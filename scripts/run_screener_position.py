"""
Screener semanal para Position Trading — corre via GitHub Actions los lunes.
Criterios:
  - Precio > SMA200 (estructura alcista de largo plazo)
  - SMA50 > SMA200 (tendencia de mediano plazo confirmada — golden cross)
  - RSI 40–65 (momentum presente, sin sobrecompra)
  - Volumen promedio > 500k
  - Precio > $10
  - Market cap > $300M
  - NYSE y NASDAQ únicamente
"""
import asyncio
import httpx
import json
import re
import os
from datetime import datetime, timezone

# Finviz: precio>SMA200, SMA50>SMA200, RSI 40-65, avgvol>500k, precio>10, cap>$300M
FINVIZ_URL = (
    "https://finviz.com/screener.ashx?v=111&f="
    "exch_nasd|nyse,"
    "ind_stocksonly,"
    "cap_smallover,"          # market cap > $300M
    "sh_avgvol_o500,"         # avg volume > 500k
    "sh_price_o10,"           # precio > $10
    "ta_rsi_40to65,"          # RSI 40-65
    "ta_sma50_pa200,"         # SMA50 > SMA200
    "ta_sma200_pa"            # precio > SMA200
    "&o=-volume"
)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Connection": "keep-alive",
    "Referer": "https://finviz.com/",
    "Upgrade-Insecure-Requests": "1",
}

ETFS = {
    'SPY','QQQ','IWM','DIA','IVV','IJH','VTI','VOO','SCHX','SCHG','SCHD',
    'XLF','XLK','XLE','XLV','XLI','XLU','XLP','XLB','XLY','XLC','XLRE','XLC',
    'EEM','EFA','VEA','EWZ','EWY','FXI','KWEB','IEMG','EWJ',
    'TLT','LQD','HYG','BIL','BKLN','VCIT','SPIB','SGOV','EMB','SPSB','SPAB',
    'GLD','SLV','IAU','IAUM','GDX','GDXJ','USO','UNG','PDBC','GLDM','SGOL','AGQ',
    'IEF','TIP','SHY','IEI','AGG','BND','JNK',
    'SOXL','SOXS','TQQQ','SQQQ','SPYM','QID','TNA','TZA','UVXY','PSQ',
    'IBIT','BITX','FBTC','GBTC',
    'SCHF','SCHB','RSP','VIG','VYM','DVY','NOBL','VWO','EWC','EWA',
    'SMH','SOXX','XSD','ARKK','ARKG','ARKW','ARKF',
    'SCHH','KRE','VIX','FELG','FMDE','ZSL','SILJ','PAAS',
}

AV_KEY = os.environ.get("ALPHA_VANTAGE_KEY", "")


async def fetch_finviz_position() -> list[str]:
    """Obtiene tickers filtrados de Finviz con criterios de position trading."""
    tickers = []
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as c:
        for page_start in [1, 21, 41, 61, 81]:
            url = FINVIZ_URL + f"&r={page_start}"
            try:
                r = await c.get(url, headers=HEADERS)
                html = r.content.decode('utf-8', errors='ignore')
                print(f"Page {page_start}: status={r.status_code} len={len(html)}")

                if r.status_code != 200:
                    break

                found = re.findall(r'quote\.ashx\?t=([A-Z]{1,5})&', html)
                seen = set()
                deduped = []
                for t in found:
                    if t not in seen:
                        seen.add(t)
                        deduped.append(t)
                found = deduped

                print(f"  Tickers: {found[:10]}")
                if not found:
                    break

                new_tickers = [t for t in found if t not in tickers]
                tickers.extend(new_tickers)
                print(f"  {len(new_tickers)} nuevos. Total: {len(tickers)}")

                if len(found) < 15:
                    break

                await asyncio.sleep(2)

            except Exception as e:
                print(f"  Error: {e}")
                break

    filtered = [t for t in tickers if t not in ETFS]
    print(f"\nTickers tras filtrar ETFs: {len(filtered)} (eliminados {len(tickers)-len(filtered)} ETFs)")
    return filtered[:80]


def _analyze_base_simple(weekly_candles: list) -> dict:
    """Detecta semanas en base de consolidación (versión standalone para el screener)."""
    if len(weekly_candles) < 3:
        return {"weeks_in_base": 0, "base_quality": "none"}
    closes = [c["close"] for c in weekly_candles]
    highs  = [c["high"]  for c in weekly_candles]
    lows   = [c["low"]   for c in weekly_candles]
    base_start = len(closes) - 1
    base_high  = highs[-1]
    base_low   = lows[-1]
    for i in range(len(closes) - 2, max(0, len(closes) - 53), -1):
        new_high = max(base_high, highs[i])
        new_low  = min(base_low, lows[i])
        rng = (new_high - new_low) / new_low * 100 if new_low > 0 else 999
        if rng > 35:
            break
        if closes[i] < base_low * 0.85:
            break
        base_high  = new_high
        base_low   = new_low
        base_start = i
    weeks_in_base = len(closes) - base_start
    quality = "sound" if weeks_in_base >= 7 else "short" if weeks_in_base >= 3 else "none"
    return {"weeks_in_base": weeks_in_base, "base_quality": quality}


