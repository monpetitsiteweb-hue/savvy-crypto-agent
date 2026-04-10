# Deposit Watcher — Debug Report
**Date** : 2026-04-10  
**Fichier** : `supabase/functions/onchain-deposit-watcher/index.ts`  
**Status** : 🔴 Transaction toujours non détectée

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

**Avant** (lignes ~276-282) :
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
  const callIndex = result.id - 100 - i;  // ← retrouve l'index via l'ID de la réponse
  const blockNum = batch[callIndex];
  if (blockNum === undefined) continue;
```

**Impact** : Sans ce fix, les transferts trouvés dans un block pouvaient être associés au mauvais numéro de block, ou être silencieusement ignorés si l'index dépassait la taille du batch.

---

### Bug #2 — Pas de `from_block` explicite

**Problème** : Le watcher ne scannait que les N derniers blocks (lookback). Impossible de scanner un block historique spécifique.

**Fix** : Ajout du paramètre `from_block` dans le payload JSON :
```typescript
if (body?.from_block && typeof body.from_block === "number") {
  explicitFromBlock = body.from_block;
}
// ...
const fromBlock = explicitFromBlock ?? (currentBlock - lookbackBlocks);
```

**Localisation** : lignes ~185-196 du fichier actuel.

---

### Bug #3 — RPC batch non supporté par `mainnet.base.org`

**Problème** : Le RPC public `mainnet.base.org` renvoie des réponses batch sans le champ `result.transactions`, ce qui fait que le batch RPC retourne 0 blocks valides.

**Fix** : Fallback séquentiel automatique. Si la réponse batch ne contient aucun block avec `result.transactions`, le code bascule en appels individuels `eth_getBlockByNumber` avec un throttle de 100ms :

```typescript
// Après le batch
if (!batchWorked) {
  usedSequentialFallback = true;
  for (const blockNum of batch) {
    const blockResult = await fetchBlockSingle(blockNum);
    const found = extractEthTransfers(blockResult, blockNum, botAddressLower, true);
    // ... push transfers
    await sleep(SEQUENTIAL_THROTTLE_MS); // 100ms
  }
}
```

**Localisation** : lignes ~253-327 du fichier actuel.

---

## 3. Bug actuel — Block sampling (🔴 NON CORRIGÉ)

### Symptôme
Avec `{ "from_block": 44523100 }`, le block `44523165` n'apparaît **jamais** dans la liste des blocks scannés.

### Cause racine
```typescript
const totalBlocks = currentBlock - fromBlock;  // ex: 44524600 - 44523100 = 1500
const blockStep = totalBlocks <= 1000 ? 1 : Math.max(1, Math.floor(totalBlocks / 200));
// blockStep = Math.floor(1500 / 200) = 7
```

Le range `from_block → currentBlock` fait ~1500 blocks, ce qui dépasse le seuil de 1000. Le `blockStep` passe à 7, et la boucle scanne :
```
44523100, 44523107, 44523114, ..., 44523156, 44523163, 44523170, ...
```
→ **44523165 est sauté** (entre 44523163 et 44523170).

### Preuve (logs)
```
[deposit-watcher][DEBUG] Block list info {
  total_blocks_in_list: 215,
  blockStep: 7,
  includes_44523165: false,
  first_5: [44523100, 44523107, ...],
  last_5: [...]
}
```

---

## 4. Fix A+B — APPLIQUÉ ✅ (2026-04-10 17:48 UTC)

### Changements appliqués

**Option A — `to_block` explicite** : Ajout du paramètre `to_block` dans le payload. Si absent, `toBlock = currentBlock`.

**Option B — `blockStep = 1` quand `from_block` explicite** :
```typescript
const blockStep = explicitFromBlock ? 1 : (totalBlocks <= 1000 ? 1 : Math.max(1, Math.floor(totalBlocks / 200)));
```

**Remplacement de `currentBlock` par `toBlock`** dans :
- La boucle de scan ETH (ligne 240)
- L'appel `eth_getLogs` ERC20 (ligne 346)
- Le résumé de réponse (ligne 626)

### Résultat du test

```json
POST { "from_block": 44523100, "to_block": 44523200 }

