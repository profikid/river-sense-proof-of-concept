import uuid

from sqlalchemy import Boolean, Column, DateTime, Float, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID

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
