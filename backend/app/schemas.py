from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class StreamBase(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    rtsp_url: str = Field(min_length=3)
    grid_size: int = Field(default=16, ge=4, le=128)
    threshold: float = Field(default=1.2, ge=0.0, le=100.0)


class StreamCreate(StreamBase):
    is_active: bool = False


class StreamUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    rtsp_url: Optional[str] = Field(default=None, min_length=3)
    grid_size: Optional[int] = Field(default=None, ge=4, le=128)
    threshold: Optional[float] = Field(default=None, ge=0.0, le=100.0)
    is_active: Optional[bool] = None


class StreamRead(StreamBase):
    id: UUID
    is_active: bool
    created_at: datetime
    worker_container_name: Optional[str] = None
    worker_started_at: Optional[datetime] = None
    worker_status: str = "stopped"

    model_config = ConfigDict(from_attributes=True)


class MessageResponse(BaseModel):
    message: str
