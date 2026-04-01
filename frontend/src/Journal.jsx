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
  const days    = calcDaysOpen(trade.date)
  const maxDays = trade.maxDays || 20
  const entryRef = trade.entryPrice || trade.entryLow || trade.price
  const pnl = trade.exitPrice ? ((trade.exitPrice - entryRef) / entryRef) * 100 : null

  const greenLimit  = Math.round(maxDays * 0.30)
  const yellowLimit = Math.round(maxDays * 0.70)

  let color, label, rec
  if (days <= greenLimit) {
    color = C.green; label = `Día ${days} de ${maxDays} — Setup activo`
    rec = `Mantener el plan. El setup está dentro de su ventana óptima (días 1–${greenLimit} de ${maxDays}).`
  } else if (days <= yellowLimit) {
    color = C.amber; label = `Día ${days} de ${maxDays} — Setup debilitándose`
    if (pnl !== null && pnl > 2) rec = `Llevas ${pnl.toFixed(1)}% de ganancia y ${days} días. Considera vender si no avanza pronto.`
    else if (pnl !== null && pnl < -1) rec = `El precio no responde (${pnl.toFixed(1)}%) y llevas ${days} días. Evalúa salir antes del stop-loss.`
    else rec = `El precio lleva ${days} días sin moverse significativamente. La probabilidad del setup baja cada día sin confirmación.`
  } else if (days < maxDays) {
    color = C.red; label = `Día ${days} de ${maxDays} — Alta probabilidad de invalidación`
    if (pnl !== null && pnl > 1) rec = `Llevas ${days} días con ganancia (${pnl.toFixed(1)}%). Salir ahora libera capital para un setup más fresco.`
    else if (pnl !== null && pnl >= -2) rec = `${days} días sin resolverse y casi en breakeven. Salir con pérdida mínima es mejor que esperar al stop-loss.`
    else rec = `El setup lleva ${days} días y no se cumplió. Revisar si la tesis original sigue siendo válida.`
  } else {
    color = C.red; label = `Día ${days} — Plazo máximo vencido`
    rec = `Han pasado ${days} días (plazo máximo: ${maxDays}). Cerrar la posición independiente del P&L y liberar el capital.`
  }
  const pct = Math.max(0, Math.min(100, ((maxDays - days) / maxDays) * 100))
  return { days, maxDays, color, label, rec, pct }
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

// ── Modal de confirmación para eliminar ───────────────────────────────
function ConfirmModal({ ticker, onConfirm, onCancel }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.85)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div style={{ background:C.card, border:`1px solid ${C.red}44`, borderRadius:14, padding:28, width:'100%', maxWidth:360, textAlign:'center' }}>
        <div style={{ fontSize:28, marginBottom:12 }}>⚠️</div>
        <div style={{ fontSize:16, fontWeight:700, color:C.text, marginBottom:8 }}>¿Eliminar operación?</div>
        <div style={{ fontSize:13, color:C.muted, marginBottom:24 }}>
          Se eliminará el registro de <span style={{ color:C.text, fontWeight:700 }}>{ticker}</span> del journal. Esta acción no se puede deshacer.
        </div>
        <div style={{ display:'flex', gap:10 }}>
          <button onClick={onCancel}
            style={{ flex:1, background:'none', border:`1px solid ${C.border}`, borderRadius:8, color:C.muted, padding:'10px', cursor:'pointer', fontSize:13 }}>
            Cancelar
          </button>
          <button onClick={onConfirm}
            style={{ flex:1, background:C.red, border:'none', borderRadius:8, color:'#fff', fontWeight:700, padding:'10px', cursor:'pointer', fontSize:13 }}>
            Eliminar
          </button>
        </div>
      </div>
    </div>
  )
}

