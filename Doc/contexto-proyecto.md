# KNNS TradeAgent — Contexto del Proyecto
> Versión actual: **v19.0** · Última actualización: 2026-04-10
> Usar este archivo al inicio de nuevas conversaciones con Claude para retomar el proyecto sin perder contexto.

---

## Nombre de la app

**KNNS TradeAgent** — pantalla de selector de módulos al entrar, luego navega a:
- **Módulo Swing Trading** — análisis técnico de corto/mediano plazo
- **Módulo Position Trading** — análisis de mediano/largo plazo (semanas a 12 meses)

---

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Frontend | React 18 SPA (Vite), desplegado en **Vercel** |
| Backend | FastAPI (Python), desplegado en **Railway** |
| Base de datos | **Supabase** PostgreSQL |
| Gráficos | **Recharts** (LineChart, ComposedChart, Bar, Line, etc.) |
| Autenticación | Supabase Auth |
| Datos de mercado | Alpha Vantage (premium, 15 min delay) |
| IA | Claude Haiku (`claude-haiku-4-5-20251001`) para narrativa y catalizador |
| Screener Swing | GitHub Actions cron (Finviz → `data/screener.json`) |
| Screener Position | GitHub Actions cron lunes 14:00 UTC (Finviz → `data/screener_position.json`) |
| Repositorio | GitHub (`orlaknns/swing-agent`) |

---

## Estructura de archivos clave

```
swing-agent/
├── frontend/src/
│   ├── App.jsx               — Selector de módulos + SwingModule completo
│   ├── PositionModule.jsx    — Módulo completo de position trading (~1700 líneas)
│   ├── StockCard.jsx         — Tarjeta swing con sparkline + modal chart
│   ├── Journal.jsx           — Journal swing (CRUD trades)
│   ├── Dashboard.jsx         — Dashboard swing (P&L mensual)
│   ├── Discover.jsx          — Screener swing
│   └── supabase.js           — Cliente Supabase
├── backend/
│   └── main.py               — FastAPI: todos los endpoints
├── scripts/
│   ├── test_scoring.py       — 45 tests del scoring swing (correr antes de push)
│   └── run_screener_position.py — Screener position (corre en GitHub Actions)
├── data/
│   ├── screener.json             — Candidatos swing (actualizado por Actions)
│   └── screener_position.json    — Candidatos position (actualizado por Actions)
├── .github/workflows/
│   ├── screener.yml              — Cron swing (frecuencia variable)
│   └── screener-position.yml     — Cron position: lunes 14:00 UTC
└── Doc/
    ├── contexto-proyecto.md              — Este archivo
    ├── swing-agent-arquitectura.docx     — Documentación técnica (pendiente actualizar)
    ├── guia-inversionista-swing-agent.docx — Guía de uso (pendiente actualizar)
    ├── mejoras-potenciales.txt           — Backlog de funcionalidades
    └── prompt_position_trading_app.md    — Prompt original de diseño position trading
```

---

## Navegación — Selector de módulos

`App.jsx` tiene `const [module, setModule] = useState('selector')`:

```jsx
if (module === 'selector')  return <ModuleSelector onSelect={setModule} />
if (module === 'position')  return <PositionModule session={session} onBack={() => setModule('selector')} />
// else: renderiza SwingModule (contenido original de App.jsx)
```

---

## Tablas Supabase

### `watchlist`
```
user_id              uuid (PK / upsert key)
tickers              text[]       — watchlist swing
monitor_tickers      text[]       — lista "en seguimiento" swing
analysis_cache       jsonb        — cache análisis swing (con _savedAt)
position_watchlist   text[]       — watchlist position trading
position_cache       jsonb        — cache análisis position (con _savedAt)
updated_at           timestamptz
```

**CRÍTICO:** Siempre escribir todos los campos juntos en un solo upsert (ver patrón `upsertAll` más abajo).

### `journal`
```
id, user_id, date, ticker, signal, strategy, trend, price,
entry_low, entry_high, stop_loss, target, max_days, rr, rsi,
sma21, sma50, sma200, mansfield_rs, next_earnings, fundamentals jsonb,
analysis, status (open|breakeven|partial|closed),
entry_price, position_size, exit_price, real_stop_loss, real_target,
notes, exit_date, created_at
```

### `position_trades` (journal position)
```
id, user_id, ticker, company, sector,
status (planning|open|closed),
entry_date, entry_price, stop_price, target_price, shares,
notes, scorecard jsonb,
exit_date, exit_price, pnl,
created_at
```

---

## ══════════════════════════════════════
## MÓDULO SWING TRADING
## ══════════════════════════════════════

### Arquitectura de scoring (backend Python)

Tres capas secuenciales — **Claude no decide la señal**:

1. **`calc_score()`** — Score técnico puro 0–100 (base 50)
   - SMA trend (SMA21 > SMA50): +15 / -10
   - RSI 45–65: +10 | RSI >75 o <25: ±5 | RSI >80: -10
   - Precio > SMA21: +10
   - SMA200 (precio sobre SMA200): +8 / -6 (recuperación: -3)
   - Volumen vs avg: +8 si >120% / -8 si <50%
   - Mansfield RS: +12 si >2 / -12 si <-2
   - Momentum 4 semanas: +10 si >10% / -8 si <-5%

