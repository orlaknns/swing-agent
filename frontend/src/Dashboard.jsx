import { useState, useEffect } from 'react'
import { supabase } from './supabase.js'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts'

const C = {
  bg:'#070d1a', card:'#0f1929', border:'#1a2d45',
  accent:'#00d4ff', green:'#00e096', red:'#ff4060',
  amber:'#ffb800', text:'#dde6f0', muted:'#4a6080',
}

function fmt(n) {
  if (n == null) return '—'
  return `$${Number(n).toFixed(2)}`
}
function fmtPct(n) {
  if (n == null) return '—'
  return `${Number(n) >= 0 ? '+' : ''}${Number(n).toFixed(2)}%`
}
function fmtUsd(n) {
  if (n == null) return '—'
  const abs = Math.abs(n)
  const sign = n >= 0 ? '+' : '-'
  if (abs >= 1000) return `${sign}$${(abs/1000).toFixed(1)}k`
  return `${sign}$${abs.toFixed(2)}`
}
function fmtUsdShort(n) {
  if (n == null) return '—'
  const abs = Math.abs(n)
  const sign = n >= 0 ? '+' : '-'
  if (abs >= 1000) return `${sign}$${(abs/1000).toFixed(1)}k`
  return `${sign}$${abs.toFixed(0)}`
}

function StatCard({ label, value, color, sub }) {
  return (
    <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:'14px 16px', textAlign:'center' }}>
      <div style={{ fontSize:9, color:C.muted, letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:6 }}>{label}</div>
      <div style={{ fontSize:22, fontWeight:700, fontFamily:'monospace', color: color || C.text }}>{value}</div>
      {sub && <div style={{ fontSize:10, color:C.muted, marginTop:4 }}>{sub}</div>}
    </div>
  )
}

function SectionHeader({ title }) {
  return (
    <div style={{ fontSize:10, color:C.muted, letterSpacing:'0.1em', textTransform:'uppercase',
      fontWeight:700, marginBottom:12, paddingBottom:6, borderBottom:`1px solid ${C.border}` }}>
      {title}
    </div>
  )
}

// Tooltip personalizado para el gráfico
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  return (
    <div style={{ background:'#0f1929', border:`1px solid #1a2d45`, borderRadius:8, padding:'10px 14px', fontSize:11 }}>
      <div style={{ color:C.accent, fontWeight:700, marginBottom:6 }}>{d.monthLabel}</div>
      <div style={{ color:C.muted, marginBottom:2 }}>P&L mensual: <span style={{ color: d.pnlUsd >= 0 ? C.green : C.red, fontWeight:700, fontFamily:'monospace' }}>{fmtUsd(d.pnlUsd)}</span></div>
      <div style={{ color:C.muted, marginBottom:2 }}>P&L %: <span style={{ color: d.pnlPct >= 0 ? C.green : C.red, fontFamily:'monospace' }}>{fmtPct(d.pnlPct)}</span></div>
      <div style={{ color:C.muted, marginBottom:2 }}>Acumulado: <span style={{ color: d.cumPnl >= 0 ? C.green : C.red, fontFamily:'monospace' }}>{fmtUsd(d.cumPnl)}</span></div>
      <div style={{ color:C.muted, marginBottom:2 }}>Trades: <span style={{ color:C.text, fontFamily:'monospace' }}>{d.count}</span></div>
      <div style={{ color:C.muted }}>Win rate: <span style={{ color: d.winRate >= 50 ? C.green : C.red, fontFamily:'monospace' }}>{d.winRate}%</span></div>
    </div>
  )
}

