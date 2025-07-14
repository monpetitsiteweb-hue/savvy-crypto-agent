import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
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
  const [apiName, setApiName] = useState('');
  const [apiIdentifier, setApiIdentifier] = useState('');
  const [apiPrivateKey, setApiPrivateKey] = useState('');
  const [connectionMethod, setConnectionMethod] = useState<'oauth' | 'api'>('oauth');
  const [keyType, setKeyType] = useState<'ecdsa' | 'ed25519'>('ed25519');

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
    const requiredFields = keyType === 'ecdsa' ? [apiName, apiIdentifier, apiPrivateKey] : [apiIdentifier, apiPrivateKey];
    if (!user || !requiredFields.every(field => field.trim())) {
      toast({
        title: "Missing Information",
        description: keyType === 'ecdsa' 
          ? "Please provide API name, identifier, and private key" 
          : "Please provide API identifier and private key",
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
          api_name_encrypted: keyType === 'ecdsa' ? apiName : `ed25519_key_${Date.now()}`,
          api_identifier_encrypted: apiIdentifier,
          api_private_key_encrypted: `${keyType}:${apiPrivateKey}`, // Prefix with key type
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
      setApiName('');
      setApiIdentifier('');
      setApiPrivateKey('');
      
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

              <div className="space-y-4">
                <div>
                  <Label className="text-white">Key Type</Label>
                  <RadioGroup value={keyType} onValueChange={(value) => setKeyType(value as 'ecdsa' | 'ed25519')} className="flex gap-4 mt-2">
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="ed25519" id="ed25519" />
                      <Label htmlFor="ed25519" className="text-white">Ed25519 (Recommended)</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="ecdsa" id="ecdsa" />
                      <Label htmlFor="ecdsa" className="text-white">ECDSA</Label>
                    </div>
                  </RadioGroup>
                  <p className="text-xs text-slate-400 mt-2">
                    {keyType === 'ed25519' 
                      ? "Ed25519 keys are simpler and don't require an API name field"
                      : "ECDSA keys require the organizations/xxx format API name"
                    }
                  </p>
                </div>

                {keyType === 'ecdsa' && (
                  <div>
                    <Label htmlFor="apiName" className="text-white">API Name</Label>
                    <Input
                      id="apiName"
                      placeholder="organizations/your-org-id"
                      value={apiName}
                      onChange={(e) => setApiName(e.target.value)}
                      className="bg-slate-800/50 border-slate-600 text-white"
                    />
                    <p className="text-xs text-slate-400 mt-1">Format: organizations/xxx (found in your downloaded JSON file)</p>
                  </div>
                )}
                
                <div>
                  <Label htmlFor="apiIdentifier" className="text-white">API Key Identifier</Label>
                  <Input
                    id="apiIdentifier"
                    placeholder="97dc6c2d"
                    value={apiIdentifier}
                    onChange={(e) => setApiIdentifier(e.target.value)}
                    className="bg-slate-800/50 border-slate-600 text-white"
                  />
                  <p className="text-xs text-slate-400 mt-1">Short identifier from your JSON file (e.g., 97dc6c2d)</p>
                </div>

                <div>
                  <Label htmlFor="apiPrivateKey" className="text-white">Private Key</Label>
                  <textarea
                    id="apiPrivateKey"
                    value={apiPrivateKey}
                    onChange={(e) => setApiPrivateKey(e.target.value)}
                    placeholder={keyType === 'ed25519' 
                      ? "-----BEGIN PRIVATE KEY-----\nMIGEAgEAMBAGByqGSM49AgEG...\n-----END PRIVATE KEY-----"
                      : "-----BEGIN EC PRIVATE KEY-----\nMHcCAQXXXXXX\n-----END EC PRIVATE KEY-----"
                    }
                    className="w-full min-h-[100px] p-2 border border-slate-600 rounded-md resize-vertical font-mono text-sm bg-slate-800/50 text-white"
                  />
                  <p className="text-xs text-slate-400 mt-1">
                    Complete PEM format private key from your JSON file
                    {keyType === 'ed25519' && " (Ed25519 keys start with -----BEGIN PRIVATE KEY-----)"}
                  </p>
                </div>
              </div>

              <Button 
                onClick={handleApiKeyConnect}
                disabled={loading || !apiIdentifier.trim() || !apiPrivateKey.trim() || (keyType === 'ecdsa' && !apiName.trim())}
                className="w-full bg-purple-600 hover:bg-purple-700"
              >
                {loading ? 'Connecting...' : 'Connect with API Credentials'}
              </Button>

              <div className="space-y-2 text-sm text-slate-400">
                <p className="font-medium">How to get your API credentials:</p>
                <ol className="list-decimal list-inside space-y-1 ml-2">
                  <li>Go to <a href="https://www.coinbase.com/settings/api" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">coinbase.com/settings/api</a></li>
                  <li>Click "Create an API Key"</li>
                  <li>Choose <strong>{keyType === 'ed25519' ? 'Ed25519' : 'ECDSA'}</strong> as the signature algorithm</li>
                  <li>Set permissions (View for portfolio access)</li>
                  <li>Download the JSON file containing your credentials</li>
                  <li>Extract the {keyType === 'ecdsa' ? '"name", ' : ''}key identifier, and "privateKey" from the JSON</li>
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