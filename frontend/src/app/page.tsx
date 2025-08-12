'use client'

import React from 'react';
import axios from 'axios';

export default function Home() {
  const [link, setLink] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [startTime, setStartTime] = React.useState<string>('');
  const [durationMinutes, setDurationMinutes] = React.useState<number>(30);
  const [errors, setErrors] = React.useState<{start?: string; duration?: string}>({});
  function validate(): boolean {
    const next: {start?: string; duration?: string} = {};
    if (!startTime) next.start = 'Please select a start date and time';
    if (!durationMinutes || durationMinutes <= 0) next.duration = 'Enter a valid duration in minutes';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  // Ensure API base is correct for HTTPS/ngrok
  async function createLink() {
    if (!validate()) return;
    setLoading(true);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:3000` : 'http://localhost:3000');
      const payload: any = {};
      if (startTime) payload.startTime = new Date(startTime).toISOString();
      if (durationMinutes && durationMinutes > 0) payload.durationMinutes = durationMinutes;
      const res = await axios.post(`${apiBase}/agora/create-room`, payload);
      setLink(res.data.link);
      navigator.clipboard?.writeText(res.data.link).catch(()=>{});
    } catch (err) {
      console.error(err);
      alert('Failed to create link');
    } finally { setLoading(false); }
  }

  return (
    <div style={{minHeight:'100vh',display:'grid',placeItems:'center',background:'#0b1022'}}> 
      <div style={{width:'min(680px, 92vw)',background:'#0f172a',color:'#e5e7eb',border:'1px solid rgba(255,255,255,.06)',borderRadius:14,padding:20,boxShadow:'0 20px 60px rgba(0,0,0,.6)'}}>
        <h1 style={{fontSize:22,margin:'0 0 16px',fontWeight:600}}>Doctor — Patient Video Call</h1>

        <div style={{display:'grid',gridTemplateColumns:'1fr 200px',gap:12,alignItems:'end'}}>
          <div>
            <label style={{display:'block',fontSize:12,color:'#9ca3af',marginBottom:6}}>Start time</label>
            <input
              type="datetime-local"
              value={startTime}
              onChange={(e)=>{ setStartTime(e.target.value); if (errors.start) setErrors(prev=>({...prev,start:undefined})); }}
              style={{width:'100%',padding:10,fontSize:14,borderRadius:10,border:'1px solid rgba(106, 94, 94, 0.08)',background:'#111827',color:'#e5e7eb'}}
            />
            {errors.start && <div style={{color:'#fca5a5',fontSize:12,marginTop:6}}>{errors.start}</div>}
          </div>
          <div>
            <label style={{display:'block',fontSize:12,color:'#9ca3af',marginBottom:6}}>Duration (minutes)</label>
            <input
              type="number"
              min={5}
              step={5}
              value={durationMinutes}
              onChange={(e)=>{ const val = Number(e.target.value); setDurationMinutes(val); if (errors.duration) setErrors(prev=>({...prev,duration:undefined})); }}
              style={{width:'100%',padding:10,fontSize:14,borderRadius:10,border:'1px solid rgba(230, 205, 205, 0.08)',background:'#111827',color:'#e5e7eb'}}
            />
            {errors.duration && <div style={{color:'#fca5a5',fontSize:12,marginTop:6}}>{errors.duration}</div>}
          </div>
        </div>

        <div style={{display:'flex',gap:10,alignItems:'center',marginTop:14}}>
          <button
            onClick={createLink}
            disabled={loading || !startTime || !durationMinutes || durationMinutes <= 0}
            className="home-btn home-btn-primary"
            style={{padding:'12px 18px',fontSize:16,borderRadius:10,border:'1px solid #1d4ed8',background:'#2563eb',color:'#e5e7eb',cursor:'pointer'}}
          >
            {loading ? 'Creating…' : 'Generate Link'}
          </button>
          <span style={{fontSize:12,color:'#9ca3af'}}>You must set start time and duration to generate a link.</span>
        </div>

        {link && (
          <div style={{marginTop:16,fontSize:14}}>
            Link created — <a href={link} style={{color:'#93c5fd',textDecoration:'underline'}}>{link}</a> (copied to clipboard)
          </div>
        )}

        <p style={{marginTop:18,fontSize:12,color:'#9ca3af'}}>Open the link on another device or share with the other person.</p>
      </div>
      <style jsx>{`
        /* Make the calendar icon visible on dark inputs */
        input[type="datetime-local"] {
          color-scheme: light;
        }
        input[type="datetime-local"]::-webkit-calendar-picker-indicator {
          filter: invert(1) brightness(1.6);
          opacity: 0.9;
          cursor: pointer;
        }
        /* Improve number input contrast on dark bg (optional) */
        input[type="number"] {
          color-scheme: light;
        }
      `}</style>
    </div>
  );
}
