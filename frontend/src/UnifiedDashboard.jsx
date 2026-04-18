import { useState, useEffect } from 'react'
import { supabase } from './supabase.js'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Cell, Legend,
} from 'recharts'

const C = {
  bg:'#070d1a', card:'#0f1929', border:'#1a2d45',
  accent:'#00d4ff', green:'#00e096', red:'#ff4060',
  amber:'#ffb800', text:'#dde6f0', muted:'#4a6080',
}
const SWING_COLOR    = '#00d4ff'
const POSITION_COLOR = '#a78bfa'

function fmtUsd(n) {
  if (n == null) return '—'
  const abs = Math.abs(n), sign = n >= 0 ? '+' : '-'
  if (abs >= 1000) return `${sign}$${(abs/1000).toFixed(1)}k`
  return `${sign}$${abs.toFixed(2)}`
}
function fmtPct(n) {
  if (n == null) return '—'
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`
}

function StatCard({ label, value, color, sub, accent }) {
  return (
    <div style={{ background:C.card, border:`1px solid ${accent ? accent+'44' : C.border}`,
      borderRadius:10, padding:'14px 16px', textAlign:'center',
      borderTop: accent ? `3px solid ${accent}` : undefined }}>
      <div style={{ fontSize:9, color:C.muted, letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:6 }}>{label}</div>
      <div style={{ fontSize:20, fontWeight:700, fontFamily:'monospace', color: color || C.text }}>{value}</div>
      {sub && <div style={{ fontSize:10, color:C.muted, marginTop:4 }}>{sub}</div>}
    </div>
  )
}

function SectionHeader({ title, color }) {
  return (
    <div style={{ fontSize:10, color: color || C.muted, letterSpacing:'0.1em', textTransform:'uppercase',
      fontWeight:700, marginBottom:12, paddingBottom:6, borderBottom:`1px solid ${C.border}` }}>
      {title}
    </div>
  )
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background:'#0f1929', border:`1px solid #1a2d45`, borderRadius:8, padding:'10px 14px', fontSize:11 }}>
      <div style={{ color:C.text, fontWeight:700, marginBottom:6 }}>{label}</div>
      {payload.map((p, i) => p.value != null && (
        <div key={i} style={{ color:p.color, marginBottom:2 }}>
          {p.name}: <span style={{ fontFamily:'monospace', fontWeight:700 }}>{typeof p.value === 'number' ? fmtUsd(p.value) : p.value}</span>
        </div>
      ))}
    </div>
  )
}

