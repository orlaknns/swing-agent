from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import httpx
import asyncio
import json
import re
import os
from anthropic import Anthropic
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

scheduler = AsyncIOScheduler(timezone="America/New_York")

@app.on_event("startup")
async def startup():
    """Al iniciar: pre-carga screener desde GitHub."""
    data = await _load_screener_json()
    print(f"Screener listo: {data.get('count', 0)} candidatas | source={data.get('source')} | date={data.get('date')}")
    scheduler.start()

@app.on_event("shutdown")
async def shutdown():
    scheduler.shutdown()

client = Anthropic()
AV_KEY = os.environ.get("ALPHA_VANTAGE_KEY", "I3ZGIWYTKOVF07TP")

# Cache SPY para evitar llamadas repetidas (se renueva cada 60 min)
_spy_cache: dict = {"closes": [], "ts": 0}

TICKER_MAP = {
    "GOOGL": "GOOGL",
    "META": "META",
    "AMZN": "AMZN",
}



def calc_rsi(closes: list, period: int = 14) -> float:
    if len(closes) < period + 1:
        return 50.0
    deltas = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    gains = [d for d in deltas[-period:] if d > 0]
    losses = [-d for d in deltas[-period:] if d < 0]
    avg_gain = sum(gains) / period if gains else 0
    avg_loss = sum(losses) / period if losses else 0.001
    rs = avg_gain / avg_loss
    return round(100 - (100 / (1 + rs)), 1)


def calc_sma(closes: list, period: int) -> float | None:
    if len(closes) < period:
        return None
    return round(sum(closes[-period:]) / period, 2)


def safe_float(val, default=None):
    try:
        f = float(val)
        return None if f == 0 else round(f, 2)
    except (TypeError, ValueError):
        return default


def fmt_market_cap(val):
    try:
        v = float(val)
        if v >= 1e12: return f"${v/1e12:.1f}T"
        if v >= 1e9:  return f"${v/1e9:.1f}B"
        if v >= 1e6:  return f"${v/1e6:.1f}M"
        return f"${v:.0f}"
    except Exception as e:
        print(f"GLOBAL_QUOTE error for {ticker}: {e}")
        return None


async def fetch_prices(ticker: str, client_: httpx.AsyncClient) -> list:
    symbol = TICKER_MAP.get(ticker, ticker)
    url = (
        f"https://www.alphavantage.co/query"
        f"?function=TIME_SERIES_DAILY&symbol={symbol}"
        f"&outputsize=full&apikey={AV_KEY}"
    )
    r = await client_.get(url)
    r.raise_for_status()
    data = r.json()

    if "Note" in data or "Information" in data:
        msg = data.get("Note", data.get("Information", ""))
        raise HTTPException(status_code=429, detail=f"Límite de API Alpha Vantage: {msg[:100]}")
    if "Error Message" in data:
        raise HTTPException(status_code=404, detail=f"Ticker '{ticker}' no encontrado")

    ts = data.get("Time Series (Daily)")
    if not ts:
        raise HTTPException(status_code=404, detail=f"No se encontraron datos para {ticker}")

    dates = sorted(ts.keys())[-220:]
    candles = []
    for d in dates:
        try:
            candles.append({
                "date":   d,
                "open":   float(ts[d]["1. open"]),
                "high":   float(ts[d]["2. high"]),
                "low":    float(ts[d]["3. low"]),
                "close":  float(ts[d]["4. close"]),
                "volume": float(ts[d]["5. volume"]),
            })
        except Exception:
            continue
    return candles


async def fetch_fundamentals(ticker: str, client_: httpx.AsyncClient) -> dict:
    symbol = TICKER_MAP.get(ticker, ticker)
    url = (
        f"https://www.alphavantage.co/query"
        f"?function=OVERVIEW&symbol={symbol}&apikey={AV_KEY}"
    )
    try:
        r = await client_.get(url)
        r.raise_for_status()
        data = r.json()
        if not data or "Note" in data or "Information" in data or "Symbol" not in data:
            return {}

        mc = fmt_market_cap(data.get("MarketCapitalization"))
        eps = safe_float(data.get("EPS"))
        pe  = safe_float(data.get("PERatio"))
        roe_raw = safe_float(data.get("ReturnOnEquityTTM"))
        roe = round(roe_raw * 100, 1) if roe_raw else None
        rev_growth_raw = safe_float(data.get("QuarterlyRevenueGrowthYOY"))
        rev_growth = round(rev_growth_raw * 100, 1) if rev_growth_raw else None
        eps_growth_raw = safe_float(data.get("QuarterlyEarningsGrowthYOY"))
        eps_growth = round(eps_growth_raw * 100, 1) if eps_growth_raw else None

        # Dividend data
        ex_div_date = data.get("ExDividendDate") or None
        div_per_share = safe_float(data.get("DividendPerShare"))
        div_yield_raw = safe_float(data.get("DividendYield"))
        div_yield = round(div_yield_raw * 100, 2) if div_yield_raw else None

        # Limpiar fechas inválidas ("None", "0000-00-00", etc.)
        if ex_div_date and (ex_div_date in ("None", "0000-00-00", "null", "-") or len(ex_div_date) < 8):
            ex_div_date = None

        return {
            "name":         data.get("Name") or None,
            "sector":       data.get("Sector") or None,
            "industry":     data.get("Industry") or None,
            "marketCap":    mc,
            "eps":          eps,
            "peRatio":      pe,
            "roe":          roe,
            "revenueGrowth": rev_growth,
            "epsGrowth":    eps_growth,
            "analystTarget": safe_float(data.get("AnalystTargetPrice")),
            "debtToEquity": safe_float(data.get("DebtToEquityRatio")),
            "exDividendDate": ex_div_date,
            "dividendPerShare": div_per_share,
            "dividendYield": div_yield,
        }
    except Exception:
        return {}


