# Changelog — 15 avril 2026 (2/2)

## Résumé

Correction d'un gap critique de traçabilité : quand le ML bloquait un symbole (`ensemble_prob < ML_SIGNAL_THRESHOLD`), **aucun `decision_event` ni `decision_snapshot`** n'était créé. Le monitoring des valeurs `ensemble_prob` en temps réel était impossible pour les symboles bloqués.

**Après ce fix** : chaque symbole évalué par le ML (bloqué ou non) produit un `decision_event` + `decision_snapshot` avec le `ml_shadow` complet.

---

## Fichier modifié

### `supabase/functions/backend-shadow-engine/index.ts`

---

## Problème

Dans la branche `ml_filter_blocked` (ensemble_prob < seuil), le code :

1. Pushait un objet dans `allDecisions[]` (mémoire locale, jamais persisté en DB)
2. Appelait `mergeMlShadowIntoSnapshot()` — qui cherchait un `decision_event` récent pour y greffer le `ml_shadow`... mais ce `decision_event` **n'existait pas** puisque le coordinator n'était jamais appelé

**Résultat** : zéro trace en DB pour tous les symboles bloqués par le ML.

---

## Code supprimé (BEFORE)

### Ancien bloc ML blocked (lignes 1335–1369 AVANT)

```typescript
} else {
  // ===== ML says NO: HOLD — do not call coordinator =====
  console.log(
    `[ML_FILTER] ${symbol}: ensemble_prob=${ensembleProb.toFixed(4)} < ${ML_SIGNAL_THRESHOLD} → blocked`
  );

  allDecisions.push({
    symbol: baseSymbol,
    side: 'HOLD',
    action: 'HOLD',
    reason: 'ml_filter_blocked',
    confidence: 0,
    fusionScore: null,
    wouldExecute: false,
    timestamp: new Date().toISOString(),
    metadata: {
      strategyId: strategy.id,
      strategyName: strategy.strategy_name,
      price: currentPrice,
      intent_side: 'BUY',
      execution_status: 'BLOCKED',
      execution_reason: 'ml_filter_blocked',
      snapshot_type: 'ENTRY',
      ml_shadow: mlShadow,
    }
  });

  // ❌ mergeMlShadowIntoSnapshot cherche un decision_event qui n'existe pas
  if (strategy?.id) {
    try {
      await mergeMlShadowIntoSnapshot(supabaseClient, userId, strategy.id, baseSymbol, mlShadow);
    } catch (mergeErr: any) {
      console.warn(`[ml_shadow] ${baseSymbol}: merge failed (non-fatal): ${mergeErr?.message || mergeErr}`);
    }
  }
  continue;
}
```

**Problèmes** :
- `allDecisions.push()` → mémoire locale uniquement, jamais persisté
- `mergeMlShadowIntoSnapshot()` → échoue silencieusement car aucun `decision_event` n'existe pour ce symbole/cycle
- **Aucune ligne écrite dans `decision_events` ni `decision_snapshots`**

---

## Code ajouté (AFTER)

### Nouveau bloc ML blocked — écriture directe en DB

```typescript
} else {
  // ===== ML says NO: HOLD — do not call coordinator =====
  console.log(
    `[ML_FILTER] ${symbol}: ensemble_prob=${ensembleProb.toFixed(4)} < ${ML_SIGNAL_THRESHOLD} → blocked`
  );

  // ===== TRACEABILITY: write decision_event + decision_snapshot directly =====
  const nowIso = new Date().toISOString();
  let decisionEventId: string | null = null;
  try {
    const { data: deData, error: deError } = await supabaseClient
      .from('decision_events')
      .insert({
        user_id: userId,
        strategy_id: strategy.id,
        symbol: baseSymbol,
        side: 'HOLD',
        source: 'intelligent',
        reason: 'ml_filter_blocked',
        confidence: ensembleProb,
        entry_price: currentPrice,
        decision_ts: nowIso,
        metadata: {
          ml_shadow: mlShadow,
          engine: 'intelligent',
          context: effectiveShadowMode ? 'BACKEND_SHADOW' : 'BACKEND_LIVE',
          is_test_mode: strategyIsTestMode,
          backend_request_id: backendRequestId,
          ml_signal_threshold: ML_SIGNAL_THRESHOLD,
        },
      })
      .select('id')
      .single();

    if (deError) {
      console.warn(`[ML_FILTER] ${baseSymbol}: decision_event insert failed: ${deError.message}`);
    } else {
      decisionEventId = deData?.id ?? null;
    }
  } catch (deErr: any) {
    console.warn(`[ML_FILTER] ${baseSymbol}: decision_event insert error: ${deErr?.message}`);
  }

  // Write decision_snapshot with full ml_shadow for observability
  try {
    const { error: snapError } = await supabaseClient
      .from('decision_snapshots')
      .insert({
        user_id: userId,
        strategy_id: strategy.id,
        symbol: baseSymbol,
        side: 'HOLD',
        decision_result: 'HOLD',
        decision_reason: 'ml_filter_blocked',
        decision_id: decisionEventId,
        schema_version: 'v1',
        snapshot_type: 'ENTRY',
        timestamp_utc: nowIso,
        fusion_score: null,
        market_context_json: {
          entry_price: currentPrice,
          ml_shadow: mlShadow,
          ml_signal_threshold: ML_SIGNAL_THRESHOLD,
          ensemble_prob: ensembleProb,
        },
        signal_breakdown_json: null,
        guard_states_json: null,
      });

    if (snapError) {
      console.warn(`[ML_FILTER] ${baseSymbol}: decision_snapshot insert failed: ${snapError.message}`);
    } else {
      console.log(`[ML_FILTER] ${baseSymbol}: decision_snapshot written (decision_id=${decisionEventId})`);
    }
  } catch (snapErr: any) {
    console.warn(`[ML_FILTER] ${baseSymbol}: decision_snapshot insert error: ${snapErr?.message}`);
  }

  allDecisions.push({
    symbol: baseSymbol,
    side: 'HOLD',
    action: 'HOLD',
    reason: 'ml_filter_blocked',
    confidence: 0,
    fusionScore: null,
    wouldExecute: false,
    timestamp: nowIso,
    metadata: {
      strategyId: strategy.id,
      strategyName: strategy.strategy_name,
      price: currentPrice,
      intent_side: 'BUY',
      execution_status: 'BLOCKED',
      execution_reason: 'ml_filter_blocked',
      snapshot_type: 'ENTRY',
      ml_shadow: mlShadow,
    }
  });
  continue;
}
```

