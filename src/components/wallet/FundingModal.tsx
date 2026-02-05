/**
 * FundingModal
 * 
 * Single source of truth for REAL funding instructions.
 * Shows system wallet address, QR code, step-by-step instructions, and accepted assets.
 */
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Copy, 
  CheckCircle, 
  ExternalLink, 
  AlertTriangle,
  Wallet,
  Info
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useToast } from '@/hooks/use-toast';

interface FundingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  systemWalletAddress: string;
  externalWalletCount: number;
}

export function FundingModal({ 
  open, 
  onOpenChange, 
  systemWalletAddress,
  externalWalletCount 
}: FundingModalProps) {
  const { toast } = useToast();
  const [copiedAddress, setCopiedAddress] = useState(false);

  const copyAddress = () => {
    navigator.clipboard.writeText(systemWalletAddress);
    setCopiedAddress(true);
    toast({
      title: "Address Copied",
      description: "System wallet address copied to clipboard",
    });
    setTimeout(() => setCopiedAddress(false), 2000);
  };

  const openBasescan = () => {
    window.open(`https://basescan.org/address/${systemWalletAddress}`, '_blank');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Wallet className="h-5 w-5 text-primary" />
            Fund Your Portfolio
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* Network Badge */}
          <div className="flex justify-center">
            <Badge className="bg-primary text-primary-foreground font-semibold px-4 py-1.5">
              Base Network (Chain ID 8453)
            </Badge>
          </div>

          {/* System Wallet Address - PRIMARY FOCUS */}
          <div className="bg-primary/10 border-2 border-primary/50 rounded-xl p-5 space-y-4">
            <div className="text-center">
              <h3 className="font-semibold text-foreground text-lg mb-1">
                System Deposit Address
              </h3>
              <p className="text-sm text-muted-foreground">
                Send funds to this address from your registered wallet
              </p>
            </div>

            {/* Full Address Display */}
            <div className="bg-background border-2 border-primary/40 rounded-lg p-4">
              <code className="text-primary text-sm sm:text-base font-mono break-all block text-center leading-relaxed select-all">
                {systemWalletAddress}
              </code>
            </div>

            {/* Primary CTA - Copy Address */}
            <Button
              onClick={copyAddress}
              size="lg"
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-base py-6"
            >
              {copiedAddress ? (
                <>
                  <CheckCircle className="w-5 h-5 mr-2" />
                  Address Copied!
                </>
              ) : (
                <>
                  <Copy className="w-5 h-5 mr-2" />
                  Copy Address
                </>
              )}
            </Button>

            {/* QR Code */}
            <div className="flex justify-center p-4 bg-white rounded-lg border border-border">
              <QRCodeSVG value={systemWalletAddress} size={180} />
            </div>

            {/* View on Basescan */}
            <Button
              variant="outline"
              onClick={openBasescan}
              className="w-full border-primary/30 hover:bg-primary/5"
            >
              View on Basescan
              <ExternalLink className="w-4 h-4 ml-2" />
            </Button>
          </div>

          {/* Step-by-Step Instructions */}
          <div className="bg-muted/50 border border-border rounded-lg p-4 space-y-3">
            <h4 className="font-semibold text-foreground flex items-center gap-2">
              <Info className="w-4 h-4 text-primary" />
              How to Fund Your Portfolio
            </h4>
            <ol className="list-decimal pl-5 text-sm text-foreground/80 space-y-2">
              <li>
                <strong>Open your wallet app</strong> (MetaMask, Rabby, or Coinbase Wallet)
              </li>
              <li>
                <strong>Select your registered funding wallet</strong>
                <span className="text-muted-foreground ml-1">
                  ({externalWalletCount} wallet{externalWalletCount !== 1 ? 's' : ''} registered)
                </span>
              </li>
              <li>
                <strong>Switch to Base network</strong> (Chain ID 8453)
              </li>
              <li>
                <strong>Send ETH or USDC</strong> to the system address above
              </li>
              <li>
                <strong>Wait for confirmation</strong> (typically 2–5 minutes)
              </li>
            </ol>
          </div>

          {/* Accepted Assets */}
          <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
            <h4 className="font-medium text-foreground text-sm mb-2">Accepted Assets</h4>
            <div className="flex gap-3 mb-2">
              <Badge variant="outline" className="border-primary/40 text-foreground">
                ETH
              </Badge>
              <Badge variant="outline" className="border-primary/40 text-foreground">
                USDC
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              <strong>Base network only</strong> • Recommended minimum: 0.01 ETH or 25 USDC
            </p>
          </div>

          {/* Critical Warning */}
          <div className="bg-amber-500/10 border-2 border-amber-500/40 rounded-lg p-4">
            <div className="flex gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm space-y-2">
                <p className="font-semibold text-amber-700 dark:text-amber-400">
                  Important — Read Before Sending
                </p>
                <ul className="space-y-1.5 text-foreground/80">
                  <li>• <strong>Only send from your registered wallet</strong> — transfers from other addresses cannot be attributed to your account</li>
                  <li>• <strong>This app cannot move funds on your behalf</strong> — you must initiate the transfer in your wallet app</li>
                  <li>• <strong>Use Base network only</strong> — funds sent on other networks may be lost</li>
                </ul>
              </div>
            </div>
          </div>

          {/* What happens after */}
          <div className="text-center text-sm text-muted-foreground">
            <p>
              Once your transaction confirms on Base, your portfolio will be credited automatically.
              You'll receive a notification when your funds are ready.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
