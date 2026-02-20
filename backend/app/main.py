import logging
import os
from contextlib import asynccontextmanager
from typing import List, Optional
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, Query, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from prometheus_client import CONTENT_TYPE_LATEST, Gauge, generate_latest
from sqlalchemy import text
from sqlalchemy.orm import Session

from .database import Base, SessionLocal, engine, get_db
from .frame_broker import FrameBroker
from .models import CameraStream, SystemSettings
from .orchestrator import WorkerOrchestrator
from .schemas import (
    MessageResponse,
    StreamCreate,
    StreamRead,
    StreamUpdate,
    SystemSettingsRead,
    SystemSettingsUpdate,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

redis_url = os.getenv("REDIS_URL", "redis://redis:6379/0")
redis_channel = os.getenv("REDIS_CHANNEL", "flow.frames")

orchestrator = WorkerOrchestrator()
frame_broker = FrameBroker(redis_url=redis_url, channel=redis_channel)

managed_streams_metric = Gauge(
    "vector_flow_managed_streams_total",
    "Total stream records managed by the API",
)
active_streams_metric = Gauge(
    "vector_flow_active_streams_total",
    "Number of currently active streams",
)
running_streams_metric = Gauge(
    "vector_flow_running_streams_total",
    "Number of currently running streams with healthy connection",
)
streams_by_state_metric = Gauge(
    "vector_flow_streams_by_state",
    "Number of streams by dashboard state",
    ["state"],
)

SCHEMA_PATCHES = [
    "ALTER TABLE camera_streams ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION",
    "ALTER TABLE camera_streams ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION",
    "ALTER TABLE camera_streams ADD COLUMN IF NOT EXISTS win_radius INTEGER",
    "ALTER TABLE camera_streams ADD COLUMN IF NOT EXISTS arrow_scale DOUBLE PRECISION",
    "ALTER TABLE camera_streams ADD COLUMN IF NOT EXISTS arrow_opacity DOUBLE PRECISION",
    "ALTER TABLE camera_streams ADD COLUMN IF NOT EXISTS gradient_intensity DOUBLE PRECISION",
    "ALTER TABLE camera_streams ADD COLUMN IF NOT EXISTS show_feed BOOLEAN",
    "ALTER TABLE camera_streams ADD COLUMN IF NOT EXISTS show_arrows BOOLEAN",
    "ALTER TABLE camera_streams ADD COLUMN IF NOT EXISTS show_magnitude BOOLEAN",
    "ALTER TABLE camera_streams ADD COLUMN IF NOT EXISTS show_trails BOOLEAN",
    "UPDATE camera_streams SET win_radius = 8 WHERE win_radius IS NULL",
    "UPDATE camera_streams SET arrow_scale = 4.0 WHERE arrow_scale IS NULL",
    "UPDATE camera_streams SET arrow_opacity = 90.0 WHERE arrow_opacity IS NULL",
    "UPDATE camera_streams SET gradient_intensity = 1.0 WHERE gradient_intensity IS NULL",
    "UPDATE camera_streams SET show_feed = TRUE WHERE show_feed IS NULL",
    "UPDATE camera_streams SET show_arrows = TRUE WHERE show_arrows IS NULL",
    "UPDATE camera_streams SET show_magnitude = FALSE WHERE show_magnitude IS NULL",
    "UPDATE camera_streams SET show_trails = FALSE WHERE show_trails IS NULL",
    "ALTER TABLE camera_streams ALTER COLUMN win_radius SET DEFAULT 8",
    "ALTER TABLE camera_streams ALTER COLUMN arrow_scale SET DEFAULT 4.0",
    "ALTER TABLE camera_streams ALTER COLUMN arrow_opacity SET DEFAULT 90.0",
    "ALTER TABLE camera_streams ALTER COLUMN gradient_intensity SET DEFAULT 1.0",
    "ALTER TABLE camera_streams ALTER COLUMN show_feed SET DEFAULT TRUE",
    "ALTER TABLE camera_streams ALTER COLUMN show_arrows SET DEFAULT TRUE",
    "ALTER TABLE camera_streams ALTER COLUMN show_magnitude SET DEFAULT FALSE",
    "ALTER TABLE camera_streams ALTER COLUMN show_trails SET DEFAULT FALSE",
    "ALTER TABLE camera_streams ALTER COLUMN win_radius SET NOT NULL",
    "ALTER TABLE camera_streams ALTER COLUMN arrow_scale SET NOT NULL",
    "ALTER TABLE camera_streams ALTER COLUMN arrow_opacity SET NOT NULL",
    "ALTER TABLE camera_streams ALTER COLUMN gradient_intensity SET NOT NULL",
    "ALTER TABLE camera_streams ALTER COLUMN show_feed SET NOT NULL",
    "ALTER TABLE camera_streams ALTER COLUMN show_arrows SET NOT NULL",
    "ALTER TABLE camera_streams ALTER COLUMN show_magnitude SET NOT NULL",
    "ALTER TABLE camera_streams ALTER COLUMN show_trails SET NOT NULL",
    "CREATE TABLE IF NOT EXISTS system_settings ("
    "id INTEGER PRIMARY KEY, "
    "live_preview_fps DOUBLE PRECISION NOT NULL DEFAULT 6.0, "
    "live_preview_jpeg_quality INTEGER NOT NULL DEFAULT 65, "
    "live_preview_max_width INTEGER NOT NULL DEFAULT 960, "
    "updated_at TIMESTAMP NOT NULL DEFAULT NOW())",
    "ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS live_preview_fps DOUBLE PRECISION",
    "ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS live_preview_jpeg_quality INTEGER",
    "ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS live_preview_max_width INTEGER",
    "ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP",
    "UPDATE system_settings SET live_preview_fps = 6.0 WHERE live_preview_fps IS NULL",
    "UPDATE system_settings SET live_preview_jpeg_quality = 65 WHERE live_preview_jpeg_quality IS NULL",
    "UPDATE system_settings SET live_preview_max_width = 960 WHERE live_preview_max_width IS NULL",
    "UPDATE system_settings SET updated_at = NOW() WHERE updated_at IS NULL",
    "INSERT INTO system_settings (id, live_preview_fps, live_preview_jpeg_quality, live_preview_max_width, updated_at) "
    "VALUES (1, 6.0, 65, 960, NOW()) ON CONFLICT (id) DO NOTHING",
    "ALTER TABLE system_settings ALTER COLUMN live_preview_fps SET DEFAULT 6.0",
    "ALTER TABLE system_settings ALTER COLUMN live_preview_jpeg_quality SET DEFAULT 65",
    "ALTER TABLE system_settings ALTER COLUMN live_preview_max_width SET DEFAULT 960",
    "ALTER TABLE system_settings ALTER COLUMN updated_at SET DEFAULT NOW()",
    "ALTER TABLE system_settings ALTER COLUMN live_preview_fps SET NOT NULL",
    "ALTER TABLE system_settings ALTER COLUMN live_preview_jpeg_quality SET NOT NULL",
    "ALTER TABLE system_settings ALTER COLUMN live_preview_max_width SET NOT NULL",
    "ALTER TABLE system_settings ALTER COLUMN updated_at SET NOT NULL",
]


def apply_schema_patches() -> None:
    with engine.begin() as connection:
        for statement in SCHEMA_PATCHES:
            connection.execute(text(statement))


def get_or_create_system_settings(db: Session) -> SystemSettings:
    settings = db.get(SystemSettings, 1)
    if settings is not None:
        return settings

    settings = SystemSettings(
        id=1,
        live_preview_fps=6.0,
        live_preview_jpeg_quality=65,
        live_preview_max_width=960,
    )
    db.add(settings)
    db.commit()
    db.refresh(settings)
    return settings


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    apply_schema_patches()

    db = SessionLocal()
    try:
        orchestrator.reconcile(db)
        settings = get_or_create_system_settings(db)
        frame_broker.set_frame_rate_limit(settings.live_preview_fps)
    finally:
        db.close()

    await frame_broker.start()
    yield
    await frame_broker.stop()


app = FastAPI(title="Vector Flow API", version="1.0.0", lifespan=lifespan)

cors_origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]
allow_all = "*" in cors_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if allow_all else cors_origins,
    allow_credentials=False if allow_all else True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def resolve_stream_status(stream: CameraStream) -> tuple[str, str, Optional[str], Optional[str]]:
    worker_status = orchestrator.get_worker_status(stream.worker_container_name)
    state = frame_broker.get_stream_state(str(stream.id)) or {}
    connection_status = state.get("connection_status")
    last_error = state.get("last_error")
    last_event_at = state.get("last_event_at")

    if not stream.is_active:
        connection_status = "inactive"
        last_error = None
    elif stream.worker_container_name and worker_status != "running":
        connection_status = "worker_down"
        if not last_error:
            last_error = "Worker container is not running."
    elif not connection_status:
        connection_status = "starting"

    return worker_status, connection_status, last_error, last_event_at


