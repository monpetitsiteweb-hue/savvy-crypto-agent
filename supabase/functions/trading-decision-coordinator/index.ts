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
    
    // Parse request body first
    const raw = await req.json().catch(() => ({} as any));
    
    // Check if this is a service role call (edge function to edge function)
    const isServiceCall = token.includes('service_role');
    
    let userId;
    
    if (isServiceCall) {
      // For service calls, get user_id from the request body
      userId = raw.user_id || raw.userId;
      
      if (!userId) {
        return new Response(JSON.stringify({ ok:false, stage:"auth", reason:"no_user_in_service_call" }), {
          status: 400, headers: { ...cors, "Content-Type":"application/json", "X-Coord-Version":"v2" }
        });
      }
      
      console.log(`🔧 Service role call for user: ${userId}`);
    } else {
      // For user calls, decode JWT
      const payload = decodeJWT(token);
      if (!payload?.sub) {
        return new Response(JSON.stringify({ ok:false, stage:"auth", reason:"invalid_jwt" }), {
          status: 401, headers: { ...cors, "Content-Type":"application/json", "X-Coord-Version":"v2" }
        });
      }
      userId = payload.sub;
      console.log(`👤 User call for: ${userId}`);
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Parse and validate input
    const side = (raw.side ?? raw.action ?? "").toString().toLowerCase();
    const base = (raw.symbol ?? raw.base ?? "").toString().toUpperCase().split("-")[0];
    const qty  = Number(raw.amount);
    const px   = Number(raw.price);
    const strategy_id = raw.strategy_id;
    const is_test_mode = (raw.testMode === true) || (["mock","test"].includes(String(raw.mode).toLowerCase()));

    if (!["buy","sell"].includes(side) || !base || !qty || !px || !strategy_id) {
      return new Response(JSON.stringify({ ok:false, stage:"input", reason:"bad_input", details: { side, base, qty, px, strategy_id } }), {
        status: 400, headers: { ...cors, "Content-Type":"application/json", "X-Coord-Version":"v2" }
      });
    }

    console.log(`🎯 COORDINATOR: Processing ${side} ${base} qty=${qty} price=${px} strategy=${strategy_id} test=${is_test_mode} user=${userId}`);

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
      console.error(`❌ Insert error:`, error);
      return new Response(JSON.stringify({ ok:false, stage:"insert", error: error.message }), {
        status: 500, headers: { ...cors, "Content-Type":"application/json", "X-Coord-Version":"v2" }
      });
    }

    console.log(`✅ COORDINATOR: Trade inserted with ID: ${data.id}`);

    return new Response(JSON.stringify({ ok:true, trade_id: data.id }), {
      status: 200, headers: { ...cors, "Content-Type":"application/json", "X-Coord-Version":"v2" }
    });
  } catch (e) {
    console.error(`❌ Exception:`, e);
    return new Response(JSON.stringify({ ok:false, stage:"exception", error: String(e) }), {
      status: 500, headers: { ...cors, "Content-Type":"application/json", "X-Coord-Version":"v2" }
    });
  }
});