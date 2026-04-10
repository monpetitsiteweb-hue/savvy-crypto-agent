# 🏗️ Design — Edge Function `onchain-settlement`

**Date** : 2026-04-10  
**Statut** : Design uniquement — aucun code  
**Principe** : `onchain-receipts` = confirmateur de tx. `onchain-settlement` = comptabilité métier.

---

## 1. Interface d'appel

### Appelant

`onchain-receipts` appelle `onchain-settlement` **après** avoir mis à jour `mock_trades` avec les données on-chain (amount, price, execution_confirmed=true).

### Payload

```typescript
interface SettlementPayload {
  mockTradeId: string;      // UUID du placeholder mock_trades (BUY ou SELL)
  side: 'BUY' | 'SELL';
  symbol: string;           // ex: 'ETH'
  userId: string;           // UUID
  strategyId: string;       // UUID
  actualAmount: number;     // quantité réelle confirmée on-chain
  actualPrice: number;      // prix effectif USD
  totalValueEur: number;    // valeur totale en EUR (après conversion)
  gasCostEur: number;       // gas en EUR (pour déduire du P&L net si souhaité)
  txHash: string;           // pour traçabilité dans les logs
}
```

### Ce qui manque dans la proposition initiale

| Champ | Pourquoi nécessaire |
|-------|-------------------|
| `strategyId` | Nécessaire pour les queries FIFO (filtre par stratégie) et pour `coin_pool_states` |
| `gasCostEur` | Pour un P&L net incluant les frais de gas |
| `txHash` | Pour la traçabilité dans les logs de settlement |

### Ce qui n'est PAS nécessaire

- `is_test_mode` : toujours `false` — `onchain-settlement` ne traite que des trades REAL par définition (seuls les trades confirmés on-chain arrivent ici)

---

## 2. Idempotence

### Problème actuel

`settle_buy_trade` et `settle_sell_trade` sont de simples `UPDATE cash_balance_eur ± montant`. Aucun garde-fou contre le double-appel.

### Mécanisme proposé : champ `settlement_status` sur `mock_trades`

**Option retenue** : Ajouter une colonne `settlement_status` à `mock_trades`.

```
settlement_status ENUM:
  - NULL / 'PENDING'  → pas encore settled (état par défaut)
  - 'SETTLED'         → settlement exécuté avec succès
  - 'FAILED'          → settlement tenté mais échoué (loggé, retry possible)
```

### Logique d'idempotence dans `onchain-settlement`

```
1. SELECT settlement_status FROM mock_trades WHERE id = mockTradeId
2. Si settlement_status = 'SETTLED' → return { ok: true, skipped: true, reason: 'already_settled' }
3. Si settlement_status = 'PENDING' ou NULL → continuer
4. UPDATE mock_trades SET settlement_status = 'SETTLING' WHERE id = mockTradeId AND settlement_status IS DISTINCT FROM 'SETTLED'
   → Si 0 rows affected → race condition, un autre process a settled entre-temps → return skipped
5. Exécuter le settlement (cash, FIFO, P&L)
6. UPDATE mock_trades SET settlement_status = 'SETTLED' WHERE id = mockTradeId
```

### Alternative rejetée : table dédiée `settlement_log`

Une table `settlement_log(mock_trade_id UNIQUE, settled_at, ...)` fonctionnerait aussi, mais ajoute une jointure supplémentaire. Le champ sur `mock_trades` est plus simple et directement requêtable.

### Migration nécessaire

```sql
ALTER TABLE mock_trades ADD COLUMN settlement_status text DEFAULT NULL;
-- Valeurs possibles : NULL, 'PENDING', 'SETTLING', 'SETTLED', 'FAILED'
```

---

## 3. FIFO matching pour les SELLs

### Query FIFO

```sql
SELECT id, amount, purchase_price, purchase_value_eur, executed_at
FROM mock_trades
WHERE cryptocurrency = $symbol
  AND is_open_position = true
  AND is_test_mode = false
  AND trade_type = 'BUY'
  AND execution_confirmed = true       -- ⚠️ CRITIQUE : exclure les placeholders non confirmés
  AND user_id = $userId
  AND strategy_id = $strategyId        -- scope par stratégie
ORDER BY executed_at ASC               -- FIFO
```

