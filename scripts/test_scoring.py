"""
Tests del sistema de scoring antes de cada push al backend.
Ejecutar con: python scripts/test_scoring.py

Verifica:
  1. calc_score  — score técnico puro (usa SMA21/SMA50)
  2. calc_context_stars — estrellas de contexto (usa SMA21/SMA50)
  3. determine_final_signal — señal final
  4. calc_levels — niveles anclados a soportes técnicos (usa SMA21)
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from main import calc_score, calc_context_stars, determine_final_signal, calc_levels

PASS = 0
FAIL = 0

def check(name, actual, expected):
    global PASS, FAIL
    if actual == expected:
        print(f"  ✓ {name}")
        PASS += 1
    else:
        print(f"  ✗ {name}")
        print(f"    esperado: {expected}")
        print(f"    obtenido: {actual}")
        FAIL += 1

def check_range(name, actual, lo, hi):
    global PASS, FAIL
    if lo <= actual <= hi:
        print(f"  ✓ {name} ({actual} en [{lo},{hi}])")
        PASS += 1
    else:
        print(f"  ✗ {name} ({actual} fuera de [{lo},{hi}])")
        FAIL += 1

# ── 1. calc_score — score técnico puro ───────────────────────────────────────
print("\n[1] calc_score — score técnico puro (SMA21/SMA50)")

# Setup perfecto: todo alcista
s = calc_score(rsi=52, sma21=110, sma50=100, sma200=90, price=115,
               vol_ratio=110, mansfield_rs=3.0, momentum_4w=8.0, recent_high=120)
check_range("Setup perfecto → score alto", s['score'], 80, 100)
check("Setup perfecto → sin alertas técnicas", len(s['alerts']), 0)

# Setup bajista: todo negativo
s = calc_score(rsi=78, sma21=90, sma50=110, sma200=120, price=88,
               vol_ratio=40, mansfield_rs=-4.0, momentum_4w=-12.0, recent_high=115)
check_range("Setup bajista → score bajo", s['score'], 0, 30)

# SMA bajista → siempre penaliza
s = calc_score(rsi=50, sma21=95, sma50=100, sma200=None, price=96,
               vol_ratio=100, mansfield_rs=0.5, momentum_4w=2.0, recent_high=105)
check("SMA bajista → ema_trend = -10", s['breakdown']['ema_trend'], -10)

# RSI sobrecompra extrema → penaliza
s = calc_score(rsi=80, sma21=110, sma50=100, sma200=90, price=112,
               vol_ratio=100, mansfield_rs=1.0, momentum_4w=5.0, recent_high=120)
check("RSI 80 → rsi = -10", s['breakdown']['rsi'], -10)

# RSI sobreventa → bonus moderado
s = calc_score(rsi=25, sma21=110, sma50=100, sma200=90, price=112,
               vol_ratio=100, mansfield_rs=1.0, momentum_4w=5.0, recent_high=120)
check("RSI 25 → rsi = +5", s['breakdown']['rsi'], +5)

# Volumen muy bajo → penaliza
s = calc_score(rsi=50, sma21=110, sma50=100, sma200=90, price=112,
               vol_ratio=45, mansfield_rs=1.0, momentum_4w=5.0, recent_high=120)
check("Volumen 45% → volume = -8", s['breakdown']['volume'], -8)

# Mansfield RS muy negativo
s = calc_score(rsi=50, sma21=110, sma50=100, sma200=90, price=112,
               vol_ratio=100, mansfield_rs=-3.0, momentum_4w=5.0, recent_high=120)
check("Mansfield -3 → mansfield = -12", s['breakdown']['mansfield'], -12)

# SMA200 recuperación: precio bajo SMA pero SMA alcista y momentum positivo → -3 no -6
s = calc_score(rsi=50, sma21=110, sma50=100, sma200=120, price=112,
               vol_ratio=100, mansfield_rs=1.0, momentum_4w=5.0, recent_high=125)
check("Recuperación SMA200 → sma200 = -3", s['breakdown']['sma200'], -3)

# Score nunca supera 100
s = calc_score(rsi=50, sma21=110, sma50=100, sma200=90, price=112,
               vol_ratio=110, mansfield_rs=5.0, momentum_4w=10.0, recent_high=130)
check("Score máximo ≤ 100", s['score'] <= 100, True)

# Score nunca baja de 0
s = calc_score(rsi=85, sma21=80, sma50=100, sma200=120, price=78,
               vol_ratio=30, mansfield_rs=-5.0, momentum_4w=-20.0, recent_high=115)
check("Score mínimo ≥ 0", s['score'] >= 0, True)

# ── 2. calc_context_stars ─────────────────────────────────────────────────────
print("\n[2] calc_context_stars — estrellas de contexto (SMA21/SMA50)")

f_clean  = {}
f_target = {'analystTarget': 80.0, 'dividendYield': 0.0}

# Sin factores de riesgo → 3 estrellas
c = calc_context_stars(score=70, sma21=110, sma50=100, mansfield_rs=2.0,
                       next_earnings=None, ex_dividend_date=None,
                       fundamentals=f_clean, price=100.0, max_days=20)
check("Sin riesgos → 3 estrellas", c['stars'], 3)

# Earnings en 4 días → baja 2 estrellas
from datetime import date, timedelta
earn_4d = (date.today() + timedelta(days=4)).isoformat()
c = calc_context_stars(score=70, sma21=110, sma50=100, mansfield_rs=2.0,
                       next_earnings=earn_4d, ex_dividend_date=None,
                       fundamentals=f_clean, price=100.0, max_days=20)
check("Earnings en 4 días → 1 estrella (3-2)", c['stars'], 1)

# Earnings en 10 días → baja 1 estrella
earn_10d = (date.today() + timedelta(days=10)).isoformat()
c = calc_context_stars(score=70, sma21=110, sma50=100, mansfield_rs=2.0,
                       next_earnings=earn_10d, ex_dividend_date=None,
                       fundamentals=f_clean, price=100.0, max_days=20)
check("Earnings en 10 días → 2 estrellas (3-1)", c['stars'], 2)

# Ex-dividend en 3 días con yield 2% → baja 2 estrellas
exdiv_3d = (date.today() + timedelta(days=3)).isoformat()
c = calc_context_stars(score=70, sma21=110, sma50=100, mansfield_rs=2.0,
                       next_earnings=None, ex_dividend_date=exdiv_3d,
                       fundamentals={'dividendYield': 2.0}, price=100.0, max_days=20)
check("Ex-div en 3 días yield 2% → 1 estrella (3-2)", c['stars'], 1)

# Precio superó target analistas → baja 1 estrella
c = calc_context_stars(score=70, sma21=110, sma50=100, mansfield_rs=2.0,
                       next_earnings=None, ex_dividend_date=None,
                       fundamentals={'analystTarget': 85.0}, price=100.0, max_days=20)
check("Precio superó target analistas → 2 estrellas (3-1)", c['stars'], 2)

# Mansfield < -2 con técnica alcista (SMA21 > SMA50) → baja 1 estrella
c = calc_context_stars(score=70, sma21=110, sma50=100, mansfield_rs=-3.0,
                       next_earnings=None, ex_dividend_date=None,
                       fundamentals=f_clean, price=100.0, max_days=20)
check("Mansfield -3 + SMA alcista → 2 estrellas (3-1)", c['stars'], 2)

# Score < 45 → 0 estrellas (no aplica)
c = calc_context_stars(score=40, sma21=110, sma50=100, mansfield_rs=2.0,
                       next_earnings=None, ex_dividend_date=None,
                       fundamentals=f_clean, price=100.0, max_days=20)
check("Score < 45 → 0 estrellas", c['stars'], 0)

# ── 3. determine_final_signal ─────────────────────────────────────────────────
print("\n[3] determine_final_signal — señal final")

# Score alto + 3 estrellas → buy alta confianza
r = determine_final_signal(score=80, tech_signal="buy", context_stars=3,
                           context_reasons=[], rsi=52)
check("Score 80 + 3★ → buy", r['signal'], "buy")
check("Score 80 + 3★ → confidenceStars 3", r['confidenceStars'], 3)

# Score alto + 2 estrellas → buy media confianza
r = determine_final_signal(score=75, tech_signal="buy", context_stars=2,
                           context_reasons=["Earnings en 10 días"], rsi=52)
check("Score 75 + 2★ → buy", r['signal'], "buy")
check("Score 75 + 2★ → confidenceStars 2", r['confidenceStars'], 2)

# Score alto + 0-1 estrellas con razones → monitor
r = determine_final_signal(score=75, tech_signal="buy", context_stars=1,
                           context_reasons=["Earnings en 4 días — riesgo alto"], rsi=52)
check("Score 75 + 1★ con razón → monitor", r['signal'], "monitor")

# Score < 30 → avoid siempre
r = determine_final_signal(score=25, tech_signal="buy", context_stars=3,
                           context_reasons=[], rsi=50)
check("Score 25 → avoid", r['signal'], "avoid")

# Score 30-44 → hold
r = determine_final_signal(score=38, tech_signal="buy", context_stars=3,
                           context_reasons=[], rsi=50)
check("Score 38 → hold", r['signal'], "hold")

# RSI >= 72 con score bueno → monitor
r = determine_final_signal(score=70, tech_signal="buy", context_stars=3,
                           context_reasons=[], rsi=74)
check("RSI 74 → monitor", r['signal'], "monitor")

# Hold de Claude → hold siempre (score 45-64)
r = determine_final_signal(score=55, tech_signal="hold", context_stars=3,
                           context_reasons=[], rsi=50)
check("Claude hold → hold", r['signal'], "hold")

# ── 4. calc_levels — niveles anclados a soportes técnicos ─────────────────────
print("\n[4] calc_levels — niveles anclados a soportes técnicos (SMA21)")

# Caso normal: entrada anclada a SMA21, stop al mínimo 20d
lv = calc_levels(price=100.0, recent_low=95.0, recent_high=115.0, sma21=99.0)
# Entrada: sma21=99 → el=99*0.995=98.5, eh=99*1.010=99.99
check("Entrada baja = sma21 × 0.995", lv['el'], 98.5)
check("Entrada alta = sma21 × 1.010", lv['eh'], 99.99)
# stop = 95*0.995 = 94.53
check("Stop anclado al mínimo 20d (94.53)", lv['sl'], 94.53)
# entry_mid ≈ 99.25 | riesgo = 99.25-94.53=4.72 | min_target=99.25+4.72*2.5=110.05 | max(115,110.05)=115
check("Target = máximo 20d cuando supera mínimo R:B", lv['tg'], 115.0)

# Stop siempre anclado al mínimo 20d — sin floor porcentual del precio actual
lv = calc_levels(price=100.0, recent_low=80.0, recent_high=115.0, sma21=99.0)
# sl = 80*0.995 = 79.6 — sin floor, precio no interviene
check("Stop = mínimo 20d × 0.995 aunque esté lejos (79.6)", lv['sl'], 79.6)

# Caso: máximo 20d insuficiente para 2.5x R:B → target calculado
lv = calc_levels(price=100.0, recent_low=97.0, recent_high=101.0, sma21=99.0)
# sl=97*0.995=96.52, entry_mid≈99.25, riesgo=99.25-96.52=2.73, min_target=99.25+2.73*2.5=106.08
check("Target calculado por R:B 2.5x cuando máximo 20d es insuficiente", lv['tg'], 106.08)

# R:B resultante siempre >= 2.5x
for price, low, high, sma in [(100, 95, 115, 99), (200, 185, 220, 198), (50, 47, 55, 49)]:
    lv = calc_levels(price=price, recent_low=low, recent_high=high, sma21=sma)
    risk = lv['entry_mid'] - lv['sl']
    if risk > 0:
        rr = round((lv['tg'] - lv['entry_mid']) / risk, 2)
        check(f"R:B >= 2.5x para price={price} low={low} high={high} (obtenido {rr}x)", rr >= 2.5, True)

# Niveles estables: mismos inputs → mismos niveles
lv1 = calc_levels(price=150.0, recent_low=142.0, recent_high=162.0, sma21=148.0)
lv2 = calc_levels(price=150.0, recent_low=142.0, recent_high=162.0, sma21=148.0)
check("Niveles reproducibles con mismos inputs", lv1, lv2)

# Precio levemente diferente pero SMA21 y mínimo/máximo 20d iguales → niveles IDÉNTICOS
lv_a = calc_levels(price=150.0, recent_low=142.0, recent_high=162.0, sma21=148.0)
lv_b = calc_levels(price=150.5, recent_low=142.0, recent_high=162.0, sma21=148.0)
check("Stop idéntico si mínimo 20d no cambió", lv_a['sl'], lv_b['sl'])
check("Entrada idéntica si SMA21 no cambió", lv_a['el'], lv_b['el'])
check("Target idéntico si máximo 20d no cambió", lv_a['tg'], lv_b['tg'])

# ── Resultado final ───────────────────────────────────────────────────────────
print(f"\n{'='*40}")
total = PASS + FAIL
print(f"Resultado: {PASS}/{total} tests pasaron")
if FAIL > 0:
    print(f"FALLOS: {FAIL} — NO hacer push hasta corregir")
    sys.exit(1)
else:
    print("Todo OK — listo para push")
    sys.exit(0)
