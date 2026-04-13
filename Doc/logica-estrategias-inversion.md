# KNNS TradeAgent — Lógica y Criterios de Inversión
> Documento de revisión para analistas · Última actualización: 2026-04-13

Este documento describe la lógica completa de evaluación y selección de empresas para las dos estrategias implementadas en la plataforma. Está escrito en términos de proceso y criterios de inversión, sin referencias a implementación técnica.

---

## PARTE I — SWING TRADING

**Horizonte:** 10 a 30 días (calculado dinámicamente por volatilidad de cada acción)
**Filosofía:** Set-and-forget. Una entrada, un stop fijo, un objetivo fijo. Sin gestión activa de la posición una vez abierta.

---

### 1. Pre-selección de candidatos (Screener)

El universo inicial se obtiene de [[Finviz]] aplicando los siguientes filtros simultáneos:

| Criterio                 | Valor                                                                |
| ------------------------ | -------------------------------------------------------------------- |
| Mercados                 | NYSE y NASDAQ únicamente                                             |
| Tipo de instrumento      | Acciones individuales (excluye ETFs, fondos y REITs desde el origen) |
| Precio mínimo            | > $20                                                                |
| Volumen promedio diario  | > 500.000 acciones                                                   |
| RSI                      | Entre 30 y 60                                                        |
| Tendencia de corto plazo | [[EMA20]] cruzando al alza [[EMA50]] (proxy de SMA21 > SMA50)        |

La lista resultante se actualiza automáticamente cada día de mercado a las 9:30am ET. Como segunda capa de filtro, se excluye una lista de ~80 ETFs y fondos conocidos que puedan haber pasado los filtros de Finviz.

El universo de candidatos es el punto de partida; el análisis individual de cada acción se realiza de forma separada al agregarla a la watchlist.

---

### 2. Análisis individual de cada acción

El análisis se estructra en tres capas independientes que se calculan en secuencia:

1. **Score técnico puro** (0–100): evalúa únicamente indicadores de precio y momentum
2. **Estrellas de contexto de entrada** (0–3): evalúa si el *momento* es propicio para entrar, independientemente del score técnico
3. **Señal final**: combina las dos capas anteriores en una recomendación de acción

---

### 3. Capa 1 — Score técnico (0–100)

El score parte de un valor base de **50 puntos** (postura neutral). Se suman o restan puntos según siete factores. El score no puede bajar de 0 ni superar 100.

#### Factor 1 — Tendencia de corto plazo: SMA21 vs SMA50

Evalúa si la media móvil de 21 días está por encima o por debajo de la de 50 días.

| Condición | Ajuste al score |
|---|---|
| SMA21 > SMA50 | +10 puntos |
| SMA21 ≤ SMA50 | −10 puntos |

**Razón:** La relación SMA21/SMA50 es el filtro principal de dirección del mercado a corto plazo (metodología IBD/CAN SLIM). Un cruce alcista reciente (SMA21 acaba de superar SMA50, diferencia < 2%) se trata como una señal positiva emergente.

---

#### Factor 2 — RSI (14 períodos diarios)

El RSI mide la velocidad y magnitud de los movimientos de precio recientes. La zona ideal para swing trading es un pullback sin sobrecompra.

| Condición RSI | Ajuste | Interpretación |
|---|---|---|
| 40 – 60 | +8 | Zona ideal de pullback: momentum presente sin sobrecompra |
| < 30 | +5 | Sobreventa técnica: posible rebote, pero con mayor riesgo |
| 65 – 75 | −5 | Zona de calentamiento: no es sobrecompra extrema pero el margen se reduce |
| > 75 | −10 | Sobrecompra avanzada: alta probabilidad de corrección inminente |
| 30 – 40 o 60 – 65 | 0 | Zona neutral |

**Umbral crítico:** RSI ≥ 72 con score positivo produce señal MONITOREAR en lugar de COMPRAR (ver Capa 3), recomendando esperar un pullback al rango 55–65 para una entrada de mejor calidad.

---

#### Factor 3 — Posición respecto a la SMA200

Determina la tendencia estructural de largo plazo.

| Condición | Ajuste | Interpretación |
|---|---|---|
| Precio > SMA200 | +6 | Tendencia alcista de largo plazo vigente |
| Precio < SMA200 con SMA21 > SMA50 y momentum positivo (recuperación) | −3 | Posible reversión en marcha — menos penalización |
| Precio < SMA200 sin señales de recuperación | −6 | Tendencia bajista estructural |

**Razón:** Para swing trading, es posible operar acciones bajo SMA200 si la tendencia de corto plazo es alcista y el momentum es positivo (recuperaciones técnicas). El ajuste diferenciado reconoce esta distinción.

