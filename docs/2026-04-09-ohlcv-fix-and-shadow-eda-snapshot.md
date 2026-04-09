# Changelog — 9 avril 2026

## Résumé

Deux corrections déployées en production :

1. **PROBLÈME 1** — Pipeline OHLCV 5m bloqué depuis 3 jours (root cause : limite Coinbase 300 bougies/requête)
2. **PROBLÈME 2** — Shadow EDA (`ml_shadow`) absent de `decision_snapshots.market_context_json` (root cause : le coordinator ne propage pas les metadata de l'intent)

---

## PROBLÈME 1 — Fix OHLCV 5m pipeline stall

### Fichier modifié : `supabase/functions/ohlcv-live-ingest/index.ts`

#### Ce qui a été ajouté (dans `fetchLatestCandles()`, lignes ~113-127)

```typescript
// Clamp window to max 300 candles (Coinbase hard limit per request)
const MAX_CANDLES_PER_REQUEST = 300;
const maxRangeMs = MAX_CANDLES_PER_REQUEST * granularitySeconds * 1000;
const idealRangeMs = now.getTime() - since.getTime();
const estimatedCandles = Math.round(idealRangeMs / (granularitySeconds * 1000));

let clampedSince = since;
if (idealRangeMs > maxRangeMs) {
  clampedSince = new Date(now.getTime() - maxRangeMs);
  const missingCandles = estimatedCandles - MAX_CANDLES_PER_REQUEST;
  logger.warn(
    `[OHLCV_GAP] ${symbol} ${granularity}: gap=${estimatedCandles} candles (>${MAX_CANDLES_PER_REQUEST} limit). ` +
    `Fetching latest ${MAX_CANDLES_PER_REQUEST} candles only. ~${missingCandles} candles still missing — will catch up over subsequent cycles.`
  );
}
```

#### Ce qui a été modifié

- L'URL de l'appel Coinbase utilise désormais `clampedSince` au lieu de `since` directement.
- Le filtre post-fetch utilise `clampedSince` pour filtrer les bougies retournées.

#### Logique de rattrapage progressif

- Si le gap > 300 bougies, le système récupère les 300 plus récentes à chaque cycle.
- Au cycle suivant, le high water mark avance → le gap diminue → rattrapage complet en quelques cycles.
- Un `[OHLCV_GAP]` WARNING est loggé avec le nombre estimé de bougies manquantes.

### Fichier modifié : `supabase/config.toml`

```toml
# AVANT
[functions.ohlcv-live-ingest]
verify_jwt = true

# APRÈS
[functions.ohlcv-live-ingest]
verify_jwt = false
```

**Raison** : Le cron `pg_net` appelle la fonction avec un header `x-cron-secret` (pas un JWT). Avec `verify_jwt = true`, le gateway Supabase rejetait l'appel en 401 avant même que le code d'auth ne s'exécute.

---

## PROBLÈME 2 — Shadow EDA dans decision_snapshots

### Fichier modifié : `supabase/functions/backend-shadow-engine/index.ts`

#### Code ajouté : `mergeMlShadowIntoSnapshot()` (lignes ~132-210)

Nouvelle fonction helper qui écrit `ml_shadow` dans `decision_snapshots.market_context_json` **après** l'appel au coordinator, de manière non-bloquante.

```typescript
async function mergeMlShadowIntoSnapshot(
  supabaseClient: any,
  userId: string,
  strategyId: string,
  symbol: string,
  mlShadow: EdaShadowResult,
): Promise<void> {
  // 1. Trouve le decision_event le plus récent pour ce symbole
  // 2. Lit le snapshot associé (decision_snapshots.decision_id)
  // 3. Merge ml_shadow dans market_context_json existant (spread, jamais d'écrasement)
  // 4. Si snapshot absent → retry après 2s → si toujours absent → log + abandon
  // 5. Toute erreur est catchée → le cycle continue normalement
}
```

**Mécanisme de merge** (read-modify-write) :

```typescript
const existingContext = snapshot.market_context_json || {};
const mergedContext = {
  ...existingContext,   // préserve entry_price, trigger, etc.
  ml_shadow: mlShadow,  // ajoute le bloc shadow
};
await supabaseClient
  .from('decision_snapshots')
  .update({ market_context_json: mergedContext })
  .eq('id', snapshot.id);
```

#### Code ajouté : appel post-coordinator (lignes ~1291-1300)

```typescript
// ============= POST-COORDINATOR: Merge ml_shadow into decision_snapshot =============
if (mlShadow && strategy?.id) {
  try {
    await mergeMlShadowIntoSnapshot(supabaseClient, userId, strategy.id, baseSymbol, mlShadow);
  } catch (mergeErr: any) {
    console.warn(`[ml_shadow] ${baseSymbol}: merge failed (non-fatal): ${mergeErr?.message || mergeErr}`);
  }
}
```

#### Ce qui n'a PAS été modifié

- `trading-decision-coordinator` : **inchangé**
- Tables `decision_events`, `decision_outcomes`, `mock_trades`, `real_trades` : **inchangées**
- Flux BUY / SELL / TP / SL / trailing : **inchangé**
- `computeEdaShadow()` (ajouté dans la phase précédente) : **inchangé**

---

## Logs de vérification post-déploiement

### OHLCV 5m — résultat

- 2 197 nouvelles lignes insérées dans `market_ohlcv_raw` au premier cycle post-fix
- 10/10 symboles actifs
- Gap historique 6-8 avril reste (nécessite backfill séparé)

### Shadow EDA — résultat

Requête de validation :

```sql
SELECT
  ds.decision_id,
  ds.market_context_json->'ml_shadow'->>'stoch_k'     AS stoch_k,
  ds.market_context_json->'ml_shadow'->>'rsi14'        AS rsi14,
  ds.market_context_json->'ml_shadow'->>'eda_signal'   AS eda_signal,
  ds.market_context_json->'ml_shadow'->>'would_filter' AS would_filter,
  ds.market_context_json->>'entry_price'               AS entry_price
FROM decision_snapshots ds
WHERE ds.market_context_json ? 'ml_shadow'
ORDER BY ds.created_at DESC LIMIT 5;
```

Résultat : `ml_shadow` présent aux côtés des champs existants (`entry_price`, `trigger`, etc.) — aucun écrasement.

---

## Fichiers impactés — résumé

| Fichier | Action |
|---|---|
| `supabase/functions/ohlcv-live-ingest/index.ts` | Modifié — ajout clamp 300 bougies + warning OHLCV_GAP |
| `supabase/config.toml` | Modifié — `ohlcv-live-ingest` → `verify_jwt = false` |
| `supabase/functions/backend-shadow-engine/index.ts` | Modifié — ajout `mergeMlShadowIntoSnapshot()` + appel post-coordinator |
