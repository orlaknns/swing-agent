# Swing Trading Agent — Contexto del Proyecto
> Versión actual: **v18.0** · Última actualización: 2026-04-07
> Usar este archivo al inicio de nuevas conversaciones con Claude para retomar el proyecto sin perder contexto.

---

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Frontend | React 18 SPA (Vite), desplegado en **Vercel** |
| Backend | FastAPI (Python), desplegado en **Railway** |
| Base de datos | **Supabase** PostgreSQL |
| Gráficos | **Recharts** (LineChart, ReferenceLine, ReferenceArea, YAxis, CartesianGrid) |
| Autenticación | Supabase Auth |
| Datos de mercado | Alpha Vantage (premium, 15 min delay) |
| Screener | GitHub Actions cron (Finviz scraper → `data/screener.json`) |
| Repositorio | GitHub (`orlaknns/swing-agent`) |

---

## Estructura de archivos clave

```
swing-agent/
├── frontend/src/
│   ├── App.jsx          — Lógica central, watchlist, cache, tabs, tabla comparativa
│   ├── StockCard.jsx    — Tarjeta de análisis individual + sparkline + modal chart
│   ├── Journal.jsx      — Trading journal (CRUD trades, filtros, búsqueda)
│   ├── Dashboard.jsx    — Resumen mensual P&L (ComposedChart barras+línea)
│   ├── Discover.jsx     — Screener con filtros por sector
│   └── supabase.js      — Cliente Supabase
├── backend/
│   └── main.py          — FastAPI: /analyze/{ticker}, /screener, calc_score, etc.
├── scripts/
│   └── test_scoring.py  — 45 tests del sistema de scoring (correr antes de push)
├── data/
│   └── screener.json    — Candidatos del screener (actualizado por GitHub Actions)
└── Doc/
    ├── contexto-proyecto.md              — Este archivo
    ├── swing-agent-arquitectura.docx     — Documentación técnica completa
    ├── guia-inversionista-swing-agent.docx — Guía de uso para el usuario
    └── mejoras-potenciales.txt           — Backlog de funcionalidades
```

---

## Tablas Supabase

### `watchlist`
```
user_id          uuid (PK)
tickers          text[]
monitor_tickers  text[]
analysis_cache   jsonb       ← agregado en v18 (persistencia del cache)
updated_at       timestamp
```

### `journal`
```
id               uuid (PK)
user_id          uuid
date             text (YYYY-MM-DD)
ticker           text
signal           text
strategy         text
trend            text
price            numeric
entry_low        numeric
entry_high       numeric
stop_loss        numeric
target           numeric
max_days         integer
rr               numeric
rsi              numeric
sma21            numeric
sma50            numeric
sma200           numeric
mansfield_rs     numeric
next_earnings    text
fundamentals     jsonb
analysis         text
status           text (open | breakeven | partial | closed)
entry_price      numeric
position_size    numeric
exit_price       numeric
real_stop_loss   numeric
real_target      numeric
notes            text
exit_date        text (YYYY-MM-DD)  ← agregado en v17 para Dashboard mensual
created_at       timestamp
```

---

## Arquitectura de scoring (backend Python)

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
   - Target: máximo 20d si cumple R:B ≥2.5x, si no se calcula

---

## Flujo de datos en App.jsx

```
INICIO:
  Supabase SELECT tickers + monitor_tickers + analysis_cache
  → Restaura watchlist, monitorTickers y analysisCache (con _savedAt)
  → dbLoaded.current = true

ANÁLISIS:
  StockCard → fetch /api/analyze/{ticker}
  → cacheAnalysis(ticker, data)
    → añade _savedAt = now()
    → actualiza analysisCacheRef
    → upsertAll() → Supabase (tickers + monitor_tickers + analysis_cache juntos)

CAMBIO DE LISTA:
  setWatchlist / setMonitorTickers
  → actualiza watchlistRef / monitorTickersRef
  → saveToSupabase() debounce 800ms → upsertAll()

IMPORTANTE — upsertAll():
  Siempre incluye los 3 campos juntos para evitar sobrescrituras parciales.
  Usa refs (analysisCacheRef, watchlistRef, monitorTickersRef) para evitar
  stale closures en callbacks asíncronos.
```

---

## Componentes principales

### `StockCard.jsx`
- Props: `ticker, session, cachedData, onAnalysed, onRemove, onMonitor, isInMonitorTab, activeTrade, lastClosedTrade, hideRemove`
- `hideRemove=true` oculta el botón × cuando se abre desde el modal de tabla
- Contiene el componente `Sparkline` con:
  - Gráfico pequeño (72px) + botón ⤢ para modal expandido (260px)
  - **Regla crítica Recharts**: `LineChart` debe ser hijo directo de `ResponsiveContainer` — no puede haber componentes wrapper entre ellos
  - Crosshair: `cursor` prop en LineChart (vertical) + `ReferenceLine y={hoverY}` dinámico (horizontal)
  - Props Sparkline: `prices, sma21Series, signal, entryLow, entryHigh, stopLoss, target, ticker`

