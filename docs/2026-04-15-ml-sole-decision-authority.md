# Changelog — 15 avril 2026

## Résumé

Le ML devient la **seule source de décision BUY**. Le moteur de règles (fusion score / coordinator) est désactivé pour les entrées — il ne sert plus que de fallback si le service ML est indisponible.

---

## Fichier modifié

### `supabase/functions/backend-shadow-engine/index.ts`

---

## Logique BEFORE (lignes 1202–1336)

```
1. computeEdaShadow() → mlShadow
2. SI would_filter=true → HOLD (ml_filter_blocked), skip coordinator
3. SINON → construire intent, appeler coordinator
4. Coordinator décide BUY/HOLD via fusion score
5. ML et fusion score doivent TOUS DEUX être d'accord → quasi aucun trade ne passe
```

**Problème** : le ML et le coordinator étaient en série — les deux devaient dire "oui" pour qu'un BUY passe.

---

## Logique AFTER (lignes 1202–1434)

```
1. computeEdaShadow() → mlShadow

2. ML_SIGNAL_THRESHOLD = env var (défaut 0.90)

3. SI ML disponible (pas d'erreur) :
   ensembleProb = mlShadow.ensemble_prob ?? 0

   a. SI ensembleProb >= ML_SIGNAL_THRESHOLD :
      → Construire intent avec reason='ml_signal_buy'
      → Appeler coordinator pour EXÉCUTION seulement (pas pour décision)
      → execution_reason = 'ml_signal_buy'
      → Log: [ML_FILTER] XRP-EUR: ensemble_prob=0.9249 >= 0.90 → BUY

   b. SI ensembleProb < ML_SIGNAL_THRESHOLD :
      → HOLD directement, NE PAS appeler coordinator
      → execution_reason = 'ml_filter_blocked'
      → Log: [ML_FILTER] BTC-EUR: ensemble_prob=0.2822 < 0.90 → blocked

4. SI ML indisponible (erreur/timeout) :
      → FALLBACK : appeler coordinator normalement (fusion score)
      → Log: [ML_FILTER] BTC-EUR: ML service error (...), falling through to coordinator

NOTE: Le champ booléen `signal` retourné par Railway est IGNORÉ.
      Seul `ensemble_prob` vs ML_SIGNAL_THRESHOLD détermine le signal.
```

---

## Code supprimé

### Ancien bloc ML gate (lignes 1208–1249 AVANT)

```typescript
// ML gate: block BUY if would_filter=true AND no error (fail-open)
if (mlShadow && !mlShadow.error && mlShadow.would_filter) {
  // ... push HOLD decision, continue
}
if (mlShadow && !mlShadow.error) {
  console.log(`[ML_FILTER] ${symbol}: allowed (...)`);
}
```

Ce bloc filtrait en amont mais laissait ensuite le coordinator décider → double gate.

### Ancien appel coordinator inconditionnel (lignes 1251–1336 AVANT)

L'intent était construit avec `reason: 'backend_entry_evaluation'` et le coordinator avait le dernier mot via fusion score.

---

## Code ajouté

### 1. Branche ML signal=true (BUY direct)

```typescript
if (mlSignalBuy) {
  console.log(`[ML_FILTER] ${symbol}: BUY signal (ensemble_prob=...)`);

  const intent = {
    // ...
    confidence: mlShadow.ensemble_prob ?? 0.97,
    reason: 'ml_signal_buy',
    // ...
  };

  // Coordinator appelé pour EXÉCUTION, pas pour décision
  const { data, error } = await supabaseClient.functions.invoke(
    'trading-decision-coordinator',
    { body: { intent } }
  );
}
```

### 2. Branche ML signal=false (HOLD)

```typescript
} else {
  console.log(`[ML_FILTER] ${symbol}: blocked (ensemble_prob=...)`);
  allDecisions.push({
    // side: 'HOLD', action: 'HOLD', reason: 'ml_filter_blocked'
  });
  continue; // Coordinator JAMAIS appelé
}
```

### 3. Fallback coordinator (ML down)

```typescript
if (mlShadow?.error) {
  console.warn(`[ML_FILTER] ${symbol}: ML service error (...), falling through to coordinator`);
}
// ... ancien flux coordinator préservé comme filet de sécurité
```

---

## Code NON modifié

| Composant | Statut |
|-----------|--------|
| `computeEdaShadow()` | ❌ Non modifié |
| `mergeMlShadowIntoSnapshot()` | ❌ Non modifié |
| Logique SELL / TP / SL / trailing | ❌ Non modifié |
| Tables DB / schéma | ❌ Non modifié |

---

## Fichier modifié (2/2)

### `supabase/functions/trading-decision-coordinator/index.ts`

### ML Bypass — Fusion gate (ligne ~4074)

**BEFORE** :
```typescript
if (intent.side === 'BUY' && precomputedFusionData) {
  // fusion gate s'applique toujours → bloque si score < threshold
}
```

**AFTER** :
```typescript
const isMlSignalBuy = intent.reason === 'ml_signal_buy';
if (isMlSignalBuy) {
  console.log(`[ML_BYPASS] ${intent.symbol}: skipping fusion gate & confidence gate`);
}

if (intent.side === 'BUY' && precomputedFusionData && !isMlSignalBuy) {
  // fusion gate sautée si ML signal
}
```

### ML Bypass — Confidence gate (ligne ~4329)

**BEFORE** :
```typescript
if (effectiveConfidence !== null && effectiveConfidence < confidenceThreshold) {
  // → signal_too_weak → HOLD
}
```

**AFTER** :
```typescript
if (!isMlSignalBuy && effectiveConfidence !== null && effectiveConfidence < confidenceThreshold) {
  // → sauté si ML signal
}
```

---

## Impact

- **ML signal=true** → BUY exécuté (coordinator bypass fusion + confidence gates)
- **ML signal=false** → HOLD (coordinator jamais appelé)
- **ML down** → coordinator fallback (fusion score, comme avant la migration ML)
- Le fusion score n'est plus utilisé comme critère d'entrée quand le ML est disponible
- Les guards de sécurité du coordinator (exposure, circuit breakers, SL cooldown) restent actifs même pour les ML intents
