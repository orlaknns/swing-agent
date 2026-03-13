import { useState, useEffect } from 'react'
import StockCard from './StockCard.jsx'
import Journal from './Journal.jsx'

const DEFAULT_WATCHLIST = ['AAPL','MSFT','NVDA','TSLA','AMZN','GOOGL','META','JPM','NFLX','AMD']
const LS_KEY = 'swing_agent_watchlist'
const LS_JOURNAL = 'swing_agent_journal'

const C = {
  bg:'#070d1a', card:'#0f1929', border:'#1a2d45',
  accent:'#00d4ff', green:'#00e096', red:'#ff4060',
  amber:'#ffb800', text:'#dde6f0', muted:'#4a6080',
}

function loadWatchlist() {
  try {
    const saved = localStorage.getItem(LS_KEY)
    if (saved) { const p = JSON.parse(saved); if (Array.isArray(p) && p.length > 0) return p }
  } catch {}
  return DEFAULT_WATCHLIST
}

export default function App() {
  const [tab, setTab]             = useState('watchlist')
  const [watchlist, setWatchlist] = useState(loadWatchlist)
  const [search, setSearch]       = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [saved, setSaved]         = useState(false)
  const [journalCount, setJournalCount] = useState(0)

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(watchlist)); setSaved(true); const t = setTimeout(() => setSaved(false), 1500); return () => clearTimeout(t) }
    catch {}
  }, [watchlist])

  // Count journal entries for badge
  useEffect(() => {
    const update = () => {
      try { const j = JSON.parse(localStorage.getItem(LS_JOURNAL) || '[]'); setJournalCount(j.length) }
      catch {}
    }
    update()
    window.addEventListener('storage', update)
    // Poll every 2s to catch saves from StockCard
    const interval = setInterval(update, 2000)
    return () => { window.removeEventListener('storage', update); clearInterval(interval) }
  }, [])

  const add = () => {
    const t = search.trim().toUpperCase().replace(/[^A-Z.]/g, '')
    if (t && !watchlist.includes(t)) { setWatchlist(p => [t, ...p]); setSearch('') }
  }

  const reset = () => {
    if (confirm('¿Restaurar la lista por defecto?')) setWatchlist(DEFAULT_WATCHLIST)
  }

  return (
    <div style={{ paddingBottom: 48 }}>
      {/* Header */}
      <div style={{ background:'linear-gradient(180deg,#0c1828 0%,#070d1a 100%)', padding:'22px 20px 0', borderBottom:`1px solid ${C.border}`, marginBottom:0 }}>
        <div style={{ maxWidth:960, margin:'0 auto' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:5 }}>
            <div style={{ display:'flex', alignItems:'center', gap:7 }}>
              <div style={{ width:7, height:7, borderRadius:'50%', background:C.green, animation:'glow 2s ease-in-out infinite' }}/>
              <span style={{ fontSize:10, color:C.green, letterSpacing:'0.12em' }}>LIVE · DATOS REALES DE MERCADO</span>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              {saved && tab==='watchlist' && <span style={{ fontSize:10, color:C.green }}>✓ Lista guardada</span>}
              {tab==='watchlist' && (
                <button onClick={reset} style={{ background:'none', border:`1px solid ${C.border}`, borderRadius:6, color:C.muted, padding:'3px 9px', cursor:'pointer', fontSize:10 }}>
                  Restaurar default
                </button>
              )}
            </div>
          </div>

          <div style={{ display:'flex', alignItems:'baseline', gap:10, marginBottom: tab==='watchlist' ? 14 : 10 }}>
            <h1 style={{ fontSize:22, fontWeight:700, letterSpacing:'-0.02em' }}>Swing Trading Agent</h1>
            <span style={{ fontSize:11, color:C.muted }}>NYSE / NASDAQ</span>
          </div>

          {/* Search bar — only on watchlist tab */}
          {tab === 'watchlist' && (
            <div style={{ display:'flex', gap:7, marginBottom:14 }}>
              <input value={search} onChange={e => setSearch(e.target.value.toUpperCase())}
                onKeyDown={e => e.key==='Enter' && add()}
                placeholder="Agregar ticker… ej: COIN, PLTR, SOFI"
                style={{ flex:1, background:'#0f1929', border:`1px solid ${C.border}`, borderRadius:9, padding:'10px 14px', color:C.text, fontSize:13, outline:'none' }}
                onFocus={e => e.target.style.borderColor=C.accent}
                onBlur={e  => e.target.style.borderColor=C.border}
              />
              <button onClick={add} style={{ background:C.accent, border:'none', borderRadius:9, color:'#000', fontWeight:700, padding:'10px 16px', cursor:'pointer', fontSize:13, whiteSpace:'nowrap' }}>
                + Agregar
              </button>
              <button onClick={() => setRefreshKey(k=>k+1)} style={{ background:'none', border:`1px solid ${C.border}`, borderRadius:9, color:C.muted, padding:'10px 13px', cursor:'pointer', fontSize:13 }} title="Reiniciar">
                ↻
              </button>
            </div>
          )}

          {/* Tabs */}
          <div style={{ display:'flex', gap:0, borderTop:`1px solid ${C.border}`, marginTop: tab==='journal' ? 10 : 0 }}>
            {[
              { key:'watchlist', label:`Watchlist · ${watchlist.length}` },
              { key:'journal',   label:`Journal · ${journalCount}` },
            ].map(({ key, label }) => (
              <button key={key} onClick={() => setTab(key)}
                style={{ background:'none', border:'none', borderBottom: tab===key ? `2px solid ${C.accent}` : '2px solid transparent',
                  color: tab===key ? C.accent : C.muted, padding:'10px 18px', cursor:'pointer', fontSize:12, fontWeight: tab===key ? 700 : 400, transition:'all 0.15s' }}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ marginTop:20 }}>
        {tab === 'watchlist' && (
          <div style={{ maxWidth:960, margin:'0 auto', padding:'0 20px' }}>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(268px, 1fr))', gap:11 }}>
              {watchlist.map(t => (
                <StockCard key={`${t}-${refreshKey}`} ticker={t} onRemove={x => setWatchlist(p => p.filter(v=>v!==x))} />
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
        )}

        {tab === 'journal' && <Journal />}
      </div>
    </div>
  )
}
