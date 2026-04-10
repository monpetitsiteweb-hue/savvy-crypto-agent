# Trace brute — SELL `source='intelligent'` en REAL dans `trading-decision-coordinator`

**Lecture seule.**  
**But du document :** montrer le code brut exact du chemin emprunté par un intent `source='intelligent'` avec `side='SELL'` quand `execution_target='REAL'`.

---

## 1) Point d'entrée `source='intelligent'`

> Il n'existe pas une ligne unique qui teste à la fois `source='intelligent'` **et** `side='SELL'` au point d'entrée.  
> L'entrée « intelligent » se fait ici, puis la branche `SELL` est choisie plus loin dans le bloc automated REAL.

```text
2095:     // They have source='intelligent' but NO debugTag='forced_debug_trade'
2096:     // We MUST log them to decision_events with source='intelligent' for learning loop
2097:     const isNormalIntelligentTrade =
2098:       intent?.source === "intelligent" && intent?.metadata?.debugTag !== "forced_debug_trade";
2099: 
2100:     // DEBUG INSTRUMENTATION: Track BUY pipeline entry
2101:     console.log("[DEBUG][COORD] ========== INTELLIGENT TRADE PIPELINE ==========");
2102:     console.log("[DEBUG][COORD] isNormalIntelligentTrade:", isNormalIntelligentTrade);
2103:     console.log("[DEBUG][COORD] intent.strategyId:", intent.strategyId);
2104:     console.log("[DEBUG][COORD] intent.side:", intent.side);
2105:     console.log("[DEBUG][COORD] intent.source:", intent.source);
2106:     console.log("[DEBUG][COORD] intent.metadata?.is_test_mode:", intent.metadata?.is_test_mode);
2107: 
2108:     if (isNormalIntelligentTrade && intent.strategyId) {
2109:       console.log("[DEBUG][COORD] ENTERED normal intelligent trade block");
2110:       console.log("🧠 INTELLIGENT DECISION – normal trade path", {
2111:         source: intent.source,
2112:         symbol: intent.symbol,
2113:         side: intent.side,
2114:         strategyId: intent.strategyId,
2115:         engine: intent.metadata?.engine,
2116:         reason: intent.reason,
2117:         confidence: intent.confidence,
2118:       });
```

---

## 2) Si la stratégie est `execution_target='REAL'`, le code **tombe** vers le flow principal REAL

```text
2145:       // State/execution gate for intelligent trades (early check)
2146:       const intStrategyState = strategyConfig.state || "ACTIVE";
2147:       const intExecutionTarget = strategyConfig.execution_target || "MOCK";
2148:       const intPanicActive = strategyConfig.panic_active === true;
2149: 
2150:       // Panic gate (hard blocker)
2151:       if (intPanicActive) {
2152:         console.log("🚫 INTELLIGENT: PANIC ACTIVE - trade blocked");
2153:         return new Response(
2154:           JSON.stringify({
2155:             ok: true,
2156:             decision: { action: "BLOCK", reason: "blocked_panic_active", request_id: requestId, retry_in_ms: 0 },
2157:           }),
2158:           { headers: corsHeaders },
2159:         );
2160:       }
2161: 
2162:       // REAL mode: Let it fall through to the main REAL execution path below
2163:       // The main coordinator REAL gate handles prerequisites and execution_jobs insertion
2164:       if (intExecutionTarget === "REAL") {
2165:         console.log("🔥 INTELLIGENT: REAL mode - falling through to main REAL execution path");
2166:         // Don't block here - let the main flow handle REAL mode with prerequisites check
2167:       }
2168: 
2169:       if (intent.side === "BUY" && intStrategyState !== "ACTIVE") {
2170:         console.log(`🚫 INTELLIGENT: BUY blocked - strategy state is ${intStrategyState}`);
2171:         return new Response(
2172:           JSON.stringify({
2173:             ok: true,
2174:             decision: {
2175:               action: "BLOCK",
2176:               reason: "blocked_strategy_not_active",
2177:               request_id: requestId,
2178:               retry_in_ms: 0,
2179:               strategy_state: intStrategyState,
2180:             },
2181:           }),
2182:           { headers: corsHeaders },
2183:         );
2184:       }
```