async def fetch_weekly_candles(ticker: str, client: httpx.AsyncClient) -> list:
    """Obtiene velas semanales ajustadas desde Alpha Vantage (últimas 52)."""
    if not AV_KEY:
        return []
    try:
        url = (
            f"https://www.alphavantage.co/query?function=TIME_SERIES_WEEKLY_ADJUSTED"
            f"&symbol={ticker}&apikey={AV_KEY}"
        )
        r = await client.get(url, timeout=15)
        if r.status_code != 200:
            return []
        data = r.json()
        weekly = data.get("Weekly Adjusted Time Series", {})
        if not weekly:
            return []
        candles = []
        for date_str in sorted(weekly.keys(), reverse=True)[:52]:
            w = weekly[date_str]
            try:
                candles.append({
                    "date":  date_str,
                    "close": float(w["5. adjusted close"]),
                    "high":  float(w["2. high"]),
                    "low":   float(w["3. low"]),
                    "volume": float(w.get("6. volume", 0)),
                })
            except Exception:
                pass
        candles.reverse()  # cronológico
        return candles
    except Exception as e:
        print(f"  AV weekly error for {ticker}: {e}")
        return []


async def enrich_ticker(ticker: str, client: httpx.AsyncClient) -> dict:
    """Obtiene nombre, sector, fundamentals y base analysis desde Alpha Vantage."""
    if not AV_KEY:
        return {"ticker": ticker, "company": "", "sector": ""}
    try:
        url = f"https://www.alphavantage.co/query?function=OVERVIEW&symbol={ticker}&apikey={AV_KEY}"
        r = await client.get(url, timeout=10)
        if r.status_code == 200:
            data = r.json()
            name = data.get("Name", "")
            if not name:
                return None
            # Rev growth y EPS growth para mostrar en screener
            rev_raw = data.get("QuarterlyRevenueGrowthYOY")
            eps_raw = data.get("QuarterlyEarningsGrowthYOY")
            try:
                rev_growth = round(float(rev_raw) * 100, 1) if rev_raw and rev_raw != "None" else None
            except Exception:
                rev_growth = None
            try:
                eps_growth = round(float(eps_raw) * 100, 1) if eps_raw and eps_raw != "None" else None
            except Exception:
                eps_growth = None
            try:
                mkt_cap = float(data.get("MarketCapitalization", 0))
                if mkt_cap >= 1e12:   mkt_str = f"${mkt_cap/1e12:.1f}T"
                elif mkt_cap >= 1e9:  mkt_str = f"${mkt_cap/1e9:.1f}B"
                elif mkt_cap >= 1e6:  mkt_str = f"${mkt_cap/1e6:.1f}M"
                else: mkt_str = ""
            except Exception:
                mkt_str = ""
            return {
                "ticker":     ticker,
                "company":    name,
                "sector":     data.get("Sector", ""),
                "industry":   data.get("Industry", ""),
                "exchange":   data.get("Exchange", ""),
                "mktCap":     mkt_str,
                "revGrowth":  rev_growth,
                "epsGrowth":  eps_growth,
            }
    except Exception as e:
        print(f"  AV error for {ticker}: {e}")
    return {"ticker": ticker, "company": "", "sector": ""}


async def enrich_all(tickers: list[str]) -> list[dict]:
    results = []
    print(f"\nEnriqueciendo {len(tickers)} tickers con Alpha Vantage...")
    async with httpx.AsyncClient(timeout=15) as client:
        for i, ticker in enumerate(tickers):
            result = await enrich_ticker(ticker, client)
            if result is None:
                print(f"  [{i+1}/{len(tickers)}] {ticker} — sin datos (posible ETF/fondo)")
                continue

            # Obtener velas semanales y calcular base analysis
            await asyncio.sleep(0.9)  # respetar rate limit antes de segunda llamada
            weekly = await fetch_weekly_candles(ticker, client)
            if weekly:
                base = _analyze_base_simple(weekly)
                result["weeksInBase"]  = base["weeks_in_base"]
                result["baseQuality"]  = base["base_quality"]
            else:
                result["weeksInBase"]  = None
                result["baseQuality"]  = None

            results.append(result)
            name = result.get("company", "")[:30]
            sector = result.get("sector", "")
            base_txt = f" | base {result['weeksInBase']}sem ({result['baseQuality']})" if result.get("weeksInBase") else ""
            print(f"  [{i+1}/{len(tickers)}] {ticker} — {name} | {sector}{base_txt}")
            await asyncio.sleep(0.9)
    print(f"Enriquecimiento completo: {len(results)} acciones con datos")
    return results