def classify_dashboard_state(stream: CameraStream, connection_status: str) -> str:
    if not stream.is_active:
        return "deactivated"
    if connection_status in {"connected", "ok"}:
        return "running"
    return "error"


def serialize_stream(stream: CameraStream) -> StreamRead:
    worker_status, connection_status, last_error, last_event_at = resolve_stream_status(stream)

    return StreamRead(
        id=stream.id,
        name=stream.name,
        rtsp_url=stream.rtsp_url,
        latitude=stream.latitude,
        longitude=stream.longitude,
        grid_size=stream.grid_size,
        win_radius=stream.win_radius,
        threshold=stream.threshold,
        arrow_scale=stream.arrow_scale,
        arrow_opacity=stream.arrow_opacity,
        gradient_intensity=stream.gradient_intensity,
        show_feed=stream.show_feed,
        show_arrows=stream.show_arrows,
        show_magnitude=stream.show_magnitude,
        show_trails=stream.show_trails,
        is_active=stream.is_active,
        created_at=stream.created_at,
        worker_container_name=stream.worker_container_name,
        worker_started_at=stream.worker_started_at,
        worker_status=worker_status,
        connection_status=connection_status,
        last_error=last_error,
        last_event_at=last_event_at,
    )


def serialize_system_settings(settings: SystemSettings) -> SystemSettingsRead:
    return SystemSettingsRead(
        id=settings.id,
        live_preview_fps=settings.live_preview_fps,
        live_preview_jpeg_quality=settings.live_preview_jpeg_quality,
        live_preview_max_width=settings.live_preview_max_width,
        updated_at=settings.updated_at,
    )


