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
import { Plus, Edit, Trash2, Key } from 'lucide-react';

interface CoinbaseSandboxCredentials {
  id: string;
  api_key_encrypted: string | null;
  api_secret_encrypted: string | null;
  api_passphrase_encrypted: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const CoinbaseSandboxPanel = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [credentials, setCredentials] = useState<CoinbaseSandboxCredentials[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingCredentials, setEditingCredentials] = useState<CoinbaseSandboxCredentials | null>(null);
  const [formData, setFormData] = useState({
    api_key: '',
    api_secret: '',
    api_passphrase: '',
    is_active: true
  });

  useEffect(() => {
    if (user) {
      fetchCredentials();
    }
  }, [user]);

  const fetchCredentials = async () => {
    try {
      const { data, error } = await supabase
        .from('coinbase_sandbox_credentials')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setCredentials(data || []);
    } catch (error) {
      console.error('Error fetching sandbox credentials:', error);
      toast({
        title: "Error",
        description: "Failed to fetch sandbox credentials",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAddCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.api_key || !formData.api_secret || !formData.api_passphrase) {
      toast({
        title: "Error",
        description: "Please fill in all required fields (API Key, Secret, and Passphrase)",
        variant: "destructive",
      });
      return;
    }

    try {
      const { error } = await supabase
        .from('coinbase_sandbox_credentials')
        .insert([{
          api_key_encrypted: formData.api_key,
          api_secret_encrypted: formData.api_secret,
          api_passphrase_encrypted: formData.api_passphrase,
          is_active: formData.is_active
        }]);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Sandbox credentials added successfully",
      });

      setFormData({ api_key: '', api_secret: '', api_passphrase: '', is_active: true });
      setIsAddDialogOpen(false);
      fetchCredentials();
    } catch (error) {
      console.error('Error adding sandbox credentials:', error);
      toast({
        title: "Error",
        description: "Failed to add sandbox credentials",
        variant: "destructive",
      });
    }
  };

  const handleUpdateCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCredentials || !formData.api_key || !formData.api_secret || !formData.api_passphrase) {
      toast({
        title: "Error",
        description: "Please fill in all required fields (API Key, Secret, and Passphrase)",
        variant: "destructive",
      });
      return;
    }

    try {
      const { error } = await supabase
        .from('coinbase_sandbox_credentials')
        .update({
          api_key_encrypted: formData.api_key,
          api_secret_encrypted: formData.api_secret,
          api_passphrase_encrypted: formData.api_passphrase,
          is_active: formData.is_active
        })
        .eq('id', editingCredentials.id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Sandbox credentials updated successfully",
      });

      setFormData({ api_key: '', api_secret: '', api_passphrase: '', is_active: true });
      setIsEditDialogOpen(false);
      setEditingCredentials(null);
      fetchCredentials();
    } catch (error) {
      console.error('Error updating sandbox credentials:', error);
      toast({
        title: "Error",
        description: "Failed to update sandbox credentials",
        variant: "destructive",
      });
    }
  };

  const handleDeleteCredentials = async (credentialsId: string) => {
    if (!confirm('Are you sure you want to delete these sandbox credentials?')) return;

    try {
      const { error } = await supabase
        .from('coinbase_sandbox_credentials')
        .delete()
        .eq('id', credentialsId);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Sandbox credentials deleted successfully",
      });

      fetchCredentials();
    } catch (error) {
      console.error('Error deleting sandbox credentials:', error);
      toast({
        title: "Error",
        description: "Failed to delete sandbox credentials",
        variant: "destructive",
      });
    }
  };

  const openEditDialog = (creds: CoinbaseSandboxCredentials) => {
    setEditingCredentials(creds);
    setFormData({
      api_key: creds.api_key_encrypted || '',
      api_secret: creds.api_secret_encrypted || '',
      api_passphrase: creds.api_passphrase_encrypted || '',
      is_active: creds.is_active
    });
    setIsEditDialogOpen(true);
  };

  if (loading) {
    return <div>Loading sandbox credentials...</div>;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              Coinbase Sandbox API Credentials
            </CardTitle>
            <CardDescription>
              Manage Coinbase sandbox API credentials for test mode trading
            </CardDescription>
          </div>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Add Sandbox Credentials
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Coinbase Sandbox Credentials</DialogTitle>
                <DialogDescription>
                  Add your Coinbase sandbox API key and secret for test mode trading
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleAddCredentials} className="space-y-4">
                <div>
                  <Label htmlFor="api_key">API Key</Label>
                  <Input
                    id="api_key"
                    value={formData.api_key}
                    onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
                    placeholder="Enter sandbox API key"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="api_secret">API Secret</Label>
                  <Input
                    id="api_secret"
                    type="password"
                    value={formData.api_secret}
                    onChange={(e) => setFormData({ ...formData, api_secret: e.target.value })}
                    placeholder="Enter sandbox API secret"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="api_passphrase">API Passphrase</Label>
                  <Input
                    id="api_passphrase"
                    type="password"
                    value={formData.api_passphrase}
                    onChange={(e) => setFormData({ ...formData, api_passphrase: e.target.value })}
                    placeholder="Enter sandbox API passphrase"
                    required
                  />
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="is_active"
                    checked={formData.is_active}
                    onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                  />
                  <Label htmlFor="is_active">Active</Label>
                </div>
                <Button type="submit" className="w-full">Add Credentials</Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {credentials.length === 0 ? (
          <p className="text-muted-foreground">No sandbox credentials configured</p>
        ) : (
          <div className="space-y-4">
            {credentials.map((creds) => (
              <div key={creds.id} className="flex items-center justify-between p-4 border rounded-lg">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Sandbox API Key</span>
                    <Badge variant={creds.is_active ? "default" : "secondary"}>
                      {creds.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    API Key: {creds.api_key_encrypted ? `${creds.api_key_encrypted.substring(0, 10)}...` : 'Not set'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Created: {new Date(creds.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openEditDialog(creds)}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDeleteCredentials(creds.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Sandbox Credentials</DialogTitle>
            <DialogDescription>
              Update your Coinbase sandbox API credentials
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUpdateCredentials} className="space-y-4">
            <div>
              <Label htmlFor="edit_api_key">API Key</Label>
              <Input
                id="edit_api_key"
                value={formData.api_key}
                onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
                placeholder="Enter sandbox API key"
                required
              />
            </div>
            <div>
              <Label htmlFor="edit_api_secret">API Secret</Label>
              <Input
                id="edit_api_secret"
                type="password"
                value={formData.api_secret}
                onChange={(e) => setFormData({ ...formData, api_secret: e.target.value })}
                placeholder="Enter sandbox API secret"
                required
              />
            </div>
            <div>
              <Label htmlFor="edit_api_passphrase">API Passphrase</Label>
              <Input
                id="edit_api_passphrase"
                type="password"
                value={formData.api_passphrase}
                onChange={(e) => setFormData({ ...formData, api_passphrase: e.target.value })}
                placeholder="Enter sandbox API passphrase"
                required
              />
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="edit_is_active"
                checked={formData.is_active}
                onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
              />
              <Label htmlFor="edit_is_active">Active</Label>
            </div>
            <Button type="submit" className="w-full">Update Credentials</Button>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
};