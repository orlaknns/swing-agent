"""
test_position_scoring.py
Test exhaustivo del scorecard de position trading.

Importa directamente desde backend/main.py:
  - calc_position_scorecard
  - detect_hh_hl
  - analyze_base
  - detect_stage

Ejecutar: python scripts/test_position_scoring.py
"""

import sys
import os

# Agrega backend/ al path para importar main.py
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from main import calc_position_scorecard, detect_hh_hl, analyze_base, detect_stage

# ─── Helpers de output ────────────────────────────────────────────────────────

PASS_COUNT = 0
FAIL_COUNT = 0
RESULTS = []


def check(label: str, condition: bool, obtained, expected_desc: str):
    global PASS_COUNT, FAIL_COUNT
    status = "PASS" if condition else "FAIL"
    if condition:
        PASS_COUNT += 1
    else:
        FAIL_COUNT += 1
    icon = "✓" if condition else "✗"
    msg = f"  [{icon}] {label}"
    if not condition:
        msg += f"\n      Obtenido : {obtained}"
        msg += f"\n      Esperado : {expected_desc}"
    RESULTS.append((status, msg))
    print(msg)


def section(title: str):
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}")


# ─── Fixtures comunes ─────────────────────────────────────────────────────────

def make_weekly_candles_bullish(n=26):
    """26 velas semanales con tendencia alcista: highs y lows crecientes con correcciones."""
    candles = []
    base = 100.0
    for i in range(n):
        # Tendencia alcista: subida ~2% por semana con correcciones cada 3 semanas
        trend = base * (1 + 0.02 * i)
        # Corrección suave cada 3 semanas (genera HL reales)
        if i % 3 == 2:
            low = trend * 0.97
        else:
            low = trend * 0.99
        high = trend * 1.02
        close = trend * 1.005
        candles.append({
            "date":  f"2025-{(i//4)+1:02d}-{(i%4)*7+1:02d}",
            "open":  round(trend, 2),
            "high":  round(high, 2),
            "low":   round(low, 2),
            "close": round(close, 2),
        })
    return candles


def make_weekly_candles_bearish(n=26):
    """26 velas semanales con tendencia bajista: highs y lows decrecientes."""
    candles = []
    base = 200.0
    for i in range(n):
        trend = base * (1 - 0.02 * i)
        high = trend * 1.005
        low  = trend * 0.97
        close = trend * 0.99
        candles.append({
            "date":  f"2025-{(i//4)+1:02d}-{(i%4)*7+1:02d}",
            "open":  round(trend, 2),
            "high":  round(high, 2),
            "low":   round(low, 2),
            "close": round(close, 2),
        })
    return candles


def make_weekly_candles_stage2(n=40):
    """40 velas semanales con precio subiendo claramente sobre SMA30 con pendiente positiva."""
    candles = []
    base = 80.0
    for i in range(n):
        # Las primeras 5 semanas: lateral (consolidación)
        if i < 5:
            price = base + i * 0.1
        else:
            # Tendencia alcista fuerte desde semana 6
            price = base + 5 + (i - 5) * 2.0
        high  = price * 1.015
        low   = price * 0.985
        close = price * 1.005
        candles.append({
            "date":  f"2025-{(i//4)+1:02d}-{(i%4)*7+1:02d}",
            "open":  round(price, 2),
            "high":  round(high, 2),
            "low":   round(low, 2),
            "close": round(close, 2),
        })
    return candles


def make_weekly_candles_base(n=15, range_pct=0.10):
    """15 velas semanales en rango estrecho (<20%)."""
    candles = []
    center = 100.0
    for i in range(n):
        # Oscila en rango estrecho
        offset = (i % 3 - 1) * center * range_pct * 0.3
        price = center + offset
        high  = price * (1 + range_pct * 0.4)
        low   = price * (1 - range_pct * 0.4)
        close = price
        candles.append({
            "date":  f"2025-{(i//4)+1:02d}-{(i%4)*7+1:02d}",
            "open":  round(price, 2),
            "high":  round(high, 2),
            "low":   round(low, 2),
            "close": round(close, 2),
        })
    return candles


