import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Activity, 
  Settings, 
  Camera, 
  Maximize2, 
  Layers, 
  Wind, 
  BarChart3, 
  Clock,
  ChevronRight,
  Zap
} from 'lucide-react';

const App = () => {
  // State Management
  const [running, setRunning] = useState(false);
  const [fps, setFps] = useState(0);
  const [stats, setStats] = useState({
    vectors: 0,
    maxMag: '0.0',
    avgMag: '0.0',
    domDir: '—',
    coverage: '0%'
  });

  const [opts, setOpts] = useState({
    showFeed: true,
    showArrows: true,
    showMagnitude: false,
    showTrails: false,
    gridSize: 16,
    winRadius: 8,
    threshold: 1.2,
    arrowScale: 4,
    arrowOpacity: 90,
    gradientIntensity: 1.0
  });

  // Refs for performance-critical objects
  const videoRef = useRef(null);
  const bgCanvasRef = useRef(null);
  const flowCanvasRef = useRef(null);
  const procCanvasRef = useRef(null);
  const trailCanvasRef = useRef(null);
  const histCanvasRef = useRef(null);
  
  const prevGrayRef = useRef(null);
  const magHistoryRef = useRef(new Array(60).fill(0));
  const frameCountRef = useRef(0);
  const lastTimeRef = useRef(performance.now());
  const requestRef = useRef();

  // Color Mapping Utility: Returns [r, g, b] based on magnitude
  const getIntensityColor = (mag) => {
    // Normalizing magnitude: 0 to 15 is the typical active range
    const n = Math.min(mag / 15, 1);
    
    // Gradient: Cyan (0.0) -> Blue (0.3) -> Purple (0.6) -> Red (1.0)
    let r, g, b;
    if (n < 0.33) {
      // Cyan to Blue
      r = 0;
      g = 255 * (1 - n * 3);
      b = 255;
    } else if (n < 0.66) {
      // Blue to Purple
      r = 255 * (n - 0.33) * 3;
      g = 0;
      b = 255;
    } else {
      // Purple to Red
      r = 255;
      g = 0;
      b = 255 * (1 - (n - 0.66) * 3);
    }
    return [Math.round(r), Math.round(g), Math.round(b)];
  };

  const initCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: 1280, height: 720, facingMode: 'user' }, 
        audio: false 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current.play();
          setRunning(true);
          resize();
        };
      }
    } catch (err) {
      console.error("Camera access denied:", err);
    }
  };

  const resize = useCallback(() => {
    const video = videoRef.current;
    const bg = bgCanvasRef.current;
    const flow = flowCanvasRef.current;
    const proc = procCanvasRef.current;

    if (!video || !bg) return;

    const W = bg.parentElement.clientWidth;
    const H = bg.parentElement.clientHeight;

    bg.width = W; bg.height = H;
    flow.width = W; flow.height = H;
    
    proc.width = video.videoWidth || 640;
    proc.height = video.videoHeight || 480;

    if (trailCanvasRef.current) {
      trailCanvasRef.current.width = W;
      trailCanvasRef.current.height = H;
    }
  }, []);

  useEffect(() => {
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [resize]);

  const computeFlow = (prev, curr, W, H) => {
    const { gridSize, winRadius, threshold } = opts;
    const vectors = [];

    const Ix = new Float32Array(W * H);
    const Iy = new Float32Array(W * H);
    const It = new Float32Array(W * H);

    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        Ix[i] = (curr[y * W + x + 1] - curr[y * W + x - 1]) / 2;
        Iy[i] = (curr[(y + 1) * W + x] - curr[(y - 1) * W + x]) / 2;
        It[i] = curr[i] - prev[i];
      }
    }

    const half = Math.floor(gridSize / 2);
    for (let gy = half; gy < H - half; gy += gridSize) {
      for (let gx = half; gx < W - half; gx += gridSize) {
        let sxx = 0, syy = 0, sxy = 0, sxt = 0, syt = 0;
        
        for (let dy = -winRadius; dy <= winRadius; dy++) {
          const ny = gy + dy;
          if (ny < 0 || ny >= H) continue;
          for (let dx = -winRadius; dx <= winRadius; dx++) {
            const nx = gx + dx;
            if (nx < 0 || nx >= W) continue;
            const idx = ny * W + nx;
            const ix = Ix[idx], iy = Iy[idx], it = It[idx];
            sxx += ix * ix; syy += iy * iy; sxy += ix * iy;
            sxt += ix * it; syt += iy * it;
          }
        }

        const det = sxx * syy - sxy * sxy;
        if (Math.abs(det) < 1e-6) continue;

        const u = (syy * (-sxt) - sxy * (-syt)) / det;
        const v = (sxx * (-syt) - sxy * (-sxt)) / det;
        const mag = Math.sqrt(u * u + v * v);

        if (mag > threshold && mag < 50) {
          vectors.push({ x: gx, y: gy, u, v, mag });
        }
      }
    }
    return vectors;
  };

  const drawArrow = (ctx, x, y, u, v, mag, alpha) => {
    const scale = opts.arrowScale;
    const ex = x + u * scale;
    const ey = y + v * scale;
    
    // Get color based on intensity
    const [r, g, b] = getIntensityColor(mag);
    const a = (opts.arrowOpacity / 100) * alpha;

    ctx.strokeStyle = `rgba(${r},${g},${b},${a})`;
    ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
    ctx.lineWidth = Math.max(1, Math.min(3, mag / 4));

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(ex, ey);
    ctx.stroke();

    const angle = Math.atan2(ey - y, ex - x);
    const hw = Math.max(3, Math.min(8, mag / 2));
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - hw * Math.cos(angle - 0.4), ey - hw * Math.sin(angle - 0.4));
    ctx.lineTo(ex - hw * Math.cos(angle + 0.4), ey - hw * Math.sin(angle + 0.4));
    ctx.closePath();
    ctx.fill();
  };

  const drawGraph = useCallback(() => {
    const canvas = histCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    const history = magHistoryRef.current;
    
    ctx.clearRect(0, 0, W, H);
    const max = Math.max(...history, 1);
    
    ctx.strokeStyle = 'rgba(26, 64, 80, 0.3)';
    ctx.lineWidth = 1;
    for(let i=1; i<4; i++) {
        const y = (i/4) * H;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // Graph itself uses the current average magnitude's color
    const avg = history[history.length - 1] || 0;
    const [r, g, b] = getIntensityColor(avg);
    ctx.strokeStyle = `rgb(${r},${g},${b})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    history.forEach((v, i) => {
      const x = (i / (history.length - 1)) * W;
      const y = H - (v / max) * H * 0.8 - 5;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, []);

  const loop = useCallback((time) => {
    if (!running) return;

    frameCountRef.current++;
    if (time - lastTimeRef.current >= 500) {
      setFps(Math.round(frameCountRef.current * 1000 / (time - lastTimeRef.current)));
      frameCountRef.current = 0;
      lastTimeRef.current = time;
    }

    const bgCtx = bgCanvasRef.current?.getContext('2d');
    const flowCtx = flowCanvasRef.current?.getContext('2d');
    const procCtx = procCanvasRef.current?.getContext('2d', { willReadFrequently: true });
    
    if (!bgCtx || !flowCtx || !procCtx) {
      requestRef.current = requestAnimationFrame(loop);
      return;
    }

    const W = procCanvasRef.current.width;
    const H = procCanvasRef.current.height;
    const dW = bgCanvasRef.current.width;
    const dH = bgCanvasRef.current.height;
    const sX = dW / W;
    const sY = dH / H;

    procCtx.drawImage(videoRef.current, 0, 0, W, H);
    const imageData = procCtx.getImageData(0, 0, W, H);
    const d = imageData.data;
    const currGray = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      currGray[i] = 0.299 * d[i*4] + 0.587 * d[i*4+1] + 0.114 * d[i*4+2];
    }

    bgCtx.fillStyle = '#030609';
    bgCtx.fillRect(0, 0, dW, dH);
    if (opts.showFeed) {
      bgCtx.save();
      bgCtx.scale(-1, 1);
      bgCtx.translate(-dW, 0);
      bgCtx.globalAlpha = 0.6;
      bgCtx.drawImage(videoRef.current, 0, 0, dW, dH);
      bgCtx.restore();
    }

    flowCtx.clearRect(0, 0, dW, dH);
    if (prevGrayRef.current && prevGrayRef.current.length === currGray.length) {
      const vectors = computeFlow(prevGrayRef.current, currGray, W, H);
      
      if (opts.showTrails) {
        if (!trailCanvasRef.current) {
          trailCanvasRef.current = document.createElement('canvas');
          trailCanvasRef.current.width = dW;
          trailCanvasRef.current.height = dH;
        }
        const tCtx = trailCanvasRef.current.getContext('2d');
        tCtx.fillStyle = 'rgba(3,6,9,0.12)';
        tCtx.fillRect(0, 0, dW, dH);
        vectors.forEach(v => drawArrow(tCtx, dW - v.x*sX, v.y*sY, -v.u*sX, v.v*sY, v.mag, 0.4));
        flowCtx.drawImage(trailCanvasRef.current, 0, 0);
      }

      if (opts.showMagnitude) {
        vectors.forEach(v => {
          const [r, g, b] = getIntensityColor(v.mag);
          const grd = flowCtx.createRadialGradient(dW - v.x*sX, v.y*sY, 0, dW - v.x*sX, v.y*sY, opts.gridSize*sX * 1.5);
          grd.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${Math.min(0.5, v.mag/8)})`);
          grd.addColorStop(1, 'transparent');
          flowCtx.fillStyle = grd;
          flowCtx.fillRect(dW - (v.x+opts.gridSize)*sX*2, (v.y-opts.gridSize)*sY*2, opts.gridSize*4*sX, opts.gridSize*4*sY);
        });
      }

      if (opts.showArrows) {
        vectors.forEach(v => drawArrow(flowCtx, dW - v.x*sX, v.y*sY, -v.u*sX, v.v*sY, v.mag, 1.0));
      }

      if (vectors.length > 0) {
        const mags = vectors.map(v => v.mag);
        const avg = mags.reduce((a,b) => a+b, 0) / vectors.length;
        const max = Math.max(...mags);
        const avgU = vectors.reduce((a,b) => a+b.u, 0) / vectors.length;
        const avgV = vectors.reduce((a,b) => a+b.v, 0) / vectors.length;
        const angle = Math.atan2(avgV, avgU) * 180 / Math.PI;
        const dirs = ['→','↘','↓','↙','←','↖','↑','↗'];
        const dir = dirs[Math.round((angle + 180) / 45) % 8];

        setStats({
          vectors: vectors.length,
          maxMag: max.toFixed(1),
          avgMag: avg.toFixed(1),
          domDir: dir,
          coverage: Math.round(vectors.length / ((W*H)/(opts.gridSize**2)) * 100) + '%'
        });

        magHistoryRef.current.push(avg);
        if (magHistoryRef.current.length > 60) magHistoryRef.current.shift();
        drawGraph();
      }
    }

    prevGrayRef.current = currGray;
    requestRef.current = requestAnimationFrame(loop);
  }, [running, opts, drawGraph]);

  useEffect(() => {
    if (running) {
      requestRef.current = requestAnimationFrame(loop);
    }
    return () => cancelAnimationFrame(requestRef.current);
  }, [running, loop]);

  const applyPreset = (type) => {
    const presets = {
      sparse: { gridSize: 32, winRadius: 12, threshold: 2.5, arrowScale: 8 },
      dense: { gridSize: 8, winRadius: 5, threshold: 0.6, arrowScale: 3 },
      sensitive: { gridSize: 16, winRadius: 10, threshold: 0.2, arrowScale: 10 }
    };
    setOpts(prev => ({ ...prev, ...presets[type] }));
  };

  return (
    <div className="flex flex-col h-screen bg-[#030609] text-[#7ecfc0] font-mono select-none overflow-hidden">
      {/* Scanline Overlay */}
      <div className="fixed inset-0 pointer-events-none z-50 opacity-10 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_2px,3px_100%]" />

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 bg-[#070d12] border-b border-[#0f2a35] relative">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-[#00ffe0] animate-pulse shadow-[0_0_10px_#00ffe0]" />
          <h1 className="text-sm font-black tracking-[0.3em] text-[#00ffe0]">VECTOR FLOW</h1>
        </div>
        
        <div className="flex gap-8 text-[10px] tracking-widest text-[#1a4050]">
          <div className="flex flex-col items-center">
            <span className="text-[#00ffe0] text-sm font-bold">{fps}</span>
            <span>FPS</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="text-[#00ffe0] text-sm font-bold">{stats.vectors}</span>
            <span>VECTORS</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="text-[#00ffe0] text-sm font-bold">{stats.maxMag}</span>
            <span>MAX MAG</span>
          </div>
        </div>
      </header>

      {/* Main UI */}
      <main className="flex-1 flex overflow-hidden">
        {/* Viewport */}
        <div className="flex-1 relative bg-black overflow-hidden border-r border-[#0f2a35]">
          <video ref={videoRef} className="hidden" playsInline muted />
          <canvas ref={bgCanvasRef} className="absolute inset-0 w-full h-full" />
          <canvas ref={flowCanvasRef} className="absolute inset-0 w-full h-full mix-blend-screen" />
          <canvas ref={procCanvasRef} className="hidden" />

          {/* HUD Elements */}
          <div className="absolute top-4 left-4 w-6 h-6 border-t-2 border-l-2 border-[#00ffe0]" />
          <div className="absolute top-4 right-4 w-6 h-6 border-t-2 border-r-2 border-[#00ffe0]" />
          <div className="absolute bottom-4 left-4 w-6 h-6 border-b-2 border-l-2 border-[#00ffe0]" />
          <div className="absolute bottom-4 right-4 w-6 h-6 border-b-2 border-r-2 border-[#00ffe0]" />
          
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20">
            <div className="w-10 h-[1px] bg-[#00ffe0]" />
            <div className="h-10 w-[1px] bg-[#00ffe0]" />
          </div>

          {!running && (
            <div className="absolute inset-0 z-40 bg-[#030609]/90 flex flex-col items-center justify-center gap-6 text-center px-4">
              <Zap className="w-12 h-12 text-[#00ffe0] animate-pulse" />
              <div>
                <h2 className="text-xl font-bold tracking-[0.4em] text-[#00ffe0] mb-2 uppercase">L-K Gradient Sensor</h2>
                <p className="text-xs text-[#1a4050] max-w-xs leading-relaxed uppercase tracking-widest">
                  Real-time optical flow estimation using Lucas-Kanade differential methods.
                </p>
              </div>
              <button 
                onClick={initCamera}
                className="px-10 py-3 border border-[#00ffe0] text-[#00ffe0] text-xs font-bold tracking-[0.3em] hover:bg-[#00ffe0]/10 transition-all shadow-[0_0_30px_rgba(0,255,224,0.1)]"
              >
                BOOT ANALYZER
              </button>
            </div>
          )}
        </div>

        {/* Sidebar Controls */}
        <div className="w-64 bg-[#070d12] overflow-y-auto border-l border-[#0f2a35]">
          {/* Layers Section */}
          <div className="p-4 border-b border-[#0f2a35]">
            <div className="flex items-center gap-2 mb-4">
              <Layers className="w-3 h-3 text-[#1a4050]" />
              <span className="text-[9px] tracking-[0.2em] font-bold text-[#1a4050]">LAYERS</span>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {[
                { label: 'RAW FEED', key: 'showFeed', icon: Camera },
                { label: 'FLOW ARROWS', key: 'showArrows', icon: Wind },
                { label: 'MAGNITUDE MAP', key: 'showMagnitude', icon: Maximize2 },
                { label: 'MOTION TRAILS', key: 'showTrails', icon: Clock }
              ].map(item => (
                <button
                  key={item.key}
                  onClick={() => setOpts(o => ({...o, [item.key]: !o[item.key]}))}
                  className={`flex items-center justify-between px-3 py-2 text-[10px] tracking-widest border border-[#0f2a35] transition-all ${
                    opts[item.key] ? 'bg-[#00ffe0]/10 border-[#00ffe0] text-[#00ffe0]' : 'text-[#1a4050] hover:text-[#7ecfc0]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <item.icon className="w-3 h-3" />
                    {item.label}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Magnitude Legend */}
          <div className="p-4 border-b border-[#0f2a35]">
            <div className="text-[9px] tracking-[0.2em] font-bold text-[#1a4050] mb-3 uppercase">Magnitude Spectrum</div>
            <div className="h-3 w-full rounded bg-gradient-to-r from-cyan-400 via-blue-500 via-purple-500 to-red-500 mb-2" />
            <div className="flex justify-between text-[8px] text-[#1a4050]">
              <span>STAGNANT</span>
              <span>VOLATILE</span>
            </div>
          </div>

          {/* Parameters Section */}
          <div className="p-4 border-b border-[#0f2a35]">
            <div className="flex items-center gap-2 mb-4">
              <Settings className="w-3 h-3 text-[#1a4050]" />
              <span className="text-[9px] tracking-[0.2em] font-bold text-[#1a4050]">SETTINGS</span>
            </div>
            
            <div className="space-y-4">
              {[
                { label: 'GRID STEP', key: 'gridSize', min: 8, max: 48, step: 4, unit: 'px' },
                { label: 'WINDOW', key: 'winRadius', min: 4, max: 20, step: 1, unit: '' },
                { label: 'SENSITIVITY', key: 'threshold', min: 0.1, max: 5, step: 0.1, unit: '' },
                { label: 'VECTOR SCALE', key: 'arrowScale', min: 1, max: 15, step: 0.5, unit: 'x' }
              ].map(p => (
                <div key={p.key} className="space-y-2">
                  <div className="flex justify-between text-[10px] tracking-tighter">
                    <span className="text-[#1a4050]">{p.label}</span>
                    <span className="text-[#00ffe0]">{opts[p.key]}{p.unit}</span>
                  </div>
                  <input 
                    type="range"
                    min={p.min} max={p.max} step={p.step}
                    value={opts[p.key]}
                    onChange={(e) => setOpts(o => ({...o, [p.key]: parseFloat(e.target.value)}))}
                    className="w-full h-1 bg-[#0f2a35] appearance-none cursor-pointer accent-[#00ffe0]"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Analytics Section */}
          <div className="p-4 border-b border-[#0f2a35]">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="w-3 h-3 text-[#1a4050]" />
              <span className="text-[9px] tracking-[0.2em] font-bold text-[#1a4050]">ANALYTICS</span>
            </div>
            
            <div className="grid grid-cols-2 gap-2 mb-4">
              <div className="bg-[#030609] p-3 border border-[#0f2a35] text-center">
                <span className="block text-lg font-bold text-[#00ffe0]">{stats.avgMag}</span>
                <span className="text-[7px] text-[#1a4050] tracking-widest uppercase">Avg Intensity</span>
              </div>
              <div className="bg-[#030609] p-3 border border-[#0f2a35] text-center">
                <span className="block text-lg font-bold text-[#00ffe0]">{stats.domDir}</span>
                <span className="text-[7px] text-[#1a4050] tracking-widest uppercase">Dom Dir</span>
              </div>
            </div>
            <div className="text-[9px] text-[#1a4050] mb-2 uppercase tracking-widest">Temporal Flow (Avg Mag)</div>
            <canvas ref={histCanvasRef} height={60} className="w-full border-t border-[#0f2a35] pt-2" />
          </div>

          {/* Presets */}
          <div className="p-4">
            <div className="text-[9px] tracking-[0.2em] font-bold text-[#1a4050] mb-3 uppercase">Presets</div>
            <div className="space-y-2">
              {['sparse', 'dense', 'sensitive'].map(p => (
                <button
                  key={p}
                  onClick={() => applyPreset(p)}
                  className="w-full flex items-center justify-between px-3 py-2 text-[8px] border border-[#0f2a35] text-[#1a4050] hover:text-[#00ffe0] hover:border-[#00ffe0] transition-all uppercase tracking-[0.3em]"
                >
                  {p}
                  <ChevronRight className="w-3 h-3" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="flex items-center justify-between px-6 py-2 bg-[#070d12] border-t border-[#0f2a35] text-[8px] tracking-[0.3em] text-[#1a4050]">
        <span>GRADIENT_SENSING: ACTIVE</span>
        <div className="flex gap-4">
          <span>{new Date().toLocaleTimeString('en-US', { hour12: false })}</span>
          <span className="text-[#00ffe0] uppercase">Sensor Feed: Normal</span>
        </div>
      </footer>

      <style>{`
        input[type=range]::-webkit-slider-thumb {
          width: 8px; height: 8px; border-radius: 50%;
          background: #00ffe0; box-shadow: 0 0 10px #00ffe0;
        }
      `}</style>
    </div>
  );
};

export default App;