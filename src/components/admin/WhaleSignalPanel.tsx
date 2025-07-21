import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Activity, ExternalLink, RefreshCw, TrendingUp, AlertCircle, CheckCircle } from "lucide-react";

interface WhaleSignalEvent {
  id: string;
  source_id: string;
  user_id: string;
  event_type: string;
  transaction_hash?: string;
  amount?: number;
  from_address?: string;
  to_address?: string;
  token_symbol?: string;
  blockchain?: string;
  timestamp: string;
  raw_data?: any;
  processed: boolean;
  created_at: string;
}

interface DataSource {
  id: string;
  source_name: string;
  source_type: string;
  is_active: boolean;
  configuration: any;
  last_sync?: string;
}

export function WhaleSignalPanel() {
  const [whaleEvents, setWhaleEvents] = useState<WhaleSignalEvent[]>([]);
  const [dataSources, setDataSources] = useState<DataSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      // Load whale signal events
      const { data: events, error: eventsError } = await supabase
        .from('whale_signal_events')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(50);

      if (eventsError) throw eventsError;
      setWhaleEvents(events || []);

      // Load whale signal data sources
      const { data: sources, error: sourcesError } = await supabase
        .from('ai_data_sources')
        .select('*')
        .in('source_type', ['whale_signals', 'blockchain_analytics'])
        .order('created_at', { ascending: false });

      if (sourcesError) throw sourcesError;
      setDataSources(sources || []);
    } catch (error) {
      console.error('Error loading whale signal data:', error);
      toast({
        title: "Error",
        description: "Failed to load whale signal data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const refreshSignals = async () => {
    setRefreshing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Trigger external data collection for whale signals
      const { error } = await supabase.functions.invoke('external-data-collector', {
        body: { 
          action: 'collect_whale_signals', 
          userId: user.id,
          sources: dataSources.filter(s => s.is_active).map(s => s.id)
        }
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: "Whale signals refreshed successfully",
      });

      // Reload data after refresh
      await loadData();
    } catch (error) {
      console.error('Error refreshing whale signals:', error);
      toast({
        title: "Error",
        description: "Failed to refresh whale signals",
        variant: "destructive",
      });
    } finally {
      setRefreshing(false);
    }
  };

  const formatAmount = (amount?: number) => {
    if (!amount) return 'N/A';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(amount);
  };

  const getEventTypeColor = (eventType: string) => {
    switch (eventType) {
      case 'webhook': return 'bg-purple-100 text-purple-800';
      case 'api_poll': return 'bg-blue-100 text-blue-800';
      case 'manual_trigger': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getSourceStatusIcon = (source: DataSource) => {
    if (!source.is_active) return <AlertCircle className="h-4 w-4 text-red-500" />;
    if (source.configuration && Object.keys(source.configuration).length > 0) {
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    }
    return <AlertCircle className="h-4 w-4 text-orange-500" />;
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Whale Signal Tracking
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Stats */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Whale Signal Tracking</h2>
          <p className="text-muted-foreground">Monitor large transactions and whale movements in real-time</p>
        </div>
        <Button onClick={refreshSignals} disabled={refreshing}>
          {refreshing ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary mr-2"></div>
              Refreshing...
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh Signals
            </>
          )}
        </Button>
      </div>

      {/* Status Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-blue-500" />
            <div>
              <div className="text-2xl font-bold text-blue-600">{whaleEvents.length}</div>
              <div className="text-sm text-muted-foreground">Total Signals</div>
            </div>
          </div>
        </Card>
        
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-500" />
            <div>
              <div className="text-2xl font-bold text-green-600">
                {dataSources.filter(s => s.is_active).length}
              </div>
              <div className="text-sm text-muted-foreground">Active Sources</div>
            </div>
          </div>
        </Card>
        
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-purple-500" />
            <div>
              <div className="text-2xl font-bold text-purple-600">
                {whaleEvents.filter(e => e.processed).length}
              </div>
              <div className="text-sm text-muted-foreground">Processed</div>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-orange-500" />
            <div>
              <div className="text-2xl font-bold text-orange-600">
                {whaleEvents.filter(e => e.amount && e.amount > 1000000).length}
              </div>
              <div className="text-sm text-muted-foreground">Large Alerts (&gt;$1M)</div>
            </div>
          </div>
        </Card>
      </div>

      <Tabs defaultValue="events" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="events">Recent Events</TabsTrigger>
          <TabsTrigger value="sources">Signal Sources</TabsTrigger>
        </TabsList>
        
        <TabsContent value="events" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Recent Whale Signal Events</CardTitle>
            </CardHeader>
            <CardContent>
              {whaleEvents.length > 0 ? (
                <div className="space-y-4">
                  {whaleEvents.map((event) => (
                    <div key={event.id} className="p-4 border rounded-lg">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Badge className={getEventTypeColor(event.event_type)}>
                            {event.event_type}
                          </Badge>
                          {event.token_symbol && (
                            <Badge variant="outline">{event.token_symbol}</Badge>
                          )}
                          {event.blockchain && (
                            <Badge variant="outline">{event.blockchain}</Badge>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {new Date(event.timestamp).toLocaleString()}
                        </div>
                      </div>
                      
                      <div className="space-y-1">
                        {event.amount && (
                          <div className="text-lg font-semibold text-green-600">
                            Amount: {formatAmount(event.amount)}
                          </div>
                        )}
                        {event.from_address && (
                          <div className="text-sm text-muted-foreground">
                            From: {event.from_address.slice(0, 10)}...{event.from_address.slice(-8)}
                          </div>
                        )}
                        {event.to_address && (
                          <div className="text-sm text-muted-foreground">
                            To: {event.to_address.slice(0, 10)}...{event.to_address.slice(-8)}
                          </div>
                        )}
                        {event.transaction_hash && (
                          <div className="text-sm text-muted-foreground">
                            Tx: {event.transaction_hash.slice(0, 10)}...{event.transaction_hash.slice(-8)}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Activity className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">No whale signals detected yet</p>
                  <p className="text-sm text-muted-foreground">
                    Configure data sources to start receiving whale alerts
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="sources" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Whale Signal Data Sources</CardTitle>
            </CardHeader>
            <CardContent>
              {dataSources.length > 0 ? (
                <div className="space-y-4">
                  {dataSources.map((source) => (
                    <div key={source.id} className="p-4 border rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {getSourceStatusIcon(source)}
                          <h3 className="font-semibold">{source.source_name}</h3>
                          <Badge variant="outline">{source.source_type}</Badge>
                          {source.is_active ? (
                            <Badge className="bg-green-100 text-green-800">Active</Badge>
                          ) : (
                            <Badge className="bg-red-100 text-red-800">Inactive</Badge>
                          )}
                        </div>
                      </div>
                      
                      {source.configuration && Object.keys(source.configuration).length > 0 && (
                        <div className="text-sm text-muted-foreground space-y-1">
                          {source.configuration.threshold_amount && (
                            <div>Threshold: {formatAmount(source.configuration.threshold_amount)}</div>
                          )}
                          {source.configuration.blockchain_networks && (
                            <div>Networks: {Array.isArray(source.configuration.blockchain_networks) 
                              ? source.configuration.blockchain_networks.join(', ') 
                              : source.configuration.blockchain_networks}</div>
                          )}
                          {source.configuration.webhook_url && (
                            <div>Webhook: Configured ✅</div>
                          )}
                        </div>
                      )}
                      
                      {source.last_sync && (
                        <div className="text-xs text-muted-foreground mt-2">
                          Last sync: {new Date(source.last_sync).toLocaleString()}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">No whale signal sources configured</p>
                  <Button 
                    variant="outline" 
                    className="mt-4"
                    onClick={() => window.location.hash = '#data-sources'}
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Configure Data Sources
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}