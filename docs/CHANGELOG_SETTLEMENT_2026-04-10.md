# 📋 Changelog — Settlement Pipeline REAL

**Date** : 2026-04-10  
**Scope** : Migration DB + Edge Function `onchain-settlement` + documentation

---

## 1. Migration DB : `add_settlement_pipeline.sql`

### 1.1 Colonnes ajoutées sur `mock_trades`

| Colonne | Type | Default | Rôle |
|---------|------|---------|------|
| `settlement_status` | `text` | `NULL` | État du settlement : `NULL`, `SETTLING`, `SETTLED`, `FAILED`, `SETTLED_NO_FIFO` |
| `original_trade_id` | `uuid` | `NULL` | Référence au lot BUY parent en cas de split partiel |

### 1.2 Index créés

| Nom | Table | Colonnes | Condition partielle |
|-----|-------|----------|-------------------|
| `idx_mock_trades_settlement_status` | `mock_trades` | `settlement_status` | `WHERE settlement_status IS NOT NULL` |
| `idx_mock_trades_original_trade_id` | `mock_trades` | `original_trade_id` | `WHERE original_trade_id IS NOT NULL` |
| `idx_mock_trades_fifo_real` | `mock_trades` | `user_id, strategy_id, cryptocurrency, executed_at ASC` | `WHERE is_open_position = true AND is_test_mode = false AND trade_type = 'BUY' AND execution_confirmed = true` |

### 1.3 RPC `settle_buy_trade_v2` — CRÉÉE

**Fichier** : Migration SQL (pas de fichier séparé — fonction PostgreSQL)

**Signature** :
```sql
settle_buy_trade_v2(
  p_mock_trade_id UUID,
  p_user_id UUID,
  p_actual_spent_eur NUMERIC,
  p_reserved_amount NUMERIC
) RETURNS jsonb
```

**Propriétés** : `SECURITY DEFINER`, `SET search_path = public`

**Logique** :
1. `SELECT settlement_status FROM mock_trades WHERE id = p_mock_trade_id FOR UPDATE` — lock + guard idempotence
2. Si `SETTLED` → return `{ ok: true, skipped: true }`
3. `SELECT cash_balance_eur, reserved_eur FROM portfolio_capital WHERE user_id = p_user_id AND is_test_mode = false FOR UPDATE`
4. Calcul du `v_release_amount` via formule safe : `LEAST(v_reserved, GREATEST(p_reserved_amount, v_reserved - (v_cash - p_actual_spent_eur)))`
5. `UPDATE portfolio_capital SET cash_balance_eur -= p_actual_spent_eur, reserved_eur -= v_release_amount`
6. `UPDATE mock_trades SET settlement_status = 'SETTLED'`
7. Return `{ ok: true, skipped: false, debited_eur: p_actual_spent_eur }`

**Tables lues** : `mock_trades`, `portfolio_capital`  
**Tables écrites** : `mock_trades` (settlement_status), `portfolio_capital` (cash_balance_eur, reserved_eur)

### 1.4 RPC `settle_sell_trade_v2` — CRÉÉE

**Signature** :
```sql
settle_sell_trade_v2(
  p_mock_trade_id UUID,
  p_user_id UUID,
  p_strategy_id UUID,
  p_symbol TEXT,
  p_sold_qty NUMERIC,
  p_sell_price NUMERIC,
  p_proceeds_eur NUMERIC
) RETURNS jsonb
```

**Propriétés** : `SECURITY DEFINER`, `SET search_path = public`

**Logique** :
1. Guard idempotence identique au BUY (`FOR UPDATE` + check `SETTLED`/`SETTLED_NO_FIFO`)
2. Boucle FIFO sur les lots BUY ouverts :
   ```sql
   SELECT ... FROM mock_trades
   WHERE cryptocurrency = p_symbol AND is_open_position = true
     AND is_test_mode = false AND trade_type = 'BUY'
     AND execution_confirmed = true
     AND user_id = p_user_id AND strategy_id = p_strategy_id
   ORDER BY executed_at ASC FOR UPDATE
   ```
3. Pour chaque lot :
   - **Fermeture complète** (si `lot.amount <= remaining`) :
     - `UPDATE mock_trades SET is_open_position = false, sell_price, exit_value, profit_loss, profit_loss_percentage, settlement_status = 'SETTLED'`
   - **Split partiel** (si `lot.amount > remaining`) :
     - `UPDATE mock_trades SET amount = amount - sold_qty` (réduit le lot ouvert)
     - `INSERT mock_trades` (nouveau lot fermé avec `original_trade_id = lot.id`)
