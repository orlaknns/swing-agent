import { useState, useCallback, useEffect } from 'react'
import { saveTradeToJournal } from './Journal.jsx'
import { LineChart, Line, ResponsiveContainer, Tooltip } from 'recharts'

const C = {
  bg:'#070d1a', card:'#0f1929', border:'#1a2d45',
  accent:'#00d4ff', green:'#00e096', red:'#ff4060',
  amber:'#ffb800', text:'#dde6f0', muted:'#4a6080',
}

const BADGE = {
  buy:      { bg:'#00e09618', text:'#00e096', label:'COMPRAR' },
  sell:     { bg:'#ff406018', text:'#ff4060', label:'VENDER'  },
  hold:     { bg:'#ffb80018', text:'#ffb800', label:'ESPERAR' },
  avoid:    { bg:'#88888818', text:'#888888', label:'EVITAR'  },
  monitor:  { bg:'#00aaff18', text:'#00aaff', label:'MONITOREAR' },
  pullback: { bg:'#00d4ff18', text:'#00d4ff', label:'Pullback' },
  breakout: { bg:'#a78bfa18', text:'#a78bfa', label:'Ruptura'  },
  reversal: { bg:'#fb923c18', text:'#fb923c', label:'Reversión'},
  neutral:  { bg:'#4a608018', text:'#4a6080', label:'Neutral'  },
  bullish:  { bg:'#00e09618', text:'#00e096', label:'Alcista'  },
  bearish:  { bg:'#ff406018', text:'#ff4060', label:'Bajista'  },
  sideways: { bg:'#ffb80018', text:'#ffb800', label:'Lateral'  },
}

function Badge({ type }) {
  const s = BADGE[type] || BADGE.neutral
  return (
    <span style={{ background:s.bg, color:s.text, fontSize:10, fontWeight:700, padding:'3px 9px', borderRadius:99, letterSpacing:'0.06em', whiteSpace:'nowrap' }}>
      {s.label}
    </span>
  )
}

function ConfidenceBadge({ signal, stars }) {
  if (!stars || stars === 0) return null
  const isBuy  = signal === 'buy'
  const isSell = signal === 'sell'
  if (!isBuy && !isSell) return null
  const color = stars === 3 ? C.green : stars === 2 ? C.amber : '#ff8c00'
  const filled = '★'.repeat(stars)
  const empty  = '☆'.repeat(3 - stars)
  return (
    <span style={{ fontSize:11, color, fontWeight:700, letterSpacing:'0.05em' }}>
      {filled}{empty}
    </span>
  )
}

function RRBar({ rr }) {
  const pct   = Math.min(((rr || 0) / 4) * 100, 100)
  const color = rr >= 2 ? C.green : rr >= 1 ? C.amber : C.red
  return (
    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
      <div style={{ flex:1, height:3, background:C.border, borderRadius:2, overflow:'hidden' }}>
        <div style={{ width:`${pct}%`, height:'100%', background:color, borderRadius:2 }}/>
      </div>
      <span style={{ fontSize:11, color, fontFamily:'monospace', fontWeight:700, minWidth:28 }}>{(rr||0).toFixed(1)}x</span>
    </div>
  )
}

