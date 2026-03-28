# Audit RSI + EMA50 Entry Filter — Feasibility Report

**Date**: 2026-03-28  
**Phase**: Phase 1 — Inspection only, no live changes  
**Status**: AUDIT COMPLETE

---

## QUESTION 1 — Où se prend la décision BUY ?

### 1.1 Fichier et fonction

**Fichier**: `supabase/functions/trading-decision-coordinator/index.ts`  
**Taille**: 8568 lignes — c'est le seul fichier du coordinator.

### 1.2 Flux exact : fusion score → trade exécuté

```
1. Ligne ~2955: FUSION GATE — computeFusedSignalScore()
   ↓ Calcule le fusedScore à partir de live_signals (agrégation par source)
   ↓ Stocke dans precomputedFusionData

2. Ligne ~3048: PANIC GATE — vérifie panicActive
   ↓ Si panic → BLOCK (return early)

3. Ligne ~3066: STATE GATE — vérifie strategy state + on_disable_policy
   ↓ Si inactive sans policy → BLOCK

4. Ligne ~3797: FUSION THRESHOLD CHECK
   ↓ Si precomputedFusionData.score < enterThreshold (configuré) → HOLD
   ↓ Sinon → dérive confidence depuis fusion score

5. Ligne ~3857: UD MODE DECISION
   ↓ Si enableUnifiedDecisions=false → executeTradeDirectly() (ligne ~4561)
   ↓ Si enableUnifiedDecisions=true → detectConflicts() puis execute

6. Ligne ~4561: executeTradeDirectly()
   ↓ Appelle getMarketPrice() pour le prix
   ↓ Vérifie hold period, spread, exposition
   ↓ Insère dans mock_trades (MOCK) ou appelle onchain-sign-and-send (REAL)

7. Ligne ~5100: logDecisionAsync() — écrit decision_event + snapshot
```

### 1.3 Point d'insertion optimal pour un filtre d'entrée

**Entre l'étape 4 (FUSION THRESHOLD) et l'étape 5 (UD MODE), ligne ~3844.**

C'est le point idéal car :
- La fusion est déjà calculée (on a `precomputedFusionData`)
- Les gates de base (panic, state) sont passés
- La confidence est déjà dérivée
- On est AVANT l'exécution → un HOLD ici bloque proprement
- Le pattern existe déjà (voir fear_greed_shadow à la ligne ~2993)

---

## QUESTION 2 — Disponibilité des données au moment de la décision

### a) rsi_14 (RSI sur 14 périodes)

| Critère | Réponse |
|---------|---------|
| **Disponible au moment BUY ?** | ❌ NON — pas directement dans le flux de décision |
| **Où est-il stocké ?** | Table `market_features_v0`, colonne `rsi_14` |
| **Accessible comment ?** | Via query Supabase : `.from("market_features_v0").select("rsi_14").eq("symbol", "BTC-EUR").eq("granularity", "1h").order("ts_utc", {ascending: false}).limit(1)` |
| **Fraîcheur** | Dépend du cron `features-refresh` — recalculé périodiquement |
| **Déjà utilisé dans le coordinator ?** | NON — `market_features_v0` est seulement utilisé dans `computeDynamicTpSlThresholds()` (ligne ~5503) pour la volatilité, pas pour RSI |

**Conclusion**: rsi_14 existe en DB, est calculé par `features-refresh`, mais n'est **pas lu** par le coordinator au moment de la décision BUY. Il faudrait ajouter une query.

### b) price_vs_ema50 (position du prix vs EMA50)

| Critère | Réponse |
|---------|---------|
| **Disponible au moment BUY ?** | ❌ NON — pas calculé |
| **Calculable ?** | ✅ OUI — à partir de `ema_50` (market_features_v0) et du prix courant (`realMarketPrice` dans `executeTradeDirectly()`, ou `getMarketPrice()`) |
| **Formule** | `price_vs_ema50 = (currentPrice - ema_50) / ema_50` |

### c) ema_50 (EMA sur 50 périodes)

