# Guía del Inversionista — KNNS TradeAgent v21.0

---

## Flujo de uso recomendado

| Paso | Módulo / Pestaña | Qué hacer |
|---|---|---|
| 1 | Selector | Elegir **Swing Trading** o **Position Trading** según el horizonte temporal. |
| 2 (Swing) | Screener Swing | Revisar candidatas del día. Filtrar por sector. Agregar a watchlist. |
| 3 (Swing) | Watchlist Swing | Analizar cada acción. Revisar señal, estrellas de contexto, score y alertas. Verificar badge entryZone. |
| 4 (Swing) | En Seguimiento | Acciones con Método B (wait_pullback) o MONITOREAR. Re-analizar tras el evento. |
| 5 (Swing) | Journal Swing | Registrar entrada real, N° acciones, SL real y TP real del broker. |
| 1 (Position) | Screener Position | Revisar candidatas de la semana (actualizado lunes). Filtrar por sector, agregar a watchlist. |
| 2 (Position) | Watchlist Position | Analizar cada candidata. Revisar score/51, decisión, vetos, sizing calculator. |
| 3 (Position) | Mercado (Sector Rotation) | Ver qué sectores lideran vs SPY. Priorizar candidatas en sectores fuertes. |
| 4 (Position) | Journal Position | Registrar tesis, entrada, stop, target, acciones. |

---

## MÓDULO SWING TRADING

### 1. Pestaña Screener

Lista de acciones candidatas que cumplen criterios de swing trading. Se actualiza automáticamente a las 9:30am ET (lunes a viernes) vía GitHub Actions. Solo muestra acciones individuales — ETFs excluidos desde el origen.

- Badge verde **"FINVIZ LIVE"**: candidatas reales de Finviz.
- Badge amarillo **"LISTA CURADA"**: fallback cuando Finviz no está disponible.
- Botón ↻ Actualizar screener: dispara el screener manualmente (~60 segundos).
- Filtro por sector. Botones "Agregar todos" / "Quitar todos".

### 2. Pestaña Watchlist — Cómo leer el análisis

| Señal | Contexto | Qué significa |
|---|---|---|
| COMPRAR | ★★★ (Alta) | Técnico sólido y contexto de entrada muy favorable. Setup de máxima calidad. |
| COMPRAR | ★★☆ (Media) | Setup sólido con algún factor de contexto moderado. Operar con posición más pequeña. |
| COMPRAR | ★☆☆ (Baja) | Setup técnico presente pero contexto con limitaciones. Riesgo elevado. |
| MONITOREAR | — | Condiciones técnicas buenas pero hay evento temporal (earnings ≤7d, RSI ≥72, contexto desfavorable). Mover a En Seguimiento. |
| ESPERAR | — | Score 30–44. Sin señal clara. |
| EVITAR | — | Score <30. No operar. |

**Precio:** con 15 minutos de delay durante horario de mercado (badge verde). Fuera de horario muestra el precio de cierre anterior (badge amarillo).

### Badge entryZone — Método A / Método B

| Badge | Estado | Acción |
|---|---|---|
| 🟢 Precio en zona de entrada | `in_zone` | **Método A**: entrar con orden de mercado dentro del rango entryLow–entryHigh. |
| 🟡 Espera pullback | `wait_pullback` | **Método B**: poner orden límite en entryLow–entryHigh y mover a En Seguimiento. |
| 🔴 Precio fuera de zona | `below_zone` | Setup invalidado — no entrar. |

### Indicadores de historial en tarjeta

**Badge verde "TRADE ACTIVO · Entrada $XX.XX · +X.X%"**: aparece cuando hay una operación abierta en el journal para esa acción. Muestra el P&L en vivo vs precio actual. El botón "Guardar en journal" queda deshabilitado mientras haya trade activo.

**Badge gris "Último trade cerrado · fecha · hace Xd"**: aparece cuando el último trade está cerrado. Útil para evitar re-entrar demasiado pronto.

Estos badges se excluyen mutuamente.

### Banner Ex-Dividend (swing)

Aparece solo si la fecha ex-dividend cae dentro del plazo máximo del trade (`max_days`).

- **Banner rojo** (≤5 días): evitar abrir posición — el precio caerá ~el monto del dividendo.
- **Banner ámbar** (6d hasta el plazo): advertencia moderada sobre presión vendedora post-pago.
- **Sin banner** si el ex-dividend es posterior al plazo del trade — no es relevante.

### 3. Pestaña En Seguimiento

