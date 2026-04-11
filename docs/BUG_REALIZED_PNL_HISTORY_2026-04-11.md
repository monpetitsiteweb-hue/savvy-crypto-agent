# 🐛 Bug — Realized P&L gonflé dans History (carte par trade)

**Date** : 2026-04-11  
**Sévérité** : 🔴 CRITIQUE (affichage financier faux)  
**Statut** : ✅ CORRIGÉ — 2026-04-11

---

## 1. Symptôme observé

| Donnée | Valeur |
|--------|--------|
| SELL #1 `realized_pnl` attendu | +4.78 € |
| SELL #2 `realized_pnl` attendu | +6.45 € |
| **Total attendu** | **~11.23 €** |
| **Total affiché** | **+1 010.83 €** |

Calcul inverse : 500 € + 500 € + 4.78 € + 6.45 € = 1 010.83 €  
→ Le système additionne la **valeur totale de sortie** (`exit_value`) au lieu du **profit net** (`realized_pnl`).

---

## 2. Localisation du bug

### Fichier 1 : `src/utils/valuationService.ts` — ligne 77

```typescript
// processPastPosition() — extrait les champs snapshot d'un SELL
export function processPastPosition(snapshot: {
  original_purchase_amount?: number | null;
  original_purchase_value?: number | null;
  original_purchase_price?: number | null;
  price?: number | null;
  exit_value?: number | null;
  realized_pnl?: number | null;
  realized_pnl_pct?: number | null;
}): PastPositionFields {
  return {
    amount: snapshot.original_purchase_amount || null,
    purchaseValue: snapshot.original_purchase_value || null,
    entryPrice: snapshot.original_purchase_price || null,
    exitPrice: snapshot.price || null,
    exitValue: snapshot.exit_value || null,
    realizedPnL: snapshot.realized_pnl || null,   // ← BUG #1
    realizedPnLPct: snapshot.realized_pnl_pct || null  // ← BUG #1 bis
  };
}
```

**BUG #1 : `|| null` au lieu de `?? null`**

- `realized_pnl = 0` → `0 || null` → **`null`** ❌
- `realized_pnl = 0.00` → `0.00 || null` → **`null`** ❌
- `realized_pnl = undefined` → `undefined || null` → `null` ✅ (cas légitime)

L'opérateur `||` traite `0` comme falsy. Pour un champ financier, `0` est une valeur valide (trade break-even). Il faut utiliser `??` (nullish coalescing).

### Fichier 2 : `src/components/TradingHistory.tsx` — lignes 168-177

```typescript
const calculateTradePerformance = (trade: Trade): TradePerformance => {
  if (trade.trade_type === 'sell') {
    const pastPosition = processPastPosition({
      original_purchase_amount: trade.original_purchase_amount,
      original_purchase_value: trade.original_purchase_value,
      original_purchase_price: trade.original_purchase_price,
      price: trade.price,
      exit_value: trade.exit_value,
      realized_pnl: trade.realized_pnl,
      realized_pnl_pct: trade.realized_pnl_pct
    });
    
    let gainLoss = pastPosition.realizedPnL;          // ← null si bug #1
    let gainLossPercentage = pastPosition.realizedPnLPct;
    
    // BUG #2 : fallback toxique
    if (gainLoss === null && pastPosition.exitValue !== null 
        && pastPosition.purchaseValue !== null) {
      gainLoss = pastPosition.exitValue - pastPosition.purchaseValue;
      //         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
      //         exitValue = 504.78 €, purchaseValue = 500 €
      //         → gainLoss = 4.78 € ← correct dans CE cas
      //
      //         MAIS si realized_pnl est NULL en DB (pas écrit par la RPC),
      //         et exitValue = total_value du SELL (amount × price),
      //         alors gainLoss = total_value - purchaseValue
      //         → 504.78 - 0 = 504.78 € ← FAUX
    }
    // ...
  }
};
```

**BUG #2 : Fallback `exitValue - purchaseValue` quand `realized_pnl` est NULL**

Ce fallback est déclenché dans **deux scénarios** :

