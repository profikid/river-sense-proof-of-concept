import uuid

from sqlalchemy import Boolean, Column, DateTime, Float, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID

from .database import Base


class CameraStream(Base):
    __tablename__ = "camera_streams"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    rtsp_url = Column(Text, nullable=False)
    location_name = Column(String(512), nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    orientation_deg = Column(Float, nullable=False, default=0.0)
    view_angle_deg = Column(Float, nullable=False, default=60.0)
    view_distance_m = Column(Float, nullable=False, default=120.0)
    camera_tilt_deg = Column(Float, nullable=False, default=15.0)
    camera_height_m = Column(Float, nullable=False, default=4.0)
    grid_size = Column(Integer, nullable=False, default=16)
    win_radius = Column(Integer, nullable=False, default=8)
    threshold = Column(Float, nullable=False, default=1.2)
    arrow_scale = Column(Float, nullable=False, default=4.0)
    arrow_opacity = Column(Float, nullable=False, default=90.0)
    gradient_intensity = Column(Float, nullable=False, default=1.0)
    show_feed = Column(Boolean, nullable=False, default=True)
    show_arrows = Column(Boolean, nullable=False, default=True)
    show_magnitude = Column(Boolean, nullable=False, default=False)
    show_trails = Column(Boolean, nullable=False, default=False)
    show_perspective_ruler = Column(Boolean, nullable=False, default=True)
    perspective_ruler_opacity = Column(Float, nullable=False, default=70.0)
    is_active = Column(Boolean, nullable=False, default=False)
    worker_container_name = Column(String(255), nullable=True)
    worker_started_at = Column(DateTime(timezone=False), nullable=True)
    created_at = Column(DateTime(timezone=False), nullable=False, server_default=func.now())


class SystemSettings(Base):
    __tablename__ = "system_settings"

    id = Column(Integer, primary_key=True, default=1)
    live_preview_fps = Column(Float, nullable=False, default=6.0)
    live_preview_jpeg_quality = Column(Integer, nullable=False, default=65)
    live_preview_max_width = Column(Integer, nullable=False, default=960)
    orientation_offset_deg = Column(Float, nullable=False, default=0.0)
    updated_at = Column(
        DateTime(timezone=False),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class AlertWebhookEvent(Base):
    __tablename__ = "alert_webhook_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    receiver = Column(String(255), nullable=True)
    group_key = Column(Text, nullable=True)
    notification_status = Column(String(64), nullable=True)
    alert_status = Column(String(64), nullable=True)
    alert_name = Column(String(255), nullable=True)
    alert_uid = Column(String(255), nullable=True)
    severity = Column(String(64), nullable=True)
    stream_name = Column(String(255), nullable=True)
    fingerprint = Column(String(255), nullable=True)
    summary = Column(Text, nullable=True)
    description = Column(Text, nullable=True)
    starts_at = Column(DateTime(timezone=False), nullable=True)
    ends_at = Column(DateTime(timezone=False), nullable=True)
    labels = Column(JSONB, nullable=False, default=dict)
    annotations = Column(JSONB, nullable=False, default=dict)
    values = Column(JSONB, nullable=False, default=dict)
    raw_payload = Column(JSONB, nullable=False, default=dict)
    received_at = Column(DateTime(timezone=False), nullable=False, server_default=func.now())


class AlertGroupState(Base):
    __tablename__ = "alert_group_states"

    identifier = Column(String(1024), primary_key=True)
    resolved = Column(Boolean, nullable=False, default=False)
    resolved_at = Column(DateTime(timezone=False), nullable=True)
    updated_at = Column(
        DateTime(timezone=False),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