---

#### Factor 4 — Fuerza Relativa Mansfield vs S&P500

Compara el rendimiento de la acción vs el S&P500 (representado por SPY) en el período de hasta 52 semanas disponibles.

**Fórmula:**
> RS bruto = [ (precio\_actual / precio\_52s) / (SPY\_actual / SPY\_52s) − 1 ] × 100

El resultado se normaliza dividiendo por 5, produciendo una escala aproximada de −5 a +5.

| RS Mansfield | Ajuste | Interpretación |
|---|---|---|
| > 2 | +8 | Líder claro del mercado |
| 0 a 2 | +4 | Supera al S&P500 |
| −1 a 0 (con cruce SMA reciente) | 0 | Rezago leve en período de cambio |
| −2 a −1 | −6 | Rezagada vs el mercado |
| < −2 | −12 | Muy rezagada — señal de debilidad severa |

**Razón:** La fortaleza relativa es uno de los mejores predictores de continuación. Acciones con RS fuerte tienden a seguir liderando; acciones con RS negativo tienden a seguir rezagándose, incluso si su análisis técnico independiente parece positivo.

---

#### Factor 5 — Volumen relativo (vs promedio de 20 días)

Mide la participación institucional comparando el volumen actual con el promedio de los últimos 20 días.

| Volumen relativo | Ajuste | Interpretación |
|---|---|---|
| ≥ 100% del promedio | +4 | Participación institucional sana |
| 70% – 99% | +2 | Participación ligeramente baja pero aceptable |
| 50% – 69% | 0 | Baja participación, neutral |
| < 50% | −8 | Volumen muy bajo — señal de desinterés institucional |

**Razón:** El volumen es el combustible del movimiento. Un rally con volumen bajo tiene alta probabilidad de revertirse. Un pullback con volumen bajo (desinterés vendedor) es una condición favorable para comprar.

---

#### Factor 6 — Momentum de 4 semanas (~20 días de trading)

Mide el cambio porcentual del precio en las últimas 4 semanas. Busca momentum positivo moderado, penalizando tanto la sobreextensión como la debilidad.

| Cambio en 4 semanas | Ajuste | Interpretación |
|---|---|---|
| +5% a +20% | +3 | Momentum saludable — avance sostenible |
| +20% o más | −5 | Sobreextensión — corrección probable |
| 0% a −5% | −3 | Debilidad leve |
| < −5% | −6 | Debilidad significativa |

---

#### Factor 7 — Distancia al máximo de 20 días

Evalúa el espacio disponible antes de la resistencia técnica inmediata (el máximo reciente de 20 días). Una entrada cercana a una resistencia fuerte limita el potencial de ganancia antes del primer obstáculo.

| Distancia al máximo 20d | Ajuste | Interpretación |
|---|---|---|
| > 5% de margen | +3 | Buen espacio antes de resistencia |
| 2% – 5% | 0 | Espacio aceptable |
| < 2% | −5 | Resistencia inmediata — riesgo de rechazo |

---

### 4. Capa 2 — Estrellas de contexto de entrada (0–3★)

Las estrellas evalúan si el *momento actual* es propicio para entrar, independientemente de la fortaleza técnica. Parten de 3★ y se descuentan penalizaciones según los factores de riesgo de timing.

**Regla base:** Si el score técnico es menor a 45, las estrellas son automáticamente 0 sin importar el contexto. No tiene sentido evaluar el timing si el setup técnico es insuficiente.

#### Penalización 1 — Earnings próximos

| Días hasta earnings | Penalización |
|---|---|
| < 7 días | −2★ |
| 7 a 14 días | −1★ |
| > 14 días | Sin penalización |

**Razón:** Los earnings son eventos binarios de alto impacto. Incluso un setup técnico perfecto puede destruirse en segundos con un resultado inesperado. La zona de 7–14 días anterior a earnings es de precaución; dentro de 7 días es de evitación.

#### Penalización 2 — Ex-dividend inminente

Se activa únicamente cuando el yield anual del dividendo supera 0.3% (descarta acciones con dividendos marginales que no tienen impacto real en el precio).

| Condición | Penalización |
|---|---|
| Ex-dividend en ≤ 5 días y yield > 0.3% | −2★ |
| Ex-dividend dentro del primer 40% del plazo máximo del trade y yield > 0.3% | −1★ |
| Ex-dividend fuera del plazo del trade | Sin penalización |

**Razón:** El precio cae aproximadamente el monto del dividendo en la fecha ex-dividend. Si este evento ocurre durante el trade, reduce el potencial de ganancia. Si ocurre fuera del plazo estimado del trade, no es relevante y no se penaliza.