4. `UPDATE portfolio_capital SET cash_balance_eur += p_proceeds_eur`
5. `UPDATE mock_trades SET settlement_status = 'SETTLED'` (ou `'SETTLED_NO_FIFO'` si aucun lot trouvé) sur le placeholder SELL
6. Return `{ ok, lots_closed, lots_split, total_pnl_eur, orphan_qty, credited_eur }`

**Tables lues** : `mock_trades` (placeholder SELL + lots BUY ouverts), `portfolio_capital`  
**Tables écrites** : `mock_trades` (fermeture lots, split, settlement_status), `portfolio_capital` (cash_balance_eur)

### 1.5 Permissions

```sql
GRANT EXECUTE ON settle_buy_trade_v2  TO authenticated, service_role;
GRANT EXECUTE ON settle_sell_trade_v2 TO authenticated, service_role;
```

### 1.6 Ce qui N'A PAS été modifié

- Aucune colonne existante de `mock_trades` n'a été modifiée ou supprimée
- Les RPCs existantes `settle_buy_trade` et `settle_sell_trade` (v1) sont **intactes**
- Aucune table autre que `mock_trades` n'a été modifiée structurellement
- Aucune policy RLS n'a été ajoutée ou modifiée

---

## 2. Edge Function `onchain-settlement` — CRÉÉE

### Fichier créé

```
supabase/functions/onchain-settlement/index.ts
```

**~190 lignes**

### Comportement

Dispatcher stateless — aucune logique métier. Toute la logique est dans les RPCs PostgreSQL.

### Endpoint

```
POST /onchain-settlement
Authorization: Bearer <SERVICE_ROLE_KEY>
```

### Payload attendu

```typescript
{
  mockTradeId: string,    // UUID du placeholder mock_trades
  side: 'BUY' | 'SELL',
  symbol: string,
  userId: string,
  strategyId: string,
  actualAmount: number,
  actualPrice: number,
  totalValueEur: number,
  gasCostEur: number,
  txHash: string
}
```

### Flow interne

```
1. Vérification auth : Bearer token === SUPABASE_SERVICE_ROLE_KEY
   → sinon 401

2. Parse JSON body
   → si invalide : 400

3. Validation des 10 champs obligatoires
   → si manquant : 400 avec liste des champs

4. Validation side === 'BUY' || 'SELL'
   → sinon : 400

5. Si BUY :
   → supabase.rpc('settle_buy_trade_v2', {
       p_mock_trade_id, p_user_id, p_actual_spent_eur, p_reserved_amount
     })
   → Return { ok, side: 'BUY', settled, skipped, debited_eur }

6. Si SELL :
   → supabase.rpc('settle_sell_trade_v2', {
       p_mock_trade_id, p_user_id, p_strategy_id, p_symbol,
       p_sold_qty, p_sell_price, p_proceeds_eur
     })
   → Return { ok, side: 'SELL', settled, skipped, lots_closed, lots_split,
              total_pnl_eur, orphan_qty, credited_eur }
```

### Logs émis

| Log | Condition |
|-----|-----------|
| `🏦 [settlement] BUY settlement started { mockTradeId, userId, totalValueEur, txHash }` | Toujours (BUY) |
| `✅ [settlement] BUY settled { mockTradeId, debited_eur }` | BUY réussi |
| `⏭️ [settlement] BUY already settled — skipped` | Idempotence (déjà SETTLED) |
| `🏦 [settlement] SELL settlement started { mockTradeId, userId, symbol, actualAmount, actualPrice, txHash }` | Toujours (SELL) |
| `✅ [settlement] SELL settled { mockTradeId, lots_closed, lots_split, total_pnl_eur, orphan_qty, credited_eur }` | SELL réussi |
| `⚠️ [settlement] SELL orphan detected { mockTradeId, orphan_qty, symbol }` | orphan_qty > 0 |
| `⏭️ [settlement] SELL already settled — skipped` | Idempotence |
| `❌ [settlement] Settlement failed { mockTradeId, side, error, txHash }` | Erreur RPC |
| `❌ [settlement] Unexpected error { mockTradeId, side, error, txHash }` | Exception non gérée |

### Ce qui N'A PAS été fait

- **Aucune autre Edge Function n'a été modifiée** (`onchain-receipts`, `onchain-sign-and-send`, `trading-decision-coordinator`, `backend-shadow-engine` — tous intacts)
- **Aucun fichier frontend n'a été touché**
- **Aucun fichier `_shared/` n'a été modifié ou créé**

---

## 3. Documentation mise à jour

### Fichier modifié : `docs/ENGINE_ONCHAIN_CONNECTION.md`

#### Section 1 — Flux complet (lignes 8-46)