def restart_active_workers(db: Session) -> list[str]:
    errors: list[str] = []
    active_streams = db.query(CameraStream).filter(CameraStream.is_active.is_(True)).all()
    for stream in active_streams:
        try:
            orchestrator.stop_worker(db, stream, deactivate=False)
            orchestrator.start_worker(db, stream)
            db.commit()
            db.refresh(stream)
        except Exception as exc:
            db.rollback()
            errors.append(f"{stream.name}: {exc}")
    return errors


@app.get("/health")
def healthcheck() -> dict:
    return {"status": "ok"}


@app.get("/streams", response_model=List[StreamRead])
def list_streams(db: Session = Depends(get_db)) -> List[StreamRead]:
    streams = db.query(CameraStream).order_by(CameraStream.created_at.desc()).all()
    return [serialize_stream(stream) for stream in streams]


@app.get("/settings/system", response_model=SystemSettingsRead)
def get_system_settings(db: Session = Depends(get_db)) -> SystemSettingsRead:
    settings = get_or_create_system_settings(db)
    frame_broker.set_frame_rate_limit(settings.live_preview_fps)
    return serialize_system_settings(settings)


@app.put("/settings/system", response_model=SystemSettingsRead)
def update_system_settings(payload: SystemSettingsUpdate, db: Session = Depends(get_db)) -> SystemSettingsRead:
    settings = get_or_create_system_settings(db)

    changed = False
    for field in ("live_preview_fps", "live_preview_jpeg_quality", "live_preview_max_width"):
        value = getattr(payload, field)
        if value is None:
            continue
        if getattr(settings, field) != value:
            setattr(settings, field, value)
            changed = True

    if changed:
        db.add(settings)
        db.commit()
        db.refresh(settings)

    frame_broker.set_frame_rate_limit(settings.live_preview_fps)

    if payload.restart_workers and (changed or payload.live_preview_fps is not None or payload.live_preview_jpeg_quality is not None or payload.live_preview_max_width is not None):
        restart_errors = restart_active_workers(db)
        if restart_errors:
            raise HTTPException(
                status_code=500,
                detail={
                    "message": "Settings saved but some workers failed to restart.",
                    "errors": restart_errors,
                },
            )

    return serialize_system_settings(settings)


