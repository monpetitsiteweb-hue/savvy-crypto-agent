# Diagnostic complet — Confidence bloquée à ~0.24

**Date** : 14 avril 2025  
**Problème** : Le marché fait +3.5% (XRP) et +4.5% (BTC) mais le système reste à confidence ~0.17–0.24.  
**Fichiers concernés** :
- `supabase/functions/technical-signal-generator/index.ts`
- `supabase/functions/trading-decision-coordinator/index.ts`

---

## BUG 1 — Breakout Detection aveugle aux mouvements > 5 minutes

### Fichier : `technical-signal-generator/index.ts`, lignes 192–231

```typescript
// CODE ACTUEL (PROBLÉMATIQUE)
// Lignes 192-231

async function generateTechnicalSignals(symbol: string, priceData: any[], userId: string | null, sourceId: string) {
  const signals = [];
  const latest = priceData[priceData.length - 1];
  const previous = priceData[priceData.length - 2];    // ← BUG : bougie N-1 seulement (5 min)
  const earlier = priceData[0];                          // ← earlier = début du buffer (4h)
  
  const baseSymbol = symbol.split('-')[0];

  console.log(`🔬 Calculating indicators for ${symbol}: Latest=${latest.close_price}, Previous=${previous.close_price}`);

  // 1. Price Change Analysis
  const shortTermChange = ((latest.close_price - previous.close_price) / previous.close_price) * 100;
  //                        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  //                        BUG CRITIQUE : compare UNIQUEMENT bougie N vs bougie N-1
  //                        Sur des bougies 5min, un move de +3.5% sur 1h = ~0.03% par bougie
  //                        → JAMAIS au dessus du seuil de 0.5%
  
  const longerTermChange = ((latest.close_price - earlier.close_price) / earlier.close_price) * 100;
  //                        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  //                        longerTermChange est calculé mais JAMAIS utilisé pour déclencher un signal !

  console.log(`📊 ${symbol} - Short-term: ${shortTermChange.toFixed(2)}%, Longer-term: ${longerTermChange.toFixed(2)}%`);

  // Generate price movement signals (lower threshold for more signals)
  if (Math.abs(shortTermChange) > 0.5) { // 0.5% threshold
    //  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    //  SEUL shortTermChange est vérifié → longerTermChange ignoré
    //  Résultat : un +3.5% sur 4h ne génère AUCUN signal
    
    const signalType = shortTermChange > 0 ? 'price_breakout_bullish' : 'price_breakout_bearish';
    const strength = Math.min(100, Math.abs(shortTermChange) * 40);

    signals.push({
      source_id: sourceId,
      user_id: userId,
      timestamp: new Date().toISOString(),
      symbol: baseSymbol,
      signal_type: signalType,
      signal_strength: strength,
      source: 'technical_analysis',
      data: {
        price_change_short: shortTermChange,
        price_change_longer: longerTermChange,
        current_price: latest.close_price,
        indicator: 'price_movement',
        threshold_triggered: '0.5%'
      },
      processed: false
    });
  }
  // ... suite du code
}
```

### Pourquoi c'est cassé

| Scénario | shortTermChange (N vs N-1) | longerTermChange (N vs début) | Signal généré ? |
|---|---|---|---|
| BTC +4.5% sur 4h (bougies 5min) | ~0.09% | +4.5% | ❌ NON (0.09% < 0.5%) |
| XRP +3.5% sur 1h | ~0.29% | +3.5% | ❌ NON (0.29% < 0.5%) |
| Flash crash -5% en 5min | -5% | -5% | ✅ OUI |

Le système ne détecte que les flash crashes, jamais les tendances progressives.

### Fix proposé