Et la sortie du bloc intelligent est ici :

```text
2225:       // ARCHITECTURE FIX: Do NOT log decision_events here (pre-execution).
2226:       // The execution paths (UD=OFF at line ~3828, UD=ON at line ~6585) already log
2227:       // the authoritative decision_event WITH trade_id after successful execution.
2228:       // Logging here created orphan rows with trade_id=NULL (Bucket C in forensic audit).
2229:       console.log("[COORD] Intelligent fast path: skipping pre-execution decision_event (coordinator logs post-execution)");
2230:       console.log("[DEBUG][COORD] About to fall through to regular coordinator flow for execution");
2231:       console.log("[DEBUG][COORD] intent.side for execution:", intent.side);
2232:     } else {
2233:       console.log("[DEBUG][COORD] SKIPPED normal intelligent trade block");
```

---

## 3) Le `execClass` est dérivé avec `target='REAL'`

```text
2916:     // =============================================================================
2917:     // PHASE 2: CENTRALIZED EXECUTION SEMANTICS
2918:     // =============================================================================
2919:     // Use deriveExecutionClass() as the SINGLE POINT OF TRUTH for execution classification.
2920:     // All downstream logic MUST derive from execClass, not from raw flags.
2921:     // Legacy flags (source, system_operator_mode, force, execution_wallet_id) are
2922:     // interpreted ONLY in deriveExecutionClass() and are DEPRECATED for direct use.
2923:     // =============================================================================
2924:     const execClass: ExecutionClass = deriveExecutionClass({
2925:       source: intent.source,
2926:       metadata: intent.metadata,
2927:       strategyExecutionTarget: strategyExecutionTarget,
2928:     });
2929: 
2930:     // Log the derived execution class for diagnostics (Phase 2 requirement)
2931:     logExecutionClass(execClass, requestId);
2932: 
2933:     // =============================================================================
2934:     // DERIVED CONVENIENCE VARIABLES (from execClass, not raw flags)
2935:     // These replace the previous scattered flag checks.
2936:     // Deprecated: canonicalExecutionMode, isMockExecution computed from raw flags
2937:     // =============================================================================
2938:     type ExecutionMode = "REAL" | "MOCK";
2939:     // Deprecated: computed inline from raw flags - now derived from execClass
2940:     const canonicalExecutionMode: ExecutionMode = execClass.target;
2941:     const isMockExecution = execClass.isMockExecution;
2942:     const canonicalIsTestMode = isMockExecution; // Alias for passing to sub-functions
```

---

## 4) Entrée dans le bloc REAL principal

```text
3156:     // ============= REAL MODE EXECUTION PATH (Phase 1) =============
3157:     // REAL mode: Check prerequisites, then execute
3158:     // MANUAL trades with execution_wallet_id → DIRECT SYNCHRONOUS EXECUTION
3159:     // AUTOMATED trades → route to execution_jobs (async) for worker processing
3160:     if (execClass.target === "REAL") {
3161:       // Phase 2: Use execClass-derived flags instead of raw flag checks
3162:       // Deprecated: Direct checks like `intent.source === "manual"`
3163:       const isManualIntent = execClass.isManualTrade;
3164:       const hasWalletId = !!intent.metadata?.execution_wallet_id;
3165:       
3166:       // Phase 2: Use execClass.isSystemOperator instead of raw flag check
3167:       // Deprecated: `intent.source === "manual" && intent.metadata?.system_operator_mode === true`
3168:       const isSystemOperatorMode = execClass.isSystemOperator;
3169:       
3170:       console.log("🔥 COORDINATOR: REAL mode detected", {
3171:         isManualIntent,
3172:         isSystemOperatorMode,
3173:         hasWalletId,
3174:         execution_wallet_id: intent.metadata?.execution_wallet_id,
3175:         // Deprecated: system_operator_mode - use execClass.isSystemOperator
3176:         system_operator_mode: intent.metadata?.system_operator_mode,
3177:         request_id: requestId,
3178:         // Phase 2: Include execClass for observability
3179:         execClass_authority: execClass.authority,
3180:         execClass_intent: execClass.intent,
3181:       });
3182: 
3183:       // For system_operator_mode OR automated intelligent trades: skip user wallet checks (uses SYSTEM wallet)
3184:       // Phase 2: Deprecated check - now derived from execClass.isSystemOperator
3185:       const isAutomatedIntelligent = intent.source === "intelligent";
3186:       if (isSystemOperatorMode || isAutomatedIntelligent) {
3187:         const skipLabel = isSystemOperatorMode ? "system_operator_mode" : "automated_intelligent";
3188:         console.log(`🔧 COORDINATOR: ${skipLabel} - skipping user wallet prerequisite checks (uses SYSTEM wallet)`);
3189:       } else {
```

