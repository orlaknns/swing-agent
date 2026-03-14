import { useState, useEffect } from 'react'
import { supabase } from './supabase.js'

const C = {
  bg:'#070d1a', card:'#0f1929', border:'#1a2d45',
  accent:'#00d4ff', green:'#00e096', red:'#ff4060',
  amber:'#ffb800', text:'#dde6f0', muted:'#4a6080',
}

const STATUS_LABELS = { open:'Abierta', breakeven:'Breakeven movido', partial:'Parcial cerrada', closed:'Cerrada' }
const STATUS_COLORS = { open:C.accent, breakeven:C.amber, partial:C.amber, closed:C.muted }

function fmt(n) { return n != null ? `$${Number(n).toFixed(2)}` : '—' }
function fmtPct(n) { return n != null ? `${n > 0 ? '+' : ''}${Number(n).toFixed(2)}%` : '—' }

function calcDaysOpen(dateStr) {
  try { return Math.floor((new Date() - new Date(dateStr + 'T00:00:00')) / (1000*60*60*24)) }
  catch { return 0 }
}

function getSetupDecay(trade) {
  if (trade.status === 'closed') return null
  const days = calcDaysOpen(trade.date)
  const entryRef = trade.entryPrice || trade.entryLow || trade.price
  const pnl = trade.exitPrice ? ((trade.exitPrice - entryRef) / entryRef) * 100 : null
  let color, label, rec
  if (days <= 3) {
    color = C.green; label = `Día ${days} — Setup activo`
    rec = 'Mantener el plan. El setup está dentro de su ventana óptima (1–3 días).'
  } else if (days <= 7) {
    color = C.amber; label = `Día ${days} — Setup debilitándose`
    if (pnl !== null && pnl > 2) rec = `Llevas ${pnl.toFixed(1)}% de ganancia y ${days} días. Considera vender si no avanza hoy.`
    else if (pnl !== null && pnl < -1) rec = `El precio no responde (${pnl.toFixed(1)}%) y llevas ${days} días. Evalúa salir antes del stop-loss.`
    else rec = `El precio lleva ${days} días sin moverse. La probabilidad del setup baja cada día sin confirmación.`
  } else {
    color = C.red; label = `Día ${days} — Alta probabilidad de invalidación`
    if (pnl !== null && pnl > 1) rec = `Llevas ${days} días con ganancia (${pnl.toFixed(1)}%). Salir libera capital para un setup más fresco.`
    else if (pnl !== null && pnl >= -2) rec = `${days} días sin moverse y casi en breakeven. Salir con pérdida mínima es mejor que esperar al stop-loss.`
    else rec = `El setup lleva ${days} días y no se cumplió. Revisar si la tesis original sigue válida.`
  }
  const pct = Math.max(0, Math.min(100, ((10 - days) / 10) * 100))
  return { days, color, label, rec, pct }
}

function SetupDecayBar({ trade }) {
  const d = getSetupDecay(trade)
  if (!d) return null
  return (
    <div style={{ marginTop:8, background:C.bg, borderRadius:8, padding:'8px 10px', borderLeft:`3px solid ${d.color}` }}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:5 }}>
        <span style={{ fontSize:10, color:d.color, fontWeight:700 }}>{d.label}</span>
        <span style={{ fontSize:10, color:C.muted }}>Vigencia del setup</span>
      </div>
      <div style={{ height:4, background:C.border, borderRadius:2, marginBottom:6, overflow:'hidden' }}>
        <div style={{ width:`${d.pct}%`, height:'100%', background:d.color, borderRadius:2 }}/>
      </div>
      <div style={{ fontSize:11, color:C.text, lineHeight:1.6 }}>{d.rec}</div>
    </div>
  )
}

