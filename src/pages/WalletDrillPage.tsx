/**
 * Execution Wallet – Operator Panel
 * 
 * INTERNAL SAFETY TOOL — NOT A PRODUCT FEATURE
 * 
 * This page exists ONLY to verify the custody system works:
 * 1. Create wallet (server-side, system-custodied)
 * 2. Display address for manual funding
 * 3. Withdraw funds
 * 
 * NO private keys. NO automation. NO onboarding logic.
 */

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Copy, Wallet, ArrowDownToLine, AlertTriangle } from 'lucide-react';

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

export default function WalletDrillPage() {
  const { user } = useAuth();
  const { isAdmin, loading: roleLoading } = useUserRole();

  // Section 1: Create wallet state
  const [walletInfo, setWalletInfo] = useState<WalletInfo | null>(null);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Section 3: Withdraw state
  const [withdrawWalletId, setWithdrawWalletId] = useState('');
  const [withdrawAsset, setWithdrawAsset] = useState<'ETH' | 'USDC'>('ETH');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawDestination, setWithdrawDestination] = useState('');
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
  // SECTION 1: Create Wallet
  // ─────────────────────────────────────────────────────────────
  const handleCreateWallet = async () => {
    if (!user) return;
    
    setCreateLoading(true);
    setCreateError(null);
    setWalletInfo(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      const response = await fetch(
        `https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/execution-wallet-create`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            user_id: user.id,
            chain_id: 8453, // Base mainnet
          }),
        }
      );

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
        // Prefill withdraw wallet ID
        setWithdrawWalletId(result.wallet_id);
      } else {
        throw new Error(result.error || 'Unknown error');
      }
    } catch (err: any) {
      setCreateError(err.message || 'Failed to create wallet');
    } finally {
      setCreateLoading(false);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // SECTION 2: Copy address helper
  // ─────────────────────────────────────────────────────────────
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  // ─────────────────────────────────────────────────────────────
  // SECTION 3: Withdraw Funds
  // ─────────────────────────────────────────────────────────────
  const handleWithdraw = async () => {
    if (!user || !withdrawWalletId || !withdrawAmount || !withdrawDestination) return;

    setWithdrawLoading(true);
    setWithdrawResult(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      const response = await fetch(
        `https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/execution-wallet-withdraw`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            wallet_id: withdrawWalletId,
            asset: withdrawAsset,
            amount: withdrawAmount,
            destination: withdrawDestination,
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
          error: result.error || 'Unknown error',
        });
      }
    } catch (err: any) {
      setWithdrawResult({
        success: false,
        error: err.message || 'Failed to withdraw',
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
            <Wallet className="h-6 w-6" />
            Execution Wallet – Operator Panel
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Internal safety verification tool. NOT a product feature.
          </p>
        </div>

        {/* SECTION 1: Create Wallet */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">1. Create Execution Wallet</CardTitle>
            <CardDescription>
              System-custodied wallet. Private key never leaves server.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button 
              onClick={handleCreateWallet} 
              disabled={createLoading}
              className="w-full"
            >
              {createLoading ? 'Creating...' : 'Create execution wallet'}
            </Button>

            {createError && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded text-sm text-destructive">
                Error: {createError}
              </div>
            )}

            {walletInfo && (
              <div className="p-4 bg-muted rounded space-y-2 font-mono text-sm">
                <div><strong>wallet_id:</strong> {walletInfo.wallet_id}</div>
                <div><strong>wallet_address:</strong> {walletInfo.wallet_address}</div>
                <div><strong>chain_id:</strong> {walletInfo.chain_id}</div>
                <div><strong>is_funded:</strong> {walletInfo.is_funded ? 'true' : 'false'}</div>
                {walletInfo.already_existed && (
                  <div className="text-muted-foreground">(wallet already existed)</div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* SECTION 2: Fund Wallet (Manual) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">2. Fund Wallet (Manual)</CardTitle>
            <CardDescription>
              Send a small amount (e.g. 0.001 ETH) from an external wallet.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {walletInfo ? (
              <>
                <div className="flex items-center gap-2">
                  <Input 
                    value={walletInfo.wallet_address} 
                    readOnly 
                    className="font-mono text-sm"
                  />
                  <Button 
                    variant="outline" 
                    size="icon"
                    onClick={() => copyToClipboard(walletInfo.wallet_address)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <div className="text-sm text-muted-foreground">
                  <strong>Network:</strong> Base (Chain ID: 8453)
                </div>
              </>
            ) : (
              <p className="text-muted-foreground text-sm">
                Create a wallet first to see the funding address.
              </p>
            )}
          </CardContent>
        </Card>

        {/* SECTION 3: Withdraw Funds */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <ArrowDownToLine className="h-5 w-5" />
              3. Withdraw Funds
            </CardTitle>
            <CardDescription>
              Emergency exit. Works regardless of UI or automation state.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="wallet-id">Wallet ID</Label>
              <Input
                id="wallet-id"
                value={withdrawWalletId}
                onChange={(e) => setWithdrawWalletId(e.target.value)}
                placeholder="UUID of the wallet"
                className="font-mono text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="asset">Asset</Label>
              <select
                id="asset"
                value={withdrawAsset}
                onChange={(e) => setWithdrawAsset(e.target.value as 'ETH' | 'USDC')}
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
              {withdrawLoading ? 'Processing...' : 'Withdraw'}
            </Button>

            {withdrawResult && (
              <div className={`p-3 rounded text-sm ${
                withdrawResult.success 
                  ? 'bg-green-500/10 border border-green-500/20 text-green-600' 
                  : 'bg-destructive/10 border border-destructive/20 text-destructive'
              }`}>
                {withdrawResult.success ? (
                  <>
                    <div><strong>Success!</strong></div>
                    {withdrawResult.tx_hash && (
                      <div className="font-mono text-xs mt-1 break-all">
                        tx_hash: {withdrawResult.tx_hash}
                      </div>
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
          Operator-only safety tool. Not for production use.
        </div>
      </div>
    </div>
  );
}
