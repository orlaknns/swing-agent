import { useState, useEffect } from 'react'

const C = {
  bg:'#070d1a', card:'#0f1929', border:'#1a2d45',
  accent:'#00d4ff', green:'#00e096', red:'#ff4060',
  amber:'#ffb800', text:'#dde6f0', muted:'#4a6080',
  card2:'#111f33',
}

const LS_KEY = 'swing_agent_journal'
const STATUS_LABELS = { open:'Abierta', breakeven:'Breakeven movido', partial:'Parcial cerrada', closed:'Cerrada' }
const STATUS_COLORS = { open:C.accent, breakeven:C.amber, partial:C.amber, closed:C.muted }

function loadTrades() {
  try { const s = localStorage.getItem(LS_KEY); return s ? JSON.parse(s) : [] }
  catch { return [] }
}

function saveTrades(trades) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(trades)) } catch {}
}

function fmt(n) { return n != null ? `$${Number(n).toFixed(2)}` : '—' }
function fmtPct(n) { return n != null ? `${n > 0 ? '+' : ''}${Number(n).toFixed(2)}%` : '—' }

// ── Export to CSV (opens in Excel/Sheets) ──────────────────────────────
function exportToCSV(trades) {
  const headers = [
    'Fecha entrada','Ticker','Señal','Estrategia','Tendencia',
    'Precio análisis','Entrada real','Tamaño pos.','Rango compra bajo','Rango compra alto',
    'Stop-loss','Breakeven','Obj.1','Obj.2','Obj.3',
    'R:B','RSI','EMA20','EMA50','SMA200','Mansfield RS',
    'EPS','ROE%','Crecim.EPS%','Crecim.Ventas%','Market Cap','P/E','Próx.Earnings',
    'Estado','Días abierta','Vigencia setup','Precio cierre','P&L %','Notas'
  ]

  const rows = trades.map(t => {
    const f = t.fundamentals || {}
    const pnl = t.exitPrice && t.entryPrice
      ? (((t.exitPrice - t.entryPrice) / t.entryPrice) * 100).toFixed(2)
      : ''
    return [
      t.date, t.ticker, t.signal, t.strategy, t.trend,
      t.price, t.entryPrice || '', t.positionSize || '',
      t.entryLow, t.entryHigh,
      t.stopLoss, t.breakeven, t.target1, t.target2, t.target3,
      t.rr, t.rsi, t.ema20, t.ema50, t.sma200 || '', t.mansfieldRS || '',
      f.eps || '', f.roe || '', f.epsGrowth || '', f.revenueGrowth || '',
      f.marketCap || '', f.peRatio || '', t.nextEarnings || '',
      STATUS_LABELS[t.status] || t.status,
      t.status !== 'closed' ? calcDaysOpen(t.date) : '',
      t.status !== 'closed' ? (calcDaysOpen(t.date) <= 3 ? 'Alta' : calcDaysOpen(t.date) <= 7 ? 'Media' : 'Baja') : '',
      t.exitPrice || '', pnl, t.notes || ''
    ]
  })

  const csv = [headers, ...rows]
    .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n')

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url
  a.download = `trading-journal-${new Date().toISOString().slice(0,10)}.csv`
  a.click(); URL.revokeObjectURL(url)
}