---

## 5) Le fast-path manual est **sauté**

```text
3305:       // =============================================================================
3306:       // MANUAL FAST-PATH: Direct synchronous on-chain execution
3307:       // This path is triggered by: source === "manual" + execution_wallet_id
3308:       // It bypasses the async execution_jobs queue and executes immediately.
3309:       // This SAME flow will be used by automated trades once they're trusted.
3310:       //
3311:       // ARCHITECTURE: Coordinator calls ONLY onchain-sign-and-send with raw params.
3312:       // onchain-sign-and-send internally handles: quote → build → sign → broadcast
3313:       // This ensures ONE execution path for both MANUAL and future AUTO trades.
3314:       // =============================================================================
3315:       if (intent.source === "manual" && hasWalletId) {
3316:         const modeLabel = isSystemOperatorMode ? "SYSTEM_OPERATOR" : "MANUAL";
3317:         console.log(`🚀 COORDINATOR: ${modeLabel} FAST-PATH - calling onchain-sign-and-send`);
```

Pour un SELL `source='intelligent'`, cette condition est **fausse**.

---

## 6) Le SELL intelligent REAL passe dans **le même bloc L3572-3883** que le BUY automated

```text
3572:       // =============================================================================
3573:       // AUTOMATED PATH: Direct synchronous on-chain execution
3574:       // This path is for automated trades from backend-shadow-engine (source=intelligent)
3575:       // Same architecture as Manual/System Operator: coordinator → onchain-sign-and-send
3576:       // =============================================================================
3577:       console.log("🤖 COORDINATOR: AUTOMATED INTELLIGENT PATH - synchronous on-chain execution");
3578: 
3579:       const baseSymbol = toBaseSymbol(intent.symbol);
3580:       const slippageBps = 50; // Tighter slippage for automated trades
3581: 
3582:       // Determine amount based on side (same logic as Manual path)
3583:       let tradeAmount: number;
3584:       if (intent.side === "BUY") {
3585:         const eurAmount = intent.metadata?.eurAmount;
3586:         if (!eurAmount || eurAmount <= 0) {
3587:           console.error("❌ COORDINATOR: Automated BUY requires eurAmount in metadata");
3588:           return new Response(
3589:             JSON.stringify({
3590:               ok: false,
3591:               success: false,
3592:               error: "blocked_missing_eur_amount",
3593:               decision: {
3594:                 action: "BLOCK",
3595:                 reason: "blocked_missing_eur_amount",
3596:                 request_id: requestId,
3597:                 message: "Automated BUY requires eurAmount in metadata.",
3598:               },
3599:             }),
3600:             { headers: { ...corsHeaders, "Content-Type": "application/json" } },
3601:           );
3602:         }
3603:         tradeAmount = eurAmount;
3604:       } else {
3605:         const sellQty = intent.qtySuggested;
3606:         if (!sellQty || sellQty <= 0) {
3607:           console.error("❌ COORDINATOR: Automated SELL requires qtySuggested");
3608:           return new Response(
3609:             JSON.stringify({
3610:               ok: false,
3611:               success: false,
3612:               error: "blocked_missing_sell_qty",
3613:               decision: {
3614:                 action: "BLOCK",
3615:                 reason: "blocked_missing_sell_qty",
3616:                 request_id: requestId,
3617:                 message: "Automated SELL requires qtySuggested.",
3618:               },
3619:             }),
3620:             { headers: { ...corsHeaders, "Content-Type": "application/json" } },
3621:           );
3622:         }
3623:         tradeAmount = sellQty;
3624:       }
```

