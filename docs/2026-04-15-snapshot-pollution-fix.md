# Changelog — 15 avril 2026 (2/2)

## Résumé

Correction de la pollution des `decision_snapshots` par `mergeMlShadowIntoSnapshot()`. Cette fonction écrasait le champ `market_context_json.ml_shadow` de snapshots existants avec les données ML d'un cycle ultérieur, rendant le monitoring trompeur.

---

## Problème

Quand le ML évaluait un symbole à `ensemble_prob=0.28` (→ HOLD, snapshot écrit avec `ml_filter_blocked`), puis au cycle suivant à `ensemble_prob=0.97` (→ BUY, coordinator appelé), la fonction `mergeMlShadowIntoSnapshot()` dans la branche BUY cherchait le `decision_event` le plus récent pour ce symbole et mettait à jour **son** snapshot.

Résultat : un snapshot marqué `ml_filter_blocked` (correct) affichait `ensemble_prob=0.97` (provenant d'un cycle ultérieur), donnant l'impression fausse que le système avait raté une opportunité.

### Preuve

| Champ | Snapshot (pollué) | decision_event (vérité) |
|-------|-------------------|------------------------|
| XRP 09:10 | ensemble_prob=0.9698 | confidence=**0.2778** |
| ADA 10:20 | ensemble_prob=0.9763 | confidence=**0.8842** |

**Aucun signal n'a réellement atteint 0.90.** Le maximum réel était ADA à 0.8993.

---

## Fichier modifié

### `supabase/functions/backend-shadow-engine/index.ts`

---

## Code supprimé

### Branche ML BUY (`ml_signal_buy`) — lignes 1325–1332

**BEFORE** :
```typescript
              // Merge ml_shadow into snapshot
              if (strategy?.id) {
                try {
                  await mergeMlShadowIntoSnapshot(supabaseClient, userId, strategy.id, baseSymbol, mlShadow);
                } catch (mergeErr: any) {
                  console.warn(`[ml_shadow] ${baseSymbol}: merge failed (non-fatal): ${mergeErr?.message || mergeErr}`);
                }
              }
```

**AFTER** :
```typescript
              // NOTE: Do NOT call mergeMlShadowIntoSnapshot here.
              // The ml_signal_buy snapshot is written by the coordinator with ml_shadow
              // already in intent.metadata. Calling merge would pollute older HOLD snapshots.
```

---

## Code NON modifié

| Composant | Statut | Raison |
|-----------|--------|--------|
| Branche HOLD (`ml_filter_blocked`) | ❌ Non modifié | Écrit déjà ses propres `decision_event` + `decision_snapshot` directement (lignes 1341–1433) |
| Fallback coordinator (ML down) | ❌ Non modifié | Conserve `mergeMlShadowIntoSnapshot` (ligne 1554–1560) car le coordinator ne propage pas `ml_shadow` dans son snapshot |
| Fonction `mergeMlShadowIntoSnapshot()` | ❌ Non modifié | Toujours utilisée par le fallback coordinator |
| `computeEdaShadow()` | ❌ Non modifié | |
| Logique SELL / TP / SL / trailing | ❌ Non modifié | |

---

## Impact

- Les snapshots `ml_filter_blocked` reflètent désormais **uniquement** les données ML du cycle qui a produit la décision
- Les snapshots `ml_signal_buy` (quand un trade sera déclenché) contiendront les données ML via `intent.metadata.ml_shadow` propagé par le coordinator
- Le fallback coordinator continue de bénéficier de `mergeMlShadowIntoSnapshot` pour enrichir ses snapshots avec les données ML
- **Le monitoring est désormais fiable** : `ensemble_prob` dans un snapshot = valeur au moment de la décision