// ── Trade detail / edit modal ──────────────────────────────────────────
function TradeModal({ trade, onSave, onClose }) {
  const [form, setForm] = useState({
    entryPrice:    trade.entryPrice    || trade.price || '',
    positionSize:  trade.positionSize  || '',
    exitPrice:     trade.exitPrice     || '',
    status:        trade.status        || 'open',
    notes:         trade.notes         || '',
  })

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const pnl = form.exitPrice && form.entryPrice
    ? (((form.exitPrice - form.entryPrice) / form.entryPrice) * 100).toFixed(2)
    : null

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:24, width:'100%', maxWidth:480, maxHeight:'90vh', overflowY:'auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <div>
            <span style={{ fontSize:20, fontWeight:700, color:C.text }}>{trade.ticker}</span>
            <span style={{ fontSize:12, color:C.muted, marginLeft:10 }}>{trade.date}</span>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:C.muted, fontSize:20, cursor:'pointer' }}>×</button>
        </div>

        {/* Análisis original snapshot */}
        <div style={{ background:C.bg, borderRadius:8, padding:12, marginBottom:16, fontSize:11 }}>
          <div style={{ color:C.muted, letterSpacing:'0.07em', fontSize:9, marginBottom:8, textTransform:'uppercase' }}>Análisis al momento de entrada</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
            {[
              ['Precio análisis', fmt(trade.price)],
              ['RSI(14)', trade.rsi],
              ['Rango compra', `${fmt(trade.entryLow)} – ${fmt(trade.entryHigh)}`],
              ['Stop-loss', fmt(trade.stopLoss)],
              ['Breakeven', fmt(trade.breakeven)],
              ['Obj. 1', fmt(trade.target1)],
              ['Obj. 2', fmt(trade.target2)],
              ['Obj. 3', fmt(trade.target3)],
              ['R:B', trade.rr ? `${trade.rr}x` : '—'],
              ['Mansfield RS', trade.mansfieldRS ?? '—'],
              ['EMA20', fmt(trade.ema20)],
              ['SMA200', trade.sma200 ? fmt(trade.sma200) : '—'],
            ].map(([l, v]) => (
              <div key={l}>
                <span style={{ color:C.muted }}>{l}: </span>
                <span style={{ color:C.text, fontFamily:'monospace' }}>{v}</span>
              </div>
            ))}
          </div>
          {trade.analysis && (
            <div style={{ marginTop:8, color:C.text, lineHeight:1.6, borderTop:`1px solid ${C.border}`, paddingTop:8 }}>
              {trade.analysis}
            </div>
          )}
        </div>

        {/* Editable fields */}
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <label>
              <div style={{ fontSize:10, color:C.muted, marginBottom:4 }}>Precio entrada real</div>
              <input type="number" value={form.entryPrice} onChange={e => set('entryPrice', e.target.value)}
                style={{ width:'100%', background:C.bg, border:`1px solid ${C.border}`, borderRadius:6, padding:'7px 10px', color:C.text, fontSize:13 }} />
            </label>
            <label>
              <div style={{ fontSize:10, color:C.muted, marginBottom:4 }}>Tamaño posición ($)</div>
              <input type="number" value={form.positionSize} onChange={e => set('positionSize', e.target.value)}
                style={{ width:'100%', background:C.bg, border:`1px solid ${C.border}`, borderRadius:6, padding:'7px 10px', color:C.text, fontSize:13 }} />
            </label>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <label>
              <div style={{ fontSize:10, color:C.muted, marginBottom:4 }}>Precio cierre (si cerrada)</div>
              <input type="number" value={form.exitPrice} onChange={e => set('exitPrice', e.target.value)}
                style={{ width:'100%', background:C.bg, border:`1px solid ${C.border}`, borderRadius:6, padding:'7px 10px', color:C.text, fontSize:13 }} />
            </label>
            <label>
              <div style={{ fontSize:10, color:C.muted, marginBottom:4 }}>Estado</div>
              <select value={form.status} onChange={e => set('status', e.target.value)}
                style={{ width:'100%', background:C.bg, border:`1px solid ${C.border}`, borderRadius:6, padding:'7px 10px', color:C.text, fontSize:13 }}>
                {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
          </div>

          {pnl && (
            <div style={{ background:C.bg, borderRadius:6, padding:'8px 12px', textAlign:'center' }}>
              <span style={{ fontSize:12, color:C.muted }}>P&L estimado: </span>
              <span style={{ fontSize:16, fontWeight:700, fontFamily:'monospace', color: pnl > 0 ? C.green : C.red }}>
                {fmtPct(pnl)}
                {form.positionSize && ` · $${((pnl/100) * form.positionSize).toFixed(0)}`}
              </span>
            </div>
          )}

          <label>
            <div style={{ fontSize:10, color:C.muted, marginBottom:4 }}>Notas</div>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3}
              placeholder="Por qué entré, qué pasó, qué aprendí…"
              style={{ width:'100%', background:C.bg, border:`1px solid ${C.border}`, borderRadius:6, padding:'7px 10px', color:C.text, fontSize:13, resize:'vertical', boxSizing:'border-box' }} />
          </label>

          <div style={{ display:'flex', gap:8 }}>
            <button onClick={() => onSave({ ...trade, ...form })}
              style={{ flex:1, background:C.accent, border:'none', borderRadius:8, color:'#000', fontWeight:700, padding:'10px', cursor:'pointer', fontSize:13 }}>
              Guardar cambios
            </button>
            <button onClick={onClose}
              style={{ background:'none', border:`1px solid ${C.border}`, borderRadius:8, color:C.muted, padding:'10px 16px', cursor:'pointer', fontSize:13 }}>
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Setup Decay: días en posición + recomendación ─────────────────────
function calcDaysOpen(dateStr) {
  try {
    const d = new Date(dateStr + 'T00:00:00')
    return Math.floor((new Date() - d) / (1000*60*60*24))
  } catch { return 0 }
}