---

## Détail des changements

### 1. Insertion directe dans `decision_events`

| Champ | Valeur |
|-------|--------|
| `side` | `'HOLD'` |
| `source` | `'intelligent'` |
| `reason` | `'ml_filter_blocked'` |
| `confidence` | `ensembleProb` (valeur brute, ex: 0.2822) |
| `entry_price` | prix courant du symbole |
| `metadata.ml_shadow` | objet complet (ensemble_prob, stoch_k, rsi14, signal, would_filter, candle_count) |
| `metadata.ml_signal_threshold` | seuil utilisé (ex: 0.90) |

### 2. Insertion directe dans `decision_snapshots`

| Champ | Valeur |
|-------|--------|
| `side` | `'HOLD'` |
| `decision_result` | `'HOLD'` |
| `decision_reason` | `'ml_filter_blocked'` |
| `decision_id` | FK vers le `decision_events.id` créé juste avant |
| `schema_version` | `'v1'` |
| `snapshot_type` | `'ENTRY'` |
| `market_context_json.entry_price` | prix courant |
| `market_context_json.ml_shadow` | objet complet |
| `market_context_json.ml_signal_threshold` | seuil utilisé |
| `market_context_json.ensemble_prob` | probabilité brute (raccourci pour queries) |

### 3. Suppression de `mergeMlShadowIntoSnapshot()`

L'appel à `mergeMlShadowIntoSnapshot()` dans la branche blocked a été **supprimé** car :
- Il cherchait un `decision_event` qui n'existait pas (le coordinator n'est pas appelé)
- Il échouait silencieusement à chaque cycle
- Le snapshot est maintenant écrit directement, rendant le merge inutile

### 4. Logs ajoutés

| Log | Condition |
|-----|-----------|
| `[ML_FILTER] {symbol}: decision_event insert failed: ...` | Erreur d'insertion decision_event |
| `[ML_FILTER] {symbol}: decision_snapshot insert failed: ...` | Erreur d'insertion snapshot |
| `[ML_FILTER] {symbol}: decision_snapshot written (decision_id=...)` | Succès — snapshot écrit |

---

## Code NON modifié

| Composant | Statut |
|-----------|--------|
| Branche ML signal=true (BUY) | ❌ Non modifié |
| Branche ML fallback (coordinator) | ❌ Non modifié |
| `computeEdaShadow()` | ❌ Non modifié |
| `mergeMlShadowIntoSnapshot()` (fonction elle-même) | ❌ Non modifié (toujours utilisée dans la branche BUY) |
| `trading-decision-coordinator` | ❌ Non modifié |
| Logique SELL / TP / SL / trailing | ❌ Non modifié |
| Tables DB / schéma | ❌ Non modifié |

---

## Fichier modifié (2/2)

### `docs/2026-04-15-ml-sole-decision-authority.md`

Section "Branche ML signal=false (HOLD)" mise à jour pour refléter l'écriture directe du `decision_event` + `decision_snapshot`.

---

## Impact

- **ML signal=true** → BUY (inchangé, coordinator crée le snapshot)
- **ML signal=false** → HOLD + `decision_event` + `decision_snapshot` écrits directement par le backend-shadow-engine
- **ML down** → coordinator fallback (inchangé)
- Toutes les valeurs `ensemble_prob` sont maintenant traçables en temps réel via `decision_snapshots`

---

## Vérification post-déploiement

```sql
-- Snapshots ML blocked créés après déploiement
SELECT ds.symbol, ds.decision_reason,
       ds.market_context_json->'ml_shadow'->>'ensemble_prob' AS ensemble_prob,
       ds.market_context_json->>'ml_signal_threshold' AS threshold,
       ds.created_at
FROM decision_snapshots ds
WHERE ds.decision_reason = 'ml_filter_blocked'
  AND ds.created_at > '2026-04-15 22:00:00'
ORDER BY ds.created_at DESC LIMIT 10;
```

```sql
-- Vérifier zero orphans (decision_events sans snapshots)
SELECT de.id, de.symbol, de.reason, de.created_at
FROM decision_events de
LEFT JOIN decision_snapshots ds ON ds.decision_id = de.id
WHERE ds.id IS NULL
  AND de.reason = 'ml_filter_blocked'
  AND de.created_at > '2026-04-15 22:00:00';
```
