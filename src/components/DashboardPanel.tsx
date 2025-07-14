import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { CoinbaseConnectionSelector } from './CoinbaseConnectionSelector';

export const DashboardPanel = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showConnectionSelector, setShowConnectionSelector] = useState(false);

  useEffect(() => {
    if (user) {
      fetchConnections();
    }
  }, [user]);

  const fetchConnections = async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase
        .from('user_coinbase_connections')
        .select('id, is_active, connected_at, user_id')
        .eq('user_id', user.id)
        .eq('is_active', true);

      if (error) throw error;
      setConnections(data || []);
    } catch (error) {
      console.error('Error fetching connections:', error);
      toast({
        title: "Error",
        description: "Failed to load connections",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const testFunction = async () => {
    try {
      const session = await supabase.auth.getSession();
      const response = await fetch('https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/coinbase-portfolio', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.data.session?.access_token}`,
          'Content-Type': 'application/json',
        },
      });
      
      const data = await response.json();
      console.log('Edge function response:', data);
      
      if (data.error) {
        toast({
          title: "Function Error",
          description: data.error,
          variant: "destructive",
        });
      } else {
        // Show the full debug data
        console.log('Full response data:', data);
        
        let displayMessage = data.message || 'Function responded successfully';
        
        // If there's debug data, add it to the message
        if (data.debug) {
          displayMessage += `\n\nDebug Info:\n`;
          displayMessage += `API Key: ${data.debug.apiKey}\n`;
          displayMessage += `Private Key (first 30 chars): ${data.debug.privateKeyStart}\n`;
          displayMessage += `Key Length: ${data.debug.privateKeyLength}`;
        }
        
        toast({
          title: "Function Test Success",
          description: displayMessage,
        });
      }
    } catch (error) {
      console.error('Function test error:', error);
      toast({
        title: "Function Test Failed",
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-slate-400">Loading...</div>
      </div>
    );
  }

  if (connections.length === 0 || showConnectionSelector) {
    return (
      <CoinbaseConnectionSelector 
        onConnectionEstablished={() => {
          fetchConnections();
          setShowConnectionSelector(false);
        }} 
      />
    );
  }

  return (
    <div className="space-y-6">
      <Card className="p-6 bg-slate-700/30 border-slate-600">
        <h3 className="text-lg font-semibold text-white mb-4">Simple Dashboard</h3>
        <p className="text-slate-400 mb-4">
          Found {connections.length} connection(s)
        </p>
        <Button onClick={testFunction} className="mr-4">
          Test Edge Function
        </Button>
        <Button onClick={() => setShowConnectionSelector(true)} variant="outline">
          Add Connection
        </Button>
      </Card>
    </div>
  );
};