```typescript
// CODE CORRIGÉ — Fenêtres glissantes 1h et 4h

async function generateTechnicalSignals(symbol: string, priceData: any[], userId: string | null, sourceId: string) {
  const signals = [];
  const latest = priceData[priceData.length - 1];
  const previous = priceData[priceData.length - 2];
  const earlier = priceData[0];
  
  const baseSymbol = symbol.split('-')[0];

  // === FIX BUG 1 : Fenêtres glissantes au lieu de N vs N-1 ===
  
  // Fenêtre 1h (~12 bougies de 5min)
  const oneHourIdx = Math.max(0, priceData.length - 12);
  const oneHourChange = ((latest.close_price - priceData[oneHourIdx].close_price) / priceData[oneHourIdx].close_price) * 100;
  
  // Fenêtre 4h (tout le buffer)
  const fourHourChange = ((latest.close_price - earlier.close_price) / earlier.close_price) * 100;
  
  // Fenêtre courte (N vs N-1, gardée pour compatibilité)
  const shortTermChange = ((latest.close_price - previous.close_price) / previous.close_price) * 100;

  console.log(`📊 ${symbol} - 5min: ${shortTermChange.toFixed(2)}%, 1h: ${oneHourChange.toFixed(2)}%, 4h: ${fourHourChange.toFixed(2)}%`);

  // Seuils par fenêtre
  const breakoutDetected = 
    Math.abs(shortTermChange) > 0.5 ||   // Flash move 5min
    Math.abs(oneHourChange) > 1.0 ||      // Move significatif 1h
    Math.abs(fourHourChange) > 3.0;       // Tendance forte 4h

  if (breakoutDetected) {
    // Prendre le changement le plus significatif
    const dominantChange = Math.abs(fourHourChange) > Math.abs(oneHourChange) 
      ? fourHourChange 
      : (Math.abs(oneHourChange) > Math.abs(shortTermChange) ? oneHourChange : shortTermChange);
    
    const signalType = dominantChange > 0 ? 'price_breakout_bullish' : 'price_breakout_bearish';
    const strength = Math.min(100, Math.abs(dominantChange) * 20);

    signals.push({
      source_id: sourceId,
      user_id: userId,
      timestamp: new Date().toISOString(),
      symbol: baseSymbol,
      signal_type: signalType,
      signal_strength: strength,
      source: 'technical_analysis',
      data: {
        price_change_5min: shortTermChange,
        price_change_1h: oneHourChange,
        price_change_4h: fourHourChange,
        dominant_window: Math.abs(fourHourChange) > Math.abs(oneHourChange) ? '4h' : '1h',
        current_price: latest.close_price,
        indicator: 'price_movement',
        thresholds: { '5min': 0.5, '1h': 1.0, '4h': 3.0 }
      },
      processed: false
    });
  }
  // ... suite identique (RSI, Volume, EMA)
}
```

---

## BUG 2 — Diversity Gate bloque les signaux à source unique

### Fichier : `trading-decision-coordinator/index.ts`, lignes 133–313

```typescript
// CODE ACTUEL (PROBLÉMATIQUE)
// Lignes 133-136

/** Maximum contribution any single source can have */
const MAX_SOURCE_CONTRIBUTION = 0.4;
/** Minimum number of unique sources required */
const MIN_UNIQUE_SOURCES = 2;
//                         ^
//                         Si SEUL technical_analysis a des signaux → score forcé à 0
```

```typescript
// Lignes 297-313 — Diversity Gate

    // === FIX 3: Minimum signal diversity check ===
    const uniqueSources = new Set(processedSignals.map(ps => ps.signal.source));
    if (uniqueSources.size < MIN_UNIQUE_SOURCES) {
      console.log(`[SignalFusion] ${symbol}: insufficient diversity (${uniqueSources.size} sources < ${MIN_UNIQUE_SOURCES})`);
      return {
        fusedScore: 0,                    // ← FORCÉ À ZÉRO
        details,
        totalSignals: rawCount,
        enabledSignals: processedSignals.length,
        signals_used: signalsUsed,
        source_contributions: {},
        fusion_version: FUSION_VERSION,
        insufficient_diversity: true,     // ← Flag mais score = 0
        unique_sources_count: uniqueSources.size,
        deduplicated_signal_count: dedupedSignals.length,
      };
    }
```

### Impact concret

Pour BTC, SOL, DOGE : souvent seul `technical_analysis` est actif → **fusedScore = 0 systématiquement**.

Même avec RSI=24.4 (fortement oversold) et 10 signaux bullish, le score reste à 0 car il n'y a qu'une seule source.

### Fix proposé — Pénalité au lieu de blocage

