from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import yfinance as yf
import requests
import json
import re
from anthropic import Anthropic

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

client = Anthropic()


def get_session():
    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    })
    return session


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


def calc_avg_volume(volumes: list, period: int = 20) -> float:
    recent = [v for v in volumes[-period:] if v]
    return sum(recent) / len(recent) if recent else 0


@app.get("/analyze/{ticker}")
async def analyze(ticker: str):
    ticker = ticker.upper().strip()

    hist = None
    try:
        session = get_session()
        stock = yf.Ticker(ticker, session=session)
        hist = stock.history(period="90d", interval="1d", auto_adjust=True)
    except Exception:
        pass

    if hist is None or hist.empty:
        try:
            stock = yf.Ticker(ticker)
            hist = stock.history(period="60d", interval="1d")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Error obteniendo datos: {str(e)}")

    if hist is None or hist.empty or len(hist) < 5:
        raise HTTPException(status_code=404, detail=f"No se encontraron datos para {ticker}. Verifica que el ticker sea válido.")

    closes = hist["Close"].tolist()
    volumes = hist["Volume"].tolist()
    highs = hist["High"].tolist()
    lows = hist["Low"].tolist()
    dates = [str(d.date()) for d in hist.index]

    price = round(closes[-1], 2)
    prev_close = closes[-2] if len(closes) >= 2 else closes[-1]
    change = round(((price - prev_close) / prev_close) * 100, 2)

    ema20 = calc_ema(closes, 20)
    ema50 = calc_ema(closes, 50)
    rsi = calc_rsi(closes)
    avg_vol = calc_avg_volume(volumes)
    last_vol = volumes[-1] or 0
    vol_ratio = round(last_vol / avg_vol * 100) if avg_vol else 100

    recent_high = max(highs[-20:]) if len(highs) >= 20 else max(highs)
    recent_low = min(lows[-20:]) if len(lows) >= 20 else min(lows)
    prices_20d = [round(c, 2) for c in closes[-20:]]
    last_5_closes = [round(c, 2) for c in closes[-5:]]

    prompt = f"""Eres un experto en swing trading de acciones USA. Analiza {ticker} con estos datos técnicos reales:

- Precio actual: ${price}
- Cambio diario: {change}%
- EMA20: ${ema20}
- EMA50: ${ema50}
- RSI(14): {rsi}
- Volumen vs promedio 20d: {vol_ratio}%
- Máximo 20d: ${round(recent_high, 2)}
- Mínimo 20d: ${round(recent_low, 2)}
- Últimos 5 cierres: {last_5_closes}

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
    ai = json.loads(raw)

    entry = ai.get("entry", price)
    stop = ai.get("stopLoss", price * 0.97)
    target = ai.get("target", price * 1.06)
    rr = round(abs((target - entry) / (entry - stop)), 2) if entry != stop else 0

    return {
        "ticker": ticker,
        "price": price,
        "change": change,
        "ema20": ema20,
        "ema50": ema50,
        "rsi": rsi,
        "volRatio": vol_ratio,
        "prices20d": prices_20d,
        "signal": ai.get("signal", "hold"),
        "strategy": ai.get("strategy", "neutral"),
        "entry": round(entry, 2),
        "stopLoss": round(stop, 2),
        "target": round(target, 2),
        "rr": rr,
        "trend": ai.get("trend", "sideways"),
        "successRate": ai.get("successRate", 50),
        "keyLevel": ai.get("keyLevel", round(ema20, 2)),
        "analysis": ai.get("analysis", ""),
    }


@app.get("/search/{query}")
async def search(query: str):
    q = query.upper().strip()
    results = []
    try:
        t = yf.Ticker(q)
        info = t.info
        if info.get("symbol"):
            results.append({
                "ticker": info["symbol"],
                "name": info.get("longName", info["symbol"]),
                "exchange": info.get("exchange", ""),
            })
    except Exception:
        pass
    return {"results": results}


@app.get("/health")
def health():
    return {"status": "ok"}