async def fetch_realtime_quote(ticker: str, client_: httpx.AsyncClient) -> dict | None:
    """Obtiene precio con 15 min delay via GLOBAL_QUOTE."""
    symbol = TICKER_MAP.get(ticker, ticker)
    url = (
        f"https://www.alphavantage.co/query"
        f"?function=GLOBAL_QUOTE&symbol={symbol}&entitlement=delayed&apikey={AV_KEY}"
    )
    try:
        # Cliente propio para evitar conflictos con el cliente compartido
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get(url)
        r.raise_for_status()
        data = r.json()
        gq = data.get("Global Quote", {}) or data.get("Global Quote - DATA DELAYED BY 15 MINUTES", {})
        if not gq or "05. price" not in gq:
            print(f"GLOBAL_QUOTE empty or missing price for {ticker}")
            return None
        result = {
            "price":      round(float(gq.get("05. price", 0)), 2),
            "open":       round(float(gq.get("02. open", 0)), 2),
            "high":       round(float(gq.get("03. high", 0)), 2),
            "low":        round(float(gq.get("04. low", 0)), 2),
            "volume":     int(float(gq.get("06. volume", 0))),
            "prevClose":  round(float(gq.get("08. previous close", 0)), 2),
            "change":     round(float(gq.get("09. change", 0)), 2),
            "changePct":  round(float(gq.get("10. change percent", "0%").replace("%","")), 2),
            "tradingDay": gq.get("07. latest trading day", ""),
        }
        print(f"GLOBAL_QUOTE {ticker}: price={result['price']} tradingDay={result['tradingDay']} change={result['changePct']}%")
        return result
    except Exception as e:
        print(f"GLOBAL_QUOTE error for {ticker}: {e}")
        return None


async def fetch_earnings(ticker: str, client_: httpx.AsyncClient) -> str | None:
    """Obtiene la próxima fecha de earnings desde Alpha Vantage EARNINGS_CALENDAR."""
    symbol = TICKER_MAP.get(ticker, ticker)
    url = (
        f"https://www.alphavantage.co/query"
        f"?function=EARNINGS_CALENDAR&symbol={symbol}&horizon=3month&apikey={AV_KEY}"
    )
    try:
        r = await client_.get(url)
        r.raise_for_status()
        text = r.text.strip()
        if not text or "Note" in text or "Information" in text:
            return None
        # El endpoint devuelve CSV: symbol,name,reportDate,fiscalDateEnding,estimate,currency
        lines = [l for l in text.splitlines() if l.strip() and not l.startswith("symbol")]
        if not lines:
            return None
        # Primera línea = próximo earnings
        parts = lines[0].split(",")
        return parts[2] if len(parts) > 2 else None
    except Exception:
        return None


async def fetch_spy_closes(client_: httpx.AsyncClient) -> list:
    """Fetches SPY daily closes con caché de 60 minutos."""
    import time
    global _spy_cache

    # Retornar desde caché si tiene menos de 60 minutos
    if _spy_cache["closes"] and (time.time() - _spy_cache["ts"]) < 3600:
        return _spy_cache["closes"]

    url = (
        f"https://www.alphavantage.co/query"
        f"?function=TIME_SERIES_DAILY&symbol=SPY"
        f"&outputsize=full&apikey={AV_KEY}"
    )
    try:
        r = await client_.get(url)
        r.raise_for_status()
        data = r.json()
        ts = data.get("Time Series (Daily)")
        if not ts:
            return _spy_cache["closes"]  # devuelve caché viejo si falla
        dates = sorted(ts.keys())[-260:]
        closes = [float(ts[d]["4. close"]) for d in dates]

        # Guardar en caché
        _spy_cache["closes"] = closes
        _spy_cache["ts"] = time.time()
        return closes
    except Exception:
        return _spy_cache["closes"]  # devuelve caché viejo si hay error


def calc_mansfield_rs(stock_closes: list, spy_closes: list) -> float | None:
    """
    Mansfield RS = ((stock_now / stock_52w) / (spy_now / spy_52w) - 1) * 100
    Normalized to roughly -5 to +5 scale by dividing by 5.
    Positive = outperforming S&P500, negative = underperforming.
    """
    try:
        if len(stock_closes) < 252 or len(spy_closes) < 252:
            periods = min(len(stock_closes), len(spy_closes), 252)
            if periods < 20:
                return None
        else:
            periods = 252

        stock_now  = stock_closes[-1]
        stock_52w  = stock_closes[-periods]
        spy_now    = spy_closes[-1]
        spy_52w    = spy_closes[-periods]

        if stock_52w == 0 or spy_52w == 0:
            return None

        rs_raw = ((stock_now / stock_52w) / (spy_now / spy_52w) - 1) * 100
        # normalize: typical range ±25% → scale to ±5
        normalized = round(rs_raw / 5, 2)
        return max(-5.0, min(5.0, normalized))
    except Exception:
        return None