### `WatchlistTable` (en App.jsx)
- Estado interno: `sortCol, sortDir, filterSignal, filterText`
- Columnas ordenables: ticker, score, signal, rsi, dist, rr
- `SIGNAL_ORDER = { buy:0, monitor:1, hold:2, avoid:3, sell:4 }` para ordenar señales
- `distPct()` calcula % de distancia al punto medio del rango de entrada
- Props: `tickers, analysisCache, openTrades, lastClosedTrades, onRowClick, onRemove, onRefresh, refreshingTickers`

### `Journal.jsx`
- Estado: `trades, filter ('open'|'all'|...), searchTicker, selected, confirmDelete`
- `filtered = trades.filter(status).filter(ticker)` — ambos filtros combinados
- `_originalStatus` en form state para detectar si trade ya estaba cerrado al abrir modal
- `tradeToDb` asigna `exit_date = today` solo si `_originalStatus !== 'closed'` y `exitDate` es null

---

## Convenciones de código

```javascript
const C = {
  bg:'#070d1a', card:'#0f1929', border:'#1a2d45',
  accent:'#00d4ff',  // cyan — precio en charts
  green:'#00e096', red:'#ff4060',
  amber:'#ffb800', text:'#dde6f0', muted:'#4a6080',
}
// SMA21 en charts: '#fb923c' (naranja)
```

- Tests antes de cada push: `python3 scripts/test_scoring.py` (45 tests, deben pasar todos)
- Nunca push sin confirmar con el usuario primero
- Commits siempre con `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`

---

## Backlog de mejoras (mejoras-potenciales.txt)

| # | Funcionalidad | Estado |
|---|--------------|--------|
| 1 | Mini chart en tarjeta | ✅ Implementado |
| 2 | Position sizing integrado | 🔄 En evaluación |
| 3 | Vista tabla comparativa | ✅ Implementado |
| 4 | Alertas de precio (email/push) | ⬜ Pendiente |
| 5 | Analytics del journal (win rate por sector, etc.) | ⬜ Pendiente |
| 6 | Contexto macro / VIX / Fear & Greed | ⬜ Pendiente |
| 7 | Backtesting básico del screener | ⬜ Pendiente |
| 8 | Modo multi-usuario / portafolio compartido | ⬜ Pendiente |

---

## Historial de versiones relevante

| Versión | Cambios principales |
|---------|-------------------|
| v18.0 | Mini chart 30d + SMA21 + crosshair, tabla comparativa con ordenamiento/filtros, persistencia analysisCache en Supabase, búsqueda en Journal |
| v17.0 | exit_date para Dashboard mensual, confirmación al cerrar/reabrir trade, Dashboard ComposedChart barras+línea, entryZone 4 estados |
| v16.x | Mansfield RS, momentum 4 semanas, score breakdown, banner ex-dividend |
| v15.x | Sistema de estrellas de contexto, señal monitor, botón En Seguimiento |

---

## Gotchas y decisiones de diseño importantes

1. **Recharts wrapper bug**: `LineChart` debe ser hijo **directo** de `ResponsiveContainer`. Extraerlo a un componente intermedio rompe el render (chart en blanco).

2. **upsertAll() obligatorio**: Nunca hacer upserts parciales a la tabla `watchlist`. Siempre incluir `tickers + monitor_tickers + analysis_cache` en un solo upsert para evitar que una escritura sobrescriba la otra.

3. **dbLoaded.current ref**: El `useEffect` que escucha cambios en `watchlist/monitorTickers` tiene un guard `if (!dbLoaded.current) return` para evitar sobrescribir Supabase con el state inicial vacío al montar.

4. **exit_date legacy**: Trades cerrados antes de v17 tienen `exit_date = null`. El Dashboard usa `t.exitDate || t.date` como fallback. No se asigna fecha retroactiva.

5. **hideRemove prop**: Cuando StockCard se abre desde el modal de tabla, `hideRemove=true` oculta el botón × para evitar que el usuario elimine accidentalmente un ticker pensando que solo cierra el modal.

6. **Screener cron**: GitHub Actions puede tener 1–1.5h de delay. El badge "FINVIZ LIVE" indica datos reales; "LISTA CURADA" es fallback.

7. **Price data**: Alpha Vantage con suscripción premium. La cuenta debe estar registrada con email personal (política NASDAQ). El precio tiene 15 min de delay durante horario de mercado.
