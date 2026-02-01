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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Copy, ArrowDownToLine, AlertTriangle, Server, User, Shield, Info, RefreshCw, CheckCircle, XCircle } from "lucide-react";
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

interface SystemWalletStatus {
  address: string | null;
  chainId: number;
  chainName: string;
  balances: {
    eth: string;
    usdc: string;
    weth: string;
  };
  approvals: {
    usdc: { erc20_to_permit2: boolean; permit2_to_0x: boolean; ready: boolean };
    weth: { erc20_to_permit2: boolean; permit2_to_0x: boolean; ready: boolean };
  };
  hasGas: boolean;
  readyToTrade: boolean;
  loading: boolean;
  error: string | null;
}

interface ApprovalResult {
  loading: boolean;
  error: string | null;
  success: boolean;
  txHashes: { erc20?: string; permit2?: string };
}

export default function WalletDrillPage() {
  const { user } = useAuth();
  const { isAdmin, loading: roleLoading } = useUserRole();

  // Section: System wallet status (from new endpoint)
  const [systemWallet, setSystemWallet] = useState<SystemWalletStatus>({
    address: null,
    chainId: 8453,
    chainName: "Base",
    balances: { eth: "0", usdc: "0", weth: "0" },
    approvals: {
      usdc: { erc20_to_permit2: false, permit2_to_0x: false, ready: false },
      weth: { erc20_to_permit2: false, permit2_to_0x: false, ready: false },
    },
    hasGas: false,
    readyToTrade: false,
    loading: true,
    error: null,
  });

  // Approval state
  const [usdcApproval, setUsdcApproval] = useState<ApprovalResult>({
    loading: false,
    error: null,
    success: false,
    txHashes: {},
  });
  const [wethApproval, setWethApproval] = useState<ApprovalResult>({
    loading: false,
    error: null,
    success: false,
    txHashes: {},
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

  // Fetch system wallet status
  const fetchSystemWalletStatus = useCallback(async () => {
    setSystemWallet((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      if (!token) {
        setSystemWallet((prev) => ({ ...prev, loading: false, error: "Not authenticated" }));
        return;
      }

      const response = await fetch(
        `https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/system-wallet-status`,
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
          address: result.system_wallet?.address || null,
          chainId: result.system_wallet?.chain_id || 8453,
          chainName: result.system_wallet?.chain_name || "Base",
          balances: {
            eth: result.balances?.eth || "0",
            usdc: result.balances?.usdc || "0",
            weth: result.balances?.weth || "0",
          },
          approvals: {
            usdc: result.approvals?.usdc || { erc20_to_permit2: false, permit2_to_0x: false, ready: false },
            weth: result.approvals?.weth || { erc20_to_permit2: false, permit2_to_0x: false, ready: false },
          },
          hasGas: result.has_gas || false,
          readyToTrade: result.ready_to_trade || false,
          loading: false,
          error: null,
        });
      } else {
        setSystemWallet((prev) => ({
          ...prev,
          loading: false,
          error: result.error || "Failed to fetch system wallet status",
        }));
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Network error";
      setSystemWallet((prev) => ({ ...prev, loading: false, error: message }));
    }
  }, []);

  // Fetch on mount
  useEffect(() => {
    fetchSystemWalletStatus();
  }, [fetchSystemWalletStatus]);

  // Setup Permit2 approvals
  const setupPermit2Approval = async (token: "USDC" | "WETH") => {
    const setApproval = token === "USDC" ? setUsdcApproval : setWethApproval;
    setApproval({ loading: true, error: null, success: false, txHashes: {} });

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;

      if (!accessToken) {
        setApproval({ loading: false, error: "Not authenticated", success: false, txHashes: {} });
        return;
      }

      const response = await fetch(
        `https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/wallet-approve-permit2`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ token }),
        }
      );

      const result = await response.json();

      if (result.ok) {
        setApproval({
          loading: false,
          error: null,
          success: true,
          txHashes: {
            erc20: result.erc20_tx_hash || undefined,
            permit2: result.permit2_tx_hash || undefined,
          },
        });
        // Refresh status after approval
        setTimeout(fetchSystemWalletStatus, 3000);
      } else {
        setApproval({
          loading: false,
          error: result.error || "Approval failed",
          success: false,
          txHashes: {},
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Network error";
      setApproval({ loading: false, error: message, success: false, txHashes: {} });
    }
  };

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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to create wallet";
      setCreateError(message);
    } finally {
      setCreateLoading(false);
    }
  };

  // Copy address helper
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
        // Refresh balances after withdrawal
        setTimeout(fetchSystemWalletStatus, 3000);
      } else {
        setWithdrawResult({
          success: false,
          error: result.error || "Unknown error",
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to withdraw";
      setWithdrawResult({
        success: false,
        error: message,
      });
    } finally {
      setWithdrawLoading(false);
    }
  };

  // Render approval status icon
  const ApprovalIcon = ({ approved }: { approved: boolean }) =>
    approved ? (
      <CheckCircle className="h-4 w-4 text-green-500" />
    ) : (
      <XCircle className="h-4 w-4 text-destructive" />
    );

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
        <Alert className="border-blue-500/30 bg-blue-500/5">
          <Info className="h-5 w-5 text-blue-600" />
          <AlertTitle className="text-blue-600">Custodial Model – How It Works</AlertTitle>
          <AlertDescription className="text-sm text-muted-foreground space-y-1 mt-2">
            <p>
              <strong>System Wallet (BOT_ADDRESS):</strong> Holds ALL real on-chain funds. Executes all
              trades, Permit2 approvals, and withdrawals. Not user-specific.
            </p>
            <p>
              <strong>User Wallets:</strong> For DEPOSIT and AUDIT only. Funds deposited here are swept to
              the system wallet. Users own DATABASE balances, not on-chain balances.
            </p>
          </AlertDescription>
        </Alert>

        {/* SECTION A: SYSTEM WALLET STATUS (PRIMARY) */}
        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg flex items-center gap-2 text-yellow-600">
                  <Server className="h-5 w-5" />
                  🏦 System Trading Wallet
                </CardTitle>
                <CardDescription>
                  Executes all REAL trades and withdrawals. Holds pooled on-chain funds.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={fetchSystemWalletStatus}
                disabled={systemWallet.loading}
              >
                <RefreshCw className={`h-4 w-4 mr-1 ${systemWallet.loading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {systemWallet.loading ? (
              <div className="text-muted-foreground text-sm">Loading system wallet status...</div>
            ) : systemWallet.error ? (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded text-sm text-destructive">
                Error: {systemWallet.error}
              </div>
            ) : (
              <>
                {/* Address and Chain */}
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
                    <strong>Chain:</strong> {systemWallet.chainName} ({systemWallet.chainId})
                  </div>
                </div>

                {/* Balances */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="p-3 bg-muted rounded text-center">
                    <div className="text-xs text-muted-foreground">ETH (Gas)</div>
                    <div className="font-mono font-semibold">{systemWallet.balances.eth}</div>
                    {!systemWallet.hasGas && (
                      <div className="text-xs text-destructive mt-1">⚠️ Low gas</div>
                    )}
                  </div>
                  <div className="p-3 bg-muted rounded text-center">
                    <div className="text-xs text-muted-foreground">USDC</div>
                    <div className="font-mono font-semibold">{systemWallet.balances.usdc}</div>
                  </div>
                  <div className="p-3 bg-muted rounded text-center">
                    <div className="text-xs text-muted-foreground">WETH</div>
                    <div className="font-mono font-semibold">{systemWallet.balances.weth}</div>
                  </div>
                </div>

                {/* Permit2 Approvals Status */}
                <div className="space-y-3">
                  <h4 className="text-sm font-medium">Permit2 Approvals</h4>

                  {/* USDC Approvals */}
                  <div className="p-3 bg-muted rounded space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">USDC</span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded ${
                          systemWallet.approvals.usdc.ready
                            ? "bg-green-500/20 text-green-600"
                            : "bg-destructive/20 text-destructive"
                        }`}
                      >
                        {systemWallet.approvals.usdc.ready ? "Ready" : "Not Ready"}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-4">
                      <span className="flex items-center gap-1">
                        <ApprovalIcon approved={systemWallet.approvals.usdc.erc20_to_permit2} />
                        ERC20 → Permit2
                      </span>
                      <span className="flex items-center gap-1">
                        <ApprovalIcon approved={systemWallet.approvals.usdc.permit2_to_0x} />
                        Permit2 → 0x
                      </span>
                    </div>
                    {!systemWallet.approvals.usdc.ready && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full mt-2"
                        onClick={() => setupPermit2Approval("USDC")}
                        disabled={usdcApproval.loading}
                      >
                        {usdcApproval.loading ? "Approving..." : "Setup USDC Permit2"}
                      </Button>
                    )}
                    {usdcApproval.error && (
                      <div className="text-xs text-destructive mt-1">{usdcApproval.error}</div>
                    )}
                    {usdcApproval.success && (
                      <div className="text-xs text-green-600 mt-1">
                        ✓ Approval submitted
                        {usdcApproval.txHashes.erc20 && (
                          <span className="block font-mono">ERC20 tx: {usdcApproval.txHashes.erc20.slice(0, 18)}...</span>
                        )}
                        {usdcApproval.txHashes.permit2 && (
                          <span className="block font-mono">Permit2 tx: {usdcApproval.txHashes.permit2.slice(0, 18)}...</span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* WETH Approvals */}
                  <div className="p-3 bg-muted rounded space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">WETH</span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded ${
                          systemWallet.approvals.weth.ready
                            ? "bg-green-500/20 text-green-600"
                            : "bg-destructive/20 text-destructive"
                        }`}
                      >
                        {systemWallet.approvals.weth.ready ? "Ready" : "Not Ready"}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-4">
                      <span className="flex items-center gap-1">
                        <ApprovalIcon approved={systemWallet.approvals.weth.erc20_to_permit2} />
                        ERC20 → Permit2
                      </span>
                      <span className="flex items-center gap-1">
                        <ApprovalIcon approved={systemWallet.approvals.weth.permit2_to_0x} />
                        Permit2 → 0x
                      </span>
                    </div>
                    {!systemWallet.approvals.weth.ready && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full mt-2"
                        onClick={() => setupPermit2Approval("WETH")}
                        disabled={wethApproval.loading}
                      >
                        {wethApproval.loading ? "Approving..." : "Setup WETH Permit2"}
                      </Button>
                    )}
                    {wethApproval.error && (
                      <div className="text-xs text-destructive mt-1">{wethApproval.error}</div>
                    )}
                    {wethApproval.success && (
                      <div className="text-xs text-green-600 mt-1">
                        ✓ Approval submitted
                        {wethApproval.txHashes.erc20 && (
                          <span className="block font-mono">ERC20 tx: {wethApproval.txHashes.erc20.slice(0, 18)}...</span>
                        )}
                        {wethApproval.txHashes.permit2 && (
                          <span className="block font-mono">Permit2 tx: {wethApproval.txHashes.permit2.slice(0, 18)}...</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Overall Status */}
                <div
                  className={`p-4 rounded text-center ${
                    systemWallet.readyToTrade
                      ? "bg-green-500/10 border border-green-500/20 text-green-600"
                      : "bg-destructive/10 border border-destructive/20 text-destructive"
                  }`}
                >
                  {systemWallet.readyToTrade ? (
                    <div className="flex items-center justify-center gap-2">
                      <CheckCircle className="h-5 w-5" />
                      <span className="font-medium">System Wallet Ready for Trading</span>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center gap-2">
                      <XCircle className="h-5 w-5" />
                      <span className="font-medium">System Wallet NOT Ready</span>
                    </div>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* MANUAL TRADING SECTION */}
        <div className="space-y-4">
          <Alert className="border-yellow-500/30 bg-yellow-500/5">
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
            <AlertTitle>Custodial Execution</AlertTitle>
            <AlertDescription className="text-sm">
              Trades execute from the SYSTEM wallet. User database balance is checked before execution and
              updated after confirmation. The user wallet is NOT involved in trading.
            </AlertDescription>
          </Alert>

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
