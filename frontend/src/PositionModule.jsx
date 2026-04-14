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
  const hasVeto   = d?.scorecard?.precio_sma200?.score_sugerido === 0
  const hasRRVeto = d?.rr_suggested != null && d.rr_suggested < 2
  const daysToEarn = d?.next_earnings ? (() => {
    try { return Math.ceil((new Date(d.next_earnings) - new Date()) / (1000*60*60*24)) } catch { return null }
  })() : null
  const earningsNearby = daysToEarn != null && daysToEarn >= 0 && daysToEarn <= 7
  if (hasVeto || hasRRVeto) return 'NO_OPERAR'
  if (earningsNearby && scoreTotal >= 32) return 'OPERAR_CAUTELA'
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
function PositionJournal({ session }) {
  const [trades,   setTrades]   = useState([])
  const [filter,   setFilter]   = useState('all')
  const [selected, setSelected] = useState(null)
  const [form,     setForm]     = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [saving,   setSaving]   = useState(false)

  useEffect(() => {
    if (!session) return
    supabase.from('position_trades')
      .select('*')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setTrades(data || []))
  }, [session, saving])

  const filtered = filter === 'all' ? trades : trades.filter(t => t.status === filter)

  const openModal = (trade) => {
    setSelected(trade)
    setForm({ ...trade })
  }

  const closeModal = () => { setSelected(null); setForm(null) }

  const handleUpdate = async () => {
    if (!form) return
    setSaving(true)
    const { error } = await supabase.from('position_trades')
      .update({
        status:       form.status,
        exit_price:   form.exit_price   || null,
        exit_date:    form.exit_date    || null,
        notes:        form.notes        || null,
        catalyst:     form.catalyst     || null,
        invalidation: form.invalidation || null,
      })
      .eq('id', form.id)
    if (!error) closeModal()
    setSaving(false)
  }

  const handleDelete = async (id) => {
    await supabase.from('position_trades').delete().eq('id', id)
    setTrades(prev => prev.filter(t => t.id !== id))
    setConfirmDelete(null)
    closeModal()
  }

  const DECISION_SHORT = { OPERAR_CONVICCION:'CONVICCIÓN', OPERAR_CAUTELA:'CAUTELA', NO_OPERAR:'NO OPERAR' }

  return (
    <div style={{ maxWidth:960, margin:'0 auto', padding:'0 20px' }}>
      {/* Filtros */}
      <div style={{ display:'flex', gap:8, marginBottom:18, flexWrap:'wrap' }}>
        {[['all','Todos'],['planning','Planificando'],['open','Activos'],['closed','Cerrados']].map(([v,l]) => (
          <button key={v} onClick={() => setFilter(v)}
            style={{ background: filter===v ? C.accent+'22' : 'none',
              border:`1px solid ${filter===v ? C.accent : C.border}`,
              borderRadius:7, color: filter===v ? C.accent : C.muted,
              padding:'5px 14px', cursor:'pointer', fontSize:11, fontWeight:600 }}>
            {l}
          </button>
        ))}
        <span style={{ marginLeft:'auto', fontSize:11, color:C.muted, alignSelf:'center' }}>
          {filtered.length} operaciones
        </span>
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign:'center', padding:'60px', color:C.muted, fontSize:13 }}>
          No hay operaciones de position trading registradas.
        </div>
      ) : (
        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, overflow:'hidden' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead>
              <tr style={{ borderBottom:`1px solid ${C.border}` }}>
                {['Ticker','Empresa','Score','Decisión','Entrada','Stop','Obj.1','Estado',''].map(h => (
                  <th key={h} style={{ padding:'9px 10px', textAlign:'left', fontSize:10,
                    color:C.muted, letterSpacing:'0.07em', textTransform:'uppercase', fontWeight:600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => (
                <tr key={t.id} onClick={() => openModal(t)}
                  style={{ borderBottom:`1px solid ${C.border}`, cursor:'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background='#1a2d4533'}
                  onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                  <td style={{ padding:'10px', fontWeight:700, color:C.text }}>{t.ticker}</td>
                  <td style={{ padding:'10px', color:C.muted, fontSize:11 }}>{t.company_name || '—'}</td>
                  <td style={{ padding:'10px', fontFamily:'monospace', fontWeight:700,
                    color: t.score_total >= 32 ? C.green : t.score_total >= 22 ? C.amber : C.red }}>
                    {t.score_total}/{MAX_SCORE}
                  </td>
                  <td style={{ padding:'10px' }}>
                    <span style={{ fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:99,
                      color: DECISION_COLOR[t.decision], background: DECISION_COLOR[t.decision]+'18' }}>
                      {DECISION_SHORT[t.decision] || t.decision || '—'}
                    </span>
                  </td>
                  <td style={{ padding:'10px', fontFamily:'monospace', color:C.text }}>{t.entry_price ? `$${t.entry_price}` : '—'}</td>
                  <td style={{ padding:'10px', fontFamily:'monospace', color:C.red }}>{t.stop_loss ? `$${t.stop_loss}` : '—'}</td>
                  <td style={{ padding:'10px', fontFamily:'monospace', color:C.green }}>{t.target1 ? `$${t.target1}` : '—'}</td>
                  <td style={{ padding:'10px' }}>
                    <span style={{ fontSize:10, fontWeight:700, color: STATUS_COLORS[t.status] }}>
                      {STATUS_LABELS[t.status] || t.status}
                    </span>
                  </td>
                  <td style={{ padding:'10px' }} onClick={e => { e.stopPropagation(); setConfirmDelete(t.id) }}>
                    <span style={{ color:C.red, opacity:0.6, cursor:'pointer', fontSize:14 }}>×</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Confirm delete */}
      {confirmDelete && (
        <div onClick={() => setConfirmDelete(null)}
          style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', zIndex:3000,
            display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12,
              padding:'24px', textAlign:'center', maxWidth:320 }}>
            <div style={{ fontSize:14, color:C.text, marginBottom:16 }}>¿Eliminar esta operación?</div>
            <div style={{ display:'flex', gap:10, justifyContent:'center' }}>
              <button onClick={() => setConfirmDelete(null)}
                style={{ background:'none', border:`1px solid ${C.border}`, borderRadius:7,
                  color:C.muted, padding:'8px 18px', cursor:'pointer', fontSize:12 }}>Cancelar</button>
              <button onClick={() => handleDelete(confirmDelete)}
                style={{ background:C.red, border:'none', borderRadius:7,
                  color:'#fff', padding:'8px 18px', cursor:'pointer', fontSize:12, fontWeight:700 }}>Eliminar</button>
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
              padding:'24px', width:'100%', maxWidth:480 }}>
            <div style={{ fontSize:16, fontWeight:700, color:C.text, marginBottom:4 }}>
              {selected.ticker} — {selected.company_name}
            </div>
            <div style={{ fontSize:11, color:C.muted, marginBottom:18 }}>
              Score {selected.score_total}/{MAX_SCORE} · {DECISION_LABEL[selected.decision] || selected.decision}
            </div>

            {selected.narrative && (
              <div style={{ marginBottom:14, padding:'10px 12px', background:C.bg,
                borderRadius:8, fontSize:11, color:C.text, fontStyle:'italic' }}>
                "{selected.narrative}"
              </div>
            )}

            {selected.invalidation && (
              <div style={{ marginBottom:14 }}>
                <div style={{ fontSize:10, color:C.muted, marginBottom:3 }}>Invalidación de tesis:</div>
                <div style={{ fontSize:11, color:C.amber }}>{selected.invalidation}</div>
              </div>
            )}

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:14 }}>
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
              <div>
                <div style={{ fontSize:10, color:C.muted, marginBottom:4 }}>Precio de salida</div>
                <input type="number" value={form.exit_price || ''} onChange={e => setForm(f => ({ ...f, exit_price: e.target.value }))}
                  style={{ width:'100%', background:C.bg, border:`1px solid ${C.border}`, borderRadius:7,
                    padding:'8px 10px', color:C.text, fontSize:12, outline:'none', boxSizing:'border-box' }} />
              </div>
              <div>
                <div style={{ fontSize:10, color:C.muted, marginBottom:4 }}>Fecha de salida</div>
                <input type="date" value={form.exit_date || ''} onChange={e => setForm(f => ({ ...f, exit_date: e.target.value }))}
                  style={{ width:'100%', background:C.bg, border:`1px solid ${C.border}`, borderRadius:7,
                    padding:'8px 10px', color:C.text, fontSize:12, outline:'none', boxSizing:'border-box' }} />
              </div>
            </div>

            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:10, color:C.muted, marginBottom:4 }}>Notas</div>
              <textarea value={form.notes || ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={3} style={{ width:'100%', background:C.bg, border:`1px solid ${C.border}`, borderRadius:7,
                  padding:'9px 12px', color:C.text, fontSize:12, outline:'none', resize:'vertical',
                  boxSizing:'border-box', fontFamily:'inherit' }} />
            </div>

            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:10, color:C.muted, marginBottom:4 }}>Catalizador</div>
              <input value={form.catalyst || ''} onChange={e => setForm(f => ({ ...f, catalyst: e.target.value }))}
                style={{ width:'100%', background:C.bg, border:`1px solid ${C.border}`, borderRadius:7,
                  padding:'9px 12px', color:C.text, fontSize:12, outline:'none', boxSizing:'border-box' }} />
            </div>

            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:10, color:C.muted, marginBottom:4 }}>Invalidación de tesis</div>
              <textarea value={form.invalidation || ''} onChange={e => setForm(f => ({ ...f, invalidation: e.target.value }))}
                rows={3} style={{ width:'100%', background:C.bg, border:`1px solid ${C.border}`, borderRadius:7,
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
  const [preview,      setPreview]      = useState(null)   // ticker en modal
  const [previewData,  setPreviewData]  = useState(null)   // datos del análisis
  const [previewLoad,  setPreviewLoad]  = useState(false)

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/screener-position')
      if (!res.ok) throw new Error(`Error ${res.status}`)
      const data = await res.json()
      setCandidates(data.candidates || [])
      setScreenerDate(data.date || null)
      setSource(data.source || null)
      setUpdatedAt(data.updatedAt || null)
      setHistoryWeeks(data.historyWeeks || 0)
    } catch {
      setError('No se pudo conectar con el screener.')
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const openPreview = async (ticker) => {
    setPreview(ticker)
    // Usar caché si existe
    if (posCache?.[ticker]) {
      setPreviewData(posCache[ticker])
      return
    }
    setPreviewData(null)
    setPreviewLoad(true)
    try {
      const res = await fetch(`/api/analyze-position/${ticker}`)
      if (res.ok) setPreviewData(await res.json())
    } catch {}
    setPreviewLoad(false)
  }

  const triggerRefresh = async () => {
    setRefreshing(true); setRefreshMsg(null)
    try {
      const res = await fetch('/api/screener-position/refresh', { method:'POST' })
      const data = await res.json()
      if (res.ok) {
        setRefreshMsg({ ok:true, text:'Actualizando... listo en ~90 segundos' })
        setTimeout(() => { load(); setRefreshMsg(null) }, 90000)
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
          <button onClick={triggerRefresh} disabled={refreshing}
            style={{ background: refreshing ? C.border : C.green+'22',
              border:`1px solid ${refreshing ? C.border : C.green}`,
              borderRadius:7, color: refreshing ? C.muted : C.green,
              fontWeight:700, padding:'6px 14px', cursor: refreshing ? 'default' : 'pointer', fontSize:11 }}>
            {refreshing ? 'Actualizando...' : '↻ Actualizar screener'}
          </button>
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
                {s === 'all' ? `Todos (${candidates.length})` : s}
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
function PositionCard({ ticker, cachedData, onAnalysed, onRemove, scoreHistory, inSwingModule }) {
  const [data,       setData]       = useState(cachedData || null)
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState(null)
  const [expanded,   setExpanded]   = useState(false)
  const [capital,    setCapital]    = useState('')
  const [riskPct,    setRiskPct]    = useState('1')
  // Overrides manuales: { criterio: scoreManual (0-3) }
  const [overrides,  setOverrides]  = useState(cachedData?._overrides || {})

  // Si cachedData cambia (e.g. tras ↻ manual), sincronizar
  useEffect(() => {
    if (cachedData) {
      setData(cachedData)
      setOverrides(cachedData._overrides || {})
    }
  }, [cachedData])

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
  const hasOverrides = Object.keys(overrides).length > 0
  const hasVeto   = (overrides['precio_sma200'] ?? data?.scorecard?.precio_sma200?.score_sugerido) === 0
  const hasRRVeto = data?.rr_suggested != null && data.rr_suggested < 2

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
      border:`1px solid ${hasVeto||hasRRVeto ? C.red+'55' : decision==='OPERAR_CONVICCION' ? C.green+'44' : C.border}`,
      borderRadius:12, padding:'16px', display:'flex', flexDirection:'column', gap:11,
      borderLeft:`3px solid ${hasVeto||hasRRVeto ? C.red : decisionColor}` }}>

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
              display:'flex', alignItems:'center', gap:6 }}>
              <span style={{ color:'#00d4ff', fontWeight:700 }}>⚠ Este ticker está en tu watchlist de Swing Trading</span>
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
    </div>
  )
}

