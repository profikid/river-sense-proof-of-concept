import { useEffect, useMemo, useRef, useState } from "react";

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

const LIVE_SORT_FIELD_OPTIONS = [
  { value: "name", label: "Name" },
  { value: "fps", label: "FPS" },
  { value: "vector_count", label: "Vector Count" },
  { value: "direction_degrees", label: "Direction" },
  { value: "direction_coherence", label: "Direction Align" },
  { value: "avg_magnitude", label: "Avg Magnitude" },
  { value: "max_magnitude", label: "Max Magnitude" },
];

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

function firstConnectedStreamId(streams) {
  const connected = streams.find((stream) => {
    const status = String(stream.connection_status || "").toLowerCase();
    return status === "connected" || status === "ok";
  });
  return connected?.id || null;
}

function streamToForm(stream) {
  return {
    name: stream.name ?? "",
    rtsp_url: stream.rtsp_url ?? "",
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

function buildPayload(form) {
  return {
    name: form.name.trim(),
    rtsp_url: form.rtsp_url.trim(),
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
  const [wsStatus, setWsStatus] = useState("disconnected");
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
  const [liveStatusFilter, setLiveStatusFilter] = useState("all");
  const [liveSortField, setLiveSortField] = useState("name");
  const [liveSortOrder, setLiveSortOrder] = useState("asc");

  const canvasRef = useRef(null);
  const imageRef = useRef(new Image());

  const selectedStream = useMemo(
    () => streams.find((stream) => stream.id === selectedStreamId) || null,
    [selectedStreamId, streams]
  );

  const liveFrameCount = useMemo(
    () => Object.keys(liveFramesByStream).length,
    [liveFramesByStream]
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
      const locationView = parseLocationState().view;
      if (!currentSelectedId || data.length === 0) {
        if (data.length === 0) {
          return null;
        }
        if (locationView === "config") {
          return firstConnectedStreamId(data);
        }
        return null;
      }
      const stillExists = data.some((stream) => stream.id === currentSelectedId);
      if (stillExists) {
        return currentSelectedId;
      }
      if (locationView === "config") {
        return firstConnectedStreamId(data);
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

  const handleEdit = (stream) => {
    setSelectedStreamId(stream.id);
    setEditingId(stream.id);
    setForm(streamToForm(stream));
  };

  const handleTuneSelected = () => {
    if (!selectedStream) {
      return;
    }
    handleEdit(selectedStream);
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

  const liveFilteredSortedStreams = useMemo(() => {
    const filtered = streams.filter((stream) => {
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

    const metricValue = (stream) => {
      const payload = liveFramesByStream[stream.id];
      if (liveSortField === "name") {
        return null;
      }
      const raw =
        liveSortField === "fps"
          ? payload?.fps
          : liveSortField === "vector_count"
            ? payload?.vector_count
            : liveSortField === "direction_degrees"
              ? payload?.direction_degrees
              : liveSortField === "direction_coherence"
                ? payload?.direction_coherence
                : liveSortField === "avg_magnitude"
                  ? payload?.avg_magnitude
                  : payload?.max_magnitude;
      const numeric = Number(raw);
      return Number.isFinite(numeric) ? numeric : null;
    };

    return [...filtered].sort((left, right) => {
      if (liveSortField === "name") {
        const leftName = String(left.name || "");
        const rightName = String(right.name || "");
        return liveSortOrder === "asc"
          ? leftName.localeCompare(rightName)
          : rightName.localeCompare(leftName);
      }

      const leftMetric = metricValue(left);
      const rightMetric = metricValue(right);
      if (leftMetric === null && rightMetric === null) {
        return String(left.name || "").localeCompare(String(right.name || ""));
      }
      if (leftMetric === null) {
        return 1;
      }
      if (rightMetric === null) {
        return -1;
      }
      if (leftMetric === rightMetric) {
        return String(left.name || "").localeCompare(String(right.name || ""));
      }
      return liveSortOrder === "asc"
        ? leftMetric - rightMetric
        : rightMetric - leftMetric;
    });
  }, [streams, liveFramesByStream, liveStatusFilter, liveSortField, liveSortOrder]);

  const selectedLiveStream = selectedStreamId
    ? liveFilteredSortedStreams.find((stream) => stream.id === selectedStreamId) || null
    : null;
  const liveGridStreams = selectedLiveStream
    ? liveFilteredSortedStreams.filter((stream) => stream.id !== selectedLiveStream.id)
    : liveFilteredSortedStreams;

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
        <div className="header-meta">
          <span className={`pill ${wsStatus}`}>WebSocket: {wsStatus}</span>
          <span className="pill">API: {API_BASE}</span>
          {currentView === "live" && <span className="pill">Live Frames: {liveFrameCount}</span>}
          <span className="pill">Selected: {selectedStream?.name || "All streams"}</span>
        </div>
      </header>

      {currentView === "config" ? (
        <main className="app-grid">
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

            <h2>Stream Fleet</h2>
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
                    onClick={() => setSelectedStreamId(stream.id)}
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
                    <span>Worker {stream.worker_status}</span>
                  </div>
                  {stream.last_error && <p className="stream-error">{stream.last_error}</p>}

                  <div className="row actions">
                    <button disabled={busy} className="btn tiny" onClick={() => handleEdit(stream)}>
                      Edit
                    </button>
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

          <section className="panel viewport-panel">
            <h2>Live Preview</h2>
            <p className="muted">
              {selectedStream
                ? `Selected: ${selectedStream.name}`
                : "Select a stream to view its live frame feed."}
            </p>
            {selectedStream && (
              <p className={`connection-badge ${statusClass(selectedStream)}`}>
                Connection: {statusLabel(selectedStream)}
                {selectedStream.last_error ? ` - ${selectedStream.last_error}` : ""}
              </p>
            )}

            <div className="row">
              <button
                type="button"
                className="btn tiny"
                disabled={!selectedStream || busy}
                onClick={handleTuneSelected}
              >
                Tune Selected Stream
              </button>
            </div>

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
              {!selectedStream ? (
                <p className="muted">Select a stream to inspect worker activity.</p>
              ) : workerLogs.length === 0 ? (
                <p className="muted">No worker log lines available for this stream.</p>
              ) : (
                <pre className="worker-log-output">{workerLogs.join("\n")}</pre>
              )}
            </section>
          </section>
        </main>
      ) : currentView === "live" ? (
        <main className="app-grid dashboard-only">
          <section className="panel live-route-panel">
            <div className="live-toolbar">
              <div>
                <h2>Live Stream Overview</h2>
                <p className="muted">
                  {selectedLiveStream
                    ? "Other streams stay in the grid. Selected stream is shown larger below."
                    : "Latest frame for every stream in one grid. Use filters and sorting to inspect flow faster."}
                </p>
              </div>
              <div className="live-toolbar-actions">
                <div className="live-controls">
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
                </div>
                {selectedLiveStream && (
                  <button
                    type="button"
                    className="btn tiny ghost"
                    onClick={() => setSelectedStreamId(null)}
                  >
                    Clear Selection
                  </button>
                )}
              </div>
            </div>

            {error && <p className="error">{error}</p>}
            {streams.length === 0 ? (
              <p className="muted">No streams configured yet.</p>
            ) : liveFilteredSortedStreams.length === 0 ? (
              <p className="muted">No streams match the current filter.</p>
            ) : (
              <>
                {liveGridStreams.length > 0 && (
                  <div className="live-grid">
                    {liveGridStreams.map((stream) => (
                      <div key={stream.id}>{renderLiveCard(stream)}</div>
                    ))}
                  </div>
                )}

                {selectedLiveStream && (
                  <section className="live-featured-section">
                    <h3>Selected Stream</h3>
                    {renderLiveCard(selectedLiveStream, { featured: true })}
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
                  Stream
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
