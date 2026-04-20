# Diagnostic moteur ML — 2026-04-20 16:56 UTC

4 requêtes SQL lancées sur la base Supabase. Résultats bruts ci-dessous.

---

## Requête 1 — Derniers cycles ML (10 dernières minutes)

### Cycle `2026-04-20 16:55:0x` UTC (threshold = 0.97)

| created_at | symbol | reason | confidence | ensemble_prob | xgb_prob | lstm_prob | stoch_k | rsi14 |
|---|---|---|---|---|---|---|---|---|
| 16:55:07.035 | DOGE | fusion_below_threshold: backend_entry_evaluation | null | null | null | null | null | null |
| 16:55:06.339 | USDC | fusion_below_threshold: backend_entry_evaluation | null | null | null | null | null | null |
| 16:55:05.557 | USDT | fusion_below_threshold: backend_entry_evaluation | null | null | null | null | null | null |
| 16:55:04.996 | ADA  | ml_filter_blocked | 0.9352 | **0.9352** | null | null | **0**    | 41.38 |
| 16:55:04.577 | XRP  | ml_filter_blocked | 0.4149 | 0.4149 | null | null | 6.38     | 44.30 |
| 16:55:04.072 | AVAX | ml_filter_blocked | 0.5337 | 0.5337 | null | null | 20       | 43.78 |
| 16:55:03.563 | SOL  | ml_filter_blocked | 0.4802 | 0.4802 | null | null | 8.70     | 47.16 |
| 16:55:01.327 | BTC  | ml_filter_blocked | 0.8226 | 0.8226 | null | null | 2.32     | 46.07 |

> ETH et LINK absents de ce cycle.

### Cycle `2026-04-20 16:50:0x` UTC

| created_at | symbol | reason | confidence | ensemble_prob | xgb_prob | lstm_prob | stoch_k | rsi14 |
|---|---|---|---|---|---|---|---|---|
| 16:50:07.472 | DOGE | fusion_below_threshold | null | null | null | null | null | null |
| 16:50:06.725 | USDC | fusion_below_threshold | null | null | null | null | null | null |
| 16:50:06.012 | USDT | fusion_below_threshold | null | null | null | null | null | null |
| 16:50:05.366 | ADA  | ml_filter_blocked | 0.9232 | **0.9232** | null | null | 22.22 | 44.98 |
| 16:50:04.875 | XRP  | ml_filter_blocked | 0.9267 | **0.9267** | null | null | 5.68  | 45.27 |
| 16:50:04.098 | AVAX | ml_filter_blocked | 0.4953 | 0.4953 | null | null | 40    | 47.42 |
| 16:50:03.292 | SOL  | ml_filter_blocked | 0.4863 | 0.4863 | null | null | 48.65 | 56.25 |
| 16:50:02.612 | ETH  | ml_filter_blocked | 0.4761 | 0.4761 | null | null | 41.91 | 49.88 |
| 16:50:01.812 | BTC  | ml_filter_blocked | 0.3491 | 0.3491 | null | null | 38.02 | 51.98 |

**Observations brutes** :
- `xgb_prob` et `lstm_prob` = `null` sur 100% des lignes
- `stoch_k = 0` réapparaît sur ADA (16:55) — cohérent avec le pattern observé hier
- Aucun `ensemble_prob ≥ 0.97` sur les 10 dernières minutes (max = 0.9352, ADA)

---

## Requête 2 — Top 10 `ensemble_prob` (24h, `ml_filter_blocked`)

| created_at | symbol | ensemble_prob | stoch_k | rsi14 |
|---|---|---|---|---|
| 2026-04-19 18:55:05 | XRP  | **0.9688** | 44.32 | 43.25 |
| 2026-04-19 18:10:03 | SOL  | 0.9684 | 2.50  | 30.35 |
| 2026-04-19 19:45:08 | SOL  | 0.9679 | 57.63 | 47.75 |
| 2026-04-19 19:50:03 | SOL  | 0.9679 | 57.63 | 47.75 |
| 2026-04-19 20:45:04 | ADA  | 0.9676 | 0     | 37.36 |
| 2026-04-19 20:20:04 | XRP  | 0.9675 | 5.19  | 36.04 |
| 2026-04-19 17:25:04 | ADA  | 0.9673 | 16.13 | 40.45 |
| 2026-04-19 21:55:02 | SOL  | 0.9670 | 56.82 | 47.43 |
| 2026-04-19 17:00:03 | ETH  | 0.9667 | 7.02  | 30.20 |
| 2026-04-19 18:25:04 | XRP  | 0.9661 | 20.56 | 36.15 |

**Observation brute** : meilleure prob 24h = **0.9688** (XRP) → toujours **sous** le seuil 0.97.

---

## Requête 3 — `ml_signal_buy` (24h)

**0 ligne retournée.**

Aucun trade ML déclenché dans les 24 dernières heures.

---

## Requête 4 — Fraîcheur ingestion OHLCV 5m

Heure du SELECT : ~`2026-04-20 16:56:20 UTC`

| symbol   | dernière_bougie         | age         |
|----------|-------------------------|-------------|
| ADA-EUR  | 2026-04-20 16:50:00+00  | 00:06:20.32 |
| AVAX-EUR | 2026-04-20 16:50:00+00  | 00:06:20.32 |
| BTC-EUR  | 2026-04-20 16:50:00+00  | 00:06:20.32 |
| ETH-EUR  | 2026-04-20 16:50:00+00  | 00:06:20.32 |
| LINK-EUR | 2026-04-20 16:50:00+00  | 00:06:20.32 |
| LTC-EUR  | 2026-04-20 16:50:00+00  | 00:06:20.32 |
| SOL-EUR  | 2026-04-20 16:50:00+00  | 00:06:20.32 |
| XRP-EUR  | 2026-04-20 16:50:00+00  | 00:06:20.32 |

Tous les symboles synchronisés sur la même bougie (16:50). La bougie 16:55 n'était pas encore ingérée au moment du SELECT.

---

## Synthèse factuelle (sans interprétation)

| Question | Réponse brute |
|---|---|
| Le moteur tourne-t-il ? | Oui — cycles toutes les 5 min (16:50 et 16:55 observés) |
| Symboles les + proches du seuil 0.97 ? | XRP 0.9688 / SOL 0.9684 / ADA 0.9676 (tous datés 2026-04-19) |
| Trades déclenchés sur 24h ? | **0** (`ml_signal_buy` vide) |
| Données fraîches (< 10 min) ? | Oui — 6 min 20 s pour les 8 symboles |
| `xgb_prob` / `lstm_prob` exposés ? | Non — `null` sur 100% des lignes |
| `stoch_k = 0` toujours présent ? | Oui — ADA 16:55 (et ADA 2026-04-19 20:45) |
