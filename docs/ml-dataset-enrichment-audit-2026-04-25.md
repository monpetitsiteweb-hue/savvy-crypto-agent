# Audit d'enrichissement du dataset ML historique

**Date** : 2026-04-25  
**Périmètre cible** : bougies 5m, juillet 2025 → avril 2026 (~8 mois)  
**Question** : quelles données déjà en base peuvent enrichir le dataset ML ?

---

## TL;DR

| Source candidate | Couvre la période ? | Verdict |
|---|---|---|
| `market_ohlcv_raw` (1h, 4h, 24h) | ✅ Juin 2025 → Avril 2026 | **Utilisable** pour features multi-TF |
| `market_ohlcv_raw` (5m) | ❌ Démarre 2026-03-11 | Inutilisable hors derniers ~45 jours |
| `external_market_data` (sentiment_score) | ✅ 2025-07-21 → 2026-04-25 (6 092 rows) | **Utilisable** (à inspecter) |
| `historical_market_data` (BigQuery daily) | ⚠️ 2024-01-01 → 2025-11-26 (gel) | Utilisable pour 2024→nov 2025 uniquement |
| `live_signals` (toutes sources) | ❌ Démarre 2026-03-15 | Inutilisable pour backfill historique |
| Fear & Greed Index | ❌ Aucune table dédiée ; 749 rows depuis 2026-03-15 | Inutilisable (à backfiller via API externe) |
| Whale Alert | ❌ `whale_signal_events` vide ; live_signals depuis 2026-03-15 | Inutilisable |
| `crypto_news` | ❌ Démarre 2026-03-26 | Inutilisable |
| `price_data` | ❌ Démarre 2026-03-11 | Redondant avec OHLCV récent |

**Conclusion** : seules **2 sources** permettent un enrichissement réel sur l'intégralité de la fenêtre juillet 2025 → avril 2026 :
1. `market_ohlcv_raw` aux granularités **1h / 4h / 24h** (features multi-timeframe par interpolation/forward-fill sur la grille 5m)
2. `external_market_data` type `sentiment_score` (6 092 points sur 9 mois)

---

## 1. FEAR & GREED INDEX

### Requête
```sql
SELECT MIN(created_at), MAX(created_at), COUNT(*) FROM fear_greed_index;
```
**Résultat** : `ERROR 42P01 — relation "fear_greed_index" does not exist`.

### Donnée alternative
F&G ingéré dans `live_signals` avec `source='fear_greed_index'` :
- Min : `2026-03-15 11:00:04`
- Max : `2026-04-25 17:30:04`
- Count : **749**

### Verdict
❌ **Inutilisable** pour backfill 2025. La couverture commence 8 mois après le début du dataset cible.  
👉 Pour récupérer juillet 2025 → mars 2026 : appeler `https://api.alternative.me/fng/?limit=0` (gratuit, daily) et insérer manuellement.

---

## 2. WHALE ALERT

### Recherche de tables
```sql
SELECT table_name FROM information_schema.tables 
WHERE table_schema='public' AND table_name ILIKE '%whale%';
```
**Résultat** : une seule table → `whale_signal_events`.

### Comptes
| Source | Min | Max | Count |
|---|---|---|---|
| `whale_signal_events` (table) | NULL | NULL | **0** (vide) |
| `live_signals` source `whale_alert_ws` | 2026-03-15 10:48 | 2026-04-25 17:00 | 24 800 |
| `live_signals` source `whale_alert_api` | 2026-04-13 21:49 | 2026-04-25 17:30 | 46 991 |

### Verdict
❌ **Inutilisable** pour le backfill historique. Aucune donnée whale n'existe avant le 15 mars 2026.

---

## 3. LIVE SIGNALS — inventaire complet

| source | min_at | max_at | count |
|---|---|---|---|
| eodhd | 2026-03-15 10:00:30 | 2026-04-24 04:25:24 | 146 |
| technical_analysis | 2026-03-15 10:05:05 | 2026-04-25 17:45:02 | 138 342 |
| whale_alert_ws | 2026-03-15 10:48:12 | 2026-04-25 17:00:06 | 24 800 |
| fear_greed_index | 2026-03-15 11:00:04 | 2026-04-25 17:30:04 | 749 |
| crypto_news | 2026-03-26 22:46:05 | 2026-04-25 17:45:02 | 21 780 |
| whale_alert_api | 2026-04-13 21:49:39 | 2026-04-25 17:30:06 | 46 991 |

### Verdict
❌ Toutes les sources démarrent au plus tôt le **15 mars 2026** → couvrent ~6 semaines des 35 semaines ciblées (≈ 17 % de la fenêtre).  
Inutilisable pour l'entraînement historique. Utilisable uniquement pour la **validation walk-forward récente**.

---

## 4. AUTRES TABLES — couvertures temporelles utiles

