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


def calc_ema(closes: list, period: int) -> float:
    if len(closes) < period:
        return round(closes[-1], 2)
    k = 2 / (period + 1)
    ema = sum(closes[:period]) / period
    for price in closes[period:]:
        ema = price * k + ema * (1 - k)
    return round(ema, 2)


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


def calc_score(rsi, ema20, ema50, sma200, price, vol_ratio, mansfield_rs,
               next_earnings, fundamentals, rr) -> dict:
    """
    Score de probabilidad calculado matemáticamente (0-100).
    Retorna score, desglose y lista de contradicciones/alertas.
    """
    score = 50  # base neutral
    breakdown = {}
    alerts = []
    contradictions = []

    # RSI
    if 40 <= rsi <= 60:
        score += 15; breakdown['rsi'] = +15
    elif rsi < 30:
        score += 8; breakdown['rsi'] = +8
    elif rsi > 75:
        score -= 15; breakdown['rsi'] = -15
        alerts.append(f"RSI {rsi} — sobrecompra extrema, alta probabilidad de corrección")
    elif rsi > 65:
        score -= 8; breakdown['rsi'] = -8
    else:
        breakdown['rsi'] = 0

    # Tendencia EMA
    if ema20 > ema50:
        score += 15; breakdown['ema_trend'] = +15
    else:
        score -= 15; breakdown['ema_trend'] = -15
        alerts.append("EMA20 < EMA50 — tendencia bajista de corto plazo")

    # SMA200
    if sma200:
        if price > sma200:
            score += 10; breakdown['sma200'] = +10
        else:
            score -= 10; breakdown['sma200'] = -10
            alerts.append(f"Precio bajo SMA200 (${sma200}) — tendencia bajista estructural")

    # Mansfield RS
    if mansfield_rs is not None:
        if mansfield_rs > 2:
            score += 12; breakdown['mansfield'] = +12
        elif mansfield_rs > 0:
            score += 6; breakdown['mansfield'] = +6
        elif mansfield_rs < -2:
            score -= 15; breakdown['mansfield'] = -15
            alerts.append(f"Mansfield RS {mansfield_rs} — acción muy rezagada vs S&P500")
        else:
            score -= 6; breakdown['mansfield'] = -6

    # Volumen
    if vol_ratio >= 100:
        score += 8; breakdown['volume'] = +8
    elif vol_ratio >= 80:
        score += 4; breakdown['volume'] = +4
    elif vol_ratio < 60:
        score -= 10; breakdown['volume'] = -10
        alerts.append(f"Volumen muy bajo ({vol_ratio}% del promedio) — baja participación institucional")
    else:
        breakdown['volume'] = 0

    # Earnings
    if next_earnings:
        try:
            from datetime import date
            days_to_earn = (date.fromisoformat(next_earnings) - date.today()).days
            if days_to_earn < 7:
                score -= 25; breakdown['earnings'] = -25
                alerts.append(f"Earnings en {days_to_earn} días — riesgo muy alto de movimiento inesperado")
            elif days_to_earn < 14:
                score -= 15; breakdown['earnings'] = -15
                alerts.append(f"Earnings en {days_to_earn} días — evitar abrir posición nueva")
            else:
                breakdown['earnings'] = 0
        except Exception:
            breakdown['earnings'] = 0

    # R:B
    if rr >= 3:
        score += 10; breakdown['rr'] = +10
    elif rr >= 2.5:
        score += 6; breakdown['rr'] = +6
    elif rr < 2:
        score -= 10; breakdown['rr'] = -10
    else:
        breakdown['rr'] = 0

    # Detectar contradicciones técnico vs fundamental
    f = fundamentals or {}
    eps_growth = f.get('epsGrowth')
    rev_growth = f.get('revenueGrowth')
    analyst_target = f.get('analystTarget')

    tech_bullish = ema20 > ema50 and (sma200 is None or price > sma200)
    tech_bearish = ema20 < ema50 or (sma200 and price < sma200)
    fund_strong = (eps_growth and eps_growth > 15) or (rev_growth and rev_growth > 15)
    fund_weak = (eps_growth and eps_growth < -10) or (rev_growth and rev_growth < -5)

    if tech_bearish and fund_strong:
        contradictions.append(
            f"Contradicción: señal técnica bajista pero fundamentales fuertes "
            f"(EPS +{eps_growth}%, ventas +{rev_growth}%). "
            "Señal SELL de menor confianza — el negocio va bien pero el precio está bajo presión."
        )
        score -= 8

    if tech_bullish and fund_weak:
        contradictions.append(
            f"Contradicción: señal técnica alcista pero fundamentales débiles "
            f"(EPS {eps_growth}%, ventas {rev_growth}%). "
            "Señal BUY de menor confianza — el precio sube pero los resultados no acompañan."
        )
        score -= 8

    if analyst_target and price > 0:
        analyst_upside = ((analyst_target - price) / price) * 100
        if analyst_upside < -10:
            contradictions.append(
                f"Precio objetivo de analistas ${analyst_target} está {abs(analyst_upside):.0f}% "
                "por debajo del precio actual — consenso institucional bajista."
            )
            score -= 5
        elif analyst_upside > 30:
            score += 5  # analistas ven mucho upside

    # Señal EVITAR
    avoid = False
    avoid_reason = None
    if score < 30:
        avoid = True
        avoid_reason = "Condiciones desfavorables en múltiples dimensiones. No es buen momento para operar."
    elif len(alerts) >= 3:
        avoid = True
        avoid_reason = "Demasiadas señales de alerta simultáneas. Esperar mejores condiciones."
    elif len(contradictions) >= 2:
        avoid = True
        avoid_reason = "Señales técnicas y fundamentales fuertemente contradictorias. Difícil estimar dirección."

    score = max(0, min(100, score))
    return {
        'score': score,
        'breakdown': breakdown,
        'alerts': alerts,
        'contradictions': contradictions,
        'avoid': avoid,
        'avoidReason': avoid_reason,
    }