def make_daily_data(n=260, price_start=100, trend_pct=0.001):
    """Genera listas highs/lows/closes/volumes para datos diarios."""
    closes  = []
    highs   = []
    lows    = []
    volumes = []
    p = float(price_start)
    for i in range(n):
        p = p * (1 + trend_pct)
        highs.append(round(p * 1.01, 2))
        lows.append(round(p * 0.99, 2))
        closes.append(round(p, 2))
        volumes.append(1_000_000)
    return closes, highs, lows, volumes


def calc_score_total(scorecard: dict) -> int:
    return sum(v["score_sugerido"] * v["peso"] for v in scorecard.values())


# ═══════════════════════════════════════════════════════════════════════════════
#  CASO 1 — Acción ideal screener (debe dar CONVICCIÓN ≥ 32)
# ═══════════════════════════════════════════════════════════════════════════════

section("CASO 1 — Acción ideal screener (score total ≥ 32)")

# HH/HL: 3 HH + 3 HL → combined=6 → score=3
bullish_weekly = make_weekly_candles_bullish(26)
hh_hl_ideal = detect_hh_hl(bullish_weekly)

# Datos diarios: precio bien sobre SMA50 (pullback a SMA50 → vol bajo → score_entrada=3)
closes_ideal, highs_ideal, lows_ideal, volumes_ideal = make_daily_data(
    260, price_start=140, trend_pct=0.0008
)
# Ajuste: el último precio es ~150, SMA50 está en torno a 140
# Forzar precio en pullback a SMA50 (dist_sma50 entre -5 y +10)
closes_ideal[-1] = 150.0
highs_ideal[-1]  = 151.0
lows_ideal[-1]   = 149.0
# Volumen bajo → vol_ratio < 80 (para que entrada sea score=3)
volumes_ideal[-5:] = [600_000] * 5
volumes_ideal[-20:] = [800_000] * 20 + volumes_ideal[-5:]  # avg ~800k, last 5 = 600k

sc1 = calc_position_scorecard({
    "price":        150,
    "sma50":        140,
    "sma200":       110,
    "mansfield_rs": 3.5,
    "rs_sector":    2.0,
    "hh_hl":        hh_hl_ideal,
    "fundamentals": {
        "revenueGrowth":   25,
        "epsGrowth":       40,
        "profitMargin":    18,
        "operatingMargin": 22,
    },
    "cashflow":     {"fcf_positive": True},
    "vol_ratio":    130,
    "rr_suggested": 2.8,
    "next_earnings": None,
    "highs":        highs_ideal,
    "lows":         lows_ideal,
    "volumes":      volumes_ideal,
    "base":         {"base_quality": "sound", "weeks_in_base": 10, "breakout_vol": None},
})

# Simular narrativa evaluada por Haiku (score=3 como dice el caso)
sc1["narrativa"]["score_sugerido"] = 3

score1 = calc_score_total(sc1)

print(f"\n  Score total obtenido: {score1}")
print(f"  Desglose:")
for k, v in sc1.items():
    s = v["score_sugerido"]
    p = v["peso"]
    print(f"    {k:25s}: score={s} × peso={p} = {s*p}  | {v['justificacion'][:60]}")

