# Swing Trading Agent — Arquitectura del Sistema v21.0

---

## Descripción general

KNNS TradeAgent es una aplicación web full-stack con autenticación en la nube. Tiene dos módulos independientes: **Swing Trading** (análisis técnico corto/mediano plazo) y **Position Trading** (mediano/largo plazo, semanas a 12+ meses). El swing module implementa estrategia set-and-forget con señal final determinada por score técnico matemático (0–100), estrellas de contexto de entrada (0–3★) y detección automática de eventos que afectan el timing (earnings, ex-dividend, RSI extremo, precio sobre target de analistas).

---

## Stack tecnológico

| Componente           | Tecnología                                 | Función                                                                                                                |
| -------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Frontend             | React 18 + Vite + Vercel                   | SPA. App.jsx (Swing), PositionModule.jsx, StockCard.jsx, Journal.jsx, Discover.jsx                                     |
| Backend              | FastAPI + Python + Railway                 | Análisis técnico, score matemático, estrellas de contexto, Claude AI, endpoints REST                                   |
| Base de datos / Auth | [[Supabase]] (PostgreSQL)                  | watchlist, monitor_tickers, journal, position_trades, analysis_cache, position_cache. Auth email/password              |
| Datos de mercado     | [[Alpha Vantage ]](premium)                | Precios históricos, GLOBAL_QUOTE (15-min delay), OVERVIEW (fundamentales + dividendos), Weekly Adjusted                |
| IA                   | Claude Haiku (`claude-haiku-4-5-20251001`) | Narrativa y catalizador para scorecard position trading. Los niveles y scores técnicos se calculan en Python.          |
| Screener Swing       | [[Finviz]] + [[GitHub]] Actions            | Scraping diario 9:30am ET (lunes-viernes). Filtro `ind_stocksonly`. Guarda `data/screener.json`.                       |
| Screener Position    | Finviz + GitHub Actions                    | Cron lunes 14:00 UTC. Enriquece con AV OVERVIEW + Weekly Adjusted (weeksInBase). Guarda `data/screener_position.json`. |
| Repositorio          | [[GitHub]] (orlaknns/swing-agent)          | Fuente de verdad. Actions para screeners automáticos.                                                                  |

---

## Navegación — Selector de módulos

`App.jsx` tiene `const [module, setModule] = useState('selector')`. Al cargar, muestra `ModuleSelector`. El usuario elige Swing Trading o Position Trading. Botón "← Volver" en cada módulo regresa al selector.

```jsx
if (module === 'selector')  return <ModuleSelector onSelect={setModule} />
if (module === 'position')  return <PositionModule session={session} onBack={() => setModule('selector')} />
// else: renderiza SwingModule (contenido original de App.jsx)
```

---

## Tablas Supabase

### `watchlist`

| Columna | Tipo | Descripción |
|---|---|---|
| user_id | uuid | PK / clave de upsert |
| tickers | text[] | Watchlist swing |
| monitor_tickers | text[] | Lista "En seguimiento" swing |
| analysis_cache | jsonb | Cache análisis swing (con `_savedAt`) |
| position_watchlist | text[] | Watchlist position trading |
| position_cache | jsonb | Cache análisis position (con `_savedAt`) |
| updated_at | timestamptz | |

> **CRÍTICO:** Siempre escribir todos los campos juntos en un solo upsert (`upsertAll`). Nunca hacer upserts parciales — una escritura parcial sobreescribe los demás campos con null.

