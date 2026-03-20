import { useState, useEffect, useRef, Component } from 'react'
import { supabase } from './supabase.js'
import Auth from './Auth.jsx'
import StockCard from './StockCard.jsx'
import Journal from './Journal.jsx'
import Discover from './Discover.jsx'

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

export default function App() {
  const [session,        setSession]        = useState(null)
  const [appLoading,     setAppLoading]     = useState(true)
  const [tab,            setTab]            = useState('watchlist')

  // null = not yet loaded from DB
  const [watchlist,      setWatchlist]      = useState(null)
  const [monitorTickers, setMonitorTickers] = useState(null)

  // Centralised analysis cache: { AAPL: {...data}, MSFT: {...data} }
  const [analysisCache,  setAnalysisCache]  = useState({})

  const [search,         setSearch]         = useState('')
  const [refreshKey,     setRefreshKey]     = useState(0)
  const [saved,          setSaved]          = useState(false)
  const [journalCount,   setJournalCount]   = useState(0)
  const saveTimer = useRef(null)

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
    supabase.from('watchlist')
      .select('tickers, monitor_tickers')
      .eq('user_id', session.user.id)
      .single()
      .then(({ data }) => {
        setWatchlist(data?.tickers?.length     ? data.tickers         : DEFAULT_WATCHLIST)
        setMonitorTickers(data?.monitor_tickers?.length ? data.monitor_tickers : [])
      })
      .catch(() => {
        setWatchlist(DEFAULT_WATCHLIST)
        setMonitorTickers([])
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

  // Trigger save when either list changes (but only after both loaded)
  useEffect(() => {
    if (watchlist === null || monitorTickers === null) return
    saveToSupabase(watchlist, monitorTickers)
  }, [watchlist, monitorTickers, session]) // eslint-disable-line

  // ── Journal count ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!session) return
    const fetchCount = () =>
      supabase.from('journal').select('id', { count:'exact' }).eq('user_id', session.user.id)
        .then(({ count }) => setJournalCount(count || 0))
    fetchCount()
    const iv = setInterval(fetchCount, 5000)
    return () => clearInterval(iv)
  }, [session])

  // ── Helpers ───────────────────────────────────────────────────────────
  const wl      = watchlist      || []
  const monitor = monitorTickers || []

  const activeWatchlist  = wl.filter(t => !monitor.includes(t))
  const monitorWatchlist = wl.filter(t =>  monitor.includes(t))

  const add = () => {
    const t = search.trim().toUpperCase().replace(/[^A-Z.]/g, '')
    if (t && !wl.includes(t)) { setWatchlist(p => [t, ...(p||[])]); setSearch('') }
  }

  const removeFromAll = (ticker) => {
    setWatchlist(p => (p||[]).filter(v => v !== ticker))
    setMonitorTickers(p => (p||[]).filter(v => v !== ticker))
  }

  const moveToMonitor = (ticker) => {
    if (!monitor.includes(ticker)) setMonitorTickers(p => [...(p||[]), ticker])
  }

  const removeFromMonitor = (ticker) => {
    setMonitorTickers(p => (p||[]).filter(v => v !== ticker))
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
    ['watchlist', `Watchlist · ${wl.length}`],
    ['monitor',   monitor.length > 0 ? `En Seguimiento · ${monitor.length}` : 'En Seguimiento'],
    ['discover',  'Descubrir'],
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

        {/* Watchlist activa — display:none para preservar estado */}
        <div style={{ display: tab === 'watchlist' ? 'block' : 'none' }}>
          <div style={{ maxWidth:960, margin:'0 auto', padding:'0 20px' }}>
            {!isLoaded ? (
              <div style={{ textAlign:'center', padding:'60px', color:C.muted, fontSize:13 }}>Cargando watchlist...</div>
            ) : (
              <>
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
                      />
                    </ErrorBoundary>
                  ))}
                </div>
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
                <div style={{ marginBottom:14, padding:'10px 14px', background:'#001a2a', border:'1px solid #00aaff33', borderRadius:9, fontSize:11, color:'#4a8080' }}>
                  Acciones con buenas condiciones técnicas esperando el momento de entrada. Re-analiza después del evento.
                </div>
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
                      />
                    </ErrorBoundary>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Descubrir */}
        <div style={{ display: tab === 'discover' ? 'block' : 'none' }}>
          <ErrorBoundary>
            <Discover
              watchlist={wl}
              onAdd={ticker => {
                if (!wl.includes(ticker)) setWatchlist(p => [ticker, ...(p||[])])
              }}
              onRemove={ticker => {
                setWatchlist(p => (p||[]).filter(t => t !== ticker))
              }}
              onAddAll={tickers => {
                setWatchlist(p => {
                  const existing = p || []
                  const toAdd = tickers.filter(t => !existing.includes(t))
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
    </div>
  )
}
