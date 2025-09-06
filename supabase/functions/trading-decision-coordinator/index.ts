import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function decodeJWT(t: string){ try{ const p=t.split('.'); return p.length===3?JSON.parse(atob(p[1])):null; }catch{return null;} }

serve(async (req) => {
  // Build CORS headers dynamically: echo requested headers
  const acrh = req.headers.get("Access-Control-Request-Headers") ?? "authorization, x-client-info, apikey, content-type";
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": acrh,
    "Access-Control-Max-Age": "86400",
    // helpful for debugging/reading custom response headers
    "Access-Control-Expose-Headers": "X-Coord-Version"
  };

  // PRE-FLIGHT must return 204 and ONLY CORS headers
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  try {
    // Always include CORS headers below
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ ok:false, stage:"auth", reason:"no_user" }), {
        status: 401, headers: { ...cors, "Content-Type":"application/json", "X-Coord-Version":"v2" }
      });
    }

    const token = auth.slice(7);
    const payload = decodeJWT(token);
    if (!payload?.sub) {
      return new Response(JSON.stringify({ ok:false, stage:"auth", reason:"no_user" }), {
        status: 401, headers: { ...cors, "Content-Type":"application/json", "X-Coord-Version":"v2" }
      });
    }
    const userId = payload.sub;

    const sb = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // ---- your existing input parsing stays, but ensure both shapes are supported ----
    const raw = await req.json().catch(() => ({} as any));
    const side = (raw.side ?? raw.action ?? "").toString().toLowerCase(); // buy|sell
    const base = (raw.symbol ?? raw.base ?? "").toString().toUpperCase().split("-")[0];
    const qty  = Number(raw.amount);
    const px   = Number(raw.price);
    const strategy_id = raw.strategy_id;
    const is_test_mode = (raw.testMode === true) || (["mock","test"].includes(String(raw.mode).toLowerCase()));

    if (!["buy","sell"].includes(side) || !base || !qty || !px || !strategy_id) {
      return new Response(JSON.stringify({ ok:false, stage:"input", reason:"bad_input" }), {
        status: 400, headers: { ...cors, "Content-Type":"application/json", "X-Coord-Version":"v2" }
      });
    }

    const trade = {
      user_id: userId,
      strategy_id,
      trade_type: side,
      cryptocurrency: base,
      amount: qty,
      price: px,
      total_value: qty * px,
      fees: 0,
      buy_fees: 0,
      sell_fees: 0,
      is_test_mode,
      executed_at: new Date().toISOString(),
      notes: raw.reasonOverride ?? "coordinator"
    };

    const { data, error } = await sb.from("mock_trades").insert(trade).select("id").single();
    if (error) {
      return new Response(JSON.stringify({ ok:false, stage:"insert", error: error.message }), {
        status: 500, headers: { ...cors, "Content-Type":"application/json", "X-Coord-Version":"v2" }
      });
    }

    return new Response(JSON.stringify({ ok:true, trade_id: data.id }), {
      status: 200, headers: { ...cors, "Content-Type":"application/json", "X-Coord-Version":"v2" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok:false, stage:"exception", error: String(e) }), {
      status: 500, headers: { ...cors, "Content-Type":"application/json", "X-Coord-Version":"v2" }
    });
  }
});