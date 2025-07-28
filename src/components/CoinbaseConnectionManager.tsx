import React, { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle, AlertTriangle, Key, Link2, Calendar, Shield, Trash2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface CoinbaseConnection {
  id: string;
  api_name_encrypted?: string;
  coinbase_user_id?: string;
  connected_at: string;
  is_active: boolean;
  access_token_encrypted?: string;
  api_private_key_encrypted?: string;
  expires_at?: string;
}

export const CoinbaseConnectionManager = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [connections, setConnections] = useState<CoinbaseConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeConnectionId, setActiveConnectionId] = useState<string>('');
  const [updating, setUpdating] = useState(false);

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
      
      // Find the currently active connection
      const activeConnection = data?.find(conn => conn.is_active);
      if (activeConnection) {
        setActiveConnectionId(activeConnection.id);
      }
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

  const handleConnectionChange = async (connectionId: string) => {
    if (!user || updating) return;
    
    setUpdating(true);
    try {
      // First, deactivate all connections for this user
      const { error: deactivateError } = await supabase
        .from('user_coinbase_connections')
        .update({ is_active: false })
        .eq('user_id', user.id);

      if (deactivateError) throw deactivateError;

      // Then activate the selected connection
      const { error: activateError } = await supabase
        .from('user_coinbase_connections')
        .update({ is_active: true })
        .eq('id', connectionId)
        .eq('user_id', user.id);

      if (activateError) throw activateError;

      setActiveConnectionId(connectionId);
      
      // Refresh connections to get updated state
      await fetchConnections();

      // Get connection type for success message
      const selectedConnection = connections.find(c => c.id === connectionId);
      const connectionType = selectedConnection?.api_private_key_encrypted ? 'API Key' : 'OAuth';

      toast({
        title: "Connection Activated",
        description: `${connectionType} connection is now active for trading`,
      });
    } catch (error) {
      console.error('Error updating connection:', error);
      toast({
        title: "Error",
        description: "Failed to update connection",
        variant: "destructive"
      });
    } finally {
      setUpdating(false);
    }
  };

  const handleOAuthConnect = async (refreshConnectionId?: string) => {
    if (!user) {
      toast({
        title: "Authentication required",
        description: "You must be signed in to connect your Coinbase account",
        variant: "destructive"
      });
      return;
    }

    setUpdating(true);
    try {
      if (refreshConnectionId) {
        // Refresh specific existing connection
        const { data, error } = await supabase.functions.invoke('coinbase-oauth', {
          body: { refresh_existing: true, connection_id: refreshConnectionId }
        });

        if (error) throw error;

        if (data?.oauth_url) {
          window.location.href = data.oauth_url;
        }
      } else {
        // Create new OAuth connection
        const { data, error } = await supabase.functions.invoke('coinbase-oauth');

        if (error) throw error;

        if (data?.oauth_url) {
          window.location.href = data.oauth_url;
        }
      }
    } catch (error) {
      console.error('OAuth error:', error);
      toast({
        title: "Connection failed",
        description: "Failed to start OAuth flow",
        variant: "destructive"
      });
      setUpdating(false);
    }
  };

  const handleDeleteConnection = async (connectionId: string) => {
    if (!user || updating) return;
    
    const connectionToDelete = connections.find(c => c.id === connectionId);
    if (!connectionToDelete) return;

    if (!confirm('Are you sure you want to delete this connection? This action cannot be undone.')) {
      return;
    }
    
    setUpdating(true);
    try {
      const { error } = await supabase
        .from('user_coinbase_connections')
        .delete()
        .eq('id', connectionId)
        .eq('user_id', user.id);

      if (error) throw error;

      toast({
        title: "Connection Deleted",
        description: "Connection has been removed successfully",
      });
      
      // Refresh connections
      await fetchConnections();
    } catch (error) {
      console.error('Error deleting connection:', error);
      toast({
        title: "Error",
        description: "Failed to delete connection",
        variant: "destructive"
      });
    } finally {
      setUpdating(false);
    }
  };

  const getConnectionType = (connection: CoinbaseConnection) => {
    return connection.api_private_key_encrypted ? 'API Key' : 'OAuth';
  };

  const getConnectionStatus = (connection: CoinbaseConnection) => {
    if (!connection.is_active) {
      return { status: 'inactive', color: 'bg-gray-500', text: 'Inactive' };
    }

    // Check if OAuth connection is expired
    if (connection.access_token_encrypted && connection.expires_at) {
      const isExpired = new Date(connection.expires_at) <= new Date();
      if (isExpired) {
        return { status: 'expired', color: 'bg-red-500', text: 'Expired' };
      }
    }

    return { status: 'active', color: 'bg-green-500', text: 'Active' };
  };

  const formatConnectionDetails = (connection: CoinbaseConnection) => {
    const type = getConnectionType(connection);
    const connectedTime = formatDistanceToNow(new Date(connection.connected_at), { addSuffix: true });
    
    if (type === 'API Key') {
      return {
        title: `API Key Connection`,
        subtitle: `Connected ${connectedTime}`,
        icon: <Key className="w-4 h-4" />,
        details: connection.api_name_encrypted || 'API Key',
        keyType: connection.api_private_key_encrypted?.startsWith('ed25519:') ? 'Ed25519' : 'ECDSA'
      };
    } else {
      const expiresIn = connection.expires_at 
        ? formatDistanceToNow(new Date(connection.expires_at), { addSuffix: true })
        : 'No expiry info';
        
      return {
        title: `OAuth Connection`,
        subtitle: `Connected ${connectedTime}`,
        icon: <Link2 className="w-4 h-4" />,
        details: `Expires ${expiresIn}`,
        keyType: null
      };
    }
  };

  if (loading) {
    return (
      <Card className="bg-slate-800 border-slate-700">
        <CardContent className="p-6">
          <div className="flex items-center justify-center">
            <div className="text-slate-400">Loading connections...</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (connections.length === 0) {
    return (
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Coinbase Connections
          </CardTitle>
          <CardDescription>
            No Coinbase connections found. Please set up a connection first.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const activeConnections = connections.filter(c => c.is_active);
  const inactiveConnections = connections.filter(c => !c.is_active);

  return (
    <Card className="bg-slate-800 border-slate-700">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Shield className="w-5 h-5" />
          Manage Coinbase Connections
        </CardTitle>
        <CardDescription>
          Choose which Coinbase connection to use for trading. You have {connections.length} connection{connections.length !== 1 ? 's' : ''} available.
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-6">
        <div>
          <h4 className="text-white font-medium mb-3">Select Active Connection:</h4>
          <RadioGroup 
            value={activeConnectionId} 
            onValueChange={handleConnectionChange}
            disabled={updating}
            className="space-y-3"
          >
            {connections.map((connection) => {
              const details = formatConnectionDetails(connection);
              const status = getConnectionStatus(connection);
              const isExpired = status.status === 'expired';
              
              return (
                <div key={connection.id} className={`flex items-center space-x-4 p-4 border rounded-lg transition-colors ${
                  connection.is_active 
                    ? 'border-green-500/50 bg-green-500/5' 
                    : isExpired 
                    ? 'border-red-500/50 bg-red-500/5' 
                    : 'border-slate-600 hover:border-slate-500'
                }`}>
                  <RadioGroupItem 
                    value={connection.id} 
                    id={connection.id}
                    disabled={updating || isExpired}
                  />
                  
                  <div className="flex-1">
                    <Label 
                      htmlFor={connection.id} 
                      className="flex items-center justify-between cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <div className="text-slate-300">
                          {details.icon}
                        </div>
                        
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-white font-medium">{details.title}</span>
                            {details.keyType && (
                              <Badge variant="outline" className="text-xs border-slate-500 text-slate-300">
                                {details.keyType}
                              </Badge>
                            )}
                            <Badge 
                              className={`${status.color} text-white text-xs`}
                              variant="secondary"
                            >
                              {status.text}
                            </Badge>
                          </div>
                          <div className="text-sm text-slate-400 mt-1">
                            {details.subtitle}
                          </div>
                          <div className="text-xs text-slate-500 mt-1">
                            {details.details}
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        {connection.is_active && status.status === 'active' && (
                          <CheckCircle className="w-5 h-5 text-green-400" />
                        )}
                        {isExpired && (
                          <AlertTriangle className="w-5 h-5 text-red-400" />
                        )}
                      </div>
                    </Label>
                  </div>
                  
                  <div className="flex gap-2">
                    {/* Refresh OAuth button for expired OAuth connections */}
                    {isExpired && connection.access_token_encrypted && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleOAuthConnect(connection.id)}
                        disabled={updating}
                        className="text-blue-400 border-blue-400/50 hover:bg-blue-500/10"
                      >
                        <Link2 className="w-4 h-4 mr-1" />
                        Refresh
                      </Button>
                    )}
                    
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDeleteConnection(connection.id)}
                      disabled={updating}
                      className="text-red-400 border-red-400/50 hover:bg-red-500/10"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </RadioGroup>
        </div>
        
        {connections.length === 0 && (
          <div className="text-center py-8 border border-slate-600 rounded-lg">
            <AlertTriangle className="w-12 h-12 text-slate-500 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-slate-300 mb-2">No connections found</h3>
            <p className="text-slate-400 mb-4">
              Connect your Coinbase account to start trading
            </p>
            <Button 
              onClick={() => handleOAuthConnect()}
              disabled={updating}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {updating ? 'Connecting...' : 'Connect with OAuth'}
            </Button>
          </div>
        )}
        
        {connections.length > 0 && (
          <div className="pt-4 border-t border-slate-600">
            <h4 className="text-white font-medium mb-3">Add New Connection:</h4>
            <div className="flex gap-3">
              <Button 
                onClick={() => handleOAuthConnect()}
                disabled={updating}
                className="bg-blue-600 hover:bg-blue-700"
                size="sm"
              >
                <Link2 className="w-4 h-4 mr-2" />
                {updating ? 'Connecting...' : 'Add OAuth'}
              </Button>
            </div>
          </div>
        )}
        
        {updating && (
          <div className="text-center text-slate-400 py-2 flex items-center justify-center gap-2">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
            Updating connection...
          </div>
        )}
        
        <div className="space-y-3">
          {activeConnections.length > 1 && (
            <div className="text-xs text-amber-400 p-3 bg-amber-500/10 rounded border border-amber-500/30">
              <strong>Warning:</strong> You have {activeConnections.length} active connections. Only one should be active at a time for consistent trading behavior.
            </div>
          )}
          
          <div className="text-xs text-slate-500 p-3 bg-slate-700/50 rounded border border-slate-600">
            <strong>Connection Types:</strong>
            <ul className="mt-2 space-y-1">
              <li><strong>OAuth:</strong> Temporary tokens that expire and need renewal. More secure but require periodic reconnection.</li>
              <li><strong>API Key:</strong> Permanent credentials until revoked from Coinbase. Direct access to your account.</li>
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};