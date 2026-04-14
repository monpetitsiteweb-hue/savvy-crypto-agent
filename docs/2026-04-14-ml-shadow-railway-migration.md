# Changelog — 14 avril 2026

## Résumé

Migration du calcul `ml_shadow` : remplacement du calcul local (Stoch K + RSI) par un appel au service ML FastAPI déployé sur Railway.

---

## Fichier modifié

### `supabase/functions/backend-shadow-engine/index.ts`

---

## Code supprimé (lignes 32–125 AVANT)

### Interface `EdaShadowResult` (ancienne)

```typescript
interface EdaShadowResult {
  model: string;        // supprimé
  stoch_k: number | null;
  rsi14: number | null;
  eda_signal: boolean;
  would_filter: boolean;
  candle_count: number; // supprimé
  error?: string;
}
```

### Fonction `computeEdaShadow()` (ancienne)

Supprimée en totalité. Cette fonction :
- Récupérait 14 bougies 5m depuis `market_ohlcv_raw`
- Récupérait RSI(14) depuis `market_features_v0`
- Calculait Stochastic K localement
- Calculait `eda_signal = stochK < 10 && rsi14 < 30`

---

## Code ajouté (lignes 32–152 APRÈS)

### 1. Variable `ML_SERVICE_URL`

```typescript
const ML_SERVICE_URL = (Deno.env.get('ML_SERVICE_URL') ?? 'https://savvy-crypto-ml-production.up.railway.app').replace(/\/+$/, '');
```

- Lue depuis les secrets Supabase Edge Functions
- Fallback hardcodé vers l'URL Railway actuelle
- Trailing slash nettoyé

### 2. Interface `MlPredictResponse` (nouvelle)

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

### 3. Interface `EdaShadowResult` (modifiée)

```typescript
interface EdaShadowResult {
  stoch_k: number | null;
  rsi14: number | null;
  eda_signal: boolean;
  would_filter: boolean;
  ensemble_prob: number | null;  // NOUVEAU
  signal: string | null;         // NOUVEAU
  error?: string;
}
```

Champs supprimés : `model`, `candle_count`
Champs ajoutés : `ensemble_prob`, `signal`

### 4. Fonction `computeEdaShadow()` (réécrite)

**Nouvelle logique** :

```
1. Récupère les 300 dernières bougies 5m depuis market_ohlcv_raw
   (symbol, granularity='5m', ORDER BY ts_utc DESC, LIMIT 300)

2. Construit le payload pour le service ML :
   {
     symbol: "BTC-EUR",
     candles: [
       { candle_time, open_price, high_price, low_price, close_price, volume }
       × 300, triées chronologiquement (reverse)
     ]
   }

3. Appelle POST ML_SERVICE_URL/predict
   - Timeout 5 secondes (AbortController)
   - Content-Type: application/json

4. Mappe la réponse dans EdaShadowResult :
   - stoch_k, rsi14, eda_signal, would_filter → mappés directement
   - ensemble_prob → nouveau champ (probabilité ensemble ML)
   - signal → nouveau champ (signal binaire du modèle)
   - would_filter déduit de eda_signal si absent de la réponse

5. Fallback si erreur ou timeout :
   - Retourne fallback avec error message
   - Ne crashe jamais le cycle
   - Timeout spécifique : "ML service timeout after 5000ms"
```

**Code complet** :