```typescript
// OPTION : Pénaliser au lieu de bloquer
const MIN_UNIQUE_SOURCES = 2;
const SINGLE_SOURCE_PENALTY = 0.5; // Divise le score par 2 si une seule source

// Remplacer le bloc lignes 297-313 par :
const uniqueSources = new Set(processedSignals.map(ps => ps.signal.source));
const diversityPenalty = uniqueSources.size < MIN_UNIQUE_SOURCES ? SINGLE_SOURCE_PENALTY : 1.0;

if (uniqueSources.size < MIN_UNIQUE_SOURCES) {
  console.log(`[SignalFusion] ${symbol}: low diversity (${uniqueSources.size} sources), applying ${SINGLE_SOURCE_PENALTY}x penalty`);
}

// ... puis plus bas dans le calcul final :
const fusedScore = Math.max(-100, Math.min(100, convictionScore * 100 * diversityPenalty));
```

---

## BUG 3 — Signaux contradictoires simultanés diluent le score

### Fichier : `technical-signal-generator/index.ts`, lignes 324–401

```typescript
// CODE ACTUEL (PROBLÉMATIQUE)
// Lignes 324-401 — EMA Analysis

  // 4. EMA Analysis (EMA9/EMA21 to match UI)
  if (priceData.length >= 21) {
    const prices = priceData.map(p => p.close_price);
    const ema9 = calculateEMA(prices, 9);
    const ema21 = calculateEMA(prices, 21);
    const currentPrice = latest.close_price;
    
    const emaSpreadPct = ((ema9 - ema21) / ema21) * 100;

    // EMA Crossover Detection
    if (ema9 > ema21) {
      signals.push({
        // ... ma_cross_bullish avec strength basée sur emaSpreadPct
        signal_type: 'ma_cross_bullish',
        signal_strength: Math.max(10, strength),
        // ...
      });
    } else if (ema9 < ema21) {
      signals.push({
        // ... ma_cross_bearish
        signal_type: 'ma_cross_bearish',
        signal_strength: Math.max(10, strength),
        // ...
      });
    }
    
    // PROBLÈME : Ce signal trend peut CONTREDIRE le signal ma_cross ci-dessus
    // Exemple : EMA9 < EMA21 → ma_cross_bearish MAIS price > EMA21 → trend_bullish
    // Résultat : les deux signaux s'annulent dans l'average
    
    const trendStrength = ((currentPrice - ema21) / ema21) * 100;
    if (Math.abs(trendStrength) > 0.1) {
      signals.push({
        signal_type: trendStrength > 0 ? 'trend_bullish' : 'trend_bearish',
        signal_strength: Math.min(100, Math.abs(trendStrength) * 30),
        // ...
      });
    }
  }
```

### Exemple concret de neutralisation

| Signal | Direction | Strength | Contribution |
|---|---|---|---|
| `ma_cross_bullish` | +1 | 60 | +0.18 |
| `trend_bearish` | -1 | 40 | -0.12 |
| `momentum_neutral` | 0 | 50 | 0 |
| **Average** | | | **+0.02** (dilué) |

Avec `'average'`, les signaux contradictoires s'annulent → contribution technique quasi-nulle.

### Fix proposé — Cohérence directionnelle

```typescript
// Dans generateTechnicalSignals, après le calcul EMA :
// Ne PAS générer trend_bullish si ma_cross_bearish est déjà émis (et vice-versa)

    if (ema9 > ema21) {
      signals.push({
        signal_type: 'ma_cross_bullish',
        // ...
      });
      
      // Trend signal COHÉRENT seulement
      if (trendStrength > 0.1) {
        signals.push({
          signal_type: 'trend_bullish',
          // ...
        });
      }
      // Si trendStrength < 0, NE PAS émettre trend_bearish (contradiction)
      
    } else if (ema9 < ema21) {
      signals.push({
        signal_type: 'ma_cross_bearish',
        // ...
      });
      
      // Trend signal COHÉRENT seulement
      if (trendStrength < -0.1) {
        signals.push({
          signal_type: 'trend_bearish',
          // ...
        });
      }
      // Si trendStrength > 0, NE PAS émettre trend_bullish (contradiction)
    }
```

---

## BUG 4 — Aggregation `average` dilue technical_analysis

### Fichier : `trading-decision-coordinator/index.ts`, lignes 122–131

```typescript
// CODE ACTUEL
const SOURCE_AGGREGATION_STRATEGY: Record<string, AggregationStrategy> = {
  technical_analysis: "average",    // ← PROBLÈME : dilue les signaux forts
  crypto_news: "average",
  whale_alert_ws: "max",
  whale_alert_api: "max",
  fear_greed_index: "latest",
  eodhd: "latest",
};
```

### Mécanisme de dilution (lignes 175-179)

