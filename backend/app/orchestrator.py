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

try:
    from kubernetes import client as k8s_client
    from kubernetes import config as k8s_config
    from kubernetes.client.rest import ApiException as K8sApiException
except Exception:  # pragma: no cover - optional dependency for docker-only runtime
    k8s_client = None
    k8s_config = None
    K8sApiException = Exception  # type: ignore[assignment]


class WorkerOrchestrator:
    def __init__(self) -> None:
        self.worker_image = os.getenv("WORKER_IMAGE", "vectorflow-worker:latest")
        self.worker_build_context = os.getenv("WORKER_BUILD_CONTEXT", "/opt/worker")
        self.runtime = os.getenv("WORKER_RUNTIME", "docker").strip().lower()
        self.docker_network = os.getenv("DOCKER_NETWORK", "vectorflow")
        self.prometheus_sd_file = Path(os.getenv("PROMETHEUS_SD_FILE", "/prometheus_sd/workers.json"))
        self.metrics_port = int(os.getenv("WORKER_METRICS_PORT", "9100"))
        self.k8s_namespace = os.getenv("WORKER_K8S_NAMESPACE", "default")
        self.k8s_image_pull_policy = os.getenv("WORKER_K8S_IMAGE_PULL_POLICY", "IfNotPresent")
        self.redis_url = os.getenv("REDIS_URL", "redis://redis:6379/0")
        self.redis_channel = os.getenv("REDIS_CHANNEL", "flow.frames")
        self.default_live_preview_fps = float(os.getenv("LIVE_PREVIEW_FPS_DEFAULT", "6.0"))
        self.default_live_preview_jpeg_quality = int(os.getenv("LIVE_PREVIEW_JPEG_QUALITY_DEFAULT", "65"))
        self.default_live_preview_max_width = int(os.getenv("LIVE_PREVIEW_MAX_WIDTH_DEFAULT", "960"))

        self.client: Optional[docker.DockerClient] = None
        self.k8s_apps_api: Optional["k8s_client.AppsV1Api"] = None
        self.k8s_core_api: Optional["k8s_client.CoreV1Api"] = None
        self._image_checked = False

        if self.runtime not in {"docker", "kubernetes"}:
            logger.warning("Unsupported WORKER_RUNTIME=%s, defaulting to docker", self.runtime)
            self.runtime = "docker"

        self._connect()

    def _connect(self) -> None:
        if self.runtime == "kubernetes":
            self._connect_kubernetes()
            return
        self._connect_docker()

    def _connect_docker(self) -> None:
        try:
            self.client = docker.from_env()
            self.client.ping()
            logger.info("Connected to Docker API")
        except DockerException as exc:
            self.client = None
            logger.warning("Docker API unavailable: %s", exc)

    def _connect_kubernetes(self) -> None:
        if k8s_client is None or k8s_config is None:
            logger.warning(
                "Kubernetes runtime requested, but kubernetes package is unavailable. "
                "Install backend dependency `kubernetes`."
            )
            self.k8s_apps_api = None
            self.k8s_core_api = None
            return

        try:
            try:
                k8s_config.load_incluster_config()
            except Exception:
                k8s_config.load_kube_config()
            self.k8s_apps_api = k8s_client.AppsV1Api()
            self.k8s_core_api = k8s_client.CoreV1Api()
            logger.info("Connected to Kubernetes API (namespace=%s)", self.k8s_namespace)
        except Exception as exc:
            self.k8s_apps_api = None
            self.k8s_core_api = None
            logger.warning("Kubernetes API unavailable: %s", exc)

    def _require_client(self) -> docker.DockerClient:
        if self.client is None:
            self._connect_docker()
        if self.client is None:
            raise RuntimeError(
                "Docker API unavailable. Mount /var/run/docker.sock into the API container."
            )
        return self.client

    def _require_k8s_apis(self) -> tuple["k8s_client.AppsV1Api", "k8s_client.CoreV1Api"]:
        if self.k8s_apps_api is None or self.k8s_core_api is None:
            self._connect_kubernetes()
        if self.k8s_apps_api is None or self.k8s_core_api is None:
            raise RuntimeError(
                "Kubernetes API unavailable. Ensure API pod has in-cluster credentials "
                "and RBAC permissions for deployments and pods."
            )
        return self.k8s_apps_api, self.k8s_core_api

    def _container_name(self, stream_id: str) -> str:
        safe_id = stream_id.replace("-", "")[:12]
        return f"vector-worker-{safe_id}"

    def ensure_worker_image(self) -> None:
        if self.runtime == "kubernetes":
            self._image_checked = True
            return

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

    def _worker_environment(self, db: Session, stream: CameraStream) -> dict[str, str]:
        live_preview_fps, live_preview_jpeg_quality, live_preview_max_width = (
            self._resolve_live_preview_settings(db)
        )
        return {
            "STREAM_ID": str(stream.id),
            "STREAM_NAME": stream.name,
            "RTSP_URL": stream.rtsp_url,
            "LATITUDE": "" if stream.latitude is None else f"{float(stream.latitude):.6f}",
            "LONGITUDE": "" if stream.longitude is None else f"{float(stream.longitude):.6f}",
            "ORIENTATION_DEG": str(float(stream.orientation_deg)),
            "VIEW_ANGLE_DEG": str(float(stream.view_angle_deg)),
            "VIEW_DISTANCE_M": str(float(stream.view_distance_m)),
            "CAMERA_TILT_DEG": str(float(stream.camera_tilt_deg)),
            "CAMERA_HEIGHT_M": str(float(stream.camera_height_m)),
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

    def get_worker_status(self, container_name: Optional[str]) -> str:
        if self.runtime == "kubernetes":
            return self._get_worker_status_kubernetes(container_name)

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

    def _get_worker_status_kubernetes(self, container_name: Optional[str]) -> str:
        if not container_name:
            return "stopped"

        try:
            apps_api, core_api = self._require_k8s_apis()
            deployment = apps_api.read_namespaced_deployment(
                name=container_name,
                namespace=self.k8s_namespace,
            )
            desired = int(deployment.spec.replicas or 0) if deployment.spec else 0
            ready = int(deployment.status.ready_replicas or 0) if deployment.status else 0
            available = int(deployment.status.available_replicas or 0) if deployment.status else 0
            if desired <= 0:
                return "stopped"
            if ready >= desired or available >= desired:
                return "running"

            pods = core_api.list_namespaced_pod(
                namespace=self.k8s_namespace,
                label_selector=f"vectorflow_worker={container_name}",
            ).items
            for pod in pods:
                phase = (pod.status.phase if pod.status and pod.status.phase else "").lower()
                if phase in {"pending", "running"}:
                    return "starting"
                if phase == "failed":
                    return "error"
            return "starting"
        except K8sApiException as exc:
            if getattr(exc, "status", None) == 404:
                return "missing"
            logger.warning("Unable to read worker status from Kubernetes: %s", exc)
            return "unknown"
        except Exception:
            return "unknown"

    def get_worker_logs(self, container_name: Optional[str], tail: int = 200) -> list[str]:
        if self.runtime == "kubernetes":
            return self._get_worker_logs_kubernetes(container_name, tail=tail)

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

    def _get_worker_logs_kubernetes(self, container_name: Optional[str], tail: int = 200) -> list[str]:
        if not container_name:
            return []

        safe_tail = max(1, min(int(tail), 1000))
        try:
            _, core_api = self._require_k8s_apis()
            pods = core_api.list_namespaced_pod(
                namespace=self.k8s_namespace,
                label_selector=f"vectorflow_worker={container_name}",
            ).items
            if not pods:
                return []

            pods.sort(
                key=lambda p: (
                    p.metadata.creation_timestamp.timestamp()
                    if p.metadata and p.metadata.creation_timestamp
                    else 0.0
                ),
                reverse=True,
            )

            chosen = None
            for pod in pods:
                phase = (pod.status.phase if pod.status and pod.status.phase else "").lower()
                if phase == "running":
                    chosen = pod
                    break
            if chosen is None:
                chosen = pods[0]

            pod_name = chosen.metadata.name if chosen.metadata else None
            if not pod_name:
                return []

            raw = core_api.read_namespaced_pod_log(
                name=pod_name,
                namespace=self.k8s_namespace,
                tail_lines=safe_tail,
                timestamps=True,
                container="worker",
            )
            return [line for line in raw.splitlines() if line.strip()]
        except K8sApiException as exc:
            if getattr(exc, "status", None) == 404:
                return []
            raise RuntimeError(f"Unable to fetch worker logs from {container_name}: {exc}") from exc
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
        if self.runtime == "kubernetes":
            return self._start_worker_kubernetes(db, stream)
        return self._start_worker_docker(db, stream)

    def _start_worker_docker(self, db: Session, stream: CameraStream) -> str:
        client = self._require_client()
        self.ensure_worker_image()

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

        environment = self._worker_environment(db, stream)

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

    def _start_worker_kubernetes(self, db: Session, stream: CameraStream) -> str:
        if k8s_client is None:
            raise RuntimeError(
                "Kubernetes runtime requested, but backend dependency `kubernetes` is not installed."
            )

        self.ensure_worker_image()
        apps_api, _ = self._require_k8s_apis()
        deployment_name = self._container_name(str(stream.id))
        environment = self._worker_environment(db, stream)
        labels = {
            "app": "vectorflow-worker",
            "stream_id": str(stream.id),
            "vectorflow_worker": deployment_name,
        }
        annotations = {
            "vectorflow.io/stream-id": str(stream.id),
            "vectorflow.io/stream-name": stream.name[:512],
        }

        container = k8s_client.V1Container(
            name="worker",
            image=self.worker_image,
            image_pull_policy=self.k8s_image_pull_policy,
            env=[k8s_client.V1EnvVar(name=key, value=value) for key, value in environment.items()],
            ports=[k8s_client.V1ContainerPort(name="metrics", container_port=self.metrics_port)],
        )
        template = k8s_client.V1PodTemplateSpec(
            metadata=k8s_client.V1ObjectMeta(labels=labels, annotations=annotations),
            spec=k8s_client.V1PodSpec(containers=[container], restart_policy="Always"),
        )
        spec = k8s_client.V1DeploymentSpec(
            replicas=1,
            selector=k8s_client.V1LabelSelector(match_labels={"vectorflow_worker": deployment_name}),
            template=template,
        )
        deployment = k8s_client.V1Deployment(
            api_version="apps/v1",
            kind="Deployment",
            metadata=k8s_client.V1ObjectMeta(
                name=deployment_name,
                namespace=self.k8s_namespace,
                labels=labels,
                annotations=annotations,
            ),
            spec=spec,
        )

        try:
            existing = apps_api.read_namespaced_deployment(
                name=deployment_name,
                namespace=self.k8s_namespace,
            )
            deployment.metadata.resource_version = existing.metadata.resource_version
            apps_api.replace_namespaced_deployment(
                name=deployment_name,
                namespace=self.k8s_namespace,
                body=deployment,
            )
        except K8sApiException as exc:
            if getattr(exc, "status", None) != 404:
                raise RuntimeError(f"Unable to upsert Kubernetes worker {deployment_name}: {exc}") from exc
            apps_api.create_namespaced_deployment(
                namespace=self.k8s_namespace,
                body=deployment,
            )

        stream.worker_container_name = deployment_name
        stream.worker_started_at = datetime.utcnow()
        stream.is_active = True
        self.refresh_prometheus_targets(db)
        return deployment_name

    def stop_worker(self, db: Session, stream: CameraStream, deactivate: bool = True) -> None:
        if self.runtime == "kubernetes":
            self._stop_worker_kubernetes(db, stream, deactivate=deactivate)
            return
        self._stop_worker_docker(db, stream, deactivate=deactivate)

    def _stop_worker_docker(self, db: Session, stream: CameraStream, deactivate: bool = True) -> None:
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

    def _stop_worker_kubernetes(self, db: Session, stream: CameraStream, deactivate: bool = True) -> None:
        container_name = stream.worker_container_name or self._container_name(str(stream.id))
        try:
            apps_api, _ = self._require_k8s_apis()
            apps_api.delete_namespaced_deployment(
                name=container_name,
                namespace=self.k8s_namespace,
                body=k8s_client.V1DeleteOptions(
                    propagation_policy="Background",
                    grace_period_seconds=0,
                )
                if k8s_client
                else None,
            )
        except K8sApiException as exc:
            if getattr(exc, "status", None) != 404:
                raise RuntimeError(f"Unable to stop worker {container_name}: {exc}") from exc
            logger.info("Worker deployment %s already absent", container_name)
        except Exception as exc:
            raise RuntimeError(f"Unable to stop worker {container_name}: {exc}") from exc

        stream.worker_container_name = None
        stream.worker_started_at = None
        if deactivate:
            stream.is_active = False

        self.refresh_prometheus_targets(db)

    def refresh_prometheus_targets(self, db: Session) -> None:
        if self.runtime == "kubernetes":
            return

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
            if status not in {"running", "starting"}:
                stream.worker_container_name = None
                stream.worker_started_at = None
                stream.is_active = False
                changed = True

        if changed:
            db.commit()

        self.refresh_prometheus_targets(db)
