import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Wallet, 
  Loader2, 
  Copy,
  CheckCircle,
  ExternalLink
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { logger } from '@/utils/logger';
import { Button } from '@/components/ui/button';

interface ExternalAddress {
  id: string;
  address: string;
  label: string | null;
  chain_id: number;
  is_verified: boolean;
  source: 'manual' | 'coinbase';
  created_at: string;
}

interface ExternalAddressListProps {
  refreshTrigger?: number;
}

const BASE_CHAIN_ID = 8453;

export function ExternalAddressList({ refreshTrigger }: ExternalAddressListProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [addresses, setAddresses] = useState<ExternalAddress[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchAddresses = useCallback(async () => {
    if (!user?.id) return;
    
    setIsLoading(true);
    try {
      const { data, error } = await (supabase
        .from('user_external_addresses' as any)
        .select('id, address, label, chain_id, is_verified, source, created_at')
        .eq('user_id', user.id)
        .eq('chain_id', BASE_CHAIN_ID)
        .order('created_at', { ascending: false }) as any);

      if (error) throw error;
      
      setAddresses(data || []);
    } catch (err) {
      logger.error('[ExternalAddressList] Fetch error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchAddresses();
  }, [fetchAddresses, refreshTrigger]);

  const copyAddress = (id: string, address: string) => {
    navigator.clipboard.writeText(address);
    setCopiedId(id);
    toast({
      title: "Copied",
      description: "Address copied to clipboard",
    });
    setTimeout(() => setCopiedId(null), 2000);
  };

  const openBasescan = (address: string) => {
    window.open(`https://basescan.org/address/${address}`, '_blank');
  };

  const truncateAddress = (address: string): string => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  if (isLoading) {
    return (
      <Card className="p-4 bg-muted/50 border-border">
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
        </div>
      </Card>
    );
  }

  if (addresses.length === 0) {
    return (
      <Card className="p-4 bg-muted/50 border-border">
        <div className="text-center py-4">
          <Wallet className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No funding wallets registered</p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Register your wallet address above to enable REAL trading deposits
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4 bg-muted/50 border-border">
      <h4 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
        <Wallet className="w-4 h-4 text-primary" />
        Your Registered Funding Wallets
      </h4>
      
      <div className="space-y-2">
        {addresses.map((addr) => (
          <div
            key={addr.id}
            className="flex items-center justify-between p-3 bg-background rounded-lg border border-border"
          >
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <code className="text-primary font-mono text-sm">
                    {truncateAddress(addr.address)}
                  </code>
                  {addr.source === 'coinbase' && (
                    <Badge variant="outline" className="text-xs border-accent/50 text-accent">
                      Coinbase
                    </Badge>
                  )}
                  {addr.is_verified && (
                    <Badge className="bg-primary/20 text-primary border-primary/30 text-xs">
                      <CheckCircle className="w-3 h-3 mr-1" />
                      Verified
                    </Badge>
                  )}
                </div>
                {addr.label && (
                  <span className="text-xs text-muted-foreground mt-1 truncate">
                    {addr.label}
                  </span>
                )}
              </div>
            </div>
            
            <div className="flex items-center gap-1 flex-shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyAddress(addr.id, addr.address)}
                className="text-muted-foreground hover:text-foreground h-8 w-8 p-0"
              >
                {copiedId === addr.id ? (
                  <CheckCircle className="w-4 h-4 text-primary" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => openBasescan(addr.address)}
                className="text-muted-foreground hover:text-foreground h-8 w-8 p-0"
              >
                <ExternalLink className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground mt-3">
        Deposits from these addresses to the system wallet will be credited to your portfolio.
      </p>
    </Card>
  );
}
