# 🔍 Audit exhaustif du pipeline LIVE — 2026-04-10

**Statut** : Lecture seule — aucun fix appliqué  
**Scope** : Chaîne complète `lecture portfolio → décision engine → exécution on-chain → mise à jour ledger → calcul P&L → affichage UI`  
**Fichiers audités** :
- `supabase/functions/backend-shadow-engine/index.ts`
- `supabase/functions/trading-decision-coordinator/index.ts`
- `supabase/functions/onchain-sign-and-send/index.ts`
- `supabase/functions/onchain-receipts/index.ts`
- `supabase/functions/onchain-execute/index.ts`
- `supabase/functions/_shared/signer.ts`
- `src/hooks/useRealTrades.ts`, `src/hooks/useRealPositions.ts`
- `src/types/trading.ts`

---

## CHAÎNE 1 — Lecture du portfolio par l'engine

### 1.1 fetchOpenPositions() — tables et filtres

**Fichier** : `backend-shadow-engine/index.ts`, ~L1486-1520

La fonction lit depuis `mock_trades` avec les filtres suivants :
- `.eq('is_open_position', true)`
- `.eq('trade_type', 'BUY')`
- `.eq('is_test_mode', isTestMode)` ← **corrigé dynamiquement** (anciennement hardcodé `true`)

`isTestMode` est dérivé de :
```javascript
const isTestMode = BACKEND_ENGINE_MODE !== 'LIVE'; // L28-29
```

