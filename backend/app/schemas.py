from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class StreamBase(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    rtsp_url: str = Field(min_length=3)
    location_name: Optional[str] = Field(default=None, max_length=512)
    latitude: Optional[float] = Field(default=None, ge=-90.0, le=90.0)
    longitude: Optional[float] = Field(default=None, ge=-180.0, le=180.0)
    orientation_deg: float = Field(default=0.0, ge=0.0, lt=360.0)
    view_angle_deg: float = Field(default=60.0, ge=5.0, le=170.0)
    view_distance_m: float = Field(default=120.0, ge=10.0, le=5000.0)
    grid_size: int = Field(default=16, ge=4, le=128)
    win_radius: int = Field(default=8, ge=2, le=32)
    threshold: float = Field(default=1.2, ge=0.0, le=100.0)
    arrow_scale: float = Field(default=4.0, ge=0.1, le=25.0)
    arrow_opacity: float = Field(default=90.0, ge=0.0, le=100.0)
    gradient_intensity: float = Field(default=1.0, ge=0.1, le=5.0)
    show_feed: bool = True
    show_arrows: bool = True
    show_magnitude: bool = False
    show_trails: bool = False


class StreamCreate(StreamBase):
    is_active: bool = False


class StreamUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    rtsp_url: Optional[str] = Field(default=None, min_length=3)
    location_name: Optional[str] = Field(default=None, max_length=512)
    latitude: Optional[float] = Field(default=None, ge=-90.0, le=90.0)
    longitude: Optional[float] = Field(default=None, ge=-180.0, le=180.0)
    orientation_deg: Optional[float] = Field(default=None, ge=0.0, lt=360.0)
    view_angle_deg: Optional[float] = Field(default=None, ge=5.0, le=170.0)
    view_distance_m: Optional[float] = Field(default=None, ge=10.0, le=5000.0)
    grid_size: Optional[int] = Field(default=None, ge=4, le=128)
    win_radius: Optional[int] = Field(default=None, ge=2, le=32)
    threshold: Optional[float] = Field(default=None, ge=0.0, le=100.0)
    arrow_scale: Optional[float] = Field(default=None, ge=0.1, le=25.0)
    arrow_opacity: Optional[float] = Field(default=None, ge=0.0, le=100.0)
    gradient_intensity: Optional[float] = Field(default=None, ge=0.1, le=5.0)
    show_feed: Optional[bool] = None
    show_arrows: Optional[bool] = None
    show_magnitude: Optional[bool] = None
    show_trails: Optional[bool] = None
    is_active: Optional[bool] = None


class StreamRead(StreamBase):
    id: UUID
    is_active: bool
    created_at: datetime
    worker_container_name: Optional[str] = None
    worker_started_at: Optional[datetime] = None
    worker_status: str = "stopped"
    connection_status: str = "unknown"
    last_error: Optional[str] = None
    last_event_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class MessageResponse(BaseModel):
    message: str


class SystemSettingsBase(BaseModel):
    live_preview_fps: float = Field(default=6.0, ge=0.5, le=30.0)
    live_preview_jpeg_quality: int = Field(default=65, ge=30, le=95)
    live_preview_max_width: int = Field(default=960, ge=0, le=1920)
    orientation_offset_deg: float = Field(default=0.0, ge=-360.0, le=360.0)


class SystemSettingsUpdate(BaseModel):
    live_preview_fps: Optional[float] = Field(default=None, ge=0.5, le=30.0)
    live_preview_jpeg_quality: Optional[int] = Field(default=None, ge=30, le=95)
    live_preview_max_width: Optional[int] = Field(default=None, ge=0, le=1920)
    orientation_offset_deg: Optional[float] = Field(default=None, ge=-360.0, le=360.0)
    restart_workers: bool = True


class SystemSettingsRead(SystemSettingsBase):
    id: int
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)
