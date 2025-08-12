'use client'

import React from 'react';
import axios from 'axios';

export default function Home() {
  const [link, setLink] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  // Ensure API base is correct for HTTPS/ngrok
  async function createLink() {
    setLoading(true);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:3000` : 'http://localhost:3000');
      const res = await axios.post(`${apiBase}/agora/create-room`);
      setLink(res.data.link);
      navigator.clipboard?.writeText(res.data.link).catch(()=>{});
    } catch (err) {
      console.error(err);
      alert('Failed to create link');
    } finally { setLoading(false); }
  }

  return (
    <div style={{display:'flex',height:'100vh',alignItems:'center',justifyContent:'center',flexDirection:'column'}}>
      <h1>Doctor — Patient Video Call</h1>
      <button onClick={createLink} disabled={loading} style={{padding:'12px 20px',fontSize:16}}>
        {loading ? 'Creating...' : 'Generate Link'}
      </button>

      {link && (
        <p style={{marginTop:16}}>Link created — <a href={link}>{link}</a> (copied to clipboard)</p>
      )}

      <p style={{marginTop:40,fontSize:12,color:'#666'}}>Open the link on another device or share with the other person.</p>
    </div>
  );
}