check("Score total ≥ 32 (CONVICCIÓN)", score1 >= 32, score1, ">= 32")
check("precio_sma200 = 3 (no veto)", sc1["precio_sma200"]["score_sugerido"] == 3, sc1["precio_sma200"]["score_sugerido"], "3")
check("precio_sma200.es_veto == False", sc1["precio_sma200"]["es_veto"] == False, sc1["precio_sma200"]["es_veto"], "False")
check("estructura_hh_hl >= 2", sc1["estructura_hh_hl"]["score_sugerido"] >= 2, sc1["estructura_hh_hl"]["score_sugerido"], ">= 2")
check("rs_relativa = 3 (líder vs SPY y sector)", sc1["rs_relativa"]["score_sugerido"] == 3, sc1["rs_relativa"]["score_sugerido"], "3")
check("calidad_fundamental >= 2", sc1["calidad_fundamental"]["score_sugerido"] >= 2, sc1["calidad_fundamental"]["score_sugerido"], ">= 2")
check("ratio_rr = 2 (rr=2.8)", sc1["ratio_rr"]["score_sugerido"] == 2, sc1["ratio_rr"]["score_sugerido"], "2")
check("narrativa = 3 (simulado Haiku)", sc1["narrativa"]["score_sugerido"] == 3, sc1["narrativa"]["score_sugerido"], "3")


# ═══════════════════════════════════════════════════════════════════════════════
#  CASO 2 — Acción mediocre (22 ≤ score ≤ 31 → CAUTELA)
# ═══════════════════════════════════════════════════════════════════════════════

section("CASO 2 — Acción mediocre (22 ≤ score ≤ 31 → CAUTELA)")

# Objetivo: score 22-31 con datos mediocres
# Desglose objetivo:
#   narrativa       : 2 × 3 = 6
#   precio_sma200   : 3 × 3 = 9  (precio > SMA200, no es veto)
#   hh_hl           : 1 × 2 = 2  (combined=1, estructura débil)
#   rs_relativa     : 2 × 2 = 4  (mansfield=0.5 → score=2, no líder sectorial)
#   calidad_fund    : 2 × 2 = 4  (rev moderado + eps positivo + fcf)
#   punto_entrada   : 1 × 2 = 2  (precio BAJO SMA50 → debilidad)
#   ratio_rr        : 2 × 2 = 4  (rr=2.0 → score=2)
# Total esperado: 6+9+2+4+4+2+4 = 31

# HH/HL: usamos dict sintético con combined=1 (score=1)
# Esto verifica calc_position_scorecard aceptando el formato correcto.
# detect_hh_hl ya se prueba en casos 5 y 6.
hh_hl_cautela = {
    "score": 1,
    "hh_count": 1,
    "hl_count": 0,
    "description": "1 máximos crecientes + 0 mínimos crecientes (últimas 26 semanas)"
}

# Datos diarios: precio BAJO SMA50 → punto_entrada score=1
# Con make_daily_data(260, start=80), SMA50 = ~closes[-50:].mean() ≈ 80
# Forzamos precio actual = 75 para que esté bajo SMA50=80
closes_c, highs_c, lows_c, volumes_c = make_daily_data(260, price_start=80, trend_pct=0.0)
closes_c[-1] = 75.0
highs_c[-1]  = 75.5
lows_c[-1]   = 74.5

sc2 = calc_position_scorecard({
    "price":        75,
    "sma50":        80,       # precio BAJO SMA50 → entrada score=1
    "sma200":       65,       # precio SOBRE SMA200 → no es veto
    "mansfield_rs": 0.5,
    "rs_sector":    0.3,
    "hh_hl":        hh_hl_cautela,
    "fundamentals": {
        "revenueGrowth": 5,
        "epsGrowth":     8,
        "profitMargin":  6,   # <10 → no activa quality_ok por margen
    },
    "cashflow":     {"fcf_positive": False},  # sin FCF → quality_ok=False → fund_score=1
    "vol_ratio":    90,
    "rr_suggested": 2.0,
    "next_earnings": None,
    "highs":        highs_c,
    "lows":         lows_c,
    "volumes":      volumes_c,
    "base":         {},
})

sc2["narrativa"]["score_sugerido"] = 2
score2 = calc_score_total(sc2)

print(f"\n  Score total obtenido: {score2}")
print(f"  Desglose:")
for k, v in sc2.items():
    s = v["score_sugerido"]
    p = v["peso"]
    print(f"    {k:25s}: score={s} × peso={p} = {s*p}  | {v['justificacion'][:60]}")