### `journal` (swing)

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
exit_date, exit_price, pnl, created_at
```

---

## MÓDULO SWING TRADING

### Arquitectura de scoring en 3 capas

El análisis se divide en tres capas independientes ejecutadas secuencialmente en Python. **Claude NO decide la señal** — solo genera el análisis narrativo.

| Capa | Función | Rango |
|---|---|---|
| `calc_score()` | Score técnico puro. Solo indicadores de precio y momentum. Base 50. | 0–100 |
| `calc_context_stars()` | Estrellas de contexto de entrada. Evalúa si es buen momento para entrar ahora. | 0–3★ |
| `determine_final_signal()` | Señal final combinando score + estrellas + RSI. | buy/monitor/hold/avoid |

### Score técnico — factores (`calc_score`)

| Factor | Positivo | Negativo | Notas |
|---|---|---|---|
| SMA trend (SMA21 vs SMA50) | +15 | -10 | +15 si SMA21 > SMA50 |
| RSI | +10 (45–65) / +5 (<30) | -10 (>80) / -5 (>75) | Zona pullback ideal: 45–65 |
| Precio > SMA21 | +10 | — | |
| SMA200 | +8 | -6 / -3 (recuperación) | -3 si SMA21>SMA50 y momentum>0 |
| Volumen vs avg | +8 (>120%) | -8 (<50%) | Participación institucional |
| Mansfield RS | +12 (>2) | -12 (<-2) | Fuerza relativa vs S&P500 |
| Momentum 4 semanas | +10 (>10%) | -8 (<-5%) | Cambio precio en 4 semanas |

### Estrellas de contexto (`calc_context_stars`)

Empiezan en 3★. Se restan penalizaciones. Si score < 45: siempre 0★.

| Condición | Penalización |
|---|---|
| Earnings ≤ 5 días | -2★ |
| Earnings 6–14 días | -1★ |
| Ex-dividend ≤ 5 días (yield > 0.3%) | -2★ |
| Ex-dividend dentro del 40% del plazo | -1★ |
| Precio > 10% sobre target analistas | -1★ |
| Mansfield RS < -2 con SMA21 > SMA50 | -1★ |

### Señal final (`determine_final_signal`)

| Score | Contexto | RSI | Señal |
|---|---|---|---|
| < 30 | cualquiera | cualquiera | EVITAR |
| 30–44 | cualquiera | cualquiera | ESPERAR |
| ≥ 50 | cualquiera | ≥ 72 | MONITOREAR (esperar pullback RSI) |
| ≥ 50 | 0–1★ con razones | < 72 | MONITOREAR (contexto desfavorable) |
| ≥ 65 | 2–3★ | < 72 | COMPRAR (high/medium confidence) |
| 45–64 | 3★ | < 72 | COMPRAR (medium confidence) |
| 45–64 | < 3★ | < 72 | COMPRAR (low confidence) |

### Niveles técnicos (`calc_levels`)

| Nivel | Cálculo | Descripción |
|---|---|---|
| entryLow | SMA21 × 0.995 | Límite inferior de la zona de compra |
| entryHigh | SMA21 × 1.010 | Límite superior de la zona de compra |
| stopLoss | mínimo 20 días × 0.995 | Anclado al soporte real. Sin floor porcentual. |
| target | max(máx 20d, entry_mid + riesgo × 2.5) | R:B mínimo 2.5x garantizado |
| max_days | distancia real al target / ATR | Dinámico por acción (10–30 días) |

### Endpoints swing

```
GET /analyze/{ticker}   — análisis swing completo
GET /screener           — candidatos del screener swing
```

### Componentes clave swing

**`StockCard.jsx`**
- Contiene `Sparkline` (gráfico 72px + modal 260px con crosshair)
- Props: `ticker, session, cachedData, onAnalysed, onRemove, onMonitor, isInMonitorTab, activeTrade, lastClosedTrade, hideRemove`
- `hideRemove=true` cuando se abre desde tabla (evita eliminación accidental)

**`WatchlistTable` (en `App.jsx`)**
- Columnas ordenables: ticker, score, signal, rsi, dist, rr, contexto (★)
- `SIGNAL_ORDER = { buy:0, monitor:1, hold:2, avoid:3, sell:4 }`
- `distPct()` calcula % de distancia al punto medio del rango de entrada

**`Journal.jsx`**
- CRUD completo sobre tabla `journal`
- `_originalStatus` para detectar si trade ya estaba cerrado al abrir modal
- `tradeToDb` asigna `exit_date = today` solo si `_originalStatus !== 'closed'`

---

## MÓDULO POSITION TRADING

Tabs: **Watchlist · Screener · Mercado · Journal · Dashboard**

### Scorecard — 7 criterios (MAX_SCORE = 51)

| Criterio | Peso | Escala | Automático | Notas |
|---|---|---|---|---|
| narrativa | ×3 | 0–3 | Claude Haiku | Catalizador estructural de crecimiento |
| precio_sma200 | ×3 | 0–3 | Sí | Gradual: >15%=3, 5-15%=2, 0-5%=1, bajo=0+VETO |
| estructura_tecnica | ×3 | 0–3 | Sí (Stage + HH/HL) | Stage 2 fuerte+HH/HL=3, Stage 2+HH/HL=3, Stage 2 tardío=2, Stage 1=1 |
| rs_relativa | ×2 | 0–3 | Sí (Mansfield RS) | Bonus +1 si lidera sector (rs_sector > 1) |
| calidad_fundamental | ×3 | 0–3 | Sí (AV OVERVIEW) | Rev+EPS+FCF/márgenes |
| punto_entrada | ×1 | 0–3 | Sí | Breakout con vol / pullback SMA50 / extendido |
| ratio_rr | ×2 | 0–3 | Sí | R/R 2.5x fijo, veto si < 2 |

**Decisiones:**
- ≥ 32 → OPERAR CON CONVICCIÓN
- 22–31 → OPERAR CON CAUTELA
- < 22 → NO OPERAR

**Vetos absolutos** (independiente del score):
- `precio_sma200 === 0` (precio bajo SMA200) → VETO
- `ratio_rr < 2` → VETO

**Ajuste macro:** SPY < SMA200 → `score_total -= 4` (penalización Weinstein)

### Lógica `estructura_tecnica` (Stage + HH/HL)

Combina Stage Weinstein + HH/HL. La **pendiente de SMA30 semanal** distingue Stage 2 emergente de Stage 2 tardío.

```python
stage == 2 y slope > 1.5%    → stage_base = 3  # Stage 2 fuerte, acelerando
stage == 2 y slope 0.5–1.5%  → stage_base = 2  # Stage 2 establecido
stage == 2 y slope < 0.5%    → stage_base = 1  # Stage 2 tardío — distribución inminente
stage == 1                   → stage_base = 1  # Acumulación
stage 3/4/None               → stage_base = 0  # Penaliza

