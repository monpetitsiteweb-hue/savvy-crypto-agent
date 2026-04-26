# Audit Whale Alert — signaux en base

**Date** : 2026-04-26 13:30 UTC
**Source** : table `live_signals`, sources `whale_alert_ws` et `whale_alert_api`

---

## 1. Structure des 10 signaux whale les plus récents

| created_at | source | signal_type | strength | symbol | amount | amount_usd | blockchain | exchange | tracked_entity |
|---|---|---|---|---|---|---|---|---|---|
| 2026-04-26 13:30:04.626 | whale_alert_api | whale_transfer | 56.28 | USDT | 565 638.70 | 562 798.60 | tron | unknown | null |
| 2026-04-26 13:30:04.598 | whale_alert_api | whale_transfer | 29.85 | USDT | 300 000.00 | 298 493.70 | tron | unknown | null |
| 2026-04-26 13:30:04.565 | whale_alert_api | whale_transfer | 17.91 | USDT | 180 011.06 | 179 107.23 | tron | unknown | null |
| 2026-04-26 13:30:04.546 | whale_alert_api | whale_transfer | 19.90 | USDT | 200 000.00 | 198 995.80 | tron | unknown | null |
| 2026-04-26 13:30:04.527 | whale_alert_api | whale_transfer | 32.58 | USDT | 327 469.88 | 325 825.66 | tron | Binance | null |
| 2026-04-26 13:30:04.508 | whale_alert_api | whale_transfer | 49.75 | USDT | 500 000.00 | 497 489.50 | tron | unknown | null |
| 2026-04-26 13:30:04.489 | whale_alert_api | whale_transfer | 14.33 | XRP-EUR | 99 999.80 | 143 300.19 | ripple | null | null |
| 2026-04-26 13:30:04.466 | whale_alert_api | whale_transfer | 14.92 | USDT | 150 000.00 | 149 246.84 | tron | unknown | null |
| 2026-04-26 13:30:04.447 | whale_alert_api | whale_transfer | 10.19 | USDT | 101 872.00 | 101 859.06 | tron | unknown | null |
| 2026-04-26 13:30:04.427 | whale_alert_api | whale_transfer | 99.99 | USDT | 1 000 000.00 | 999 873.00 | tron | Kucoin | null |

---

## 2. Distribution par source × signal_type × symbol (top 20)

| source | signal_type | symbol | n | first | last |
|---|---|---|---|---|---|
| whale_alert_api | whale_transfer | USDT | 45 813 | 2026-04-13 21:49 | 2026-04-26 13:30 |
| whale_alert_ws | whale_large_movement | USDT | 15 341 | 2026-03-15 10:48 | 2026-04-26 11:53 |
| whale_alert_ws | whale_exchange_inflow | USDT | 2 064 | 2026-03-15 10:48 | 2026-04-26 11:01 |
| whale_alert_ws | whale_large_movement | BTC-EUR | 1 828 | 2026-03-27 23:45 | 2026-04-26 11:53 |
| whale_alert_api | whale_transfer | XRP-EUR | 1 475 | 2026-04-13 21:49 | 2026-04-26 13:30 |
| whale_alert_ws | whale_exchange_outflow | USDT | 1 472 | 2026-03-15 10:48 | 2026-04-26 11:53 |
| whale_alert_ws | whale_exchange_inflow | BTC-EUR | 1 310 | 2026-03-27 23:45 | 2026-04-26 11:53 |
| whale_alert_api | whale_transfer | BTC-EUR | 1 001 | 2026-04-13 21:49 | 2026-04-26 13:30 |
| whale_alert_api | whale_transfer | TRX | 774 | 2026-04-13 22:30 | 2026-04-26 13:09 |
| whale_alert_ws | whale_exchange_outflow | BTC-EUR | 719 | 2026-03-27 23:45 | 2026-04-26 11:53 |
| whale_alert_ws | whale_large_movement | ETH-EUR | 529 | 2026-03-28 23:45 | 2026-04-26 11:53 |
| whale_alert_ws | whale_large_movement | XRP-EUR | 526 | 2026-03-27 23:45 | 2026-04-26 08:36 |
| whale_alert_api | whale_transfer | USDC | 434 | 2026-04-13 21:49 | 2026-04-26 13:00 |
| whale_alert_api | whale_exchange_outflow | XRP-EUR | 332 | 2026-04-13 21:49 | 2026-04-26 13:00 |
| whale_alert_api | whale_exchange_inflow | XRP-EUR | 230 | 2026-04-13 22:30 | 2026-04-26 13:09 |
| whale_alert_ws | whale_large_movement | BTC | 230 | 2026-03-15 10:48 | 2026-03-27 22:51 |
| whale_alert_ws | whale_exchange_inflow | BTC | 184 | 2026-03-15 10:48 | 2026-03-27 22:51 |
| whale_alert_ws | whale_exchange_inflow | ETH-EUR | 163 | 2026-03-28 23:45 | 2026-04-26 11:01 |
| whale_alert_ws | whale_large_movement | TRON | 151 | 2026-03-15 10:48 | 2026-04-26 03:54 |
| whale_alert_api | whale_transfer | ETH-EUR | 141 | 2026-04-13 21:49 | 2026-04-26 13:00 |

