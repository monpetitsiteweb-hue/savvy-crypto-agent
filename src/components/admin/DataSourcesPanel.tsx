import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Youtube, Twitter, Globe, FileText, MessageSquare, Plus, Edit, RefreshCw, Trash2, Circle } from "lucide-react";

interface DataSource {
  id: string;
  source_name: string;
  source_type: string;
  is_active: boolean;
  update_frequency: string;
  configuration: any;
  last_sync?: string;
  created_at: string;
}

interface SourceStatus {
  color: 'green' | 'yellow' | 'red';
  label: string;
}

type RefreshMode = 'static' | 'feed';

interface SourceTemplate {
  name: string;
  type: string;
  description: string;
  refresh_mode: RefreshMode;
  icon: any;
  fields: string[];
  default_frequency?: string;
}

// CANONICAL KNOWLEDGE BASE SOURCE NAMES (from backend)
const KNOWLEDGE_BASE_SOURCE_NAMES = [
  'bigquery',
  'youtube_channels',
  'custom_website',
  'document_upload',
  'website_page'
] as const;

// CANONICAL SIGNAL SOURCE NAMES (from backend)
// Note: 'eodhd' is canonical; 'eodhd_api' exists for backward compatibility
const SIGNAL_SOURCE_NAMES = [
  'coinbase_institutional',
  'eodhd',
  'eodhd_api', // Legacy - external-data-collector redirects to eodhd
  'cryptonews_api',
  'fear_greed_index',
  'whale_alert_api',
  'whale_alert',
  'quicknode_webhooks'
] as const;

// Knowledge Base templates (aligned with actual source_name values in backend)
const KNOWLEDGE_SOURCE_TEMPLATES: Record<string, SourceTemplate> = {
  youtube_channels: {
    name: "YouTube Channels",
    type: "knowledge_base",
    description: "📺 Monitor YouTube channels for recurring new video updates",
    refresh_mode: "feed",
    icon: Youtube,
    fields: ["channel_url", "youtube_api_key", "update_frequency", "tags"],
    default_frequency: "daily"
  },
  website_page: {
    name: "Website Page",
    type: "knowledge_base",
    description: "🌐 Single website page for static content extraction",
    refresh_mode: "static",
    icon: Globe,
    fields: ["url", "custom_name"],
    default_frequency: "manual"
  },
  document_upload: {
    name: "Document Upload",
    type: "knowledge_base",
    description: "📄 Upload documents (PDF, etc.) for knowledge extraction",
    refresh_mode: "static",
    icon: FileText,
    fields: ["title", "tags"],
    default_frequency: "manual"
  },
  bigquery: {
    name: "BigQuery",
    type: "knowledge_base",
    description: "🗄️ Query BigQuery datasets for structured data",
    refresh_mode: "feed",
    icon: Globe,
    fields: ["project_id", "dataset_id", "query", "update_frequency"],
    default_frequency: "daily"
  },
  custom_website: {
    name: "Custom Website",
    type: "knowledge_base",
    description: "🌐 Custom website scraping configuration",
    refresh_mode: "feed",
    icon: Globe,
    fields: ["url", "custom_name", "update_frequency", "filters"],
    default_frequency: "daily"
  }
};

// API source templates (aligned with external-data-collector)
const API_SOURCE_TEMPLATES = {
  eodhd: { name: "EODHD API", type: "api", description: "Stock & crypto intraday data", fields: ["api_key"], default_frequency: "5min" as const },
  whale_alert_api: { name: "Whale Alert API", type: "api", description: "Whale transactions via API", fields: ["api_key"], default_frequency: "30min" as const },
  cryptonews_api: { name: "Crypto News API", type: "api", description: "News & sentiment analysis", fields: ["api_key"], default_frequency: "15min" as const },
  fear_greed_index: { name: "Fear & Greed Index", type: "api", description: "Market sentiment index", fields: [] as string[], default_frequency: "1h" as const },
  coinbase_institutional: { name: "Coinbase Institutional", type: "api", description: "Institutional flow analysis", fields: [] as string[], default_frequency: "1h" as const }
};

