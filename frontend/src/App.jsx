import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { divIcon } from "leaflet";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polygon,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";

const API_BASE = normalizeHttpBase(import.meta.env.VITE_API_URL || "http://localhost:8000");
const WS_BASE = toWsBase(API_BASE);
const GRAFANA_DASHBOARD_URL =
  import.meta.env.VITE_GRAFANA_DASHBOARD_URL ||
  "http://localhost:3000/d/vector-flow/vector-flow-overview";

const DEFAULT_STREAM_CONFIG = {
  grid_size: 16,
  win_radius: 8,
  threshold: 1.2,
  arrow_scale: 4,
  arrow_opacity: 90,
  perspective_ruler_opacity: 70,
  gradient_intensity: 1.0,
  show_feed: true,
  show_arrows: true,
  show_magnitude: false,
  show_trails: false,
  show_perspective_ruler: true,
};

const DEFAULT_FORM = {
  name: "",
  rtsp_url:
    "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
  location_name: "",
  latitude: "",
  longitude: "",
  orientation_deg: 0,
  view_angle_deg: 60,
  view_distance_m: 150,
  camera_tilt_deg: 15,
  camera_height_m: 4,
  ...DEFAULT_STREAM_CONFIG,
  is_active: false,
};

const NUMERIC_FIELDS = {
  grid_size: { min: 4, max: 128, step: 1 },
  win_radius: { min: 2, max: 32, step: 1 },
  threshold: { min: 0, max: 100, step: 0.1 },
  arrow_scale: { min: 0.1, max: 25, step: 0.1 },
  arrow_opacity: { min: 0, max: 100, step: 1 },
  perspective_ruler_opacity: { min: 0, max: 100, step: 1 },
  gradient_intensity: { min: 0.1, max: 5, step: 0.1 },
};

const SLIDER_FIELDS = [
  { key: "grid_size", label: "Grid Size", unit: "px" },
  { key: "win_radius", label: "Window Radius", unit: "px" },
  { key: "threshold", label: "Sensitivity Threshold", unit: "" },
  { key: "arrow_scale", label: "Arrow Scale", unit: "x" },
  { key: "arrow_opacity", label: "Arrow Opacity", unit: "%" },
  { key: "perspective_ruler_opacity", label: "Perspective Ruler Opacity", unit: "%" },
  { key: "gradient_intensity", label: "Gradient Intensity", unit: "x" },
];

const TOGGLE_FIELDS = [
  { key: "show_feed", label: "Raw Feed" },
  { key: "show_arrows", label: "Flow Arrows" },
  { key: "show_magnitude", label: "Magnitude Map" },
  { key: "show_trails", label: "Motion Trails" },
  { key: "show_perspective_ruler", label: "Perspective Ruler" },
];

const WORKER_LOG_TAIL = 180;
const WORKER_LOG_POLL_MS = 5000;

const DEFAULT_DASHBOARD_RANGE = "15m";
const DASHBOARD_TIME_OPTIONS = [
  { value: "5m", label: "Last 5 minutes" },
  { value: "15m", label: "Last 15 minutes" },
  { value: "30m", label: "Last 30 minutes" },
  { value: "1h", label: "Last 1 hour" },
  { value: "3h", label: "Last 3 hours" },
  { value: "6h", label: "Last 6 hours" },
  { value: "12h", label: "Last 12 hours" },
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
];

const DEFAULT_SYSTEM_SETTINGS = {
  live_preview_fps: 6.0,
  live_preview_jpeg_quality: 65,
  live_preview_max_width: 960,
  orientation_offset_deg: 0,
  restart_workers: true,
};

const LIVE_STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "connected", label: "Connected" },
  { value: "inactive", label: "Inactive" },
  { value: "starting", label: "Starting" },
  { value: "error", label: "Error" },
];

const LIVE_MAP_COLOR_OPTIONS = [
  { value: "fps", label: "FPS" },
  { value: "vector_count", label: "Vectors" },
  { value: "avg_magnitude", label: "Avg Magnitude" },
  { value: "direction_degrees", label: "Direction" },
  { value: "direction_coherence", label: "Direction Align" },
];

const LIVE_MAP_LAYER_OPTIONS = [
  { value: "camera_markers", label: "Camera Markers" },
  { value: "camera_cones", label: "Camera Cones" },
  { value: "heatmap", label: "Heatmap" },
];

const LIVE_SORT_FIELD_OPTIONS = [
  { value: "name", label: "Name" },
  { value: "fps", label: "FPS" },
  { value: "vector_count", label: "Vector Count" },
  { value: "avg_magnitude", label: "Avg Magnitude" },
  { value: "direction_degrees", label: "Direction" },
  { value: "direction_coherence", label: "Direction Align" },
];

const LIVE_LAYOUT_OPTIONS = [
  { value: "grid", label: "Grid" },
  { value: "list", label: "List" },
  { value: "map", label: "Map" },
  { value: "frameless", label: "Frameless" },
];
const ALERT_STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "firing", label: "Firing/Alerting" },
  { value: "pending", label: "Pending" },
  { value: "resolved", label: "Resolved" },
  { value: "unknown", label: "Unknown" },
];
const ALERT_SEVERITY_FILTER_OPTIONS = [
  { value: "all", label: "All Severities" },
  { value: "critical", label: "Critical" },
  { value: "warning", label: "Warning" },
  { value: "info", label: "Info" },
  { value: "na", label: "N/A" },
];
const DEFAULT_LIVE_NAME_FILTER = "";
const DEFAULT_LIVE_STATUS_FILTER = "all";
const DEFAULT_LIVE_LAYOUT = "grid";
const DEFAULT_LIVE_SORT_FIELD = "name";
const DEFAULT_LIVE_SORT_ORDER = "asc";
const DEFAULT_LIVE_MAP_COLOR_METRIC = "avg_magnitude";
const DEFAULT_LIVE_MAP_LAYERS = [
  "camera_markers",
  "camera_cones",
  "heatmap",
];