### Filtre `execution_confirmed = true`

**Obligatoire.** Sans ce filtre, les ghost placeholders (amount=0, price=0) seraient inclus dans le matching FIFO, corrompant le calcul.

### Filtre `strategy_id`

**Recommandé.** Les positions sont gérées par stratégie. Un SELL sur la stratégie A ne doit pas fermer un BUY de la stratégie B.

### Gestion des lots partiels

**Scénario** : SELL 0.5 ETH, BUY ouvert de 1 ETH.

**Approche retenue : Split du lot BUY**

```
Lot BUY original : amount=1.0, is_open_position=true

Après SELL partiel de 0.5 :

1. UPDATE le lot BUY original :
   - amount = 0.5            (quantité restante)
   - is_open_position = true (reste ouvert pour le résidu)

2. INSERT un nouveau lot "fermé" (clone du BUY) :
   - amount = 0.5            (quantité vendue)
   - is_open_position = false
   - sell_price = actualPrice
   - profit_loss = (sell_price - purchase_price) × 0.5
   - profit_loss_percentage = (sell_price - purchase_price) / purchase_price × 100
   - exit_value = sell_price × 0.5
   - settlement_status = 'SETTLED'
   - original_trade_id = id du lot BUY original (traçabilité)
```

**Pourquoi split plutôt qu'ajuster ?**
- Chaque lot fermé a son propre P&L indépendant
- L'historique est complet : on peut retracer chaque vente partielle
- Compatible avec le dashboard qui affiche les trades individuels
- `profit_loss_percentage` est identique sur le lot complet et le lot partiel (même prix d'entrée)

### Algorithme FIFO complet

```
remaining_to_sell = actualAmount

FOR EACH open_buy IN fifo_query:
  IF remaining_to_sell <= 0: BREAK
  
  IF open_buy.amount <= remaining_to_sell:
    // Fermeture complète du lot
    UPDATE open_buy SET
      is_open_position = false,
      sell_price = actualPrice,
      exit_value = actualPrice × open_buy.amount,
      profit_loss = (actualPrice - open_buy.purchase_price) × open_buy.amount,
      profit_loss_percentage = (actualPrice - open_buy.purchase_price) / open_buy.purchase_price × 100,
      settlement_status = 'SETTLED'
    remaining_to_sell -= open_buy.amount
  
  ELSE:
    // Lot partiel — split
    sold_qty = remaining_to_sell
    remaining_qty = open_buy.amount - sold_qty
    
    // 1. Réduire le lot ouvert
    UPDATE open_buy SET amount = remaining_qty
    
    // 2. Insérer le lot fermé
    INSERT mock_trades (copie de open_buy) SET
      amount = sold_qty,
      is_open_position = false,
      sell_price = actualPrice,
      exit_value = actualPrice × sold_qty,
      profit_loss = (actualPrice - open_buy.purchase_price) × sold_qty,
      profit_loss_percentage = (actualPrice - open_buy.purchase_price) / open_buy.purchase_price × 100,
      settlement_status = 'SETTLED',
      original_trade_id = open_buy.id
    
    remaining_to_sell = 0

IF remaining_to_sell > 0:
  // Cas d'erreur — voir section 5
```

---

## 4. Calcul du P&L

### Champs existants sur `mock_trades`

| Champ | Existe ? | Type |
|-------|---------|------|
| `profit_loss` | ✅ Oui | numeric, nullable |
| `profit_loss_percentage` | ✅ Oui | numeric, nullable |
| `sell_price` | ✅ Oui | numeric, nullable |
| `exit_value` | ✅ Oui | numeric, nullable |

**Aucune migration nécessaire pour le P&L.** Les colonnes existent déjà.

### Formules

```
profit_loss = (sell_price - purchase_price) × amount_sold
profit_loss_percentage = ((sell_price - purchase_price) / purchase_price) × 100
exit_value = sell_price × amount_sold
```

### P&L net (avec gas)

Le `gasCostEur` est stocké séparément sur le trade SELL (`mock_trades.gas_cost_eur`). Le P&L calculé ci-dessus est **brut** (hors gas). Le P&L net peut être calculé côté frontend :

```
pnl_net = profit_loss - gas_cost_eur_buy - gas_cost_eur_sell
```

**Recommandation** : Ne pas intégrer le gas dans `profit_loss` pour garder la cohérence avec le mode MOCK qui n'a pas de gas.

### Migration nécessaire

Seule migration : `settlement_status` (voir section 2). Pas de nouvelle colonne pour le P&L.

---

## 5. Gestion des erreurs

### Cas 1 : FIFO ne trouve aucun BUY ouvert

**Scénario** : SELL confirmé on-chain mais aucun `mock_trades` BUY ouvert pour ce symbole.

**Comportement proposé** :
1. Logger un warning SEV-1 dans les Edge Function logs
2. Créditer quand même `portfolio_capital.cash_balance_eur` (les tokens ont été vendus on-chain, le cash DOIT être comptabilisé)
3. Marquer le trade SELL avec `settlement_status = 'SETTLED_NO_FIFO'`
4. Insérer un événement dans `decision_events` avec `reason: 'settlement_orphan_sell'` pour audit

**Justification** : Bloquer le settlement serait pire — le cash on-chain existe, ne pas le refléter dans le ledger crée une divergence croissante.

### Cas 2 : remaining_to_sell > 0 après épuisement des lots

**Scénario** : SELL 1.0 ETH mais les BUY ouverts ne totalisent que 0.8 ETH.

**Comportement** : Identique au cas 1 pour la portion orpheline (0.2 ETH). Fermer les 0.8 ETH de BUY trouvés normalement, logger le delta.

### Cas 3 : settle_buy_trade / settle_sell_trade échoue

**Comportement** :
1. Marquer `settlement_status = 'FAILED'`
2. Logger l'erreur avec le détail
3. Retourner `{ ok: false, error: 'cash_settlement_failed' }`
4. `onchain-receipts` reçoit l'échec → log mais ne retry pas (retry sera via cron futur)

### Cas 4 : mock_trades introuvable

**Scénario** : `mockTradeId` ne correspond à aucune ligne.

**Comportement** : Return `{ ok: false, error: 'mock_trade_not_found' }`. Log SEV-1.

---

## 6. Appel depuis onchain-receipts

### Option A : Appel synchrone (await)

```
onchain-receipts confirme tx
  → await fetch('onchain-settlement', payload)
  → si succès → return { confirmed: true, settled: true }
  → si échec → return { confirmed: true, settled: false }
```

**Avantages** :
- Le caller sait immédiatement si le settlement a réussi
- Pas de trade "confirmé mais non settled" invisible

**Inconvénients** :
- Augmente la latence de `onchain-receipts` (~200-500ms supplémentaires)
- Si `onchain-settlement` timeout, `onchain-receipts` timeout aussi

### Option B : Fire-and-forget

```
onchain-receipts confirme tx
  → fetch('onchain-settlement', payload)  // no await
  → return { confirmed: true, settled: 'pending' }
```

**Avantages** :
- `onchain-receipts` reste rapide
- Découplage

**Inconvénients** :
- Si le fetch échoue silencieusement → trade confirmé mais jamais settled (même problème que P7 actuel)
- Nécessite un cron de rattrapage

### Recommandation : **Appel synchrone (Option A)**

**Justification** :
- `onchain-receipts` est déjà un processus asynchrone (déclenché en fire-and-forget par `onchain-sign-and-send`). Il n'y a pas de user qui attend sa réponse.
- Ajouter 200-500ms à un process qui poll déjà la blockchain pendant plusieurs secondes est négligeable.
- L'appel synchrone garantit que tout trade confirmé est aussi settled, éliminant le besoin d'un cron de rattrapage.
- Si `onchain-settlement` fail, `onchain-receipts` peut logger proprement et le `settlement_status = 'FAILED'` permet un retry manuel ou via cron ultérieur.

---

## 7. Structure de la Edge Function

### Fichiers

```
supabase/functions/onchain-settlement/
  └── index.ts              # Point d'entrée unique
```

### Dépendances `_shared/`

| Module | Usage |
|--------|-------|
| Aucun nouveau | Les imports Supabase client suffisent. Pas besoin de `signer.ts` ni de crypto. |

### Tables lues

| Table | Opération | Raison |
|-------|-----------|--------|
| `mock_trades` | SELECT | Vérifier `settlement_status` (idempotence) |
| `mock_trades` | SELECT | FIFO query (lots BUY ouverts pour le symbole) |

### Tables écrites

| Table | Opération | Raison |
|-------|-----------|--------|
| `mock_trades` | UPDATE | `settlement_status = 'SETTLED'` sur le placeholder appelant |
| `mock_trades` | UPDATE | Fermer les lots BUY (`is_open_position=false`, `sell_price`, `profit_loss`, etc.) |
| `mock_trades` | UPDATE | Réduire `amount` sur lot BUY en cas de split partiel |
| `mock_trades` | INSERT | Insérer le lot fermé en cas de split partiel |
| `decision_events` | INSERT | Logger les cas orphelins (sell sans BUY correspondant) |

### RPCs appelées

| RPC | Quand |
|-----|-------|
| `settle_buy_trade(p_user_id, p_actual_spent, p_reserved_amount, p_is_test_mode)` | Après confirmation BUY |
| `settle_sell_trade(p_user_id, p_proceeds, p_is_test_mode)` | Après confirmation SELL |

### Flow complet

```
POST /onchain-settlement
  │
  ├─ Valider le payload (Zod)
  ├─ Vérifier idempotence (settlement_status != 'SETTLED')
  │
  ├─ Si side = 'BUY' :
  │   ├─ UPDATE mock_trades SET settlement_status = 'SETTLED'
  │   ├─ RPC settle_buy_trade(userId, totalValueEur, totalValueEur, false)
  │   └─ Return { ok: true, side: 'BUY', settled: true }
  │
  └─ Si side = 'SELL' :
      ├─ FIFO query : lots BUY ouverts pour ce symbole
      ├─ Boucle FIFO :
      │   ├─ Fermeture complète ou split partiel
      │   ├─ Calcul P&L par lot
      │   └─ UPDATE/INSERT mock_trades
      ├─ UPDATE mock_trades (SELL) SET settlement_status = 'SETTLED'
      ├─ RPC settle_sell_trade(userId, totalValueEur, false)
      └─ Return { ok: true, side: 'SELL', settled: true, lots_closed: N }
```

---

## 8. Récapitulatif des migrations nécessaires

| Migration | Table | Détail |
|-----------|-------|--------|
| Ajouter `settlement_status` | `mock_trades` | `text DEFAULT NULL` — valeurs : NULL, PENDING, SETTLING, SETTLED, FAILED, SETTLED_NO_FIFO |

**C'est la seule migration.** Tous les autres champs (`profit_loss`, `sell_price`, `exit_value`, `profit_loss_percentage`) existent déjà.

---

## 9. Risques et points d'attention

| Risque | Mitigation |
|--------|-----------|
| Race condition : deux appels settlement en parallèle pour le même trade | Guard par `settlement_status` + UPDATE conditionnel (0 rows = skip) |
| Lot BUY splitté crée un doublon dans l'historique | Le lot splitté porte `original_trade_id` pour le distinguer. Le frontend devra filtrer/grouper. |
| `settle_buy_trade` / `settle_sell_trade` non idempotentes | Le guard `settlement_status` en amont empêche le double-appel. Les RPCs elles-mêmes ne sont pas modifiées. |
| SELL orphelin (pas de BUY à fermer) | Cash crédité quand même + log d'audit. Ne pas bloquer le settlement. |
| `onchain-receipts` → `onchain-settlement` échoue | `settlement_status = 'FAILED'` → retry possible via cron ou manuellement |