#### Penalización 3 — Precio sobre el target de analistas

| Condición | Penalización |
|---|---|
| Precio actual > 10% por encima del target de precio promedio de analistas | −1★ |

**Razón:** El consenso institucional de analistas representa el precio justo estimado por los grandes bancos y casas de inversión. Si la acción ya superó ese nivel en más de 10%, el upside percibido por el mercado institucional se vuelve negativo o neutro.

#### Penalización 4 — Trampa alcista potencial

| Condición | Penalización |
|---|---|
| Mansfield RS < −2 con SMA21 > SMA50 (técnica alcista pero RS muy negativa) | −1★ |

**Razón:** Cuando el análisis técnico de la acción individual es positivo pero la fuerza relativa vs el mercado es muy negativa, existe un riesgo de trampa alcista: el movimiento técnico local puede ser un rebote dentro de una tendencia bajista relativa persistente.

---

### 5. Capa 3 — Señal final

La señal final combina el score técnico, las estrellas de contexto y el RSI. La lógica es determinista y no depende de inteligencia artificial.

| Score | Contexto (★) | RSI | Señal | Descripción |
|---|---|---|---|---|
| < 30 | cualquiera | cualquiera | **EVITAR** | Setup muy débil, múltiples factores en contra |
| 30 – 44 | cualquiera | cualquiera | **ESPERAR** | Condiciones insuficientes, sin niveles operacionales |
| ≥ 50 | cualquiera | ≥ 72 | **MONITOREAR** | Setup bueno pero sobrecomprado, esperar pullback RSI a 55–65 |
| ≥ 50 | 0 – 1★ con razones | < 72 | **MONITOREAR** | Condiciones técnicas buenas pero timing desfavorable (earnings, ex-div) |
| ≥ 65 | 3★ | < 72 | **COMPRAR** alta confianza | Setup sólido, contexto limpio |
| ≥ 65 | 2★ | < 72 | **COMPRAR** media confianza | Setup sólido con algún factor de precaución |
| ≥ 65 | 1★ | < 72 | **COMPRAR** baja confianza | Setup técnico presente, contexto desfavorable — posición reducida |
| 45 – 64 | 3★ | < 72 | **COMPRAR** media confianza | Condiciones técnicas aceptables con contexto limpio |
| 45 – 64 | < 3★ | < 72 | **COMPRAR** baja confianza | Setup débil con limitaciones de contexto — riesgo elevado |

---

### 6. Niveles operacionales (entrada, stop, objetivo)

Los niveles se calculan anclados a soportes y resistencias técnicas reales, no a porcentajes fijos. El objetivo es que sean estables entre un análisis y otro — cambian solo cuando cambia el precio de cierre diario o el rango de 20 días.

#### Zona de entrada

- **Límite inferior:** SMA21 × 0.995 (0.5% por debajo de SMA21)
- **Límite superior:** SMA21 × 1.010 (1% por encima de SMA21)

**Razón:** La SMA21 actúa como soporte dinámico en tendencias alcistas. La zona de ±1% alrededor de ella representa el rango de pullback limpio a ese soporte.

#### Stop-loss

- **Nivel:** Mínimo de los últimos 20 días × 0.995 (0.5% por debajo del soporte real)

**El stop es fijo — no se desplaza una vez abierta la posición.** Se ancla al soporte técnico real más reciente. No se usa un porcentaje arbitrario de pérdida máxima.

#### Objetivo (target)

- **Nivel:** El mayor entre: (a) el máximo de los últimos 20 días, o (b) la entrada media más 2.5 veces el riesgo (R/R mínimo garantizado de 2.5x)

**El objetivo también es fijo** — se establece al abrir la posición y no se ajusta.

#### Plazo máximo del trade

Se calcula dinámicamente para cada acción usando su ATR (Average True Range, volatilidad promedio diaria real). La fórmula estima cuántos días tomaría alcanzar el objetivo a ese ritmo de movimiento, multiplicado por un factor 2.5 que reconoce que el precio no se mueve linealmente hacia el objetivo.

El plazo resultante se limita al rango de **10 a 30 días**.

#### Badge de zona de entrada (Método A / Método B)

| Estado | Condición | Acción recomendada |
|---|---|---|
| En zona *(verde)* | Precio está dentro del rango entryLow–entryHigh | Método A: orden de mercado inmediata |
| Espera pullback *(ámbar)* | Precio sobre el rango (extendido) | Método B: orden límite en el rango, mover a seguimiento |
| Fuera de zona *(rojo)* | Precio bajo SMA21 (setup roto) | No entrar — setup invalidado |
| Aproximando *(neutro)* | Precio entre SMA21 −2% y entryLow | Preparar orden, posición cerca del rango |

