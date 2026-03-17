"""
Screener diario — corre via GitHub Actions a las 9:30am ET.
Obtiene candidatas de Finviz con filtros de swing trading set-and-forget.
Guarda resultado en data/screener.json.
"""
import asyncio
import httpx
import json
import re
import os
from datetime import datetime, timezone

# Filtros Finviz para swing trading set-and-forget:
# exch_nasd|nyse     = NYSE y NASDAQ
# sh_avgvol_o500     = volumen promedio > 500k
# sh_price_o20       = precio > $20
# ta_rsi_30to60      = RSI entre 30 y 60 (zona pullback)
# ta_ema20_cross50a  = EMA20 cruzó sobre EMA50 recientemente
# sh_instown_o30     = > 30% institucional (calidad)
# fa_eps_pos         = EPS positivo

FINVIZ_URL = (
    "https://finviz.com/screener.ashx?v=111&f="
    "exch_nasd|nyse,"
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
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Referer": "https://finviz.com/",
    "Cache-Control": "no-cache",
}

async def fetch_finviz():
    """Scraping HTML de Finviz para obtener tickers filtrados."""
    tickers = []
    
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as c:
        # Paginar — Finviz muestra 20 por página, queremos hasta 100
        for page_start in [1, 21, 41, 61, 81]:
            url = FINVIZ_URL + f"&r={page_start}"
            try:
                r = await c.get(url, headers=HEADERS)
                print(f"Page {page_start}: status={r.status_code} len={len(r.text)}")
                
                if r.status_code != 200:
                    print(f"  Non-200 response, stopping pagination")
                    break
                
                # Extraer tickers del HTML
                found = re.findall(r'quote\.ashx\?t=([A-Z]{1,5})"', r.text)
                found = list(dict.fromkeys(found))  # dedup manteniendo orden
                
                if not found:
                    print(f"  No tickers found, stopping pagination")
                    break
                    
                new_tickers = [t for t in found if t not in tickers]
                tickers.extend(new_tickers)
                print(f"  Found {len(found)} tickers, {len(new_tickers)} new. Total: {len(tickers)}")
                
                # Si encontramos menos de 20, es la última página
                if len(found) < 15:
                    break
                    
                await asyncio.sleep(2)  # respetar rate limit
                
            except Exception as e:
                print(f"  Error on page {page_start}: {e}")
                break
    
    return tickers


def load_existing():
    """Cargar screener.json existente como fallback."""
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
    
    tickers = await fetch_finviz()
    
    if tickers:
        result = {
            "tickers": tickers[:80],  # máximo 80 candidatas
            "count": len(tickers[:80]),
            "date": date_str,
            "updatedAt": now_str,
            "source": "finviz",
            "criteria": {
                "exchange": "NYSE, NASDAQ",
                "avgVolume": "> 500k",
                "price": "> $20",
                "rsi": "30-60 (pullback zone)",
                "ema": "EMA20 recently crossed above EMA50"
            }
        }
        print(f"\nSuccess: {len(tickers[:80])} tickers found")
    else:
        # Fallback: usar resultado anterior si existe
        existing = load_existing()
        if existing:
            existing["source"] = "cached"
            existing["fetchError"] = "Finviz scraping failed — using previous results"
            result = existing
            print(f"\nFallback: using existing data from {existing.get('date', 'unknown')}")
        else:
            # Último recurso: lista curada
            result = {
                "tickers": [
                    "AAPL","MSFT","NVDA","GOOGL","META","AMZN","TSLA","JPM","V","MA",
                    "UNH","JNJ","PG","HD","AVGO","CRM","AMD","ORCL","NFLX","DIS",
                    "PYPL","SHOP","SNOW","PLTR","COIN","UBER","ABNB","DDOG","NET","CRWD",
                    "PANW","SMCI","ARM","MU","INTC","QCOM","XOM","CVX","BAC","GS"
                ],
                "count": 40,
                "date": date_str,
                "updatedAt": now_str,
                "source": "curated",
                "fetchError": "Finviz scraping failed — using curated fallback"
            }
            print("\nFallback: using curated list")
    
    with open("data/screener.json", "w") as f:
        json.dump(result, f, indent=2)
    
    print(f"Saved to data/screener.json")
    print(f"Source: {result['source']}")
    print(f"Tickers: {result['tickers'][:10]}...")


if __name__ == "__main__":
    asyncio.run(main())
