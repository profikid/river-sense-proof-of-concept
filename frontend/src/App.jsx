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
  gradient_intensity: 1.0,
  show_feed: true,
  show_arrows: true,
  show_magnitude: false,
  show_trails: false,
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
  view_distance_m: 120,
  ...DEFAULT_STREAM_CONFIG,
  is_active: false,
};

const NUMERIC_FIELDS = {
  grid_size: { min: 4, max: 128, step: 1 },
  win_radius: { min: 2, max: 32, step: 1 },
  threshold: { min: 0, max: 100, step: 0.1 },
  arrow_scale: { min: 0.1, max: 25, step: 0.1 },
  arrow_opacity: { min: 0, max: 100, step: 1 },
  gradient_intensity: { min: 0.1, max: 5, step: 0.1 },
};

const SLIDER_FIELDS = [
  { key: "grid_size", label: "Grid Size", unit: "px" },
  { key: "win_radius", label: "Window Radius", unit: "px" },
  { key: "threshold", label: "Sensitivity Threshold", unit: "" },
  { key: "arrow_scale", label: "Arrow Scale", unit: "x" },
  { key: "arrow_opacity", label: "Arrow Opacity", unit: "%" },
  { key: "gradient_intensity", label: "Gradient Intensity", unit: "x" },
];

const TOGGLE_FIELDS = [
  { key: "show_feed", label: "Raw Feed" },
  { key: "show_arrows", label: "Flow Arrows" },
  { key: "show_magnitude", label: "Magnitude Map" },
  { key: "show_trails", label: "Motion Trails" },
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
];

const MAP_DEFAULT_CENTER = [37.0902, -95.7129];
const MAP_DEFAULT_ZOOM = 4;
const MAP_SELECTED_ZOOM = 13;
const MAP_LIVE_SINGLE_POINT_ZOOM = 19;
const CAMERA_ORIENTATION_MIN = 0;
const CAMERA_ORIENTATION_MAX = 359.9;
const CAMERA_VIEW_ANGLE_MIN = 5;
const CAMERA_VIEW_ANGLE_MAX = 170;
const CAMERA_VIEW_DISTANCE_MIN = 10;
const CAMERA_VIEW_DISTANCE_MAX = 5000;
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
  } else if (url.pathname.startsWith("/settings")) {
    view = "settings";
  }
  const selected = url.searchParams.get("stream");
  const dashboardRange = normalizeDashboardRange(url.searchParams.get("range"));
  return {
    view,
    selectedStreamId: selected && selected.trim() ? selected : null,
    dashboardRange,
  };
}