function exportToCSV(trades) {
  const headers = ['Fecha','Ticker','Señal','Estrategia','Tendencia','Precio app',
    'Rango bajo (app)','Rango alto (app)','Stop-loss (app)','Objetivo (app)','R:B (app)',
    'RSI','SMA21','SMA50','SMA200','Mansfield RS','EPS','ROE%','Crecim.EPS%','Crecim.Ventas%',
    'Market Cap','P/E','Próx.Earnings',
    'Entrada real','SL real','TP real','N° acciones','Precio cierre',
    'P&L %','P&L USD','Estado','Días abierta','Notas']
  const rows = trades.map(t => {
    const f = t.fundamentals || {}
    const entryRef = t.entryPrice || t.price
    const pnlPct = t.exitPrice && entryRef ? (((t.exitPrice - entryRef) / entryRef) * 100).toFixed(2) : ''
    const pnlUsd = t.exitPrice && entryRef && t.positionSize
      ? ((t.exitPrice - entryRef) * parseFloat(t.positionSize)).toFixed(2) : ''
    const days = t.status !== 'closed' ? calcDaysOpen(t.date) : ''
    return [t.date, t.ticker, t.signal, t.strategy, t.trend, t.price,
      t.entryLow, t.entryHigh, t.stopLoss, t.target, t.rr,
      t.rsi, t.sma21, t.sma50, t.sma200||'', t.mansfieldRS||'',
      f.eps||'', f.roe||'', f.epsGrowth||'', f.revenueGrowth||'', f.marketCap||'', f.peRatio||'', t.nextEarnings||'',
      t.entryPrice||'', t.realStopLoss||'', t.realTarget||'', t.positionSize||'', t.exitPrice||'',
      pnlPct, pnlUsd, STATUS_LABELS[t.status]||t.status, days, t.notes||'']
  })
  const csv = [headers,...rows].map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n')
  const blob = new Blob(['\uFEFF'+csv], {type:'text/csv;charset=utf-8;'})
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href=url; a.download=`journal-${new Date().toISOString().slice(0,10)}.csv`
  a.click(); URL.revokeObjectURL(url)
}

