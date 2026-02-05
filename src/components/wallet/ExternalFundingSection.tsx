import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  ChevronDown, 
  ChevronUp,
  Wallet,
  Info,
  Plus
} from 'lucide-react';
import { ExternalAddressForm } from './ExternalAddressForm';
import { ExternalAddressList } from './ExternalAddressList';
import { useExternalAddresses } from '@/hooks/useExternalAddresses';

/**
 * ExternalFundingSection
 * 
 * PRIMARY FUNDING PATH for REAL mode.
 * 
 * This component provides the authoritative UI for registering external
 * wallet addresses that can fund the user's REAL trading portfolio.
 * 
 * Architecture:
 * - User registers external wallet addresses they own
 * - User sends funds from those addresses to the system wallet
 * - System attributes deposits and credits portfolio_capital
 * 
 * This is the ONLY path to fund REAL trading. There is no "alternative".
 */

interface ExternalFundingSectionProps {
  systemWalletAddress?: string;
  /** If true, start expanded (for when no wallets exist) */
  defaultExpanded?: boolean;
}

export function ExternalFundingSection({ 
  systemWalletAddress,
  defaultExpanded = false 
}: ExternalFundingSectionProps) {
  const { hasAddresses, count, refetch } = useExternalAddresses();
  const [isExpanded, setIsExpanded] = useState(defaultExpanded || !hasAddresses);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleAddressAdded = () => {
    setRefreshTrigger(prev => prev + 1);
    refetch();
  };

  return (
    <Card className="p-4 bg-primary/10 border-primary/30">
      {/* Header - Always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          <Wallet className="w-5 h-5 text-primary" />
          <div>
            <h4 className="text-foreground font-medium">Funding Wallets</h4>
            <p className="text-muted-foreground text-xs mt-0.5">
              {hasAddresses 
                ? `${count} wallet${count !== 1 ? 's' : ''} registered for deposit attribution`
                : 'Register wallets to enable REAL trading deposits'
              }
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasAddresses ? (
            <Badge className="bg-primary/20 text-primary border-primary/30 text-xs">
              {count} Registered
            </Badge>
          ) : (
            <Badge variant="outline" className="text-destructive border-destructive/30 text-xs">
              Required
            </Badge>
          )}
          {isExpanded ? (
            <ChevronUp className="w-5 h-5 text-primary" />
          ) : (
            <ChevronDown className="w-5 h-5 text-primary" />
          )}
        </div>
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-primary/30 space-y-4">
          {/* Explanation - only show if no addresses yet */}
          {!hasAddresses && (
            <div className="bg-primary/10 rounded-lg p-3 text-sm text-foreground/80">
              <div className="flex gap-2">
                <Info className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                <div className="space-y-2">
                  <p className="font-medium text-foreground">How funding works:</p>
                  <ol className="list-decimal pl-4 space-y-1 text-muted-foreground">
                    <li>Register your external wallet address below</li>
                    <li>Send funds from that address to the system wallet</li>
                    <li>System automatically attributes the deposit to your account</li>
                    <li>Your portfolio capital is credited with EUR value</li>
                  </ol>
                  <p className="text-destructive/80 text-xs mt-2">
                    <strong>Important:</strong> Only deposits from registered addresses can be attributed.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* System Wallet Address (if provided) */}
          {systemWalletAddress && (
            <div className="bg-muted rounded-lg p-3">
              <div className="text-xs text-muted-foreground mb-1">System Deposit Address</div>
              <code className="text-primary text-sm font-mono break-all">
                {systemWalletAddress}
              </code>
              <p className="text-xs text-muted-foreground mt-2">
                Send funds to this address from your registered wallets
              </p>
            </div>
          )}

          {/* Address List */}
          <ExternalAddressList refreshTrigger={refreshTrigger} />

          {/* Add Address Form */}
          <ExternalAddressForm onAddressAdded={handleAddressAdded} />
        </div>
      )}
    </Card>
  );
}