**C'est ici que le `SELL` est réellement branché** : `L3604-L3624`.

---

## 7) Placeholder `mock_trades` créé avant l'appel on-chain

```text
3683:         // STEP 3: Insert placeholder mock_trades
3684:         const mockTradeId = crypto.randomUUID();
3685:         const isBuySide = intent.side.toLowerCase() === "buy";
3686:         const placeholderRecord = {
3687:           id: mockTradeId,
3688:           user_id: intent.userId,
3689:           strategy_id: intent.strategyId,
3690:           cryptocurrency: baseSymbol,
3691:           trade_type: intent.side.toLowerCase(),
3692:           amount: tradeAmount,
3693:           price: 0,
3694:           total_value: 0,
3695:           executed_at: new Date().toISOString(),
3696:           is_test_mode: false,
3697:           is_system_operator: false,
3698:           execution_source: 'onchain_pending',
3699:           execution_confirmed: false,
3700:           notes: 'PENDING_ONCHAIN: Automated intelligent trade awaiting receipt confirmation',
3701:           idempotency_key: `pending_${mockTradeId}`,
3702:           ...(isBuySide ? { is_open_position: true } : {}),
3703:         };
3704: 
3705:         const { error: placeholderError } = await supabaseClient
3706:           .from("mock_trades")
3707:           .insert(placeholderRecord);
3708: 
3709:         if (placeholderError) {
3710:           console.error("❌ COORDINATOR: Failed to insert automated mock_trades placeholder:", placeholderError);
3711:           return new Response(
3712:             JSON.stringify({
3713:               ok: false,
3714:               success: false,
3715:               error: "placeholder_insert_failed",
3716:               decision: {
3717:                 action: "DEFER",
3718:                 reason: "placeholder_insert_failed",
3719:                 request_id: requestId,
3720:                 message: `Failed to prepare automated trade: ${placeholderError.message}`,
3721:               },
3722:             }),
3723:             { headers: { ...corsHeaders, "Content-Type": "application/json" } },
3724:           );
3725:         }
```

---

## 8) Appel on-chain synchrone — SELL transmis à `onchain-sign-and-send`

```text
3735:         // STEP 4: Synchronous call to onchain-sign-and-send
3736:         console.log("📡 COORDINATOR: AUTOMATED calling onchain-sign-and-send", {
3737:           symbol: baseSymbol,
3738:           side: intent.side,
3739:           amount: tradeAmount,
3740:           taker: BOT_ADDRESS,
3741:           slippageBps,
3742:           mock_trade_id: mockTradeId,
3743:         });
3744: 
3745:         let signSendData: any;
3746:         try {
3747:           const signSendResponse = await fetch(`${PROJECT_URL}/functions/v1/onchain-sign-and-send`, {
3748:             method: "POST",
3749:             headers: {
3750:               "Content-Type": "application/json",
3751:               Authorization: `Bearer ${SERVICE_ROLE}`,
3752:               apikey: SERVICE_ROLE!,
3753:             },
3754:             body: JSON.stringify({
3755:               symbol: baseSymbol,
3756:               side: intent.side,
3757:               amount: tradeAmount,
3758:               taker: BOT_ADDRESS,
3759:               slippageBps,
3760:               system_operator_mode: true,
3761:               mock_trade_id: mockTradeId,
3762:             }),
3763:           });
```

