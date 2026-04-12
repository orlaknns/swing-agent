# KNNS TradeAgent — Contexto del Proyecto
> Versión actual: **v20.0** · Última actualización: 2026-04-12
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
│   ├── PositionModule.jsx    — Módulo completo de position trading (~1800 líneas)
│   ├── StockCard.jsx         — Tarjeta swing con sparkline + modal chart
│   ├── Journal.jsx           — Journal swing (CRUD trades)
│   ├── Dashboard.jsx         — Dashboard swing (P&L mensual)
│   ├── Discover.jsx          — Screener swing
│   └── supabase.js           — Cliente Supabase
├── backend/
│   └── main.py               — FastAPI: todos los endpoints
├── scripts/
│   ├── test_scoring.py           — 45 tests del scoring swing (correr antes de push)
│   ├── test_position_scoring.py  — 36 tests del scoring position (correr antes de push)
│   └── run_screener_position.py  — Screener position (corre en GitHub Actions)
├── data/
│   ├── screener.json             — Candidatos swing (actualizado por Actions)
│   └── screener_position.json    — Candidatos position (actualizado por Actions)
├── .github/workflows/
│   ├── screener.yml              — Cron swing (frecuencia variable)
│   └── screener-position.yml     — Cron position: lunes 14:00 UTC
└── Doc/
    ├── contexto-proyecto.md              — Este archivo
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
**Watchlist · Screener · Mercado · Journal · Dashboard**

### Scorecard — 7 criterios (MAX_SCORE = 51)

| Criterio | Peso | Automático | Escala | Notas |
|----------|------|-----------|--------|-------|
| narrativa | ×3 | Claude Haiku | 0–3 | Catalizador estructural de crecimiento |
| precio_sma200 | ×3 | Sí | 0–3 | Gradual: >15%=3, 5-15%=2, 0-5%=1, bajo=0+VETO |
| estructura_tecnica | ×3 | Sí (Stage + HH/HL) | 0–3 | Stage 2 fuerte+HH/HL=3, Stage 2+HH/HL=3, Stage 2 tardío=2, Stage 1=1 |
| rs_relativa | ×2 | Sí (Mansfield RS) | 0–3 | Bonus +1 si lidera sector (rs_sector > 1) |
| calidad_fundamental | ×3 | Sí (AV OVERVIEW) | 0–3 | Rev+EPS+FCF/márgenes |
| punto_entrada | ×1 | Sí | 0–3 | Breakout con vol / pullback SMA50 / extendido |
| ratio_rr | ×2 | Sí | 0–3 | R/R 2.5x fijo, veto si < 2 |

**Decisiones:**
- ≥32 → OPERAR CON CONVICCIÓN
- 22–31 → OPERAR CON CAUTELA
- <22 → NO OPERAR

**Vetos absolutos** (independiente del score):
- `precio_sma200 === 0` (precio bajo SMA200) → VETO
- `ratio_rr < 2` → VETO

**Ajuste macro:**
- SPY < SMA200 (mercado bajista) → `score_total -= 4` (penalización Weinstein)

### Lógica de `estructura_tecnica` (criterio clave v20)

Combina Stage Weinstein + HH/HL. La **pendiente** de SMA30 semanal distingue Stage 2 emergente de Stage 2 tardío — diferencia crítica en Weinstein:

```python
if stage == 2 and slope > 1.5%:   stage_base = 3  # Stage 2 fuerte, acelerando
if stage == 2 and slope 0.5-1.5%: stage_base = 2  # Stage 2 establecido
if stage == 2 and slope < 0.5%:   stage_base = 1  # Stage 2 tardío (distribución inminente)
if stage == 1:                     stage_base = 1  # Acumulación
else (3/4/None):                   stage_base = 0  # Penaliza

hh_bonus = 1 si hh_hl_score >= 2 AND stage_base > 0
struct_score = min(3, stage_base + hh_bonus)
```

### Lógica de `detect_hh_hl`

