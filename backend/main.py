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

        profit_margin_raw  = safe_float(data.get("ProfitMargin"))
        profit_margin      = round(profit_margin_raw * 100, 1) if profit_margin_raw else None
        op_margin_raw      = safe_float(data.get("OperatingMarginTTM"))
        op_margin          = round(op_margin_raw * 100, 1) if op_margin_raw else None
        analyst_strong_buy = safe_float(data.get("AnalystRatingStrongBuy"))
        analyst_buy        = safe_float(data.get("AnalystRatingBuy"))

        return {
            "name":              data.get("Name") or None,
            "sector":            data.get("Sector") or None,
            "industry":          data.get("Industry") or None,
            "marketCap":         mc,
            "eps":               eps,
            "peRatio":           pe,
            "roe":               roe,
            "revenueGrowth":     rev_growth,
            "epsGrowth":         eps_growth,
            "profitMargin":      profit_margin,
            "operatingMargin":   op_margin,
            "analystTarget":     safe_float(data.get("AnalystTargetPrice")),
            "analystStrongBuy":  analyst_strong_buy,
            "analystBuy":        analyst_buy,
            "debtToEquity":      safe_float(data.get("DebtToEquityRatio")),
            "exDividendDate":    ex_div_date,
            "dividendPerShare":  div_per_share,
            "dividendYield":     div_yield,
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


def calc_mansfield_rs_raw(stock_closes: list, spy_closes: list) -> float | None:
    """Retorna el RS real sin normalizar ni capear (% vs SPY en 52 semanas)."""
    try:
        if len(stock_closes) < 20 or len(spy_closes) < 20:
            return None
        periods = min(len(stock_closes), len(spy_closes), 252)
        stock_now = stock_closes[-1]; stock_52w = stock_closes[-periods]
        spy_now   = spy_closes[-1];   spy_52w   = spy_closes[-periods]
        if stock_52w == 0 or spy_52w == 0:
            return None
        return round(((stock_now / stock_52w) / (spy_now / spy_52w) - 1) * 100, 1)
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


# ── Batch analyze — corre en el servidor, el frontend solo hace polling ───────

_batch_jobs: dict = {}   # job_id → { status, total, done, results, error }

from fastapi import BackgroundTasks
from pydantic import BaseModel

class BatchRequest(BaseModel):
    tickers: list[str]
    module: str = "swing"   # "swing" | "position"

async def _run_batch(job_id: str, tickers: list[str], module: str):
    job = _batch_jobs[job_id]
    analyze_fn = _analyze_inner if module == "swing" else _analyze_position_inner
    for i, ticker in enumerate(tickers):
        if job.get("cancelled"):
            break
        try:
            data = await analyze_fn(ticker)
            job["results"][ticker] = data
        except Exception as e:
            job["results"][ticker] = {"error": str(e)}
        job["done"] = i + 1
        if i < len(tickers) - 1:
            await asyncio.sleep(3)
    job["status"] = "done"

@app.post("/batch-analyze")
async def batch_analyze(req: BatchRequest, background_tasks: BackgroundTasks):
    import uuid, time as _time
    job_id = str(uuid.uuid4())[:8]
    _batch_jobs[job_id] = {
        "status": "running",
        "module": req.module,
        "total": len(req.tickers),
        "done": 0,
        "results": {},
        "cancelled": False,
        "started_at": _time.time(),
    }
    background_tasks.add_task(_run_batch, job_id, req.tickers, req.module)
    return {"job_id": job_id, "total": len(req.tickers)}

@app.get("/batch-status/{job_id}")
async def batch_status(job_id: str):
    job = _batch_jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return {
        "job_id":  job_id,
        "status":  job["status"],
        "total":   job["total"],
        "done":    job["done"],
        "results": job["results"] if job["status"] == "done" else {},
    }

@app.post("/batch-cancel/{job_id}")
async def batch_cancel(job_id: str):
    job = _batch_jobs.get(job_id)
    if job:
        job["cancelled"] = True
    return {"ok": True}


# ── Position Trading ────────────────────────────────────────────────────────

SECTOR_ETF_MAP = {
    "Technology":             "XLK",
    "Financial Services":     "XLF",
    "Financial":              "XLF",
    "Healthcare":             "XLV",
    "Consumer Cyclical":      "XLY",
    "Consumer Defensive":     "XLP",
    "Energy":                 "XLE",
    "Industrials":            "XLI",
    "Utilities":              "XLU",
    "Basic Materials":        "XLB",
    "Real Estate":            "XLRE",
    "Communication Services": "XLC",
    "Communication":          "XLC",
}

# Cache de sector ETFs — clave: símbolo ETF, valor: {closes, ts}
_sector_etf_cache: dict = {}


async def fetch_prices_weekly(ticker: str, client_: httpx.AsyncClient, weeks: int = 52) -> list:
    """Obtiene velas semanales de Alpha Vantage para detección de HH/HL."""
    symbol = TICKER_MAP.get(ticker, ticker)
    url = (
        f"https://www.alphavantage.co/query"
        f"?function=TIME_SERIES_WEEKLY&symbol={symbol}"
        f"&outputsize=compact&apikey={AV_KEY}"
    )
    try:
        r = await client_.get(url)
        r.raise_for_status()
        data = r.json()
        if "Note" in data or "Information" in data or "Error Message" in data:
            return []
        ts = data.get("Weekly Time Series")
        if not ts:
            return []
        dates = sorted(ts.keys())[-weeks:]
        candles = []
        for d in dates:
            try:
                candles.append({
                    "date":  d,
                    "open":  float(ts[d]["1. open"]),
                    "high":  float(ts[d]["2. high"]),
                    "low":   float(ts[d]["3. low"]),
                    "close": float(ts[d]["4. close"]),
                })
            except Exception:
                continue
        return candles
    except Exception:
        return []


async def fetch_cashflow(ticker: str, client_: httpx.AsyncClient) -> dict:
    """Obtiene Free Cash Flow del último reporte anual."""
    symbol = TICKER_MAP.get(ticker, ticker)
    url = (
        f"https://www.alphavantage.co/query"
        f"?function=CASH_FLOW&symbol={symbol}&apikey={AV_KEY}"
    )
    try:
        r = await client_.get(url)
        r.raise_for_status()
        data = r.json()
        if not data or "Note" in data or "Information" in data:
            return {"fcf": None, "fcf_positive": None}
        annual = data.get("annualReports", [])
        if not annual:
            return {"fcf": None, "fcf_positive": None}
        latest = annual[0]
        op_cf = safe_float(latest.get("operatingCashflow"))
        capex = safe_float(latest.get("capitalExpenditures"))
        if op_cf is None:
            return {"fcf": None, "fcf_positive": None}
        capex = capex or 0
        fcf = round(op_cf - capex, 0)
        return {"fcf": fcf, "fcf_positive": fcf > 0}
    except Exception:
        return {"fcf": None, "fcf_positive": None}


async def fetch_sector_etf_closes(etf: str, client_: httpx.AsyncClient) -> list:
    """Obtiene closes del ETF de sector con caché de 60 minutos."""
    import time
    global _sector_etf_cache
    cached = _sector_etf_cache.get(etf, {})
    if cached.get("closes") and (time.time() - cached.get("ts", 0)) < 3600:
        return cached["closes"]
    url = (
        f"https://www.alphavantage.co/query"
        f"?function=TIME_SERIES_DAILY&symbol={etf}"
        f"&outputsize=compact&apikey={AV_KEY}"
    )
    try:
        r = await client_.get(url)
        r.raise_for_status()
        data = r.json()
        ts = data.get("Time Series (Daily)")
        if not ts:
            return cached.get("closes", [])
        dates = sorted(ts.keys())[-260:]
        closes = [float(ts[d]["4. close"]) for d in dates]
        _sector_etf_cache[etf] = {"closes": closes, "ts": time.time()}
        return closes
    except Exception:
        return cached.get("closes", [])


def detect_stage(weekly_candles: list) -> dict:
    """
    Clasifica la etapa de Weinstein (1-4) usando velas semanales.
    Requiere al menos 34 semanas para calcular SMA30 semanal.

    Stage 1 — Acumulación: precio consolidando, SMA30 plana
    Stage 2 — Avance: precio > SMA30, SMA30 con pendiente alcista ← ideal
    Stage 3 — Distribución: precio en techo, SMA30 pierde pendiente
    Stage 4 — Declive: precio < SMA30, SMA30 con pendiente bajista
    """
    if len(weekly_candles) < 34:
        return {"stage": None, "description": "Datos insuficientes para Stage Analysis"}

    closes = [c["close"] for c in weekly_candles]

    # SMA30 semanal — necesita 30 velas
    def sma_n(data, n):
        if len(data) < n:
            return None
        return sum(data[-n:]) / n

    sma30_now  = sma_n(closes, 30)
    sma30_4w   = sma_n(closes[:-4], 30) if len(closes) >= 34 else None

    if sma30_now is None or sma30_4w is None:
        return {"stage": None, "description": "SMA30 insuficiente"}

    price_now  = closes[-1]
    slope      = (sma30_now - sma30_4w) / sma30_4w * 100  # % cambio en 4 semanas
    above_sma  = price_now > sma30_now

    # Clasificación
    if above_sma and slope > 0.5:
        stage = 2
        label = "Avance (Stage 2)"
        desc  = f"Precio sobre SMA30 semanal con pendiente +{slope:.1f}% — estructura alcista confirmada"
    elif above_sma and abs(slope) <= 0.5:
        stage = 3
        label = "Distribución (Stage 3)"
        desc  = f"Precio sobre SMA30 pero pendiente plana ({slope:+.1f}%) — posible techo"
    elif not above_sma and slope < -0.5:
        stage = 4
        label = "Declive (Stage 4)"
        desc  = f"Precio bajo SMA30 con pendiente {slope:.1f}% — tendencia bajista activa"
    else:
        # Bajo SMA30 pero pendiente frenando o ligeramente positiva → acumulación
        stage = 1
        label = "Acumulación (Stage 1)"
        desc  = f"Precio bajo SMA30, pendiente {slope:+.1f}% — base en formación"

    return {
        "stage":       stage,
        "label":       label,
        "description": desc,
        "sma30_weekly": round(sma30_now, 2),
        "slope_4w_pct": round(slope, 2),
        "price_above_sma30": above_sma,
    }


def analyze_base(weekly_candles: list) -> dict:
    """
    Detecta la base de consolidación actual en velas semanales.

    Una 'base' es un período donde el precio se mueve en un rango estrecho
    (<= 35% de amplitud) sin romper por debajo del soporte previo.

    Retorna:
      weeks_in_base  — semanas que lleva en base (0 si no hay base)
      base_quality   — 'sound' (>6 semanas) | 'short' (3-5 sem) | 'none'
      range_pct      — amplitud del rango como % (alto-bajo / bajo)
      breakout_vol   — True si el volumen reciente es ≥1.5× promedio de la base
      description    — texto explicativo
    """
    if len(weekly_candles) < 3:
        return {"weeks_in_base": 0, "base_quality": "none", "range_pct": None,
                "breakout_vol": None, "description": "Datos insuficientes"}

    closes  = [c["close"]  for c in weekly_candles]
    highs   = [c["high"]   for c in weekly_candles]
    lows    = [c["low"]    for c in weekly_candles]
    volumes = [c.get("volume", 0) for c in weekly_candles]
    has_vol = any(v > 0 for v in volumes)

    # Buscar el inicio de la base actual — recorremos hacia atrás desde la última vela
    # La base termina donde el precio rompe con fuerza (cierre > high de la base + 5%)
    # o donde cae por debajo del soporte (cierre < mínimo de la base - 3%)
    base_start = len(closes) - 1
    base_high  = highs[-1]
    base_low   = lows[-1]

    for i in range(len(closes) - 2, max(0, len(closes) - 53), -1):  # máx 52 semanas atrás
        week_high  = highs[i]
        week_low   = lows[i]
        week_close = closes[i]

        new_high = max(base_high, week_high)
        new_low  = min(base_low, week_low)
        rng = (new_high - new_low) / new_low * 100 if new_low > 0 else 999

        # Si la ampliación del rango supera 35% el rango es demasiado ancho → fin de la base
        if rng > 35:
            break
        # Si el cierre de esa semana cae > 15% bajo el mínimo actual → ruptura bajista → fin
        if week_close < base_low * 0.85:
            break

        base_high  = new_high
        base_low   = new_low
        base_start = i

    weeks_in_base = len(closes) - base_start  # número de velas incluidas en la base
    range_pct     = round((base_high - base_low) / base_low * 100, 1) if base_low > 0 else None

    # Calidad de la base
    if weeks_in_base >= 7:
        quality = "sound"     # base sólida ≥ 7 semanas
    elif weeks_in_base >= 3:
        quality = "short"     # base corta 3-6 semanas
    else:
        quality = "none"

    # Volumen en breakout vs promedio de la base
    base_vols   = volumes[base_start:] if has_vol else []
    avg_base_vol = sum(base_vols) / len(base_vols) if base_vols else None
    last_vol     = volumes[-1] if has_vol and volumes else None
    breakout_vol = None
    if avg_base_vol and last_vol:
        bvr = last_vol / avg_base_vol
        breakout_vol = bvr >= 1.5

    # Descripción
    if quality == "none":
        desc = "No hay base clara de consolidación (< 3 semanas)"
    elif quality == "short":
        desc = f"Base corta de {weeks_in_base} semanas — rango {range_pct}%"
    else:
        bvol_txt = ""
        if breakout_vol is True:    bvol_txt = " — volumen de breakout confirmado ✓"
        elif breakout_vol is False: bvol_txt = " — breakout sin volumen confirmado"
        desc = f"Base sólida de {weeks_in_base} semanas — rango {range_pct}%{bvol_txt}"

    return {
        "weeks_in_base": weeks_in_base,
        "base_quality":  quality,
        "range_pct":     range_pct,
        "breakout_vol":  breakout_vol,
        "description":   desc,
    }


def detect_hh_hl(weekly_candles: list) -> dict:
    """
    Detecta Higher Highs / Higher Lows usando highs y lows de velas semanales.
    Usa las últimas 26 semanas (~6 meses) para capturar la estructura de tendencia.
    Los pivots se detectan con los extremos reales de cada vela, no los cierres.
    """
    candles = weekly_candles[-26:] if len(weekly_candles) >= 26 else weekly_candles
    if len(candles) < 5:
        return {"score": 0, "hh_count": 0, "hl_count": 0, "description": "Datos semanales insuficientes"}

    wk_highs = [c["high"]  for c in candles]
    wk_lows  = [c["low"]   for c in candles]

    # Pivot highs: vela cuyo high supera al anterior y al siguiente
    # Pivot lows:  vela cuyo low está por debajo del anterior y el siguiente
    highs_pivot, lows_pivot = [], []
    for i in range(1, len(candles) - 1):
        if wk_highs[i] > wk_highs[i-1] and wk_highs[i] > wk_highs[i+1]:
            highs_pivot.append(wk_highs[i])
        if wk_lows[i] < wk_lows[i-1] and wk_lows[i] < wk_lows[i+1]:
            lows_pivot.append(wk_lows[i])

    # Contar pivots crecientes significativos (mínimo 0.5% de diferencia)
    # Filtra micro-oscilaciones laterales que no representan tendencia real
    MIN_MOVE = 0.005
    hh_count = sum(
        1 for i in range(1, len(highs_pivot))
        if highs_pivot[i] > highs_pivot[i-1] * (1 + MIN_MOVE)
    )
    hl_count = sum(
        1 for i in range(1, len(lows_pivot))
        if lows_pivot[i] > lows_pivot[i-1] * (1 + MIN_MOVE)
    )

    # Score: basta con HH o HL, no necesita ambos igual de fuertes
    combined = hh_count + hl_count
    if combined >= 4:
        score = 3
    elif combined >= 2:
        score = 2
    elif combined >= 1:
        score = 1
    else:
        score = 0

    return {
        "score":    score,
        "hh_count": hh_count,
        "hl_count": hl_count,
        "description": f"{hh_count} máximos crecientes + {hl_count} mínimos crecientes (últimas 26 semanas)"
    }


def calc_position_scorecard(data: dict) -> dict:
    """Puntúa los 7 criterios del scorecard de position trading."""
    from datetime import date as _date

    price        = data["price"]
    sma50        = data["sma50"]
    sma200       = data["sma200"]
    rs_spy       = data["mansfield_rs"]
    rs_sector    = data["rs_sector"]
    hh_hl        = data["hh_hl"]
    stage_data   = data.get("stage", {}) or {}
    fundamentals = data["fundamentals"] or {}
    cashflow     = data["cashflow"] or {}
    vol_ratio    = data["vol_ratio"]
    rr_suggested = data.get("rr_suggested")
    next_earnings = data.get("next_earnings")
    highs        = data.get("highs", [])
    lows         = data.get("lows", [])
    volumes      = data.get("volumes", [])

    criteria = {}

    # 1. Narrativa activa x3 — subjetivo, Claude sugiere luego
    criteria["narrativa"] = {
        "peso": 3, "score_sugerido": 1, "es_automatico": False,
        "justificacion": "Evalúa si existe un catalizador estructural de crecimiento (IA, regulación, ciclo de producto, expansión geográfica, etc.)"
    }

    # 2. Precio vs SMA200 x3 — gradual (no binario)
    # La distancia importa: acabar de cruzar SMA200 no es igual que llevar meses sobre ella
    if sma200 and price > sma200:
        dist_sma200 = (price - sma200) / sma200 * 100
        if dist_sma200 >= 15:
            sma200_score = 3
            sma200_desc  = f"Precio {dist_sma200:.1f}% sobre SMA200 — tendencia madura y confirmada"
        elif dist_sma200 >= 5:
            sma200_score = 2
            sma200_desc  = f"Precio {dist_sma200:.1f}% sobre SMA200 — tendencia alcista establecida"
        else:
            sma200_score = 1
            sma200_desc  = f"Precio {dist_sma200:.1f}% sobre SMA200 — recién sobre la media, confirmar sostenibilidad"
        criteria["precio_sma200"] = {
            "peso": 3, "score_sugerido": sma200_score, "es_automatico": True,
            "justificacion": sma200_desc, "es_veto": False
        }
    else:
        criteria["precio_sma200"] = {
            "peso": 3, "score_sugerido": 0, "es_automatico": True,
            "justificacion": f"Precio ${price} BAJO SMA200 ${sma200 or 'N/A'} — estructura bajista",
            "es_veto": True
        }

    # 3. Estructura técnica x3 — combina Stage Weinstein + HH/HL
    # Stage 2 confirma la tendencia de largo plazo; HH/HL confirma la calidad de la subida.
    # La pendiente de la SMA30 semanal distingue Stage 2 emergente (ideal) de Stage 2 tardío
    # (SMA aplanándose → distribución inminente). Esto evita entrar en Stage 2 casi terminado.
    stage_num   = stage_data.get("stage")
    slope_4w    = stage_data.get("slope_4w_pct")  # % cambio SMA30 en 4 semanas
    hh_hl_score = hh_hl["score"]  # 0–3

    # Stage 2 con pendiente fuerte (>1.5%): tendencia sana, acelerando → vale 3 base
    # Stage 2 con pendiente moderada (0.5–1.5%): tendencia establecida → vale 2 base
    # Stage 2 con pendiente aplanando (<0.5%): Stage 2 tardío, posible distribución → vale 1 base
    # Stage 1: acumulación, puede entrar anticipando breakout → vale 1 base
    # Stage 3/4 o sin datos: penaliza → vale 0 base
    if stage_num == 2:
        if slope_4w is not None and slope_4w > 1.5:
            stage_base = 3   # Stage 2 fuerte y acelerando
        elif slope_4w is not None and slope_4w > 0.5:
            stage_base = 2   # Stage 2 establecido
        else:
            stage_base = 1   # Stage 2 tardío — SMA30 aplanándose
    elif stage_num == 1:
        stage_base = 1
    else:
        stage_base = 0

    # HH/HL añade 1 punto si es ≥ 2 (estructura alcista clara), pero no puede subir si stage_base=0
    hh_bonus = 1 if (hh_hl_score >= 2 and stage_base > 0) else 0
    struct_score = min(3, stage_base + hh_bonus)

    slope_txt = f" (pendiente {slope_4w:+.1f}%)" if slope_4w is not None else ""
    struct_desc = (
        f"{stage_data.get('label', 'Stage desconocido')}{slope_txt} | "
        f"HH/HL: {hh_hl['hh_count']} máx + {hh_hl['hl_count']} mín crecientes"
    )
    criteria["estructura_tecnica"] = {
        "peso": 3, "score_sugerido": struct_score, "es_automatico": True,
        "justificacion": struct_desc
    }

    # 4. RS vs sector/SPY x2 — automático
    # Combina Mansfield RS vs SPY y RS vs sector propio
    if rs_spy is not None:
        if rs_spy > 2:    score_rs, rs_desc = 3, f"Mansfield RS {rs_spy} — líder claro vs S&P500"
        elif rs_spy > 0:  score_rs, rs_desc = 2, f"Mansfield RS {rs_spy} — supera al S&P500"
        elif rs_spy >= -1: score_rs, rs_desc = 1, f"Mansfield RS {rs_spy} — similar al S&P500"
        else:              score_rs, rs_desc = 0, f"Mansfield RS {rs_spy} — rezagado vs S&P500"

        if rs_sector is not None:
            rs_desc += f" | RS vs sector: {rs_sector:+.2f}"
            # Si lidera su sector aunque RS vs SPY sea moderado → bonus +1 (máx 3)
            if rs_sector > 1 and score_rs < 3:
                score_rs = min(3, score_rs + 1)
                rs_desc += " ✓ líder sectorial"
    else:
        score_rs, rs_desc = 1, "RS no calculable — datos insuficientes"
    criteria["rs_relativa"] = {
        "peso": 2, "score_sugerido": score_rs, "es_automatico": True,
        "justificacion": rs_desc
    }

    # 5. Calidad fundamental x3 — semi-automático (peso aumentado: fundamentales > timing exacto)
    rev_growth     = fundamentals.get("revenueGrowth")    # % YoY
    eps_growth     = fundamentals.get("epsGrowth")        # % YoY
    profit_margin  = fundamentals.get("profitMargin")     # % neto
    op_margin      = fundamentals.get("operatingMargin")  # % operativo
    analyst_sb     = fundamentals.get("analystStrongBuy") or 0
    analyst_buy    = fundamentals.get("analystBuy") or 0
    fcf_positive   = cashflow.get("fcf_positive")

    fund_score = 0
    fund_points = []

    # ── Punto 1: Crecimiento de ingresos ──────────────────────────────────────
    rev_strong   = rev_growth is not None and rev_growth > 10
    rev_moderate = rev_growth is not None and 0 < rev_growth <= 10
    rev_negative = rev_growth is not None and rev_growth < 0

    if rev_strong:
        fund_score += 1; fund_points.append(f"Revenue +{rev_growth}% YoY")
    elif rev_moderate:
        fund_points.append(f"Revenue +{rev_growth}% YoY (moderado)")
    elif rev_negative:
        fund_points.append(f"Revenue {rev_growth}% YoY (contracción)")

    # ── Punto 2: Crecimiento de beneficios (EPS) ──────────────────────────────
    eps_strong   = eps_growth is not None and eps_growth > 20
    eps_positive = eps_growth is not None and 0 < eps_growth <= 20
    eps_negative = eps_growth is not None and eps_growth < 0

    if eps_strong:
        fund_score += 1; fund_points.append(f"EPS +{eps_growth}% YoY (acelerando)")
    elif eps_positive:
        fund_points.append(f"EPS +{eps_growth}% YoY")
        # Rev fuerte (>10%) + EPS positivo → 2 puntos sólidos
        if rev_strong:
            fund_score += 1; fund_points[-1] += " ✓"
        # Rev moderado + EPS positivo → juntos valen 1 punto
        elif rev_moderate and fund_score == 0:
            fund_score += 1; fund_points[-1] += " | combo growth ✓"
    elif eps_negative:
        fund_points.append(f"EPS {eps_growth}% YoY (deterioro)")

    # ── Punto 3: Calidad del negocio — FCF y márgenes ─────────────────────────
    quality_ok = False
    if fcf_positive is True:
        quality_ok = True; fund_points.append("FCF positivo")
    if profit_margin is not None and profit_margin > 10:
        quality_ok = True; fund_points.append(f"Margen neto {profit_margin}%")
    elif op_margin is not None and op_margin > 15:
        quality_ok = True; fund_points.append(f"Margen operativo {op_margin}%")
    if quality_ok:
        fund_score += 1

    fund_score = min(3, fund_score)
    criteria["calidad_fundamental"] = {
        "peso": 3, "score_sugerido": fund_score, "es_automatico": True,
        "justificacion": " | ".join(fund_points) if fund_points else "Datos fundamentales insuficientes — revisar manualmente"
    }

    # 6. Punto de entrada x2 — automático
    # Combina: posición vs SMA50, volumen diario de breakout, y calidad de la base semanal
    base      = data.get("base", {}) or {}
    entry_score, entry_desc = 1, "Datos insuficientes"
    if sma50 and price > 0:
        dist_sma50 = ((price - sma50) / sma50) * 100

        # Volumen en breakout: max volumen de los últimos 5 días vs promedio de los 20 días
        # previos (días -25 a -5). Se excluyen los últimos 5 días del denominador para no
        # contaminar el promedio base con el propio volumen del movimiento que se evalúa.
        recent_vol_max = max(volumes[-5:]) if len(volumes) >= 5 else None
        base_vols = volumes[-25:-5] if len(volumes) >= 25 else (volumes[:-5] if len(volumes) > 5 else [])
        avg_vol_20 = sum(base_vols) / len(base_vols) if base_vols else None
        breakout_vol_ratio = round(recent_vol_max / avg_vol_20 * 100) if (recent_vol_max and avg_vol_20) else None
        breakout_confirmed = breakout_vol_ratio and breakout_vol_ratio >= 150

        # ¿Precio cerca de máximo de 52 semanas? → posible breakout
        high_52w = max(highs[-252:]) if len(highs) >= 252 else max(highs)
        near_52w_high = price >= high_52w * 0.95

        # Info de base semanal para enriquecer la descripción
        base_quality  = base.get("base_quality", "none")
        weeks_in_base = base.get("weeks_in_base", 0)
        base_bvol     = base.get("breakout_vol")   # True/False/None
        base_suffix   = ""
        if base_quality == "sound":
            base_suffix = f" | Base sólida {weeks_in_base}sem ✓"
        elif base_quality == "short":
            base_suffix = f" | Base corta {weeks_in_base}sem"

        if near_52w_high:
            # Zona de breakout / nuevos máximos — la mejor condición en position trading
            if breakout_confirmed or base_bvol is True:
                entry_score = 3
                vol_txt = f"{breakout_vol_ratio}%" if breakout_vol_ratio else "semanal ✓"
                entry_desc = f"Breakout en zona de máximos — volumen {vol_txt} confirmado{base_suffix}"
            else:
                entry_score = 2
                entry_desc = f"Breakout en máximos — sin confirmación de volumen ({breakout_vol_ratio or '?'}%){base_suffix}"
        elif -5 <= dist_sma50 <= 10:
            # Pullback limpio a SMA50 — zona óptima de entrada
            if vol_ratio < 80:
                entry_score = 3
                entry_desc = f"Pullback a SMA50 ({dist_sma50:+.1f}%) volumen bajo ({vol_ratio}%) — entrada ideal{base_suffix}"
            else:
                entry_score = 2
                entry_desc = f"Cerca de SMA50 ({dist_sma50:+.1f}%) — vol {vol_ratio}%, esperar absorción{base_suffix}"
        elif 10 < dist_sma50 <= 25:
            # Extendido pero en rango normal para tendencias sanas
            entry_score = 2
            entry_desc = f"Precio {dist_sma50:.1f}% sobre SMA50 — algo extendido, esperar pullback{base_suffix}"
        elif dist_sma50 > 25:
            # Muy extendido — riesgo de corrección significativa
            entry_score = 1
            entry_desc = f"Precio {dist_sma50:.1f}% sobre SMA50 — sobreextendido, esperar pullback a SMA50"
        elif dist_sma50 < -5:
            entry_score = 1
            entry_desc = f"Precio {abs(dist_sma50):.1f}% bajo SMA50 — debilidad temporal o cambio de tendencia{base_suffix}"
    criteria["punto_entrada"] = {
        "peso": 1, "score_sugerido": entry_score, "es_automatico": True,
        "justificacion": entry_desc
    }

    # 7. Ratio R/R x2 — calculado con niveles sugeridos
    # Nota: este es un R/R preliminar automático, el usuario puede ajustarlo.
    # Score mínimo 1 salvo veto (R/R < 1.5 = no compensa el riesgo).
    if rr_suggested is not None:
        if rr_suggested >= 3:     rr_score = 3
        elif rr_suggested >= 2:   rr_score = 2
        else:                     rr_score = 0  # R/R < 2 no compensa el riesgo → score 0 + veto
        rr_veto = rr_suggested < 2
        rr_desc = f"R/R preliminar {rr_suggested:.1f}x (estimado automático — ajustar con niveles reales)"
    else:
        rr_score, rr_veto = 0, False
        rr_desc = "R/R pendiente — definir entrada, stop y objetivo manualmente"
    criteria["ratio_rr"] = {
        "peso": 2, "score_sugerido": rr_score, "es_automatico": True,
        "justificacion": rr_desc,
        "es_veto": rr_veto
    }

    # ── Confidence score — cuántos criterios tienen datos reales vs defaults ──
    # Criterios que dependen de datos externos que pueden faltar:
    # narrativa: siempre subjetivo/IA — contar si Haiku lo actualizó (se marca luego)
    # precio_sma200: siempre real (precio + SMA200 siempre disponibles)
    # estructura_tecnica: real si stage_num != 0 (no desconocido)
    # rs_relativa: real si rs_spy is not None
    # calidad_fundamental: real si hay al menos un dato fundamental
    # punto_entrada: siempre real (precio + SMA50)
    # ratio_rr: real si rr_suggested is not None
    data_flags = {
        "precio_sma200":      True,  # siempre disponible
        "estructura_tecnica": stage_data.get("stage", 0) != 0,
        "rs_relativa":        rs_spy is not None,
        "calidad_fundamental": any(fundamentals.get(k) is not None
                                   for k in ["revenueGrowth","epsGrowth","profitMargin","operatingMargin"]),
        "punto_entrada":      True,  # siempre disponible
        "ratio_rr":           rr_suggested is not None,
        "narrativa":          False,  # se actualiza a True si Haiku responde (ver _analyze_position_inner)
    }
    criteria["_confidence"] = {
        "total": len(data_flags),
        "real": sum(data_flags.values()),
        "flags": data_flags,
    }

    return criteria


@app.get("/analyze-position/{ticker}")
async def analyze_position(ticker: str):
    ticker = ticker.upper().strip()
    try:
        return await _analyze_position_inner(ticker)
    except HTTPException:
        raise
    except Exception as e:
        import traceback as _tb
        detail = f"{type(e).__name__}: {e}\n{_tb.format_exc()[-800:]}"
        print(f"ANALYZE-POSITION ERROR {ticker}: {detail}")
        raise HTTPException(status_code=500, detail=detail)


async def _analyze_position_inner(ticker: str):
    async with httpx.AsyncClient(timeout=25) as http:
        candles, fundamentals, spy_closes, next_earnings, rt_quote, weekly_candles, cashflow = \
            await asyncio.gather(
                fetch_prices(ticker, http),
                fetch_fundamentals(ticker, http),
                fetch_spy_closes(http),
                fetch_earnings(ticker, http),
                fetch_realtime_quote(ticker, http),
                fetch_prices_weekly(ticker, http),
                fetch_cashflow(ticker, http),
            )

    if len(candles) < 5:
        raise HTTPException(status_code=404, detail=f"Datos insuficientes para {ticker}")

    closes  = [c["close"]  for c in candles]
    highs   = [c["high"]   for c in candles]
    lows    = [c["low"]    for c in candles]
    volumes = [c["volume"] for c in candles]

    price = round(rt_quote["price"], 2) if rt_quote and rt_quote.get("price", 0) > 0 else round(closes[-1], 2)

    sma20  = calc_sma(closes, 20)
    sma50  = calc_sma(closes, 50)
    sma200 = calc_sma(closes, 200)
    rsi    = calc_rsi(closes)
    atr    = calc_atr(highs, lows, closes)
    mansfield_rs     = calc_mansfield_rs(closes, spy_closes)
    mansfield_rs_raw = calc_mansfield_rs_raw(closes, spy_closes)

    avg_vol   = sum(volumes[-20:]) / min(20, len(volumes))
    cur_vol   = rt_quote.get("volume", volumes[-1]) if rt_quote else volumes[-1]
    vol_ratio = round(cur_vol / avg_vol * 100) if avg_vol else 100

    # SPY vs SMA200 — contexto macro automático
    spy_sma200 = calc_sma(spy_closes, 200)
    spy_price  = spy_closes[-1] if spy_closes else None
    spy_above  = (spy_price > spy_sma200) if (spy_price and spy_sma200) else None
    macro_context = {
        "spy_price":        round(spy_price, 2) if spy_price else None,
        "spy_sma200":       round(spy_sma200, 2) if spy_sma200 else None,
        "spy_above_sma200": spy_above,
        "market_regime":    "bull" if spy_above else ("bear" if spy_above is False else "unknown"),
    }

    # RS vs sector ETF
    sector     = (fundamentals or {}).get("sector")
    sector_etf = SECTOR_ETF_MAP.get(sector)
    rs_sector  = None
    if sector_etf:
        async with httpx.AsyncClient(timeout=15) as http2:
            sector_closes = await fetch_sector_etf_closes(sector_etf, http2)
        if sector_closes:
            rs_sector = calc_mansfield_rs(closes, sector_closes)

    # Stage Analysis (Weinstein) + HH/HL + Base Analysis en datos semanales
    stage_data = detect_stage(weekly_candles)
    hh_hl_data = detect_hh_hl(weekly_candles)
    base_data  = analyze_base(weekly_candles)

    # ── Sizing preliminar ──────────────────────────────────────────────────────
    high_52w_e = max(highs[-252:]) if len(highs) >= 252 else max(highs)
    near_high  = price >= high_52w_e * 0.95

    # Entrada: breakout → precio actual | pullback → SMA50
    entry_sug = round(price, 2) if near_high else (round(sma50, 2) if sma50 else round(price, 2))

    # Stop: usar el low de la base semanal detectada por analyze_base() con -2% de margen.
    # Esto es técnicamente correcto: el stop va por debajo del soporte de la base,
    # no a una distancia arbitraria de días diarios.
    # Fallback: mínimo de los últimos 10 días si no hay base semanal disponible.
    base_low_weekly = None
    if base_data and base_data.get("base_quality") in ("sound", "short"):
        # Calcular el low real de la base a partir de las velas semanales
        n = base_data.get("weeks_in_base", 0)
        if n > 0 and len(weekly_candles) >= n:
            base_low_weekly = min(c["low"] for c in weekly_candles[-n:])

    if base_low_weekly:
        stop_sug = round(base_low_weekly * 0.98, 2)
    else:
        # Fallback: mínimo de los últimos 10 días hábiles
        fallback_lows = lows[-10:] if len(lows) >= 10 else lows
        stop_sug = round(min(fallback_lows) * 0.98, 2)

    # Target: R/R 2.5x desde la entrada
    if entry_sug and stop_sug and entry_sug > stop_sug:
        risk_amt   = entry_sug - stop_sug
        target_sug = round(entry_sug + risk_amt * 2.5, 2)
    else:
        target_sug = round(entry_sug * 1.20, 2) if entry_sug else None

    rr_suggested = None
    if entry_sug and stop_sug and target_sug and entry_sug > stop_sug:
        risk = entry_sug - stop_sug
        if risk > 0:
            rr_suggested = round((target_sug - entry_sug) / risk, 2)

    # Scorecard automático
    scorecard = calc_position_scorecard({
        "price": price, "sma50": sma50, "sma200": sma200,
        "mansfield_rs": mansfield_rs, "rs_sector": rs_sector,
        "hh_hl": hh_hl_data, "stage": stage_data,
        "fundamentals": fundamentals,
        "cashflow": cashflow, "vol_ratio": vol_ratio,
        "rr_suggested": rr_suggested, "next_earnings": next_earnings,
        "highs": highs, "lows": lows, "volumes": volumes,
        "base": base_data,
    })

    # Claude Haiku — evalúa narrativa activa
    # Prompt enriquecido con sector, industria, fundamentales completos y contexto técnico
    fund = fundamentals or {}
    try:
        haiku_prompt = (
            f"Eres analista senior de position trading (horizonte 3-12 meses).\n"
            f"Empresa: {fund.get('name', ticker)} ({ticker})\n"
            f"Sector: {sector or 'desconocido'} | Industria: {fund.get('industry', 'N/A')}\n"
            f"\nFundamentales:\n"
            f"  Revenue growth YoY: {fund.get('revenueGrowth', 'N/A')}%\n"
            f"  EPS growth YoY: {fund.get('epsGrowth', 'N/A')}%\n"
            f"  Margen neto: {fund.get('profitMargin', 'N/A')}%\n"
            f"  Margen operativo: {fund.get('operatingMargin', 'N/A')}%\n"
            f"  P/E ratio: {fund.get('peRatio', 'N/A')}\n"
            f"  Market cap: {fund.get('mktCap', 'N/A')}\n"
            f"  Analistas buy/strong buy: {(fund.get('analystBuy') or 0) + (fund.get('analystStrongBuy') or 0)}\n"
            f"\nTécnico:\n"
            f"  Precio: ${price} | SMA200: ${sma200} | Mansfield RS vs SPY: {mansfield_rs}\n"
            f"  Stage Weinstein: {stage_data.get('label', 'N/A')}\n"
            f"  Próximos earnings: {next_earnings or 'sin fecha'}\n"
            f"\nPregunta: ¿Existe un tema estructural de crecimiento que justifique esta acción como "
            f"position trade de mediano plazo?\n"
            f"Criterios de scoring (sé conservador — score 3 solo si hay evidencia muy clara):\n"
            f"  0 = sin narrativa clara, negocio maduro sin catalizador visible\n"
            f"  1 = posible catalizador pero débil, maduro o sin confirmación en números\n"
            f"  2 = narrativa activa con evidencia en ingresos o márgenes crecientes\n"
            f"  3 = tema dominante del mercado con flujo institucional confirmado (IA pura, GLP-1, ciberseguridad líder)\n"
            f"Responde SOLO JSON sin texto extra: "
            + '{"narrativa_sugerida":1,"narrativa_razon":"razón concreta en español (máx 15 palabras)"}'
        )
        haiku_msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=200,
            messages=[{"role": "user", "content": haiku_prompt}]
        )
        haiku_json = extract_json(haiku_msg.content[0].text)
        scorecard["narrativa"]["score_sugerido"] = int(haiku_json.get("narrativa_sugerida", 1))
        scorecard["narrativa"]["justificacion"]   = haiku_json.get("narrativa_razon", scorecard["narrativa"]["justificacion"])
        if scorecard.get("_confidence"):
            scorecard["_confidence"]["flags"]["narrativa"] = True
            scorecard["_confidence"]["real"] = sum(scorecard["_confidence"]["flags"].values())
    except Exception as e:
        print(f"Haiku position error {ticker}: {e}")

    # Score total sugerido (excluir _confidence que no es criterio)
    score_total = sum(
        v["score_sugerido"] * v["peso"]
        for k, v in scorecard.items()
        if k != "_confidence"
    )

    # Ajuste macro: en mercado bajista (SPY < SMA200) aplicar penalización
    # Weinstein: nunca comprar Stage 2 en mercado Stage 4
    # -4 pts en bear baja el umbral efectivo de CONVICCIÓN de 32 a 36
    market_penalty = 0
    if spy_above is False:
        market_penalty = 4
        score_total = max(0, score_total - market_penalty)

    return JSONResponse(content={
        "ticker":          ticker,
        "company_name":    (fundamentals or {}).get("name"),
        "sector":          sector,
        "sector_etf":      sector_etf,
        "price":           price,
        "sma20":           sma20,
        "sma50":           sma50,
        "sma200":          sma200,
        "rsi":             rsi,
        "vol_ratio":       vol_ratio,
        "atr":             round(atr, 2),
        "mansfield_rs":     mansfield_rs,
        "mansfield_rs_raw": mansfield_rs_raw,
        "rs_sector":        rs_sector,
        "macro_context":   macro_context,
        "hh_hl":           hh_hl_data,
        "stage":           stage_data,
        "base":            base_data,
        "next_earnings":   next_earnings,
        "entry_suggested": entry_sug,
        "stop_suggested":  stop_sug,
        "target_suggested": target_sug,
        "rr_suggested":    rr_suggested,
        "scorecard":       scorecard,
        "score_total_suggested": score_total,
        "market_penalty":  market_penalty,
        "fundamentals":    fundamentals,
        "cashflow":        cashflow,
    }, media_type="application/json; charset=utf-8")


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


