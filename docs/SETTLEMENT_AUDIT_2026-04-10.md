# 🔍 Audit complémentaire — Settlement pipeline REAL

**Date** : 2026-04-10  
**Statut** : Lecture seule — aucun fix appliqué  
**Scope** : `onchain-receipts` post-confirmation + RPCs `settle_buy_trade` / `settle_sell_trade` + FIFO closing

---

## 1. onchain-receipts — après confirmation d'un BUY

### Champs mis à jour sur `mock_trades` (liste exhaustive)

**Fichier** : `supabase/functions/onchain-receipts/index.ts`, ~L574-610

```javascript
const { error: updateError } = await supabase
  .from('mock_trades')
  .update({
    amount: decodedAmountOut,           // quantité de tokens reçue (décodée des logs Transfer)
    purchase_price: effectivePrice,     // prix effectif = totalValue / decodedAmountOut
    purchase_value_eur: totalValueEur,  // valeur en EUR (via taux EUR/USD)
    execution_confirmed: true,          // ✅ marqué confirmé
    execution_ts: new Date().toISOString(),
    tx_hash: txHash,
    chain_id: chainId,
    gas_cost_eth: gasUsedEth,
    gas_cost_eur: gasCostEur,
    fees: gasCostEur,
    execution_source: 'onchain_confirmed',
    execution_mode: 'REAL'
  })
  .eq('id', mockTradeId);
```

### Ce qui N'EST PAS mis à jour pour un BUY

| Champ | Valeur actuelle | Valeur attendue | Impact |
|-------|----------------|-----------------|--------|
| `is_open_position` | Déjà `true` (set par le placeholder) | `true` | ✅ OK par accident — le placeholder le met à `true` dès l'insertion |
| `purchase_price` | ✅ Rempli par `effectivePrice` | — | OK |
| `amount` | ✅ Rempli par `decodedAmountOut` | — | OK |

**Verdict BUY** : Les champs critiques (`amount`, `purchase_price`, `execution_confirmed`) sont correctement remplis. `is_open_position` est déjà `true` depuis le placeholder. **Le BUY est fonctionnel** dans `onchain-receipts`.

### Ce qui manque après un BUY

- ❌ `settle_buy_trade()` n'est PAS appelé → `portfolio_capital.cash_balance_eur` n'est pas débité
- ❌ `coin_pool_states` n'est pas mis à jour
- ❌ `reserved_eur` n'est pas libéré

---

## 2. onchain-receipts — après confirmation d'un SELL

### Champs mis à jour sur `mock_trades` (liste exhaustive)

Le même bloc de code est utilisé pour BUY et SELL. Il n'y a **aucune distinction de side** dans la logique de mise à jour :

```javascript
// Même update que pour BUY — pas de branchement sur side
.update({
  amount: decodedAmountOut,
  purchase_price: effectivePrice,   // ⚠️ Pour un SELL, c'est le prix de VENTE, pas d'achat
  purchase_value_eur: totalValueEur,
  execution_confirmed: true,
  execution_ts: new Date().toISOString(),
  tx_hash: txHash,
  chain_id: chainId,
  gas_cost_eth: gasUsedEth,
  gas_cost_eur: gasCostEur,
  fees: gasCostEur,
  execution_source: 'onchain_confirmed',
  execution_mode: 'REAL'
})
```

### Ce qui N'EST PAS fait pour un SELL

| Action manquante | Impact |
|-----------------|--------|
| `is_open_position = false` sur le trade BUY d'origine | La position BUY reste "ouverte" indéfiniment dans le ledger |
| Identification du BUY à fermer (FIFO) | Aucune logique FIFO — le SELL ne sait pas quel BUY il clôture |
| `sell_price` sur le trade BUY | Non rempli → P&L impossible à calculer |
| `profit_loss` sur le trade BUY | Non calculé |
| `profit_loss_percentage` sur le trade BUY | Non calculé |
| `exit_value` sur le trade BUY | Non rempli |
| `settle_sell_trade()` | Non appelé → `portfolio_capital.cash_balance_eur` n'est pas crédité |

### Comment `onchain-receipts` identifie le trade à mettre à jour

Il utilise **uniquement** le `mockTradeId` passé en paramètre :

```javascript
// Le mockTradeId est celui du SELL placeholder inséré par le coordinator
.eq('id', mockTradeId)
```