def calc_atr(highs: list, lows: list, closes: list, period: int = 14) -> float:
    """Average True Range — volatilidad diaria promedio."""
    if len(closes) < period + 1:
        return 0.0
    trs = []
    for i in range(1, len(closes)):
        tr = max(highs[i] - lows[i], abs(highs[i] - closes[i-1]), abs(lows[i] - closes[i-1]))
        trs.append(tr)
    return round(sum(trs[-period:]) / period, 4)


def calc_momentum_4w(closes: list) -> float | None:
    """Cambio porcentual en las últimas 4 semanas (~20 días de trading)."""
    if len(closes) < 21:
        return None
    return round(((closes[-1] - closes[-21]) / closes[-21]) * 100, 2)


def calc_score(rsi, sma21, sma50, sma200, price, vol_ratio, mansfield_rs,
               momentum_4w=None, recent_high=None) -> dict:
    """
    Score técnico puro (0-100) — solo análisis técnico de precio y momentum.
    Base: 50 (neutral). Máximo teórico: 100 exacto.

    Factores:
      SMA trend    +10 / -10   (tendencia corto plazo: SMA21 vs SMA50)
      RSI          +8  / -10   (momentum y sobrecompra)
      SMA200       +6  / -6    (tendencia estructural)
      Mansfield RS +8  / -12   (fuerza relativa vs S&P500)
      Volumen      +4  / -8    (participación institucional)
      Momentum 4s  +3  / -6    (magnitud movimiento reciente)
      Distancia max +3 / -5    (espacio antes de resistencia 20d)
      Suma máx positivos: 42 → base 50 + 42 = 92 máx sin casos extremos
    """
    score = 50
    breakdown = {}
    alerts = []

    # ── SMA trend: tendencia de corto plazo (máx +10) ─────────────────────
    ema_cross_recent = sma21 > sma50 and (sma21 - sma50) / sma50 < 0.02
    if sma21 > sma50:
        score += 10; breakdown['sma_trend'] = +10
    else:
        score -= 10; breakdown['sma_trend'] = -10
        alerts.append("SMA21 < SMA50 — tendencia bajista de corto plazo")

    # ── RSI: momentum y zona de entrada (máx +8) ──────────────────────────
    if 40 <= rsi <= 60:
        score += 8; breakdown['rsi'] = +8
    elif rsi < 30:
        score += 5; breakdown['rsi'] = +5
    elif rsi > 75:
        score -= 10; breakdown['rsi'] = -10
        alerts.append(f"RSI {rsi} — sobrecompra extrema, alta probabilidad de corrección")
    elif rsi > 65:
        score -= 5; breakdown['rsi'] = -5
    else:
        breakdown['rsi'] = 0

    # ── SMA200: tendencia estructural (máx +6) ────────────────────────────
    if sma200:
        if price > sma200:
            score += 6; breakdown['sma200'] = +6
        else:
            recovering = sma21 > sma50 and (momentum_4w or 0) > 0
            penalty = -3 if recovering else -6
            score += penalty; breakdown['sma200'] = penalty
            if not recovering:
                alerts.append(f"Precio bajo SMA200 (${sma200}) — tendencia bajista estructural")
            else:
                alerts.append(f"Precio bajo SMA200 (${sma200}) pero con tendencia de recuperación")

    # ── Mansfield RS: fuerza relativa vs S&P500 (máx +8) ─────────────────
    if mansfield_rs is not None:
        if mansfield_rs > 2:
            score += 8; breakdown['mansfield'] = +8
        elif mansfield_rs > 0:
            score += 4; breakdown['mansfield'] = +4
        elif mansfield_rs >= -1 and ema_cross_recent:
            score += 0; breakdown['mansfield'] = 0
        elif mansfield_rs < -2:
            score -= 12; breakdown['mansfield'] = -12
            alerts.append(f"Mansfield RS {mansfield_rs} — acción muy rezagada vs S&P500")
        else:
            score -= 6; breakdown['mansfield'] = -6

    # ── Volumen: participación institucional (máx +4) ─────────────────────
    if vol_ratio >= 100:
        score += 4; breakdown['volume'] = +4
    elif vol_ratio >= 70:
        score += 2; breakdown['volume'] = +2
    elif vol_ratio < 50:
        score -= 8; breakdown['volume'] = -8
        alerts.append(f"Volumen muy bajo ({vol_ratio}% del promedio) — baja participación institucional")
    else:
        breakdown['volume'] = 0

    # ── Momentum 4 semanas (máx +3) ───────────────────────────────────────
    if momentum_4w is not None:
        if 5 <= momentum_4w <= 20:
            score += 3; breakdown['momentum4w'] = +3
        elif momentum_4w > 20:
            score -= 5; breakdown['momentum4w'] = -5
            alerts.append(f"Momentum +{momentum_4w:.1f}% en 4 semanas — posible sobreextensión")
        elif momentum_4w < -5:
            score -= 6; breakdown['momentum4w'] = -6
        elif momentum_4w < 0:
            score -= 3; breakdown['momentum4w'] = -3
        else:
            breakdown['momentum4w'] = 0

    # ── Distancia al máximo de 20 días (máx +3) ───────────────────────────
    if recent_high and recent_high > 0 and price > 0:
        dist_to_high_pct = ((recent_high - price) / price) * 100
        if dist_to_high_pct > 5:
            score += 3; breakdown['dist_to_high'] = +3
        elif dist_to_high_pct < 2:
            score -= 5; breakdown['dist_to_high'] = -5
            alerts.append(f"Precio a {dist_to_high_pct:.1f}% del máximo de 20 días — resistencia inmediata")
        else:
            breakdown['dist_to_high'] = 0

    score = max(0, min(100, score))
    return {
        'score': score,
        'breakdown': breakdown,
        'alerts': alerts,
    }


