import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  ChevronDown, 
  ChevronUp,
  Landmark,
  Info
} from 'lucide-react';
import { ExternalAddressForm } from './ExternalAddressForm';
import { ExternalAddressList } from './ExternalAddressList';

/**
 * ExternalFundingSection
 * 
 * ADDITIVE ONLY - Does not replace wallet balance polling (Flow A)
 * 
 * This component provides the UI for Flow B (deposit attribution):
 * - Register external funding addresses
 * - View registered addresses
 * - Instructions for address-based funding
 * 
 * This is purely additive and coexists with the existing wallet funding flow.
 */

interface ExternalFundingSectionProps {
  systemWalletAddress?: string;
}

export function ExternalFundingSection({ systemWalletAddress }: ExternalFundingSectionProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleAddressAdded = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  return (
    <Card className="p-4 bg-indigo-500/10 border-indigo-500/30">
      {/* Collapsible Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          <Landmark className="w-5 h-5 text-indigo-400" />
          <div>
            <h4 className="text-indigo-300 font-medium">Advanced: Portfolio Funding</h4>
            <p className="text-indigo-200/60 text-xs mt-0.5">
              Register addresses for EUR-tracked deposit attribution
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge className="bg-indigo-500/20 text-indigo-300 border-indigo-500/30 text-xs">
            Optional
          </Badge>
          {isExpanded ? (
            <ChevronUp className="w-5 h-5 text-indigo-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-indigo-400" />
          )}
        </div>
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-indigo-500/30 space-y-4">
          {/* Explanation */}
          <div className="bg-indigo-500/10 rounded-lg p-3 text-sm text-indigo-200/80">
            <div className="flex gap-2">
              <Info className="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5" />
              <div className="space-y-2">
                <p>
                  <strong>This is an alternative funding method</strong> for users who want:
                </p>
                <ul className="list-disc pl-4 space-y-1 text-indigo-200/70">
                  <li>EUR-denominated portfolio tracking</li>
                  <li>Deposit attribution from known addresses</li>
                  <li>Formal accounting of capital inflows</li>
                </ul>
                <p className="text-indigo-300 mt-2">
                  <strong>How it works:</strong>
                </p>
                <ol className="list-decimal pl-4 space-y-1 text-indigo-200/70">
                  <li>Register your external wallet address below</li>
                  <li>Send funds from that address to the system wallet</li>
                  <li>System automatically attributes the deposit to your account</li>
                  <li>Your portfolio capital is credited with EUR value</li>
                </ol>
              </div>
            </div>
          </div>

          {/* System Wallet Address (if provided) */}
          {systemWalletAddress && (
            <div className="bg-slate-800 rounded-lg p-3">
              <div className="text-xs text-slate-400 mb-1">System Deposit Address</div>
              <code className="text-green-400 text-sm font-mono break-all">
                {systemWalletAddress}
              </code>
              <p className="text-xs text-slate-500 mt-2">
                Send funds to this address from your registered addresses
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
