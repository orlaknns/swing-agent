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
    "Connection": "keep-alive",
    "Referer": "https://finviz.com/",
    "Upgrade-Insecure-Requests": "1",
}

async def fetch_finviz():
    tickers = []
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as c:
        for page_start in [1, 21, 41, 61, 81]:
            url = FINVIZ_URL + f"&r={page_start}"
            try:
                r = await c.get(url, headers=HEADERS)
                # Decodificar explicitamente para evitar problemas con compresion
                html = r.content.decode('utf-8', errors='ignore')
                print(f"Page {page_start}: status={r.status_code} len={len(html)}")

                if r.status_code != 200:
                    print(f"  Non-200, stopping")
                    break

                # Debug: primeros 300 chars
                preview = html[:300].replace('\n', ' ').replace('\r', '')
                print(f"  Preview: {preview}")

                # Multiples patrones para encontrar tickers
                found = re.findall(r'quote\.ashx\?t=([A-Z]{1,5})"', html)
                if not found:
                    found = re.findall(r'"ticker"\s*:\s*"([A-Z]{1,5})"', html)
                if not found:
                    found = re.findall(r'data-ticker="([A-Z]{1,5})"', html)
                if not found:
                    found = re.findall(r'class="screener-link-primary"[^>]*>([A-Z]{1,5})<', html)
                if not found:
                    found = re.findall(r'href="/quote\.ashx\?t=([A-Z]{1,5})', html)

                found = list(dict.fromkeys(found))
                print(f"  Tickers: {found[:10]}")

                if not found:
                    print(f"  Sin tickers, deteniendo")
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

    return tickers


def load_existing():
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
            "tickers": tickers[:80],
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
        print(f"Success: {len(tickers[:80])} tickers")
    else:
        existing = load_existing()
        if existing and existing.get("source") == "finviz":
            existing["source"] = "cached"
            existing["fetchError"] = "Finviz no disponible — usando resultados anteriores"
            result = existing
            print(f"Fallback: datos previos de {existing.get('date')}")
        else:
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
                "fetchError": "Finviz no disponible — usando lista curada"
            }
            print("Fallback: lista curada")

    with open("data/screener.json", "w") as f:
        json.dump(result, f, indent=2)

    print(f"Guardado — source: {result['source']}")


if __name__ == "__main__":
    asyncio.run(main())
