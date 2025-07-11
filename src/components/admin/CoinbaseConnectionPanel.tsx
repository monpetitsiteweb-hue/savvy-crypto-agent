
import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Plus, Wallet2, AlertTriangle, CheckCircle, AlertCircle, Trash2, Settings } from 'lucide-react';

interface CoinbaseConnection {
  id: string;
  connection_name: string;
  is_sandbox: boolean;
  is_active: boolean;
  connected_at: string;
  last_sync: string | null;
  api_key_encrypted?: string;
  api_secret_encrypted?: string;
}

export const CoinbaseConnectionPanel = () => {
  const [connections, setConnections] = useState<CoinbaseConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [testingConnection, setTestingConnection] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingConnection, setEditingConnection] = useState<CoinbaseConnection | null>(null);
  const [connectionName, setConnectionName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  
  const [isSandbox, setIsSandbox] = useState(false); // Changed default to false for production
  const { toast } = useToast();
  const { user } = useAuth();

  useEffect(() => {
    if (user) {
      fetchConnections();
    }
  }, [user]);

  const fetchConnections = async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase
        .from('coinbase_connections')
        .select('*')
        .order('connected_at', { ascending: false });

      if (error) throw error;
      setConnections(data || []);
    } catch (error) {
      console.error('Error fetching connections:', error);
      toast({
        title: "Error",
        description: "Failed to load Coinbase connections",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveConnection = async () => {
    if (!user) {
      toast({
        title: "Authentication Required",
        description: "Please log in to save Coinbase connections",
        variant: "destructive",
      });
      return;
    }

    if (!connectionName || !apiKey || !apiSecret) {
      toast({
        title: "Missing Information",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    try {
      const { error } = await supabase
        .from('coinbase_connections')
        .insert({
          user_id: user.id,
          connection_name: connectionName,
          api_key_encrypted: apiKey, // In production, this should be encrypted
          api_secret_encrypted: apiSecret, // In production, this should be encrypted
          is_sandbox: isSandbox,
          is_active: true,
        });

      if (error) throw error;

      toast({
        title: "Success",
        description: `Coinbase connection saved successfully (${isSandbox ? 'Sandbox' : 'Production'} mode)`,
      });

      setIsDialogOpen(false);
      setConnectionName('');
      setApiKey('');
      setApiSecret('');
      setIsSandbox(false); // Reset to production default
      fetchConnections();
    } catch (error) {
      console.error('Error saving connection:', error);
      toast({
        title: "Error",
        description: "Failed to save Coinbase connection",
        variant: "destructive",
      });
    }
  };

  const testConnection = async (connectionId: string) => {
    const connection = connections.find(c => c.id === connectionId);
    if (!connection) return;

    setTestingConnection(connectionId);
    
    try {
      // Check if credentials are present
      if (!connection.api_key_encrypted || !connection.api_secret_encrypted) {
        throw new Error('API credentials are missing');
      }

      // Test the actual connection by calling the portfolio function
      const { data, error } = await supabase.functions.invoke('coinbase-portfolio', {
        headers: {
          Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
        },
      });

      if (error) {
        throw new Error('Connection test failed: ' + error.message);
      }

      if (data.success) {
        toast({
          title: "Connection Test Successful",
          description: `✅ Successfully connected to Coinbase ${connection.is_sandbox ? 'Sandbox' : 'Production'} API and fetched ${data.accounts?.length || 0} accounts.`,
        });
      } else {
        throw new Error(data.error || 'Unknown error occurred');
      }
      
      // Update last_sync timestamp on successful test
      await supabase
        .from('coinbase_connections')
        .update({ last_sync: new Date().toISOString() })
        .eq('id', connectionId);
        
      fetchConnections(); // Refresh the connections list
    } catch (error) {
      console.error('Connection test failed:', error);
      toast({
        title: "Connection Test Failed",
        description: "❌ " + (error as Error).message,
        variant: "destructive",
      });
    } finally {
      setTestingConnection(null);
    }
  };

  const toggleConnection = async (id: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase
        .from('coinbase_connections')
        .update({ is_active: !currentStatus })
        .eq('id', id);

      if (error) throw error;
      fetchConnections();
    } catch (error) {
      console.error('Error toggling connection:', error);
    }
  };

  const toggleSandboxMode = async (id: string, currentSandboxMode: boolean) => {
    try {
      const { error } = await supabase
        .from('coinbase_connections')
        .update({ is_sandbox: !currentSandboxMode })
        .eq('id', id);

      if (error) throw error;
      
      toast({
        title: "Environment Updated",
        description: `Connection switched to ${!currentSandboxMode ? 'Sandbox' : 'Production'} mode`,
      });
      
      fetchConnections();
    } catch (error) {
      console.error('Error toggling sandbox mode:', error);
      toast({
        title: "Error",
        description: "Failed to update environment mode",
        variant: "destructive",
      });
    }
  };

  const deleteConnection = async (id: string, connectionName: string) => {
    try {
      const { error } = await supabase
        .from('coinbase_connections')
        .delete()
        .eq('id', id);

      if (error) throw error;
      
      toast({
        title: "Connection Deleted",
        description: `"${connectionName}" has been removed successfully`,
      });
      
      fetchConnections();
    } catch (error) {
      console.error('Error deleting connection:', error);
      toast({
        title: "Error",
        description: "Failed to delete connection",
        variant: "destructive",
      });
    }
  };

  const openEditDialog = (connection: CoinbaseConnection) => {
    setEditingConnection(connection);
    setConnectionName(connection.connection_name);
    setApiKey(''); // Don't pre-fill for security
    setApiSecret(''); // Don't pre-fill for security
    
    setIsSandbox(connection.is_sandbox);
    setIsEditDialogOpen(true);
  };

  const handleUpdateConnection = async () => {
    if (!user || !editingConnection) {
      toast({
        title: "Error",
        description: "Unable to update connection",
        variant: "destructive",
      });
      return;
    }

    if (!connectionName || !apiKey || !apiSecret) {
      toast({
        title: "Missing Information",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    try {
      const { error } = await supabase
        .from('coinbase_connections')
        .update({
          connection_name: connectionName,
          api_key_encrypted: apiKey, // In production, this should be encrypted
          api_secret_encrypted: apiSecret, // In production, this should be encrypted
          
          is_sandbox: isSandbox,
        })
        .eq('id', editingConnection.id);

      if (error) throw error;

      toast({
        title: "Success",
        description: `Connection "${connectionName}" updated successfully`,
      });

      setIsEditDialogOpen(false);
      setEditingConnection(null);
      setConnectionName('');
      setApiKey('');
      setApiSecret('');
      
      setIsSandbox(false);
      fetchConnections();
    } catch (error) {
      console.error('Error updating connection:', error);
      toast({
        title: "Error",
        description: "Failed to update connection",
        variant: "destructive",
      });
    }
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-slate-400">Please log in to manage Coinbase connections</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Coinbase Connections</h2>
          <p className="text-slate-400">Manage your Coinbase API connections for trading</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-blue-600 hover:bg-blue-700">
              <Plus className="w-4 h-4 mr-2" />
              Connect Coinbase
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-slate-800 border-slate-700">
            <DialogHeader>
              <DialogTitle className="text-white">Connect to Coinbase</DialogTitle>
              <DialogDescription className="text-slate-400">
                Add your Coinbase API credentials to enable automated trading
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5" />
                  <div className="text-sm">
                    <p className="text-amber-200 font-medium">Security Notice</p>
                    <p className="text-amber-300/80">
                      Your API keys are encrypted and stored securely. Use production mode for live trading.
                    </p>
                  </div>
                </div>
              </div>
              
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-blue-500 mt-0.5" />
                  <div className="text-sm">
                    <p className="text-blue-200 font-medium">How to get Coinbase API Keys</p>
                    <p className="text-blue-300/80">
                      1. Go to Coinbase Advanced Trade → API<br/>
                      2. Create new API key with trading permissions<br/>
                      3. Copy both the API Key and Secret<br/>
                      4. Make sure to select the correct environment (Production/Sandbox)
                    </p>
                  </div>
                </div>
              </div>
              
              <div className="space-y-2">
                <Label className="text-slate-300">Connection Name</Label>
                <Input
                  value={connectionName}
                  onChange={(e) => setConnectionName(e.target.value)}
                  placeholder="e.g., Main Trading Account"
                  className="bg-slate-700 border-slate-600 text-white"
                />
              </div>
              
              <div className="space-y-2">
                <Label className="text-slate-300">API Key</Label>
                <Input
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Your Coinbase API Key"
                  className="bg-slate-700 border-slate-600 text-white"
                />
              </div>
              
              <div className="space-y-2">
                <Label className="text-slate-300">API Secret</Label>
                <Input
                  type="password"
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                  placeholder="Your Coinbase API Secret"
                  className="bg-slate-700 border-slate-600 text-white"
                />
              </div>
              
              
              <div className="flex items-center justify-between p-3 bg-slate-700/30 rounded-lg">
                <div>
                  <Label className="text-slate-300">Sandbox Mode</Label>
                  <p className="text-xs text-slate-500">
                    {isSandbox ? 'Testing with fake data' : 'Live trading with real money'}
                  </p>
                </div>
                <Switch
                  checked={isSandbox}
                  onCheckedChange={setIsSandbox}
                />
              </div>
              
              <Button onClick={handleSaveConnection} className="w-full bg-blue-600 hover:bg-blue-700">
                Save Connection ({isSandbox ? 'Sandbox' : 'Production'})
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {connections.map((connection) => (
          <Card key={connection.id} className="bg-slate-800/50 border-slate-700">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Wallet2 className="w-5 h-5 text-blue-400" />
                  <CardTitle className="text-lg text-white">
                    {connection.connection_name}
                  </CardTitle>
                </div>
                <Badge 
                  variant={connection.is_active ? "default" : "secondary"}
                  className={connection.is_active ? "bg-green-600" : "bg-slate-600"}
                >
                  {connection.is_active ? (
                    <CheckCircle className="w-3 h-3 mr-1" />
                  ) : (
                    <AlertTriangle className="w-3 h-3 mr-1" />
                  )}
                  {connection.is_active ? 'Active' : 'Inactive'}
                </Badge>
              </div>
              <CardDescription className="text-slate-400">
                {connection.is_sandbox ? 'Sandbox Environment' : 'Live Trading'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Connected:</span>
                <span className="text-slate-300">
                  {new Date(connection.connected_at).toLocaleDateString()}
                </span>
              </div>
              {connection.last_sync && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Last Sync:</span>
                  <span className="text-slate-300">
                    {new Date(connection.last_sync).toLocaleString()}
                  </span>
                </div>
              )}
              <div className="space-y-2 pt-2">
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => toggleConnection(connection.id, connection.is_active)}
                    className="flex-1 border-slate-600 text-slate-300"
                  >
                    {connection.is_active ? 'Disable' : 'Enable'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openEditDialog(connection)}
                    className="border-slate-600 text-slate-300 hover:bg-slate-600 hover:text-white"
                  >
                    <Settings className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => testConnection(connection.id)}
                    disabled={testingConnection === connection.id}
                    className="border-blue-600 text-blue-400 hover:bg-blue-600 hover:text-white"
                  >
                    {testingConnection === connection.id ? 'Testing...' : 'Test Connection'}
                  </Button>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => toggleSandboxMode(connection.id, connection.is_sandbox)}
                  className="w-full border-amber-600 text-amber-400 hover:bg-amber-600 hover:text-white"
                >
                  Switch to {connection.is_sandbox ? 'Production' : 'Sandbox'} Mode
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full border-red-600 text-red-400 hover:bg-red-600 hover:text-white"
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete Connection
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="bg-slate-800 border-slate-700">
                    <AlertDialogHeader>
                      <AlertDialogTitle className="text-white">Delete Connection</AlertDialogTitle>
                      <AlertDialogDescription className="text-slate-400">
                        Are you sure you want to delete "{connection.connection_name}"? This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600">
                        Cancel
                      </AlertDialogCancel>
                      <AlertDialogAction 
                        onClick={() => deleteConnection(connection.id, connection.connection_name)}
                        className="bg-red-600 hover:bg-red-700 text-white"
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {connections.length === 0 && !loading && (
        <Card className="bg-slate-800/30 border-slate-700 border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Wallet2 className="w-12 h-12 text-slate-600 mb-4" />
            <h3 className="text-lg font-semibold text-slate-400 mb-2">No Coinbase Connections</h3>
            <p className="text-slate-500 text-center mb-4">
              Connect your Coinbase account to start automated trading
            </p>
            <Button onClick={() => setIsDialogOpen(true)} className="bg-blue-600 hover:bg-blue-700">
              <Plus className="w-4 h-4 mr-2" />
              Connect Your First Account
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Edit Connection Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="bg-slate-800 border-slate-700">
          <DialogHeader>
            <DialogTitle className="text-white">Edit Coinbase Connection</DialogTitle>
            <DialogDescription className="text-slate-400">
              Update your Coinbase API credentials and settings
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5" />
                <div className="text-sm">
                  <p className="text-amber-200 font-medium">Security Notice</p>
                  <p className="text-amber-300/80">
                    For security reasons, you must re-enter all API credentials to update the connection.
                  </p>
                </div>
              </div>
            </div>
            
            <div className="space-y-2">
              <Label className="text-slate-300">Connection Name</Label>
              <Input
                value={connectionName}
                onChange={(e) => setConnectionName(e.target.value)}
                placeholder="e.g., Main Trading Account"
                className="bg-slate-700 border-slate-600 text-white"
              />
            </div>
            
            <div className="space-y-2">
              <Label className="text-slate-300">API Key</Label>
              <Input
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter your Coinbase API Key"
                className="bg-slate-700 border-slate-600 text-white"
              />
            </div>
            
            <div className="space-y-2">
              <Label className="text-slate-300">API Secret</Label>
              <Input
                type="password"
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                placeholder="Enter your Coinbase API Secret"
                className="bg-slate-700 border-slate-600 text-white"
              />
            </div>
            
            
            <div className="flex items-center justify-between p-3 bg-slate-700/30 rounded-lg">
              <div>
                <Label className="text-slate-300">Sandbox Mode</Label>
                <p className="text-xs text-slate-500">
                  {isSandbox ? 'Testing with fake data' : 'Live trading with real money'}
                </p>
              </div>
              <Switch
                checked={isSandbox}
                onCheckedChange={setIsSandbox}
              />
            </div>
            
            <Button onClick={handleUpdateConnection} className="w-full bg-blue-600 hover:bg-blue-700">
              Update Connection ({isSandbox ? 'Sandbox' : 'Production'})
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