# ── Position Screener ────────────────────────────────────────────────────────

_POSITION_SCREENER_CACHE: dict = {}
_POSITION_SCREENER_TS: float = 0
_POSITION_SCREENER_TTL = 3600  # 1 hora — se actualiza semanalmente

_GITHUB_RAW_POSITION         = "https://raw.githubusercontent.com/orlaknns/swing-agent/main/data/screener_position.json"
_GITHUB_RAW_POSITION_HISTORY = "https://raw.githubusercontent.com/orlaknns/swing-agent/main/data/screener_position_history.json"
_POSITION_HISTORY_CACHE: dict = {}
_POSITION_HISTORY_TS: float   = 0

_POSITION_CURATED_FALLBACK = {
    "candidates": [
        {"ticker":"AAPL",  "company":"Apple Inc",          "sector":"Technology"},
        {"ticker":"MSFT",  "company":"Microsoft Corp",      "sector":"Technology"},
        {"ticker":"NVDA",  "company":"NVIDIA Corp",         "sector":"Technology"},
        {"ticker":"GOOGL", "company":"Alphabet Inc",        "sector":"Technology"},
        {"ticker":"META",  "company":"Meta Platforms",      "sector":"Communication"},
        {"ticker":"AMZN",  "company":"Amazon.com",          "sector":"Consumer Cyclical"},
        {"ticker":"JPM",   "company":"JPMorgan Chase",      "sector":"Financial"},
        {"ticker":"V",     "company":"Visa Inc",            "sector":"Financial"},
        {"ticker":"UNH",   "company":"UnitedHealth Group",  "sector":"Healthcare"},
        {"ticker":"LLY",   "company":"Eli Lilly",           "sector":"Healthcare"},
        {"ticker":"AVGO",  "company":"Broadcom Inc",        "sector":"Technology"},
        {"ticker":"COST",  "company":"Costco Wholesale",    "sector":"Consumer Defensive"},
        {"ticker":"NOW",   "company":"ServiceNow",          "sector":"Technology"},
        {"ticker":"ISRG",  "company":"Intuitive Surgical",  "sector":"Healthcare"},
        {"ticker":"GE",    "company":"GE Aerospace",        "sector":"Industrials"},
    ],
    "count": 15, "date": "", "updatedAt": "", "source": "curated",
}