{
  "success": true,
  "summary": {
    "transfers_scanned": 1,      // ← TX TROUVÉE ✅
    "matched": 0,
    "unmatched": 0,
    "ambiguous": 0,
    "already_processed": 1,      // ← déjà traitée (idempotence OK)
    "block_range": { "from": 44523100, "to": 44523200 }
  },
  "duration_ms": 24519
}
```

**La transaction 0.0225 ETH du block 44523165 est détectée.** `already_processed: 1` signifie qu'elle avait déjà été insérée (probablement via un test précédent).

---

## 5. Logs de debug (temporaires)

Logs ajoutés pour diagnostic dans `extractEthTransfers()` et la boucle principale. À retirer après stabilisation.

---

## 6. État final du fichier

| Section | Lignes | Status |
|---------|--------|--------|
| Imports & constantes | 1-43 | ✅ |
| `fetchBlockSingle()` | 48-62 | ✅ |
| `extractEthTransfers()` | 67-116 | ✅ + debug logs |
| `TransferEvent` interface | 118-128 | ✅ |
| `batchRpc()` | 134-162 | ✅ |
| Parsing `from_block` + `to_block` | 184-200 | ✅ MODIFIÉ |
| `blockStep` (force 1 si explicit) | ~237 | ✅ MODIFIÉ |
| Boucle scan → `toBlock` | ~240 | ✅ MODIFIÉ |
| ERC20 getLogs → `toBlock` | ~346 | ✅ MODIFIÉ |
| Réponse block_range → `toBlock` | ~626 | ✅ MODIFIÉ |
| Attribution | 427-604 | ✅ |

Permet de borner le range pour éviter un `totalBlocks` trop grand :
```typescript
let explicitToBlock: number | null = null;
if (body?.to_block && typeof body.to_block === "number") {
  explicitToBlock = body.to_block;
}
const toBlock = explicitToBlock ?? currentBlock;
// Scanner de fromBlock à toBlock au lieu de currentBlock
```

### Option B : Forcer `blockStep = 1` quand le range est raisonnable
```typescript
const blockStep = totalBlocks <= 1000 ? 1 : Math.max(1, Math.floor(totalBlocks / 200));
```
Change le seuil ou force `blockStep = 1` quand `from_block` est explicite :
```typescript
// Si from_block explicite, ne jamais sampler — scanner chaque block
const blockStep = explicitFromBlock ? 1 : (totalBlocks <= 1000 ? 1 : Math.max(1, Math.floor(totalBlocks / 200)));
```

### Recommandation : A + B combinées
1. Ajouter `to_block` pour borner le scan
2. Quand `from_block` est explicite, forcer `blockStep = 1` (scan exhaustif)
3. Garder le cap à `lookback_blocks` (max 1000) pour le mode par défaut

---

## 5. Logs de debug ajoutés (temporaires)

Les logs suivants ont été ajoutés pour le diagnostic et peuvent être retirés après résolution :

1. **Block list info** : nombre de blocks, `blockStep`, inclusion de 44523165
2. **Par block scanné** : nombre de transactions, 3 premiers `tx.to`
3. **Block 44523165 spécifique** : log dédié si ce block est dans la liste, avec matching txs

Localisation : fonction `extractEthTransfers()` (lignes ~67-116) et boucle principale (lignes ~243-250).

---

## 6. État du fichier actuel

| Section | Lignes | Status |
|---------|--------|--------|
| Imports & constantes | 1-43 | ✅ OK |
| `fetchBlockSingle()` | 48-62 | ✅ OK |
| `extractEthTransfers()` | 67-116 | ✅ + debug logs |
| `TransferEvent` interface | 118-128 | ✅ OK |
| `batchRpc()` | 134-162 | ✅ OK |
| Handler principal | 164-640 | ✅ sauf blockStep (bug #3) |
| - Parsing `from_block` | 185-196 | ✅ OK |
| - Block sampling | 234-241 | 🔴 Bug actif |
| - Batch + fallback séquentiel | 253-327 | ✅ OK |
| - ERC20 scan | 336-421 | ✅ OK |
| - Attribution | 427-604 | ✅ OK |

---

## 7. Prochaine action

**En attente d'approbation** pour appliquer le fix A+B :
- Ajouter `to_block` dans le payload
- Forcer `blockStep = 1` quand `from_block` est explicite
- Déployer et tester avec `{ "from_block": 44523100, "to_block": 44523200 }`