| Critère | Réponse |
|---------|---------|
| **Disponible en DB ?** | ✅ OUI — `market_features_v0.ema_50` |
| **Disponible dans le coordinator ?** | ❌ NON — pas lu actuellement |
| **Comment la récupérer ?** | Même query que pour rsi_14 : `.from("market_features_v0").select("rsi_14, ema_50").eq("symbol", ...).eq("granularity", "1h").order("ts_utc", {ascending: false}).limit(1)` |

### Résumé disponibilité

| Variable | En DB ? | Dans le coordinator ? | Action requise |
|----------|---------|----------------------|----------------|
| `rsi_14` | ✅ `market_features_v0` | ❌ | Ajouter 1 query |
| `ema_50` | ✅ `market_features_v0` | ❌ | Même query |
| `price_vs_ema50` | ❌ (calculé) | ❌ | Calculer depuis prix + ema_50 |
| `currentPrice` | ✅ via `getMarketPrice()` | ✅ (ligne ~4562) | Déjà disponible |

**Important** : Le prix courant est disponible dans `executeTradeDirectly()` (ligne ~4562) mais PAS au point d'insertion recommandé (ligne ~3844). Pour le shadow, il faudra soit :
- Appeler `getMarketPrice()` plus tôt (avant la ligne ~3844), ou
- Utiliser le prix d'intent (`intent.metadata?.currentPrice`) qui est souvent fourni par le backend engine

---

## QUESTION 3 — Où se fait la sortie (TP/exit) ?

### 3.1 TP/SL Detection

**Fichier** : `supabase/functions/trading-decision-coordinator/index.ts`  
**Fonction** : `computeDynamicTpSlThresholds()` (ligne ~5482) + logique TP/SL inline  
**Lignes clés** :
- Ligne ~5671 : `if (pnlPct >= effectiveTpPct)` → **TAKE_PROFIT**
- Ligne ~5672-5680 : **Anti-churn guard** — bloque les micro-TP (< 25% du TP configuré)
- Ligne ~5696 : `if (pnlPct <= -effectiveSlPct)` → **STOP_LOSS**

### 3.2 Trailing Stop + Runner Mode

**Fichier** : `supabase/functions/backend-shadow-engine/index.ts`  
**C'est un service SÉPARÉ du coordinator.**

Logique (ligne ~1560) :
1. Si `runner_mode` activé ET pnlPct > 0 :
   - Met à jour le peak PnL
   - Calcule `newTrailingStopLevel = peak - trailingDistancePct`
   - Si `pnlPct <= newTrailingStopLevel` → **TRAILING_STOP** exit
2. Si TP atteint ET bull_override (signaux de continuation) :
   - Ne vend PAS au TP
   - Active le **RUNNER mode** avec trailing stop
   - Persiste l'état dans `coin_pool_states`

### 3.3 Architecture de sortie

| Composant | Rôle | Fichier |
|-----------|------|---------|
| Coordinator | TP/SL detection (calcul P&L vs seuils dynamiques) | `trading-decision-coordinator/index.ts` |
| Backend Shadow Engine | Runner mode, trailing stop, bull override | `backend-shadow-engine/index.ts` |
| Coordinator | Exécution finale du SELL (mock_trades insert) | `trading-decision-coordinator/index.ts` |

**Le backend engine détecte la condition de sortie, puis envoie un intent SELL au coordinator qui exécute.**

---

## QUESTION 4 — Shadow simulation

### Données disponibles ?

| Variable | Disponible ? |
|----------|-------------|
| `rsi_14` | ✅ En DB (`market_features_v0`) — nécessite 1 query |
| `ema_50` | ✅ En DB (`market_features_v0`) — même query |
| `currentPrice` | ⚠️ Disponible via `getMarketPrice()` ou `intent.metadata?.currentPrice` |

### Implémentation shadow — OUI, faisable

Le shadow doit être inséré dans le snapshot `market_context_json` (ligne ~5427), exactement comme `fear_greed_shadow` et `confidence_shadow` le sont déjà (lignes ~5433-5434).

**Plan d'implémentation (pour validation avant exécution)** :