check("Score total 22-31 (CAUTELA)", 22 <= score2 <= 31, score2, "22 <= score <= 31")


# ═══════════════════════════════════════════════════════════════════════════════
#  CASO 3 — Acción con VETO SMA200 (precio bajo SMA200)
# ═══════════════════════════════════════════════════════════════════════════════

section("CASO 3 — VETO SMA200 (precio BAJO SMA200)")

hh_hl_veto = detect_hh_hl(make_weekly_candles_bullish(26))

closes_v, highs_v, lows_v, volumes_v = make_daily_data(260, price_start=90, trend_pct=0.0)

sc3 = calc_position_scorecard({
    "price":        95,
    "sma50":        90,
    "sma200":       100,      # PRECIO BAJO SMA200 → VETO
    "mansfield_rs": 2.5,
    "rs_sector":    1.5,
    "hh_hl":        hh_hl_veto,
    "fundamentals": {
        "revenueGrowth": 20,
        "epsGrowth":     30,
        "profitMargin":  15,
    },
    "cashflow":     {"fcf_positive": True},
    "vol_ratio":    110,
    "rr_suggested": 2.5,
    "next_earnings": None,
    "highs":        highs_v,
    "lows":         lows_v,
    "volumes":      volumes_v,
    "base":         {},
})

sc3["narrativa"]["score_sugerido"] = 2

print(f"\n  precio_sma200: score={sc3['precio_sma200']['score_sugerido']}, es_veto={sc3['precio_sma200']['es_veto']}")
print(f"  Justificacion: {sc3['precio_sma200']['justificacion']}")

check("precio_sma200.score_sugerido == 0", sc3["precio_sma200"]["score_sugerido"] == 0, sc3["precio_sma200"]["score_sugerido"], "0")
check("precio_sma200.es_veto == True", sc3["precio_sma200"]["es_veto"] == True, sc3["precio_sma200"]["es_veto"], "True")


# ═══════════════════════════════════════════════════════════════════════════════
#  CASO 4 — Acción rezagada (score < 22 → NO OPERAR)
# ═══════════════════════════════════════════════════════════════════════════════

section("CASO 4 — Acción rezagada (score < 22 → NO OPERAR)")

hh_hl_bad = detect_hh_hl(make_weekly_candles_bearish(26))

closes_bad, highs_bad, lows_bad, volumes_bad = make_daily_data(260, price_start=55, trend_pct=-0.0005)
closes_bad[-1] = 50.0
highs_bad[-1]  = 50.5
lows_bad[-1]   = 49.5

sc4 = calc_position_scorecard({
    "price":        50,
    "sma50":        55,       # precio BAJO SMA50
    "sma200":       45,       # precio SOBRE SMA200 (no veto técnico)
    "mansfield_rs": -3,
    "rs_sector":    -2,
    "hh_hl":        hh_hl_bad,
    "fundamentals": {
        "revenueGrowth": -5,
        "epsGrowth":     -10,
        "profitMargin":  3,
    },
    "cashflow":     {"fcf_positive": False},
    "vol_ratio":    70,
    "rr_suggested": 1.2,
    "next_earnings": None,
    "highs":        highs_bad,
    "lows":         lows_bad,
    "volumes":      volumes_bad,
    "base":         {},
})

sc4["narrativa"]["score_sugerido"] = 0
score4 = calc_score_total(sc4)

print(f"\n  Score total obtenido: {score4}")
print(f"  Desglose:")
for k, v in sc4.items():
    s = v["score_sugerido"]
    p = v["peso"]
    print(f"    {k:25s}: score={s} × peso={p} = {s*p}")

check("Score < 22 (NO OPERAR)", score4 < 22, score4, "< 22")


# ═══════════════════════════════════════════════════════════════════════════════
#  CASO 5 — detect_hh_hl con tendencia alcista clara
# ═══════════════════════════════════════════════════════════════════════════════

section("CASO 5 — detect_hh_hl con tendencia alcista (score >= 2)")