---

### 7. Análisis narrativo (Claude Haiku)

Claude Haiku recibe los datos técnicos y fundamentales de la acción y genera un texto corto de análisis. **No determina la señal ni los niveles** — esos son calculados matemáticamente. El rol de Haiku es exclusivamente explicar en lenguaje natural las condiciones observadas.

La información recibida por Haiku incluye: precio, SMA21/50/200, RSI, volumen relativo, máximo/mínimo de 20 días, ATR, momentum de 4 semanas, tendencia objetiva (SMA21 vs SMA50), posición vs SMA200, nivel de RSI contextualizado, proximidad de earnings y, si aplica, la advertencia de ex-dividend dentro del plazo del trade.

---

## PARTE II — POSITION TRADING

**Horizonte:** Semanas a 12 meses
**Filosofía:** Identificar empresas en Stage 2 de Weinstein (tendencia alcista establecida) con fundamentos sólidos, fuerza relativa positiva y un catalizador estructural de crecimiento. Operar el trend completo con stops amplios anclados a la base de consolidación.

---

### 1. Pre-selección de candidatos (Screener semanal)

El universo se obtiene de Finviz cada lunes a las 10:00 AM ET, aplicando los siguientes filtros:

| Criterio | Valor | Razón |
|---|---|---|
| Mercados | NYSE y NASDAQ | Liquidez mínima garantizada |
| Tipo | Solo acciones individuales | Excluye ETFs, fondos y notas estructuradas |
| Market cap | > $300 millones | Liquidez suficiente para position trading |
| Volumen promedio diario | > 500.000 acciones | Facilidad de entrada y salida |
| Precio mínimo | > $10 | Excluye penny stocks con comportamiento errático |
| RSI | 40 – 65 | Momentum presente sin sobrecompra — zona ideal de acumulación |
| SMA50 vs SMA200 | SMA50 > SMA200 (golden cross) | Confirmación de tendencia alcista de mediano plazo |
| Precio vs SMA200 | Precio > SMA200 | Tendencia alcista de largo plazo activa |

Cada candidato es enriquecido con datos fundamentales (crecimiento de ingresos, EPS, market cap, sector, industria) y con análisis de la base de consolidación semanal (ver sección 4).

---

### 2. Scorecard de evaluación (7 criterios, máximo 51 puntos)

Cada candidato se evalúa con un scorecard de 7 criterios. Cada criterio tiene una escala de 0 a 3 y un peso multiplicador. El score total máximo teórico es **51 puntos**.

| # | Criterio | Peso | Score | Puntos máx |
|---|---|---|---|---|
| 1 | Narrativa activa (catalizador) | ×3 | 0–3 | 9 |
| 2 | Precio vs SMA200 | ×3 | 0–3 | 9 |
| 3 | Estructura técnica (Stage + HH/HL) | ×3 | 0–3 | 9 |
| 4 | Fuerza relativa (Mansfield RS) | ×2 | 0–3 | 6 |
| 5 | Calidad fundamental | ×3 | 0–3 | 9 |
| 6 | Punto de entrada | ×1 | 0–3 | 3 |
| 7 | Ratio Riesgo/Recompensa | ×2 | 0–3 | 6 |
| | **Total máximo** | | | **51** |

#### Umbrales de decisión

| Score total | Decisión | Tamaño de posición |
|---|---|---|
| ≥ 32 puntos | **OPERAR CON CONVICCIÓN** | Tamaño completo |
| 22 – 31 puntos | **OPERAR CON CAUTELA** | Reducir 30–50% |
| < 22 puntos | **NO OPERAR** | — |

#### Vetos absolutos (independientes del score)

Existen dos condiciones que producen veto automático sin importar el score total:
1. **Precio bajo SMA200** (criterio 2 = 0): la tendencia estructural está rota
2. **Ratio R/R < 2.0** (criterio 7 con R/R calculado < 2x): el trade no compensa el riesgo

Un veto hace que la decisión sea NO OPERAR independientemente de los demás criterios.

#### Ajuste macro (penalización Weinstein)

Si el S&P500 (SPY) está por debajo de su SMA200 en el momento del análisis, se aplica una **penalización de −4 puntos** al score total. Esto implementa la regla de Weinstein: nunca comprar acciones individuales en Stage 2 cuando el mercado está en Stage 4 (tendencia bajista). El efecto práctico es que el umbral efectivo de CONVICCIÓN sube de 32 a 36 en mercados bajistas.