function exportToCSV(trades) {
  const headers = ['Fecha','Ticker','Señal','Estrategia','Tendencia','Precio','Entrada real','Tamaño pos.',
    'Rango bajo','Rango alto','Stop-loss','Breakeven','Obj.1','Obj.2','Obj.3','R:B',
    'RSI','EMA20','EMA50','SMA200','Mansfield RS','EPS','ROE%','Crecim.EPS%','Crecim.Ventas%',
    'Market Cap','P/E','Próx.Earnings','Estado','Días abierta','Vigencia setup','Precio cierre','P&L %','Notas']
  const rows = trades.map(t => {
    const f = t.fundamentals || {}
    const pnl = t.exitPrice && t.entryPrice ? (((t.exitPrice - t.entryPrice) / t.entryPrice) * 100).toFixed(2) : ''
    const days = t.status !== 'closed' ? calcDaysOpen(t.date) : ''
    const vigor = t.status !== 'closed' ? (calcDaysOpen(t.date) <= 3 ? 'Alta' : calcDaysOpen(t.date) <= 7 ? 'Media' : 'Baja') : ''
    return [t.date, t.ticker, t.signal, t.strategy, t.trend, t.price, t.entryPrice||'', t.positionSize||'',
      t.entryLow, t.entryHigh, t.stopLoss, t.breakeven, t.target1, t.target2, t.target3, t.rr,
      t.rsi, t.ema20, t.ema50, t.sma200||'', t.mansfieldRS||'',
      f.eps||'', f.roe||'', f.epsGrowth||'', f.revenueGrowth||'', f.marketCap||'', f.peRatio||'', t.nextEarnings||'',
      STATUS_LABELS[t.status]||t.status, days, vigor, t.exitPrice||'', pnl, t.notes||'']
  })
  const csv = [headers,...rows].map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n')
  const blob = new Blob(['\uFEFF'+csv], {type:'text/csv;charset=utf-8;'})
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href=url; a.download=`journal-${new Date().toISOString().slice(0,10)}.csv`
  a.click(); URL.revokeObjectURL(url)
}