2. **`calc_context_stars()`** — Estrellas 0–3★ (empieza en 3)
   - Earnings ≤5 días: -2★ | ≤14 días: -1★
   - Ex-dividend dentro del plazo con yield >0.3%: -1★ o -2★
   - Precio > target analistas: -1★
   - Mansfield RS < -2 con SMA alcista: -1★
   - Score < 45: siempre 0★

3. **`determine_final_signal()`**
   - Score ≥65 + 2–3★ → **buy**
   - Score ≥65 + 1★ con razones → **monitor**
   - Score 45–64 → **hold**
   - Score 30–44 → **hold**
   - Score <30 → **avoid**
   - RSI ≥72 con score bueno → **monitor**

4. **`calc_levels()`** — Niveles anclados a soportes técnicos
   - Entrada: SMA21 × 0.995 (low) y SMA21 × 1.010 (high)
   - Stop-loss: mínimo 20d × 0.995 (sin floor porcentual)
   - Target: máximo 20d si cumple R:B ≥2.5x

### Endpoint swing
```
GET /analyze/{ticker}   — análisis swing completo
GET /screener           — candidatos del screener swing
```

### Componentes clave swing

**`StockCard.jsx`**
- Contiene `Sparkline` (gráfico 72px + modal 260px)
- `hideRemove=true` cuando se abre desde tabla
- Props: `ticker, session, cachedData, onAnalysed, onRemove, onMonitor, isInMonitorTab, activeTrade, lastClosedTrade, hideRemove`

**`WatchlistTable` (en App.jsx)**
- Columnas ordenables: ticker, score, signal, rsi, dist, rr, contexto (★)
- `SIGNAL_ORDER = { buy:0, monitor:1, hold:2, avoid:3, sell:4 }`
- `distPct()` calcula % de distancia al punto medio del rango de entrada
- Columna "Ctx" muestra estrellas de contexto (★★★)

**`Journal.jsx`**
- CRUD completo sobre tabla `journal`
- `_originalStatus` para detectar si trade ya estaba cerrado al abrir modal
- `tradeToDb` asigna `exit_date = today` solo si `_originalStatus !== 'closed'`

---

## ══════════════════════════════════════
## MÓDULO POSITION TRADING
## ══════════════════════════════════════

### Tabs del módulo
**Watchlist · Screener · Journal · Dashboard**

### Scorecard — 8 criterios (MAX_SCORE = 51)

| Criterio | Peso | Automático | Escala |
|----------|------|-----------|--------|
| narrativa | ×3 | Claude Haiku | 0–3 |
| precio_sma200 | ×3 | Sí | 0 ó 3 (binario) |
| estructura_hh_hl | ×2 | Sí (weekly candles) | 0–3 |
| rs_relativa | ×2 | Sí (Mansfield RS) | 0–3 |
| calidad_fundamental | ×2 | Sí (AV OVERVIEW) | 0–3 |
| punto_entrada | ×2 | Sí | 0–3 |
| ratio_rr | ×2 | Sí | 0–3 |
| catalizador | ×1 | Claude Haiku | 0–3 |

**Decisiones:**
- ≥38 → OPERAR CON CONVICCIÓN
- 28–37 → OPERAR CON CAUTELA
- <28 → NO OPERAR

**Vetos absolutos** (independiente del score):
- `precio_sma200 === 0` → VETO
- `ratio_rr <= 1` → VETO

### Endpoints position
```
GET  /analyze-position/{ticker}     — análisis completo + scorecard
GET  /screener-position             — candidatos (lee data/screener_position.json)
POST /screener-position/refresh     — trigger manual de refresh
```

### Respuesta de `/analyze-position/{ticker}`
```json
{
  "ticker", "company_name", "sector", "sector_etf",
  "price", "sma20", "sma50", "sma200",
  "rsi", "vol_ratio", "atr", "mansfield_rs", "rs_sector",
  "macro_context": { "spy_price", "spy_sma200", "spy_above_sma200", "market_regime" },
  "hh_hl": { "hh_count", "hl_count", "score" },
  "next_earnings",
  "entry_suggested", "stop_suggested", "target_suggested", "rr_suggested",
  "scorecard": { [criterio]: { "score_sugerido", "peso", "justificacion", "automatico" } },
  "score_total_suggested",
  "fundamentals": { "name", "sector", "revenueGrowth", "epsGrowth", "peRatio", "mktCap", ... },
  "cashflow"
}
```

### Componentes clave position

**`PositionCard`**
- Auto-analiza SOLO si no hay cache (usa `hasFetched` ref — nunca re-analiza al re-montar)
- Botón ↻ individual: re-analiza manualmente y actualiza cache
- Muestra: precio + SMAs, macro context SPY, score bar, vetos, 6 indicadores (RSI/RS Mansfield/HH-HL/Vol%/ATR/RS Sector), Entry/Stop/Target sugeridos, R/R, earnings, **scorecard expandible** con justificaciones y fundamentales

