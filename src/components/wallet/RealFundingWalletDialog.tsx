/**
 * RealFundingWalletDialog
 * 
 * Dialog for registering external funding wallets for REAL mode.
 * This is the ONLY path to initialize REAL trading capital.
 * 
 * Features:
 * - Register manual wallet addresses
 * - View registered addresses
 * - Clear instructions on how funding works
 * 
 * IMPORTANT: This does NOT fund anything by itself.
 * User must send funds from registered addresses to system wallet.
 */
import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { 
  Wallet, 
  Plus, 
  Loader2, 
  AlertCircle,
  CheckCircle,
  Info,
  Copy,
  ExternalLink
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useExternalAddresses } from '@/hooks/useExternalAddresses';
import { logger } from '@/utils/logger';

interface RealFundingWalletDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onWalletAdded?: () => void;
}

const BASE_CHAIN_ID = 8453;

// Basic Ethereum address validation
const isValidEthAddress = (address: string): boolean => {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
};

export function RealFundingWalletDialog({
  open,
  onOpenChange,
  onWalletAdded,
}: RealFundingWalletDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { addresses, hasAddresses, refetch } = useExternalAddresses();

  const [address, setAddress] = useState('');
  const [label, setLabel] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setAddress('');
      setLabel('');
      setError(null);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user?.id) {
      setError('You must be logged in to add an address');
      return;
    }

    const trimmedAddress = address.trim();

    // Validate address format
    if (!isValidEthAddress(trimmedAddress)) {
      setError('Invalid Ethereum address format. Must start with 0x followed by 40 hex characters.');
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const { error: insertError } = await (supabase
        .from('user_external_addresses' as any)
        .insert({
          user_id: user.id,
          chain_id: BASE_CHAIN_ID,
          address: trimmedAddress.toLowerCase(),
          label: label.trim() || null,
          is_verified: false,
          source: 'manual'
        }) as any);

      if (insertError) {
        if (insertError.code === '23505') {
          setError('This address is already registered.');
        } else {
          throw insertError;
        }
        return;
      }

      logger.info('[RealFundingWalletDialog] Address registered:', {
        address: trimmedAddress.toLowerCase().slice(0, 10) + '...',
        chain_id: BASE_CHAIN_ID
      });

      toast({
        title: "✅ Funding Wallet Added Successfully",
        description: "Your wallet is registered. Send funds from this address to the system wallet to start trading.",
      });

      // Clear form and refresh list
      setAddress('');
      setLabel('');
      await refetch();
      onWalletAdded?.();
    } catch (err) {
      logger.error('[RealFundingWalletDialog] Insert error:', err);
      setError(err instanceof Error ? err.message : 'Failed to add address');
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyAddress = (addr: string) => {
    navigator.clipboard.writeText(addr);
    setCopiedAddress(addr);
    toast({
      title: "Copied",
      description: "Address copied to clipboard",
    });
    setTimeout(() => setCopiedAddress(null), 2000);
  };

  const truncateAddress = (addr: string): string => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg bg-background border-border max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <Wallet className="w-5 h-5 text-primary" />
            Register Funding Wallet
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Register wallets you own to enable REAL trading deposits.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 my-4">
          {/* Clear explanation - no ambiguity */}
          <div className="bg-primary/10 border border-primary/30 rounded-lg p-4">
            <div className="flex gap-3">
              <Info className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
              <div className="text-sm text-foreground/80 space-y-2">
                <p className="font-medium text-foreground">Why register a wallet?</p>
                <p className="text-muted-foreground">
                  Only deposits from registered wallets can be credited to your account. 
                  After registration, you'll see the system address to send funds to.
                </p>
                <p className="text-xs text-destructive/80 mt-2">
                  <strong>Important:</strong> Transfers from unregistered wallets cannot be attributed and will be lost.
                </p>
              </div>
            </div>
          </div>

          {/* Existing Registered Addresses */}
          {hasAddresses && (
            <div className="bg-muted/50 rounded-lg p-4 border border-border">
              <h4 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-primary" />
                Your Registered Wallets ({addresses.length})
              </h4>
              <div className="space-y-2">
                {addresses.slice(0, 3).map((addr) => (
                  <div
                    key={addr.id}
                    className="flex items-center justify-between p-2 bg-background rounded border border-border"
                  >
                    <div className="flex items-center gap-2">
                      <code className="text-primary font-mono text-sm">
                        {truncateAddress(addr.address)}
                      </code>
                      {addr.is_verified && (
                        <Badge variant="outline" className="text-primary border-primary/30 text-xs">
                          Verified
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyAddress(addr.address)}
                        className="text-muted-foreground hover:text-foreground h-7 w-7 p-0"
                      >
                        {copiedAddress === addr.address ? (
                          <CheckCircle className="w-3.5 h-3.5 text-primary" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => window.open(`https://basescan.org/address/${addr.address}`, '_blank')}
                        className="text-muted-foreground hover:text-foreground h-7 w-7 p-0"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
                {addresses.length > 3 && (
                  <p className="text-xs text-muted-foreground text-center">
                    + {addresses.length - 3} more registered
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Add New Address Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-address" className="text-foreground text-sm">
                {hasAddresses ? 'Add Another Wallet' : 'Wallet Address'} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="new-address"
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="0x..."
                className="bg-background border-border text-foreground font-mono text-sm"
                disabled={isSubmitting}
              />
              <p className="text-xs text-muted-foreground">
                Base network (Chain ID {BASE_CHAIN_ID}) only
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="wallet-label" className="text-foreground text-sm">
                Label (optional)
              </Label>
              <Input
                id="wallet-label"
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g., MetaMask, Coinbase Wallet"
                className="bg-background border-border text-foreground text-sm"
                maxLength={50}
                disabled={isSubmitting}
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 text-destructive text-sm bg-destructive/10 p-3 rounded border border-destructive/30">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <Button
              type="submit"
              disabled={isSubmitting || !address.trim()}
              className="w-full"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Registering...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-2" />
                  {hasAddresses ? 'Add Wallet' : 'Register Funding Wallet'}
                </>
              )}
            </Button>
          </form>
        </div>

        {/* Footer Note - clear and firm */}
        <div className="text-xs text-muted-foreground text-center border-t border-border pt-4">
          Only register wallets you fully control. After registration, you'll receive the system address to fund.
        </div>
      </DialogContent>
    </Dialog>
  );
}

