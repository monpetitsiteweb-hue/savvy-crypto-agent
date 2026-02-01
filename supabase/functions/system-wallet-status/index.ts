/**
 * system-wallet-status
 *
 * Lightweight endpoint for the operator panel to check system wallet status.
 * Returns:
 * - System wallet address (BOT_ADDRESS)
 * - On-chain balances (ETH, USDC, WETH)
 * - Permit2 approval status
 * - Overall readiness for trading
 *
 * CUSTODIAL MODEL:
 * This is the SYSTEM wallet that executes ALL real trades.
 * Users do NOT trade from their own wallets.
 */

import { corsHeaders } from "../_shared/cors.ts";
import { logger } from "../_shared/logger.ts";

const CHAIN_ID = 8453; // Base
const BASE_RPC = Deno.env.get("RPC_URL_8453") || "https://mainnet.base.org";

// Contract addresses (Base chain)
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const OX_PROXY = "0xDef1C0ded9bec7F1a1670819833240f027b25EfF";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH_BASE = "0x4200000000000000000000000000000000000006";

// Function selectors
const BALANCE_OF_SELECTOR = "0x70a08231";
const ALLOWANCE_SELECTOR = "0xdd62ed3e";
const PERMIT2_ALLOWANCE_SELECTOR = "0x927da105";

// Threshold for "sufficient" approval (half of max)
const HALF_MAX_UINT256 = BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
const HALF_MAX_UINT160 = BigInt("0x7fffffffffffffffffffffff");

function jsonResponse(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonError(status: number, message: string) {
  logger.error("system-wallet-status.error", { status, message });
  return jsonResponse({ ok: false, error: message }, status);
}

async function rpcCall(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(BASE_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const data = await res.json();
  if (data.error) {
    throw new Error(data.error.message || "RPC error");
  }
  return data.result;
}

async function getEthBalance(address: string): Promise<string> {
  const result = await rpcCall("eth_getBalance", [address, "latest"]);
  const wei = BigInt(result as string);
  // Convert to ETH with 6 decimals precision
  const ethValue = Number(wei) / 1e18;
  return ethValue.toFixed(6);
}

async function getTokenBalance(tokenAddress: string, walletAddress: string, decimals: number): Promise<string> {
  const addressPadded = walletAddress.slice(2).toLowerCase().padStart(64, "0");
  const calldata = `${BALANCE_OF_SELECTOR}${addressPadded}`;

  const result = await rpcCall("eth_call", [{ to: tokenAddress, data: calldata }, "latest"]);
  const raw = BigInt((result as string) || "0x0");
  const value = Number(raw) / Math.pow(10, decimals);
  return value.toFixed(2);
}

async function getErc20Allowance(tokenAddress: string, owner: string, spender: string): Promise<bigint> {
  const ownerPadded = owner.slice(2).toLowerCase().padStart(64, "0");
  const spenderPadded = spender.slice(2).toLowerCase().padStart(64, "0");
  const calldata = `${ALLOWANCE_SELECTOR}${ownerPadded}${spenderPadded}`;

  const result = await rpcCall("eth_call", [{ to: tokenAddress, data: calldata }, "latest"]);
  return BigInt((result as string) || "0x0");
}

async function getPermit2InternalAllowance(owner: string, token: string, spender: string): Promise<bigint> {
  const ownerPadded = owner.slice(2).toLowerCase().padStart(64, "0");
  const tokenPadded = token.slice(2).toLowerCase().padStart(64, "0");
  const spenderPadded = spender.slice(2).toLowerCase().padStart(64, "0");
  const calldata = `${PERMIT2_ALLOWANCE_SELECTOR}${ownerPadded}${tokenPadded}${spenderPadded}`;

  const result = await rpcCall("eth_call", [{ to: PERMIT2, data: calldata }, "latest"]);
  const hexResult = result as string;
  
  if (!hexResult || hexResult === "0x") return 0n;
  
  // First 32 bytes contain amount (uint160 right-padded in ABI word)
  const word0 = hexResult.slice(2, 66);
  if (!word0 || word0.length !== 64) return 0n;
  return BigInt(`0x${word0}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return jsonError(405, "Method not allowed");
  }

  try {
    logger.info("system-wallet-status.start", {});

    // Get BOT_ADDRESS from environment
    const botAddress = Deno.env.get("BOT_ADDRESS");
    if (!botAddress) {
      return jsonError(500, "BOT_ADDRESS not configured");
    }

    logger.info("system-wallet-status.checking", { botAddress });

    // Fetch all data in parallel
    const [
      ethBalance,
      usdcBalance,
      wethBalance,
      usdcToPermit2Allowance,
      wethToPermit2Allowance,
      permit2UsdcTo0x,
      permit2WethTo0x,
    ] = await Promise.all([
      getEthBalance(botAddress),
      getTokenBalance(USDC_BASE, botAddress, 6),
      getTokenBalance(WETH_BASE, botAddress, 18),
      getErc20Allowance(USDC_BASE, botAddress, PERMIT2),
      getErc20Allowance(WETH_BASE, botAddress, PERMIT2),
      getPermit2InternalAllowance(botAddress, USDC_BASE, OX_PROXY),
      getPermit2InternalAllowance(botAddress, WETH_BASE, OX_PROXY),
    ]);

    // Determine approval status
    const usdcErc20Approved = usdcToPermit2Allowance >= HALF_MAX_UINT256;
    const wethErc20Approved = wethToPermit2Allowance >= HALF_MAX_UINT256;
    const usdcPermit2Approved = permit2UsdcTo0x >= HALF_MAX_UINT160;
    const wethPermit2Approved = permit2WethTo0x >= HALF_MAX_UINT160;

    // Overall readiness: both tokens must have full approval chain
    const usdcReady = usdcErc20Approved && usdcPermit2Approved;
    const wethReady = wethErc20Approved && wethPermit2Approved;
    const readyToTrade = usdcReady && wethReady;

    // Need gas for transactions
    const hasGas = parseFloat(ethBalance) >= 0.0001;

    logger.info("system-wallet-status.result", {
      botAddress,
      ethBalance,
      usdcBalance,
      wethBalance,
      usdcReady,
      wethReady,
      readyToTrade,
      hasGas,
    });

    return jsonResponse({
      ok: true,
      system_wallet: {
        address: botAddress,
        chain_id: CHAIN_ID,
        chain_name: "Base",
      },
      balances: {
        eth: ethBalance,
        usdc: usdcBalance,
        weth: wethBalance,
      },
      approvals: {
        usdc: {
          erc20_to_permit2: usdcErc20Approved,
          permit2_to_0x: usdcPermit2Approved,
          ready: usdcReady,
        },
        weth: {
          erc20_to_permit2: wethErc20Approved,
          permit2_to_0x: wethPermit2Approved,
          ready: wethReady,
        },
      },
      has_gas: hasGas,
      ready_to_trade: readyToTrade && hasGas,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("system-wallet-status.unexpected_error", { error: message });
    return jsonError(500, message);
  }
});
