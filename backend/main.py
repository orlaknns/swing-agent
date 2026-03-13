from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import httpx
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


async def fetch_prices(ticker: str) -> dict:
    url = (
        f"https://www.alphavantage.co/query"
        f"?function=TIME_SERIES_DAILY&symbol={ticker}"
        f"&outputsize=compact&apikey={AV_KEY}"
    )
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(url)
        r.raise_for_status()
        data = r.json()

    if "Note" in data:
        raise HTTPException(status_code=429, detail="Límite de API alcanzado, intenta en 1 minuto")
    if "Error Message" in data:
        raise HTTPException(status_code=404, detail=f"Ticker '{ticker}' no encontrado")
    if "Time Series (Daily)" not in data:
        raise HTTPException(status_code=404, detail=f"No se encontraron datos para {ticker}")

    ts = data["Time Series (Daily)"]
    dates = sorted(ts.keys())[-90:]
    candles = [
        {
            "date": d,
            "open":   float(ts[d]["1. open"]),
            "high":   float(ts[d]["2. high"]),
            "low":    float(ts[d]["3. low"]),
            "close":  float(ts[d]["4. close"]),
            "volume": float(ts[d]["5. volume"]),
        }
        for d in dates
    ]
    return candles


@app.get("/analyze/{ticker}")
async def analyze(ticker: str):
    ticker = ticker.upper().strip()

    candles = await fetch_prices(ticker)
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

    avg_vol   = sum(volumes[-20:]) / min(20, len(volumes))
    vol_ratio = round(volumes[-1] / avg_vol * 100) if avg_vol else 100

    recent_high = max(highs[-20:])
    recent_low  = min(lows[-20:])
    prices_20d  = [round(c, 2) for c in closes[-20:]]
    last_5      = [round(c, 2) for c in closes[-5:]]

    prompt = f"""Eres un experto en swing trading de acciones USA. Analiza {ticker} con estos datos técnicos reales:

- Precio actual: ${price}
- Cambio diario: {change}%
- EMA20: ${ema20}
- EMA50: ${ema50}
- RSI(14): {rsi}
- Volumen vs promedio 20d: {vol_ratio}%
- Máximo 20d: ${round(recent_high, 2)}
- Mínimo 20d: ${round(recent_low, 2)}
- Últimos 5 cierres: {last_5}

Responde SOLO con JSON válido sin markdown:
{{"signal":"buy|sell|hold","strategy":"pullback|breakout|reversal|neutral","entry":número,"stopLoss":número,"target":número,"trend":"bullish|bearish|sideways","successRate":número entre 40-75,"keyLevel":número,"analysis":"2-3 oraciones en español explicando la señal y qué hacer"}}

Reglas: entry=precio óptimo hoy, stopLoss=máx 5% de pérdida desde entry, target=mínimo ratio R:R 1:2."""

    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=600,
        messages=[{"role": "user", "content": prompt}]
    )

    raw = message.content[0].text.strip()
    raw = re.sub(r"```[a-z]*|```", "", raw).strip()
    ai  = json.loads(raw)

    entry  = ai.get("entry",    price)
    stop   = ai.get("stopLoss", price * 0.97)
    target = ai.get("target",   price * 1.06)
    rr     = round(abs((target - entry) / (entry - stop)), 2) if entry != stop else 0

    return {
        "ticker":      ticker,
        "price":       price,
        "change":      change,
        "ema20":       ema20,
        "ema50":       ema50,
        "rsi":         rsi,
        "volRatio":    vol_ratio,
        "prices20d":   prices_20d,
        "signal":      ai.get("signal",      "hold"),
        "strategy":    ai.get("strategy",    "neutral"),
        "entry":       round(entry,  2),
        "stopLoss":    round(stop,   2),
        "target":      round(target, 2),
        "rr":          rr,
        "trend":       ai.get("trend",       "sideways"),
        "successRate": ai.get("successRate", 50),
        "keyLevel":    ai.get("keyLevel",    round(ema20, 2)),
        "analysis":    ai.get("analysis",    ""),
    }


@app.get("/health")
def health():
    return {"status": "ok"}