---

### 3. Criterio 1 — Narrativa activa (catalizador estructural)

**Peso: ×3 | Evaluación: Claude Haiku (IA)**

Este es el único criterio subjetivo del scorecard. Evalúa si existe un catalizador estructural de crecimiento que justifique mantener la posición durante meses, no solo días.

| Score | Descripción |
|---|---|
| 0 | Sin narrativa clara. Negocio maduro sin catalizador visible. |
| 1 | Posible catalizador pero débil, maduro o sin confirmación en números. |
| 2 | Narrativa activa con evidencia en ingresos o márgenes crecientes. |
| 3 | Tema dominante del mercado con flujo institucional confirmado (IA, GLP-1, ciberseguridad líder). |

Claude Haiku recibe: nombre de la empresa, sector, industria, crecimiento de revenue y EPS, márgenes, P/E, market cap, número de analistas buy/strong buy, Stage Weinstein y fecha de próximos earnings. Se le pide ser conservador: el score 3 requiere evidencia muy clara.

**Importante:** Haiku no conoce eventos recientes no reflejados en los datos históricos (cambios de guidance, aranceles, cambios de CEO, lawsuits). El análisis de narrativa debe complementarse con revisión manual de noticias recientes.

---

### 4. Criterio 2 — Precio vs SMA200 (tendencia estructural)

**Peso: ×3 | Evaluación: automática**

La distancia a la SMA200 es gradual — no es lo mismo acabar de cruzar la media que llevar meses sobre ella con la tendencia madura.

| Condición | Score | Interpretación |
|---|---|---|
| Precio > 15% sobre SMA200 | 3 | Tendencia alcista madura y confirmada |
| Precio 5%–15% sobre SMA200 | 2 | Tendencia alcista establecida |
| Precio 0%–5% sobre SMA200 | 1 | Recién cruzado — confirmar sostenibilidad |
| Precio < SMA200 | 0 + **VETO** | Tendencia bajista estructural — no operar |

---

### 5. Criterio 3 — Estructura técnica (Stage Weinstein + HH/HL)

**Peso: ×3 | Evaluación: automática**

Este criterio combina dos análisis sobre velas semanales para determinar la calidad de la tendencia alcista.

#### Stage Weinstein (análisis semanal)

El Stage se determina usando la SMA30 semanal (media de 30 semanas) y su pendiente en las últimas 4 semanas.

| Stage | Condición de precio | Pendiente SMA30 (últimas 4 semanas) | Descripción |
|---|---|---|---|
| **Stage 2 fuerte** | Precio > SMA30 semanal | > +1.5% | Tendencia acelerando — ideal |
| **Stage 2 establecido** | Precio > SMA30 semanal | +0.5% a +1.5% | Tendencia confirmada |
| **Stage 2 tardío** | Precio > SMA30 semanal | < +0.5% | SMA30 aplanándose — posible distribución inminente |
| **Stage 1** | Precio < SMA30 semanal | Plana o suavizándose | Acumulación — posible breakout anticipatorio |
| **Stage 3/4** | Variable | Negativa | Distribución o declive — penaliza |

La pendiente de la SMA30 es crítica en la metodología Weinstein: distingue un Stage 2 emergente (mejor momento de entrada) de un Stage 2 tardío (peor momento, distribución posible). Esta distinción no está presente en la mayoría de screeners convencionales.

#### Estructura Higher Highs / Higher Lows (últimas 26 semanas)

Se detectan los máximos y mínimos pivotales de las últimas 26 semanas usando los highs y lows reales de cada vela semanal (no los cierres). Un pivot high se define como una semana cuyo high supera tanto al de la semana anterior como al de la semana siguiente. Análogamente para pivot lows.

Solo se cuentan pares consecutivos con movimiento mínimo del 0.5% (filtra micro-oscilaciones laterales). Una tendencia perfectamente lineal sin pullbacks produce score 0 — esto es correcto, ya que no genera pivots reales.

| Suma de HH + HL consecutivos | Score HH/HL |
|---|---|
| ≥ 4 | 3 — estructura alcista fuerte |
| ≥ 2 | 2 — estructura alcista clara |
| ≥ 1 | 1 — estructura incipiente |
| 0 | 0 — sin estructura o lateral |

#### Combinación Stage + HH/HL

El score de estructura técnica se calcula así:

