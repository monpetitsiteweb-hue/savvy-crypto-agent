# FIX 4 — Aggregation technical_analysis : `average` → `max` (P1)

**Fichier modifié :** `supabase/functions/trading-decision-coordinator/index.ts`  
**Déployé :** ✅ Oui

---

## Changement : ligne 125

### BEFORE

```typescript
const SOURCE_AGGREGATION_STRATEGY: Record<string, AggregationStrategy> = {
  technical_analysis: "average",    // ← dilue les signaux forts
  crypto_news: "average",
  whale_alert_ws: "max",
  whale_alert_api: "max",
  fear_greed_index: "latest",
  eodhd: "latest",
};
```

### AFTER

```typescript
const SOURCE_AGGREGATION_STRATEGY: Record<string, AggregationStrategy> = {
  technical_analysis: "max",        // ← le signal tech le plus fort l'emporte
  crypto_news: "average",
  whale_alert_ws: "max",
  whale_alert_api: "max",
  fear_greed_index: "latest",
  eodhd: "latest",
};
```

---

## Problème résolu

| Scénario | Avant (`average`) | Après (`max`) |
|---|---|---|
| 5 signaux tech : [+0.3, +0.2, -0.1, +0.05, 0] | `+0.09` (moyenne diluée) | `+0.3` (signal dominant) |
| RSI oversold fort + EMA faible | Neutralisation mutuelle | Le plus fort survit |

## Résumé

- Le signal technique le plus fort détermine la contribution de `technical_analysis`
- Élimine la dilution par moyenne de signaux de forces inégales
- Cohérent avec le traitement de `whale_alert_ws` et `whale_alert_api` (déjà en `max`)
