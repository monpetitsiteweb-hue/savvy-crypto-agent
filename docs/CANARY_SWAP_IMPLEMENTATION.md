# Canary Swap — Documentation d'implémentation

**Date** : 2026-04-10  
**Objectif** : Valider le pipeline on-chain complet avec un swap réel de petite taille (SELL 0.002 ETH → USDC sur Base).

---

## 1. Fichiers modifiés

| Fichier | Lignes touchées | Nature du changement |
|---|---|---|
| `src/components/strategy/CanarySwapButton.tsx` | **Nouveau fichier** (≈210 lignes) | Composant complet : bouton, modal de confirmation, exécution, affichage du résultat |
| `src/components/PerformanceOverview.tsx` | Import + insertion dans le header | Import de `CanarySwapButton` + insertion à côté du titre "Performance Overview" |

## 2. Fichiers NON modifiés (conformité aux règles absolues)

- `supabase/functions/onchain-sign-and-send/index.ts` — **AUCUNE modification**
- `supabase/functions/trading-decision-coordinator/index.ts` — **AUCUNE modification**
- `supabase/functions/_shared/signer.ts` — **AUCUNE modification**
- `src/utils/testModeHelpers.ts` — **AUCUNE modification**
- Pipeline mock/test — **AUCUNE modification**

## 2b. Fixes pré-canary dans `onchain-execute` (2026-04-10)

| Fix | Ligne | Avant | Après |
|-----|-------|-------|-------|
| BOT_PK fallback | 228 | `Deno.env.get('BOT_PK')` | `Deno.env.get('BOT_PK') \|\| Deno.env.get('BOT_PRIVATE_KEY')` |
| Skip Permit2 si ETH natif | 691-700 | `shouldAutoSignPermit2` sans check `tx.value` | Ajout `txValueIsZero` : si le quote 0x a `transaction.value > 0`, Permit2 est entièrement sauté |
| **Fix contrat action wrap** | 539 (`wallet-ensure-weth`) | `action: 'wrap'` en réponse submit réussie | `action: 'wrapped'` — aligne avec le check `onchain-execute` ligne 212 qui attend `'wrapped'` pour continuer l'exécution |
| **Fix metadata hardcodée engine** | 976-978, 1190-1192 (`backend-shadow-engine`) | `mode: 'mock'`, `is_test_mode: true` hardcodés | Dynamique : `mode` = `'live'`/`'mock'` et `is_test_mode` = `false`/`true` selon `BACKEND_ENGINE_MODE` |

## 3. Procédure d'exécution du Canary Swap

### Pré-requis
1. Être connecté à l'application
2. **Test Mode activé** (le bouton n'apparaît qu'en Test Mode)
3. Secrets Supabase configurés :
   - `SERVER_SIGNER_MODE=local`
   - `SERVER_SIGNER_LOCAL=true`
   - `BOT_PRIVATE_KEY` ✅
   - `BOT_ADDRESS` ✅
   - `RPC_URL_8453` ✅
4. Le wallet `BOT_ADDRESS` doit détenir :
   - ≥ 0.002 ETH (montant vendu)
   - Un peu d'ETH supplémentaire pour le gas

### Étapes
1. Naviguer vers l'onglet **Performance** (barre de navigation principale)
2. Cliquer sur le bouton **🧪 Canary Swap** (en haut à droite du titre "Performance Overview")
3. Vérifier les paramètres dans la modal de confirmation :
   - SELL 0.002 ETH → USDC
   - Chain: Base (8453)
   - Slippage: 50 bps
4. Cliquer **Confirmer le swap**
5. Observer le résultat en temps réel

### Paramètres hardcodés (non modifiables)
```typescript
{
  symbol: 'ETH',
  side: 'SELL',
  amount: 0.002,
  slippageBps: 50,
  chainId: 8453,  // Base
  quote: 'USDC',
  system_operator_mode: true
}
```

## 4. Signaux de succès

| Signal | Où vérifier |
|---|---|
| Status `submitted` dans l'UI | Carte verte avec badge "submitted" |
| TX Hash cliquable | Lien vers `https://basescan.org/tx/{hash}` |
| Trade ID affiché | Dans la carte de résultat |
| Entrée dans `trades` table | `SELECT * FROM trades WHERE status='submitted' ORDER BY created_at DESC LIMIT 1;` |
| Entrées dans `trade_events` | `SELECT * FROM trade_events ORDER BY created_at DESC LIMIT 5;` |
| Logs Edge Function | Dashboard Supabase → Functions → `onchain-sign-and-send` → Logs |
| Transaction confirmée sur BaseScan | Le lien TX hash doit montrer "Success" |

## 5. Signaux d'échec et interprétation

| Erreur | Cause probable | Action |
|---|---|---|
| `SYSTEM signer not configured` | `BOT_PRIVATE_KEY` ou `BOT_ADDRESS` manquant | Vérifier les secrets Supabase |
| `BUILD_FAILED` | `onchain-execute` a échoué (quote 0x, balance insuffisante) | Vérifier logs de `onchain-execute` |
| `Preflight required: permit2_approval` | WETH n'a pas l'approbation Permit2 | Approuver manuellement Permit2 pour WETH sur Base |
| `VALUE_CAP_EXCEEDED` | `MAX_TX_VALUE_WEI` trop bas | Augmenter ou supprimer le secret |
| `SIGNER_MISCONFIGURED` | Mode webhook actif mais URLs manquantes | Vérifier `SERVER_SIGNER_MODE=local` |
| `Trade missing tx_payload` | Build n'a pas produit de payload | Vérifier logs `onchain-execute` |
| `insufficient funds` | Wallet n'a pas assez d'ETH | Approvisionner le wallet |
| `EXECUTION_DRY_RUN` active | `onchain-execute` en mode dry run | Mettre `EXECUTION_DRY_RUN=false` |
| Erreur réseau / timeout | Problème RPC Base | Vérifier `RPC_URL_8453` |

## 6. Procédure de rollback complet

Pour retirer complètement le Canary Swap :

1. **Supprimer** `src/components/strategy/CanarySwapButton.tsx`
2. **Dans** `src/components/strategy/PerformanceDashboard.tsx` :
   - Supprimer la ligne d'import : `import { CanarySwapButton } from './CanarySwapButton';`
   - Retirer `<CanarySwapButton />` du JSX (dans le header)
   - Remettre le `<Button>` Refresh directement dans le `<div>` sans wrapper `flex gap-3`
3. **Aucun rollback nécessaire** côté Edge Functions (rien n'a été modifié)
4. **Aucune migration DB** à annuler (aucune n'a été créée)

---

## Architecture

```
[UI: CanarySwapButton]
    │
    ▼ supabase.functions.invoke('onchain-sign-and-send')
    │
    ├─ PATH A (raw params): symbol=ETH, side=SELL, amount=0.002
    │   │
    │   ▼ buildTrade() → appelle onchain-execute (mode=build)
    │   │
    │   ▼ getSigner() → LocalSigner (SERVER_SIGNER_MODE=local)
    │   │
    │   ▼ signTransaction() → eth_sendRawTransaction via RPC_URL_8453
    │   │
    │   ▼ Résultat: { ok: true, txHash, tradeId }
    │
    └─ UI affiche le résultat (txHash cliquable, status, erreurs)
```

**Note importante** : `EXECUTION_DRY_RUN` dans `onchain-execute` doit être `false` pour que le swap soit réellement exécuté. Si ce secret est absent ou `true`, le build retournera un dry-run sans broadcaster.
