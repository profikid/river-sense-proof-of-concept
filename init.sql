CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS camera_streams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    rtsp_url TEXT NOT NULL,
    grid_size INTEGER NOT NULL DEFAULT 16,
    threshold DOUBLE PRECISION NOT NULL DEFAULT 1.2,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    worker_container_name VARCHAR(255),
    worker_started_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_camera_streams_active ON camera_streams(is_active);