const MAP_BASEMAP_OPTIONS = [
  {
    value: "white",
    label: "White",
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    subdomains: "abcd",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  {
    value: "dark",
    label: "Dark",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    subdomains: "abcd",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  {
    value: "satellite",
    label: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution:
      "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
  },
  {
    value: "streets",
    label: "Streets",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    subdomains: "abc",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
];
const DEFAULT_MAP_BASEMAP = "white";

const MAP_DEFAULT_CENTER = [37.0902, -95.7129];
const MAP_DEFAULT_ZOOM = 4;
const MAP_SELECTED_ZOOM = 13;
const MAP_LIVE_SINGLE_POINT_ZOOM = 19;
const CAMERA_ORIENTATION_MIN = 0;
const CAMERA_ORIENTATION_MAX = 359.9;
const CAMERA_VIEW_ANGLE_MIN = 5;
const CAMERA_VIEW_ANGLE_MAX = 170;
const CAMERA_VIEW_DISTANCE_MIN = 50;
const CAMERA_VIEW_DISTANCE_MAX = 1000;
const CAMERA_VIEW_DISTANCE_STEP = 50;
const CAMERA_TILT_MIN = -45;
const CAMERA_TILT_MAX = 89;
const CAMERA_TILT_STEP = 0.5;
const CAMERA_HEIGHT_MIN = 0.5;
const CAMERA_HEIGHT_MAX = 120;
const CAMERA_HEIGHT_STEP = 0.5;
const LOCATION_NAME_MAX_LENGTH = 512;
const LOCATION_SEARCH_MIN_LENGTH = 3;
const LOCATION_SEARCH_LIMIT = 6;
const LOCATION_REVERSE_ZOOM_LEVELS = [18, 16, 14];
const EARTH_RADIUS_M = 6371000;

function normalizeDashboardRange(value) {
  const candidate = String(value || "").trim();
  if (!candidate) {
    return DEFAULT_DASHBOARD_RANGE;
  }
  const isValid = DASHBOARD_TIME_OPTIONS.some((option) => option.value === candidate);
  return isValid ? candidate : DEFAULT_DASHBOARD_RANGE;
}

function normalizeOptionValue(value, options, fallback) {
  const candidate = String(value || "").trim();
  if (!candidate) {
    return fallback;
  }
  return options.some((option) => option.value === candidate) ? candidate : fallback;
}

function normalizeLiveSortOrder(value) {
  const candidate = String(value || "").trim().toLowerCase();
  return candidate === "desc" ? "desc" : DEFAULT_LIVE_SORT_ORDER;
}

function normalizeLiveMapLayers(value) {
  const allowed = new Set(LIVE_MAP_LAYER_OPTIONS.map((option) => option.value));
  const requested = String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => allowed.has(entry));
  if (requested.length === 0) {
    return [...DEFAULT_LIVE_MAP_LAYERS];
  }
  const requestedSet = new Set(requested);
  return LIVE_MAP_LAYER_OPTIONS.map((option) => option.value).filter((entry) =>
    requestedSet.has(entry)
  );
}

function normalizeMapBasemap(value) {
  return normalizeOptionValue(value, MAP_BASEMAP_OPTIONS, DEFAULT_MAP_BASEMAP);
}

function normalizeHttpBase(value) {
  return value.replace(/\/+$/, "");
}

function toWsBase(httpBase) {
  if (httpBase.startsWith("https://")) {
    return httpBase.replace("https://", "wss://");
  }
  return httpBase.replace("http://", "ws://");
}

function parseLocationState() {
  const url = new URL(window.location.href);
  let view = "config";
  if (url.pathname.startsWith("/dashboard")) {
    view = "dashboard";
  } else if (url.pathname.startsWith("/live")) {
    view = "live";
  } else if (url.pathname.startsWith("/alerts")) {
    view = "alerts";
  } else if (url.pathname.startsWith("/settings")) {
    view = "settings";
  }
  const selected = url.searchParams.get("stream");
  const dashboardRange = normalizeDashboardRange(url.searchParams.get("range"));
  const liveNameFilter = String(url.searchParams.get("live_name") || DEFAULT_LIVE_NAME_FILTER);
  const liveStatusFilter = normalizeOptionValue(
    url.searchParams.get("live_status"),
    LIVE_STATUS_FILTER_OPTIONS,
    DEFAULT_LIVE_STATUS_FILTER
  );
  const liveLayout = normalizeOptionValue(
    url.searchParams.get("live_layout"),
    LIVE_LAYOUT_OPTIONS,
    DEFAULT_LIVE_LAYOUT
  );
  const liveSortField = normalizeOptionValue(
    url.searchParams.get("live_sort_field"),
    LIVE_SORT_FIELD_OPTIONS,
    DEFAULT_LIVE_SORT_FIELD
  );
  const liveSortOrder = normalizeLiveSortOrder(url.searchParams.get("live_sort_order"));
  const liveMapColorMetric = normalizeOptionValue(
    url.searchParams.get("live_map_color"),
    LIVE_MAP_COLOR_OPTIONS,
    DEFAULT_LIVE_MAP_COLOR_METRIC
  );
  const liveMapLayers = normalizeLiveMapLayers(url.searchParams.get("live_map_layers"));
  const mapBasemap = normalizeMapBasemap(url.searchParams.get("basemap"));
  return {
    view,
    selectedStreamId: selected && selected.trim() ? selected : null,
    dashboardRange,
    liveNameFilter,
    liveStatusFilter,
    liveLayout,
    liveSortField,
    liveSortOrder,
    liveMapColorMetric,
    liveMapLayers,
    mapBasemap,
  };
}

function buildLocation(
  view,
  selectedStreamId,
  dashboardRange,
  {
    liveNameFilter = DEFAULT_LIVE_NAME_FILTER,
    liveStatusFilter = DEFAULT_LIVE_STATUS_FILTER,
    liveLayout = DEFAULT_LIVE_LAYOUT,
    liveSortField = DEFAULT_LIVE_SORT_FIELD,
    liveSortOrder = DEFAULT_LIVE_SORT_ORDER,
    liveMapColorMetric = DEFAULT_LIVE_MAP_COLOR_METRIC,
    liveMapLayers = DEFAULT_LIVE_MAP_LAYERS,
    mapBasemap = DEFAULT_MAP_BASEMAP,
  } = {}
) {
  const pathname =
    view === "dashboard"
      ? "/dashboard"
      : view === "live"
        ? "/live"
        : view === "alerts"
          ? "/alerts"
        : view === "settings"
          ? "/settings"
          : "/";
  const params = new URLSearchParams();
  if (selectedStreamId) {
    params.set("stream", selectedStreamId);
  }
  const normalizedRange = normalizeDashboardRange(dashboardRange);
  if (normalizedRange !== DEFAULT_DASHBOARD_RANGE) {
    params.set("range", normalizedRange);
  }
  const normalizedNameFilter = String(liveNameFilter || "");
  if (normalizedNameFilter) {
    params.set("live_name", normalizedNameFilter);
  }
  params.set(
    "live_status",
    normalizeOptionValue(liveStatusFilter, LIVE_STATUS_FILTER_OPTIONS, DEFAULT_LIVE_STATUS_FILTER)
  );
  params.set(
    "live_layout",
    normalizeOptionValue(liveLayout, LIVE_LAYOUT_OPTIONS, DEFAULT_LIVE_LAYOUT)
  );
  params.set(
    "live_sort_field",
    normalizeOptionValue(liveSortField, LIVE_SORT_FIELD_OPTIONS, DEFAULT_LIVE_SORT_FIELD)
  );
  params.set("live_sort_order", normalizeLiveSortOrder(liveSortOrder));
  params.set(
    "live_map_color",
    normalizeOptionValue(
      liveMapColorMetric,
      LIVE_MAP_COLOR_OPTIONS,
      DEFAULT_LIVE_MAP_COLOR_METRIC
    )
  );
  params.set(
    "live_map_layers",
    normalizeLiveMapLayers(
      Array.isArray(liveMapLayers) ? liveMapLayers.join(",") : liveMapLayers
    ).join(",")
  );
  params.set("basemap", normalizeMapBasemap(mapBasemap));
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ""}`;
}

function streamToForm(stream) {
  return {
    name: stream.name ?? "",
    rtsp_url: stream.rtsp_url ?? "",
    location_name: stream.location_name ?? "",
    latitude:
      Number.isFinite(Number(stream.latitude)) && stream.latitude !== null
        ? Number(stream.latitude).toFixed(6)
        : "",
    longitude:
      Number.isFinite(Number(stream.longitude)) && stream.longitude !== null
        ? Number(stream.longitude).toFixed(6)
        : "",
    orientation_deg: Number.isFinite(Number(stream.orientation_deg))
      ? Number(stream.orientation_deg)
      : DEFAULT_FORM.orientation_deg,
    view_angle_deg: Number.isFinite(Number(stream.view_angle_deg))
      ? Number(stream.view_angle_deg)
      : DEFAULT_FORM.view_angle_deg,
    view_distance_m: normalizeViewDistance(
      Number.isFinite(Number(stream.view_distance_m))
        ? Number(stream.view_distance_m)
        : DEFAULT_FORM.view_distance_m,
      DEFAULT_FORM.view_distance_m
    ),
    camera_tilt_deg: normalizeCameraTilt(
      Number.isFinite(Number(stream.camera_tilt_deg))
        ? Number(stream.camera_tilt_deg)
        : DEFAULT_FORM.camera_tilt_deg,
      DEFAULT_FORM.camera_tilt_deg
    ),
    camera_height_m: normalizeCameraHeight(
      Number.isFinite(Number(stream.camera_height_m))
        ? Number(stream.camera_height_m)
        : DEFAULT_FORM.camera_height_m,
      DEFAULT_FORM.camera_height_m
    ),
    is_active: !!stream.is_active,
    grid_size: stream.grid_size ?? DEFAULT_STREAM_CONFIG.grid_size,
    win_radius: stream.win_radius ?? DEFAULT_STREAM_CONFIG.win_radius,
    threshold: stream.threshold ?? DEFAULT_STREAM_CONFIG.threshold,
    arrow_scale: stream.arrow_scale ?? DEFAULT_STREAM_CONFIG.arrow_scale,
    arrow_opacity: stream.arrow_opacity ?? DEFAULT_STREAM_CONFIG.arrow_opacity,
    perspective_ruler_opacity: normalizePerspectiveRulerOpacity(
      stream.perspective_ruler_opacity ?? DEFAULT_STREAM_CONFIG.perspective_ruler_opacity,
      DEFAULT_STREAM_CONFIG.perspective_ruler_opacity
    ),
    gradient_intensity: stream.gradient_intensity ?? DEFAULT_STREAM_CONFIG.gradient_intensity,
    show_feed: stream.show_feed ?? DEFAULT_STREAM_CONFIG.show_feed,
    show_arrows: stream.show_arrows ?? DEFAULT_STREAM_CONFIG.show_arrows,
    show_magnitude: stream.show_magnitude ?? DEFAULT_STREAM_CONFIG.show_magnitude,
    show_trails: stream.show_trails ?? DEFAULT_STREAM_CONFIG.show_trails,
    show_perspective_ruler:
      stream.show_perspective_ruler ?? DEFAULT_STREAM_CONFIG.show_perspective_ruler,
  };
}

function parseOptionalCoordinate(value, min, max) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  if (numeric < min || numeric > max) {
    return null;
  }
  return Number(numeric.toFixed(6));
}

function normalizeLocationName(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).replace(/\s+/g, " ").trim().slice(0, LOCATION_NAME_MAX_LENGTH);
}

function buildPinnedPointName(latitude, longitude) {
  return `Pinned point (${Number(latitude).toFixed(5)}, ${Number(longitude).toFixed(5)})`;
}

function locationSourceLabel(source) {
  if (source === "current") return "Current";
  if (source === "map") return "Point";
  if (source === "around") return "Nearby";
  if (source === "pin") return "Pin";
  return "Search";
}

function isFiniteInRange(value, min, max) {
  return Number.isFinite(value) && value >= min && value <= max;
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function parseBoundedNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return clampNumber(numeric, min, max);
}

function snapToStep(value, step, min = 0) {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) {
    return value;
  }
  const snapped = Math.round((value - min) / step) * step + min;
  return Number(snapped.toFixed(3));
}

function normalizeOrientation(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_FORM.orientation_deg;
  }
  const normalized = ((numeric % 360) + 360) % 360;
  return clampNumber(normalized, CAMERA_ORIENTATION_MIN, CAMERA_ORIENTATION_MAX);
}

function normalizeViewDistance(value, fallback = DEFAULT_FORM.view_distance_m) {
  const bounded = parseBoundedNumber(
    value,
    CAMERA_VIEW_DISTANCE_MIN,
    CAMERA_VIEW_DISTANCE_MAX,
    fallback
  );
  const stepped = snapToStep(
    bounded,
    CAMERA_VIEW_DISTANCE_STEP,
    CAMERA_VIEW_DISTANCE_MIN
  );
  return clampNumber(stepped, CAMERA_VIEW_DISTANCE_MIN, CAMERA_VIEW_DISTANCE_MAX);
}

function normalizeCameraTilt(value, fallback = DEFAULT_FORM.camera_tilt_deg) {
  return parseBoundedNumber(value, CAMERA_TILT_MIN, CAMERA_TILT_MAX, fallback);
}

function normalizeCameraHeight(value, fallback = DEFAULT_FORM.camera_height_m) {
  return parseBoundedNumber(value, CAMERA_HEIGHT_MIN, CAMERA_HEIGHT_MAX, fallback);
}

function normalizePerspectiveRulerOpacity(
  value,
  fallback = DEFAULT_STREAM_CONFIG.perspective_ruler_opacity
) {
  return parseBoundedNumber(value, 0, 100, fallback);
}

function estimateGroundReachMeters(cameraHeightM, cameraTiltDeg) {
  const height = Number(cameraHeightM);
  const tilt = Number(cameraTiltDeg);
  if (!Number.isFinite(height) || !Number.isFinite(tilt) || height <= 0 || tilt <= 0) {
    return null;
  }
  const tiltRadians = (tilt * Math.PI) / 180;
  const tiltTangent = Math.tan(tiltRadians);
  if (!Number.isFinite(tiltTangent) || tiltTangent <= 0.00001) {
    return null;
  }
  return height / tiltTangent;
}

function orientationFromClientPoint(element, clientX, clientY) {
  if (!element) {
    return DEFAULT_FORM.orientation_deg;
  }
  const rect = element.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const dx = clientX - centerX;
  const dy = clientY - centerY;
  const degrees = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  return normalizeOrientation(degrees);
}

function compassPoint(centerX, centerY, radius, bearingDeg) {
  const radians = (Number(bearingDeg) * Math.PI) / 180;
  return {
    x: centerX + radius * Math.sin(radians),
    y: centerY - radius * Math.cos(radians),
  };
}

function destinationPoint(latitude, longitude, bearingDeg, distanceMeters) {
  const bearing = (bearingDeg * Math.PI) / 180;
  const angularDistance = distanceMeters / EARTH_RADIUS_M;
  const lat1 = (latitude * Math.PI) / 180;
  const lon1 = (longitude * Math.PI) / 180;

  const sinLat1 = Math.sin(lat1);
  const cosLat1 = Math.cos(lat1);
  const sinAngularDistance = Math.sin(angularDistance);
  const cosAngularDistance = Math.cos(angularDistance);

  const lat2 = Math.asin(
    sinLat1 * cosAngularDistance + cosLat1 * sinAngularDistance * Math.cos(bearing)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * sinAngularDistance * cosLat1,
      cosAngularDistance - sinLat1 * Math.sin(lat2)
    );

  const normalizedLon = ((((lon2 * 180) / Math.PI) + 540) % 360) - 180;
  return [Number((lat2 * 180 / Math.PI).toFixed(6)), Number(normalizedLon.toFixed(6))];
}

function buildCameraViewPolygon(latitude, longitude, orientationDeg, viewAngleDeg, viewDistanceM) {
  const halfAngle = clampNumber(viewAngleDeg / 2, 1, 85);
  const left = destinationPoint(latitude, longitude, orientationDeg - halfAngle, viewDistanceM);
  const center = destinationPoint(latitude, longitude, orientationDeg, viewDistanceM);
  const right = destinationPoint(latitude, longitude, orientationDeg + halfAngle, viewDistanceM);
  return [
    [latitude, longitude],
    left,
    center,
    right,
  ];
}

function normalizeBearing(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return ((numeric % 360) + 360) % 360;
}

function shortestAngleDelta(targetDeg, referenceDeg) {
  const target = normalizeBearing(targetDeg);
  const reference = normalizeBearing(referenceDeg);
  return ((target - reference + 540) % 360) - 180;
}

function interpolate(start, end, ratio) {
  return start + (end - start) * ratio;
}

function buildPerspectiveGridGeometry(stream) {
  const streamOrientation = Number(stream?.orientation_deg);
  const streamViewAngle = Number(stream?.view_angle_deg);
  const streamViewDistance = Number(stream?.view_distance_m);
  const streamCameraTilt = Number(stream?.camera_tilt_deg);
  const streamCameraHeight = Number(stream?.camera_height_m);

  const orientationDeg = normalizeOrientation(
    Number.isFinite(streamOrientation) ? streamOrientation : DEFAULT_FORM.orientation_deg
  );
  const viewAngleDeg = parseBoundedNumber(
    Number.isFinite(streamViewAngle) ? streamViewAngle : DEFAULT_FORM.view_angle_deg,
    CAMERA_VIEW_ANGLE_MIN,
    CAMERA_VIEW_ANGLE_MAX,
    DEFAULT_FORM.view_angle_deg
  );
  const viewDistanceM = normalizeViewDistance(
    Number.isFinite(streamViewDistance) ? streamViewDistance : DEFAULT_FORM.view_distance_m,
    DEFAULT_FORM.view_distance_m
  );
  const cameraTiltDeg = normalizeCameraTilt(
    Number.isFinite(streamCameraTilt) ? streamCameraTilt : DEFAULT_FORM.camera_tilt_deg,
    DEFAULT_FORM.camera_tilt_deg
  );
  const cameraHeightM = normalizeCameraHeight(
    Number.isFinite(streamCameraHeight) ? streamCameraHeight : DEFAULT_FORM.camera_height_m,
    DEFAULT_FORM.camera_height_m
  );

  const signedOrientation = shortestAngleDelta(orientationDeg, 0);
  const orientationFactor = Math.sin((signedOrientation * Math.PI) / 180);
  const distanceRatio = clampNumber(
    (viewDistanceM - CAMERA_VIEW_DISTANCE_MIN) /
      Math.max(1, CAMERA_VIEW_DISTANCE_MAX - CAMERA_VIEW_DISTANCE_MIN),
    0,
    1
  );
  const tiltRatio = clampNumber(
    (cameraTiltDeg - CAMERA_TILT_MIN) / Math.max(1, CAMERA_TILT_MAX - CAMERA_TILT_MIN),
    0,
    1
  );
  const groundReachM = estimateGroundReachMeters(cameraHeightM, cameraTiltDeg);
  const groundReachRatio =
    groundReachM === null
      ? null
      : clampNumber(groundReachM / Math.max(1, viewDistanceM), 0, 1);

  let horizonY = 62 - distanceRatio * 24 + tiltRatio * 18;
  if (groundReachRatio !== null) {
    horizonY += (1 - groundReachRatio) * 10;
  }
  horizonY = clampNumber(horizonY, 18, 78);

  const topWidth =
    18 +
    ((viewAngleDeg - CAMERA_VIEW_ANGLE_MIN) /
      Math.max(1, CAMERA_VIEW_ANGLE_MAX - CAMERA_VIEW_ANGLE_MIN)) *
      58;
  const nearY = 97;
  const leftBottomX = 2;
  const rightBottomX = 98;
  const vanishX = clampNumber(50 + orientationFactor * 16, 18, 82);
  let leftTopX = vanishX - topWidth * 0.5;
  let rightTopX = vanishX + topWidth * 0.5;
  if (leftTopX < 4) {
    const delta = 4 - leftTopX;
    leftTopX += delta;
    rightTopX += delta;
  }
  if (rightTopX > 96) {
    const delta = rightTopX - 96;
    leftTopX -= delta;
    rightTopX -= delta;
  }
  leftTopX = clampNumber(leftTopX, 4, 92);
  rightTopX = clampNumber(rightTopX, 8, 96);

  const laneDivisions = clampNumber(Math.round(5 + viewAngleDeg / 26), 6, 12);
  const laneLines = [];
  for (let index = 1; index < laneDivisions; index += 1) {
    const ratio = index / laneDivisions;
    laneLines.push({
      x1: interpolate(leftTopX, rightTopX, ratio),
      y1: horizonY,
      x2: interpolate(leftBottomX, rightBottomX, ratio),
      y2: nearY,
    });
  }

  const depthDivisions = clampNumber(Math.round(4 + viewDistanceM / 110), 5, 13);
  const depthLines = [];
  for (let index = 1; index <= depthDivisions; index += 1) {
    const ratio = index / (depthDivisions + 1);
    const yRatio = Math.pow(ratio, 1.75);
    const xRatio = Math.pow(ratio, 1.24);
    depthLines.push({
      y: interpolate(horizonY, nearY, yRatio),
      xLeft: interpolate(leftTopX, leftBottomX, xRatio),
      xRight: interpolate(rightTopX, rightBottomX, xRatio),
    });
  }

  return {
    leftTopX,
    rightTopX,
    leftBottomX,
    rightBottomX,
    horizonY,
    nearY,
    laneLines,
    depthLines,
    headingLine: {
      x1: vanishX,
      y1: horizonY,
      x2: 50 + orientationFactor * 7,
      y2: nearY,
    },
  };
}

function resolveLiveDirectionBearing(orientationDeg, vectorDirectionDeg, orientationOffsetDeg) {
  const vectorDirection = Number(vectorDirectionDeg);
  if (!Number.isFinite(vectorDirection)) {
    return null;
  }

  const orientation = normalizeBearing(orientationDeg);
  const offset = Number.isFinite(Number(orientationOffsetDeg)) ? Number(orientationOffsetDeg) : 0;
  // Worker direction is screen-space where 90deg means "forward/up" in camera view.
  // Convert it to world bearing by anchoring forward/up to camera orientation.
  return normalizeBearing(orientation + (normalizeBearing(vectorDirection) - 90) + offset);
}

function clampBearingToCone(bearingDeg, orientationDeg, viewAngleDeg) {
  const halfAngle = clampNumber(Number(viewAngleDeg) / 2, 1, 85);
  const maxDelta = Math.max(1.5, halfAngle - 1.5);
  const delta = shortestAngleDelta(bearingDeg, orientationDeg);
  return normalizeBearing(normalizeBearing(orientationDeg) + clampNumber(delta, -maxDelta, maxDelta));
}

function buildFlowDirectionPattern(latitude, longitude, bearingDeg, viewAngleDeg, viewDistanceM) {
  if (
    !Number.isFinite(Number(latitude)) ||
    !Number.isFinite(Number(longitude)) ||
    !Number.isFinite(Number(bearingDeg))
  ) {
    return [];
  }

  const maxDistance = clampNumber(Number(viewDistanceM) * 0.82, 35, 420);
  const startDistance = clampNumber(Number(viewDistanceM) * 0.18, 8, 110);
  const stepCount = viewDistanceM >= 320 ? 5 : viewDistanceM >= 170 ? 4 : 3;
  const segmentLength = clampNumber(Number(viewDistanceM) * 0.12, 10, 80);
  const wingLength = clampNumber(segmentLength * 0.48, 7, 34);
  const laneSpread = clampNumber(Number(viewAngleDeg) * 0.22, 6, 28);
  const laneBearings =
    Number(viewAngleDeg) >= 24
      ? [bearingDeg - laneSpread, bearingDeg, bearingDeg + laneSpread]
      : [bearingDeg];

  const segments = [];
  laneBearings.forEach((laneBearing, laneIndex) => {
    for (let step = 0; step < stepCount; step += 1) {
      const t = (step + 1) / (stepCount + 1);
      const centerDistance = startDistance + (maxDistance - startDistance) * t;
      const shaftStartDistance = Math.max(startDistance, centerDistance - segmentLength * 0.5);
      const shaftEndDistance = Math.min(maxDistance, centerDistance + segmentLength * 0.5);
      const shaftStart = destinationPoint(latitude, longitude, laneBearing, shaftStartDistance);
      const shaftEnd = destinationPoint(latitude, longitude, laneBearing, shaftEndDistance);
      const headLeft = destinationPoint(shaftEnd[0], shaftEnd[1], laneBearing + 154, wingLength);
      const headRight = destinationPoint(shaftEnd[0], shaftEnd[1], laneBearing - 154, wingLength);

      segments.push({
        id: `${laneIndex}-${step}`,
        shaft: [shaftStart, shaftEnd],
        leftHead: [shaftEnd, headLeft],
        rightHead: [shaftEnd, headRight],
      });
    }
  });

  return segments;
}

function buildPayload(form) {
  const latitude = parseOptionalCoordinate(form.latitude, -90, 90);
  const longitude = parseOptionalCoordinate(form.longitude, -180, 180);
  const orientation = normalizeOrientation(form.orientation_deg);
  const viewAngle = parseBoundedNumber(
    form.view_angle_deg,
    CAMERA_VIEW_ANGLE_MIN,
    CAMERA_VIEW_ANGLE_MAX,
    DEFAULT_FORM.view_angle_deg
  );
  const viewDistance = normalizeViewDistance(
    form.view_distance_m,
    DEFAULT_FORM.view_distance_m
  );
  const cameraTilt = normalizeCameraTilt(
    form.camera_tilt_deg,
    DEFAULT_FORM.camera_tilt_deg
  );
  const cameraHeight = normalizeCameraHeight(
    form.camera_height_m,
    DEFAULT_FORM.camera_height_m
  );
  const perspectiveRulerOpacity = normalizePerspectiveRulerOpacity(
    form.perspective_ruler_opacity,
    DEFAULT_STREAM_CONFIG.perspective_ruler_opacity
  );
  let locationName = normalizeLocationName(form.location_name);
  if (latitude !== null && longitude !== null && !locationName) {
    locationName = buildPinnedPointName(latitude, longitude);
  }

  return {
    name: form.name.trim(),
    rtsp_url: form.rtsp_url.trim(),
    location_name: locationName || null,
    latitude,
    longitude,
    orientation_deg: Number(orientation.toFixed(1)),
    view_angle_deg: Number(viewAngle.toFixed(1)),
    view_distance_m: Number(viewDistance.toFixed(0)),
    camera_tilt_deg: Number(cameraTilt.toFixed(1)),
    camera_height_m: Number(cameraHeight.toFixed(1)),
    is_active: !!form.is_active,
    grid_size: Number(form.grid_size),
    win_radius: Number(form.win_radius),
    threshold: Number(form.threshold),
    arrow_scale: Number(form.arrow_scale),
    arrow_opacity: Number(form.arrow_opacity),
    perspective_ruler_opacity: Number(perspectiveRulerOpacity.toFixed(0)),
    gradient_intensity: Number(form.gradient_intensity),
    show_feed: !!form.show_feed,
    show_arrows: !!form.show_arrows,
    show_magnitude: !!form.show_magnitude,
    show_trails: !!form.show_trails,
    show_perspective_ruler: !!form.show_perspective_ruler,
  };
}

function statusClass(stream) {
  const status = stream.connection_status || "unknown";
  if (status === "connected") return "healthy";
  if (status === "inactive") return "inactive";
  if (status === "starting") return "starting";
  if (status === "worker_down") return "error";
  if (status === "error") return "error";
  return "unknown";
}

function statusLabel(stream) {
  const status = stream.connection_status || "unknown";
  if (status === "connected") return "connected";
  if (status === "inactive") return "inactive";
  if (status === "starting") return "starting";
  if (status === "worker_down") return "worker down";
  if (status === "error") return "stream error";
  return status;
}

function statusDotColorClass(stream) {
  const status = stream.connection_status || "unknown";
  if (status === "connected") return "green";
  if (status === "starting" || status === "unknown") return "yellow";
  return "red";
}

function statusDotTooltip(stream) {
  const label = statusLabel(stream);
  if (stream.last_error) {
    return `${label}: ${stream.last_error}`;
  }
  return label;
}

function isConnectedStream(stream) {
  return (stream?.connection_status || "unknown") === "connected";
}

function requiresConnectedDeactivationWarning(stream) {
  return !!stream?.is_active && isConnectedStream(stream);
}

function toFixedValue(value, digits, fallback = "0.0") {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return numeric.toFixed(digits);
}

function formatTimestamp(value) {
  if (!value) {
    return "N/A";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }
  return parsed.toLocaleString();
}

function toTimestampMillis(value) {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeAlertStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  return status || null;
}

function alertStatusTone(status) {
  if (status === "firing" || status === "alerting") {
    return "danger";
  }
  if (status === "resolved" || status === "ok" || status === "normal") {
    return "good";
  }
  if (status === "pending") {
    return "pending";
  }
  return "na";
}

function alertStatusLabel(status) {
  if (status === "firing") return "Firing";
  if (status === "alerting") return "Alerting";
  if (status === "resolved") return "Resolved";
  if (status === "ok") return "OK";
  if (status === "normal") return "Normal";
  if (status === "pending") return "Pending";
  return "N/A";
}

function normalizeAlertSeverity(value) {
  const severity = String(value || "").trim().toLowerCase();
  if (!severity) {
    return null;
  }
  if (["critical", "fatal", "high", "emergency"].includes(severity)) {
    return "critical";
  }
  if (["warning", "warn", "medium"].includes(severity)) {
    return "warning";
  }
  if (["info", "informational", "low"].includes(severity)) {
    return "info";
  }
  return severity;
}

function alertSeverityTone(severity) {
  if (severity === "critical") return "critical";
  if (severity === "warning") return "warning";
  if (severity === "info") return "info";
  return "na";
}

function alertSeverityLabel(severity) {
  if (!severity || severity === "na") return "N/A";
  if (severity === "critical") return "Critical";
  if (severity === "warning") return "Warning";
  if (severity === "info") return "Info";
  return String(severity).toUpperCase();
}

function alertGroupStatusTone(statusBucket) {
  if (statusBucket === "firing") return "danger";
  if (statusBucket === "pending") return "pending";
  if (statusBucket === "resolved") return "good";
  return "na";
}

function alertGroupStatusLabel(statusBucket) {
  if (statusBucket === "firing") return "Firing";
  if (statusBucket === "pending") return "Pending";
  if (statusBucket === "resolved") return "Resolved";
  return "N/A";
}

function alertGroupStatusBucket(group) {
  if (group.manualResolvedActive) {
    return "resolved";
  }
  const status = group.latestStatus;
  if (status === "firing" || status === "alerting") {
    return "firing";
  }
  if (status === "pending") {
    return "pending";
  }
  if (status === "resolved" || status === "ok" || status === "normal") {
    return "resolved";
  }
  return "unknown";
}

function alertGroupSeverityBucket(group) {
  return group.latestSeverity || "na";
}

function buildAlertGroupStateMap(items) {
  const next = {};
  if (!Array.isArray(items)) {
    return next;
  }
  for (const item of items) {
    const identifier = String(item?.identifier || "").trim();
    if (!identifier) {
      continue;
    }
    next[identifier] = item;
  }
  return next;
}

function getLiveMetricValue(payload, metric) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const raw =
    metric === "fps"
      ? payload.fps
      : metric === "vector_count"
        ? payload.vector_count
        : metric === "direction_degrees"
          ? payload.direction_degrees
          : metric === "direction_coherence"
            ? payload.direction_coherence
            : payload.avg_magnitude;
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatLiveMetricValue(value, metric) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return metric === "vector_count" ? "0" : "0.0";
  }
  if (metric === "vector_count") {
    return `${Math.round(numeric)}`;
  }
  if (metric === "avg_magnitude") {
    return numeric.toFixed(3);
  }
  if (metric === "direction_degrees") {
    return `${numeric.toFixed(1)}°`;
  }
  if (metric === "direction_coherence") {
    return `${(numeric * 100).toFixed(0)}%`;
  }
  return numeric.toFixed(1);
}

function getHeatColor(value, metric, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "rgba(127, 176, 190, 0.75)";
  }

  if (metric === "direction_degrees") {
    const hue = ((numeric % 360) + 360) % 360;
    return `hsl(${hue}, 82%, 52%)`;
  }

  const span = Math.max(1e-6, max - min);
  const t = clampNumber((numeric - min) / span, 0, 1);
  const hue = 210 - t * 190;
  return `hsl(${hue.toFixed(0)}, 84%, 54%)`;
}

function getHeatRadius(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 14;
  }
  const span = Math.max(1e-6, max - min);
  const t = clampNumber((numeric - min) / span, 0, 1);
  return 14 + t * 26;
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (body?.detail) {
        detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
      }
    } catch {
      // Keep default detail when body cannot be parsed.
    }
    throw new Error(detail);
  }

  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return null;
}

function StreamMapClickCapture({ onPick }) {
  useMapEvents({
    click(event) {
      onPick(event.latlng.lat, event.latlng.lng);
    },
  });
  return null;
}

function MapBasemapSelector({ value, onChange }) {
  return (
    <label className="map-basemap-picker">
      <span>Basemap</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {MAP_BASEMAP_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function StreamMapCenter({ latitude, longitude, focusKey }) {
  const map = useMap();

  useEffect(() => {
    const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude);
    const targetCenter = hasCoordinates ? [latitude, longitude] : MAP_DEFAULT_CENTER;
    const targetZoom = hasCoordinates ? Math.max(map.getZoom(), MAP_SELECTED_ZOOM) : MAP_DEFAULT_ZOOM;

    const applyCenter = () => {
      map.invalidateSize({ pan: false, debounceMoveend: true });
      map.setView(targetCenter, targetZoom, { animate: false });
    };

    const frameId = window.requestAnimationFrame(applyCenter);
    const timeoutId = window.setTimeout(applyCenter, 140);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
    };
  }, [map, latitude, longitude, focusKey]);

  return null;
}

function LivePerspectiveGridOverlay({ stream }) {
  const showPerspectiveRuler =
    stream?.show_perspective_ruler ?? DEFAULT_STREAM_CONFIG.show_perspective_ruler;
  if (!showPerspectiveRuler) {
    return null;
  }

  const opacityRatio = clampNumber(
    normalizePerspectiveRulerOpacity(
      stream?.perspective_ruler_opacity,
      DEFAULT_STREAM_CONFIG.perspective_ruler_opacity
    ) / 100,
    0,
    1
  );

  const geometry = useMemo(
    () => buildPerspectiveGridGeometry(stream),
    [
      stream?.orientation_deg,
      stream?.view_angle_deg,
      stream?.view_distance_m,
      stream?.camera_tilt_deg,
      stream?.camera_height_m,
    ]
  );

  const surfacePoints = [
    [geometry.leftTopX, geometry.horizonY],
    [geometry.rightTopX, geometry.horizonY],
    [geometry.rightBottomX, geometry.nearY],
    [geometry.leftBottomX, geometry.nearY],
  ]
    .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ");

  return (
    <svg
      className="live-processing-overlay"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{ opacity: opacityRatio }}
      aria-hidden="true"
    >
      <polygon className="live-processing-surface" points={surfacePoints} />
      <line
        className="live-processing-boundary"
        x1={geometry.leftTopX.toFixed(2)}
        y1={geometry.horizonY.toFixed(2)}
        x2={geometry.leftBottomX.toFixed(2)}
        y2={geometry.nearY.toFixed(2)}
      />
      <line
        className="live-processing-boundary"
        x1={geometry.rightTopX.toFixed(2)}
        y1={geometry.horizonY.toFixed(2)}
        x2={geometry.rightBottomX.toFixed(2)}
        y2={geometry.nearY.toFixed(2)}
      />
      {geometry.depthLines.map((line, index) => (
        <line
          key={`depth-${index}`}
          className="live-processing-depth-line"
          x1={line.xLeft.toFixed(2)}
          y1={line.y.toFixed(2)}
          x2={line.xRight.toFixed(2)}
          y2={line.y.toFixed(2)}
        />
      ))}
      {geometry.laneLines.map((line, index) => (
        <line
          key={`lane-${index}`}
          className="live-processing-lane-line"
          x1={line.x1.toFixed(2)}
          y1={line.y1.toFixed(2)}
          x2={line.x2.toFixed(2)}
          y2={line.y2.toFixed(2)}
        />
      ))}
      <line
        className="live-processing-heading-line"
        x1={geometry.headingLine.x1.toFixed(2)}
        y1={geometry.headingLine.y1.toFixed(2)}
        x2={geometry.headingLine.x2.toFixed(2)}
        y2={geometry.headingLine.y2.toFixed(2)}
      />
    </svg>
  );
}

function LiveOverviewMapViewport({ points, fitKey, singlePointZoom = MAP_SELECTED_ZOOM }) {
  const map = useMap();

  useEffect(() => {
    const applyViewport = () => {
      map.invalidateSize({ pan: false, debounceMoveend: true });
      if (!Array.isArray(points) || points.length === 0) {
        map.setView(MAP_DEFAULT_CENTER, MAP_DEFAULT_ZOOM, { animate: false });
        return;
      }
      if (points.length === 1) {
        map.setView(points[0], singlePointZoom, { animate: false });
        return;
      }
      map.fitBounds(points, {
        animate: false,
        padding: [22, 22],
        maxZoom: 14,
      });
    };

    const frameId = window.requestAnimationFrame(applyViewport);
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [map, points, fitKey, singlePointZoom]);

  return null;
}

export default function App() {
  const initialLocation = parseLocationState();
  const [streams, setStreams] = useState([]);
  const [selectedStreamId, setSelectedStreamId] = useState(initialLocation.selectedStreamId);
  const [currentView, setCurrentView] = useState(initialLocation.view);
  const [dashboardRange, setDashboardRange] = useState(initialLocation.dashboardRange);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [alertEvents, setAlertEvents] = useState([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsError, setAlertsError] = useState("");
  const [alertSearchQuery, setAlertSearchQuery] = useState("");
  const [alertStatusFilter, setAlertStatusFilter] = useState("all");
  const [alertSeverityFilter, setAlertSeverityFilter] = useState("all");
  const [hideResolvedAlerts, setHideResolvedAlerts] = useState(true);
  const [alertGroupStates, setAlertGroupStates] = useState({});
  const [alertGroupMenuOpen, setAlertGroupMenuOpen] = useState(null);
  const [alertGroupActionBusyKey, setAlertGroupActionBusyKey] = useState("");
  const [, setWsStatus] = useState("disconnected");
  const [framePayload, setFramePayload] = useState(null);
  const [liveFramesByStream, setLiveFramesByStream] = useState({});
  const [workerLogs, setWorkerLogs] = useState([]);
  const [workerLogStatus, setWorkerLogStatus] = useState("unknown");
  const [workerLogContainer, setWorkerLogContainer] = useState(null);
  const [workerLogError, setWorkerLogError] = useState("");
  const [workerLogLoading, setWorkerLogLoading] = useState(false);
  const [workerLogUpdatedAt, setWorkerLogUpdatedAt] = useState(null);
  const [systemSettings, setSystemSettings] = useState(DEFAULT_SYSTEM_SETTINGS);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [liveNameFilter, setLiveNameFilter] = useState(initialLocation.liveNameFilter);
  const [liveStatusFilter, setLiveStatusFilter] = useState(initialLocation.liveStatusFilter);
  const [liveLayout, setLiveLayout] = useState(initialLocation.liveLayout);
  const [liveSortField, setLiveSortField] = useState(initialLocation.liveSortField);
  const [liveSortOrder, setLiveSortOrder] = useState(initialLocation.liveSortOrder);
  const [liveMapColorMetric, setLiveMapColorMetric] = useState(initialLocation.liveMapColorMetric);
  const [liveMapLayers, setLiveMapLayers] = useState(initialLocation.liveMapLayers);
  const [liveMapLayersOpen, setLiveMapLayersOpen] = useState(false);
  const [liveMapFitKey, setLiveMapFitKey] = useState(0);
  const [mapBasemap, setMapBasemap] = useState(initialLocation.mapBasemap);
  const [locationQuery, setLocationQuery] = useState("");
  const [locationSearching, setLocationSearching] = useState(false);
  const [locationResolvingPoint, setLocationResolvingPoint] = useState(false);
  const [locatingCurrent, setLocatingCurrent] = useState(false);
  const [locationSearchError, setLocationSearchError] = useState("");
  const [locationSearchResults, setLocationSearchResults] = useState([]);
  const [streamComboboxOpen, setStreamComboboxOpen] = useState(false);
  const [streamComboboxSearch, setStreamComboboxSearch] = useState("");
  const [deactivationConfirmStream, setDeactivationConfirmStream] = useState(null);
  const [deleteConfirmStream, setDeleteConfirmStream] = useState(null);
  const [isLivePanelFullscreen, setIsLivePanelFullscreen] = useState(false);

  const streamComboboxRef = useRef(null);
  const streamComboboxSearchRef = useRef(null);
  const deactivationConfirmResolverRef = useRef(null);
  const deleteConfirmResolverRef = useRef(null);
  const liveRoutePanelRef = useRef(null);
  const cameraAngleVisualRef = useRef(null);
  const cameraAngleVisualDraggingRef = useRef(false);
  const canvasRef = useRef(null);
  const imageRef = useRef(new Image());

  const selectedStream = useMemo(
    () => streams.find((stream) => stream.id === selectedStreamId) || null,
    [selectedStreamId, streams]
  );
  const groupedAlertEvents = useMemo(() => {
    const grouped = new Map();

    for (const event of alertEvents) {
      const fingerprint = String(event?.fingerprint || "").trim();
      const fallbackKey = [
        String(event?.alert_name || "").trim(),
        String(event?.stream_name || "").trim(),
        String(event?.severity || "").trim(),
      ]
        .filter(Boolean)
        .join("|");
      const groupKey = fingerprint || `na:${fallbackKey || "alert"}`;

      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, {
          groupKey,
          fingerprint: fingerprint || null,
          events: [],
        });
      }
      grouped.get(groupKey).events.push(event);
    }

    return Array.from(grouped.values())
      .map((group) => {
        const events = [...group.events].sort(
          (left, right) =>
            toTimestampMillis(right.received_at) - toTimestampMillis(left.received_at) ||
            Number(right.id || 0) - Number(left.id || 0)
        );
        const latest = events[0] || null;
        const latestStatus = normalizeAlertStatus(
          latest?.alert_status || latest?.notification_status
        );
        const latestSeverity = normalizeAlertSeverity(latest?.severity);
        const manualState = alertGroupStates[group.groupKey] || null;
        const manualResolved = !!manualState?.resolved;
        const manualResolvedAt = toTimestampMillis(manualState?.resolved_at);
        const latestReceivedAt = toTimestampMillis(latest?.received_at);
        const isNewlyActive =
          latestStatus !== null &&
          ["firing", "alerting", "pending"].includes(latestStatus) &&
          latestReceivedAt > manualResolvedAt;
        const manualResolvedActive = manualResolved && !isNewlyActive;

        return {
          groupKey: group.groupKey,
          fingerprint: group.fingerprint,
          events,
          count: events.length,
          latest,
          latestStatus,
          latestSeverity,
          manualResolvedActive,
        };
      })
      .sort(
        (left, right) =>
          toTimestampMillis(right.latest?.received_at) -
            toTimestampMillis(left.latest?.received_at) ||
          Number(right.latest?.id || 0) - Number(left.latest?.id || 0)
      );
  }, [alertEvents, alertGroupStates]);
  const filteredAlertGroups = useMemo(() => {
    const query = alertSearchQuery.trim().toLowerCase();

    return groupedAlertEvents.filter((group) => {
      const statusBucket = alertGroupStatusBucket(group);
      const severityBucket = alertGroupSeverityBucket(group);

      if (hideResolvedAlerts && statusBucket === "resolved") {
        return false;
      }
      if (alertStatusFilter !== "all" && statusBucket !== alertStatusFilter) {
        return false;
      }
      if (alertSeverityFilter !== "all" && severityBucket !== alertSeverityFilter) {
        return false;
      }

      if (!query) {
        return true;
      }
      const haystack = [
        group.fingerprint || "",
        group.latest?.alert_name || "",
        group.latest?.stream_name || "",
        group.latest?.summary || "",
        group.latest?.description || "",
        group.latestStatus || "",
        group.latestSeverity || "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [
    groupedAlertEvents,
    alertSearchQuery,
    alertStatusFilter,
    alertSeverityFilter,
    hideResolvedAlerts,
  ]);
  const unresolvedAlertGroupCount = useMemo(
    () =>
      groupedAlertEvents.reduce(
        (count, group) => count + (alertGroupStatusBucket(group) === "resolved" ? 0 : 1),
        0
      ),
    [groupedAlertEvents]
  );
  const unresolvedAlertGroupCountLabel =
    unresolvedAlertGroupCount > 99 ? "99+" : String(unresolvedAlertGroupCount);
  const streamComboboxFilteredStreams = useMemo(() => {
    const query = streamComboboxSearch.trim().toLowerCase();
    if (!query) {
      return streams;
    }
    return streams.filter((stream) => {
      const haystack = [
        String(stream.name || ""),
        statusLabel(stream),
        String(stream.worker_status || ""),
        normalizeLocationName(stream.location_name),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [streams, streamComboboxSearch]);
  const selectedBasemap = useMemo(
    () =>
      MAP_BASEMAP_OPTIONS.find((option) => option.value === mapBasemap) || MAP_BASEMAP_OPTIONS[0],
    [mapBasemap]
  );
  const mapTileLayerProps = useMemo(() => {
    const props = {
      attribution: selectedBasemap.attribution,
      url: selectedBasemap.url,
    };
    if (selectedBasemap.subdomains) {
      props.subdomains = selectedBasemap.subdomains;
    }
    return props;
  }, [selectedBasemap]);
  const formLatitude = useMemo(
    () => parseOptionalCoordinate(form.latitude, -90, 90),
    [form.latitude]
  );
  const formLongitude = useMemo(
    () => parseOptionalCoordinate(form.longitude, -180, 180),
    [form.longitude]
  );
  const formOrientationDeg = useMemo(
    () => normalizeOrientation(form.orientation_deg),
    [form.orientation_deg]
  );
  const formViewAngleDeg = useMemo(
    () =>
      parseBoundedNumber(
        form.view_angle_deg,
        CAMERA_VIEW_ANGLE_MIN,
        CAMERA_VIEW_ANGLE_MAX,
        DEFAULT_FORM.view_angle_deg
      ),
    [form.view_angle_deg]
  );
  const formViewDistanceM = useMemo(
    () => normalizeViewDistance(form.view_distance_m, DEFAULT_FORM.view_distance_m),
    [form.view_distance_m]
  );
  const formCameraTiltDeg = useMemo(
    () => normalizeCameraTilt(form.camera_tilt_deg, DEFAULT_FORM.camera_tilt_deg),
    [form.camera_tilt_deg]
  );
  const formCameraHeightM = useMemo(
    () => normalizeCameraHeight(form.camera_height_m, DEFAULT_FORM.camera_height_m),
    [form.camera_height_m]
  );
  const formPerspectiveRulerOpacity = useMemo(
    () =>
      normalizePerspectiveRulerOpacity(
        form.perspective_ruler_opacity,
        DEFAULT_STREAM_CONFIG.perspective_ruler_opacity
      ),
    [form.perspective_ruler_opacity]
  );
  const formGroundReachM = useMemo(
    () => estimateGroundReachMeters(formCameraHeightM, formCameraTiltDeg),
    [formCameraHeightM, formCameraTiltDeg]
  );
  const cameraAnglePreview = useMemo(() => {
    const size = 168;
    const center = size / 2;
    const radius = 66;
    const halfAngle = clampNumber(formViewAngleDeg / 2, 1, 85);
    const leftBearing = formOrientationDeg - halfAngle;
    const rightBearing = formOrientationDeg + halfAngle;
    const leftPoint = compassPoint(center, center, radius, leftBearing);
    const rightPoint = compassPoint(center, center, radius, rightBearing);
    const headingPoint = compassPoint(center, center, radius, formOrientationDeg);
    const clampedGroundReachRatio = formGroundReachM === null
      ? null
      : clampNumber(formGroundReachM / Math.max(1, formViewDistanceM), 0.14, 1);
    const groundReachPoint = clampedGroundReachRatio === null
      ? null
      : compassPoint(center, center, radius * clampedGroundReachRatio, formOrientationDeg);
    const conePath = `M ${center} ${center} L ${leftPoint.x.toFixed(2)} ${leftPoint.y.toFixed(2)} A ${radius} ${radius} 0 0 1 ${rightPoint.x.toFixed(2)} ${rightPoint.y.toFixed(2)} Z`;

    return {
      size,
      center,
      conePath,
      leftPoint,
      rightPoint,
      headingPoint,
      groundReachPoint,
    };
  }, [formOrientationDeg, formViewAngleDeg, formViewDistanceM, formGroundReachM]);
  const hasFormCoordinates = formLatitude !== null && formLongitude !== null;
  const mapCenter = hasFormCoordinates
    ? [formLatitude, formLongitude]
    : MAP_DEFAULT_CENTER;
  const mapZoom = hasFormCoordinates ? MAP_SELECTED_ZOOM : MAP_DEFAULT_ZOOM;
  const cameraViewPolygon = useMemo(() => {
    if (!hasFormCoordinates) {
      return null;
    }
    return buildCameraViewPolygon(
      formLatitude,
      formLongitude,
      formOrientationDeg,
      formViewAngleDeg,
      formViewDistanceM
    );
  }, [
    hasFormCoordinates,
    formLatitude,
    formLongitude,
    formOrientationDeg,
    formViewAngleDeg,
    formViewDistanceM,
  ]);
  const cameraMarkerIcon = useMemo(
    () =>
      divIcon({
        className: "camera-map-icon-wrap",
        html: '<div class="camera-map-icon"><span class="camera-map-lens"></span></div>',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      }),
    []
  );
  const configPreviewPerspectiveStream = useMemo(
    () => ({
      ...(selectedStream || {}),
      orientation_deg: formOrientationDeg,
      view_angle_deg: formViewAngleDeg,
      view_distance_m: formViewDistanceM,
      camera_tilt_deg: formCameraTiltDeg,
      camera_height_m: formCameraHeightM,
      show_perspective_ruler: !!form.show_perspective_ruler,
      perspective_ruler_opacity: formPerspectiveRulerOpacity,
    }),
    [
      selectedStream,
      formOrientationDeg,
      formViewAngleDeg,
      formViewDistanceM,
      formCameraTiltDeg,
      formCameraHeightM,
      form.show_perspective_ruler,
      formPerspectiveRulerOpacity,
    ]
  );

  const grafanaUrl = useMemo(() => {
    const base = `${GRAFANA_DASHBOARD_URL}?orgId=1&from=now-${dashboardRange}&to=now&refresh=5s&kiosk`;
    if (!selectedStream) {
      return `${base}&var-stream_name=All`;
    }
    return `${base}&var-stream_name=${encodeURIComponent(selectedStream.name)}`;
  }, [selectedStream, dashboardRange]);

  const latestStats = framePayload
    ? {
      fps: toFixedValue(framePayload.fps, 1, "0.0"),
      avg: toFixedValue(framePayload.avg_magnitude, 3, "0.000"),
      max: toFixedValue(framePayload.max_magnitude, 3, "0.000"),
      vectors: framePayload.vector_count ?? 0,
    }
    : {
      fps: "0.0",
      avg: "0.000",
      max: "0.000",
      vectors: 0,
    };

  const switchView = (nextView) => {
    if (nextView === currentView) {
      return;
    }
    const nextLocation = buildLocation(nextView, selectedStreamId, dashboardRange, {
      liveNameFilter,
      liveStatusFilter,
      liveLayout,
      liveSortField,
      liveSortOrder,
      liveMapColorMetric,
      liveMapLayers,
      mapBasemap,
    });
    window.history.pushState(null, "", nextLocation);
    setCurrentView(nextView);
  };

  const loadSystemSettings = async () => {
    const data = await apiRequest("/settings/system");
    setSystemSettings((current) => ({
      ...current,
      live_preview_fps: data.live_preview_fps,
      live_preview_jpeg_quality: data.live_preview_jpeg_quality,
      live_preview_max_width: data.live_preview_max_width,
      orientation_offset_deg: Number(data.orientation_offset_deg ?? 0),
    }));
    setSettingsLoaded(true);
  };

  const loadStreams = async () => {
    const data = await apiRequest("/streams");
    setStreams(data);

    setSelectedStreamId((currentSelectedId) => {
      if (!currentSelectedId || data.length === 0) {
        return null;
      }
      const stillExists = data.some((stream) => stream.id === currentSelectedId);
      if (stillExists) {
        return currentSelectedId;
      }
      return null;
    });
  };

  const loadAlertEvents = async (limit = 400) => {
    const data = await apiRequest(`/alerts?limit=${limit}`);
    setAlertEvents(Array.isArray(data) ? data : []);
  };

  const loadAlertGroupStates = async () => {
    const data = await apiRequest("/alerts/group-states");
    setAlertGroupStates(buildAlertGroupStateMap(data));
  };

  const handleSetAlertGroupResolved = async (group, resolved) => {
    const identifier = String(group?.groupKey || "").trim();
    if (!identifier) {
      return;
    }

    setAlertGroupActionBusyKey(identifier);
    try {
      const state = await apiRequest("/alerts/group-states", {
        method: "POST",
        body: JSON.stringify({
          identifier,
          resolved: !!resolved,
        }),
      });
      setAlertGroupStates((current) => ({
        ...current,
        [identifier]: state,
      }));
      setAlertsError("");
    } catch (err) {
      setAlertsError(err.message || "Unable to update alert group state.");
    } finally {
      setAlertGroupActionBusyKey("");
      setAlertGroupMenuOpen(null);
    }
  };

  useEffect(() => {
    const syncFromLocation = () => {
      const locationState = parseLocationState();
      setCurrentView(locationState.view);
      setSelectedStreamId(locationState.selectedStreamId);
      setDashboardRange(locationState.dashboardRange);
      setLiveNameFilter(locationState.liveNameFilter);
      setLiveStatusFilter(locationState.liveStatusFilter);
      setLiveLayout(locationState.liveLayout);
      setLiveSortField(locationState.liveSortField);
      setLiveSortOrder(locationState.liveSortOrder);
      setLiveMapColorMetric(locationState.liveMapColorMetric);
      setLiveMapLayers(locationState.liveMapLayers);
      setMapBasemap(locationState.mapBasemap);
    };

    window.addEventListener("popstate", syncFromLocation);
    return () => window.removeEventListener("popstate", syncFromLocation);
  }, []);

  useEffect(() => {
    const nextLocation = buildLocation(currentView, selectedStreamId, dashboardRange, {
      liveNameFilter,
      liveStatusFilter,
      liveLayout,
      liveSortField,
      liveSortOrder,
      liveMapColorMetric,
      liveMapLayers,
      mapBasemap,
    });
    const currentLocation = `${window.location.pathname}${window.location.search}`;
    if (nextLocation !== currentLocation) {
      window.history.replaceState(null, "", nextLocation);
    }
  }, [
    currentView,
    selectedStreamId,
    dashboardRange,
    liveNameFilter,
    liveStatusFilter,
    liveLayout,
    liveSortField,
    liveSortOrder,
    liveMapColorMetric,
    liveMapLayers,
    mapBasemap,
  ]);

  useEffect(() => {
    const run = async () => {
      try {
        setError("");
        await Promise.all([loadStreams(), loadSystemSettings()]);
      } catch (err) {
        setError(err.message);
      }
    };

    run();

    const interval = setInterval(() => {
      loadStreams().catch(() => {
        // Ignore periodic polling errors and keep last known state.
      });
    }, 8000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (currentView !== "settings" || settingsLoaded) {
      return;
    }

    let cancelled = false;
    setSettingsLoading(true);
    loadSystemSettings()
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSettingsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentView, settingsLoaded]);

  useEffect(() => {
    if (currentView !== "alerts") {
      return;
    }

    let cancelled = false;

    const fetchAlerts = async (silent = false) => {
      if (!silent) {
        setAlertsLoading(true);
      }
      try {
        const [eventsData, stateData] = await Promise.all([
          apiRequest("/alerts?limit=500"),
          apiRequest("/alerts/group-states"),
        ]);
        if (!cancelled) {
          setAlertEvents(Array.isArray(eventsData) ? eventsData : []);
          setAlertGroupStates(buildAlertGroupStateMap(stateData));
          setAlertsError("");
        }
      } catch (err) {
        if (!cancelled) {
          setAlertsError(err.message || "Unable to load webhook alerts.");
        }
      } finally {
        if (!silent && !cancelled) {
          setAlertsLoading(false);
        }
      }
    };

    fetchAlerts(false).catch(() => {
      // Keep last known state if initial fetch fails.
    });

    const interval = setInterval(() => {
      fetchAlerts(true).catch(() => {
        // Ignore periodic errors and keep last known data.
      });
    }, 10000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [currentView]);

  useEffect(() => {
    if (currentView === "alerts") {
      return;
    }

    let cancelled = false;
    const fetchAlertsForBadge = async () => {
      try {
        const [eventsData, stateData] = await Promise.all([
          apiRequest("/alerts?limit=500"),
          apiRequest("/alerts/group-states"),
        ]);
        if (!cancelled) {
          setAlertEvents(Array.isArray(eventsData) ? eventsData : []);
          setAlertGroupStates(buildAlertGroupStateMap(stateData));
        }
      } catch {
        // Badge refresh is best-effort outside of the alerts page.
      }
    };

    fetchAlertsForBadge().catch(() => {
      // Keep last known count if background refresh fails.
    });

    const interval = setInterval(() => {
      fetchAlertsForBadge().catch(() => {
        // Ignore periodic background failures.
      });
    }, 15000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [currentView]);

  useEffect(() => {
    if (!alertGroupMenuOpen) {
      return;
    }

    const handleDocumentMouseDown = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      if (!target.closest(".alerts-group-menu-wrap")) {
        setAlertGroupMenuOpen(null);
      }
    };
    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setAlertGroupMenuOpen(null);
      }
    };

    document.addEventListener("mousedown", handleDocumentMouseDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleDocumentMouseDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [alertGroupMenuOpen]);

  useEffect(() => {
    const validStreamIds = new Set(streams.map((stream) => stream.id));
    setLiveFramesByStream((current) => {
      const next = {};
      let changed = false;
      for (const [streamId, payload] of Object.entries(current)) {
        if (validStreamIds.has(streamId)) {
          next[streamId] = payload;
        } else {
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [streams]);

  useEffect(() => {
    if (!streamComboboxOpen) {
      return;
    }

    const handleDocumentMouseDown = (event) => {
      if (streamComboboxRef.current && !streamComboboxRef.current.contains(event.target)) {
        setStreamComboboxOpen(false);
        setStreamComboboxSearch("");
      }
    };
    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setStreamComboboxOpen(false);
        setStreamComboboxSearch("");
      }
    };

    document.addEventListener("mousedown", handleDocumentMouseDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleDocumentMouseDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [streamComboboxOpen]);

  useEffect(() => {
    if (!streamComboboxOpen) {
      return;
    }
    const frameId = window.requestAnimationFrame(() => {
      streamComboboxSearchRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [streamComboboxOpen]);

  useEffect(() => {
    if (currentView !== "config") {
      return;
    }

    if (!selectedStreamId) {
      if (editingId !== null) {
        setEditingId(null);
        setForm(DEFAULT_FORM);
        setLocationQuery("");
      }
      return;
    }

    if (editingId === selectedStreamId) {
      return;
    }

    const stream = streams.find((entry) => entry.id === selectedStreamId);
    if (!stream) {
      return;
    }

    setEditingId(stream.id);
    setForm(streamToForm(stream));
    setLocationQuery(normalizeLocationName(stream.location_name));
  }, [currentView, selectedStreamId, streams, editingId]);

  useEffect(() => {
    setLocationSearchResults([]);
    setLocationSearchError("");
    setLocationResolvingPoint(false);
    setLocatingCurrent(false);
  }, [selectedStreamId]);

  useEffect(() => {
    const needsConfigSocket = currentView === "config";
    const needsLiveSocket = currentView === "live";

    if (!needsConfigSocket && !needsLiveSocket) {
      setFramePayload(null);
      setWsStatus("disconnected");
      return;
    }

    if (needsConfigSocket && !selectedStreamId) {
      setFramePayload(null);
      setWsStatus("disconnected");
      return;
    }

    if (!needsConfigSocket) {
      setFramePayload(null);
    }

    let socket;
    let reconnectTimer;
    let closed = false;

    const connect = () => {
      if (closed) {
        return;
      }

      setWsStatus("connecting");
      const socketUrl = needsLiveSocket
        ? `${WS_BASE}/ws/frames`
        : `${WS_BASE}/ws/frames?stream_id=${encodeURIComponent(selectedStreamId)}`;
      socket = new WebSocket(socketUrl);

      socket.onopen = () => {
        setWsStatus("connected");
      };

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload?.type === "frame" || payload?.frame_b64) {
            if (needsLiveSocket) {
              if (!payload?.stream_id) {
                return;
              }
              setLiveFramesByStream((current) => ({
                ...current,
                [payload.stream_id]: payload,
              }));
              return;
            }
            setFramePayload(payload);
          }
        } catch {
          // Ignore malformed payloads.
        }
      };

      socket.onerror = () => {
        socket.close();
      };

      socket.onclose = () => {
        if (closed) {
          setWsStatus("disconnected");
          return;
        }
        setWsStatus("reconnecting");
        reconnectTimer = setTimeout(connect, 1200);
      };
    };

    connect();

    return () => {
      closed = true;
      clearTimeout(reconnectTimer);
      if (socket && socket.readyState <= WebSocket.OPEN) {
        socket.close();
      }
      setWsStatus("disconnected");
    };
  }, [selectedStreamId, currentView]);

  useEffect(() => {
    if (!framePayload?.frame_b64 || !canvasRef.current) {
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const img = imageRef.current;

    img.onload = () => {
      const rect = canvas.getBoundingClientRect();
      const displayWidth = Math.max(1, Math.floor(rect.width));
      const displayHeight = Math.max(1, Math.floor(rect.height));
      const dpr = window.devicePixelRatio || 1;

      canvas.width = Math.floor(displayWidth * dpr);
      canvas.height = Math.floor(displayHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, displayWidth, displayHeight);
      ctx.drawImage(img, 0, 0, displayWidth, displayHeight);
    };

    img.src = `data:image/jpeg;base64,${framePayload.frame_b64}`;
  }, [framePayload]);

  useEffect(() => {
    if (currentView !== "config" || !selectedStreamId) {
      setWorkerLogs([]);
      setWorkerLogStatus("unknown");
      setWorkerLogContainer(null);
      setWorkerLogError("");
      setWorkerLogLoading(false);
      setWorkerLogUpdatedAt(null);
      return;
    }

    let cancelled = false;

    const fetchWorkerLogs = async (silent = false) => {
      if (!silent && !cancelled) {
        setWorkerLogLoading(true);
      }
      try {
        const payload = await apiRequest(`/streams/${selectedStreamId}/worker-logs?tail=${WORKER_LOG_TAIL}`);
        if (cancelled) {
          return;
        }
        setWorkerLogs(Array.isArray(payload?.logs) ? payload.logs : []);
        setWorkerLogStatus(payload?.worker_status || "unknown");
        setWorkerLogContainer(payload?.worker_container_name || null);
        setWorkerLogError(payload?.error || "");
        setWorkerLogUpdatedAt(new Date().toISOString());
      } catch (err) {
        if (cancelled) {
          return;
        }
        setWorkerLogError(err.message);
      } finally {
        if (!silent && !cancelled) {
          setWorkerLogLoading(false);
        }
      }
    };

    fetchWorkerLogs(false).catch(() => {
      // Keep previous state if the initial fetch fails.
    });

    const interval = setInterval(() => {
      fetchWorkerLogs(true).catch(() => {
        // Ignore periodic fetch failures and keep last known logs.
      });
    }, WORKER_LOG_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [currentView, selectedStreamId]);

  const resetForm = () => {
    setForm(DEFAULT_FORM);
    setEditingId(null);
  };

  const requestConnectedDeactivationConfirm = (stream) => {
    if (!requiresConnectedDeactivationWarning(stream)) {
      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      if (deactivationConfirmResolverRef.current) {
        deactivationConfirmResolverRef.current(false);
      }
      deactivationConfirmResolverRef.current = resolve;
      setDeactivationConfirmStream({
        id: stream.id,
        name: stream.name || `Stream ${stream.id}`,
      });
    });
  };

  const resolveConnectedDeactivationConfirm = (proceed) => {
    if (deactivationConfirmResolverRef.current) {
      deactivationConfirmResolverRef.current(proceed);
      deactivationConfirmResolverRef.current = null;
    }
    setDeactivationConfirmStream(null);
  };

  const requestDeleteConfirm = (stream) =>
    new Promise((resolve) => {
      if (deleteConfirmResolverRef.current) {
        deleteConfirmResolverRef.current(false);
      }
      deleteConfirmResolverRef.current = resolve;
      setDeleteConfirmStream({
        id: stream.id,
        name: stream.name || `Stream ${stream.id}`,
        statusLabel: statusLabel(stream),
        statusClass: statusClass(stream),
        isActive: !!stream.is_active,
      });
    });

  const resolveDeleteConfirm = (proceed) => {
    if (deleteConfirmResolverRef.current) {
      deleteConfirmResolverRef.current(proceed);
      deleteConfirmResolverRef.current = null;
    }
    setDeleteConfirmStream(null);
  };

  useEffect(() => {
    return () => {
      if (deactivationConfirmResolverRef.current) {
        deactivationConfirmResolverRef.current(false);
        deactivationConfirmResolverRef.current = null;
      }
      if (deleteConfirmResolverRef.current) {
        deleteConfirmResolverRef.current(false);
        deleteConfirmResolverRef.current = null;
      }
    };
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setNotice("");

    const payload = buildPayload(form);
    const editingStream = editingId
      ? streams.find((stream) => stream.id === editingId) || null
      : null;
    if (
      editingStream &&
      editingStream.is_active &&
      !payload.is_active &&
      requiresConnectedDeactivationWarning(editingStream)
    ) {
      const confirmed = await requestConnectedDeactivationConfirm(editingStream);
      if (!confirmed) {
        return;
      }
    }

    setBusy(true);

    try {
      if (editingId) {
        await apiRequest(`/streams/${editingId}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        setNotice("Stream configuration saved.");
      } else {
        const created = await apiRequest("/streams", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setNotice("Stream created.");
        setSelectedStreamId(created.id);
      }

      await loadStreams();
      resetForm();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleSelectStream = (stream) => {
    setSelectedStreamId(stream.id);
    setEditingId(stream.id);
    setForm(streamToForm(stream));
    setLocationQuery(normalizeLocationName(stream.location_name));
  };

  const handleClearStreamSelection = () => {
    setSelectedStreamId(null);
    setEditingId(null);
    setForm(DEFAULT_FORM);
    setLocationQuery("");
    setLocationSearchResults([]);
    setLocationSearchError("");
    setLocationResolvingPoint(false);
    setLocatingCurrent(false);
  };

  const fetchNominatimJson = async (url) => {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      throw new Error(`Lookup failed (${response.status})`);
    }
    return response.json();
  };

  const normalizeLocationCandidates = (
    payload,
    source,
    fallbackLatitude = null,
    fallbackLongitude = null
  ) => {
    if (!Array.isArray(payload)) {
      return [];
    }
    return payload
      .map((entry) => {
        const displayName = normalizeLocationName(entry?.display_name || entry?.name || "");
        const latitude = Number(entry?.lat ?? fallbackLatitude);
        const longitude = Number(entry?.lon ?? fallbackLongitude);
        if (!displayName) {
          return null;
        }
        if (!isFiniteInRange(latitude, -90, 90) || !isFiniteInRange(longitude, -180, 180)) {
          return null;
        }
        return {
          display_name: displayName,
          lat: latitude,
          lon: longitude,
          source,
        };
      })
      .filter(Boolean);
  };

  const dedupeLocationCandidates = (candidates) => {
    const seen = new Set();
    const unique = [];
    for (const candidate of candidates) {
      const key = `${candidate.display_name.toLowerCase()}|${Number(candidate.lat).toFixed(5)}|${Number(candidate.lon).toFixed(5)}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      unique.push(candidate);
    }
    return unique;
  };

  const resolvePointLocationCandidates = async (latitude, longitude) => {
    const roundedLat = Number(latitude.toFixed(6));
    const roundedLon = Number(longitude.toFixed(6));
    const reverseResponses = await Promise.all(
      LOCATION_REVERSE_ZOOM_LEVELS.map((zoom) =>
        fetchNominatimJson(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=${zoom}&lat=${roundedLat}&lon=${roundedLon}`
        ).catch(() => null)
      )
    );

    const candidates = [];
    reverseResponses.forEach((payload, index) => {
      if (!payload || typeof payload !== "object") {
        return;
      }

      candidates.push(
        ...normalizeLocationCandidates([payload], index === 0 ? "map" : "around", roundedLat, roundedLon)
      );

      const address = payload.address && typeof payload.address === "object" ? payload.address : {};
      const nearbyLabel = normalizeLocationName(
        [
          address.road || address.pedestrian || address.neighbourhood || address.suburb,
          address.city || address.town || address.village || address.county,
          address.state || address.country,
        ]
          .filter(Boolean)
          .join(", ")
      );
      if (nearbyLabel) {
        candidates.push({
          display_name: nearbyLabel,
          lat: roundedLat,
          lon: roundedLon,
          source: index === 0 ? "map" : "around",
        });
      }
    });

    candidates.push({
      display_name: buildPinnedPointName(roundedLat, roundedLon),
      lat: roundedLat,
      lon: roundedLon,
      source: "pin",
    });
    return dedupeLocationCandidates(candidates).slice(0, LOCATION_SEARCH_LIMIT);
  };

  const applyLocationCandidate = (candidate, options = {}) => {
    const latitude = Number(candidate?.lat);
    const longitude = Number(candidate?.lon);
    if (!isFiniteInRange(latitude, -90, 90) || !isFiniteInRange(longitude, -180, 180)) {
      return;
    }

    const locationName =
      normalizeLocationName(candidate.display_name) || buildPinnedPointName(latitude, longitude);
    setForm((current) => ({
      ...current,
      location_name: locationName,
      latitude: latitude.toFixed(6),
      longitude: longitude.toFixed(6),
    }));
    setLocationQuery(locationName);

    if (!options.keepResults) {
      setLocationSearchResults([]);
    }
    setLocationSearchError("");
  };

  const handleLocationSearch = async () => {
    const query = locationQuery.trim();
    if (query.length < LOCATION_SEARCH_MIN_LENGTH) {
      setLocationSearchResults([]);
      setLocationSearchError(`Enter at least ${LOCATION_SEARCH_MIN_LENGTH} characters.`);
      return;
    }

    setLocationSearching(true);
    setLocationSearchError("");
    try {
      const payload = await fetchNominatimJson(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=${LOCATION_SEARCH_LIMIT}&addressdetails=1&q=${encodeURIComponent(query)}`
      );
      const results = normalizeLocationCandidates(payload, "search");

      setLocationSearchResults(results);
      if (results.length === 0) {
        setLocationSearchError("No matching locations found.");
      }
    } catch (err) {
      setLocationSearchResults([]);
      setLocationSearchError(err.message || "Location lookup failed.");
    } finally {
      setLocationSearching(false);
    }
  };

  const handleUseCurrentLocation = async () => {
    if (!navigator.geolocation) {
      setLocationSearchError("Browser geolocation is not available.");
      return;
    }

    setLocatingCurrent(true);
    setLocationSearchError("");

    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 60000,
        });
      });

      const latitude = Number(position.coords.latitude);
      const longitude = Number(position.coords.longitude);
      if (!isFiniteInRange(latitude, -90, 90) || !isFiniteInRange(longitude, -180, 180)) {
        throw new Error("Current coordinates are out of range.");
      }

      setLocationResolvingPoint(true);
      const candidates = await resolvePointLocationCandidates(latitude, longitude);
      const annotated = candidates.map((candidate, index) =>
        index === 0 ? { ...candidate, source: "current" } : candidate
      );
      setLocationSearchResults(annotated);
      applyLocationCandidate(annotated[0], { keepResults: true });
    } catch (err) {
      if (err && typeof err === "object" && "code" in err) {
        if (err.code === 1) {
          setLocationSearchError("Location permission was denied.");
        } else if (err.code === 2) {
          setLocationSearchError("Current location is unavailable.");
        } else if (err.code === 3) {
          setLocationSearchError("Current location request timed out.");
        } else {
          setLocationSearchError(String(err.message || "Unable to get current location."));
        }
      } else {
        setLocationSearchError(err.message || "Unable to get current location.");
      }
    } finally {
      setLocationResolvingPoint(false);
      setLocatingCurrent(false);
    }
  };

  const handleMapPointSelection = async (latitude, longitude) => {
    const roundedLat = Number(latitude.toFixed(6));
    const roundedLon = Number(longitude.toFixed(6));
    const fallbackCandidate = {
      display_name: buildPinnedPointName(roundedLat, roundedLon),
      lat: roundedLat,
      lon: roundedLon,
      source: "pin",
    };

    applyLocationCandidate(fallbackCandidate, { keepResults: true });
    setLocationResolvingPoint(true);
    setLocationSearchError("");

    try {
      const candidates = await resolvePointLocationCandidates(roundedLat, roundedLon);
      setLocationSearchResults(candidates);
      if (candidates.length > 0) {
        applyLocationCandidate(candidates[0], { keepResults: true });
      }
    } catch (err) {
      setLocationSearchResults([fallbackCandidate]);
      setLocationSearchError(err.message || "Unable to resolve location labels for this point.");
    } finally {
      setLocationResolvingPoint(false);
    }
  };

  const handleApplyLocationResult = (result, options = {}) => {
    applyLocationCandidate(result, options);
  };

  const handleCameraViewChange = (key, value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return;
    }

    if (key === "view_distance_m") {
      const steppedDistance = normalizeViewDistance(numeric, formViewDistanceM);
      setForm((current) => ({ ...current, [key]: Number(steppedDistance.toFixed(0)) }));
      return;
    }

    if (key === "camera_tilt_deg") {
      const boundedTilt = normalizeCameraTilt(numeric, formCameraTiltDeg);
      setForm((current) => ({ ...current, [key]: Number(boundedTilt.toFixed(1)) }));
      return;
    }

    if (key === "camera_height_m") {
      const boundedHeight = normalizeCameraHeight(numeric, formCameraHeightM);
      setForm((current) => ({ ...current, [key]: Number(boundedHeight.toFixed(1)) }));
      return;
    }

    let bounded = key === "orientation_deg"
      ? normalizeOrientation(numeric)
      : clampNumber(numeric, CAMERA_VIEW_ANGLE_MIN, CAMERA_VIEW_ANGLE_MAX);
    setForm((current) => ({ ...current, [key]: Number(bounded.toFixed(1)) }));
  };

  const updateOrientationFromPointer = (clientX, clientY) => {
    const orientation = orientationFromClientPoint(
      cameraAngleVisualRef.current,
      clientX,
      clientY
    );
    handleCameraViewChange("orientation_deg", orientation);
  };

  const handleOrientationDialPointerDown = (event) => {
    event.preventDefault();
    cameraAngleVisualDraggingRef.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    updateOrientationFromPointer(event.clientX, event.clientY);
  };

  const handleOrientationDialPointerMove = (event) => {
    if (!cameraAngleVisualDraggingRef.current) {
      return;
    }
    updateOrientationFromPointer(event.clientX, event.clientY);
  };

  const handleOrientationDialPointerUp = (event) => {
    cameraAngleVisualDraggingRef.current = false;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleOrientationDialKeyDown = (event) => {
    const fineStep = event.shiftKey ? 10 : 1;
    let nextOrientation = null;

    if (event.key === "ArrowUp" || event.key === "ArrowRight") {
      nextOrientation = formOrientationDeg + fineStep;
    } else if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
      nextOrientation = formOrientationDeg - fineStep;
    } else if (event.key === "Home") {
      nextOrientation = CAMERA_ORIENTATION_MIN;
    } else if (event.key === "End") {
      nextOrientation = CAMERA_ORIENTATION_MAX;
    }

    if (nextOrientation === null) {
      return;
    }
    event.preventDefault();
    handleCameraViewChange("orientation_deg", nextOrientation);
  };

  const handleSliderChange = (key, value) => {
    setForm((current) => ({ ...current, [key]: Number(value) }));
  };

  const handleToggle = async (stream) => {
    const confirmed = await requestConnectedDeactivationConfirm(stream);
    if (!confirmed) {
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      const path = stream.is_active
        ? `/streams/${stream.id}/deactivate`
        : `/streams/${stream.id}/activate`;
      await apiRequest(path, { method: "POST" });
      setNotice(stream.is_active ? "Stream deactivated." : "Stream activated.");
      await loadStreams();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (stream) => {
    const confirmed = await requestDeleteConfirm(stream);
    if (!confirmed) {
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      await apiRequest(`/streams/${stream.id}`, { method: "DELETE" });
      setNotice("Stream deleted.");
      if (selectedStreamId === stream.id) {
        setSelectedStreamId(null);
      }
      await loadStreams();
      if (editingId === stream.id) {
        resetForm();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleEditFromLive = (stream) => {
    handleSelectStream(stream);
    const nextLocation = buildLocation("config", stream.id, dashboardRange, {
      liveNameFilter,
      liveStatusFilter,
      liveLayout,
      liveSortField,
      liveSortOrder,
      liveMapColorMetric,
      liveMapLayers,
      mapBasemap,
    });
    window.history.pushState(null, "", nextLocation);
    setCurrentView("config");
  };

  const handleSystemSettingsSave = async (event) => {
    event.preventDefault();
    setSettingsSaving(true);
    setError("");
    setNotice("");

    try {
      await apiRequest("/settings/system", {
        method: "PUT",
        body: JSON.stringify({
          live_preview_fps: Number(systemSettings.live_preview_fps),
          live_preview_jpeg_quality: Number(systemSettings.live_preview_jpeg_quality),
          live_preview_max_width: Number(systemSettings.live_preview_max_width),
          orientation_offset_deg: Number(systemSettings.orientation_offset_deg),
          restart_workers: !!systemSettings.restart_workers,
        }),
      });
      setNotice("System settings saved.");
      await loadStreams();
      await loadSystemSettings();
    } catch (err) {
      setError(err.message);
    } finally {
      setSettingsSaving(false);
    }
  };

  const liveFilteredStreams = useMemo(() => {
    const nameFilter = liveNameFilter.trim().toLowerCase();
    const filtered = streams.filter((stream) => {
      const streamName = String(stream.name || "").toLowerCase();
      if (nameFilter && !streamName.includes(nameFilter)) {
        return false;
      }
      const status = String(stream.connection_status || "unknown").toLowerCase();
      if (liveStatusFilter === "connected") {
        return status === "connected" || status === "ok";
      }
      if (liveStatusFilter === "inactive") {
        return status === "inactive";
      }
      if (liveStatusFilter === "starting") {
        return status === "starting";
      }
      if (liveStatusFilter === "error") {
        return status === "error" || status === "worker_down";
      }
      return true;
    });
    return filtered;
  }, [streams, liveNameFilter, liveStatusFilter]);

  const liveFilteredSortedStreams = useMemo(() => {
    const getSortValue = (stream) => {
      if (liveSortField === "name") {
        return null;
      }
      const payload = liveFramesByStream[stream.id] || null;
      return getLiveMetricValue(payload, liveSortField);
    };

    return [...liveFilteredStreams].sort((left, right) => {
      if (liveSortField === "name") {
        const leftName = String(left.name || "");
        const rightName = String(right.name || "");
        return liveSortOrder === "asc"
          ? leftName.localeCompare(rightName)
          : rightName.localeCompare(leftName);
      }

      const leftValue = getSortValue(left);
      const rightValue = getSortValue(right);
      if (leftValue === null && rightValue === null) {
        return String(left.name || "").localeCompare(String(right.name || ""));
      }
      if (leftValue === null) {
        return 1;
      }
      if (rightValue === null) {
        return -1;
      }
      if (leftValue === rightValue) {
        return String(left.name || "").localeCompare(String(right.name || ""));
      }
      return liveSortOrder === "asc" ? leftValue - rightValue : rightValue - leftValue;
    });
  }, [liveFilteredStreams, liveFramesByStream, liveSortField, liveSortOrder]);

  const selectedLiveStream = selectedStreamId
    ? liveFilteredSortedStreams.find((stream) => stream.id === selectedStreamId) || null
    : null;
  const livePrimaryStreams = selectedLiveStream
    ? liveFilteredSortedStreams.filter((stream) => stream.id !== selectedLiveStream.id)
    : liveFilteredSortedStreams;
  const liveDirectionOffsetDeg = useMemo(
    () => parseBoundedNumber(systemSettings.orientation_offset_deg, -360, 360, 0),
    [systemSettings.orientation_offset_deg]
  );

  const liveMapStreams = useMemo(
    () =>
      liveFilteredStreams
        .map((stream) => {
          const latitude = Number(stream.latitude);
          const longitude = Number(stream.longitude);
          if (!isFiniteInRange(latitude, -90, 90) || !isFiniteInRange(longitude, -180, 180)) {
            return null;
          }

          const payload = liveFramesByStream[stream.id] || null;
          const colorValue = getLiveMetricValue(payload, liveMapColorMetric);
          const orientationDeg = normalizeOrientation(stream.orientation_deg);
          const viewAngleDeg = parseBoundedNumber(
            stream.view_angle_deg,
            CAMERA_VIEW_ANGLE_MIN,
            CAMERA_VIEW_ANGLE_MAX,
            DEFAULT_FORM.view_angle_deg
          );
          const viewDistanceM = parseBoundedNumber(
            stream.view_distance_m,
            CAMERA_VIEW_DISTANCE_MIN,
            CAMERA_VIEW_DISTANCE_MAX,
            DEFAULT_FORM.view_distance_m
          );
          const rawLiveDirectionBearing = resolveLiveDirectionBearing(
            orientationDeg,
            payload?.direction_degrees,
            liveDirectionOffsetDeg
          );
          const liveDirectionBearing =
            rawLiveDirectionBearing === null
              ? null
              : clampBearingToCone(rawLiveDirectionBearing, orientationDeg, viewAngleDeg);
          const directionCoherence = Number(payload?.direction_coherence);
          const flowPatternOpacity = Number.isFinite(directionCoherence)
            ? clampNumber(0.26 + directionCoherence * 0.72, 0.26, 0.96)
            : 0.38;
          const flowDirectionPattern =
            liveDirectionBearing === null
              ? []
              : buildFlowDirectionPattern(
                  latitude,
                  longitude,
                  liveDirectionBearing,
                  viewAngleDeg,
                  viewDistanceM
                );

          return {
            stream,
            payload,
            latitude,
            longitude,
            orientationDeg,
            viewAngleDeg,
            viewDistanceM,
            colorValue,
            liveDirectionBearing,
            flowPatternOpacity,
            flowDirectionPattern,
            cameraViewPolygon: buildCameraViewPolygon(
              latitude,
              longitude,
              orientationDeg,
              viewAngleDeg,
              viewDistanceM
            ),
            cameraOrientationLine: [
              [latitude, longitude],
              destinationPoint(latitude, longitude, orientationDeg, Math.max(20, viewDistanceM * 0.55)),
            ],
          };
        })
        .filter(Boolean),
    [liveFilteredStreams, liveFramesByStream, liveMapColorMetric, liveDirectionOffsetDeg]
  );

  const liveMapPoints = useMemo(
    () => liveMapStreams.map((entry) => [entry.latitude, entry.longitude]),
    [liveMapStreams]
  );

  const liveMapMetricRange = useMemo(() => {
    const values = liveMapStreams
      .map((entry) => Number(entry.colorValue))
      .filter((value) => Number.isFinite(value));
    if (values.length === 0) {
      return { min: 0, max: 1 };
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (Math.abs(max - min) < 1e-6) {
      return { min, max: min + 1 };
    }
    return { min, max };
  }, [liveMapStreams]);

  const liveMapColorLabel = useMemo(
    () =>
      LIVE_MAP_COLOR_OPTIONS.find((option) => option.value === liveMapColorMetric)?.label ||
      "Avg Magnitude",
    [liveMapColorMetric]
  );
  const isLiveMapLayout = liveLayout === "map";
  const isLiveFramelessLayout = liveLayout === "frameless";
  const fullscreenSupported =
    typeof document !== "undefined" && document.fullscreenEnabled !== false;
  const showLiveMapMarkers = liveMapLayers.includes("camera_markers");
  const showLiveMapCones = liveMapLayers.includes("camera_cones");
  const showLiveMapHeatmap = liveMapLayers.includes("heatmap");
  const showSingleStreamFlowDirection = liveMapStreams.length === 1;
  const liveMapLayerSummary = useMemo(() => {
    const selectedLabels = LIVE_MAP_LAYER_OPTIONS.filter((option) =>
      liveMapLayers.includes(option.value)
    ).map((option) => option.label);
    if (selectedLabels.length === 0) {
      return "No layers";
    }
    if (selectedLabels.length === LIVE_MAP_LAYER_OPTIONS.length) {
      return "All layers";
    }
    return selectedLabels.join(", ");
  }, [liveMapLayers]);

  useEffect(() => {
    if (!isLiveMapLayout) {
      setLiveMapLayersOpen(false);
    }
  }, [isLiveMapLayout]);

  useEffect(() => {
    const syncFullscreenState = () => {
      const panel = liveRoutePanelRef.current;
      setIsLivePanelFullscreen(!!panel && document.fullscreenElement === panel);
    };
    document.addEventListener("fullscreenchange", syncFullscreenState);
    syncFullscreenState();
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreenState);
    };
  }, []);

  useEffect(() => {
    if (
      !isLiveFramelessLayout &&
      liveRoutePanelRef.current &&
      document.fullscreenElement === liveRoutePanelRef.current
    ) {
      document.exitFullscreen?.().catch(() => {
        // Ignore browser fullscreen exit failures.
      });
    }
  }, [isLiveFramelessLayout]);

  const liveMapFocusStream = useMemo(() => {
    if (selectedStreamId) {
      const selected = liveMapStreams.find((entry) => entry.stream.id === selectedStreamId);
      if (selected) {
        return selected;
      }
    }
    return liveMapStreams[0] || null;
  }, [selectedStreamId, liveMapStreams]);

  const liveMapFocusPayload = liveMapFocusStream?.payload || null;
  const liveMapFocusDirectionCoherencePercent = Number.isFinite(
    Number(liveMapFocusPayload?.direction_coherence)
  )
    ? Number(liveMapFocusPayload.direction_coherence) * 100
    : 0;
  const selectedLiveMapEntry = useMemo(() => {
    if (!selectedLiveStream) {
      return null;
    }
    return liveMapStreams.find((entry) => entry.stream.id === selectedLiveStream.id) || null;
  }, [selectedLiveStream, liveMapStreams]);
  const selectedLiveMapPoints = useMemo(() => {
    if (!selectedLiveMapEntry) {
      return [];
    }
    return [[selectedLiveMapEntry.latitude, selectedLiveMapEntry.longitude]];
  }, [selectedLiveMapEntry]);

  const handleToggleLiveMapLayer = (layerValue) => {
    setLiveMapLayers((current) => {
      if (current.includes(layerValue)) {
        if (current.length === 1) {
          return current;
        }
        return current.filter((entry) => entry !== layerValue);
      }
      return [...current, layerValue];
    });
  };

  const renderLiveCard = (stream, { featured = false } = {}) => {
    const livePayload = liveFramesByStream[stream.id];
    const hasFrame = !!livePayload?.frame_b64;
    const directionCoherencePercent = Number.isFinite(Number(livePayload?.direction_coherence))
      ? Number(livePayload.direction_coherence) * 100
      : 0;

    return (
      <article
        className={`live-card ${statusClass(stream)} ${selectedStreamId === stream.id ? "selected" : ""} ${featured ? "featured" : ""}`}
      >
        <button
          type="button"
          className="live-card-header"
          onClick={() => setSelectedStreamId(stream.id)}
        >
          <span className="live-card-title">{stream.name}</span>
          <span className={`status ${statusClass(stream)}`}>{statusLabel(stream)}</span>
        </button>

        <div className="live-frame-shell">
          {hasFrame ? (
            <img
              className="live-frame"
              src={`data:image/jpeg;base64,${livePayload.frame_b64}`}
              alt={`${stream.name} live preview`}
              loading="lazy"
            />
          ) : (
            <div className="live-placeholder">
              <span>No live frame yet</span>
              <small>
                {stream.is_active
                  ? "Worker is starting or reconnecting."
                  : "Stream is deactivated."}
              </small>
            </div>
          )}
          <LivePerspectiveGridOverlay stream={stream} />
        </div>

        <div className="live-metrics">
          <span>FPS {toFixedValue(livePayload?.fps, 1, "0.0")}</span>
          <span>Vectors {livePayload?.vector_count ?? 0}</span>
          <span>Avg {toFixedValue(livePayload?.avg_magnitude, 3, "0.000")}</span>
          <span>Dir {toFixedValue(livePayload?.direction_degrees, 1, "0.0")}°</span>
          <span>Align {toFixedValue(directionCoherencePercent, 0, "0")}%</span>
        </div>

        {stream.last_error && <p className="stream-error">{stream.last_error}</p>}
        <div className="row actions live-actions">
          <button
            disabled={busy}
            className="btn tiny"
            type="button"
            onClick={() => handleEditFromLive(stream)}
          >
            Edit
          </button>
          <button
            disabled={busy}
            className="btn tiny"
            type="button"
            onClick={() => handleToggle(stream)}
          >
            {stream.is_active ? "Deactivate" : "Activate"}
          </button>
          <button
            disabled={busy}
            className="btn tiny danger"
            type="button"
            onClick={() => handleDelete(stream)}
          >
            Delete
          </button>
        </div>
      </article>
    );
  };

  const renderLiveListRow = (stream) => {
    const livePayload = liveFramesByStream[stream.id];
    const hasFrame = !!livePayload?.frame_b64;
    const directionCoherencePercent = Number.isFinite(Number(livePayload?.direction_coherence))
      ? Number(livePayload.direction_coherence) * 100
      : 0;

    return (
      <article
        className={`live-list-row ${statusClass(stream)} ${selectedStreamId === stream.id ? "selected" : ""}`}
      >
        <button
          type="button"
          className="live-list-row-main"
          onClick={() => setSelectedStreamId(stream.id)}
        >
          <div className="live-list-preview">
            <div className="live-frame-shell">
              {hasFrame ? (
                <img
                  className="live-frame"
                  src={`data:image/jpeg;base64,${livePayload.frame_b64}`}
                  alt={`${stream.name} live preview`}
                  loading="lazy"
                />
              ) : (
                <div className="live-placeholder">
                  <span>No live frame yet</span>
                  <small>
                    {stream.is_active
                      ? "Worker is starting or reconnecting."
                      : "Stream is deactivated."}
                  </small>
                </div>
              )}
              <LivePerspectiveGridOverlay stream={stream} />
            </div>
          </div>

          <div className="live-list-content">
            <div className="live-list-header">
              <span className="live-list-title">{stream.name}</span>
              <span className={`status ${statusClass(stream)}`}>{statusLabel(stream)}</span>
            </div>
            <div className="live-metrics live-list-metrics">
              <span>FPS {toFixedValue(livePayload?.fps, 1, "0.0")}</span>
              <span>Vectors {livePayload?.vector_count ?? 0}</span>
              <span>Avg {toFixedValue(livePayload?.avg_magnitude, 3, "0.000")}</span>
              <span>Dir {toFixedValue(livePayload?.direction_degrees, 1, "0.0")}°</span>
              <span>Align {toFixedValue(directionCoherencePercent, 0, "0")}%</span>
            </div>
            {stream.last_error && <p className="stream-error">{stream.last_error}</p>}
          </div>
        </button>
        <div className="row actions live-actions">
          <button
            disabled={busy}
            className="btn tiny"
            type="button"
            onClick={() => handleEditFromLive(stream)}
          >
            Edit
          </button>
          <button
            disabled={busy}
            className="btn tiny"
            type="button"
            onClick={() => handleToggle(stream)}
          >
            {stream.is_active ? "Deactivate" : "Activate"}
          </button>
          <button
            disabled={busy}
            className="btn tiny danger"
            type="button"
            onClick={() => handleDelete(stream)}
          >
            Delete
          </button>
        </div>
      </article>
    );
  };

  const renderSelectedLiveSection = () => {
    if (!selectedLiveStream) {
      return null;
    }

    return (
      <section
        className={`live-featured-section live-selected-split ${isLiveMapLayout ? "live-selected-map-top" : ""}`.trim()}
      >
        <article className="live-selected-location-panel">
          <header className="live-selected-panel-header">
            <h3>Selected Location</h3>
            <p className="muted">
              {normalizeLocationName(selectedLiveStream.location_name) ||
                (selectedLiveMapEntry
                  ? `${toFixedValue(selectedLiveMapEntry.latitude, 4, "0.0000")}, ${toFixedValue(selectedLiveMapEntry.longitude, 4, "0.0000")}`
                  : "No coordinates configured")}
            </p>
          </header>
          {selectedLiveMapEntry ? (
            <div className="live-selected-map-shell map-with-basemap">
              <MapBasemapSelector value={mapBasemap} onChange={setMapBasemap} />
              <MapContainer
                center={selectedLiveMapPoints[0]}
                zoom={MAP_LIVE_SINGLE_POINT_ZOOM}
                scrollWheelZoom
                className="live-selected-map-canvas"
              >
                <TileLayer {...mapTileLayerProps} />
                <LiveOverviewMapViewport
                  points={selectedLiveMapPoints}
                  fitKey={selectedLiveStream.id}
                  singlePointZoom={MAP_LIVE_SINGLE_POINT_ZOOM}
                />
                <Polygon
                  positions={selectedLiveMapEntry.cameraViewPolygon}
                  pathOptions={{
                    color: "#16f2b3",
                    fillColor: "#16f2b3",
                    fillOpacity: 0.2,
                    weight: 1.7,
                  }}
                />
                <Polyline
                  positions={selectedLiveMapEntry.cameraOrientationLine}
                  pathOptions={{
                    color: "#16f2b3",
                    weight: 2.1,
                    opacity: 0.9,
                  }}
                />
                {selectedLiveMapEntry.flowDirectionPattern.map((segment) => (
                  <Fragment key={`selected-flow-${segment.id}`}>
                    <Polyline
                      positions={segment.shaft}
                      pathOptions={{
                        color: "#f6e58d",
                        weight: 2.2,
                        opacity: selectedLiveMapEntry.flowPatternOpacity,
                      }}
                    />
                    <Polyline
                      positions={segment.leftHead}
                      pathOptions={{
                        color: "#f6e58d",
                        weight: 1.8,
                        opacity: selectedLiveMapEntry.flowPatternOpacity,
                      }}
                    />
                    <Polyline
                      positions={segment.rightHead}
                      pathOptions={{
                        color: "#f6e58d",
                        weight: 1.8,
                        opacity: selectedLiveMapEntry.flowPatternOpacity,
                      }}
                    />
                  </Fragment>
                ))}
                <Marker
                  position={[
                    selectedLiveMapEntry.latitude,
                    selectedLiveMapEntry.longitude,
                  ]}
                  icon={cameraMarkerIcon}
                >
                  <Tooltip direction="top" offset={[0, -14]} opacity={0.9}>
                    {selectedLiveStream.name}
                  </Tooltip>
                </Marker>
              </MapContainer>
            </div>
          ) : (
            <div className="live-selected-map-empty">
              <p className="muted">
                Set latitude and longitude in Stream Config to show the location.
              </p>
            </div>
          )}
        </article>
        <article className="live-selected-preview-panel">
          <header className="live-selected-panel-header">
            <h3>Selected Preview</h3>
          </header>
          {renderLiveCard(selectedLiveStream, { featured: true })}
        </article>
      </section>
    );
  };

  const renderLiveFramelessTile = (stream) => {
    const livePayload = liveFramesByStream[stream.id];
    const hasFrame = !!livePayload?.frame_b64;
    const directionCoherencePercent = Number.isFinite(Number(livePayload?.direction_coherence))
      ? Number(livePayload.direction_coherence) * 100
      : 0;

    return (
      <article
        key={stream.id}
        className={`live-frameless-tile ${selectedStreamId === stream.id ? "selected" : ""}`}
        role="button"
        tabIndex={0}
        aria-label={`Select ${stream.name} stream`}
        onClick={() => setSelectedStreamId(stream.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setSelectedStreamId(stream.id);
          }
        }}
      >
        <div className="live-frameless-frame">
          {hasFrame ? (
            <img
              className="live-frame"
              src={`data:image/jpeg;base64,${livePayload.frame_b64}`}
              alt={`${stream.name} live preview`}
              loading="lazy"
            />
          ) : (
            <div className="live-placeholder">
              <span>No frame</span>
              <small>{stream.is_active ? "Starting/reconnecting" : "Deactivated"}</small>
            </div>
          )}
          <LivePerspectiveGridOverlay stream={stream} />
          <span className="live-frameless-name">{stream.name}</span>
          <div className="live-frameless-metrics">
            <span>F{toFixedValue(livePayload?.fps, 1, "0.0")}</span>
            <span>V{livePayload?.vector_count ?? 0}</span>
            <span>A{toFixedValue(livePayload?.avg_magnitude, 2, "0.00")}</span>
            <span>D{toFixedValue(livePayload?.direction_degrees, 0, "0")}°</span>
            <span>C{toFixedValue(directionCoherencePercent, 0, "0")}%</span>
          </div>
        </div>
      </article>
    );
  };

  const handleToggleLiveFullscreen = async () => {
    const panel = liveRoutePanelRef.current;
    if (!panel || !fullscreenSupported) {
      return;
    }

    try {
      if (document.fullscreenElement === panel) {
        await document.exitFullscreen();
      } else {
        await panel.requestFullscreen();
      }
    } catch (err) {
      setError(err.message || "Unable to toggle fullscreen mode.");
    }
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>Vector Flow Fleet Manager</h1>
          <p>Add stream URL first, then tune live settings and save to apply worker processing.</p>
          <div className="view-toggle" role="tablist" aria-label="Application views">
            <button
              type="button"
              className={`btn tiny ${currentView === "config" ? "primary active" : ""}`}
              onClick={() => switchView("config")}
            >
              {selectedStream ? `Tune Stream: ${selectedStream.name}` : "Create Stream"}
            </button>
            <button
              type="button"
              className={`btn tiny ${currentView === "dashboard" ? "primary active" : ""}`}
              onClick={() => switchView("dashboard")}
            >
              Dashboard
            </button>
            <button
              type="button"
              className={`btn tiny ${currentView === "live" ? "primary active" : ""}`}
              onClick={() => switchView("live")}
            >
              Live Overview
            </button>
            <button
              type="button"
              className={`btn tiny alerts-nav-button ${currentView === "alerts" ? "primary active" : ""}`}
              onClick={() => switchView("alerts")}
              title={`${unresolvedAlertGroupCount} unresolved alert group${unresolvedAlertGroupCount === 1 ? "" : "s"}`}
            >
              <span>Alerts</span>
              <span className={`alerts-nav-pill ${unresolvedAlertGroupCount > 0 ? "has-alerts" : ""}`}>
                {unresolvedAlertGroupCountLabel}
              </span>
            </button>
            <button
              type="button"
              className={`btn tiny ${currentView === "settings" ? "primary active" : ""}`}
              onClick={() => switchView("settings")}
            >
              System Settings
            </button>
          </div>
        </div>
        <div className="header-controls">
          <div className="header-stream-select" ref={streamComboboxRef}>
            <span>Selected Stream</span>
            <div className={`header-stream-combobox ${streamComboboxOpen ? "open" : ""}`}>
              <button
                type="button"
                className="header-stream-combobox-trigger"
                onClick={() => {
                  setStreamComboboxOpen((current) => {
                    const next = !current;
                    if (!next) {
                      setStreamComboboxSearch("");
                    }
                    return next;
                  });
                }}
                aria-haspopup="listbox"
                aria-expanded={streamComboboxOpen}
              >
                <span className="header-stream-combobox-trigger-main">
                  <span
                    className={`stream-status-dot ${selectedStream ? statusDotColorClass(selectedStream) : "green"}`}
                    title={selectedStream ? statusDotTooltip(selectedStream) : "All streams selected"}
                    aria-hidden="true"
                  />
                  <span className="header-stream-combobox-trigger-label">
                    {selectedStream ? selectedStream.name : "All Streams"}
                  </span>
                </span>
                <span className="header-stream-combobox-caret">
                  {streamComboboxOpen ? "▴" : "▾"}
                </span>
              </button>
              {streamComboboxOpen && (
                <div className="header-stream-combobox-menu">
                  <input
                    ref={streamComboboxSearchRef}
                    type="search"
                    value={streamComboboxSearch}
                    onChange={(event) => setStreamComboboxSearch(event.target.value)}
                    placeholder="Search streams"
                    aria-label="Search streams"
                  />
                  <div className="header-stream-combobox-options" role="listbox" aria-label="Streams">
                    <button
                      type="button"
                      className={`header-stream-option ${!selectedStreamId ? "selected" : ""}`}
                      onClick={() => {
                        setSelectedStreamId(null);
                        setStreamComboboxOpen(false);
                        setStreamComboboxSearch("");
                      }}
                    >
                      <span className="header-stream-option-main">
                        <span
                          className="stream-status-dot green"
                          title="All streams selected"
                          aria-hidden="true"
                        />
                        <span className="header-stream-option-name">All Streams</span>
                      </span>
                      <span className="header-stream-option-meta">No stream filter</span>
                    </button>
                    {streamComboboxFilteredStreams.length === 0 ? (
                      <p className="muted header-stream-empty">No streams match this search.</p>
                    ) : (
                      streamComboboxFilteredStreams.map((stream) => (
                        <button
                          key={stream.id}
                          type="button"
                          className={`header-stream-option ${selectedStreamId === stream.id ? "selected" : ""}`}
                          onClick={() => {
                            setSelectedStreamId(stream.id);
                            setStreamComboboxOpen(false);
                            setStreamComboboxSearch("");
                          }}
                        >
                          <span className="header-stream-option-main">
                            <span
                              className={`stream-status-dot ${statusDotColorClass(stream)}`}
                              title={statusDotTooltip(stream)}
                              aria-hidden="true"
                            />
                            <span className="header-stream-option-name">{stream.name}</span>
                          </span>
                          <span className="header-stream-option-meta">
                            {statusLabel(stream)} · Worker {stream.worker_status || "unknown"}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
            {selectedStream && (
              <div className="header-selected-stream-actions">
                <button
                  type="button"
                  className="btn tiny ghost"
                  disabled={busy}
                  onClick={handleClearStreamSelection}
                >
                  Clear Selection
                </button>
                <button
                  type="button"
                  className="btn tiny"
                  disabled={busy}
                  onClick={() => handleToggle(selectedStream)}
                >
                  {selectedStream.is_active ? "Deactivate Selected Stream" : "Activate Selected Stream"}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {currentView === "config" ? (
        <main className={`app-grid ${selectedStream ? "" : "dashboard-only"}`.trim()}>
          <section className="panel controls-panel">
            <h2>{editingId ? "Tune Stream Config" : "Add Stream"}</h2>

            <form onSubmit={handleSubmit} className="stream-form">
              <label>
                Name
                <input
                  required
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Entrance Camera"
                />
              </label>

              <label>
                RTSP / Video URL
                <input
                  required
                  value={form.rtsp_url}
                  onChange={(event) => setForm((current) => ({ ...current, rtsp_url: event.target.value }))}
                />
              </label>

              <div className="config-section">
                <h3>Location</h3>
                <div className={`location-layout ${editingId ? "is-editing" : "is-creating"}`}>
                  <div className="location-form-pane">
                    <div className="location-search-shell">
                      <label>
                        Search Address / Place
                        <div className="location-search-row">
                          <input
                            type="search"
                            value={locationQuery}
                            placeholder="Search city, address, landmark..."
                            onChange={(event) => {
                              setLocationQuery(event.target.value);
                              setLocationSearchError("");
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                handleLocationSearch();
                              }
                            }}
                          />
                          <button
                            type="button"
                            className="btn tiny"
                            onClick={handleLocationSearch}
                            disabled={locationSearching}
                          >
                            {locationSearching ? "Searching..." : "Search"}
                          </button>
                          <button
                            type="button"
                            className="btn tiny ghost"
                            onClick={handleUseCurrentLocation}
                            disabled={locatingCurrent}
                          >
                            {locatingCurrent ? "Locating..." : "Use Current"}
                          </button>
                        </div>
                      </label>
                      {locationSearchError && <p className="error">{locationSearchError}</p>}
                      {locationResolvingPoint && (
                        <p className="muted">Resolving nearby labels for selected coordinates...</p>
                      )}
                      {locationSearchResults.length > 0 && (
                        <div className="location-search-results">
                          {locationSearchResults.map((result, index) => (
                            <button
                              key={`${result.lat}-${result.lon}-${index}`}
                              type="button"
                              className="location-search-result"
                              onClick={() => handleApplyLocationResult(result)}
                            >
                              <span className="location-result-title">{result.display_name}</span>
                              <div className="location-result-meta">
                                <small>
                                  {toFixedValue(result.lat, 5, "0.00000")},{" "}
                                  {toFixedValue(result.lon, 5, "0.00000")}
                                </small>
                                <span className={`location-result-source ${result.source || "search"}`}>
                                  {locationSourceLabel(result.source)}
                                </span>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <label>
                      Location Name
                      <input
                        value={form.location_name}
                        maxLength={LOCATION_NAME_MAX_LENGTH}
                        placeholder="Auto-filled from search, map, or current location"
                        onChange={(event) =>
                          setForm((current) => ({ ...current, location_name: event.target.value }))
                        }
                      />
                    </label>
                    <div className="row two-col">
                      <label>
                        Latitude
                        <input
                          type="number"
                          step="0.000001"
                          min="-90"
                          max="90"
                          value={form.latitude}
                          placeholder="37.774900"
                          onChange={(event) =>
                            setForm((current) => ({ ...current, latitude: event.target.value }))
                          }
                        />
                      </label>
                      <label>
                        Longitude
                        <input
                          type="number"
                          step="0.000001"
                          min="-180"
                          max="180"
                          value={form.longitude}
                          placeholder="-122.419400"
                          onChange={(event) =>
                            setForm((current) => ({ ...current, longitude: event.target.value }))
                          }
                        />
                      </label>
                    </div>
                    <div className="row camera-heading-controls">
                      <label className="camera-angle-control">
                        <div
                          ref={cameraAngleVisualRef}
                          className="camera-angle-visual"
                          role="group"
                          tabIndex={0}
                          aria-label={`Direction ${Math.round(formOrientationDeg)} degrees`}
                          onPointerDown={handleOrientationDialPointerDown}
                          onPointerMove={handleOrientationDialPointerMove}
                          onPointerUp={handleOrientationDialPointerUp}
                          onPointerCancel={handleOrientationDialPointerUp}
                          onKeyDown={handleOrientationDialKeyDown}
                        >
                          <svg
                            className="camera-angle-svg"
                            viewBox={`0 0 ${cameraAnglePreview.size} ${cameraAnglePreview.size}`}
                            aria-hidden="true"
                          >
                            <circle
                              className="camera-angle-ring"
                              cx={cameraAnglePreview.center}
                              cy={cameraAnglePreview.center}
                              r="66"
                            />
                            <path className="camera-angle-cone" d={cameraAnglePreview.conePath} />
                            <line
                              className="camera-angle-boundary"
                              x1={cameraAnglePreview.center}
                              y1={cameraAnglePreview.center}
                              x2={cameraAnglePreview.leftPoint.x}
                              y2={cameraAnglePreview.leftPoint.y}
                            />
                            <line
                              className="camera-angle-boundary"
                              x1={cameraAnglePreview.center}
                              y1={cameraAnglePreview.center}
                              x2={cameraAnglePreview.rightPoint.x}
                              y2={cameraAnglePreview.rightPoint.y}
                            />
                            <line
                              className="camera-angle-heading"
                              x1={cameraAnglePreview.center}
                              y1={cameraAnglePreview.center}
                              x2={cameraAnglePreview.headingPoint.x}
                              y2={cameraAnglePreview.headingPoint.y}
                            />
                            {cameraAnglePreview.groundReachPoint && (
                              <circle
                                className="camera-angle-ground-reach"
                                cx={cameraAnglePreview.groundReachPoint.x}
                                cy={cameraAnglePreview.groundReachPoint.y}
                                r="4.8"
                              />
                            )}
                            <text
                              className="camera-angle-north"
                              x={cameraAnglePreview.center}
                              y="18"
                              textAnchor="middle"
                            >
                              N
                            </text>
                            <circle
                              className="camera-angle-origin"
                              cx={cameraAnglePreview.center}
                              cy={cameraAnglePreview.center}
                              r="6"
                            />
                          </svg>
                          <input
                            type="range"
                            className="camera-tilt-slider-horizontal"
                            step={CAMERA_TILT_STEP}
                            min={CAMERA_TILT_MIN}
                            max={CAMERA_TILT_MAX}
                            value={formCameraTiltDeg}
                            aria-label="Camera tilt"
                            onPointerDown={(event) => event.stopPropagation()}
                            onChange={(event) =>
                              handleCameraViewChange("camera_tilt_deg", event.target.value)
                            }
                          />
                          <input
                            type="range"
                            className="camera-angle-slider-horizontal"
                            step="1"
                            min={CAMERA_VIEW_ANGLE_MIN}
                            max={CAMERA_VIEW_ANGLE_MAX}
                            value={formViewAngleDeg}
                            aria-label="View angle"
                            onPointerDown={(event) => event.stopPropagation()}
                            onChange={(event) =>
                              handleCameraViewChange("view_angle_deg", event.target.value)
                            }
                          />
                          <input
                            type="range"
                            className="camera-height-slider-vertical"
                            step={CAMERA_HEIGHT_STEP}
                            min={CAMERA_HEIGHT_MIN}
                            max={CAMERA_HEIGHT_MAX}
                            value={formCameraHeightM}
                            aria-label="Camera height"
                            onPointerDown={(event) => event.stopPropagation()}
                            onChange={(event) =>
                              handleCameraViewChange("camera_height_m", event.target.value)
                            }
                          />
                          <input
                            type="range"
                            className="camera-range-slider-vertical"
                            step={CAMERA_VIEW_DISTANCE_STEP}
                            min={CAMERA_VIEW_DISTANCE_MIN}
                            max={CAMERA_VIEW_DISTANCE_MAX}
                            value={formViewDistanceM}
                            aria-label="View range"
                            onPointerDown={(event) => event.stopPropagation()}
                            onChange={(event) =>
                              handleCameraViewChange("view_distance_m", event.target.value)
                            }
                          />
                        </div>
                        <div className="camera-angle-metrics">
                          <span>Dir {toFixedValue(formOrientationDeg, 0, "0")}deg</span>
                          <span>Angle {toFixedValue(formViewAngleDeg, 0, "0")}deg</span>
                          <span>Range {toFixedValue(formViewDistanceM, 0, "0")}m</span>
                          <span>
                            Tilt {toFixedValue(Math.abs(formCameraTiltDeg), 1, "0.0")}deg{" "}
                            {formCameraTiltDeg >= 0 ? "down" : "up"}
                          </span>
                          <span>Height {toFixedValue(formCameraHeightM, 1, "0.0")}m</span>
                          <span>
                            Ground{" "}
                            {formGroundReachM === null
                              ? "horizon"
                              : `${toFixedValue(formGroundReachM, 0, "0")}m`}
                          </span>
                        </div>
                      </label>
                    </div>
                    <div className="row map-row">
                      <button
                        type="button"
                        className="btn tiny ghost"
                        onClick={() => {
                          setForm((current) => ({
                            ...current,
                            location_name: "",
                            latitude: "",
                            longitude: "",
                          }));
                          setLocationSearchError("");
                          setLocationSearchResults([]);
                          setLocationQuery("");
                        }}
                      >
                        Clear Coordinates
                      </button>
                      <span className="muted">
                        Search, use current location, or click map to set camera point; adjust orientation, cone, tilt, and mount height.
                      </span>
                    </div>
                  </div>
                  <div className="location-map-pane">
                    <div className="stream-map-picker map-with-basemap">
                      <MapBasemapSelector value={mapBasemap} onChange={setMapBasemap} />
                      <MapContainer
                        center={mapCenter}
                        zoom={mapZoom}
                        scrollWheelZoom
                        className="stream-map-canvas"
                      >
                        <TileLayer {...mapTileLayerProps} />
                        <StreamMapClickCapture
                          onPick={handleMapPointSelection}
                        />
                        <StreamMapCenter
                          latitude={formLatitude}
                          longitude={formLongitude}
                          focusKey={selectedStreamId || "new-stream"}
                        />
                        {hasFormCoordinates && cameraViewPolygon && (
                          <Polygon
                            positions={cameraViewPolygon}
                            pathOptions={{
                              color: "#16f2b3",
                              fillColor: "#16f2b3",
                              fillOpacity: 0.22,
                              weight: 1.6,
                            }}
                          />
                        )}
                        {hasFormCoordinates && (
                          <Marker position={[formLatitude, formLongitude]} icon={cameraMarkerIcon}>
                            <Tooltip direction="top" offset={[0, -14]} opacity={0.9} permanent>
                              {(normalizeLocationName(form.location_name) || "Camera") +
                                ` · ${toFixedValue(formOrientationDeg, 0, "0")}°`}
                            </Tooltip>
                          </Marker>
                        )}
                      </MapContainer>
                    </div>
                  </div>
                </div>
              </div>

              <div className="config-section">
                <h3>Layers</h3>
                <div className="toggle-grid">
                  {TOGGLE_FIELDS.map((field) => (
                    <label className="checkbox-row" key={field.key}>
                      <input
                        type="checkbox"
                        checked={form[field.key]}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, [field.key]: event.target.checked }))
                        }
                      />
                      {field.label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="config-section">
                <h3>Processing</h3>
                <div className="slider-grid">
                  {SLIDER_FIELDS.map((field) => {
                    const bounds = NUMERIC_FIELDS[field.key];
                    return (
                      <label key={field.key}>
                        <span className="slider-label">
                          {field.label}
                          <strong>
                            {form[field.key]}
                            {field.unit}
                          </strong>
                        </span>
                        <input
                          type="range"
                          min={bounds.min}
                          max={bounds.max}
                          step={bounds.step}
                          value={form[field.key]}
                          onChange={(event) => handleSliderChange(field.key, event.target.value)}
                        />
                      </label>
                    );
                  })}
                </div>
              </div>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, is_active: event.target.checked }))
                  }
                />
                Start worker immediately
              </label>

              <div className="row">
                <button disabled={busy} type="submit" className="btn primary">
                  {editingId ? "Save Config" : "Create Stream"}
                </button>
                {editingId && (
                  <button disabled={busy} type="button" className="btn ghost" onClick={resetForm}>
                    Cancel Edit
                  </button>
                )}
              </div>
            </form>

            {notice && <p className="notice">{notice}</p>}
            {error && <p className="error">{error}</p>}

          </section>

          {selectedStream && (
            <section className="panel viewport-panel">
              <h2>Live Preview</h2>
              <p className="muted">Selected: {selectedStream.name}</p>
              <p className={`connection-badge ${statusClass(selectedStream)}`}>
                Connection: {statusLabel(selectedStream)}
                {selectedStream.last_error ? ` - ${selectedStream.last_error}` : ""}
              </p>

              <div className="canvas-shell">
                <canvas ref={canvasRef} className="preview-canvas" />
                <LivePerspectiveGridOverlay stream={configPreviewPerspectiveStream} />
              </div>

              <div className="stats-grid">
                <div>
                  <span className="label">FPS</span>
                  <strong>{latestStats.fps}</strong>
                </div>
                <div>
                  <span className="label">AVG MAG</span>
                  <strong>{latestStats.avg}</strong>
                </div>
                <div>
                  <span className="label">MAX MAG</span>
                  <strong>{latestStats.max}</strong>
                </div>
                <div>
                  <span className="label">VECTORS</span>
                  <strong>{latestStats.vectors}</strong>
                </div>
              </div>

              <section className="worker-log-section">
                <div className="worker-log-header">
                  <h3>Worker Activity Log</h3>
                  <div className="worker-log-meta">
                    <span className={`status ${workerLogStatus}`}>{workerLogStatus}</span>
                    {workerLogContainer && (
                      <span className="worker-log-container">{workerLogContainer}</span>
                    )}
                    {workerLogUpdatedAt && (
                      <span className="muted">
                        Updated {new Date(workerLogUpdatedAt).toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                </div>

                {workerLogLoading && <p className="muted">Loading worker logs...</p>}
                {workerLogError && <p className="error">{workerLogError}</p>}
                {workerLogs.length === 0 ? (
                  <p className="muted">No worker log lines available for this stream.</p>
                ) : (
                  <pre className="worker-log-output">{workerLogs.join("\n")}</pre>
                )}
              </section>
            </section>
          )}
        </main>
      ) : currentView === "live" ? (
        <main className="app-grid dashboard-only">
          <section className="panel live-route-panel" ref={liveRoutePanelRef}>
            <div className="live-toolbar">
              <div className="live-toolbar-actions">
                <div className="live-controls">
                  <label className="live-control live-control-name">
                    Name
                    <input
                      type="search"
                      value={liveNameFilter}
                      onChange={(event) => setLiveNameFilter(event.target.value)}
                      placeholder="Search stream name"
                    />
                  </label>
                  <label className="live-control">
                    Status
                    <select
                      value={liveStatusFilter}
                      onChange={(event) => setLiveStatusFilter(event.target.value)}
                    >
                      {LIVE_STATUS_FILTER_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {isLiveMapLayout ? (
                    <>
                      <label className="live-control">
                        Colors
                        <select
                          value={liveMapColorMetric}
                          onChange={(event) => setLiveMapColorMetric(event.target.value)}
                        >
                          {LIVE_MAP_COLOR_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="live-control live-control-layer-select">
                        <span>Layers</span>
                        <div className={`live-layer-multiselect ${liveMapLayersOpen ? "open" : ""}`}>
                          <button
                            type="button"
                            className="live-layer-multiselect-trigger"
                            onClick={() => setLiveMapLayersOpen((current) => !current)}
                          >
                            <span>{liveMapLayerSummary}</span>
                            <span className="live-layer-multiselect-caret">
                              {liveMapLayersOpen ? "▴" : "▾"}
                            </span>
                          </button>
                          {liveMapLayersOpen && (
                            <div className="live-layer-multiselect-menu">
                              {LIVE_MAP_LAYER_OPTIONS.map((option) => (
                                <label key={option.value} className="live-layer-option">
                                  <input
                                    type="checkbox"
                                    checked={liveMapLayers.includes(option.value)}
                                    disabled={
                                      liveMapLayers.length === 1 &&
                                      liveMapLayers.includes(option.value)
                                    }
                                    onChange={() => handleToggleLiveMapLayer(option.value)}
                                  />
                                  <span>{option.label}</span>
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <label className="live-control">
                        Sort
                        <select
                          value={liveSortField}
                          onChange={(event) => setLiveSortField(event.target.value)}
                        >
                          {LIVE_SORT_FIELD_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="live-control">
                        Order
                        <select
                          value={liveSortOrder}
                          onChange={(event) => setLiveSortOrder(event.target.value)}
                        >
                          <option value="asc">ASC</option>
                          <option value="desc">DESC</option>
                        </select>
                      </label>
                      {isLiveFramelessLayout && (
                        <div className="live-control live-control-fullscreen">
                          <span>View</span>
                          <button
                            type="button"
                            className="btn tiny ghost live-fullscreen-btn"
                            onClick={handleToggleLiveFullscreen}
                            disabled={!fullscreenSupported}
                          >
                            {isLivePanelFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
	                <div className="live-toolbar-right">
	                  {isLiveMapLayout && (
	                    <button
	                      type="button"
	                      className="btn tiny ghost"
	                      onClick={() => setLiveMapFitKey((current) => current + 1)}
	                      disabled={liveMapPoints.length === 0}
	                    >
	                      Fit Points
	                    </button>
	                  )}
	                  <div className="live-layout-group">
	                    <div className="live-layout-toggle" role="group" aria-label="Live overview layout">
	                      {LIVE_LAYOUT_OPTIONS.map((option) => (
	                        <button
	                          key={option.value}
	                          type="button"
	                          className={`btn tiny live-layout-btn ${liveLayout === option.value ? "primary active" : ""}`}
	                          onClick={() => setLiveLayout(option.value)}
	                        >
	                          <span className={`live-layout-icon ${option.value}`} aria-hidden="true" />
	                          <span>{option.label}</span>
	                        </button>
	                      ))}
	                      {selectedLiveStream && (
	                        <button
	                          type="button"
	                          className="btn tiny ghost live-layout-btn live-layout-clear"
	                          onClick={() => setSelectedStreamId(null)}
	                        >
	                          <span className="live-layout-icon clear" aria-hidden="true" />
	                          <span>Clear</span>
	                        </button>
	                      )}
	                    </div>
	                  </div>
	                </div>
	              </div>
	            </div>

            {error && <p className="error">{error}</p>}
            {!isLiveFramelessLayout && renderSelectedLiveSection()}
            {streams.length === 0 ? (
              <p className="muted">No streams configured yet.</p>
            ) : liveFilteredStreams.length === 0 ? (
              <p className="muted">No streams match the current filter.</p>
            ) : isLiveMapLayout ? (
              <section className="live-overview-map-section">
                <div className="live-overview-map-header">
                  <div>
                    <h3>Live Map View</h3>
                    <p className="muted">
                      Uses Name/Status filters. Click any map point to focus that stream in the overview.
                    </p>
                  </div>
                  <div className="live-map-focus">
                    <span className="live-map-focus-title">
                      {liveMapFocusStream ? liveMapFocusStream.stream.name : "No mapped stream selected"}
                    </span>
                    <div className="live-metrics live-map-focus-metrics">
                      <span>FPS {toFixedValue(liveMapFocusPayload?.fps, 1, "0.0")}</span>
                      <span>Vectors {liveMapFocusPayload?.vector_count ?? 0}</span>
                      <span>Avg {toFixedValue(liveMapFocusPayload?.avg_magnitude, 3, "0.000")}</span>
                      <span>Dir {toFixedValue(liveMapFocusPayload?.direction_degrees, 1, "0.0")}°</span>
                      <span>Align {toFixedValue(liveMapFocusDirectionCoherencePercent, 0, "0")}%</span>
                    </div>
                  </div>
                </div>
                <div className="live-overview-map-shell map-with-basemap">
                  {liveMapStreams.length === 0 ? (
                    <p className="muted">
                      No streams with valid coordinates match the current filters.
                    </p>
                  ) : (
                    <>
                      <MapBasemapSelector value={mapBasemap} onChange={setMapBasemap} />
                      <MapContainer
                        center={MAP_DEFAULT_CENTER}
                        zoom={MAP_DEFAULT_ZOOM}
                        scrollWheelZoom
                        className="live-overview-map-canvas"
                      >
                      <TileLayer {...mapTileLayerProps} />
                      <LiveOverviewMapViewport
                        points={liveMapPoints}
                        fitKey={liveMapFitKey}
                        singlePointZoom={MAP_LIVE_SINGLE_POINT_ZOOM}
                      />
		                      {liveMapStreams.map((entry) => {
		                        const {
		                          stream,
		                          payload,
		                          latitude,
		                          longitude,
		                          orientationDeg,
		                          colorValue,
		                        } = entry;
		                        const isSelected = selectedStreamId === stream.id;
		                        const directionCoherencePercent = Number.isFinite(
		                          Number(payload?.direction_coherence)
		                        )
                          ? Number(payload.direction_coherence) * 100
                          : 0;
                        const heatColor = getHeatColor(
                          colorValue,
                          liveMapColorMetric,
                          liveMapMetricRange.min,
                          liveMapMetricRange.max
                        );
                        const heatRadius = getHeatRadius(
                          colorValue,
                          liveMapMetricRange.min,
                          liveMapMetricRange.max
                        );

                        return (
                          <Fragment key={stream.id}>
                            {showLiveMapCones && (
                              <>
                                <Polygon
                                  positions={entry.cameraViewPolygon}
                                  pathOptions={{
                                    color: isSelected ? "#16f2b3" : "#4eb5dd",
                                    fillColor: isSelected ? "#16f2b3" : "#4eb5dd",
                                    fillOpacity: isSelected ? 0.2 : 0.12,
                                    weight: isSelected ? 1.7 : 1.2,
                                  }}
                                />
                                <Polyline
                                  positions={entry.cameraOrientationLine}
                                  pathOptions={{
                                    color: isSelected ? "#16f2b3" : "#6ec5e8",
                                    weight: isSelected ? 2.1 : 1.6,
                                    opacity: 0.9,
                                  }}
		                                />
		                              </>
		                            )}
		                            {showSingleStreamFlowDirection &&
		                              entry.flowDirectionPattern.length > 0 &&
		                              entry.flowDirectionPattern.map((segment) => (
		                                <Fragment key={`${stream.id}-flow-${segment.id}`}>
		                                  <Polyline
		                                    positions={segment.shaft}
		                                    pathOptions={{
		                                      color: "#f6e58d",
		                                      weight: isSelected ? 2.2 : 1.8,
		                                      opacity: entry.flowPatternOpacity,
		                                    }}
		                                  />
		                                  <Polyline
		                                    positions={segment.leftHead}
		                                    pathOptions={{
		                                      color: "#f6e58d",
		                                      weight: isSelected ? 1.8 : 1.5,
		                                      opacity: entry.flowPatternOpacity,
		                                    }}
		                                  />
		                                  <Polyline
		                                    positions={segment.rightHead}
		                                    pathOptions={{
		                                      color: "#f6e58d",
		                                      weight: isSelected ? 1.8 : 1.5,
		                                      opacity: entry.flowPatternOpacity,
		                                    }}
		                                  />
		                                </Fragment>
		                              ))}
		                            {showLiveMapMarkers && (
		                              <Marker
		                                position={[latitude, longitude]}
                                icon={cameraMarkerIcon}
                                eventHandlers={{
                                  click: () => setSelectedStreamId(stream.id),
                                }}
                              >
                                <Tooltip direction="top" offset={[0, -14]} opacity={0.9}>
                                  {stream.name}
                                </Tooltip>
                                <Popup>
                                  <div className="live-map-popup">
                                    <strong>{stream.name}</strong>
                                    <div className="live-map-popup-metrics">
                                      <span>FPS {toFixedValue(payload?.fps, 1, "0.0")}</span>
                                      <span>Vectors {payload?.vector_count ?? 0}</span>
                                      <span>Avg {toFixedValue(payload?.avg_magnitude, 3, "0.000")}</span>
                                      <span>Dir {toFixedValue(payload?.direction_degrees, 1, "0.0")}°</span>
                                      <span>
                                        Align {toFixedValue(directionCoherencePercent, 0, "0")}%
                                      </span>
                                    </div>
                                    <small>
                                      Cam {toFixedValue(orientationDeg, 1, "0.0")}° ·{" "}
                                      {normalizeLocationName(stream.location_name) ||
                                        `${toFixedValue(latitude, 4)}, ${toFixedValue(longitude, 4)}`}
                                    </small>
                                  </div>
                                </Popup>
                              </Marker>
                            )}
                            {showLiveMapHeatmap && (
                              <>
                                <CircleMarker
                                  center={[latitude, longitude]}
                                  radius={heatRadius * 2.7}
                                  pathOptions={{
                                    color: heatColor,
                                    fillColor: heatColor,
                                    fillOpacity: isSelected ? 0.13 : 0.09,
                                    weight: 0,
                                    opacity: 0,
                                  }}
                                  eventHandlers={{
                                    click: () => setSelectedStreamId(stream.id),
                                  }}
                                />
                                <CircleMarker
                                  center={[latitude, longitude]}
                                  radius={heatRadius * 1.85}
                                  pathOptions={{
                                    color: heatColor,
                                    fillColor: heatColor,
                                    fillOpacity: isSelected ? 0.2 : 0.14,
                                    weight: 0,
                                    opacity: 0,
                                  }}
                                  eventHandlers={{
                                    click: () => setSelectedStreamId(stream.id),
                                  }}
                                />
                                <CircleMarker
                                  center={[latitude, longitude]}
                                  radius={heatRadius}
                                  pathOptions={{
                                    color: heatColor,
                                    fillColor: heatColor,
                                    fillOpacity: isSelected ? 0.36 : 0.27,
                                    weight: isSelected ? 1.4 : 0.8,
                                    opacity: 0.62,
                                  }}
                                  eventHandlers={{
                                    click: () => setSelectedStreamId(stream.id),
                                  }}
                                >
                                  <Tooltip direction="top" opacity={0.95}>
                                    {`${stream.name} · ${liveMapColorLabel} ${formatLiveMetricValue(colorValue, liveMapColorMetric)}`}
                                  </Tooltip>
                                </CircleMarker>
                              </>
                            )}
                          </Fragment>
                        );
                      })}
                      </MapContainer>
                    </>
                  )}
                </div>
              </section>
            ) : (
              <>
                {livePrimaryStreams.length > 0 && (
                  <>
                    {liveLayout === "list" ? (
                      <div className="live-list">
                        {livePrimaryStreams.map((stream) => (
                          <div key={stream.id}>{renderLiveListRow(stream)}</div>
                        ))}
                      </div>
                    ) : liveLayout === "frameless" ? (
                      <div className="live-frameless-grid">
                        {liveFilteredSortedStreams.map((stream) => renderLiveFramelessTile(stream))}
                      </div>
                    ) : (
                      <div className="live-grid">
                        {livePrimaryStreams.map((stream) => (
                          <div key={stream.id}>{renderLiveCard(stream)}</div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </section>
        </main>
      ) : currentView === "dashboard" ? (
        <main className="app-grid dashboard-only">
          <section className="panel dashboard-route-panel">
            <div className="dashboard-toolbar">
              <h2>Vector Flow Overview</h2>
              <div className="dashboard-filters">
                <label className="dashboard-filter">
                  Time
                  <select
                    value={dashboardRange}
                    onChange={(event) => setDashboardRange(normalizeDashboardRange(event.target.value))}
                  >
                    {DASHBOARD_TIME_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            {error && <p className="error">{error}</p>}
            <p className="muted">
              {selectedStream
                ? `Showing dashboard for ${selectedStream.name}.`
                : "Showing dashboard for all streams."}
            </p>
            <iframe
              title="Vector Flow Grafana"
              src={grafanaUrl}
              className="grafana-frame grafana-route-frame"
              loading="lazy"
            />
          </section>
        </main>
      ) : currentView === "alerts" ? (
        <main className="app-grid dashboard-only">
          <section className="panel alerts-route-panel">
            <div className="alerts-toolbar">
              <div className="alerts-toolbar-main">
                <h2>Grafana Webhook Alerts</h2>
                <p className="muted">
                  Incoming alert notifications received by the API webhook endpoint.
                </p>
              </div>
              <div className="alerts-filter-row">
                <label className="alerts-filter-control">
                  Search
                  <input
                    type="search"
                    value={alertSearchQuery}
                    placeholder="Alert name, stream, fingerprint..."
                    onChange={(event) => setAlertSearchQuery(event.target.value)}
                  />
                </label>
                <label className="alerts-filter-control">
                  Status
                  <select
                    value={alertStatusFilter}
                    onChange={(event) => setAlertStatusFilter(event.target.value)}
                  >
                    {ALERT_STATUS_FILTER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="alerts-filter-control">
                  Severity
                  <select
                    value={alertSeverityFilter}
                    onChange={(event) => setAlertSeverityFilter(event.target.value)}
                  >
                    {ALERT_SEVERITY_FILTER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="checkbox-row alerts-filter-toggle">
                  <input
                    type="checkbox"
                    checked={hideResolvedAlerts}
                    onChange={(event) => setHideResolvedAlerts(event.target.checked)}
                  />
                  Hide Resolved
                </label>
              </div>
              <button
                type="button"
                className="btn tiny ghost"
                disabled={alertsLoading}
                onClick={() => {
                  setAlertsLoading(true);
                  Promise.all([loadAlertEvents(500), loadAlertGroupStates()])
                    .then(() => {
                      setAlertsError("");
                    })
                    .catch((err) => setAlertsError(err.message || "Unable to load webhook alerts."))
                    .finally(() => setAlertsLoading(false));
                }}
              >
                {alertsLoading ? "Refreshing..." : "Refresh"}
              </button>
            </div>

            {alertsError && <p className="error">{alertsError}</p>}
            {alertsLoading ? (
              <p className="muted">Loading webhook alerts...</p>
            ) : groupedAlertEvents.length === 0 ? (
              <p className="muted">No webhook alerts have been received yet.</p>
            ) : filteredAlertGroups.length === 0 ? (
              <p className="muted">No alert groups match the current filters.</p>
            ) : (
              <div className="alerts-groups">
                {filteredAlertGroups.map((group) => {
                  const statusBucket = alertGroupStatusBucket(group);
                  const severityBucket = alertGroupSeverityBucket(group);
                  return (
                    <article key={group.groupKey} className="alerts-group-card">
                      <header className="alerts-group-header">
                        <div className="alerts-group-title-wrap">
                          <h3>{group.latest?.alert_name || "Unnamed Alert"}</h3>
                          <p className="alerts-group-subtitle">
                            Fingerprint:{" "}
                            <span className="alerts-fingerprint">{group.fingerprint || "N/A"}</span>
                          </p>
                        </div>
                        <div className="alerts-group-icons">
                          <span
                            className="alerts-group-icon-chip"
                            title={`Latest status: ${alertGroupStatusLabel(statusBucket)}`}
                          >
                            <span
                              className={`alerts-group-icon status ${alertGroupStatusTone(statusBucket)}`}
                              aria-hidden="true"
                            />
                            <span>{alertGroupStatusLabel(statusBucket)}</span>
                          </span>
                          <span
                            className="alerts-group-icon-chip"
                            title={`Latest severity: ${alertSeverityLabel(severityBucket)}`}
                          >
                            <span
                              className={`alerts-group-icon severity ${alertSeverityTone(severityBucket)}`}
                              aria-hidden="true"
                            />
                            <span>{alertSeverityLabel(severityBucket)}</span>
                          </span>
                        </div>
                        <div className="alerts-group-menu-wrap">
                          <button
                            type="button"
                            className="btn tiny ghost alerts-group-menu-trigger"
                            aria-haspopup="menu"
                            aria-expanded={alertGroupMenuOpen === group.groupKey}
                            onClick={() =>
                              setAlertGroupMenuOpen((current) =>
                                current === group.groupKey ? null : group.groupKey
                              )
                            }
                            disabled={alertGroupActionBusyKey === group.groupKey}
                          >
                            ⋯
                          </button>
                          {alertGroupMenuOpen === group.groupKey && (
                            <div className="alerts-group-menu" role="menu">
                              <button
                                type="button"
                                className="alerts-group-menu-item"
                                role="menuitem"
                                disabled={alertGroupActionBusyKey === group.groupKey}
                                onClick={() =>
                                  handleSetAlertGroupResolved(group, !group.manualResolvedActive)
                                }
                              >
                                {group.manualResolvedActive ? "Reopen Group" : "Mark Resolved"}
                              </button>
                            </div>
                          )}
                        </div>
                      </header>

                      <div className="alerts-group-meta">
                        <span>{group.count} event{group.count === 1 ? "" : "s"}</span>
                        <span>Latest {formatTimestamp(group.latest?.received_at)}</span>
                      </div>

                      <div className="alerts-table-wrap">
                        <table className="alerts-table alerts-table-grouped">
                          <thead>
                            <tr>
                              <th>Received</th>
                              <th>Status</th>
                              <th>Severity</th>
                              <th>Stream</th>
                              <th>Summary</th>
                              <th>Starts</th>
                              <th>Ends</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.events.map((event) => {
                              const status = normalizeAlertStatus(
                                event.alert_status || event.notification_status
                              );
                              const severity = normalizeAlertSeverity(event.severity);
                              return (
                                <tr key={event.id}>
                                  <td>{formatTimestamp(event.received_at)}</td>
                                  <td>
                                    <span className={`status ${status || "unknown"}`}>
                                      {alertStatusLabel(status)}
                                    </span>
                                  </td>
                                  <td>
                                    <span className={`status ${alertSeverityTone(severity)}`}>
                                      {alertSeverityLabel(severity)}
                                    </span>
                                  </td>
                                  <td>{event.stream_name || "N/A"}</td>
                                  <td>{event.summary || event.description || "N/A"}</td>
                                  <td>{formatTimestamp(event.starts_at)}</td>
                                  <td>{formatTimestamp(event.ends_at)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </main>
      ) : (
        <main className="app-grid dashboard-only">
          <section className="panel settings-route-panel">
            <div className="settings-toolbar">
              <h2>System Settings</h2>
              <p className="muted">
                Global throttling for live frame publishing to keep Redis and UI stable.
              </p>
            </div>

            {error && <p className="error">{error}</p>}
            {notice && <p className="notice">{notice}</p>}

            <form className="settings-form" onSubmit={handleSystemSettingsSave}>
              <label>
                Live Preview FPS Cap
                <input
                  type="number"
                  min={0.5}
                  max={30}
                  step={0.5}
                  value={systemSettings.live_preview_fps}
                  onChange={(event) =>
                    setSystemSettings((current) => ({
                      ...current,
                      live_preview_fps: Number(event.target.value),
                    }))
                  }
                  required
                />
              </label>

              <label>
                Preview JPEG Quality
                <input
                  type="number"
                  min={30}
                  max={95}
                  step={1}
                  value={systemSettings.live_preview_jpeg_quality}
                  onChange={(event) =>
                    setSystemSettings((current) => ({
                      ...current,
                      live_preview_jpeg_quality: Number(event.target.value),
                    }))
                  }
                  required
                />
              </label>

	              <label>
	                Preview Max Width (px, 0 disables resizing)
	                <input
                  type="number"
                  min={0}
                  max={1920}
                  step={10}
                  value={systemSettings.live_preview_max_width}
                  onChange={(event) =>
                    setSystemSettings((current) => ({
                      ...current,
                      live_preview_max_width: Number(event.target.value),
                    }))
                  }
	                  required
	                />
	              </label>

	              <label>
	                Orientation Offset (deg)
	                <input
	                  type="number"
	                  min={-360}
	                  max={360}
	                  step={0.5}
	                  value={systemSettings.orientation_offset_deg}
	                  onChange={(event) =>
	                    setSystemSettings((current) => ({
	                      ...current,
	                      orientation_offset_deg: Number(event.target.value),
	                    }))
	                  }
	                  required
	                />
	              </label>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={systemSettings.restart_workers}
                  onChange={(event) =>
                    setSystemSettings((current) => ({
                      ...current,
                      restart_workers: event.target.checked,
                    }))
                  }
                />
                Restart active workers after save
              </label>

              <div className="row">
                <button
                  type="submit"
                  className="btn primary"
                  disabled={settingsSaving || settingsLoading}
                >
                  {settingsSaving ? "Saving..." : "Save System Settings"}
                </button>
              </div>
            </form>

	            <p className="muted settings-note">
	              Lower FPS and width reduce Redis traffic and prevent pub/sub output buffer overflows.
	              Orientation offset rotates live map direction arrows globally for camera alignment
	              calibration.
	            </p>
          </section>
        </main>
      )}
      {deactivationConfirmStream && (
        <div
          className="deactivation-confirm-backdrop"
          role="presentation"
          onClick={() => resolveConnectedDeactivationConfirm(false)}
        >
          <div
            className="deactivation-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="deactivation-confirm-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="deactivation-confirm-title">Deactivate connected stream?</h3>
            <p>
              <strong>{deactivationConfirmStream.name}</strong> is connected right now. Proceeding will
              stop processing and disconnect this stream.
            </p>
            <div className="deactivation-confirm-actions">
              <button
                type="button"
                className="btn tiny ghost"
                onClick={() => resolveConnectedDeactivationConfirm(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn tiny danger"
                onClick={() => resolveConnectedDeactivationConfirm(true)}
              >
                Proceed
              </button>
            </div>
          </div>
        </div>
      )}
      {deleteConfirmStream && (
        <div
          className="delete-confirm-backdrop"
          role="presentation"
          onClick={() => resolveDeleteConfirm(false)}
        >
          <div
            className="delete-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-confirm-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="delete-confirm-title">Delete stream permanently?</h3>
            <p className="delete-confirm-warning">This action cannot be undone.</p>
            <p>
              <strong>{deleteConfirmStream.name}</strong> will be removed from fleet configuration and
              its worker will be stopped.
            </p>
            <div className="delete-confirm-meta">
              <span className={`status ${deleteConfirmStream.statusClass}`}>
                {deleteConfirmStream.statusLabel}
              </span>
              <span className={`status ${deleteConfirmStream.isActive ? "active" : "inactive"}`}>
                {deleteConfirmStream.isActive ? "active" : "inactive"}
              </span>
            </div>
            <div className="delete-confirm-actions">
              <button
                type="button"
                className="btn tiny ghost"
                onClick={() => resolveDeleteConfirm(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn tiny danger"
                onClick={() => resolveDeleteConfirm(true)}
              >
                Delete Stream
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
