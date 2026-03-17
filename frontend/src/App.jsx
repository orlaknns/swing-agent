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
  const [session,      setSession]      = useState(null)
  const [loading,      setLoading]      = useState(true)
  const [tab,          setTab]          = useState('watchlist')
  const [watchlist,    setWatchlist]    = useState(DEFAULT_WATCHLIST)
  const [search,       setSearch]       = useState('')
  const [refreshKey,   setRefreshKey]   = useState(0)
  const [monitorTickers, setMonitorTickers] = useState([])
  const [saved,        setSaved]        = useState(false)
  const [journalCount, setJournalCount] = useState(0)

  // FIX #3: flag para no guardar hasta que hayamos cargado de Supabase
  const loadedFromDB = useRef(false)

  // Auth listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session); setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      // Reset flag on session change so we reload
      loadedFromDB.current = false
    })
    return () => subscription.unsubscribe()
  }, [])

  // Load watchlist from Supabase
  useEffect(() => {
    if (!session) return
    supabase.from('watchlist').select('tickers').eq('user_id', session.user.id).single()
      .then(({ data }) => {
        if (data?.tickers?.length) setWatchlist(data.tickers)
        // Mark as loaded regardless — even if no data, don't overwrite with default
        loadedFromDB.current = true
      })
      .catch(() => {
        // Error loading — still mark as loaded to allow future saves
        loadedFromDB.current = true
      })
  }, [session])

  // Save watchlist — only after loading from DB
  useEffect(() => {
    if (!session || !loadedFromDB.current) return
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

  const add = () => {
    const t = search.trim().toUpperCase().replace(/[^A-Z.]/g, '')
    if (t && !watchlist.includes(t)) { setWatchlist(p => [t, ...p]); setSearch('') }
  }

  const signOut = async () => { await supabase.auth.signOut() }

  if (loading) return (
    <div style={{ minHeight:'100vh', background:C.bg, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ color:C.muted, fontSize:14 }}>Cargando...</div>
    </div>
  )

  if (!session) return <Auth />

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
            {[['watchlist',`Watchlist · ${watchlist.length}`], ['discover','Descubrir'], ['journal',`Journal · ${journalCount}`]].map(([key, label]) => (
              <button key={key} onClick={() => setTab(key)}
                style={{ background:'none', border:'none', borderBottom: tab===key ? `2px solid ${C.accent}` : '2px solid transparent',
                  color: tab===key ? C.accent : C.muted, padding:'10px 18px', cursor:'pointer', fontSize:12, fontWeight: tab===key ? 700 : 400 }}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content — FIX #2: usar display:none en vez de desmontar */}
      <div style={{ marginTop:20 }}>

        {/* Watchlist — siempre montada, solo se oculta */}
        <div style={{ display: tab === 'watchlist' ? 'block' : 'none' }}>
          <div style={{ maxWidth:960, margin:'0 auto', padding:'0 20px' }}>

            {/* Tarjetas activas */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(268px, 1fr))', gap:11 }}>
              {watchlist.filter(t => !monitorTickers.includes(t)).map(t => (
                <ErrorBoundary key={`${t}-${refreshKey}`}>
                  <StockCard ticker={t} session={session}
                    onRemove={x => setWatchlist(p => p.filter(v=>v!==x))}
                    onSignal={(ticker, signal) => {
                      if (signal === 'monitor') setMonitorTickers(p => p.includes(ticker) ? p : [...p, ticker])
                      else setMonitorTickers(p => p.filter(v => v !== ticker))
                    }}
                  />
                </ErrorBoundary>
              ))}
            </div>

            {/* Sección En seguimiento */}
            {monitorTickers.length > 0 && (
              <div style={{ marginTop:24 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12 }}>
                  <div style={{ width:8, height:8, borderRadius:'50%', background:'#00aaff', animation:'pulse 2s infinite' }}/>
                  <span style={{ fontSize:12, fontWeight:700, color:'#00aaff', letterSpacing:'0.08em' }}>
                    EN SEGUIMIENTO — {monitorTickers.length} acción{monitorTickers.length !== 1 ? 'es' : ''}
                  </span>
                  <span style={{ fontSize:10, color:C.muted }}>· Buenas condiciones técnicas, esperando el momento de entrada</span>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(268px, 1fr))', gap:11 }}>
                  {monitorTickers.map(t => (
                    <ErrorBoundary key={`${t}-${refreshKey}`}>
                      <StockCard ticker={t} session={session}
                        onRemove={x => { setWatchlist(p => p.filter(v=>v!==x)); setMonitorTickers(p => p.filter(v=>v!==x)) }}
                        onSignal={(ticker, signal) => {
                          if (signal !== 'monitor') setMonitorTickers(p => p.filter(v => v !== ticker))
                        }}
                      />
                    </ErrorBoundary>
                  ))}
                </div>
              </div>
            )}

            {watchlist.length === 0 && (
              <div style={{ textAlign:'center', padding:'60px', color:C.muted, fontSize:14 }}>
                Agrega tickers con el buscador de arriba
              </div>
            )}
            <div style={{ marginTop:18, padding:'12px 14px', background:C.card, borderRadius:9, border:`1px solid ${C.border}`, fontSize:11, color:C.muted }}>
              <b style={{ color:C.amber }}>Aviso:</b> Análisis orientativo. No constituye asesoría financiera.
            </div>
          </div>
        </div>

        {/* Descubrir — FIX #1: no redirige al agregar */}
        <div style={{ display: tab === 'discover' ? 'block' : 'none' }}>
          <ErrorBoundary>
            <Discover
              watchlist={watchlist}
              onAdd={ticker => {
                if (!watchlist.includes(ticker)) {
                  setWatchlist(p => [ticker, ...p])
                  // FIX #1: no cambia de pestaña — el usuario sigue en Descubrir
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
