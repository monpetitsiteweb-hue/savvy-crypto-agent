# FIX 2 — Diversity Gate → Pénalité (P0)

**Fichier modifié :** `supabase/functions/trading-decision-coordinator/index.ts`  
**Déployé :** ✅ Oui

---

## Changement 1 : Remplacement du hard gate (lignes 297-313)

### BEFORE

```typescript
    // === FIX 3: Minimum signal diversity check ===
    const uniqueSources = new Set(processedSignals.map(ps => ps.signal.source));
    if (uniqueSources.size < MIN_UNIQUE_SOURCES) {
      console.log(`[SignalFusion] ${symbol}: insufficient diversity (${uniqueSources.size} sources < ${MIN_UNIQUE_SOURCES})`);
      return {
        fusedScore: 0,
        details,
        totalSignals: rawCount,
        enabledSignals: processedSignals.length,
        signals_used: signalsUsed,
        source_contributions: {},
        fusion_version: FUSION_VERSION,
        insufficient_diversity: true,
        unique_sources_count: uniqueSources.size,
        deduplicated_signal_count: dedupedSignals.length,
      };
    }
```

### AFTER

```typescript
    // === FIX 2: Diversity penalty (replaces hard gate) ===
    const uniqueSources = new Set(processedSignals.map(ps => ps.signal.source));
    const SINGLE_SOURCE_PENALTY = 0.5;
    const hasDiversityPenalty = uniqueSources.size < MIN_UNIQUE_SOURCES;
    if (hasDiversityPenalty) {
      console.log(`[SignalFusion] ${symbol}: low diversity (${uniqueSources.size} source(s) < ${MIN_UNIQUE_SOURCES}), applying ${SINGLE_SOURCE_PENALTY}x penalty instead of blocking`);
    }
```

### Problème résolu
- Avant : si 1 seule source → `fusedScore = 0` (HOLD forcé), le moteur est **paralysé** quand seul `technical_analysis` a des signaux
- Après : le calcul continue normalement, avec un flag `hasDiversityPenalty` pour appliquer la pénalité en aval

---

## Changement 2 : Application de la pénalité sur fusedScore (ligne 347)

### BEFORE

```typescript
    const fusedScore = Math.max(-100, Math.min(100, convictionScore * 100));
```

### AFTER

```typescript
    let fusedScore = Math.max(-100, Math.min(100, convictionScore * 100));

    // Apply diversity penalty if only 1 source (FIX 2)
    if (hasDiversityPenalty) {
      const originalScore = fusedScore;
      fusedScore = Math.round(fusedScore * SINGLE_SOURCE_PENALTY);
      console.log(`[SignalFusion] ${symbol}: diversity penalty applied: ${originalScore.toFixed(2)} → ${fusedScore}`);
    }
```

---

## Résumé

| Aspect | Avant | Après |
|--------|-------|-------|
| 1 seule source | `fusedScore = 0` (HOLD forcé) | `fusedScore × 0.5` (pénalisé, pas bloqué) |
| `return` anticipé | Oui — skip tout le calcul | Non — calcul complet exécuté |
| Log | `insufficient diversity` | `diversity penalty applied: X → Y` |
| Impact | BTC/SOL/DOGE toujours à 0 | Score réduit mais non nul |
