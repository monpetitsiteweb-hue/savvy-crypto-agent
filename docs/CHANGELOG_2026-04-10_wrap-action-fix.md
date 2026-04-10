# Fix : Contrat d'interface wrap action (`wallet-ensure-weth` ↔ `onchain-execute`)

**Date** : 2026-04-10  
**Gravité** : Bloquant — empêchait tout auto-wrap ETH→WETH d'aboutir

---

## Problème

`onchain-execute` (ligne 212) attend `action === 'wrapped'` pour valider qu'un wrap a été exécuté avec succès et poursuivre le flux d'exécution.

Or `wallet-ensure-weth` retournait **toujours** `action: 'wrap'` — y compris après un wrap submit réussi (ligne 539). Résultat : `onchain-execute` tombait systématiquement dans le bloc ligne 200 et retournait `"Auto-wrap enabled but not executed (read-only check)"`, bloquant l'exécution.

### Contrat cassé

| Valeur attendue par `onchain-execute` | Valeur retournée par `wallet-ensure-weth` | Résultat |
|---|---|---|
| `action: 'none'` (solde suffisant) | `action: 'none'` | ✅ OK |
| `action: 'wrap'` (plan only, mode plan) | `action: 'wrap'` | ✅ OK |
| `action: 'wrapped'` (wrap exécuté, mode submit) | `action: 'wrap'` ❌ | 🐛 Bloqué |

---

## Fix appliqué

### Fichier modifié

**`supabase/functions/wallet-ensure-weth/index.ts`** — ligne 539

#### Avant

```ts
action: 'wrap',
```

#### Après

```ts
action: 'wrapped',
```

### Fichiers NON modifiés

- `supabase/functions/onchain-execute/index.ts` — aucun changement nécessaire, le check ligne 212 était déjà correct
- `supabase/functions/onchain-sign-and-send/index.ts` — non concerné
- `supabase/functions/_shared/signer.ts` — non concerné

---

## Documentation mise à jour

**`docs/CANARY_SWAP_IMPLEMENTATION.md`** — section 2b, ajout d'une ligne dans le tableau des fixes pré-canary :

```
| Fix contrat action wrap | 539 (wallet-ensure-weth) | action: 'wrap' en réponse submit réussie | action: 'wrapped' — aligne avec le check onchain-execute ligne 212 |
```

---

## Déploiement

- Edge function `wallet-ensure-weth` redéployée immédiatement après le fix.
- Aucun autre déploiement nécessaire.

---

## Vérification

Le flux attendu après fix :

1. `onchain-execute` appelle `wallet-ensure-weth` avec `autoWrap: true` (→ `action: 'submit'`)
2. `wallet-ensure-weth` exécute le wrap, confirme le receipt on-chain
3. Retourne `action: 'wrapped'` + `txHash` + nouveau solde WETH
4. `onchain-execute` ligne 212 matche `action === 'wrapped'` → **continue l'exécution** (Permit2, swap, etc.)