**`PositionWatchlistTable`**
- Columnas: ticker, precio, score/51, decisión, RSI, RS SPY, macro ▲/▼, HH/HL, acciones
- Click fila → modal con PositionCard

**`PositionScreener`**
- Candidatos de Finviz vía `/api/screener-position`
- Criterios: Precio>SMA200, SMA50>SMA200 (golden cross), RSI 40–65, Vol>500k, Cap>$300M
- Actualización semanal automática (lunes 14:00 UTC)
- Filtros por sector, agregar/quitar de watchlist

**`PositionJournal`** — CRUD sobre tabla `position_trades`

**`PositionDashboard`** — P&L mensual, win rate, win rate por decisión

### Screener position (GitHub Actions)
```yaml
# .github/workflows/screener-position.yml
cron: '0 14 * * 1'  # Lunes 14:00 UTC = 10:00 AM ET
```
Script `scripts/run_screener_position.py`:
- Scraping Finviz con filtros position
- Enriquece con AV OVERVIEW (revGrowth, epsGrowth, mktCap)
- Fallback: datos previos → lista curada 20 large-caps
- Guarda `data/screener_position.json` y hace commit

---

## Patrón crítico — Cache persistence

**NUNCA hacer upserts parciales.** Siempre escribir todos los campos juntos:

```javascript
const upsertAll = (wl, cache) => {
  supabase.from('watchlist').upsert({
    user_id:            session.user.id,
    position_watchlist: wl    ?? watchlistRef.current,
    position_cache:     cache ?? posCacheRef.current,
    updated_at:         new Date().toISOString(),
  }, { onConflict:'user_id' })
}
```

Refs obligatorios para evitar stale closures:
```javascript
const watchlistRef = useRef([])
const posCacheRef  = useRef({})
const dbLoaded     = useRef(false)
const listsReady   = useRef(false)
const saveTimer    = useRef(null)
```

Guard `listsReady` evita que el primer render vacíe el cache al cargar desde Supabase.

### savedAtLabel (calendar-aware)
Comparar strings `YYYY-M-D` (no diferencia en ms) para evitar mostrar "hoy" cuando son <24h pero diferente día calendario.

---

## Paleta de colores

```javascript
const C = {
  bg:'#070d1a', card:'#0f1929', border:'#1a2d45',
  accent:'#00d4ff',  // cyan
  green:'#00e096', red:'#ff4060',
  amber:'#ffb800', text:'#dde6f0', muted:'#4a6080',
}
// SMA21 en charts swing: '#fb923c' (naranja)
```

---

## Convenciones

- Tests antes de push swing: `python3 scripts/test_scoring.py` (45 tests, todos deben pasar)
- Commits con `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`
- Push siempre con `git pull --rebase origin main && git push origin main`
- Todos los estilos inline (sin CSS externo ni Tailwind)
- `fontFamily:'monospace'` para números/tickers

---

## Gotchas importantes

1. **Recharts wrapper bug**: `LineChart` debe ser hijo **directo** de `ResponsiveContainer`. Extraerlo a un componente intermedio rompe el render.

2. **upsertAll() obligatorio**: Nunca hacer upserts parciales a `watchlist`. Una escritura parcial sobreescribe los demás campos con null.

3. **dbLoaded.current ref**: El `useEffect` que escucha cambios en la watchlist tiene guard `if (!dbLoaded.current) return` para evitar sobrescribir Supabase con el state inicial vacío al montar.

4. **hasFetched ref en PositionCard**: Evita que al navegar entre tabs se re-analice una tarjeta que ya tiene datos.

5. **exit_date legacy**: Trades cerrados antes de v17 tienen `exit_date = null`. Dashboard usa `t.exitDate || t.date` como fallback.

6. **hideRemove prop (swing)**: `hideRemove=true` cuando StockCard se abre desde modal de tabla.

7. **Alpha Vantage**: Plan premium. Precio con 15 min delay. La cuenta debe estar con email personal (política NASDAQ).

8. **Screener cron**: GitHub Actions puede tener 1–1.5h de delay real.

---

## Historial de versiones

| Versión | Cambios principales |
|---------|-------------------|
| v19.0 | Módulo Position Trading completo: watchlist con tarjetas/tabla, cache persistido, screener semanal, journal, dashboard. Selector de módulos. Rename a KNNS TradeAgent. |
| v18.0 | Mini chart 30d + SMA21 + crosshair, tabla comparativa con ordenamiento/filtros, persistencia analysisCache en Supabase, búsqueda en Journal, columna estrellas contexto |
| v17.0 | exit_date para Dashboard mensual, confirmación al cerrar/reabrir trade, Dashboard ComposedChart, entryZone 4 estados |
| v16.x | Mansfield RS, momentum 4 semanas, score breakdown, banner ex-dividend |
| v15.x | Sistema de estrellas de contexto, señal monitor, botón En Seguimiento |
