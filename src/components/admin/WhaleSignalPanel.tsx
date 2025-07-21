import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Activity, ExternalLink, RefreshCw, TrendingUp, AlertCircle, CheckCircle, Settings, Trash2, Edit, Clock } from "lucide-react";

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
  api_endpoint?: string;
  is_active: boolean;
  update_frequency: string;
  configuration: any;
  last_sync?: string;
  last_webhook_received?: string;
  webhook_success?: boolean;
}

export function WhaleSignalPanel() {
  const [whaleEvents, setWhaleEvents] = useState<WhaleSignalEvent[]>([]);
  const [dataSources, setDataSources] = useState<DataSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncingSource, setSyncingSource] = useState<string | null>(null);
  const [editingSource, setEditingSource] = useState<DataSource | null>(null);
  const [editFormData, setEditFormData] = useState<any>({});
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

      // Trigger external data collection for all active whale signal sources
      const { error } = await supabase.functions.invoke('external-data-collector', {
        body: { 
          action: 'sync_all_sources', 
          userId: user.id
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

  const syncSingleSource = async (sourceId: string, sourceName: string) => {
    setSyncingSource(sourceId);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // For webhook sources, listen for incoming payload
      if (dataSources.find(s => s.id === sourceId)?.configuration?.webhook_url) {
        // Update source to mark webhook listening started
        await supabase
          .from('ai_data_sources')
          .update({ 
            last_sync: new Date().toISOString(),
            configuration: { 
              ...dataSources.find(s => s.id === sourceId)?.configuration,
              last_test_initiated: new Date().toISOString()
            }
          })
          .eq('id', sourceId);

        // Set up real-time subscription to listen for webhook events
        const subscription = supabase
          .channel('webhook-events')
          .on('postgres_changes', 
            { event: 'INSERT', schema: 'public', table: 'whale_signal_events', filter: `source_id=eq.${sourceId}` },
            async (payload) => {
              console.log('Webhook event received:', payload);
              
              // Update source with success timestamp
              await supabase
                .from('ai_data_sources')
                .update({ 
                  last_webhook_received: new Date().toISOString(),
                  webhook_success: true,
                  configuration: {
                    ...dataSources.find(s => s.id === sourceId)?.configuration,
                    last_event_preview: payload.new
                  }
                })
                .eq('id', sourceId);

              toast({
                title: "✅ Webhook Received",
                description: `Successfully received test payload from ${sourceName}`,
              });

              // Reload data to show updated status
              await loadData();
              setSyncingSource(null);
              subscription.unsubscribe();
            }
          )
          .subscribe();

        // Set a timeout to stop listening after 30 seconds
        setTimeout(() => {
          if (syncingSource === sourceId) {
            subscription.unsubscribe();
            setSyncingSource(null);
            toast({
              title: "Timeout",
              description: "No webhook payload received within 30 seconds",
              variant: "destructive",
            });
          }
        }, 30000);

        toast({
          title: "Listening for Webhook",
          description: `Waiting for test payload from ${sourceName} (30s timeout)...`,
        });
      } else {
        // Regular API sync
        const { error } = await supabase.functions.invoke('external-data-collector', {
          body: { 
            action: 'sync_source', 
            sourceId: sourceId 
          }
        });

        if (error) throw error;

        toast({
          title: "Synchronized",
          description: `${sourceName} synced successfully`,
        });

        // Reload data after sync
        await loadData();
        setSyncingSource(null);
      }
    } catch (error) {
      console.error('Error syncing source:', error);
      toast({
        title: "Error",
        description: `Failed to sync ${sourceName}`,
        variant: "destructive",
      });
      setSyncingSource(null);
    }
  };

  const openEditDialog = (source: DataSource) => {
    setEditingSource(source);
    setEditFormData({ ...source.configuration });
  };

  const updateDataSource = async () => {
    if (!editingSource) return;

    try {
      const { error } = await supabase
        .from('ai_data_sources')
        .update({
          configuration: editFormData,
          is_active: editFormData.is_active ?? editingSource.is_active,
          update_frequency: editFormData.update_frequency ?? editingSource.update_frequency,
        })
        .eq('id', editingSource.id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Data source updated successfully",
      });

      setEditingSource(null);
      setEditFormData({});
      await loadData();
    } catch (error) {
      console.error('Error updating source:', error);
      toast({
        title: "Error",
        description: "Failed to update data source",
        variant: "destructive",
      });
    }
  };

  const deleteDataSource = async (sourceId: string, sourceName: string) => {
    try {
      const { error } = await supabase
        .from('ai_data_sources')
        .delete()
        .eq('id', sourceId);

      if (error) throw error;

      toast({
        title: "Success",
        description: `${sourceName} deleted successfully`,
      });

      // Reload data after deletion
      await loadData();
    } catch (error) {
      console.error('Error deleting source:', error);
      toast({
        title: "Error",
        description: `Failed to delete ${sourceName}`,
        variant: "destructive",
      });
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
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => syncSingleSource(source.id, source.source_name)}
                            disabled={syncingSource === source.id}
                          >
                            {syncingSource === source.id ? (
                              <>
                                <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-primary mr-2"></div>
                                Syncing...
                              </>
                            ) : (
                              <>
                                <RefreshCw className="h-3 w-3 mr-1" />
                                Sync Now
                              </>
                            )}
                          </Button>
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openEditDialog(source)}
                              >
                                <Edit className="h-3 w-3" />
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-2xl">
                              <DialogHeader>
                                <DialogTitle>Edit Data Source: {editingSource?.source_name}</DialogTitle>
                              </DialogHeader>
                              {editingSource && (
                                <div className="space-y-4">
                                  <div className="grid grid-cols-2 gap-4">
                                    <div>
                                      <Label htmlFor="is_active">Active</Label>
                                      <Switch
                                        id="is_active"
                                        checked={editFormData.is_active ?? editingSource.is_active}
                                        onCheckedChange={(checked) => 
                                          setEditFormData({ ...editFormData, is_active: checked })
                                        }
                                      />
                                    </div>
                                    <div>
                                      <Label htmlFor="update_frequency">Update Frequency</Label>
                                      <Select
                                        value={editFormData.update_frequency ?? editingSource.update_frequency}
                                        onValueChange={(value) => 
                                          setEditFormData({ ...editFormData, update_frequency: value })
                                        }
                                      >
                                        <SelectTrigger>
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="realtime">Real-time</SelectItem>
                                          <SelectItem value="hourly">Hourly</SelectItem>
                                          <SelectItem value="daily">Daily</SelectItem>
                                          <SelectItem value="weekly">Weekly</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </div>
                                  </div>

                                  {/* Dynamic form fields based on source configuration */}
                                  <div className="space-y-3">
                                    {Object.entries(editingSource.configuration || {}).map(([key, value]) => (
                                      <div key={key}>
                                        <Label htmlFor={key}>{key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</Label>
                                        <Input
                                          id={key}
                                          value={editFormData[key] ?? value}
                                          onChange={(e) => 
                                            setEditFormData({ ...editFormData, [key]: e.target.value })
                                          }
                                          placeholder={`Enter ${key.replace(/_/g, ' ')}`}
                                        />
                                      </div>
                                    ))}
                                  </div>

                                  <div className="flex justify-end gap-2">
                                    <Button
                                      variant="outline"
                                      onClick={() => {
                                        setEditingSource(null);
                                        setEditFormData({});
                                      }}
                                    >
                                      Cancel
                                    </Button>
                                    <Button onClick={updateDataSource}>
                                      Save Changes
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </DialogContent>
                          </Dialog>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => deleteDataSource(source.id, source.source_name)}
                            className="text-red-600 hover:text-red-700"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
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
                      
                      <div className="space-y-1 mt-2">
                        {source.last_sync && (
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Last sync: {new Date(source.last_sync).toLocaleString()}
                          </div>
                        )}
                        {source.last_webhook_received && (
                          <div className="text-xs text-green-600 flex items-center gap-1">
                            <CheckCircle className="h-3 w-3" />
                            Last webhook: {new Date(source.last_webhook_received).toLocaleString()}
                          </div>
                        )}
                        {source.configuration?.last_event_preview && (
                          <div className="text-xs text-muted-foreground">
                            Preview: {JSON.stringify(source.configuration.last_event_preview).slice(0, 100)}...
                          </div>
                        )}
                      </div>
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
                    onClick={() => {
                      const dataSources = document.querySelector('[data-tab="data-sources"]') as HTMLElement;
                      if (dataSources) {
                        dataSources.click();
                      } else {
                        // Fallback: navigate to admin page and trigger data sources tab
                        window.location.href = '/admin';
                        setTimeout(() => {
                          const tab = document.querySelector('[data-tab="data-sources"]') as HTMLElement;
                          if (tab) tab.click();
                        }, 100);
                      }
                    }}
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