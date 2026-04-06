import { useState, useEffect, useRef, Component } from 'react'
import { supabase } from './supabase.js'
import Auth from './Auth.jsx'
import StockCard from './StockCard.jsx'
import Journal from './Journal.jsx'
import Discover from './Discover.jsx'
import Dashboard from './Dashboard.jsx'

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(e) { return { error: e.message || 'Error desconocido' } }
  componentDidCatch(e, info) { console.error('React crash:', e, info) }
  render() {
    if (this.state.error) return (
      <div style={{ padding:40, textAlign:'center', color:'#ff4060', fontFamily:'Arial' }}>
        <div style={{ fontSize:32, marginBottom:12 }}>!</div>
        <div style={{ fontSize:16, marginBottom:8 }}>Algo salió mal</div>
        <div style={{ fontSize:12, color:'#4a6080', marginBottom:20 }}>{this.state.error}</div>
        <button onClick={() => this.setState({ error: null })}
          style={{ background:'#00d4ff', border:'none', borderRadius:8, padding:'10px 20px', fontWeight:700, cursor:'pointer' }}>
          Reintentar
        </button>
      </div>
    )
    return this.props.children
  }
}

const DEFAULT_WATCHLIST = ['AAPL','MSFT','NVDA','TSLA','AMZN','GOOGL','META','JPM','NFLX','AMD']

const C = {
  bg:'#070d1a', card:'#0f1929', border:'#1a2d45',
  accent:'#00d4ff', green:'#00e096', red:'#ff4060',
  amber:'#ffb800', text:'#dde6f0', muted:'#4a6080',
}

const SIGNAL_LABEL = { buy:'COMPRAR', sell:'VENDER', hold:'ESPERAR', avoid:'EVITAR', monitor:'MONITOREAR' }
const SIGNAL_COLOR = { buy:'#00e096', sell:'#ff4060', hold:'#ffb800', avoid:'#888888', monitor:'#00aaff' }