def determine_final_signal(score: int, tech_signal: str, contradictions: list,
                           alerts: list = None, next_earnings: str = None,
                           rsi: float = 50) -> dict:
    """
    Determina la señal final y nivel de confianza basado en:
    - Score matemático
    - Señal técnica de Claude
    - Contradicciones detectadas
    - Alertas (earnings inminentes, RSI extremo, etc.)
    """
    from datetime import date
    has_contradiction = len(contradictions) > 0
    is_directional = tech_signal in ("buy", "sell")
    alerts = alerts or []

    # MONITOREAR — condiciones buenas pero evento temporal impide entrar
    if score >= 50 and is_directional:
        monitor_reason = None

        # Earnings en menos de 7 días con buenas condiciones
        if next_earnings:
            try:
                days_to_earn = (date.fromisoformat(next_earnings) - date.today()).days
                if days_to_earn <= 7:
                    monitor_reason = (
                        f"Earnings en {days_to_earn} día{'s' if days_to_earn != 1 else ''} — "
                        "las condiciones técnicas son buenas pero el reporte puede cambiar la dirección. "
                        "Esperar el resultado antes de entrar."
                    )
            except Exception:
                pass

        # RSI muy alto pero score bueno (cerca de sobrecompra)
        if not monitor_reason and rsi >= 68:
            monitor_reason = (
                f"RSI en {rsi} — cerca de sobrecompra. "
                "Las condiciones son buenas pero esperar un pullback a zona 55–60 mejora la entrada."
            )

        if monitor_reason:
            return {
                "signal": "monitor",
                "confidence": None,
                "confidenceStars": 0,
                "justification": monitor_reason
            }

    # EVITAR
    if score < 30:
        return {
            "signal": "avoid",
            "confidence": None,
            "confidenceStars": 0,
            "justification": "Demasiados factores en contra simultáneamente. No es buen momento para operar."
        }
    if 30 <= score <= 44 and has_contradiction:
        return {
            "signal": "avoid",
            "confidence": None,
            "confidenceStars": 0,
            "justification": "Condiciones débiles con señales contradictorias. No operar."
        }

    # ESPERAR
    if 30 <= score <= 44 and not has_contradiction:
        return {
            "signal": "hold",
            "confidence": None,
            "confidenceStars": 0,
            "justification": "Condiciones insuficientes para operar con confianza. Esperar mejor setup."
        }
    if not is_directional:  # HOLD de Claude
        return {
            "signal": "hold",
            "confidence": None,
            "confidenceStars": 0,
            "justification": "Sin dirección técnica clara. Monitorear y esperar setup definido."
        }
    if 45 <= score <= 64 and has_contradiction:
        # Baja confianza — sigue siendo direccional pero con advertencia
        action = "buy" if tech_signal == "buy" else "sell"
        return {
            "signal": action,
            "confidence": "low",
            "confidenceStars": 1,
            "justification": (
                "Setup técnico presente pero señales fundamentales contradicen la dirección. "
                "Riesgo elevado — operar con posición reducida si se decide entrar."
            )
        }

    # COMPRAR / VENDER con confianza media o alta
    action = "buy" if tech_signal == "buy" else "sell"
    action_label = "compra" if action == "buy" else "venta corta"

    if score >= 65 and not has_contradiction:
        return {
            "signal": action,
            "confidence": "high",
            "confidenceStars": 3,
            "justification": f"Condiciones técnicas y fundamentales alineadas. Setup de {action_label} de alta calidad."
        }
    if score >= 65 and has_contradiction:
        return {
            "signal": action,
            "confidence": "medium",
            "confidenceStars": 2,
            "justification": (
                f"Setup técnico sólido para {action_label}. "
                "Los fundamentales presentan señales mixtas — operar con posición más pequeña."
            )
        }
    if 45 <= score <= 64 and not has_contradiction:
        return {
            "signal": action,
            "confidence": "medium",
            "confidenceStars": 2,
            "justification": f"Condiciones favorables con algunos factores neutros. Setup de {action_label} aceptable."
        }

    # fallback
    return {
        "signal": "hold",
        "confidence": None,
        "confidenceStars": 0,
        "justification": "Condiciones no concluyentes. Esperar mejor momento."
    }


