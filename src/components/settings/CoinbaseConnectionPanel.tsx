import React, { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { Link2, Plus, Trash2, CheckCircle, AlertTriangle, Settings } from 'lucide-react';

interface CoinbaseConnection {
  id: string;
  api_name_encrypted?: string;
  coinbase_user_id?: string;
  connected_at: string;
  is_active: boolean;
  access_token_encrypted?: string;
  expires_at?: string;
}

export const CoinbaseConnectionPanel = () => {
  const { user, session } = useAuth();
  const { toast } = useToast();
  const [connections, setConnections] = useState<CoinbaseConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  
  // API Key form state
  const [apiKeyForm, setApiKeyForm] = useState({
    name: '',
    identifier: '',
    privateKey: '',
    keyType: 'ECDSA'
  });

  useEffect(() => {
    if (user) {
      fetchConnections();
    }
  }, [user]);

  const fetchConnections = async () => {
    try {
      const { data, error } = await supabase
        .from('user_coinbase_connections')
        .select('*')
        .eq('user_id', user?.id)
        .order('connected_at', { ascending: false });

      if (error) throw error;
      setConnections(data || []);
    } catch (error) {
      console.error('Error fetching connections:', error);
      toast({
        title: "Error",
        description: "Failed to load connections",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleOAuthConnect = async () => {
    if (!user || !session) {
      toast({
        title: "Authentication required",
        description: "You must be signed in to connect your Coinbase account. Please log in first.",
        variant: "destructive"
      });
      return;
    }

    setConnecting(true);
    try {
      console.log('Starting OAuth flow for user:', user.id);
      const { data, error } = await supabase.functions.invoke('coinbase-oauth');

      if (error) {
        console.error('OAuth function error:', error);
        throw new Error(`Failed to start OAuth flow: ${error.message}`);
      }

      if (!data?.success) {
        console.error('OAuth response error:', data);
        throw new Error(data?.error || 'OAuth initialization failed');
      }

      console.log('Redirecting to OAuth URL:', data.oauth_url);
      // Redirect to Coinbase OAuth URL
      window.location.href = data.oauth_url;
    } catch (error) {
      console.error('OAuth error:', error);
      toast({
        title: "Connection failed",
        description: error instanceof Error ? error.message : "Failed to start OAuth flow. Please try again.",
        variant: "destructive"
      });
      setConnecting(false);
    }
  };

  const handleApiKeyConnect = async () => {
    if (!apiKeyForm.name || !apiKeyForm.identifier || !apiKeyForm.privateKey) {
      toast({
        title: "Missing information",
        description: "Please fill in all required fields",
        variant: "destructive"
      });
      return;
    }

    setConnecting(true);
    try {
      const { error } = await supabase
        .from('user_coinbase_connections')
        .insert({
          user_id: user?.id,
          api_name_encrypted: apiKeyForm.name,
          api_identifier_encrypted: apiKeyForm.identifier,
          api_private_key_encrypted: apiKeyForm.privateKey,
          is_active: true
        });

      if (error) throw error;

      setApiKeyForm({ name: '', identifier: '', privateKey: '', keyType: 'ECDSA' });
      await fetchConnections();
      
      toast({
        title: "Success",
        description: "API key connection added successfully",
      });
    } catch (error) {
      console.error('API key connection error:', error);
      toast({
        title: "Connection failed",
        description: "Failed to add API key connection",
        variant: "destructive"
      });
    } finally {
      setConnecting(false);
    }
  };

  const handleEditConnection = async (connectionId: string) => {
    toast({
      title: "Edit Connection",
      description: "Connection editing feature coming soon",
    });
  };

  const handleDisconnect = async (connectionId: string) => {
    try {
      const { error } = await supabase
        .from('user_coinbase_connections')
        .delete()
        .eq('id', connectionId);

      if (error) throw error;

      await fetchConnections();
      toast({
        title: "Disconnected",
        description: "Connection removed successfully",
      });
    } catch (error) {
      console.error('Disconnect error:', error);
      toast({
        title: "Error",
        description: "Failed to disconnect",
        variant: "destructive"
      });
    }
  };

  if (loading) {
    return (
      <Card className="bg-slate-800 border-slate-700">
        <CardContent className="p-6">
          <div className="text-center text-slate-400">Loading connections...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Current Connections */}
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            Coinbase Connections
          </CardTitle>
          <CardDescription className="text-slate-400">
            Manage your Coinbase account connections for trading
          </CardDescription>
        </CardHeader>
        <CardContent>
          {connections.length === 0 ? (
            <div className="text-center py-8">
              <AlertTriangle className="h-12 w-12 text-slate-500 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-slate-300 mb-2">No connections found</h3>
              <p className="text-slate-400 mb-4">
                Connect your Coinbase account to start trading
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {connections.map((connection) => (
                <div key={connection.id} className="flex items-center justify-between p-4 border border-slate-600 rounded-lg">
                  <div className="flex items-center gap-3">
                    <CheckCircle className="h-5 w-5 text-green-400" />
                    <div>
                      <div className="font-medium text-white">
                        {connection.api_name_encrypted || connection.coinbase_user_id || 'Coinbase Account'}
                      </div>
                      <div className="text-sm text-slate-400">
                        Connected {new Date(connection.connected_at).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={connection.is_active ? "default" : "secondary"}>
                      {connection.is_active ? "Active" : "Inactive"}
                    </Badge>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEditConnection(connection.id)}
                      className="text-blue-400 border-blue-400 hover:bg-blue-400 hover:text-white"
                    >
                      <Settings className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDisconnect(connection.id)}
                      className="text-red-400 border-red-400 hover:bg-red-400 hover:text-white"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add New Connection */}
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Add Connection
          </CardTitle>
          <CardDescription className="text-slate-400">
            Connect your Coinbase account using OAuth or API keys
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="oauth" className="space-y-4">
            <TabsList className="bg-slate-700">
              <TabsTrigger value="oauth">OAuth (Recommended)</TabsTrigger>
              <TabsTrigger value="apikey">API Keys</TabsTrigger>
            </TabsList>
            
            <TabsContent value="oauth" className="space-y-4">
              <Alert className="bg-blue-900/20 border-blue-700">
                <Settings className="h-4 w-4" />
                <AlertDescription className="text-blue-200">
                  OAuth provides secure access to your Coinbase account without storing sensitive credentials.
                </AlertDescription>
              </Alert>
              
              <Button 
                onClick={handleOAuthConnect}
                disabled={connecting}
                className="w-full bg-blue-600 hover:bg-blue-700"
              >
                {connecting ? 'Connecting...' : 'Connect with OAuth'}
              </Button>
            </TabsContent>
            
            <TabsContent value="apikey" className="space-y-4">
              <Alert className="bg-yellow-900/20 border-yellow-700">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-yellow-200">
                  API keys provide direct access but require careful handling. Only use if OAuth is not available.
                </AlertDescription>
              </Alert>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="keyType" className="text-white">Key Type</Label>
                  <Select value={apiKeyForm.keyType} onValueChange={(value) => setApiKeyForm(prev => ({ ...prev, keyType: value }))}>
                    <SelectTrigger className="bg-slate-700 border-slate-600">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ECDSA">ECDSA</SelectItem>
                      <SelectItem value="Ed25519">Ed25519</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="name" className="text-white">Connection Name</Label>
                  <Input
                    id="name"
                    value={apiKeyForm.name}
                    onChange={(e) => setApiKeyForm(prev => ({ ...prev, name: e.target.value }))}
                    className="bg-slate-700 border-slate-600"
                    placeholder="My Coinbase API"
                  />
                </div>
              </div>
              
              <div>
                <Label htmlFor="identifier" className="text-white">API Key / Identifier</Label>
                <Input
                  id="identifier"
                  value={apiKeyForm.identifier}
                  onChange={(e) => setApiKeyForm(prev => ({ ...prev, identifier: e.target.value }))}
                  className="bg-slate-700 border-slate-600"
                  placeholder="Your API key identifier"
                />
              </div>
              
              <div>
                <Label htmlFor="privateKey" className="text-white">Private Key</Label>
                <Input
                  id="privateKey"
                  type="password"
                  value={apiKeyForm.privateKey}
                  onChange={(e) => setApiKeyForm(prev => ({ ...prev, privateKey: e.target.value }))}
                  className="bg-slate-700 border-slate-600"
                  placeholder="Your private key"
                />
              </div>
              
              <Button 
                onClick={handleApiKeyConnect}
                disabled={connecting}
                className="w-full bg-green-600 hover:bg-green-700"
              >
                {connecting ? 'Adding...' : 'Add API Key Connection'}
              </Button>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
};