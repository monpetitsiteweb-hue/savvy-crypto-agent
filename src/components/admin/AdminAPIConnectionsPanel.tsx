import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, Plus, Settings, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface AdminAPIConnection {
  id: string;
  service_name: string;
  connection_name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const AdminAPIConnectionsPanel = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [connections, setConnections] = useState<AdminAPIConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newConnection, setNewConnection] = useState({
    service_name: 'coinbase',
    connection_name: '',
    api_key: ''
  });

  useEffect(() => {
    fetchConnections();
  }, [user]);

  const fetchConnections = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('api_connections')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setConnections(data || []);
    } catch (error) {
      console.error('Error fetching connections:', error);
      toast({
        title: "Error",
        description: "Failed to fetch API connections",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAddConnection = async () => {
    if (!user || !newConnection.connection_name.trim() || !newConnection.api_key.trim()) {
      toast({
        title: "Error",
        description: "Please fill in all required fields",
        variant: "destructive"
      });
      return;
    }

    try {
      const { error } = await supabase
        .from('api_connections')
        .insert([{
          user_id: user.id,
          service_name: newConnection.service_name,
          connection_name: newConnection.connection_name,
          api_key_encrypted: newConnection.api_key, // In production, this should be encrypted
          is_active: true
        }]);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Admin API connection added successfully"
      });

      setNewConnection({
        service_name: 'coinbase',
        connection_name: '',
        api_key: ''
      });
      setIsAddDialogOpen(false);
      fetchConnections();
    } catch (error) {
      console.error('Error adding connection:', error);
      toast({
        title: "Error",
        description: "Failed to add API connection",
        variant: "destructive"
      });
    }
  };

  const handleDeleteConnection = async (connectionId: string) => {
    try {
      const { error } = await supabase
        .from('api_connections')
        .delete()
        .eq('id', connectionId)
        .eq('user_id', user?.id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Admin API connection deleted successfully"
      });

      fetchConnections();
    } catch (error) {
      console.error('Error deleting connection:', error);
      toast({
        title: "Error",
        description: "Failed to delete API connection",
        variant: "destructive"
      });
    }
  };

  if (loading) {
    return <div className="flex justify-center p-8">Loading admin API connections...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Admin API Connections</h2>
          <p className="text-muted-foreground mt-1">
            Manage API connections for admin functionality and system integrations
          </p>
        </div>
        
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button className="flex items-center gap-2">
              <Plus className="w-4 h-4" />
              Add Connection
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Admin API Connection</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="service_name">Service</Label>
                <select 
                  id="service_name"
                  value={newConnection.service_name}
                  onChange={(e) => setNewConnection({...newConnection, service_name: e.target.value})}
                  className="w-full mt-1 p-2 border rounded-md"
                >
                  <option value="coinbase">Coinbase</option>
                </select>
              </div>
              <div>
                <Label htmlFor="connection_name">Connection Name</Label>
                <Input
                  id="connection_name"
                  value={newConnection.connection_name}
                  onChange={(e) => setNewConnection({...newConnection, connection_name: e.target.value})}
                  placeholder="Admin Coinbase API"
                />
              </div>
              <div>
                <Label htmlFor="api_key">API Key</Label>
                <Input
                  id="api_key"
                  type="password"
                  value={newConnection.api_key}
                  onChange={(e) => setNewConnection({...newConnection, api_key: e.target.value})}
                  placeholder="Enter admin API key"
                />
              </div>
              <Button onClick={handleAddConnection} className="w-full">
                Add Connection
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          These are admin-level API connections used for system operations. 
          Regular users have their own separate API connections for personal trading.
        </AlertDescription>
      </Alert>

      {connections.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8">
            <p className="text-muted-foreground mb-4">No admin API connections configured</p>
            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">Add Your First Connection</Button>
              </DialogTrigger>
            </Dialog>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {connections.map((connection) => (
            <Card key={connection.id}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <div>
                  <CardTitle className="text-lg">{connection.connection_name}</CardTitle>
                  <CardDescription className="capitalize">
                    {connection.service_name} Admin API
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={connection.is_active ? "default" : "secondary"}>
                    {connection.is_active ? "Active" : "Inactive"}
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDeleteConnection(connection.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-sm text-muted-foreground">
                  Created: {new Date(connection.created_at).toLocaleDateString()}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};