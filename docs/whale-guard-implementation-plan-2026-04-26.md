# Whale Guard — Plan d'implémentation (DRAFT, non déployé)

**Cible** : `supabase/functions/backend-shadow-engine/index.ts`
**Statut** : Code rédigé, **NON déployé**, en attente de validation utilisateur.

---

## Résumé du comportement

- **Scope** : BUY uniquement (chemins `ml_signal_buy` et `trend_signal_buy`). Les SELL ne sont JAMAIS touchés.
- **Position** : entre la décision BUY (ML ou TREND) et l'appel `supabaseClient.functions.invoke('trading-decision-coordinator', …)`.
- **Source de vérité** : table `live_signals`, sources `whale_alert_ws` + `whale_alert_api`, `signal_type = 'whale_exchange_inflow'`, fenêtre 30 min.
- **Seuil par défaut** : `amount_usd > 500 000`.
- **Désactivation runtime** : env `WHALE_GUARD_ENABLED` (défaut `true`).
- **Seuil runtime** : env `WHALE_MIN_USD` (défaut `500000`).
- **Symbol matching** : on cherche `[BASE, BASE-EUR, BASE-USD]` (ex. `BTC`, `BTC-EUR`, `BTC-USD`).
- **Comportement si déclenché** :
  1. **PAS** d'appel coordinator.
  2. Insertion d'une ligne dans `decision_events` avec `reason = 'whale_bearish_blocked'`.
  3. Push dans `allDecisions` avec `execution_status = 'BLOCKED'` pour traçabilité UI.
  4. Log : `[WHALE_GUARD] SYMBOL: exchange_inflow $X USD détecté il y a Y min → BUY bloqué`.
  5. `continue;` → on saute à la prochaine itération de la boucle symbole.

---

## 1. Ajout des constantes d'environnement

### Localisation
Fichier : `supabase/functions/backend-shadow-engine/index.ts`
**Après la ligne 35** (juste après `ML_SIGNAL_THRESHOLD`).

### Code à insérer

```ts
// ============= WHALE GUARD CONFIG =============
const WHALE_GUARD_ENABLED = (Deno.env.get('WHALE_GUARD_ENABLED') ?? 'true') === 'true';
const WHALE_MIN_USD = Number(Deno.env.get('WHALE_MIN_USD') ?? '500000');
const WHALE_GUARD_WINDOW_MIN = 30; // fenêtre fixe demandée
```

---

## 2. Ajout de la fonction helper `checkWhaleBearishGuard`

### Localisation
Fichier : `supabase/functions/backend-shadow-engine/index.ts`
**À insérer juste avant la fonction `serve(...)` ou en haut du module** (zone des helpers, avant ligne ~900). Concrètement, je propose de l'insérer **juste après la définition des constantes** (après la nouvelle ligne ajoutée au point 1) pour rester groupé, mais une zone helpers existe vers la ligne 880-920 — n'importe laquelle convient.

### Code à insérer

```ts
/**
 * WHALE GUARD — bloque un BUY si un gros exchange_inflow récent est détecté.
 * Retourne { blocked: true, reason, amount_usd, ageMin } si on doit bloquer,
 * sinon { blocked: false }.
 *
 * Ne lit que la table live_signals. Lecture seule. Aucun side-effect.
 */
async function checkWhaleBearishGuard(
  supabase: any,
  baseSymbol: string
): Promise<{ blocked: boolean; amount_usd?: number; ageMin?: number; created_at?: string }> {
  if (!WHALE_GUARD_ENABLED) return { blocked: false };

  // Normalisation : on cherche les 3 variantes possibles en base
  const candidates = [baseSymbol, `${baseSymbol}-EUR`, `${baseSymbol}-USD`];
  const sinceIso = new Date(Date.now() - WHALE_GUARD_WINDOW_MIN * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('live_signals')
    .select('signal_type, signal_strength, data, created_at')
    .in('symbol', candidates)
    .in('source', ['whale_alert_ws', 'whale_alert_api'])
    .eq('signal_type', 'whale_exchange_inflow')
    .gt('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    console.warn(`[WHALE_GUARD] ${baseSymbol}: query error → fail-open (${error.message})`);
    return { blocked: false };
  }
  if (!data || data.length === 0) return { blocked: false };

  const row = data[0];
  const rawAmount = row?.data?.amount_usd;
  const amountUsd = typeof rawAmount === 'string' ? parseFloat(rawAmount) : Number(rawAmount ?? 0);

  if (!Number.isFinite(amountUsd) || amountUsd <= WHALE_MIN_USD) {
    return { blocked: false };
  }

  const ageMin = Math.round((Date.now() - new Date(row.created_at).getTime()) / 60000);
  return { blocked: true, amount_usd: amountUsd, ageMin, created_at: row.created_at };
}
```

---

## 3. Branchement du guard sur le chemin `ml_signal_buy`

### Localisation
Fichier : `supabase/functions/backend-shadow-engine/index.ts`
**Entre la ligne 1349 (fin du log `[ML_FILTER]`) et la ligne 1351 (`const intent = {…}`)**.

