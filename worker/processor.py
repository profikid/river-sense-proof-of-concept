import base64
import json
import logging
import os
import time
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np
import redis
import psutil
from prometheus_client import Counter, Gauge, start_http_server

try:
    import pynvml
except Exception:  # pragma: no cover - optional GPU dependency
    pynvml = None

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s [worker] %(message)s",
)
logger = logging.getLogger("vectorflow.worker")

AVG_MAG = Gauge("vector_flow_magnitude_avg", "Average motion vector magnitude", ["stream_id", "stream_name"])
MAX_MAG = Gauge("vector_flow_magnitude_max", "Maximum motion vector magnitude", ["stream_id", "stream_name"])
VECTORS = Gauge("vector_flow_vector_count", "Count of vectors above threshold", ["stream_id", "stream_name"])
FPS = Gauge("vector_flow_fps", "Processing frames per second", ["stream_id", "stream_name"])
FRAMES = Counter("vector_flow_frames_processed_total", "Total processed frames", ["stream_id", "stream_name"])
STREAM_CONNECTED = Gauge("vector_flow_stream_connected", "Stream connectivity status (1=connected)", ["stream_id", "stream_name"])
WORKER_MEMORY_RSS = Gauge(
    "vector_flow_worker_memory_rss_bytes",
    "Resident memory used by worker process",
    ["stream_id", "stream_name"],
)
WORKER_MEMORY_PERCENT = Gauge(
    "vector_flow_worker_memory_percent",
    "Percentage of system memory used by worker process",
    ["stream_id", "stream_name"],
)
GPU_AVAILABLE = Gauge("vector_flow_gpu_available", "GPU availability for this worker", ["stream_id", "stream_name"])
GPU_UTILIZATION = Gauge(
    "vector_flow_gpu_utilization_percent",
    "GPU utilization percent for this worker",
    ["stream_id", "stream_name"],
)
GPU_MEMORY_USED = Gauge(
    "vector_flow_gpu_memory_used_bytes",
    "Used GPU memory in bytes for this worker",
    ["stream_id", "stream_name"],
)
GPU_MEMORY_TOTAL = Gauge(
    "vector_flow_gpu_memory_total_bytes",
    "Total GPU memory in bytes for this worker",
    ["stream_id", "stream_name"],
)


def env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "y", "on"}


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


@dataclass
class FlowVector:
    x: float
    y: float
    u: float
    v: float
    mag: float


