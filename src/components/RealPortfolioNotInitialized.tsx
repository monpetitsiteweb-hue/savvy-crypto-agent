/**
 * RealPortfolioNotInitialized
 * 
 * REAL MODE ONLY - This component replaces PortfolioNotInitialized for REAL mode.
 * 
 * KEY DIFFERENCE FROM TEST MODE:
 * - TEST mode: Shows "Initialize Portfolio" button to create €30k mock capital
 * - REAL mode: Shows "Add Funding Wallet" CTA - capital comes from on-chain deposits ONLY
 * 
 * REAL portfolio can ONLY be created via:
 * 1. User registers external wallet address
 * 2. User sends funds from that address to system wallet
 * 3. System automatically attributes deposit and creates portfolio_capital
 * 
 * There is NO initialize button for REAL mode.
 */
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Wallet, ArrowRight, Shield, Info } from "lucide-react";
import { useState } from "react";
import { RealFundingWalletDialog } from "./wallet/RealFundingWalletDialog";

interface RealPortfolioNotInitializedProps {
  onWalletAdded?: () => void;
}

export function RealPortfolioNotInitialized({ onWalletAdded }: RealPortfolioNotInitializedProps) {
  const [showFundingDialog, setShowFundingDialog] = useState(false);

  return (
    <>
      <Card className="bg-muted/50 border-primary/30">
        <CardContent className="p-6">
          <div className="flex flex-col items-center justify-center text-center space-y-4">
            <div className="relative">
              <Wallet className="h-12 w-12 text-primary" />
              <Shield className="h-5 w-5 text-primary/70 absolute -bottom-1 -right-1" />
            </div>
            
            <div>
              <h3 className="text-lg font-semibold text-foreground">Enable Real Trading</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-md">
                To start trading with real capital, you must first register a funding wallet you own.
                Deposits from registered wallets will automatically create your portfolio.
              </p>
            </div>

            {/* Key Information */}
            <div className="bg-primary/10 border border-primary/30 rounded-lg p-4 text-left w-full max-w-md">
              <div className="flex gap-3">
                <Info className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                <div className="text-sm text-foreground/80 space-y-2">
                  <p className="font-medium text-foreground">How it works:</p>
                  <ol className="list-decimal pl-4 space-y-1">
                    <li>Register your external wallet address</li>
                    <li>Send funds from that address to the system wallet</li>
                    <li>System automatically credits your portfolio in EUR</li>
                    <li>Start trading with real capital</li>
                  </ol>
                </div>
              </div>
            </div>
            
            <Button 
              onClick={() => setShowFundingDialog(true)}
              className="bg-primary hover:bg-primary/90"
            >
              <Wallet className="h-4 w-4 mr-2" />
              Add Funding Wallet
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>

            <p className="text-xs text-muted-foreground max-w-md">
              Only deposits from registered wallets on Base network (Chain ID 8453) are supported.
              ETH and USDC are accepted.
            </p>
          </div>
        </CardContent>
      </Card>

      <RealFundingWalletDialog
        open={showFundingDialog}
        onOpenChange={setShowFundingDialog}
        onWalletAdded={() => {
          onWalletAdded?.();
          setShowFundingDialog(false);
        }}
      />
    </>
  );
}
