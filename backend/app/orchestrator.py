import json
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Optional

import docker
from docker.errors import APIError, DockerException, ImageNotFound, NotFound
from sqlalchemy.orm import Session

from .models import CameraStream, SystemSettings

logger = logging.getLogger(__name__)


class WorkerOrchestrator:
    def __init__(self) -> None:
        self.worker_image = os.getenv("WORKER_IMAGE", "vectorflow-worker:latest")
        self.worker_build_context = os.getenv("WORKER_BUILD_CONTEXT", "/opt/worker")
        self.docker_network = os.getenv("DOCKER_NETWORK", "vectorflow")
        self.prometheus_sd_file = Path(os.getenv("PROMETHEUS_SD_FILE", "/prometheus_sd/workers.json"))
        self.metrics_port = int(os.getenv("WORKER_METRICS_PORT", "9100"))
        self.redis_url = os.getenv("REDIS_URL", "redis://redis:6379/0")
        self.redis_channel = os.getenv("REDIS_CHANNEL", "flow.frames")
        self.default_live_preview_fps = float(os.getenv("LIVE_PREVIEW_FPS_DEFAULT", "6.0"))
        self.default_live_preview_jpeg_quality = int(os.getenv("LIVE_PREVIEW_JPEG_QUALITY_DEFAULT", "65"))
        self.default_live_preview_max_width = int(os.getenv("LIVE_PREVIEW_MAX_WIDTH_DEFAULT", "960"))

        self.client: Optional[docker.DockerClient] = None
        self._image_checked = False
        self._connect()

    def _connect(self) -> None:
        try:
            self.client = docker.from_env()
            self.client.ping()
            logger.info("Connected to Docker API")
        except DockerException as exc:
            self.client = None
            logger.warning("Docker API unavailable: %s", exc)

    def _require_client(self) -> docker.DockerClient:
        if self.client is None:
            self._connect()
        if self.client is None:
            raise RuntimeError(
                "Docker API unavailable. Mount /var/run/docker.sock into the API container."
            )
        return self.client

    def _container_name(self, stream_id: str) -> str:
        safe_id = stream_id.replace("-", "")[:12]
        return f"vector-worker-{safe_id}"

    def ensure_worker_image(self) -> None:
        if self._image_checked:
            return

        client = self._require_client()
        try:
            client.images.get(self.worker_image)
            self._image_checked = True
            return
        except ImageNotFound:
            logger.info("Worker image %s not found. Building from %s", self.worker_image, self.worker_build_context)

        if not Path(self.worker_build_context).exists():
            raise RuntimeError(
                f"Worker build context not found: {self.worker_build_context}. "
                "Mount the worker directory into the API container."
            )

        try:
            _, logs = client.images.build(path=self.worker_build_context, tag=self.worker_image, rm=True)
            for chunk in logs:
                line = chunk.get("stream", "").strip()
                if line:
                    logger.info("worker-build: %s", line)
            self._image_checked = True
        except (APIError, DockerException) as exc:
            raise RuntimeError(f"Failed to build worker image {self.worker_image}: {exc}") from exc

    def get_worker_status(self, container_name: Optional[str]) -> str:
        if not container_name:
            return "stopped"

        try:
            client = self._require_client()
            container = client.containers.get(container_name)
            container.reload()
            return container.status
        except NotFound:
            return "missing"
        except Exception:
            return "unknown"

    def get_worker_logs(self, container_name: Optional[str], tail: int = 200) -> list[str]:
        if not container_name:
            return []

        safe_tail = max(1, min(int(tail), 1000))
        try:
            client = self._require_client()
            container = client.containers.get(container_name)
            raw = container.logs(tail=safe_tail, timestamps=True)
            decoded = raw.decode("utf-8", errors="replace")
            return [line for line in decoded.splitlines() if line.strip()]
        except NotFound:
            return []
        except Exception as exc:
            raise RuntimeError(f"Unable to fetch worker logs from {container_name}: {exc}") from exc

    def _resolve_live_preview_settings(self, db: Session) -> tuple[float, int, int]:
        fps = max(0.5, min(float(self.default_live_preview_fps), 30.0))
        jpeg_quality = max(30, min(int(self.default_live_preview_jpeg_quality), 95))
        max_width = max(0, min(int(self.default_live_preview_max_width), 1920))

        try:
            settings = db.get(SystemSettings, 1) or db.query(SystemSettings).first()
        except Exception as exc:
            logger.warning("Unable to read system settings, using defaults: %s", exc)
            return fps, jpeg_quality, max_width

        if not settings:
            return fps, jpeg_quality, max_width

        try:
            fps = max(0.5, min(float(settings.live_preview_fps), 30.0))
            jpeg_quality = max(30, min(int(settings.live_preview_jpeg_quality), 95))
            max_width = max(0, min(int(settings.live_preview_max_width), 1920))
        except Exception as exc:
            logger.warning("System settings malformed, using defaults: %s", exc)

        return fps, jpeg_quality, max_width

    def start_worker(self, db: Session, stream: CameraStream) -> str:
        client = self._require_client()
        self.ensure_worker_image()
        live_preview_fps, live_preview_jpeg_quality, live_preview_max_width = (
            self._resolve_live_preview_settings(db)
        )

        container_name = self._container_name(str(stream.id))

        try:
            existing = client.containers.get(container_name)
            existing.reload()
            if existing.status != "running":
                existing.start()
            stream.worker_container_name = container_name
            stream.worker_started_at = datetime.utcnow()
            stream.is_active = True
            self.refresh_prometheus_targets(db)
            return container_name
        except NotFound:
            pass

        environment = {
            "STREAM_ID": str(stream.id),
            "STREAM_NAME": stream.name,
            "RTSP_URL": stream.rtsp_url,
            "LATITUDE": "" if stream.latitude is None else f"{float(stream.latitude):.6f}",
            "LONGITUDE": "" if stream.longitude is None else f"{float(stream.longitude):.6f}",
            "GRID_SIZE": str(stream.grid_size),
            "WIN_RADIUS": str(stream.win_radius),
            "THRESHOLD": str(stream.threshold),
            "ARROW_SCALE": str(stream.arrow_scale),
            "ARROW_OPACITY": str(stream.arrow_opacity),
            "GRADIENT_INTENSITY": str(stream.gradient_intensity),
            "SHOW_FEED": str(stream.show_feed).lower(),
            "SHOW_ARROWS": str(stream.show_arrows).lower(),
            "SHOW_MAGNITUDE": str(stream.show_magnitude).lower(),
            "SHOW_TRAILS": str(stream.show_trails).lower(),
            "PROMETHEUS_PORT": str(self.metrics_port),
            "REDIS_URL": self.redis_url,
            "REDIS_CHANNEL": self.redis_channel,
            "LIVE_PREVIEW_FPS": str(live_preview_fps),
            "LIVE_PREVIEW_JPEG_QUALITY": str(live_preview_jpeg_quality),
            "LIVE_PREVIEW_MAX_WIDTH": str(live_preview_max_width),
        }

        try:
            client.containers.run(
                self.worker_image,
                name=container_name,
                detach=True,
                network=self.docker_network,
                restart_policy={"Name": "unless-stopped"},
                environment=environment,
                labels={
                    "app": "vectorflow-worker",
                    "stream_id": str(stream.id),
                },
            )
        except (APIError, DockerException) as exc:
            raise RuntimeError(f"Unable to start worker for stream {stream.id}: {exc}") from exc

        stream.worker_container_name = container_name
        stream.worker_started_at = datetime.utcnow()
        stream.is_active = True
        self.refresh_prometheus_targets(db)
        return container_name

    def stop_worker(self, db: Session, stream: CameraStream, deactivate: bool = True) -> None:
        container_name = stream.worker_container_name or self._container_name(str(stream.id))

        try:
            client = self._require_client()
            container = client.containers.get(container_name)
            container.stop(timeout=10)
            container.remove(v=True)
        except NotFound:
            logger.info("Worker container %s already absent", container_name)
        except (APIError, DockerException) as exc:
            raise RuntimeError(f"Unable to stop worker {container_name}: {exc}") from exc

        stream.worker_container_name = None
        stream.worker_started_at = None
        if deactivate:
            stream.is_active = False

        self.refresh_prometheus_targets(db)

    def refresh_prometheus_targets(self, db: Session) -> None:
        entries = []
        active_streams = (
            db.query(CameraStream)
            .filter(CameraStream.is_active.is_(True), CameraStream.worker_container_name.isnot(None))
            .all()
        )

        for stream in active_streams:
            entries.append(
                {
                    "targets": [f"{stream.worker_container_name}:{self.metrics_port}"],
                    "labels": {
                        "stream_id": str(stream.id),
                        "stream_name": stream.name,
                    },
                }
            )

        self.prometheus_sd_file.parent.mkdir(parents=True, exist_ok=True)
        temp_file = self.prometheus_sd_file.with_suffix(".tmp")
        temp_file.write_text(json.dumps(entries, indent=2), encoding="utf-8")
        temp_file.replace(self.prometheus_sd_file)

    def reconcile(self, db: Session) -> None:
        changed = False
        streams = db.query(CameraStream).all()

        for stream in streams:
            if not stream.worker_container_name:
                continue
            status = self.get_worker_status(stream.worker_container_name)
            if status != "running":
                stream.worker_container_name = None
                stream.worker_started_at = None
                stream.is_active = False
                changed = True

        if changed:
            db.commit()

        self.refresh_prometheus_targets(db)
