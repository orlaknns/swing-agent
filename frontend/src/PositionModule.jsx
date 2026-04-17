import { useState, useEffect, useRef } from 'react'
import { supabase } from './supabase.js'
import {
  ComposedChart, Bar, Line, LineChart, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts'

const C = {
  bg:'#070d1a', card:'#0f1929', border:'#1a2d45',
  accent:'#00d4ff', green:'#00e096', red:'#ff4060',
  amber:'#ffb800', text:'#dde6f0', muted:'#4a6080',
}
const M = '#a78bfa'  // color de identidad del módulo Position Trading

const WEIGHTS = {
  narrativa: 3, precio_sma200: 3, estructura_tecnica: 3,
  rs_relativa: 2, calidad_fundamental: 3, punto_entrada: 1,
  ratio_rr: 2,
}
const MAX_SCORE = 51 // (3+3+3+2+3+1+2) × 3 = 17 × 3 = 51

const CRITERIA_LABELS = {
  narrativa:           'Narrativa activa',
  precio_sma200:       'Distancia SMA200',
  estructura_tecnica:  'Estructura técnica',
  rs_relativa:         'RS vs sector/SPY',
  calidad_fundamental: 'Calidad fundamental',
  punto_entrada:       'Punto de entrada',
  ratio_rr:            'Ratio R/R',
}

const ENTRY_SIGNALS = [
  'Retroceso a SMA50',
  'Retroceso a SMA200',
  'Ruptura de resistencia',
  'Consolidación en soporte',
  'Otro',
]

const STATUS_LABELS = { planning:'Planificando', open:'Activo', closed:'Cerrado' }
const STATUS_COLORS = { planning: C.amber, open: C.green, closed: C.muted }
const DECISION_COLOR = { OPERAR_CONVICCION: C.green, OPERAR_CAUTELA: C.amber, NO_OPERAR: C.red }

function calcDecision(scoreTotal, d) {
  if (scoreTotal == null) return null

  // ── VETOS (NO_OPERAR inmediato) ───────────────────────────────────────
  // 1. Precio bajo SMA200 (Weinstein: nunca operar fuera de tendencia alcista estructural)
  const hasVeto   = d?.scorecard?.precio_sma200?.score_sugerido === 0
  // 2. R/R < 2 (no compensa el riesgo)
  const hasRRVeto = d?.rr_suggested != null && d.rr_suggested < 2
  // 3. Stage 3 o 4 (Weinstein: distribución o declive — smart money saliendo)
  const stage = d?.stage?.stage
  const hasStageVeto = stage === 3 || stage === 4
  if (hasVeto || hasRRVeto || hasStageVeto) return 'NO_OPERAR'

  // ── CAUTELA FORZADA (máximo CAUTELA, nunca CONVICCIÓN) ────────────────
  // 4. Mercado bajista: SPY bajo SMA200 (Weinstein: evitar compras en Stage 4 macro)
  const bearMarket = d?.macro_context?.spy_above_sma200 === false
  // 5. Confidence baja: menos de 4/7 criterios con datos reales
  const confidence = d?.scorecard?._confidence
  const lowConfidence = confidence != null && confidence.real < 4
  // 6. Earnings próximos ≤7d
  const daysToEarn = d?.next_earnings ? (() => {
    try { return Math.ceil((new Date(d.next_earnings) - new Date()) / (1000*60*60*24)) } catch { return null }
  })() : null
  const earningsNearby = daysToEarn != null && daysToEarn >= 0 && daysToEarn <= 7
  // 7. Precio extendido: más de 5% sobre entrada sugerida → R/R real ya no es el calculado
  const priceExtended = d?.price != null && d?.entry_suggested != null
    && ((d.price - d.entry_suggested) / d.entry_suggested) > 0.05

  if (bearMarket || lowConfidence || earningsNearby || priceExtended) {
    return scoreTotal >= 22 ? 'OPERAR_CAUTELA' : 'NO_OPERAR'
  }

  // ── DECISIÓN NORMAL ───────────────────────────────────────────────────
  return scoreTotal >= 32 ? 'OPERAR_CONVICCION' : scoreTotal >= 22 ? 'OPERAR_CAUTELA' : 'NO_OPERAR'
}
const DECISION_LABEL = {
  OPERAR_CONVICCION: 'OPERAR CON CONVICCIÓN',
  OPERAR_CAUTELA:    'OPERAR CON CAUTELA',
  NO_OPERAR:         'NO OPERAR',
}

function fmtUsd(n) {
  if (n == null) return '—'
  const abs = Math.abs(n)
  const sign = n >= 0 ? '+' : '-'
  if (abs >= 1000) return `${sign}$${(abs/1000).toFixed(1)}k`
  return `${sign}$${abs.toFixed(0)}`
}
function fmtUsdShort(n) {
  if (n == null) return '—'
  const abs = Math.abs(n)
  const sign = n >= 0 ? '+' : '-'
  if (abs >= 1000) return `${sign}$${(abs/1000).toFixed(1)}k`
  return `${sign}$${abs.toFixed(2)}`
}

// ── Criterio Slider ──────────────────────────────────────────────────────────
function CriterioSlider({ id, value, onChange, justificacion, esAutomatico, esVeto }) {
  const label = CRITERIA_LABELS[id]
  const peso  = WEIGHTS[id]
  const scoreColors = ['#4a6080','#ffb800','#00aaff','#00e096']
  const color = esVeto && value === 0 ? C.red : scoreColors[value]
  return (
    <div style={{
      padding:'12px 14px', borderRadius:9,
      border: `1px solid ${esVeto && value === 0 ? C.red+'55' : C.border}`,
      background: esVeto && value === 0 ? '#ff406008' : C.bg,
    }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
        <div style={{ display:'flex', alignItems:'center', gap:7 }}>
          <span style={{ fontSize:12, fontWeight:600, color:C.text }}>{label}</span>
          <span style={{ fontSize:9, color:C.muted, background:C.card, border:`1px solid ${C.border}`,
            borderRadius:99, padding:'1px 6px' }}>×{peso}</span>
          {esAutomatico && <span style={{ fontSize:9, color:C.accent, background:C.accent+'15',
            border:`1px solid ${C.accent}33`, borderRadius:99, padding:'1px 6px' }}>AUTO</span>}
          {esVeto && value === 0 && <span style={{ fontSize:9, color:C.red, fontWeight:700 }}>⚠ VETO</span>}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <span style={{ fontSize:13, fontWeight:700, fontFamily:'monospace', color }}>
            {value}/3
          </span>
          <span style={{ fontSize:10, color:C.muted }}>= {value * peso} pts</span>
        </div>
      </div>
      <input
        type="range" min={0} max={3} step={1} value={value}
        onChange={e => onChange(id, parseInt(e.target.value))}
        style={{ width:'100%', accentColor: color, cursor:'pointer', marginBottom:4 }}
      />
      <div style={{ fontSize:10, color: esVeto && value === 0 ? C.red : C.muted, lineHeight:1.5 }}>
        {justificacion}
      </div>
    </div>
  )
}

// ── Position Journal ─────────────────────────────────────────────────────────
// ── SetupProgress — vigencia de la tesis position (Weinstein: ~3–12 meses) ──
function PositionSetupBar({ trade }) {
  if (trade.status === 'closed' || trade.status === 'planning') return null
  const dateStr = trade.entry_date || trade.created_at?.slice(0,10)
  if (!dateStr) return null
  try {
    const days = Math.floor((new Date() - new Date(dateStr + 'T00:00:00')) / (1000*60*60*24))
    const maxDays = 365  // Position: hasta 12 meses
    const entryRef = trade.entry_price ? parseFloat(trade.entry_price) : null
    const exitRef  = trade.exit_price  ? parseFloat(trade.exit_price)  : null
    const pnlPct   = entryRef && exitRef ? (((exitRef - entryRef) / entryRef) * 100) : null

    const greenLimit  = 90   // 0–3 meses: óptimo
    const yellowLimit = 270  // 3–9 meses: monitorear
    let color, label, rec
    if (days <= greenLimit) {
      color = C.green; label = `Día ${days} de ${maxDays} — Tesis activa`
      rec = `Posición dentro de la ventana óptima de Weinstein (primeros 3 meses). Mantener si la estructura semanal se preserva.`
    } else if (days <= yellowLimit) {
      color = C.amber; label = `Día ${days} de ${maxDays} — Revisar tesis`
      if (pnlPct !== null && pnlPct > 15) rec = `Llevas ${pnlPct.toFixed(1)}% de ganancia en ${days} días. Considera subir el stop a breakeven o mejor.`
      else if (pnlPct !== null && pnlPct < -5) rec = `${days} días con pérdida (${pnlPct.toFixed(1)}%). Revisar si el Stage sigue siendo 2.`
      else rec = `${days} días en posición. Revisar gráfico semanal: ¿price >SMA30w? ¿RS positivo? ¿Volumen en avances?`
    } else if (days < maxDays) {
      color = C.red; label = `Día ${days} de ${maxDays} — Alta vigilancia`
      if (pnlPct !== null && pnlPct > 0) rec = `${days} días con ganancia (${pnlPct.toFixed(1)}%). Evalúa asegurar parciales si el gráfico muestra debilidad.`
      else rec = `${days} días sin ganancia significativa. Stage puede estar girando a 3. Revisar estructura antes de continuar.`
    } else {
      color = C.red; label = `Día ${days} — Revisión obligatoria`
      rec = `Han pasado ${days} días (12 meses). Evaluar cierre o renovación de tesis con análisis fresco de Stage y RS.`
    }
    const pct = Math.max(0, Math.min(100, ((maxDays - days) / maxDays) * 100))
    return (
      <div style={{ marginTop:8, background:C.bg, borderRadius:8, padding:'8px 10px', borderLeft:`3px solid ${color}` }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:5 }}>
          <span style={{ fontSize:10, color, fontWeight:700 }}>{label}</span>
          <span style={{ fontSize:10, color:C.muted }}>Vigencia posición</span>
        </div>
        <div style={{ height:4, background:C.border, borderRadius:2, marginBottom:6, overflow:'hidden' }}>
          <div style={{ width:`${pct}%`, height:'100%', background:color, borderRadius:2 }}/>
        </div>
        <div style={{ fontSize:11, color:C.text, lineHeight:1.6 }}>{rec}</div>
      </div>
    )
  } catch { return null }
}

function exportPositionCSV(trades) {
  const M = '#a78bfa'
  const headers = ['Fecha entrada','Fecha cierre','Ticker','Empresa','Score','Decisión',
    'Entrada app','Stop app','Target app',
    'Entrada real','Stop real','Target real','N° acciones','Precio cierre',
    'P&L %','P&L USD','Estado','Catalizador','Invalidación','Notas']
  const rows = trades.map(t => {
    const entryRef = t.entry_price ? parseFloat(t.entry_price) : null
    const exitRef  = t.exit_price  ? parseFloat(t.exit_price)  : null
    const sharesN  = t.shares      ? parseFloat(t.shares)      : null
    const pnlPct   = entryRef && exitRef ? (((exitRef - entryRef) / entryRef) * 100).toFixed(2) : ''
    const pnlUsd   = entryRef && exitRef && sharesN ? ((exitRef - entryRef) * sharesN).toFixed(2) : ''
    const STATUS_L = { planning:'Planificando', open:'Activo', closed:'Cerrado' }
    const DEC_L    = { OPERAR_CONVICCION:'CONVICCIÓN', OPERAR_CAUTELA:'CAUTELA', NO_OPERAR:'NO OPERAR' }
    return [t.entry_date||t.created_at?.slice(0,10)||'', t.exit_date||'',
      t.ticker, t.company_name||'', t.score_total||'', DEC_L[t.decision]||t.decision||'',
      t.entry_price||'', t.stop_loss||'', t.target1||'',
      t.entry_price||'', t.stop_loss||'', t.target1||'', t.shares||'', t.exit_price||'',
      pnlPct, pnlUsd, STATUS_L[t.status]||t.status, t.catalyst||'', t.invalidation||'', t.notes||'']
  })
  const csv = [headers,...rows].map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n')
  const blob = new Blob(['\uFEFF'+csv], {type:'text/csv;charset=utf-8;'})
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href=url; a.download=`journal-position-${new Date().toISOString().slice(0,10)}.csv`
  a.click(); URL.revokeObjectURL(url)
}

function PositionJournal({ session }) {
  const [trades,        setTrades]        = useState([])
  const [filter,        setFilter]        = useState('all')
  const [searchTicker,  setSearchTicker]  = useState('')
  const [selected,      setSelected]      = useState(null)
  const [form,          setForm]          = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [saving,        setSaving]        = useState(false)

  const reload = () => {
    if (!session) return
    supabase.from('position_trades')
      .select('*')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setTrades(data || []))
  }

  useEffect(() => { reload() }, [session])

  let filtered = filter === 'all' ? trades : trades.filter(t => t.status === filter)
  if (searchTicker.trim()) filtered = filtered.filter(t => t.ticker?.includes(searchTicker.trim().toUpperCase()))

  // Stats
  const total     = trades.length
  const planning  = trades.filter(t => t.status === 'planning').length
  const open      = trades.filter(t => t.status === 'open').length
  const closed    = trades.filter(t => t.status === 'closed')
  const closedWithPnl = closed.filter(t => t.exit_price && t.entry_price)
  const wins      = closedWithPnl.filter(t => parseFloat(t.exit_price) > parseFloat(t.entry_price)).length
  const winRate   = closedWithPnl.length > 0 ? Math.round(wins / closedWithPnl.length * 100) : null

  const openModal = (trade) => { setSelected(trade); setForm({ ...trade }) }
  const closeModal = () => { setSelected(null); setForm(null) }

  const handleUpdate = async () => {
    if (!form) return
    setSaving(true)
    // auto-asignar entry_date si pasa a open y no tiene fecha
    const entry_date = form.entry_date || (form.status === 'open' && !selected.entry_date
      ? new Date().toISOString().slice(0,10) : selected.entry_date || null)
    // auto-asignar exit_date si pasa a closed
    const exit_date = form.exit_date || (form.status === 'closed' && !selected.exit_date
      ? new Date().toISOString().slice(0,10) : form.status !== 'closed' ? null : (form.exit_date || null))
    const { error } = await supabase.from('position_trades')
      .update({
        status:       form.status,
        entry_price:  form.entry_price  || null,
        stop_loss:    form.stop_loss    || null,
        target1:      form.target1      || null,
        shares:       form.shares       || null,
        exit_price:   form.exit_price   || null,
        exit_date,
        entry_date,
        notes:        form.notes        || null,
        catalyst:     form.catalyst     || null,
        invalidation: form.invalidation || null,
      })
      .eq('id', form.id)
    if (!error) { closeModal(); reload() }
    setSaving(false)
  }

  const handleDelete = async (id) => {
    await supabase.from('position_trades').delete().eq('id', id)
    setTrades(prev => prev.filter(t => t.id !== id))
    setConfirmDelete(null)
    closeModal()
  }

  const DECISION_SHORT = { OPERAR_CONVICCION:'CONVICCIÓN', OPERAR_CAUTELA:'CAUTELA', NO_OPERAR:'NO OPERAR' }
  const M = '#a78bfa'  // color violeta Position

  return (
    <div style={{ maxWidth:960, margin:'0 auto', padding:'0 20px' }}>

      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:18, flexWrap:'wrap', gap:10 }}>
        <div>
          <h2 style={{ fontSize:18, fontWeight:700, color:C.text, margin:0, marginBottom:3 }}>Position Journal</h2>
          <div style={{ fontSize:11, color:C.muted }}>Sincronizado en la nube · accede desde cualquier dispositivo</div>
        </div>
        <button onClick={() => exportPositionCSV(trades)}
          style={{ background:M, border:'none', borderRadius:8, color:'#000',
            fontWeight:700, padding:'9px 16px', cursor:'pointer', fontSize:12 }}>
          Exportar Excel / Sheets
        </button>
      </div>

      {/* Stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:18 }}>
        {[
          ['TOTAL OPS.', total, C.text],
          ['PLANIF. + ACTIVAS', planning + open, C.accent],
          ['CERRADAS', closed.length, C.muted],
          ['WIN RATE', winRate != null ? `${winRate}%` : '—', winRate != null ? (winRate >= 50 ? C.green : C.red) : C.muted],
        ].map(([label, val, color]) => (
          <div key={label} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:10,
            padding:'14px', textAlign:'center' }}>
            <div style={{ fontSize:9, color:C.muted, letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:6 }}>{label}</div>
            <div style={{ fontSize:22, fontWeight:700, fontFamily:'monospace', color }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Filtros + búsqueda */}
      <div style={{ display:'flex', gap:8, marginBottom:18, flexWrap:'wrap', alignItems:'center' }}>
        {[['all','Todas'],['planning','Planificando'],['open','Activas'],['closed','Cerradas']].map(([v,l]) => (
          <button key={v} onClick={() => setFilter(v)}
            style={{ background: filter===v ? M+'22' : 'none',
              border:`1px solid ${filter===v ? M : C.border}`,
              borderRadius:7, color: filter===v ? M : C.muted,
              padding:'5px 14px', cursor:'pointer', fontSize:11, fontWeight:600 }}>
            {l}
          </button>
        ))}
        <div style={{ marginLeft:'auto', position:'relative' }}>
          <input value={searchTicker} onChange={e => setSearchTicker(e.target.value)}
            placeholder="Buscar ticker…"
            style={{ background:C.bg, border:`1px solid ${searchTicker ? M : C.border}`,
              borderRadius:7, padding:'5px 28px 5px 10px', color:C.text, fontSize:11,
              outline:'none', width:130 }} />
          {searchTicker && (
            <span onClick={() => setSearchTicker('')}
              style={{ position:'absolute', right:8, top:'50%', transform:'translateY(-50%)',
                color:C.muted, cursor:'pointer', fontSize:13 }}>×</span>
          )}
        </div>
        <span style={{ fontSize:11, color:C.muted }}>{filtered.length} ops.</span>
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign:'center', padding:'60px', color:C.muted, fontSize:13 }}>
          {searchTicker || filter !== 'all' ? 'Sin resultados para este filtro' : 'No hay operaciones de position trading registradas.'}
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {filtered.map(t => {
            const ep  = t.entry_price ? parseFloat(t.entry_price) : null
            const sl  = t.stop_loss   ? parseFloat(t.stop_loss)   : null
            const tp  = t.target1     ? parseFloat(t.target1)     : null
            const xp  = t.exit_price  ? parseFloat(t.exit_price)  : null
            const sh  = t.shares      ? parseFloat(t.shares)      : null
            const pnlPct = ep && xp ? (((xp - ep) / ep) * 100) : null
            const pnlUsd = ep && xp && sh ? ((xp - ep) * sh) : null
            const rrReal = ep && sl && tp ? Math.abs((tp - ep) / (ep - sl)) : null
            const slPct  = ep && sl ? (((sl - ep) / ep) * 100) : null
            const tpPct  = ep && tp ? (((tp - ep) / ep) * 100) : null
            const pnlColor = pnlPct != null ? (pnlPct >= 0 ? C.green : C.red) : C.muted
            const statusColor = STATUS_COLORS[t.status] || C.muted
            const dateLabel = t.entry_date || t.created_at?.slice(0,10)
            return (
              <div key={t.id}
                style={{ background:C.card, borderLeft:`3px solid ${statusColor}`,
                  border:`1px solid ${C.border}`, borderLeft:`3px solid ${statusColor}`,
                  borderRadius:10, padding:'14px 16px', cursor:'pointer', transition:'background 0.15s' }}
                onMouseEnter={e => e.currentTarget.style.background = '#131e30'}
                onMouseLeave={e => e.currentTarget.style.background = C.card}
                onClick={() => openModal(t)}>

                {/* Header row */}
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6, flexWrap:'wrap' }}>
                  <span style={{ fontSize:17, fontWeight:800, color:C.text, fontFamily:'monospace' }}>{t.ticker}</span>
                  <span style={{ fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:99,
                    color:DECISION_COLOR[t.decision]||M, background:(DECISION_COLOR[t.decision]||M)+'18',
                    border:`1px solid ${(DECISION_COLOR[t.decision]||M)}33` }}>
                    {DECISION_SHORT[t.decision] || '—'}
                  </span>
                  <span style={{ fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:99,
                    color:statusColor, background:statusColor+'18', border:`1px solid ${statusColor}33` }}>
                    {STATUS_LABELS[t.status] || t.status}
                  </span>
                  {dateLabel && <span style={{ fontSize:10, color:C.muted }}>{dateLabel}</span>}
                  {/* P&L prominente */}
                  {pnlPct != null && (
                    <span style={{ marginLeft:'auto', fontSize:14, fontWeight:700, fontFamily:'monospace', color:pnlColor }}>
                      {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
                    </span>
                  )}
                  {pnlUsd != null && (
                    <span style={{ fontSize:12, fontWeight:700, fontFamily:'monospace', color:pnlColor }}>
                      ({pnlUsd >= 0 ? '+' : ''}${Math.abs(pnlUsd).toFixed(2)})
                    </span>
                  )}
                  <button onClick={e => { e.stopPropagation(); openModal(t) }}
                    style={{ background:'none', border:`1px solid ${C.border}`, borderRadius:6,
                      color:C.muted, padding:'3px 10px', cursor:'pointer', fontSize:10, marginLeft: pnlPct == null ? 'auto' : 0 }}>
                    Editar
                  </button>
                  <div onClick={e => { e.stopPropagation(); setConfirmDelete(t) }}
                    style={{ color:C.red, opacity:0.5, cursor:'pointer', fontSize:16, padding:'0 2px' }}>×</div>
                </div>

                {t.company_name && <div style={{ fontSize:11, color:C.muted, marginBottom:6 }}>{t.company_name}</div>}

                {/* Datos inline */}
                <div style={{ display:'flex', flexWrap:'wrap', gap:'3px 14px', fontSize:11, marginBottom:4 }}>
                  {ep && <span style={{ color:C.muted }}>Entrada: <b style={{ color:C.text, fontFamily:'monospace' }}>${ep.toFixed(2)}</b></span>}
                  {sh && <span style={{ color:C.muted }}>Acciones: <b style={{ color:C.text, fontFamily:'monospace' }}>{sh}</b></span>}
                  {sl && <span style={{ color:C.muted }}>Stop: <b style={{ color:C.red, fontFamily:'monospace' }}>${sl.toFixed(2)}{slPct != null ? ` (${slPct.toFixed(1)}%)` : ''}</b></span>}
                  {tp && <span style={{ color:C.muted }}>Target: <b style={{ color:C.green, fontFamily:'monospace' }}>${tp.toFixed(2)}{tpPct != null ? ` (+${tpPct.toFixed(1)}%)` : ''}</b></span>}
                  {rrReal != null && <span style={{ color:C.muted }}>R/R: <b style={{ color: rrReal >= 2 ? C.green : C.amber, fontFamily:'monospace' }}>{rrReal.toFixed(1)}x</b></span>}
                  {xp && <span style={{ color:C.muted }}>Cierre: <b style={{ color:C.accent, fontFamily:'monospace' }}>${xp.toFixed(2)}</b></span>}
                  <span style={{ color:C.muted }}>Score: <b style={{ color: (t.score_total||0) >= 32 ? C.green : (t.score_total||0) >= 22 ? C.amber : C.red, fontFamily:'monospace' }}>{t.score_total ?? '—'}/{MAX_SCORE}</b></span>
                </div>

                {t.notes && (
                  <div style={{ fontSize:11, color:C.muted, fontStyle:'italic',
                    borderTop:`1px solid ${C.border}`, paddingTop:6, marginTop:6 }}>
                    {t.notes}
                  </div>
                )}

                {/* Barra de vigencia — solo para posiciones activas */}
                <PositionSetupBar trade={t} />
              </div>
            )
          })}
        </div>
      )}

      {/* Confirm delete */}
      {confirmDelete && (
        <div onClick={() => setConfirmDelete(null)}
          style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.85)', zIndex:3000,
            display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background:C.card, border:`1px solid ${C.red}44`, borderRadius:14,
              padding:28, width:'100%', maxWidth:360, textAlign:'center' }}>
            <div style={{ fontSize:28, marginBottom:12 }}>⚠️</div>
            <div style={{ fontSize:16, fontWeight:700, color:C.text, marginBottom:8 }}>¿Eliminar operación?</div>
            <div style={{ fontSize:13, color:C.muted, marginBottom:24 }}>
              Se eliminará el registro de <span style={{ color:C.text, fontWeight:700 }}>{confirmDelete.ticker}</span> del journal. Esta acción no se puede deshacer.
            </div>
            <div style={{ display:'flex', gap:10 }}>
              <button onClick={() => setConfirmDelete(null)}
                style={{ flex:1, background:'none', border:`1px solid ${C.border}`, borderRadius:8,
                  color:C.muted, padding:'10px', cursor:'pointer', fontSize:13 }}>Cancelar</button>
              <button onClick={() => handleDelete(confirmDelete.id)}
                style={{ flex:1, background:C.red, border:'none', borderRadius:8,
                  color:'#fff', fontWeight:700, padding:'10px', cursor:'pointer', fontSize:13 }}>Eliminar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal edición */}
      {selected && form && (
        <div onClick={closeModal}
          style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:2500,
            display:'flex', alignItems:'flex-start', justifyContent:'center',
            padding:'40px 16px', overflowY:'auto' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14,
              padding:'24px', width:'100%', maxWidth:520 }}>

            {/* Título */}
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:4 }}>
              <div>
                <span style={{ fontSize:18, fontWeight:800, color:C.text, fontFamily:'monospace' }}>{selected.ticker}</span>
                {selected.company_name && <span style={{ fontSize:12, color:C.muted, marginLeft:8 }}>{selected.company_name}</span>}
              </div>
              <button onClick={closeModal}
                style={{ background:'none', border:'none', color:C.muted, cursor:'pointer', fontSize:20, padding:'0 4px' }}>×</button>
            </div>
            <div style={{ fontSize:11, color:C.muted, marginBottom:16 }}>
              Score {selected.score_total ?? '—'}/{MAX_SCORE} · {DECISION_LABEL[selected.decision] || selected.decision || '—'}
            </div>

            {/* Referencia app */}
            {(selected.entry_price || selected.stop_loss || selected.target1) && (
              <div style={{ marginBottom:16, padding:'10px 14px', background:C.bg,
                border:`1px solid ${C.border}`, borderRadius:9 }}>
                <div style={{ fontSize:9, color:'#a78bfa', letterSpacing:'0.1em', fontWeight:700,
                  textTransform:'uppercase', marginBottom:8 }}>Valores sugeridos · Solo referencia</div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:'4px 20px', fontSize:11 }}>
                  {selected.entry_price && <span style={{ color:C.muted }}>Entrada app: <b style={{ color:C.text, fontFamily:'monospace' }}>${selected.entry_price}</b></span>}
                  {selected.stop_loss   && <span style={{ color:C.muted }}>Stop app: <b style={{ color:C.red, fontFamily:'monospace' }}>${selected.stop_loss}</b></span>}
                  {selected.target1     && <span style={{ color:C.muted }}>Target app: <b style={{ color:C.green, fontFamily:'monospace' }}>${selected.target1}</b></span>}
                </div>
              </div>
            )}

            {/* Sección Mi operación real */}
            <div style={{ marginBottom:14, padding:'12px 14px', background:'#0a1628',
              border:'1px solid #a78bfa44', borderRadius:9 }}>
              <div style={{ fontSize:9, color:'#a78bfa', letterSpacing:'0.1em', fontWeight:700,
                textTransform:'uppercase', marginBottom:12 }}>Mi operación real · Editable</div>

              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                <div>
                  <div style={{ fontSize:10, color:C.muted, marginBottom:4 }}>Precio entrada real</div>
                  <input type="number" step="0.01" value={form.entry_price || ''}
                    onChange={e => setForm(f => ({ ...f, entry_price: e.target.value }))}
                    style={{ width:'100%', background:C.bg, border:`1px solid ${C.border}`, borderRadius:7,
                      padding:'8px 10px', color:C.text, fontSize:12, outline:'none', boxSizing:'border-box' }} />
                </div>
                <div>
                  <div style={{ fontSize:10, color:C.muted, marginBottom:4 }}>N° acciones</div>
                  <input type="number" step="1" value={form.shares || ''}
                    onChange={e => setForm(f => ({ ...f, shares: e.target.value }))}
                    style={{ width:'100%', background:C.bg, border:`1px solid ${C.border}`, borderRadius:7,
                      padding:'8px 10px', color:C.text, fontSize:12, outline:'none', boxSizing:'border-box' }} />
                </div>
                <div>
                  <div style={{ fontSize:10, marginBottom:4, display:'flex', justifyContent:'space-between' }}>
                    <span style={{ color:C.muted }}>Stop-loss real (broker)</span>
                    {form.entry_price && form.stop_loss && (
                      <span style={{ color:C.red, fontFamily:'monospace', fontSize:10 }}>
                        {(((parseFloat(form.stop_loss) - parseFloat(form.entry_price)) / parseFloat(form.entry_price)) * 100).toFixed(1)}%
                      </span>
                    )}
                  </div>
                  <input type="number" step="0.01" value={form.stop_loss || ''}
                    onChange={e => setForm(f => ({ ...f, stop_loss: e.target.value }))}
                    style={{ width:'100%', background:C.bg, border:`1px solid ${C.border}`, borderRadius:7,
                      padding:'8px 10px', color:C.text, fontSize:12, outline:'none', boxSizing:'border-box' }} />
                </div>
                <div>
                  <div style={{ fontSize:10, marginBottom:4, display:'flex', justifyContent:'space-between' }}>
                    <span style={{ color:C.muted }}>Take profit real (broker)</span>
                    {form.entry_price && form.target1 && (
                      <span style={{ color:C.green, fontFamily:'monospace', fontSize:10 }}>
                        +{(((parseFloat(form.target1) - parseFloat(form.entry_price)) / parseFloat(form.entry_price)) * 100).toFixed(1)}%
                      </span>
                    )}
                  </div>
                  <input type="number" step="0.01" value={form.target1 || ''}
                    onChange={e => setForm(f => ({ ...f, target1: e.target.value }))}
                    style={{ width:'100%', background:C.bg, border:`1px solid ${C.border}`, borderRadius:7,
                      padding:'8px 10px', color:C.text, fontSize:12, outline:'none', boxSizing:'border-box' }} />
                </div>
                <div>
                  <div style={{ fontSize:10, color:C.muted, marginBottom:4 }}>Precio cierre real</div>
                  <input type="number" step="0.01" value={form.exit_price || ''}
                    onChange={e => setForm(f => ({ ...f, exit_price: e.target.value }))}
                    style={{ width:'100%', background:C.bg, border:`1px solid ${C.border}`, borderRadius:7,
                      padding:'8px 10px', color:C.text, fontSize:12, outline:'none', boxSizing:'border-box' }} />
                </div>
                <div>
                  <div style={{ fontSize:10, color:C.muted, marginBottom:4 }}>Estado</div>
                  <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                    style={{ width:'100%', background:C.bg, border:`1px solid ${C.border}`, borderRadius:7,
                      padding:'8px 10px', color:C.text, fontSize:12, outline:'none', boxSizing:'border-box' }}>
                    <option value="planning">Planificando</option>
                    <option value="open">Activo</option>
                    <option value="closed">Cerrado</option>
                  </select>
                </div>
              </div>

              {/* Fecha de salida */}
              {(form.status === 'closed' || form.exit_date) && (
                <div style={{ marginTop:10 }}>
                  <div style={{ fontSize:10, color:C.muted, marginBottom:4 }}>Fecha de salida</div>
                  <input type="date" value={form.exit_date || ''} onChange={e => setForm(f => ({ ...f, exit_date: e.target.value }))}
                    style={{ width:'100%', background:C.bg, border:`1px solid ${C.border}`, borderRadius:7,
                      padding:'8px 10px', color:C.text, fontSize:12, outline:'none', boxSizing:'border-box' }} />
                </div>
              )}

              {/* P&L en tiempo real */}
              {(() => {
                const ep = form.entry_price ? parseFloat(form.entry_price) : null
                const xp = form.exit_price  ? parseFloat(form.exit_price)  : null
                const sh = form.shares      ? parseFloat(form.shares)      : null
                if (!ep || !xp) return null
                const pct = ((xp - ep) / ep) * 100
                const usd = sh ? (xp - ep) * sh : null
                const col = pct >= 0 ? C.green : C.red
                return (
                  <div style={{ marginTop:10, display:'grid', gridTemplateColumns: usd != null ? '1fr 1fr' : '1fr', gap:8 }}>
                    <div style={{ background: col+'11', border:`1px solid ${col}33`, borderRadius:8,
                      padding:'10px', textAlign:'center' }}>
                      <div style={{ fontSize:9, color:C.muted, marginBottom:3, textTransform:'uppercase' }}>P&L %</div>
                      <div style={{ fontSize:18, fontWeight:700, fontFamily:'monospace', color:col }}>
                        {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                      </div>
                    </div>
                    {usd != null && (
                      <div style={{ background: col+'11', border:`1px solid ${col}33`, borderRadius:8,
                        padding:'10px', textAlign:'center' }}>
                        <div style={{ fontSize:9, color:C.muted, marginBottom:3, textTransform:'uppercase' }}>P&L USD</div>
                        <div style={{ fontSize:18, fontWeight:700, fontFamily:'monospace', color:col }}>
                          {usd >= 0 ? '+' : ''}${Math.abs(usd).toFixed(2)}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>

            {/* Notas */}
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:10, color:C.muted, marginBottom:4 }}>Notas</div>
              <textarea value={form.notes || ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={3} style={{ width:'100%', background:C.bg, border:`1px solid ${C.border}`, borderRadius:7,
                  padding:'9px 12px', color:C.text, fontSize:12, outline:'none', resize:'vertical',
                  boxSizing:'border-box', fontFamily:'inherit' }} />
            </div>

            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:10, color:C.muted, marginBottom:4 }}>Catalizador</div>
              <input value={form.catalyst || ''} onChange={e => setForm(f => ({ ...f, catalyst: e.target.value }))}
                style={{ width:'100%', background:C.bg, border:`1px solid ${C.border}`, borderRadius:7,
                  padding:'9px 12px', color:C.text, fontSize:12, outline:'none', boxSizing:'border-box' }} />
            </div>

            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:10, color:C.muted, marginBottom:4 }}>Invalidación de tesis</div>
              <textarea value={form.invalidation || ''} onChange={e => setForm(f => ({ ...f, invalidation: e.target.value }))}
                rows={2} style={{ width:'100%', background:C.bg, border:`1px solid ${C.border}`, borderRadius:7,
                  padding:'9px 12px', color:C.text, fontSize:12, outline:'none', resize:'vertical',
                  boxSizing:'border-box', fontFamily:'inherit' }} />
            </div>

            <div style={{ display:'flex', gap:10 }}>
              <button onClick={closeModal}
                style={{ flex:1, background:'none', border:`1px solid ${C.border}`, borderRadius:8,
                  color:C.muted, padding:'10px', cursor:'pointer', fontSize:12 }}>Cancelar</button>
              <button onClick={handleUpdate} disabled={saving}
                style={{ flex:2, background:C.accent, border:'none', borderRadius:8,
                  color:'#000', fontWeight:700, padding:'10px', cursor:'pointer', fontSize:13 }}>
                {saving ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Position Dashboard ───────────────────────────────────────────────────────
function PositionDashboard({ session }) {
  const [trades, setTrades] = useState([])

  useEffect(() => {
    if (!session) return
    supabase.from('position_trades')
      .select('*')
      .eq('user_id', session.user.id)
      .eq('status', 'closed')
      .then(({ data }) => setTrades(data || []))
  }, [session])

  const closed = trades.filter(t => t.exit_price && t.entry_price && t.shares)

  // P&L por trade
  const withPnl = closed.map(t => {
    const pnl = (parseFloat(t.exit_price) - parseFloat(t.entry_price)) * parseInt(t.shares)
    return { ...t, pnl: round2(pnl) }
  })

  // Agrupar por mes
  const byMonth = {}
  withPnl.forEach(t => {
    const key = (t.exit_date || t.created_at || '').slice(0, 7)
    if (!key) return
    if (!byMonth[key]) byMonth[key] = { month: key, pnl: 0, count: 0, wins: 0 }
    byMonth[key].pnl += t.pnl
    byMonth[key].count++
    if (t.pnl > 0) byMonth[key].wins++
  })
  const monthData = Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month))
  let cumPnl = 0
  monthData.forEach(m => { cumPnl += m.pnl; m.cumPnl = round2(cumPnl) })

  const totalPnl    = withPnl.reduce((s, t) => s + t.pnl, 0)
  const winRate     = closed.length > 0 ? Math.round(withPnl.filter(t => t.pnl > 0).length / closed.length * 100) : null
  const avgScore    = closed.length > 0 ? Math.round(closed.reduce((s, t) => s + (t.score_total || 0), 0) / closed.length) : null
  const convWins    = withPnl.filter(t => t.decision === 'OPERAR_CONVICCION' && t.pnl > 0).length
  const convTotal   = withPnl.filter(t => t.decision === 'OPERAR_CONVICCION').length
  const convRate    = convTotal > 0 ? Math.round(convWins / convTotal * 100) : null

  function round2(n) { return Math.round(n * 100) / 100 }

  function CustomTooltip({ active, payload, label }) {
    if (!active || !payload?.length) return null
    const d = payload[0]?.payload
    return (
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:'10px 14px', fontSize:11 }}>
        <div style={{ color:C.muted, marginBottom:4 }}>{label}</div>
        <div style={{ color: d?.pnl >= 0 ? C.green : C.red }}>P&L: {fmtUsdShort(d?.pnl)}</div>
        <div style={{ color:C.accent }}>Acumulado: {fmtUsdShort(d?.cumPnl)}</div>
        <div style={{ color:C.muted }}>{d?.count} trades · {d?.wins} wins</div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth:960, margin:'0 auto', padding:'0 20px' }}>
      {closed.length === 0 ? (
        <div style={{ textAlign:'center', padding:'60px', color:C.muted, fontSize:13 }}>
          No hay operaciones cerradas en position trading aún.
        </div>
      ) : (
        <>
          {/* Stats */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(160px, 1fr))', gap:12, marginBottom:24 }}>
            {[
              ['P&L Total', fmtUsdShort(totalPnl), totalPnl >= 0 ? C.green : C.red],
              ['Win Rate', winRate != null ? `${winRate}%` : '—', winRate >= 50 ? C.green : C.red],
              ['Operaciones', closed.length, C.text],
              ['Score Promedio', avgScore != null ? `${avgScore}/${MAX_SCORE}` : '—', C.text],
              ['Win Rate Convicción', convRate != null ? `${convRate}%` : '—', convRate >= 60 ? C.green : C.amber],
            ].map(([label, val, color]) => (
              <div key={label} style={{ background:C.card, border:`1px solid ${C.border}`,
                borderRadius:10, padding:'14px 16px', textAlign:'center' }}>
                <div style={{ fontSize:9, color:C.muted, letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:6 }}>{label}</div>
                <div style={{ fontSize:20, fontWeight:700, fontFamily:'monospace', color }}>{val}</div>
              </div>
            ))}
          </div>

          {/* Gráfico mensual */}
          {monthData.length > 0 && (
            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12,
              padding:'18px', marginBottom:24 }}>
              <div style={{ fontSize:10, color:C.muted, textTransform:'uppercase', letterSpacing:'0.08em',
                fontWeight:700, marginBottom:16 }}>P&L Mensual</div>
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={monthData} margin={{ top:5, right:10, left:0, bottom:5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="month" tick={{ fontSize:10, fill:C.muted }} />
                  <YAxis tick={{ fontSize:10, fill:C.muted }} tickFormatter={v => fmtUsdShort(v)} />
                  <Tooltip content={<CustomTooltip />} />
                  <ReferenceLine y={0} stroke={C.border} />
                  <Bar dataKey="pnl" radius={[4,4,0,0]}>
                    {monthData.map((m, i) => <Cell key={i} fill={m.pnl >= 0 ? C.green : C.red} fillOpacity={0.8} />)}
                  </Bar>
                  <Line type="monotone" dataKey="cumPnl" stroke={C.accent} strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Tabla últimas operaciones */}
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, overflow:'hidden' }}>
            <div style={{ fontSize:10, color:C.muted, textTransform:'uppercase', letterSpacing:'0.08em',
              fontWeight:700, padding:'12px 16px', borderBottom:`1px solid ${C.border}` }}>
              Historial de operaciones cerradas
            </div>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr style={{ borderBottom:`1px solid ${C.border}` }}>
                  {['Ticker','Decisión','Score','Entrada','Salida','Acciones','P&L','Fecha'].map(h => (
                    <th key={h} style={{ padding:'8px 10px', textAlign:'left', fontSize:10,
                      color:C.muted, letterSpacing:'0.06em', textTransform:'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {withPnl.sort((a,b) => (b.exit_date||'').localeCompare(a.exit_date||'')).map(t => (
                  <tr key={t.id} style={{ borderBottom:`1px solid ${C.border}` }}>
                    <td style={{ padding:'9px 10px', fontWeight:700, color:C.text }}>{t.ticker}</td>
                    <td style={{ padding:'9px 10px' }}>
                      <span style={{ fontSize:10, color: DECISION_COLOR[t.decision], fontWeight:700 }}>
                        {t.decision === 'OPERAR_CONVICCION' ? 'CONV.' : t.decision === 'OPERAR_CAUTELA' ? 'CAUTELA' : '—'}
                      </span>
                    </td>
                    <td style={{ padding:'9px 10px', fontFamily:'monospace',
                      color: t.score_total >= 32 ? C.green : t.score_total >= 22 ? C.amber : C.red }}>
                      {t.score_total}
                    </td>
                    <td style={{ padding:'9px 10px', fontFamily:'monospace' }}>${t.entry_price}</td>
                    <td style={{ padding:'9px 10px', fontFamily:'monospace' }}>${t.exit_price}</td>
                    <td style={{ padding:'9px 10px', fontFamily:'monospace' }}>{t.shares}</td>
                    <td style={{ padding:'9px 10px', fontFamily:'monospace', fontWeight:700,
                      color: t.pnl >= 0 ? C.green : C.red }}>
                      {fmtUsdShort(t.pnl)}
                    </td>
                    <td style={{ padding:'9px 10px', color:C.muted, fontSize:11 }}>{t.exit_date || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

const SECTOR_COLORS = {
  'Technology':         '#00d4ff',
  'Financial':          '#00e096',
  'Financial Services': '#00e096',
  'Healthcare':         '#a78bfa',
  'Consumer Cyclical':  '#ffb800',
  'Consumer Defensive': '#34d399',
  'Communication':      '#fb923c',
  'Communication Services': '#fb923c',
  'Energy':             '#f59e0b',
  'Industrials':        '#94a3b8',
  'Basic Materials':    '#84cc16',
  'Real Estate':        '#e879f9',
  'Utilities':          '#38bdf8',
}

// ── Position Screener ────────────────────────────────────────────────────────
function PositionScreener({ watchlist, onAdd, onRemove, onAddAll, posCache }) {
  const [candidates,   setCandidates]   = useState([])
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState(null)
  const [filter,       setFilter]       = useState('all')
  const [screenerDate,  setScreenerDate]  = useState(null)
  const [source,        setSource]        = useState(null)
  const [updatedAt,     setUpdatedAt]     = useState(null)
  const [historyWeeks,  setHistoryWeeks]  = useState(0)
  const [refreshing,   setRefreshing]   = useState(false)
  const [refreshMsg,   setRefreshMsg]   = useState(null)
  const [polling,      setPolling]      = useState(false)
  const [preview,      setPreview]      = useState(null)
  const [previewData,  setPreviewData]  = useState(null)
  const [previewLoad,  setPreviewLoad]  = useState(false)
  const preRefreshDate = useRef(null)
  const pollInterval   = useRef(null)

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/screener-position')
      if (!res.ok) throw new Error(`Error ${res.status}`)
      const data = await res.json()
      const newDate = data.updatedAt || data.date || null
      setCandidates(data.candidates || [])
      setScreenerDate(data.date || null)
      setSource(data.source || null)
      setUpdatedAt(newDate)
      setHistoryWeeks(data.historyWeeks || 0)
      if (polling && preRefreshDate.current && newDate !== preRefreshDate.current) {
        stopPolling()
        setRefreshMsg({ ok:true, text:'✓ Screener actualizado' })
        setTimeout(() => setRefreshMsg(null), 4000)
      }
    } catch {
      setError('No se pudo conectar con el screener.')
    }
    setLoading(false)
  }

  const stopPolling = () => {
    if (pollInterval.current) { clearInterval(pollInterval.current); pollInterval.current = null }
    setPolling(false)
  }

  useEffect(() => {
    load()
    return () => stopPolling()
  }, [])

  useEffect(() => {
    if (polling) {
      pollInterval.current = setInterval(() => load(), 15000)
    } else {
      if (pollInterval.current) { clearInterval(pollInterval.current); pollInterval.current = null }
    }
    return () => { if (pollInterval.current) clearInterval(pollInterval.current) }
  }, [polling])

  const openPreview = async (ticker) => {
    setPreview(ticker)
    if (posCache?.[ticker]) { setPreviewData(posCache[ticker]); return }
    setPreviewData(null); setPreviewLoad(true)
    try {
      const res = await fetch(`/api/analyze-position/${ticker}`)
      if (res.ok) setPreviewData(await res.json())
    } catch {}
    setPreviewLoad(false)
  }

  const triggerRefresh = async () => {
    setRefreshing(true); setRefreshMsg(null)
    preRefreshDate.current = updatedAt || screenerDate
    try {
      const res = await fetch('/api/screener-position/refresh', { method:'POST' })
      const data = await res.json()
      if (res.ok) {
        setRefreshMsg({ ok:true, text:'Actualizando… verificando cada 15s' })
        setPolling(true)
      } else {
        setRefreshMsg({ ok:false, text: data.error || 'Error al actualizar' })
      }
    } catch {
      setRefreshMsg({ ok:false, text:'No se pudo conectar con el servidor' })
    }
    setRefreshing(false)
  }

  const sectors = ['all', ...new Set(candidates.map(c => c.sector).filter(Boolean))]
  const filtered = filter === 'all' ? candidates : candidates.filter(c => c.sector === filter)
  const inWatchlist = t => watchlist.includes(t)

  return (
    <div style={{ maxWidth:960, margin:'0 auto', padding:'0 20px 48px' }}>

      {/* Header */}
      <div style={{ marginBottom:16 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <h2 style={{ fontSize:18, fontWeight:700, color:C.text, margin:0 }}>Screener Position Trading</h2>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            {polling && (
              <span style={{ fontSize:10, color:C.amber, display:'flex', alignItems:'center', gap:5 }}>
                <span style={{ display:'inline-block', width:7, height:7, borderRadius:'50%',
                  background:C.amber, animation:'pulse 1.2s infinite' }}/>
                Verificando actualización…
              </span>
            )}
            <button onClick={polling ? stopPolling : triggerRefresh} disabled={refreshing}
              style={{ background: refreshing ? C.border : polling ? C.amber+'22' : C.green+'22',
                border:`1px solid ${refreshing ? C.border : polling ? C.amber : C.green}`,
                borderRadius:7, color: refreshing ? C.muted : polling ? C.amber : C.green,
                fontWeight:700, padding:'6px 14px', cursor: refreshing ? 'default' : 'pointer', fontSize:11 }}>
              {refreshing ? 'Iniciando...' : polling ? '✕ Cancelar' : '↻ Actualizar screener'}
            </button>
          </div>
        </div>
        <p style={{ fontSize:11, color:C.muted, margin:'4px 0 0' }}>
          Candidatas para position trading · Precio &gt; SMA200 · SMA50 &gt; SMA200 · RSI 40–65 · Cap &gt; $300M
        </p>
        <div style={{ marginTop:4, fontSize:11, display:'flex', alignItems:'center', gap:8 }}>
          {source === 'curated' ? (
            <span style={{ background:'#ffb80022', color:C.amber, padding:'2px 8px', borderRadius:99, fontSize:10, fontWeight:700 }}>
              LISTA CURADA
            </span>
          ) : source === 'finviz' ? (
            <>
              <span style={{ background:'#00e09622', color:C.green, padding:'2px 8px', borderRadius:99, fontSize:10, fontWeight:700 }}>
                FINVIZ LIVE
              </span>
              <span style={{ color:C.muted }}>Actualizado: {updatedAt || screenerDate}</span>
            </>
          ) : source === 'cached' ? (
            <span style={{ background:'#00aaff22', color:C.accent, padding:'2px 8px', borderRadius:99, fontSize:10, fontWeight:700 }}>
              CACHÉ
            </span>
          ) : (
            <span style={{ color:C.muted }}>Cargando...</span>
          )}
          <span style={{ color:C.muted, fontSize:10 }}>· Actualización semanal (lunes)</span>
          {historyWeeks > 0 && (
            <span style={{ fontSize:10, color:C.accent, background:C.accent+'15',
              padding:'1px 7px', borderRadius:99 }}>
              📋 {historyWeeks} sem de historial
            </span>
          )}
        </div>
      </div>

      {refreshMsg && (
        <div style={{ background: refreshMsg.ok ? C.green+'11' : C.red+'11',
          border:`1px solid ${refreshMsg.ok ? C.green : C.red}44`,
          borderRadius:8, padding:'8px 14px', marginBottom:12, fontSize:12,
          color: refreshMsg.ok ? C.green : C.red }}>
          {refreshMsg.text}
        </div>
      )}

      {/* Criterios */}
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8,
        padding:'10px 14px', marginBottom:16, fontSize:11, color:C.muted }}>
        <span style={{ color:C.green, fontWeight:700 }}>Criterios de filtrado: </span>
        Precio sobre SMA200 (tendencia alcista estructural) · SMA50 &gt; SMA200 (golden cross) · RSI 40–65 (momentum sin sobrecompra) · Volumen &gt; 500k · Market cap &gt; $300M · NYSE y NASDAQ
      </div>

      {error && (
        <div style={{ background:'#ff406011', border:`1px solid ${C.red}44`, borderRadius:8,
          padding:'12px 14px', marginBottom:16, fontSize:12, color:C.red }}>
          {error}
        </div>
      )}

      {loading && (
        <div style={{ textAlign:'center', padding:'60px 20px', color:C.muted }}>
          <div style={{ fontSize:13 }}>Consultando screener de position trading...</div>
        </div>
      )}

      {!loading && candidates.length > 0 && (
        <>
          {/* Filtros por sector */}
          <div style={{ display:'flex', gap:6, marginBottom:8, flexWrap:'wrap' }}>
            {sectors.map(s => (
              <button key={s} onClick={() => setFilter(s)}
                style={{ background: filter===s ? (s==='all' ? C.green : SECTOR_COLORS[s]||C.green)+'dd' : 'none',
                  border:`1px solid ${filter===s ? (SECTOR_COLORS[s]||C.green) : C.border}`,
                  borderRadius:6, color: filter===s ? '#000' : C.muted,
                  padding:'4px 12px', cursor:'pointer', fontSize:11, fontWeight: filter===s ? 700 : 400 }}>
                {s === 'all' ? `Todos (${filtered.length})` : s}
              </button>
            ))}
          </div>

          {/* Bulk actions */}
          <div style={{ display:'flex', gap:8, marginBottom:14, alignItems:'center' }}>
            {(() => {
              const notAdded = filtered.filter(c => !watchlist.includes(c.ticker))
              return notAdded.length > 0 ? (
                <button onClick={() => onAddAll(notAdded.map(c => c.ticker))}
                  style={{ background:C.green, border:'none', borderRadius:7, color:'#000',
                    fontWeight:700, padding:'6px 14px', cursor:'pointer', fontSize:11 }}>
                  + Agregar {notAdded.length === filtered.length ? 'todos' : `${notAdded.length} restantes`} a watchlist
                </button>
              ) : null
            })()}
            {(() => {
              const added = filtered.filter(c => watchlist.includes(c.ticker))
              return added.length > 0 ? (
                <button onClick={() => added.forEach(c => onRemove(c.ticker))}
                  style={{ background:'none', border:`1px solid ${C.red}66`, borderRadius:7, color:C.red,
                    fontWeight:700, padding:'6px 14px', cursor:'pointer', fontSize:11 }}>
                  − Quitar {added.length === filtered.length ? 'todos' : added.length} de watchlist
                </button>
              ) : null
            })()}
          </div>
        </>
      )}

      {/* Grid de candidatas */}
      {!loading && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:8 }}>
          {filtered.map(c => {
            const added = inWatchlist(c.ticker)
            const sectorColor = SECTOR_COLORS[c.sector] || C.muted
            return (
              <div key={c.ticker} onClick={() => openPreview(c.ticker)}
                style={{
                  background:C.card,
                  border:`1px solid ${added ? C.green+'55' : C.border}`,
                  borderRadius:10, padding:'12px 14px',
                  borderLeft:`3px solid ${added ? C.green : sectorColor}`,
                  cursor:'pointer', transition:'border-color 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = added ? C.green : C.accent+'66'}
                onMouseLeave={e => e.currentTarget.style.borderColor = added ? C.green+'55' : C.border}
              >
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8 }}>
                  <div>
                    <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                      <span style={{ fontSize:16, fontWeight:700, color:C.text, fontFamily:'monospace' }}>{c.ticker}</span>
                      {added && (
                        <span style={{ fontSize:9, background:C.green+'22', color:C.green,
                          padding:'2px 7px', borderRadius:99, fontWeight:700 }}>
                          ✓ En watchlist
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize:11, color:C.muted, marginTop:2,
                      maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {c.company}
                    </div>
                  </div>
                  <button onClick={e => { e.stopPropagation(); added ? onRemove(c.ticker) : onAdd(c.ticker) }}
                    style={{ background: added ? C.red+'22' : C.green,
                      border: added ? `1px solid ${C.red}66` : 'none',
                      borderRadius:7, color: added ? C.red : '#000',
                      fontWeight:700, padding:'5px 12px', cursor:'pointer',
                      fontSize:11, whiteSpace:'nowrap', flexShrink:0 }}>
                    {added ? '− Quitar' : '+ Agregar'}
                  </button>
                </div>

                <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                  {c.sector && (
                    <span style={{ fontSize:9, background:sectorColor+'22', color:sectorColor,
                      padding:'2px 7px', borderRadius:99, fontWeight:600 }}>
                      {c.sector}
                    </span>
                  )}
                  {c.mktCap && (
                    <span style={{ fontSize:9, background:C.border, color:C.muted,
                      padding:'2px 7px', borderRadius:99 }}>
                      {c.mktCap}
                    </span>
                  )}
                  {c.revGrowth != null && (
                    <span style={{ fontSize:9, padding:'2px 7px', borderRadius:99,
                      background: c.revGrowth > 10 ? C.green+'22' : C.border,
                      color: c.revGrowth > 10 ? C.green : C.muted }}>
                      Rev {c.revGrowth > 0 ? '+' : ''}{c.revGrowth}%
                    </span>
                  )}
                  {c.epsGrowth != null && (
                    <span style={{ fontSize:9, padding:'2px 7px', borderRadius:99,
                      background: c.epsGrowth > 0 ? C.accent+'22' : C.border,
                      color: c.epsGrowth > 0 ? C.accent : C.muted }}>
                      EPS {c.epsGrowth > 0 ? '+' : ''}{c.epsGrowth}%
                    </span>
                  )}
                  {c.weeksInBase != null && c.baseQuality !== 'none' && (
                    <span style={{ fontSize:9, padding:'2px 7px', borderRadius:99,
                      background: c.baseQuality === 'sound' ? C.green+'22' : C.amber+'22',
                      color: c.baseQuality === 'sound' ? C.green : C.amber,
                      fontWeight:600 }}>
                      Base {c.weeksInBase}sem
                    </span>
                  )}
                  {c.weeksInScreener > 0 && (
                    <span title={`Primera vez: ${c.firstSeen || '—'}`}
                      style={{ fontSize:9, padding:'2px 7px', borderRadius:99, fontWeight:600,
                        background: c.weeksInScreener >= 3 ? C.accent+'22' : C.border,
                        color: c.weeksInScreener >= 3 ? C.accent : C.muted }}>
                      📋 {c.weeksInScreener}sem
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
          <div style={{ fontSize:11, marginTop:6 }}>Intenta actualizar el screener</div>
        </div>
      )}

      {!loading && candidates.length > 0 && (
        <div style={{ marginTop:16, padding:'10px 14px', background:C.card, borderRadius:8,
          border:`1px solid ${C.border}`, fontSize:11, color:C.muted }}>
          <b style={{ color:C.amber }}>Aviso:</b> Estas acciones cumplen criterios técnicos de position trading.
          Analiza cada una con el tab Análisis antes de operar — el screener es un punto de partida.
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

            {/* Header modal */}
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <span style={{ fontSize:18, fontWeight:700, fontFamily:'monospace', color:C.text }}>{preview}</span>
                {previewData && (() => {
                  const sc = previewData.scorecard
                  const total = sc ? Object.entries(sc).reduce((s,[k,v]) =>
                    k==='_confidence' ? s : s+(v.score_sugerido??0)*(WEIGHTS[k]||1), 0) : null
                  const dec = calcDecision(total, previewData)
                  const dc = DECISION_COLOR[dec] || C.muted
                  const dl = DECISION_LABEL[dec] || ''
                  return total != null ? (
                    <>
                      <span style={{ fontSize:9, fontWeight:700, padding:'2px 8px', borderRadius:99,
                        color:dc, background:dc+'18', border:`1px solid ${dc}44` }}>{dl}</span>
                      <span style={{ fontSize:13, fontWeight:700, fontFamily:'monospace', color:dc }}>{total}/51</span>
                    </>
                  ) : null
                })()}
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
                No se pudo obtener el análisis
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
                  {/* 4 indicadores clave */}
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:6 }}>
                    {[
                      ['RSI', d.rsi != null ? d.rsi?.toFixed(1) : '—',
                        d.rsi > 65 ? C.red : d.rsi < 40 ? C.amber : C.green],
                      ['RS vs SPY', d.mansfield_rs_raw != null
                        ? `${d.mansfield_rs_raw > 0?'+':''}${d.mansfield_rs_raw}%`
                        : d.mansfield_rs ?? '—',
                        d.mansfield_rs > 0 ? C.green : C.red],
                      ['HH/HL', d.hh_hl ? `${d.hh_hl.hh_count}/${d.hh_hl.hl_count}` : '—',
                        d.hh_hl?.score >= 2 ? C.green : C.muted],
                      ['Stage', d.stage?.stage != null ? `S${d.stage.stage} — ${d.stage.label || ''}` : 'Desconocido',
                        d.stage?.stage === 2 ? C.green : d.stage?.stage === 1 ? C.muted : d.stage?.stage === 3 ? C.amber : d.stage?.stage === 4 ? C.red : C.muted],
                    ].map(([label, val, color]) => (
                      <div key={label} style={{ background:C.bg, borderRadius:6, padding:'7px 10px' }}>
                        <div style={{ fontSize:8, color:C.muted, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:2 }}>{label}</div>
                        <div style={{ fontSize:11, fontWeight:700, color, fontFamily:'monospace' }}>{val}</div>
                      </div>
                    ))}
                  </div>

                  {/* Entrada / Stop / Target */}
                  {(d.entry_suggested || d.stop_suggested || d.target_suggested) && (
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:6 }}>
                      {[
                        ['Entrada', d.entry_suggested, C.amber],
                        ['Stop',    d.stop_suggested,  C.red],
                        ['Target',  d.target_suggested, C.green],
                      ].map(([label, val, color]) => (
                        <div key={label} style={{ background:C.bg, borderRadius:6, padding:'6px 8px', textAlign:'center' }}>
                          <div style={{ fontSize:8, color:C.muted, textTransform:'uppercase', marginBottom:2 }}>{label}</div>
                          <div style={{ fontSize:11, fontWeight:700, color, fontFamily:'monospace' }}>
                            {val ? `$${val}` : '—'}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Earnings warning */}
                  {daysToEarn != null && daysToEarn >= 0 && daysToEarn <= 21 && (
                    <div style={{ fontSize:10, borderRadius:6, padding:'6px 10px',
                      background: daysToEarn < 7 ? C.red+'22' : C.amber+'22',
                      border: `1px solid ${daysToEarn < 7 ? C.red : C.amber}44`,
                      color: daysToEarn < 7 ? C.red : C.amber, fontWeight:600 }}>
                      {daysToEarn < 7 ? '🔴' : '⚠️'} Earnings en {daysToEarn} días ({d.next_earnings})
                    </div>
                  )}

                  {/* Botón agregar */}
                  <button onClick={() => {
                    watchlist.includes(preview) ? onRemove(preview) : onAdd(preview)
                    setPreview(null); setPreviewData(null)
                  }} style={{
                    background: watchlist.includes(preview) ? C.red+'22' : C.green,
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

// ── Position Card ────────────────────────────────────────────────────────────
function PositionCard({ ticker, cachedData, onAnalysed, onRemove, scoreHistory, inSwingModule, session }) {
  const [data,         setData]       = useState(cachedData || null)
  const [loading,      setLoading]    = useState(false)
  const [error,        setError]      = useState(null)
  const [expanded,     setExpanded]   = useState(false)
  const [capital,      setCapital]    = useState('')
  const [riskPct,      setRiskPct]    = useState('1')
  const [editingDate,  setEditingDate] = useState(false)
  const [journalSaved, setJournalSaved] = useState(false)
  const [journalExists, setJournalExists] = useState(false)
  // Overrides manuales: { criterio: scoreManual (0-3) }
  const [overrides,  setOverrides]  = useState(cachedData?._overrides || {})

  // Si cachedData cambia (e.g. tras ↻ manual), sincronizar
  useEffect(() => {
    if (cachedData) {
      setData(cachedData)
      setOverrides(cachedData._overrides || {})
    }
  }, [cachedData])

  // Verificar si ya existe en position_trades (planning/open)
  useEffect(() => {
    if (!session || !ticker) return
    supabase.from('position_trades')
      .select('id')
      .eq('user_id', session.user.id)
      .eq('ticker', ticker)
      .in('status', ['planning', 'open'])
      .limit(1)
      .then(({ data: rows }) => setJournalExists(!!(rows && rows.length > 0)))
  }, [session, ticker, journalSaved])

  const saveToPositionJournal = async () => {
    if (!session || !data) return
    const scoreTotal = data.scorecard
      ? Object.entries(data.scorecard).reduce((s, [k, v]) => {
          if (k === '_confidence') return s
          const sc = overrides[k] != null ? overrides[k] : (v.score_sugerido ?? 0)
          return s + sc * (WEIGHTS[k] || 1)
        }, 0)
      : null
    const decision = calcDecision(scoreTotal, data)
    await supabase.from('position_trades').insert({
      user_id:      session.user.id,
      ticker,
      company_name: data.company_name || null,
      score_total:  scoreTotal != null ? Math.round(scoreTotal) : null,
      decision,
      entry_price:  data.entry_suggested || null,
      stop_loss:    data.stop_suggested || null,
      target1:      data.target_suggested || null,
      status:       'planning',
      created_at:   new Date().toISOString(),
    })
    setJournalSaved(true)
    setJournalExists(true)
    setTimeout(() => setJournalSaved(false), 2500)
  }

  const setOverride = (key, val) => {
    const next = { ...overrides, [key]: val }
    // Si el valor manual coincide con el sugerido, eliminar override
    const suggested = data?.scorecard?.[key]?.score_sugerido ?? 0
    if (val === suggested) delete next[key]
    setOverrides(next)
    // Persistir en caché
    const updated = { ...data, _overrides: next }
    onAnalysed(ticker, updated)
  }

  const runAnalysis = async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/analyze-position/${ticker}`)
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail || 'Error') }
      const json = await res.json()
      setData(json)
      onAnalysed(ticker, json)
    } catch(e) { setError(e.message) }
    setLoading(false)
  }

  // Score total — aplica overrides manuales si existen
  const scoreTotal = data?.scorecard
    ? Object.entries(data.scorecard).reduce((s, [k, v]) => {
        if (k === '_confidence') return s
        const score = overrides[k] != null ? overrides[k] : (v.score_sugerido ?? 0)
        return s + score * (WEIGHTS[k] || 1)
      }, 0)
    : null
  const hasOverrides  = Object.keys(overrides).length > 0
  const hasVeto       = (overrides['precio_sma200'] ?? data?.scorecard?.precio_sma200?.score_sugerido) === 0
  const hasRRVeto     = data?.rr_suggested != null && data.rr_suggested < 2
  const hasStageVeto  = data?.stage?.stage === 3 || data?.stage?.stage === 4
  const hasAnyVeto    = hasVeto || hasRRVeto || hasStageVeto
  const bearMarket     = data?.macro_context?.spy_above_sma200 === false
  const lowConfidence  = data?.scorecard?._confidence != null && data.scorecard._confidence.real < 4
  const priceExtended  = data?.price != null && data?.entry_suggested != null
    && ((data.price - data.entry_suggested) / data.entry_suggested) > 0.05

  const nextEarnings   = data?.next_earnings
  const daysToEarnings = nextEarnings ? (() => {
    try { return Math.ceil((new Date(nextEarnings) - new Date()) / (1000*60*60*24)) } catch { return null }
  })() : null
  const hasEarningsNearby = daysToEarnings != null && daysToEarnings >= 0 && daysToEarnings <= 7

  const decision = calcDecision(scoreTotal, data)

  const savedAt = data?._savedAt
  const cacheAgeHours = savedAt ? (new Date() - new Date(savedAt)) / (1000*60*60) : null
  const cacheStale = cacheAgeHours != null && cacheAgeHours > 24
  const cacheVeryStale = cacheAgeHours != null && cacheAgeHours > 48
  const savedLabel = savedAt ? (() => {
    const d = new Date(savedAt), now = new Date()
    const dDate   = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    const nowDate = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`
    if (dDate === nowDate) {
      const h = d.getHours().toString().padStart(2,'0')
      const m = d.getMinutes().toString().padStart(2,'0')
      return `hoy ${h}:${m}`
    }
    const y = new Date(now); y.setDate(y.getDate()-1)
    const yesterDate = `${y.getFullYear()}-${y.getMonth()}-${y.getDate()}`
    if (dDate === yesterDate) return 'ayer'
    return `hace ${Math.floor((now-d)/(1000*60*60*24))}d`
  })() : null

  // Ex-dividend warning
  const exDivDate = data?.fundamentals?.exDividendDate
  const divYield  = data?.fundamentals?.dividendYield || 0
  const divPerShare = data?.fundamentals?.dividendPerShare
  const daysToExDiv = exDivDate ? (() => {
    try { return Math.ceil((new Date(exDivDate) - new Date()) / (1000*60*60*24)) } catch { return null }
  })() : null
  const showExDivWarning = daysToExDiv != null && daysToExDiv >= 0 && daysToExDiv <= 14 && divYield > 0.3

  const decisionColor = DECISION_COLOR[decision] || C.muted
  const decisionLabel = DECISION_LABEL[decision] || ''

  const f = data?.fundamentals || {}
  const scoreColors = ['#4a6080','#ffb800','#00aaff','#00e096']

  return (
    <div style={{ background:C.card,
      border:`1px solid ${hasAnyVeto ? C.red+'55' : decision==='OPERAR_CONVICCION' ? C.green+'44' : C.border}`,
      borderRadius:12, padding:'16px', display:'flex', flexDirection:'column', gap:11,
      borderLeft:`3px solid ${hasAnyVeto ? C.red : decisionColor}` }}>

      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:7, flexWrap:'wrap' }}>
            <span style={{ fontSize:16, fontWeight:700, fontFamily:'monospace', color:C.text }}>{ticker}</span>
            {decision && !loading && (
              <span style={{ fontSize:9, fontWeight:700, padding:'2px 8px', borderRadius:99,
                color: decisionColor, background: decisionColor+'18', border:`1px solid ${decisionColor}44` }}>
                {decisionLabel}
              </span>
            )}
            {hasOverrides && !loading && (
              <span style={{ fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:99,
                color: C.amber, background: C.amber+'18', border:`1px solid ${C.amber}44` }}>
                ✏ EDITADO
              </span>
            )}
          </div>
          {/* Razón del veto o cautela forzada */}
          {!loading && decision && (() => {
            const reasons = []
            if (hasStageVeto)  reasons.push(`Stage ${data.stage.stage} — ${data.stage.stage === 3 ? 'distribución' : 'declive'}`)
            if (hasVeto)       reasons.push('precio bajo SMA200')
            if (hasRRVeto)     reasons.push(`R/R ${data.rr_suggested?.toFixed(1)}x insuficiente`)
            if (bearMarket)     reasons.push('mercado bajista (SPY < SMA200)')
            if (lowConfidence)  reasons.push(`datos incompletos (${data.scorecard._confidence.real}/7)`)
            if (priceExtended)  reasons.push(`precio extendido ${(((data.price - data.entry_suggested) / data.entry_suggested) * 100).toFixed(1)}% sobre entrada`)
            if (reasons.length === 0) return null
            return (
              <div style={{ fontSize:9, color: hasAnyVeto ? C.red : C.amber, marginTop:2 }}>
                {hasAnyVeto ? '⛔ ' : '⚠ '}{reasons.join(' · ')}
              </div>
            )
          })()}

          {data?.company_name && (
            <div style={{ fontSize:11, color:C.muted, marginTop:2,
              overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {data.company_name}
            </div>
          )}
          {data?.sector && (
            <div style={{ fontSize:9, marginTop:1, display:'flex', alignItems:'center', gap:6 }}>
              <span style={{ color:C.accent }}>{data.sector}</span>
              {data.sector_etf && (
                <span style={{ color:C.muted }}>· {data.sector_etf}</span>
              )}
              {data.rs_sector != null && (
                <span style={{ fontFamily:'monospace', fontWeight:700, fontSize:9,
                  color: data.rs_sector > 2 ? C.green : data.rs_sector > 0 ? '#7fd4a0' : data.rs_sector > -2 ? C.amber : C.red }}>
                  RS {data.rs_sector > 0 ? '+' : ''}{data.rs_sector}
                </span>
              )}
            </div>
          )}
          {savedLabel && (
            <div style={{ fontSize:9, marginTop:1, display:'flex', alignItems:'center', gap:5 }}>
              <span style={{ color: cacheVeryStale ? C.red : cacheStale ? C.amber : C.muted }}>
                Actualizado {savedLabel}
              </span>
              {cacheStale && (
                <span style={{ fontSize:9, fontWeight:700, padding:'1px 5px', borderRadius:99,
                  background: cacheVeryStale ? C.red+'22' : C.amber+'22',
                  color: cacheVeryStale ? C.red : C.amber,
                  border: `1px solid ${cacheVeryStale ? C.red : C.amber}44` }}>
                  {cacheVeryStale ? '⚠ +48h' : '⚠ +24h'}
                </span>
              )}
            </div>
          )}
        </div>
        <div style={{ display:'flex', gap:5, alignItems:'center', flexShrink:0 }}>
          <button onClick={runAnalysis} disabled={loading} title="Re-analizar"
            style={{ background:'none', border:`1px solid ${C.border}`, borderRadius:5,
              color: loading ? M : C.muted, cursor: loading ? 'not-allowed' : 'pointer',
              padding:'4px 8px', fontSize:12 }}>↻</button>
          <button onClick={() => onRemove(ticker)} title="Eliminar"
            style={{ background:'none', border:`1px solid ${C.red}44`, borderRadius:5,
              color:C.red, cursor:'pointer', padding:'4px 8px', fontSize:12, opacity:0.7 }}>×</button>
        </div>
      </div>

      {/* Error */}
      {error && <div style={{ fontSize:10, color:C.red, background:'#ff406011', padding:'6px 9px', borderRadius:6 }}>{error}</div>}

      {/* Sin cache — pedir análisis manual */}
      {!data && !loading && (
        <button onClick={runAnalysis}
          style={{ background:`${M}15`, border:`1px solid ${M}55`, borderRadius:8,
            color:M, cursor:'pointer', padding:9, fontSize:12, fontWeight:700, letterSpacing:'0.06em' }}>
          ANALIZAR ↗
        </button>
      )}

      {/* Loading */}
      {loading && !data && (
        <div style={{ fontSize:12, color:C.muted, textAlign:'center', padding:'20px 0' }}>
          Analizando {ticker}...
        </div>
      )}
      {loading && data && (
        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 0' }}>
          <div style={{ width:13, height:13, border:`2px solid ${C.border}`, borderTop:`2px solid ${M}`, borderRadius:'50%', animation:'spin 0.7s linear infinite', flexShrink:0 }}/>
          <span style={{ fontSize:12, color:C.muted }}>Obteniendo datos actualizados…</span>
        </div>
      )}

      {/* ── Datos ── */}
      {data && (
        <>
          {/* Precio y SMAs */}
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
            background:C.bg, borderRadius:8, padding:'9px 12px' }}>
            <div>
              <div style={{ fontSize:22, fontWeight:700, fontFamily:'monospace', color:C.text }}>${data.price}</div>
              <div style={{ fontSize:9, color:C.muted, marginTop:1 }}>precio actual</div>
            </div>
            <div style={{ textAlign:'right', display:'flex', flexDirection:'column', gap:3 }}>
              <div style={{ fontSize:10, color:C.muted }}>
                SMA20 <span style={{ color:C.text, fontFamily:'monospace' }}>${data.sma20}</span>
              </div>
              <div style={{ fontSize:10, color:C.muted }}>
                SMA50 <span style={{ color:C.amber, fontFamily:'monospace' }}>${data.sma50}</span>
              </div>
              <div style={{ fontSize:10, color:C.muted }}>
                SMA200 <span style={{ color: data.sma200 && data.price >= data.sma200 ? C.green : C.red, fontFamily:'monospace' }}>${data.sma200}</span>
              </div>
            </div>
          </div>

          {/* Macro context */}
          <div style={{ padding:'7px 10px', borderRadius:7, fontSize:10, fontWeight:600,
            background: data.macro_context?.spy_above_sma200 ? '#00e09612' : '#ff406012',
            color: data.macro_context?.spy_above_sma200 ? C.green : C.red,
            display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span>{data.macro_context?.spy_above_sma200 ? '▲ Mercado alcista' : '▼ Mercado bajista'}</span>
            <span style={{ color:C.muted, fontWeight:400, fontSize:9 }}>
              SPY ${data.macro_context?.spy_price} / SMA200 ${data.macro_context?.spy_sma200}
            </span>
          </div>

          {/* Stage Analysis (Weinstein) */}
          {data.stage?.stage != null && (() => {
            const s = data.stage
            const stageColors = { 1: C.muted, 2: C.green, 3: C.amber, 4: C.red }
            const stageBg     = { 1: '#4a608022', 2: '#00e09615', 3: '#ffb80015', 4: '#ff406015' }
            const color = stageColors[s.stage] || C.muted
            const bg    = stageBg[s.stage]    || '#4a608022'
            return (
              <div style={{ padding:'7px 10px', borderRadius:7, fontSize:10, fontWeight:600,
                background: bg, color, display:'flex', justifyContent:'space-between', alignItems:'center',
                border: s.stage === 4 ? `1px solid ${C.red}55` : 'none' }}>
                <span>Stage {s.stage} — {s.label?.replace(/Stage \d — /,'')}</span>
                <span style={{ color:C.muted, fontWeight:400, fontSize:9 }}>{s.slope_4w_pct > 0 ? '+' : ''}{s.slope_4w_pct}% / 4w · SMA30 ${s.sma30_weekly}</span>
              </div>
            )
          })()}

          {/* Stage 4 aviso */}
          {data.stage?.stage === 4 && (
            <div style={{ fontSize:10, color:C.amber, background:'#ffb80012',
              border:`1px solid ${C.amber}44`, borderRadius:6, padding:'7px 10px', fontWeight:600 }}>
              ⚠️ Stage 4 (declive) — considerar esperar recuperación a Stage 1/2
            </div>
          )}

          {/* Mercado bajista — warning Weinstein */}
          {data.macro_context?.spy_above_sma200 === false && (
            <div style={{ fontSize:10, color:C.red, background:'#ff406015',
              border:`1px solid ${C.red}55`, borderRadius:6, padding:'7px 10px', fontWeight:600 }}>
              ⚠️ Mercado bajista (SPY &lt; SMA200) — score ajustado -4 pts · Weinstein: evitar compras en Stage 4 de mercado
            </div>
          )}

          {/* Score bar + decisión */}
          {scoreTotal != null && (
            <div>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                <span style={{ fontSize:10, color:C.muted }}>Score total</span>
                <span style={{ fontSize:13, fontWeight:700, fontFamily:'monospace', color: decisionColor }}>
                  {scoreTotal} / {MAX_SCORE}
                </span>
              </div>
              <div style={{ height:6, background:C.bg, borderRadius:99, overflow:'hidden', border:`1px solid ${C.border}` }}>
                <div style={{ height:'100%', width:`${Math.min(100,(scoreTotal/MAX_SCORE)*100)}%`,
                  background: decisionColor, borderRadius:99, transition:'width 0.4s' }} />
              </div>
            </div>
          )}

          {/* Historial de score */}
          {scoreHistory && scoreHistory.length >= 2 && (
            <div>
              <div style={{ fontSize:9, color:C.muted, marginBottom:4, textTransform:'uppercase', letterSpacing:'0.05em' }}>
                Historial score ({scoreHistory.length} análisis)
              </div>
              <ResponsiveContainer width="100%" height={52}>
                <LineChart data={scoreHistory} margin={{ top:2, right:4, left:0, bottom:0 }}>
                  <YAxis domain={[0, 51]} hide />
                  <ReferenceLine y={32} stroke={C.green}  strokeDasharray="3 3" strokeOpacity={0.4} />
                  <ReferenceLine y={22} stroke={C.amber}  strokeDasharray="3 3" strokeOpacity={0.4} />
                  <Tooltip
                    contentStyle={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:6, fontSize:10 }}
                    formatter={(v, _, p) => [`${v}/51 — ${p.payload.decision}`, '']}
                    labelFormatter={l => l}
                  />
                  <Line type="monotone" dataKey="score" stroke={C.accent} strokeWidth={2}
                    dot={{ r:3, fill:C.accent }} activeDot={{ r:4 }} />
                </LineChart>
              </ResponsiveContainer>
              <div style={{ display:'flex', gap:10, fontSize:9, color:C.muted, marginTop:2 }}>
                <span style={{ color:C.green }}>— ≥32 Convicción</span>
                <span style={{ color:C.amber }}>— ≥22 Cautela</span>
              </div>
            </div>
          )}

          {/* Confidence score */}
          {data.scorecard?._confidence && (() => {
            const conf = data.scorecard._confidence
            const pct  = Math.round((conf.real / conf.total) * 100)
            const color = pct >= 85 ? C.green : pct >= 57 ? C.amber : C.red
            const label = pct >= 85 ? 'Alta' : pct >= 57 ? 'Media' : 'Baja'
            return (
              <div style={{ display:'flex', alignItems:'center', gap:7, fontSize:10, color:C.muted }}>
                <span>Confianza del análisis:</span>
                <span style={{ fontWeight:700, color }}>{label}</span>
                <span style={{ color:C.muted }}>({conf.real}/{conf.total} criterios con datos reales)</span>
              </div>
            )
          })()}

          {/* Vetos */}
          {hasVeto && (
            <div style={{ fontSize:10, color:C.red, background:'#ff406015',
              border:`1px solid ${C.red}44`, borderRadius:6, padding:'7px 10px', fontWeight:600 }}>
              ⛔ Precio bajo SMA200 — VETO ABSOLUTO
            </div>
          )}
          {!hasVeto && hasRRVeto && (
            <div style={{ fontSize:10, color:C.red, background:'#ff406015',
              border:`1px solid ${C.red}44`, borderRadius:6, padding:'7px 10px', fontWeight:600 }}>
              ⛔ R/R &lt; 2 — VETO ABSOLUTO
            </div>
          )}

          {/* Indicadores clave — 6 celdas */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:6 }}>
            {[
              ['RSI', data.rsi != null ? data.rsi : '—',   data.rsi > 65 ? C.red : data.rsi < 40 ? C.amber : C.green],
              ['RS vs SPY', data.mansfield_rs_raw != null
                ? `${data.mansfield_rs_raw > 0 ? '+' : ''}${data.mansfield_rs_raw}%`
                : data.mansfield_rs != null ? data.mansfield_rs : '—',
                data.mansfield_rs > 0 ? C.green : C.red],
              ['HH/HL', data.hh_hl ? `${data.hh_hl.hh_count}/${data.hh_hl.hl_count}` : '—', data.hh_hl?.score >= 2 ? C.green : C.muted],
              ['Volumen%', data.vol_ratio != null ? `${data.vol_ratio}%` : '—', data.vol_ratio > 120 ? C.green : C.muted],
              ['ATR', data.atr != null ? `$${data.atr}` : '—', C.muted],
              ['RS Sector', data.rs_sector != null ? data.rs_sector : '—', data.rs_sector > 0 ? C.green : data.rs_sector < 0 ? C.red : C.muted],
            ].map(([label, val, color]) => (
              <div key={label} style={{ background:C.bg, borderRadius:6, padding:'6px 8px' }}>
                <div style={{ fontSize:8, color:C.muted, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:2 }}>{label}</div>
                <div style={{ fontSize:12, fontFamily:'monospace', fontWeight:600, color }}>{val ?? '—'}</div>
              </div>
            ))}
          </div>

          {/* Entry / Stop / Target */}
          {(data.entry_suggested || data.stop_suggested || data.target_suggested) && (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:6 }}>
              {[
                ['Entrada sug.', data.entry_suggested ? `$${data.entry_suggested}` : '—', C.amber],
                ['Stop sug.',    data.stop_suggested  ? `$${data.stop_suggested}`  : '—', C.red],
                ['Target sug.',  data.target_suggested? `$${data.target_suggested}`: '—', C.green],
              ].map(([label, val, color]) => (
                <div key={label} style={{ background:C.bg, borderRadius:6, padding:'6px 8px',
                  border:`1px solid ${color}22` }}>
                  <div style={{ fontSize:8, color:C.muted, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:2 }}>{label}</div>
                  <div style={{ fontSize:12, fontFamily:'monospace', fontWeight:700, color }}>{val}</div>
                </div>
              ))}
            </div>
          )}
          {data.rr_suggested != null && (
            <div style={{ fontSize:10, color: data.rr_suggested >= 2 ? C.green : data.rr_suggested >= 1.5 ? C.amber : C.red,
              background: data.rr_suggested >= 2 ? '#00e09610' : '#ff406010',
              borderRadius:6, padding:'5px 9px', fontWeight:600 }}>
              R/R sugerido: {data.rr_suggested}x {data.rr_suggested < 1 ? '⛔' : data.rr_suggested >= 2 ? '✓' : '⚠'}
            </div>
          )}

          {/* Sizing Calculator */}
          {data.entry_suggested && data.stop_suggested && data.entry_suggested > data.stop_suggested && (() => {
            const entry   = data.entry_suggested
            const stop    = data.stop_suggested
            const target  = data.target_suggested
            const riskPer = entry - stop
            const cap     = parseFloat(capital)
            const rsk     = parseFloat(riskPct) / 100
            const shares  = (cap > 0 && rsk > 0 && riskPer > 0)
              ? Math.floor((cap * rsk) / riskPer) : null
            const invested = shares ? (shares * entry) : null
            const pctPort  = (invested && cap) ? ((invested / cap) * 100).toFixed(1) : null
            const potGain  = (shares && target) ? ((target - entry) * shares).toFixed(0) : null
            const potLoss  = shares ? (riskPer * shares).toFixed(0) : null
            return (
              <div style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:8, padding:'10px 12px' }}>
                <div style={{ fontSize:10, color:C.muted, fontWeight:600, marginBottom:8, textTransform:'uppercase', letterSpacing:'0.05em' }}>
                  Sizing Calculator
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, marginBottom:8 }}>
                  <div>
                    <div style={{ fontSize:9, color:C.muted, marginBottom:3 }}>Capital disponible ($)</div>
                    <input type="number" value={capital} onChange={e => setCapital(e.target.value)}
                      placeholder="ej: 50000"
                      style={{ width:'100%', background:C.card, border:`1px solid ${C.border}`, borderRadius:5,
                        padding:'5px 8px', color:C.text, fontSize:11, outline:'none', boxSizing:'border-box' }}
                      onFocus={e => e.target.style.borderColor=C.accent}
                      onBlur={e  => e.target.style.borderColor=C.border}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize:9, color:C.muted, marginBottom:3 }}>Riesgo por operación (%)</div>
                    <input type="number" value={riskPct} onChange={e => setRiskPct(e.target.value)}
                      placeholder="ej: 1"
                      style={{ width:'100%', background:C.card, border:`1px solid ${C.border}`, borderRadius:5,
                        padding:'5px 8px', color:C.text, fontSize:11, outline:'none', boxSizing:'border-box' }}
                      onFocus={e => e.target.style.borderColor=C.accent}
                      onBlur={e  => e.target.style.borderColor=C.border}
                    />
                  </div>
                </div>
                {shares != null ? (
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:5 }}>
                    {[
                      ['Acciones',     shares,                    C.accent],
                      ['Monto inv.',   `$${invested?.toLocaleString()}`, C.text],
                      ['% portafolio', `${pctPort}%`,             pctPort > 20 ? C.red : pctPort > 10 ? C.amber : C.green],
                      ['Riesgo max.',  `-$${potLoss}`,            C.red],
                      ['Ganancia obj.',`+$${potGain}`,            C.green],
                      ['R/R real',     data.rr_suggested ? `${data.rr_suggested}x` : '—', C.muted],
                    ].map(([label, val, color]) => (
                      <div key={label} style={{ background:C.card, borderRadius:5, padding:'5px 7px' }}>
                        <div style={{ fontSize:8, color:C.muted, marginBottom:1 }}>{label}</div>
                        <div style={{ fontSize:11, fontFamily:'monospace', fontWeight:700, color }}>{val}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize:10, color:C.muted, textAlign:'center', padding:'4px 0' }}>
                    Ingresa capital y % de riesgo para calcular
                  </div>
                )}
              </div>
            )
          })()}

          {/* Base Analysis */}
          {data.base?.base_quality !== 'none' && data.base?.weeks_in_base > 0 && (() => {
            const b = data.base
            const isSolid = b.base_quality === 'sound'
            const color = isSolid ? C.green : C.amber
            const bg    = isSolid ? '#00e09612' : '#ffb80012'
            return (
              <div style={{ fontSize:10, padding:'6px 10px', borderRadius:6, background:bg,
                color, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span style={{ fontWeight:600 }}>
                  {isSolid ? '◼' : '◻'} Base {isSolid ? 'sólida' : 'corta'}: {b.weeks_in_base} semanas
                  {b.range_pct != null ? ` · rango ${b.range_pct}%` : ''}
                </span>
                {b.breakout_vol === true  && <span style={{ color:C.green,  fontWeight:700 }}>Vol ✓</span>}
                {b.breakout_vol === false && <span style={{ color:C.amber,  fontWeight:500 }}>Vol ⚠</span>}
              </div>
            )
          })()}

          {/* Cross-module warning */}
          {inSwingModule && (
            <div style={{ fontSize:10, borderRadius:6, padding:'7px 10px',
              background:'#00d4ff11', border:'1px solid #00d4ff44',
              display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontWeight:700, color:'#00d4ff',
                background:'#00d4ff18', border:'1px solid #00d4ff44',
                borderRadius:99, padding:'2px 8px', whiteSpace:'nowrap' }}>
                ⚡ Swing
              </span>
              <span style={{ color:'#00d4ff' }}>Este ticker está en tu watchlist de Swing Trading</span>
            </div>
          )}

          {/* Earnings warning */}
          {daysToEarnings != null && daysToEarnings >= 0 && daysToEarnings <= 21 && (
            <div style={{ fontSize:10, borderRadius:6, padding:'7px 10px',
              background: daysToEarnings < 7 ? C.red+'22' : daysToEarnings < 14 ? C.amber+'22' : C.bg,
              border: `1px solid ${daysToEarnings < 7 ? C.red : daysToEarnings < 14 ? C.amber : C.border}55`,
              display:'flex', alignItems:'center', gap:6 }}>
              <span>{daysToEarnings < 7 ? '🔴' : daysToEarnings < 14 ? '⚠️' : '📅'}</span>
              <span style={{ color: daysToEarnings < 7 ? C.red : daysToEarnings < 14 ? C.amber : C.muted, fontWeight: daysToEarnings < 14 ? 700 : 400 }}>
                Earnings en <strong>{daysToEarnings} días</strong> ({nextEarnings})
                {daysToEarnings < 7 && ' — riesgo muy alto, evitar entrada'}
                {daysToEarnings >= 7 && daysToEarnings < 14 && ' — considerar esperar resultado'}
              </span>
            </div>
          )}
          {daysToEarnings != null && daysToEarnings < 0 && nextEarnings && (
            <div style={{ fontSize:10, color:C.muted, background:C.bg, borderRadius:6, padding:'5px 9px' }}>
              Último earnings: <span style={{ fontWeight:600 }}>{nextEarnings}</span>
            </div>
          )}

          {/* Ex-dividend warning */}
          {showExDivWarning && (
            <div style={{ fontSize:10, borderRadius:6, padding:'7px 10px',
              background: daysToExDiv < 7 ? C.red+'22' : C.amber+'22',
              border: `1px solid ${daysToExDiv < 7 ? C.red : C.amber}55`,
              display:'flex', alignItems:'center', gap:6 }}>
              <span>{daysToExDiv < 7 ? '🔴' : '⚠️'}</span>
              <span style={{ color: daysToExDiv < 7 ? C.red : C.amber, fontWeight:700 }}>
                Ex-dividend en <strong>{daysToExDiv} días</strong> ({exDivDate})
                {divPerShare ? ` · $${divPerShare}/acción` : ''}
                {daysToExDiv < 7 ? ' — precio caerá el monto del dividendo' : ' — presión bajista próxima'}
              </span>
            </div>
          )}

          {/* Próxima revisión */}
          {(() => {
            const stage = data?.stage?.stage
            const suggestedWeeks = stage === 2 ? 4 : stage === 3 ? 2 : stage === 1 ? 8 : 4
            const savedDate = data?._reviewDate
            const reviewDate = savedDate
              ? new Date(savedDate)
              : (() => { const d = new Date(); d.setDate(d.getDate() + suggestedWeeks * 7); return d })()
            const reviewDateStr = reviewDate.toISOString().slice(0, 10)
            const daysLeft = Math.ceil((reviewDate - new Date()) / (1000*60*60*24))
            const isOverdue = daysLeft < 0
            const isSoon    = daysLeft >= 0 && daysLeft <= 7
            const color = isOverdue ? C.red : isSoon ? C.amber : C.muted

            // Texto de acción según estado y stage
            const actionText = stage === 3
              ? 'Posible techo — evaluar reducir o salir'
              : isOverdue
                ? '¿Sigue en Stage 2? Confirmar tesis antes de continuar'
                : isSoon
                  ? 'Revisar pronto — confirmar Stage y señales'
                  : stage === 2
                    ? 'Mantener mientras precio > SMA30 semanal'
                    : stage === 1
                      ? 'Esperar ruptura de resistencia para entrada'
                      : 'Revisar tesis y Stage'

            const saveDate = (val) => {
              const updated = { ...data }
              if (val) updated._reviewDate = val
              else delete updated._reviewDate
              onAnalysed(ticker, updated)
              setEditingDate(false)
            }

            return (
              <div style={{ background:C.bg, borderRadius:8, padding:'9px 12px',
                border:`1px solid ${isOverdue ? C.red+'44' : isSoon ? C.amber+'44' : stage === 3 ? C.amber+'44' : C.border}` }}>
                <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                  <span style={{ fontSize:9, color:C.muted, textTransform:'uppercase', letterSpacing:'0.07em' }}>
                    Próxima revisión
                  </span>
                  <span style={{ fontSize:9, color:C.muted, background:C.card,
                    border:`1px solid ${C.border}`, borderRadius:99, padding:'1px 6px' }}>
                    {stage ? `Stage ${stage} · ${suggestedWeeks}s` : `${suggestedWeeks}s`}
                  </span>
                </div>
                {editingDate ? (
                  <div style={{ display:'flex', gap:6, marginTop:6, alignItems:'center' }}>
                    <input type="date" defaultValue={reviewDateStr}
                      style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:6,
                        color:C.text, fontSize:11, padding:'4px 8px', outline:'none', flex:1 }}
                      onBlur={e => saveDate(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') saveDate(e.target.value) }}
                      autoFocus
                    />
                    <button onClick={() => setEditingDate(false)}
                      style={{ background:'none', border:'none', color:C.muted, cursor:'pointer', fontSize:11 }}>✕</button>
                  </div>
                ) : (
                  <>
                  <div style={{ display:'flex', alignItems:'flex-start', gap:8, marginTop:6 }}>
                    <span style={{ fontSize:14, fontWeight:700, fontFamily:'monospace', color }}>
                      {reviewDate.toLocaleDateString('es', { day:'numeric', month:'short', year:'numeric' })}
                    </span>
                    <span style={{ fontSize:10, color }}>
                      {isOverdue ? `vencida hace ${Math.abs(daysLeft)}d` : daysLeft === 0 ? 'hoy' : `en ${daysLeft}d`}
                    </span>
                    <div style={{ marginLeft:'auto', display:'flex', flexDirection:'column', gap:4, alignItems:'stretch' }}>
                      <button onClick={() => setEditingDate(true)}
                        style={{ background:'none', border:`1px solid ${C.border}`,
                          borderRadius:6, color:C.muted, cursor:'pointer', fontSize:10, padding:'3px 8px' }}>
                        ✏ Cambiar
                      </button>
                      {savedDate && (
                        <button onClick={() => saveDate(null)} title="Restaurar fecha automática"
                          style={{ background:'none', border:`1px solid ${C.border}`, borderRadius:6,
                            color:C.muted, cursor:'pointer', fontSize:10, padding:'3px 8px' }}>
                          ↺ Auto
                        </button>
                      )}
                    </div>
                  </div>
                  <div style={{ fontSize:10, color: isOverdue || stage === 3 ? color : C.muted, marginTop:3 }}>
                    {actionText}
                  </div>
                  </>
                )}
              </div>
            )
          })()}

          {/* Scorecard detalle — expandible */}
          {data.scorecard && (
            <>
              <button onClick={() => setExpanded(e => !e)}
                style={{ background:'none', border:`1px solid ${C.border}`, borderRadius:7,
                  color:C.muted, padding:'5px 10px', cursor:'pointer', fontSize:10,
                  textAlign:'left', display:'flex', justifyContent:'space-between' }}>
                <span>Scorecard detallado</span>
                <span>{expanded ? '▲' : '▼'}</span>
              </button>

              {expanded && (
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  {Object.entries(data.scorecard).filter(([k]) => k !== '_confidence').map(([key, crit]) => {
                    const suggested = crit.score_sugerido ?? 0
                    const score     = overrides[key] != null ? overrides[key] : suggested
                    const isOverridden = overrides[key] != null
                    const peso   = crit.peso ?? WEIGHTS[key] ?? 1
                    const color  = scoreColors[Math.min(score, 3)]
                    const esVeto = (key === 'precio_sma200' && score === 0) || (key === 'ratio_rr' && score === 0)
                    return (
                      <div key={key} style={{ padding:'8px 10px', borderRadius:7, background:C.bg,
                        border:`1px solid ${esVeto ? C.red+'44' : isOverridden ? C.amber+'44' : C.border}` }}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:3 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                            <span style={{ fontSize:11, fontWeight:600, color:C.text }}>
                              {CRITERIA_LABELS[key] || key}
                            </span>
                            <span style={{ fontSize:9, color:C.muted, background:C.card,
                              border:`1px solid ${C.border}`, borderRadius:99, padding:'1px 5px' }}>×{peso}</span>
                            {isOverridden
                              ? <span style={{ fontSize:9, color:C.amber, background:C.amber+'15',
                                  border:`1px solid ${C.amber}33`, borderRadius:99, padding:'1px 5px' }}>
                                  ✏ MANUAL (AUTO:{suggested})
                                </span>
                              : crit.es_automatico && (
                                  <span style={{ fontSize:9, color:C.accent, background:C.accent+'15',
                                    border:`1px solid ${C.accent}33`, borderRadius:99, padding:'1px 5px' }}>AUTO</span>
                                )
                            }
                            {esVeto && <span style={{ fontSize:9, color:C.red, fontWeight:700 }}>⚠ VETO</span>}
                          </div>
                          <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                            <span style={{ fontSize:12, fontWeight:700, fontFamily:'monospace', color }}>{score}/3</span>
                            <span style={{ fontSize:9, color:C.muted }}>= {score*peso} pts</span>
                          </div>
                        </div>
                        {/* Mini barra */}
                        <div style={{ height:3, background:C.card, borderRadius:99, overflow:'hidden', marginBottom:4 }}>
                          <div style={{ height:'100%', width:`${(score/3)*100}%`, background:color, borderRadius:99 }} />
                        </div>
                        {crit.justificacion && (
                          <div style={{ fontSize:10, color: esVeto ? C.red : C.muted, lineHeight:1.5, marginBottom:6 }}>
                            {crit.justificacion}
                          </div>
                        )}
                        {/* Botones de ajuste manual */}
                        <div style={{ display:'flex', alignItems:'center', gap:4, marginTop:2 }}>
                          <span style={{ fontSize:9, color:C.muted }}>Ajustar:</span>
                          {[0,1,2,3].map(v => (
                            <button key={v} onClick={() => setOverride(key, v)}
                              style={{ width:22, height:22, borderRadius:4, fontSize:10, fontWeight:700,
                                cursor:'pointer', border:'none',
                                background: score === v ? scoreColors[v] : C.card,
                                color: score === v ? '#000' : C.muted,
                                outline: score === v ? `2px solid ${scoreColors[v]}` : 'none' }}>
                              {v}
                            </button>
                          ))}
                          {isOverridden && (
                            <button onClick={() => setOverride(key, suggested)}
                              style={{ fontSize:9, padding:'2px 6px', borderRadius:4, cursor:'pointer',
                                background:'none', border:`1px solid ${C.border}`, color:C.muted }}>
                              Reset
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}

                  {/* Fundamentales breves */}
                  {(f.revenueGrowth != null || f.epsGrowth != null || f.peRatio != null || f.mktCap || f.profitMargin != null || f.operatingMargin != null) && (
                    <div style={{ background:C.bg, borderRadius:7, padding:'8px 10px',
                      border:`1px solid ${C.border}` }}>
                      <div style={{ fontSize:10, color:C.text, fontWeight:600, marginBottom:6 }}>Fundamentales</div>
                      <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:5 }}>
                        {[
                          ['Rev Growth',   f.revenueGrowth  != null ? `${f.revenueGrowth > 0?'+':''}${f.revenueGrowth}%`   : null, f.revenueGrowth > 0 ? C.green : C.red],
                          ['EPS Growth',   f.epsGrowth      != null ? `${f.epsGrowth > 0?'+':''}${f.epsGrowth}%`           : null, f.epsGrowth > 0 ? C.green : C.red],
                          ['Margen neto',  f.profitMargin   != null ? `${f.profitMargin}%`                                  : null, f.profitMargin > 10 ? C.green : f.profitMargin > 0 ? C.amber : C.red],
                          ['Margen op.',   f.operatingMargin!= null ? `${f.operatingMargin}%`                               : null, f.operatingMargin > 15 ? C.green : f.operatingMargin > 0 ? C.amber : C.red],
                          ['P/E',          f.peRatio        ? `${f.peRatio}x`                                               : null, C.muted],
                          ['Mkt Cap',      f.mktCap         || null,                                                                C.muted],
                        ].filter(([,v]) => v != null).map(([label, val, color]) => (
                          <div key={label} style={{ display:'flex', justifyContent:'space-between' }}>
                            <span style={{ fontSize:10, color:C.muted }}>{label}</span>
                            <span style={{ fontSize:10, fontWeight:600, color }}>{val}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Botón agregar al Journal */}
      {data && !data.error && !loading && (
        <button
          onClick={journalExists ? undefined : saveToPositionJournal}
          disabled={journalExists}
          style={{ width:'100%', marginTop:8,
            background: journalExists ? '#a78bfa11' : journalSaved ? '#a78bfa22' : 'none',
            border:`1px solid ${journalExists ? '#a78bfa44' : journalSaved ? '#a78bfa' : C.border}`,
            borderRadius:7,
            color: journalExists ? '#a78bfa99' : journalSaved ? '#a78bfa' : C.muted,
            cursor: journalExists ? 'default' : 'pointer',
            padding:'7px 10px', fontSize:11, transition:'all 0.2s',
            display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
          {journalExists ? '📋 Ya está en el Journal (planning/activo)' : journalSaved ? '✓ Guardado en Journal' : '📋 Agregar al Journal'}
        </button>
      )}
    </div>
  )
}

// ── Position Watchlist Table ─────────────────────────────────────────────────
function PositionWatchlistTable({ tickers, cache, onRemove, onRefresh, refreshingTickers, onRowClick, swingExposedTickers = [], selected = new Set(), onToggleSelect, onToggleSelectAll }) {
  const [sortCol, setSortCol] = useState(null)
  const [sortDir, setSortDir] = useState('desc')
  const [filterText, setFilterText] = useState('')

  const handleSort = col => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
  }
  const SortIcon = ({ col }) => sortCol !== col
    ? <span style={{ opacity:0.3, marginLeft:3 }}>↕</span>
    : <span style={{ marginLeft:3, color:C.green }}>{sortDir==='asc'?'↑':'↓'}</span>

  let rows = tickers.map(ticker => {
    const d = cache[ticker]
    const scoreTotal = d?.scorecard
      ? Object.entries(d.scorecard).reduce((s,[k,v]) => s+(v.score_sugerido??0)*(WEIGHTS[k]||1),0)
      : null
    return { ticker, d, scoreTotal, analyzed: !!(d && !d.error) }
  })
  if (filterText) rows = rows.filter(r => r.ticker.includes(filterText.toUpperCase()))
  if (sortCol) rows = [...rows].sort((a,b) => {
    let va, vb
    if (sortCol === 'ticker') { va=a.ticker; vb=b.ticker }
    if (sortCol === 'score')  { va=a.scoreTotal??-1; vb=b.scoreTotal??-1 }
    if (sortCol === 'rsi')    { va=a.d?.rsi??-1; vb=b.d?.rsi??-1 }
    if (sortCol === 'rs')     { va=a.d?.mansfield_rs??-99; vb=b.d?.mansfield_rs??-99 }
    if (va<vb) return sortDir==='asc'?-1:1
    if (va>vb) return sortDir==='asc'?1:-1
    return 0
  })

  const thStyle = col => ({ padding:'8px 10px', textAlign:'left', fontSize:10,
    color: sortCol===col ? C.green : C.muted, letterSpacing:'0.07em',
    textTransform:'uppercase', fontWeight:600, whiteSpace:'nowrap',
    cursor: col ? 'pointer' : 'default', userSelect:'none' })

  return (
    <div>
      <div style={{ display:'flex', gap:8, padding:'10px 12px', borderBottom:`1px solid ${C.border}`, alignItems:'center' }}>
        <input value={filterText} onChange={e => setFilterText(e.target.value)}
          placeholder="Buscar ticker…"
          style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:7,
            padding:'5px 10px', color:C.text, fontSize:11, outline:'none', width:120 }} />
        <span style={{ marginLeft:'auto', fontSize:10, color:C.muted }}>{rows.length} / {tickers.length}</span>
      </div>
      <div style={{ overflowX:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
          <thead>
            <tr style={{ borderBottom:`1px solid ${C.border}` }}>
              <th style={{ padding:'8px 10px', cursor:'pointer' }} onClick={onToggleSelectAll}>
                <div style={{ width:16, height:16, borderRadius:3, border:`2px solid ${C.border}`,
                  background: tickers.length > 0 && tickers.every(t => selected.has(t)) ? M : 'transparent',
                  display:'flex', alignItems:'center', justifyContent:'center' }}>
                  {tickers.length > 0 && tickers.every(t => selected.has(t)) &&
                    <span style={{ color:'#000', fontSize:10, fontWeight:700 }}>✓</span>}
                </div>
              </th>
              <th style={thStyle('ticker')} onClick={() => handleSort('ticker')}>Ticker <SortIcon col="ticker"/></th>
              <th style={thStyle(null)}>Precio</th>
              <th style={thStyle('score')} onClick={() => handleSort('score')}>Score <SortIcon col="score"/></th>
              <th style={thStyle(null)}>Decisión</th>
              <th style={thStyle('rsi')} onClick={() => handleSort('rsi')}>RSI <SortIcon col="rsi"/></th>
              <th style={thStyle('rs')} onClick={() => handleSort('rs')}>RS SPY <SortIcon col="rs"/></th>
              <th style={thStyle(null)}>Sector</th>
              <th style={thStyle(null)}>Macro</th>
              <th style={thStyle(null)}>HH/HL</th>
              <th style={thStyle(null)}>Stage</th>
              <th style={thStyle(null)}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ ticker, d, scoreTotal, analyzed }) => {
              const decision = calcDecision(scoreTotal, d)
              const dc = DECISION_COLOR[decision] || C.muted
              const hasVeto = d?.scorecard?.precio_sma200?.score_sugerido === 0
              return (
                <tr key={ticker} onClick={() => onRowClick(ticker)}
                  style={{ borderBottom:`1px solid ${C.border}`, cursor:'pointer', transition:'background 0.15s',
                    background: selected.has(ticker) ? M+'11' : 'transparent' }}
                  onMouseEnter={e => { if (!selected.has(ticker)) e.currentTarget.style.background='#1a2d4533' }}
                  onMouseLeave={e => { e.currentTarget.style.background = selected.has(ticker) ? M+'11' : 'transparent' }}>
                  <td style={{ padding:'10px 10px' }} onClick={e => { e.stopPropagation(); onToggleSelect(ticker) }}>
                    <div style={{ width:16, height:16, borderRadius:3, cursor:'pointer',
                      background: selected.has(ticker) ? M : 'transparent',
                      border:`2px solid ${selected.has(ticker) ? M : C.border}`,
                      display:'flex', alignItems:'center', justifyContent:'center' }}>
                      {selected.has(ticker) && <span style={{ color:'#000', fontSize:10, fontWeight:700 }}>✓</span>}
                    </div>
                  </td>
                  <td style={{ padding:'10px' }}>
                    <span style={{ fontFamily:'monospace', fontWeight:700, color:C.text }}>{ticker}</span>
                    {swingExposedTickers.includes(ticker) && (
                      <span title="Ticker en watchlist de Swing Trading"
                        style={{ marginLeft:5, fontSize:9, fontWeight:700, color:'#00d4ff',
                          background:'#00d4ff18', border:'1px solid #00d4ff44',
                          borderRadius:99, padding:'1px 5px' }}>
                        ⚡ Swing
                      </span>
                    )}
                    {d?._savedAt && (() => {
                      const dt = new Date(d._savedAt), now = new Date()
                      const ageH = (now - dt) / (1000*60*60)
                      const dDate = `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`
                      const nDate = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`
                      const h = dt.getHours().toString().padStart(2,'0')
                      const m = dt.getMinutes().toString().padStart(2,'0')
                      const label = dDate===nDate ? `hoy ${h}:${m}` : 'ayer'
                      const staleColor = ageH > 48 ? C.red : ageH > 24 ? C.amber : null
                      return (
                        <div style={{ display:'flex', alignItems:'center', gap:4, marginTop:1 }}>
                          <span style={{ fontSize:9, color: staleColor || C.muted }}>{label}</span>
                          {staleColor && (
                            <span style={{ fontSize:8, fontWeight:700, padding:'0px 4px', borderRadius:99,
                              background: staleColor+'22', color: staleColor }}>
                              {ageH > 48 ? '+48h' : '+24h'}
                            </span>
                          )}
                        </div>
                      )
                    })()}
                  </td>
                  <td style={{ padding:'10px', fontFamily:'monospace', color:C.text }}>
                    {analyzed ? `$${d.price?.toFixed(2)}` : <span style={{ color:C.muted }}>—</span>}
                  </td>
                  <td style={{ padding:'10px', fontFamily:'monospace', fontWeight:700,
                    color: scoreTotal >= 32 ? C.green : scoreTotal >= 22 ? C.amber : scoreTotal != null ? C.red : C.muted }}>
                    {scoreTotal != null ? `${scoreTotal}/${MAX_SCORE}` : '—'}
                  </td>
                  <td style={{ padding:'10px' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:4, flexWrap:'wrap' }}>
                      {decision ? (
                        <span style={{ fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:99,
                          color:dc, background:dc+'18' }}>
                          {decision==='OPERAR_CONVICCION'?'CONVICCIÓN':decision==='OPERAR_CAUTELA'?'CAUTELA':'NO OPERAR'}
                        </span>
                      ) : <span style={{ color:C.muted }}>—</span>}
                      {hasVeto && <span style={{ fontSize:9, color:C.red }}>⛔</span>}
                      {d?.next_earnings && (() => {
                        try {
                          const days = Math.ceil((new Date(d.next_earnings) - new Date()) / (1000*60*60*24))
                          if (days >= 0 && days < 14) return (
                            <span title={`Earnings en ${days}d (${d.next_earnings})`}
                              style={{ fontSize:9, fontWeight:700, padding:'1px 5px', borderRadius:99,
                                background: days < 7 ? C.red+'22' : C.amber+'22',
                                color: days < 7 ? C.red : C.amber }}>
                              E{days}d
                            </span>
                          )
                        } catch {}
                        return null
                      })()}
                      {d?.fundamentals?.exDividendDate && (() => {
                        try {
                          const days = Math.ceil((new Date(d.fundamentals.exDividendDate) - new Date()) / (1000*60*60*24))
                          const dy = d.fundamentals.dividendYield || 0
                          if (days >= 0 && days <= 14 && dy > 0.3) return (
                            <span title={`Ex-div en ${days}d (${d.fundamentals.exDividendDate})`}
                              style={{ fontSize:9, fontWeight:700, padding:'1px 5px', borderRadius:99,
                                background: C.amber+'22', color: C.amber }}>
                              X{days}d
                            </span>
                          )
                        } catch {}
                        return null
                      })()}
                    </div>
                  </td>
                  <td style={{ padding:'10px', fontFamily:'monospace',
                    color: analyzed && d.rsi > 65 ? C.red : analyzed && d.rsi < 40 ? C.green : C.text }}>
                    {analyzed ? d.rsi?.toFixed(0) : '—'}
                  </td>
                  <td style={{ padding:'10px', fontFamily:'monospace',
                    color: analyzed && d.mansfield_rs > 0 ? C.green : analyzed && d.mansfield_rs < 0 ? C.red : C.muted }}>
                    {analyzed
                      ? d.mansfield_rs_raw != null
                        ? `${d.mansfield_rs_raw > 0 ? '+' : ''}${d.mansfield_rs_raw}%`
                        : d.mansfield_rs
                      : '—'}
                  </td>
                  <td style={{ padding:'10px', maxWidth:130 }}>
                    {analyzed && d.sector ? (
                      <div>
                        <div style={{ fontSize:10, color:C.accent, whiteSpace:'nowrap',
                          overflow:'hidden', textOverflow:'ellipsis' }}>
                          {d.sector}
                        </div>
                        {d.rs_sector != null && (
                          <div style={{ fontSize:9, fontFamily:'monospace', fontWeight:700,
                            color: d.rs_sector > 2 ? C.green : d.rs_sector > 0 ? '#7fd4a0' : d.rs_sector > -2 ? C.amber : C.red }}>
                            RS {d.rs_sector > 0 ? '+' : ''}{d.rs_sector}
                          </div>
                        )}
                      </div>
                    ) : <span style={{ color:C.muted }}>—</span>}
                  </td>
                  <td style={{ padding:'10px' }}>
                    {analyzed ? (
                      <span style={{ fontSize:10, fontWeight:600,
                        color: d.macro_context?.spy_above_sma200 ? C.green : C.red }}>
                        {d.macro_context?.spy_above_sma200 ? '▲' : '▼'} SPY
                      </span>
                    ) : '—'}
                  </td>
                  <td style={{ padding:'10px', fontFamily:'monospace', color:C.muted }}>
                    {analyzed && d.hh_hl ? `${d.hh_hl.hh_count}/${d.hh_hl.hl_count}` : '—'}
                  </td>
                  <td style={{ padding:'10px' }}>
                    {analyzed && d.stage?.stage != null ? (() => {
                      const stageColors = { 1: C.muted, 2: C.green, 3: C.amber, 4: C.red }
                      const color = stageColors[d.stage.stage] || C.muted
                      return <span style={{ fontFamily:'monospace', fontWeight:700, fontSize:11, color }}>S{d.stage.stage}</span>
                    })() : <span style={{ color:C.muted }}>—</span>}
                  </td>
                  <td style={{ padding:'10px 8px', whiteSpace:'nowrap' }} onClick={e => e.stopPropagation()}>
                    <button onClick={() => onRefresh(ticker)} disabled={!!refreshingTickers?.[ticker]}
                      title="Actualizar"
                      style={{ background:'none', border:`1px solid ${C.border}`, borderRadius:5,
                        color: refreshingTickers?.[ticker] ? C.green : C.muted,
                        cursor: refreshingTickers?.[ticker] ? 'not-allowed' : 'pointer',
                        padding:'3px 7px', fontSize:11, marginRight:4,
                        animation: refreshingTickers?.[ticker] ? 'spin 0.7s linear infinite' : 'none' }}>↻</button>
                    <button onClick={() => onRemove(ticker)}
                      style={{ background:'none', border:`1px solid ${C.red}44`, borderRadius:5,
                        color:C.red, cursor:'pointer', padding:'3px 7px', fontSize:11, opacity:0.7 }}>×</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Macro Panel global ───────────────────────────────────────────────────────
function MacroPanel() {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/sector-rotation')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setData(d) })
      .finally(() => setLoading(false))
  }, [])

  if (loading) return null
  if (!data)   return null

  const spy    = data.spy
  const vix    = data.vix
  const spyOk  = spy?.above_sma200
  const vixColor = vix?.regime === 'bajo' ? C.green : vix?.regime === 'normal' ? '#7fd4a0'
    : vix?.regime === 'elevado' ? C.amber : C.red
  const vixLabel = vix?.regime === 'bajo' ? 'Bajo' : vix?.regime === 'normal' ? 'Normal'
    : vix?.regime === 'elevado' ? 'Elevado' : 'Extremo'

  return (
    <div style={{ background: spyOk ? '#00e09608' : '#ff406008',
      border:`1px solid ${spyOk ? C.green+'33' : C.red+'33'}`,
      borderRadius:8, padding:'8px 14px', marginBottom:12,
      display:'flex', alignItems:'center', gap:16, flexWrap:'wrap', fontSize:11 }}>
      {/* SPY */}
      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
        <span style={{ color:C.muted }}>Mercado:</span>
        <span style={{ fontWeight:700, color: spyOk ? C.green : C.red }}>
          {spyOk ? '▲' : '▼'} SPY ${spy?.price}
        </span>
        <span style={{ color:C.muted, fontSize:10 }}>/ SMA200 ${spy?.sma200}</span>
        {spy?.momentum_4w != null && (
          <span style={{ fontSize:10, color: spy.momentum_4w > 0 ? C.green : C.red }}>
            {spy.momentum_4w > 0 ? '+' : ''}{spy.momentum_4w}% 4sem
          </span>
        )}
      </div>
      {/* Separador */}
      <span style={{ color:C.border }}>|</span>
      {/* VIX */}
      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
        <span style={{ color:C.muted }}>VIX:</span>
        <span style={{ fontWeight:700, color: vixColor }}>{vix?.price ?? '—'}</span>
        <span style={{ fontSize:10, padding:'1px 6px', borderRadius:99,
          background: vixColor+'22', color: vixColor, fontWeight:600 }}>
          {vixLabel}
        </span>
      </div>
      {/* Advertencia si condición desfavorable */}
      {(!spyOk || vix?.regime === 'extremo') && (
        <>
          <span style={{ color:C.border }}>|</span>
          <span style={{ fontSize:10, fontWeight:700, color: C.red }}>
            ⚠ {!spyOk ? 'Mercado bajista' : ''}{!spyOk && vix?.regime === 'extremo' ? ' · ' : ''}{vix?.regime === 'extremo' ? 'VIX extremo' : ''}
            {' '}— ser muy selectivo
          </span>
        </>
      )}
    </div>
  )
}

// ── Sector Rotation Tracker ──────────────────────────────────────────────────
function SectorRotation() {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/sector-rotation')
      if (!res.ok) throw new Error(`Error ${res.status}`)
      setData(await res.json())
    } catch(e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const rsColor = rs => rs == null ? C.muted : rs > 2 ? C.green : rs > 0 ? '#7fd4a0' : rs > -2 ? C.amber : C.red
  const momColor = m => m == null ? C.muted : m > 3 ? C.green : m > 0 ? '#7fd4a0' : m > -3 ? C.amber : C.red

  return (
    <div style={{ maxWidth:960, margin:'0 auto', padding:'0 20px' }}>
      {/* SPY header */}
      {data?.spy && (
        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:10,
          padding:'12px 16px', marginBottom:14, display:'flex', alignItems:'center',
          justifyContent:'space-between', flexWrap:'wrap', gap:8 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ fontFamily:'monospace', fontWeight:700, fontSize:15, color:C.text }}>SPY</span>
            <span style={{ fontSize:13, fontFamily:'monospace', color:C.text }}>${data.spy.price}</span>
            <span style={{ fontSize:10, padding:'2px 7px', borderRadius:99, fontWeight:600,
              background: data.spy.above_sma200 ? '#00e09618' : '#ff406018',
              color: data.spy.above_sma200 ? C.green : C.red }}>
              {data.spy.above_sma200 ? '▲ Sobre SMA200' : '▼ Bajo SMA200'}
            </span>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:14 }}>
            <span style={{ fontSize:11, color:C.muted }}>
              Momentum 4sem: <span style={{ fontFamily:'monospace', fontWeight:600,
                color: momColor(data.spy.momentum_4w) }}>
                {data.spy.momentum_4w != null ? `${data.spy.momentum_4w > 0 ? '+' : ''}${data.spy.momentum_4w}%` : '—'}
              </span>
            </span>
            <span style={{ fontSize:10, color:C.muted }}>SMA200 ${data.spy.sma200}</span>
            <button onClick={load} disabled={loading}
              style={{ background:'none', border:`1px solid ${C.border}`, borderRadius:6,
                color:C.muted, padding:'3px 9px', cursor:'pointer', fontSize:11,
                animation: loading ? 'spin 0.7s linear infinite' : 'none' }}>↻</button>
          </div>
        </div>
      )}

      {/* Estado carga */}
      {loading && !data && (
        <div style={{ textAlign:'center', padding:'60px', color:C.muted, fontSize:13 }}>
          Cargando datos de sectores… (~10 segundos)
        </div>
      )}
      {error && (
        <div style={{ padding:'16px', background:'#ff406015', border:`1px solid ${C.red}44`,
          borderRadius:9, color:C.red, fontSize:12 }}>
          Error: {error}
        </div>
      )}

      {/* Tabla de sectores */}
      {data?.sectors && (
        <>
          {/* Leyenda RS */}
          <div style={{ display:'flex', gap:12, marginBottom:10, flexWrap:'wrap' }}>
            {[
              ['RS > 2', C.green,  'Líder fuerte'],
              ['RS 0–2', '#7fd4a0','Leve liderazgo'],
              ['RS -2–0',C.amber,  'Rezagado leve'],
              ['RS < -2',C.red,    'Rezagado fuerte'],
            ].map(([label, color, desc]) => (
              <span key={label} style={{ fontSize:10, color, display:'flex', alignItems:'center', gap:4 }}>
                <span style={{ width:8, height:8, borderRadius:'50%', background:color, display:'inline-block' }}/>
                {label} — {desc}
              </span>
            ))}
          </div>

          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, overflow:'hidden' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr style={{ borderBottom:`1px solid ${C.border}`, background:'#0c1828' }}>
                  <th style={{ padding:'10px 14px', textAlign:'left', color:C.muted, fontWeight:600, fontSize:11 }}>Sector</th>
                  <th style={{ padding:'10px 10px', textAlign:'center', color:C.muted, fontWeight:600, fontSize:11 }}>ETF</th>
                  <th style={{ padding:'10px 10px', textAlign:'right', color:C.muted, fontWeight:600, fontSize:11 }}>Precio</th>
                  <th style={{ padding:'10px 10px', textAlign:'right', color:C.muted, fontWeight:600, fontSize:11 }}>RS SPY</th>
                  <th style={{ padding:'10px 10px', textAlign:'right', color:C.muted, fontWeight:600, fontSize:11 }}>Mom 4sem</th>
                  <th style={{ padding:'10px 10px', textAlign:'center', color:C.muted, fontWeight:600, fontSize:11 }}>SMA50</th>
                  <th style={{ padding:'10px 10px', textAlign:'center', color:C.muted, fontWeight:600, fontSize:11 }}>SMA200</th>
                </tr>
              </thead>
              <tbody>
                {data.sectors.map((s, i) => (
                  <tr key={s.etf} style={{ borderBottom:`1px solid ${C.border}`,
                    background: i % 2 === 0 ? 'transparent' : '#0c182808' }}>
                    <td style={{ padding:'10px 14px' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                        <span style={{ width:8, height:8, borderRadius:'50%', flexShrink:0,
                          background: rsColor(s.rs_mansfield) }} />
                        <span style={{ color:C.text, fontWeight: i < 3 ? 700 : 400 }}>{s.sector}</span>
                        {i < 3 && <span style={{ fontSize:9, color:C.green, background:'#00e09618',
                          padding:'1px 5px', borderRadius:99, fontWeight:600 }}>TOP</span>}
                        {i >= data.sectors.length - 2 && <span style={{ fontSize:9, color:C.red,
                          background:'#ff406018', padding:'1px 5px', borderRadius:99, fontWeight:600 }}>WEAK</span>}
                      </div>
                    </td>
                    <td style={{ padding:'10px', textAlign:'center', fontFamily:'monospace',
                      color:C.muted, fontSize:11 }}>{s.etf}</td>
                    <td style={{ padding:'10px', textAlign:'right', fontFamily:'monospace', color:C.text }}>
                      {s.price != null ? `$${s.price}` : '—'}
                    </td>
                    <td style={{ padding:'10px', textAlign:'right', fontFamily:'monospace',
                      fontWeight:700, color: rsColor(s.rs_mansfield) }}>
                      {s.rs_mansfield != null ? (s.rs_mansfield > 0 ? `+${s.rs_mansfield}` : s.rs_mansfield) : '—'}
                    </td>
                    <td style={{ padding:'10px', textAlign:'right', fontFamily:'monospace',
                      color: momColor(s.momentum_4w) }}>
                      {s.momentum_4w != null ? `${s.momentum_4w > 0 ? '+' : ''}${s.momentum_4w}%` : '—'}
                    </td>
                    <td style={{ padding:'10px', textAlign:'center' }}>
                      {s.above_sma50 != null ? (
                        <span style={{ fontSize:10, fontWeight:600,
                          color: s.above_sma50 ? C.green : C.red }}>
                          {s.above_sma50 ? '▲' : '▼'}
                        </span>
                      ) : '—'}
                    </td>
                    <td style={{ padding:'10px', textAlign:'center' }}>
                      {s.above_sma200 != null ? (
                        <span style={{ fontSize:10, fontWeight:600,
                          color: s.above_sma200 ? C.green : C.red }}>
                          {s.above_sma200 ? '▲' : '▼'}
                        </span>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.updated_at && (
            <div style={{ fontSize:10, color:C.muted, marginTop:8, textAlign:'right' }}>
              Actualizado: {new Date(data.updated_at).toLocaleTimeString()} · Caché 1h
            </div>
          )}
        </>
      )}
    </div>
  )
}


// ── Position Module (contenedor principal) ──────────────────────────────────
export default function PositionModule({ session, onBack, swingExposedTickers = [] }) {
  const [tab,          setTab]          = useState('dashboard')
  const [viewMode,     setViewMode]     = useState('cards')   // 'cards' | 'table'
  const [search,       setSearch]       = useState('')
  const [tableModal,   setTableModal]   = useState(null)
  const [refreshingTickers, setRefreshingTickers] = useState({})
  const [journalCount, setJournalCount] = useState(0)

  useEffect(() => {
    if (!session) return
    supabase.from('position_trades')
      .select('id', { count:'exact', head:true })
      .eq('user_id', session.user.id)
      .then(({ count }) => setJournalCount(count || 0))
  }, [session])

  // ── Selección y cola de actualización (batch en servidor) ────────────────
  const [selected,     setSelected]     = useState(new Set())
  const [queue,        setQueue]        = useState([])
  const [queueTotal,   setQueueTotal]   = useState(0)
  const [queueDone,    setQueueDone]    = useState(0)
  const batchJobId   = useRef(null)
  const batchPollRef = useRef(null)

  const toggleSelect = (ticker) => setSelected(s => {
    const next = new Set(s)
    next.has(ticker) ? next.delete(ticker) : next.add(ticker)
    return next
  })
  const toggleSelectAll = (tickers) => setSelected(s => {
    if (tickers.every(t => s.has(t))) return new Set()
    return new Set(tickers)
  })

  const stopBatchPoll = () => {
    if (batchPollRef.current) {
      clearInterval(batchPollRef.current)
      if (batchPollRef._removeListener) { batchPollRef._removeListener(); batchPollRef._removeListener = null }
      batchPollRef.current = null
    }
  }

  const pollBatchStatus = (jobId, tickersList) => {
    stopBatchPoll()

    const doPoll = async () => {
      try {
        const res = await fetch(`/api/batch-status/${jobId}`)
        if (!res.ok) {
          if (res.status === 404) { stopBatchPoll(); setQueue([]); setRefreshingTickers({}); batchJobId.current = null }
          return
        }
        const job = await res.json()
        setQueueDone(job.done)
        setQueue(tickersList.slice(job.done))
        const currentTicker = job.status !== 'done' ? tickersList[job.done] : null
        setRefreshingTickers(currentTicker ? { [currentTicker]: true } : {})
        Object.entries(job.results || {}).forEach(([ticker, data]) => {
          if (!data.error) cacheAnalysis(ticker, data)
        })
        if (job.status === 'done') {
          stopBatchPoll()
          setQueue([])
          batchJobId.current = null
          setRefreshingTickers({})
        }
      } catch {}
    }

    const onVisible = () => { if (document.visibilityState === 'visible') doPoll() }
    document.addEventListener('visibilitychange', onVisible)
    batchPollRef.current = setInterval(doPoll, 4000)
    batchPollRef._removeListener = () => document.removeEventListener('visibilitychange', onVisible)
  }

  const runQueue = async (tickers) => {
    if (!tickers.length) return
    setQueue([...tickers])
    setQueueTotal(tickers.length)
    setQueueDone(0)
    try {
      const res = await fetch('/api/batch-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers, module: 'position' }),
      })
      if (!res.ok) return
      const { job_id } = await res.json()
      batchJobId.current = job_id
      pollBatchStatus(job_id, tickers)
    } catch {
      setQueue([])
    }
  }

  const cancelQueue = async () => {
    if (batchJobId.current) {
      await fetch(`/api/batch-cancel/${batchJobId.current}`, { method: 'POST' }).catch(() => {})
      batchJobId.current = null
    }
    stopBatchPoll()
    setQueue([])
    setRefreshingTickers({})
  }

  // Watchlist
  const [watchlist,  setWatchlist]  = useState(null)   // null = no cargado aún
  const watchlistRef = useRef([])

  // Cache de análisis position
  const [posCache,   setPosCache]   = useState({})
  const posCacheRef   = useRef({})
  const dbLoaded      = useRef(false)
  const [posHistory,  setPosHistory]  = useState({})  // { TICKER: [{date,score,decision},...] }
  const posHistoryRef = useRef({})

  // ── Carga inicial desde Supabase ──────────────────────────────────────────
  useEffect(() => {
    if (!session) return
    dbLoaded.current = false
    supabase.from('watchlist')
      .select('position_watchlist, position_cache, position_score_history')
      .eq('user_id', session.user.id)
      .single()
      .then(({ data }) => {
        const wl   = data?.position_watchlist?.length ? data.position_watchlist : []
        const cache = data?.position_cache || {}
        const hist  = data?.position_score_history || {}

        watchlistRef.current  = wl
        posCacheRef.current   = cache
        posHistoryRef.current = hist
        setWatchlist(wl)
        if (Object.keys(cache).length > 0) setPosCache(cache)
        if (Object.keys(hist).length  > 0) setPosHistory(hist)
        dbLoaded.current = true
      })
  }, [session])

  const upsertAll = async (wl, cache, hist) => {
    const payload = {
      user_id:                  session.user.id,
      position_watchlist:       wl    ?? watchlistRef.current,
      position_cache:           cache ?? posCacheRef.current,
      position_score_history:   hist  ?? posHistoryRef.current,
      updated_at:               new Date().toISOString(),
    }
    const { error } = await supabase.from('watchlist').upsert(payload, { onConflict:'user_id' })
    if (error) console.error('[position upsertAll error]', error)
  }

  const cacheAnalysis = (ticker, data) => {
    const entry = { ...data, _savedAt: new Date().toISOString() }
    const next  = { ...posCacheRef.current, [ticker]: entry }
    posCacheRef.current = next
    setPosCache(next)

    // Guardar snapshot en historial (máx 12 por ticker)
    const scoreTotal = data.scorecard
      ? Object.entries(data.scorecard).reduce((s,[k,v]) =>
          k === '_confidence' ? s : s + (v.score_sugerido ?? 0) * (WEIGHTS[k] || 1), 0)
      : null
    if (scoreTotal != null) {
      const dec = calcDecision(scoreTotal, data)
      const decision = dec === 'OPERAR_CONVICCION' ? 'CONVICCIÓN' : dec === 'OPERAR_CAUTELA' ? 'CAUTELA' : 'NO OPERAR'
      const snapshot = { date: new Date().toISOString().slice(0,10), score: scoreTotal, decision }
      const prev = posHistoryRef.current[ticker] || []
      // Evitar duplicado del mismo día
      const filtered = prev.filter(s => s.date !== snapshot.date)
      const updated  = [...filtered, snapshot].slice(-12)
      const nextHist = { ...posHistoryRef.current, [ticker]: updated }
      posHistoryRef.current = nextHist
      setPosHistory(nextHist)
      if (dbLoaded.current) upsertAll(null, next, nextHist)
    } else {
      if (dbLoaded.current) upsertAll(null, next)
    }
  }

  const add = () => {
    const t = search.trim().toUpperCase().replace(/[^A-Z.]/g,'')
    if (t && !watchlistRef.current.includes(t)) {
      const next = [t, ...watchlistRef.current]
      watchlistRef.current = next
      setWatchlist(next)
      setSearch('')
      upsertAll(next, null)
    }
  }

  const remove = (ticker) => {
    const next = watchlistRef.current.filter(t => t !== ticker)
    watchlistRef.current = next
    setWatchlist(next)
    const nextCache = { ...posCacheRef.current }
    delete nextCache[ticker]
    posCacheRef.current = nextCache
    setPosCache(nextCache)
    upsertAll(next, nextCache)
  }

  const addToWatchlist = (ticker) => {
    if (watchlistRef.current.includes(ticker)) return
    const next = [ticker, ...watchlistRef.current]
    watchlistRef.current = next
    setWatchlist(next)
    upsertAll(next, null)
  }
  const addAllToWatchlist = (tickers) => {
    const toAdd = tickers.filter(t => !watchlistRef.current.includes(t))
    if (!toAdd.length) return
    const next = [...toAdd, ...watchlistRef.current]
    watchlistRef.current = next
    setWatchlist(next)
    upsertAll(next, null)
  }

  const refreshFromTable = async (ticker) => {
    setRefreshingTickers(prev => ({ ...prev, [ticker]:true }))
    try {
      const res = await fetch(`/api/analyze-position/${ticker}`)
      if (res.ok) cacheAnalysis(ticker, await res.json())
    } catch {}
    setRefreshingTickers(prev => { const n={...prev}; delete n[ticker]; return n })
  }

  const [wlFilters, setWlFilters] = useState({ decision:'all', rsiMin:'', rsiMax:'', stage:'all', hhhl:'all', sector:'all' })
  const toggleWlFilter = (key, val) => setWlFilters(f => ({ ...f, [key]: f[key]===val ? 'all' : val }))
  const resetWlFilters = () => setWlFilters({ decision:'all', rsiMin:'', rsiMax:'', stage:'all', hhhl:'all', sector:'all' })
  const hasWlFilters = wlFilters.decision!=='all' || wlFilters.rsiMin!=='' || wlFilters.rsiMax!=='' || wlFilters.stage!=='all' || wlFilters.hhhl!=='all' || wlFilters.sector!=='all'

  const wl = watchlist || []
  const isLoaded = watchlist !== null

  const calcScore = (cache) => {
    if (!cache?.scorecard) return null
    return Object.entries(cache.scorecard).reduce((s,[k,v]) =>
      k==='_confidence' ? s : s+(v.score_sugerido??0)*(WEIGHTS[k]||1), 0)
  }

  // Sectores disponibles en la watchlist actual (para el dropdown)
  const availableSectors = [...new Set(wl.map(t => posCache[t]?.sector).filter(Boolean))].sort()

  const filteredWl = wl.filter(t => {
    const d = posCache[t]
    if (!d) return wlFilters.decision==='all' && wlFilters.rsiMin==='' && wlFilters.rsiMax==='' && wlFilters.stage==='all' && wlFilters.hhhl==='all' && wlFilters.sector==='all'
    const score = calcScore(d)
    const dec = calcDecision(score, d)
    if (wlFilters.decision !== 'all' && dec !== wlFilters.decision) return false
    if (wlFilters.rsiMin !== '' || wlFilters.rsiMax !== '') {
      const rsi = d.rsi
      if (rsi == null) return false
      if (wlFilters.rsiMin !== '' && rsi < parseFloat(wlFilters.rsiMin)) return false
      if (wlFilters.rsiMax !== '' && rsi > parseFloat(wlFilters.rsiMax)) return false
    }
    if (wlFilters.stage !== 'all') {
      const st = d.stage?.stage
      if (wlFilters.stage === '1' && st !== 1) return false
      if (wlFilters.stage === '2' && st !== 2) return false
      if (wlFilters.stage === '3' && st !== 3) return false
      if (wlFilters.stage === '4' && st !== 4) return false
    }
    if (wlFilters.hhhl !== 'all') {
      const score_hh = d.hh_hl?.score
      if (wlFilters.hhhl === 'strong' && !(score_hh >= 2)) return false
      if (wlFilters.hhhl === 'weak'   && !(score_hh < 2)) return false
    }
    if (wlFilters.sector !== 'all' && d.sector !== wlFilters.sector) return false
    return true
  })

  const tabs = [
    ['dashboard', 'Dashboard'],
    ['watchlist', `Watchlist · ${wl.length}`],
    ['mercado',   'Mercado'],
    ['screener',  'Screener'],
    ['journal',   journalCount > 0 ? `Journal · ${journalCount}` : 'Journal'],
  ]

  return (
    <div style={{ paddingBottom:48 }}>
      {/* Header */}
      <div style={{ background:'linear-gradient(180deg,#0c1828 0%,#070d1a 100%)',
        padding:'22px 20px 0', borderBottom:`1px solid ${C.border}` }}>
        <div style={{ maxWidth:960, margin:'0 auto' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:5 }}>
            <div style={{ display:'flex', alignItems:'center', gap:7 }}>
              <div style={{ width:7, height:7, borderRadius:'50%', background:C.green }}/>
              <span style={{ fontSize:10, color:C.green, letterSpacing:'0.12em' }}>LIVE · DATOS REALES DE MERCADO</span>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <span style={{ fontSize:11, color:C.muted }}>{session.user.email}</span>
              <button onClick={() => supabase.auth.signOut()}
                style={{ background:'none', border:`1px solid ${C.border}`, borderRadius:6,
                  color:C.muted, padding:'3px 9px', cursor:'pointer', fontSize:10 }}>
                Salir
              </button>
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'baseline', gap:10, marginBottom: 10 }}>
            <button onClick={onBack}
              style={{ background:'none', border:`1px solid ${C.border}`, borderRadius:6, color:C.muted,
                padding:'3px 9px', cursor:'pointer', fontSize:10, marginRight:4 }}>
              ← Módulos
            </button>
            <div>
              <span style={{ fontSize:11, color:C.muted, letterSpacing:'0.04em', textTransform:'uppercase' }}>KNNS TradeAgent</span>
              <h1 style={{ fontSize:22, fontWeight:700, letterSpacing:'-0.02em', color:M, margin:0 }}>Position Trading</h1>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display:'flex', borderTop:`1px solid ${C.border}` }}>
            {tabs.map(([key, label]) => (
              <button key={key} onClick={() => setTab(key)}
                style={{ background:'none', border:'none',
                  borderBottom: tab===key ? `2px solid ${M}` : '2px solid transparent',
                  color: tab===key ? M : C.muted,
                  padding:'10px 18px', cursor:'pointer', fontSize:12,
                  fontWeight: tab===key ? 700 : 400 }}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ marginTop:20 }}>

        {/* Watchlist */}
        <div style={{ display: tab==='watchlist' ? 'block' : 'none' }}>
          <div style={{ maxWidth:960, margin:'0 auto', padding:'0 20px' }}>
            <MacroPanel />
            {/* Filtros watchlist */}
            {isLoaded && wl.length > 0 && (
              <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:10, alignItems:'center' }}>
                {/* Decisión */}
                <select value={wlFilters.decision}
                  onChange={e => setWlFilters(f => ({ ...f, decision: e.target.value }))}
                  style={{ background:'#0f1929', border:`1px solid ${wlFilters.decision!=='all' ? C.accent : C.border}`,
                    borderRadius:6, color: wlFilters.decision!=='all' ? C.accent : C.text,
                    fontSize:10, padding:'3px 8px', cursor:'pointer', outline:'none' }}>
                  <option value="all">Decisión: todas</option>
                  <option value="OPERAR_CONVICCION">Convicción (≥32)</option>
                  <option value="OPERAR_CAUTELA">Cautela (22–31)</option>
                  <option value="NO_OPERAR">No operar (&lt;22)</option>
                </select>
                <div style={{ width:1, height:16, background:C.border }} />
                {/* RSI range */}
                <span style={{ fontSize:10, color:C.muted }}>RSI</span>
                <input type="text" inputMode="numeric" placeholder="min" value={wlFilters.rsiMin}
                  onChange={e => setWlFilters(f => ({ ...f, rsiMin: e.target.value.replace(/[^0-9.]/g,'') }))}
                  style={{ width:44, background:'#0f1929', border:`1px solid ${wlFilters.rsiMin!=='' ? C.accent : C.border}`,
                    borderRadius:6, color:C.text, fontSize:10, padding:'3px 6px', outline:'none', textAlign:'center' }}
                  onFocus={e => e.target.style.borderColor=C.accent}
                  onBlur={e  => e.target.style.borderColor=wlFilters.rsiMin!=='' ? C.accent : C.border}
                />
                <span style={{ fontSize:10, color:C.muted }}>–</span>
                <input type="text" inputMode="numeric" placeholder="max" value={wlFilters.rsiMax}
                  onChange={e => setWlFilters(f => ({ ...f, rsiMax: e.target.value.replace(/[^0-9.]/g,'') }))}
                  style={{ width:44, background:'#0f1929', border:`1px solid ${wlFilters.rsiMax!=='' ? C.accent : C.border}`,
                    borderRadius:6, color:C.text, fontSize:10, padding:'3px 6px', outline:'none', textAlign:'center' }}
                  onFocus={e => e.target.style.borderColor=C.accent}
                  onBlur={e  => e.target.style.borderColor=wlFilters.rsiMax!=='' ? C.accent : C.border}
                />
                <div style={{ width:1, height:16, background:C.border }} />
                {/* Stage */}
                <select value={wlFilters.stage}
                  onChange={e => setWlFilters(f => ({ ...f, stage: e.target.value }))}
                  style={{ background:'#0f1929', border:`1px solid ${wlFilters.stage!=='all' ? C.accent : C.border}`,
                    borderRadius:6, color: wlFilters.stage!=='all' ? C.accent : C.text,
                    fontSize:10, padding:'3px 8px', cursor:'pointer', outline:'none' }}>
                  <option value="all">Stage: todos</option>
                  <option value="1">Stage 1 — Base</option>
                  <option value="2">Stage 2 — Alcista</option>
                  <option value="3">Stage 3 — Techo</option>
                  <option value="4">Stage 4 — Bajista</option>
                </select>
                <div style={{ width:1, height:16, background:C.border }} />
                {/* HH/HL */}
                <select value={wlFilters.hhhl}
                  onChange={e => setWlFilters(f => ({ ...f, hhhl: e.target.value }))}
                  style={{ background:'#0f1929', border:`1px solid ${wlFilters.hhhl!=='all' ? C.accent : C.border}`,
                    borderRadius:6, color: wlFilters.hhhl!=='all' ? C.accent : C.text,
                    fontSize:10, padding:'3px 8px', cursor:'pointer', outline:'none' }}>
                  <option value="all">Estructura: todas</option>
                  <option value="strong">Alcista confirmada (≥2 HH/HL)</option>
                  <option value="weak">Sin estructura clara</option>
                </select>
                <select value={wlFilters.sector}
                  onChange={e => setWlFilters(f => ({ ...f, sector: e.target.value }))}
                  style={{ background:'#0f1929', border:`1px solid ${wlFilters.sector!=='all' ? C.accent : C.border}`,
                    borderRadius:6, color: wlFilters.sector!=='all' ? C.accent : C.text,
                    fontSize:10, padding:'3px 8px', cursor:'pointer', outline:'none' }}>
                  <option value="all">Sector: todos</option>
                  {availableSectors.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                {hasWlFilters && (
                  <button onClick={resetWlFilters}
                    style={{ background:'none', border:`1px solid ${C.border}`, borderRadius:6,
                      color:C.muted, padding:'3px 8px', cursor:'pointer', fontSize:10 }}>
                    × limpiar
                  </button>
                )}
              </div>
            )}
            {/* Barra de progreso de cola */}
            {queue.length > 0 && (
              <div style={{ background:C.card, border:`1px solid ${M}44`, borderRadius:9,
                padding:'10px 14px', marginBottom:10, display:'flex', alignItems:'center', gap:12 }}>
                <div style={{ flex:1 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:5 }}>
                    <span style={{ fontSize:11, color:M, fontWeight:700 }}>
                      Actualizando {queueDone} / {queueTotal}...
                    </span>
                    <span style={{ fontSize:10, color:C.muted }}>
                      ~{Math.ceil(queue.length * 3)}s restantes
                    </span>
                  </div>
                  <div style={{ background:C.border, borderRadius:99, height:4 }}>
                    <div style={{ background:M, borderRadius:99, height:4,
                      width:`${(queueDone/queueTotal)*100}%`, transition:'width 0.3s' }} />
                  </div>
                  {queue.length > 0 && (
                    <div style={{ fontSize:9, color:C.muted, marginTop:4 }}>
                      Siguiente: {queue[0]}
                    </div>
                  )}
                </div>
                <button onClick={cancelQueue}
                  style={{ background:'none', border:`1px solid ${C.red}44`, borderRadius:6,
                    color:C.red, cursor:'pointer', fontSize:10, padding:'4px 10px', flexShrink:0 }}>
                  ✕ Cancelar
                </button>
              </div>
            )}
            {/* Indicador de tickers con caché viejo */}
            {queue.length === 0 && (() => {
              const stale = wl.filter(t => {
                const s = posCache[t]?._savedAt
                if (!s) return true
                return (Date.now() - new Date(s)) > 24 * 60 * 60 * 1000
              })
              if (stale.length === 0) return null
              return (
                <div style={{ marginBottom:10, display:'flex', alignItems:'center', gap:8,
                  padding:'7px 12px', background:'#ffb80008', border:'1px solid #ffb80033',
                  borderRadius:8, fontSize:11 }}>
                  <span style={{ color:C.amber }}>⚠ {stale.length} ticker{stale.length > 1 ? 's' : ''} con datos de más de 24h</span>
                  <button onClick={() => runQueue(stale)}
                    style={{ background:C.amber+'22', border:`1px solid ${C.amber}`, borderRadius:6,
                      color:C.amber, fontWeight:700, padding:'3px 10px', cursor:'pointer', fontSize:10, marginLeft:'auto' }}>
                    ↻ Actualizar {stale.length > 1 ? 'estos' : 'este'}
                  </button>
                </div>
              )
            })()}

            <div style={{ display:'flex', gap:7, marginBottom:14, flexWrap:'wrap' }}>
              <input value={search} onChange={e => setSearch(e.target.value.toUpperCase())}
                onKeyDown={e => e.key==='Enter' && add()}
                placeholder="Agregar ticker… ej: NVDA, MSFT, AAPL"
                style={{ flex:1, minWidth:180, background:'#0f1929', border:`1px solid ${C.border}`, borderRadius:9,
                  padding:'10px 14px', color:C.text, fontSize:13, outline:'none' }}
                onFocus={e => e.target.style.borderColor=M}
                onBlur={e  => e.target.style.borderColor=C.border}
              />
              <button onClick={add}
                style={{ background:M, border:'none', borderRadius:9, color:'#000',
                  fontWeight:700, padding:'10px 16px', cursor:'pointer', fontSize:13 }}>
                + Agregar
              </button>
              {selected.size > 0 && queue.length === 0 && (
                <button onClick={() => runQueue([...selected])}
                  style={{ background:M+'22', border:`1px solid ${M}`, borderRadius:9,
                    color:M, fontWeight:700, padding:'10px 14px', cursor:'pointer', fontSize:12 }}>
                  ↻ Actualizar selección ({selected.size})
                </button>
              )}
              {selected.size > 0 && (
                <button onClick={() => { [...selected].forEach(t => remove(t)); setSelected(new Set()) }}
                  style={{ background:C.red+'22', border:`1px solid ${C.red}66`, borderRadius:9,
                    color:C.red, fontWeight:700, padding:'10px 14px', cursor:'pointer', fontSize:12 }}>
                  ✕ Eliminar selección ({selected.size})
                </button>
              )}
              {queue.length === 0 && (
                <button onClick={() => runQueue([...wl])}
                  title="Actualizar todos los tickers (3s entre cada uno)"
                  style={{ background:'none', border:`1px solid ${C.border}`, borderRadius:9,
                    color:C.muted, padding:'10px 14px', cursor:'pointer', fontSize:12 }}>
                  ↻ Actualizar todo
                </button>
              )}
              <button onClick={() => setViewMode(v => v==='cards'?'table':'cards')}
                title={viewMode==='cards'?'Ver tabla':'Ver tarjetas'}
                style={{ background: viewMode==='table' ? M+'22' : 'none',
                  border:`1px solid ${viewMode==='table' ? M : C.border}`,
                  borderRadius:9, color: viewMode==='table' ? M : C.muted,
                  padding:'10px 13px', cursor:'pointer', fontSize:13 }}>
                {viewMode==='cards' ? '☰' : '⊞'}
              </button>
            </div>
            {!isLoaded ? (
              <div style={{ textAlign:'center', padding:'60px', color:C.muted, fontSize:13 }}>Cargando watchlist...</div>
            ) : wl.length === 0 ? (
              <div style={{ textAlign:'center', padding:'60px', color:C.muted }}>
                <div style={{ fontSize:28, marginBottom:12 }}>📋</div>
                <div style={{ fontSize:14, marginBottom:6 }}>Tu watchlist de position trading está vacía</div>
                <div style={{ fontSize:11 }}>Agrega tickers con el buscador o desde el Screener.</div>
              </div>
            ) : viewMode === 'table' ? (
              <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12 }}>
                <PositionWatchlistTable
                  tickers={filteredWl} cache={posCache}
                  onRemove={remove} onRefresh={refreshFromTable}
                  refreshingTickers={refreshingTickers}
                  onRowClick={setTableModal}
                  swingExposedTickers={swingExposedTickers}
                  selected={selected}
                  onToggleSelect={toggleSelect}
                  onToggleSelectAll={() => toggleSelectAll(filteredWl)}
                />
              </div>
            ) : (
              <>
                {/* Header selección */}
                <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
                  <label style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', fontSize:11, color:C.muted }}>
                    <input type="checkbox"
                      checked={filteredWl.length > 0 && filteredWl.every(t => selected.has(t))}
                      onChange={() => toggleSelectAll(filteredWl)}
                      style={{ cursor:'pointer', accentColor:M }}
                    />
                    {selected.size > 0 ? `${selected.size} seleccionados` : 'Seleccionar todo'}
                  </label>
                  {selected.size > 0 && (
                    <button onClick={() => setSelected(new Set())}
                      style={{ background:'none', border:'none', color:C.muted, cursor:'pointer', fontSize:10 }}>
                      ✕ Limpiar selección
                    </button>
                  )}
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(260px, 1fr))', gap:11 }}>
                  {filteredWl.length === 0 && (
                    <div style={{ gridColumn:'1/-1', textAlign:'center', padding:'40px', color:C.muted, fontSize:12 }}>
                      Sin resultados para este filtro
                    </div>
                  )}
                  {filteredWl.map(t => (
                    <div key={t} style={{ position:'relative' }}>
                      {/* Checkbox sobre la tarjeta */}
                      <div onClick={e => { e.stopPropagation(); toggleSelect(t) }}
                        style={{ position:'absolute', top:10, right:10, zIndex:10, cursor:'pointer' }}>
                        <div style={{ width:18, height:18, borderRadius:4,
                          background: selected.has(t) ? M : C.card,
                          border:`2px solid ${selected.has(t) ? M : C.border}`,
                          display:'flex', alignItems:'center', justifyContent:'center' }}>
                          {selected.has(t) && <span style={{ color:'#000', fontSize:11, fontWeight:700 }}>✓</span>}
                        </div>
                      </div>
                      <PositionCard ticker={t}
                        cachedData={posCache[t] || null}
                        onAnalysed={cacheAnalysis}
                        onRemove={remove}
                        scoreHistory={posHistory[t] || []}
                        inSwingModule={swingExposedTickers.includes(t)}
                        session={session}
                      />
                    </div>
                  ))}
                </div>
              </>
            )}
            {isLoaded && wl.length > 0 && (
              <div style={{ marginTop:18, padding:'12px 14px', background:C.card, borderRadius:9,
                border:`1px solid ${C.border}`, fontSize:11, color:C.muted }}>
                <b style={{ color:C.amber }}>Aviso:</b> Análisis orientativo. No constituye asesoría financiera.
              </div>
            )}
          </div>
        </div>

        {/* Screener */}
        <div style={{ display: tab==='screener' ? 'block' : 'none' }}>
          <PositionScreener watchlist={wl}
            onAdd={addToWatchlist} onRemove={remove} onAddAll={addAllToWatchlist}
            posCache={posCache} />
        </div>

        {/* Mercado */}
        {tab === 'mercado'   && <SectorRotation />}

        {/* Journal */}
        {tab === 'journal'   && <PositionJournal   session={session} />}
        {tab === 'dashboard' && <PositionDashboard session={session} />}
      </div>

      {/* Modal tarjeta desde tabla */}
      {tableModal && (
        <div onClick={() => setTableModal(null)}
          style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:2000,
            display:'flex', alignItems:'flex-start', justifyContent:'center',
            padding:'40px 16px', overflowY:'auto' }}>
          <div onClick={e => e.stopPropagation()} style={{ width:'100%', maxWidth:380 }}>
            <PositionCard ticker={tableModal}
              cachedData={posCache[tableModal] || null}
              onAnalysed={cacheAnalysis}
              onRemove={t => { remove(t); setTableModal(null) }}
              scoreHistory={posHistory[tableModal] || []}
              inSwingModule={swingExposedTickers.includes(tableModal)}
              session={session}
            />
            <button onClick={() => setTableModal(null)}
              style={{ marginTop:10, width:'100%', background:'none', border:`1px solid ${C.border}`,
                borderRadius:8, color:C.muted, padding:'8px', cursor:'pointer', fontSize:12 }}>
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
