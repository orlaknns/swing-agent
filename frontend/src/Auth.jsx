import { useState } from 'react'
import { supabase } from './supabase.js'

const C = {
  bg:'#070d1a', card:'#0f1929', border:'#1a2d45',
  accent:'#00d4ff', green:'#00e096', red:'#ff4060',
  amber:'#ffb800', text:'#dde6f0', muted:'#4a6080',
}

export default function Auth() {
  const [mode, setMode]       = useState('login') // 'login' | 'signup'
  const [email, setEmail]     = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const [message, setMessage] = useState(null)

  const handleSubmit = async () => {
    setLoading(true); setError(null); setMessage(null)
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        setMessage('Revisa tu email para confirmar tu cuenta.')
      }
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  const handleGoogle = async () => {
    await supabase.auth.signInWithOAuth({ provider: 'google',
      options: { redirectTo: window.location.origin } })
  }

  return (
    <div style={{ minHeight:'100vh', background:C.bg, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:16, padding:36, width:'100%', maxWidth:380 }}>

        {/* Logo */}
        <div style={{ textAlign:'center', marginBottom:28 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8, marginBottom:6 }}>
            <div style={{ width:8, height:8, borderRadius:'50%', background:C.green }}/>
            <span style={{ fontSize:10, color:C.green, letterSpacing:'0.12em' }}>SWING TRADING AGENT</span>
          </div>
          <h1 style={{ fontSize:22, fontWeight:700, color:C.text, margin:0 }}>
            {mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}
          </h1>
          <p style={{ fontSize:12, color:C.muted, marginTop:6 }}>
            Tu watchlist y journal sincronizados en la nube
          </p>
        </div>

        {/* Google */}
        <button onClick={handleGoogle}
          style={{ width:'100%', background:'#ffffff', border:'none', borderRadius:9, padding:'11px', cursor:'pointer',
            fontSize:13, fontWeight:600, color:'#333', display:'flex', alignItems:'center', justifyContent:'center', gap:8, marginBottom:16 }}>
          <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/></svg>
          Continuar con Google
        </button>

        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:16 }}>
          <div style={{ flex:1, height:1, background:C.border }}/>
          <span style={{ fontSize:11, color:C.muted }}>o con email</span>
          <div style={{ flex:1, height:1, background:C.border }}/>
        </div>

        {/* Email / Password */}
        <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:16 }}>
          <input type="email" placeholder="tu@email.com" value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:8, padding:'10px 14px', color:C.text, fontSize:13, outline:'none' }}
            onFocus={e => e.target.style.borderColor=C.accent}
            onBlur={e  => e.target.style.borderColor=C.border}
          />
          <input type="password" placeholder="Contraseña" value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:8, padding:'10px 14px', color:C.text, fontSize:13, outline:'none' }}
            onFocus={e => e.target.style.borderColor=C.accent}
            onBlur={e  => e.target.style.borderColor=C.border}
          />
        </div>

        {error   && <div style={{ color:C.red,   fontSize:12, marginBottom:10, padding:'8px 12px', background:'#ff406011', borderRadius:6 }}>{error}</div>}
        {message && <div style={{ color:C.green, fontSize:12, marginBottom:10, padding:'8px 12px', background:'#00e09611', borderRadius:6 }}>{message}</div>}

        <button onClick={handleSubmit} disabled={loading}
          style={{ width:'100%', background:C.accent, border:'none', borderRadius:9, color:'#000', fontWeight:700,
            padding:'11px', cursor: loading ? 'not-allowed' : 'pointer', fontSize:14, opacity: loading ? 0.7 : 1 }}>
          {loading ? 'Cargando...' : mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}
        </button>

        <p style={{ textAlign:'center', fontSize:12, color:C.muted, marginTop:16 }}>
          {mode === 'login' ? '¿No tienes cuenta? ' : '¿Ya tienes cuenta? '}
          <button onClick={() => { setMode(mode==='login'?'signup':'login'); setError(null); setMessage(null) }}
            style={{ background:'none', border:'none', color:C.accent, cursor:'pointer', fontSize:12, fontWeight:600 }}>
            {mode === 'login' ? 'Crear cuenta' : 'Iniciar sesión'}
          </button>
        </p>
      </div>
    </div>
  )
}