// Webhook source templates (aligned with external-data-collector)
const WEBHOOK_SOURCE_TEMPLATES = {
  whale_alert: { name: "Whale Alert Webhook", type: "webhook", description: "Real-time tracked wallet events", fields: ["webhook_url"], default_frequency: "manual" as const },
  quicknode_webhooks: { name: "QuickNode Webhooks", type: "webhook", description: "On-chain event webhooks", fields: ["webhook_url"], default_frequency: "manual" as const }
};

// Hidden internal sources that should NEVER appear in the UI
const HIDDEN_INTERNAL_SOURCES = ['coinbase_realtime', 'technical_analysis'];

export function DataSourcesPanel() {
  const [dataSources, setDataSources] = useState<DataSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [formData, setFormData] = useState<any>({});
  const [syncingSource, setSyncingSource] = useState<string | null>(null);
  const [editingSource, setEditingSource] = useState<DataSource | null>(null);
  const [editFormData, setEditFormData] = useState<any>({});
  const { toast } = useToast();

  // Debug: Log on mount
  console.log('[DataSourcesPanel] Component mounted');

  useEffect(() => {
    console.log('[DataSourcesPanel] useEffect triggered - calling loadDataSources');
    loadDataSources();
  }, []);

  const loadDataSources = async () => {
    console.log('[DataSourcesPanel] loadDataSources() called');
    try {
      // Get current user for debugging
      const { data: { user } } = await supabase.auth.getUser();
      console.log('[DataSourcesPanel] Current user:', user?.id);

      const { data, error } = await supabase
        .from('ai_data_sources')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[DataSourcesPanel] Supabase error:', error);
        throw error;
      }

      // Raw rows from ai_data_sources (before any frontend filtering)
      console.log('[DataSourcesPanel] ai_data_sources rows (raw from Supabase):', data);
      console.log('[DataSourcesPanel] Row count:', data?.length);
      
      // Log each source_name for debugging
      console.log('[DataSourcesPanel] All source_names:', data?.map(s => s.source_name));
      
      // Filter out hidden internal sources only (do NOT filter on user_id)
      const filtered = (data || []).filter(
        (source) => !HIDDEN_INTERNAL_SOURCES.includes(source.source_name)
      );
      
      console.log('[DataSourcesPanel] After filtering hidden sources:', filtered.length, 'rows');
      console.log('[DataSourcesPanel] Filtered source_names:', filtered.map(s => s.source_name));
      
      // Debug: Check which sources match SIGNAL_SOURCE_NAMES
      const matchingSignals = filtered.filter(s => 
        SIGNAL_SOURCE_NAMES.includes(s.source_name as any)
      );
      console.log('[DataSourcesPanel] Sources matching SIGNAL_SOURCE_NAMES:', matchingSignals.map(s => ({
        source_name: s.source_name,
        source_type: s.source_type,
        user_id: (s as any).user_id,
        is_active: s.is_active,
      })));
      
      setDataSources(filtered);
      console.log('[DataSourcesPanel] setDataSources called with', filtered.length, 'sources');
    } catch (error) {
      console.error('[DataSourcesPanel] Error loading data sources:', error);
      toast({
        title: "Error",
        description: "Failed to load data sources",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      console.log('[DataSourcesPanel] Loading complete');
    }
  };

  const getSourceStatus = (source: DataSource): SourceStatus => {
    const config = source.configuration || {};
    const template = KNOWLEDGE_SOURCE_TEMPLATES[source.source_name];
    const refreshMode = template ? (config.refresh_mode as RefreshMode || template.refresh_mode) : null;
    
    // RED: Inactive
    if (!source.is_active) {
      return { color: 'red', label: 'Inactive' };
    }
    
    // For KB sources: check required fields
    if (template) {
      const requiredFields = template.fields.filter(
        f => !['title', 'tags', 'custom_name', 'filters'].includes(f)
      );
      const missingFields = requiredFields.filter(field => !config[field]);
      
      if (missingFields.length > 0) {
        return { color: 'red', label: 'Missing Config' };
      }
    }
    
    // YELLOW: Pending first sync
    if (!source.last_sync) {
      return { color: 'yellow', label: 'Pending Sync' };
    }
    
    // Check staleness for feeds or API/webhook sources with update_frequency
    if (source.last_sync && source.update_frequency) {
      const lastSync = new Date(source.last_sync).getTime();
      const now = Date.now();
      const frequencyMs = getFrequencyMs(source.update_frequency);
      const staleThreshold = frequencyMs * 3;
      
      if (now - lastSync > staleThreshold) {
        return { color: 'red', label: 'Sync Overdue' };
      }
    }
    
    // GREEN: All good
    return { color: 'green', label: 'Healthy' };
  };

  const getFrequencyMs = (frequency: string): number => {
    const map: Record<string, number> = {
      'manual': Infinity,
      'hourly': 60 * 60 * 1000,
      'daily': 24 * 60 * 60 * 1000,
      'weekly': 7 * 24 * 60 * 60 * 1000
    };
    return map[frequency] || map['daily'];
  };

  const addDataSource = async () => {
    if (!selectedTemplate) {
      toast({
        title: "Error",
        description: "Please select a source type",
        variant: "destructive",
      });
      return;
    }

    const kbTemplate = KNOWLEDGE_SOURCE_TEMPLATES[selectedTemplate];
    const apiTemplate = API_SOURCE_TEMPLATES[selectedTemplate as keyof typeof API_SOURCE_TEMPLATES];
    const webhookTemplate = WEBHOOK_SOURCE_TEMPLATES[selectedTemplate as keyof typeof WEBHOOK_SOURCE_TEMPLATES];
    const template = kbTemplate || apiTemplate || webhookTemplate;
    
    if (!template) {
      toast({
        title: "Error",
        description: "Invalid source template",
        variant: "destructive",
      });
      return;
    }
    
    const requiredFields = template.fields?.filter(
      f => !['title', 'tags', 'custom_name', 'filters'].includes(f)
    ) || [];
    
    const missingFields = requiredFields.filter(field => !formData[field]?.trim?.());
    
    if (missingFields.length > 0) {
      toast({
        title: "Error",
        description: `Missing required fields: ${missingFields.join(', ')}`,
        variant: "destructive",
      });
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const config = {
        ...formData,
        ...(kbTemplate && { refresh_mode: kbTemplate.refresh_mode })
      };

      const { data: newSource, error } = await supabase
        .from('ai_data_sources')
        .insert({
          user_id: user.id,
          source_name: selectedTemplate,
          source_type: template.type,
          update_frequency: formData.update_frequency || template.default_frequency || 'manual',
          configuration: config,
          is_active: true
        })
        .select()
        .single();

      if (error) throw error;

      toast({
        title: "Success",
        description: `${template.name} added successfully`,
      });

      // Trigger initial sync for new source (skip for webhooks)
      if (newSource && template.type !== 'webhook') {
        await syncDataSource(newSource);
      }

      setShowAddDialog(false);
      setSelectedTemplate('');
      setFormData({});
      loadDataSources();
    } catch (error) {
      console.error('Error adding data source:', error);
      toast({
        title: "Error",
        description: "Failed to add data source",
        variant: "destructive",
      });
    }
  };

  const syncDataSource = async (source: DataSource) => {
    const isWebhook = source.source_type === 'webhook' || source.source_name.includes('webhook');
    
    // Webhooks cannot be synced manually
    if (isWebhook) {
      toast({
        title: "Error",
        description: "Webhook sources receive data in real-time and cannot be manually synced",
        variant: "destructive",
      });
      return;
    }
    
    setSyncingSource(source.id);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const template = KNOWLEDGE_SOURCE_TEMPLATES[source.source_name];
      let error;

      if (template) {
        // Knowledge Base → knowledge-collector
        const { error: fnError } = await supabase.functions.invoke('knowledge-collector', {
          body: { sourceId: source.id }
        });
        error = fnError;
      } else {
        // API → external-data-collector
        const { error: fnError } = await supabase.functions.invoke('external-data-collector', {
          body: { action: 'sync_source', sourceId: source.id }
        });
        error = fnError;
      }

      if (error) throw error;

      toast({
        title: "✅ Synced",
        description: `${source.source_name} synced successfully`,
      });

      loadDataSources();
    } catch (error) {
      console.error('Error syncing source:', error);
      toast({
        title: "Error",
        description: `Failed to sync ${source.source_name}`,
        variant: "destructive",
      });
    } finally {
      setSyncingSource(null);
    }
  };

  const openEditDialog = (source: DataSource) => {
    setEditingSource(source);
    setEditFormData({
      ...source.configuration,
      is_active: source.is_active,
      update_frequency: source.update_frequency
    });
  };

  const updateDataSource = async () => {
    if (!editingSource) return;

    try {
      const { is_active, update_frequency, ...configuration } = editFormData;

      const { error } = await supabase
        .from('ai_data_sources')
        .update({
          configuration,
          is_active: is_active ?? editingSource.is_active,
          update_frequency: update_frequency ?? editingSource.update_frequency,
        })
        .eq('id', editingSource.id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Source updated successfully",
      });

      setEditingSource(null);
      setEditFormData({});
      loadDataSources();
    } catch (error) {
      console.error('Error updating source:', error);
      toast({
        title: "Error",
        description: "Failed to update source",
        variant: "destructive",
      });
    }
  };

  const deleteDataSource = async (id: string) => {
    if (!confirm('Are you sure you want to delete this data source?')) return;

    try {
      const { error } = await supabase
        .from('ai_data_sources')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Data source deleted",
      });

      loadDataSources();
    } catch (error) {
      console.error('Error deleting source:', error);
      toast({
        title: "Error",
        description: "Failed to delete source",
        variant: "destructive",
      });
    }
  };

  const renderSourceFields = (templateKey: string, isEdit: boolean = false) => {
    const kbTemplate = KNOWLEDGE_SOURCE_TEMPLATES[templateKey];
    const apiTemplate = API_SOURCE_TEMPLATES[templateKey as keyof typeof API_SOURCE_TEMPLATES];
    const webhookTemplate = WEBHOOK_SOURCE_TEMPLATES[templateKey as keyof typeof WEBHOOK_SOURCE_TEMPLATES];

    const template = kbTemplate || apiTemplate || webhookTemplate;
    if (!template) return null;

    const data = isEdit ? editFormData : formData;
    const setData = isEdit ? setEditFormData : setFormData;

    const isKB = !!kbTemplate;
    const isAPI = !!apiTemplate;
    const isWebhook = !!webhookTemplate;

    return (
      <div className="space-y-4">
        {/* Common fields for KB/API/Webhook based on template.fields */}
        {template.fields.map((field) => {
          // KB feed sources have a dedicated update_frequency selector
          if (isKB && field === "update_frequency" && kbTemplate?.refresh_mode === "feed") {
            return (
              <div key={field}>
                <Label>Update Frequency</Label>
                <Select
                  value={data[field] || kbTemplate.default_frequency}
                  onValueChange={(value) =>
                    setData((prev: any) => ({ ...prev, [field]: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hourly">Hourly</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            );
          }

          // API/Webhook + any other KB fields → simple text/password input
          return (
            <div key={field}>
              <Label htmlFor={field}>
                {field.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
                {!["title", "tags", "custom_name", "filters"].includes(field) && " *"}
              </Label>
              <Input
                id={field}
                type={
                  field.includes("key") || field.includes("secret") || field.includes("token")
                    ? "password"
                    : "text"
                }
                placeholder={`Enter ${field.replace(/_/g, " ")}`}
                value={data[field] || ""}
                onChange={(e) =>
                  setData((prev: any) => ({ ...prev, [field]: e.target.value }))
                }
              />
            </div>
          );
        })}

        {/* Generic update_frequency for API/Webhook if needed */}
        {(isAPI || isWebhook) && (
          <div>
            <Label>Update Frequency</Label>
            <Select
              value={data.update_frequency || template.default_frequency || "daily"}
              onValueChange={(value) =>
                setData((prev: any) => ({ ...prev, update_frequency: value }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="hourly">Hourly</SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Status toggle in edit mode */}
        {isEdit && (
          <div>
            <Label>Status</Label>
            <Select
              value={data.is_active ? "active" : "inactive"}
              onValueChange={(value) =>
                setData((prev: any) => ({ ...prev, is_active: value === "active" }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>External Data Sources</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Partition sources using canonical classification
  const knowledgeBaseSources = dataSources.filter(source =>
    KNOWLEDGE_BASE_SOURCE_NAMES.includes(source.source_name as any)
  );
  const signalSources = dataSources.filter(source =>
    SIGNAL_SOURCE_NAMES.includes(source.source_name as any)
  );

  // Debug: Log before render
  console.log('[DataSourcesPanel] RENDER - dataSources.length:', dataSources.length);
  console.log('[DataSourcesPanel] RENDER - signalSources:', signalSources.map(s => s.source_name));
  console.log('[DataSourcesPanel] RENDER - knowledgeBaseSources:', knowledgeBaseSources.map(s => s.source_name));
  console.log('[DataSourcesPanel] SIGNAL_SOURCE_NAMES constant:', SIGNAL_SOURCE_NAMES);

  const renderSourceCard = (source: DataSource) => {
    const config = source.configuration || {};
    const template = KNOWLEDGE_SOURCE_TEMPLATES[source.source_name];
    const apiTemplate = API_SOURCE_TEMPLATES[source.source_name as keyof typeof API_SOURCE_TEMPLATES];
    const webhookTemplate = WEBHOOK_SOURCE_TEMPLATES[source.source_name as keyof typeof WEBHOOK_SOURCE_TEMPLATES];
    const isKnowledge = !!template;
    const refreshMode = isKnowledge ? (config.refresh_mode || template.refresh_mode) : null;
    const status = getSourceStatus(source);
    const Icon = template?.icon || Globe;

    // Determine display title
    let displayTitle = template?.name || apiTemplate?.name || webhookTemplate?.name;
    if (!displayTitle && source.source_name === 'pdf_upload') {
      displayTitle = config.title || 'PDF Upload';
    }
    if (!displayTitle) {
      displayTitle = source.source_name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }

    // Determine type badge
    let typeBadge: string;
    if (isKnowledge && refreshMode === 'static') {
      typeBadge = 'Knowledge (static)';
    } else if (isKnowledge && refreshMode === 'feed') {
      typeBadge = 'Knowledge (feed)';
    } else if (source.source_type === 'webhook' || source.source_name.includes('webhook')) {
      typeBadge = 'Webhook';
    } else {
      typeBadge = 'API';
    }

    return (
      <Card key={source.id}>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <Icon className="h-5 w-5" />
              <CardTitle className="text-lg">
                {displayTitle}
              </CardTitle>
            </div>
            <Circle 
              className={`h-3 w-3 fill-current ${
                status.color === 'green' ? 'text-green-500' :
                status.color === 'yellow' ? 'text-yellow-500' :
                'text-red-500'
              }`}
            />
          </div>
          <CardDescription className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="text-xs">
                {typeBadge}
              </Badge>
              <Badge variant={status.color === 'green' ? 'default' : 'secondary'} className="text-xs">
                {status.label}
              </Badge>
            </div>
            {source.last_sync && (
              <div className="text-xs text-muted-foreground">
                Last sync: {new Date(source.last_sync).toLocaleString()}
              </div>
            )}
            {source.update_frequency && (
              <div className="text-xs text-muted-foreground">
                Updates: {source.update_frequency}
              </div>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => syncDataSource(source)}
              disabled={syncingSource === source.id || source.source_type === 'webhook' || source.source_name.includes('webhook')}
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${syncingSource === source.id ? 'animate-spin' : ''}`} />
              Sync Now
            </Button>
            <Dialog>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openEditDialog(source)}
                >
                  <Edit className="h-4 w-4 mr-1" />
                  Edit
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Edit {displayTitle}</DialogTitle>
                </DialogHeader>
                {editingSource?.id === source.id && (
                  <>
                    {renderSourceFields(source.source_name, true)}
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setEditingSource(null)}>
                        Cancel
                      </Button>
                      <Button onClick={updateDataSource}>
                        Save Changes
                      </Button>
                    </DialogFooter>
                  </>
                )}
              </DialogContent>
            </Dialog>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => deleteDataSource(source.id)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">External Data Sources</h2>
          <p className="text-muted-foreground">Manage signals and knowledge sources</p>
        </div>
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Source
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add Data Source</DialogTitle>
            </DialogHeader>
            <div className="space-y-6">
              {/* Signals Section */}
              <div>
                <h3 className="text-lg font-semibold mb-2">Signals (API & Webhook)</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Real-time and scheduled data sources for market signals
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {Object.entries(API_SOURCE_TEMPLATES).map(([key, template]) => (
                    <Card
                      key={key}
                      className={`cursor-pointer transition-colors hover:border-primary/50 ${
                        selectedTemplate === key ? 'border-primary bg-primary/5' : ''
                      }`}
                      onClick={() => setSelectedTemplate(key)}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <Globe className="h-5 w-5 mt-1" />
                          <div className="flex-1">
                            <h3 className="font-medium mb-1">{template.name}</h3>
                            <p className="text-sm text-muted-foreground mb-2">{template.description}</p>
                            <Badge variant="outline" className="text-xs">API</Badge>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  {Object.entries(WEBHOOK_SOURCE_TEMPLATES).map(([key, template]) => (
                    <Card
                      key={key}
                      className={`cursor-pointer transition-colors hover:border-primary/50 ${
                        selectedTemplate === key ? 'border-primary bg-primary/5' : ''
                      }`}
                      onClick={() => setSelectedTemplate(key)}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <Globe className="h-5 w-5 mt-1" />
                          <div className="flex-1">
                            <h3 className="font-medium mb-1">{template.name}</h3>
                            <p className="text-sm text-muted-foreground mb-2">{template.description}</p>
                            <Badge variant="outline" className="text-xs">Webhook</Badge>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {/* Show config form for selected signal sources */}
                {selectedTemplate && (API_SOURCE_TEMPLATES[selectedTemplate as keyof typeof API_SOURCE_TEMPLATES] || 
                                      WEBHOOK_SOURCE_TEMPLATES[selectedTemplate as keyof typeof WEBHOOK_SOURCE_TEMPLATES]) && (
                  <div className="mt-4 border-t pt-4">
                    <h4 className="font-medium mb-4">
                      Configure {
                        API_SOURCE_TEMPLATES[selectedTemplate as keyof typeof API_SOURCE_TEMPLATES]?.name ||
                        WEBHOOK_SOURCE_TEMPLATES[selectedTemplate as keyof typeof WEBHOOK_SOURCE_TEMPLATES]?.name
                      }
                    </h4>
                    {renderSourceFields(selectedTemplate)}
                  </div>
                )}
              </div>

              {/* Knowledge Base Section */}
              <div>
                <h3 className="text-lg font-semibold mb-2">Knowledge Base Sources</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Document and content sources for AI knowledge retrieval
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {Object.entries(KNOWLEDGE_SOURCE_TEMPLATES).map(([key, template]) => {
                    const Icon = template.icon;
                    return (
                      <Card
                        key={key}
                        className={`cursor-pointer transition-colors hover:border-primary/50 ${
                          selectedTemplate === key ? 'border-primary bg-primary/5' : ''
                        }`}
                        onClick={() => setSelectedTemplate(key)}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-start gap-3">
                            <Icon className="h-5 w-5 mt-1" />
                            <div className="flex-1">
                              <h3 className="font-medium mb-1">{template.name}</h3>
                              <p className="text-sm text-muted-foreground mb-2">{template.description}</p>
                              <Badge variant="outline" className="text-xs">
                                {template.refresh_mode}
                              </Badge>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>

                {/* Show config form for selected KB sources */}
                {selectedTemplate && KNOWLEDGE_SOURCE_TEMPLATES[selectedTemplate] && (
                  <div className="mt-4 border-t pt-4">
                    <h4 className="font-medium mb-4">
                      Configure {KNOWLEDGE_SOURCE_TEMPLATES[selectedTemplate].name}
                    </h4>
                    {renderSourceFields(selectedTemplate)}
                  </div>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => {
                setShowAddDialog(false);
                setSelectedTemplate('');
                setFormData({});
              }}>
                Cancel
              </Button>
              <Button onClick={addDataSource} disabled={!selectedTemplate}>
                Add Source
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {dataSources.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">No data sources configured yet.</p>
            <p className="text-sm text-muted-foreground mt-2">
              Click "Add Source" to get started.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="signals" className="space-y-4">
          <TabsList>
            <TabsTrigger value="signals">Signals (API / Webhook)</TabsTrigger>
            <TabsTrigger value="knowledge">Knowledge Base</TabsTrigger>
          </TabsList>
          
          <TabsContent value="signals" className="space-y-4">
            {signalSources.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center">
                  <p className="text-muted-foreground">No signal sources configured yet.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {signalSources.map(renderSourceCard)}
              </div>
            )}
          </TabsContent>

          <TabsContent value="knowledge" className="space-y-4">
            {knowledgeBaseSources.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center">
                  <p className="text-muted-foreground">No knowledge base sources configured yet.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {knowledgeBaseSources.map(renderSourceCard)}
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
