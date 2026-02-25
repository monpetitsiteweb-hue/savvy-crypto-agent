# Engine Mode Regression Investigation

**Date:** 2026-02-25  
**Status:** ✅ RESOLVED — NO REGRESSION FOUND  
**Symptom:** User perceived zero BUY trade activity.

---

## RESOLUTION SUMMARY

**There is no regression.** The entire pipeline is operational:

1. **Engine mode:** `LIVE` (confirmed via `[ENGINE_MODE_DIAG]` runtime logs)
2. **Engine IS calling coordinator** for both BUYs and SELLs
3. **BUY signals ARE positive** (`shouldBuy=true` for all coins)
4. **BUYs are being DEFERRED** by the `is_open_position` guard — NOT blocked by exposure, NOT blocked by shadow mode

### Evidence (10:36 UTC engine logs)

| Coin | BUY Result | Reason |
|------|-----------|--------|
| BTC  | DEFER | `position_already_open` |
| ETH  | **BUY EXECUTED** | `unified_decisions_disabled_direct_path` |
| SOL  | DEFER | `position_already_open` |
| AVAX | DEFER | `position_already_open` |
| XRP  | DEFER | `position_already_open` |
| ADA  | DEFER | `position_already_open` |

ETH was the one coin without an open position — it executed a BUY successfully.

### Why stop-losses are also firing simultaneously

The same engine cycle evaluated exits first:
- BTC → STOP_LOSS → SELL
- ETH → STOP_LOSS → SELL  
- SOL → STOP_LOSS → SELL
- AVAX → STOP_LOSS → SELL

After these SELLs clear the `is_open_position` flag, subsequent cycles will allow new BUYs.

---

## 1. Runtime Engine Mode Proof (CAPTURED)

```
[ENGINE_MODE_DIAG] BACKEND_ENGINE_MODE raw env = "LIVE"
[ENGINE_MODE_DIAG] BACKEND_ENGINE_MODE resolved = LIVE
[ENGINE_MODE_DIAG] effectiveShadowMode = false
[ENGINE_MODE_DIAG] deploymentTimestamp = 2026-02-25T10:34:55.435Z
[ENGINE_MODE_DIAG] BACKEND_ENGINE_USER_ALLOWLIST raw = "25a0c221-1f0e-431d-8d79-db9fb4db9cb3"
[ENGINE_MODE_DIAG] All env keys containing ENGINE = ["BACKEND_ENGINE_MODE","BACKEND_ENGINE_USER_ALLOWLIST","SERVER_SIGNER_MODE"]
```

**Conclusion:** Engine is LIVE. Not shadow. Secrets intact.

---

## 2. Supabase Secrets State

| Secret | Exists | Runtime Value | Notes |
|--------|--------|---------------|-------|
| `BACKEND_ENGINE_MODE` | ✅ YES | `LIVE` | Confirmed via runtime log |
| `BACKEND_ENGINE_USER_ALLOWLIST` | ✅ YES | `25a0c221-...` | Present but allowlist not used for gating in LIVE mode |

---

## 3. BUY Signal Evaluation (ALL POSITIVE)

```
🌑 LIVE: BTC SIGNAL CHECK → rawFusion=0.523, effectiveFusion=0.523, threshold=0.15, shouldBuy=true
🌑 LIVE: ETH SIGNAL CHECK → rawFusion=0.432, effectiveFusion=0.332, threshold=0.15, shouldBuy=true
🌑 LIVE: SOL SIGNAL CHECK → rawFusion=0.600, effectiveFusion=0.600, threshold=0.15, shouldBuy=true
🌑 LIVE: ADA SIGNAL CHECK → rawFusion=0.600, effectiveFusion=0.600, threshold=0.15, shouldBuy=true
🌑 LIVE: XRP SIGNAL CHECK → rawFusion=0.575, effectiveFusion=0.575, threshold=0.15, shouldBuy=true
🌑 LIVE: AVAX SIGNAL CHECK → rawFusion=0.539, effectiveFusion=0.489, threshold=0.15, shouldBuy=true
```

All coins pass signal thresholds. BUY intents ARE being sent to coordinator.

---

## 4. Coordinator BUY Processing

BUYs reach the coordinator and are blocked by `is_open_position`:

```
🌑 LIVE: BTC → action=DEFER, reason=Guards tripped: executionFailed - position_already_open
🌑 LIVE: SOL → action=DEFER, reason=Guards tripped: executionFailed - position_already_open
🌑 LIVE: AVAX → action=DEFER, reason=Guards tripped: executionFailed - position_already_open
🌑 LIVE: XRP → action=DEFER, reason=Guards tripped: executionFailed - position_already_open
🌑 LIVE: ADA → action=DEFER, reason=Guards tripped: executionFailed - position_already_open
🌑 LIVE: ETH → action=BUY, reason=unified_decisions_disabled_direct_path ← EXECUTED
```

---

## 5. Deployment Impact Assessment

Today's changes (exposure instrumentation, engine diagnostics) did NOT cause any regression:

- Engine boots correctly (no TypeErrors, no syntax errors)
- Coordinator boots correctly
- All signal evaluation paths intact
- All coordinator routing paths intact
- Exposure instrumentation is logging-only (no logic changes)

---

## 6. Diagnostic Cleanup

The `[ENGINE_MODE_DIAG]` and `[EXPOSURE_DIAG]` temporary logs can now be removed. Investigation is complete.

---

## 7. Separate Concern: `enableUnifiedDecisions` Resolution

A secondary observation: strategy config has `enableUnifiedDecisions: true` but coordinator resolves it as `false`. This causes trades to route through `UD_MODE=OFF` (direct path) instead of `UD_MODE=ON`. This is a separate investigation item — it does NOT prevent trades from executing.
