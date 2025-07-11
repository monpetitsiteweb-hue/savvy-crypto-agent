
import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Plus, Settings, Trash2, CheckCircle, XCircle } from 'lucide-react';

interface APIConnection {
  id: string;
  service_name: string;
  connection_name: string;
  is_active: boolean;
  created_at: string;
}

export const APIConnectionsPanel = () => {
  const [connections, setConnections] = useState<APIConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [serviceName, setServiceName] = useState('');
  const [connectionName, setConnectionName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const { toast } = useToast();
  const { user } = useAuth();

  const serviceOptions = [
    { value: 'openai', label: 'OpenAI API', description: 'For ChatGPT integration' },
    { value: 'twitter', label: 'Twitter/X API', description: 'For social media monitoring' },
    { value: 'telegram', label: 'Telegram Bot', description: 'For alerts and notifications' },
    { value: 'rss', label: 'RSS Feeds', description: 'For news monitoring' },
    { value: 'webhook', label: 'Custom Webhook', description: 'For custom integrations' },
  ];

  useEffect(() => {
    if (user) {
      fetchConnections();
    }
  }, [user]);

  const fetchConnections = async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase
        .from('api_connections')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setConnections(data || []);
    } catch (error) {
      console.error('Error fetching connections:', error);
      toast({
        title: "Error",
        description: "Failed to load API connections",
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
        description: "Please log in to save API connections",
        variant: "destructive",
      });
      return;
    }

    if (!serviceName || !connectionName || !apiKey) {
      toast({
        title: "Missing Information",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    try {
      const { error } = await supabase
        .from('api_connections')
        .insert({
          user_id: user.id,
          service_name: serviceName,
          connection_name: connectionName,
          api_key_encrypted: apiKey, // In production, this should be encrypted
          is_active: true,
        });

      if (error) throw error;

      toast({
        title: "Success",
        description: "API connection saved successfully",
      });

      setIsDialogOpen(false);
      setServiceName('');
      setConnectionName('');
      setApiKey('');
      fetchConnections();
    } catch (error) {
      console.error('Error saving connection:', error);
      toast({
        title: "Error",
        description: "Failed to save API connection",
        variant: "destructive",
      });
    }
  };

  const toggleConnection = async (id: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase
        .from('api_connections')
        .update({ is_active: !currentStatus })
        .eq('id', id);

      if (error) throw error;
      fetchConnections();
    } catch (error) {
      console.error('Error toggling connection:', error);
    }
  };

  const deleteConnection = async (id: string) => {
    try {
      const { error } = await supabase
        .from('api_connections')
        .delete()
        .eq('id', id);

      if (error) throw error;
      
      toast({
        title: "Success",
        description: "API connection deleted successfully",
      });
      
      fetchConnections();
    } catch (error) {
      console.error('Error deleting connection:', error);
      toast({
        title: "Error",
        description: "Failed to delete API connection",
        variant: "destructive",
      });
    }
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-slate-400">Please log in to manage API connections</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">API Connections</h2>
          <p className="text-slate-400">Manage your external service integrations</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-green-600 hover:bg-green-700">
              <Plus className="w-4 h-4 mr-2" />
              Add Connection
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-slate-800 border-slate-700">
            <DialogHeader>
              <DialogTitle className="text-white">Add API Connection</DialogTitle>
              <DialogDescription className="text-slate-400">
                Connect to external services for enhanced functionality
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-slate-300">Service</Label>
                <select
                  value={serviceName}
                  onChange={(e) => setServiceName(e.target.value)}
                  className="w-full p-2 bg-slate-700 border border-slate-600 rounded-md text-white"
                >
                  <option value="">Select a service</option>
                  {serviceOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300">Connection Name</Label>
                <Input
                  value={connectionName}
                  onChange={(e) => setConnectionName(e.target.value)}
                  placeholder="e.g., Main OpenAI Account"
                  className="bg-slate-700 border-slate-600 text-white"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300">API Key</Label>
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Enter your API key"
                  className="bg-slate-700 border-slate-600 text-white"
                />
              </div>
              <Button onClick={handleSaveConnection} className="w-full bg-green-600 hover:bg-green-700">
                Save Connection
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {connections.map((connection) => (
          <Card key={connection.id} className="bg-slate-800/50 border-slate-700">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg text-white capitalize">
                  {connection.service_name}
                </CardTitle>
                <Badge 
                  variant={connection.is_active ? "default" : "secondary"}
                  className={connection.is_active ? "bg-green-600" : "bg-slate-600"}
                >
                  {connection.is_active ? (
                    <CheckCircle className="w-3 h-3 mr-1" />
                  ) : (
                    <XCircle className="w-3 h-3 mr-1" />
                  )}
                  {connection.is_active ? 'Active' : 'Inactive'}
                </Badge>
              </div>
              <CardDescription className="text-slate-400">
                {connection.connection_name}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-xs text-slate-500">
                Created: {new Date(connection.created_at).toLocaleDateString()}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => toggleConnection(connection.id, connection.is_active)}
                  className="flex-1 border-slate-600 text-slate-300"
                >
                  <Settings className="w-3 h-3 mr-1" />
                  {connection.is_active ? 'Disable' : 'Enable'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => deleteConnection(connection.id)}
                  className="border-red-600 text-red-400 hover:bg-red-600 hover:text-white"
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {connections.length === 0 && !loading && (
        <Card className="bg-slate-800/30 border-slate-700 border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Settings className="w-12 h-12 text-slate-600 mb-4" />
            <h3 className="text-lg font-semibold text-slate-400 mb-2">No API Connections</h3>
            <p className="text-slate-500 text-center mb-4">
              Connect to external services to enhance your trading assistant capabilities
            </p>
            <Button onClick={() => setIsDialogOpen(true)} className="bg-green-600 hover:bg-green-700">
              <Plus className="w-4 h-4 mr-2" />
              Add Your First Connection
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
