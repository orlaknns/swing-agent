"""
Screener diario — corre via GitHub Actions a las 9:30am ET.
1. Obtiene candidatas de Finviz con filtros de swing trading
2. Enriquece con nombre y sector desde Alpha Vantage OVERVIEW
3. Guarda resultado en data/screener.json
"""
import asyncio
import httpx
import json
import re
import os
from datetime import datetime, timezone

FINVIZ_URL = (
    "https://finviz.com/screener.ashx?v=111&f="
    "exch_nasd|nyse,"
    "ind_stocksonly,"
    "sh_avgvol_o500,"
    "sh_price_o20,"
    "ta_rsi_30to60,"
    "ta_ema20_cross50a"
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

# ETFs a excluir
ETFS = {
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
    # Other funds
    'SCHH','KRE','VIX','FELG','FMDE','ZSL','SILJ','PAAS',
}

AV_KEY = os.environ.get("ALPHA_VANTAGE_KEY", "")


async def fetch_finviz() -> list[str]:
    """Obtiene tickers filtrados de Finviz."""
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

    # Filtrar ETFs
    filtered = [t for t in tickers if t not in ETFS]
    print(f"\nTickers tras filtrar ETFs: {len(filtered)} (se eliminaron {len(tickers)-len(filtered)} ETFs)")
    return filtered[:80]


async def enrich_ticker(ticker: str, client: httpx.AsyncClient) -> dict:
    """Obtiene nombre y sector desde Alpha Vantage OVERVIEW."""
    if not AV_KEY:
        return {"ticker": ticker, "company": "", "sector": ""}
    try:
        url = f"https://www.alphavantage.co/query?function=OVERVIEW&symbol={ticker}&apikey={AV_KEY}"
        r = await client.get(url, timeout=10)
        if r.status_code == 200:
            data = r.json()
            name   = data.get("Name", "")
            sector = data.get("Sector", "")
            exch   = data.get("Exchange", "")
            # Si no tiene Name, probablemente es ETF o no encontrado
            if not name:
                return None
            return {"ticker": ticker, "company": name, "sector": sector, "exchange": exch}
    except Exception as e:
        print(f"  AV error for {ticker}: {e}")
    return {"ticker": ticker, "company": "", "sector": ""}


async def enrich_all(tickers: list[str]) -> list[dict]:
    """Enriquece todos los tickers con nombre y sector."""
    if not AV_KEY:
        print("No AV_KEY — skipping enrichment")
        return [{"ticker": t, "company": "", "sector": ""} for t in tickers]

    results = []
    print(f"\nEnriqueciendo {len(tickers)} tickers con Alpha Vantage...")
    async with httpx.AsyncClient(timeout=15) as client:
        for i, ticker in enumerate(tickers):
            result = await enrich_ticker(ticker, client)
            if result is None:
                print(f"  [{i+1}/{len(tickers)}] {ticker} — sin datos (posible ETF/fondo)")
                continue
            results.append(result)
            name = result.get("company", "")[:30]
            sector = result.get("sector", "")
            print(f"  [{i+1}/{len(tickers)}] {ticker} — {name} | {sector}")
            # Pausa para respetar rate limit (75 calls/min = 0.8s entre llamadas)
            await asyncio.sleep(0.9)

    print(f"Enriquecimiento completo: {len(results)} acciones con datos")
    return results


def load_existing() -> dict | None:
    path = "data/screener.json"
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return None


async def main():
    os.makedirs("data", exist_ok=True)
    now_utc = datetime.now(timezone.utc)
    now_str = now_utc.strftime("%Y-%m-%d %H:%M UTC")
    date_str = now_utc.strftime("%Y-%m-%d")
    print(f"Starting screener at {now_str}")
    print(f"AV_KEY present: {'yes' if AV_KEY else 'NO — enrichment disabled'}")

    tickers = await fetch_finviz()

    if tickers:
        # Filtrar ETFs antes de enriquecer
        clean = [t for t in tickers if t not in ETFS]
        print(f"\nTras filtrar ETFs: {len(clean)} acciones (eliminados {len(tickers)-len(clean)} ETFs)")
        candidates = await enrich_all(clean)
        result = {
            "candidates": candidates,
            "tickers": [c["ticker"] for c in candidates],  # compatibilidad legacy
            "count": len(candidates),
            "date": date_str,
            "updatedAt": now_str,
            "source": "finviz",
            "criteria": {
                "exchange": "NYSE, NASDAQ",
                "avgVolume": "> 500k",
                "price": "> $20",
                "rsi": "30-60 (pullback zone)",
                "ema": "EMA20 recently crossed above EMA50 (Finviz filter — app uses SMA21/SMA50 for analysis)"
            }
        }
        print(f"Success: {len(candidates)} candidatas con nombre y sector")
    else:
        existing = load_existing()
        if existing and existing.get("source") == "finviz":
            existing["source"] = "cached"
            existing["fetchError"] = "Finviz no disponible — usando resultados anteriores"
            result = existing
            print(f"Fallback: datos previos de {existing.get('date')}")
        else:
            result = {
                "candidates": [
                    {"ticker":"AAPL","company":"Apple Inc","sector":"Technology"},
                    {"ticker":"MSFT","company":"Microsoft Corp","sector":"Technology"},
                    {"ticker":"NVDA","company":"NVIDIA Corp","sector":"Technology"},
                    {"ticker":"GOOGL","company":"Alphabet Inc","sector":"Technology"},
                    {"ticker":"META","company":"Meta Platforms","sector":"Technology"},
                    {"ticker":"AMZN","company":"Amazon.com","sector":"Consumer Cyclical"},
                    {"ticker":"TSLA","company":"Tesla Inc","sector":"Consumer Cyclical"},
                    {"ticker":"JPM","company":"JPMorgan Chase","sector":"Financial"},
                    {"ticker":"V","company":"Visa Inc","sector":"Financial"},
                    {"ticker":"MA","company":"Mastercard","sector":"Financial"},
                    {"ticker":"UNH","company":"UnitedHealth Group","sector":"Healthcare"},
                    {"ticker":"JNJ","company":"Johnson & Johnson","sector":"Healthcare"},
                    {"ticker":"PG","company":"Procter & Gamble","sector":"Consumer Defensive"},
                    {"ticker":"HD","company":"Home Depot","sector":"Consumer Cyclical"},
                    {"ticker":"AVGO","company":"Broadcom Inc","sector":"Technology"},
                    {"ticker":"CRM","company":"Salesforce","sector":"Technology"},
                    {"ticker":"AMD","company":"Advanced Micro Devices","sector":"Technology"},
                    {"ticker":"NFLX","company":"Netflix Inc","sector":"Communication"},
                    {"ticker":"PLTR","company":"Palantir Technologies","sector":"Technology"},
                    {"ticker":"CRWD","company":"CrowdStrike","sector":"Technology"},
                ],
                "count": 20,
                "date": date_str,
                "updatedAt": now_str,
                "source": "curated",
                "fetchError": "Finviz no disponible — usando lista curada"
            }
            print("Fallback: lista curada")

    with open("data/screener.json", "w") as f:
        json.dump(result, f, indent=2)
    print(f"Guardado — source: {result['source']}, count: {result['count']}")


if __name__ == "__main__":
    asyncio.run(main())