function buildLocation(view, selectedStreamId, dashboardRange) {
  const pathname =
    view === "dashboard"
      ? "/dashboard"
      : view === "live"
        ? "/live"
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
    view_distance_m: Number.isFinite(Number(stream.view_distance_m))
      ? Number(stream.view_distance_m)
      : DEFAULT_FORM.view_distance_m,
    is_active: !!stream.is_active,
    grid_size: stream.grid_size ?? DEFAULT_STREAM_CONFIG.grid_size,
    win_radius: stream.win_radius ?? DEFAULT_STREAM_CONFIG.win_radius,
    threshold: stream.threshold ?? DEFAULT_STREAM_CONFIG.threshold,
    arrow_scale: stream.arrow_scale ?? DEFAULT_STREAM_CONFIG.arrow_scale,
    arrow_opacity: stream.arrow_opacity ?? DEFAULT_STREAM_CONFIG.arrow_opacity,
    gradient_intensity: stream.gradient_intensity ?? DEFAULT_STREAM_CONFIG.gradient_intensity,
    show_feed: stream.show_feed ?? DEFAULT_STREAM_CONFIG.show_feed,
    show_arrows: stream.show_arrows ?? DEFAULT_STREAM_CONFIG.show_arrows,
    show_magnitude: stream.show_magnitude ?? DEFAULT_STREAM_CONFIG.show_magnitude,
    show_trails: stream.show_trails ?? DEFAULT_STREAM_CONFIG.show_trails,
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

function normalizeOrientation(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_FORM.orientation_deg;
  }
  const normalized = ((numeric % 360) + 360) % 360;
  return clampNumber(normalized, CAMERA_ORIENTATION_MIN, CAMERA_ORIENTATION_MAX);
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
  const viewDistance = parseBoundedNumber(
    form.view_distance_m,
    CAMERA_VIEW_DISTANCE_MIN,
    CAMERA_VIEW_DISTANCE_MAX,
    DEFAULT_FORM.view_distance_m
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
    view_distance_m: Number(viewDistance.toFixed(1)),
    is_active: !!form.is_active,
    grid_size: Number(form.grid_size),
    win_radius: Number(form.win_radius),
    threshold: Number(form.threshold),
    arrow_scale: Number(form.arrow_scale),
    arrow_opacity: Number(form.arrow_opacity),
    gradient_intensity: Number(form.gradient_intensity),
    show_feed: !!form.show_feed,
    show_arrows: !!form.show_arrows,
    show_magnitude: !!form.show_magnitude,
    show_trails: !!form.show_trails,
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

function toFixedValue(value, digits, fallback = "0.0") {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return numeric.toFixed(digits);
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
  const [liveNameFilter, setLiveNameFilter] = useState("");
  const [liveStatusFilter, setLiveStatusFilter] = useState("all");
  const [liveLayout, setLiveLayout] = useState("grid");
  const [liveSortField, setLiveSortField] = useState("name");
  const [liveSortOrder, setLiveSortOrder] = useState("asc");
  const [liveMapColorMetric, setLiveMapColorMetric] = useState("avg_magnitude");
  const [liveMapLayers, setLiveMapLayers] = useState([
    "camera_markers",
    "camera_cones",
    "heatmap",
  ]);
  const [liveMapLayersOpen, setLiveMapLayersOpen] = useState(false);
  const [liveMapFitKey, setLiveMapFitKey] = useState(0);
  const [locationQuery, setLocationQuery] = useState("");
  const [locationSearching, setLocationSearching] = useState(false);
  const [locationResolvingPoint, setLocationResolvingPoint] = useState(false);
  const [locatingCurrent, setLocatingCurrent] = useState(false);
  const [locationSearchError, setLocationSearchError] = useState("");
  const [locationSearchResults, setLocationSearchResults] = useState([]);

  const canvasRef = useRef(null);
  const imageRef = useRef(new Image());

  const selectedStream = useMemo(
    () => streams.find((stream) => stream.id === selectedStreamId) || null,
    [selectedStreamId, streams]
  );
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
    () =>
      parseBoundedNumber(
        form.view_distance_m,
        CAMERA_VIEW_DISTANCE_MIN,
        CAMERA_VIEW_DISTANCE_MAX,
        DEFAULT_FORM.view_distance_m
      ),
    [form.view_distance_m]
  );
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
    const nextLocation = buildLocation(nextView, selectedStreamId, dashboardRange);
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

  useEffect(() => {
    const syncFromLocation = () => {
      const locationState = parseLocationState();
      setCurrentView(locationState.view);
      setSelectedStreamId(locationState.selectedStreamId);
      setDashboardRange(locationState.dashboardRange);
    };

    window.addEventListener("popstate", syncFromLocation);
    return () => window.removeEventListener("popstate", syncFromLocation);
  }, []);

  useEffect(() => {
    const nextLocation = buildLocation(currentView, selectedStreamId, dashboardRange);
    const currentLocation = `${window.location.pathname}${window.location.search}`;
    if (nextLocation !== currentLocation) {
      window.history.replaceState(null, "", nextLocation);
    }
  }, [currentView, selectedStreamId, dashboardRange]);

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

  const handleSubmit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");

    const payload = buildPayload(form);

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

    let bounded = numeric;
    if (key === "orientation_deg") {
      bounded = normalizeOrientation(numeric);
    } else if (key === "view_angle_deg") {
      bounded = clampNumber(numeric, CAMERA_VIEW_ANGLE_MIN, CAMERA_VIEW_ANGLE_MAX);
    } else if (key === "view_distance_m") {
      bounded = clampNumber(numeric, CAMERA_VIEW_DISTANCE_MIN, CAMERA_VIEW_DISTANCE_MAX);
    }

    setForm((current) => ({ ...current, [key]: Number(bounded.toFixed(1)) }));
  };

  const handleSliderChange = (key, value) => {
    setForm((current) => ({ ...current, [key]: Number(value) }));
  };

  const handleToggle = async (stream) => {
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
    if (!window.confirm(`Delete stream "${stream.name}"?`)) {
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
    const nextLocation = buildLocation("config", stream.id, dashboardRange);
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
          restart_workers: !!systemSettings.restart_workers,
        }),
      });
      setNotice("System settings saved. Active workers were restarted to apply throttling.");
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

          return {
            stream,
            payload,
            latitude,
            longitude,
            orientationDeg,
            viewAngleDeg,
            viewDistanceM,
            colorValue,
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
    [liveFilteredStreams, liveFramesByStream, liveMapColorMetric]
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
  const showLiveMapMarkers = liveMapLayers.includes("camera_markers");
  const showLiveMapCones = liveMapLayers.includes("camera_cones");
  const showLiveMapHeatmap = liveMapLayers.includes("heatmap");
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
              Stream Config
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
              className={`btn tiny ${currentView === "settings" ? "primary active" : ""}`}
              onClick={() => switchView("settings")}
            >
              System Settings
            </button>
          </div>
        </div>
        <div className="header-controls">
          <label className="header-stream-select">
            Selected Stream
            <select
              value={selectedStreamId || ""}
              onChange={(event) => setSelectedStreamId(event.target.value || null)}
            >
              <option value="">All Streams</option>
              {streams.map((stream) => (
                <option key={stream.id} value={stream.id}>
                  {stream.name}
                </option>
              ))}
            </select>
          </label>
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
                <div className="row three-col">
                  <label>
                    Orientation (deg, 0=N)
                    <input
                      type="number"
                      step="1"
                      min={CAMERA_ORIENTATION_MIN}
                      max={CAMERA_ORIENTATION_MAX}
                      value={form.orientation_deg}
                      onChange={(event) =>
                        handleCameraViewChange("orientation_deg", event.target.value)
                      }
                    />
                  </label>
                  <label>
                    View Angle (deg)
                    <input
                      type="number"
                      step="1"
                      min={CAMERA_VIEW_ANGLE_MIN}
                      max={CAMERA_VIEW_ANGLE_MAX}
                      value={form.view_angle_deg}
                      onChange={(event) =>
                        handleCameraViewChange("view_angle_deg", event.target.value)
                      }
                    />
                  </label>
                  <label>
                    View Range (m)
                    <input
                      type="number"
                      step="5"
                      min={CAMERA_VIEW_DISTANCE_MIN}
                      max={CAMERA_VIEW_DISTANCE_MAX}
                      value={form.view_distance_m}
                      onChange={(event) =>
                        handleCameraViewChange("view_distance_m", event.target.value)
                      }
                    />
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
                    Search, use current location, or click map to set camera point; adjust orientation and cone.
                  </span>
                </div>
                <div className="stream-map-picker">
                  <MapContainer
                    center={mapCenter}
                    zoom={mapZoom}
                    scrollWheelZoom
                    className="stream-map-canvas"
                  >
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                      subdomains="abcd"
                      url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                    />
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

            <div className="section-title-row">
              <h2>Stream Fleet</h2>
              <button
                type="button"
                className="btn tiny ghost"
                disabled={!selectedStream}
                onClick={handleClearStreamSelection}
              >
                Clear Selection
              </button>
            </div>
            <div className="stream-list">
              {streams.length === 0 && <p className="muted">No streams configured yet.</p>}
              {streams.map((stream) => (
                <article
                  key={stream.id}
                  className={`stream-item ${statusClass(stream)} ${selectedStreamId === stream.id ? "selected" : ""}`}
                >
                  <button
                    type="button"
                    className="stream-title"
                    onClick={() => handleSelectStream(stream)}
                  >
                    <span>{stream.name}</span>
                    <span className={`status ${statusClass(stream)}`}>
                      {statusLabel(stream)}
                    </span>
                  </button>

                  <div className="stream-meta">
                    <span>Grid {stream.grid_size}</span>
                    <span>Win {stream.win_radius}</span>
                    <span>Thr {stream.threshold}</span>
                    <span>Cam {toFixedValue(stream.orientation_deg, 0, "0")}deg</span>
                    <span>Worker {stream.worker_status}</span>
                    <span>
                      {stream.latitude !== null &&
                        stream.longitude !== null &&
                        Number.isFinite(Number(stream.latitude)) &&
                        Number.isFinite(Number(stream.longitude))
                        ? `${normalizeLocationName(stream.location_name) || "Unnamed location"
                        } · Lat ${toFixedValue(stream.latitude, 4)} · Lon ${toFixedValue(stream.longitude, 4)}`
                        : "Location unset"}
                    </span>
                  </div>
                  {stream.last_error && <p className="stream-error">{stream.last_error}</p>}

                  <div className="row actions">
                    <button
                      disabled={busy}
                      className="btn tiny"
                      onClick={() => handleToggle(stream)}
                    >
                      {stream.is_active ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      disabled={busy}
                      className="btn tiny danger"
                      onClick={() => handleDelete(stream)}
                    >
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
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
          <section className="panel live-route-panel">
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
	                    <span className="live-layout-group-label">
	                      <span className="live-layout-group-label-icon" aria-hidden="true" />
	                      Layout + Selection
	                    </span>
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
                <div className="live-overview-map-shell">
                  {liveMapStreams.length === 0 ? (
                    <p className="muted">
                      No streams with valid coordinates match the current filters.
                    </p>
                  ) : (
                    <MapContainer
                      center={MAP_DEFAULT_CENTER}
                      zoom={MAP_DEFAULT_ZOOM}
                      scrollWheelZoom
                      className="live-overview-map-canvas"
                    >
                      <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                        subdomains="abcd"
                        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                      />
                      <LiveOverviewMapViewport
                        points={liveMapPoints}
                        fitKey={liveMapFitKey}
                        singlePointZoom={MAP_LIVE_SINGLE_POINT_ZOOM}
                      />
                      {liveMapStreams.map((entry) => {
                        const { stream, payload, latitude, longitude, orientationDeg, colorValue } = entry;
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
                    ) : (
                      <div className="live-grid">
                        {livePrimaryStreams.map((stream) => (
                          <div key={stream.id}>{renderLiveCard(stream)}</div>
                        ))}
                      </div>
                    )}
                  </>
                )}

                {selectedLiveStream && (
                  <section className="live-featured-section live-selected-split">
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
                        <div className="live-selected-map-shell">
                          <MapContainer
                            center={selectedLiveMapPoints[0]}
                            zoom={MAP_SELECTED_ZOOM}
                            scrollWheelZoom
                            className="live-selected-map-canvas"
                          >
                            <TileLayer
                              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                              subdomains="abcd"
                              url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                            />
                            <LiveOverviewMapViewport
                              points={selectedLiveMapPoints}
                              fitKey={selectedLiveStream.id}
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
            </p>
          </section>
        </main>
      )}
    </div>
  );
}