**⚠️ PROBLÈME RÉSIDUEL (SEV-1 — #P1)** : La query ne filtre PAS sur `execution_confirmed`. En mode LIVE, les placeholders insérés par le coordinator (avec `execution_confirmed: false`, `price: 0`, `amount: 0`) sont inclus dans les résultats. Cela corrompt :
- Le calcul du prix moyen d'entrée (division par zéro ou prix = 0)
- Le calcul de la position nette (amount = 0 comptabilisé)
- Les décisions TP/SL (PnL calculé vs un prix d'entrée de 0 → faux positif TP)

**Ligne impactée** : ~L1486
```javascript
// Manque : .eq('execution_confirmed', true)
```

---

### 1.2 fetchAvailableCapital() — capital disponible

**Fichier** : `backend-shadow-engine/index.ts`, ~L1380-1420

L'engine calcule le capital disponible via une logique interne basée sur :
- `strategy.configuration.allocations` (allocation par symbole en EUR)
- Le nombre de positions ouvertes (via `fetchOpenPositions`)

**Il n'y a PAS de lecture du solde réel du wallet on-chain.** L'engine suppose que le capital configuré dans la stratégie est disponible. En mode LIVE, cela signifie :
- L'engine peut ordonner un BUY de 50€ alors que le wallet ne contient que 10 USDC
- La vérification de solvabilité est déléguée à `onchain-execute` (preflight balance check)
- Si `onchain-execute` échoue pour insuffisance de fonds, l'engine ne le sait pas et réessaie au cycle suivant

**Sévérité** : SEV-2 (dégradé mais pas bloquant — le preflight catch l'erreur)

---

### 1.3 Position sizing — calcul de eurAmount

**Fichier** : `backend-shadow-engine/index.ts`, ~L1650-1700

Le sizing est déterministe :
```javascript
eurAmount = strategy.configuration.allocations[symbol] || defaultAllocation;
```

Aucune vérification que le wallet possède réellement ce montant. Le montant est passé tel quel dans `intent.metadata.eurAmount` au coordinator.

**En mode LIVE** : Le coordinator transmet `eurAmount` à `onchain-sign-and-send` qui appelle `onchain-execute`. C'est `onchain-execute` qui vérifie le solde USDC du wallet avant de construire la transaction. Si insuffisant, la tx échoue → mais le placeholder `mock_trades` reste en DB (voir #P4).

---

### 1.4 Exposure guards — filtres is_test_mode

**Fichier** : `trading-decision-coordinator/index.ts`

#### Gate 3 — detectConflicts() exposure cap (~L6072)

```javascript
const { data: exposureData } = await supabase
  .from('mock_trades')
  .select('purchase_value_eur')
  .eq('cryptocurrency', symbol)
  .eq('is_open_position', true)
  .eq('user_id', userId);
// ❌ MANQUE : .eq('is_test_mode', canonicalIsTestMode)
```

**PROBLÈME (SEV-1 — #P2)** : Sans filtre `is_test_mode`, la query agrège les trades TEST **et** REAL. En LIVE, l'historique de paper trading (~30+ trades par symbole) sera compté dans l'exposition, bloquant systématiquement les BUY REAL légitimes quand `totalExposureEUR > max_exposure_per_coin`.

#### Gate 5b — maxLotsPerSymbol (~L6474)

```javascript
const { data: lotData } = await supabase
  .from('mock_trades')
  .select('id')
  .eq('cryptocurrency', symbol)
  .eq('is_open_position', true)
  .eq('user_id', userId);
// ❌ MANQUE : .eq('is_test_mode', canonicalIsTestMode)
```

**PROBLÈME (SEV-1 — #P3)** : Même issue. Les lots TEST sont comptés, pouvant atteindre `maxLotsPerSymbol` avant tout trade REAL.

#### Autres queries dans detectConflicts()

Aucune autre query dans `detectConflicts()` n'accède à `mock_trades` — les deux ci-dessus sont les seules impactées.

---

## CHAÎNE 2 — Exécution du trade

### 2.1 Chemin complet BUY automated

**Fichier** : `trading-decision-coordinator/index.ts`, ~L3572-3883 (bloc "AUTOMATED INTELLIGENT PATH")

```
1. Vérifie intent.source === 'intelligent'
2. deriveExecutionClass() → target: 'REAL'
3. isAutomatedIntelligent = true → skip check_live_trading_prerequisites
4. walletAddress = Deno.env.get('BOT_ADDRESS') || 'SYSTEM_WALLET'
   → si BOT_ADDRESS absent → return error
5. acquire_execution_lock(lockKey, 30s TTL)
   → si lock déjà pris → return { action: 'DEFER', reason: 'automated_lock_contention' }
6. INSERT mock_trades placeholder :
   {
     cryptocurrency: symbol,
     trade_type: 'BUY',
     amount: 0,                    // ← placeholder
     purchase_price: 0,            // ← placeholder  
     purchase_value_eur: eurAmount,
     is_open_position: true,
     is_test_mode: false,
     execution_source: 'onchain_pending',
     execution_confirmed: false,
     user_id, strategy_id
   }
7. fetch('onchain-sign-and-send', {
     symbol, side: 'BUY', amount: eurAmount,
     taker: BOT_ADDRESS, slippage_bps: 50,
     mockTradeId: placeholder.id
   })
8. Si succès (ok: true) :
   → Log decision_event (reason: 'real_execution_synchronous')
   → return { action: 'BUY', tradeId, txHash }
9. Si échec :
   → Log decision_event (reason: 'automated_execution_failed')
   → return { action: 'DEFER', reason: 'automated_execution_failed' }
   → ❌ Le placeholder N'EST PAS supprimé (voir #P4)
10. finally : release_execution_lock(lockKey)
```

**Tables écrites** :
| Table | Champs | Quand |
|-------|--------|-------|
| `mock_trades` | placeholder (amount=0, price=0, confirmed=false) | Étape 6 |
| `decision_events` | reason, metadata, raw_intent | Étape 8 ou 9 |
| `execution_locks` | lock_key, expires_at | Étape 5 (acquis) / 10 (libéré) |

---

### 2.2 Chemin complet SELL automated

**Fichier** : `trading-decision-coordinator/index.ts`

Le chemin SELL automated suit un parcours **différent** du BUY :

```
1. intent.side === 'SELL' arrive au coordinator
2. Si UD=ON (enableUnifiedDecisions=true) :
   → Route vers executeTradeOrder() (L6853+)
3. executeTradeOrder() évalue :
   - detectConflicts() (exposure check)
   - evaluatePositionStatus() (TP/SL/Trailing check)
4. Si shouldSell=true → executeTPSellWithLock()
5. executeTPSellWithLock() → executeTradeOrder() (re-entry pour SELL)
6. Dans executeTradeOrder() SELL branch (L7063+) :
   - deriveExecutionClass() avec strategyConfig?.canonicalExecutionMode
   - Si REAL + system_operator → chemin System Operator (L7100+)
   - Si REAL + automated → ⚠️ PAS de chemin dédié
```

**⚠️ PROBLÈME MAJEUR (SEV-1 — #P5)** : Le chemin SELL automated REAL n'existe PAS dans le même bloc que le BUY (L3572-3883). Le BUY automated a son propre bloc synchrone, mais le SELL passe par `executeTradeOrder()` qui :
- Pour REAL, n'a que le chemin System Operator (manual + system_operator_mode)
- Le SELL intelligent n'a PAS `system_operator_mode = true` dans son intent
- Il tombe donc dans le chemin MOCK par défaut, insérant un trade TEST au lieu d'exécuter on-chain

**Impact** : Les SELLs automatiques en mode LIVE seront routés vers MOCK (paper trade) au lieu d'exécuter réellement on-chain. Le bot achètera réellement mais vendra fictivement.

> **Note** : Ce point nécessite une vérification approfondie du routing exact. Si `deriveExecutionClass()` retourne `target: 'REAL'` pour les SELLs intelligents ET que le per-lot SELL path (L7801+) gère ce cas, le problème n'existe pas. Mais les queries à L7801/L7812 sont hardcodées `is_test_mode: true`, ce qui bloque le SELL REAL de toute façon (voir #P6).

---

### 2.3 Scénarios d'échec et nettoyage

#### Si onchain-execute échoue (balance insuffisante, quote 0x échoue, etc.)

```
onchain-execute retourne { ok: false, error: "..." }
→ onchain-sign-and-send retourne { ok: false, error: "..." }
→ coordinator catch : log automated_execution_failed
→ placeholder mock_trades RESTE en DB (amount=0, confirmed=false)
→ lock libéré dans finally
```

**Résidu en DB** : 1 ligne `mock_trades` fantôme par échec.

#### Si onchain-sign-and-send échoue (timeout HTTP, crash Edge Function)

```
fetch() throw → coordinator catch
→ même résidu que ci-dessus
```

#### Si onchain-receipts échoue (fire-and-forget)

**Fichier** : `onchain-sign-and-send/index.ts`, ~L851-875

```javascript
// Fire-and-forget — no await, no retry
fetch(`${SUPABASE_URL}/functions/v1/onchain-receipts`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
  body: JSON.stringify({ txHash, chainId, mockTradeId, tradeId })
});
```

**PROBLÈME (SEV-2 — #P7)** : Aucun retry, aucun cron de rattrapage. Si le fetch échoue :
- La transaction est confirmée on-chain (tokens échangés)
- Le placeholder `mock_trades` reste `execution_confirmed: false`
- L'engine ne voit pas la position (si on ajoute le filtre `execution_confirmed: true`)
- Le capital est dépensé on-chain mais invisible dans le ledger
- Au cycle suivant, l'engine peut re-tenter le même BUY (double spend potentiel)

---

### 2.4 Placeholders fantômes — inventaire des scénarios

| Scénario | Placeholder créé | Nettoyé ? | Détectable |
|----------|-----------------|-----------|------------|
| BUY succès + receipts succès | Oui → mis à jour par receipts | ✅ | N/A |
| BUY succès + receipts échoue | Oui → reste confirmed=false | ❌ | `WHERE execution_confirmed = false AND execution_source = 'onchain_pending'` |
| BUY échoue (onchain-execute) | Oui → reste amount=0, confirmed=false | ❌ | `WHERE amount = 0 AND execution_source = 'onchain_pending'` |
| BUY échoue (HTTP timeout) | Oui → idem | ❌ | idem |
| SELL (via executeTradeOrder) | Non (pas de placeholder pour SELL) | N/A | N/A |

**Query de détection** :
```sql
SELECT id, cryptocurrency, amount, purchase_price, execution_confirmed, executed_at
FROM mock_trades
WHERE execution_source = 'onchain_pending'
  AND (execution_confirmed = false OR amount = 0)
ORDER BY executed_at DESC;
```

---

## CHAÎNE 3 — Mise à jour du ledger

### 3.1 Après un BUY confirmé on-chain

**Fichier** : `onchain-receipts/index.ts`

Quand `onchain-receipts` s'exécute avec succès, il :

1. Poll la transaction via le RPC jusqu'à confirmation (status = 1)
2. Décode les logs de la transaction (Transfer events)
3. Met à jour `mock_trades` :
   ```javascript
   UPDATE mock_trades SET
     execution_confirmed = true,
     amount = decodedAmount,         // quantité réelle reçue
     purchase_price = effectivePrice, // prix effectif
     tx_hash = txHash
   WHERE id = mockTradeId;
   ```
4. Insère dans `real_trades` :
   ```javascript
   INSERT INTO real_trades {
     mock_trade_id: mockTradeId,
     tx_hash, chain_id, provider: '0x',
     filled_quantity, effective_price, total_value,
     fees, gas_used, block_number, block_timestamp,
     execution_status: 'CONFIRMED',
     user_id, strategy_id
   }
   ```

**CE QUI N'EST PAS FAIT** :
- ❌ `portfolio_capital.cash_balance_eur` n'est PAS débité (voir #P8)
- ❌ `settle_buy_trade` RPC n'est PAS appelée
- ❌ `reserved_eur` n'est PAS mis à jour
- ❌ `coin_pool_states` n'est PAS mis à jour

---

### 3.2 Après un SELL confirmé on-chain

**Fichier** : `onchain-receipts/index.ts`

Le même flux s'applique, mais avec des lacunes supplémentaires :

**CE QUI N'EST PAS FAIT** :
- ❌ `is_open_position` n'est PAS mis à `false` sur le trade BUY d'origine (pas de FIFO clearing)
- ❌ `sell_price`, `profit_loss`, `profit_loss_percentage` ne sont PAS calculés sur le trade BUY
- ❌ `portfolio_capital.cash_balance_eur` n'est PAS crédité
- ❌ `settle_sell_trade` RPC n'est PAS appelée
- ❌ Aucune logique de fermeture de position

**PROBLÈME (SEV-1 — #P8)** : `onchain-receipts` est un confirmateur de transaction, pas un settlement engine. Il met à jour le statut d'exécution mais ne gère aucune comptabilité métier. Toute la logique de settlement (cash, positions, P&L) est absente du chemin REAL automated.

---

### 3.3 RPCs settle_buy_trade et settle_sell_trade

**Statut** : Ces RPCs existent dans le schéma Supabase (fonctions PostgreSQL) mais ne sont appelées **nulle part** dans le chemin automated REAL.

**settle_buy_trade** (rôle attendu) :
- Débiter `cash_balance_eur` du montant dépensé
- Libérer `reserved_eur`
- Mettre à jour `coin_pool_states`

**settle_sell_trade** (rôle attendu) :
- Créditer `cash_balance_eur` du produit de vente
- Mettre `is_open_position = false` sur le trade BUY (FIFO)
- Calculer `profit_loss` et `profit_loss_percentage`
- Mettre à jour `coin_pool_states`

**Impact** : Sans ces appels, `portfolio_capital` reste figé à sa valeur initiale, et les positions ne sont jamais clôturées dans le ledger.

---

## CHAÎNE 4 — Calcul du P&L

### 4.1 P&L réalisé pour trades on-chain

**Problème** : Le P&L réalisé est normalement calculé par `settle_sell_trade` au moment de la clôture d'une position. Puisque cette RPC n'est pas appelée dans le chemin REAL (#P8), le P&L réalisé n'est **jamais calculé** pour les trades on-chain.

Les champs `profit_loss` et `profit_loss_percentage` sur `mock_trades` resteront à `null` pour tous les trades REAL.

---

### 4.2 Vues real_trade_history_view et real_positions_view

**real_trade_history_view** : Joint `real_trades` avec `mock_trades` pour enrichir les données on-chain avec le contexte métier (strategy_id, etc.). Filtre sur `trade_role = 'ENGINE_TRADE'` (exclut les funding events).

**real_positions_view** : Agrège les `real_trades` par symbole pour calculer `position_size` (somme algébrique des BUY - SELL). N'inclut PAS de P&L — c'est un agrégat de quantité uniquement.

**Cohérence après BUY→SELL** : Si `onchain-receipts` fonctionne correctement pour les deux, `real_trades` aura les deux lignes et `real_positions_view` montrera `position_size ≈ 0` après le SELL. **Mais** `mock_trades` ne sera pas cohérent car `is_open_position` ne sera pas mis à `false`.

---

### 4.3 Bug pro-rata (partial sells)

Le bug pro-rata existait dans le chemin MOCK car `executeTradeDirectly()` ne faisait pas de FIFO partiel. Dans le chemin REAL automated :
- Les SELLs ne passent pas par `executeTradeDirectly()` (chemin UD=ON)
- Le per-lot SELL path (L7801+) implémente du FIFO
- **Mais** les queries à L7801/L7812 sont hardcodées `is_test_mode: true` → le FIFO ne trouvera pas les trades REAL (voir #P6)

---

## CHAÎNE 5 — Affichage UI

### 5.1 Dashboard portfolio en mode REAL

**Fichier** : `src/hooks/useRealPositions.ts`

Le dashboard REAL lit depuis `real_positions_view` qui agrège `real_trades`. Cette vue fournit :
- `symbol`, `position_size`, `last_trade_at`
- **Pas de P&L**, pas de prix d'entrée, pas de valeur courante

Le P&L affiché en UI doit être calculé côté frontend en croisant `position_size` avec un prix de marché live. Ce calcul n'est pas implémenté dans les hooks existants — le dashboard REAL affichera des positions sans P&L.

---

### 5.2 Onglet History en mode REAL

**Fichier** : `src/hooks/useRealTrades.ts`

Lit depuis `real_trade_history_view`. Affichera correctement :
- Les BUY/SELL avec tx_hash, prix effectif, quantité, fees
- **Manque** : `profit_loss` (jamais calculé, voir #P8)

---

### 5.3 Onglet Performance

L'onglet Performance (win rate, avg win/loss) dépend de `mock_trades.profit_loss` et `profit_loss_percentage`. Ces champs ne sont pas remplis pour les trades REAL → l'onglet Performance sera vide ou incorrect en mode REAL.

---

### 5.4 Calculs frontend potentiellement faux

- Le portfolio value total en REAL devrait = Σ(position_size × current_price). Si `real_positions_view` est correct, le calcul est juste.
- Le cash disponible est lu depuis `portfolio_capital.cash_balance_eur` qui n'est jamais mis à jour en REAL (#P8) → affiché comme initial (ex: 1000€) même après avoir dépensé 500€ on-chain.

---

## SYNTHÈSE — Inventaire complet

| # | Problème | Chaîne | Sévérité | Impact réel |
|---|----------|--------|----------|-------------|
| **P1** | `fetchOpenPositions` lit les placeholders non confirmés (price=0, amount=0) | 1 — Engine | **SEV-1** | Corrompt le calcul de position nette, prix moyen, et PnL. Peut déclencher des faux TP/SL. |
| **P2** | `detectConflicts()` exposure query sans filtre `is_test_mode` (L6072) | 1 — Guards | **SEV-1** | Les trades MOCK historiques bloquent les BUY REAL légitimes. |
| **P3** | `maxLotsPerSymbol` query sans filtre `is_test_mode` (L6474) | 1 — Guards | **SEV-1** | Idem — lots MOCK comptés, cap atteint avant tout trade REAL. |
| **P4** | Placeholder `mock_trades` non supprimé en cas d'échec on-chain | 2 — Exécution | **SEV-1** | Accumulation de ghost trades (amount=0, confirmed=false). Polluent les queries de positions, capital, et exposure. |
| **P5** | Chemin SELL automated REAL absent ou mal routé | 2 — Exécution | **SEV-1** | Les SELLs automatiques en LIVE risquent d'être routés vers MOCK au lieu d'on-chain. Le bot achète réellement mais vend fictivement. |
| **P6** | Per-lot SELL queries hardcodées `is_test_mode: true` (L7801/L7812) | 2 — Exécution | **SEV-1** | Même si le SELL REAL atteint le per-lot path, les queries FIFO ne trouvent aucun trade REAL. |
| **P7** | `onchain-receipts` invoqué en fire-and-forget sans retry | 2 — Exécution | **SEV-2** | Si le fetch échoue, le trade est exécuté on-chain mais invisible dans le ledger. Risque de double-spend au cycle suivant. |
| **P8** | Settlement absent (`portfolio_capital`, `is_open_position`, `profit_loss`) | 3 — Ledger | **SEV-1** | Cash balance jamais mis à jour, positions jamais fermées, P&L jamais calculé. Le ledger diverge de l'état on-chain après chaque trade. |
| **P9** | `settle_buy_trade` / `settle_sell_trade` RPCs non appelées | 3 — Ledger | **SEV-1** | Conséquence directe de P8. Les RPCs existent mais ne sont invoquées nulle part dans le chemin automated. |
| **P10** | Capital disponible non vérifié vs wallet réel | 1 — Engine | **SEV-2** | L'engine peut ordonner des BUY dépassant le solde réel du wallet. Mitigé par le preflight de `onchain-execute`, mais génère des ghost trades (P4). |
| **P11** | Dashboard REAL sans P&L | 5 — UI | **SEV-2** | Les positions REAL s'affichent sans P&L (ni réalisé ni non-réalisé). |
| **P12** | Performance tab vide en REAL | 5 — UI | **SEV-3** | Win rate, avg win/loss basés sur `mock_trades.profit_loss` qui est null pour les trades REAL. |
| **P13** | Cash affiché stale en REAL | 5 — UI | **SEV-2** | `portfolio_capital.cash_balance_eur` figé à la valeur initiale. |

---

## Priorisation recommandée

### Avant activation LIVE (bloquants)

1. **P1** — Ajouter `.eq('execution_confirmed', true)` à `fetchOpenPositions`
2. **P2 + P3** — Ajouter `.eq('is_test_mode', canonicalIsTestMode)` aux exposure queries
3. **P4** — Supprimer/marquer le placeholder en cas d'échec dans le catch du coordinator
4. **P5 + P6** — Implémenter le chemin SELL REAL automated ou corriger le routing + les queries FIFO
5. **P8 + P9** — Intégrer les appels `settle_buy_trade` / `settle_sell_trade` dans `onchain-receipts` ou dans le coordinator post-confirmation

### Après activation (améliorations)

6. **P7** — Ajouter un retry ou cron de rattrapage pour `onchain-receipts`
7. **P10** — Pré-vérifier le solde wallet avant d'envoyer l'intent
8. **P11 + P12 + P13** — Enrichir les hooks UI pour le mode REAL

---

## Requêtes de diagnostic

### Détecter les ghost trades
```sql
SELECT id, cryptocurrency, amount, purchase_price, execution_confirmed, execution_source, executed_at
FROM mock_trades
WHERE execution_source = 'onchain_pending'
  AND (execution_confirmed = false OR amount = 0)
ORDER BY executed_at DESC;
```

### Vérifier la cohérence mock_trades vs real_trades
```sql
SELECT mt.id AS mock_id, rt.id AS real_id,
       mt.amount AS mock_amount, rt.filled_quantity AS real_qty,
       mt.purchase_price AS mock_price, rt.effective_price AS real_price,
       mt.execution_confirmed
FROM mock_trades mt
LEFT JOIN real_trades rt ON rt.mock_trade_id = mt.id
WHERE mt.is_test_mode = false
ORDER BY mt.executed_at DESC;
```

### Vérifier portfolio_capital vs dépenses réelles
```sql
SELECT pc.cash_balance_eur,
       COALESCE(SUM(rt.total_value), 0) AS total_spent_onchain
FROM portfolio_capital pc
LEFT JOIN real_trades rt ON rt.user_id = pc.user_id AND rt.side = 'BUY'
WHERE pc.is_test_mode = false
GROUP BY pc.cash_balance_eur;
```

### Positions ouvertes non fermées
```sql
SELECT mt.id, mt.cryptocurrency, mt.amount, mt.is_open_position, mt.execution_confirmed
FROM mock_trades mt
WHERE mt.is_test_mode = false
  AND mt.trade_type = 'BUY'
  AND mt.is_open_position = true
ORDER BY mt.executed_at;
```