- Usa **highs y lows reales** de velas semanales (no closes)
- Ventana: últimas 26 semanas
- Pivot high: `high[i] > high[i-1] AND high[i] > high[i+1]`
- Cuenta solo pares consecutivos con movimiento mínimo 0.5%
- Score: combined (HH+HL) ≥4=3, ≥2=2, ≥1=1, 0=0
- **Requiere oscilaciones reales** — tendencia lineal sin pullbacks no genera pivots (correcto)

### Lógica de `analyze_base`

- Recorre hacia atrás desde la última vela semanal
- Base válida: rango total ≤ 35%, sin cierre > 15% bajo el soporte
- `sound` ≥7 semanas, `short` 3–6 semanas, `none` <3 semanas
- El **stop sugerido** usa `base_low_weekly × 0.98` (soporte real, no % arbitrario)
- Fallback si no hay base: mínimo de últimos 10 días diarios × 0.98

### Entry / Stop / Target

```python
# Entrada
entry = price si near_52w_high (breakout) else SMA50 (pullback)

# Stop: low real de la base semanal detectada
stop = base_low_weekly * 0.98
# Fallback si no hay base: min(lows[-10:]) * 0.98

# Target: R/R 2.5x fijo
target = entry + (entry - stop) * 2.5
rr = (target - entry) / (entry - stop)  # siempre ~2.5
```

### Endpoints position
```
GET  /analyze-position/{ticker}     — análisis completo + scorecard
GET  /screener-position             — candidatos (lee data/screener_position.json)
POST /screener-position/refresh     — trigger manual de refresh
GET  /sector-rotation               — RS Mansfield 11 sectores SPDR vs SPY (cache 1h)
```

### Respuesta de `/analyze-position/{ticker}`
```json
{
  "ticker", "company_name", "sector", "sector_etf",
  "price", "sma20", "sma50", "sma200",
  "rsi", "vol_ratio", "atr", "mansfield_rs", "rs_sector",
  "macro_context": { "spy_price", "spy_sma200", "spy_above_sma200", "market_regime" },
  "hh_hl": { "hh_count", "hl_count", "score", "description" },
  "stage": { "stage", "label", "slope_4w_pct", "price_above_sma30", "description" },
  "base": { "weeks_in_base", "base_quality", "range_pct", "breakout_vol", "description" },
  "next_earnings",
  "entry_suggested", "stop_suggested", "target_suggested", "rr_suggested",
  "scorecard": { [criterio]: { "score_sugerido", "peso", "justificacion", "es_automatico" } },
  "score_total_suggested",
  "market_penalty",
  "fundamentals": { "name", "sector", "industry", "revenueGrowth", "epsGrowth", "peRatio", "mktCap", ... },
  "cashflow"
}
```

### Componentes clave position

**`PositionCard`**
- Auto-analiza SOLO si no hay cache (usa `hasFetched` ref — nunca re-analiza al re-montar)
- Botón ↻ individual: re-analiza manualmente y actualiza cache
- Muestra: precio + SMAs, macro context SPY, Stage badge, base analysis badge
- Warning Stage 4, warning mercado bajista (SPY < SMA200)
- Score bar con decisión color-coded, vetos destacados
- 6 indicadores: RSI / RS Mansfield / HH-HL / Vol% / ATR / RS Sector
- Entry/Stop/Target sugeridos + R/R
- Sizing calculator: capital × %riesgo → acciones, monto, % portafolio
- Scorecard expandible con justificaciones y fundamentales

**`PositionWatchlistTable`**
- Columnas: ticker, precio, score/51, decisión, RSI, RS SPY, Stage, macro ▲/▼, sector, acciones
- Click fila → modal con PositionCard

**`PositionScreener`**
- Candidatos de Finviz vía `/api/screener-position`
- Criterios: Precio>SMA200, SMA50>SMA200 (golden cross), RSI 40–65, Vol>500k, Cap>$300M
- Cada candidato enriquecido con: company, sector, revGrowth, epsGrowth, mktCap, **weeksInBase**, **baseQuality**
- Badge "Base Nsem" en tarjeta (verde=sound, ámbar=short)
- Actualización semanal automática (lunes 14:00 UTC)
- Filtros por sector, agregar/quitar de watchlist