Il met à jour **le placeholder SELL**, pas le trade BUY d'origine. Il n'y a **aucune référence** au trade BUY correspondant (`original_trade_id` n'est jamais utilisé dans `onchain-receipts`).

**Verdict SELL** : Le SELL est confirmé on-chain mais la position BUY n'est jamais fermée. Le P&L n'est jamais calculé. Le cash n'est jamais crédité.

---

## 3. RPCs settle_buy_trade et settle_sell_trade

### 3.1 settle_buy_trade — signature exacte

```sql
CREATE OR REPLACE FUNCTION public.settle_buy_trade(
  p_user_id UUID,
  p_actual_spent NUMERIC,
  p_reserved_amount NUMERIC,
  p_is_test_mode BOOLEAN
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE portfolio_capital
  SET
    cash_balance_eur = cash_balance_eur - p_actual_spent,
    reserved_eur = GREATEST(reserved_eur - p_reserved_amount, 0),
    updated_at = now()
  WHERE user_id = p_user_id
    AND is_test_mode = p_is_test_mode;
END;
$$;
```

**Analyse** :
- ✅ Débite `cash_balance_eur` du montant réellement dépensé
- ✅ Libère `reserved_eur`
- ❌ **Non idempotent** : pas de `trade_id` en paramètre, pas de guard contre double-appel. Appeler 2× = double débit.
- ❌ Pas de vérification que `cash_balance_eur` reste ≥ 0

### 3.2 settle_sell_trade — signature exacte

```sql
CREATE OR REPLACE FUNCTION public.settle_sell_trade(
  p_user_id UUID,
  p_proceeds NUMERIC,
  p_is_test_mode BOOLEAN
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE portfolio_capital
  SET
    cash_balance_eur = cash_balance_eur + p_proceeds,
    updated_at = now()
  WHERE user_id = p_user_id
    AND is_test_mode = p_is_test_mode;
END;
$$;
```

**Analyse** :
- ✅ Crédite `cash_balance_eur` du produit de vente
- ❌ **Non idempotent** : même problème que `settle_buy_trade`
- ❌ Ne fait AUCUNE opération de clôture de position (pas de `is_open_position = false`, pas de P&L)

### 3.3 Qui les appelle aujourd'hui ?

**Personne dans le chemin automated REAL.** Ces RPCs sont appelées uniquement dans le chemin MOCK via `executeTradeDirectly()` dans le coordinator :

```javascript
// ~L5200 dans trading-decision-coordinator
await supabase.rpc('settle_buy_trade', {
  p_user_id: userId,
  p_actual_spent: eurAmount,
  p_reserved_amount: eurAmount,
  p_is_test_mode: true   // ← hardcodé MOCK
});
```

Le chemin REAL automated (L3572-3883) n'appelle **jamais** ces RPCs.

---

## 4. FIFO closing pour trades REAL — existe-t-il ?

### Réponse : NON — complètement absent

#### 4.1 Logique FIFO existante (MOCK uniquement)

La logique FIFO existe dans deux endroits, **tous deux hardcodés pour MOCK** :

**a) Per-lot SELL path dans `executeTradeOrder()` (~L7801)**

```javascript
const { data: openLots } = await supabase
  .from('mock_trades')
  .select('*')
  .eq('cryptocurrency', symbol)
  .eq('is_open_position', true)
  .eq('trade_type', 'BUY')
  .eq('is_test_mode', true)     // ← hardcodé true → ne trouvera JAMAIS un trade REAL
  .eq('user_id', userId)
  .order('executed_at', { ascending: true }); // FIFO
```

**b) Trigger `mt_on_sell_snapshot` sur `mock_trades`**

Ce trigger PostgreSQL se déclenche sur INSERT d'un SELL mais :
- Il ne fait que copier un snapshot, pas de clôture de position
- Il ne modifie pas `is_open_position` sur le BUY d'origine

#### 4.2 Ce qu'il faudrait pour le REAL

Pour que le FIFO fonctionne en REAL, il faudrait :

1. Après confirmation SELL dans `onchain-receipts` :
   - Identifier les BUY REAL ouverts pour le même symbole (`is_open_position = true`, `is_test_mode = false`)
   - Les trier par `executed_at` ASC (FIFO)
   - Fermer les lots correspondants (`is_open_position = false`)
   - Calculer `profit_loss` = `(sell_price - purchase_price) × amount`
   - Calculer `profit_loss_percentage` = `(sell_price - purchase_price) / purchase_price × 100`
   - Remplir `sell_price`, `exit_value` sur le trade BUY
   - Gérer les lots partiels (si SELL amount < BUY amount → split)

2. Appeler `settle_sell_trade()` avec le produit réel de la vente

3. Rendre le tout idempotent (vérifier si déjà clôturé)

**Aucune de ces étapes n'existe aujourd'hui pour le chemin REAL.**

---

## 5. Synthèse — État du settlement pipeline REAL

```
BUY on-chain confirmé
  ├─ mock_trades.amount           ✅ rempli
  ├─ mock_trades.purchase_price   ✅ rempli
  ├─ mock_trades.execution_confirmed  ✅ true
  ├─ mock_trades.is_open_position     ✅ true (par accident, via placeholder)
  ├─ portfolio_capital.cash_balance_eur  ❌ NON débité
  ├─ portfolio_capital.reserved_eur      ❌ NON libéré
  ├─ coin_pool_states                    ❌ NON mis à jour
  └─ settle_buy_trade()                  ❌ NON appelé

SELL on-chain confirmé
  ├─ mock_trades (SELL placeholder)
  │   ├─ amount                   ✅ rempli (mais c'est le SELL, pas le BUY)
  │   ├─ execution_confirmed      ✅ true
  │   └─ purchase_price           ⚠️ contient le prix de VENTE (sémantique incorrecte)
  ├─ mock_trades (BUY d'origine)
  │   ├─ is_open_position         ❌ reste true → position jamais fermée
  │   ├─ sell_price               ❌ NON rempli
  │   ├─ profit_loss              ❌ NON calculé
  │   └─ profit_loss_percentage   ❌ NON calculé
  ├─ portfolio_capital.cash_balance_eur  ❌ NON crédité
  ├─ FIFO lot matching                   ❌ INEXISTANT en REAL
  └─ settle_sell_trade()                 ❌ NON appelé
```

---

## 6. Risques concrets en production LIVE

| Scénario | Conséquence |
|----------|-------------|
| BUY REAL confirmé | Tokens reçus on-chain, cash_balance_eur inchangé → l'engine croit avoir encore le capital → peut re-BUY |
| SELL REAL confirmé | Tokens vendus on-chain, position BUY reste "ouverte" → l'engine peut tenter un 2e SELL sur la même position |
| Accumulation de BUY sans settlement | cash_balance_eur figé à la valeur initiale (ex: 1000€) même après avoir dépensé 800€ |
| SELL sans FIFO | Aucun P&L calculé → onglet Performance vide, historique sans profit/perte |
| Double appel settle_* (si implémenté naïvement) | Double débit/crédit sur cash_balance_eur (RPCs non idempotentes) |
