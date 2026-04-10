# Engine → On-Chain Connection — Documentation

**Date** : 2026-04-10  
**Objectif** : Connecter le backend-shadow-engine au pipeline on-chain réel via un appel synchrone à `onchain-sign-and-send`, en réutilisant exactement l'architecture du System Operator path.

---

## 1. Flux complet

```
backend-shadow-engine (BACKEND_ENGINE_MODE=LIVE)
    │
    ▼ supabase.functions.invoke('trading-decision-coordinator')
    │  intent: { source: 'intelligent', side: 'BUY'/'SELL', metadata.eurAmount, ... }
    │
    ▼ trading-decision-coordinator
    │  ├─ deriveExecutionClass() → target: 'REAL' (from strategy.execution_target)
    │  ├─ isAutomatedIntelligent = true → skip check_live_trading_prerequisites
    │  ├─ walletAddress = 'SYSTEM_WALLET' (BOT_ADDRESS used by onchain-sign-and-send)
    │  │
    │  ▼ AUTOMATED INTELLIGENT PATH (formerly execution_jobs insert)
    │     ├─ acquire_execution_lock (anti-double, TTL 30s)
    │     ├─ INSERT mock_trades placeholder (execution_source='onchain_pending')
    │     ├─ fetch('onchain-sign-and-send', { symbol, side, amount, taker: BOT_ADDRESS })
    │     ├─ Log decision_event (reason='real_execution_synchronous')
    │     └─ release_execution_lock (in finally)
    │
    ▼ onchain-sign-and-send
       ├─ onchain-execute (mode=build, provider=0x, chain=Base 8453)
       ├─ getSigner() → LocalSigner (BOT_PRIVATE_KEY)
       ├─ signTransaction → eth_sendRawTransaction (RPC_URL_8453)
       └─ Résultat: { ok, tx_hash, tradeId }
```

---

## 2. Fichier modifié

| Fichier | Lignes | Nature du changement |
|---|---|---|
| `supabase/functions/trading-decision-coordinator/index.ts` | L3183-3186 | Ajout `isAutomatedIntelligent` pour skip prerequisites |
| | L3266-3271 | Wallet resolution : intelligent utilise SYSTEM_WALLET |
| | L3570-3678 | **Remplacé** : insertion `execution_jobs` → appel synchrone `onchain-sign-and-send` avec lock + placeholder + error handling |

## 3. Fichiers NON modifiés

- `supabase/functions/onchain-sign-and-send/index.ts` — AUCUNE modification
- `supabase/functions/onchain-execute/index.ts` — AUCUNE modification
- `supabase/functions/backend-shadow-engine/index.ts` — AUCUNE modification (metadata fix séparé, voir CHANGELOG)
- `supabase/functions/_shared/signer.ts` — AUCUNE modification
- Chemin Manual Fast-Path (L3313-3568) — INTACT
- Chemin System Operator (L2200-2500) — INTACT
- Chemin MOCK — INTACT

---

## 4. Comment activer

### Pré-requis secrets Supabase
- `BACKEND_ENGINE_MODE=LIVE` (sur `backend-shadow-engine`)
- `BOT_ADDRESS` ✅
- `BOT_PRIVATE_KEY` ✅
- `RPC_URL_8453` ✅
- `SERVER_SIGNER_MODE=local`
- `SERVER_SIGNER_LOCAL=true`
- `EXECUTION_DRY_RUN=false` (dans `onchain-execute`)

### Pré-requis stratégie
- `trading_strategies.execution_target = 'REAL'` pour la stratégie active

### Étapes d'activation
1. Mettre `BACKEND_ENGINE_MODE=LIVE` dans les secrets de `backend-shadow-engine`
2. Mettre `execution_target = 'REAL'` sur la stratégie cible (table `trading_strategies`)
3. Vérifier que `EXECUTION_DRY_RUN=false` dans les secrets de `onchain-execute`
4. Redéployer les edge functions

---

