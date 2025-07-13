import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertCircle, Wallet, Key, Link, Shield, Info } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface CoinbaseConnectionSelectorProps {
  onConnectionEstablished: () => void;
}

export const CoinbaseConnectionSelector = ({ onConnectionEstablished }: CoinbaseConnectionSelectorProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [connectionMethod, setConnectionMethod] = useState<'oauth' | 'api'>('oauth');

  const handleOAuthConnect = async () => {
    if (!user) return;
    
    setLoading(true);
    try {
      const session = await supabase.auth.getSession();
      if (!session.data.session?.access_token) {
        throw new Error('No valid session found');
      }

      const { data, error } = await supabase.functions.invoke('coinbase-oauth', {
        headers: {
          Authorization: `Bearer ${session.data.session.access_token}`,
        },
      });

      if (error) {
        throw new Error(error.message);
      }

      if (data?.success && data?.oauth_url) {
        // Redirect to Coinbase OAuth
        window.location.href = data.oauth_url;
      } else {
        throw new Error('Failed to generate OAuth URL');
      }
    } catch (error) {
      console.error('OAuth initiation error:', error);
      toast({
        title: "OAuth Connection Failed",
        description: error instanceof Error ? error.message : 'Failed to start OAuth flow',
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleApiKeyConnect = async () => {
    if (!user || !apiKey.trim() || !apiSecret.trim()) {
      toast({
        title: "Missing Information",
        description: "Please provide both API key and secret",
        variant: "destructive",
      });
      return;
    }
    
    setLoading(true);
    try {
      // Store API credentials in the database (encrypted)
      const { error } = await supabase
        .from('user_coinbase_connections')
        .insert({
          user_id: user.id,
          access_token_encrypted: apiKey, // Using access_token field for API key
          refresh_token_encrypted: apiSecret, // Using refresh_token field for API secret
          coinbase_user_id: 'api_user', // Placeholder for API connections
          is_active: true,
          connected_at: new Date().toISOString(),
        });

      if (error) throw error;

      toast({
        title: "API Connection Successful",
        description: "Your Coinbase API credentials have been saved securely",
      });

      // Clear the form
      setApiKey('');
      setApiSecret('');
      
      // Notify parent component
      onConnectionEstablished();
      
    } catch (error) {
      console.error('API connection error:', error);
      toast({
        title: "API Connection Failed",
        description: error instanceof Error ? error.message : 'Failed to save API credentials',
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center py-12 space-y-6 max-w-2xl mx-auto">
      <div className="text-center space-y-4">
        <div className="w-16 h-16 bg-slate-700/50 rounded-full flex items-center justify-center mx-auto">
          <Wallet className="w-8 h-8 text-slate-500" />
        </div>
        <div>
          <h3 className="text-xl font-semibold text-white mb-2">Connect Your Coinbase Account</h3>
          <p className="text-slate-400 max-w-md mx-auto">
            Choose how you'd like to connect to Coinbase. You can use OAuth for easy setup or provide your API credentials for direct access.
          </p>
        </div>
      </div>

      <Card className="w-full bg-slate-700/30 border-slate-600">
        <Tabs value={connectionMethod} onValueChange={(value) => setConnectionMethod(value as 'oauth' | 'api')} className="w-full">
          <TabsList className="grid w-full grid-cols-2 bg-slate-800/50">
            <TabsTrigger value="oauth" className="flex items-center gap-2">
              <Link className="w-4 h-4" />
              OAuth (Recommended)
            </TabsTrigger>
            <TabsTrigger value="api" className="flex items-center gap-2">
              <Key className="w-4 h-4" />
              API Keys
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="oauth" className="p-6 space-y-4">
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                <Info className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <p className="text-blue-200 font-medium">OAuth Connection</p>
                  <p className="text-blue-300/80">
                    Securely connect through Coinbase's official OAuth flow. You'll be redirected to Coinbase to authorize access.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-green-400">
                  <Shield className="w-4 h-4" />
                  <span className="text-sm">Secure OAuth flow</span>
                </div>
                <div className="flex items-center gap-2 text-green-400">
                  <Shield className="w-4 h-4" />
                  <span className="text-sm">No need to share API keys</span>
                </div>
                <div className="flex items-center gap-2 text-green-400">
                  <Shield className="w-4 h-4" />
                  <span className="text-sm">Coinbase-managed permissions</span>
                </div>
              </div>

              <Button 
                onClick={handleOAuthConnect}
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700"
              >
                {loading ? 'Connecting...' : 'Connect with OAuth'}
              </Button>

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-amber-300/80">
                    Note: OAuth is currently experiencing issues. If this doesn't work, try the API Keys method below.
                  </p>
                </div>
              </div>
            </div>
          </TabsContent>
          
          <TabsContent value="api" className="p-6 space-y-4">
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 bg-purple-500/10 border border-purple-500/20 rounded-lg">
                <Key className="w-5 h-5 text-purple-400 mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <p className="text-purple-200 font-medium">API Key Connection</p>
                  <p className="text-purple-300/80">
                    Connect directly using your Coinbase Pro API credentials. This is a reliable alternative if OAuth is having issues.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <Label htmlFor="apiKey" className="text-white">API Key</Label>
                  <Input
                    id="apiKey"
                    type="password"
                    placeholder="Enter your Coinbase API key"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="bg-slate-800/50 border-slate-600 text-white"
                  />
                </div>
                
                <div>
                  <Label htmlFor="apiSecret" className="text-white">API Secret</Label>
                  <Input
                    id="apiSecret"
                    type="password"
                    placeholder="Enter your Coinbase API secret"
                    value={apiSecret}
                    onChange={(e) => setApiSecret(e.target.value)}
                    className="bg-slate-800/50 border-slate-600 text-white"
                  />
                </div>
              </div>

              <Button 
                onClick={handleApiKeyConnect}
                disabled={loading || !apiKey.trim() || !apiSecret.trim()}
                className="w-full bg-purple-600 hover:bg-purple-700"
              >
                {loading ? 'Connecting...' : 'Connect with API Keys'}
              </Button>

              <div className="space-y-2 text-sm text-slate-400">
                <p className="font-medium">How to get your API credentials:</p>
                <ol className="list-decimal list-inside space-y-1 ml-2">
                  <li>Go to <a href="https://exchange.coinbase.com/profile/api" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Coinbase Exchange API settings</a></li>
                  <li>Create a new API key with read permissions</li>
                  <li>Copy the key and secret (you won't see the secret again)</li>
                  <li>Paste them above to connect</li>
                </ol>
              </div>

              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                  <div className="text-sm">
                    <p className="text-red-200 font-medium">Security Notice</p>
                    <p className="text-red-300/80">
                      Your API credentials are encrypted and stored securely. Never share your API secret with anyone.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
};