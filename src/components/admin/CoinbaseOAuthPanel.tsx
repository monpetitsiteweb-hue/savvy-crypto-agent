import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Trash2, Plus, Settings } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";

interface CoinbaseOAuthCredentials {
  id: string;
  app_name: string;
  is_active: boolean;
  is_sandbox: boolean;
  created_at: string;
  updated_at: string;
}

export const CoinbaseOAuthPanel = () => {
  const [credentials, setCredentials] = useState<CoinbaseOAuthCredentials[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingCredentials, setEditingCredentials] = useState<CoinbaseOAuthCredentials | null>(null);
  const [formData, setFormData] = useState({
    app_name: "",
    client_id: "",
    client_secret: "",
    is_sandbox: true,
  });
  const { toast } = useToast();
  const { user } = useAuth();

  useEffect(() => {
    if (user) {
      fetchCredentials();
    }
  }, [user]);

  const fetchCredentials = async () => {
    try {
      const { data, error } = await supabase
        .from("coinbase_oauth_credentials")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setCredentials(data || []);
    } catch (error: any) {
      console.error("Error fetching OAuth credentials:", error);
      toast({
        title: "Error",
        description: "Failed to fetch OAuth credentials",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAddCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.app_name || !formData.client_id || !formData.client_secret) {
      toast({
        title: "Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    try {
      const { error } = await supabase
        .from("coinbase_oauth_credentials")
        .insert({
          app_name: formData.app_name,
          client_id_encrypted: formData.client_id, // In production, this should be encrypted
          client_secret_encrypted: formData.client_secret, // In production, this should be encrypted
          is_sandbox: formData.is_sandbox,
        });

      if (error) throw error;

      toast({
        title: "Success",
        description: "OAuth credentials added successfully",
      });

      setFormData({
        app_name: "",
        client_id: "",
        client_secret: "",
        is_sandbox: true,
      });
      setIsAddDialogOpen(false);
      fetchCredentials();
    } catch (error: any) {
      console.error("Error adding OAuth credentials:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to add OAuth credentials",
        variant: "destructive",
      });
    }
  };

  const handleUpdateCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!editingCredentials || !formData.app_name || !formData.client_id || !formData.client_secret) {
      toast({
        title: "Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    try {
      const { error } = await supabase
        .from("coinbase_oauth_credentials")
        .update({
          app_name: formData.app_name,
          client_id_encrypted: formData.client_id, // In production, this should be encrypted
          client_secret_encrypted: formData.client_secret, // In production, this should be encrypted
          is_sandbox: formData.is_sandbox,
        })
        .eq("id", editingCredentials.id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "OAuth credentials updated successfully",
      });

      setIsEditDialogOpen(false);
      setEditingCredentials(null);
      fetchCredentials();
    } catch (error: any) {
      console.error("Error updating OAuth credentials:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to update OAuth credentials",
        variant: "destructive",
      });
    }
  };

  const handleDeleteCredentials = async (credentialsId: string) => {
    if (!confirm("Are you sure you want to delete these OAuth credentials?")) {
      return;
    }

    try {
      const { error } = await supabase
        .from("coinbase_oauth_credentials")
        .delete()
        .eq("id", credentialsId);

      if (error) throw error;

      toast({
        title: "Success",
        description: "OAuth credentials deleted successfully",
      });

      fetchCredentials();
    } catch (error: any) {
      console.error("Error deleting OAuth credentials:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to delete OAuth credentials",
        variant: "destructive",
      });
    }
  };

  const openEditDialog = (creds: CoinbaseOAuthCredentials) => {
    setEditingCredentials(creds);
    setFormData({
      app_name: creds.app_name,
      client_id: "",
      client_secret: "",
      is_sandbox: creds.is_sandbox,
    });
    setIsEditDialogOpen(true);
  };

  if (loading) {
    return <div>Loading OAuth credentials...</div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Coinbase OAuth Credentials (Admin)
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Add OAuth App
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Coinbase OAuth Credentials</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleAddCredentials} className="space-y-4">
                <div>
                  <Label htmlFor="app_name">App Name</Label>
                  <Input
                    id="app_name"
                    type="text"
                    value={formData.app_name}
                    onChange={(e) => setFormData({ ...formData, app_name: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="client_id">Client ID</Label>
                  <Input
                    id="client_id"
                    type="text"
                    value={formData.client_id}
                    onChange={(e) => setFormData({ ...formData, client_id: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="client_secret">Client Secret</Label>
                  <Input
                    id="client_secret"
                    type="password"
                    value={formData.client_secret}
                    onChange={(e) => setFormData({ ...formData, client_secret: e.target.value })}
                    required
                  />
                </div>
                <div className="flex items-center space-x-2">
                  <Switch
                    id="is_sandbox"
                    checked={formData.is_sandbox}
                    onCheckedChange={(checked) => setFormData({ ...formData, is_sandbox: checked })}
                  />
                  <Label htmlFor="is_sandbox">Sandbox Mode</Label>
                </div>
                <Button type="submit" className="w-full">
                  Add OAuth Credentials
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {credentials.length === 0 ? (
          <p className="text-muted-foreground">No OAuth credentials configured yet.</p>
        ) : (
          <div className="space-y-4">
            {credentials.map((creds) => (
              <div key={creds.id} className="flex items-center justify-between p-4 border rounded-lg">
                <div>
                  <h3 className="font-medium">{creds.app_name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {creds.is_sandbox ? "Sandbox" : "Production"} • 
                    Status: {creds.is_active ? "Active" : "Inactive"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Created: {new Date(creds.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openEditDialog(creds)}
                  >
                    <Settings className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDeleteCredentials(creds.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit OAuth Credentials</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleUpdateCredentials} className="space-y-4">
              <div>
                <Label htmlFor="edit_app_name">App Name</Label>
                <Input
                  id="edit_app_name"
                  type="text"
                  value={formData.app_name}
                  onChange={(e) => setFormData({ ...formData, app_name: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="edit_client_id">Client ID</Label>
                <Input
                  id="edit_client_id"
                  type="text"
                  value={formData.client_id}
                  onChange={(e) => setFormData({ ...formData, client_id: e.target.value })}
                  placeholder="Enter new Client ID"
                  required
                />
              </div>
              <div>
                <Label htmlFor="edit_client_secret">Client Secret</Label>
                <Input
                  id="edit_client_secret"
                  type="password"
                  value={formData.client_secret}
                  onChange={(e) => setFormData({ ...formData, client_secret: e.target.value })}
                  placeholder="Enter new Client Secret"
                  required
                />
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="edit_is_sandbox"
                  checked={formData.is_sandbox}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_sandbox: checked })}
                />
                <Label htmlFor="edit_is_sandbox">Sandbox Mode</Label>
              </div>
              <Button type="submit" className="w-full">
                Update OAuth Credentials
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
};