---

## 3. Exemples bruts du champ `data` (3 derniers `whale_alert_api`)

```json
{
  "amount": 565638.7,
  "amount_usd": 562798.6,
  "asset": "usdt",
  "blockchain": "tron",
  "exchange": "unknown",
  "from": "TJ7hhYhVhaxNx6BPyq7yFpqZrQULL3JSdb",
  "to": "TBfGs1ThEAXRH9sS7hWLVQEawSMYAgQYAo",
  "hash": "dd513d5b856c082b7aa9ce57d6aae6deacd557269ae7d82f94aee8e9137d5721",
  "timestamp": 1777207014,
  "tracked_entity": null,
  "tracked_entity_type": null,
  "transaction_type": "transfer"
}
```

```json
{
  "amount": 300000,
  "amount_usd": 298493.7,
  "asset": "usdt",
  "blockchain": "tron",
  "exchange": "unknown",
  "from": "TUSNLdTPwRsYgU1cNiLQUGF1Egewe2qCj6",
  "to": "TFjsh6aadjE4aTvgTPH66dB7C5JsYHsnSg",
  "hash": "29d47d4cbecb098b6a60485a6d15ea1cfda3bc90eee41e3de47f89af51355b86",
  "timestamp": 1777206987,
  "tracked_entity": null,
  "tracked_entity_type": null,
  "transaction_type": "transfer"
}
```

```json
{
  "amount": 180011.06,
  "amount_usd": 179107.23,
  "asset": "usdt",
  "blockchain": "tron",
  "exchange": "unknown",
  "from": "TJauRsk46MoHwBdypuUp65MZESiNE8GBWt",
  "to": "TM86XzqKnb4S9PguexQpZSWgEt28ohnK6h",
  "hash": "92c2624d9d2fb4ad4bf30b029e0df246d0ec992a1e475e5aae96500bda1ddedc",
  "timestamp": 1777206984,
  "tracked_entity": null,
  "tracked_entity_type": null,
  "transaction_type": "transfer"
}
```

---

## Annexe — Schéma observé du champ `data`

| clé | type | exemple |
|---|---|---|
| `amount` | number | 565638.7 |
| `amount_usd` | number | 562798.6 |
| `asset` | string (lowercase) | `usdt`, `btc`, `xrp` |
| `blockchain` | string | `tron`, `ripple`, `ethereum` |
| `exchange` | string \| "unknown" \| null | `Binance`, `Kucoin`, `unknown`, null |
| `from` | string (address) | `TJ7hhYhVha…` |
| `to` | string (address) | `TBfGs1ThEA…` |
| `hash` | string (tx hash) | `dd513d5b…` |
| `timestamp` | number (unix s) | 1777207014 |
| `transaction_type` | string | `transfer` (uniquement observé sur api) |
| `tracked_entity` | string \| null | null sur tous les API récents |
| `tracked_entity_type` | string \| null | null sur tous les API récents |

---

## Annexe — Requêtes exécutées

```sql
-- Q1
SELECT created_at, source, signal_type, signal_strength, symbol, data
FROM live_signals
WHERE source IN ('whale_alert_ws','whale_alert_api')
ORDER BY created_at DESC
LIMIT 10;

-- Q2
SELECT source, signal_type, symbol, COUNT(*) AS n,
       MIN(created_at) AS first, MAX(created_at) AS last
FROM live_signals
WHERE source IN ('whale_alert_ws','whale_alert_api')
GROUP BY source, signal_type, symbol
ORDER BY n DESC
LIMIT 20;

-- Q3
SELECT data
FROM live_signals
WHERE source = 'whale_alert_api'
ORDER BY created_at DESC
LIMIT 3;
```
