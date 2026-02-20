CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS camera_streams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    rtsp_url TEXT NOT NULL,
    grid_size INTEGER NOT NULL DEFAULT 16,
    win_radius INTEGER NOT NULL DEFAULT 8,
    threshold DOUBLE PRECISION NOT NULL DEFAULT 1.2,
    arrow_scale DOUBLE PRECISION NOT NULL DEFAULT 4.0,
    arrow_opacity DOUBLE PRECISION NOT NULL DEFAULT 90.0,
    gradient_intensity DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    show_feed BOOLEAN NOT NULL DEFAULT TRUE,
    show_arrows BOOLEAN NOT NULL DEFAULT TRUE,
    show_magnitude BOOLEAN NOT NULL DEFAULT FALSE,
    show_trails BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    worker_container_name VARCHAR(255),
    worker_started_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE camera_streams ADD COLUMN IF NOT EXISTS win_radius INTEGER;
ALTER TABLE camera_streams ADD COLUMN IF NOT EXISTS arrow_scale DOUBLE PRECISION;
ALTER TABLE camera_streams ADD COLUMN IF NOT EXISTS arrow_opacity DOUBLE PRECISION;
ALTER TABLE camera_streams ADD COLUMN IF NOT EXISTS gradient_intensity DOUBLE PRECISION;
ALTER TABLE camera_streams ADD COLUMN IF NOT EXISTS show_feed BOOLEAN;
ALTER TABLE camera_streams ADD COLUMN IF NOT EXISTS show_arrows BOOLEAN;
ALTER TABLE camera_streams ADD COLUMN IF NOT EXISTS show_magnitude BOOLEAN;
ALTER TABLE camera_streams ADD COLUMN IF NOT EXISTS show_trails BOOLEAN;

UPDATE camera_streams SET win_radius = 8 WHERE win_radius IS NULL;
UPDATE camera_streams SET arrow_scale = 4.0 WHERE arrow_scale IS NULL;
UPDATE camera_streams SET arrow_opacity = 90.0 WHERE arrow_opacity IS NULL;
UPDATE camera_streams SET gradient_intensity = 1.0 WHERE gradient_intensity IS NULL;
UPDATE camera_streams SET show_feed = TRUE WHERE show_feed IS NULL;
UPDATE camera_streams SET show_arrows = TRUE WHERE show_arrows IS NULL;
UPDATE camera_streams SET show_magnitude = FALSE WHERE show_magnitude IS NULL;
UPDATE camera_streams SET show_trails = FALSE WHERE show_trails IS NULL;

ALTER TABLE camera_streams ALTER COLUMN win_radius SET DEFAULT 8;
ALTER TABLE camera_streams ALTER COLUMN arrow_scale SET DEFAULT 4.0;
ALTER TABLE camera_streams ALTER COLUMN arrow_opacity SET DEFAULT 90.0;
ALTER TABLE camera_streams ALTER COLUMN gradient_intensity SET DEFAULT 1.0;
ALTER TABLE camera_streams ALTER COLUMN show_feed SET DEFAULT TRUE;
ALTER TABLE camera_streams ALTER COLUMN show_arrows SET DEFAULT TRUE;
ALTER TABLE camera_streams ALTER COLUMN show_magnitude SET DEFAULT FALSE;
ALTER TABLE camera_streams ALTER COLUMN show_trails SET DEFAULT FALSE;

ALTER TABLE camera_streams ALTER COLUMN win_radius SET NOT NULL;
ALTER TABLE camera_streams ALTER COLUMN arrow_scale SET NOT NULL;
ALTER TABLE camera_streams ALTER COLUMN arrow_opacity SET NOT NULL;
ALTER TABLE camera_streams ALTER COLUMN gradient_intensity SET NOT NULL;
ALTER TABLE camera_streams ALTER COLUMN show_feed SET NOT NULL;
ALTER TABLE camera_streams ALTER COLUMN show_arrows SET NOT NULL;
ALTER TABLE camera_streams ALTER COLUMN show_magnitude SET NOT NULL;
ALTER TABLE camera_streams ALTER COLUMN show_trails SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_camera_streams_active ON camera_streams(is_active);
