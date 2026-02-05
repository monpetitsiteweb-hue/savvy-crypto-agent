import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { 
  Plus, 
  Loader2, 
  AlertCircle,
  CheckCircle
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { logger } from '@/utils/logger';

interface ExternalAddressFormProps {
  onAddressAdded?: () => void;
}

const BASE_CHAIN_ID = 8453;

// Basic Ethereum address validation
const isValidEthAddress = (address: string): boolean => {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
};

export function ExternalAddressForm({ onAddressAdded }: ExternalAddressFormProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [address, setAddress] = useState('');
  const [label, setLabel] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      // Insert into user_external_addresses
      // Address will be lowercased by DB trigger
      const { error: insertError } = await (supabase
        .from('user_external_addresses' as any)
        .insert({
          user_id: user.id,
          chain_id: BASE_CHAIN_ID,
          address: trimmedAddress.toLowerCase(), // Normalize on client as well
          label: label.trim() || null,
          is_verified: false, // User-declared, not verified yet
          source: 'manual'
        }) as any);

      if (insertError) {
        // Handle duplicate address error
        if (insertError.code === '23505') {
          setError('This address is already registered (possibly by you or another user).');
        } else {
          throw insertError;
        }
        return;
      }

      logger.info('[ExternalAddressForm] Address registered:', { 
        address: trimmedAddress.toLowerCase().slice(0, 10) + '...',
        chain_id: BASE_CHAIN_ID 
      });

      toast({
        title: "Funding Wallet Registered",
        description: "Your wallet has been added. Deposits from this address will be attributed to your account.",
      });

      // Clear form
      setAddress('');
      setLabel('');
      
      // Notify parent
      onAddressAdded?.();
    } catch (err) {
      logger.error('[ExternalAddressForm] Insert error:', err);
      setError(err instanceof Error ? err.message : 'Failed to add address');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="p-4 bg-muted/50 border-border">
      <h4 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
        <Plus className="w-4 h-4 text-primary" />
        Register Funding Wallet
      </h4>
      
      <p className="text-xs text-muted-foreground mb-4">
        Register wallet addresses you own. Deposits from these addresses to the system wallet 
        will be automatically credited to your REAL trading portfolio.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="address" className="text-foreground text-sm">
            Wallet Address <span className="text-destructive">*</span>
          </Label>
          <Input
            id="address"
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
          <Label htmlFor="label" className="text-foreground text-sm">
            Label (optional)
          </Label>
          <Input
            id="label"
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
              <CheckCircle className="w-4 h-4 mr-2" />
              Register Wallet
            </>
          )}
        </Button>
      </form>

      <div className="mt-4 pt-4 border-t border-border">
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
          <span>
            Only register addresses you fully control. System will attribute deposits 
            from these addresses to your account automatically.
          </span>
        </div>
      </div>
    </Card>
  );
}