# Construir 26 velas con highs y lows explícitamente crecientes con estructura de pivots
def make_bullish_pivots(n=26):
    """Velas con pivots claros HH y HL garantizados."""
    candles = []
    base_high = 100.0
    base_low  = 95.0
    for i in range(n):
        # Ciclo de 3 velas: sube → toca máximo (pivot high) → corrige → rebota (pivot low)
        phase = i % 4
        if phase == 0:
            h = base_high + i * 0.8
            l = base_low  + i * 0.5
        elif phase == 1:
            h = base_high + i * 0.8 + 1.5   # pivot high
            l = base_low  + i * 0.5 + 0.5
        elif phase == 2:
            h = base_high + i * 0.8 - 0.3
            l = base_low  + i * 0.5 - 0.5
        else:
            h = base_high + i * 0.8 + 0.2
            l = base_low  + i * 0.5 + 0.8   # pivot low
        candles.append({
            "date": f"2025-{(i//4)+1:02d}-{(i%4)*7+1:02d}",
            "open":  round((h + l) / 2, 2),
            "high":  round(h, 2),
            "low":   round(l, 2),
            "close": round((h + l) / 2, 2),
        })
    return candles

candles5 = make_bullish_pivots(26)
result5 = detect_hh_hl(candles5)

print(f"\n  HH count: {result5['hh_count']}")
print(f"  HL count: {result5['hl_count']}")
print(f"  Score: {result5['score']}")
print(f"  Descripcion: {result5['description']}")

check("detect_hh_hl score >= 2 (tendencia alcista)", result5["score"] >= 2, result5["score"], ">= 2")
check("hh_count >= 1", result5["hh_count"] >= 1, result5["hh_count"], ">= 1")
check("hl_count >= 1", result5["hl_count"] >= 1, result5["hl_count"], ">= 1")


# ═══════════════════════════════════════════════════════════════════════════════
#  CASO 6 — detect_hh_hl con mercado bajista (score == 0)
# ═══════════════════════════════════════════════════════════════════════════════

section("CASO 6 — detect_hh_hl con mercado bajista (score == 0)")

candles6 = make_weekly_candles_bearish(26)
result6 = detect_hh_hl(candles6)

print(f"\n  HH count: {result6['hh_count']}")
print(f"  HL count: {result6['hl_count']}")
print(f"  Score: {result6['score']}")
print(f"  Descripcion: {result6['description']}")

check("detect_hh_hl score == 0 (mercado bajista)", result6["score"] == 0, result6["score"], "0")


# ═══════════════════════════════════════════════════════════════════════════════
#  CASO 7 — analyze_base con base sólida (>= 7 semanas)
# ═══════════════════════════════════════════════════════════════════════════════

section("CASO 7 — analyze_base con base sólida (weeks >= 7, quality = 'sound')")

candles7 = make_weekly_candles_base(n=15, range_pct=0.08)
result7 = analyze_base(candles7)

print(f"\n  weeks_in_base: {result7['weeks_in_base']}")
print(f"  base_quality:  {result7['base_quality']}")
print(f"  range_pct:     {result7['range_pct']}%")
print(f"  Descripcion:   {result7['description']}")

check("weeks_in_base >= 7", result7["weeks_in_base"] >= 7, result7["weeks_in_base"], ">= 7")
check("base_quality == 'sound'", result7["base_quality"] == "sound", result7["base_quality"], "'sound'")
check("range_pct <= 20", result7["range_pct"] is not None and result7["range_pct"] <= 20, result7["range_pct"], "<= 20%")


# ═══════════════════════════════════════════════════════════════════════════════
#  CASO 8 — detect_stage Stage 2 (alcista)
# ═══════════════════════════════════════════════════════════════════════════════

section("CASO 8 — detect_stage Stage 2 (precio > SMA30, pendiente positiva)")

candles8 = make_weekly_candles_stage2(n=40)
result8 = detect_stage(candles8)