### Code AVANT (lignes 1345-1352)

```ts
            if (mlSignalBuy) {
              // ===== ML SIGNAL BUY: bypass coordinator entirely =====
              console.log(
                `[ML_FILTER] ${symbol}: ensemble_prob=${ensembleProb.toFixed(4)} >= ${ML_SIGNAL_THRESHOLD} → BUY`
              );

              const intent = {
```

### Code APRÈS (insertion entre les deux blocs)

```ts
            if (mlSignalBuy) {
              // ===== ML SIGNAL BUY: bypass coordinator entirely =====
              console.log(
                `[ML_FILTER] ${symbol}: ensemble_prob=${ensembleProb.toFixed(4)} >= ${ML_SIGNAL_THRESHOLD} → BUY`
              );

              // ===== WHALE GUARD (BUY only, pre-coordinator) =====
              const whaleCheck = await checkWhaleBearishGuard(supabaseClient, baseSymbol);
              if (whaleCheck.blocked) {
                const usd = whaleCheck.amount_usd!;
                const ageMin = whaleCheck.ageMin!;
                console.log(
                  `[WHALE_GUARD] ${baseSymbol}: exchange_inflow $${usd.toFixed(0)} USD détecté il y a ${ageMin} min → BUY bloqué`
                );

                try {
                  await supabaseClient.from('decision_events').insert({
                    user_id: userId,
                    strategy_id: strategy.id,
                    symbol: baseSymbol,
                    side: 'HOLD',
                    source: 'intelligent',
                    reason: 'whale_bearish_blocked',
                    confidence: mlShadow.ensemble_prob ?? 0.97,
                    metadata: {
                      blocked_by: 'whale_guard',
                      blocked_intent: 'ml_signal_buy',
                      whale_amount_usd: usd,
                      whale_age_min: ageMin,
                      whale_signal_at: whaleCheck.created_at,
                      whale_min_usd_threshold: WHALE_MIN_USD,
                      whale_window_min: WHALE_GUARD_WINDOW_MIN,
                      execution_status: 'BLOCKED',
                      execution_reason: 'whale_bearish_blocked',
                      ml_shadow: { ...mlShadow, closes: undefined },
                      price: currentPrice,
                    },
                  });
                } catch (e) {
                  console.warn(`[WHALE_GUARD] decision_events insert failed for ${baseSymbol}: ${(e as Error).message}`);
                }

                allDecisions.push({
                  symbol: baseSymbol,
                  side: 'HOLD',
                  action: 'BLOCKED',
                  reason: 'whale_bearish_blocked',
                  confidence: mlShadow.ensemble_prob ?? 0.97,
                  fusionScore: null,
                  wouldExecute: false,
                  timestamp: new Date().toISOString(),
                  metadata: {
                    strategyId: strategy.id,
                    strategyName: strategy.strategy_name,
                    price: currentPrice,
                    intent_side: 'BUY',
                    execution_status: 'BLOCKED',
                    execution_reason: 'whale_bearish_blocked',
                    snapshot_type: 'ENTRY',
                    ml_shadow: { ...mlShadow, closes: undefined },
                    whale_guard: {
                      amount_usd: usd,
                      age_min: ageMin,
                      threshold_usd: WHALE_MIN_USD,
                      window_min: WHALE_GUARD_WINDOW_MIN,
                    },
                  },
                });
                continue;
              }

              const intent = {
```

(le reste du chemin `ml_signal_buy` est inchangé)

---

## 4. Branchement du guard sur le chemin `trend_signal_buy`

### Localisation
Fichier : `supabase/functions/backend-shadow-engine/index.ts`
**Entre la ligne 1466 (fin du log `[TREND_SIGNAL] … → BUY`) et la ligne 1468 (`const trendSignalMeta = {…}`)**.

### Code AVANT (lignes 1460-1469)

```ts
              if (trend.triggered) {
                // ===== TREND SIGNAL BUY: bypass coordinator gates (like ml_signal_buy) =====
                console.log(
                  `[TREND_SIGNAL] ${symbol}: stoch_k=${trend.stoch_k?.toFixed(1)} rsi14=${trend.rsi14?.toFixed(1)} ` +
                  `ema9=${trend.ema9?.toFixed(2)} ema21=${trend.ema21?.toFixed(2)} ema50=${trend.ema50?.toFixed(2)} ` +
                  `ema200=${trend.ema200?.toFixed(2)} slope48=${trend.ema200_slope_48?.toFixed(5)} → BUY`
                );

                const trendSignalMeta = {
```

### Code APRÈS (insertion entre les deux blocs)