async def _load_position_screener_json() -> dict:
    """Lee screener_position.json desde GitHub raw con caché de 1 hora."""
    global _POSITION_SCREENER_CACHE, _POSITION_SCREENER_TS
    now = _time.time()
    if _POSITION_SCREENER_CACHE and (now - _POSITION_SCREENER_TS) < _POSITION_SCREENER_TTL:
        return _POSITION_SCREENER_CACHE
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            bust_url = f"{_GITHUB_RAW_POSITION}?t={int(now)}"
            r = await c.get(bust_url, headers={"Cache-Control": "no-cache", "Pragma": "no-cache"})
            if r.status_code == 200:
                data = r.json()
                _POSITION_SCREENER_CACHE = data
                _POSITION_SCREENER_TS = now
                print(f"Position screener loaded: {data.get('count', 0)} tickers | source={data.get('source')} | date={data.get('date')}")
                return data
    except Exception as e:
        print(f"Error loading position screener: {e}")
    return _POSITION_SCREENER_CACHE or _POSITION_CURATED_FALLBACK


async def _load_position_history() -> dict:
    """Lee screener_position_history.json desde GitHub raw con caché de 1 hora."""
    global _POSITION_HISTORY_CACHE, _POSITION_HISTORY_TS
    now = _time.time()
    if _POSITION_HISTORY_CACHE and (now - _POSITION_HISTORY_TS) < 3600:
        return _POSITION_HISTORY_CACHE
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(f"{_GITHUB_RAW_POSITION_HISTORY}?t={int(now)}",
                            headers={"Cache-Control": "no-cache"})
            if r.status_code == 200:
                _POSITION_HISTORY_CACHE = r.json()
                _POSITION_HISTORY_TS    = now
                return _POSITION_HISTORY_CACHE
    except Exception:
        pass
    return _POSITION_HISTORY_CACHE or {"snapshots": []}


