# 📝 Changelog — Fix P&L History Cards

**Date** : 2026-04-11  
**Ticket** : Bug Realized P&L gonflé (+1 010.83 € au lieu de +11.23 €)

---

## Fichiers modifiés : 2

---

### 1. `src/utils/valuationService.ts`

**Lignes modifiées** : 77–78

**AVANT** :
```typescript
realizedPnL: snapshot.realized_pnl || null,
realizedPnLPct: snapshot.realized_pnl_pct || null
```

**APRÈS** :
```typescript
realizedPnL: snapshot.realized_pnl ?? null,
realizedPnLPct: snapshot.realized_pnl_pct ?? null
```

**Pourquoi** : L'opérateur `||` traite `0` comme falsy → un P&L de 0 € (break-even) devenait `null`, déclenchant le fallback toxique dans TradingHistory. L'opérateur `??` ne retourne `null` que si la valeur est `null` ou `undefined`.

---

### 2. `src/components/TradingHistory.tsx`

**Lignes supprimées** : 171–177 (7 lignes)

**AVANT** :
```typescript
// Only compute if DB values missing (legacy data)
if (gainLoss === null && pastPosition.exitValue !== null && pastPosition.purchaseValue !== null) {
  gainLoss = pastPosition.exitValue - pastPosition.purchaseValue;
}
if (gainLossPercentage === null && gainLoss !== null && pastPosition.purchaseValue !== null && pastPosition.purchaseValue > 0) {
  gainLossPercentage = (gainLoss / pastPosition.purchaseValue) * 100;
}
```

**APRÈS** (1 ligne de commentaire) :
```typescript
// No fallback: if realized_pnl is null in DB, display null (not a fabricated value)
```

**Pourquoi** : Ce fallback calculait `exitValue - purchaseValue` quand `realized_pnl` était null. `exitValue` = valeur totale du SELL (~504 €), pas le profit (~4.78 €). Résultat : P&L gonflé de ~100x. Supprimé — si la DB n'a pas de `realized_pnl`, l'UI affiche `null` au lieu de fabriquer un chiffre faux.

---

### 3. `docs/BUG_REALIZED_PNL_HISTORY_2026-04-11.md`

**Ligne modifiée** : 4

**AVANT** :
```
**Statut** : Diagnostiqué — non corrigé
```

**APRÈS** :
```
**Statut** : ✅ CORRIGÉ — 2026-04-11
```

---

## Fichiers NON modifiés

| Fichier | Raison |
|---------|--------|
| `src/utils/portfolioMath.ts` | Le Portfolio Summary utilise le calcul par invariant (`total - unrealized`), pas `processPastPosition`. Pas affecté. |
| `get_portfolio_metrics` (RPC SQL) | Calcul FIFO côté serveur, correct. Pas affecté. |
| `PerformancePanel.tsx` | Query directe sur `mock_trades.profit_loss`, pas via `processPastPosition`. Pas affecté. |
| `StrategyConfig.tsx` | Idem. Pas affecté. |

---

## Résumé

| Action | Fichier | Lignes | Type |
|--------|---------|--------|------|
| `||` → `??` | `valuationService.ts` | 77–78 | Modifié (2 lignes) |
| Suppression fallback toxique | `TradingHistory.tsx` | 171–177 | Supprimé (7 lignes → 1 ligne) |
| Statut mis à jour | `BUG_REALIZED_PNL_HISTORY_2026-04-11.md` | 4 | Modifié (1 ligne) |