def calc_context_stars(score: int, sma21: float, sma50: float, mansfield_rs,
                       next_earnings: str, ex_dividend_date: str,
                       fundamentals: dict, price: float, max_days: int) -> dict:
    """
    Estrellas de contexto de entrada (0-3) — ¿es buen momento para entrar ahora?

    Evalúa factores que NO son técnicos puros pero afectan si conviene entrar:
      - Earnings próximos (evento binario de riesgo)
      - Ex-dividend inminente (caída garantizada de precio)
      - Precio superó target de analistas (consenso institucional bajista)
      - Mansfield RS < -2 con técnica alcista (trampa alcista potencial)

    Retorna stars (0-3) y lista de razones que bajaron las estrellas.
    """
    from datetime import date as _date

    if score < 45:
        return {'stars': 0, 'reasons': []}

    stars = 3
    reasons = []

    # ── Earnings próximos ─────────────────────────────────────────────────
    if next_earnings:
        try:
            days_to_earn = (_date.fromisoformat(next_earnings) - _date.today()).days
            if days_to_earn < 7:
                stars -= 2
                reasons.append(f"Earnings en {days_to_earn} día{'s' if days_to_earn != 1 else ''} — riesgo muy alto de movimiento inesperado")
            elif days_to_earn < 14:
                stars -= 1
                reasons.append(f"Earnings en {days_to_earn} días — evitar abrir posición nueva")
        except Exception:
            pass

    # ── Ex-dividend inminente ─────────────────────────────────────────────
    if ex_dividend_date:
        try:
            days_to_exdiv = (_date.fromisoformat(ex_dividend_date) - _date.today()).days
            div_yield = (fundamentals or {}).get('dividendYield') or 0
            if 0 <= days_to_exdiv <= max_days and div_yield > 0.3:
                if days_to_exdiv <= 5:
                    stars -= 2
                    reasons.append(f"Ex-dividend en {days_to_exdiv} días (yield {div_yield}%) — el precio caerá ~el monto del dividendo")
                elif days_to_exdiv <= round(max_days * 0.4):
                    stars -= 1
                    reasons.append(f"Ex-dividend en {days_to_exdiv} días (yield {div_yield}%) — presión bajista dentro del plazo del trade")
        except Exception:
            pass

    # ── Precio superó target de analistas ────────────────────────────────
    analyst_target = (fundamentals or {}).get('analystTarget')
    if analyst_target and price > 0:
        analyst_upside = ((analyst_target - price) / price) * 100
        if analyst_upside < -10:
            stars -= 1
            reasons.append(
                f"Precio objetivo analistas ${analyst_target} está {abs(analyst_upside):.0f}% "
                "por debajo del precio actual — consenso institucional bajista"
            )

    # ── Mansfield RS muy negativo con técnica alcista ─────────────────────
    tech_bullish = sma21 > sma50
    if tech_bullish and mansfield_rs is not None and mansfield_rs < -2:
        stars -= 1
        reasons.append(
            f"Mansfield RS {mansfield_rs} — técnica alcista pero acción muy rezagada vs S&P500. "
            "Posible trampa alcista"
        )

    stars = max(0, min(3, stars))
    return {'stars': stars, 'reasons': reasons}


def determine_final_signal(score: int, tech_signal: str, context_stars: int,
                           context_reasons: list, alerts: list = None,
                           rsi: float = 50) -> dict:
    """
    Determina la señal final basada en:
    - Score técnico puro (0-100)
    - Señal técnica de Claude (buy/sell/hold)
    - Estrellas de contexto (0-3) calculadas por calc_context_stars
    """
    is_directional = tech_signal in ("buy", "sell")
    alerts = alerts or []

    # EVITAR — técnica muy débil
    if score < 30:
        return {
            "signal": "avoid",
            "confidence": None,
            "confidenceStars": 0,
            "justification": "Setup técnico muy débil. Demasiados factores en contra."
        }

    # ESPERAR — técnica insuficiente
    if score < 45:
        return {
            "signal": "hold",
            "confidence": None,
            "confidenceStars": 0,
            "justification": "Condiciones técnicas insuficientes. Esperar mejor setup."
        }

    if not is_directional:
        return {
            "signal": "hold",
            "confidence": None,
            "confidenceStars": 0,
            "justification": "Sin dirección técnica clara. Monitorear y esperar setup definido."
        }

    # RSI cerca de sobrecompra → monitorear
    if score >= 50 and rsi >= 72:
        return {
            "signal": "monitor",
            "confidence": None,
            "confidenceStars": 0,
            "justification": (
                f"RSI en {rsi} — cerca de sobrecompra. "
                "Setup técnico bueno pero esperar pullback a zona 55–65 para mejor entrada."
            )
        }

    action = "buy" if tech_signal == "buy" else "sell"
    action_label = "compra" if action == "buy" else "venta corta"

    # MONITOREAR — técnica buena pero contexto desaconseja entrar ahora
    # (stars 0 o 1 por earnings inminentes o ex-dividend muy cercano)
    if score >= 50 and context_stars <= 1 and context_reasons:
        return {
            "signal": "monitor",
            "confidence": None,
            "confidenceStars": 0,
            "justification": context_reasons[0]  # razón más importante
        }

    # COMPRAR / VENDER — señal direccional con confianza según score y contexto
    if score >= 65:
        conf_stars = context_stars  # 3=alta, 2=media, 1=baja
        conf_label = "high" if context_stars == 3 else "medium" if context_stars == 2 else "low"
        if context_stars == 3:
            just = f"Setup técnico sólido y contexto limpio. {action_label.capitalize()} con alta confianza."
        elif context_stars == 2:
            just = f"Setup técnico sólido para {action_label}. {context_reasons[0] if context_reasons else 'Contexto con factores a considerar.'}. Operar con posición normal."
        else:
            just = f"Setup técnico presente para {action_label} pero contexto desfavorable. Operar con posición reducida o esperar."
        return {"signal": action, "confidence": conf_label, "confidenceStars": conf_stars, "justification": just}

    # score 45-64 — señal direccional débil
    if context_stars == 3:
        return {
            "signal": action,
            "confidence": "medium",
            "confidenceStars": 2,
            "justification": f"Condiciones técnicas favorables con algunos factores neutros. Setup de {action_label} aceptable."
        }

    return {
        "signal": action,
        "confidence": "low",
        "confidenceStars": 1,
        "justification": f"Setup técnico débil para {action_label}. Riesgo elevado — posición reducida si se decide entrar."
    }