| Stage | Stage base | Condición HH/HL para bonus | Score final |
|---|---|---|---|
| Stage 2 fuerte (slope > 1.5%) | 3 | HH/HL ≥ 2 → +1 (máx 3) | 3 |
| Stage 2 establecido (slope 0.5–1.5%) | 2 | HH/HL ≥ 2 → +1 | 2 ó 3 |
| Stage 2 tardío (slope < 0.5%) | 1 | HH/HL ≥ 2 → +1 | 1 ó 2 |
| Stage 1 | 1 | HH/HL ≥ 2 → +1 | 1 ó 2 |
| Stage 3/4 o sin datos | 0 | Sin bonus | 0 |

El bonus de HH/HL solo aplica si el stage base es mayor a 0 — no se puede compensar un Stage 4 con una buena estructura de pivots.

---

### 6. Criterio 4 — Fuerza Relativa vs S&P500 y sector

**Peso: ×2 | Evaluación: automática**

#### RS Mansfield vs S&P500

Misma fórmula que en swing trading (ver Parte I, sección 3, Factor 4). El valor normalizado (escala −5 a +5) se convierte en score:

| RS Mansfield | Score base | Interpretación          |
| ------------ | ---------- | ----------------------- |
| > 2          | 3          | Líder claro del mercado |
| 0 a 2        | 2          | Supera al [[S&P500]]    |
| −1 a 0       | 1          | Similar al [[S&P500]]   |
| < −1         | 0          | Rezagada vs el mercado  |

#### Bonus por liderazgo sectorial

Si la RS de la acción vs el ETF de su sector propio es mayor a +1 (Mansfield normalizado), y el score base es menor a 3, se suma +1 punto (máximo 3). El ETF de sector se mapea según la clasificación de [[Alpha Vantage]] (XLK para Technology, XLV para Healthcare, XLE para Energy, etc.).

---

### 7. Criterio 5 — Calidad fundamental

**Peso: ×3 | Evaluación: semi-automática (datos de Alpha Vantage OVERVIEW y CASH_FLOW)**

Se evalúan tres dimensiones del negocio, cada una puede aportar 1 punto al score (máximo 3):

#### Dimensión A — Crecimiento de ingresos (Revenue YoY)

| Condición | Contribución |
|---|---|
| Revenue growth > 10% YoY | +1 punto (crecimiento fuerte) |
| Revenue growth 0%–10% YoY | 0 puntos adicionales (crecimiento moderado) |
| Revenue growth < 0% | 0 puntos (contracción) |

#### Dimensión B — Crecimiento de beneficios (EPS YoY)

| Condición | Contribución |
|---|---|
| EPS growth > 20% YoY | +1 punto (aceleración de beneficios) |
| EPS growth 0%–20% con revenue > 10% | +1 punto (combo crecimiento sólido) |
| EPS growth 0%–20% con revenue moderado (0–10%) | +1 punto (juntos valen 1 punto si EPS es positivo) |
| EPS growth < 0% | 0 puntos |

#### Dimensión C — Calidad del negocio (FCF y márgenes)

Se evalúa cualquiera de estas condiciones (basta con una):

| Condición | Contribución |
|---|---|
| Free Cash Flow positivo (último reporte anual) | +1 punto |
| Margen neto > 10% | +1 punto |
| Margen operativo > 15% (si margen neto no disponible) | +1 punto |

**Score final: mínimo 0, máximo 3** (una por cada dimensión).

---

### 8. Criterio 6 — Punto de entrada

**Peso: ×1 | Evaluación: automática**

Evalúa la calidad técnica del momento de entrada, combinando la posición del precio respecto a la SMA50, el volumen de breakout y la calidad de la base de consolidación semanal.

#### Detección de base de consolidación (análisis semanal)

Se analiza la acción retroactivamente buscando el período más reciente de consolidación en precio:
- **Base válida:** rango alto-bajo ≤ 35% de amplitud, sin cierres más de 15% por debajo del soporte mínimo de la base
- **Base sólida (sound):** ≥ 7 semanas
- **Base corta (short):** 3 a 6 semanas
- **Sin base:** < 3 semanas
- Se busca hacia atrás hasta un máximo de 52 semanas

#### Volumen de breakout

Se compara el volumen máximo de los últimos 5 días vs el promedio de los 20 días previos (días −25 a −5, excluyendo los 5 días más recientes para no contaminar el denominador con el propio breakout). Un ratio ≥ 150% se considera volumen de breakout confirmado.

#### Scoring del punto de entrada

