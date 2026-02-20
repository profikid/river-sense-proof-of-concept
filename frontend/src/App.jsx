import { useEffect, useMemo, useRef, useState } from "react";

const API_BASE = normalizeHttpBase(import.meta.env.VITE_API_URL || "http://localhost:8000");
const WS_BASE = toWsBase(API_BASE);
const GRAFANA_DASHBOARD_URL =
  import.meta.env.VITE_GRAFANA_DASHBOARD_URL ||
  "http://localhost:3000/d/vector-flow/vector-flow-overview";

const DEFAULT_FORM = {
  name: "",
  rtsp_url:
    "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
  grid_size: 16,
  threshold: 1.2,
  is_active: false,
};

function normalizeHttpBase(value) {
  return value.replace(/\/+$/, "");
}

function toWsBase(httpBase) {
  if (httpBase.startsWith("https://")) {
    return httpBase.replace("https://", "wss://");
  }
  return httpBase.replace("http://", "ws://");
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
      // Preserve default detail when body cannot be parsed.
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
  const [streams, setStreams] = useState([]);
  const [selectedStreamId, setSelectedStreamId] = useState(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [wsStatus, setWsStatus] = useState("disconnected");
  const [framePayload, setFramePayload] = useState(null);

  const canvasRef = useRef(null);
  const imageRef = useRef(new Image());

  const selectedStream = useMemo(
    () => streams.find((stream) => stream.id === selectedStreamId) || null,
    [selectedStreamId, streams]
  );

  const grafanaUrl = useMemo(() => {
    const base = `${GRAFANA_DASHBOARD_URL}?orgId=1&from=now-15m&to=now&refresh=5s&kiosk`;
    if (!selectedStreamId) {
      return `${base}&var-stream_id=All`;
    }
    return `${base}&var-stream_id=${encodeURIComponent(selectedStreamId)}`;
  }, [selectedStreamId]);

  const latestStats = framePayload
    ? {
        fps: framePayload.fps?.toFixed ? framePayload.fps.toFixed(1) : framePayload.fps,
        avg: framePayload.avg_magnitude?.toFixed
          ? framePayload.avg_magnitude.toFixed(3)
          : framePayload.avg_magnitude,
        max: framePayload.max_magnitude?.toFixed
          ? framePayload.max_magnitude.toFixed(3)
          : framePayload.max_magnitude,
        vectors: framePayload.vector_count ?? 0,
      }
    : {
        fps: "0.0",
        avg: "0.000",
        max: "0.000",
        vectors: 0,
      };

  const loadStreams = async () => {
    const data = await apiRequest("/streams");
    setStreams(data);

    if (data.length === 0) {
      setSelectedStreamId(null);
      return;
    }

    const stillExists = data.some((stream) => stream.id === selectedStreamId);
    if (!selectedStreamId || !stillExists) {
      setSelectedStreamId(data[0].id);
    }
  };

  useEffect(() => {
    const run = async () => {
      try {
        setError("");
        await loadStreams();
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
    if (!selectedStreamId) {
      setFramePayload(null);
      return;
    }

    let socket;
    let reconnectTimer;
    let closed = false;

    const connect = () => {
      if (closed) {
        return;
      }

      setWsStatus("connecting");
      socket = new WebSocket(`${WS_BASE}/ws/frames?stream_id=${encodeURIComponent(selectedStreamId)}`);

      socket.onopen = () => {
        setWsStatus("connected");
      };

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          setFramePayload(payload);
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
  }, [selectedStreamId]);

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

      const srcWidth = framePayload.width || img.width;
      const srcHeight = framePayload.height || img.height;
      const scaleX = displayWidth / srcWidth;
      const scaleY = displayHeight / srcHeight;

      ctx.strokeStyle = "rgba(13, 245, 180, 0.9)";
      ctx.fillStyle = "rgba(13, 245, 180, 0.9)";
      ctx.lineWidth = 1.2;

      for (const vector of framePayload.vectors || []) {
        const x = vector.x * scaleX;
        const y = vector.y * scaleY;
        const tx = (vector.x + vector.u * 4) * scaleX;
        const ty = (vector.y + vector.v * 4) * scaleY;

        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(tx, ty);
        ctx.stroke();

        const angle = Math.atan2(ty - y, tx - x);
        const head = 5;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx - head * Math.cos(angle - 0.45), ty - head * Math.sin(angle - 0.45));
        ctx.lineTo(tx - head * Math.cos(angle + 0.45), ty - head * Math.sin(angle + 0.45));
        ctx.closePath();
        ctx.fill();
      }
    };

    img.src = `data:image/jpeg;base64,${framePayload.frame_b64}`;
  }, [framePayload]);

  const resetForm = () => {
    setForm(DEFAULT_FORM);
    setEditingId(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    setBusy(true);
    setError("");
    setNotice("");

    const payload = {
      ...form,
      name: form.name.trim(),
      rtsp_url: form.rtsp_url.trim(),
      grid_size: Number(form.grid_size),
      threshold: Number(form.threshold),
    };

    try {
      if (editingId) {
        await apiRequest(`/streams/${editingId}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        setNotice("Stream updated.");
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
    setEditingId(stream.id);
    setForm({
      name: stream.name,
      rtsp_url: stream.rtsp_url,
      grid_size: stream.grid_size,
      threshold: stream.threshold,
      is_active: stream.is_active,
    });
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

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>Vector Flow Fleet Manager</h1>
          <p>Multi-stream optical flow orchestration with live overlays and metrics.</p>
        </div>
        <div className="header-meta">
          <span className={`pill ${wsStatus}`}>WebSocket: {wsStatus}</span>
          <span className="pill">API: {API_BASE}</span>
        </div>
      </header>

      <main className="app-grid">
        <section className="panel controls-panel">
          <h2>{editingId ? "Edit Stream" : "Add Stream"}</h2>

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

            <div className="row two-col">
              <label>
                Grid Size
                <input
                  type="number"
                  min="4"
                  max="128"
                  value={form.grid_size}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, grid_size: Number(event.target.value) }))
                  }
                />
              </label>

              <label>
                Threshold
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={form.threshold}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, threshold: Number(event.target.value) }))
                  }
                />
              </label>
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
                {editingId ? "Save Changes" : "Create Stream"}
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
                className={`stream-item ${selectedStreamId === stream.id ? "selected" : ""}`}
              >
                <button className="stream-title" onClick={() => setSelectedStreamId(stream.id)}>
                  <span>{stream.name}</span>
                  <span className={`status ${stream.is_active ? "active" : "inactive"}`}>
                    {stream.worker_status}
                  </span>
                </button>

                <div className="stream-meta">
                  <span>Grid {stream.grid_size}</span>
                  <span>Threshold {stream.threshold}</span>
                </div>

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

          <h2>Grafana</h2>
          <iframe
            title="Vector Flow Grafana"
            src={grafanaUrl}
            className="grafana-frame"
            loading="lazy"
          />
        </section>
      </main>
    </div>
  );
}
