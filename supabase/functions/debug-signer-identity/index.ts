// DEBUG ONLY – SAFE TO DELETE

import { corsHeaders } from "../_shared/cors.ts";
import { getSigner } from "../_shared/signer.ts";

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const signer = getSigner();

    const derivedAddressRaw = signer.getAddress();
    const envBotAddressRaw = Deno.env.get("BOT_ADDRESS");

    const derivedAddress = derivedAddressRaw ?? "";
    const envBotAddress = envBotAddressRaw ?? "";

    const match =
      derivedAddress.length > 0 &&
      envBotAddress.length > 0 &&
      derivedAddress.toLowerCase() === envBotAddress.toLowerCase();

    if (!match) {
      return json(
        {
          ok: false,
          derivedAddress,
          envBotAddress,
          error: "SIGNER_ADDRESS_MISMATCH",
        },
        200
      );
    }

    return json({ ok: true, derivedAddress, envBotAddress }, 200);
  } catch (_err) {
    // Fail closed but keep response format stable.
    return json(
      {
        ok: false,
        derivedAddress: "",
        envBotAddress: Deno.env.get("BOT_ADDRESS") ?? "",
        error: "SIGNER_ADDRESS_MISMATCH",
      },
      200
    );
  }
});