```typescript
async function computeEdaShadow(
  supabaseClient: any,
  symbol: string
): Promise<EdaShadowResult> {
  const fallback: EdaShadowResult = {
    stoch_k: null, rsi14: null, eda_signal: false,
    would_filter: false, ensemble_prob: null, signal: null,
  };

  try {
    const { data: candles, error: candlesError } = await supabaseClient
      .from('market_ohlcv_raw')
      .select('ts_utc, open, high, low, close, volume')
      .eq('symbol', symbol)
      .eq('granularity', '5m')
      .order('ts_utc', { ascending: false })
      .limit(300);

    if (candlesError) throw new Error(`candle fetch failed: ${candlesError.message}`);
    if (!candles || candles.length < 300) {
      return { ...fallback, error: `insufficient candles (${candles?.length ?? 0}/300)` };
    }

    const payload = {
      symbol,
      candles: [...candles].reverse().map((c: any) => ({
        candle_time: c.ts_utc,
        open_price: Number(c.open),
        high_price: Number(c.high),
        low_price: Number(c.low),
        close_price: Number(c.close),
        volume: c.volume != null ? Number(c.volume) : 0,
      })),
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    let response: Response;
    try {
      response = await fetch(`${ML_SERVICE_URL}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally { clearTimeout(timeoutId); }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ML service ${response.status}: ${errorText.slice(0, 300)}`);
    }

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
    return mapped;
  } catch (err: any) {
    const message = err?.name === 'AbortError'
      ? 'ML service timeout after 5000ms'
      : err?.message || 'unknown';
    console.error(`[ml_shadow] ${symbol}: error:`, message);
    return { ...fallback, error: message };
  }
}
```

---

## Code modifié (ligne ~1502)

### Bloc catch principal — typage erreur

**AVANT** :
```typescript
} catch (error) {
    console.error(`🌑 ${BACKEND_ENGINE_MODE}: Fatal error:`, error);
    return new Response(JSON.stringify({ 
      ...
      error: error.message,
```

**APRÈS** :
```typescript
} catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`🌑 ${BACKEND_ENGINE_MODE}: Fatal error:`, error);
    return new Response(JSON.stringify({ 
      ...
      error: errorMessage,
```

Correction du type-check Deno (`error` est `unknown`, pas `Error`).

---

## Code NON modifié (explicitement préservé)

| Composant | Statut |
|-----------|--------|
| `trading-decision-coordinator` | ❌ Non modifié |
| `mergeMlShadowIntoSnapshot()` | ❌ Non modifié |
| Logique SELL / TP / SL / trailing | ❌ Non modifié |
| Appel au coordinator (L1240) | ❌ Non modifié |
| `allDecisions[].metadata.ml_shadow` (L1319) | ❌ Non modifié |
| Intent BUY `.metadata.ml_shadow` (L1232) | ❌ Non modifié |
| Post-coordinator merge (L1326) | ❌ Non modifié |
| Tables DB / schéma | ❌ Non modifié |

---

## Données loguées par cycle (nouveau format)

### Dans les logs console (par symbole) :

```
[ml_shadow] BTC-EUR: stochK=46.4 rsi14=47.3 eda_signal=false would_filter=true ensemble_prob=0.2909 signal=false
[ml_shadow] SOL-EUR: stochK=7.7 rsi14=19.5 eda_signal=true would_filter=false ensemble_prob=0.9812 signal=true
[ml_shadow] DOGE-EUR: insufficient candles (0/300)
```

### Dans `decision_snapshots.market_context_json.ml_shadow` :

```json
{
  "stoch_k": 46.4,
  "rsi14": 47.3,
  "eda_signal": false,
  "would_filter": true,
  "ensemble_prob": 0.2909,
  "signal": "false"
}
```

---

## Validation en production

Déployé et vérifié via les logs Edge Function le 2026-04-14 :

- ✅ BTC-EUR : appel ML OK, `ensemble_prob=0.2909`, `signal=false`
- ✅ SOL-EUR : appel ML OK, `ensemble_prob` retourné
- ✅ DOGE-EUR : fallback propre (`insufficient candles 0/300`)
- ✅ Aucun crash du cycle
- ✅ Aucun trade bloqué (mode observation maintenu)
- ✅ Healthcheck Railway : `{"status":"ok","models_loaded":{"xgboost":true,"random_forest":true,"lstm":true}}`

---

## Prochaine étape

Activer le filtre ML en live : si `would_filter=true` → bloquer le BUY avant l'appel au coordinator.