@app.get("/screener-position")
async def screener_position():
    """Devuelve candidatas de position trading desde GitHub (actualizado semanalmente)."""
    data, history = await asyncio.gather(
        _load_position_screener_json(),
        _load_position_history(),
    )
    candidates = data.get("candidates", [])

    # Calcular frecuencia histórica por ticker
    snapshots = history.get("snapshots", [])
    ticker_weeks: dict[str, int] = {}
    ticker_first: dict[str, str] = {}
    for snap in snapshots:
        for t in snap.get("tickers", []):
            ticker_weeks[t] = ticker_weeks.get(t, 0) + 1
            if t not in ticker_first:
                ticker_first[t] = snap["date"]

    # Enriquecer candidatos con datos históricos
    for c in candidates:
        t = c.get("ticker", "")
        c["weeksInScreener"] = ticker_weeks.get(t, 0)
        c["firstSeen"]       = ticker_first.get(t)

    return JSONResponse(
        content={
            "candidates": candidates,
            "count": len(candidates),
            "date": data.get("date", ""),
            "updatedAt": data.get("updatedAt", ""),
            "source": data.get("source", "curated"),
            "criteria": data.get("criteria", {}),
            "historyWeeks": len(snapshots),
        },
        media_type="application/json; charset=utf-8"
    )


