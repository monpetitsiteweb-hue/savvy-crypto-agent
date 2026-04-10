# Deposit Watcher — Debug Report 2026-04-10

## Contexte

Transaction ETH native envoyée au system wallet, non détectée par `onchain-deposit-watcher`.

### Transaction cible

| Champ | Valeur |
|-------|--------|
| Block | `44523165` |
| From | `0xD02172fB...dbF30cc04` |
| To | `0x115030C501b87c0C64834281c704EFDd36D4978d` (BOT_ADDRESS) |
| Amount | `0.0225 ETH` |
| Type | Transfert ETH natif (premier niveau, pas internal tx) |
| Confirmé sur | BaseScan → onglet "Transactions" |

---

## Chronologie des interventions

### 1. Bug initial — Batch RPC ID alignment (corrigé)

**Fichier** : `supabase/functions/onchain-deposit-watcher/index.ts`

**Problème** : Le code supposait que `results[j]` correspondait à `batch[j]` après tri par `id`. Faux car les IDs étaient calculés comme `i + idx + 100`, créant un désalignement quand les réponses RPC arrivaient dans un ordre différent.

**Fix appliqué** :
```typescript
// AVANT (bugué)
const blockNum = batch[j];

// APRÈS (corrigé)
const callIndex = result.id - 100 - i;
const blockNum = batch[callIndex];
if (blockNum === undefined) continue;
```

**Statut** : ✅ Corrigé et déployé

---

### 2. Ajout du paramètre `from_block` explicite

**Fichier** : `supabase/functions/onchain-deposit-watcher/index.ts`

**Problème** : Le block 44523165 était sorti de la fenêtre de lookback par défaut (200 blocks). Impossible de re-scanner un block ancien.

**Fix appliqué** :
```typescript
// Lecture du body
let explicitFromBlock: number | null = null;
if (body?.from_block && typeof body.from_block === "number") {
  explicitFromBlock = body.from_block;
}

// Calcul du range
const fromBlock = explicitFromBlock ?? (currentBlock - lookbackBlocks);
```

**Statut** : ✅ Corrigé et déployé

---

### 3. Fallback séquentiel quand le batch RPC échoue

**Fichier** : `supabase/functions/onchain-deposit-watcher/index.ts`

**Problème** : Le RPC public `mainnet.base.org` ne supporte pas le JSON-RPC batching. Les réponses batch revenaient sans `result.transactions`, et le code les sautait silencieusement → `transfers_found: 0`.

**Fix appliqué** :
- Tenter le batch RPC en premier
- Compter les résultats valides (`validCount`)
- Si `validCount === 0` → fallback automatique en appels séquentiels individuels `eth_getBlockByNumber`
- Throttle de 100ms entre chaque appel séquentiel pour éviter le rate limit

```typescript
const validCount = results.filter(
  (r: any) => r?.result?.transactions !== undefined
).length;

if (validCount > 0) {
  batchWorked = true;
  // ... traitement batch normal
} else {
  logger.warn("[deposit-watcher] Batch returned 0 valid blocks, falling back to sequential");
}

// Sequential fallback
if (!batchWorked) {
  usedSequentialFallback = true;
  for (const blockNum of batch) {
    const blockResult = await fetchBlockSingle(blockNum);
    const found = extractEthTransfers(blockResult, blockNum, botAddressLower, true);
    // ...
    await sleep(SEQUENTIAL_THROTTLE_MS); // 100ms
  }
}
```

**Fonctions helper ajoutées** :
- `fetchBlockSingle(blockNum)` — appel RPC individuel
- `extractEthTransfers(blockResult, blockNum, botAddressLower, debug)` — extraction factorisée
- `sleep(ms)` — throttle

**Statut** : ✅ Corrigé et déployé. Le fallback fonctionne (confirmé par logs : "Used sequential fallback for ETH scan", durée ~48s).

---

### 4. Logs de debug temporaires ajoutés

**Fichier** : `supabase/functions/onchain-deposit-watcher/index.ts`