function getSetupDecay(trade) {
  if (trade.status === 'closed') return null
  const days = calcDaysOpen(trade.date)

  // P&L actual (si tiene entrada real, úsala; si no, usa precio análisis)
  const entryRef = trade.entryPrice || trade.entryLow || trade.price
  const currentPnl = trade.exitPrice
    ? ((trade.exitPrice - entryRef) / entryRef) * 100
    : null

  // Semáforo
  let level, label, color, rec
  if (days <= 3) {
    level = 'green'; color = '#00e096'
    label = `Día ${days} — Setup activo`
    rec = 'Mantener el plan. El setup está dentro de su ventana óptima (1–3 días).'
  } else if (days <= 7) {
    level = 'yellow'; color = '#ffb800'
    label = `Día ${days} — Setup debilitándose`
    if (currentPnl !== null && currentPnl > 2) {
      rec = `Llevas ${currentPnl.toFixed(1)}% de ganancia y ${days} días. Considera vender si no avanza hoy — la presión compradora se está agotando.`
    } else if (currentPnl !== null && currentPnl < -1) {
      rec = `El precio no está respondiendo (${currentPnl.toFixed(1)}%) y llevas ${days} días. Evalúa salir antes de que alcance el stop-loss.`
    } else {
      rec = `El precio lleva ${days} días sin moverse significativamente. La probabilidad del setup baja cada día que pasa sin confirmación.`
    }
  } else {
    level = 'red'; color = '#ff4060'
    label = `Día ${days} — Alta probabilidad de invalidación`
    if (currentPnl !== null && currentPnl > 1) {
      rec = `Llevas ${days} días y aún hay ganancia (${currentPnl.toFixed(1)}%). Salir ahora libera capital para un setup más fresco. El tiempo jugó en tu contra.`
    } else if (currentPnl !== null && currentPnl >= -2) {
      rec = `${days} días sin moverse y casi en breakeven. Salir con pérdida mínima es mejor que esperar al stop-loss. Libera el capital.`
    } else {
      rec = `El setup lleva ${days} días y no se cumplió. La tesis original probablemente cambió. Revisar si los niveles originales siguen siendo válidos.`
    }
  }

  // Barra de vigencia (100% = día 0, 0% = día 10+)
  const pct = Math.max(0, Math.min(100, ((10 - days) / 10) * 100))
  return { days, level, color, label, rec, pct }
}

function SetupDecayBar({ trade }) {
  const decay = getSetupDecay(trade)
  if (!decay) return null
  return (
    <div style={{ marginTop:8, background:'#070d1a', borderRadius:8, padding:'8px 10px', borderLeft:`3px solid ${decay.color}` }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:5 }}>
        <span style={{ fontSize:10, color:decay.color, fontWeight:700, letterSpacing:'0.05em' }}>{decay.label}</span>
        <span style={{ fontSize:10, color:'#4a6080' }}>Vigencia del setup</span>
      </div>
      <div style={{ height:4, background:'#1a2d45', borderRadius:2, marginBottom:6, overflow:'hidden' }}>
        <div style={{ width:`${decay.pct}%`, height:'100%', background:decay.color, borderRadius:2, transition:'width 0.3s' }}/>
      </div>
      <div style={{ fontSize:11, color:'#dde6f0', lineHeight:1.6 }}>{decay.rec}</div>
    </div>
  )
}