@app.post("/streams", response_model=StreamRead, status_code=201)
def create_stream(payload: StreamCreate, db: Session = Depends(get_db)) -> StreamRead:
    stream = CameraStream(
        name=payload.name.strip(),
        rtsp_url=payload.rtsp_url.strip(),
        latitude=payload.latitude,
        longitude=payload.longitude,
        grid_size=payload.grid_size,
        win_radius=payload.win_radius,
        threshold=payload.threshold,
        arrow_scale=payload.arrow_scale,
        arrow_opacity=payload.arrow_opacity,
        gradient_intensity=payload.gradient_intensity,
        show_feed=payload.show_feed,
        show_arrows=payload.show_arrows,
        show_magnitude=payload.show_magnitude,
        show_trails=payload.show_trails,
        is_active=False,
    )
    db.add(stream)
    db.commit()
    db.refresh(stream)

    if payload.is_active:
        try:
            orchestrator.start_worker(db, stream)
            db.commit()
            db.refresh(stream)
        except Exception as exc:
            db.rollback()
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    return serialize_stream(stream)


@app.get("/streams/{stream_id}", response_model=StreamRead)
def get_stream(stream_id: UUID, db: Session = Depends(get_db)) -> StreamRead:
    stream = db.get(CameraStream, stream_id)
    if stream is None:
        raise HTTPException(status_code=404, detail="Stream not found")
    return serialize_stream(stream)


@app.get("/streams/{stream_id}/worker-logs")
def get_worker_logs(
    stream_id: UUID,
    tail: int = Query(default=160, ge=1, le=1000),
    db: Session = Depends(get_db),
) -> dict:
    stream = db.get(CameraStream, stream_id)
    if stream is None:
        raise HTTPException(status_code=404, detail="Stream not found")

    worker_status = orchestrator.get_worker_status(stream.worker_container_name)
    logs: list[str] = []
    fetch_error: Optional[str] = None
    try:
        logs = orchestrator.get_worker_logs(stream.worker_container_name, tail=tail)
    except Exception as exc:
        fetch_error = str(exc)

    return {
        "stream_id": str(stream.id),
        "stream_name": stream.name,
        "worker_container_name": stream.worker_container_name,
        "worker_status": worker_status,
        "tail": tail,
        "logs": logs,
        "error": fetch_error,
    }


@app.put("/streams/{stream_id}", response_model=StreamRead)
def update_stream(stream_id: UUID, payload: StreamUpdate, db: Session = Depends(get_db)) -> StreamRead:
    stream = db.get(CameraStream, stream_id)
    if stream is None:
        raise HTTPException(status_code=404, detail="Stream not found")

    should_restart = False
    activated_now = False

    if payload.name is not None:
        next_name = payload.name.strip()
        if next_name != stream.name:
            stream.name = next_name
            should_restart = True
    if payload.rtsp_url is not None and payload.rtsp_url.strip() != stream.rtsp_url:
        stream.rtsp_url = payload.rtsp_url.strip()
        should_restart = True
    if "latitude" in payload.model_fields_set and payload.latitude != stream.latitude:
        stream.latitude = payload.latitude
        should_restart = True
    if "longitude" in payload.model_fields_set and payload.longitude != stream.longitude:
        stream.longitude = payload.longitude
        should_restart = True
    if payload.grid_size is not None and payload.grid_size != stream.grid_size:
        stream.grid_size = payload.grid_size
        should_restart = True
    if payload.win_radius is not None and payload.win_radius != stream.win_radius:
        stream.win_radius = payload.win_radius
        should_restart = True
    if payload.threshold is not None and payload.threshold != stream.threshold:
        stream.threshold = payload.threshold
        should_restart = True
    if payload.arrow_scale is not None and payload.arrow_scale != stream.arrow_scale:
        stream.arrow_scale = payload.arrow_scale
        should_restart = True
    if payload.arrow_opacity is not None and payload.arrow_opacity != stream.arrow_opacity:
        stream.arrow_opacity = payload.arrow_opacity
        should_restart = True
    if payload.gradient_intensity is not None and payload.gradient_intensity != stream.gradient_intensity:
        stream.gradient_intensity = payload.gradient_intensity
        should_restart = True
    if payload.show_feed is not None and payload.show_feed != stream.show_feed:
        stream.show_feed = payload.show_feed
        should_restart = True
    if payload.show_arrows is not None and payload.show_arrows != stream.show_arrows:
        stream.show_arrows = payload.show_arrows
        should_restart = True
    if payload.show_magnitude is not None and payload.show_magnitude != stream.show_magnitude:
        stream.show_magnitude = payload.show_magnitude
        should_restart = True
    if payload.show_trails is not None and payload.show_trails != stream.show_trails:
        stream.show_trails = payload.show_trails
        should_restart = True

    if payload.is_active is True and not stream.is_active:
        try:
            orchestrator.start_worker(db, stream)
            activated_now = True
        except Exception as exc:
            db.rollback()
            raise HTTPException(status_code=500, detail=str(exc)) from exc
    elif payload.is_active is False and stream.is_active:
        try:
            orchestrator.stop_worker(db, stream, deactivate=True)
        except Exception as exc:
            db.rollback()
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    if should_restart and stream.is_active and not activated_now:
        try:
            orchestrator.stop_worker(db, stream, deactivate=False)
            orchestrator.start_worker(db, stream)
        except Exception as exc:
            db.rollback()
            raise HTTPException(status_code=500, detail=f"Unable to restart worker: {exc}") from exc

    db.commit()
    db.refresh(stream)
    return serialize_stream(stream)


