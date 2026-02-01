// DEBUG ONLY – SAFE TO DELETE

import { Wallet } from "npm:ethers";

Deno.serve(() => {
  const pk = Deno.env.get("BOT_PRIVATE_KEY");
  const envAddr = Deno.env.get("BOT_ADDRESS");

  if (!pk || !envAddr) {
    return Response.json({ ok: false, error: "Missing BOT_PRIVATE_KEY or BOT_ADDRESS" }, { status: 500 });
  }

  const derived = new Wallet(pk).address;

  return Response.json({
    ok: true,
    derivedAddress: derived,
    envBotAddress: envAddr,
    match: derived.toLowerCase() === envAddr.toLowerCase()
  });
});