```ts
              if (trend.triggered) {
                // ===== TREND SIGNAL BUY: bypass coordinator gates (like ml_signal_buy) =====
                console.log(
                  `[TREND_SIGNAL] ${symbol}: stoch_k=${trend.stoch_k?.toFixed(1)} rsi14=${trend.rsi14?.toFixed(1)} ` +
                  `ema9=${trend.ema9?.toFixed(2)} ema21=${trend.ema21?.toFixed(2)} ema50=${trend.ema50?.toFixed(2)} ` +
                  `ema200=${trend.ema200?.toFixed(2)} slope48=${trend.ema200_slope_48?.toFixed(5)} → BUY`
                );

                // ===== WHALE GUARD (BUY only, pre-coordinator) =====
                const whaleCheckTrend = await checkWhaleBearishGuard(supabaseClient, baseSymbol);
                if (whaleCheckTrend.blocked) {
                  const usd = whaleCheckTrend.amount_usd!;
                  const ageMin = whaleCheckTrend.ageMin!;
                  console.log(
                    `[WHALE_GUARD] ${baseSymbol}: exchange_inflow $${usd.toFixed(0)} USD détecté il y a ${ageMin} min → BUY bloqué`
                  );

                  try {
                    await supabaseClient.from('decision_events').insert({
                      user_id: userId,
                      strategy_id: strategy.id,
                      symbol: baseSymbol,
                      side: 'HOLD',
                      source: 'intelligent',
                      reason: 'whale_bearish_blocked',
                      confidence: 0.85,
                      metadata: {
                        blocked_by: 'whale_guard',
                        blocked_intent: 'trend_signal_buy',
                        whale_amount_usd: usd,
                        whale_age_min: ageMin,
                        whale_signal_at: whaleCheckTrend.created_at,
                        whale_min_usd_threshold: WHALE_MIN_USD,
                        whale_window_min: WHALE_GUARD_WINDOW_MIN,
                        execution_status: 'BLOCKED',
                        execution_reason: 'whale_bearish_blocked',
                        ml_shadow: mlShadowForStorage,
                        price: currentPrice,
                      },
                    });
                  } catch (e) {
                    console.warn(`[WHALE_GUARD] decision_events insert failed for ${baseSymbol}: ${(e as Error).message}`);
                  }

                  allDecisions.push({
                    symbol: baseSymbol,
                    side: 'HOLD',
                    action: 'BLOCKED',
                    reason: 'whale_bearish_blocked',
                    confidence: 0.85,
                    fusionScore: null,
                    wouldExecute: false,
                    timestamp: new Date().toISOString(),
                    metadata: {
                      strategyId: strategy.id,
                      strategyName: strategy.strategy_name,
                      price: currentPrice,
                      intent_side: 'BUY',
                      execution_status: 'BLOCKED',
                      execution_reason: 'whale_bearish_blocked',
                      snapshot_type: 'ENTRY',
                      ml_shadow: mlShadowForStorage,
                      whale_guard: {
                        amount_usd: usd,
                        age_min: ageMin,
                        threshold_usd: WHALE_MIN_USD,
                        window_min: WHALE_GUARD_WINDOW_MIN,
                      },
                    },
                  });
                  continue;
                }

                const trendSignalMeta = {
```

(le reste du chemin `trend_signal_buy` est inchangé)

---

## 5. Ce qui n'est PAS modifié

- ❌ Aucun changement dans le chemin SELL (lignes ~1123-1280) — les SELL ne sont jamais touchés.
- ❌ Aucun changement dans le chemin fallback ML-down (lignes ~1707+) — la consigne couvre uniquement `ml_signal_buy` et `trend_signal_buy`. (À confirmer si tu veux aussi l'appliquer au fallback.)
- ❌ Aucun changement dans `trading-decision-coordinator/index.ts`.
- ❌ Aucun changement de schéma DB — `decision_events` accepte déjà des `reason` libres.
- ❌ Aucune nouvelle dépendance.

---

## 6. Vérifications post-déploiement (ce que je ferai après ton OK)

```sql
-- 1. Compter les blocages whale sur la dernière heure
SELECT symbol, reason, COUNT(*)
FROM decision_events
WHERE created_at > NOW() - INTERVAL '1 hour'
  AND reason = 'whale_bearish_blocked'
GROUP BY symbol, reason;

-- 2. Détail d'un blocage récent
SELECT created_at, symbol,
       metadata->>'blocked_intent' AS blocked_intent,
       metadata->>'whale_amount_usd' AS amount_usd,
       metadata->>'whale_age_min' AS age_min
FROM decision_events
WHERE reason = 'whale_bearish_blocked'
ORDER BY created_at DESC
LIMIT 10;
```

Plus inspection des logs `[WHALE_GUARD]` dans la fonction.

---

## 7. Questions ouvertes (à confirmer avant déploiement)

1. **Fallback ML-down** : appliquer aussi le whale guard sur le chemin de secours coordinator (lignes ~1707+) ? Tu n'as pas mentionné ce chemin, donc **par défaut je ne l'ajoute PAS**.
2. **Symbol matching** : la table `live_signals` montre des entrées `BTC`, `BTC-EUR`, `USDT`, `XRP-EUR`, etc. La normalisation `[BASE, BASE-EUR, BASE-USD]` couvre ce qui est observé. OK ?
3. **`amount_usd` typage** : en base c'est un `number` (vu dans l'audit), mais le helper convertit aussi depuis string par sécurité. OK ?

---

**Prêt à déployer dès ton GO. Je ne touche à rien tant que tu n'as pas validé.**