@app.post("/streams/{stream_id}/activate", response_model=StreamRead)
def activate_stream(stream_id: UUID, db: Session = Depends(get_db)) -> StreamRead:
    stream = db.get(CameraStream, stream_id)
    if stream is None:
        raise HTTPException(status_code=404, detail="Stream not found")

    if stream.is_active and orchestrator.get_worker_status(stream.worker_container_name) == "running":
        return serialize_stream(stream)

    try:
        orchestrator.start_worker(db, stream)
        db.commit()
        db.refresh(stream)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return serialize_stream(stream)


@app.post("/streams/{stream_id}/deactivate", response_model=StreamRead)
def deactivate_stream(stream_id: UUID, db: Session = Depends(get_db)) -> StreamRead:
    stream = db.get(CameraStream, stream_id)
    if stream is None:
        raise HTTPException(status_code=404, detail="Stream not found")

    if not stream.is_active and not stream.worker_container_name:
        return serialize_stream(stream)

    try:
        orchestrator.stop_worker(db, stream, deactivate=True)
        db.commit()
        db.refresh(stream)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return serialize_stream(stream)


@app.delete("/streams/{stream_id}", response_model=MessageResponse)
def delete_stream(stream_id: UUID, db: Session = Depends(get_db)) -> MessageResponse:
    stream = db.get(CameraStream, stream_id)
    if stream is None:
        raise HTTPException(status_code=404, detail="Stream not found")

    try:
        if stream.worker_container_name or stream.is_active:
            orchestrator.stop_worker(db, stream, deactivate=True)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    db.delete(stream)
    db.commit()
    orchestrator.refresh_prometheus_targets(db)
    return MessageResponse(message="Stream deleted")


@app.get("/metrics")
def metrics(db: Session = Depends(get_db)) -> Response:
    streams = db.query(CameraStream).all()
    total_streams = len(streams)
    active_streams = sum(1 for stream in streams if stream.is_active)

    state_counts = {"running": 0, "deactivated": 0, "error": 0}
    for stream in streams:
        _, connection_status, _, _ = resolve_stream_status(stream)
        state = classify_dashboard_state(stream, connection_status)
        state_counts[state] += 1

    managed_streams_metric.set(total_streams)
    active_streams_metric.set(active_streams)
    running_streams_metric.set(state_counts["running"])
    for state, count in state_counts.items():
        streams_by_state_metric.labels(state=state).set(count)

    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.websocket("/ws/frames")
async def stream_frames(websocket: WebSocket):
    stream_filter = websocket.query_params.get("stream_id")
    await frame_broker.connect(websocket, stream_filter=stream_filter)

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        frame_broker.disconnect(websocket)
    except Exception:
        frame_broker.disconnect(websocket)