Ici, pour un SELL intelligent REAL, `intent.side === 'SELL'` et `tradeAmount === intent.qtySuggested`.

---

## 9) Branche d'abandon si l'exécution on-chain échoue

```text
3783:         } catch (execError: any) {
3784:           console.error("❌ COORDINATOR: AUTOMATED Execution error:", execError.message);
3785: 
3786:           const { data: _diAutoExecFail } = await supabaseClient.from("decision_events").insert({
3787:             user_id: intent.userId,
3788:             strategy_id: intent.strategyId,
3789:             symbol: baseSymbol,
3790:             side: intent.side,
3791:             source: intent.source,
3792:             confidence: intent.confidence,
3793:             reason: "automated_execution_failed",
3794:             decision_ts: new Date().toISOString(),
3795:             metadata: buildDecisionMetadata({
3796:               error: execError.message,
3797:               request_id: requestId,
3798:               fast_path: "AUTOMATED_INTELLIGENT",
3799:             }, false),
3800:           }).select("id");
3801:           await writeSnapshotForDirectInsert(supabaseClient, _diAutoExecFail?.[0]?.id, intent.userId, intent.strategyId, baseSymbol, intent.side, "DEFER", "automated_execution_failed", false);
3802: 
3803:           return new Response(
3804:             JSON.stringify({
3805:               ok: false,
3806:               success: false,
3807:               error: "execution_failed",
3808:               reason: execError.message,
3809:               decision: {
3810:                 action: "DEFER",
3811:                 reason: "automated_execution_failed",
3812:                 request_id: requestId,
3813:                 message: `Automated execution failed: ${execError.message}`,
3814:               },
3815:             }),
3816:             { headers: { ...corsHeaders, "Content-Type": "application/json" } },
3817:           );
3818:         }
```

**Dernière ligne de retour d'abandon dans ce sous-chemin : `L3803`** (`return new Response(...)`).

---

## 10) Branche succès

```text
3820:         // STEP 5: Success — log decision_event
3821:         console.log("🎉 COORDINATOR: AUTOMATED TRADE EXECUTED SUCCESSFULLY", {
3822:           tradeId: signSendData.tradeId,
3823:           txHash: signSendData.tx_hash,
3824:           symbol: baseSymbol,
3825:           side: intent.side,
3826:           amount: tradeAmount,
3827:           source: "automated_intelligent",
3828:         });
3829: 
3830:         const { data: _diAutoExecOk } = await supabaseClient.from("decision_events").insert({
3831:           user_id: intent.userId,
3832:           strategy_id: intent.strategyId,
3833:           symbol: baseSymbol,
3834:           side: intent.side,
3835:           source: intent.source,
3836:           confidence: intent.confidence,
3837:           entry_price: signSendData.executedPrice,
3838:           reason: "real_execution_synchronous",
3839:           decision_ts: new Date().toISOString(),
3840:           trade_id: signSendData.tradeId,
3841:           metadata: buildDecisionMetadata({
3842:             tx_hash: signSendData.tx_hash,
3843:             trade_id: signSendData.tradeId,
3844:             wallet_address: BOT_ADDRESS,
3845:             execution_status: "SUBMITTED",
3846:             fast_path: "AUTOMATED_INTELLIGENT",
3847:             amount: tradeAmount,
3848:             slippage_bps: slippageBps,
3849:             request_id: requestId,
3850:           }, false),
3851:         }).select("id");
3852:         await writeSnapshotForDirectInsert(supabaseClient, _diAutoExecOk?.[0]?.id, intent.userId, intent.strategyId, baseSymbol, intent.side, intent.side, "real_execution_synchronous", false);
3853: 
3854:         return new Response(
3855:           JSON.stringify({
3856:             ok: true,
3857:             success: true,
3858:             tradeId: signSendData.tradeId,
3859:             tx_hash: signSendData.tx_hash,
3860:             executed_price: signSendData.executedPrice,
3861:             qty: tradeAmount,
3862:             decision: {
3863:               action: intent.side,
3864:               reason: "real_execution_synchronous",
3865:               request_id: requestId,
3866:               trade_id: signSendData.tradeId,
3867:               tx_hash: signSendData.tx_hash,
3868:               message: "Automated REAL trade submitted on-chain.",
3869:             },
3870:           }),
3871:           { headers: { ...corsHeaders, "Content-Type": "application/json" } },
3872:         );
```

