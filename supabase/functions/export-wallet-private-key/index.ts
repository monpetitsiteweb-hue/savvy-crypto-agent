import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { decryptPrivateKey } from "../_shared/envelope-encryption.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-secret",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  // HARD STOP: manual admin confirmation
  const adminSecret = req.headers.get("x-admin-secret");
  if (adminSecret !== Deno.env.get("EXPORT_ADMIN_SECRET")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { wallet_id } = await req.json();

    if (!wallet_id) {
      return new Response(JSON.stringify({ error: "Missing wallet_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Get wallet info
    const { data: wallet, error: walletError } = await supabase
      .from("execution_wallets")
      .select("id, wallet_address, user_id")
      .eq("id", wallet_id)
      .single();

    if (walletError || !wallet) {
      return new Response(JSON.stringify({ error: "Wallet not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get encrypted secrets
    const { data: secrets, error: secretsError } = await supabase
      .from("execution_wallet_secrets")
      .select("*")
      .eq("wallet_id", wallet_id)
      .single();

    if (secretsError || !secrets) {
      return new Response(JSON.stringify({ error: "Wallet secrets not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Decode base64 fields to Uint8Array
    const decodeB64 = (val: string | null): Uint8Array => {
      if (!val) throw new Error("Missing encrypted field");
      return Uint8Array.from(atob(val), (c) => c.charCodeAt(0));
    };

    const encryptedData = {
      encrypted_private_key: decodeB64(secrets.encrypted_private_key_b64 || secrets.encrypted_private_key),
      iv: decodeB64(secrets.iv_b64 || secrets.iv),
      auth_tag: decodeB64(secrets.auth_tag_b64 || secrets.auth_tag),
      encrypted_dek: decodeB64(secrets.encrypted_dek_b64 || secrets.encrypted_dek),
      dek_iv: decodeB64(secrets.dek_iv_b64 || secrets.dek_iv),
      dek_auth_tag: decodeB64(secrets.dek_auth_tag_b64 || secrets.dek_auth_tag),
      kek_version: secrets.kek_version,
    };

    // Decrypt using envelope encryption
    const privateKey = await decryptPrivateKey(encryptedData);

    console.log(`[export-wallet-private-key] Exported wallet ${wallet_id} for user ${wallet.user_id}`);

    return new Response(
      JSON.stringify({
        wallet_id: wallet.id,
        address: wallet.wallet_address,
        private_key: privateKey,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("[export-wallet-private-key] Error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