**Ajouts** :
- Log du nombre de transactions dans chaque block scanné
- Log spécial si block `44523165` est rencontré (avec les 3 premiers `tx.to` et les txs matchant le BOT_ADDRESS)
- Log de la liste des blocks (`includes_44523165`, `blockStep`, `first_5`, `last_5`)

**Statut** : ✅ Déployé (temporaire, à retirer après résolution)

---

## 5. BUG RACINE IDENTIFIÉ — Block sampling saute le block cible

### Diagnostic

Après déploiement des logs de debug et exécution avec `{ "from_block": 44523160 }` :

**Logs observés** :
```
Block scanned { block: 44524378, tx_count: 167 }
Block scanned { block: 44524385, tx_count: 205 }
Block scanned { block: 44524392, tx_count: 195 }
Block scanned { block: 44524399, tx_count: 204 }
...
```

**Constatations** :
1. Les blocks sont scannés **par pas de 7** (44524378, 44524385, 44524392...)
2. Le block `44523165` **n'apparaît jamais** dans les logs
3. Le log "Block list info" n'apparaît pas non plus (probablement tronqué ou pas encore visible)

### Cause racine

```typescript
const totalBlocks = currentBlock - fromBlock;
// totalBlocks ≈ 1500 (44524700 - 44523160)
const blockStep = totalBlocks <= 1000 ? 1 : Math.max(1, Math.floor(totalBlocks / 200));
// blockStep = Math.floor(1500 / 200) = 7
```

Quand `from_block` est explicite :
- Le `to_block` est implicitement le block courant (~44524700)
- Le range total est ~1500 blocks (> 1000)
- Le sampling s'active : `blockStep = 7`
- Block 44523160 + 7n = 44523160, 44523167, 44523174... → **44523165 est sauté**

### La reliability policy (mémoire projet) stipule :

> `blockStep = 1` obligatoire pour les fenêtres ≤ 1000 blocks.

Mais ici le range est 1500 blocks car `to_block` n'est pas borné.

---

## Fix requis (NON ENCORE APPLIQUÉ)

**Deux options** :

### Option A — Ajouter `to_block` explicite
```typescript
// Si from_block est explicite et to_block aussi → scanner exactement ce range
// Si from_block est explicite sans to_block → to_block = from_block + lookback_blocks
const toBlock = explicitToBlock ?? (explicitFromBlock ? fromBlock + lookbackBlocks : currentBlock);
```
**Avantage** : Contrôle précis, pas de scan inutile  
**Inconvénient** : Nécessite un paramètre supplémentaire

### Option B — Forcer `blockStep = 1` quand `from_block` est explicite
```typescript
const blockStep = explicitFromBlock ? 1 : (totalBlocks <= 1000 ? 1 : Math.max(1, Math.floor(totalBlocks / 200)));
```
**Avantage** : Simple, pas de nouveau paramètre  
**Inconvénient** : Si from_block est très ancien, le scan séquentiel de milliers de blocks provoquera un timeout

### Recommandation : Option A + B combinées
- Ajouter `to_block` optionnel
- Quand `from_block` est explicite sans `to_block`, borner à `from_block + lookback_blocks`
- Forcer `blockStep = 1` dans tous les cas pour les ranges ≤ 1000 blocks

---

## Fichiers modifiés

| Fichier | Modifications |
|---------|--------------|
| `supabase/functions/onchain-deposit-watcher/index.ts` | Bug fix batch ID alignment, ajout `from_block`, fallback séquentiel, logs debug, helpers `fetchBlockSingle` / `extractEthTransfers` / `sleep` |

## État actuel

- ❌ La transaction 0.0225 ETH au block 44523165 n'est toujours pas détectée
- ✅ Le fallback séquentiel fonctionne
- ✅ Le batch ID alignment est corrigé
- ⏳ **Le fix du sampling (blockStep) est en attente d'approbation**
- ⏳ Les logs de debug sont encore en place (à retirer après résolution)