@app.post("/screener-position/refresh")
async def screener_position_refresh():
    """Dispara el workflow de GitHub Actions para actualizar el screener de position."""
    global _POSITION_SCREENER_TS
    token = os.environ.get("GITHUB_TOKEN_WORKFLOW", "")
    if not token:
        return JSONResponse(status_code=503, content={"error": "Token no configurado"})
    url = f"https://api.github.com/repos/{_GH_OWNER}/{_GH_REPO}/actions/workflows/screener-position.yml/dispatches"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(url, headers=headers, json={"ref": "main"})
            if r.status_code == 204:
                _POSITION_SCREENER_TS = 0
                return JSONResponse(content={"ok": True, "message": "Screener en ejecución — listo en ~90 segundos"})
            return JSONResponse(status_code=r.status_code, content={"error": f"GitHub respondió {r.status_code}", "detail": r.text})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


# ── Sector Rotation Tracker ──────────────────────────────────────────────────

_SECTOR_ROTATION_CACHE: dict = {}
_SECTOR_ROTATION_TS: float = 0
_SECTOR_ROTATION_TTL = 3600  # 1 hora

# ETFs canónicos por sector (sin duplicados)
SECTOR_ETFS = [
    ("Technology",             "XLK"),
    ("Financial Services",     "XLF"),
    ("Healthcare",             "XLV"),
    ("Consumer Cyclical",      "XLY"),
    ("Consumer Defensive",     "XLP"),
    ("Energy",                 "XLE"),
    ("Industrials",            "XLI"),
    ("Utilities",              "XLU"),
    ("Basic Materials",        "XLB"),
    ("Real Estate",            "XLRE"),
    ("Communication Services", "XLC"),
]