| Condición | Score | Descripción |
|---|---|---|
| Precio cerca del máximo de 52 semanas (≥ 95%) + volumen de breakout confirmado | 3 | Breakout en zona de máximos con volumen institucional |
| Precio cerca del máximo de 52 semanas sin volumen confirmado | 2 | Breakout en máximos sin confirmación institucional |
| Pullback a SMA50 (−5% a +10%) con volumen bajo (< 80% promedio) | 3 | Pullback limpio a soporte dinámico — entrada ideal |
| Pullback a SMA50 con volumen normal | 2 | Cerca del soporte, volumen no confirma absorción vendedora |
| Precio 10%–25% sobre SMA50 | 2 | Algo extendido, esperar pullback |
| Precio > 25% sobre SMA50 | 1 | Muy extendido — corrección probable antes de continuar |
| Precio < −5% bajo SMA50 | 1 | Debilidad — posible cambio de tendencia o corrección prolongada |

---

### 9. Criterio 7 — Ratio Riesgo/Recompensa

**Peso: ×2 | Evaluación: automática (estimado preliminar)**

El R/R se calcula con los niveles sugeridos automáticamente (ver sección 11). Es una estimación preliminar — el usuario debe ajustar con sus propios niveles reales de entrada, stop y objetivo.

| R/R calculado | Score | Nota |
|---|---|---|
| ≥ 3x | 3 | Excelente relación riesgo/recompensa |
| 2x – 3x | 2 | Buena relación |
| 1.5x – 2x | 1 | Mínimo aceptable |
| < 2x | 1 + **VETO** | El trade no compensa el riesgo — veto automático |

---

### 10. Confidence score del análisis

Para cada análisis se calcula una métrica de confianza que indica cuántos de los 7 criterios cuentan con datos reales vs valores por defecto:

| Criterios con datos reales | Nivel de confianza |
|---|---|
| ≥ 6 de 7 | Alta |
| 4 de 7 | Media |
| < 4 de 7 | Baja |

Los criterios que pueden quedar sin datos reales son: estructura técnica (si hay menos de 34 semanas de datos), RS Mansfield (si no hay suficiente historia), calidad fundamental (si Alpha Vantage no tiene datos), R/R preliminar (si los niveles no están disponibles), y narrativa Haiku (si la IA falla). Precio vs SMA200 y punto de entrada siempre tienen datos reales.

---

### 11. Niveles operacionales (entrada, stop, objetivo)

Los niveles son estimaciones automáticas orientativas. El usuario debe revisarlos y ajustarlos con sus propios niveles reales antes de operar.

#### Precio de entrada sugerido

- Si el precio está en zona de máximos de 52 semanas (≥ 95% del máximo): **precio actual** (breakout)
- Si no: **SMA50** (pullback al soporte dinámico)

#### Stop-loss sugerido

El stop se ancla al soporte técnico real de la base de consolidación detectada:

- Si existe base válida (sound o short): **mínimo de los lows semanales de la base × 0.98** (2% de margen bajo el soporte real)
- Si no hay base: **mínimo de los últimos 10 días diarios × 0.98**

**Razón:** Un stop fijado en el mínimo de la base respeta la estructura técnica que el mercado ya validó como soporte. Un stop arbitrario basado en porcentaje ignora esa información y puede quedar dentro del rango normal de fluctuación.

#### Objetivo (target) sugerido

- **Target = entrada + (entrada − stop) × 2.5** (R/R fijo de 2.5x)

#### Sizing calculator

La herramienta incluye una calculadora que permite al usuario determinar el tamaño de posición según su gestión de capital:

- **Inputs:** capital total en USD + porcentaje de riesgo por operación (por defecto 1%)
- **Número de acciones** = (capital × % riesgo) / (entrada − stop)
- **Monto invertido** = acciones × precio de entrada
- **Ganancia potencial** = (objetivo − entrada) × acciones
- **Pérdida máxima** = (entrada − stop) × acciones

---

### 12. Warnings y alertas adicionales

Además del scorecard, la plataforma muestra alertas contextuales que el sistema detecta automáticamente:

| Warning | Condición | Severidad |
|---|---|---|
| Datos desactualizados | Cache del análisis con > 24 horas de antigüedad | Naranja |
| Datos muy desactualizados | Cache con > 48 horas | Rojo |
| Earnings próximos | < 7 días | Rojo — evitar entrada |
| Earnings cercanos | 7 – 14 días | Naranja — precaución |
| Ex-dividend inminente | < 7 días y yield > 0.3% | Rojo |
| Ex-dividend cercano | 7 – 14 días y yield > 0.3% | Naranja |
| Mercado bajista | SPY < SMA200 | Warning global en todas las tarjetas |
| Stage 4 | Precio en declive activo (Stage 4 Weinstein) | Warning prominente |
| Veto activo | Cualquier criterio de veto activado | Bloquea la decisión |

---

## PARTE III — Comparativa de estrategias

