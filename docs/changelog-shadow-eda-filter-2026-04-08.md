# Changelog: Shadow EDA Filter (Phase 1a)

**Date** : 2026-04-08  
**Scope** : Ajout d'un filtre EDA en shadow mode dans `backend-shadow-engine`  
**Comportement modifié** : Aucun — observation pure, aucun trade bloqué

---

## Fichier modifié

### `supabase/functions/backend-shadow-engine/index.ts`

---

## Code ajouté

### 1. Variable d'environnement `SHADOW_ML_ENABLED`

```typescript
const SHADOW_ML_ENABLED = (Deno.env.get('SHADOW_ML_ENABLED') ?? 'true') === 'true';
```

- Défaut : `true` (activé)
- Permet de désactiver le calcul EDA sans redéployer, en mettant `SHADOW_ML_ENABLED=false` dans les secrets Supabase

---

### 2. Interface `EdaShadowResult`

```typescript
interface EdaShadowResult {
  model: string;        // toujours "eda_v1"
  stoch_k: number | null;
  rsi14: number | null;
  eda_signal: boolean;  // true = conditions de survente réunies (Stoch K < 10 ET RSI < 30)
  would_filter: boolean; // true = le trade AURAIT été bloqué (= eda_signal === false)
  candle_count: number;  // nombre de bougies 5m récupérées (attendu : 14)
  error?: string;
}
```

---

### 3. Fonction `computeEdaShadow()`

**Emplacement** : ajoutée comme fonction top-level dans le fichier, après la déclaration de `BACKEND_ENGINE_MODE`.

**Logique** :

```
1. Récupère les 14 dernières bougies 5m depuis market_ohlcv_raw
   (symbol, granularity='5m', ORDER BY ts_utc DESC, LIMIT 14)

2. Récupère le dernier RSI(14) depuis market_features_v0
   (symbol, granularity='5m', ORDER BY ts_utc DESC, LIMIT 1)

3. Les deux requêtes sont exécutées en parallèle (Promise.all)

4. Calcule le Stochastique K :
   stochK = ((close - lowestLow) / (highestHigh - lowestLow)) * 100
   - close = bougie la plus récente
   - highestHigh = max des 14 highs
   - lowestLow = min des 14 lows
   - Si highestHigh === lowestLow → stochK = 50 (évite division par zéro)

5. Calcule le signal EDA :
   eda_signal = stochK < 10 AND rsi14 < 30

6. would_filter = !eda_signal
   (= true si le filtre aurait bloqué le trade)
```

**Gestion d'erreurs** :
- Si < 14 bougies disponibles → retourne `stoch_k: null, would_filter: false`
- Si erreur quelconque → retourne le fallback avec `error: "message"`, ne fait jamais crasher le cycle

---

### 4. Appel dans la boucle BUY (évaluation d'entrée par symbole)

**Emplacement** : dans la boucle `for (const coin of selectedCoins)`, juste avant la construction de l'objet `intent` envoyé au coordinator.

**Code ajouté** :

```typescript
// ============= ML SHADOW: EDA v1 (observation only) =============
let mlShadow: EdaShadowResult | null = null;
if (SHADOW_ML_ENABLED) {
  mlShadow = await computeEdaShadow(supabaseClient, symbol);
}
```

---

### 5. Injection dans `intent.metadata`

Le résultat `ml_shadow` est injecté dans les métadonnées de l'intent BUY envoyé au coordinator :

```typescript
metadata: {
  // ... champs existants inchangés ...
  ...(mlShadow ? { ml_shadow: mlShadow } : {}),
},
```

Ceci garantit que `ml_shadow` est présent dans :
- `decision_events.metadata` (écrit par le coordinator)
- `decision_snapshots.market_context_json` (si le coordinator le propage)

---

### 6. Injection dans `allDecisions[].metadata` (réponse BUY)

Le résultat est aussi ajouté aux métadonnées de la décision BUY retournée par l'engine :

```typescript
metadata: {
  // ... champs existants ...
  ...(mlShadow ? { ml_shadow: mlShadow } : {}),
}
```

---

### 7. Injection dans `market_context_json` des snapshots EXIT

Pour les snapshots écrits directement par l'engine (EXIT/SELL/HOLD), `ml_shadow` est ajouté au `market_context_json` :

**Avant** :
```typescript
market_context_json: {
  entry_price: dec.metadata.price || dec.metadata.currentPrice || null,
  trigger: dec.metadata.trigger ?? dec.reason,
},
```

**Après** :
```typescript
market_context_json: {
  entry_price: dec.metadata.price || dec.metadata.currentPrice || null,
  trigger: dec.metadata.trigger ?? dec.reason,
  ml_shadow: dec.metadata.ml_shadow ?? null,
},
```

---

## Code supprimé

Aucun code supprimé.

---

## Code non modifié (explicitement préservé)

| Composant | Statut |
|-----------|--------|
| `trading-decision-coordinator` | ❌ Non modifié |
| Logique SELL / TP / SL / trailing | ❌ Non modifié |
| Logique BUY / fusion / confidence | ❌ Non modifié |
| Stratégies existantes | ❌ Non modifié |
| Tables DB / schéma | ❌ Non modifié |
| Flux d'exécution des trades | ❌ Non modifié |

---

## Données loguées par cycle

### Dans les logs console (par symbole) :

```
[ml_shadow] BTC-EUR: stochK=70.5 rsi14=48.6 eda_signal=false would_filter=true
[ml_shadow] ETH-EUR: stochK=67.2 rsi14=52.1 eda_signal=false would_filter=true
[ml_shadow] ADA-EUR: stochK=73.3 rsi14=51.2 eda_signal=false would_filter=true
[ml_shadow] DOGE-EUR: insufficient candles (0/14)
```

### Dans `decision_events.metadata.ml_shadow` :

```json
{
  "model": "eda_v1",
  "stoch_k": 70.5,
  "rsi14": 48.6,
  "eda_signal": false,
  "would_filter": true,
  "candle_count": 14
}
```

### Dans `decision_snapshots.market_context_json.ml_shadow` (snapshots EXIT) :

Même structure que ci-dessus, ou `null` si `SHADOW_ML_ENABLED=false`.

---

## Validation en production

Déployé et vérifié via les logs Edge Function le 2026-04-08 :

- ✅ 6 symboles avec données 5m complètes (BTC, ETH, SOL, XRP, ADA, AVAX) : calcul OK
- ✅ 3 symboles sans données 5m (DOGE, USDC, USDT) : fallback propre (`insufficient candles`)
- ✅ Aucun crash du cycle
- ✅ Aucun trade bloqué

---

## Prochaines étapes

1. Laisser tourner 1-2 semaines en shadow mode
2. Analyser la fréquence de `eda_signal=true` et corrélation avec les outcomes
3. Phase 1b : activer le filtre en live si les résultats shadow confirment l'amélioration