def extract_json(text: str) -> dict:
    text = re.sub(r"```[a-z]*|```", "", text).strip()
    match = re.search(r'\{[^{}]*\}', text, re.DOTALL)
    if match:
        return json.loads(match.group())
    return json.loads(text)


@app.get("/analyze/{ticker}")
async def analyze(ticker: str):
    ticker = ticker.upper().strip()

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

    ema20 = calc_ema(closes, 20)
    ema50 = calc_ema(closes, 50)
    rsi   = calc_rsi(closes)
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
    prices_20d  = [round(c, 2) for c in closes[-20:]]
    last_5      = [round(c, 2) for c in closes[-5:]]

    # defaults set-and-forget

    # Plazo dinámico basado en ATR y distancia al objetivo
    # ATR como % del precio = movimiento diario real
    avg_daily_move = (atr / price * 100) if price > 0 else 1.5
    dist_to_target_pct = 12.5  # objetivo base ~12.5%
    # Factor 2.5: el precio no se mueve linealmente hacia el objetivo
    # En la práctica toma 2-3x más días que el movimiento puro sugiere
    estimated_days = round(dist_to_target_pct / avg_daily_move * 2.5) if avg_daily_move > 0 else 20
    max_days = max(10, min(30, estimated_days))  # entre 10 y 30 días

    # defaults set-and-forget
    el_default = round(price * 0.995, 2)
    eh_default = round(price * 1.010, 2)
    sl_default = round(price * 0.95,  2)
    tg_default = round(price * 1.125, 2)

    prompt = (
        f"Analiza {ticker} para swing trading set-and-forget (sin gestion activa). Datos reales:\n"
        f"Precio: ${price} | Cambio: {change}% | EMA20: ${ema20} | EMA50: ${ema50} | RSI: {rsi} | Vol%: {vol_ratio}\n"
        f"Max20d: ${round(recent_high,2)} | Min20d: ${round(recent_low,2)} | SMA200: ${sma200 or 'N/A'} | ATR: ${round(atr,2)} | Mom4w: {momentum_4w}% | Ultimos5: {last_5}\n"
        f"\nEstrategia: entrada unica, stop-loss fijo, objetivo unico fijo. Sin ajustes manuales. Plazo maximo estimado: {max_days} dias (calculado por volatilidad ATR).\n"
        "\nResponde UNICAMENTE con este JSON (sin texto antes ni despues, sin markdown):\n"
        + '{' + f'"signal":"buy","strategy":"pullback","entryLow":{el_default},"entryHigh":{eh_default},"stopLoss":{sl_default},"target":{tg_default},"trend":"bullish","successRate":60,"keyLevel":{ema20},"analysis":"texto aqui"' + '}'
        + "\n\nReglas:\n"
        "- entryLow: limite inferior del rango de entrada (soporte tecnico, precio -0.5% a -1.5%)\n"
        "- entryHigh: limite superior del rango de entrada (resistencia menor, precio +0.5% a +1.5%)\n"
        "- stopLoss: FIJO entre 5% y 7% bajo entryLow, en soporte tecnico real. NO se mueve.\n"
        "- target: objetivo UNICO fijo con R:B minimo 2.5x. En resistencia tecnica real.\n"
        "- successRate: probabilidad de llegar al objetivo antes del stop en 20 dias (0-100)\n"
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

    # Score calculado matemáticamente
    score_data = calc_score(
        rsi=rsi, ema20=ema20, ema50=ema50, sma200=sma200, price=price,
        vol_ratio=vol_ratio, mansfield_rs=mansfield_rs,
        next_earnings=next_earnings, fundamentals=fundamentals, rr=rr
    )
    # Determinar señal final con nivel de confianza
    signal_result = determine_final_signal(
        score=score_data['score'],
        tech_signal=ai.get("signal", "hold"),
        contradictions=score_data['contradictions'],
        alerts=score_data['alerts'],
        next_earnings=next_earnings,
        rsi=rsi
    )

    return JSONResponse(content={
        "ticker":       ticker,
        "price":        price,
        "change":       change,
        "isRealtime":   is_realtime,
        "rtHigh":       rt_quote.get("high") if rt_quote else None,
        "rtLow":        rt_quote.get("low")  if rt_quote else None,
        "ema20":        ema20,
        "ema50":        ema50,
        "rsi":          rsi,
        "volRatio":     vol_ratio,
        "prices20d":    prices_20d,
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
        "scoreBreakdown": score_data['breakdown'],
        "alerts":         score_data['alerts'],
        "contradictions": score_data['contradictions'],
        "avoidReason":    score_data['avoidReason'] or signal_result["justification"],
        "momentum4w":     momentum_4w,
        "maxDays":        max_days,
        "keyLevel":     round(float(ai.get("keyLevel", ema20)), 2),
        "analysis":     str(ai.get("analysis", "")),
        "mansfieldRS":  mansfield_rs,
        "sma200":       sma200,
        "nextEarnings": next_earnings,
        "fundamentals": fundamentals,
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
    'GLD','SLV','IAU','GDX','GDXJ','USO','UNG','PDBC',
    # Leveraged/Inverse ETFs
    'SOXL','SOXS','TQQQ','SQQQ','SPYM','QID','TNA','TZA','UVXY','PSQ',
    # Crypto ETFs
    'IBIT','BITX','FBTC','GBTC',
    # International / Multi-asset ETFs
    'SCHF','SCHB','RSP','VIG','VYM','DVY','NOBL',
    # Other funds/ETFs
    'SCHH','KRE','VIX','FELG','FMDE','ZSL','SILJ','PAAS',
    'SLB',  # Schlumberger (ticker coincide con commodity ETF en algunos screeners)
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
            r = await c.get(_GITHUB_RAW, headers={"Cache-Control": "no-cache"})
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
