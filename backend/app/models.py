import uuid

from sqlalchemy import Boolean, Column, DateTime, Float, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID

from .database import Base


class CameraStream(Base):
    __tablename__ = "camera_streams"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    rtsp_url = Column(Text, nullable=False)
    grid_size = Column(Integer, nullable=False, default=16)
    threshold = Column(Float, nullable=False, default=1.2)
    is_active = Column(Boolean, nullable=False, default=False)
    worker_container_name = Column(String(255), nullable=True)
    worker_started_at = Column(DateTime(timezone=False), nullable=True)
    created_at = Column(DateTime(timezone=False), nullable=False, server_default=func.now())