```typescript
      case "average":
      default: {
        aggContribution = signals.reduce((acc, s) => acc + s.contribution, 0) / signals.length;
        //               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
        //               Si 5 signaux tech : [+0.3, +0.2, -0.1, +0.05, 0] → average = +0.09
        //               Avec 'max' ce serait : +0.3
        aggStrength = signals.reduce((acc, s) => acc + s.normalizedStrength, 0) / signals.length;
        break;
      }
```

### Fix proposé — Passer technical_analysis en `max` ou `directional_max`

```typescript
// Option A : Simple — passer en 'max'
const SOURCE_AGGREGATION_STRATEGY: Record<string, AggregationStrategy> = {
  technical_analysis: "max",        // ← Le signal tech le plus fort l'emporte
  crypto_news: "average",
  whale_alert_ws: "max",
  whale_alert_api: "max",
  fear_greed_index: "latest",
  eodhd: "latest",
};

// Option B : Nouvelle stratégie 'directional_max' (plus sophistiquée)
// Séparer bullish et bearish, prendre le max de chaque direction
// puis faire la différence
```

---

## BUG 5 — Per-source cap trop bas (0.4)

### Fichier : `trading-decision-coordinator/index.ts`, ligne 134

```typescript
const MAX_SOURCE_CONTRIBUTION = 0.4;
```

### Lignes 319-326 — Application du cap

```typescript
    if (useSourceAggregation && processedSignals.length > 0) {
      const aggregated = aggregateBySource(processedSignals);
      for (const [source, agg] of aggregated) {
        const raw = agg.contribution;
        const capped = Math.sign(raw) * Math.min(Math.abs(raw), MAX_SOURCE_CONTRIBUTION);
        //             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
        //             Même si technical_analysis contribue +0.8, c'est plafonné à +0.4
        sourceContributions[source] = Number(capped.toFixed(4));
        perSourceCappedContributions[source] = Number(raw.toFixed(4));
      }
    }
```

### Fix proposé

```typescript
// Augmenter le cap quand il y a peu de sources
const effectiveCap = uniqueSources.size <= 2 
  ? 0.6   // Plus permissif avec peu de sources
  : 0.4;  // Standard avec diversité

const capped = Math.sign(raw) * Math.min(Math.abs(raw), effectiveCap);
```

---

## Résumé des 5 bugs et priorités

| # | Bug | Fichier | Impact | Priorité |
|---|---|---|---|---|
| 1 | Breakout compare N vs N-1 (5min) | `technical-signal-generator` L204 | Moves de +3.5% invisibles | 🔴 P0 |
| 2 | Diversity gate bloque à 0 si 1 source | `trading-decision-coordinator` L299 | BTC/SOL/DOGE = toujours 0 | 🔴 P0 |
| 3 | Signaux contradictoires simultanés | `technical-signal-generator` L337-401 | Neutralisation mutuelle | 🟡 P1 |
| 4 | `average` dilue technical_analysis | `trading-decision-coordinator` L125 | Score compressé à ~0.05 | 🟡 P1 |
| 5 | Per-source cap 0.4 trop restrictif | `trading-decision-coordinator` L134 | Plafonnement artificiel | 🟢 P2 |

---

## Score de fusion — Calcul complet (pour référence)

### Fichier : `trading-decision-coordinator/index.ts`, lignes 340-357

```typescript
    // === FIX 4: Score normalization before dominance ===
    const normFactor = maxPossibleScore > 0 ? maxPossibleScore : 1;

    let bullishTotal = 0;
    let bearishTotal = 0;
    for (const ps of processedSignals) {
      const normalizedContribution = ps.contribution / normFactor;
      if (normalizedContribution > 0) bullishTotal += normalizedContribution;
      else bearishTotal += Math.abs(normalizedContribution);
    }

    const totalMass = bullishTotal + bearishTotal;
    const dominance = totalMass === 0 ? 0 : Math.max(bullishTotal, bearishTotal) / totalMass;
    const magnitude = totalMass === 0 ? 0 : Math.max(bullishTotal, bearishTotal);
    const direction = bullishTotal >= bearishTotal ? 1 : -1;
    const convictionScore = direction * dominance * magnitude;

    const fusedScore = Math.max(-100, Math.min(100, convictionScore * 100));
    
    // Confidence effective = abs(fusedScore) / 100
    // Donc fusedScore = 24 → confidence = 0.24
```