Acciones con buenas condiciones técnicas esperando el momento de entrada. El usuario decide explícitamente mover una acción aquí usando el botón "En Seguimiento".

**Casos de uso:**
- Señal **MONITOREAR** (earnings próximos, RSI alto, contexto desfavorable)
- Señal **COMPRAR** con entryZone = `wait_pullback` (Método B)

Re-analizar la acción después del evento o cuando el precio regrese a la zona de entrada.

### 4. Pestaña Journal Swing

Filtros: Todas / Abiertas / Breakeven / Parciales / Cerradas. Búsqueda por ticker.

**Sección "Análisis de la app"** (solo referencia): valores teóricos calculados al momento de guardar — precio sugerido, rango de entrada, SL app, objetivo app, R:B, RSI, SMA21, SMA200.

**Sección "Mi operación real"** (editable):

| Campo | Descripción |
|---|---|
| Precio entrada real | Precio al que realmente compraste. |
| N° acciones | Cantidad de acciones compradas. |
| Stop-loss real | SL configurado en el broker. |
| Take profit real | TP configurado en el broker. |
| Precio cierre real | Precio al que se cerró la posición. |
| Estado | Abierta / Breakeven movido / Parcial cerrada / Cerrada. |
| P&L | (precio cierre − precio entrada) × N° acciones. |

Al filtrar por "Cerradas": aparece resumen con total invertido, P&L USD total y P&L % sobre todas las operaciones cerradas.

> `exit_date` se asigna al cerrar por primera vez. Si el trade ya tenía `exit_date`, se preserva al editar — no se sobrescribe.

### 5. Estrategia Set and Forget — parámetros

| Parámetro | Valor | Descripción |
|---|---|---|
| Zona BUY | entryLow–entryHigh | SMA21 × 0.995 a SMA21 × 1.010 |
| Stop-loss | Mínimo 20 días × 0.995 | Anclado al soporte real. No se mueve. |
| Objetivo | R:B mínimo 2.5x | `target = max(máx 20d, entry_mid + riesgo × 2.5)` |
| Plazo | 10–30 días (ATR) | Calculado con volatilidad real de la acción. |
| Orden broker | OCO | Stop y objetivo simultáneos. Cero intervención manual. |

### 6. Barra de vigencia del setup

El plazo es dinámico por acción (10–30 días según ATR).

| Color | Porcentaje del plazo | Acción |
|---|---|---|
| Verde | 0–30% | Setup activo. El broker cerrará automáticamente. |
| Amarillo | 30–70% | Debilitándose. Si hay ganancia y no avanza, considerar cerrar. |
| Rojo | 70–100% | Alta probabilidad de invalidación. Evaluar cierre. |
| Rojo | Plazo vencido | Cerrar siempre, independiente del P&L. |

---

## MÓDULO POSITION TRADING

### 1. Pestaña Screener Position

Se actualiza automáticamente los **lunes a las 14:00 UTC** (10:00 AM ET) via GitHub Actions.

**Criterios Finviz:** Precio > SMA200, SMA50 > SMA200 (golden cross), RSI 40–65, Vol > 500k, Cap > $300M, NYSE + NASDAQ.

Cada candidata aparece enriquecida con: empresa, sector, crecimiento de revenue/EPS, market cap, y badge **"Base Nsem"**:
- 🟢 Verde (`sound`): base ≥ 7 semanas — estructura consolidada, ideal para breakout.
- 🟡 Ámbar (`short`): base 3–6 semanas — formación incipiente, más riesgo.

### 2. Pestaña Watchlist Position — Cómo leer el scorecard

| Score / 51 | Decisión | Acción |
|---|---|---|
| ≥ 32 | **OPERAR CON CONVICCIÓN** | Tamaño completo según sizing calculator. |
| 22–31 | **OPERAR CON CAUTELA** | Reducir posición 30–50%. |
| < 22 | **NO OPERAR** | No entrar aunque el gráfico se vea bien. |
| Veto activo | **NO OPERAR (VETO)** | Precio < SMA200 o R/R < 2. Independiente del score. |

> **Ajuste macro:** si SPY está bajo SMA200 (mercado bajista), el score se penaliza -4 puntos (regla Weinstein). Warning visible en tarjeta.

### Badges y warnings en tarjeta position

