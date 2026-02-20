import asyncio
import json
import logging
import time
from contextlib import suppress
from datetime import datetime, timezone
from typing import Dict, Optional

from fastapi import WebSocket
from redis.asyncio import Redis

logger = logging.getLogger(__name__)


class FrameBroker:
    def __init__(self, redis_url: str, channel: str) -> None:
        self.redis_url = redis_url
        self.channel = channel
        self.connections: Dict[WebSocket, Optional[str]] = {}
        self.stream_states: Dict[str, dict] = {}
        self.last_frame_emit_at: Dict[str, float] = {}
        self._task: Optional[asyncio.Task] = None
        self._running = False
        self.frame_emit_interval_sec = 0.0

    def set_frame_rate_limit(self, fps: float) -> None:
        safe_fps = max(0.5, min(float(fps), 30.0))
        self.frame_emit_interval_sec = 1.0 / safe_fps

    async def start(self) -> None:
        if self._task:
            return
        self._running = True
        self._task = asyncio.create_task(self._listen_loop())

    async def stop(self) -> None:
        self._running = False

        if self._task:
            self._task.cancel()
            with suppress(asyncio.CancelledError):
                await self._task
            self._task = None

        for websocket in list(self.connections.keys()):
            with suppress(Exception):
                await websocket.close()
        self.connections.clear()

    async def connect(self, websocket: WebSocket, stream_filter: Optional[str]) -> None:
        await websocket.accept()
        self.connections[websocket] = stream_filter

    def disconnect(self, websocket: WebSocket) -> None:
        self.connections.pop(websocket, None)

    async def _listen_loop(self) -> None:
        while self._running:
            redis_client: Optional[Redis] = None
            pubsub = None
            try:
                redis_client = Redis.from_url(self.redis_url, decode_responses=True)
                pubsub = redis_client.pubsub()
                await pubsub.subscribe(self.channel)
                logger.info("Subscribed to Redis channel: %s", self.channel)

                while self._running:
                    message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                    if message and message.get("type") == "message":
                        payload = message.get("data")
                        if payload:
                            await self._broadcast(str(payload))
                    await asyncio.sleep(0.01)
            except Exception as exc:
                logger.warning("Frame broker reconnecting after error: %s", exc)
                await asyncio.sleep(2)
            finally:
                if pubsub:
                    with suppress(Exception):
                        await pubsub.unsubscribe(self.channel)
                    with suppress(Exception):
                        await pubsub.aclose()
                if redis_client:
                    with suppress(Exception):
                        await redis_client.aclose()

    async def _broadcast(self, payload: str) -> None:
        stream_id = None
        is_frame = False
        try:
            decoded = json.loads(payload)
            stream_id = decoded.get("stream_id")
            is_frame = decoded.get("type") == "frame" or "frame_b64" in decoded
            self._update_stream_state(decoded)
        except json.JSONDecodeError:
            pass

        if is_frame and stream_id and self.frame_emit_interval_sec > 0:
            now = time.perf_counter()
            last_emit = self.last_frame_emit_at.get(stream_id, 0.0)
            if now - last_emit < self.frame_emit_interval_sec:
                return
            self.last_frame_emit_at[stream_id] = now

        stale = []
        for websocket, stream_filter in list(self.connections.items()):
            if stream_filter and stream_id and stream_filter != stream_id:
                continue
            if stream_filter and stream_id is None:
                continue
            try:
                await websocket.send_text(payload)
            except Exception:
                stale.append(websocket)

        for websocket in stale:
            self.disconnect(websocket)

    def get_stream_state(self, stream_id: str) -> Optional[dict]:
        return self.stream_states.get(stream_id)

    @staticmethod
    def _parse_timestamp(timestamp_ms: Optional[int]) -> Optional[datetime]:
        if not timestamp_ms:
            return None
        try:
            return datetime.fromtimestamp(float(timestamp_ms) / 1000.0, tz=timezone.utc).replace(tzinfo=None)
        except Exception:
            return None

    def _update_stream_state(self, message: dict) -> None:
        stream_id = message.get("stream_id")
        if not stream_id:
            return

        event_type = message.get("type", "frame")
        status = message.get("status")
        error = message.get("error")
        event_time = self._parse_timestamp(message.get("timestamp"))

        current = self.stream_states.get(stream_id, {})

        if event_type == "stream_status":
            if status:
                current["connection_status"] = status
            if error:
                current["last_error"] = str(error)
            elif status in {"connected", "ok"}:
                current["last_error"] = None
        elif event_type == "frame" or "frame_b64" in message:
            current["connection_status"] = "connected"
            current["last_error"] = None

        if event_time:
            current["last_event_at"] = event_time
        else:
            current["last_event_at"] = datetime.utcnow()

        self.stream_states[stream_id] = current