## 5. Comment désactiver en urgence

### Option A — Désactiver l'engine (instantané)
```
BACKEND_ENGINE_MODE=SHADOW
```
L'engine continue d'évaluer mais n'invoque plus le coordinator.

### Option B — Repasser en MOCK (instantané)
```sql
UPDATE trading_strategies SET execution_target = 'MOCK' WHERE id = '<strategy_id>';
```
Le coordinator route vers le chemin MOCK (insère dans mock_trades, pas d'on-chain).

### Option C — Activer le dry run (instantané)
```
EXECUTION_DRY_RUN=true
```
`onchain-execute` construit les transactions mais ne broadcast pas.

### Option D — Panic button
```sql
INSERT INTO execution_circuit_breakers (user_id, strategy_id, symbol, breaker, tripped, trip_reason)
VALUES ('<user_id>', '<strategy_id>', '*', 'PANIC', true, 'Emergency stop');
```

---

## 6. Logs à surveiller

### Flux normal (succès)
```
🤖 COORDINATOR: AUTOMATED INTELLIGENT PATH - synchronous on-chain execution
🔒 COORDINATOR: Acquiring lock for automated execution: <lockKey>
🔒 COORDINATOR: Lock acquired: <lockKey>
MOCK_TRADES_PENDING_ONCHAIN_INSERTED { source: "automated_intelligent" }
📡 COORDINATOR: AUTOMATED calling onchain-sign-and-send { ... }
✅ COORDINATOR: AUTOMATED Transaction submitted: { tradeId, txHash }
🎉 COORDINATOR: AUTOMATED TRADE EXECUTED SUCCESSFULLY { ... }
🔓 COORDINATOR: Released automated lock: <lockKey>
```

### Erreurs à surveiller
| Log | Signification |
|---|---|
| `❌ COORDINATOR: BOT_ADDRESS not configured` | Secret manquant |
| `⏳ COORDINATOR: Lock contention` | Trade déjà en cours pour ce symbol |
| `❌ COORDINATOR: Failed to insert automated mock_trades placeholder` | Problème DB |
| `❌ COORDINATOR: AUTOMATED onchain-sign-and-send failed` | Échec HTTP |
| `❌ COORDINATOR: AUTOMATED onchain-sign-and-send response invalid` | Réponse malformée |
| `❌ COORDINATOR: AUTOMATED Execution error` | Erreur générale |

### Decision events à vérifier
```sql
-- Trades automatiques soumis avec succès
SELECT * FROM decision_events
WHERE reason = 'real_execution_synchronous'
ORDER BY created_at DESC LIMIT 10;

-- Échecs d'exécution automatique
SELECT * FROM decision_events
WHERE reason = 'automated_execution_failed'
ORDER BY created_at DESC LIMIT 10;
```

### Placeholder mock_trades
```sql
-- Trades en attente de confirmation on-chain
SELECT id, cryptocurrency, trade_type, amount, execution_source, execution_confirmed
FROM mock_trades
WHERE execution_source = 'onchain_pending'
  AND execution_confirmed = false
ORDER BY executed_at DESC LIMIT 10;
```

---

## 7. Différences avec le System Operator path

| Aspect | System Operator | Automated Intelligent |
|---|---|---|
| Source | `manual` + `system_operator_mode=true` | `intelligent` |
| Prerequisites | Skippé | Skippé (même raison : SYSTEM wallet) |
| Execution lock | Non | **Oui** (anti-double via `acquire_execution_lock`) |
| `strategy_id` | `null` | `intent.strategyId` |
| `is_system_operator` | `true` | `false` |
| Slippage | `intent.metadata.slippage_bps \|\| 100` | `50` (hardcodé, plus serré) |
| Amount BUY | `intent.metadata.eurAmount` | `intent.metadata.eurAmount` |
| Amount SELL | `intent.qtySuggested` | `intent.qtySuggested` |
| Decision reason | `manual_execution_submitted` | `real_execution_synchronous` |
