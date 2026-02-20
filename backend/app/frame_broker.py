import asyncio
import json
import logging
from contextlib import suppress
from typing import Dict, Optional

from fastapi import WebSocket
from redis.asyncio import Redis

logger = logging.getLogger(__name__)


class FrameBroker:
    def __init__(self, redis_url: str, channel: str) -> None:
        self.redis_url = redis_url
        self.channel = channel
        self.connections: Dict[WebSocket, Optional[str]] = {}
        self._task: Optional[asyncio.Task] = None
        self._running = False

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
        try:
            decoded = json.loads(payload)
            stream_id = decoded.get("stream_id")
        except json.JSONDecodeError:
            pass

        stale = []
        for websocket, stream_filter in self.connections.items():
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
