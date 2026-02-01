/**
 * Custodial Execution – Operator Panel
 *
 * INTERNAL SAFETY TOOL — NOT A PRODUCT FEATURE
 *
 * CUSTODIAL MODEL:
 * - ONE SYSTEM WALLET (BOT_ADDRESS) holds ALL real on-chain funds
 * - Users own DATABASE balances, not on-chain funds
 * - User wallets are for DEPOSIT + AUDIT only, never used for trading
 * - All REAL trades execute from BOT_ADDRESS
 *
 * This page validates:
 * 1. System wallet identity and status
 * 2. User deposit wallets (audit only)
 * 3. Manual BUY/SELL (routed to system wallet)
 * 4. Withdrawals (from system wallet to external)
 * 5. Trade history
 *
 * NO private keys exposed. NO automation. NO onboarding logic.
 */

import { useState, useCallback, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Copy, Wallet, ArrowDownToLine, AlertTriangle, Server, User, Shield, Info } from "lucide-react";
import { WalletBalanceCard } from "@/components/wallet/WalletBalanceCard";
import { ManualTradeCard } from "@/components/wallet/ManualTradeCard";
import { ManualTradeHistory } from "@/components/wallet/ManualTradeHistory";

interface WalletInfo {
  wallet_id: string;
  wallet_address: string;
  chain_id: number;
  is_funded: boolean;
  already_existed?: boolean;
}

interface WithdrawResult {
  success: boolean;
  tx_hash?: string;
  error?: string;
}

interface SystemWalletInfo {
  address: string | null;
  match: boolean;
  loading: boolean;
  error: string | null;
}