// ── Position Watchlist Table ─────────────────────────────────────────────────
function PositionWatchlistTable({ tickers, cache, onRemove, onRefresh, refreshingTickers, onRowClick, swingExposedTickers = [] }) {
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
                  style={{ borderBottom:`1px solid ${C.border}`, cursor:'pointer', transition:'background 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.background='#1a2d4533'}
                  onMouseLeave={e => e.currentTarget.style.background='transparent'}>
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
  const [tab,        setTab]        = useState('dashboard')
  const [viewMode,   setViewMode]   = useState('cards')   // 'cards' | 'table'
  const [search,     setSearch]     = useState('')
  const [tableModal, setTableModal] = useState(null)
  const [refreshingTickers, setRefreshingTickers] = useState({})

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
      const decision = scoreTotal >= 32 ? 'CONVICCIÓN' : scoreTotal >= 22 ? 'CAUTELA' : 'NO OPERAR'
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

  const [wlFilters, setWlFilters] = useState({ decision:'all', rsiMin:'', rsiMax:'', stage:'all', hhhl:'all' })
  const toggleWlFilter = (key, val) => setWlFilters(f => ({ ...f, [key]: f[key]===val ? 'all' : val }))
  const resetWlFilters = () => setWlFilters({ decision:'all', rsiMin:'', rsiMax:'', stage:'all', hhhl:'all' })
  const hasWlFilters = wlFilters.decision!=='all' || wlFilters.rsiMin!=='' || wlFilters.rsiMax!=='' || wlFilters.stage!=='all' || wlFilters.hhhl!=='all'

  const wl = watchlist || []
  const isLoaded = watchlist !== null

  const calcScore = (cache) => {
    if (!cache?.scorecard) return null
    return Object.entries(cache.scorecard).reduce((s,[k,v]) =>
      k==='_confidence' ? s : s+(v.score_sugerido??0)*(WEIGHTS[k]||1), 0)
  }

  const filteredWl = wl.filter(t => {
    const d = posCache[t]
    if (!d) return wlFilters.decision==='all' && wlFilters.rsiMin==='' && wlFilters.rsiMax==='' && wlFilters.stage==='all' && wlFilters.hhhl==='all'
    const score = calcScore(d)
    const dec = score == null ? null : score >= 32 ? 'OPERAR_CONVICCION' : score >= 22 ? 'OPERAR_CAUTELA' : 'NO_OPERAR'
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
    return true
  })

  const tabs = [
    ['dashboard', 'Dashboard'],
    ['watchlist', `Watchlist · ${wl.length}`],
    ['mercado',   'Mercado'],
    ['screener',  'Screener'],
    ['journal',   'Journal'],
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
                {hasWlFilters && (
                  <button onClick={resetWlFilters}
                    style={{ background:'none', border:`1px solid ${C.border}`, borderRadius:6,
                      color:C.muted, padding:'3px 8px', cursor:'pointer', fontSize:10 }}>
                    × limpiar
                  </button>
                )}
              </div>
            )}
            <div style={{ display:'flex', gap:7, marginBottom:14 }}>
              <input value={search} onChange={e => setSearch(e.target.value.toUpperCase())}
                onKeyDown={e => e.key==='Enter' && add()}
                placeholder="Agregar ticker… ej: NVDA, MSFT, AAPL"
                style={{ flex:1, background:'#0f1929', border:`1px solid ${C.border}`, borderRadius:9,
                  padding:'10px 14px', color:C.text, fontSize:13, outline:'none' }}
                onFocus={e => e.target.style.borderColor=M}
                onBlur={e  => e.target.style.borderColor=C.border}
              />
              <button onClick={add}
                style={{ background:M, border:'none', borderRadius:9, color:'#000',
                  fontWeight:700, padding:'10px 16px', cursor:'pointer', fontSize:13 }}>
                + Agregar
              </button>
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
                />
              </div>
            ) : (
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(260px, 1fr))', gap:11 }}>
                {filteredWl.length === 0 && (
                  <div style={{ gridColumn:'1/-1', textAlign:'center', padding:'40px', color:C.muted, fontSize:12 }}>
                    Sin resultados para este filtro
                  </div>
                )}
                {filteredWl.map(t => (
                  <PositionCard key={t} ticker={t}
                    cachedData={posCache[t] || null}
                    onAnalysed={cacheAnalysis}
                    onRemove={remove}
                    scoreHistory={posHistory[t] || []}
                    inSwingModule={swingExposedTickers.includes(t)}
                  />
                ))}
              </div>
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
