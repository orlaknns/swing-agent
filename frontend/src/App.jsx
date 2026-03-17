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
  const [loading,        setLoading]        = useState(true)
  const [tab,            setTab]            = useState('watchlist')
  // FIX: null = not yet loaded from DB, prevents premature save
  const [watchlist,      setWatchlist]      = useState(null)
  const [monitorTickers, setMonitorTickers] = useState([])
  const [search,         setSearch]         = useState('')
  const [refreshKey,     setRefreshKey]     = useState(0)
  const [saved,          setSaved]          = useState(false)
  const [journalCount,   setJournalCount]   = useState(0)

  // Auth listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session); setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setWatchlist(null) // reset on session change — will reload from DB
    })
    return () => subscription.unsubscribe()
  }, [])

  // Load watchlist from Supabase — sets watchlist (possibly to DEFAULT if no data)
  useEffect(() => {
    if (!session) return
    supabase.from('watchlist').select('tickers').eq('user_id', session.user.id).single()
      .then(({ data }) => {
        setWatchlist(data?.tickers?.length ? data.tickers : DEFAULT_WATCHLIST)
      })
      .catch(() => {
        setWatchlist(DEFAULT_WATCHLIST)
      })
  }, [session])

  // Save watchlist — only when watchlist is non-null (i.e. loaded from DB)
  useEffect(() => {
    if (!session || watchlist === null) return
    const save = async () => {
      await supabase.from('watchlist').upsert({
        user_id: session.user.id,
        tickers: watchlist,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' })
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    }
    const t = setTimeout(save, 800)
    return () => clearTimeout(t)
  }, [watchlist, session])

  // Journal count
  useEffect(() => {
    if (!session) return
    const fetchCount = () => {
      supabase.from('journal').select('id', { count:'exact' }).eq('user_id', session.user.id)
        .then(({ count }) => setJournalCount(count || 0))
    }
    fetchCount()
    const interval = setInterval(fetchCount, 3000)
    return () => clearInterval(interval)
  }, [session])

  const activeWatchlist  = (watchlist || []).filter(t => !monitorTickers.includes(t))
  const monitorWatchlist = (watchlist || []).filter(t => monitorTickers.includes(t))

  const add = () => {
    const t = search.trim().toUpperCase().replace(/[^A-Z.]/g, '')
    if (t && watchlist && !watchlist.includes(t)) {
      setWatchlist(p => [t, ...p]); setSearch('')
    }
  }

  const signOut = async () => { await supabase.auth.signOut() }

  if (loading) return (
    <div style={{ minHeight:'100vh', background:C.bg, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ color:C.muted, fontSize:14 }}>Cargando...</div>
    </div>
  )

  if (!session) return <Auth />

  // Tabs: Watchlist · En Seguimiento · Descubrir · Journal
  const tabs = [
    ['watchlist', `Watchlist · ${(watchlist||[]).length}`],
    ...(monitorTickers.length > 0 ? [['monitor', `En Seguimiento · ${monitorTickers.length}`]] : []),
    ['discover', 'Descubrir'],
    ['journal',  `Journal · ${journalCount}`],
  ]

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
              <button onClick={() => setRefreshKey(k=>k+1)}
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
                {key === 'monitor' && <span style={{ width:6, height:6, borderRadius:'50%', background:'#00aaff', display:'inline-block' }}/>}
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ marginTop:20 }}>

        {/* Watchlist activa */}
        <div style={{ display: tab === 'watchlist' ? 'block' : 'none' }}>
          <div style={{ maxWidth:960, margin:'0 auto', padding:'0 20px' }}>
            {watchlist === null ? (
              <div style={{ textAlign:'center', padding:'60px', color:C.muted, fontSize:13 }}>Cargando watchlist...</div>
            ) : (
              <>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(268px, 1fr))', gap:11 }}>
                  {activeWatchlist.map(t => (
                    <ErrorBoundary key={`${t}-${refreshKey}`}>
                      <StockCard ticker={t} session={session}
                        onRemove={x => setWatchlist(p => p.filter(v=>v!==x))}
                        onMonitor={(ticker, isMonitor) => {
                          // FIX 1: usuario decide manualmente si mover a seguimiento
                          // onMonitor solo se llama desde botón explícito en StockCard
                          if (isMonitor) setMonitorTickers(p => p.includes(ticker) ? p : [...p, ticker])
                          else setMonitorTickers(p => p.filter(v => v !== ticker))
                        }}
                      />
                    </ErrorBoundary>
                  ))}
                </div>
                {activeWatchlist.length === 0 && watchlist.length === 0 && (
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

        {/* En Seguimiento */}
        <div style={{ display: tab === 'monitor' ? 'block' : 'none' }}>
          <div style={{ maxWidth:960, margin:'0 auto', padding:'0 20px' }}>
            <div style={{ marginBottom:14, padding:'10px 14px', background:'#001a2a', border:'1px solid #00aaff33', borderRadius:9, fontSize:11, color:'#4a8080' }}>
              Acciones con buenas condiciones técnicas que estás esperando para entrar. Re-analiza después del evento para ver si la señal cambió.
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(268px, 1fr))', gap:11 }}>
              {monitorWatchlist.map(t => (
                <ErrorBoundary key={`${t}-${refreshKey}`}>
                  <StockCard ticker={t} session={session}
                    onRemove={x => { setWatchlist(p => p.filter(v=>v!==x)); setMonitorTickers(p => p.filter(v=>v!==x)) }}
                    onMonitor={(ticker, isMonitor) => {
                      if (!isMonitor) setMonitorTickers(p => p.filter(v => v !== ticker))
                    }}
                  />
                </ErrorBoundary>
              ))}
            </div>
            {monitorWatchlist.length === 0 && (
              <div style={{ textAlign:'center', padding:'60px', color:C.muted, fontSize:14 }}>
                No hay acciones en seguimiento
              </div>
            )}
          </div>
        </div>

        {/* Descubrir */}
        <div style={{ display: tab === 'discover' ? 'block' : 'none' }}>
          <ErrorBoundary>
            <Discover
              watchlist={watchlist || []}
              onAdd={ticker => {
                if (watchlist && !watchlist.includes(ticker)) {
                  setWatchlist(p => [ticker, ...p])
                }
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
