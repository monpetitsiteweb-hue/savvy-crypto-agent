# Deposit Watcher — Debug Report
**Date** : 2026-04-10  
**Fichier** : `supabase/functions/onchain-deposit-watcher/index.ts`  
**Status** : ✅ Transaction détectée — tous les bugs corrigés

---

## 1. Contexte

Transaction cible :
| Champ | Valeur |
|-------|--------|
| Block | `44523165` |
| From | `0xD02172fB...dbF30cc04` |
| To (BOT_ADDRESS) | `0x115030C501b87c0C64834281c704EFDd36D4978d` |
| Amount | `0.0225 ETH` |
| Type | Transfert ETH natif (premier niveau, confirmé BaseScan onglet "Transactions") |

---

## 2. Bugs identifiés et corrigés

### Bug #1 — Désalignement batch RPC → block index

**Problème** : Le code traitait `results[j]` comme correspondant à `batch[j]` après tri par `id`. Mais les IDs étaient calculés comme `i + idx + 100`, ce qui pouvait créer un décalage entre la réponse et le block demandé.

**Avant** :
```typescript
for (let j = 0; j < results.length; j++) {
  const result = results[j];
  if (!result?.result?.transactions) continue;
  const blockNum = batch[j];  // ← supposé aligné, FAUX
```

**Après** :
```typescript
for (let j = 0; j < results.length; j++) {
  const result = results[j];
  if (!result?.result?.transactions) continue;
  const callIndex = result.id - 100 - i;  // ← retrouve l'index via l'ID
  const blockNum = batch[callIndex];
  if (blockNum === undefined) continue;
```

---

### Bug #2 — Pas de `from_block` explicite

**Problème** : Le watcher ne scannait que les N derniers blocks (lookback). Impossible de scanner un block historique.

**Fix** : Ajout du paramètre `from_block` dans le payload JSON.

---

### Bug #3 — RPC batch non supporté par `mainnet.base.org`

**Problème** : Le RPC public renvoie des réponses batch sans `result.transactions`, ce qui retournait 0 blocks valides.

**Fix** : Fallback séquentiel automatique avec throttle de 100ms entre chaque appel individuel.

---

### Bug #4 — Block sampling (CAUSE RACINE) ✅ CORRIGÉ

**Problème** : Quand le range `from_block → currentBlock` dépassait 1000 blocks, le `blockStep` passait à >1, ce qui sautait des blocks (dont 44523165).

```typescript
// AVANT — blockStep = 7 pour un range de 1500 blocks
const totalBlocks = currentBlock - fromBlock;  // 1500
const blockStep = totalBlocks <= 1000 ? 1 : Math.floor(totalBlocks / 200);  // 7
// → 44523165 sauté (entre 44523163 et 44523170)
```

**Fix A+B combiné** :
```typescript
// APRÈS — blockStep = 1 quand from_block explicite, + to_block support
let explicitToBlock: number | null = null;
if (body?.to_block && typeof body.to_block === "number") {
  explicitToBlock = body.to_block;
}
const toBlock = explicitToBlock ?? currentBlock;
const totalBlocks = toBlock - fromBlock;
const blockStep = explicitFromBlock ? 1 : (totalBlocks <= 1000 ? 1 : Math.max(1, Math.floor(totalBlocks / 200)));
```

**Tous les usages de `currentBlock` dans le scan remplacés par `toBlock`** :
- Boucle ETH scan (ligne ~240)
- Appel `eth_getLogs` ERC20 (ligne ~346)
- Résumé de réponse (ligne ~626)

---

## 3. Résultat du test final

```json
POST { "from_block": 44523100, "to_block": 44523200 }

{
  "success": true,
  "summary": {
    "transfers_scanned": 1,       // ← TX 0.0225 ETH TROUVÉE ✅
    "matched": 0,
    "unmatched": 0,
    "ambiguous": 0,
    "already_processed": 1,       // ← idempotence OK (déjà insérée)
    "block_range": { "from": 44523100, "to": 44523200 }
  },
  "duration_ms": 24519
}
```

---

## 4. Logs de debug (temporaires)

Logs ajoutés pour diagnostic dans `extractEthTransfers()` et la boucle principale. À retirer après stabilisation :
1. **Block list info** : nombre de blocks, `blockStep`, inclusion de 44523165
2. **Par block scanné** : nombre de transactions, 3 premiers `tx.to`
3. **Block 44523165 spécifique** : log dédié avec matching txs

---

## 5. État final du fichier

| Section | Lignes | Status |
|---------|--------|--------|
| Imports & constantes | 1-43 | ✅ |
| `fetchBlockSingle()` | 48-62 | ✅ |
| `extractEthTransfers()` | 67-116 | ✅ + debug logs temporaires |
| `TransferEvent` interface | 118-128 | ✅ |
| `batchRpc()` | 134-162 | ✅ |
| Parsing `from_block` + `to_block` | 184-200 | ✅ MODIFIÉ |
| `blockStep` (force 1 si explicit) | ~237 | ✅ MODIFIÉ |
| Boucle scan → `toBlock` | ~240 | ✅ MODIFIÉ |
| Batch + fallback séquentiel | 253-327 | ✅ |
| ERC20 getLogs → `toBlock` | ~346 | ✅ MODIFIÉ |
| Attribution | 427-604 | ✅ |
| Réponse block_range → `toBlock` | ~626 | ✅ MODIFIÉ |