| Dimensión | Swing Trading | Position Trading |
|---|---|---|
| **Horizonte** | 10 – 30 días | Semanas a 12 meses |
| **Filtro inicial (screener)** | Precio > $20, Vol > 500k, RSI 30–60, SMA21 > SMA50 | Precio > $10, Cap > $300M, Vol > 500k, RSI 40–65, golden cross, precio > SMA200 |
| **Frecuencia screener** | Diaria (días de mercado, 9:30am ET) | Semanal (lunes, 10:00am ET) |
| **Sistema de scoring** | Score numérico 0–100 + estrellas contexto 0–3 | Scorecard ponderado 7 criterios, máximo 51 pts |
| **Fuerza relativa** | Mansfield RS vs SPY (normalizado ±5) | Mansfield RS vs SPY + RS vs ETF de sector propio |
| **Análisis técnico primario** | SMA21 vs SMA50, RSI, volumen, momentum 4 semanas | Stage Weinstein (SMA30 semanal), HH/HL (pivots semanales) |
| **Análisis fundamental** | Solo contexto (target analistas, earnings, dividendo) | Criterio de peso ×3 (revenue growth, EPS, FCF, márgenes) |
| **Catalizador** | No evaluado explícitamente | Criterio de peso ×3 evaluado por IA (narrativa) |
| **Stop-loss** | Mínimo 20 días × 0.995 | Mínimo de la base semanal × 0.98 |
| **Objetivo** | Máximo 20 días o R/R 2.5x (el mayor) | R/R 2.5x desde la entrada |
| **Gestión activa** | Ninguna (set-and-forget con OCO) | Stop y objetivo fijos, pero horizonte más largo permite revisión |
| **Contexto macro** | No penaliza score | −4 puntos si SPY < SMA200 (regla Weinstein) |
| **Vetos automáticos** | Ninguno en el score (las estrellas reducen a 0) | Precio < SMA200 y/o R/R < 2 |
| **Rol de la IA** | Texto narrativo explicativo (no decide) | Score de narrativa/catalizador (1 de 7 criterios) |

---

## PARTE IV — Fuentes de datos y limitaciones

### Fuentes

| Dato | Fuente | Latencia |
|---|---|---|
| Precios históricos diarios | Alpha Vantage TIME_SERIES_DAILY | Cierre del día anterior |
| Precio del día actual | Alpha Vantage GLOBAL_QUOTE | 15 minutos de delay (plan premium) |
| Datos fundamentales | Alpha Vantage OVERVIEW | Trimestral (último reporte) |
| Free Cash Flow | Alpha Vantage CASH_FLOW | Anual (último reporte) |
| Próxima fecha de earnings | Alpha Vantage EARNINGS_CALENDAR | Horizonte 3 meses |
| Velas semanales | Alpha Vantage TIME_SERIES_WEEKLY | Cierre de la semana anterior |
| Candidatos screener | Finviz (web scraping) | Datos del día |
| SPY para contexto macro | Alpha Vantage (cache 60 min) | Cierre del día anterior |
| ETF de sector (RS sectorial) | Alpha Vantage (cache 60 min) | Cierre del día anterior |

### Limitaciones conocidas

1. **Haiku no conoce noticias recientes:** el modelo usa datos históricos de Alpha Vantage. Eventos post-entrenamiento (earnings sorpresa, cambios regulatorios, aranceles, cambios de CEO) no están reflejados en el score de narrativa.

2. **Precios con 15 minutos de delay:** el análisis de entrada y el badge de zona usan el precio actual, pero con un retraso de 15 minutos durante el horario de mercado. Fuera de horario, se usa el cierre del día anterior.

3. **Fundamentales trimestrales/anuales:** los datos de crecimiento de revenue y EPS reflejan el último trimestre o año reportado, no la información más reciente de conferencias de analistas o guidance.

4. **Datos de volumen semanal:** en algunos casos Alpha Vantage no incluye el volumen en las velas semanales. Cuando esto ocurre, el análisis de volumen de breakout dentro de la base no está disponible y se indica como "sin confirmación".

5. **Haiku conservador por diseño:** el prompt instruye a Haiku a ser conservador con el score de narrativa (score 3 solo si hay evidencia muy clara). Esto puede producir scores de narrativa conservadores para empresas legítimamente líderes pero cuya ventaja no es fácilmente identificable desde datos históricos.

6. **analyze_base con tendencias alcistas muy largas:** en acciones que llevan muchos meses subiendo sin consolidar, el algoritmo puede detectar una "base" con rango del 20–35% que corresponde a la tendencia completa, produciendo un stop más alejado de lo usual. Este comportamiento es técnicamente válido para position trading (los stops deben ser amplios), pero conviene revisarlo manualmente.