def load_existing() -> dict | None:
    path = "data/screener_position.json"
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return None


CURATED_FALLBACK = [
    {"ticker":"AAPL",  "company":"Apple Inc",            "sector":"Technology",          "mktCap":"$3.0T"},
    {"ticker":"MSFT",  "company":"Microsoft Corp",        "sector":"Technology",          "mktCap":"$3.1T"},
    {"ticker":"NVDA",  "company":"NVIDIA Corp",           "sector":"Technology",          "mktCap":"$2.6T"},
    {"ticker":"GOOGL", "company":"Alphabet Inc",          "sector":"Technology",          "mktCap":"$2.0T"},
    {"ticker":"META",  "company":"Meta Platforms",        "sector":"Communication",       "mktCap":"$1.4T"},
    {"ticker":"AMZN",  "company":"Amazon.com",            "sector":"Consumer Cyclical",   "mktCap":"$2.0T"},
    {"ticker":"JPM",   "company":"JPMorgan Chase",        "sector":"Financial",           "mktCap":"$700B"},
    {"ticker":"V",     "company":"Visa Inc",              "sector":"Financial",           "mktCap":"$550B"},
    {"ticker":"UNH",   "company":"UnitedHealth Group",    "sector":"Healthcare",          "mktCap":"$500B"},
    {"ticker":"AVGO",  "company":"Broadcom Inc",          "sector":"Technology",          "mktCap":"$900B"},
    {"ticker":"LLY",   "company":"Eli Lilly",             "sector":"Healthcare",          "mktCap":"$700B"},
    {"ticker":"MA",    "company":"Mastercard",            "sector":"Financial",           "mktCap":"$450B"},
    {"ticker":"XOM",   "company":"Exxon Mobil",           "sector":"Energy",              "mktCap":"$450B"},
    {"ticker":"COST",  "company":"Costco Wholesale",      "sector":"Consumer Defensive",  "mktCap":"$400B"},
    {"ticker":"HD",    "company":"Home Depot",            "sector":"Consumer Cyclical",   "mktCap":"$350B"},
    {"ticker":"ORCL",  "company":"Oracle Corp",           "sector":"Technology",          "mktCap":"$400B"},
    {"ticker":"NOW",   "company":"ServiceNow",            "sector":"Technology",          "mktCap":"$200B"},
    {"ticker":"ISRG",  "company":"Intuitive Surgical",    "sector":"Healthcare",          "mktCap":"$200B"},
    {"ticker":"GE",    "company":"GE Aerospace",          "sector":"Industrials",         "mktCap":"$200B"},
    {"ticker":"DECK",  "company":"Deckers Outdoor",       "sector":"Consumer Cyclical",   "mktCap":"$20B"},
]


async def main():
    os.makedirs("data", exist_ok=True)
    now_utc = datetime.now(timezone.utc)
    now_str = now_utc.strftime("%Y-%m-%d %H:%M UTC")
    date_str = now_utc.strftime("%Y-%m-%d")
    print(f"Starting position screener at {now_str}")
    print(f"AV_KEY present: {'yes' if AV_KEY else 'NO — enrichment disabled'}")

    tickers = await fetch_finviz_position()

    if tickers:
        clean = [t for t in tickers if t not in ETFS]
        candidates = await enrich_all(clean)
        result = {
            "candidates": candidates,
            "tickers": [c["ticker"] for c in candidates],
            "count": len(candidates),
            "date": date_str,
            "updatedAt": now_str,
            "source": "finviz",
            "criteria": {
                "exchange":    "NYSE, NASDAQ",
                "marketCap":   "> $300M",
                "avgVolume":   "> 500k",
                "price":       "> $10",
                "rsi":         "40-65 (momentum sin sobrecompra)",
                "sma50_200":   "SMA50 > SMA200 (golden cross)",
                "price_sma200":"Precio > SMA200 (tendencia alcista)",
            }
        }
        print(f"Success: {len(candidates)} candidatas")
    else:
        existing = load_existing()
        if existing and existing.get("source") == "finviz":
            existing["source"] = "cached"
            existing["fetchError"] = "Finviz no disponible — usando resultados anteriores"
            result = existing
            print(f"Fallback: datos previos de {existing.get('date')}")
        else:
            result = {
                "candidates": CURATED_FALLBACK,
                "tickers": [c["ticker"] for c in CURATED_FALLBACK],
                "count": len(CURATED_FALLBACK),
                "date": date_str,
                "updatedAt": now_str,
                "source": "curated",
                "fetchError": "Finviz no disponible — usando lista curada de position trading",
                "criteria": {
                    "note": "Lista curada de acciones líderes de largo plazo"
                }
            }
            print("Fallback: lista curada position")

    with open("data/screener_position.json", "w") as f:
        json.dump(result, f, indent=2)
    print(f"Guardado — source: {result['source']}, count: {result['count']}")


if __name__ == "__main__":
    asyncio.run(main())