export default function WalletDrillPage() {
  const { user } = useAuth();
  const { isAdmin, loading: roleLoading } = useUserRole();

  // Section: System wallet info
  const [systemWallet, setSystemWallet] = useState<SystemWalletInfo>({
    address: null,
    match: false,
    loading: true,
    error: null,
  });

  // Section: User deposit wallet state
  const [walletInfo, setWalletInfo] = useState<WalletInfo | null>(null);
  const [createLoading, setCreateLoading] = useState<boolean>(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Section: Withdraw state
  const [withdrawAsset, setWithdrawAsset] = useState<"ETH" | "USDC">("ETH");
  const [withdrawAmount, setWithdrawAmount] = useState<string>("");
  const [withdrawDestination, setWithdrawDestination] = useState<string>("");
  const [withdrawLoading, setWithdrawLoading] = useState<boolean>(false);
  const [withdrawResult, setWithdrawResult] = useState<WithdrawResult | null>(null);

  // Trade history refresh trigger
  const [tradeRefreshTrigger, setTradeRefreshTrigger] = useState<number>(0);

  // Callback MUST be declared before any conditional returns (React hooks rule)
  const handleTradeComplete = useCallback(() => {
    setTradeRefreshTrigger((prev) => prev + 1);
  }, []);

  // Fetch system wallet info on mount
  useEffect(() => {
    const fetchSystemWallet = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;

        if (!token) {
          setSystemWallet({ address: null, match: false, loading: false, error: "Not authenticated" });
          return;
        }

        const response = await fetch(
          `https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/debug-bot-address`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        const result = await response.json();

        if (result.ok) {
          setSystemWallet({
            address: result.derivedAddress || result.envBotAddress,
            match: result.match === true,
            loading: false,
            error: null,
          });
        } else {
          setSystemWallet({
            address: null,
            match: false,
            loading: false,
            error: result.error || "Failed to fetch system wallet",
          });
        }
      } catch (err: any) {
        setSystemWallet({
          address: null,
          match: false,
          loading: false,
          error: err.message || "Network error",
        });
      }
    };

    fetchSystemWallet();
  }, []);

  // Loading state - AFTER all hooks
  if (roleLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-foreground">Loading...</div>
      </div>
    );
  }

  // Admin-only access - AFTER all hooks
  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <AlertTriangle className="h-12 w-12 text-destructive mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-foreground mb-2">Access Denied</h2>
          <p className="text-muted-foreground">Operator-only page. Admin privileges required.</p>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // SECTION: Create User Deposit Wallet
  // ─────────────────────────────────────────────────────────────
  const handleCreateWallet = async () => {
    if (!user) return;

    setCreateLoading(true);
    setCreateError(null);
    setWalletInfo(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      const response = await fetch(`https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/execution-wallet-create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          user_id: user.id,
          chain_id: 8453, // Base mainnet
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `HTTP ${response.status}`);
      }

      if (result.success) {
        setWalletInfo({
          wallet_id: result.wallet_id,
          wallet_address: result.wallet_address,
          chain_id: result.chain_id,
          is_funded: result.is_funded,
          already_existed: result.already_existed,
        });
      } else {
        throw new Error(result.error || "Unknown error");
      }
    } catch (err: any) {
      setCreateError(err.message || "Failed to create wallet");
    } finally {
      setCreateLoading(false);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // Copy address helper
  // ─────────────────────────────────────────────────────────────
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  // ─────────────────────────────────────────────────────────────
  // SECTION: Withdraw Funds (from SYSTEM wallet to external)
  // ─────────────────────────────────────────────────────────────
  const handleWithdraw = async () => {
    if (!user || !withdrawAmount || !withdrawDestination) return;

    setWithdrawLoading(true);
    setWithdrawResult(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      const parsedAmount = Number(withdrawAmount.replace(",", ".").trim());

      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        throw new Error("Invalid amount");
      }

      const response = await fetch(
        `https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/execution-wallet-withdraw`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            // NOTE: wallet_id removed - withdrawals are from SYSTEM wallet
            asset: withdrawAsset,
            to_address: withdrawDestination,
            amount: parsedAmount,
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        setWithdrawResult({
          success: false,
          error: result.error || `HTTP ${response.status}`,
        });
      } else if (result.success) {
        setWithdrawResult({
          success: true,
          tx_hash: result.tx_hash,
        });
      } else {
        setWithdrawResult({
          success: false,
          error: result.error || "Unknown error",
        });
      }
    } catch (err: any) {
      setWithdrawResult({
        success: false,
        error: err.message || "Failed to withdraw",
      });
    } finally {
      setWithdrawLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <div className="border-b border-border pb-4">
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Shield className="h-6 w-6" />
            Custodial Execution – Operator Panel
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Internal safety verification tool. Validates REAL on-chain execution under custodial model.
          </p>
        </div>

        {/* CUSTODIAL MODEL EXPLAINER */}
        <Card className="border-blue-500/30 bg-blue-500/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2 text-blue-600">
              <Info className="h-5 w-5" />
              Custodial Model – How It Works
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              <strong>System Wallet (BOT_ADDRESS):</strong> Holds ALL real on-chain funds. Executes all
              trades, Permit2 approvals, and withdrawals. Not user-specific.
            </p>
            <p>
              <strong>User Wallets:</strong> For DEPOSIT and AUDIT only. Funds deposited here are swept to
              the system wallet. Users own DATABASE balances, not on-chain balances.
            </p>
            <p>
              <strong>Manual Trades:</strong> Execute from the SYSTEM wallet. The user wallet ID is passed
              for authorization, but execution happens from BOT_ADDRESS.
            </p>
          </CardContent>
        </Card>

        {/* SECTION A: SYSTEM WALLET (READ-ONLY) */}
        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2 text-yellow-600">
              <Server className="h-5 w-5" />
              System Trading Wallet
            </CardTitle>
            <CardDescription>
              Executes all REAL trades and withdrawals. Holds pooled on-chain funds.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {systemWallet.loading ? (
              <div className="text-muted-foreground text-sm">Loading system wallet...</div>
            ) : systemWallet.error ? (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded text-sm text-destructive">
                Error: {systemWallet.error}
              </div>
            ) : (
              <div className="p-4 bg-muted rounded space-y-2 font-mono text-sm">
                <div className="flex items-center gap-2">
                  <strong>Address:</strong>
                  <span className="break-all">{systemWallet.address || "Not configured"}</span>
                  {systemWallet.address && (
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => copyToClipboard(systemWallet.address!)}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  )}
                </div>
                <div>
                  <strong>Chain:</strong> Base (8453)
                </div>
                <div>
                  <strong>Purpose:</strong> All REAL BUY/SELL, Permit2, Withdrawals
                </div>
                <div className={systemWallet.match ? "text-green-600" : "text-destructive"}>
                  <strong>Key Match:</strong> {systemWallet.match ? "✓ Verified" : "✗ Mismatch"}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* WALLET BALANCES (system wallet balances) */}
        <WalletBalanceCard />

        {/* MANUAL TRADING SECTION */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
            <span className="text-sm font-medium">
              Trades execute from the SYSTEM wallet (custodial model). User wallet is for authorization only.
            </span>
          </div>
          {user && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <ManualTradeCard side="BUY" userId={user.id} onTradeComplete={handleTradeComplete} />
              <ManualTradeCard side="SELL" userId={user.id} onTradeComplete={handleTradeComplete} />
            </div>
          )}
        </div>

        {/* SECTION B: USER DEPOSIT WALLET (AUDIT ONLY) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <User className="h-5 w-5" />
              User Deposit Wallet (Audit Only)
            </CardTitle>
            <CardDescription>
              System-custodied wallet for deposits. NOT used for trading. Funds are swept to system wallet.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-3 bg-muted/50 border border-border rounded text-xs text-muted-foreground">
              <strong>Note:</strong> This address is for receiving deposits only. Trading balance is tracked
              in the DATABASE, not on-chain. All trades execute from the system wallet.
            </div>

            <Button onClick={handleCreateWallet} disabled={createLoading} className="w-full" variant="outline">
              {createLoading ? "Creating..." : "Create / Fetch User Deposit Wallet"}
            </Button>

            {createError && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded text-sm text-destructive">
                Error: {createError}
              </div>
            )}

            {walletInfo && (
              <div className="p-4 bg-muted rounded space-y-2 font-mono text-sm">
                <div>
                  <strong>wallet_id:</strong> {walletInfo.wallet_id}
                </div>
                <div className="flex items-center gap-2">
                  <strong>deposit_address:</strong>
                  <span className="break-all">{walletInfo.wallet_address}</span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => copyToClipboard(walletInfo.wallet_address)}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
                <div>
                  <strong>chain_id:</strong> {walletInfo.chain_id} (Base)
                </div>
                <div>
                  <strong>has_received_deposit:</strong> {walletInfo.is_funded ? "true" : "false"}
                </div>
                {walletInfo.already_existed && <div className="text-muted-foreground">(wallet already existed)</div>}
                <div className="mt-2 p-2 bg-yellow-500/10 border border-yellow-500/20 rounded text-yellow-600 text-xs">
                  ⚠️ Deposits to this address are for audit/tracking. Actual trading uses system wallet.
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* SECTION: Withdraw Funds */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <ArrowDownToLine className="h-5 w-5" />
              Withdraw Funds
            </CardTitle>
            <CardDescription>
              Emergency exit. Sends from SYSTEM wallet to external address. User wallet is NOT involved.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-3 bg-muted/50 border border-border rounded text-xs text-muted-foreground">
              <strong>How withdrawals work:</strong> Funds are sent FROM the system wallet (BOT_ADDRESS) TO
              the destination address you specify. The user's database balance is debited accordingly.
            </div>

            <div className="space-y-2">
              <Label htmlFor="asset">Asset</Label>
              <select
                id="asset"
                value={withdrawAsset}
                onChange={(e) => setWithdrawAsset(e.target.value as "ETH" | "USDC")}
                className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
              >
                <option value="ETH">ETH</option>
                <option value="USDC">USDC</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="amount">Amount</Label>
              <Input
                id="amount"
                type="text"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                placeholder="e.g. 0.001"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="destination">Destination Address (External)</Label>
              <Input
                id="destination"
                value={withdrawDestination}
                onChange={(e) => setWithdrawDestination(e.target.value)}
                placeholder="0x..."
                className="font-mono text-sm"
              />
            </div>

            <Button
              onClick={handleWithdraw}
              disabled={withdrawLoading || !withdrawAmount || !withdrawDestination}
              className="w-full"
              variant="destructive"
            >
              {withdrawLoading ? "Processing..." : "Withdraw from System Wallet"}
            </Button>

            {withdrawResult && (
              <div
                className={`p-3 rounded text-sm ${
                  withdrawResult.success
                    ? "bg-green-500/10 border border-green-500/20 text-green-600"
                    : "bg-destructive/10 border border-destructive/20 text-destructive"
                }`}
              >
                {withdrawResult.success ? (
                  <>
                    <div>
                      <strong>Success!</strong>
                    </div>
                    {withdrawResult.tx_hash && (
                      <div className="font-mono text-xs mt-1 break-all">tx_hash: {withdrawResult.tx_hash}</div>
                    )}
                  </>
                ) : (
                  <div>Error: {withdrawResult.error}</div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* MANUAL TRADE HISTORY */}
        {user && <ManualTradeHistory userId={user.id} refreshTrigger={tradeRefreshTrigger} />}

        {/* Footer warning */}
        <div className="text-xs text-muted-foreground text-center pt-4 border-t border-border">
          <AlertTriangle className="h-4 w-4 inline mr-1" />
          Operator-only safety tool. Validates REAL on-chain execution under custodial model.
        </div>
      </div>
    </div>
  );
}
