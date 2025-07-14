import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Trash2, Globe, Rss, TrendingUp, Users, BarChart3, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface DataSource {
  id: string;
  name: string;
  type: 'rss' | 'api' | 'social' | 'market';
  url: string;
  enabled: boolean;
  lastSync?: string;
  status: 'active' | 'error' | 'disabled';
}

export const DataSourcesPanel = () => {
  const { toast } = useToast();
  const [sources, setSources] = useState<DataSource[]>([
    {
      id: '1',
      name: 'CoinDesk RSS',
      type: 'rss',
      url: 'https://feeds.coindesk.com/rss',
      enabled: true,
      lastSync: '2024-01-15T10:30:00Z',
      status: 'active'
    },
    {
      id: '2',
      name: 'Federal Reserve Economic Data',
      type: 'api',
      url: 'https://api.stlouisfed.org/fred/',
      enabled: true,
      lastSync: '2024-01-15T09:15:00Z',
      status: 'active'
    },
    {
      id: '3',
      name: 'X (Twitter) Crypto Sentiment',
      type: 'social',
      url: 'https://api.twitter.com/2/',
      enabled: false,
      status: 'disabled'
    }
  ]);

  const [newSource, setNewSource] = useState({
    name: '',
    type: 'rss' as const,
    url: ''
  });

  const addSource = () => {
    if (!newSource.name || !newSource.url) {
      toast({
        title: "Missing Information",
        description: "Please fill in all fields",
        variant: "destructive"
      });
      return;
    }

    const source: DataSource = {
      id: Date.now().toString(),
      ...newSource,
      enabled: true,
      status: 'active'
    };

    setSources(prev => [...prev, source]);
    setNewSource({ name: '', type: 'rss', url: '' });
    
    toast({
      title: "Data Source Added",
      description: `${newSource.name} has been configured successfully`,
    });
  };

  const removeSource = (id: string) => {
    setSources(prev => prev.filter(s => s.id !== id));
    toast({
      title: "Data Source Removed",
      description: "The data source has been deleted",
    });
  };

  const toggleSource = (id: string) => {
    setSources(prev => prev.map(source => 
      source.id === id 
        ? { ...source, enabled: !source.enabled, status: !source.enabled ? 'active' : 'disabled' }
        : source
    ));
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'rss': return <Rss className="w-4 h-4" />;
      case 'api': return <BarChart3 className="w-4 h-4" />;
      case 'social': return <Users className="w-4 h-4" />;
      case 'market': return <TrendingUp className="w-4 h-4" />;
      default: return <Globe className="w-4 h-4" />;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'rss': return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
      case 'api': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'social': return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
      case 'market': return 'bg-green-500/20 text-green-400 border-green-500/30';
      default: return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-500/20 text-green-400';
      case 'error': return 'bg-red-500/20 text-red-400';
      case 'disabled': return 'bg-slate-500/20 text-slate-400';
      default: return 'bg-slate-500/20 text-slate-400';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Data Sources</h2>
          <p className="text-slate-400">Configure external data feeds for the AI trading agent</p>
        </div>
      </div>

      <Tabs defaultValue="sources" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 bg-slate-800">
          <TabsTrigger value="sources">Data Sources</TabsTrigger>
          <TabsTrigger value="add">Add New Source</TabsTrigger>
        </TabsList>

        <TabsContent value="sources" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sources.map((source) => (
              <Card key={source.id} className="p-4 bg-slate-700/30 border-slate-600">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    {getTypeIcon(source.type)}
                    <h3 className="font-medium text-white truncate">{source.name}</h3>
                  </div>
                  <Switch
                    checked={source.enabled}
                    onCheckedChange={() => toggleSource(source.id)}
                  />
                </div>

                <div className="space-y-2 mb-4">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={getTypeColor(source.type)}>
                      {source.type.toUpperCase()}
                    </Badge>
                    <Badge variant="outline" className={getStatusColor(source.status)}>
                      {source.status}
                    </Badge>
                  </div>
                  
                  <p className="text-xs text-slate-400 truncate">{source.url}</p>
                  
                  {source.lastSync && (
                    <p className="text-xs text-slate-500">
                      Last sync: {new Date(source.lastSync).toLocaleString()}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 border-slate-600 text-slate-300"
                    onClick={() => {
                      toast({
                        title: "Sync Started",
                        description: `Synchronizing ${source.name}...`,
                      });
                    }}
                  >
                    Sync Now
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => removeSource(source.id)}
                    className="border-red-600 text-red-400 hover:bg-red-500/10"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>

          {sources.length === 0 && (
            <div className="text-center py-12">
              <Globe className="w-12 h-12 text-slate-600 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-white mb-2">No Data Sources</h3>
              <p className="text-slate-400">Add your first data source to get started</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="add" className="space-y-4">
          <Card className="p-6 bg-slate-700/30 border-slate-600">
            <h3 className="text-lg font-semibold text-white mb-4">Add New Data Source</h3>
            
            <div className="space-y-4">
              <div>
                <Label className="text-slate-300">Name</Label>
                <Input
                  value={newSource.name}
                  onChange={(e) => setNewSource(prev => ({ ...prev, name: e.target.value }))}
                  className="bg-slate-800 border-slate-600 text-white"
                  placeholder="e.g., CoinTelegraph RSS Feed"
                />
              </div>

              <div>
                <Label className="text-slate-300">Type</Label>
                <select
                  value={newSource.type}
                  onChange={(e) => setNewSource(prev => ({ ...prev, type: e.target.value as any }))}
                  className="w-full p-2 bg-slate-800 border border-slate-600 rounded-md text-white"
                >
                  <option value="rss">RSS Feed</option>
                  <option value="api">API Endpoint</option>
                  <option value="social">Social Media</option>
                  <option value="market">Market Data</option>
                </select>
              </div>

              <div>
                <Label className="text-slate-300">URL</Label>
                <Input
                  value={newSource.url}
                  onChange={(e) => setNewSource(prev => ({ ...prev, url: e.target.value }))}
                  className="bg-slate-800 border-slate-600 text-white"
                  placeholder="https://example.com/feed.xml"
                />
              </div>

              <Button onClick={addSource} className="w-full bg-green-500 hover:bg-green-600">
                <Plus className="w-4 h-4 mr-2" />
                Add Data Source
              </Button>
            </div>
          </Card>

          <Card className="p-4 bg-blue-500/10 border border-blue-500/20">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-blue-400 mt-0.5" />
              <div>
                <h4 className="font-medium text-blue-300 mb-1">Supported Data Sources</h4>
                <ul className="text-sm text-blue-200 space-y-1">
                  <li><strong>RSS Feeds:</strong> News sites, government publications, financial reports</li>
                  <li><strong>API Endpoints:</strong> Real-time market data, economic indicators</li>
                  <li><strong>Social Media:</strong> X (Twitter), Reddit sentiment analysis</li>
                  <li><strong>Market Data:</strong> Whale movements, institutional flows</li>
                </ul>
              </div>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};