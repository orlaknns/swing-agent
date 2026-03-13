import { useState, useCallback } from 'react'
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

async function fetchAnalysis(ticker) {
  const res = await fetch(`/api/analyze/${ticker}`)
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.detail || 'Error al analizar')
  }
  return res.json()
}

export default function StockCard({ ticker, onRemove }) {
  const [data,     setData]     = useState(null)
  const [loading,  setLoading]  = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [ready,    setReady]    = useState(false)

  const run = useCallback(async () => {
    setLoading(true); setData(null); setExpanded(false)
    try   { setData(await fetchAnalysis(ticker)) }
    catch (e) { setData({ error: e.message }) }
    setLoading(false)
  }, [ticker])

  const signalColor = data?.signal === 'buy' ? C.green : data?.signal === 'sell' ? C.red : C.amber
  const cardBorder  = !data || data.error ? C.border
    : data.signal === 'buy'  ? `${C.green}55`
    : data.signal === 'sell' ? `${C.red}55`
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
          <span style={{ fontFamily:'monospace', fontWeight:700, fontSize:15, color:C.text, letterSpacing:'0.05em', flexShrink:0 }}>{ticker}</span>
          {data && !data.error && <Badge type={data.strategy} />}
        </div>
        <div style={{ display:'flex', gap:4, alignItems:'center', flexShrink:0 }}>
          {data && !data.error && <Badge type={data.signal} />}
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
          </div>
          <Sparkline prices={data.prices20d} signal={data.signal} />
        </div>

        {/* Rango compra / SL */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:5 }}>
          <div style={{ background:C.bg, borderRadius:8, padding:'8px 10px' }}>
            <div style={{ fontSize:9, color:C.muted, letterSpacing:'0.07em', marginBottom:4, textTransform:'uppercase' }}>Rango compra</div>
            <div style={{ fontSize:11, fontWeight:700, color:C.green, fontFamily:'monospace' }}>
              ${data.entryLow?.toFixed(2)} – ${data.entryHigh?.toFixed(2)}
            </div>
          </div>
          <div style={{ background:C.bg, borderRadius:8, padding:'8px 10px', textAlign:'right' }}>
            <div style={{ fontSize:9, color:C.muted, letterSpacing:'0.07em', marginBottom:4, textTransform:'uppercase' }}>Stop-loss</div>
            <div style={{ fontSize:12, fontWeight:700, color:C.red, fontFamily:'monospace' }}>${data.stopLoss?.toFixed(2)}</div>
          </div>
        </div>

        {/* Salida escalonada */}
        <div style={{ background:C.bg, borderRadius:8, padding:'8px 10px' }}>
          <div style={{ fontSize:9, color:C.muted, letterSpacing:'0.07em', marginBottom:6, textTransform:'uppercase' }}>Salida escalonada</div>
          {[
            { label:'Breakeven (mover SL)', val:data.breakeven, color:C.amber,  pct:'—'    },
            { label:'Obj. 1 · vender ⅓',   val:data.target1,   color:C.accent, pct:'1/3'  },
            { label:'Obj. 2 · vender ⅓',   val:data.target2,   color:C.accent, pct:'1/3'  },
            { label:'Obj. 3 · vender ⅓',   val:data.target3,   color:C.green,  pct:'1/3'  },
          ].map(({ label, val, color, pct }) => (
            <div key={label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'3px 0', borderBottom:`1px solid ${C.border}` }}>
              <span style={{ fontSize:11, color:C.muted }}>{label}</span>
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                {pct !== '—' && <span style={{ fontSize:9, color:C.muted, background:`${C.border}`, borderRadius:4, padding:'1px 5px' }}>{pct}</span>}
                <span style={{ fontSize:12, fontWeight:700, color, fontFamily:'monospace' }}>${val?.toFixed(2) ?? '—'}</span>
              </div>
            </div>
          ))}
        </div>

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
        {data.fundamentals && Object.keys(data.fundamentals).length > 0 && (() => {
          const f = data.fundamentals
          const rows = [
            f.sector        && { label:'Sector',         val:f.sector,                             color:C.text   },
            f.marketCap     && { label:'Market cap',     val:f.marketCap,                          color:C.text   },
            f.peRatio       && { label:'P/E ratio',      val:f.peRatio?.toFixed(1)+'x',            color:C.text   },
            f.eps           && { label:'EPS',            val:'$'+f.eps?.toFixed(2),                color:C.text   },
            f.epsGrowth     != null && { label:'Crecim. EPS trim.', val:(f.epsGrowth>0?'+':'')+f.epsGrowth+'%', color:f.epsGrowth>0?C.green:C.red },
            f.roe           != null && { label:'ROE',             val:f.roe+'%',                   color:f.roe>15?C.green:C.text },
            f.revenueGrowth != null && { label:'Crecim. ventas',  val:(f.revenueGrowth>0?'+':'')+f.revenueGrowth+'%', color:f.revenueGrowth>0?C.green:C.red },
            f.analystTarget && { label:'Precio objetivo anal.', val:'$'+f.analystTarget?.toFixed(2), color:C.accent },
          ].filter(Boolean)
          // Agregar earnings fuera del array de fundamentals (viene del nivel superior)
          const earningsRow = data.nextEarnings ? [{
            label: 'Próx. earnings',
            val: (() => {
              const d = new Date(data.nextEarnings + 'T00:00:00')
              const today = new Date()
              const days = Math.ceil((d - today) / (1000*60*60*24))
              const dateStr = d.toLocaleDateString('es-CL', {day:'numeric', month:'short'})
              return days <= 14
                ? dateStr + ' ⚠️ ' + days + 'd'
                : dateStr + ' (' + days + 'd)'
            })(),
            color: (() => {
              const d = new Date(data.nextEarnings + 'T00:00:00')
              const days = Math.ceil((d - new Date()) / (1000*60*60*24))
              return days <= 14 ? C.red : days <= 30 ? C.amber : C.muted
            })()
          }] : []
          const allRows = [...rows, ...earningsRow]
          if (!rows.length) return null
          return (
            <div style={{ background:C.bg, borderRadius:8, padding:'8px 10px' }}>
              <div style={{ fontSize:9, color:C.muted, letterSpacing:'0.07em', marginBottom:6, textTransform:'uppercase' }}>Fundamentales</div>
              {allRows.map(({ label, val, color }) => (
                <div key={label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'3px 0', borderBottom:`1px solid ${C.border}` }}>
                  <span style={{ fontSize:11, color:C.muted }}>{label}</span>
                  <span style={{ fontSize:11, fontWeight:600, color, fontFamily:'monospace' }}>{val}</span>
                </div>
              ))}
            </div>
          )
        })()}

        {/* Expandable analysis */}
        <button onClick={() => setExpanded(!expanded)}
          style={{ background:'none', border:`1px solid ${C.border}`, borderRadius:7, color:C.muted, cursor:'pointer', padding:'6px 10px', fontSize:11, textAlign:'left', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span>Análisis detallado</span><span>{expanded ? '▲' : '▼'}</span>
        </button>

        {expanded && (
          <div style={{ background:C.bg, borderRadius:8, padding:'12px 14px', fontSize:12, color:C.text, lineHeight:1.8, borderLeft:`3px solid ${signalColor}` }}>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:8, alignItems:'center' }}>
              <span style={{ fontSize:10, color:C.muted }}>Tendencia:</span><Badge type={data.trend} />
              <span style={{ fontSize:10, color:C.muted, marginLeft:6 }}>Nivel clave:</span>
              <span style={{ fontSize:10, color:C.amber, fontFamily:'monospace', fontWeight:700 }}>${data.keyLevel}</span>
              <span style={{ fontSize:10, color:C.muted, marginLeft:6 }}>Éxito est.:</span>
              <span style={{ fontSize:10, color:C.amber, fontFamily:'monospace', fontWeight:700 }}>{data.successRate}%</span>
            </div>
            {data.analysis}
          </div>
        )}
      </>)}
    </div>
  )
}
