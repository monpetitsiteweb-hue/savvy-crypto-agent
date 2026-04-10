# 🔍 Audit P&L — Trades REAL On-Chain

**Date** : 2026-04-10  
**Statut** : Lecture seule — constat architectural

---

## 1. settle_sell_trade_v2 : le P&L est BRUT (sans gas)

### Ce que fait la RPC

```sql
v_pnl := (p_sell_price - v_lot.purchase_price) * v_sold_from_lot;
```

**`profit_loss` sur `mock_trades` = P&L BRUT.** Aucune déduction de gas.

### Comment le gas est pris en compte dans le P&L final

Dans `get_portfolio_metrics` (la seule source de vérité pour l'UI portfolio) :

```sql
-- STEP 6: REAL mode only
IF p_is_test_mode = false THEN
  SELECT COALESCE(SUM(gas_cost_eth), 0) * v_eth_price
  INTO v_total_gas_eur
  FROM mock_trades
  WHERE user_id = p_user_id
    AND is_test_mode = false
    AND execution_confirmed = true
    AND gas_cost_eth IS NOT NULL;

  v_total_fees := v_total_fees + v_total_gas_eur;  -- ← ajouté aux fees globaux
END IF;
```

**⚠️ PROBLÈME** : `v_total_gas_eur` est additionné à `v_total_fees` mais **n'est PAS soustrait de `v_total_pnl`** :

```sql
v_total_pnl := v_unrealized + v_realized;  -- ← pas de déduction gas
v_portfolio_value := v_cash + v_current_value;  -- ← pas de déduction gas
```

Le gas est **affiché** dans `total_fees_eur` mais **pas déduit** du P&L total ni de la portfolio value.

### Impact

| Métrique | Gas déduit ? | Commentaire |
|----------|:---:|---|
| `total_fees_eur` | ✅ | Inclut gas converti ETH→EUR |
| `realized_pnl_eur` | ❌ | Somme brute de `realized_pnl` sur les SELLs |
| `total_pnl_eur` | ❌ | `unrealized + realized`, gas absent |
| `total_portfolio_value_eur` | ❌ | `cash + positions`, gas non déduit |

**Le P&L affiché est trop optimiste pour les trades REAL.** Le gas n'est visible que dans `total_fees_eur`.

---

## 2. real_trade_history_view : aucun P&L

### Champs de la vue

```sql
SELECT
  rt.id AS real_trade_id,
  rt.trade_id AS mock_trade_id,
  rt.cryptocurrency AS symbol,
  rt.side,
  rt.amount AS filled_quantity,
  rt.price AS effective_price,
  rt.total_value,
  rt.fees,
  rt.tx_hash,
  rt.gas_used,
  ...
```

**Champs P&L absents de la vue :**
- ❌ `profit_loss`
- ❌ `profit_loss_percentage`
- ❌ `gas_cost_eth`
- ❌ `gas_cost_eur`
- ❌ Aucun join vers les colonnes P&L de `mock_trades`

La vue est un **journal d'exécution on-chain**, pas un rapport P&L.

### Gas du BUY et du SELL

- `rt.fees` = fees rapportées par le DEX (souvent NULL pour 0x)
- `rt.gas_used` = gas units (pas converti en EUR)
- Le gas en ETH est sur `mock_trades.gas_cost_eth` (écrit par `onchain-receipts`)
- **Ni le gas du BUY ni celui du SELL ne sont dans la vue**

---

## 3. UI Performance tab : source des métriques

### PerformancePanel.tsx (onglet Strategy → Performance)

```typescript
const { data: trades } = await supabase
  .from('mock_trades')
  .select('*')
  .eq('user_id', user.id)
  .eq('strategy_id', strategyId);
  // ⚠️ PAS de filtre is_test_mode !

const winningTrades = trades.filter(t => t.profit_loss > 0).length;
const winRate = (winningTrades / totalTrades) * 100;
const totalProfitLoss = trades.reduce((sum, t) => sum + (t.profit_loss || 0), 0);
```

### Problèmes identifiés

| Problème | Gravité | Détail |
|----------|---------|--------|
| **Pas de filtre `is_test_mode`** | 🔴 CRITIQUE | Mélange trades TEST et REAL dans les mêmes métriques |
| **Inclut les BUY ouverts** (profit_loss=null) | 🟡 Moyen | Comptés dans `totalTrades` mais `profit_loss || 0` → fausse le win rate |
| **P&L brut, gas non déduit** | 🟡 Moyen | Même problème que §1 |
| **avgTradeDuration = 2.5 (hardcodé)** | 🟠 Cosmétique | Placeholder jamais implémenté |

### StrategyConfig.tsx (cards de la liste)

Même source (`mock_trades`), même problème : pas de filtre `is_test_mode`, mélange TEST+REAL.

### Sources des données

| Composant | Source | P&L type | Gas inclus ? |
|-----------|--------|----------|:---:|
| `UnifiedPortfolioDisplay` | `get_portfolio_metrics` RPC | Brut (realized) + Unrealized | Gas dans fees seulement |
| `PerformancePanel` | `mock_trades` direct | `profit_loss` brut | ❌ |
| `StrategyConfig` cards | `mock_trades` direct | `profit_loss` brut | ❌ |
| `WalletPerformanceDashboard` | Edge Function + calcul JS | Wallet delta - gas | ✅ (soustrait manuellement) |
| `real_trade_history_view` | Vue SQL | Aucun P&L | ❌ |

---

## 4. Champ `profit_loss_net` : inexistant

```
grep -r "profit_loss_net" → 0 résultats
```

**Il n'existe nulle part** : ni colonne DB, ni champ calculé, ni dans les types TypeScript.

### Options pour un P&L net

| Option | Où | Formule | Avantage |
|--------|---|---------|----------|
| **A. Colonne calculée** | `mock_trades` | `profit_loss - gas_cost_eur_buy - gas_cost_eur_sell` | Requêtable, indexable |
| **B. Vue SQL** | Nouvelle vue | JOIN BUY.gas + SELL.gas | Pas de migration sur mock_trades |
| **C. Calcul dans la RPC** | `get_portfolio_metrics` | Soustraire gas du total_pnl | Minimal, cohérent avec l'existant |
| **D. Calcul frontend** | Components | `pnl - totalGasEur` | ❌ Viole le contrat "pas de math financière côté client" |

### Recommandation : **Option C** (minimal et cohérent)

Modifier `get_portfolio_metrics` step 7 :

```sql
-- Avant (actuel)
v_total_pnl := v_unrealized + v_realized;

-- Après (fix)
v_total_pnl := v_unrealized + v_realized - v_total_gas_eur;
```

Cela corrige le P&L affiché dans le dashboard unifié sans toucher aux colonnes.

---

## 5. Récapitulatif des trous — STATUT

| # | Problème | Sévérité | Fix | Statut |
|---|----------|----------|-----|--------|
| 1 | `get_portfolio_metrics.total_pnl_eur` ne déduit pas le gas | 🔴 | Migration : `v_total_pnl := v_unrealized + v_realized - v_total_gas_eur` | ✅ APPLIQUÉ |
| 2 | `PerformancePanel` ne filtre pas `is_test_mode` | 🔴 | `.eq('is_test_mode', isTestMode)` + filtre SELLs fermés | ✅ APPLIQUÉ |
| 3 | `PerformancePanel` inclut BUY ouverts dans le comptage | 🟡 | `.eq('trade_type', 'sell').not('profit_loss', 'is', null)` | ✅ APPLIQUÉ |
| 4 | `StrategyConfig` cards mélangent TEST/REAL | 🔴 | `.eq('is_test_mode', testMode)` + filtre SELLs fermés | ✅ APPLIQUÉ |
| 5 | `real_trade_history_view` n'expose pas le P&L | 🟡 | Non traité — vue d'exécution, pas de P&L | ⏸️ DIFFÉRÉ |
| 6 | Pas de `profit_loss_net` nulle part | 🟡 | Résolu via Option C (RPC déduit gas du total_pnl) | ✅ RÉSOLU |
| 7 | `avgTradeDuration` hardcodé à 2.5h | 🟠 | Placeholder conservé | ⏸️ DIFFÉRÉ |
| 8 | `portfolio_value` et gas ETH natif | 🟡 | Risque documenté, pas de fix immédiat | ⏸️ DIFFÉRÉ |