def extract_json(text: str) -> dict:
    text = re.sub(r"```[a-z]*|```", "", text).strip()
    match = re.search(r'\{[^{}]*\}', text, re.DOTALL)
    if match:
        return json.loads(match.group())
    return json.loads(text)


@app.get("/analyze/{ticker}")
async def analyze(ticker: str):
    import traceback as _tb
    ticker = ticker.upper().strip()
    try:
        return await _analyze_inner(ticker)
    except HTTPException:
        raise
    except Exception as e:
        detail = f"{type(e).__name__}: {e}\n{_tb.format_exc()[-800:]}"
        print(f"ANALYZE ERROR {ticker}: {detail}")
        raise HTTPException(status_code=500, detail=detail)


def calc_levels(price: float, recent_low: float, recent_high: float, sma21: float) -> dict:
    """Calcula niveles de entrada/stop/target anclados a soportes técnicos reales.

    Entrada anclada a SMA21 (soporte dinámico diario, estable entre refreshes).
    Stop anclado a mínimo 20d (soporte histórico real).
    Target anclado a máximo 20d con mínimo R:B 2.5x.

    Returns dict con keys: el, eh, entry_mid, sl, tg
    """
    # Entrada: zona alrededor de SMA21 (cambia solo con el cierre diario, no tick a tick)
    el = round(sma21 * 0.995, 2)
    eh = round(sma21 * 1.010, 2)
    entry_mid = round((el + eh) / 2, 2)
    # Stop: siempre el mínimo de 20 días ligeramente por debajo — valor fijo histórico
    sl = round(recent_low * 0.995, 2)
    # Target: máximo 20d o R:B 2.5x mínimo, lo que sea mayor
    risk = entry_mid - sl
    min_target_rb = round(entry_mid + risk * 2.5, 2) if risk > 0 else round(price * 1.125, 2)
    tg = round(max(recent_high, min_target_rb), 2)
    return {"el": el, "eh": eh, "entry_mid": entry_mid, "sl": sl, "tg": tg}


