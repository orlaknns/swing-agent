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