| Badge / Warning | Descripción |
|---|---|
| Caché viejo | >24h → badge naranja. >48h → badge rojo. Evita operar con datos desactualizados. |
| Earnings warning | <7d → banner rojo (evitar entrada). 7–14d → naranja. Tabla: badge `E{días}d` en columna DECISIÓN. |
| Ex-dividend warning | <7d → rojo, 7–14d → naranja. Solo si `dividendYield > 0.3%`. |
| RS SPY | Valor real sin cap (ej: +43% vs SPY). Antes mostraba máximo ±5. |
| Confidence score | Alta (≥6/7 criterios con datos reales), Media (4/7), Baja (<4/7). Visible debajo del score bar. |
| Stage badge | Stage 1/2/3/4 de Weinstein. Warning prominente si Stage 4. |
| Mercado bajista | Warning si SPY < SMA200. Weinstein: nunca comprar Stage 2 individual en Stage 4 del mercado. |

### Sizing calculator integrado

Disponible en cada PositionCard. Inputs: **capital total (USD)** + **% de riesgo por operación** (default 1%).

Calcula automáticamente:
- **Número de acciones** = (capital × riskPct) / (entry − stop)
- **Monto invertido** = acciones × precio de entrada
- **Ganancia potencial** = (target − entry) × acciones
- **Pérdida máxima** = (entry − stop) × acciones

Los precios de entry/stop/target se toman de los niveles sugeridos por el análisis. Revisar y ajustar manualmente si es necesario.

### Los 7 criterios del scorecard

| Criterio | Peso | Qué evalúa |
|---|---|---|
| Narrativa | ×3 | Claude Haiku: catalizador estructural de crecimiento (sector en expansión, liderazgo de producto, aceleración de adopción). |
| Precio > SMA200 | ×3 | Gradual: >15% sobre SMA200 = 3, 5–15% = 2, 0–5% = 1, bajo SMA200 = 0 + VETO. |
| Estructura técnica | ×3 | Stage Weinstein + HH/HL combinados. Stage 2 emergente (slope SMA30 > 1.5%) = máxima puntuación. |
| RS relativa | ×2 | Mansfield RS vs SPY. Bonus +1 si además lidera su sector ETF. |
| Calidad fundamental | ×3 | Revenue growth, EPS growth, FCF positivo, márgenes. |
| Punto de entrada | ×1 | Breakout con volumen / pullback a SMA50 / extendido. |
| Ratio R/R | ×2 | R/R 2.5x fijo. Veto automático si R/R < 2. |

### 3. Tab Mercado — Sector Rotation

Tabla de 11 sectores SPDR (XLK, XLV, XLE, XLF, XLI, XLU, XLP, XLB, XLY, XLC, XLRE) ordenados por **RS Mansfield vs SPY** descendente.

- Badges **TOP** (verde) para los 3 primeros sectores.
- Badges **WEAK** (rojo) para los 3 últimos.
- Header muestra precio y posición de SPY vs SMA200.
- Cache 1 hora.

**Cómo usarlo:** antes de analizar una candidata, verificar que su sector esté en la mitad superior de la tabla. Una acción en Stage 2 dentro de un sector débil tiene probabilidad de éxito mucho menor.

### 4. Pestaña Journal Position

Estados del trade: `planning` → `open` → `closed`.

Campos: ticker, empresa, sector, fecha entrada, precio entrada, stop, target, acciones, notas, scorecard (snapshot completo al momento de entrar).

Al cerrar: precio de cierre, fecha de cierre, P&L calculado automáticamente.

### 5. Pestaña Dashboard Position

- P&L mensual en barras.
- Win rate total.
- Win rate separado por tipo de decisión: **CONVICCIÓN** vs **CAUTELA**.

Útil para calibrar si las operaciones con cautela (22–31 puntos) merecen el riesgo en tu historial personal.

---

## Lo que la app hace y lo que no hace

### Hace bien

- Identifica acciones en **Stage 2 emergente** (no tardío) con fundamentos sólidos y RS positiva.
- Distingue empresa buena de entrada técnica buena (AAPL con fundamentales excelentes pero en Stage 3 = NO OPERAR).
- Calcula stop técnicamente válido (base semanal real, no % arbitrario).
- Fuerza disciplina R/R 2.5x en cada operación.
- Penaliza entradas en mercado bajista (Weinstein: nunca comprar Stage 2 individual en Stage 4 del mercado).

### Revisar manualmente antes de ejecutar

- **Noticias recientes** del ticker (earnings, aranceles, cambios de guidance, lawsuits).
- **Volumen intradiario** en tiempo real (la app tiene 15 min de delay).
- **% del portafolio total** a concentrar en una posición — el sizing calculator calcula acciones por riesgo, no diversificación del portafolio.
- **Haiku no conoce eventos recientes**: el prompt usa datos históricos de Alpha Vantage. Eventos post-cutoff no están incluidos.