| Table | Min | Max | Count | Pertinence |
|---|---|---|---|---|
| **market_ohlcv_raw** | **2025-06-22** | 2026-04-25 | **497 262** | ✅ critique |
| external_market_data | 2025-07-21 | 2026-04-25 | 6 096 | ✅ utile |
| historical_market_data | 2025-07-23 | 2025-11-26 | 6 471 | ⚠️ figé |
| price_data | 2026-03-11 | 2026-04-25 | 311 441 | ❌ trop court |
| crypto_news | 2026-03-26 | 2026-04-25 | 3 325 | ❌ trop court |
| whale_signal_events | — | — | 0 | ❌ vide |

### 4.1 `market_ohlcv_raw` — détail par symbole/granularité

#### Couverture 5m (la cible du dataset ML)
Tous les symboles **démarrent au 2026-03-11** sur la 5m. Donc :
- ADA-EUR : 11 004 rows 5m
- AVAX-EUR : 5 586
- BCH-EUR : 4 141
- BTC-EUR : 12 608
- DOT-EUR : 2 651
- ETH-EUR : 12 606
- LINK-EUR : 7 709
- LTC-EUR : 12 473
- SOL-EUR : N/A dans l'échantillon visible (à confirmer)

⚠️ La 5m sur 8 mois **n'existe pas dans market_ohlcv_raw**. Le dataset ML 5m juillet 2025 → mars 2026 doit déjà venir d'une autre source (export externe / archive).

#### Couverture 1h (utilisable pour features long-terme)
- BTC-EUR / ETH-EUR / SOL-EUR / ADA-EUR : **2025-06-22 → 2026-04-25** (~10 mois, ~44k rows chacun) ✅
- AVAX-EUR / DOT-EUR : 2025-10-05 → 2026-04-25
- LINK-EUR / LTC-EUR : 2025-11-21 → 2026-04-25
- BCH-EUR : 2025-12-04 → 2026-04-25

#### Couverture 24h
- Mêmes symboles principaux : 2025-06-23 → 2026-04-25 (~307 rows)

### 4.2 `external_market_data` — par type
| data_type | count | min | max |
|---|---|---|---|
| sentiment_score | **6 092** | 2025-07-21 15:48 | 2026-04-25 17:30 |
| institutional_flow | 2 | 2025-07-21 | 2025-07-21 |
| sync_test | 2 | 2025-07-21 | 2025-07-21 |

✅ `sentiment_score` couvre **toute la fenêtre cible** avec 6 092 points (~25/jour). À inspecter : granularité réelle, mapping symbole/marché, qualité.

### 4.3 `historical_market_data` (BigQuery daily)
| symbol | source | min | max | count |
|---|---|---|---|---|
| BTC-USD | bigquery | 2024-01-01 | **2025-11-26** | 1 618 |
| ETH-USD | bigquery | 2024-01-01 | 2025-11-26 | 1 618 |
| SOL-USD | bigquery | 2024-01-01 | 2025-11-26 | 1 618 |
| XRP-USD | bigquery | 2024-01-01 | 2025-11-26 | 1 617 |

⚠️ Pipeline BigQuery **gelée depuis le 26 novembre 2025**. Utilisable pour features long-historique (2024) mais ne couvre pas les 5 derniers mois.

---

## 5. Inventaire complet des tables publiques

88 tables. Catégorisation rapide :

**Marché / OHLCV / Features**  
`market_ohlcv_raw`, `market_features_v0`, `market_data_health`, `historical_market_data`, `price_data`, `price_data_with_indicators`, `price_data_archive_log`, `price_snapshots`, `external_market_data`

**Signaux**  
`live_signals`, `live_signals_normalized`, `live_signals_backup_20260327`, `signal_registry`, `signal_source_health`, `whale_signal_events`, `crypto_news`

**Décisions / outcomes**  
`decision_events`, `decision_events_legacy`, `decision_events_backup_all`, `decision_events_backup_legacy`, `decision_outcomes`, `decision_snapshots`, `trade_decisions_log`, `trade_events`, `vw_trade_decision_linkage_60m`, `v_decision_mix_24h`, `v_decisions_timeseries_24h`, `v_unexpected_reasons_24h`, `v_internal_errors_1h`, `v_defer_health_15m`

**Trading / portfolio**  
`mock_trades`, `mock_trades_backup_202602_fifo_fix`, `mock_trades_fix_audit`, `mock_coverage`, `real_trades`, `real_positions_view`, `real_trade_history_view`, `past_positions_view`, `trades`, `trading_history`, `trading_strategies`, `strategy_open_positions`, `strategy_parameters`, `strategy_performance`, `strategy_signal_weights`, `portfolio_capital`

**Calibration / IA**  
`calibration_metrics`, `calibration_suggestions`, `ai_data_categories`, `ai_data_sources`, `ai_category_performance`, `ai_knowledge_base`, `ai_learning_metrics`, `knowledge_documents`, `knowledge_embeddings`, `llm_configurations`, `conversation_history`, `data_sources`

