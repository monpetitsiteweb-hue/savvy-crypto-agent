# Changelog : Propagation `xgb_prob` / `lstm_prob` dans `ml_shadow`

**Date** : 2026-04-20
**Scope** : Ajout des probabilités individuelles XGBoost et LSTM dans le payload `ml_shadow` stocké en base
**Comportement modifié** : Aucun — observation pure, aucune logique de décision changée

---

## Fichier modifié

### `supabase/functions/backend-shadow-engine/index.ts`

Un seul fichier touché, 3 zones modifiées.

---

## Modification 1 — Interface `MlPredictResponse` (lignes 37-45)

**Emplacement** : déclaration du type qui décrit la réponse JSON brute renvoyée par `POST /predict` (Railway).

### Avant

```typescript
interface MlPredictResponse {
  stoch_k?: number | null;
  rsi14?: number | null;
  eda_signal?: boolean | null;
  would_filter?: boolean | null;
  ensemble_prob?: number | null;
  signal?: string | null;
}
```

### Après

```typescript
interface MlPredictResponse {
  stoch_k?: number | null;
  rsi14?: number | null;
  eda_signal?: boolean | null;
  would_filter?: boolean | null;
  ensemble_prob?: number | null;
  xgb_prob?: number | null;     // ✅ ajouté
  lstm_prob?: number | null;    // ✅ ajouté
  signal?: string | null;
}
```

**Lignes ajoutées** : 2
**Lignes supprimées** : 0

---

## Modification 2 — Interface `EdaShadowResult` (lignes 48-58)

**Emplacement** : déclaration du type retourné par `computeEdaShadow()`. C'est cet objet qui est ensuite stocké tel quel dans :
- `decision_events.metadata.ml_shadow`
- `decision_snapshots.market_context_json.ml_shadow`

### Avant

```typescript
interface EdaShadowResult {
  stoch_k: number | null;
  rsi14: number | null;
  eda_signal: boolean;
  would_filter: boolean;
  ensemble_prob: number | null;
  signal: string | null;
  error?: string;
}
```

### Après

```typescript
interface EdaShadowResult {
  stoch_k: number | null;
  rsi14: number | null;
  eda_signal: boolean;
  would_filter: boolean;
  ensemble_prob: number | null;
  xgb_prob: number | null;      // ✅ ajouté
  lstm_prob: number | null;     // ✅ ajouté
  signal: string | null;
  error?: string;
}
```

**Lignes ajoutées** : 2
**Lignes supprimées** : 0

---

## Modification 3 — Objet `fallback` dans `computeEdaShadow()` (lignes 64-73)

**Emplacement** : valeur par défaut retournée en cas d'erreur ML, de timeout ou de bougies insuffisantes. Doit conformer à la nouvelle interface `EdaShadowResult`.

### Avant

```typescript
const fallback: EdaShadowResult = {
  stoch_k: null,
  rsi14: null,
  eda_signal: false,
  would_filter: false,
  ensemble_prob: null,
  signal: null,
};
```

### Après

```typescript
const fallback: EdaShadowResult = {
  stoch_k: null,
  rsi14: null,
  eda_signal: false,
  would_filter: false,
  ensemble_prob: null,
  xgb_prob: null,               // ✅ ajouté
  lstm_prob: null,              // ✅ ajouté
  signal: null,
};
```

**Lignes ajoutées** : 2
**Lignes supprimées** : 0

---

## Modification 4 — Mapping de la réponse `/predict` + log (lignes 127-149)

**Emplacement** : juste après la lecture de la réponse JSON du service Railway. C'est ici que les champs bruts sont convertis en `EdaShadowResult` typé.

### Avant

```typescript
const result = await response.json() as MlPredictResponse;
const mapped: EdaShadowResult = {
  stoch_k: result.stoch_k != null ? Number(result.stoch_k) : null,
  rsi14: result.rsi14 != null ? Number(result.rsi14) : null,
  eda_signal: typeof result.eda_signal === 'boolean' ? result.eda_signal : false,
  would_filter: typeof result.would_filter === 'boolean'
    ? result.would_filter
    : !(typeof result.eda_signal === 'boolean' ? result.eda_signal : false),
  ensemble_prob: result.ensemble_prob != null ? Number(result.ensemble_prob) : null,
  signal: result.signal != null ? String(result.signal) : null,
};

console.log(
  `[ml_shadow] ${symbol}: stochK=${mapped.stoch_k?.toFixed(1) ?? 'null'} ` +
  `rsi14=${mapped.rsi14?.toFixed(1) ?? 'null'} ` +
  `eda_signal=${mapped.eda_signal} would_filter=${mapped.would_filter} ` +
  `ensemble_prob=${mapped.ensemble_prob?.toFixed(4) ?? 'null'} signal=${mapped.signal ?? 'null'}`
);
```

