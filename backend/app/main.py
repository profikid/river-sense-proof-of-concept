import logging
import os
from contextlib import asynccontextmanager
from typing import List
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from prometheus_client import CONTENT_TYPE_LATEST, Gauge, generate_latest
from sqlalchemy import func
from sqlalchemy.orm import Session

from .database import Base, SessionLocal, engine, get_db
from .frame_broker import FrameBroker
from .models import CameraStream
from .orchestrator import WorkerOrchestrator
from .schemas import MessageResponse, StreamCreate, StreamRead, StreamUpdate

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


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        orchestrator.reconcile(db)
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


def serialize_stream(stream: CameraStream) -> StreamRead:
    return StreamRead(
        id=stream.id,
        name=stream.name,
        rtsp_url=stream.rtsp_url,
        grid_size=stream.grid_size,
        threshold=stream.threshold,
        is_active=stream.is_active,
        created_at=stream.created_at,
        worker_container_name=stream.worker_container_name,
        worker_started_at=stream.worker_started_at,
        worker_status=orchestrator.get_worker_status(stream.worker_container_name),
    )


@app.get("/health")
def healthcheck() -> dict:
    return {"status": "ok"}


@app.get("/streams", response_model=List[StreamRead])
def list_streams(db: Session = Depends(get_db)) -> List[StreamRead]:
    streams = db.query(CameraStream).order_by(CameraStream.created_at.desc()).all()
    return [serialize_stream(stream) for stream in streams]


@app.post("/streams", response_model=StreamRead, status_code=201)
def create_stream(payload: StreamCreate, db: Session = Depends(get_db)) -> StreamRead:
    stream = CameraStream(
        name=payload.name.strip(),
        rtsp_url=payload.rtsp_url.strip(),
        grid_size=payload.grid_size,
        threshold=payload.threshold,
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


@app.put("/streams/{stream_id}", response_model=StreamRead)
def update_stream(stream_id: UUID, payload: StreamUpdate, db: Session = Depends(get_db)) -> StreamRead:
    stream = db.get(CameraStream, stream_id)
    if stream is None:
        raise HTTPException(status_code=404, detail="Stream not found")

    should_restart = False
    activated_now = False

    if payload.name is not None:
        stream.name = payload.name.strip()
    if payload.rtsp_url is not None and payload.rtsp_url.strip() != stream.rtsp_url:
        stream.rtsp_url = payload.rtsp_url.strip()
        should_restart = True
    if payload.grid_size is not None and payload.grid_size != stream.grid_size:
        stream.grid_size = payload.grid_size
        should_restart = True
    if payload.threshold is not None and payload.threshold != stream.threshold:
        stream.threshold = payload.threshold
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
    total_streams = db.query(func.count(CameraStream.id)).scalar() or 0
    active_streams = db.query(func.count(CameraStream.id)).filter(CameraStream.is_active.is_(True)).scalar() or 0

    managed_streams_metric.set(total_streams)
    active_streams_metric.set(active_streams)

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