1. **Après le fusion gate (ligne ~3041), ajouter** :
   ```typescript
   // Fetch RSI + EMA50 from market_features_v0 for shadow logging
   if (intent.side === 'BUY') {
     try {
       const baseSymbol = toBaseSymbol(intent.symbol);
       const { data: features } = await supabaseClient
         .from("market_features_v0")
         .select("rsi_14, ema_50")
         .eq("symbol", `${baseSymbol}-EUR`)
         .eq("granularity", "1h")
         .order("ts_utc", { ascending: false })
         .limit(1);
       
       const intentPrice = intent.metadata?.currentPrice || intent.metadata?.price;
       
       if (features?.[0] && intentPrice) {
         const rsi14 = features[0].rsi_14;
         const ema50 = features[0].ema_50;
         const priceVsEma50 = ema50 ? (intentPrice - ema50) / ema50 : null;
         
         const wouldPass = rsi14 !== null && priceVsEma50 !== null
           && rsi14 < 40 && priceVsEma50 < -0.005;
         
         let filterReason = 'both_fail';
         if (rsi14 !== null && priceVsEma50 !== null) {
           const rsiOk = rsi14 < 40;
           const emaOk = priceVsEma50 < -0.005;
           if (rsiOk && emaOk) filterReason = 'rsi_ok+ema_ok';
           else if (!rsiOk && emaOk) filterReason = 'rsi_fail';
           else if (rsiOk && !emaOk) filterReason = 'ema_fail';
           else filterReason = 'both_fail';
         }
         
         precomputedFusionData._entryFilterShadow = {
           rsi_14: rsi14,
           price_vs_ema50: priceVsEma50 !== null ? Number(priceVsEma50.toFixed(6)) : null,
           ema_50: ema50,
           current_price: intentPrice,
           would_pass_filter: wouldPass,
           filter_reason: filterReason,
         };
       }
     } catch (err) {
       console.warn('[entry_filter_shadow] Failed to fetch features:', err?.message);
     }
   }
   ```

2. **Dans le snapshot market_context_json (ligne ~5432), ajouter** :
   ```typescript
   ...(fusedSignalData?._entryFilterShadow && { entry_filter_shadow: fusedSignalData._entryFilterShadow }),
   ```

### Contraintes respectées

- ❌ Ne bloque AUCUN BUY — observation uniquement
- ❌ Ne modifie PAS la logique de fusion
- ❌ Ne modifie PAS les conditions d'exécution
- ✅ Uniquement un champ JSON dans le snapshot existant
- ✅ Même pattern que `fear_greed_shadow` et `confidence_shadow`

### Risque principal

Le prix `intent.metadata?.currentPrice` peut être `null` si le backend engine ne le fournit pas. Dans ce cas, le shadow ne sera pas écrit (pas de crash, pas de blocage). Pour garantir la couverture, il faudra vérifier que le backend engine envoie toujours un prix dans l'intent.

---

## QUESTION 5 — Impact estimé

Une fois le shadow branché, les métriques suivantes peuvent être calculées via SQL :

```sql
-- % des BUY filtrés par RSI<40 + EMA50<-0.5%
SELECT 
  COUNT(*) as total_buys,
  COUNT(*) FILTER (WHERE 
    (ds.market_context_json->'entry_filter_shadow'->>'would_pass_filter')::boolean = true
  ) as would_pass,
  COUNT(*) FILTER (WHERE 
    (ds.market_context_json->'entry_filter_shadow'->>'would_pass_filter')::boolean = false
  ) as would_filter,
  ROUND(
    COUNT(*) FILTER (WHERE 
      (ds.market_context_json->'entry_filter_shadow'->>'would_pass_filter')::boolean = false
    )::numeric / NULLIF(COUNT(*), 0) * 100, 1
  ) as filter_rate_pct
FROM decision_snapshots ds
JOIN decision_events de ON de.id = ds.decision_id
WHERE ds.snapshot_type = 'ENTRY'
  AND de.side = 'BUY'
  AND ds.market_context_json->'entry_filter_shadow' IS NOT NULL;

-- Corrélation would_pass vs outcomes
SELECT 
  (ds.market_context_json->'entry_filter_shadow'->>'would_pass_filter')::boolean as would_pass,
  COUNT(*) as n,
  ROUND(AVG(do_out.realized_pnl_pct)::numeric, 3) as avg_pnl_pct,
  ROUND(AVG(CASE WHEN do_out.realized_pnl_pct > 0 THEN 1.0 ELSE 0.0 END)::numeric * 100, 1) as win_rate_pct
FROM decision_snapshots ds
JOIN decision_events de ON de.id = ds.decision_id
JOIN decision_outcomes do_out ON do_out.decision_id = de.id
WHERE ds.snapshot_type = 'ENTRY'
  AND de.side = 'BUY'
  AND ds.market_context_json->'entry_filter_shadow' IS NOT NULL
GROUP BY 1;
```