**AVANT** :
```
onchain-sign-and-send
   └─ Résultat: { ok, tx_hash, tradeId }
```

**APRÈS** :
```
onchain-sign-and-send
   └─ fetch onchain-receipts (synchrone)

onchain-receipts
   ├─ Poll tx receipt via RPC
   ├─ Decode Transfer logs
   ├─ UPDATE mock_trades (amount, price, execution_confirmed=true)
   └─ fetch onchain-settlement (synchrone)  ← NOUVEAU

onchain-settlement                          ← NOUVEAU
   ├─ Si BUY → RPC settle_buy_trade_v2
   └─ Si SELL → RPC settle_sell_trade_v2
       ├─ FIFO matching
       ├─ Fermeture lots + split partiel
       ├─ cash_balance_eur += proceeds
       └─ settlement_status = 'SETTLED'
```

#### Section 6 — Logs à surveiller (lignes 153-200)

**AJOUTÉ** : Nouvelle sous-section "Settlement logs (onchain-settlement)" avec :
- Table des logs émis par `onchain-settlement`
- 3 queries SQL de monitoring :
  - Trades settled avec succès
  - Trades en échec de settlement
  - Lots splités (ventes partielles)

### Ce qui N'A PAS été modifié dans la documentation

- Sections 2 à 5 de `ENGINE_ONCHAIN_CONNECTION.md` — intactes
- Section 7 (différences System Operator) — intacte
- `docs/LIVE_PIPELINE_AUDIT_2026-04-10.md` — intact
- `docs/SETTLEMENT_AUDIT_2026-04-10.md` — intact
- `docs/DESIGN_ONCHAIN_SETTLEMENT_2026-04-10.md` — intact
- `docs/SELL_INTELLIGENT_REAL_TRACE_2026-04-10.md` — intact

---

## 4. Fichiers créés dans cette session (récapitulatif)

| Fichier | Action | Taille |
|---------|--------|--------|
| `supabase/functions/onchain-settlement/index.ts` | **CRÉÉ** | ~190 lignes |
| `supabase/migrations/[timestamp]_add_settlement_pipeline.sql` | **CRÉÉ** (migration) | ~170 lignes SQL |
| `docs/CHANGELOG_SETTLEMENT_2026-04-10.md` | **CRÉÉ** (ce fichier) | — |

## 5. Fichiers modifiés dans cette session

| Fichier | Lignes modifiées | Nature |
|---------|-----------------|--------|
| `docs/ENGINE_ONCHAIN_CONNECTION.md` | L8-46 (flux), L153-200 (logs) | Ajout `onchain-settlement` dans le flux + queries monitoring |

## 6. ÉTAPE 3 — Intégration onchain-receipts → onchain-settlement

### Fichier modifié : `supabase/functions/onchain-receipts/index.ts`

#### Bloc ajouté : lignes ~848-912 (après le bloc real_trades try/catch, avant la fermeture du `if (txSuccess && user_id && strategy_id)`)

**AVANT** (ligne 846) :
```
    } // fin du bloc if (txSuccess && user_id && strategy_id)
```

**APRÈS** — Nouveau bloc "PHASE 4: SETTLEMENT" inséré entre la fin du real_trades try/catch et la fermeture du if :

```typescript
    // PHASE 4: SETTLEMENT — appel synchrone à onchain-settlement
    if (mockTradeId) {
      const settlementPayload = {
        mockTradeId, side, symbol, userId: user_id, strategyId: strategy_id,
        actualAmount: filledAmount, actualPrice: executedPrice,
        totalValueEur: totalValue, gasCostEur: gasCostEth, txHash: tx_hash,
      };
      // fetch POST → onchain-settlement avec Bearer SERVICE_ROLE
      // Si ok: true → log ✅
      // Si ok: false ou fetch error → log ❌ SEV-1 mais NE PAS throw
    }
```