function TradeModal({ trade, onSave, onClose }) {
  const [form, setForm] = useState({
    entryPrice: trade.entryPrice || trade.price || '',
    positionSize: trade.positionSize || '',
    exitPrice: trade.exitPrice || '',
    status: trade.status || 'open',
    notes: trade.notes || '',
  })
  const set = (k,v) => setForm(f=>({...f,[k]:v}))
  const pnl = form.exitPrice && form.entryPrice
    ? (((form.exitPrice - form.entryPrice) / form.entryPrice) * 100).toFixed(2) : null

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:24, width:'100%', maxWidth:480, maxHeight:'90vh', overflowY:'auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <div><span style={{ fontSize:20, fontWeight:700, color:C.text }}>{trade.ticker}</span>
            <span style={{ fontSize:12, color:C.muted, marginLeft:10 }}>{trade.date}</span></div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:C.muted, fontSize:20, cursor:'pointer' }}>×</button>
        </div>
        <div style={{ background:C.bg, borderRadius:8, padding:12, marginBottom:16, fontSize:11 }}>
          <div style={{ color:C.muted, fontSize:9, marginBottom:8, textTransform:'uppercase', letterSpacing:'0.07em' }}>Análisis al momento de entrada</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
            {[['Precio',fmt(trade.price)],['RSI',trade.rsi],['Rango',`${fmt(trade.entryLow)}–${fmt(trade.entryHigh)}`],
              ['Stop-loss',fmt(trade.stopLoss)],['Breakeven',fmt(trade.breakeven)],['Obj.1',fmt(trade.target1)],
              ['Obj.2',fmt(trade.target2)],['Obj.3',fmt(trade.target3)],['R:B',trade.rr?`${trade.rr}x`:'—'],
              ['Mansfield RS',trade.mansfieldRS??'—'],['EMA20',fmt(trade.ema20)],['SMA200',trade.sma200?fmt(trade.sma200):'—'],
            ].map(([l,v]) => <div key={l}><span style={{color:C.muted}}>{l}: </span><span style={{color:C.text,fontFamily:'monospace'}}>{v}</span></div>)}
          </div>
          {trade.analysis && <div style={{ marginTop:8, color:C.text, lineHeight:1.6, borderTop:`1px solid ${C.border}`, paddingTop:8 }}>{trade.analysis}</div>}
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            {[['Precio entrada real','entryPrice'],['Tamaño posición ($)','positionSize']].map(([l,k])=>(
              <label key={k}><div style={{fontSize:10,color:C.muted,marginBottom:4}}>{l}</div>
                <input type="number" value={form[k]} onChange={e=>set(k,e.target.value)}
                  style={{width:'100%',background:C.bg,border:`1px solid ${C.border}`,borderRadius:6,padding:'7px 10px',color:C.text,fontSize:13,boxSizing:'border-box'}}/></label>
            ))}
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <label><div style={{fontSize:10,color:C.muted,marginBottom:4}}>Precio cierre</div>
              <input type="number" value={form.exitPrice} onChange={e=>set('exitPrice',e.target.value)}
                style={{width:'100%',background:C.bg,border:`1px solid ${C.border}`,borderRadius:6,padding:'7px 10px',color:C.text,fontSize:13,boxSizing:'border-box'}}/></label>
            <label><div style={{fontSize:10,color:C.muted,marginBottom:4}}>Estado</div>
              <select value={form.status} onChange={e=>set('status',e.target.value)}
                style={{width:'100%',background:C.bg,border:`1px solid ${C.border}`,borderRadius:6,padding:'7px 10px',color:C.text,fontSize:13}}>
                {Object.entries(STATUS_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}
              </select></label>
          </div>
          {pnl && <div style={{background:C.bg,borderRadius:6,padding:'8px 12px',textAlign:'center'}}>
            <span style={{fontSize:12,color:C.muted}}>P&L estimado: </span>
            <span style={{fontSize:16,fontWeight:700,fontFamily:'monospace',color:pnl>0?C.green:C.red}}>
              {fmtPct(pnl)}{form.positionSize && ` · $${((pnl/100)*form.positionSize).toFixed(0)}`}
            </span></div>}
          <label><div style={{fontSize:10,color:C.muted,marginBottom:4}}>Notas</div>
            <textarea value={form.notes} onChange={e=>set('notes',e.target.value)} rows={3}
              placeholder="Por qué entré, qué pasó, qué aprendí…"
              style={{width:'100%',background:C.bg,border:`1px solid ${C.border}`,borderRadius:6,padding:'7px 10px',color:C.text,fontSize:13,resize:'vertical',boxSizing:'border-box'}}/></label>
          <div style={{display:'flex',gap:8}}>
            <button onClick={()=>onSave({...trade,...form})}
              style={{flex:1,background:C.accent,border:'none',borderRadius:8,color:'#000',fontWeight:700,padding:'10px',cursor:'pointer',fontSize:13}}>
              Guardar cambios</button>
            <button onClick={onClose}
              style={{background:'none',border:`1px solid ${C.border}`,borderRadius:8,color:C.muted,padding:'10px 16px',cursor:'pointer',fontSize:13}}>
              Cancelar</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Journal({ session }) {
  const [trades,   setTrades]   = useState([])
  const [loading,  setLoading]  = useState(true)
  const [selected, setSelected] = useState(null)
  const [filter,   setFilter]   = useState('all')

  // Load from Supabase
  useEffect(() => {
    if (!session) return
    supabase.from('journal').select('*').eq('user_id', session.user.id).order('created_at', { ascending:false })
      .then(({ data }) => { if (data) setTrades(data.map(dbToTrade)); setLoading(false) })
  }, [session])

  const update = async (updated) => {
    const row = tradeToDb(updated, session.user.id)
    await supabase.from('journal').update(row).eq('id', updated.id)
    setTrades(t => t.map(x => x.id === updated.id ? updated : x))
    setSelected(null)
  }

  const remove = async (id) => {
    if (!confirm('¿Eliminar esta operación?')) return
    await supabase.from('journal').delete().eq('id', id)
    setTrades(t => t.filter(x => x.id !== id))
  }

  const filtered = filter === 'all' ? trades : trades.filter(t => t.status === filter)
  const stats = {
    total:  trades.length,
    open:   trades.filter(t => ['open','breakeven','partial'].includes(t.status)).length,
    closed: trades.filter(t => t.status === 'closed').length,
    wins:   trades.filter(t => t.status==='closed' && t.exitPrice && t.entryPrice && t.exitPrice > t.entryPrice).length,
  }
  const winRate = stats.closed > 0 ? Math.round((stats.wins/stats.closed)*100) : null

  if (loading) return <div style={{textAlign:'center',padding:60,color:C.muted}}>Cargando journal...</div>

  return (
    <div style={{ maxWidth:960, margin:'0 auto', padding:'0 20px 48px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, flexWrap:'wrap', gap:10 }}>
        <div>
          <h2 style={{ fontSize:18, fontWeight:700, color:C.text, margin:0 }}>Trading Journal</h2>
          <p style={{ fontSize:11, color:C.muted, margin:'4px 0 0' }}>Sincronizado en la nube — accede desde cualquier dispositivo</p>
        </div>
        {trades.length > 0 && (
          <button onClick={() => exportToCSV(trades)}
            style={{ background:C.green, border:'none', borderRadius:8, color:'#000', fontWeight:700, padding:'9px 16px', cursor:'pointer', fontSize:12 }}>
            Exportar Excel / Sheets
          </button>
        )}
      </div>

      {trades.length > 0 && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8, marginBottom:16 }}>
          {[['Total ops.',stats.total,C.text],['Abiertas',stats.open,C.accent],['Cerradas',stats.closed,C.muted],
            ['Win rate',winRate!=null?`${winRate}%`:'—',winRate>=50?C.green:winRate!=null?C.red:C.muted]
          ].map(([l,v,c])=>(
            <div key={l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:'10px',textAlign:'center'}}>
              <div style={{fontSize:9,color:C.muted,letterSpacing:'0.07em',textTransform:'uppercase',marginBottom:4}}>{l}</div>
              <div style={{fontSize:20,fontWeight:700,color:c,fontFamily:'monospace'}}>{v}</div>
            </div>
          ))}
        </div>
      )}

      {trades.length > 0 && (
        <div style={{ display:'flex', gap:6, marginBottom:14 }}>
          {[['all','Todas'],['open','Abiertas'],['breakeven','Breakeven'],['partial','Parciales'],['closed','Cerradas']].map(([k,l])=>(
            <button key={k} onClick={()=>setFilter(k)}
              style={{background:filter===k?C.accent:'none',border:`1px solid ${filter===k?C.accent:C.border}`,borderRadius:6,
                color:filter===k?'#000':C.muted,padding:'4px 12px',cursor:'pointer',fontSize:11,fontWeight:filter===k?700:400}}>
              {l}</button>
          ))}
        </div>
      )}

      {filtered.length === 0 && trades.length === 0 && (
        <div style={{textAlign:'center',padding:'60px 20px',color:C.muted}}>
          <div style={{fontSize:32,marginBottom:12}}>📋</div>
          <div style={{fontSize:14,marginBottom:6}}>No hay operaciones registradas</div>
          <div style={{fontSize:12}}>Haz clic en <b style={{color:C.accent}}>Guardar en journal</b> desde cualquier tarjeta de análisis</div>
        </div>
      )}

      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        {filtered.map(trade => {
          const pnl = trade.exitPrice && trade.entryPrice
            ? (((trade.exitPrice - trade.entryPrice) / trade.entryPrice) * 100).toFixed(2) : null
          const sc = STATUS_COLORS[trade.status] || C.muted
          return (
            <div key={trade.id} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:'12px 14px',borderLeft:`3px solid ${sc}`}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:8}}>
                <div style={{display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'}}>
                  <span style={{fontSize:18,fontWeight:700,color:C.text,fontFamily:'monospace'}}>{trade.ticker}</span>
                  <span style={{fontSize:10,background:trade.signal==='buy'?'#00e09618':'#ff406018',color:trade.signal==='buy'?C.green:C.red,padding:'2px 8px',borderRadius:99,fontWeight:700}}>
                    {trade.signal?.toUpperCase()}</span>
                  <span style={{fontSize:10,color:sc,border:`1px solid ${sc}`,padding:'2px 8px',borderRadius:99}}>
                    {STATUS_LABELS[trade.status]||trade.status}</span>
                  <span style={{fontSize:11,color:C.muted}}>{trade.date}</span>
                </div>
                <div style={{display:'flex',gap:8,alignItems:'center'}}>
                  {pnl && <span style={{fontSize:14,fontWeight:700,fontFamily:'monospace',color:pnl>0?C.green:C.red}}>{fmtPct(pnl)}</span>}
                  <button onClick={()=>setSelected(trade)}
                    style={{background:C.accent+'22',border:`1px solid ${C.accent}`,borderRadius:6,color:C.accent,padding:'4px 10px',cursor:'pointer',fontSize:11}}>
                    Editar</button>
                  <button onClick={()=>remove(trade.id)}
                    style={{background:'none',border:`1px solid ${C.border}`,borderRadius:6,color:C.muted,padding:'4px 8px',cursor:'pointer',fontSize:11}}>
                    ✕</button>
                </div>
              </div>
              <div style={{display:'flex',gap:16,marginTop:8,flexWrap:'wrap',fontSize:11}}>
                <span><span style={{color:C.muted}}>Precio: </span><span style={{color:C.text,fontFamily:'monospace'}}>{fmt(trade.price)}</span></span>
                {trade.entryPrice && <span><span style={{color:C.muted}}>Entrada: </span><span style={{color:C.green,fontFamily:'monospace'}}>{fmt(trade.entryPrice)}</span></span>}
                <span><span style={{color:C.muted}}>SL: </span><span style={{color:C.red,fontFamily:'monospace'}}>{fmt(trade.stopLoss)}</span></span>
                <span><span style={{color:C.muted}}>T1: </span><span style={{color:C.accent,fontFamily:'monospace'}}>{fmt(trade.target1)}</span></span>
                <span><span style={{color:C.muted}}>T2: </span><span style={{color:C.accent,fontFamily:'monospace'}}>{fmt(trade.target2)}</span></span>
                <span><span style={{color:C.muted}}>T3: </span><span style={{color:C.green,fontFamily:'monospace'}}>{fmt(trade.target3)}</span></span>
                <span><span style={{color:C.muted}}>R:B: </span><span style={{color:trade.rr>=2?C.green:C.amber,fontFamily:'monospace'}}>{trade.rr}x</span></span>
                {trade.nextEarnings && <span><span style={{color:C.muted}}>Earnings: </span><span style={{color:C.amber,fontFamily:'monospace'}}>{trade.nextEarnings}</span></span>}
              </div>
              {trade.notes && <div style={{marginTop:8,fontSize:11,color:C.muted,fontStyle:'italic',borderTop:`1px solid ${C.border}`,paddingTop:6}}>{trade.notes}</div>}
              <SetupDecayBar trade={trade} />
            </div>
          )
        })}
      </div>
      {selected && <TradeModal trade={selected} onSave={update} onClose={()=>setSelected(null)} />}
    </div>
  )
}

