import { useState, useEffect } from 'react'
import { supabase } from './supabase.js'

const C = {
  bg:'#070d1a', card:'#0f1929', border:'#1a2d45',
  accent:'#00d4ff', green:'#00e096', red:'#ff4060',
  amber:'#ffb800', text:'#dde6f0', muted:'#4a6080',
}

function fmt(n, decimals = 2) {
  if (n == null) return '—'
  return `$${Number(n).toFixed(decimals)}`
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
      fontWeight:700, marginBottom:10, paddingBottom:6, borderBottom:`1px solid ${C.border}` }}>
      {title}
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

  // ── Cálculos ──────────────────────────────────────────────────────────
  const now = new Date()
  const thisMonth = now.toISOString().slice(0, 7) // "2026-04"

  const openTrades   = trades.filter(t => ['open','breakeven','partial'].includes(t.status))
  const closedTrades = trades.filter(t => t.status === 'closed')
  const closedWithData = closedTrades.filter(t => t.exitPrice && t.entryPrice && t.positionSize)

  // Cerradas este mes
  const closedThisMonth = closedWithData.filter(t => t.date?.startsWith(thisMonth))
  // Abiertas este mes
  const openThisMonth = openTrades.filter(t => t.date?.startsWith(thisMonth))

  // P&L total cerradas
  const totalStats = calcPnl(closedWithData)
  // P&L cerradas este mes
  const monthStats = calcPnl(closedThisMonth)

  // Capital en riesgo (operaciones abiertas con stop y entrada real)
  const capitalRisk = openTrades.reduce((acc, t) => {
    const entry = parseFloat(t.entryPrice || 0)
    const stop  = parseFloat(t.realStopLoss || t.stopLoss || 0)
    const shares = parseFloat(t.positionSize || 0)
    if (entry > 0 && stop > 0 && shares > 0) acc += (entry - stop) * shares
    return acc
  }, 0)

  // Inversión actual abierta
  const openInvested = openTrades.reduce((acc, t) => {
    const entry  = parseFloat(t.entryPrice || 0)
    const shares = parseFloat(t.positionSize || 0)
    return acc + entry * shares
  }, 0)

  // Win rate total y mensual
  const wins  = closedWithData.filter(t => parseFloat(t.exitPrice) > parseFloat(t.entryPrice)).length
  const winRate = closedWithData.length > 0 ? Math.round(wins / closedWithData.length * 100) : null
  const winsMonth = closedThisMonth.filter(t => parseFloat(t.exitPrice) > parseFloat(t.entryPrice)).length
  const winRateMonth = closedThisMonth.length > 0 ? Math.round(winsMonth / closedThisMonth.length * 100) : null

  // ── Últimas 10 cerradas ───────────────────────────────────────────────
  const recentClosed = closedWithData.slice(0, 10)

  const monthName = now.toLocaleString('es', { month:'long', year:'numeric' })

  return (
    <div style={{ maxWidth:960, margin:'0 auto', padding:'0 20px 48px' }}>

      <div style={{ marginBottom:20 }}>
        <h2 style={{ fontSize:18, fontWeight:700, color:C.text, margin:0 }}>Dashboard</h2>
        <p style={{ fontSize:11, color:C.muted, margin:'4px 0 0' }}>Resumen de tu actividad de trading</p>
      </div>

      {/* ── SECCIÓN: POSICIONES ABIERTAS ─────────────────────────────── */}
      <div style={{ marginBottom:24 }}>
        <SectionHeader title="Posiciones abiertas" />
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(160px, 1fr))', gap:8 }}>
          <StatCard label="Posiciones abiertas" value={openTrades.length} color={C.accent} />
          <StatCard label="Abiertas este mes" value={openThisMonth.length} color={C.accent} />
          <StatCard
            label="Capital invertido"
            value={openInvested > 0 ? `$${(openInvested/1000).toFixed(1)}k` : '—'}
            color={C.text}
          />
          <StatCard
            label="Capital en riesgo"
            value={capitalRisk > 0 ? fmtUsd(-capitalRisk) : '—'}
            color={capitalRisk > 0 ? C.red : C.muted}
            sub="si todos los SL se activan"
          />
        </div>
      </div>

      {/* ── SECCIÓN: HISTÓRICO TOTAL ──────────────────────────────────── */}
      <div style={{ marginBottom:24 }}>
        <SectionHeader title={`Total histórico · ${closedWithData.length} operaciones cerradas`} />
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(160px, 1fr))', gap:8 }}>
          <StatCard label="Operaciones cerradas" value={closedTrades.length} color={C.muted} />
          <StatCard label="Win rate" value={winRate != null ? `${winRate}%` : '—'} color={winRate >= 50 ? C.green : winRate != null ? C.red : C.muted} sub={`${wins} ganadoras de ${closedWithData.length}`} />
          <StatCard
            label="Total invertido"
            value={totalStats.invested > 0 ? `$${(totalStats.invested/1000).toFixed(1)}k` : '—'}
            color={C.text}
          />
          <StatCard
            label="P&L Total USD"
            value={totalStats.invested > 0 ? fmtUsd(totalStats.pnlUsd) : '—'}
            color={totalStats.pnlUsd >= 0 ? C.green : C.red}
          />
          <StatCard
            label="P&L Total %"
            value={totalStats.pnlPct != null ? fmtPct(totalStats.pnlPct) : '—'}
            color={totalStats.pnlPct >= 0 ? C.green : C.red}
            sub="sobre capital invertido"
          />
        </div>
      </div>

      {/* ── SECCIÓN: ESTE MES ─────────────────────────────────────────── */}
      <div style={{ marginBottom:24 }}>
        <SectionHeader title={`Este mes · ${monthName} · ${closedThisMonth.length} cerradas`} />
        {closedThisMonth.length === 0 ? (
          <div style={{ fontSize:12, color:C.muted, padding:'12px 0' }}>Sin operaciones cerradas este mes todavía.</div>
        ) : (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(160px, 1fr))', gap:8 }}>
            <StatCard label="Cerradas" value={closedThisMonth.length} color={C.muted} />
            <StatCard label="Win rate" value={winRateMonth != null ? `${winRateMonth}%` : '—'} color={winRateMonth >= 50 ? C.green : winRateMonth != null ? C.red : C.muted} sub={`${winsMonth} ganadoras`} />
            <StatCard
              label="P&L USD"
              value={monthStats.invested > 0 ? fmtUsd(monthStats.pnlUsd) : '—'}
              color={monthStats.pnlUsd >= 0 ? C.green : C.red}
            />
            <StatCard
              label="P&L %"
              value={monthStats.pnlPct != null ? fmtPct(monthStats.pnlPct) : '—'}
              color={monthStats.pnlPct >= 0 ? C.green : C.red}
              sub="sobre capital invertido"
            />
          </div>
        )}
      </div>

      {/* ── SECCIÓN: ÚLTIMAS OPERACIONES CERRADAS ────────────────────── */}
      {recentClosed.length > 0 && (
        <div>
          <SectionHeader title="Últimas operaciones cerradas" />
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            {recentClosed.map(t => {
              const entry  = parseFloat(t.entryPrice)
              const exit   = parseFloat(t.exitPrice)
              const shares = parseFloat(t.positionSize)
              const pnlPct = ((exit - entry) / entry * 100)
              const pnlUsd = (exit - entry) * shares
              const isWin  = exit > entry
              return (
                <div key={t.id} style={{
                  background:C.card, borderRadius:8, padding:'10px 14px',
                  border:`1px solid ${C.border}`,
                  borderLeft:`3px solid ${isWin ? C.green : C.red}`,
                  display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8
                }}>
                  <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
                    <span style={{ fontSize:15, fontWeight:700, fontFamily:'monospace', color:C.text }}>{t.ticker}</span>
                    <span style={{ fontSize:10, color:C.muted }}>{t.date}</span>
                    <span style={{ fontSize:10, color:C.muted }}>
                      {fmt(t.entryPrice)} → {fmt(t.exitPrice)}
                      {shares > 0 && <span style={{ marginLeft:6 }}>{shares} acc.</span>}
                    </span>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontSize:14, fontWeight:700, fontFamily:'monospace', color: isWin ? C.green : C.red }}>
                      {fmtPct(pnlPct)}
                    </div>
                    <div style={{ fontSize:11, fontFamily:'monospace', color: isWin ? C.green : C.red }}>
                      {fmtUsd(pnlUsd)}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
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
    entryPrice:  r.entry_price,
    exitPrice:   r.exit_price,
    positionSize: r.position_size,
    stopLoss:    r.stop_loss,
    realStopLoss: r.real_stop_loss,
    price: r.price,
  }
}
