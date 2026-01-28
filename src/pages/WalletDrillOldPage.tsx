/**
 * Execution Wallet – OLD Wallet Recovery Drill
 *
 * TEMPORARY RECOVERY TOOL — NOT A PRODUCT FEATURE
 *
 * This page exists ONLY to attempt withdrawal from LEGACY wallets
 * stored in execution_wallets_old and execution_wallet_secrets_old.
 *
 * NO wallet creation. Wallet ID must be manually pasted.
 * NO automation. NO onboarding logic.
 */

import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowDownToLine, AlertTriangle, Archive } from "lucide-react";

interface WithdrawResult {
  success: boolean;
  tx_hash?: string;
  error?: string;
}

export default function WalletDrillOldPage() {
  const { user } = useAuth();
  const { isAdmin, loading: roleLoading } = useUserRole();

  // Section: Withdraw state
  const [withdrawWalletId, setWithdrawWalletId] = useState("");
  const [withdrawAsset, setWithdrawAsset] = useState<"ETH" | "USDC">("ETH");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawDestination, setWithdrawDestination] = useState("");
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [withdrawResult, setWithdrawResult] = useState<WithdrawResult | null>(null);

  // Loading state
  if (roleLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-foreground">Loading...</div>
      </div>
    );
  }

  // Admin-only access
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
  // Withdraw Funds (calls execution-wallet-withdraw-old)
  // ─────────────────────────────────────────────────────────────
  const handleWithdraw = async () => {
    if (!user || !withdrawWalletId || !withdrawAmount || !withdrawDestination) return;

    setWithdrawLoading(true);
    setWithdrawResult(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      const parsedAmount = Number(
        withdrawAmount.replace(',', '.').trim()
      );
      
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        throw new Error("Invalid amount");
      }

      const response = await fetch(`https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/execution-wallet-withdraw-old`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          wallet_id: withdrawWalletId,
          asset: withdrawAsset,
          to_address: withdrawDestination,
          amount: parsedAmount,
        }),
      });

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
      <div className="max-w-2xl mx-auto space-y-8">
        {/* Header */}
        <div className="border-b border-border pb-4">
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Archive className="h-6 w-6" />
            Execution Wallet – OLD Wallet Recovery Drill
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Temporary recovery tool for LEGACY wallets (_old tables). NOT a product feature.
          </p>
        </div>

        {/* Warning Banner */}
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
            <div>
              <p className="font-medium text-destructive">Legacy Wallet Recovery Mode</p>
              <p className="text-sm text-muted-foreground mt-1">
                This page targets <code className="bg-muted px-1 rounded">execution_wallets_old</code> and{" "}
                <code className="bg-muted px-1 rounded">execution_wallet_secrets_old</code> tables.
                <br />
                Wallet ID must be manually pasted. No wallet creation available.
              </p>
            </div>
          </div>
        </div>

        {/* Withdraw Funds */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <ArrowDownToLine className="h-5 w-5" />
              Withdraw from Legacy Wallet
            </CardTitle>
            <CardDescription>
              Attempt withdrawal from old wallet schema. Will answer: can old secrets be decrypted with current KEK?
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="wallet-id">Wallet ID (from execution_wallets_old)</Label>
              <Input
                id="wallet-id"
                value={withdrawWalletId}
                onChange={(e) => setWithdrawWalletId(e.target.value)}
                placeholder="UUID of the legacy wallet"
                className="font-mono text-sm"
              />
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
              <Label htmlFor="destination">Destination Address</Label>
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
              disabled={withdrawLoading || !withdrawWalletId || !withdrawAmount || !withdrawDestination}
              className="w-full"
              variant="destructive"
            >
              {withdrawLoading ? "Processing..." : "Withdraw from Legacy Wallet"}
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
                      <strong>Success!</strong> Legacy wallet secrets decrypted with current KEK.
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

        {/* Footer warning */}
        <div className="text-xs text-muted-foreground text-center pt-4 border-t border-border">
          <AlertTriangle className="h-4 w-4 inline mr-1" />
          Temporary recovery tool. Will be deleted after recovery drill.
        </div>
      </div>
    </div>
  );
}
