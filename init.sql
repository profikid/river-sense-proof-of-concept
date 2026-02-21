CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS camera_streams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    rtsp_url TEXT NOT NULL,
    location_name TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    orientation_deg DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    view_angle_deg DOUBLE PRECISION NOT NULL DEFAULT 60.0,
    view_distance_m DOUBLE PRECISION NOT NULL DEFAULT 120.0,
    camera_tilt_deg DOUBLE PRECISION NOT NULL DEFAULT 15.0,
    camera_height_m DOUBLE PRECISION NOT NULL DEFAULT 4.0,
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
ALTER TABLE camera_streams ADD COLUMN IF NOT EXISTS location_name TEXT;
ALTER TABLE camera_streams ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE camera_streams ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE camera_streams ADD COLUMN IF NOT EXISTS orientation_deg DOUBLE PRECISION;
ALTER TABLE camera_streams ADD COLUMN IF NOT EXISTS view_angle_deg DOUBLE PRECISION;
ALTER TABLE camera_streams ADD COLUMN IF NOT EXISTS view_distance_m DOUBLE PRECISION;
ALTER TABLE camera_streams ADD COLUMN IF NOT EXISTS camera_tilt_deg DOUBLE PRECISION;
ALTER TABLE camera_streams ADD COLUMN IF NOT EXISTS camera_height_m DOUBLE PRECISION;
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
UPDATE camera_streams SET orientation_deg = 0.0 WHERE orientation_deg IS NULL;
UPDATE camera_streams SET view_angle_deg = 60.0 WHERE view_angle_deg IS NULL;
UPDATE camera_streams SET view_distance_m = 120.0 WHERE view_distance_m IS NULL;
UPDATE camera_streams SET camera_tilt_deg = 15.0 WHERE camera_tilt_deg IS NULL;
UPDATE camera_streams SET camera_height_m = 4.0 WHERE camera_height_m IS NULL;

ALTER TABLE camera_streams ALTER COLUMN win_radius SET DEFAULT 8;
ALTER TABLE camera_streams ALTER COLUMN arrow_scale SET DEFAULT 4.0;
ALTER TABLE camera_streams ALTER COLUMN arrow_opacity SET DEFAULT 90.0;
ALTER TABLE camera_streams ALTER COLUMN gradient_intensity SET DEFAULT 1.0;
ALTER TABLE camera_streams ALTER COLUMN show_feed SET DEFAULT TRUE;
ALTER TABLE camera_streams ALTER COLUMN show_arrows SET DEFAULT TRUE;
ALTER TABLE camera_streams ALTER COLUMN show_magnitude SET DEFAULT FALSE;
ALTER TABLE camera_streams ALTER COLUMN show_trails SET DEFAULT FALSE;
ALTER TABLE camera_streams ALTER COLUMN orientation_deg SET DEFAULT 0.0;
ALTER TABLE camera_streams ALTER COLUMN view_angle_deg SET DEFAULT 60.0;
ALTER TABLE camera_streams ALTER COLUMN view_distance_m SET DEFAULT 120.0;
ALTER TABLE camera_streams ALTER COLUMN camera_tilt_deg SET DEFAULT 15.0;
ALTER TABLE camera_streams ALTER COLUMN camera_height_m SET DEFAULT 4.0;

ALTER TABLE camera_streams ALTER COLUMN win_radius SET NOT NULL;
ALTER TABLE camera_streams ALTER COLUMN arrow_scale SET NOT NULL;
ALTER TABLE camera_streams ALTER COLUMN arrow_opacity SET NOT NULL;
ALTER TABLE camera_streams ALTER COLUMN gradient_intensity SET NOT NULL;
ALTER TABLE camera_streams ALTER COLUMN show_feed SET NOT NULL;
ALTER TABLE camera_streams ALTER COLUMN show_arrows SET NOT NULL;
ALTER TABLE camera_streams ALTER COLUMN show_magnitude SET NOT NULL;
ALTER TABLE camera_streams ALTER COLUMN show_trails SET NOT NULL;
ALTER TABLE camera_streams ALTER COLUMN orientation_deg SET NOT NULL;
ALTER TABLE camera_streams ALTER COLUMN view_angle_deg SET NOT NULL;
ALTER TABLE camera_streams ALTER COLUMN view_distance_m SET NOT NULL;
ALTER TABLE camera_streams ALTER COLUMN camera_tilt_deg SET NOT NULL;
ALTER TABLE camera_streams ALTER COLUMN camera_height_m SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_camera_streams_active ON camera_streams(is_active);

CREATE TABLE IF NOT EXISTS system_settings (
    id INTEGER PRIMARY KEY,
    live_preview_fps DOUBLE PRECISION NOT NULL DEFAULT 6.0,
    live_preview_jpeg_quality INTEGER NOT NULL DEFAULT 65,
    live_preview_max_width INTEGER NOT NULL DEFAULT 960,
    orientation_offset_deg DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO system_settings (
    id,
    live_preview_fps,
    live_preview_jpeg_quality,
    live_preview_max_width,
    orientation_offset_deg,
    updated_at
)
VALUES (1, 6.0, 65, 960, 0.0, NOW())
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS alert_webhook_events (
    id SERIAL PRIMARY KEY,
    receiver VARCHAR(255),
    group_key TEXT,
    notification_status VARCHAR(64),
    alert_status VARCHAR(64),
    alert_name VARCHAR(255),
    alert_uid VARCHAR(255),
    severity VARCHAR(64),
    stream_name VARCHAR(255),
    fingerprint VARCHAR(255),
    summary TEXT,
    description TEXT,
    starts_at TIMESTAMP,
    ends_at TIMESTAMP,
    labels JSONB NOT NULL DEFAULT '{}'::jsonb,
    annotations JSONB NOT NULL DEFAULT '{}'::jsonb,
    values JSONB NOT NULL DEFAULT '{}'::jsonb,
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    received_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_webhook_events_received_at
    ON alert_webhook_events(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_webhook_events_alert_name
    ON alert_webhook_events(alert_name);
CREATE INDEX IF NOT EXISTS idx_alert_webhook_events_fingerprint
    ON alert_webhook_events(fingerprint);

CREATE TABLE IF NOT EXISTS alert_group_states (
    identifier VARCHAR(1024) PRIMARY KEY,
    resolved BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_at TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_group_states_resolved
    ON alert_group_states(resolved);
