import { useState, useCallback, useEffect } from 'react'
import StockCard from './StockCard.jsx'

const DEFAULT_WATCHLIST = ['AAPL','MSFT','NVDA','TSLA','AMZN','GOOGL','META','JPM','NFLX','AMD']
const LS_KEY = 'swing_agent_watchlist'

const C = {
  bg:'#070d1a', card:'#0f1929', border:'#1a2d45',
  accent:'#00d4ff', green:'#00e096', red:'#ff4060',
  amber:'#ffb800', text:'#dde6f0', muted:'#4a6080',
}

function loadWatchlist() {
  try {
    const saved = localStorage.getItem(LS_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
  } catch {}
  return DEFAULT_WATCHLIST
}

export default function App() {
  const [watchlist, setWatchlist]   = useState(loadWatchlist)
  const [search, setSearch]         = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [saved, setSaved]           = useState(false)

  // Auto-save watchlist to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(watchlist))
      setSaved(true)
      const t = setTimeout(() => setSaved(false), 1500)
      return () => clearTimeout(t)
    } catch {}
  }, [watchlist])

  const add = () => {
    const t = search.trim().toUpperCase().replace(/[^A-Z.]/g, '')
    if (t && !watchlist.includes(t)) { setWatchlist(p => [t, ...p]); setSearch('') }
  }

  const reset = () => {
    if (confirm('¿Restaurar la lista por defecto? Se perderá tu lista guardada.')) {
      setWatchlist(DEFAULT_WATCHLIST)
    }
  }

  return (
    <div style={{ paddingBottom: 48 }}>
      {/* Header */}
      <div style={{ background:'linear-gradient(180deg,#0c1828 0%,#070d1a 100%)', padding:'22px 20px 18px', borderBottom:`1px solid ${C.border}`, marginBottom:20 }}>
        <div style={{ maxWidth:960, margin:'0 auto' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:5 }}>
            <div style={{ display:'flex', alignItems:'center', gap:7 }}>
              <div style={{ width:7, height:7, borderRadius:'50%', background:C.green, animation:'glow 2s ease-in-out infinite' }}/>
              <span style={{ fontSize:10, color:C.green, letterSpacing:'0.12em', fontFamily:"'DM Mono'" }}>LIVE · DATOS REALES DE MERCADO</span>
            </div>
            {/* Save indicator */}
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              {saved && (
                <span style={{ fontSize:10, color:C.green, opacity: saved ? 1 : 0, transition:'opacity 0.3s' }}>
                  ✓ Lista guardada
                </span>
              )}
              <button onClick={reset}
                title="Restaurar lista por defecto"
                style={{ background:'none', border:`1px solid ${C.border}`, borderRadius:6, color:C.muted, padding:'3px 9px', cursor:'pointer', fontSize:10 }}>
                Restaurar default
              </button>
            </div>
          </div>

          <div style={{ display:'flex', alignItems:'baseline', gap:10, marginBottom:14 }}>
            <h1 style={{ fontSize:22, fontWeight:700, letterSpacing:'-0.02em' }}>Swing Trading Agent</h1>
            <span style={{ fontSize:11, color:C.muted, fontFamily:"'DM Mono'" }}>NYSE / NASDAQ</span>
          </div>

          <div style={{ display:'flex', gap:7 }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && add()}
              placeholder="Agregar ticker… ej: COIN, PLTR, SOFI"
              style={{ flex:1, background:'#0f1929', border:`1px solid ${C.border}`, borderRadius:9, padding:'10px 14px', color:C.text, fontSize:13, outline:'none', transition:'border-color 0.2s' }}
              onFocus={e => e.target.style.borderColor = C.accent}
              onBlur={e  => e.target.style.borderColor = C.border}
            />
            <button onClick={add}
              style={{ background:C.accent, border:'none', borderRadius:9, color:'#000', fontWeight:700, padding:'10px 16px', cursor:'pointer', fontSize:13, whiteSpace:'nowrap' }}>
              + Agregar
            </button>
            <button onClick={() => setRefreshKey(k => k + 1)}
              style={{ background:'none', border:`1px solid ${C.border}`, borderRadius:9, color:C.muted, padding:'10px 13px', cursor:'pointer', fontSize:13 }}
              title="Reiniciar todas las tarjetas">
              ↻
            </button>
          </div>

          <p style={{ marginTop:8, fontSize:11, color:C.muted }}>
            Haz clic en <b style={{ color:C.accent }}>ANALIZAR</b> en cada acción · Tu lista se guarda automáticamente en este navegador · {watchlist.length} acciones
          </p>
        </div>
      </div>

      {/* Grid */}
      <div style={{ maxWidth:960, margin:'0 auto', padding:'0 20px' }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(268px, 1fr))', gap:11 }}>
          {watchlist.map(t => (
            <StockCard
              key={`${t}-${refreshKey}`}
              ticker={t}
              onRemove={x => setWatchlist(p => p.filter(v => v !== x))}
            />
          ))}
        </div>

        {watchlist.length === 0 && (
          <div style={{ textAlign:'center', padding:'60px', color:C.muted, fontSize:14 }}>
            Agrega tickers con el buscador de arriba
          </div>
        )}

        <div style={{ marginTop:18, padding:'12px 14px', background:C.card, borderRadius:9, border:`1px solid ${C.border}`, fontSize:11, color:C.muted, lineHeight:1.7 }}>
          <b style={{ color:C.amber }}>Aviso:</b> Análisis orientativo. No constituye asesoría financiera. Confirma siempre los niveles en tu broker antes de operar.
        </div>
      </div>
    </div>
  )
}