**Exécution / on-chain**  
`execution_jobs`, `execution_locks`, `execution_holds`, `execution_circuit_breakers`, `execution_quality_log`, `execution_quality_metrics_24h`, `execution_quality_onchain_24h`, `execution_wallets`, `execution_wallets_old`, `execution_wallet_secrets`, `execution_wallet_secrets_old`, `execution_wallet_balance_snapshots`

**Custodie / wallets / dépôts**  
`coinbase_oauth_credentials`, `coinbase_sandbox_credentials`, `user_coinbase_connections`, `user_external_addresses`, `user_wallet_info`, `user_connections_safe`, `wallet_funding_requests`, `transfer_allowlist`, `deposit_attributions`, `unattributed_deposits`, `withdrawal_audit_log`

**Pool / coin states**  
`coin_pool_states`

**Auth / users**  
`profiles`, `user_roles`, `user_onboarding_status`

**Système / logs**  
`scheduler_execution_log`, `security_audit_log`

---

## 6. Recommandations d'enrichissement actionnables

### Tier 1 — exploitable immédiatement
1. **Features multi-timeframe via `market_ohlcv_raw` 1h/4h/24h**  
   Pour BTC, ETH, SOL, ADA : ~10 mois de données horaires. Construire des features par forward-fill sur la grille 5m :
   - `rsi_1h`, `rsi_4h`, `ema200_1h`, `ema200_4h`
   - `volume_zscore_1h`, `atr_4h`
   - `trend_alignment_1h_4h_24h`
2. **`external_market_data.sentiment_score`** (6 092 rows, juillet 2025+) à joindre par timestamp le plus proche sur la grille 5m. Inspecter d'abord le mapping symbole et la valeur.

### Tier 2 — à backfiller via API externes
3. **Fear & Greed Index** : `https://api.alternative.me/fng/?limit=0` (gratuit, daily) → ~280 points historiques.
4. **Crypto news / sentiment** : reprocesser via CryptoCompare News API ou GDELT pour 2025-07 → 2026-03.
5. **Whale Alert** : nécessite plan payant pour l'historique. Alternative gratuite : Glassnode (transferts on-chain agrégés) ou Etherscan/Blockchair en bulk.

### Tier 3 — à éviter pour ce dataset
- `live_signals`, `crypto_news`, `whale_signal_events`, `price_data` : démarrent tous après le 11 mars 2026 → ne couvrent qu'une fraction infime de la fenêtre.
- `historical_market_data` (BigQuery) : gelée depuis novembre 2025 → laisse un trou de 5 mois.

---

## 7. Données manquantes critiques

| Donnée | Statut | Action |
|---|---|---|
| **Bougies 5m juillet 2025 → mars 2026** | Absentes de `market_ohlcv_raw` | Vérifier les archives Storage (`price-data-archives`) ou re-backfiller depuis EODHD/Coinbase |
| F&G index 2025 | Absent | Backfill API alternative.me |
| News sentiment 2025 | Absent en DB | Backfill CryptoCompare/GDELT |
| Whale flows 2025 | Absent | Backfill Glassnode (payant) ou métriques on-chain Etherscan |

---

## Annexe — Requêtes exécutées

```sql
-- Q1 (échec)
SELECT MIN(created_at), MAX(created_at), COUNT(*) FROM fear_greed_index;

-- Q2 (recherche tables whale)
SELECT table_name FROM information_schema.tables
WHERE table_schema='public' AND table_name ILIKE '%whale%';

-- Q3 (sources live_signals)
SELECT source, MIN(created_at), MAX(created_at), COUNT(*)
FROM live_signals GROUP BY source ORDER BY MIN(created_at);

-- Q4 (toutes les tables)
SELECT table_name FROM information_schema.tables
WHERE table_schema='public' ORDER BY table_name;

-- Q5 (couvertures complémentaires)
SELECT 'whale_signal_events', MIN(created_at), MAX(created_at), COUNT(*) FROM whale_signal_events
UNION ALL SELECT 'external_market_data', MIN, MAX, COUNT FROM external_market_data
UNION ALL SELECT 'historical_market_data', MIN, MAX, COUNT FROM historical_market_data
UNION ALL SELECT 'market_ohlcv_raw', MIN(ts_utc), MAX(ts_utc), COUNT(*) FROM market_ohlcv_raw
UNION ALL SELECT 'price_data', MIN, MAX, COUNT FROM price_data
UNION ALL SELECT 'crypto_news', MIN, MAX, COUNT FROM crypto_news;

-- Q6 (détails OHLCV par symbole/granularité)
SELECT symbol, granularity, COUNT(*), MIN(ts_utc), MAX(ts_utc)
FROM market_ohlcv_raw GROUP BY symbol, granularity ORDER BY symbol, granularity;

-- Q7 (external_market_data par type)
SELECT data_type, COUNT(*), MIN(timestamp), MAX(timestamp)
FROM external_market_data GROUP BY data_type ORDER BY COUNT(*) DESC;

-- Q8 (historical_market_data par symbol/source)
SELECT symbol, source, COUNT(*), MIN(timestamp), MAX(timestamp)
FROM historical_market_data GROUP BY symbol, source ORDER BY symbol;
```