### Après

```typescript
const result = await response.json() as MlPredictResponse;
const mapped: EdaShadowResult = {
  stoch_k: result.stoch_k != null ? Number(result.stoch_k) : null,
  rsi14: result.rsi14 != null ? Number(result.rsi14) : null,
  eda_signal: typeof result.eda_signal === 'boolean' ? result.eda_signal : false,
  would_filter: typeof result.would_filter === 'boolean'
    ? result.would_filter
    : !(typeof result.eda_signal === 'boolean' ? result.eda_signal : false),
  ensemble_prob: result.ensemble_prob != null ? Number(result.ensemble_prob) : null,
  xgb_prob: result.xgb_prob != null ? Number(result.xgb_prob) : null,     // ✅ ajouté
  lstm_prob: result.lstm_prob != null ? Number(result.lstm_prob) : null,  // ✅ ajouté
  signal: result.signal != null ? String(result.signal) : null,
};

console.log(
  `[ml_shadow] ${symbol}: stochK=${mapped.stoch_k?.toFixed(1) ?? 'null'} ` +
  `rsi14=${mapped.rsi14?.toFixed(1) ?? 'null'} ` +
  `eda_signal=${mapped.eda_signal} would_filter=${mapped.would_filter} ` +
  `ensemble_prob=${mapped.ensemble_prob?.toFixed(4) ?? 'null'} ` +
  `xgb_prob=${mapped.xgb_prob?.toFixed(4) ?? 'null'} ` +     // ✅ ajouté
  `lstm_prob=${mapped.lstm_prob?.toFixed(4) ?? 'null'} ` +   // ✅ ajouté
  `signal=${mapped.signal ?? 'null'}`
);
```

**Lignes ajoutées** : 4 (2 mapping + 2 log)
**Lignes supprimées** : 0 (le log existant a juste été éclaté sur plusieurs lignes pour lisibilité)

---

## Code supprimé

Aucun code supprimé. Modifications strictement additives.

---

## Code NON modifié (propagation automatique)

Les emplacements suivants n'ont **pas** été touchés car ils transportent l'objet `mlShadow` complet (spread ou affectation directe) — `xgb_prob` et `lstm_prob` y sont propagés automatiquement :

| Emplacement | Ligne approx. | Cible DB |
|---|---|---|
| `intent.metadata.ml_shadow = mlShadow` (BUY signal_buy) | ~1246 | `decision_events.metadata.ml_shadow` |
| `intent.metadata.ml_shadow = mlShadow` (BUY filter_blocked) | path ml_filter_blocked | `decision_events.metadata.ml_shadow` |
| `mergedContext.ml_shadow = mlShadow` (snapshot ENTRY) | ~206 | `decision_snapshots.market_context_json.ml_shadow` |
| `allDecisions[].metadata.ml_shadow` | propagation engine | retour HTTP de l'engine |

Aucune logique de décision, de filtrage, de seuil ou d'écriture DB n'a été modifiée.

---

## Vérification SQL après déploiement

À lancer après le prochain cycle (5 min) pour valider que les nouveaux champs apparaissent :

```sql
SELECT
  created_at,
  symbol,
  metadata->'ml_shadow'->>'ensemble_prob' AS ensemble_prob,
  metadata->'ml_shadow'->>'xgb_prob'      AS xgb_prob,
  metadata->'ml_shadow'->>'lstm_prob'     AS lstm_prob
FROM decision_events
WHERE created_at > NOW() - INTERVAL '10 minutes'
  AND metadata->'ml_shadow'->>'ensemble_prob' IS NOT NULL
ORDER BY created_at DESC
LIMIT 20;
```

Attendu :
- Si Railway renvoie bien `xgb_prob` / `lstm_prob` → valeurs numériques visibles
- Si Railway ne renvoie pas ces champs → colonnes `null` (comportement actuel observé pour 100 % des lignes historiques)

---

## Impact

| Aspect | État |
|---|---|
| Comportement trading | ❌ Inchangé |
| Logique de filtrage ML | ❌ Inchangée |
| Schéma DB | ❌ Inchangé (JSONB, donc pas de migration) |
| Logs Edge Function | ✅ Enrichis (xgb_prob + lstm_prob) |
| Observabilité SQL | ✅ Nouveaux champs disponibles |

---

## Récapitulatif des lignes touchées

| Modification | Lignes | Type |
|---|---|---|
| 1. Interface `MlPredictResponse` | 37-45 | +2 |
| 2. Interface `EdaShadowResult` | 48-58 | +2 |
| 3. Objet `fallback` | 64-73 | +2 |
| 4. Mapping + log | 127-149 | +4 (mapping +2, log +2) |
| **Total** | — | **+10 lignes ajoutées, 0 supprimée** |
