# FIX 1 — Breakout Detection Multi-Window (P0)

**Fichier modifié :** `supabase/functions/technical-signal-generator/index.ts`  
**Lignes :** 203-231 (avant) → 203-253 (après)  
**Déployé :** ✅ Oui

---

## BEFORE (lignes 203-231)

```typescript
  // 1. Price Change Analysis
  const shortTermChange = ((latest.close_price - previous.close_price) / previous.close_price) * 100;
  const longerTermChange = ((latest.close_price - earlier.close_price) / earlier.close_price) * 100;

  console.log(`📊 ${symbol} - Short-term: ${shortTermChange.toFixed(2)}%, Longer-term: ${longerTermChange.toFixed(2)}%`);

  // Generate price movement signals (lower threshold for more signals)
  if (Math.abs(shortTermChange) > 0.5) { // 0.5% threshold
    const signalType = shortTermChange > 0 ? 'price_breakout_bullish' : 'price_breakout_bearish';
    const strength = Math.min(100, Math.abs(shortTermChange) * 40);

    signals.push({
      source_id: sourceId,
      user_id: userId, // NULL for system-wide
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
```

### Problème
- Compare uniquement bougie N vs N-1 (5 minutes d'écart)
- Un move de +3.5% sur 1h ou +4.5% sur 4h est **invisible** car chaque bougie individuelle ne dépasse pas 0.5%
- Multiplicateur ×40 trop agressif pour du 5min

---

## AFTER (lignes 203-253)

```typescript
  // 1. Price Change Analysis — Multi-window breakout detection (FIX 1)
  // Window 1: 5min (N vs N-1), threshold 0.5%
  const change5m = ((latest.close_price - previous.close_price) / previous.close_price) * 100;
  
  // Window 2: 1h (~12 candles of 5min), threshold 1.0%
  const idx1h = Math.max(0, priceData.length - 12);
  const price1hAgo = priceData[idx1h].close_price;
  const change1h = ((latest.close_price - price1hAgo) / price1hAgo) * 100;
  
  // Window 3: 4h (full buffer), threshold 3.0%
  const change4h = ((latest.close_price - earlier.close_price) / earlier.close_price) * 100;

  console.log(`📊 ${symbol} - 5m: ${change5m.toFixed(2)}%, 1h: ${change1h.toFixed(2)}%, 4h: ${change4h.toFixed(2)}%`);

  // Trigger if ANY window exceeds its threshold
  const breakoutWindows = [
    { window: '5m',  change: change5m,  threshold: 0.5 },
    { window: '1h',  change: change1h,  threshold: 1.0 },
    { window: '4h',  change: change4h,  threshold: 3.0 },
  ];

  const triggeredWindows = breakoutWindows.filter(w => Math.abs(w.change) > w.threshold);

  if (triggeredWindows.length > 0) {
    // Use the dominant change (largest absolute move) for direction & strength
    const dominant = triggeredWindows.reduce((a, b) => Math.abs(a.change) > Math.abs(b.change) ? a : b);
    const signalType = dominant.change > 0 ? 'price_breakout_bullish' : 'price_breakout_bearish';
    const strength = Math.min(100, Math.abs(dominant.change) * 20); // ×20 multiplier

    console.log(`🚀 ${symbol} BREAKOUT via ${dominant.window}: ${dominant.change.toFixed(2)}% (threshold ${dominant.threshold}%)`);

    signals.push({
      source_id: sourceId,
      user_id: userId,
      timestamp: new Date().toISOString(),
      symbol: baseSymbol,
      signal_type: signalType,
      signal_strength: strength,
      source: 'technical_analysis',
      data: {
        change_5m: change5m,
        change_1h: change1h,
        change_4h: change4h,
        dominant_window: dominant.window,
        dominant_change: dominant.change,
        current_price: latest.close_price,
        indicator: 'price_movement',
        triggered_windows: triggeredWindows.map(w => `${w.window}:${w.change.toFixed(2)}%`).join(', ')
      },
      processed: false
    });
  }
```

### Autre modification mineure (ligne 339)
```typescript
// BEFORE
price_change: shortTermChange,
// AFTER
price_change: change5m,
```
Variable renommée pour cohérence (shortTermChange → change5m).

---

## Résumé des changements

| Aspect | Avant | Après |
|--------|-------|-------|
| Fenêtres | 1 seule (5min N vs N-1) | 3 fenêtres (5m, 1h, 4h) |
| Seuils | 0.5% unique | 0.5% / 1.0% / 3.0% |
| Déclenchement | Si 5min > 0.5% | Si UNE des trois dépasse son seuil |
| Direction | Basée sur shortTermChange | Basée sur le changement dominant |
| Multiplicateur strength | ×40 | ×20 |
| Data payload | 2 champs | 7 champs (toutes fenêtres + triggered) |