function Sparkline({ prices, signal }) {
  if (!prices || prices.length < 2) return null
  const color  = signal === 'buy' ? C.green : signal === 'sell' ? C.red : C.accent
  const data   = prices.map((v, i) => ({ i, v }))
  return (
    <div style={{ width:150, height:40 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} />
          <Tooltip
            contentStyle={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:6, fontSize:11 }}
            formatter={v => [`$${v.toFixed(2)}`, '']}
            labelFormatter={() => ''}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

async function fetchAnalysis(ticker, attempt = 1) {
  const delay = ms => new Promise(r => setTimeout(r, ms))
  try {
    const res = await fetch(`/api/analyze/${ticker}`)
    if (!res.ok) {
      // 503/502 = servidor reiniciando, reintentar
      if ((res.status === 502 || res.status === 503) && attempt < 3) {
        await delay(attempt * 2000)
        return fetchAnalysis(ticker, attempt + 1)
      }
      let msg = `Error ${res.status}`
      try { const err = await res.json(); msg = err.detail || msg } catch {}
      throw new Error(msg)
    }
    return await res.json()
  } catch (e) {
    // Error de red (servidor caído/reiniciando), reintentar hasta 3 veces
    if (e.name === 'TypeError' && attempt < 3) {
      await delay(attempt * 2000)
      return fetchAnalysis(ticker, attempt + 1)
    }
    throw new Error(attempt > 1
      ? `Sin conexión con el servidor (${attempt} intentos). Railway puede estar reiniciando, espera 30 segundos e intenta de nuevo.`
      : e.message
    )
  }
}


function earningsDays(dateStr) {
  try {
    const d = new Date(dateStr + 'T00:00:00')
    return Math.ceil((d - new Date()) / (1000*60*60*24))
  } catch { return null }
}

function FundamentalsBlock({ f, nextEarnings }) {
  if (!f || Object.keys(f).length === 0) return null
  const rows = [
    f.sector        ? { label:'Sector',         val: f.sector,                                               color: C.text   } : null,
    f.marketCap     ? { label:'Market cap',      val: f.marketCap,                                            color: C.text   } : null,
    f.peRatio       ? { label:'P/E ratio',       val: f.peRatio.toFixed(1) + 'x',                             color: C.text   } : null,
    f.eps           ? { label:'EPS',             val: '$' + f.eps.toFixed(2),                                 color: C.text   } : null,
    f.epsGrowth     != null ? { label:'Crecim. EPS',   val: (f.epsGrowth > 0 ? '+' : '') + f.epsGrowth + '%',   color: f.epsGrowth > 0 ? C.green : C.red } : null,
    f.roe           != null ? { label:'ROE',            val: f.roe + '%',                                        color: f.roe > 15 ? C.green : C.text } : null,
    f.revenueGrowth != null ? { label:'Crecim. ventas', val: (f.revenueGrowth > 0 ? '+' : '') + f.revenueGrowth + '%', color: f.revenueGrowth > 0 ? C.green : C.red } : null,
    f.analystTarget ? { label:'Obj. analistas',  val: '$' + f.analystTarget.toFixed(2),                       color: C.accent } : null,
  ].filter(Boolean)

  if (nextEarnings) {
    const days = earningsDays(nextEarnings)
    if (days !== null) {
      let dateLabel = nextEarnings
      try { dateLabel = new Date(nextEarnings + 'T00:00:00').toLocaleDateString('es-CL', {day:'numeric', month:'short'}) } catch {}
      rows.push({
        label: 'Prox. earnings',
        val:   days <= 14 ? dateLabel + ' !! ' + days + 'd' : dateLabel + ' (' + days + 'd)',
        color: days <= 14 ? C.red : days <= 30 ? C.amber : C.muted
      })
    }
  }

  if (!rows.length) return null
  return (
    <div style={{ background:C.bg, borderRadius:8, padding:'8px 10px' }}>
      <div style={{ fontSize:9, color:C.muted, letterSpacing:'0.07em', marginBottom:6, textTransform:'uppercase' }}>Fundamentales</div>
      {rows.map(function(row) {
        return (
          <div key={row.label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'3px 0', borderBottom:'1px solid ' + C.border }}>
            <span style={{ fontSize:11, color:C.muted }}>{row.label}</span>
            <span style={{ fontSize:11, fontWeight:600, color:row.color, fontFamily:'monospace' }}>{row.val}</span>
          </div>
        )
      })}
    </div>
  )
}

const round2 = (n) => Math.round(n * 100) / 100

export default function StockCard({ ticker, onRemove, session, onMonitor, onAnalysed, cachedData, isInMonitorTab }) {
  const [data,         setData]         = useState(cachedData || null)
  const [loading,      setLoading]      = useState(false)
  const [expanded,     setExpanded]     = useState(false)
  const [ready,        setReady]        = useState(!!cachedData)
  const [journalSaved, setJournalSaved] = useState(false)
  const [showIBKR,     setShowIBKR]     = useState(false)

  // Sync with cache when prop updates (e.g. moving to En Seguimiento)
  useEffect(() => {
    if (cachedData && !data) {
      setData(cachedData)
      setReady(true)
    }
  }, [cachedData])

  const saveToJournal = async () => {
    if (!data || data.error || !session) return
    await saveTradeToJournal(data, session.user.id)
    setJournalSaved(true)
    setShowIBKR(true)
    setTimeout(() => setJournalSaved(false), 2000)
  }

  const run = useCallback(async () => {
    setLoading(true); setData(null); setExpanded(false)
    try   {
      const json = await fetchAnalysis(ticker)
      setData(json)
      if (onAnalysed) onAnalysed(ticker, json)
    }
    catch (e) { setData({ error: e.message }) }
    setLoading(false)
  }, [ticker])

  const signalColor = data?.signal === 'buy' ? C.green : data?.signal === 'sell' ? C.red : data?.signal === 'monitor' ? '#00aaff' : C.amber
  const cardBorder  = !data || data.error ? C.border
    : data.signal === 'buy'  ? `${C.green}55`
    : data.signal === 'sell' ? `${C.red}55`
    : data.signal === 'monitor' ? '#00aaff33'
    : C.border

  /* ── Not yet triggered ── */
  if (!ready) {
    return (
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:16, display:'flex', flexDirection:'column', gap:10 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <span style={{ fontFamily:'monospace', fontWeight:700, fontSize:15, color:C.text, letterSpacing:'0.05em' }}>{ticker}</span>
          <button onClick={() => onRemove(ticker)} style={{ background:'none', border:'none', color:C.muted, cursor:'pointer', fontSize:17 }}>×</button>
        </div>
        <button onClick={() => { setReady(true); run() }}
          style={{ background:`${C.accent}15`, border:`1px solid ${C.accent}55`, borderRadius:8, color:C.accent, cursor:'pointer', padding:9, fontSize:12, fontWeight:700, letterSpacing:'0.06em' }}>
          ANALIZAR ↗
        </button>
      </div>
    )
  }

  return (
    <div style={{ background:C.card, border:`1px solid ${cardBorder}`, borderRadius:12, padding:16, display:'flex', flexDirection:'column', gap:10, transition:'border-color 0.4s' }}>
      {/* Title row */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:6 }}>
        <div style={{ display:'flex', alignItems:'center', gap:7, minWidth:0 }}>
          <div style={{ display:'flex', flexDirection:'column', minWidth:0 }}>
            <span style={{ fontFamily:'monospace', fontWeight:700, fontSize:15, color:C.text, letterSpacing:'0.05em' }}>{ticker}</span>
            {data?.fundamentals?.name && (
              <span style={{ fontSize:10, color:C.muted, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:160 }}>
                {data.fundamentals.name}
              </span>
            )}
          </div>
          {data && !data.error && <Badge type={data.strategy} />}
        </div>
        <div style={{ display:'flex', gap:4, alignItems:'center', flexShrink:0 }}>
          {data && !data.error && <Badge type={data.signal} />}
          {data && !data.error && <ConfidenceBadge signal={data.signal} stars={data.confidenceStars} />}
          <button onClick={run} disabled={loading}
            style={{ background:'none', border:`1px solid ${C.border}`, borderRadius:6, color:C.muted, cursor:loading?'not-allowed':'pointer', padding:'3px 7px', fontSize:11 }}>↻</button>
          <button onClick={() => onRemove(ticker)}
            style={{ background:'none', border:'none', color:C.muted, cursor:'pointer', fontSize:17, padding:'0 3px' }}>×</button>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 0' }}>
          <div style={{ width:13, height:13, border:`2px solid ${C.border}`, borderTop:`2px solid ${C.accent}`, borderRadius:'50%', animation:'spin 0.7s linear infinite', flexShrink:0 }}/>
          <span style={{ fontSize:12, color:C.muted }}>Obteniendo datos reales…</span>
        </div>
      )}

      {/* Error */}
      {data?.error && <div style={{ color:C.red, fontSize:12 }}>{data.error}</div>}

      {/* Data */}
      {data && !data.error && !loading && (<>
        {/* Price + chart */}
        <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between', gap:8 }}>
          <div>
            <div style={{ fontSize:22, fontWeight:700, color:C.text, fontFamily:'monospace', lineHeight:1 }}>${data.price?.toFixed(2)}</div>
            <div style={{ fontSize:11, color:data.change >= 0 ? C.green : C.red, fontFamily:'monospace', marginTop:3 }}>
              {data.change >= 0 ? '+' : ''}{data.change?.toFixed(2)}% hoy
            </div>
            <div style={{ fontSize:9, color:C.muted, marginTop:3, opacity:0.6 }}>
              ⏱ hasta 15 min delay · confirma precio en broker
            </div>
          </div>
          <Sparkline prices={data.prices20d} signal={data.signal} />
        </div>

        {/* Rango entrada / SL — etiquetas según señal */}
        {(() => {
          const isSell = data.signal === 'sell'
          const rangoLabel = isSell ? 'Rango venta' : 'Rango compra'
          const rangoColor = isSell ? C.red : C.green
          const slLabel    = isSell ? 'Stop-loss (al alza)' : 'Stop-loss'
          return (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:5 }}>
              <div style={{ background:C.bg, borderRadius:8, padding:'8px 10px' }}>
                <div style={{ fontSize:9, color:C.muted, letterSpacing:'0.07em', marginBottom:4, textTransform:'uppercase' }}>{rangoLabel}</div>
                <div style={{ fontSize:11, fontWeight:700, color:rangoColor, fontFamily:'monospace' }}>
                  ${data.entryLow?.toFixed(2)} – ${data.entryHigh?.toFixed(2)}
                </div>
              </div>
              <div style={{ background:C.bg, borderRadius:8, padding:'8px 10px', textAlign:'right' }}>
                <div style={{ fontSize:9, color:C.muted, letterSpacing:'0.07em', marginBottom:4, textTransform:'uppercase' }}>{slLabel}</div>
                <div style={{ fontSize:12, fontWeight:700, color:C.red, fontFamily:'monospace' }}>${data.stopLoss?.toFixed(2)}</div>
                <div style={{ fontSize:10, color:C.red, marginTop:2, opacity:0.8 }}>
                  {data.stopLoss && data.entryLow
                    ? `${(((data.stopLoss - ((data.entryLow + data.entryHigh)/2)) / ((data.entryLow + data.entryHigh)/2)) * 100).toFixed(1)}% desde entrada`
                    : ''}
                </div>
              </div>
            </div>
          )
        })()}

        {/* Objetivo fijo set-and-forget */}
        <div style={{ background:C.bg, borderRadius:8, padding:'10px 12px' }}>
          <div style={{ fontSize:9, color:C.muted, letterSpacing:'0.07em', marginBottom:6, textTransform:'uppercase' }}>
            {data.signal === 'sell' ? 'Objetivo (cubrir posición)' : 'Objetivo (toma de ganancia)'}
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <div>
              <div style={{ fontSize:18, fontWeight:700, color:C.green, fontFamily:'monospace' }}>
                ${data.target?.toFixed(2) ?? '—'}
              </div>
              <div style={{ fontSize:10, color:C.muted, marginTop:2 }}>
                {data.target && data.entryLow
                  ? `${(((data.target - ((data.entryLow + data.entryHigh)/2)) / ((data.entryLow + data.entryHigh)/2)) * 100).toFixed(1)}% desde entrada`
                  : ''}
              </div>
            </div>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:10, color:C.muted, marginBottom:2 }}>Plazo máximo</div>
              <div style={{ fontSize:13, fontWeight:700, color:C.amber }}>{data.maxDays ?? 20} días</div>
            </div>
          </div>
        </div>

        {/* MONITOREAR — razón y condición de espera */}
        {data.signal === 'monitor' && (
          <div style={{ background:'#001a2a', border:'1px solid #00aaff44', borderRadius:8, padding:'10px 12px' }}>
            <div style={{ fontSize:9, color:'#00aaff', letterSpacing:'0.07em', marginBottom:6, textTransform:'uppercase', fontWeight:700 }}>
              Por qué monitorear
            </div>
            <div style={{ fontSize:11, color:'#00aaff', fontWeight:600, marginBottom:8 }}>
              ℹ {data.signalJustification}
            </div>
            <div style={{ fontSize:10, color:'#4a8080', borderTop:'1px solid #00aaff22', paddingTop:6, marginBottom:8 }}>
              Condiciones técnicas favorables (score {data.successRate}%). Revisar cuando el evento se resuelva.
            </div>
            {onMonitor && (
              <button onClick={() => onMonitor(ticker, !isInMonitorTab)}
                style={{ width:'100%', background: isInMonitorTab ? '#00aaff11' : '#00aaff22',
                  border:'1px solid #00aaff55', borderRadius:6,
                  color:'#00aaff', fontSize:11, fontWeight:700, padding:'6px', cursor:'pointer' }}>
                {isInMonitorTab ? '← Volver a Watchlist activa' : '+ Mover a En Seguimiento'}
              </button>
            )}
          </div>
        )}

        {/* Indicators */}
        <div style={{ display:'flex', flexDirection:'column', gap:7, fontSize:11 }}>
          <div style={{ display:'flex', justifyContent:'space-between' }}>
            <span style={{ color:C.muted }}>RSI(14)</span>
            <span style={{ color:data.rsi < 30 ? C.green : data.rsi > 70 ? C.red : C.text, fontFamily:'monospace', fontWeight:700 }}>{data.rsi?.toFixed(0)}</span>
          </div>
          <div style={{ display:'flex', justifyContent:'space-between' }}>
            <span style={{ color:C.muted }}>EMA20</span>
            <span style={{ color:C.text, fontFamily:'monospace' }}>${data.ema20?.toFixed(2)}</span>
          </div>
          <div style={{ display:'flex', justifyContent:'space-between' }}>
            <span style={{ color:C.muted }}>EMA50</span>
            <span style={{ color:C.text, fontFamily:'monospace' }}>${data.ema50?.toFixed(2)}</span>
          </div>
          {data.sma200 != null && (
            <div style={{ display:'flex', justifyContent:'space-between' }}>
              <span style={{ color:C.muted }}>SMA200</span>
              <span style={{ color: data.price > data.sma200 ? C.green : C.red, fontFamily:'monospace' }}>
                ${data.sma200?.toFixed(2)}
                <span style={{ fontSize:9, marginLeft:4, opacity:0.7 }}>
                  {data.price > data.sma200 ? '▲ alcista' : '▼ bajista'}
                </span>
              </span>
            </div>
          )}
          <div style={{ display:'flex', justifyContent:'space-between' }}>
            <span style={{ color:C.muted }}>Volumen vs avg</span>
            <span style={{ color:data.volRatio > 120 ? C.green : C.text, fontFamily:'monospace' }}>{data.volRatio}%</span>
          </div>
          {data.momentum4w != null && (
            <div style={{ display:'flex', justifyContent:'space-between' }}>
              <span style={{ color:C.muted }}>Momentum 4 sem.</span>
              <span style={{ color: data.momentum4w > 15 ? C.red : data.momentum4w > 0 ? C.green : C.red, fontFamily:'monospace', fontWeight:600 }}>
                {data.momentum4w > 0 ? '+' : ''}{data.momentum4w?.toFixed(1)}%
              </span>
            </div>
          )}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
            <span style={{ color:C.muted, flexShrink:0 }}>R:B</span>
            <div style={{ flex:1 }}><RRBar rr={data.rr} /></div>
          </div>
          {data.mansfieldRS != null && (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
              <span style={{ color:C.muted, flexShrink:0 }}>Mansfield RS</span>
              <div style={{ display:'flex', alignItems:'center', gap:6, flex:1, justifyContent:'flex-end' }}>
                <div style={{ width:80, height:3, background:C.border, borderRadius:2, overflow:'hidden', position:'relative' }}>
                  <div style={{
                    position:'absolute',
                    left: data.mansfieldRS >= 0 ? '50%' : `${50 + (data.mansfieldRS / 5) * 50}%`,
                    width: `${Math.abs(data.mansfieldRS) / 5 * 50}%`,
                    height:'100%',
                    background: data.mansfieldRS >= 0 ? C.green : C.red,
                    borderRadius:2
                  }}/>
                  <div style={{ position:'absolute', left:'50%', top:0, width:1, height:'100%', background:C.muted }}/>
                </div>
                <span style={{
                  fontSize:11, fontWeight:700, fontFamily:'monospace', minWidth:36, textAlign:'right',
                  color: data.mansfieldRS > 1 ? C.green : data.mansfieldRS < -1 ? C.red : C.amber
                }}>
                  {data.mansfieldRS > 0 ? '+' : ''}{data.mansfieldRS?.toFixed(1)}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Fundamentals */}
        <FundamentalsBlock f={data.fundamentals} nextEarnings={data.nextEarnings} />

        {/* Expandable analysis */}
        <button onClick={() => setExpanded(!expanded)}
          style={{ background:'none', border:`1px solid ${C.border}`, borderRadius:7, color:C.muted, cursor:'pointer', padding:'6px 10px', fontSize:11, textAlign:'left', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span>Análisis detallado</span><span>{expanded ? '▲' : '▼'}</span>
        </button>

        {/* Score de probabilidad */}
        {data.successRate != null && (
          <div style={{ background:C.bg, borderRadius:8, padding:'10px 12px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
              <span style={{ fontSize:10, color:C.muted, textTransform:'uppercase', letterSpacing:'0.07em' }}>Probabilidad de éxito</span>
              <span style={{ fontSize:16, fontWeight:700, fontFamily:'monospace',
                color: data.successRate >= 65 ? C.green : data.successRate >= 45 ? C.amber : C.red }}>
                {data.successRate}%
              </span>
            </div>
            <div style={{ height:5, background:C.border, borderRadius:3, overflow:'hidden' }}>
              <div style={{ width:`${data.successRate}%`, height:'100%', borderRadius:3,
                background: data.successRate >= 65 ? C.green : data.successRate >= 45 ? C.amber : C.red }}/>
            </div>
            <div style={{ fontSize:9, color:C.muted, marginTop:4 }}>
              Calculado en base a RSI, tendencia, volumen, Mansfield RS, earnings y R:B
            </div>
          </div>
        )}

        {/* Alertas y contradicciones */}
        {((data.alerts && data.alerts.length > 0) || (data.contradictions && data.contradictions.length > 0) || data.signalJustification || data.avoidReason) && (() => {
          const isHighConf = data.confidenceStars === 3
          const isAvoid    = data.signal === 'avoid'
          const bgColor    = isHighConf ? '#0a1a0a' : '#1a0a0a'
          const borderColor= isHighConf ? C.green+'44' : C.red+'44'
          const titleColor = isHighConf ? C.green : C.red
          const titleLabel = isHighConf ? 'Información adicional' : 'Alertas y advertencias'
          const justColor  = isAvoid ? C.red : isHighConf ? C.green : C.amber
          const justIcon   = isAvoid ? '⊘ ' : isHighConf ? '✓ ' : 'ℹ '
          return (
            <div style={{ background:bgColor, border:`1px solid ${borderColor}`, borderRadius:8, padding:'10px 12px' }}>
              <div style={{ fontSize:9, color:titleColor, letterSpacing:'0.07em', marginBottom:6, textTransform:'uppercase', fontWeight:700 }}>
                {titleLabel}
              </div>
              {(data.signalJustification || data.avoidReason) && (
                <div style={{ fontSize:11, color:justColor, marginBottom:6, fontWeight:600 }}>
                  {justIcon}{data.signalJustification || data.avoidReason}
                </div>
              )}
              {data.contradictions && data.contradictions.map((c, i) => (
                <div key={i} style={{ fontSize:11, color: isHighConf ? C.muted : C.amber, marginBottom:4, paddingLeft:8, borderLeft:`2px solid ${isHighConf ? C.border : C.amber}` }}>
                  {c}
                </div>
              ))}
              {data.alerts && data.alerts.map((a, i) => (
                <div key={i} style={{ fontSize:11, color:C.muted, marginBottom:3, paddingLeft:8, borderLeft:`2px solid ${C.border}` }}>
                  {a}
                </div>
              ))}
            </div>
          )
        })()}

        {expanded && (
          <div style={{ background:C.bg, borderRadius:8, padding:'12px 14px', fontSize:12, color:C.text, lineHeight:1.8, borderLeft:`3px solid ${signalColor}` }}>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:8, alignItems:'center' }}>
              <span style={{ fontSize:10, color:C.muted }}>Tendencia:</span><Badge type={data.trend} />
              <span style={{ fontSize:10, color:C.muted, marginLeft:6 }}>Nivel clave:</span>
              <span style={{ fontSize:10, color:C.amber, fontFamily:'monospace', fontWeight:700 }}>${data.keyLevel}</span>
            </div>
            {data.analysis}
          </div>
        )}
        {/* Save to journal button + IBKR config note */}
        {data && !data.error && !loading && (
          <>
            <button onClick={saveToJournal}
              style={{ width:'100%', background: journalSaved ? C.green+'22' : 'none',
                border:`1px solid ${journalSaved ? C.green : C.border}`,
                borderRadius:7, color: journalSaved ? C.green : C.muted,
                cursor:'pointer', padding:'7px 10px', fontSize:11,
                transition:'all 0.2s', display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
              {journalSaved ? '✓ Guardado en journal' : '📋 Guardar en journal'}
            </button>

            {/* IBKR OCO config note — shown after saving */}
            {showIBKR && data.entryLow && data.stopLoss && data.target && (() => {
              const isSell    = data.signal === 'sell'
              const stopLimit = isSell
                ? round2(data.stopLoss * 1.01)   // SELL: stop al alza, límite 1% más arriba
                : round2(data.stopLoss * 0.99)   // BUY: stop a la baja, límite 1% más abajo
              return (
                <div style={{ background:'#0a1628', border:'1px solid #00d4ff33', borderRadius:8, padding:'10px 12px', marginTop:4 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                    <div style={{ fontSize:9, color:C.accent, letterSpacing:'0.07em', textTransform:'uppercase', fontWeight:700 }}>
                      Configuración OCO en IBKR
                    </div>
                    <button onClick={() => setShowIBKR(false)}
                      style={{ background:'none', border:'none', color:C.muted, cursor:'pointer', fontSize:14, padding:'0 2px' }}>×</button>
                  </div>
                  <div style={{ fontSize:10, color:C.muted, marginBottom:6 }}>
                    Usa <b style={{color:C.text}}>Stop Limit</b> en vez de Stop Market para evitar slippage
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:4 }}>
                    {[
                      ['Take Profit (Limit)', `$${data.target?.toFixed(2)}`, C.green],
                      ['Stop Price', `$${data.stopLoss?.toFixed(2)}`, C.red],
                      ['Stop Limit Price', `$${stopLimit?.toFixed(2)}`, C.amber],
                      ['Tipo orden', 'Stop Limit + Limit (OCO)', C.accent],
                    ].map(([label, val, color]) => (
                      <div key={label} style={{ background:C.card, borderRadius:5, padding:'4px 7px' }}>
                        <div style={{ fontSize:9, color:C.muted }}>{label}</div>
                        <div style={{ fontSize:11, fontWeight:700, color, fontFamily:'monospace' }}>{val}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}
          </>
        )}
      </>)}
    </div>
  )
}