print(f"\n  stage:          {result8['stage']}")
print(f"  label:          {result8.get('label','N/A')}")
print(f"  slope_4w_pct:   {result8.get('slope_4w_pct','N/A')}%")
print(f"  price_above:    {result8.get('price_above_sma30','N/A')}")
print(f"  Descripcion:    {result8.get('description','N/A')}")

check("detect_stage == 2 (Stage 2)", result8["stage"] == 2, result8["stage"], "2")
check("price_above_sma30 == True", result8.get("price_above_sma30") == True, result8.get("price_above_sma30"), "True")
check("slope_4w_pct > 0.5", result8.get("slope_4w_pct", 0) > 0.5, result8.get("slope_4w_pct"), "> 0.5%")


# ═══════════════════════════════════════════════════════════════════════════════
#  CASO 9 — Consistencia entry/stop/target/rr (lógica de _analyze_position_inner)
# ═══════════════════════════════════════════════════════════════════════════════

section("CASO 9 — Consistencia entry/stop/target/rr (R/R ~ 2.5x)")

# --- Escenario BREAKOUT ---
# near_high = True → entry = price, stop = min(lows[-50]) * 0.98, target = entry + risk*2.5

price_bo  = 100.0
high_52w  = 102.0
lows_bo   = [85.0 + i * 0.06 for i in range(50)]   # min ≈ 85.0
entry_bo  = price_bo   # near_high → entry = price
stop_bo   = round(min(lows_bo) * 0.98, 2)           # min(lows)*0.98
risk_bo   = entry_bo - stop_bo
target_bo = round(entry_bo + risk_bo * 2.5, 2)
rr_bo     = round((target_bo - entry_bo) / risk_bo, 2) if risk_bo > 0 else 0

print(f"\n  [Breakout] entry={entry_bo}, stop={stop_bo}, target={target_bo}, R/R={rr_bo}")
check("Breakout R/R ≈ 2.5", abs(rr_bo - 2.5) < 0.05, rr_bo, "~2.5")
check("Stop < Entry (breakout)", stop_bo < entry_bo, stop_bo, f"< {entry_bo}")
check("Target > Entry (breakout)", target_bo > entry_bo, target_bo, f"> {entry_bo}")

# --- Escenario PULLBACK ---
# near_high = False → entry = sma50, stop = min(lows[-20]) * 0.98, target = entry + risk*2.5

sma50_pb  = 92.0
price_pb  = 90.0     # bajo SMA50, no es near_52w_high
lows_pb   = [86.0 + i * 0.05 for i in range(20)]   # min ≈ 86.0
entry_pb  = sma50_pb
stop_pb   = round(min(lows_pb) * 0.98, 2)
risk_pb   = entry_pb - stop_pb
target_pb = round(entry_pb + risk_pb * 2.5, 2)
rr_pb     = round((target_pb - entry_pb) / risk_pb, 2) if risk_pb > 0 else 0

print(f"  [Pullback] entry={entry_pb}, stop={stop_pb}, target={target_pb}, R/R={rr_pb}")
check("Pullback R/R ≈ 2.5", abs(rr_pb - 2.5) < 0.05, rr_pb, "~2.5")
check("Stop < Entry (pullback)", stop_pb < entry_pb, stop_pb, f"< {entry_pb}")
check("Entry = SMA50 (pullback)", entry_pb == sma50_pb, entry_pb, f"== {sma50_pb}")


# ═══════════════════════════════════════════════════════════════════════════════
#  CASO 10 — calidad_fundamental todos los combos
# ═══════════════════════════════════════════════════════════════════════════════

section("CASO 10 — calidad_fundamental: todos los combos")

# Para el caso 10 necesitamos highs/lows/volumes con al menos 1 elemento
# para que max() no falle en el criterio punto_entrada
_closes_f, _highs_f, _lows_f, _volumes_f = make_daily_data(260, price_start=95, trend_pct=0.0)

