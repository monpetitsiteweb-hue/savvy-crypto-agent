# Engine Mode Regression Investigation

**Date:** 2026-02-25  
**Status:** ACTIVE INVESTIGATION  
**Symptom:** Trades were firing this morning. Now zero trade activity.

---

## 1. Runtime Engine Mode Proof

### Diagnostic Deployed

Temporary logging added to `supabase/functions/backend-shadow-engine/index.ts` at module-level (fires on cold boot):

```
[ENGINE_MODE_DIAG] BACKEND_ENGINE_MODE raw env = <value>
[ENGINE_MODE_DIAG] BACKEND_ENGINE_MODE resolved = <value>
[ENGINE_MODE_DIAG] effectiveShadowMode = <boolean>
[ENGINE_MODE_DIAG] deploymentTimestamp = <ISO timestamp>
[ENGINE_MODE_DIAG] BACKEND_ENGINE_USER_ALLOWLIST raw = <value>
[ENGINE_MODE_DIAG] All env keys containing ENGINE = <array>
```

### Current Status

**⚠️ CANNOT CAPTURE OUTPUT YET** — The engine has NOT been invoked since diagnostics were deployed. See Section 4 for why.

---

## 2. Supabase Secrets State

| Secret | Exists | Value | Notes |
|--------|--------|-------|-------|
| `BACKEND_ENGINE_MODE` | ✅ YES | 🔒 Encrypted (not readable) | Cannot confirm if SHADOW or LIVE |
| `BACKEND_ENGINE_USER_ALLOWLIST` | ✅ YES | 🔒 Encrypted | Cannot confirm user IDs |
| `CRON_SECRET` | ✅ YES | 🔒 Encrypted | Used by GitHub Actions auth |
| `WHALE_ALERT_API_KEY` | ✅ YES | 🔒 Encrypted | — |
| `SIGNER_WEBHOOK_URL` | ✅ YES | 🔒 Encrypted | — |
| `SIGNER_WEBHOOK_AUTH` | ✅ YES | 🔒 Encrypted | — |

**Key Finding:** `BACKEND_ENGINE_MODE` secret exists. Value cannot be inspected from Lovable. **The user must verify the value directly in Supabase Dashboard → Edge Functions → Secrets.**

**Project Ref:** `fuieplftlcxdfkxyqzlt` (confirmed from `.env` and `supabase/config.toml`)

---

## 3. Edge Function Log Evidence

### backend-shadow-engine logs
```
RESULT: No logs found.
```

### trading-decision-coordinator logs
```
RESULT: No logs found.
```

### Interpretation
- **ZERO invocations** of `backend-shadow-engine` in the recent log window
- **ZERO invocations** of `trading-decision-coordinator` in the recent log window
- This means the engine is NOT being called at all — not even in SHADOW mode
- The issue is **upstream of the engine** (the invoker is not running)

---

## 4. GitHub Actions Cron Analysis

### Workflow File: `.github/workflows/backend-shadow-engine-5min.yml`

| Property | Value |
|----------|-------|
| File exists | ✅ YES |
| Cron schedule | `*/5 * * * *` (every 5 minutes) |
| Trigger | `schedule` + `workflow_dispatch` |
| Required GitHub Secrets | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |

### What the cron does (lines 36-75):
1. Queries `trading_strategies?is_active=eq.true` to get active user IDs
2. For each user, POSTs to `${SUPABASE_URL}/functions/v1/backend-shadow-engine`
3. Uses `Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}` (bypasses JWT verification)

### Possible Failure Points

| Failure Mode | Evidence |
|-------------|----------|
| **Cron disabled by GitHub** | GitHub auto-disables crons on repos with no commits for 60+ days. **CANNOT VERIFY FROM LOVABLE.** |
| **GitHub Secrets deleted/expired** | `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` missing → cron runs but all curl calls fail silently |
| **No active strategies** | If `trading_strategies?is_active=eq.true` returns empty → cron exits at line 48-50 with "No active strategies found" |
| **Workflow file changed** | File is present and correct in repo |
| **Repository visibility change** | Private repos have limited Actions minutes |

---

## 5. Root Cause Analysis (Evidence-Based)

### What we KNOW:
1. ✅ `BACKEND_ENGINE_MODE` secret exists in Supabase
2. ✅ Workflow file exists with correct cron schedule
3. ❌ Zero `backend-shadow-engine` logs (engine not being invoked)
4. ❌ Zero `trading-decision-coordinator` logs (coordinator not being invoked)
5. ✅ `real-time-market-data` IS running (logs show price collection at ~timestamp 1772015047)
6. ✅ `crypto-news-collector` IS running (logs show 403 errors at ~same timestamp)

### What this tells us:
- **Supabase edge functions infrastructure is operational** (market data and news collectors are running)
- **The problem is NOT Supabase secrets or engine code** — the engine is never reached
- **The problem is the INVOKER** — GitHub Actions cron is not calling the engine

### Most Likely Root Cause:
**GitHub Actions cron is not executing.** Possible reasons:
1. **GitHub auto-disabled the cron** (most common — happens after 60 days of inactivity on the default branch)
2. **GitHub Actions minutes exhausted** (if private repo on free plan)
3. **GitHub Secrets (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) were removed or rotated**

---

## 6. Required User Actions

### IMMEDIATE (verify from GitHub):
1. Go to **GitHub → Actions tab** → Check if `Backend Shadow Engine (5min)` workflow shows recent runs
2. If no recent runs: Check if workflow is disabled (yellow banner at top)
3. If disabled: Click "Enable workflow"
4. Check **GitHub → Settings → Secrets and variables → Actions** → Confirm `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` exist

### IMMEDIATE (verify from Supabase):
1. Go to **Supabase Dashboard → Edge Functions → Secrets**
2. Confirm `BACKEND_ENGINE_MODE` value is `LIVE` (not `SHADOW`)
3. Confirm `BACKEND_ENGINE_USER_ALLOWLIST` contains your user ID

### After re-enabling cron:
1. Trigger workflow manually: **GitHub → Actions → Backend Shadow Engine → Run workflow**
2. Check Supabase edge function logs for `[ENGINE_MODE_DIAG]` output
3. Report back the raw diagnostic values

---

## 7. Diagnostic Logging Location

**File:** `supabase/functions/backend-shadow-engine/index.ts`  
**Lines:** 28-38 (module-level, fires on cold boot)  
**Prefix:** `[ENGINE_MODE_DIAG]`  
**Cleanup:** Remove after investigation is complete

---

## 8. Timeline Correlation Needed

| Event | Timestamp | Source |
|-------|-----------|--------|
| Last known trade | ? (user reports "this morning") | `mock_trades` table |
| Last `backend-shadow-engine` log | None found | Supabase logs |
| Last `real-time-market-data` log | ~2026-02-25T~recent | Supabase logs (confirmed active) |
| Last GitHub Actions run | ? | GitHub Actions tab |
| Diagnostic deployed | 2026-02-25 (this session) | This commit |

**User must provide:** Last GitHub Actions run timestamp to correlate with last trade timestamp.