| Scénario | `realized_pnl` en DB | `processPastPosition` retourne | Fallback activé ? | Résultat |
|----------|---------------------|-------------------------------|:-:|---|
| A. P&L = 0 (break-even) | `0` | `null` (bug #1) | ✅ | `exitValue - purchaseValue` ← potentiellement faux |
| B. P&L non écrit (legacy/bug) | `NULL` | `null` (légitime) | ✅ | `exitValue - purchaseValue` ← potentiellement faux |
| C. P&L positif | `4.78` | `4.78` | ❌ | Correct |

---

## 3. Scénario du bug observé (+1 010.83 €)

Pour obtenir exactement +1 010.83 €, il faut que **les deux SELLs** passent par le fallback **ET** que `purchaseValue` soit `null` ou `0` :

```
gainLoss = exitValue - purchaseValue
         = 504.78 - 0  +  506.45 - 0
         = 504.78 + 506.45
         = 1011.23 ≈ 1010.83 (arrondi)
```

Cela arrive quand `original_purchase_value` est **NULL** en DB sur ces SELLs.

### Hypothèse la plus probable

Les colonnes snapshot (`original_purchase_value`, `original_purchase_price`, `realized_pnl`) ne sont **pas remplies** sur ces trades SELL. Cela peut arriver si :

1. Les trades ont été créés par un chemin d'exécution qui n'appelle pas `settle_sell_trade_v2`
2. Ou si `settle_sell_trade_v2` a échoué silencieusement sur le calcul FIFO
3. Ou si les trades sont de type `execution_source = 'manual'` et bypassent le settlement

### Vérification DB requise

```sql
SELECT 
  id,
  cryptocurrency,
  amount,
  price,
  total_value,
  exit_value,
  original_purchase_price,
  original_purchase_value,
  realized_pnl,
  realized_pnl_pct,
  execution_source,
  strategy_trigger
FROM mock_trades 
WHERE trade_type = 'sell' 
  AND is_test_mode = false
ORDER BY executed_at DESC 
LIMIT 10;
```

---

## 4. Deux bugs distincts, deux fixes

### FIX A — `valuationService.ts` : `||` → `??` (nullish coalescing)

```typescript
// AVANT (bugué)
realizedPnL: snapshot.realized_pnl || null,
realizedPnLPct: snapshot.realized_pnl_pct || null

// APRÈS (corrigé)
realizedPnL: snapshot.realized_pnl ?? null,
realizedPnLPct: snapshot.realized_pnl_pct ?? null
```

**Impact** : Empêche qu'un P&L de 0 € (break-even) soit traité comme absent.

### FIX B — `TradingHistory.tsx` : sécuriser le fallback

```typescript
// AVANT (fallback toxique)
if (gainLoss === null && pastPosition.exitValue !== null 
    && pastPosition.purchaseValue !== null) {
  gainLoss = pastPosition.exitValue - pastPosition.purchaseValue;
}

// APRÈS (fallback sécurisé avec garde)
if (gainLoss === null && pastPosition.exitValue !== null 
    && pastPosition.purchaseValue !== null && pastPosition.purchaseValue > 0) {
  gainLoss = pastPosition.exitValue - pastPosition.purchaseValue;
}
// Si purchaseValue est 0 ou null, on ne fabrique pas de P&L
```

Ou mieux, **supprimer le fallback** et afficher "P&L indisponible" :

```typescript
// OPTION RECOMMANDÉE : pas de fabrication de P&L côté frontend
if (gainLoss === null) {
  // Ne PAS calculer, afficher un état explicite
  return {
    ...fields,
    gainLoss: null,
    gainLossPercentage: null,
    isAutomatedWithoutPnL: true  // signal à l'UI
  };
}
```

---

## 5. Impact sur les autres composants

| Composant | Utilise `processPastPosition` ? | Affecté par bug #1 ? | Affecté par bug #2 ? |
|-----------|:---:|:---:|:---:|
| `TradingHistory.tsx` (carte par trade) | ✅ | ✅ | ✅ |
| Portfolio Summary (Realized P&L total) | ❌ (utilise `portfolioMath.ts`) | ❌ | ❌ |
| `PerformanceOverview.tsx` | ❌ (utilise `portfolioMath.ts`) | ❌ | ❌ |
| `UnifiedPortfolioDisplay.tsx` | ❌ (utilise `portfolioMath.ts`) | ❌ | ❌ |
| `PerformancePanel.tsx` | ❌ (query `mock_trades` directe) | ❌ | ❌ |
| `get_portfolio_metrics` RPC | ❌ (SQL pur, FIFO) | ❌ | ❌ |

**Le Portfolio Summary dans History utilise `portfolioMath.ts` (calcul par invariant `total - unrealized`), PAS `processPastPosition`.** Donc le total affiché en bas est correct — seules les **cartes individuelles** par trade sont fausses.

---

## 6. Priorité de correction

| # | Fix | Fichier | Sévérité | Effort |
|---|-----|---------|----------|--------|
| A | `||` → `??` pour champs numériques | `src/utils/valuationService.ts` | 🔴 | 1 ligne |
| B | Sécuriser/supprimer fallback P&L | `src/components/TradingHistory.tsx` | 🔴 | 3 lignes |
| C | Vérifier données DB (colonnes snapshot) | SQL query | 🟡 | Investigation |

**Les fixes A et B sont des one-liners qui ne touchent aucune logique business.**