// ── Main Journal component ─────────────────────────────────────────────
export default function Journal() {
  const [trades, setTrades]     = useState(loadTrades)
  const [selected, setSelected] = useState(null)
  const [filter, setFilter]     = useState('all')

  useEffect(() => saveTrades(trades), [trades])

  const update = (updated) => {
    setTrades(t => t.map(x => x.id === updated.id ? updated : x))
    setSelected(null)
  }

  const remove = (id) => {
    if (confirm('¿Eliminar esta operación del journal?'))
      setTrades(t => t.filter(x => x.id !== id))
  }

  const filtered = filter === 'all' ? trades : trades.filter(t => t.status === filter)

  const stats = {
    total:  trades.length,
    open:   trades.filter(t => t.status === 'open' || t.status === 'breakeven' || t.status === 'partial').length,
    closed: trades.filter(t => t.status === 'closed').length,
    wins:   trades.filter(t => t.status === 'closed' && t.exitPrice && t.entryPrice && t.exitPrice > t.entryPrice).length,
  }
  const winRate = stats.closed > 0 ? Math.round((stats.wins / stats.closed) * 100) : null

  return (
    <div style={{ maxWidth:960, margin:'0 auto', padding:'0 20px 48px' }}>

      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, flexWrap:'wrap', gap:10 }}>
        <div>
          <h2 style={{ fontSize:18, fontWeight:700, color:C.text, margin:0 }}>Trading Journal</h2>
          <p style={{ fontSize:11, color:C.muted, margin:'4px 0 0' }}>
            Registra y guarda el análisis de cada operación
          </p>
        </div>
        {trades.length > 0 && (
          <button onClick={() => exportToCSV(trades)}
            style={{ background:C.green, border:'none', borderRadius:8, color:'#000', fontWeight:700, padding:'9px 16px', cursor:'pointer', fontSize:12 }}>
            ↓ Exportar Excel / Sheets
          </button>
        )}
      </div>

      {/* Stats bar */}
      {trades.length > 0 && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:8, marginBottom:16 }}>
          {[
            { label:'Total ops.', val:stats.total, color:C.text },
            { label:'Abiertas',   val:stats.open,  color:C.accent },
            { label:'Cerradas',   val:stats.closed, color:C.muted },
            { label:'Win rate',   val: winRate != null ? `${winRate}%` : '—', color: winRate >= 50 ? C.green : winRate != null ? C.red : C.muted },
          ].map(({ label, val, color }) => (
            <div key={label} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:'10px', textAlign:'center' }}>
              <div style={{ fontSize:9, color:C.muted, letterSpacing:'0.07em', textTransform:'uppercase', marginBottom:4 }}>{label}</div>
              <div style={{ fontSize:20, fontWeight:700, color, fontFamily:'monospace' }}>{val}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filter tabs */}
      {trades.length > 0 && (
        <div style={{ display:'flex', gap:6, marginBottom:14 }}>
          {[['all','Todas'],['open','Abiertas'],['breakeven','Breakeven'],['partial','Parciales'],['closed','Cerradas']].map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)}
              style={{ background: filter===k ? C.accent : 'none', border:`1px solid ${filter===k ? C.accent : C.border}`, borderRadius:6, color: filter===k ? '#000' : C.muted, padding:'4px 12px', cursor:'pointer', fontSize:11, fontWeight: filter===k ? 700 : 400 }}>
              {l}
            </button>
          ))}
        </div>
      )}

      {/* Trades list */}
      {filtered.length === 0 && trades.length === 0 && (
        <div style={{ textAlign:'center', padding:'60px 20px', color:C.muted }}>
          <div style={{ fontSize:32, marginBottom:12 }}>📋</div>
          <div style={{ fontSize:14, marginBottom:6 }}>No hay operaciones registradas</div>
          <div style={{ fontSize:12 }}>Haz clic en <b style={{ color:C.accent }}>Guardar en journal</b> desde cualquier tarjeta de análisis</div>
        </div>
      )}

      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        {filtered.map(trade => {
          const pnl = trade.exitPrice && trade.entryPrice
            ? (((trade.exitPrice - trade.entryPrice) / trade.entryPrice) * 100).toFixed(2)
            : null
          const statusColor = STATUS_COLORS[trade.status] || C.muted

          return (
            <div key={trade.id} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:'12px 14px', borderLeft:`3px solid ${statusColor}` }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:8 }}>
                {/* Left: ticker + info */}
                <div style={{ display:'flex', gap:12, alignItems:'center', flexWrap:'wrap' }}>
                  <span style={{ fontSize:18, fontWeight:700, color:C.text, fontFamily:'monospace' }}>{trade.ticker}</span>
                  <span style={{ fontSize:10, background: trade.signal==='buy' ? '#00e09618' : trade.signal==='sell' ? '#ff406018' : '#ffb80018',
                    color: trade.signal==='buy' ? C.green : trade.signal==='sell' ? C.red : C.amber,
                    padding:'2px 8px', borderRadius:99, fontWeight:700 }}>
                    {trade.signal?.toUpperCase()}
                  </span>
                  <span style={{ fontSize:10, color:statusColor, border:`1px solid ${statusColor}`, padding:'2px 8px', borderRadius:99 }}>
                    {STATUS_LABELS[trade.status] || trade.status}
                  </span>
                  <span style={{ fontSize:11, color:C.muted }}>{trade.date}</span>
                </div>

                {/* Right: P&L + actions */}
                <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                  {pnl && (
                    <span style={{ fontSize:14, fontWeight:700, fontFamily:'monospace', color: pnl > 0 ? C.green : C.red }}>
                      {fmtPct(pnl)}
                    </span>
                  )}
                  <button onClick={() => setSelected(trade)}
                    style={{ background:C.accent+'22', border:`1px solid ${C.accent}`, borderRadius:6, color:C.accent, padding:'4px 10px', cursor:'pointer', fontSize:11 }}>
                    Editar
                  </button>
                  <button onClick={() => remove(trade.id)}
                    style={{ background:'none', border:`1px solid ${C.border}`, borderRadius:6, color:C.muted, padding:'4px 8px', cursor:'pointer', fontSize:11 }}>
                    ✕
                  </button>
                </div>
              </div>

              {/* Key levels row */}
              <div style={{ display:'flex', gap:16, marginTop:8, flexWrap:'wrap', fontSize:11 }}>
                <span><span style={{ color:C.muted }}>Precio: </span><span style={{ color:C.text, fontFamily:'monospace' }}>{fmt(trade.price)}</span></span>
                {trade.entryPrice && <span><span style={{ color:C.muted }}>Entrada real: </span><span style={{ color:C.green, fontFamily:'monospace' }}>{fmt(trade.entryPrice)}</span></span>}
                <span><span style={{ color:C.muted }}>SL: </span><span style={{ color:C.red, fontFamily:'monospace' }}>{fmt(trade.stopLoss)}</span></span>
                <span><span style={{ color:C.muted }}>T1: </span><span style={{ color:C.accent, fontFamily:'monospace' }}>{fmt(trade.target1)}</span></span>
                <span><span style={{ color:C.muted }}>T2: </span><span style={{ color:C.accent, fontFamily:'monospace' }}>{fmt(trade.target2)}</span></span>
                <span><span style={{ color:C.muted }}>T3: </span><span style={{ color:C.green, fontFamily:'monospace' }}>{fmt(trade.target3)}</span></span>
                <span><span style={{ color:C.muted }}>R:B: </span><span style={{ color: trade.rr >= 2 ? C.green : C.amber, fontFamily:'monospace' }}>{trade.rr}x</span></span>
                {trade.nextEarnings && <span><span style={{ color:C.muted }}>Earnings: </span><span style={{ color:C.amber, fontFamily:'monospace' }}>{trade.nextEarnings}</span></span>}
              </div>

              {trade.notes && (
                <div style={{ marginTop:8, fontSize:11, color:C.muted, fontStyle:'italic', borderTop:`1px solid ${C.border}`, paddingTop:6 }}>
                  {trade.notes}
                </div>
              )}
              <SetupDecayBar trade={trade} />
            </div>
          )
        })}
      </div>

      {selected && (
        <TradeModal trade={selected} onSave={update} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}

// ── Exported helper: save a trade from StockCard ───────────────────────
export function saveTradeToJournal(data) {
  const trades = loadTrades()
  const newTrade = {
    id:           Date.now().toString(),
    date:         new Date().toISOString().slice(0, 10),
    ticker:       data.ticker,
    signal:       data.signal,
    strategy:     data.strategy,
    trend:        data.trend,
    price:        data.price,
    entryLow:     data.entryLow,
    entryHigh:    data.entryHigh,
    stopLoss:     data.stopLoss,
    breakeven:    data.breakeven,
    target1:      data.target1,
    target2:      data.target2,
    target3:      data.target3,
    rr:           data.rr,
    rsi:          data.rsi,
    ema20:        data.ema20,
    ema50:        data.ema50,
    sma200:       data.sma200,
    mansfieldRS:  data.mansfieldRS,
    nextEarnings: data.nextEarnings,
    fundamentals: data.fundamentals,
    analysis:     data.analysis,
    status:       'open',
    entryPrice:   null,
    positionSize: null,
    exitPrice:    null,
    notes:        '',
  }
  saveTrades([newTrade, ...trades])
  return newTrade
}