hh_bonus = 1 si hh_hl_score >= 2 AND stage_base > 0
struct_score = min(3, stage_base + hh_bonus)
```

### Lógica `detect_hh_hl`

- Usa highs y lows reales de velas semanales (no closes)
- Ventana: últimas 26 semanas
- Pivot high: `high[i] > high[i-1] AND high[i] > high[i+1]`
- Cuenta solo pares consecutivos con movimiento mínimo 0.5%
- Score: combined (HH+HL) ≥4=3, ≥2=2, ≥1=1, 0=0
- Tendencia lineal sin pullbacks produce score=0 (correcto)

### Lógica `analyze_base`

- Recorre hacia atrás desde la última vela semanal
- Base válida: rango total ≤ 35%, sin cierre > 15% bajo el soporte
- `sound` ≥7 semanas, `short` 3–6 semanas, `none` <3 semanas
- Stop sugerido: `base_low_weekly × 0.98`
- Fallback si no hay base: `min(lows[-10:]) × 0.98`

### Entry / Stop / Target position

```python
# Entrada
entry = price si near_52w_high (breakout) else SMA50 (pullback)

# Stop: low real de la base semanal detectada
stop = base_low_weekly * 0.98
# Fallback: min(lows[-10:]) * 0.98

# Target: R/R 2.5x fijo
target = entry + (entry - stop) * 2.5
```

### Sizing calculator (`PositionCard`)

Inputs: `capital` (USD) + `riskPct` (default 1%).

```
acciones    = (capital × riskPct) / (entry - stop)
invertido   = acciones × entry
ganancia    = (target - entry) × acciones
pérdida_máx = (entry - stop) × acciones
```

### Badges y warnings position

| Feature | Descripción |
|---|---|
| Badge caché viejo | >24h → naranja, >48h → rojo. En tarjeta y tabla. |
| Earnings warning | <7d → banner rojo. 7–14d → naranja. Tabla: badge `E{días}d` en columna DECISIÓN. |
| Ex-dividend warning | <7d → rojo, 7–14d → naranja. Solo si `dividendYield > 0.3%`. |
| RS SPY sin cap | Valor real en % (ej: +43% vs SPY). Scoring interno sigue usando normalizado. |
| Confidence score | Alta (≥6/7 criterios con datos reales), Media (4/7), Baja (<4/7). |

### Endpoints position

```
GET  /analyze-position/{ticker}   — análisis completo + scorecard
GET  /screener-position           — candidatos (lee data/screener_position.json)
POST /screener-position/refresh   — trigger manual de refresh
GET  /sector-rotation             — RS Mansfield 11 sectores SPDR vs SPY (cache 1h)
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
  "scorecard": { "[criterio]": { "score_sugerido", "peso", "justificacion", "es_automatico" } },
  "score_total_suggested",
  "market_penalty",
  "fundamentals": { "name", "sector", "industry", "revenueGrowth", "epsGrowth", "peRatio", "mktCap" },
  "cashflow"
}
```

### Componentes clave position

**`PositionCard`**
- Auto-analiza SOLO si no hay cache (`hasFetched` ref — nunca re-analiza al re-montar)
- Botón ↻ individual re-analiza y actualiza cache
- Warnings: Stage 4, mercado bajista (SPY < SMA200), earnings, ex-dividend, caché viejo
- Score bar con decisión color-coded, vetos destacados
- Sizing calculator integrado (capital + riskPct)
- Scorecard expandible con justificaciones y fundamentales

**`PositionWatchlistTable`**
- Columnas: ticker, precio, score/51, decisión, RSI, RS SPY, Stage, macro ▲/▼, sector, acciones
- Click fila → modal con PositionCard

**`PositionScreener`**
- Candidatos Finviz vía `/api/screener-position`
- Badge "Base Nsem" (verde=sound, ámbar=short). Filtros por sector.

**`SectorRotation`** (tab Mercado)
- 11 sectores SPDR ordenados por RS Mansfield desc. Badges TOP/WEAK. Cache 1h.

**`PositionJournal`** — CRUD sobre tabla `position_trades`

**`PositionDashboard`** — P&L mensual, win rate, win rate por decisión (convicción/cautela)

### Screener position (GitHub Actions)

```yaml
cron: '0 14 * * 1'  # Lunes 14:00 UTC = 10:00 AM ET
```

Script `scripts/run_screener_position.py`:
1. Scraping Finviz: Precio>SMA200, SMA50>SMA200, RSI 40–65, Vol>500k, Cap>$300M, NYSE+NASDAQ
2. Enriquece con AV OVERVIEW (revGrowth, epsGrowth, mktCap, sector, industry)
3. Llama AV Weekly Adjusted por candidato → `weeksInBase` + `baseQuality`
4. Fallback: datos previos → lista curada 20 large-caps
5. Guarda `data/screener_position.json` y hace commit
6. Actualiza `data/screener_position_history.json` (máx 52 semanas acumuladas)

---

## Patrón crítico — `upsertAll`

**NUNCA hacer upserts parciales.** Siempre escribir todos los campos juntos:

```javascript
const upsertAll = (wl, cache) => {
  supabase.from('watchlist').upsert({
    user_id:            session.user.id,
    position_watchlist: wl    ?? watchlistRef.current,
    position_cache:     cache ?? posCacheRef.current,
    updated_at:         new Date().toISOString(),
  }, { onConflict: 'user_id' })
}
```

Refs obligatorios para evitar stale closures:

```javascript
const watchlistRef  = useRef([])
const posCacheRef   = useRef({})
const dbLoaded      = useRef(false)
const listsReady    = useRef(false)
const saveTimer     = useRef(null)
```

Guard `listsReady` evita que el primer render vacíe el cache al cargar desde Supabase.

---

## Paleta de colores

```javascript
const C = {
  bg: '#070d1a', card: '#0f1929', border: '#1a2d45',
  accent: '#00d4ff',   // cyan
  green: '#00e096', red: '#ff4060',
  amber: '#ffb800', text: '#dde6f0', muted: '#4a6080',
}
// SMA21 en charts swing: '#fb923c' (naranja)
```

---

## Convenciones

- Tests swing: `python3 scripts/test_scoring.py` (45 tests)
- Tests position: `python3 scripts/test_position_scoring.py` (36 tests)
- Commits con `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`
- Push: `git pull --rebase origin main && git push origin main`
- Todos los estilos inline (sin CSS externo ni Tailwind)
- `fontFamily:'monospace'` para números/tickers

---

## Gotchas importantes

1. **Recharts wrapper bug**: `LineChart` debe ser hijo **directo** de `ResponsiveContainer`. Extraerlo a un componente intermedio rompe el render.
2. **`upsertAll()` obligatorio**: Nunca hacer upserts parciales a `watchlist`.
3. **`dbLoaded.current` ref**: El `useEffect` con guard `if (!dbLoaded.current) return` evita sobrescribir Supabase con el state inicial vacío al montar.
4. **`hasFetched` ref en `PositionCard`**: Evita re-analizar al navegar entre tabs.
5. **`exit_date` legacy**: Trades cerrados antes de v17 tienen `exit_date = null`. Dashboard usa `t.exitDate || t.date` como fallback.
6. **`hideRemove` prop (swing)**: `hideRemove=true` cuando `StockCard` se abre desde modal de tabla.
7. **[[Alpha Vantage]]**: Plan premium. Precio con 15 min delay. Email personal (política NASDAQ).
8. **Screener cron**: GitHub Actions puede tener 1–1.5h de delay real.
9. **`detect_hh_hl` requiere oscilaciones reales**: Tendencias lineales sin pullbacks producen score=0. Correcto — en datos reales siempre hay oscilaciones.
10. **`analyze_base` con tendencia alcista larga**: Puede detectar base con range 20–35% si la acción lleva semanas subiendo. Stop más lejano. Técnicamente válido para position trading.
11. **Haiku no conoce noticias recientes**: El prompt usa datos históricos de AV. Siempre revisar noticias antes de ejecutar.

---

## Historial de versiones

| Versión | Cambios principales |
|---|---|
| v21.0 | Sizing calculator en PositionCard. Badge caché viejo. Earnings/ex-dividend warnings prominentes. RS SPY sin cap (valor real %). Confidence score del análisis. |
| v20.0 | `estructura_tecnica`: Stage 2 tardío vs emergente (slope SMA30). Volumen breakout corregido. Haiku conservador. `weeks_in_base` en screener. Sector Rotation tab. 36 tests position. |
| v19.0 | Módulo Position Trading completo: watchlist con tarjetas/tabla, cache persistido, screener semanal, journal, dashboard. Selector de módulos. Rename a KNNS TradeAgent. |
| v18.0 | Mini chart 30d + SMA21 + crosshair, tabla comparativa con ordenamiento/filtros, persistencia `analysisCache` en Supabase, búsqueda en Journal, `exit_date` para Dashboard mensual. |
| v17.0 | `exit_date` para Dashboard mensual, confirmación al cerrar/reabrir trade, Dashboard `ComposedChart`, `entryZone` 4 estados. |
| v16.x | Mansfield RS, momentum 4 semanas, score breakdown, banner ex-dividend. |
| v15.x | Sistema de estrellas de contexto, señal monitor, botón En Seguimiento. |
