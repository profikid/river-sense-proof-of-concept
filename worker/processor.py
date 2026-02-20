import base64
import json
import logging
import os
import time
from dataclasses import dataclass
from typing import Dict, List, Optional

import cv2
import numpy as np
import redis
from prometheus_client import Counter, Gauge, start_http_server

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
        self.grid_size = int(os.getenv("GRID_SIZE", "16"))
        self.threshold = float(os.getenv("THRESHOLD", "1.2"))
        self.prometheus_port = int(os.getenv("PROMETHEUS_PORT", "9100"))
        self.redis_url = os.getenv("REDIS_URL", "redis://redis:6379/0")
        self.redis_channel = os.getenv("REDIS_CHANNEL", "flow.frames")
        self.reconnect_delay = float(os.getenv("RECONNECT_DELAY_SEC", "2.0"))
        self.max_vectors_out = int(os.getenv("MAX_VECTORS_OUT", "120"))

        self.prev_gray: Optional[np.ndarray] = None
        self.prev_frame_time = time.perf_counter()

        self.lk_params = {
            "winSize": (15, 15),
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

    def _open_capture(self) -> cv2.VideoCapture:
        while True:
            logger.info("Opening stream: %s", self.rtsp_url)
            cap = cv2.VideoCapture(self.rtsp_url)
            if cap.isOpened():
                return cap
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

    def _build_overlay(self, frame: np.ndarray, vectors: List[FlowVector]) -> np.ndarray:
        overlay = frame.copy()
        for vector in vectors[: self.max_vectors_out]:
            start = (int(vector.x), int(vector.y))
            end = (int(vector.x + vector.u * 4), int(vector.y + vector.v * 4))
            color = (0, min(255, int(40 + vector.mag * 35)), 255)
            cv2.arrowedLine(overlay, start, end, color, 1, tipLength=0.3)

        return overlay

    def _publish_frame(self, frame: np.ndarray, vectors: List[FlowVector], fps: float, avg_mag: float, max_mag: float) -> None:
        ok, encoded = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 72])
        if not ok:
            return

        frame_b64 = base64.b64encode(encoded.tobytes()).decode("ascii")
        payload = {
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

        while True:
            cap = self._open_capture()
            self.prev_gray = None

            while True:
                ok, frame = cap.read()
                if not ok or frame is None:
                    if self.rtsp_url.lower().startswith("rtsp://"):
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

                overlay = self._build_overlay(frame, vectors)
                self._publish_frame(overlay, vectors, fps, avg_mag, max_mag)

                self.prev_gray = gray

            cap.release()
            time.sleep(self.reconnect_delay)


if __name__ == "__main__":
    processor = FlowProcessor()
    processor.run()