**`SectorRotation`** (tab Mercado)
- Tabla de 11 sectores SPDR ordenados por RS Mansfield desc
- Badges TOP/WEAK, SPY header, cache 1h

**`PositionJournal`** — CRUD sobre tabla `position_trades`

**`PositionDashboard`** — P&L mensual, win rate, win rate por decisión (convicción/cautela)

### Screener position (GitHub Actions)
```yaml
# .github/workflows/screener-position.yml
cron: '0 14 * * 1'  # Lunes 14:00 UTC = 10:00 AM ET
```
Script `scripts/run_screener_position.py`:
- Scraping Finviz con filtros position
- Enriquece con AV OVERVIEW (revGrowth, epsGrowth, mktCap, sector, industry)
- **Llama AV Weekly Adjusted** por candidato para calcular `weeksInBase` y `baseQuality`
- Fallback: datos previos → lista curada 20 large-caps
- Guarda `data/screener_position.json` y hace commit

### Tests position trading
```bash
python3 scripts/test_position_scoring.py   # 36 tests, todos deben pasar antes de push
```
Casos cubiertos: ideal (CONVICCIÓN), mediocre (CAUTELA), veto SMA200, rezagada (NO OPERAR),
HH/HL alcista/bajista, base sólida, Stage 2, R/R consistencia, fundamentales 5 combos,
Stage 2 tardío vs emergente.

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

- Tests antes de push swing: `python3 scripts/test_scoring.py` (45 tests)
- Tests antes de push position: `python3 scripts/test_position_scoring.py` (36 tests)
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

9. **detect_hh_hl requiere oscilaciones reales**: Tendencias lineales sin pullbacks no generan pivots (score=0). Esto es correcto — en datos de mercado reales siempre hay oscilaciones.

10. **analyze_base con tendencia alcista larga**: Puede detectar una "base" con range 20-35% si la acción lleva muchas semanas subiendo. El stop resultante queda más lejos. Es técnicamente válido para position trading (stops amplios) pero revisar manualmente.

11. **Haiku no conoce noticias recientes**: El prompt usa datos históricos de AV. Eventos recientes (earnings, aranceles, cambios de CEO) no están incluidos. Siempre revisar noticias antes de ejecutar.

---

## Lo que la app hace y lo que no hace

### Hace bien
- Identifica acciones en Stage 2 **emergente** (no tardío) con fundamentos sólidos y RS positiva
- Distingue empresa buena de entrada técnica buena (AAPL fundamentales excelentes pero Stage 3 = NO OPERAR)
- Calcula stop técnicamente válido (base semanal real, no % arbitrario)
- Fuerza disciplina R/R 2.5x en cada operación
- Penaliza entradas en mercado bajista (Weinstein: nunca comprar Stage 2 individual en Stage 4 de mercado)

### No hace (revisar manualmente antes de ejecutar)
- Noticias recientes del ticker (earnings, aranceles, cambios de guidance)
- Volumen intradiario en tiempo real (15 min delay)
- Decisión de % del portafolio total a concentrar en una posición

---

## Historial de versiones

| Versión | Cambios principales |
|---------|-------------------|
| v20.0 | estructura_tecnica: Stage 2 tardío vs emergente (slope SMA30). Volumen breakout corregido (volumes[-25:-5]). Haiku conservador. weeks_in_base en screener. Sector Rotation tab. 36 tests position. |
| v19.0 | Módulo Position Trading completo: watchlist con tarjetas/tabla, cache persistido, screener semanal, journal, dashboard. Selector de módulos. Rename a KNNS TradeAgent. |
| v18.0 | Mini chart 30d + SMA21 + crosshair, tabla comparativa con ordenamiento/filtros, persistencia analysisCache en Supabase, búsqueda en Journal, columna estrellas contexto |
| v17.0 | exit_date para Dashboard mensual, confirmación al cerrar/reabrir trade, Dashboard ComposedChart, entryZone 4 estados |
| v16.x | Mansfield RS, momentum 4 semanas, score breakdown, banner ex-dividend |
| v15.x | Sistema de estrellas de contexto, señal monitor, botón En Seguimiento |