class FlowProcessor:
    def __init__(self) -> None:
        self.stream_id = os.getenv("STREAM_ID", "unknown")
        self.stream_name = os.getenv("STREAM_NAME", "unnamed-stream")
        self.rtsp_url = os.getenv("RTSP_URL", "")

        self.grid_size = int(clamp(float(os.getenv("GRID_SIZE", "16")), 4.0, 128.0))
        self.win_radius = int(clamp(float(os.getenv("WIN_RADIUS", "8")), 2.0, 32.0))
        self.threshold = float(clamp(float(os.getenv("THRESHOLD", "1.2")), 0.0, 100.0))

        self.arrow_scale = float(clamp(float(os.getenv("ARROW_SCALE", "4.0")), 0.1, 25.0))
        self.arrow_opacity = float(clamp(float(os.getenv("ARROW_OPACITY", "90.0")), 0.0, 100.0))
        self.gradient_intensity = float(
            clamp(float(os.getenv("GRADIENT_INTENSITY", "1.0")), 0.1, 5.0)
        )

        self.show_feed = env_bool("SHOW_FEED", True)
        self.show_arrows = env_bool("SHOW_ARROWS", True)
        self.show_magnitude = env_bool("SHOW_MAGNITUDE", False)
        self.show_trails = env_bool("SHOW_TRAILS", False)

        self.prometheus_port = int(os.getenv("PROMETHEUS_PORT", "9100"))
        self.redis_url = os.getenv("REDIS_URL", "redis://redis:6379/0")
        self.redis_channel = os.getenv("REDIS_CHANNEL", "flow.frames")
        self.reconnect_delay = float(os.getenv("RECONNECT_DELAY_SEC", "2.0"))
        self.max_vectors_out = int(os.getenv("MAX_VECTORS_OUT", "120"))
        self.trail_decay = float(clamp(float(os.getenv("TRAIL_DECAY", "0.88")), 0.5, 0.99))
        self.status_interval_sec = float(os.getenv("STATUS_INTERVAL_SEC", "5.0"))
        self.last_status_sent = 0.0

        self.prev_gray: Optional[np.ndarray] = None
        self.prev_frame_time = time.perf_counter()
        self.trail_layer: Optional[np.ndarray] = None
        self.process = psutil.Process()
        self.gpu_handle = None

        lk_window = max(5, self.win_radius * 2 + 1)
        if lk_window % 2 == 0:
            lk_window += 1

        self.lk_params = {
            "winSize": (lk_window, lk_window),
            "maxLevel": 2,
            "criteria": (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 20, 0.03),
        }

        self.feature_params = {
            "maxCorners": 800,
            "qualityLevel": 0.01,
            "minDistance": max(4, self.grid_size // 2),
            "blockSize": 7,
        }

        self.redis_client = redis.from_url(self.redis_url, decode_responses=True)

        labels = {"stream_id": self.stream_id, "stream_name": self.stream_name}
        self.metric_avg = AVG_MAG.labels(**labels)
        self.metric_max = MAX_MAG.labels(**labels)
        self.metric_vectors = VECTORS.labels(**labels)
        self.metric_fps = FPS.labels(**labels)
        self.metric_frames = FRAMES.labels(**labels)
        self.metric_connected = STREAM_CONNECTED.labels(**labels)
        self.metric_mem_rss = WORKER_MEMORY_RSS.labels(**labels)
        self.metric_mem_pct = WORKER_MEMORY_PERCENT.labels(**labels)
        self.metric_gpu_available = GPU_AVAILABLE.labels(**labels)
        self.metric_gpu_util = GPU_UTILIZATION.labels(**labels)
        self.metric_gpu_mem_used = GPU_MEMORY_USED.labels(**labels)
        self.metric_gpu_mem_total = GPU_MEMORY_TOTAL.labels(**labels)

        self._init_gpu_metrics()

        logger.info(
            (
                "Worker configuration loaded: grid=%s win_radius=%s threshold=%.3f "
                "arrow_scale=%.2f arrow_opacity=%.1f gradient_intensity=%.2f "
                "show_feed=%s show_arrows=%s show_magnitude=%s show_trails=%s"
            ),
            self.grid_size,
            self.win_radius,
            self.threshold,
            self.arrow_scale,
            self.arrow_opacity,
            self.gradient_intensity,
            self.show_feed,
            self.show_arrows,
            self.show_magnitude,
            self.show_trails,
        )

    def _init_gpu_metrics(self) -> None:
        self.metric_gpu_available.set(0)
        self.metric_gpu_util.set(0.0)
        self.metric_gpu_mem_used.set(0.0)
        self.metric_gpu_mem_total.set(0.0)

        if pynvml is None:
            logger.info("NVML library not available. GPU metrics disabled.")
            return

        gpu_index = int(os.getenv("GPU_INDEX", "0"))
        try:
            pynvml.nvmlInit()
            self.gpu_handle = pynvml.nvmlDeviceGetHandleByIndex(gpu_index)
            self.metric_gpu_available.set(1)
            logger.info("GPU metrics enabled on device index %s", gpu_index)
        except Exception as exc:
            self.gpu_handle = None
            logger.info("GPU not available for metrics: %s", exc)

    def _collect_runtime_metrics(self) -> Tuple[int, float]:
        rss_bytes = 0
        mem_percent = 0.0
        try:
            memory_info = self.process.memory_info()
            rss_bytes = int(memory_info.rss)
            mem_percent = float(self.process.memory_percent())
        except Exception:
            pass

        self.metric_mem_rss.set(rss_bytes)
        self.metric_mem_pct.set(mem_percent)

        if self.gpu_handle is None:
            self.metric_gpu_available.set(0)
            self.metric_gpu_util.set(0.0)
            self.metric_gpu_mem_used.set(0.0)
            self.metric_gpu_mem_total.set(0.0)
            return rss_bytes, mem_percent

        try:
            util = pynvml.nvmlDeviceGetUtilizationRates(self.gpu_handle)
            mem = pynvml.nvmlDeviceGetMemoryInfo(self.gpu_handle)
            self.metric_gpu_available.set(1)
            self.metric_gpu_util.set(float(util.gpu))
            self.metric_gpu_mem_used.set(float(mem.used))
            self.metric_gpu_mem_total.set(float(mem.total))
        except Exception:
            self.metric_gpu_available.set(0)
            self.metric_gpu_util.set(0.0)
            self.metric_gpu_mem_used.set(0.0)
            self.metric_gpu_mem_total.set(0.0)

        return rss_bytes, mem_percent

    def _publish_status(self, status: str, error: Optional[str] = None, force: bool = False) -> None:
        now = time.time()
        if not force and now - self.last_status_sent < self.status_interval_sec:
            return

        payload = {
            "type": "stream_status",
            "stream_id": self.stream_id,
            "stream_name": self.stream_name,
            "timestamp": int(now * 1000),
            "status": status,
        }
        if error:
            payload["error"] = error

        try:
            self.redis_client.publish(self.redis_channel, json.dumps(payload))
            self.last_status_sent = now
        except Exception as exc:
            logger.warning("Redis status publish failed: %s", exc)

    def _open_capture(self) -> cv2.VideoCapture:
        attempt = 0
        while True:
            logger.info("Opening stream: %s", self.rtsp_url)
            cap = cv2.VideoCapture(self.rtsp_url)
            if cap.isOpened():
                self.metric_connected.set(1)
                self._publish_status("connected", force=True)
                return cap

            attempt += 1
            self.metric_connected.set(0)
            self._publish_status(
                "error",
                error=f"Unable to open stream source (attempt {attempt}).",
                force=True,
            )
            logger.warning("Unable to open stream. Retrying in %.1fs", self.reconnect_delay)
            cap.release()
            time.sleep(self.reconnect_delay)

    def _compute_vectors(self, prev_gray: np.ndarray, curr_gray: np.ndarray) -> List[FlowVector]:
        p0 = cv2.goodFeaturesToTrack(prev_gray, mask=None, **self.feature_params)
        if p0 is None or len(p0) == 0:
            return []

        p1, status, _ = cv2.calcOpticalFlowPyrLK(prev_gray, curr_gray, p0, None, **self.lk_params)
        if p1 is None or status is None:
            return []

        good_new = p1[status.flatten() == 1]
        good_old = p0[status.flatten() == 1]

        best_per_cell: Dict[tuple[int, int], FlowVector] = {}

        for new_pt, old_pt in zip(good_new, good_old):
            x1, y1 = old_pt.ravel()
            x2, y2 = new_pt.ravel()
            u = float(x2 - x1)
            v = float(y2 - y1)
            mag = float(np.hypot(u, v))

            if mag < self.threshold:
                continue

            cell = (int(x1) // self.grid_size, int(y1) // self.grid_size)
            current = best_per_cell.get(cell)
            if current is None or mag > current.mag:
                best_per_cell[cell] = FlowVector(x=float(x1), y=float(y1), u=u, v=v, mag=mag)

        return list(best_per_cell.values())

    def _intensity_color(self, magnitude: float) -> tuple[int, int, int]:
        normalized = float(np.clip(magnitude / 15.0, 0.0, 1.0))
        if normalized < 0.33:
            red = 0
            green = 255 * (1 - normalized * 3)
            blue = 255
        elif normalized < 0.66:
            red = 255 * (normalized - 0.33) * 3
            green = 0
            blue = 255
        else:
            red = 255
            green = 0
            blue = 255 * (1 - (normalized - 0.66) * 3)

        # OpenCV uses BGR ordering.
        return int(blue), int(green), int(red)

    def _ensure_trail_layer(self, shape: tuple[int, int, int]) -> np.ndarray:
        if self.trail_layer is None or self.trail_layer.shape != shape:
            self.trail_layer = np.zeros(shape, dtype=np.uint8)
        return self.trail_layer

    def _build_overlay(self, frame: np.ndarray, vectors: List[FlowVector]) -> np.ndarray:
        overlay = frame.copy() if self.show_feed else np.zeros_like(frame)
        arrow_alpha = self.arrow_opacity / 100.0

        if self.show_magnitude and vectors:
            heat_layer = np.zeros_like(overlay)
            radius = max(4, int(self.grid_size * 0.9))
            for vector in vectors[: self.max_vectors_out]:
                color = self._intensity_color(vector.mag * self.gradient_intensity)
                cv2.circle(
                    heat_layer,
                    (int(vector.x), int(vector.y)),
                    radius,
                    color,
                    thickness=-1,
                    lineType=cv2.LINE_AA,
                )

            heat_alpha = float(np.clip(0.22 * self.gradient_intensity, 0.1, 0.9))
            overlay = cv2.addWeighted(overlay, 1.0, heat_layer, heat_alpha, 0.0)

        if self.show_arrows and vectors:
            arrow_layer = np.zeros_like(overlay)
            for vector in vectors[: self.max_vectors_out]:
                start = (int(vector.x), int(vector.y))
                end = (
                    int(vector.x + vector.u * self.arrow_scale),
                    int(vector.y + vector.v * self.arrow_scale),
                )
                thickness = max(1, min(3, int(vector.mag / 4) + 1))
                cv2.arrowedLine(
                    arrow_layer,
                    start,
                    end,
                    self._intensity_color(vector.mag),
                    thickness=thickness,
                    tipLength=0.28,
                    line_type=cv2.LINE_AA,
                )

            overlay = cv2.addWeighted(overlay, 1.0, arrow_layer, arrow_alpha, 0.0)

        if self.show_trails and vectors:
            trail = self._ensure_trail_layer(overlay.shape)
            trail[:] = (trail.astype(np.float32) * self.trail_decay).astype(np.uint8)

            trail_step = np.zeros_like(overlay)
            for vector in vectors[: self.max_vectors_out]:
                start = (int(vector.x), int(vector.y))
                end = (
                    int(vector.x + vector.u * self.arrow_scale * 0.8),
                    int(vector.y + vector.v * self.arrow_scale * 0.8),
                )
                cv2.line(
                    trail_step,
                    start,
                    end,
                    self._intensity_color(vector.mag),
                    thickness=1,
                    lineType=cv2.LINE_AA,
                )

            self.trail_layer = cv2.add(trail, trail_step)
            overlay = cv2.addWeighted(overlay, 1.0, self.trail_layer, max(0.15, arrow_alpha * 0.55), 0.0)
        else:
            self.trail_layer = None

        return overlay

    def _publish_frame(
        self,
        frame: np.ndarray,
        vectors: List[FlowVector],
        fps: float,
        avg_mag: float,
        max_mag: float,
    ) -> None:
        ok, encoded = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 72])
        if not ok:
            return

        frame_b64 = base64.b64encode(encoded.tobytes()).decode("ascii")
        payload = {
            "type": "frame",
            "stream_id": self.stream_id,
            "stream_name": self.stream_name,
            "timestamp": int(time.time() * 1000),
            "width": int(frame.shape[1]),
            "height": int(frame.shape[0]),
            "fps": round(fps, 2),
            "avg_magnitude": round(avg_mag, 4),
            "max_magnitude": round(max_mag, 4),
            "vector_count": len(vectors),
            "vectors": [
                {
                    "x": round(v.x, 2),
                    "y": round(v.y, 2),
                    "u": round(v.u, 3),
                    "v": round(v.v, 3),
                    "mag": round(v.mag, 3),
                }
                for v in vectors[: self.max_vectors_out]
            ],
            "config": {
                "grid_size": self.grid_size,
                "win_radius": self.win_radius,
                "threshold": self.threshold,
                "arrow_scale": self.arrow_scale,
                "arrow_opacity": self.arrow_opacity,
                "gradient_intensity": self.gradient_intensity,
                "show_feed": self.show_feed,
                "show_arrows": self.show_arrows,
                "show_magnitude": self.show_magnitude,
                "show_trails": self.show_trails,
            },
            "frame_b64": frame_b64,
        }

        try:
            self.redis_client.publish(self.redis_channel, json.dumps(payload))
        except Exception as exc:
            logger.warning("Redis publish failed: %s", exc)

    def _update_metrics(self, vectors: List[FlowVector], fps: float) -> tuple[float, float]:
        if vectors:
            mags = np.array([v.mag for v in vectors], dtype=np.float32)
            avg_mag = float(np.mean(mags))
            max_mag = float(np.max(mags))
            count = int(len(vectors))
        else:
            avg_mag = 0.0
            max_mag = 0.0
            count = 0

        self.metric_avg.set(avg_mag)
        self.metric_max.set(max_mag)
        self.metric_vectors.set(count)
        self.metric_fps.set(fps)
        self.metric_frames.inc()
        return avg_mag, max_mag

    def _compute_fps(self) -> float:
        now = time.perf_counter()
        elapsed = max(1e-6, now - self.prev_frame_time)
        self.prev_frame_time = now
        return 1.0 / elapsed

    def run(self) -> None:
        if not self.rtsp_url:
            raise RuntimeError("RTSP_URL is required")

        start_http_server(self.prometheus_port)
        logger.info("Prometheus metrics available on :%s/metrics", self.prometheus_port)
        self.metric_connected.set(0)
        self._collect_runtime_metrics()

        while True:
            cap = self._open_capture()
            self.prev_gray = None
            self.trail_layer = None

            while True:
                ok, frame = cap.read()
                if not ok or frame is None:
                    if self.rtsp_url.lower().startswith("rtsp://"):
                        self.metric_connected.set(0)
                        self._publish_status(
                            "error",
                            error="Stream read failed. Reconnecting to source.",
                            force=True,
                        )
                        logger.warning("Stream read failed, reconnecting...")
                        break

                    # Local file fallback: loop videos instead of exiting.
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    continue

                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                if self.prev_gray is None:
                    self.prev_gray = gray
                    continue

                fps = self._compute_fps()
                vectors = self._compute_vectors(self.prev_gray, gray)
                avg_mag, max_mag = self._update_metrics(vectors, fps)
                self._collect_runtime_metrics()
                self.metric_connected.set(1)
                self._publish_status("connected")

                overlay = self._build_overlay(frame, vectors)
                self._publish_frame(overlay, vectors, fps, avg_mag, max_mag)

                self.prev_gray = gray

            cap.release()
            time.sleep(self.reconnect_delay)


if __name__ == "__main__":
    processor = FlowProcessor()
    processor.run()