export default function Dashboard({ session }) {
  const [trades, setTrades] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!session) return
    supabase.from('journal').select('*').eq('user_id', session.user.id)
      .order('date', { ascending: false })
      .then(({ data }) => {
        if (data) setTrades(data.map(dbToTrade))
        setLoading(false)
      })
  }, [session])

  if (loading) return <div style={{ textAlign:'center', padding:60, color:C.muted }}>Cargando dashboard...</div>

  if (trades.length === 0) return (
    <div style={{ maxWidth:960, margin:'0 auto', padding:'0 20px 48px' }}>
      <div style={{ textAlign:'center', padding:'80px 20px', color:C.muted }}>
        <div style={{ fontSize:40, marginBottom:16 }}>📊</div>
        <div style={{ fontSize:16, color:C.text, marginBottom:8 }}>Sin operaciones todavía</div>
        <div style={{ fontSize:12 }}>Guarda tu primera operación desde la Watchlist para ver el dashboard aquí.</div>
      </div>
    </div>
  )

  // ── Datos base ────────────────────────────────────────────────────────
  const now        = new Date()
  const thisMonth  = now.toISOString().slice(0, 7)

  const openTrades     = trades.filter(t => ['open','breakeven','partial'].includes(t.status))
  const closedWithData = trades.filter(t =>
    t.status === 'closed' && t.exitPrice && t.entryPrice && t.positionSize
  )

  // Mes de cierre: exit_date si existe, fallback a date para legacy
  const tradeMonth = (t) => (t.exitDate || t.date || '').slice(0, 7)

  // ── Agrupar por mes — todos los meses con trades cerrados ─────────────
  const monthMap = {}
  closedWithData.forEach(t => {
    const m = tradeMonth(t)
    if (!m) return
    if (!monthMap[m]) monthMap[m] = []
    monthMap[m].push(t)
  })

  // Ordenar meses cronológicamente
  const sortedMonths = Object.keys(monthMap).sort()

  // Calcular stats por mes + P&L acumulado
  let cumPnl = 0
  const monthlyData = sortedMonths.map(m => {
    const ts      = monthMap[m]
    const stats   = calcPnl(ts)
    const wins    = ts.filter(t => parseFloat(t.exitPrice) > parseFloat(t.entryPrice)).length
    const winRate = ts.length > 0 ? Math.round(wins / ts.length * 100) : 0
    cumPnl += stats.pnlUsd
    const date    = new Date(m + '-02')  // día 2 para evitar timezone offset
    const monthLabel = date.toLocaleString('es', { month:'short', year:'2-digit' })
    return {
      month: m,
      monthLabel,
      count:    ts.length,
      wins,
      winRate,
      invested: stats.invested,
      pnlUsd:   stats.pnlUsd,
      pnlPct:   stats.pnlPct,
      cumPnl:   Math.round(cumPnl * 100) / 100,
    }
  })

  // Stats del mes actual
  const thisMonthData = monthlyData.find(d => d.month === thisMonth)
  const prevMonthData = monthlyData.length >= 2
    ? monthlyData[monthlyData.length - (thisMonthData ? 2 : 1)]
    : null

  // Stats totales
  const totalStats  = calcPnl(closedWithData)
  const totalWins   = closedWithData.filter(t => parseFloat(t.exitPrice) > parseFloat(t.entryPrice)).length
  const totalWinRate = closedWithData.length > 0 ? Math.round(totalWins / closedWithData.length * 100) : null

  // Capital abierto y en riesgo
  const openInvested = openTrades.reduce((acc, t) => {
    return acc + parseFloat(t.entryPrice || 0) * parseFloat(t.positionSize || 0)
  }, 0)
  const capitalRisk = openTrades.reduce((acc, t) => {
    const entry  = parseFloat(t.entryPrice || 0)
    const stop   = parseFloat(t.realStopLoss || t.stopLoss || 0)
    const shares = parseFloat(t.positionSize || 0)
    if (entry > 0 && stop > 0 && shares > 0) acc += (entry - stop) * shares
    return acc
  }, 0)

  // Últimas 10 cerradas por fecha de cierre
  const recentClosed = [...closedWithData]
    .sort((a, b) => (b.exitDate || b.date || '').localeCompare(a.exitDate || a.date || ''))
    .slice(0, 10)

  // Escala del gráfico de barras
  const maxAbsPnl = Math.max(...monthlyData.map(d => Math.abs(d.pnlUsd)), 1)

  const hasLegacyTrades = closedWithData.some(t => !t.exitDate)

  return (
    <div style={{ maxWidth:960, margin:'0 auto', padding:'0 20px 48px' }}>

      <div style={{ marginBottom:20 }}>
        <h2 style={{ fontSize:18, fontWeight:700, color:C.text, margin:0 }}>Dashboard</h2>
        <p style={{ fontSize:11, color:C.muted, margin:'4px 0 0' }}>Resumen de tu actividad de trading</p>
      </div>

      {/* ── RESUMEN TOTAL ─────────────────────────────────────────────── */}
      <div style={{ marginBottom:24 }}>
        <SectionHeader title={`Histórico total · ${closedWithData.length} operaciones cerradas`} />
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(150px, 1fr))', gap:8 }}>
          <StatCard label="Total cerradas"   value={closedWithData.length}  color={C.muted} />
          <StatCard label="Abiertas ahora"   value={openTrades.length}      color={C.accent} />
          <StatCard label="Win rate total"
            value={totalWinRate != null ? `${totalWinRate}%` : '—'}
            color={totalWinRate >= 50 ? C.green : totalWinRate != null ? C.red : C.muted}
            sub={`${totalWins} de ${closedWithData.length}`}
          />
          <StatCard label="P&L total USD"
            value={totalStats.invested > 0 ? fmtUsd(totalStats.pnlUsd) : '—'}
            color={totalStats.pnlUsd >= 0 ? C.green : C.red}
          />
          <StatCard label="P&L total %"
            value={totalStats.pnlPct != null ? fmtPct(totalStats.pnlPct) : '—'}
            color={totalStats.pnlPct >= 0 ? C.green : C.red}
            sub="sobre capital invertido"
          />
          <StatCard label="Capital en riesgo"
            value={capitalRisk > 0 ? fmtUsd(-capitalRisk) : '—'}
            color={capitalRisk > 0 ? C.red : C.muted}
            sub="si todos los SL se activan"
          />
        </div>
      </div>

      {/* ── GRÁFICO + TABLA MENSUAL ───────────────────────────────────── */}
      {monthlyData.length > 0 && (
        <div style={{ marginBottom:24 }}>
          <SectionHeader title={`Comparativa mensual · ${monthlyData.length} ${monthlyData.length === 1 ? 'mes' : 'meses'}`} />

          {/* Gráfico: barras P&L mensual + línea acumulada */}
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:'16px 8px 8px', marginBottom:12 }}>
            <div style={{ fontSize:9, color:C.muted, textAlign:'right', marginRight:16, marginBottom:4, letterSpacing:'0.07em' }}>
              BARRAS = P&L MENSUAL · LÍNEA = P&L ACUMULADO
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={monthlyData} margin={{ top:4, right:16, left:0, bottom:0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                <XAxis
                  dataKey="monthLabel"
                  tick={{ fontSize:10, fill:C.muted }}
                  axisLine={{ stroke:C.border }}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="bar"
                  tick={{ fontSize:9, fill:C.muted }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={v => fmtUsdShort(v)}
                  domain={[-maxAbsPnl * 1.2, maxAbsPnl * 1.2]}
                  width={52}
                />
                <YAxis
                  yAxisId="line"
                  orientation="right"
                  tick={{ fontSize:9, fill:C.muted }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={v => fmtUsdShort(v)}
                  width={52}
                />
                <Tooltip content={<ChartTooltip />} />
                <ReferenceLine yAxisId="bar" y={0} stroke={C.border} strokeWidth={1} />
                <Bar yAxisId="bar" dataKey="pnlUsd" radius={[3,3,0,0]} maxBarSize={48}>
                  {monthlyData.map((d, i) => (
                    <Cell key={i} fill={d.pnlUsd >= 0 ? C.green : C.red} fillOpacity={0.8} />
                  ))}
                </Bar>
                <Line
                  yAxisId="line"
                  type="monotone"
                  dataKey="cumPnl"
                  stroke={C.accent}
                  strokeWidth={2}
                  dot={{ fill:C.accent, r:3, strokeWidth:0 }}
                  activeDot={{ r:5, fill:C.accent }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Tabla mensual */}
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:10, overflow:'hidden' }}>
            {/* Header */}
            <div style={{
              display:'grid', gridTemplateColumns:'80px 1fr 1fr 1fr 1fr 1fr 1fr',
              padding:'8px 14px', borderBottom:`1px solid ${C.border}`,
              fontSize:9, color:C.muted, letterSpacing:'0.07em', textTransform:'uppercase'
            }}>
              <span>Mes</span>
              <span style={{ textAlign:'center' }}>Trades</span>
              <span style={{ textAlign:'center' }}>Win rate</span>
              <span style={{ textAlign:'right' }}>Invertido</span>
              <span style={{ textAlign:'right' }}>P&L USD</span>
              <span style={{ textAlign:'right' }}>P&L %</span>
              <span style={{ textAlign:'right' }}>Acumulado</span>
            </div>
            {/* Filas — más reciente primero */}
            {[...monthlyData].reverse().map((d, i) => {
              const isThisMonth = d.month === thisMonth
              return (
                <div key={d.month} style={{
                  display:'grid', gridTemplateColumns:'80px 1fr 1fr 1fr 1fr 1fr 1fr',
                  padding:'9px 14px',
                  background: isThisMonth ? '#00d4ff08' : i % 2 === 0 ? 'transparent' : '#ffffff04',
                  borderBottom:`1px solid ${C.border}`,
                  borderLeft: isThisMonth ? `2px solid ${C.accent}` : '2px solid transparent',
                  fontSize:11,
                }}>
                  <span style={{ color: isThisMonth ? C.accent : C.text, fontWeight: isThisMonth ? 700 : 400 }}>
                    {d.monthLabel}{isThisMonth ? ' ←' : ''}
                  </span>
                  <span style={{ textAlign:'center', color:C.muted, fontFamily:'monospace' }}>
                    {d.count} <span style={{ fontSize:9 }}>({d.wins}W)</span>
                  </span>
                  <span style={{ textAlign:'center', fontFamily:'monospace', fontWeight:700,
                    color: d.winRate >= 50 ? C.green : C.red }}>
                    {d.winRate}%
                  </span>
                  <span style={{ textAlign:'right', color:C.muted, fontFamily:'monospace' }}>
                    {d.invested > 0 ? `$${(d.invested/1000).toFixed(1)}k` : '—'}
                  </span>
                  <span style={{ textAlign:'right', fontFamily:'monospace', fontWeight:700,
                    color: d.pnlUsd >= 0 ? C.green : C.red }}>
                    {fmtUsd(d.pnlUsd)}
                  </span>
                  <span style={{ textAlign:'right', fontFamily:'monospace',
                    color: d.pnlPct >= 0 ? C.green : C.red }}>
                    {fmtPct(d.pnlPct)}
                  </span>
                  <span style={{ textAlign:'right', fontFamily:'monospace',
                    color: d.cumPnl >= 0 ? C.green : C.red }}>
                    {fmtUsd(d.cumPnl)}
                  </span>
                </div>
              )
            })}
            {/* Fila total */}
            <div style={{
              display:'grid', gridTemplateColumns:'80px 1fr 1fr 1fr 1fr 1fr 1fr',
              padding:'9px 14px',
              background:'#ffffff06',
              borderTop:`1px solid ${C.border}`,
              fontSize:11, fontWeight:700,
            }}>
              <span style={{ color:C.text }}>Total</span>
              <span style={{ textAlign:'center', color:C.muted, fontFamily:'monospace' }}>
                {closedWithData.length} <span style={{ fontSize:9 }}>({totalWins}W)</span>
              </span>
              <span style={{ textAlign:'center', fontFamily:'monospace',
                color: totalWinRate >= 50 ? C.green : C.red }}>
                {totalWinRate != null ? `${totalWinRate}%` : '—'}
              </span>
              <span style={{ textAlign:'right', color:C.muted, fontFamily:'monospace' }}>
                {totalStats.invested > 0 ? `$${(totalStats.invested/1000).toFixed(1)}k` : '—'}
              </span>
              <span style={{ textAlign:'right', fontFamily:'monospace',
                color: totalStats.pnlUsd >= 0 ? C.green : C.red }}>
                {fmtUsd(totalStats.pnlUsd)}
              </span>
              <span style={{ textAlign:'right', fontFamily:'monospace',
                color: totalStats.pnlPct >= 0 ? C.green : C.red }}>
                {fmtPct(totalStats.pnlPct)}
              </span>
              <span style={{ textAlign:'right', color:C.muted }}>—</span>
            </div>
          </div>

          {hasLegacyTrades && (
            <div style={{ fontSize:9, color:C.muted, marginTop:6, opacity:0.6 }}>
              * Trades cerrados antes de v17 usan fecha de apertura como referencia mensual.
            </div>
          )}
        </div>
      )}

      {/* ── POSICIONES ABIERTAS ───────────────────────────────────────── */}
      {openTrades.length > 0 && (
        <div style={{ marginBottom:24 }}>
          <SectionHeader title={`Posiciones abiertas · ${openTrades.length}`} />
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(150px, 1fr))', gap:8 }}>
            <StatCard label="Capital invertido"
              value={openInvested > 0 ? `$${(openInvested/1000).toFixed(1)}k` : '—'}
              color={C.text}
            />
            <StatCard label="Capital en riesgo"
              value={capitalRisk > 0 ? fmtUsd(-capitalRisk) : '—'}
              color={capitalRisk > 0 ? C.red : C.muted}
              sub="si todos los SL se activan"
            />
          </div>
        </div>
      )}

      {/* ── ÚLTIMAS OPERACIONES CERRADAS ─────────────────────────────── */}
      {recentClosed.length > 0 && (
        <div>
          <SectionHeader title="Últimas operaciones cerradas" />
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:10, overflow:'hidden' }}>
            <div style={{
              display:'grid', gridTemplateColumns:'70px 1fr 1fr 1fr 1fr',
              padding:'8px 14px', borderBottom:`1px solid ${C.border}`,
              fontSize:9, color:C.muted, letterSpacing:'0.07em', textTransform:'uppercase'
            }}>
              <span>Ticker</span>
              <span>Cierre</span>
              <span style={{ textAlign:'right' }}>Entrada → Salida</span>
              <span style={{ textAlign:'right' }}>P&L %</span>
              <span style={{ textAlign:'right' }}>P&L USD</span>
            </div>
            {recentClosed.map((t, i) => {
              const entry  = parseFloat(t.entryPrice)
              const exit   = parseFloat(t.exitPrice)
              const shares = parseFloat(t.positionSize)
              const pnlPct = (exit - entry) / entry * 100
              const pnlUsd = (exit - entry) * shares
              const isWin  = exit > entry
              return (
                <div key={t.id} style={{
                  display:'grid', gridTemplateColumns:'70px 1fr 1fr 1fr 1fr',
                  padding:'9px 14px',
                  background: i % 2 === 0 ? 'transparent' : '#ffffff04',
                  borderBottom: i < recentClosed.length - 1 ? `1px solid ${C.border}` : 'none',
                  borderLeft:`2px solid ${isWin ? C.green : C.red}`,
                  fontSize:11,
                }}>
                  <span style={{ fontWeight:700, fontFamily:'monospace', color:C.text }}>{t.ticker}</span>
                  <span style={{ color:C.muted, fontSize:10 }}>
                    {t.exitDate || <>{t.date}<span style={{ opacity:0.4 }}> *</span></>}
                  </span>
                  <span style={{ textAlign:'right', color:C.muted, fontFamily:'monospace', fontSize:10 }}>
                    {fmt(t.entryPrice)} → {fmt(t.exitPrice)}
                  </span>
                  <span style={{ textAlign:'right', fontFamily:'monospace', fontWeight:700,
                    color: isWin ? C.green : C.red }}>
                    {fmtPct(pnlPct)}
                  </span>
                  <span style={{ textAlign:'right', fontFamily:'monospace',
                    color: isWin ? C.green : C.red }}>
                    {fmtUsd(pnlUsd)}
                  </span>
                </div>
              )
            })}
          </div>
          {hasLegacyTrades && (
            <div style={{ fontSize:9, color:C.muted, marginTop:6, opacity:0.6 }}>
              * Trades cerrados antes de v17 muestran fecha de apertura.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────
function calcPnl(trades) {
  const result = trades.reduce((acc, t) => {
    const entry  = parseFloat(t.entryPrice)
    const exit   = parseFloat(t.exitPrice)
    const shares = parseFloat(t.positionSize)
    acc.invested += entry * shares
    acc.pnlUsd   += (exit - entry) * shares
    return acc
  }, { invested: 0, pnlUsd: 0 })
  result.pnlPct = result.invested > 0 ? result.pnlUsd / result.invested * 100 : null
  return result
}

function dbToTrade(r) {
  return {
    id: r.id, date: r.date, ticker: r.ticker,
    status: r.status,
    entryPrice:   r.entry_price,
    exitPrice:    r.exit_price,
    positionSize: r.position_size,
    stopLoss:     r.stop_loss,
    realStopLoss: r.real_stop_loss,
    price:        r.price,
    exitDate:     r.exit_date || null,
  }
}
