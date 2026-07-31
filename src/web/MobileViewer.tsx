// @archigraph web.mobile
// Mobile-optimized 3D viewer: touch orbit/pan/zoom, file loading, no editing tools.

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Application } from '../../implementations/process.renderer/Application';

const EXAMPLE_SKP_URL = 'https://archigraph-releases-prod.s3.us-east-1.amazonaws.com/draftdown/examples/church.skp';

export function MobileViewer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const [ready, setReady] = useState(false);
  const [showWelcome, setShowWelcome] = useState(true);
  const [loading, setLoading] = useState<{ message: string; progress: number } | null>(null);

  // Listen for import-progress events from Application
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail.done) {
        setLoading(null);
      } else {
        setLoading({ message: detail.message || 'Loading...', progress: detail.progress ?? -1 });
      }
    };
    window.addEventListener('import-progress', handler);
    return () => window.removeEventListener('import-progress', handler);
  }, []);

  // Initialize Application
  useEffect(() => {
    const container = containerRef.current;
    if (!container || appRef.current) return;

    const app = new Application();
    appRef.current = app;

    app.initialize(container).then(() => {
      setReady(true);
      (window as any).__debugApp = app;
    });
  }, []);

  // Touch controls: 1-finger orbit, 2-finger pan, pinch zoom
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let lastTouches: { x: number; y: number }[] = [];
    let lastPinchDist = 0;

    const getTouchPoints = (e: TouchEvent) =>
      Array.from(e.touches).map(t => ({ x: t.clientX, y: t.clientY }));

    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      lastTouches = getTouchPoints(e);
      if (e.touches.length === 2) {
        const dx = lastTouches[1].x - lastTouches[0].x;
        const dy = lastTouches[1].y - lastTouches[0].y;
        lastPinchDist = Math.sqrt(dx * dx + dy * dy);
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const app = appRef.current;
      if (!app?.viewport?.camera) return;

      const touches = getTouchPoints(e);

      if (touches.length === 1 && lastTouches.length >= 1) {
        // 1 finger: orbit
        const dx = touches[0].x - lastTouches[0].x;
        const dy = touches[0].y - lastTouches[0].y;
        app.viewport.camera.orbit(dx, dy);
      } else if (touches.length === 2 && lastTouches.length >= 2) {
        // 2 fingers: pan + pinch zoom
        const midX = (touches[0].x + touches[1].x) / 2;
        const midY = (touches[0].y + touches[1].y) / 2;
        const lastMidX = (lastTouches[0].x + lastTouches[1].x) / 2;
        const lastMidY = (lastTouches[0].y + lastTouches[1].y) / 2;

        // Pan
        const dx = midX - lastMidX;
        const dy = midY - lastMidY;
        app.viewport.camera.pan(dx, dy);

        // Pinch zoom
        const pinchDx = touches[1].x - touches[0].x;
        const pinchDy = touches[1].y - touches[0].y;
        const pinchDist = Math.sqrt(pinchDx * pinchDx + pinchDy * pinchDy);
        if (lastPinchDist > 0) {
          const scale = pinchDist / lastPinchDist;
          const zoomDelta = (scale - 1) * 2;
          app.viewport.camera.zoom(zoomDelta);
        }
        lastPinchDist = pinchDist;
      }

      lastTouches = touches;
    };

    const onTouchEnd = (e: TouchEvent) => {
      lastTouches = getTouchPoints(e);
      if (e.touches.length < 2) lastPinchDist = 0;
    };

    container.addEventListener('touchstart', onTouchStart, { passive: false });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd);
    container.addEventListener('touchcancel', onTouchEnd);

    return () => {
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      container.removeEventListener('touchcancel', onTouchEnd);
    };
  }, []);

  const loadExample = useCallback(async () => {
    const app = appRef.current;
    if (!app) return;
    setShowWelcome(false);
    setLoading({ message: 'Loading example model...', progress: -1 });
    try {
      await app.loadSkpFromUrl(EXAMPLE_SKP_URL);
      app.viewport.camera.fitToBox(app.document.geometry.getBoundingBox());
    } catch (err) {
      console.error('Failed to load example:', err);
    }
    setLoading(null);
  }, []);

  const openFile = useCallback(async () => {
    const app = appRef.current;
    if (!app) return;
    setShowWelcome(false);
    try {
      await app.openDocument();
      app.viewport.camera.fitToBox(app.document.geometry.getBoundingBox());
    } catch (err) {
      console.error('Failed to open file:', err);
    }
  }, []);

  return (
    <div className="mobile-viewer">
      <div ref={containerRef} className="mobile-viewport" />

      {showWelcome && ready && (
        <div className="mobile-welcome">
          <div className="mobile-welcome-card">
            <h1>DraftDown</h1>
            <p>3D model viewer</p>
            <div className="mobile-welcome-buttons">
              <button onClick={openFile}>Open File</button>
              <button onClick={loadExample}>Example: Church</button>
            </div>
            <p className="mobile-hint">Use desktop for full editing</p>
          </div>
        </div>
      )}

      {loading && (
        <div className="mobile-loading">
          <div className="mobile-loading-card">
            <div className="mobile-spinner" />
            <p>{loading.message}</p>
            <div className="mobile-progress-track">
              {loading.progress >= 0 && loading.progress <= 1
                ? <div className="mobile-progress-fill" style={{ width: `${Math.round(loading.progress * 100)}%` }} />
                : <div className="mobile-progress-indeterminate" />
              }
            </div>
            {loading.progress >= 0 && loading.progress <= 1 && (
              <p className="mobile-progress-pct">{Math.round(loading.progress * 100)}%</p>
            )}
          </div>
        </div>
      )}

      {!showWelcome && !loading && (
        <button className="mobile-menu-btn" onClick={() => setShowWelcome(true)}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <rect y="3" width="20" height="2" rx="1" fill="currentColor"/>
            <rect y="9" width="20" height="2" rx="1" fill="currentColor"/>
            <rect y="15" width="20" height="2" rx="1" fill="currentColor"/>
          </svg>
        </button>
      )}

      <style>{`
        .mobile-viewer {
          width: 100%; height: 100%;
          position: relative; overflow: hidden;
          background: #1e1e1e;
          touch-action: none;
        }
        .mobile-viewport {
          width: 100%; height: 100%;
          position: absolute; inset: 0;
        }
        .mobile-welcome {
          position: absolute; inset: 0; z-index: 100;
          display: flex; align-items: center; justify-content: center;
          background: rgba(0,0,0,0.7);
          backdrop-filter: blur(4px);
        }
        .mobile-welcome-card {
          background: #2a2a2a; border-radius: 16px;
          padding: 28px 24px; text-align: center;
          width: calc(100% - 48px); max-width: 320px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.5);
        }
        .mobile-welcome-card h1 {
          font-size: 22px; font-weight: 600; color: #eee; margin: 0 0 4px;
        }
        .mobile-welcome-card > p {
          font-size: 13px; color: #888; margin: 0 0 20px;
        }
        .mobile-welcome-buttons {
          display: flex; flex-direction: column; gap: 10px;
        }
        .mobile-welcome-buttons button {
          padding: 14px; border-radius: 10px; border: none;
          background: #333; color: #eee; font-size: 15px; font-weight: 500;
          cursor: pointer; font-family: inherit;
          transition: background 0.15s;
        }
        .mobile-welcome-buttons button:active {
          background: #4488ff;
        }
        .mobile-hint {
          font-size: 11px; color: #666; margin: 16px 0 0 !important;
        }
        .mobile-loading {
          position: absolute; inset: 0; z-index: 200;
          display: flex; align-items: center; justify-content: center;
          background: rgba(0,0,0,0.6);
        }
        .mobile-loading-card {
          background: #2a2a2a; border-radius: 12px;
          padding: 24px; text-align: center;
          box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        }
        .mobile-loading-card p {
          font-size: 13px; color: #eee; margin: 12px 0 0;
        }
        .mobile-progress-track {
          height: 6px; background: #333; border-radius: 3px;
          overflow: hidden; margin-top: 14px;
        }
        .mobile-progress-fill {
          height: 100%; background: #4488ff; border-radius: 3px;
          transition: width 0.2s ease;
        }
        .mobile-progress-indeterminate {
          height: 100%; width: 40%; background: #4488ff; border-radius: 3px;
          animation: mprog 1.2s ease-in-out infinite;
        }
        @keyframes mprog {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(350%); }
        }
        .mobile-progress-pct {
          font-size: 11px !important; color: #888 !important; margin: 6px 0 0 !important;
        }
        .mobile-spinner {
          width: 28px; height: 28px; margin: 0 auto;
          border: 3px solid #444; border-top-color: #4488ff;
          border-radius: 50%; animation: mspin 0.8s linear infinite;
        }
        @keyframes mspin { to { transform: rotate(360deg); } }
        .mobile-menu-btn {
          position: absolute; top: 12px; left: 12px; z-index: 50;
          width: 40px; height: 40px; border-radius: 10px;
          background: rgba(42,42,42,0.85); border: none;
          color: #ccc; display: flex; align-items: center; justify-content: center;
          cursor: pointer; backdrop-filter: blur(8px);
        }
        .mobile-menu-btn:active { background: rgba(68,136,255,0.6); }
      `}</style>
    </div>
  );
}
