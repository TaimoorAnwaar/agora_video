"use client";
import React, { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import axios from "axios";
import type { ILocalAudioTrack, ILocalVideoTrack } from 'agora-rtc-sdk-ng';

export default function LobbyPage() {
  const params = useParams<{ room: string }>();
  const room = params?.room;
  const router = useRouter();
  const localVideoRef = useRef<HTMLDivElement>(null);
  const previewAudioRef = useRef<ILocalAudioTrack | null>(null);
  const previewVideoRef = useRef<ILocalVideoTrack | null>(null);

  const [micEnabled, setMicEnabled] = useState(true);
  const [camEnabled, setCamEnabled] = useState(true);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isPreparing, setIsPreparing] = useState(false);

  const [startTimeMs, setStartTimeMs] = useState<number | null>(null);
  const [endTimeMs, setEndTimeMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState<number>(Date.now());
  const [canJoin, setCanJoin] = useState<boolean>(true);
  const [ended, setEnded] = useState<boolean>(false);

  // Prepare preview and fetch schedule
  useEffect(() => {
    let volTimer: any;
    let mounted = true;
    (async () => {
      const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
      const api = process.env.NEXT_PUBLIC_API_URL || `${window.location.protocol}//${hostname}:3000`;
      try {
        const res = await axios.get(`${api}/agora/schedule`, { params: { channel: room } });
        const s = res.data;
        if (s?.startTimeMs) setStartTimeMs(Number(s.startTimeMs));
        if (s?.endTimeMs) setEndTimeMs(Number(s.endTimeMs));
        if (s?.now) setNowMs(Number(s.now));
      } catch {
        setStartTimeMs(null);
        setEndTimeMs(null);
      }

      try {
        const isSecure = location.protocol === 'https:' || ['localhost','127.0.0.1'].includes(location.hostname);
        if (!isSecure) return;
        const { default: AgoraRTC } = await import('agora-rtc-sdk-ng');
        const [mic, cam] = await Promise.all([
          AgoraRTC.createMicrophoneAudioTrack(),
          AgoraRTC.createCameraVideoTrack(),
        ]);
        if (!mounted) { mic.stop(); mic.close(); cam.stop(); cam.close(); return; }
        previewAudioRef.current = mic;
        previewVideoRef.current = cam;
        // Initial enables
        await mic.setEnabled(micEnabled);
        await cam.setEnabled(camEnabled);
        // Render preview
        cam.play(localVideoRef.current!);
        // Poll mic level
        volTimer = setInterval(() => {
          try {
            // @ts-ignore
            const lvl = typeof mic.getVolumeLevel === 'function' ? mic.getVolumeLevel() : 0;
            setAudioLevel(Number(lvl) || 0);
          } catch {}
        }, 200);
      } catch {}
    })();

    return () => {
      mounted = false;
      if (volTimer) clearInterval(volTimer);
      // Clean up preview tracks
      try { previewAudioRef.current?.stop(); previewAudioRef.current?.close(); } catch {}
      try { previewVideoRef.current?.stop(); previewVideoRef.current?.close(); } catch {}
      previewAudioRef.current = null;
      previewVideoRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!startTimeMs) {
      setCanJoin(true);
      setEnded(false);
      return;
    }
    const now = nowMs;
    const beforeStart = now < startTimeMs;
    const afterEnd = endTimeMs ? now > endTimeMs : false;
    setCanJoin(!beforeStart && !afterEnd);
    setEnded(afterEnd);
  }, [startTimeMs, endTimeMs, nowMs]);

  function goToCall() {
    if (!canJoin || isPreparing) return;
    setIsPreparing(true);
    // Ensure preview tracks are released before navigation
    try { previewAudioRef.current?.stop(); previewAudioRef.current?.close(); } catch {}
    try { previewVideoRef.current?.stop(); previewVideoRef.current?.close(); } catch {}
    previewAudioRef.current = null;
    previewVideoRef.current = null;
    router.push(`/call/${room}`);
  }

  return (
    <div className="call-container">
      <header className="call-header">
        <h2 className="title">Lobby — Room: <span className="pill">{room}</span></h2>
      </header>

      <section className="grid">
        <div className="panel">
          <h4 className="panel-title">Preview</h4>
          <div ref={localVideoRef} className="video-box" />
          <div className="preview-controls">
            <button className="btn" onClick={async () => { const next = !micEnabled; setMicEnabled(next); try { await previewAudioRef.current?.setEnabled(next); } catch {} }}>{micEnabled ? 'Mute Mic' : 'Unmute Mic'}</button>
            <button className="btn" onClick={async () => { const next = !camEnabled; setCamEnabled(next); try { await previewVideoRef.current?.setEnabled(next); } catch {} }}>{camEnabled ? 'Turn Camera Off' : 'Turn Camera On'}</button>
            <div className="meter" aria-label="mic level">
              <div className="meter-fill" style={{width: `${Math.round(audioLevel*100)}%`}} />
            </div>
          </div>
        </div>
        <div className="panel">
          <h4 className="panel-title">Status</h4>
          {startTimeMs ? (
            <div className="waiting">
              {ended ? (
                <p className="text-warn">Meeting has ended.</p>
              ) : nowMs < startTimeMs ? (
                <>
                  <p>Meeting starts in:</p>
                  <Countdown target={startTimeMs} now={nowMs} />
                </>
              ) : (
                <p>Meeting is live.</p>
              )}
            </div>
          ) : (
            <p>No schedule found. You can join anytime.</p>
          )}

          <button className="btn btn-primary" onClick={goToCall} disabled={!canJoin || isPreparing}>
            {isPreparing ? 'Opening…' : canJoin ? 'Join Meeting' : 'Join (disabled until start)'}
          </button>
        </div>
      </section>

      <style jsx>{`
        .call-container { min-height: 100vh; padding: 24px clamp(16px, 4vw, 48px); background: linear-gradient(180deg, #0f172a 0%, #0b1022 100%); color: #e5e7eb; }
        .call-header { margin-bottom: 16px; }
        .title { font-size: 22px; font-weight: 600; }
        .pill { display: inline-block; background: rgba(59,130,246,.15); color: #93c5fd; border: 1px solid rgba(59,130,246,.35); padding: 2px 8px; border-radius: 999px; font-size: 14px; }
        .grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 16px; align-items: start; }
        .panel { grid-column: span 6; }
        @media (max-width: 900px) { .panel { grid-column: span 12; } }
        .panel-title { margin: 0 0 8px; font-weight: 600; color: #cbd5e1; }
        .video-box { width: 100%; aspect-ratio: 16 / 9; background: #000; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,.35), inset 0 0 0 1px rgba(255,255,255,.06); }
        .preview-controls { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
        .meter { position: relative; width: 120px; height: 8px; background: #111827; border-radius: 6px; overflow: hidden; border: 1px solid rgba(255,255,255,.1); }
        .meter-fill { height: 100%; background: linear-gradient(90deg, #34d399, #10b981); transition: width .15s linear; }
        .text-warn { color: #fca5a5; }
        .btn { padding: 10px 14px; border-radius: 10px; background: #1f2937; color: #e5e7eb; border: 1px solid rgba(255,255,255,.08); transition: transform .06s ease, background .2s ease, border-color .2s; cursor: pointer; }
        .btn:hover { transform: translateY(-1px); border-color: rgba(255,255,255,.18); }
        .btn:active { transform: translateY(0); }
        .btn:disabled { opacity: .6; cursor: not-allowed; transform: none; }
        .btn-primary { background: #2563eb; border-color: #1d4ed8; }
        .btn-primary:hover { background: #1d4ed8; }
      `}</style>
    </div>
  );
}

function Countdown({ target, now }: { target: number; now: number }) {
  const diff = Math.max(0, target - now);
  const totalSeconds = Math.floor(diff / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    <div style={{fontVariantNumeric:'tabular-nums',fontSize:18,marginTop:6}}>
      {pad(hours)}:{pad(minutes)}:{pad(seconds)}
    </div>
  );
}