Ces queries seront exécutables dès que les snapshots contiendront le champ `entry_filter_shadow`.

---

## QUESTION 6 — Trailing stop — description architecturale

### 6.1 Comment se déclenche la sortie après TP ?

Deux modes :

**Mode standard** (coordinator, ligne ~5671) :
- Si `pnlPct >= effectiveTpPct` ET passe l'anti-churn guard (>25% du TP de base)
- → SELL immédiat via coordinator

**Mode runner** (backend-shadow-engine, ligne ~1620) :
- Si TP atteint ET `bullScore >= threshold` (signaux de continuation haussiers)
- → NE PAS vendre, activer RUNNER mode
- → Trailing stop protège le gain à la baisse

### 6.2 Monitoring continu du prix après entrée ?

**OUI** — Le `backend-shadow-engine` tourne en boucle (appelé par cron `automated-trading-engine`). À chaque cycle :
1. Récupère toutes les positions ouvertes
2. Récupère le prix courant
3. Calcule PnL
4. Vérifie TP/SL/trailing stop
5. Si condition de sortie → envoie intent SELL au coordinator

L'état du runner est persisté dans `coin_pool_states` (high_water_price, is_armed, config_snapshot).

### 6.3 Si on voulait implémenter un trailing stop (description seulement)

**Quelle partie modifier ?**
- `backend-shadow-engine/index.ts` — la logique existe DÉJÀ (ligne ~1559)
- Le trailing stop est déjà implémenté dans le runner mode
- Pour un trailing stop GLOBAL (pas seulement en runner mode), il faudrait modifier la fonction `getSellDecision` dans le backend engine

**Risque principal ?**
- **Latence de détection** : le backend engine tourne sur un cycle (typiquement 60s). Si le prix chute brusquement, le trailing stop peut être déclenché avec un retard de 60s. En crypto volatile, c'est significatif.
- **Conflit avec TP** : si le trailing stop et le TP standard coexistent, il faut des règles de priorité claires.

**Refactoring nécessaire ?**
- **NON pour le runner mode** — déjà implémenté et fonctionnel
- **MINIMAL pour un trailing stop global** — ajouter un check dans le cycle de gestion des positions, avant le check TP/SL standard. L'architecture le permet car le backend engine a déjà accès au prix courant et aux positions ouvertes. Il faudrait ajouter un état `high_water_price` par position (déjà disponible dans `coin_pool_states`).

---

## RÉSUMÉ EXÉCUTIF

| Question | Réponse |
|----------|---------|
| **Q1: Point d'insertion BUY** | Ligne ~3844 du coordinator, après fusion+confidence, avant execution |
| **Q2a: rsi_14 disponible ?** | ❌ Pas dans le coordinator, ✅ en DB (`market_features_v0`) — 1 query à ajouter |
| **Q2b: price_vs_ema50 ?** | ❌ Pas calculé — calculable depuis prix + ema_50 |
| **Q2c: ema_50 ?** | ❌ Pas dans le coordinator, ✅ en DB — même query que rsi_14 |
| **Q3: Sortie TP/SL** | Coordinator (TP/SL standard) + backend-shadow-engine (runner/trailing) |
| **Q4: Shadow** | ✅ **FAISABLE** — même pattern que fear_greed_shadow existant |
| **Q5: Métriques** | Queries SQL prêtes, exécutables après branchement shadow |
| **Q6: Trailing stop** | Déjà implémenté (runner mode). Global = modification minimale, architecture compatible |

### Prochaine étape recommandée

Implémenter le shadow `entry_filter_shadow` (Question 4) dans le coordinator.  
Attendre 48-72h de données shadow, puis exécuter les queries Q5.  
Décision d'activation (Phase 2) basée sur les résultats.
