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

const SIGNAL_LABEL = { buy:'COMPRAR', sell:'VENDER', hold:'ESPERAR', avoid:'EVITAR', monitor:'MONITOREAR' }
const SIGNAL_COLOR = { buy:'#00e096', sell:'#ff4060', hold:'#ffb800', avoid:'#888888', monitor:'#00aaff' }

export default function Discover({ watchlist, monitorList = [], openTrades = {}, analysisCache = {}, onAdd, onRemove, onAddAll }) {
  const [candidates, setCandidates] = useState([])
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState(null)
  const [filter, setFilter]         = useState('all')
  const [screenerDate, setScreenerDate] = useState(null)
  const [source, setSource]         = useState(null)
  const [updatedAt, setUpdatedAt]   = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState(null)
  const [preview, setPreview]       = useState(null)
  const [previewData, setPreviewData] = useState(null)
  const [previewLoad, setPreviewLoad] = useState(false)

  const openPreview = async (ticker) => {
    setPreview(ticker)
    if (analysisCache[ticker]) {
      setPreviewData(analysisCache[ticker])
      return
    }
    setPreviewData(null)
    setPreviewLoad(true)
    try {
      const res = await fetch(`/api/analyze/${ticker}`)
      if (res.ok) setPreviewData(await res.json())
    } catch {}
    setPreviewLoad(false)
  }

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

  const triggerRefresh = async () => {
    setRefreshing(true)
    setRefreshMsg(null)
    try {
      const res = await fetch('/api/screener/refresh', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        setRefreshMsg({ ok: true, text: 'Actualizando... listo en ~90 segundos' })
        // Recarga automática después de 90 segundos (GitHub Actions tarda ~60-90s)
        setTimeout(() => { load(); setRefreshMsg(null) }, 90000)
      } else {
        setRefreshMsg({ ok: false, text: data.error || 'Error al actualizar' })
      }
    } catch {
      setRefreshMsg({ ok: false, text: 'No se pudo conectar con el servidor' })
    }
    setRefreshing(false)
  }

  const sectors = ['all', ...new Set(candidates.map(c => c.sector).filter(Boolean))]
  const filtered = filter === 'all' ? candidates : candidates.filter(c => c.sector === filter)
  const inWatchlist = (ticker) => watchlist.includes(ticker)
  const inMonitor   = (ticker) => monitorList.includes(ticker)
  const hasOpenTrade = (ticker) => !!openTrades[ticker]

  return (
    <div style={{ maxWidth:960, margin:'0 auto', padding:'0 20px 48px' }}>

      {/* Header */}
      <div style={{ marginBottom:16 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <h2 style={{ fontSize:18, fontWeight:700, color:C.text, margin:0 }}>Descubrir acciones</h2>
          <button
            onClick={triggerRefresh}
            disabled={refreshing}
            style={{ background: refreshing ? C.border : C.accent+'22', border:`1px solid ${refreshing ? C.border : C.accent}`,
              borderRadius:7, color: refreshing ? C.muted : C.accent,
              fontWeight:700, padding:'6px 14px', cursor: refreshing ? 'default' : 'pointer', fontSize:11 }}>
            {refreshing ? 'Actualizando...' : '↻ Actualizar screener'}
          </button>
        </div>
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

      {/* Refresh message */}
      {refreshMsg && (
        <div style={{ background: refreshMsg.ok ? C.green+'11' : C.red+'11',
          border:`1px solid ${refreshMsg.ok ? C.green : C.red}44`,
          borderRadius:8, padding:'8px 14px', marginBottom:12, fontSize:12,
          color: refreshMsg.ok ? C.green : C.red }}>
          {refreshMsg.text}
        </div>
      )}

      {/* Criterios */}
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:'10px 14px', marginBottom:16, fontSize:11, color:C.muted }}>
        <span style={{ color:C.accent, fontWeight:700 }}>Criterios de filtrado: </span>
        SMA21 cruzó sobre SMA50 (tendencia alcista reciente) · RSI entre 30 y 60 (zona de pullback) · Precio &gt; $20 · Volumen promedio &gt; 500k · NYSE y NASDAQ
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
            const added      = inWatchlist(c.ticker)
            const monitoring = inMonitor(c.ticker)
            const openTrade  = hasOpenTrade(c.ticker)
            const sectorColor = SECTOR_COLORS[c.sector] || C.muted
            // Color del borde izquierdo según estado
            const leftBorder = openTrade ? C.green : monitoring ? '#00aaff' : added ? C.accent : sectorColor
            return (
              <div key={c.ticker} onClick={() => openPreview(c.ticker)} style={{
                background:C.card,
                border:`1px solid ${openTrade ? C.green+'44' : monitoring ? '#00aaff33' : added ? C.accent+'44' : C.border}`,
                borderRadius:10, padding:'12px 14px',
                borderLeft:`3px solid ${leftBorder}`,
                cursor:'pointer', transition:'border-color 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = C.accent+'66'}
              onMouseLeave={e => e.currentTarget.style.borderColor = openTrade ? C.green+'44' : monitoring ? '#00aaff33' : added ? C.accent+'44' : C.border}
              >
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8 }}>
                  <div>
                    <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                      <span style={{ fontSize:16, fontWeight:700, color:C.text, fontFamily:'monospace' }}>{c.ticker}</span>
                      {c.price > 0 && <span style={{ fontSize:12, color:C.muted, fontFamily:'monospace' }}>${c.price}</span>}
                      {openTrade && (
                        <span style={{ fontSize:9, background:C.green+'22', color:C.green, padding:'2px 7px', borderRadius:99, fontWeight:700 }}>
                          📈 Trade abierto
                        </span>
                      )}
                      {monitoring && !openTrade && (
                        <span style={{ fontSize:9, background:'#00aaff22', color:'#00aaff', padding:'2px 7px', borderRadius:99, fontWeight:700 }}>
                          👁 En seguimiento
                        </span>
                      )}
                      {added && !openTrade && !monitoring && (
                        <span style={{ fontSize:9, background:C.accent+'22', color:C.accent, padding:'2px 7px', borderRadius:99, fontWeight:700 }}>
                          ✓ En watchlist
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize:11, color:C.muted, marginTop:2, maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {c.company}
                    </div>
                  </div>
                  {/* Botón: deshabilitado si ya tiene trade abierto o está en seguimiento */}
                  {openTrade || monitoring ? (
                    <span style={{ fontSize:10, color:C.muted, padding:'5px 8px', flexShrink:0 }}>
                      {openTrade ? 'Trade activo' : 'En seguimiento'}
                    </span>
                  ) : (
                    <button
                      onClick={e => { e.stopPropagation(); added ? onRemove(c.ticker) : onAdd(c.ticker) }}
                      style={{
                        background: added ? C.red+'22' : C.accent,
                        border: added ? `1px solid ${C.red}66` : 'none',
                        borderRadius:7, color: added ? C.red : '#000',
                        fontWeight:700, padding:'5px 12px', cursor:'pointer',
                        fontSize:11, whiteSpace:'nowrap', flexShrink:0
                      }}>
                      {added ? '− Quitar' : '+ Agregar'}
                    </button>
                  )}
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

      {/* Modal vista previa */}
      {preview && (
        <div onClick={() => { setPreview(null); setPreviewData(null) }}
          style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:3000,
            display:'flex', alignItems:'center', justifyContent:'center', padding:'24px 16px' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14,
              width:'100%', maxWidth:360, padding:'18px', display:'flex', flexDirection:'column', gap:12 }}>

            {/* Header */}
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <span style={{ fontSize:18, fontWeight:700, fontFamily:'monospace', color:C.text }}>{preview}</span>
                {previewData?.signal && (
                  <span style={{ fontSize:9, fontWeight:700, padding:'2px 8px', borderRadius:99,
                    color: SIGNAL_COLOR[previewData.signal], background: SIGNAL_COLOR[previewData.signal]+'18',
                    border:`1px solid ${SIGNAL_COLOR[previewData.signal]}44` }}>
                    {SIGNAL_LABEL[previewData.signal] || previewData.signal}
                  </span>
                )}
              </div>
              <button onClick={() => { setPreview(null); setPreviewData(null) }}
                style={{ background:'none', border:`1px solid ${C.border}`, borderRadius:5,
                  color:C.muted, cursor:'pointer', padding:'3px 8px', fontSize:13 }}>×</button>
            </div>

            {/* Loading */}
            {previewLoad && (
              <div style={{ textAlign:'center', padding:'24px', color:C.muted, fontSize:12 }}>
                Analizando {preview}…
              </div>
            )}

            {/* Sin datos */}
            {!previewLoad && !previewData && (
              <div style={{ textAlign:'center', padding:'16px', color:C.muted, fontSize:11 }}>
                No hay análisis en caché — agrega a watchlist para analizar
              </div>
            )}

            {/* Datos */}
            {previewData && !previewLoad && (() => {
              const d = previewData
              const daysToEarn = d.next_earnings ? (() => {
                try { return Math.ceil((new Date(d.next_earnings) - new Date()) / (1000*60*60*24)) } catch { return null }
              })() : null
              return (
                <>
                  {/* 4 indicadores */}
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:6 }}>
                    {[
                      ['RSI', d.rsi != null ? d.rsi?.toFixed(1) : '—',
                        d.rsi > 65 ? C.red : d.rsi < 40 ? C.amber : C.green],
                      ['SMA21', d.sma21 != null ? `$${d.sma21?.toFixed(2)}` : '—', C.accent],
                      ['Score', d.score != null ? `${d.score}` : '—',
                        d.score >= 75 ? C.green : d.score >= 45 ? C.amber : C.red],
                      ['R:B', d.risk_reward != null ? `${d.risk_reward?.toFixed(1)}x` : '—',
                        d.risk_reward >= 2.5 ? C.green : C.red],
                    ].map(([label, val, color]) => (
                      <div key={label} style={{ background:C.bg, borderRadius:6, padding:'7px 10px' }}>
                        <div style={{ fontSize:8, color:C.muted, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:2 }}>{label}</div>
                        <div style={{ fontSize:11, fontWeight:700, color, fontFamily:'monospace' }}>{val}</div>
                      </div>
                    ))}
                  </div>

                  {/* Entrada / Stop / Target */}
                  {(d.entry_low || d.stop_loss || d.target) && (
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:6 }}>
                      {[
                        ['Entrada', d.entry_mid ? `$${d.entry_mid?.toFixed(2)}` : d.entry_low ? `$${d.entry_low?.toFixed(2)}` : '—', C.amber],
                        ['Stop',    d.stop_loss  ? `$${d.stop_loss?.toFixed(2)}`  : '—', C.red],
                        ['Target',  d.target     ? `$${d.target?.toFixed(2)}`     : '—', C.green],
                      ].map(([label, val, color]) => (
                        <div key={label} style={{ background:C.bg, borderRadius:6, padding:'6px 8px', textAlign:'center' }}>
                          <div style={{ fontSize:8, color:C.muted, textTransform:'uppercase', marginBottom:2 }}>{label}</div>
                          <div style={{ fontSize:11, fontWeight:700, color, fontFamily:'monospace' }}>{val}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Earnings warning */}
                  {daysToEarn != null && daysToEarn >= 0 && daysToEarn <= 21 && (
                    <div style={{ fontSize:10, borderRadius:6, padding:'6px 10px',
                      background: daysToEarn < 7 ? C.red+'22' : C.amber+'22',
                      border:`1px solid ${daysToEarn < 7 ? C.red : C.amber}44`,
                      color: daysToEarn < 7 ? C.red : C.amber, fontWeight:600 }}>
                      {daysToEarn < 7 ? '🔴' : '⚠️'} Earnings en {daysToEarn} días ({d.next_earnings})
                    </div>
                  )}

                  {/* Botón agregar */}
                  <button onClick={() => {
                    watchlist.includes(preview) ? onRemove(preview) : onAdd(preview)
                    setPreview(null); setPreviewData(null)
                  }} style={{
                    background: watchlist.includes(preview) ? C.red+'22' : C.accent,
                    border: watchlist.includes(preview) ? `1px solid ${C.red}66` : 'none',
                    borderRadius:8, color: watchlist.includes(preview) ? C.red : '#000',
                    fontWeight:700, padding:'9px', cursor:'pointer', fontSize:12, width:'100%'
                  }}>
                    {watchlist.includes(preview) ? '− Quitar de watchlist' : '+ Agregar a watchlist'}
                  </button>
                </>
              )
            })()}
          </div>
        </div>
      )}
    </div>
  )
}
