"use client";
import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import type { ILocalAudioTrack, ILocalVideoTrack, IAgoraRTCRemoteUser, ILocalTrack } from 'agora-rtc-sdk-ng';
import axios from 'axios';

export default function CallPage() {
  const params = useParams<{ room: string }>();
  const room = params?.room;
  const localVideoRef = useRef<HTMLDivElement>(null);
  const remoteVideoRef = useRef<HTMLDivElement>(null);

  const [joined, setJoined] = useState(false);
  const clientRef = useRef<any | null>(null);
  const [localTracks, setLocalTracks] = useState<{video?: ILocalVideoTrack, audio?: ILocalAudioTrack}>({});
  const [screenTrack, setScreenTrack] = useState<ILocalTrack | null>(null);
  const [micEnabled, setMicEnabled] = useState(true);
  const [camEnabled, setCamEnabled] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const eventsBoundRef = useRef(false);

  // Do not auto-join. Only clean up if leaving the page while joined.
  useEffect(() => {
    return () => {
      if (joined) {
        // Best-effort cleanup
        leave();
      }
      // Clean up screen sharing if active
      if (screenTrack) {
        try {
          screenTrack.stop();
          screenTrack.close();
        } catch (err) {
          console.error('Error cleaning up screen track:', err);
        }
      }
    };
  }, [joined, screenTrack]);

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
    const tokenRes = await axios.get(`${api}/agora/token`, { params: { channel: room, uid } });
    const token = tokenRes.data.token;
    const appId = tokenRes.data.appId as string | undefined;
    if (!token || !appId) {
      alert('Server did not return a valid Agora token/appId. Please check backend .env values.');
      setIsJoining(false);
      return;
    }

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

      const localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
      const localVideoTrack = await AgoraRTC.createCameraVideoTrack();

      setLocalTracks({ audio: localAudioTrack, video: localVideoTrack });

      localVideoTrack.play(localVideoRef.current!);
      await client.publish([localAudioTrack, localVideoTrack]);

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
      // Stop screen sharing if active
      if (screenTrack) {
        try {
          await client.unpublish(screenTrack);
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
  }

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
    if (!isScreenSharing) {
      try {
        const { default: AgoraRTC } = await import('agora-rtc-sdk-ng');
        const screenTrack = await AgoraRTC.createScreenVideoTrack({
          encoderConfig: '1080p_1',
          optimizationMode: 'detail'
        });
        
        // Handle both single track and array of tracks
        const actualScreenTrack = Array.isArray(screenTrack) ? screenTrack[0] : screenTrack;
        setScreenTrack(actualScreenTrack);
        setIsScreenSharing(true);
        
        // Publish screen track
        await clientRef.current.publish(actualScreenTrack);
        
        // Show screen share in local video area
        if (localVideoRef.current) {
          actualScreenTrack.play(localVideoRef.current);
        }
        
        // Hide camera video temporarily
        if (localTracks.video) {
          localTracks.video.setEnabled(false);
        }
        
      } catch (err: any) {
        console.error('Failed to start screen sharing:', err);
        if (err.message?.includes('Permission denied')) {
          alert('Screen sharing permission denied. Please allow screen sharing access.');
        } else {
          alert('Failed to start screen sharing: ' + err.message);
        }
      }
    } else {
      try {
        // Stop screen sharing
        if (screenTrack) {
          await clientRef.current.unpublish(screenTrack);
          screenTrack.stop();
          screenTrack.close();
          setScreenTrack(null);
        }
        
        setIsScreenSharing(false);
        
        // Show camera video again
        if (localTracks.video) {
          localTracks.video.setEnabled(true);
          if (localVideoRef.current) {
            localTracks.video.play(localVideoRef.current);
          }
        }
        
      } catch (err) {
        console.error('Failed to stop screen sharing:', err);
      }
    }
  }

  return (
    <div className="call-container">
      <header className="call-header">
        <h2 className="title">Room: <span className="pill">{room}</span></h2>
      </header>

      <section className="grid">
        <div className="panel">
          <h4 className="panel-title">
            {isScreenSharing ? 'Screen Sharing' : 'Your Video'}
            {isScreenSharing && <span className="screen-share-indicator">● LIVE</span>}
          </h4>
          <div ref={localVideoRef} className="video-box" />
        </div>
        <div className="panel">
          <h4 className="panel-title">Remote Camera</h4>
          <div ref={remoteVideoRef} className="video-box remote" />
        </div>
      </section>

      <div className="controls">
        {joined ? (
          <>
            <button className="btn btn-danger" onClick={leave}>Leave</button>
            <button className="btn" onClick={toggleMic}>{micEnabled ? 'Mute Mic' : 'Unmute Mic'}</button>
            <button className="btn" onClick={toggleCam}>{camEnabled ? 'Turn Camera Off' : 'Turn Camera On'}</button>
            <button 
              className={`btn ${isScreenSharing ? 'btn-warning' : 'btn-success'}`} 
              onClick={toggleScreenShare}
            >
              {isScreenSharing ? 'Stop Sharing' : 'Share Screen'}
            </button>
          </>
        ) : (
          <button className="btn btn-primary" onClick={join}>Join</button>
        )}
      </div>

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
