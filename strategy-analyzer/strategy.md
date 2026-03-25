# @HondaCivic Weather Trading Strategy

> Reverse-engineered from 191 positions, 20,257 trades, 135 events (Jan 29 – Mar 22, 2026).
> **82% win rate | +$14,611 realized PnL | 126% ROI**

---

## 1. Market Selection

Trade **Polymarket daily high-temperature markets** across multiple cities simultaneously.

### City Priority (by realized PnL)

| Tier | Cities | Notes |
|------|--------|-------|
| **S-Tier** | London | $8,914 PnL, 29 events, 426% ROI. Maritime climate = narrow temp range = most predictable |
| **A-Tier** | Seoul, Ankara | $1,837 and $943 PnL. High conviction, fewer events |
| **B-Tier** | NYC, Buenos Aires, Paris, Munich, Atlanta | $269–$663 PnL each. Positive but thinner edge |
| **C-Tier** | Toronto, São Paulo, Chicago, Seattle, Wellington, Dallas, Miami | Small positive PnL. Volume plays |

London alone generates **61%** of all weather profit.

---

## 2. Market Resolution Rules

Markets resolve to the **highest temperature recorded** at a **specific weather station** in **whole degrees Celsius**, as reported by **Weather Underground** (Wunderground).

| Detail | Value |
|--------|-------|
| Source | [wunderground.com](https://www.wunderground.com) historical data |
| Station | City-specific (e.g., London = London City Airport `EGLC`) |
| Precision | **Whole degrees only** — no decimals |
| Measure | Highest temperature of the day (daily max) |
| Finalization | Market resolves only after all data for that day is finalized on Wunderground |

### Rounding Implications

Wunderground reports whole integers. If the real temperature peaks at:
- **12.9°C** → Wunderground may show **13°C** → "13°C" market wins
- **12.4°C** → Wunderground may show **12°C** → "12°C" market wins
- **12.5°C** → could go either way depending on Wunderground's internal rounding

**The prediction target is not the "true" temperature — it's what Wunderground's station will DISPLAY as the daily high.** Station placement, sensor read timing, and Wunderground's internal rounding all matter.

### Station Links (by city)

Each city resolves from a specific station page:
```
Ankara:       https://www.wunderground.com/history/daily/tr/çubuk/LTAC
Atlanta:      https://www.wunderground.com/history/daily/us/ga/atlanta/KATL
Buenos Aires: https://www.wunderground.com/history/daily/ar/ezeiza/SAEZ
Chicago:      https://www.wunderground.com/history/daily/us/il/chicago/KORD
Dallas:       https://www.wunderground.com/history/daily/us/tx/dallas/KDAL
London:       https://www.wunderground.com/history/daily/gb/london/EGLC
Miami:        https://www.wunderground.com/history/daily/us/fl/miami/KMIA
Milan:        https://www.wunderground.com/history/daily/it/milan/LIMC
Munich:       https://www.wunderground.com/history/daily/de/munich/EDDM
NYC:          https://www.wunderground.com/history/daily/us/ny/new-york-city/KLGA
Paris:        https://www.wunderground.com/history/daily/fr/paris/LFPG
Sao Paulo:    https://www.wunderground.com/history/daily/br/guarulhos/SBGR
Seattle:      https://www.wunderground.com/history/daily/us/wa/seatac/KSEA
Seoul:        https://www.wunderground.com/history/daily/kr/incheon/RKSI
Toronto:      https://www.wunderground.com/history/daily/ca/mississauga/CYYZ
Wellington:   https://www.wunderground.com/history/daily/nz/wellington/NZWN
```

---

## 3. Position Structure (per city/day event)

Each temperature event has multiple brackets (e.g., 11°C, 12°C, 13°C, 14°C, 15°C+).
Only ONE bracket resolves YES. All others resolve NO.

### The Spread

For each event, take **4 bracket positions**:

| Position | Count | Entry Price | Purpose |
|----------|-------|-------------|---------|
| **YES** | ~1 bracket | avg **62¢** (range 10–100¢) | The bracket you predict **will** hit |
| **NO** | ~3 brackets | avg **98–99.9¢** | Brackets you're confident **won't** hit |

### Critical Rules

1. **NEVER buy NO on the bracket you predict is correct** — this guarantees a loss on that leg
2. Buy YES on the bracket your weather model says is most likely
3. Buy NO on brackets that are clearly out of range (extremes, "or higher" tails, etc.)
4. The YES bet is the main profit driver; the NO bets are high-probability small gains

---

## 3. Entry Timing

| Metric | Value |
|--------|-------|
| Median entry | **10.6 hours** before market resolution |
| Peak hour | **11:00 UTC** (automated batch) |
| Primary window | 6–24h before resolution (69% of all trades) |
| Heaviest day | **Saturday** (5,539 trades, 27% of total) |

### Timing Distribution

```
0-6h before:   ███████████████      5,152 trades (25%)
6-12h before:  ████████████████████ 6,596 trades (33%)
12-24h before: ████████████████████ 6,742 trades (33%)
24-48h before: ████                 1,322 trades (7%)
48h+ before:                            3 trades (0%)
```

**Why trade late**: Weather forecasts become dramatically more accurate within 24h of the target date. By entering at 10–12h before resolution, he uses the most reliable forecast data available.

---

## 4. Price Discipline

### YES Entry Prices

- **Average**: 62¢ (from spread analysis per event)
- **Overall avg**: 49.7¢ | **Median**: 41¢
- **Volume**: $356K across 2,952 trades
- He buys YES when probability is **underpriced** relative to his forecast

### NO Entry Prices

- **Average**: 98.6¢ | **Median**: 99.9¢
- **Volume**: $3.16M across 15,253 trades
- Nearly all NO entries are at **99.9¢** — maximum probability, minimum risk

### Sell Activity

- **2,052 sell trades** — he actively manages positions
- YES sells at avg **70.6¢** ($54K volume) — taking profit or cutting losses
- NO sells at avg **90.6¢** ($93K volume) — exiting when bracket risk increases

---

## 5. Capital Allocation

| Metric | Value |
|--------|-------|
| Avg capital per event | ~$6,000 deployed across all brackets |
| Avg per trade | $192 (median $10 — heavy long-tail) |
| NO capital per event | ~$5,200 (bulk of deployment) |
| YES capital per event | ~$350 (smaller speculative leg) |

The NO side is the **high-volume, low-margin** component.
The YES side is the **low-volume, high-margin** component.

---

## 6. Risk Management

| Metric | Value |
|--------|-------|
| Win rate | **82%** (107/132 resolved events) |
| Biggest win | London Feb 20: **+$2,421** |
| Biggest loss | London Feb 1: **-$2,484** |
| Active sells | 2,052 (dynamic position adjustment) |

### How Losses Are Contained

When the YES bracket is wrong:
- YES position → **total loss** (62¢ × shares)
- NO positions → **still win** (0.1¢ × shares profit each)
- Net: loss is capped to ~YES cost minus small NO gains

When the YES bracket is right:
- YES position → **big win** (38¢+ per share profit)
- NO positions → **small win** (0.1¢ per share profit)
- Net: solid profit from the YES leg

The 82% accuracy means the YES leg wins 4 out of 5 times, and the NO legs provide a small buffer even on losses.

---

## 7. Edge Source

1. **NWP Weather Models** — likely uses GFS, ECMWF, or ensemble blends for temperature forecasting
2. **Late entry** — trades when 12-24h forecasts are most accurate (skill score peaks here)
3. **City selection** — London's maritime climate has the narrowest forecast error bars
4. **Automated execution** — peak at exactly 11:00 UTC suggests a bot or scheduled script
5. **Active management** — adjusts positions as new forecast runs come in (2,052 sells)

---

## 8. Replication Checklist

```
□ Set up NWP model data feeds (GFS/ECMWF ensemble)
□ Focus on London first (highest demonstrated edge)
□ For each city/day:
  1. Run forecast model → identify most likely temperature bracket
  2. Buy YES on predicted bracket at best available price
  3. Buy NO on 3 brackets you're confident won't hit
  4. DO NOT buy NO on your predicted bracket
  5. Size: ~$6K total per event ($300-500 YES, $4,500-5,500 NO)
□ Enter positions 10-12h before market resolution
□ Monitor forecast updates → sell/adjust if prediction changes
□ Batch execute daily around 11:00 UTC
```