**Dernière ligne de retour succès dans ce sous-chemin : `L3854`** (`return new Response(...)`).

---

## 11) Le `finally` s'exécute après le `return` du `try/catch`

```text
3873:       } finally {
3874:         // Release lock
3875:         if (lockAcquired) {
3876:           try {
3877:             await supabaseClient.rpc("release_execution_lock", { p_lock_key: lockKey });
3878:             console.log(`🔓 COORDINATOR: Released automated lock: ${lockKey}`);
3879:           } catch (unlockError) {
3880:             console.error(`⚠️ COORDINATOR: Failed to release automated lock: ${lockKey}`, unlockError);
3881:           }
3882:         }
3883:       }
```

---

## 12) Preuve brute que ce chemin **ne bifurque pas** vers `executeTradeOrder()`

### Appels à `executeTradeOrder(` dans le fichier

```text
6997:    const executionResult = await executeTradeOrder(
8719:    const executionResult = await executeTradeOrder(supabaseClient, tpSellIntent, strategyConfig, requestId, priceData);
8805:    const executionResult = await executeTradeOrder(supabaseClient, tpSellIntent, strategyConfig, requestId, priceData);
```

### Définition de `executeTradeOrder`

```text
7302: async function executeTradeOrder(
```

### Conclusion brute sur ce point

- Le SELL `source='intelligent'` + `execution_target='REAL'` **entre** au handler intelligent (`L2097-L2108`),
- **tombe** dans le flow principal REAL (`L2162-L2167`, puis `L3160`),
- **saute** le fast-path manual (`L3315`),
- et **entre dans le bloc automated REAL L3572-L3883**.
- Dans ce chemin, le SELL est branché à `L3604-L3624`.
- Dans ce chemin, il n'y a **aucun appel** à `executeTradeOrder()` avant le `return` de `L3803` (abandon) ou `L3854` (succès), puis `finally` `L3873-L3883`.

---

## 13) Réponse brute aux questions posées

### Ligne exacte où `source='intelligent'` + `side='SELL'` entre

```text
2097-2108
```

Code brut :
```text
2097:     const isNormalIntelligentTrade =
2098:       intent?.source === "intelligent" && intent?.metadata?.debugTag !== "forced_debug_trade";
2104:     console.log("[DEBUG][COORD] intent.side:", intent.side);
2105:     console.log("[DEBUG][COORD] intent.source:", intent.source);
2108:     if (isNormalIntelligentTrade && intent.strategyId) {
```

### Est-ce que ça passe par le même bloc `L3572-3883` que le BUY automated ?

```text
OUI.
```

Code brut :
```text
3572:       // AUTOMATED PATH: Direct synchronous on-chain execution
3584:       if (intent.side === "BUY") {
3604:       } else {
3605:         const sellQty = intent.qtySuggested;
3623:         tradeAmount = sellQty;
```

### Est-ce que ça bifurque vers `executeTradeOrder()` ?

```text
NON sur ce chemin.
```

Preuve brute :
```text
3854:         return new Response(
...
3873:       } finally {
...
6997:    const executionResult = await executeTradeOrder(
7302: async function executeTradeOrder(
```

### Dernière ligne exécutée avant abandon ou sortie

- **Abandon qty manquante** : `L3608`
- **Abandon placeholder insert failed** : `L3711`
- **Abandon exécution on-chain failed** : `L3803`
- **Sortie succès** : `L3854`
- **Puis** `finally` : `L3873-L3883`

Code brut :
```text
3608:           return new Response(
3711:           return new Response(
3803:           return new Response(
3854:         return new Response(
3873:       } finally {
```
