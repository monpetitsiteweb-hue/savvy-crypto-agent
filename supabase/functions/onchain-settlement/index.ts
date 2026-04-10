import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/** Thin dispatcher — all business logic lives in PostgreSQL RPCs. */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ ok: false, error: "method_not_allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ── Auth: service_role only ──────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!authHeader.endsWith(serviceRoleKey) || !serviceRoleKey) {
    console.error("❌ [settlement] Unauthorized request — not service_role");
    return new Response(
      JSON.stringify({ ok: false, error: "unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ── Parse & validate payload ─────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: "invalid_json" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const required = [
    "mockTradeId",
    "side",
    "symbol",
    "userId",
    "strategyId",
    "actualAmount",
    "actualPrice",
    "totalValueEur",
    "gasCostEur",
    "txHash",
  ] as const;

  const missing = required.filter((k) => body[k] === undefined || body[k] === null);
  if (missing.length > 0) {
    return new Response(
      JSON.stringify({ ok: false, error: "missing_fields", fields: missing }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const side = String(body.side).toUpperCase();
  if (side !== "BUY" && side !== "SELL") {
    return new Response(
      JSON.stringify({ ok: false, error: "invalid_side", received: body.side }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const mockTradeId = String(body.mockTradeId);
  const userId = String(body.userId);
  const strategyId = String(body.strategyId);
  const symbol = String(body.symbol);
  const actualAmount = Number(body.actualAmount);
  const actualPrice = Number(body.actualPrice);
  const totalValueEur = Number(body.totalValueEur);
  const txHash = String(body.txHash);

  // ── Supabase client (service_role) ───────────────────────
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    serviceRoleKey,
  );

  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

  try {
    // ── BUY settlement ───────────────────────────────────
    if (side === "BUY") {
      console.log(
        `🏦 [settlement] BUY settlement started`,
        JSON.stringify({ mockTradeId, userId, totalValueEur, txHash }),
      );

      const { data, error } = await supabase.rpc("settle_buy_trade_v2", {
        p_mock_trade_id: mockTradeId,
        p_user_id: userId,
        p_actual_spent_eur: totalValueEur,
        p_reserved_amount: totalValueEur,
      });

      if (error) {
        console.error(
          `❌ [settlement] Settlement failed`,
          JSON.stringify({ mockTradeId, side, error: error.message, txHash }),
        );
        return new Response(
          JSON.stringify({ ok: false, error: error.message, mockTradeId, txHash }),
          { status: 500, headers: jsonHeaders },
        );
      }

      const result = data as Record<string, unknown>;

      if (result.ok === false) {
        console.error(
          `❌ [settlement] Settlement failed`,
          JSON.stringify({ mockTradeId, side, error: result.error, txHash }),
        );
        return new Response(
          JSON.stringify({ ok: false, error: result.error, mockTradeId, txHash }),
          { status: 500, headers: jsonHeaders },
        );
      }

      if (result.skipped) {
        console.log(
          `⏭️ [settlement] BUY already settled — skipped`,
          JSON.stringify({ mockTradeId }),
        );
      } else {
        console.log(
          `✅ [settlement] BUY settled`,
          JSON.stringify({ mockTradeId, debited_eur: result.debited_eur }),
        );
      }

      return new Response(
        JSON.stringify({
          ok: true,
          side: "BUY",
          settled: !result.skipped,
          skipped: !!result.skipped,
          debited_eur: result.debited_eur,
          mockTradeId,
        }),
        { status: 200, headers: jsonHeaders },
      );
    }

    // ── SELL settlement ──────────────────────────────────
    console.log(
      `🏦 [settlement] SELL settlement started`,
      JSON.stringify({ mockTradeId, userId, symbol, actualAmount, actualPrice, txHash }),
    );

    const { data, error } = await supabase.rpc("settle_sell_trade_v2", {
      p_mock_trade_id: mockTradeId,
      p_user_id: userId,
      p_strategy_id: strategyId,
      p_symbol: symbol,
      p_sold_qty: actualAmount,
      p_sell_price: actualPrice,
      p_proceeds_eur: totalValueEur,
    });

    if (error) {
      console.error(
        `❌ [settlement] Settlement failed`,
        JSON.stringify({ mockTradeId, side, error: error.message, txHash }),
      );
      return new Response(
        JSON.stringify({ ok: false, error: error.message, mockTradeId, txHash }),
        { status: 500, headers: jsonHeaders },
      );
    }

    const result = data as Record<string, unknown>;

    if (result.ok === false) {
      console.error(
        `❌ [settlement] Settlement failed`,
        JSON.stringify({ mockTradeId, side, error: result.error, txHash }),
      );
      return new Response(
        JSON.stringify({ ok: false, error: result.error, mockTradeId, txHash }),
        { status: 500, headers: jsonHeaders },
      );
    }

    if (result.skipped) {
      console.log(
        `⏭️ [settlement] SELL already settled — skipped`,
        JSON.stringify({ mockTradeId }),
      );
    } else {
      console.log(
        `✅ [settlement] SELL settled`,
        JSON.stringify({
          mockTradeId,
          lots_closed: result.lots_closed,
          lots_split: result.lots_split,
          total_pnl_eur: result.total_pnl_eur,
          orphan_qty: result.orphan_qty,
          credited_eur: result.credited_eur,
        }),
      );

      if (Number(result.orphan_qty) > 0) {
        console.warn(
          `⚠️ [settlement] SELL orphan detected`,
          JSON.stringify({ mockTradeId, orphan_qty: result.orphan_qty, symbol }),
        );
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        side: "SELL",
        settled: !result.skipped,
        skipped: !!result.skipped,
        lots_closed: result.lots_closed,
        lots_split: result.lots_split,
        total_pnl_eur: result.total_pnl_eur,
        orphan_qty: result.orphan_qty,
        credited_eur: result.credited_eur,
        mockTradeId,
      }),
      { status: 200, headers: jsonHeaders },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `❌ [settlement] Unexpected error`,
      JSON.stringify({ mockTradeId, side, error: message, txHash }),
    );
    return new Response(
      JSON.stringify({ ok: false, error: message, mockTradeId, txHash }),
      { status: 500, headers: jsonHeaders },
    );
  }
});