**Comportement** :
- Appel **synchrone** (await) à `onchain-settlement` via `fetch`
- Auth : `Bearer ${SERVICE_ROLE}` (même service_role que le client Supabase)
- Si `mockTradeId` est null (échec d'insert/update) → skip avec warning
- Si settlement retourne `ok: false` → log SEV-1, **ne throw pas**
- Si fetch échoue (timeout/réseau) → catch, log SEV-1, **ne throw pas**
- Le trade on-chain est confirmé indépendamment du résultat du settlement

**Logs émis** :
| Log | Condition |
|-----|-----------|
| `📤 [receipts] Calling onchain-settlement { mockTradeId, side, txHash }` | Toujours (si mockTradeId existe) |
| `✅ [receipts] Settlement confirmed { mockTradeId, side, result }` | Settlement réussi |
| `❌ [receipts] Settlement failed — manual intervention required { ... }` | Settlement échoué (RPC error ou fetch error) |
| `⚠️ [receipts] No mockTradeId available — skipping settlement call` | Pas de mockTradeId |

### Ce qui N'A PAS été modifié

- Aucune ligne existante de `onchain-receipts` n'a été modifiée ou supprimée
- Le bloc a été **inséré** entre deux blocs existants
- Aucune autre Edge Function touchée
- Aucun fichier frontend touché

---

## 7. ÉTAPE 4 — Fixes guards (P1, P2, P3, P4)

### FIX P1 — fetchOpenPositions : exclure placeholders non confirmés

**Fichier** : `supabase/functions/backend-shadow-engine/index.ts` L1494-1501

**AVANT** :
```typescript
.eq('is_test_mode', BACKEND_ENGINE_MODE !== 'LIVE')
.order('executed_at', { ascending: true })
```

**APRÈS** :
```typescript
.eq('is_test_mode', BACKEND_ENGINE_MODE !== 'LIVE')
.eq('execution_confirmed', true)
.order('executed_at', { ascending: true })
```

**Impact** : Les placeholders (amount=0, price=0) ne corrompent plus les calculs de position.

### FIX P2 — detectConflicts : filtre is_test_mode sur query d'exposition

**Fichier** : `supabase/functions/trading-decision-coordinator/index.ts` L6072-6078

**AVANT** :
```typescript
const { data: allTrades, error: tradesQueryError } = await supabaseClient
  .from("mock_trades")
  .select("cryptocurrency, amount, price, trade_type")
  .eq("user_id", intent.userId)
  .eq("strategy_id", intent.strategyId)
  .in("trade_type", ["buy", "sell"])
```

**APRÈS** :
```typescript
const canonicalIsTestMode = strategyConfig?.canonicalIsTestMode ?? true;
const { data: allTrades, error: tradesQueryError } = await supabaseClient
  .from("mock_trades")
  .select("cryptocurrency, amount, price, trade_type")
  .eq("user_id", intent.userId)
  .eq("strategy_id", intent.strategyId)
  .eq("is_test_mode", canonicalIsTestMode)
  .in("trade_type", ["buy", "sell"])
```

**Impact** : Les mock trades TEST historiques ne bloquent plus les BUY REAL légitimes.

### FIX P3 — maxLotsPerSymbol : filtre is_test_mode sur query de comptage

**Fichier** : `supabase/functions/trading-decision-coordinator/index.ts` L6474-6481

**AVANT** :
```typescript
.eq("user_id", intent.userId)
.eq("strategy_id", intent.strategyId)
.in("cryptocurrency", symbolVariants)
.eq("trade_type", "buy")
.eq("is_open_position", true);
```

**APRÈS** :
```typescript
.eq("user_id", intent.userId)
.eq("strategy_id", intent.strategyId)
.eq("is_test_mode", canonicalIsTestMode)
.in("cryptocurrency", symbolVariants)
.eq("trade_type", "buy")
.eq("is_open_position", true);
```

**Impact** : Le comptage des lots ouverts respecte l'isolation TEST/REAL.

### FIX P4 — Cleanup ghost placeholder en cas d'échec on-chain

**Fichier** : `supabase/functions/trading-decision-coordinator/index.ts` L3783 (catch block)

**AVANT** : Aucun cleanup — le placeholder restait avec `execution_confirmed=false`, `is_open_position=true`.

**APRÈS** — Bloc ajouté dans le catch, avant le `decision_events.insert` :
```typescript
await supabaseClient
  .from('mock_trades')
  .update({
    execution_source: 'onchain_failed',
    is_open_position: false,
    notes: `FAILED: ${execError.message}`,
  })
  .eq('id', mockTradeId)
  .eq('execution_confirmed', false);
```

**Impact** : Les placeholders fantômes sont marqués comme échoués et fermés, empêchant les retries infinis du moteur.

---

## 8. Fichiers NON modifiés (confirmation explicite)

| Fichier | Statut |
|---------|--------|
| `supabase/functions/onchain-sign-and-send/index.ts` | ❌ Non modifié |
| `supabase/functions/onchain-execute/index.ts` | ❌ Non modifié |
| `supabase/functions/onchain-settlement/index.ts` | ❌ Non modifié |
| `supabase/functions/onchain-receipts/index.ts` | ❌ Non modifié (étape 3) |
| `supabase/functions/_shared/*` | ❌ Non modifié |
| `src/**/*` | ❌ Aucun fichier frontend touché |