@app.get("/sector-rotation")
async def sector_rotation():
    """
    Devuelve RS Mansfield de cada sector ETF vs SPY, momentum 4 semanas,
    posición vs SMA50 y SMA200. Caché de 1 hora.
    """
    import time as _t
    global _SECTOR_ROTATION_CACHE, _SECTOR_ROTATION_TS

    if _SECTOR_ROTATION_CACHE and (_t.time() - _SECTOR_ROTATION_TS) < _SECTOR_ROTATION_TTL:
        return JSONResponse(content=_SECTOR_ROTATION_CACHE,
                            media_type="application/json; charset=utf-8")

    try:
        import asyncio as _aio
        # Llamadas secuenciales con delay para evitar rate limit de AV
        # Solo se ejecuta si no hay caché válido (1h TTL por ETF)
        async with httpx.AsyncClient(timeout=25) as http:
            spy_closes = await fetch_spy_closes(http)
            await _aio.sleep(0.5)
            vix_closes = await fetch_sector_etf_closes("VIX", http)
            etf_results = []
            for _, etf in SECTOR_ETFS:
                await _aio.sleep(0.5)
                etf_results.append(await fetch_sector_etf_closes(etf, http))

        sectors = []
        for (sector_name, etf_symbol), closes in zip(SECTOR_ETFS, etf_results):
            if len(closes) < 10:
                sectors.append({
                    "sector": sector_name, "etf": etf_symbol,
                    "price": None, "rs_mansfield": None,
                    "momentum_4w": None, "above_sma50": None, "above_sma200": None,
                    "sma50": None, "sma200": None,
                    "error": "Datos insuficientes"
                })
                continue

            price  = round(closes[-1], 2)
            sma50  = calc_sma(closes, 50)
            sma200 = calc_sma(closes, 200)
            rs     = calc_mansfield_rs(closes, spy_closes)

            # Momentum 4 semanas (~20 días hábiles)
            past_20 = closes[-21] if len(closes) >= 21 else closes[0]
            mom_4w  = round((closes[-1] - past_20) / past_20 * 100, 1) if past_20 else None

            sectors.append({
                "sector":       sector_name,
                "etf":          etf_symbol,
                "price":        price,
                "rs_mansfield": rs,
                "momentum_4w":  mom_4w,
                "above_sma50":  (closes[-1] > sma50)  if sma50  else None,
                "above_sma200": (closes[-1] > sma200) if sma200 else None,
                "sma50":        round(sma50, 2)  if sma50  else None,
                "sma200":       round(sma200, 2) if sma200 else None,
            })

        # Ordenar por RS Mansfield desc (líderes primero)
        sectors.sort(key=lambda s: s["rs_mansfield"] if s["rs_mansfield"] is not None else -999,
                     reverse=True)

        spy_price   = round(spy_closes[-1], 2) if spy_closes else None
        spy_sma200  = calc_sma(spy_closes, 200)
        spy_past_20 = spy_closes[-21] if len(spy_closes) >= 21 else (spy_closes[0] if spy_closes else None)
        spy_mom_4w  = round((spy_closes[-1] - spy_past_20) / spy_past_20 * 100, 1) if spy_past_20 else None

        # VIX actual
        vix_price = round(vix_closes[-1], 2) if vix_closes else None
        vix_regime = (
            "bajo"   if vix_price and vix_price < 15 else
            "normal" if vix_price and vix_price < 20 else
            "elevado" if vix_price and vix_price < 30 else
            "extremo" if vix_price else None
        )

        result = {
            "sectors": sectors,
            "spy": {
                "price":        spy_price,
                "sma200":       round(spy_sma200, 2) if spy_sma200 else None,
                "above_sma200": (spy_closes[-1] > spy_sma200) if (spy_closes and spy_sma200) else None,
                "momentum_4w":  spy_mom_4w,
            },
            "vix": {
                "price":  vix_price,
                "regime": vix_regime,
            },
            "updated_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        }

        _SECTOR_ROTATION_CACHE = result
        _SECTOR_ROTATION_TS    = _t.time()
        return JSONResponse(content=result, media_type="application/json; charset=utf-8")

    except Exception as e:
        import traceback as _tb
        print(f"SECTOR-ROTATION ERROR: {e}\n{_tb.format_exc()[-600:]}")
        raise HTTPException(status_code=500, detail=str(e))
