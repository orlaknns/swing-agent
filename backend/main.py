from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import httpx
import asyncio
import json
import re
import os
from anthropic import Anthropic

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

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
    except Exception:
        return None


async def fetch_prices(ticker: str, client_: httpx.AsyncClient) -> list:
    symbol = TICKER_MAP.get(ticker, ticker)
    url = (
        f"https://www.alphavantage.co/query"
        f"?function=TIME_SERIES_DAILY&symbol={symbol}"
        f"&outputsize=compact&apikey={AV_KEY}"
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

    dates = sorted(ts.keys())[-90:]
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
        candles, fundamentals, spy_closes = await asyncio.gather(
            fetch_prices(ticker, http),
            fetch_fundamentals(ticker, http),
            fetch_spy_closes(http),
        )

    if len(candles) < 5:
        raise HTTPException(status_code=404, detail=f"Datos insuficientes para {ticker}")

    closes  = [c["close"]  for c in candles]
    highs   = [c["high"]   for c in candles]
    lows    = [c["low"]    for c in candles]
    volumes = [c["volume"] for c in candles]

    price      = round(closes[-1], 2)
    prev_close = closes[-2] if len(closes) >= 2 else closes[-1]
    change     = round(((price - prev_close) / prev_close) * 100, 2)

    ema20 = calc_ema(closes, 20)
    ema50 = calc_ema(closes, 50)
    rsi   = calc_rsi(closes)

    avg_vol     = sum(volumes[-20:]) / min(20, len(volumes))
    vol_ratio   = round(volumes[-1] / avg_vol * 100) if avg_vol else 100
    mansfield_rs = calc_mansfield_rs(closes, spy_closes)

    recent_high = max(highs[-20:])
    recent_low  = min(lows[-20:])
    prices_20d  = [round(c, 2) for c in closes[-20:]]
    last_5      = [round(c, 2) for c in closes[-5:]]

    # defaults
    el_default = round(price * 0.995, 2)
    eh_default = round(price * 1.010, 2)
    t1_default = round(price * 1.04,  2)
    t2_default = round(price * 1.08,  2)
    t3_default = round(price * 1.13,  2)
    be_default = round(price * 1.02,  2)
    sl_default = round(price * 0.97,  2)

    prompt = f"""Analiza {ticker} para swing trading. Datos reales:
Precio: ${price} | Cambio: {change}% | EMA20: ${ema20} | EMA50: ${ema50} | RSI: {rsi} | Vol%: {vol_ratio}
Max20d: ${round(recent_high,2)} | Min20d: ${round(recent_low,2)} | Ultimos5: {last_5}

Responde UNICAMENTE con este JSON (sin texto antes ni despues, sin markdown):
{{"signal":"buy","strategy":"pullback","entryLow":{el_default},"entryHigh":{eh_default},"stopLoss":{sl_default},"breakeven":{be_default},"target1":{t1_default},"target2":{t2_default},"target3":{t3_default},"trend":"bullish","successRate":60,"keyLevel":{ema20},"analysis":"texto aqui"}}

Reglas:
- entryLow: limite inferior del rango de compra (soporte cercano, precio actual -0.5% a -1.5%)
- entryHigh: limite superior del rango de compra (resistencia menor, precio actual +0.5% a +1.5%)
- stopLoss: max 5% bajo entryLow, en soporte tecnico real
- breakeven: nivel donde mover SL a entryLow (~R:R 1:1)
- target1: vender 1/3, resistencia cercana (~R:R 1.5-2x)
- target2: vender 1/3, mover SL a EMA20 (~R:R 2.5-3x)
- target3: vender ultimo 1/3, resistencia mayor (~R:R 3.5-5x)
signal=buy/sell/hold, strategy=pullback/breakout/reversal/neutral, trend=bullish/bearish/sideways."""

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
    breakeven  = float(ai.get("breakeven", be_default))
    target1    = float(ai.get("target1",   t1_default))
    target2    = float(ai.get("target2",   t2_default))
    target3    = float(ai.get("target3",   t3_default))

    entry_mid = round((entry_low + entry_high) / 2, 2)
    rr = round(abs((target2 - entry_mid) / (entry_mid - stop)), 2) if abs(entry_mid - stop) > 0.001 else 0

    return {
        "ticker":       ticker,
        "price":        price,
        "change":       change,
        "ema20":        ema20,
        "ema50":        ema50,
        "rsi":          rsi,
        "volRatio":     vol_ratio,
        "prices20d":    prices_20d,
        "signal":       ai.get("signal",      "hold"),
        "strategy":     ai.get("strategy",    "neutral"),
        "entryLow":     round(entry_low,  2),
        "entryHigh":    round(entry_high, 2),
        "stopLoss":     round(stop,       2),
        "breakeven":    round(breakeven,  2),
        "target1":      round(target1,    2),
        "target2":      round(target2,    2),
        "target3":      round(target3,    2),
        "rr":           rr,
        "trend":        ai.get("trend",       "sideways"),
        "successRate":  int(ai.get("successRate", 50)),
        "keyLevel":     round(float(ai.get("keyLevel", ema20)), 2),
        "analysis":     str(ai.get("analysis", "")),
        "mansfieldRS":  mansfield_rs,
        # Fundamentales
        "fundamentals": fundamentals,
    }


@app.get("/health")
def health():
    return {"status": "ok"}
