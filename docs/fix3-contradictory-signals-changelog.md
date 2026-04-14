# FIX 3 — Signaux contradictoires → Cohérence directionnelle (P1)

**Fichier modifié :** `supabase/functions/technical-signal-generator/index.ts`  
**Déployé :** ✅ Oui

---

## Changement : Filtrage directionnel du trend signal (lignes 404-423)

### BEFORE

```typescript
    // Add trend signal based on price vs longer EMA
    const trendStrength = ((currentPrice - ema21) / ema21) * 100;
    if (Math.abs(trendStrength) > 0.1) {
      signals.push({
        source_id: sourceId,
        user_id: userId,
        timestamp: new Date().toISOString(),
        symbol: baseSymbol,
        signal_type: trendStrength > 0 ? 'trend_bullish' : 'trend_bearish',
        signal_strength: Math.min(100, Math.abs(trendStrength) * 30),
        source: 'technical_analysis',
        data: {
          trend_strength: trendStrength,
          current_price: currentPrice,
          ema_reference: ema21,
          indicator: 'trend'
        },
        processed: false
      });
    }
```

### AFTER

```typescript
    // Add trend signal based on price vs longer EMA
    // FIX 3: Directional consistency — only emit trend signals coherent with MA cross
    const trendStrength = ((currentPrice - ema21) / ema21) * 100;
    const emaBullish = ema9 > ema21;
    const emaBearish = ema9 < ema21;
    const trendCoherent = 
      (emaBullish && trendStrength > 0.1) ||   // bullish cross + bullish trend = OK
      (emaBearish && trendStrength < -0.1);     // bearish cross + bearish trend = OK

    if (trendCoherent) {
      signals.push({
        source_id: sourceId,
        user_id: userId,
        timestamp: new Date().toISOString(),
        symbol: baseSymbol,
        signal_type: trendStrength > 0 ? 'trend_bullish' : 'trend_bearish',
        signal_strength: Math.min(100, Math.abs(trendStrength) * 30),
        source: 'technical_analysis',
        data: {
          trend_strength: trendStrength,
          current_price: currentPrice,
          ema_reference: ema21,
          indicator: 'trend',
          directional_filter: 'coherent_with_ma_cross'
        },
        processed: false
      });
      console.log(`📊 ${symbol} Trend signal COHERENT: ${trendStrength > 0 ? 'bullish' : 'bearish'}`);
    } else if (Math.abs(trendStrength) > 0.1) {
      console.log(`⚠️ ${symbol} Trend signal SUPPRESSED: contradicts MA cross direction`);
    }
```

---

## Problème résolu

| Scénario | Avant | Après |
|---|---|---|
| EMA9 < EMA21 mais price > EMA21 | `ma_cross_bearish` + `trend_bullish` émis → s'annulent | `trend_bullish` **supprimé** → signal bearish cohérent |
| EMA9 > EMA21 mais price < EMA21 | `ma_cross_bullish` + `trend_bearish` émis → s'annulent | `trend_bearish` **supprimé** → signal bullish cohérent |
| EMA9 > EMA21 et price > EMA21 | `ma_cross_bullish` + `trend_bullish` | Identique ✅ (cohérent) |

## Résumé

- Le trend signal n'est émis que s'il est **dans la même direction** que le MA cross
- Les signaux contradictoires sont logués avec `⚠️ SUPPRESSED` pour monitoring
- Élimine la dilution par neutralisation dans l'agrégation `average`
