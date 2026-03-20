import { useState, useEffect } from 'react'

const C = {
  bg:'#070d1a', card:'#0f1929', border:'#1a2d45',
  accent:'#00d4ff', green:'#00e096', red:'#ff4060',
  amber:'#ffb800', text:'#dde6f0', muted:'#4a6080',
}

const SECTOR_COLORS = {
  'Technology':          '#00d4ff',
  'Financial':           '#00e096',
  'Healthcare':          '#a78bfa',
  'Consumer Cyclical':   '#ffb800',
  'Consumer Defensive':  '#34d399',
  'Communication':       '#fb923c',
  'Energy':              '#f59e0b',
  'Industrials':         '#94a3b8',
  'Basic Materials':     '#84cc16',
  'Real Estate':         '#e879f9',
  'Utilities':           '#38bdf8',
}

export default function Discover({ watchlist, onAdd, onRemove, onAddAll }) {
  const [candidates, setCandidates] = useState([])
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState(null)
  const [filter, setFilter]         = useState('all')
  const [screenerDate, setScreenerDate] = useState(null)
  const [source, setSource]         = useState(null)
  const [updatedAt, setUpdatedAt]   = useState(null)

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/screener')
      if (!res.ok) throw new Error(`Error ${res.status}`)
      const data = await res.json()
      setCandidates(data.candidates || [])
      setScreenerDate(data.date || null)
      setSource(data.source || null)
      setUpdatedAt(data.updatedAt || null)
    } catch (e) {
      setError('No se pudo conectar con el screener.')
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const sectors = ['all', ...new Set(candidates.map(c => c.sector).filter(Boolean))]
  const filtered = filter === 'all' ? candidates : candidates.filter(c => c.sector === filter)
  const inWatchlist = (ticker) => watchlist.includes(ticker)

  return (
    <div style={{ maxWidth:960, margin:'0 auto', padding:'0 20px 48px' }}>

      {/* Header */}
      <div style={{ marginBottom:16 }}>
        <h2 style={{ fontSize:18, fontWeight:700, color:C.text, margin:0 }}>Descubrir acciones</h2>
        <p style={{ fontSize:11, color:C.muted, margin:'4px 0 0' }}>
          Candidatas para swing trading set-and-forget · Filtradas por EMA, RSI y volumen
        </p>
        <div style={{ marginTop:4, fontSize:11, display:'flex', alignItems:'center', gap:8 }}>
          {source === 'curated' ? (
            <>
              <span style={{ background:'#ffb80022', color:C.amber, padding:'2px 8px', borderRadius:99, fontSize:10, fontWeight:700 }}>
                LISTA CURADA
              </span>
              <span style={{ color:C.muted }}>
                40 acciones líquidas S&P500 · Finviz no disponible desde este servidor
              </span>
            </>
          ) : source === 'finviz' ? (
            <>
              <span style={{ background:'#00e09622', color:C.green, padding:'2px 8px', borderRadius:99, fontSize:10, fontWeight:700 }}>
                FINVIZ LIVE
              </span>
              <span style={{ color: screenerDate === new Date().toISOString().slice(0,10) ? C.green : C.amber }}>
                Actualizado: {updatedAt || screenerDate}
              </span>
            </>
          ) : (
            <span style={{ color:C.muted }}>Cargando...</span>
          )}
        </div>
      </div>

      {/* Criterios */}
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:'10px 14px', marginBottom:16, fontSize:11, color:C.muted }}>
        <span style={{ color:C.accent, fontWeight:700 }}>Criterios de filtrado: </span>
        EMA20 cruzó sobre EMA50 (tendencia alcista reciente) · RSI entre 30 y 60 (zona de pullback) · Precio &gt; $20 · Volumen promedio &gt; 500k · NYSE y NASDAQ
      </div>

      {/* Error */}
      {error && (
        <div style={{ background:'#ff406011', border:`1px solid ${C.red}44`, borderRadius:8, padding:'12px 14px', marginBottom:16, fontSize:12, color:C.red }}>
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign:'center', padding:'60px 20px', color:C.muted }}>
          <div style={{ fontSize:13, marginBottom:8 }}>Consultando Finviz screener...</div>
          <div style={{ fontSize:11 }}>Buscando acciones que cumplen los criterios de set-and-forget</div>
        </div>
      )}

      {/* Sector filter + bulk actions */}
      {!loading && candidates.length > 0 && (
        <>
          <div style={{ display:'flex', gap:6, marginBottom:8, flexWrap:'wrap' }}>
            {sectors.map(s => (
              <button key={s} onClick={() => setFilter(s)}
                style={{ background:filter===s ? (s==='all' ? C.accent : SECTOR_COLORS[s]||C.accent) : 'none',
                  border:`1px solid ${filter===s ? (SECTOR_COLORS[s]||C.accent) : C.border}`,
                  borderRadius:6, color:filter===s ? '#000' : C.muted,
                  padding:'4px 12px', cursor:'pointer', fontSize:11, fontWeight:filter===s?700:400 }}>
                {s === 'all' ? `Todos (${candidates.length})` : s}
              </button>
            ))}
          </div>
          <div style={{ display:'flex', gap:8, marginBottom:14, alignItems:'center' }}>
            {(() => {
              const notAdded = filtered.filter(c => !watchlist.includes(c.ticker))
              return notAdded.length > 0 ? (
                <button
                  onClick={() => onAddAll(notAdded.map(c => c.ticker))}
                  style={{ background:C.accent, border:'none', borderRadius:7, color:'#000',
                    fontWeight:700, padding:'6px 14px', cursor:'pointer', fontSize:11 }}>
                  + Agregar {notAdded.length === filtered.length ? 'todos' : `${notAdded.length} restantes`} a watchlist
                </button>
              ) : null
            })()}
            {(() => {
              const added = filtered.filter(c => watchlist.includes(c.ticker))
              return added.length > 0 ? (
                <button
                  onClick={() => added.forEach(c => onRemove(c.ticker))}
                  style={{ background:'none', border:`1px solid ${C.red}66`, borderRadius:7, color:C.red,
                    fontWeight:700, padding:'6px 14px', cursor:'pointer', fontSize:11 }}>
                  − Quitar {added.length === filtered.length ? 'todos' : added.length} de watchlist
                </button>
              ) : null
            })()}
          </div>
        </>
      )}

      {/* Candidates grid */}
      {!loading && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:8 }}>
          {filtered.map(c => {
            const added = inWatchlist(c.ticker)
            const sectorColor = SECTOR_COLORS[c.sector] || C.muted
            return (
              <div key={c.ticker} style={{
                background:C.card, border:`1px solid ${added ? C.green+'66' : C.border}`,
                borderRadius:10, padding:'12px 14px',
                borderLeft:`3px solid ${added ? C.green : sectorColor}`
              }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8 }}>
                  <div>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <span style={{ fontSize:16, fontWeight:700, color:C.text, fontFamily:'monospace' }}>{c.ticker}</span>
                      {c.price > 0 && <span style={{ fontSize:12, color:C.muted, fontFamily:'monospace' }}>${c.price}</span>}
                    </div>
                    <div style={{ fontSize:11, color:C.muted, marginTop:2, maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {c.company}
                    </div>
                  </div>
                  <button
                    onClick={() => added ? onRemove(c.ticker) : onAdd(c.ticker)}
                    style={{
                      background: added ? C.red+'22' : C.accent,
                      border: added ? `1px solid ${C.red}66` : 'none',
                      borderRadius:7, color: added ? C.red : '#000',
                      fontWeight:700, padding:'5px 12px', cursor:'pointer',
                      fontSize:11, whiteSpace:'nowrap', flexShrink:0
                    }}>
                    {added ? '− Quitar' : '+ Agregar'}
                  </button>
                </div>

                <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                  {c.sector && (
                    <span style={{ fontSize:9, background:sectorColor+'22', color:sectorColor,
                      padding:'2px 7px', borderRadius:99, fontWeight:600, letterSpacing:'0.05em' }}>
                      {c.sector}
                    </span>
                  )}
                  {c.mktCap && (
                    <span style={{ fontSize:9, background:C.border, color:C.muted,
                      padding:'2px 7px', borderRadius:99 }}>
                      {c.mktCap}
                    </span>
                  )}
                  {c.volume > 0 && (
                    <span style={{ fontSize:9, background:C.border, color:C.muted,
                      padding:'2px 7px', borderRadius:99 }}>
                      Vol {(c.volume/1e6).toFixed(1)}M
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!loading && !error && candidates.length === 0 && (
        <div style={{ textAlign:'center', padding:'60px 20px', color:C.muted }}>
          <div style={{ fontSize:32, marginBottom:12 }}>🔍</div>
          <div style={{ fontSize:14 }}>No se encontraron candidatos con los criterios actuales</div>
          <div style={{ fontSize:11, marginTop:6 }}>Intenta actualizar — el mercado cambia durante el día</div>
        </div>
      )}

      {!loading && candidates.length > 0 && (
        <div style={{ marginTop:16, padding:'10px 14px', background:C.card, borderRadius:8,
          border:`1px solid ${C.border}`, fontSize:11, color:C.muted }}>
          <b style={{ color:C.amber }}>Aviso:</b> Estas acciones cumplen criterios técnicos iniciales.
          Analiza cada una con la app antes de operar — el screener es un punto de partida, no una recomendación de compra.
        </div>
      )}
    </div>
  )
}
