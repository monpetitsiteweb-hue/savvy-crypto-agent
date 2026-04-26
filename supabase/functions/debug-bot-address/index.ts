// DEBUG ONLY – SAFE TO DELETE

import { secp256k1 } from "https://esm.sh/@noble/curves@1.3.0/secp256k1";
import { keccak_256 } from "https://esm.sh/@noble/hashes@1.3.3/sha3";

function deriveAddress(privateKeyHex: string): string {
  const cleanHex = privateKeyHex.startsWith("0x") ? privateKeyHex.slice(2) : privateKeyHex;
  const pkBytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < pkBytes.length; i++) {
    pkBytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }
  const publicKey = secp256k1.getPublicKey(pkBytes, false);
  const hash = keccak_256(publicKey.slice(1));
  const addrBytes = hash.slice(-20);
  return "0x" + Array.from(addrBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(() => {
  const pk = Deno.env.get("BOT_PRIVATE_KEY");
  const envAddr = Deno.env.get("BOT_ADDRESS");

  if (!pk || !envAddr) {
    return Response.json({ ok: false, error: "Missing BOT_PRIVATE_KEY or BOT_ADDRESS" }, { status: 500 });
  }

  const derived = deriveAddress(pk);

  return Response.json({
    ok: true,
    derivedAddress: derived,
    envBotAddress: envAddr,
    match: derived.toLowerCase() === envAddr.toLowerCase(),
  });
});