// ── DB mappers ─────────────────────────────────────────────────────────
function tradeToDb(t, userId) {
  return {
    id: t.id, user_id: userId, date: t.date, ticker: t.ticker,
    signal: t.signal, strategy: t.strategy, trend: t.trend, price: t.price,
    entry_low: t.entryLow, entry_high: t.entryHigh, stop_loss: t.stopLoss,
    breakeven: t.breakeven, target1: t.target1, target2: t.target2, target3: t.target3,
    rr: t.rr, rsi: t.rsi, ema20: t.ema20, ema50: t.ema50, sma200: t.sma200,
    mansfield_rs: t.mansfieldRS, next_earnings: t.nextEarnings,
    fundamentals: t.fundamentals, analysis: t.analysis,
    status: t.status, entry_price: t.entryPrice, position_size: t.positionSize,
    exit_price: t.exitPrice, notes: t.notes,
  }
}

function dbToTrade(r) {
  return {
    id: r.id, date: r.date, ticker: r.ticker,
    signal: r.signal, strategy: r.strategy, trend: r.trend, price: r.price,
    entryLow: r.entry_low, entryHigh: r.entry_high, stopLoss: r.stop_loss,
    breakeven: r.breakeven, target1: r.target1, target2: r.target2, target3: r.target3,
    rr: r.rr, rsi: r.rsi, ema20: r.ema20, ema50: r.ema50, sma200: r.sma200,
    mansfieldRS: r.mansfield_rs, nextEarnings: r.next_earnings,
    fundamentals: r.fundamentals, analysis: r.analysis,
    status: r.status, entryPrice: r.entry_price, positionSize: r.position_size,
    exitPrice: r.exit_price, notes: r.notes,
  }
}

// ── Exported helper: save a trade from StockCard ───────────────────────
export async function saveTradeToJournal(data, userId) {
  const trade = {
    id: Date.now().toString(), date: new Date().toISOString().slice(0,10),
    ticker: data.ticker, signal: data.signal, strategy: data.strategy, trend: data.trend,
    price: data.price, entryLow: data.entryLow, entryHigh: data.entryHigh,
    stopLoss: data.stopLoss, breakeven: data.breakeven,
    target1: data.target1, target2: data.target2, target3: data.target3,
    rr: data.rr, rsi: data.rsi, ema20: data.ema20, ema50: data.ema50,
    sma200: data.sma200, mansfieldRS: data.mansfieldRS, nextEarnings: data.nextEarnings,
    fundamentals: data.fundamentals, analysis: data.analysis,
    status: 'open', entryPrice: null, positionSize: null, exitPrice: null, notes: '',
  }
  await supabase.from('journal').insert(tradeToDb(trade, userId))
  return trade
}
