"use client";
import React, { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { ILocalAudioTrack, ILocalVideoTrack, IAgoraRTCRemoteUser, ILocalTrack } from 'agora-rtc-sdk-ng';
import axios from 'axios';

export default function CallPage() {
  const params = useParams<{ room: string }>();
  const room = params?.room;
  const router = useRouter();
  const localVideoRef = useRef<HTMLDivElement>(null);
  const remoteVideoRef = useRef<HTMLDivElement>(null);

  const [joined, setJoined] = useState(false);
  const clientRef = useRef<any | null>(null);
  const screenClientRef = useRef<any | null>(null);
  const [localTracks, setLocalTracks] = useState<{video?: ILocalVideoTrack, audio?: ILocalAudioTrack}>({});
  const [screenTrack, setScreenTrack] = useState<ILocalTrack | null>(null);
  const [micEnabled, setMicEnabled] = useState(true);
  const [camEnabled, setCamEnabled] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isTogglingScreen, setIsTogglingScreen] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const eventsBoundRef = useRef(false);
  const didAutoJoinRef = useRef(false);
  const cleanupOnUnloadRef = useRef<() => Promise<void>>(async () => {});
  const appIdRef = useRef<string | null>(null);
  const channelRef = useRef<string | null>(null);
  const uidRef = useRef<number | null>(null);

  // Simple pre-join: just a Join button (lobby handles waiting/countdown)

  // Cleanup on unmount is handled via cleanupOnUnloadRef effect below.

  // No waiting logic here; lobby controls timing
  useEffect(() => {
    if (didAutoJoinRef.current) return;
    didAutoJoinRef.current = true;
    // Auto-join when page loads
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    join();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);

  // Ensure local video renders once container exists
  useEffect(() => {
    const videoTrack = localTracks.video;
    if (joined && videoTrack && localVideoRef.current) {
      try {
        videoTrack.play(localVideoRef.current);
      } catch {}
    }
  }, [joined, localTracks.video]);

  async function join() {
    if (isJoining || joined) return;
    setIsJoining(true);
    const uid = Math.floor(Math.random()*100000);
    // get token
    const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
    const usingNgrok = /ngrok/.test(hostname);
    const api = process.env.NEXT_PUBLIC_API_URL || `${window.location.protocol}//${hostname}:3000`;
    if (!process.env.NEXT_PUBLIC_API_URL && usingNgrok) {
      alert('Missing NEXT_PUBLIC_API_URL for ngrok. Set NEXT_PUBLIC_API_URL to your backend ngrok HTTPS URL in frontend/.env.local and restart the frontend.');
      setIsJoining(false);
      return;
    }
    let tokenRes;
    try {
      tokenRes = await axios.get(`${api}/agora/token`, { params: { channel: room, uid } });
    } catch (err: any) {
      const status = err?.response?.status;
      const code = err?.response?.data?.message || err?.response?.data || '';
      if (status === 403 && code === 'meeting_not_started') {
        alert('This meeting has not started yet. Please join at the scheduled time.');
      } else if (status === 403 && code === 'meeting_ended') {
        alert('This meeting has ended.');
      } else {
        alert('Failed to get token. Please try again later.');
      }
      setIsJoining(false);
      return;
    }
    const token = tokenRes.data.token;
    const appId = tokenRes.data.appId as string | undefined;
    if (!token || !appId) {
      alert('Server did not return a valid Agora token/appId. Please check backend .env values.');
      setIsJoining(false);
      return;
    }
    appIdRef.current = appId;
    channelRef.current = String(room);
    uidRef.current = uid;

    const { default: AgoraRTC } = await import('agora-rtc-sdk-ng');
    // Silence SDK logs and disable telemetry upload to avoid network calls to statscollector
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    AgoraRTC.setLogLevel?.(0);
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    AgoraRTC.enableLogUpload?.(false);
    const client = clientRef.current ?? (clientRef.current = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' }));
    if (client.connectionState && client.connectionState !== 'DISCONNECTED') {
      setIsJoining(false);
      return;
    }
    try {
      // Guard: browsers require HTTPS (or localhost) for getUserMedia
      const isSecure = location.protocol === 'https:' || ['localhost','127.0.0.1'].includes(location.hostname);
      if (!isSecure) {
        alert('Camera/Mic require HTTPS or localhost. Open this page via https or use ngrok/LAN HTTPS.');
        setIsJoining(false);
        return;
      }

      try {
        await client.join(appId, String(room), token, uid);
      } catch (err: any) {
        const msg = err?.message || String(err);
        if (msg.includes('CAN_NOT_GET_GATEWAY_SERVER') || msg.includes('invalid token')) {
          alert('Join failed: Invalid token. Verify AGORA_APP_ID and AGORA_APP_CERTIFICATE on the backend match your Agora project and restart the backend.');
        } else {
          alert('Join failed: ' + msg);
        }
        return;
      }

      // Create and publish tracks
      const [mic, cam] = await Promise.all([
        AgoraRTC.createMicrophoneAudioTrack(),
        AgoraRTC.createCameraVideoTrack(),
      ]);
      setLocalTracks({ audio: mic, video: cam });
      await mic.setEnabled(micEnabled);
      await cam.setEnabled(camEnabled);
      await client.publish([mic, cam]);
      // After publishing, ensure playback in the UI
      if (localVideoRef.current) {
        try { cam.play(localVideoRef.current); } catch {}
      }

      if (!eventsBoundRef.current) {
        client.on('user-published', async (user: IAgoraRTCRemoteUser, mediaType: 'audio' | 'video') => {
          await client.subscribe(user, mediaType);
          if (mediaType === 'video') {
            const remotePlayerContainer = document.createElement('div');
            remotePlayerContainer.id = `player-${user.uid}`;
            remotePlayerContainer.style.width = '640px';
            remotePlayerContainer.style.height = '360px';
            remoteVideoRef.current?.appendChild(remotePlayerContainer);
            user.videoTrack?.play(remotePlayerContainer);
          }
          if (mediaType === 'audio') {
            user.audioTrack?.play();
          }
        });

        client.on('user-unpublished', (user: IAgoraRTCRemoteUser) => {
          const el = document.getElementById(`player-${user.uid}`);
          if (el) el.remove();
        });
        eventsBoundRef.current = true;
      }

      setJoined(true);
    } finally {
      setIsJoining(false);
    }
  }

  async function leave() {
    const client = clientRef.current;
    try {
      const hadScreenClient = !!screenClientRef.current;
      // Stop screen sharing client if active
      if (screenClientRef.current) {
        try {
          if (screenTrack) {
            try { await screenClientRef.current.unpublish([screenTrack]); } catch {}
            try { screenTrack.stop(); screenTrack.close(); } catch {}
          }
          try { await screenClientRef.current.leave(); } catch {}
        } catch {}
        screenClientRef.current = null;
      }
      // Stop screen sharing if active
      if (!hadScreenClient && screenTrack) {
        try {
          if (client && client.connectionState === 'CONNECTED') {
            await client.unpublish([screenTrack]);
          }
          screenTrack.stop();
          screenTrack.close();
        } catch (err) {
          console.error('Error stopping screen track:', err);
        }
        setScreenTrack(null);
        setIsScreenSharing(false);
      }

      const tracks = Object.values(localTracks).filter(Boolean) as Array<ILocalAudioTrack | ILocalVideoTrack>;
      if (tracks.length) {
        await client.unpublish(tracks);
      }
      tracks.forEach((track) => track.stop?.());
      tracks.forEach((track) => track.close?.());
      await client.leave();
    } catch (err) {
      // ignore
    }
    setJoined(false);
    eventsBoundRef.current = false;
    // Redirect to home after leaving
    router.push('/');
  }

  // Ensure tracks are released if user navigates away without clicking Leave
  useEffect(() => {
    cleanupOnUnloadRef.current = async () => {
      try {
        const client = clientRef.current;
        const sClient = screenClientRef.current;
        // Stop screen sharing if active
        if (screenTrack) {
          try {
            if (sClient) {
              try { await sClient.unpublish([screenTrack]); } catch {}
            } else if (client && client.connectionState === 'CONNECTED') {
              try { await client.unpublish([screenTrack]); } catch {}
            }
          } catch {}
          try { screenTrack.stop(); screenTrack.close(); } catch {}
        }
        try { await sClient?.leave?.(); } catch {}
        screenClientRef.current = null;

        // Stop local tracks and leave main client
        const tracks = Object.values(localTracks).filter(Boolean) as Array<ILocalAudioTrack | ILocalVideoTrack>;
        try { if (tracks.length) await client?.unpublish?.(tracks); } catch {}
        tracks.forEach(t => { try { t.stop?.(); t.close?.(); } catch {} });
        try { await client?.leave?.(); } catch {}
      } catch {}
    };
  }, [localTracks, screenTrack]);

  useEffect(() => {
    const handler = () => { void cleanupOnUnloadRef.current(); };
    window.addEventListener('beforeunload', handler);
    return () => {
      window.removeEventListener('beforeunload', handler);
      void cleanupOnUnloadRef.current();
    };
  }, []);

  async function toggleMic() {
    if (!localTracks.audio) return;
    const next = !micEnabled;
    await localTracks.audio.setEnabled(next);
    setMicEnabled(next);
  }

  async function toggleCam() {
    if (!localTracks.video) return;
    const next = !camEnabled;
    await localTracks.video.setEnabled(next);
    setCamEnabled(next);
  }

  async function toggleScreenShare() {
    if (isTogglingScreen) return;
    setIsTogglingScreen(true);
    const mainClient = clientRef.current;
    if (!mainClient || !joined || mainClient.connectionState !== 'CONNECTED') {
      alert('Not connected yet. Please wait until you are fully joined before screen sharing.');
      setIsTogglingScreen(false);
      return;
    }
    const appId = appIdRef.current;
    const channel = channelRef.current;
    if (!appId || !channel) {
      alert('Missing appId/channel in memory. Please rejoin the call.');
      setIsTogglingScreen(false);
      return;
    }
    if (!isScreenSharing) {
      try {
        const { default: AgoraRTC } = await import('agora-rtc-sdk-ng');
        const created = await AgoraRTC.createScreenVideoTrack({
          encoderConfig: '1080p_1',
          optimizationMode: 'detail'
        });
        const actualScreenTrack = Array.isArray(created) ? created[0] : created;
        
        // Create a dedicated client for screen sharing
        const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
        const usingNgrok = /ngrok/.test(hostname);
        const apiBase = process.env.NEXT_PUBLIC_API_URL || `${window.location.protocol}//${hostname}:3000`;
        if (!process.env.NEXT_PUBLIC_API_URL && usingNgrok) {
          alert('Missing NEXT_PUBLIC_API_URL for ngrok. Set NEXT_PUBLIC_API_URL to your backend ngrok HTTPS URL in frontend/.env.local and restart the frontend.');
          setIsTogglingScreen(false);
          try { actualScreenTrack.stop(); actualScreenTrack.close(); } catch {}
          return;
        }

        const screenUid = Math.floor(Math.random() * 1000000) + 1000000;
        let tokenRes2;
        try {
          tokenRes2 = await axios.get(`${apiBase}/agora/token`, { params: { channel, uid: screenUid } });
        } catch (err: any) {
          alert('Failed to get token for screen share. Please try again.');
          setIsTogglingScreen(false);
          try { actualScreenTrack.stop(); actualScreenTrack.close(); } catch {}
          return;
        }
        const token2 = tokenRes2.data?.token as string | undefined;
        if (!token2) {
          alert('Server did not return a valid token for screen share.');
          setIsTogglingScreen(false);
          try { actualScreenTrack.stop(); actualScreenTrack.close(); } catch {}
          return;
        }

        const screenClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
        screenClientRef.current = screenClient;
        await screenClient.join(appId, channel, token2, screenUid);
        await screenClient.publish([actualScreenTrack]);

        setScreenTrack(actualScreenTrack);
        setIsScreenSharing(true);
        
        if (localVideoRef.current) {
          actualScreenTrack.play(localVideoRef.current);
        }
      } catch (err: any) {
        console.error('Failed to start screen sharing:', err);
        if (err?.message?.includes('Permission denied')) {
          alert('Screen sharing permission denied. Please allow screen sharing access.');
        } else {
          alert('Failed to start screen sharing: ' + (err?.message || String(err)));
        }
      } finally {
        setIsTogglingScreen(false);
      }
    } else {
      try {
        const sClient = screenClientRef.current;
        if (screenTrack && sClient) {
          try { await sClient.unpublish([screenTrack]); } catch {}
          try { screenTrack.stop(); screenTrack.close(); } catch {}
        }
        try { await sClient?.leave?.(); } catch {}
        screenClientRef.current = null;
        setScreenTrack(null);
        setIsScreenSharing(false);
      } catch (err) {
        console.error('Failed to stop screen sharing:', err);
      } finally {
        setIsTogglingScreen(false);
      }
    }
  }

  return (
    <div className="call-container">
      <header className="call-header">
        <h2 className="title">Room: <span className="pill">{room}</span></h2>
      </header>

      {joined ? (
        <>
          <section className="grid">
            <div className="panel">
              <h4 className="panel-title">
                {isScreenSharing ? 'Screen Sharing' : 'Your Video'}
                {isScreenSharing && <span className="screen-share-indicator">● LIVE</span>}
              </h4>
              <div ref={localVideoRef} className="video-box">
                <div id="local-fallback" style={{color:'#94a3b8',fontSize:12,padding:8}}>If your camera preview does not appear, try toggling camera or rejoining.</div>
              </div>
            </div>
            <div className="panel">
              <h4 className="panel-title">Remote Camera</h4>
              <div ref={remoteVideoRef} className="video-box remote">
                <div id="remote-fallback" style={{color:'#94a3b8',fontSize:12,padding:8}}>Waiting for the other participant to join…</div>
              </div>
            </div>
          </section>

          <div className="controls">
            <button className="btn btn-danger" onClick={leave}>Leave</button>
            <button className="btn" onClick={toggleMic}>{micEnabled ? 'Mute Mic' : 'Unmute Mic'}</button>
            <button className="btn" onClick={toggleCam}>{camEnabled ? 'Turn Camera Off' : 'Turn Camera On'}</button>
            <button 
              className={`btn ${isScreenSharing ? 'btn-warning' : 'btn-success'}`} 
              onClick={toggleScreenShare}
              disabled={isTogglingScreen}
            >
              {isScreenSharing ? 'Stop Sharing' : 'Share Screen'}
            </button>
          </div>
        </>
      ) : null}

      <style jsx>{`
        .call-container {
          min-height: 100vh;
          padding: 24px clamp(16px, 4vw, 48px);
          background: linear-gradient(180deg, #0f172a 0%, #0b1022 100%);
          color: #e5e7eb;
        }
        .call-header { margin-bottom: 16px; }
        .title { font-size: 22px; font-weight: 600; }
        .pill {
          display: inline-block;
          background: rgba(59,130,246,.15);
          color: #93c5fd;
          border: 1px solid rgba(59,130,246,.35);
          padding: 2px 8px; border-radius: 999px; font-size: 14px;
        }
        .grid {
          display: grid;
          grid-template-columns: repeat(12, 1fr);
          gap: 16px;
          align-items: start;
        }
        .panel { grid-column: span 6; }
        @media (max-width: 900px) {
          .panel { grid-column: span 12; }
        }
        .panel-title { margin: 0 0 8px; font-weight: 600; color: #cbd5e1; }
        .video-box {
          width: 100%;
          aspect-ratio: 16 / 9;
          background: #000;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 10px 25px rgba(0,0,0,.35), inset 0 0 0 1px rgba(255,255,255,.06);
        }
        
        .controls {
          margin-top: 18px;
          display: flex; gap: 10px; flex-wrap: wrap;
        }
        .btn {
          padding: 10px 14px; border-radius: 10px;
          background: #1f2937; color: #e5e7eb;
          border: 1px solid rgba(255,255,255,.08);
          transition: transform .06s ease, background .2s ease, border-color .2s;
        }
        .btn:hover { transform: translateY(-1px); border-color: rgba(255,255,255,.18); }
        .btn:active { transform: translateY(0); }
        .btn-primary { background: #2563eb; border-color: #1d4ed8; }
        .btn-primary:hover { background: #1d4ed8; }
        .btn-danger { background: #ef4444; border-color: #dc2626; }
        .btn-danger:hover { background: #dc2626; }
        .btn-success { background: #10b981; border-color: #059669; }
        .btn-success:hover { background: #059669; }
        .btn-warning { background: #f59e0b; border-color: #d97706; }
        .btn-warning:hover { background: #d97706; }
        .screen-share-indicator {
          display: inline-block;
          background: #ef4444;
          color: white;
          font-size: 12px;
          padding: 2px 6px;
          border-radius: 4px;
          margin-left: 8px;
          animation: pulse 2s infinite;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
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