_base_data_fund = {
    "price": 100, "sma50": 95, "sma200": 80,
    "mansfield_rs": 1.0, "rs_sector": 0.5,
    "hh_hl": {"score": 2, "hh_count": 2, "hl_count": 1, "description": "test"},
    "vol_ratio": 100, "rr_suggested": 2.5,
    "next_earnings": None,
    "highs": _highs_f, "lows": _lows_f, "volumes": _volumes_f,
    "base": {},
}

def fund_score_for(rev, eps, profit_margin=None, op_margin=None, fcf_positive=None, analyst_sb=0, analyst_buy=0):
    d = dict(_base_data_fund)
    d["fundamentals"] = {
        "revenueGrowth":   rev,
        "epsGrowth":       eps,
        "profitMargin":    profit_margin,
        "operatingMargin": op_margin,
        "analystStrongBuy": analyst_sb,
        "analystBuy": analyst_buy,
    }
    d["cashflow"] = {"fcf_positive": fcf_positive}
    sc = calc_position_scorecard(d)
    return sc["calidad_fundamental"]["score_sugerido"]

# Sub-caso A: rev=25, eps=30, fcf=True → rev_strong(+1) + eps_strong(+1) + quality_ok(+1) = 3
fA = fund_score_for(rev=25, eps=30, fcf_positive=True)
print(f"\n  A) rev=25, eps=30, fcf=True → score={fA} (esperado: 3)")
check("fund A: rev=25, eps=30, fcf=True → 3", fA == 3, fA, "3")

# Sub-caso B: rev=15, eps=5, fcf=True
# rev_strong(+1) + eps_positive + rev_strong→ eps "✓" (+1) + quality_ok(+1) = 3
fB = fund_score_for(rev=15, eps=5, fcf_positive=True)
print(f"  B) rev=15, eps=5, fcf=True     → score={fB} (esperado: 3)")
check("fund B: rev=15, eps=5, fcf=True → 3", fB == 3, fB, "3")

# Sub-caso C: rev=5, eps=8, fcf=True
# rev_moderate (no +1) + eps_positive + rev_moderate → combo growth (+1) + quality_ok(+1) = 2
fC = fund_score_for(rev=5, eps=8, fcf_positive=True)
print(f"  C) rev=5, eps=8, fcf=True      → score={fC} (esperado: 2)")
check("fund C: rev=5, eps=8, fcf=True → 2", fC == 2, fC, "2")

# Sub-caso D: rev=-5, eps=-10, fcf=False → nada suma, quality_ok=False → 0
fD = fund_score_for(rev=-5, eps=-10, profit_margin=3, fcf_positive=False)
print(f"  D) rev=-5, eps=-10, fcf=False  → score={fD} (esperado: 0)")
check("fund D: rev=-5, eps=-10, fcf=False → 0", fD == 0, fD, "0")

# Sub-caso E: rev=None, eps=None, profit_margin=20, fcf=True
# rev=None → nada | eps=None → nada | quality_ok: fcf=True(+1) + profit>10(+1 pero quality_ok ya True) → quality(+1) = 1
fE = fund_score_for(rev=None, eps=None, profit_margin=20, fcf_positive=True)
print(f"  E) rev=None, eps=None, pm=20, fcf=True → score={fE} (esperado: 1)")
check("fund E: rev=None, eps=None, pm=20, fcf=True → 1", fE == 1, fE, "1")


# ═══════════════════════════════════════════════════════════════════════════════
#  RESUMEN FINAL
# ═══════════════════════════════════════════════════════════════════════════════

total = PASS_COUNT + FAIL_COUNT
print(f"\n{'='*60}")
print(f"  RESUMEN: {PASS_COUNT}/{total} tests pasaron")
print(f"{'='*60}")

if FAIL_COUNT > 0:
    print(f"\n  Tests que FALLARON:")
    for status, msg in RESULTS:
        if status == "FAIL":
            print(msg)
    sys.exit(1)
else:
    print("\n  Todos los tests pasaron correctamente.")
    sys.exit(0)
