import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Activity, CheckCircle, XCircle, RefreshCw } from "lucide-react";

interface WhaleAlertIntegrationProps {
  dataSources: any[];
  onSourcesUpdate: () => void;
}

export function WhaleAlertIntegration({ dataSources, onSourcesUpdate }: WhaleAlertIntegrationProps) {
  const [apiKey, setApiKey] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'active' | 'error'>('idle');
  const { toast } = useToast();

  // Check if Whale Alert is already configured
  const whaleAlertSource = dataSources.find(source => source.source_name === 'whale_alert_api');
  const isConfigured = !!whaleAlertSource;
  const isActive = whaleAlertSource?.is_active;

  const handleConnect = async () => {
    if (!apiKey.trim()) {
      toast({
        title: "Error",
        description: "Please enter your Whale Alert API key",
        variant: "destructive",
      });
      return;
    }

    setIsConnecting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('ai_data_sources')
        .insert({
          user_id: user.id,
          source_name: 'whale_alert_api',
          source_type: 'whale_signals',
          api_endpoint: 'wss://api.whale-alert.io/v1/streaming',
          update_frequency: 'realtime',
          configuration: {
            api_key: apiKey
          },
          is_active: true
        });

      if (error) throw error;

      toast({
        title: "Success",
        description: "Whale Alert integration added successfully",
      });

      setApiKey("");
      onSourcesUpdate();
      setConnectionStatus('active');
    } catch (error) {
      console.error('Error adding Whale Alert:', error);
      toast({
        title: "Error",
        description: "Failed to add Whale Alert integration",
        variant: "destructive",
      });
      setConnectionStatus('error');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleTest = async () => {
    if (!whaleAlertSource) {
      toast({
        title: "Error",
        description: "No Whale Alert source configured",
        variant: "destructive",
      });
      return;
    }

    setIsTesting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase.functions.invoke('external-data-collector', {
        body: { 
          action: 'sync_source', 
          sourceId: whaleAlertSource.id,
          userId: user.id
        }
      });

      if (error) throw error;

      toast({
        title: "✅ Connection Test Successful",
        description: "Live Feed Active - Whale Alert WebSocket is connected",
      });

      setConnectionStatus('active');
      onSourcesUpdate();
    } catch (error) {
      console.error('Error testing Whale Alert:', error);
      toast({
        title: "Connection Error",
        description: "Please check your API key",
        variant: "destructive",
      });
      setConnectionStatus('error');
    } finally {
      setIsTesting(false);
    }
  };

  const getStatusIcon = () => {
    switch (connectionStatus) {
      case 'active':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'error':
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <Activity className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusText = () => {
    if (isTesting) return "Testing connection...";
    
    switch (connectionStatus) {
      case 'active':
        return "Live Feed Active";
      case 'error':
        return "Connection Error – Please check your API key";
      default:
        return isActive ? "Configured" : "Not connected";
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5" />
          Whale Alert Integration
          <Badge variant={isActive ? "default" : "outline"}>
            {isActive ? "Active" : "Inactive"}
          </Badge>
        </CardTitle>
        <CardDescription>
          Enter your Whale Alert API Key to receive real-time whale transaction data via WebSocket.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isConfigured ? (
          <>
            <div className="space-y-2">
              <Label htmlFor="whale-alert-api-key">API Key</Label>
              <Input
                id="whale-alert-api-key"
                type="password"
                placeholder="Enter your Whale Alert API Key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>
            <Button 
              onClick={handleConnect}
              disabled={isConnecting || !apiKey.trim()}
              className="w-full"
            >
              {isConnecting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Connecting...
                </>
              ) : (
                "Connect Whale Alert"
              )}
            </Button>
          </>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex items-center gap-2">
                {getStatusIcon()}
                <span className="text-sm font-medium">{getStatusText()}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleTest}
                disabled={isTesting}
              >
                {isTesting ? (
                  <>
                    <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-primary mr-2"></div>
                    Testing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Sync Now
                  </>
                )}
              </Button>
            </div>
            
            {whaleAlertSource && (
              <div className="text-sm text-muted-foreground space-y-1">
                <p>• API Key: ***{whaleAlertSource.configuration.api_key?.slice(-4)}</p>
                <p>• WebSocket: Real-time whale transaction monitoring</p>
                <p>• AI Integration: Signals analyzed for strategy impact</p>
                {whaleAlertSource.last_sync && (
                  <p>• Last Test: {new Date(whaleAlertSource.last_sync).toLocaleString()}</p>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}