export default function UnifiedDashboard({ session }) {
  const [swingTrades,    setSwingTrades]    = useState([])
  const [posTrades,      setPosTrades]      = useState([])
  const [loading,        setLoading]        = useState(true)

  useEffect(() => {
    if (!session) return
    Promise.all([
      supabase.from('journal').select('*').eq('user_id', session.user.id),
      supabase.from('position_trades').select('*').eq('user_id', session.user.id),
    ]).then(([sw, pos]) => {
      setSwingTrades(sw.data || [])
      setPosTrades(pos.data || [])
      setLoading(false)
    })
  }, [session])

  if (loading) return (
    <div style={{ textAlign:'center', padding:80, color:C.muted }}>Cargando dashboard...</div>
  )

  // ── Swing stats ──────────────────────────────────────────────────────────
  const swClosed = swingTrades.filter(t =>
    t.status === 'closed' && t.exit_price && t.entry_price && t.position_size
  )
  const swOpen = swingTrades.filter(t => ['open','breakeven','partial'].includes(t.status))
  const swPnl  = swClosed.reduce((acc, t) =>
    acc + (parseFloat(t.exit_price) - parseFloat(t.entry_price)) * parseFloat(t.position_size), 0)
  const swWins = swClosed.filter(t => parseFloat(t.exit_price) > parseFloat(t.entry_price)).length
  const swWinRate = swClosed.length > 0 ? Math.round(swWins / swClosed.length * 100) : null

  // ── Position stats ───────────────────────────────────────────────────────
  const posClosed = posTrades.filter(t =>
    t.status === 'closed' && t.exit_price && t.entry_price && t.shares
  )
  const posOpen = posTrades.filter(t => t.status === 'open')
  const posPnl  = posClosed.reduce((acc, t) =>
    acc + (parseFloat(t.exit_price) - parseFloat(t.entry_price)) * parseFloat(t.shares), 0)
  const posWins = posClosed.filter(t => parseFloat(t.exit_price) > parseFloat(t.entry_price)).length
  const posWinRate = posClosed.length > 0 ? Math.round(posWins / posClosed.length * 100) : null

  // ── Totales ──────────────────────────────────────────────────────────────
  const totalPnl      = swPnl + posPnl
  const totalClosed   = swClosed.length + posClosed.length
  const totalOpen     = swOpen.length + posOpen.length
  const totalWins     = swWins + posWins
  const totalWinRate  = totalClosed > 0 ? Math.round(totalWins / totalClosed * 100) : null

  // ── P&L mensual combinado ────────────────────────────────────────────────
  const monthMap = {}
  const addToMonth = (t, pnl, type) => {
    const m = (t.exit_date || t.date || '').slice(0, 7)
    if (!m) return
    if (!monthMap[m]) monthMap[m] = { swing: 0, position: 0 }
    monthMap[m][type] += pnl
  }
  swClosed.forEach(t => {
    const pnl = (parseFloat(t.exit_price) - parseFloat(t.entry_price)) * parseFloat(t.position_size)
    addToMonth(t, pnl, 'swing')
  })
  posClosed.forEach(t => {
    const pnl = (parseFloat(t.exit_price) - parseFloat(t.entry_price)) * parseFloat(t.shares)
    addToMonth(t, pnl, 'position')
  })

  let cumPnl = 0
  const monthlyData = Object.keys(monthMap).sort().map(m => {
    const sw  = monthMap[m].swing
    const pos = monthMap[m].position
    const total = sw + pos
    cumPnl += total
    const date = new Date(m + '-02')
    const monthLabel = date.toLocaleString('es', { month:'short', year:'2-digit' })
    return { month: m, monthLabel, swing: Math.round(sw*100)/100, position: Math.round(pos*100)/100, total: Math.round(total*100)/100, cumPnl: Math.round(cumPnl*100)/100 }
  })

  // ── Últimas operaciones combinadas ───────────────────────────────────────
  const recentTrades = [
    ...swClosed.map(t => ({
      type: 'swing',
      ticker: t.ticker,
      date: t.exit_date || t.date,
      pnl: (parseFloat(t.exit_price) - parseFloat(t.entry_price)) * parseFloat(t.position_size),
      entry: parseFloat(t.entry_price),
      exit: parseFloat(t.exit_price),
      signal: t.signal,
    })),
    ...posClosed.map(t => ({
      type: 'position',
      ticker: t.ticker,
      date: t.exit_date || t.created_at?.slice(0,10),
      pnl: (parseFloat(t.exit_price) - parseFloat(t.entry_price)) * parseFloat(t.shares),
      entry: parseFloat(t.entry_price),
      exit: parseFloat(t.exit_price),
      decision: t.decision,
    })),
  ].filter(t => t.date).sort((a,b) => b.date.localeCompare(a.date)).slice(0, 15)

  const hasData = totalClosed > 0 || totalOpen > 0

  return (
    <div style={{ maxWidth:960, margin:'0 auto', padding:'0 20px 48px' }}>

      {!hasData ? (
        <div style={{ textAlign:'center', padding:'80px 20px', color:C.muted }}>
          <div style={{ fontSize:40, marginBottom:16 }}>📊</div>
          <div style={{ fontSize:16, color:C.text, marginBottom:8 }}>Sin operaciones todavía</div>
          <div style={{ fontSize:12 }}>Registra operaciones en el journal de Swing o Position para ver el dashboard aquí.</div>
        </div>
      ) : (
        <>
          {/* ── Resumen general ─────────────────────────────────────── */}
          <SectionHeader title="Resumen general" />
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(160px, 1fr))', gap:10, marginBottom:24 }}>
            <StatCard label="P&L Total" value={fmtUsd(totalPnl)} color={totalPnl >= 0 ? C.green : C.red} />
            <StatCard label="Win Rate" value={totalWinRate != null ? `${totalWinRate}%` : '—'} color={totalWinRate >= 50 ? C.green : C.red} sub={`${totalWins}/${totalClosed} ops`} />
            <StatCard label="Cerradas" value={totalClosed} color={C.text} />
            <StatCard label="Activas" value={totalOpen} color={totalOpen > 0 ? C.amber : C.muted} />
          </div>

          {/* ── Por módulo ──────────────────────────────────────────── */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:28 }}>
            {/* Swing */}
            <div style={{ background:C.card, border:`1px solid ${SWING_COLOR}33`, borderRadius:12,
              padding:'16px', borderTop:`3px solid ${SWING_COLOR}` }}>
              <div style={{ fontSize:11, fontWeight:700, color:SWING_COLOR, letterSpacing:'0.06em',
                textTransform:'uppercase', marginBottom:14 }}>⚡ Swing Trading</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                {[
                  ['P&L', fmtUsd(swPnl), swPnl >= 0 ? C.green : C.red],
                  ['Win Rate', swWinRate != null ? `${swWinRate}%` : '—', swWinRate >= 50 ? C.green : C.red],
                  ['Cerradas', swClosed.length, C.text],
                  ['Activas', swOpen.length, swOpen.length > 0 ? C.amber : C.muted],
                ].map(([label, val, color]) => (
                  <div key={label} style={{ background:C.bg, borderRadius:7, padding:'8px 10px' }}>
                    <div style={{ fontSize:8, color:C.muted, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:3 }}>{label}</div>
                    <div style={{ fontSize:15, fontWeight:700, fontFamily:'monospace', color }}>{val}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Position */}
            <div style={{ background:C.card, border:`1px solid ${POSITION_COLOR}33`, borderRadius:12,
              padding:'16px', borderTop:`3px solid ${POSITION_COLOR}` }}>
              <div style={{ fontSize:11, fontWeight:700, color:POSITION_COLOR, letterSpacing:'0.06em',
                textTransform:'uppercase', marginBottom:14 }}>📈 Position Trading</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                {[
                  ['P&L', fmtUsd(posPnl), posPnl >= 0 ? C.green : C.red],
                  ['Win Rate', posWinRate != null ? `${posWinRate}%` : '—', posWinRate >= 50 ? C.green : C.red],
                  ['Cerradas', posClosed.length, C.text],
                  ['Activas', posOpen.length, posOpen.length > 0 ? C.amber : C.muted],
                ].map(([label, val, color]) => (
                  <div key={label} style={{ background:C.bg, borderRadius:7, padding:'8px 10px' }}>
                    <div style={{ fontSize:8, color:C.muted, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:3 }}>{label}</div>
                    <div style={{ fontSize:15, fontWeight:700, fontFamily:'monospace', color }}>{val}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Operaciones abiertas ────────────────────────────────── */}
          {(swOpen.length > 0 || posOpen.length > 0) && (() => {
            const openRows = [
              ...swOpen.map(t => ({
                type: 'swing',
                ticker: t.ticker,
                date: t.date,
                entry: parseFloat(t.entry_price),
                stop: t.stop_price ? parseFloat(t.stop_price) : null,
                target: null,
                size: t.position_size ? parseFloat(t.position_size) : null,
                status: t.status,
              })),
              ...posOpen.map(t => ({
                type: 'position',
                ticker: t.ticker,
                date: t.entry_date || t.created_at?.slice(0,10),
                entry: parseFloat(t.entry_price),
                stop: t.stop_price ? parseFloat(t.stop_price) : null,
                target: t.target_price ? parseFloat(t.target_price) : null,
                size: t.shares ? parseFloat(t.shares) : null,
                status: t.status,
              })),
            ].sort((a,b) => (b.date||'').localeCompare(a.date||''))
            return (
              <div style={{ marginBottom:28 }}>
                <SectionHeader title={`Operaciones abiertas (${openRows.length})`} color={C.amber} />
                <div style={{ background:C.card, border:`1px solid ${C.amber}33`, borderRadius:12, overflow:'hidden' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom:`1px solid ${C.border}` }}>
                        {['Ticker','Módulo','Fecha entrada','Entrada','Stop','Target','Tamaño'].map(h => (
                          <th key={h} style={{ padding:'8px 12px', textAlign:'left', fontSize:9,
                            color:C.muted, letterSpacing:'0.08em', textTransform:'uppercase', fontWeight:600, whiteSpace:'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {openRows.map((t, i) => {
                        const rr = t.stop && t.target && t.entry
                          ? ((t.target - t.entry) / (t.entry - t.stop)).toFixed(1)
                          : null
                        return (
                          <tr key={i} style={{ borderBottom:`1px solid ${C.border}33` }}
                            onMouseEnter={e => e.currentTarget.style.background='#1a2d4533'}
                            onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                            <td style={{ padding:'9px 12px', fontFamily:'monospace', fontWeight:700, color:C.text, fontSize:12, whiteSpace:'nowrap' }}>
                              {t.ticker}
                              {t.status && t.status !== 'open' && (
                                <span style={{ marginLeft:6, fontSize:8, fontWeight:700, padding:'1px 5px', borderRadius:99,
                                  background:C.amber+'22', color:C.amber }}>{t.status}</span>
                              )}
                            </td>
                            <td style={{ padding:'9px 12px', whiteSpace:'nowrap' }}>
                              <span style={{ fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:99,
                                color: t.type === 'swing' ? SWING_COLOR : POSITION_COLOR,
                                background: t.type === 'swing' ? SWING_COLOR+'18' : POSITION_COLOR+'18' }}>
                                {t.type === 'swing' ? '⚡ Swing' : '📈 Position'}
                              </span>
                            </td>
                            <td style={{ padding:'9px 12px', fontSize:11, color:C.muted }}>{t.date || '—'}</td>
                            <td style={{ padding:'9px 12px', fontFamily:'monospace', fontSize:11, color:C.text }}>
                              {t.entry ? `$${t.entry.toFixed(2)}` : '—'}
                            </td>
                            <td style={{ padding:'9px 12px', fontFamily:'monospace', fontSize:11, color:C.red }}>
                              {t.stop ? `$${t.stop.toFixed(2)}` : '—'}
                            </td>
                            <td style={{ padding:'9px 12px', fontFamily:'monospace', fontSize:11 }}>
                              {t.target ? (
                                <span>
                                  <span style={{ color:C.green }}>${t.target.toFixed(2)}</span>
                                  {rr && <span style={{ color:C.muted, fontSize:9, marginLeft:5 }}>R/R {rr}</span>}
                                </span>
                              ) : '—'}
                            </td>
                            <td style={{ padding:'9px 12px', fontFamily:'monospace', fontSize:11, color:C.muted }}>
                              {t.size ?? '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })()}

          {/* ── Gráfico P&L mensual ─────────────────────────────────── */}
          {monthlyData.length > 0 && (
            <div style={{ marginBottom:28 }}>
              <SectionHeader title="P&L mensual por módulo" />
              <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:'16px' }}>
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={monthlyData} margin={{ top:4, right:8, left:0, bottom:0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                    <XAxis dataKey="monthLabel" tick={{ fill:C.muted, fontSize:10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill:C.muted, fontSize:10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} width={50} />
                    <Tooltip content={<ChartTooltip />} />
                    <ReferenceLine y={0} stroke={C.border} strokeWidth={1} />
                    <Bar dataKey="swing" name="Swing" stackId="a" fill={SWING_COLOR} fillOpacity={0.8} radius={[0,0,0,0]} />
                    <Bar dataKey="position" name="Position" stackId="a" radius={[3,3,0,0]}
                      fill={POSITION_COLOR} fillOpacity={0.8}>
                      {monthlyData.map((m, i) => (
                        <Cell key={i} fill={(m.swing + m.position) >= 0 ? POSITION_COLOR : C.red} fillOpacity={0.8} />
                      ))}
                    </Bar>
                    <Line type="monotone" dataKey="cumPnl" name="Acumulado" stroke={C.amber}
                      strokeWidth={2} dot={false} strokeDasharray="4 2" />
                  </ComposedChart>
                </ResponsiveContainer>
                <div style={{ display:'flex', gap:16, justifyContent:'center', marginTop:8 }}>
                  {[['Swing', SWING_COLOR], ['Position', POSITION_COLOR], ['Acumulado', C.amber]].map(([label, color]) => (
                    <div key={label} style={{ display:'flex', alignItems:'center', gap:5, fontSize:10, color:C.muted }}>
                      <div style={{ width:10, height:10, borderRadius:2, background:color }} />
                      {label}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Últimas operaciones ─────────────────────────────────── */}
          {recentTrades.length > 0 && (
            <div>
              <SectionHeader title="Últimas operaciones" />
              <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, overflow:'hidden' }}>
                <table style={{ width:'100%', borderCollapse:'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom:`1px solid ${C.border}` }}>
                      {['Ticker','Módulo','Fecha','Entrada','Salida','P&L'].map(h => (
                        <th key={h} style={{ padding:'8px 12px', textAlign:'left', fontSize:9,
                          color:C.muted, letterSpacing:'0.08em', textTransform:'uppercase', fontWeight:600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {recentTrades.map((t, i) => (
                      <tr key={i} style={{ borderBottom:`1px solid ${C.border}33` }}
                        onMouseEnter={e => e.currentTarget.style.background='#1a2d4533'}
                        onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                        <td style={{ padding:'9px 12px', fontFamily:'monospace', fontWeight:700, color:C.text, fontSize:12 }}>
                          {t.ticker}
                        </td>
                        <td style={{ padding:'9px 12px' }}>
                          <span style={{ fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:99,
                            color: t.type === 'swing' ? SWING_COLOR : POSITION_COLOR,
                            background: t.type === 'swing' ? SWING_COLOR+'18' : POSITION_COLOR+'18' }}>
                            {t.type === 'swing' ? '⚡ Swing' : '📈 Position'}
                          </span>
                        </td>
                        <td style={{ padding:'9px 12px', fontSize:11, color:C.muted }}>{t.date}</td>
                        <td style={{ padding:'9px 12px', fontFamily:'monospace', fontSize:11, color:C.text }}>
                          ${t.entry?.toFixed(2)}
                        </td>
                        <td style={{ padding:'9px 12px', fontFamily:'monospace', fontSize:11, color:C.text }}>
                          ${t.exit?.toFixed(2)}
                        </td>
                        <td style={{ padding:'9px 12px', fontFamily:'monospace', fontWeight:700, fontSize:12,
                          color: t.pnl >= 0 ? C.green : C.red }}>
                          {fmtUsd(t.pnl)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