function TradeModal({ trade, onSave, onClose }) {
  const [form, setForm] = useState({
    entryPrice:   trade.entryPrice   || trade.price || '',
    realStopLoss: trade.realStopLoss || '',
    realTarget:   trade.realTarget   || '',
    positionSize: trade.positionSize || '',
    exitPrice:    trade.exitPrice    || '',
    status:       trade.status       || 'open',
    notes:        trade.notes        || '',
  })
  const set = (k,v) => setForm(f=>({...f,[k]:v}))

  const pnlPct = form.exitPrice && form.entryPrice
    ? (((parseFloat(form.exitPrice) - parseFloat(form.entryPrice)) / parseFloat(form.entryPrice)) * 100).toFixed(2)
    : null
  const pnlUsd = pnlPct && form.positionSize && form.exitPrice
    ? ((parseFloat(form.exitPrice) - parseFloat(form.entryPrice)) * parseFloat(form.positionSize)).toFixed(2)
    : null
  const slPct = form.realStopLoss && form.entryPrice && parseFloat(form.entryPrice) > 0
    ? (((parseFloat(form.realStopLoss) - parseFloat(form.entryPrice)) / parseFloat(form.entryPrice)) * 100).toFixed(2)
    : null
  const tpPct = form.realTarget && form.entryPrice && parseFloat(form.entryPrice) > 0
    ? (((parseFloat(form.realTarget) - parseFloat(form.entryPrice)) / parseFloat(form.entryPrice)) * 100).toFixed(2)
    : null

  const inputStyle = { width:'100%', background:C.bg, border:`1px solid ${C.border}`, borderRadius:6, padding:'7px 10px', color:C.text, fontSize:13, boxSizing:'border-box' }
  const labelStyle = { fontSize:10, color:C.muted, marginBottom:4 }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:24, width:'100%', maxWidth:520, maxHeight:'90vh', overflowY:'auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <div>
            <span style={{ fontSize:20, fontWeight:700, color:C.text }}>{trade.ticker}</span>
            <span style={{ fontSize:12, color:C.muted, marginLeft:10 }}>{trade.date}</span>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:C.muted, fontSize:20, cursor:'pointer' }}>×</button>
        </div>

        {/* Sección 1: Análisis de la app (solo lectura) */}
        <div style={{ background:C.bg, borderRadius:8, padding:12, marginBottom:16, fontSize:11 }}>
          <div style={{ color:C.accent, fontSize:9, marginBottom:8, textTransform:'uppercase', letterSpacing:'0.07em', fontWeight:700 }}>
            Análisis de la app · Solo referencia
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
            {[
              ['Precio sugerido', fmt(trade.price)],
              ['RSI', trade.rsi],
              ['Rango entrada', `${fmt(trade.entryLow)}–${fmt(trade.entryHigh)}`],
              ['Stop-loss app', fmt(trade.stopLoss)],
              ['Objetivo app', fmt(trade.target)],
              ['R:B app', trade.rr ? `${trade.rr}x` : '—'],
              ['Mansfield RS', trade.mansfieldRS ?? '—'],
              ['SMA21', fmt(trade.sma21)],
              ['SMA200', trade.sma200 ? fmt(trade.sma200) : '—'],
            ].map(([l,v]) => (
              <div key={l}>
                <span style={{color:C.muted}}>{l}: </span>
                <span style={{color:C.text, fontFamily:'monospace'}}>{v}</span>
              </div>
            ))}
          </div>
          {trade.analysis && (
            <div style={{ marginTop:8, color:C.text, lineHeight:1.6, borderTop:`1px solid ${C.border}`, paddingTop:8 }}>
              {trade.analysis}
            </div>
          )}
        </div>

        {/* Sección 2: Mi operación real (editable) */}
        <div style={{ background:'#0a1520', border:`1px solid ${C.green}33`, borderRadius:8, padding:12, marginBottom:12 }}>
          <div style={{ color:C.green, fontSize:9, marginBottom:12, textTransform:'uppercase', letterSpacing:'0.07em', fontWeight:700 }}>
            Mi operación real · Editable
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              <label><div style={labelStyle}>Precio entrada real</div>
                <input type="number" value={form.entryPrice} onChange={e=>set('entryPrice',e.target.value)} style={inputStyle}/></label>
              <label><div style={labelStyle}>N° acciones</div>
                <input type="number" value={form.positionSize} onChange={e=>set('positionSize',e.target.value)} style={inputStyle}/></label>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              <label>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                  <span style={labelStyle}>Stop-loss real (broker)</span>
                  {slPct && <span style={{ fontSize:11, fontWeight:700, fontFamily:'monospace', color:parseFloat(slPct)>=0?C.green:C.red }}>{parseFloat(slPct)>=0?'+':''}{slPct}%</span>}
                </div>
                <input type="number" value={form.realStopLoss} onChange={e=>set('realStopLoss',e.target.value)} style={inputStyle}/>
              </label>
              <label>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                  <span style={labelStyle}>Take profit real (broker)</span>
                  {tpPct && <span style={{ fontSize:11, fontWeight:700, fontFamily:'monospace', color:parseFloat(tpPct)>=0?C.green:C.red }}>{parseFloat(tpPct)>=0?'+':''}{tpPct}%</span>}
                </div>
                <input type="number" value={form.realTarget} onChange={e=>set('realTarget',e.target.value)} style={inputStyle}/>
              </label>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              <label><div style={labelStyle}>Precio cierre real</div>
                <input type="number" value={form.exitPrice} onChange={e=>set('exitPrice',e.target.value)} style={inputStyle}/></label>
              <label><div style={labelStyle}>Estado</div>
                <select value={form.status} onChange={e=>set('status',e.target.value)}
                  style={{...inputStyle, padding:'7px 10px'}}>
                  {Object.entries(STATUS_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}
                </select></label>
            </div>
          </div>
        </div>

        {/* P&L */}
        {pnlPct && (
          <div style={{ background:C.bg, borderRadius:6, padding:'10px 14px', marginBottom:12, display:'flex', justifyContent:'center', alignItems:'center', gap:16 }}>
            <div>
              <div style={{ fontSize:9, color:C.muted, textAlign:'center', marginBottom:2 }}>P&L %</div>
              <div style={{ fontSize:18, fontWeight:700, fontFamily:'monospace', color:parseFloat(pnlPct)>=0?C.green:C.red }}>
                {fmtPct(pnlPct)}
              </div>
            </div>
            {pnlUsd && (
              <>
                <div style={{ width:1, height:32, background:C.border }}/>
                <div>
                  <div style={{ fontSize:9, color:C.muted, textAlign:'center', marginBottom:2 }}>P&L USD</div>
                  <div style={{ fontSize:18, fontWeight:700, fontFamily:'monospace', color:parseFloat(pnlUsd)>=0?C.green:C.red }}>
                    {parseFloat(pnlUsd)>=0?'+':''}{pnlUsd}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        <label><div style={labelStyle}>Notas</div>
          <textarea value={form.notes} onChange={e=>set('notes',e.target.value)} rows={3}
            placeholder="Por qué entré, qué pasó, qué aprendí…"
            style={{...inputStyle, resize:'vertical'}}/></label>

        <div style={{ display:'flex', gap:8, marginTop:12 }}>
          <button onClick={()=>onSave({...trade,...form})}
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
  )
}

export default function Journal({ session }) {
  const [trades,        setTrades]        = useState([])
  const [loading,       setLoading]       = useState(true)
  const [selected,      setSelected]      = useState(null)
  const [filter,        setFilter]        = useState('open')
  const [confirmDelete, setConfirmDelete] = useState(null) // trade a eliminar

  useEffect(() => {
    if (!session) return
    supabase.from('journal').select('*').eq('user_id', session.user.id).order('created_at', { ascending:false })
      .then(({ data }) => { if (data) setTrades(data.map(dbToTrade)); setLoading(false) })
  }, [session])

  const update = async (updated) => {
    const row = tradeToDb(updated, session.user.id)
    // Exclude id and user_id from the update payload — they go in the WHERE clause / RLS
    const { id: _id, user_id: _uid, ...updateRow } = row
    const { error } = await supabase.from('journal').update(updateRow).eq('id', updated.id)
    if (error) { console.error('Journal update error:', error); return }
    setTrades(t => t.map(x => x.id === updated.id ? updated : x))
    setSelected(null)
  }

  const remove = async (id) => {
    await supabase.from('journal').delete().eq('id', id)
    setTrades(t => t.filter(x => x.id !== id))
    setConfirmDelete(null)
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
          <p style={{ fontSize:11, color:C.muted, margin:'4px 0 0' }}>Sincronizado en la nube · accede desde cualquier dispositivo</p>
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

      {/* Nota: el resumen de P&L total y mensual está en el Dashboard */}

      {filtered.length === 0 && trades.length === 0 && (
        <div style={{textAlign:'center',padding:'60px 20px',color:C.muted}}>
          <div style={{fontSize:32,marginBottom:12}}>📋</div>
          <div style={{fontSize:14,marginBottom:6}}>No hay operaciones registradas</div>
          <div style={{fontSize:12}}>Haz clic en <b style={{color:C.accent}}>Guardar en journal</b> desde cualquier tarjeta de análisis</div>
        </div>
      )}

      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        {filtered.map(trade => {
          const entryRef = trade.entryPrice || trade.price
          const pnlPct = trade.exitPrice && entryRef
            ? (((trade.exitPrice - entryRef) / entryRef) * 100).toFixed(2) : null
          const pnlUsd = pnlPct && trade.positionSize && trade.exitPrice
            ? ((trade.exitPrice - entryRef) * parseFloat(trade.positionSize)).toFixed(2) : null
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
                  {pnlPct && (
                    <div style={{textAlign:'right'}}>
                      <div style={{fontSize:14,fontWeight:700,fontFamily:'monospace',color:parseFloat(pnlPct)>=0?C.green:C.red}}>
                        {fmtPct(pnlPct)}
                      </div>
                      {pnlUsd && (
                        <div style={{fontSize:11,fontFamily:'monospace',color:parseFloat(pnlUsd)>=0?C.green:C.red}}>
                          {parseFloat(pnlUsd)>=0?'+':''}{pnlUsd} USD
                        </div>
                      )}
                    </div>
                  )}
                  <button onClick={()=>setSelected(trade)}
                    style={{background:C.accent+'22',border:`1px solid ${C.accent}`,borderRadius:6,color:C.accent,padding:'4px 10px',cursor:'pointer',fontSize:11}}>
                    Editar</button>
                  <button onClick={()=>setConfirmDelete(trade)}
                    style={{background:'none',border:`1px solid ${C.border}`,borderRadius:6,color:C.muted,padding:'4px 8px',cursor:'pointer',fontSize:11}}>
                    ✕</button>
                </div>
              </div>
              <div style={{display:'flex',gap:16,marginTop:8,flexWrap:'wrap',fontSize:11}}>
                <span><span style={{color:C.muted}}>Precio app: </span><span style={{color:C.text,fontFamily:'monospace'}}>{fmt(trade.price)}</span></span>
                {trade.entryPrice && <span><span style={{color:C.muted}}>Entrada real: </span><span style={{color:C.green,fontFamily:'monospace'}}>{fmt(trade.entryPrice)}</span></span>}
                <span><span style={{color:C.muted}}>SL app: </span><span style={{color:C.red,fontFamily:'monospace'}}>{fmt(trade.stopLoss)}</span></span>
                {trade.realStopLoss && <span><span style={{color:C.muted}}>SL real: </span><span style={{color:C.red,fontFamily:'monospace'}}>{fmt(trade.realStopLoss)}</span></span>}
                <span><span style={{color:C.muted}}>TP app: </span><span style={{color:C.green,fontFamily:'monospace'}}>{fmt(trade.target)}</span></span>
                {trade.realTarget && <span><span style={{color:C.muted}}>TP real: </span><span style={{color:C.green,fontFamily:'monospace'}}>{fmt(trade.realTarget)}</span></span>}
                {trade.nextEarnings && <span><span style={{color:C.muted}}>Earnings: </span><span style={{color:C.amber,fontFamily:'monospace'}}>{trade.nextEarnings}</span></span>}
              </div>
              {trade.notes && <div style={{marginTop:8,fontSize:11,color:C.muted,fontStyle:'italic',borderTop:`1px solid ${C.border}`,paddingTop:6}}>{trade.notes}</div>}
              <SetupDecayBar trade={trade} />
            </div>
          )
        })}
      </div>

      {selected && <TradeModal trade={selected} onSave={update} onClose={()=>setSelected(null)} />}

      {confirmDelete && (
        <ConfirmModal
          ticker={confirmDelete.ticker}
          onConfirm={() => remove(confirmDelete.id)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}

// ── DB mappers ─────────────────────────────────────────────────────────
function tradeToDb(t, userId) {
  return {
    id: t.id, user_id: userId, date: t.date, ticker: t.ticker,
    signal: t.signal, strategy: t.strategy, trend: t.trend, price: t.price,
    entry_low: t.entryLow, entry_high: t.entryHigh, stop_loss: t.stopLoss,
    target: t.target,
    max_days: t.maxDays || 20,
    rr: t.rr, rsi: t.rsi, sma21: t.sma21, sma50: t.sma50, sma200: t.sma200,
    mansfield_rs: t.mansfieldRS, next_earnings: t.nextEarnings,
    fundamentals: t.fundamentals, analysis: t.analysis,
    status: t.status,
    entry_price:    t.entryPrice   !== '' ? t.entryPrice   : null,
    position_size:  t.positionSize !== '' ? t.positionSize : null,
    exit_price:     t.exitPrice    !== '' ? t.exitPrice    : null,
    real_stop_loss: t.realStopLoss !== '' ? t.realStopLoss : null,
    real_target:    t.realTarget   !== '' ? t.realTarget   : null,
    notes: t.notes,
  }
}

function dbToTrade(r) {
  return {
    id: r.id, date: r.date, ticker: r.ticker,
    signal: r.signal, strategy: r.strategy, trend: r.trend, price: r.price,
    entryLow: r.entry_low, entryHigh: r.entry_high, stopLoss: r.stop_loss,
    target: r.target,
    maxDays: r.max_days || 20,
    rr: r.rr, rsi: r.rsi, sma21: r.sma21, sma50: r.sma50, sma200: r.sma200,
    mansfieldRS: r.mansfield_rs, nextEarnings: r.next_earnings,
    fundamentals: r.fundamentals, analysis: r.analysis,
    status: r.status, entryPrice: r.entry_price, positionSize: r.position_size,
    exitPrice: r.exit_price, notes: r.notes,
    realStopLoss: r.real_stop_loss, realTarget: r.real_target,
  }
}

// ── Exported helper: save a trade from StockCard ───────────────────────
export async function saveTradeToJournal(data, userId) {
  const trade = {
    id: Date.now().toString(), date: new Date().toISOString().slice(0,10),
    ticker: data.ticker, signal: data.signal, strategy: data.strategy, trend: data.trend,
    price: data.price, entryLow: data.entryLow, entryHigh: data.entryHigh,
    stopLoss: data.stopLoss, target: data.target,
    rr: data.rr, rsi: data.rsi, sma21: data.sma21, sma50: data.sma50,
    sma200: data.sma200, mansfieldRS: data.mansfieldRS, nextEarnings: data.nextEarnings,
    fundamentals: data.fundamentals, analysis: data.analysis,
    status: 'open', entryPrice: null, positionSize: null, exitPrice: null, notes: '',
    realStopLoss: null, realTarget: null,
  }
  await supabase.from('journal').insert(tradeToDb(trade, userId))
  return trade
}