async def _analyze_inner(ticker: str):
    async with httpx.AsyncClient(timeout=20) as http:
        candles, fundamentals, spy_closes, next_earnings, rt_quote = await asyncio.gather(
            fetch_prices(ticker, http),
            fetch_fundamentals(ticker, http),
            fetch_spy_closes(http),
            fetch_earnings(ticker, http),
            fetch_realtime_quote(ticker, http),
        )

    if len(candles) < 5:
        raise HTTPException(status_code=404, detail=f"Datos insuficientes para {ticker}")

    closes  = [c["close"]  for c in candles]
    highs   = [c["high"]   for c in candles]
    lows    = [c["low"]    for c in candles]
    volumes = [c["volume"] for c in candles]

    # Precio base desde TIME_SERIES_DAILY (cierre anterior)
    daily_price = round(closes[-1], 2)
    prev_close  = closes[-2] if len(closes) >= 2 else closes[-1]

    # Si hay precio en tiempo real, usarlo
    if rt_quote and rt_quote.get("price", 0) > 0:
        price  = rt_quote["price"]
        change = rt_quote["changePct"]
        is_realtime = True
    else:
        price  = daily_price
        change = round(((price - prev_close) / prev_close) * 100, 2)
        is_realtime = False

    sma21  = calc_sma(closes, 21)
    sma50  = calc_sma(closes, 50)
    rsi    = calc_rsi(closes)
    sma200 = calc_sma(closes, 200)

    avg_vol     = sum(volumes[-20:]) / min(20, len(volumes))
    # Usar volumen del día actual si está disponible (GLOBAL_QUOTE)
    current_vol = rt_quote.get("volume", volumes[-1]) if rt_quote else volumes[-1]
    vol_ratio   = round(current_vol / avg_vol * 100) if avg_vol else 100
    mansfield_rs = calc_mansfield_rs(closes, spy_closes)

    atr          = calc_atr(highs, lows, closes)
    momentum_4w  = calc_momentum_4w(closes)

    recent_high = max(highs[-20:])
    recent_low  = min(lows[-20:])
    prices_20d  = [round(c, 2) for c in closes[-30:]]  # 30 días para chart más completo
    last_5      = [round(c, 2) for c in closes[-5:]]

    # defaults set-and-forget — anclados a soportes/resistencias técnicas reales
    # (calcular primero para usar tg_default en max_days)
    _lvl = calc_levels(price, recent_low, recent_high, sma21)
    el_default        = _lvl["el"]
    eh_default        = _lvl["eh"]
    sl_default        = _lvl["sl"]
    tg_default        = _lvl["tg"]

    # Plazo dinámico basado en ATR y distancia real al objetivo
    # ATR como % del precio = movimiento diario real
    avg_daily_move = (atr / price * 100) if price > 0 else 1.5
    dist_to_target_pct = ((tg_default - price) / price * 100) if price > 0 else 12.5
    # Factor 2.5: el precio no se mueve linealmente — en la práctica toma 2-3x más días
    estimated_days = round(dist_to_target_pct / avg_daily_move * 2.5) if avg_daily_move > 0 else 20
    max_days = max(10, min(30, estimated_days))  # entre 10 y 30 días

    ex_dividend_date = (fundamentals or {}).get("exDividendDate")

    ex_div_str = ""
    if ex_dividend_date:
        try:
            from datetime import date as _date
            days_to_exdiv = (_date.fromisoformat(ex_dividend_date) - _date.today()).days
            div_amt = (fundamentals or {}).get("dividendPerShare")
            div_txt = f" (${div_amt}/accion)" if div_amt else ""
            if 0 <= days_to_exdiv <= max_days:
                ex_div_str = f"\nEx-dividend: {ex_dividend_date} (en {days_to_exdiv} dias){div_txt} — el precio caera aprox el monto del dividendo en esa fecha. Cae dentro del plazo maximo del trade ({max_days}d), ajustar objetivo considerando esa caida."
        except Exception:
            pass

    # Condiciones objetivas para orientar la narrativa de Claude
    ema_trend_ctx = "SMA21 > SMA50 (tendencia alcista corto plazo)" if sma21 > sma50 else "SMA21 < SMA50 (tendencia bajista corto plazo)"
    sma200_ctx = f"Precio {'sobre' if sma200 and price > sma200 else 'bajo'} SMA200" if sma200 else "SMA200 no disponible"
    rsi_ctx = "RSI en zona neutra/pullback" if 40 <= rsi <= 60 else (f"RSI {rsi} — sobrecompra" if rsi > 65 else (f"RSI {rsi} — sobreventa" if rsi < 35 else f"RSI {rsi}"))
    try:
        from datetime import date as _dctx
        earnings_ctx = f"Earnings en {(_dctx.fromisoformat(next_earnings) - _dctx.today()).days} dias" if next_earnings else "Sin earnings proximos"
    except Exception:
        earnings_ctx = "Sin earnings proximos"

    prompt = (
        f"Analiza {ticker} para swing trading set-and-forget (sin gestion activa). Datos reales:\n"
        f"Precio: ${price} | Cambio: {change}% | SMA21: ${sma21} | SMA50: ${sma50} | RSI: {rsi} | Vol%: {vol_ratio}\n"
        f"Max20d: ${round(recent_high,2)} | Min20d: ${round(recent_low,2)} | SMA200: ${sma200 or 'N/A'} | ATR: ${round(atr,2)} | Mom4w: {momentum_4w}% | Ultimos5: {last_5}\n"
        f"Condiciones objetivas: {ema_trend_ctx} | {sma200_ctx} | {rsi_ctx} | {earnings_ctx}\n"
        f"{ex_div_str}"
        f"\nEstrategia: entrada unica, stop-loss fijo, objetivo unico fijo. Sin ajustes manuales. Plazo maximo estimado: {max_days} dias (calculado por volatilidad ATR).\n"
        "\nResponde UNICAMENTE con este JSON (sin texto antes ni despues, sin markdown):\n"
        + '{' + f'"signal":"buy","strategy":"pullback","entryLow":{el_default},"entryHigh":{eh_default},"stopLoss":{sl_default},"target":{tg_default},"trend":"bullish","keyLevel":{sma21},"analysis":"texto aqui"' + '}'
        + "\n\nReglas:\n"
        "- signal debe reflejar las condiciones objetivas indicadas arriba (buy solo si tendencia alcista, sell si bajista)\n"
        f"- entryLow/entryHigh: zona de entrada anclada a SMA21 (${sma21}) — usar {el_default} y {eh_default} como referencia. Solo ajustar si hay soporte/resistencia tecnica mejor documentada.\n"
        f"- stopLoss: FIJO en minimo 20d (${round(recent_low,2)}) ligeramente por debajo — usar {sl_default} como referencia. Este nivel es el soporte real que el precio ya respeto. NO se mueve.\n"
        f"- target: objetivo UNICO fijo con R:B minimo 2.5x — maximo 20d es ${round(recent_high,2)}, usar como referencia. Default: {tg_default}. En resistencia tecnica real.\n"
        "- signal=buy/sell/hold, strategy=pullback/breakout/reversal/neutral, trend=bullish/bearish/sideways\n"
        "- Para sell: entryLow/entryHigh es rango venta corta, stopLoss es proteccion al alza, target es objetivo a la baja."
    )


    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=500,
        messages=[{"role": "user", "content": prompt}]
    )

    try:
        ai = extract_json(message.content[0].text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error parseando respuesta IA: {str(e)} | Raw: {message.content[0].text[:200]}")

    entry_low  = float(ai.get("entryLow",  el_default))
    entry_high = float(ai.get("entryHigh", eh_default))
    stop       = float(ai.get("stopLoss",  sl_default))
    target     = float(ai.get("target",    tg_default))

    entry_mid = round((entry_low + entry_high) / 2, 2)

    # ── Verificar y corregir R:B mínimo 2.5x ──────────────────────────────
    # Si Claude no respetó el mínimo, recalcular el objetivo matemáticamente
    MIN_RR = 2.5
    risk = abs(entry_mid - stop)
    if risk > 0.001:
        actual_rr = abs(target - entry_mid) / risk
        if actual_rr < MIN_RR:
            # Corregir objetivo para cumplir R:B mínimo
            if target > entry_mid:  # BUY — objetivo arriba
                target = round(entry_mid + risk * MIN_RR, 2)
            else:  # SELL — objetivo abajo
                target = round(entry_mid - risk * MIN_RR, 2)
            print(f"RR corregido para {ticker}: objetivo ajustado a {target} (R:B {MIN_RR}x)")

    rr = round(abs((target - entry_mid) / risk), 2) if risk > 0.001 else 0

    # Score técnico puro
    score_data = calc_score(
        rsi=rsi, sma21=sma21, sma50=sma50, sma200=sma200, price=price,
        vol_ratio=vol_ratio, mansfield_rs=mansfield_rs,
        momentum_4w=momentum_4w, recent_high=recent_high
    )
    # Estrellas de contexto de entrada
    context_data = calc_context_stars(
        score=score_data['score'],
        sma21=sma21, sma50=sma50, mansfield_rs=mansfield_rs,
        next_earnings=next_earnings, ex_dividend_date=ex_dividend_date,
        fundamentals=fundamentals, price=price, max_days=max_days
    )
    # Señal final
    signal_result = determine_final_signal(
        score=score_data['score'],
        tech_signal=ai.get("signal", "hold"),
        context_stars=context_data['stars'],
        context_reasons=context_data['reasons'],
        alerts=score_data['alerts'],
        rsi=rsi
    )

    # ── Momento A/B: dónde está el precio respecto al rango de entrada real ───
    # Compara contra entryLow/entryHigh reales (anclados a SMA21 ± 1%)
    # 4 estados: in_zone / wait_pullback / approaching / below_zone
    if entry_low and entry_high and sma21:
        if entry_low <= price <= entry_high:
            entry_zone = "in_zone"         # dentro del rango — entrar con mercado
        elif price > entry_high:
            entry_zone = "wait_pullback"   # sobre el rango — esperar pullback
        elif price >= sma21 * 0.98:
            entry_zone = "approaching"     # bajo el rango pero cerca de SMA21 — preparar orden
        else:
            entry_zone = "below_zone"      # bajo SMA21 — setup invalidado
    else:
        entry_zone = "unknown"

    # SMA21 diaria para los últimos 30 días (para dibujar la línea en el chart)
    sma21_series = []
    for i in range(len(closes) - 30, len(closes)):
        if i >= 21:
            sma21_series.append(round(sum(closes[i-21:i]) / 21, 2))
        else:
            sma21_series.append(None)

    return JSONResponse(content={
        "ticker":       ticker,
        "price":        price,
        "change":       change,
        "isRealtime":   is_realtime,
        "rtHigh":       rt_quote.get("high") if rt_quote else None,
        "rtLow":        rt_quote.get("low")  if rt_quote else None,
        "sma21":        sma21,
        "sma50":        sma50,
        "rsi":          rsi,
        "volRatio":     vol_ratio,
        "prices20d":    prices_20d,
        "sma21Series":  sma21_series,
        "signal":       signal_result["signal"],
        "confidence":   signal_result["confidence"],
        "confidenceStars": signal_result["confidenceStars"],
        "signalJustification": signal_result["justification"],
        "strategy":     ai.get("strategy",    "neutral"),
        "entryLow":     round(entry_low,  2),
        "entryHigh":    round(entry_high, 2),
        "stopLoss":     round(stop,       2),
        "target":       round(target,     2),
        "rr":           rr,
        "trend":        ai.get("trend",       "sideways"),
        "successRate":  score_data['score'],
        "scoreBreakdown":  score_data['breakdown'],
        "alerts":          score_data['alerts'],
        "contextStars":    context_data['stars'],
        "contextReasons":  context_data['reasons'],
        "avoidReason":     signal_result["justification"],
        "momentum4w":     momentum_4w,
        "maxDays":        max_days,
        "keyLevel":     round(float(ai.get("keyLevel", sma21)), 2),
        "analysis":     str(ai.get("analysis", "")),
        "mansfieldRS":  mansfield_rs,
        "sma200":       sma200,
        "nextEarnings": next_earnings,
        "fundamentals": fundamentals,
        "entryZone":    entry_zone,
    }, media_type="application/json; charset=utf-8")



@app.get("/health")
def health():
    return {"status": "ok"}


# ── Screener — lee screener.json desde GitHub raw ──────────────────────────
import time as _time

_SCREENER_CACHE: dict = {}
_SCREENER_TS: float = 0
_SCREENER_TTL = 300  # 5 minutos — para reflejar cambios de GitHub Actions rápido

# ETFs a filtrar — no son acciones individuales
_ETFS = {
    # Index ETFs
    'SPY','QQQ','IWM','DIA','IVV','IJH','VTI','VOO','SCHX','SCHG','SCHD',
    # Sector ETFs
    'XLF','XLK','XLE','XLV','XLI','XLU','XLP','XLB','XLY','XLC',
    # International ETFs
    'EEM','EFA','VEA','EWZ','EWY','FXI','KWEB','IEMG','EWJ',
    # Bond ETFs
    'TLT','LQD','HYG','BIL','BKLN','VCIT','SPIB','SGOV','EMB','SPSB','SPAB',
    # Commodity ETFs
    'GLD','SLV','IAU','IAUM','GDX','GDXJ','USO','UNG','PDBC','GLDM','SGOL','AGQ',
    # Bond ETFs adicionales
    'IEF','TIP','SHY','IEI','AGG','BND','JNK','HYG',
    # Leveraged/Inverse ETFs
    'SOXL','SOXS','TQQQ','SQQQ','SPYM','QID','TNA','TZA','UVXY','PSQ',
    # Crypto ETFs
    'IBIT','BITX','FBTC','GBTC',
    # International / Multi-asset ETFs
    'SCHF','SCHB','RSP','VIG','VYM','DVY','NOBL','VWO','EWC','EWA',
    # Semiconductor / Sector ETFs adicionales
    'SMH','SOXX','XSD','ARKK','ARKG','ARKW','ARKF',
    # Other funds/ETFs
    'SCHH','KRE','VIX','FELG','FMDE','ZSL','SILJ','PAAS',
}

_GITHUB_RAW = "https://raw.githubusercontent.com/orlaknns/swing-agent/main/data/screener.json"
_CURATED_FALLBACK = {
    "tickers": ["AAPL","MSFT","NVDA","GOOGL","META","AMZN","TSLA","JPM","V","MA",
                "UNH","JNJ","PG","HD","AVGO","CRM","AMD","ORCL","NFLX","DIS",
                "PYPL","SHOP","SNOW","PLTR","COIN","UBER","ABNB","DDOG","NET","CRWD"],
    "count": 30, "date": "", "updatedAt": "", "source": "curated",
}

async def _load_screener_json() -> dict:
    """Lee screener.json desde GitHub raw — siempre fresco."""
    global _SCREENER_CACHE, _SCREENER_TS
    now = _time.time()
    if _SCREENER_CACHE and (now - _SCREENER_TS) < _SCREENER_TTL:
        return _SCREENER_CACHE
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            # Query param con timestamp para bypass del CDN cache de GitHub raw
            bust_url = f"{_GITHUB_RAW}?t={int(now)}"
            r = await c.get(bust_url, headers={"Cache-Control": "no-cache", "Pragma": "no-cache"})
            if r.status_code == 200:
                data = r.json()
                # Filtrar ETFs de candidates (formato nuevo)
                raw_candidates = data.get("candidates", [])
                filtered_candidates = [c for c in raw_candidates if c.get("ticker") not in _ETFS]
                data["candidates"] = filtered_candidates
                # Filtrar ETFs de tickers (formato legacy)
                raw_tickers = data.get("tickers", [])
                filtered_tickers = [t for t in raw_tickers if t not in _ETFS]
                data["tickers"] = filtered_tickers
                data["count"] = len(filtered_candidates) or len(filtered_tickers)
                removed = (len(raw_candidates) - len(filtered_candidates)) or (len(raw_tickers) - len(filtered_tickers))
                _SCREENER_CACHE = data
                _SCREENER_TS = now
                print(f"Screener loaded from GitHub: {data['count']} tickers (filtered {removed} ETFs/funds)")
                return data
    except Exception as e:
        print(f"Error loading screener from GitHub: {e}")
    return _SCREENER_CACHE or _CURATED_FALLBACK

_GH_OWNER = "orlaknns"
_GH_REPO  = "swing-agent"
_GH_WORKFLOW = "screener.yml"

@app.post("/screener/refresh")
async def screener_refresh():
    """Dispara el workflow de GitHub Actions para actualizar el screener."""
    global _SCREENER_TS
    token = os.environ.get("GITHUB_TOKEN_WORKFLOW", "")
    if not token:
        return JSONResponse(status_code=503, content={"error": "Token no configurado"})
    url = f"https://api.github.com/repos/{_GH_OWNER}/{_GH_REPO}/actions/workflows/{_GH_WORKFLOW}/dispatches"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(url, headers=headers, json={"ref": "main"})
            if r.status_code == 204:
                _SCREENER_TS = 0  # invalida caché para forzar recarga al siguiente /screener
                return JSONResponse(content={"ok": True, "message": "Screener en ejecución — listo en ~60 segundos"})
            return JSONResponse(status_code=r.status_code, content={"error": f"GitHub respondió {r.status_code}", "detail": r.text})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.get("/screener")
async def screener():
    """Devuelve candidatas desde GitHub (generado por GitHub Actions diariamente)."""
    data = await _load_screener_json()
    # Soporta formato nuevo (candidates) y legacy (tickers)
    if "candidates" in data:
        candidates = data["candidates"]
    else:
        candidates = [{"ticker": t, "company": "", "sector": ""} for t in data.get("tickers", [])]
    return JSONResponse(
        content={
            "candidates": candidates,
            "count": len(candidates),
            "date": data.get("date", ""),
            "updatedAt": data.get("updatedAt", ""),
            "source": data.get("source", "curated"),
            "criteria": data.get("criteria", {}),
        },
        media_type="application/json; charset=utf-8"
    )