function WatchlistTable({ tickers, analysisCache, openTrades, lastClosedTrades, onRowClick }) {
  const rows = tickers.map(ticker => {
    const d = analysisCache[ticker]
    return { ticker, d }
  })

  return (
    <div style={{ overflowX:'auto' }}>
      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
        <thead>
          <tr style={{ borderBottom:`1px solid ${C.border}` }}>
            {['Ticker','Precio','Score','Señal','RSI','Zona entrada','Dist. rango','R:B'].map(h => (
              <th key={h} style={{ padding:'8px 10px', textAlign:'left', fontSize:10, color:C.muted, letterSpacing:'0.07em', textTransform:'uppercase', fontWeight:600, whiteSpace:'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ ticker, d }) => {
            const analyzed = d && !d.error
            const signalColor = analyzed ? (SIGNAL_COLOR[d.signal] || C.muted) : C.muted
            const scoreColor  = analyzed ? (d.successRate >= 65 ? C.green : d.successRate >= 45 ? C.amber : C.red) : C.muted
            const rrColor     = analyzed ? (d.rr >= 3 ? C.green : d.rr >= 2.5 ? C.amber : C.red) : C.muted
            const hasActiveTrade = !!openTrades[ticker]

            // Distancia al rango de entrada
            let distLabel = '—'
            let distColor = C.muted
            if (analyzed && d.entryLow && d.entryHigh && d.price) {
              const mid = (d.entryLow + d.entryHigh) / 2
              const pct = ((d.price - mid) / mid * 100)
              if (d.price >= d.entryLow && d.price <= d.entryHigh) {
                distLabel = '● En rango'
                distColor = C.green
              } else if (pct > 0) {
                distLabel = `+${pct.toFixed(1)}% arriba`
                distColor = C.amber
              } else {
                distLabel = `${pct.toFixed(1)}% abajo`
                distColor = C.accent
              }
            }

            return (
              <tr key={ticker}
                onClick={() => onRowClick(ticker)}
                style={{ borderBottom:`1px solid ${C.border}`, cursor:'pointer', transition:'background 0.15s' }}
                onMouseEnter={e => e.currentTarget.style.background = '#1a2d4533'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <td style={{ padding:'10px 10px', fontFamily:'monospace', fontWeight:700, color:C.text, whiteSpace:'nowrap' }}>
                  {ticker}
                  {hasActiveTrade && <span style={{ marginLeft:5, fontSize:9, color:C.green }}>📈</span>}
                </td>
                <td style={{ padding:'10px 10px', fontFamily:'monospace', color:C.text }}>
                  {analyzed ? `$${d.price?.toFixed(2)}` : <span style={{ color:C.muted }}>—</span>}
                </td>
                <td style={{ padding:'10px 10px', fontFamily:'monospace', fontWeight:700, color:scoreColor }}>
                  {analyzed ? d.successRate : <span style={{ color:C.muted }}>—</span>}
                </td>
                <td style={{ padding:'10px 10px' }}>
                  {analyzed
                    ? <span style={{ background: signalColor+'18', color:signalColor, fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:99 }}>
                        {SIGNAL_LABEL[d.signal] || d.signal?.toUpperCase() || '—'}
                      </span>
                    : <span style={{ color:C.muted }}>—</span>}
                </td>
                <td style={{ padding:'10px 10px', fontFamily:'monospace', color: analyzed && d.rsi < 30 ? C.green : analyzed && d.rsi > 70 ? C.red : C.text }}>
                  {analyzed ? d.rsi?.toFixed(0) : <span style={{ color:C.muted }}>—</span>}
                </td>
                <td style={{ padding:'10px 10px', fontFamily:'monospace', color:C.green, fontSize:11 }}>
                  {analyzed && d.entryLow ? `$${d.entryLow?.toFixed(2)}–$${d.entryHigh?.toFixed(2)}` : <span style={{ color:C.muted }}>—</span>}
                </td>
                <td style={{ padding:'10px 10px', fontFamily:'monospace', fontSize:11, color:distColor, whiteSpace:'nowrap' }}>
                  {distLabel}
                </td>
                <td style={{ padding:'10px 10px', fontFamily:'monospace', fontWeight:700, color:rrColor }}>
                  {analyzed ? `${(d.rr||0).toFixed(1)}x` : <span style={{ color:C.muted }}>—</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {rows.every(r => !r.d) && (
        <div style={{ textAlign:'center', padding:'40px', color:C.muted, fontSize:13 }}>
          Analiza los tickers primero para ver la tabla comparativa
        </div>
      )}
    </div>
  )
}

export default function App() {
  const [session,        setSession]        = useState(null)
  const [appLoading,     setAppLoading]     = useState(true)
  const [tab,            setTab]            = useState('dashboard')

  // null = not yet loaded from DB
  const [watchlist,      setWatchlist]      = useState(null)
  const [monitorTickers, setMonitorTickers] = useState(null)

  // Centralised analysis cache: { AAPL: {...data}, MSFT: {...data} }
  const [analysisCache,  setAnalysisCache]  = useState({})

  const [search,         setSearch]         = useState('')
  const [refreshKey,     setRefreshKey]     = useState(0)
  const [saved,          setSaved]          = useState(false)
  const [journalCount,   setJournalCount]   = useState(0)
  const [viewModeWatchlist, setViewModeWatchlist] = useState('cards')  // 'cards' | 'table'
  const [viewModeMonitor,   setViewModeMonitor]   = useState('cards')  // 'cards' | 'table'
  const [tableModal,     setTableModal]     = useState(null)       // ticker string | null
  const saveTimer = useRef(null)
  const dbLoaded  = useRef(false)  // true después de la primera carga desde Supabase

  // ── Auth ──────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setAppLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (!session) {
        setWatchlist(null)
        setMonitorTickers(null)
        setAnalysisCache({})
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  // ── Load from Supabase (single source of truth) ───────────────────────
  useEffect(() => {
    if (!session) return
    dbLoaded.current = false
    supabase.from('watchlist')
      .select('tickers, monitor_tickers')
      .eq('user_id', session.user.id)
      .single()
      .then(({ data, error }) => {
        if (error && error.code !== 'PGRST116') {
          // Error real de red/BD — NO sobrescribir con defaults, dejar null
          // El save useEffect no dispara porque dbLoaded sigue false
          console.error('Supabase watchlist load error:', error)
          return
        }
        // PGRST116 = no existe fila todavía (usuario nuevo) → usar defaults
        setWatchlist(data?.tickers?.length     ? data.tickers         : DEFAULT_WATCHLIST)
        setMonitorTickers(data?.monitor_tickers?.length ? data.monitor_tickers : [])
        dbLoaded.current = true
      })
  }, [session])

  // ── Save to Supabase — debounced, only when both are loaded ───────────
  const saveToSupabase = (tickers, monitorList) => {
    if (!session || tickers === null || monitorList === null) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      await supabase.from('watchlist').upsert({
        user_id:         session.user.id,
        tickers,
        monitor_tickers: monitorList,
        updated_at:      new Date().toISOString()
      }, { onConflict: 'user_id' })
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    }, 800)
  }

  // Trigger save when either list changes (but only after DB load completes)
  useEffect(() => {
    if (watchlist === null || monitorTickers === null) return
    if (!dbLoaded.current) return  // evitar sobrescribir datos reales con el state inicial
    saveToSupabase(watchlist, monitorTickers)
  }, [watchlist, monitorTickers, session]) // eslint-disable-line

  // ── Journal count + open trades + last closed trade ───────────────────
  const [openTrades,       setOpenTrades]       = useState({}) // { AAPL: { entryPrice, id } }
  const [lastClosedTrades, setLastClosedTrades] = useState({}) // { AAPL: { date, exitPrice } }

  useEffect(() => {
    if (!session) return
    const fetchJournal = () => {
      supabase.from('journal')
        .select('id, ticker, entry_price, exit_price, status, date')
        .eq('user_id', session.user.id)
        .order('date', { ascending: false })
        .then(({ data }) => {
          setJournalCount(data?.length || 0)
          const openMap  = {}
          const closedMap = {}
          ;(data || []).forEach(t => {
            if (t.status === 'open' || !t.status) {
              openMap[t.ticker] = { id: t.id, entryPrice: t.entry_price }
            } else if (t.status === 'closed' && !closedMap[t.ticker]) {
              // first occurrence = most recent (ordered desc by date)
              closedMap[t.ticker] = { date: t.date, exitPrice: t.exit_price }
            }
          })
          setOpenTrades(openMap)
          setLastClosedTrades(closedMap)
        })
    }
    fetchJournal()
    const iv = setInterval(fetchJournal, 5000)
    return () => clearInterval(iv)
  }, [session])

  // ── Helpers ───────────────────────────────────────────────────────────
  const wl      = watchlist      || []
  const monitor = monitorTickers || []

  // Listas mutuamente excluyentes — un ticker solo puede estar en una
  const activeWatchlist  = wl.filter(t => !monitor.includes(t))
  const monitorWatchlist = monitor  // monitor es lista independiente

  const add = () => {
    const t = search.trim().toUpperCase().replace(/[^A-Z.]/g, '')
    if (t && !wl.includes(t) && !monitor.includes(t)) { setWatchlist(p => [t, ...(p||[])]); setSearch('') }
  }

  const removeFromAll = (ticker) => {
    setWatchlist(p => (p||[]).filter(v => v !== ticker))
    setMonitorTickers(p => (p||[]).filter(v => v !== ticker))
  }

  // Mover a seguimiento: sale de watchlist, entra en monitor
  const moveToMonitor = (ticker) => {
    setWatchlist(p => (p||[]).filter(v => v !== ticker))
    if (!monitor.includes(ticker)) setMonitorTickers(p => [...(p||[]), ticker])
  }

  // Quitar de seguimiento: vuelve a watchlist
  const removeFromMonitor = (ticker) => {
    setMonitorTickers(p => (p||[]).filter(v => v !== ticker))
    if (!wl.includes(ticker)) setWatchlist(p => [ticker, ...(p||[])])
  }

  // Cache analysis data from StockCard
  const cacheAnalysis = (ticker, data) => {
    setAnalysisCache(prev => ({ ...prev, [ticker]: data }))
  }

  const signOut = async () => { await supabase.auth.signOut() }

  if (appLoading) return (
    <div style={{ minHeight:'100vh', background:C.bg, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ color:C.muted, fontSize:14 }}>Cargando...</div>
    </div>
  )
  if (!session) return <Auth />

  const tabs = [
    ['dashboard', 'Dashboard'],
    ['watchlist', `Watchlist · ${activeWatchlist.length}`],
    ['monitor',   monitorWatchlist.length > 0 ? `En Seguimiento · ${monitorWatchlist.length}` : 'En Seguimiento'],
    ['discover',  'Screener'],
    ['journal',   `Journal · ${journalCount}`],
  ]

  const isLoaded = watchlist !== null && monitorTickers !== null

  return (
    <div style={{ paddingBottom:48 }}>
      {/* Header */}
      <div style={{ background:'linear-gradient(180deg,#0c1828 0%,#070d1a 100%)', padding:'22px 20px 0', borderBottom:`1px solid ${C.border}` }}>
        <div style={{ maxWidth:960, margin:'0 auto' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:5 }}>
            <div style={{ display:'flex', alignItems:'center', gap:7 }}>
              <div style={{ width:7, height:7, borderRadius:'50%', background:C.green }}/>
              <span style={{ fontSize:10, color:C.green, letterSpacing:'0.12em' }}>LIVE · DATOS REALES DE MERCADO</span>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              {saved && <span style={{ fontSize:10, color:C.green }}>✓ Guardado</span>}
              <span style={{ fontSize:11, color:C.muted }}>{session.user.email}</span>
              <button onClick={signOut}
                style={{ background:'none', border:`1px solid ${C.border}`, borderRadius:6, color:C.muted, padding:'3px 9px', cursor:'pointer', fontSize:10 }}>
                Salir
              </button>
            </div>
          </div>

          <div style={{ display:'flex', alignItems:'baseline', gap:10, marginBottom: tab==='watchlist' ? 14 : 10 }}>
            <h1 style={{ fontSize:22, fontWeight:700, letterSpacing:'-0.02em' }}>Swing Trading Agent</h1>
            <span style={{ fontSize:11, color:C.muted }}>NYSE / NASDAQ</span>
          </div>

          {tab === 'watchlist' && (
            <div style={{ display:'flex', gap:7, marginBottom:14 }}>
              <input value={search} onChange={e => setSearch(e.target.value.toUpperCase())}
                onKeyDown={e => e.key==='Enter' && add()}
                placeholder="Agregar ticker… ej: COIN, PLTR, SOFI"
                style={{ flex:1, background:'#0f1929', border:`1px solid ${C.border}`, borderRadius:9, padding:'10px 14px', color:C.text, fontSize:13, outline:'none' }}
                onFocus={e => e.target.style.borderColor=C.accent}
                onBlur={e  => e.target.style.borderColor=C.border}
              />
              <button onClick={add}
                style={{ background:C.accent, border:'none', borderRadius:9, color:'#000', fontWeight:700, padding:'10px 16px', cursor:'pointer', fontSize:13 }}>
                + Agregar
              </button>
              <button onClick={() => { setAnalysisCache({}); setRefreshKey(k=>k+1) }}
                style={{ background:'none', border:`1px solid ${C.border}`, borderRadius:9, color:C.muted, padding:'10px 13px', cursor:'pointer', fontSize:13 }}>
                ↻
              </button>
              <button onClick={() => setViewModeWatchlist(v => v === 'cards' ? 'table' : 'cards')}
                title={viewModeWatchlist === 'cards' ? 'Ver tabla' : 'Ver tarjetas'}
                style={{ background: viewModeWatchlist === 'table' ? C.accent+'22' : 'none',
                  border:`1px solid ${viewModeWatchlist === 'table' ? C.accent : C.border}`,
                  borderRadius:9, color: viewModeWatchlist === 'table' ? C.accent : C.muted,
                  padding:'10px 13px', cursor:'pointer', fontSize:13 }}>
                {viewModeWatchlist === 'cards' ? '☰' : '⊞'}
              </button>
            </div>
          )}

          {/* Tabs */}
          <div style={{ display:'flex', borderTop:`1px solid ${C.border}` }}>
            {tabs.map(([key, label]) => (
              <button key={key} onClick={() => setTab(key)}
                style={{ background:'none', border:'none',
                  borderBottom: tab===key ? `2px solid ${key==='monitor' ? '#00aaff' : C.accent}` : '2px solid transparent',
                  color: tab===key ? (key==='monitor' ? '#00aaff' : C.accent) : C.muted,
                  padding:'10px 18px', cursor:'pointer', fontSize:12, fontWeight: tab===key ? 700 : 400,
                  display:'flex', alignItems:'center', gap:5 }}>
                {key === 'monitor' && monitor.length > 0 &&
                  <span style={{ width:6, height:6, borderRadius:'50%', background:'#00aaff', display:'inline-block' }}/>}
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ marginTop:20 }}>

        {/* Dashboard */}
        {tab === 'dashboard' && (
          <ErrorBoundary>
            <Dashboard session={session} />
          </ErrorBoundary>
        )}

        {/* Watchlist activa — display:none para preservar estado */}
        <div style={{ display: tab === 'watchlist' ? 'block' : 'none' }}>
          <div style={{ maxWidth:960, margin:'0 auto', padding:'0 20px' }}>
            {!isLoaded ? (
              <div style={{ textAlign:'center', padding:'60px', color:C.muted, fontSize:13 }}>Cargando watchlist...</div>
            ) : (
              <>
                {viewModeWatchlist === 'table' ? (
                  <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12 }}>
                    <WatchlistTable
                      tickers={activeWatchlist}
                      analysisCache={analysisCache}
                      openTrades={openTrades}
                      lastClosedTrades={lastClosedTrades}
                      onRowClick={setTableModal}
                    />
                  </div>
                ) : (
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(268px, 1fr))', gap:11 }}>
                    {activeWatchlist.map(t => (
                      <ErrorBoundary key={`${t}-${refreshKey}`}>
                        <StockCard
                          ticker={t}
                          session={session}
                          cachedData={analysisCache[t] || null}
                          onAnalysed={cacheAnalysis}
                          onRemove={removeFromAll}
                          onMonitor={moveToMonitor}
                          activeTrade={openTrades[t] || null}
                          lastClosedTrade={!openTrades[t] ? (lastClosedTrades[t] || null) : null}
                        />
                      </ErrorBoundary>
                    ))}
                  </div>
                )}
                {activeWatchlist.length === 0 && wl.length === 0 && (
                  <div style={{ textAlign:'center', padding:'60px', color:C.muted, fontSize:14 }}>
                    Agrega tickers con el buscador de arriba
                  </div>
                )}
                <div style={{ marginTop:18, padding:'12px 14px', background:C.card, borderRadius:9, border:`1px solid ${C.border}`, fontSize:11, color:C.muted }}>
                  <b style={{ color:C.amber }}>Aviso:</b> Análisis orientativo. No constituye asesoría financiera.
                </div>
              </>
            )}
          </div>
        </div>

        {/* En Seguimiento — display:none para preservar estado */}
        <div style={{ display: tab === 'monitor' ? 'block' : 'none' }}>
          <div style={{ maxWidth:960, margin:'0 auto', padding:'0 20px' }}>
            {!isLoaded ? (
              <div style={{ textAlign:'center', padding:'60px', color:C.muted, fontSize:13 }}>Cargando...</div>
            ) : monitor.length === 0 ? (
              <div style={{ textAlign:'center', padding:'60px', color:C.muted }}>
                <div style={{ fontSize:28, marginBottom:12 }}>👁</div>
                <div style={{ fontSize:14, marginBottom:6 }}>No hay acciones en seguimiento</div>
                <div style={{ fontSize:11 }}>Cuando una acción tenga buenas condiciones pero no sea el momento de entrar, aparecerá aquí.</div>
              </div>
            ) : (
              <>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
                  <div style={{ padding:'10px 14px', background:'#001a2a', border:'1px solid #00aaff33', borderRadius:9, fontSize:11, color:'#4a8080', flex:1 }}>
                    Acciones con buenas condiciones técnicas esperando el momento de entrada. Re-analiza después del evento.
                  </div>
                  <button onClick={() => setViewModeMonitor(v => v === 'cards' ? 'table' : 'cards')}
                    title={viewModeMonitor === 'cards' ? 'Ver tabla' : 'Ver tarjetas'}
                    style={{ marginLeft:10, background: viewModeMonitor === 'table' ? C.accent+'22' : 'none',
                      border:`1px solid ${viewModeMonitor === 'table' ? C.accent : C.border}`,
                      borderRadius:9, color: viewModeMonitor === 'table' ? C.accent : C.muted,
                      padding:'10px 13px', cursor:'pointer', fontSize:13, flexShrink:0 }}>
                    {viewModeMonitor === 'cards' ? '☰' : '⊞'}
                  </button>
                </div>
                {viewModeMonitor === 'table' ? (
                  <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12 }}>
                    <WatchlistTable
                      tickers={monitorWatchlist}
                      analysisCache={analysisCache}
                      openTrades={openTrades}
                      lastClosedTrades={lastClosedTrades}
                      onRowClick={setTableModal}
                    />
                  </div>
                ) : (
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(268px, 1fr))', gap:11 }}>
                    {monitorWatchlist.map(t => (
                      <ErrorBoundary key={`${t}-${refreshKey}`}>
                        <StockCard
                          ticker={t}
                          session={session}
                          cachedData={analysisCache[t] || null}
                          onAnalysed={cacheAnalysis}
                          onRemove={removeFromAll}
                          onMonitor={removeFromMonitor}
                          isInMonitorTab={true}
                          activeTrade={openTrades[t] || null}
                          lastClosedTrade={!openTrades[t] ? (lastClosedTrades[t] || null) : null}
                        />
                      </ErrorBoundary>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Descubrir */}
        <div style={{ display: tab === 'discover' ? 'block' : 'none' }}>
          <ErrorBoundary>
            <Discover
              watchlist={wl}
              monitorList={monitor}
              openTrades={openTrades}
              onAdd={ticker => {
                if (!wl.includes(ticker) && !monitor.includes(ticker)) setWatchlist(p => [ticker, ...(p||[])])
              }}
              onRemove={ticker => {
                setWatchlist(p => (p||[]).filter(t => t !== ticker))
              }}
              onAddAll={tickers => {
                setWatchlist(p => {
                  const existing = p || []
                  const toAdd = tickers.filter(t => !existing.includes(t) && !monitor.includes(t))
                  return [...toAdd, ...existing]
                })
              }}
            />
          </ErrorBoundary>
        </div>

        {/* Journal */}
        {tab === 'journal' && (
          <ErrorBoundary>
            <Journal session={session} />
          </ErrorBoundary>
        )}
      </div>

      {/* Modal StockCard desde tabla */}
      {tableModal && (
        <div onClick={() => setTableModal(null)}
          style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:2000,
            display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'40px 16px', overflowY:'auto' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width:'100%', maxWidth:380 }}>
            <ErrorBoundary>
              <StockCard
                ticker={tableModal}
                session={session}
                cachedData={analysisCache[tableModal] || null}
                onAnalysed={cacheAnalysis}
                onRemove={t => { removeFromAll(t); setTableModal(null) }}
                onMonitor={tab === 'monitor' ? t => { removeFromMonitor(t); setTableModal(null) } : t => { moveToMonitor(t); setTableModal(null) }}
                isInMonitorTab={tab === 'monitor'}
                activeTrade={openTrades[tableModal] || null}
                lastClosedTrade={!openTrades[tableModal] ? (lastClosedTrades[tableModal] || null) : null}
                hideRemove
              />
            </ErrorBoundary>
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
