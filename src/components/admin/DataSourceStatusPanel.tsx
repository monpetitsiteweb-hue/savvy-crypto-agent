import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, Clock, AlertTriangle, ExternalLink, Wrench } from "lucide-react";

interface DataSourceStatus {
  name: string;
  category: string;
  status: 'ready' | 'needs_setup' | 'premium_required' | 'missing';
  cost: string;
  setupUrl?: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
}

const DATA_SOURCE_STATUS: DataSourceStatus[] = [
  // Ready to use sources
  {
    name: "Fear & Greed Index",
    category: "Market Sentiment",
    status: 'ready',
    cost: 'FREE',
    setupUrl: "https://alternative.me/crypto/fear-and-greed-index/",
    description: "Market sentiment analysis (0-100 scale)",
    priority: 'medium'
  },
  {
    name: "Coinbase Institutional Flows",
    category: "Institutional Data",
    status: 'ready',
    cost: 'FREE',
    setupUrl: "https://docs.cloud.coinbase.com/exchange/docs",
    description: "Track institutional trading volumes",
    priority: 'medium'
  },
  
  // Existing premium sources with potential upgrades
  {
    name: "Arkham Intelligence",
    category: "Whale Tracking (Premium)",
    status: 'premium_required',
    cost: '$99+/month',
    setupUrl: "https://app.arkhamintelligence.com/api",
    description: "🎯 Whale wallets: BlackRock, MicroStrategy, Tesla, Trump - Critical for AI intelligence",
    priority: 'critical'
  },
  {
    name: "Whale Alert",
    category: "Large Transactions (Premium)",
    status: 'premium_required',
    cost: '$50+/month',
    setupUrl: "https://whale-alert.io/api",
    description: "🚨 Real-time large transactions (>$100K) - High priority for market signals",
    priority: 'high'
  },
  
  // New whale signal providers
  {
    name: "Cryptocurrency Alerting",
    category: "Whale Signals (Webhooks)",
    status: 'needs_setup',
    cost: 'Free tier + Premium',
    setupUrl: "https://cryptocurrencyalerting.com/webhook-setup",
    description: "🔔 Webhook-based whale alerts with custom thresholds - Recommended alternative",
    priority: 'high'
  },
  {
    name: "Bitquery API",
    category: "Whale Signals (Queries)",
    status: 'needs_setup',
    cost: 'Free (1000 queries/month)',
    setupUrl: "https://bitquery.io/docs/start/",
    description: "📊 Advanced blockchain queries for whale detection - Great free option",
    priority: 'high'
  },
  {
    name: "QuickNode Webhooks",
    category: "Whale Signals (Real-time)",
    status: 'needs_setup',
    cost: 'Pay-per-use',
    setupUrl: "https://www.quicknode.com/guides/quicknode-streams/how-to-use-quicknode-streams",
    description: "⚡ Real-time blockchain webhooks with expression filters - Most advanced",
    priority: 'high'
  },
  
  // Social and content sources
  {
    name: "Twitter/X API",
    category: "Social Sentiment",
    status: 'premium_required',
    cost: '$100+/month',
    setupUrl: "https://developer.twitter.com/en/portal/dashboard",
    description: "🐦 Crypto influencer sentiment analysis",
    priority: 'medium'
  },
  {
    name: "YouTube Data API",
    category: "Content Analysis",
    status: 'needs_setup',
    cost: 'Free tier available',
    setupUrl: "https://console.cloud.google.com/apis/library/youtube.googleapis.com",
    description: "📺 Track crypto analysis videos",
    priority: 'medium'
  },
  {
    name: "Reddit API",
    category: "Community Sentiment",
    status: 'needs_setup',
    cost: 'Free tier available',
    setupUrl: "https://www.reddit.com/prefs/apps",
    description: "💬 Monitor r/cryptocurrency, r/bitcoin",
    priority: 'medium'
  }
];

export function DataSourceStatusPanel() {
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'ready': return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'needs_setup': return <Wrench className="h-4 w-4 text-blue-500" />;
      case 'premium_required': return <AlertTriangle className="h-4 w-4 text-orange-500" />;
      case 'missing': return <XCircle className="h-4 w-4 text-red-500" />;
      default: return <Clock className="h-4 w-4 text-gray-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ready': return 'bg-green-100 text-green-800';
      case 'needs_setup': return 'bg-blue-100 text-blue-800';
      case 'premium_required': return 'bg-orange-100 text-orange-800';
      case 'missing': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'critical': return 'border-l-red-500';
      case 'high': return 'border-l-orange-500';
      case 'medium': return 'border-l-blue-500';
      case 'low': return 'border-l-gray-500';
      default: return 'border-l-gray-300';
    }
  };

  const groupedSources = DATA_SOURCE_STATUS.reduce((acc, source) => {
    if (!acc[source.category]) acc[source.category] = [];
    acc[source.category].push(source);
    return acc;
  }, {} as Record<string, DataSourceStatus[]>);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wrench className="h-5 w-5" />
          Data Source Setup Guide
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {Object.entries(groupedSources).map(([category, sources]) => (
          <div key={category}>
            <h3 className="text-lg font-semibold mb-3">{category}</h3>
            <div className="space-y-3">
              {sources.map((source) => (
                <div 
                  key={source.name}
                  className={`p-4 border-l-4 bg-gray-50 rounded-r-lg ${getPriorityColor(source.priority)}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        {getStatusIcon(source.status)}
                        <h4 className="font-semibold">{source.name}</h4>
                        <Badge className={getStatusColor(source.status)}>
                          {source.status.replace('_', ' ')}
                        </Badge>
                        <Badge variant="outline">{source.cost}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mb-2">
                        {source.description}
                      </p>
                      {source.priority === 'critical' && (
                        <p className="text-xs text-red-600 font-medium">
                          🔥 Critical for advanced AI capabilities
                        </p>
                      )}
                    </div>
                    {source.setupUrl && (
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => window.open(source.setupUrl, '_blank')}
                      >
                        <ExternalLink className="h-4 w-4 mr-2" />
                        Setup Guide
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        
        <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h4 className="font-semibold text-blue-900 mb-2">📋 Recommended Setup Priority:</h4>
          <ol className="text-sm text-blue-800 space-y-2">
            <li>1. ✅ <strong>Ready Now:</strong> Fear & Greed Index, Coinbase Institutional (working immediately)</li>
            <li>2. 🔔 <strong>Start Here:</strong> Cryptocurrency Alerting or Bitquery (free whale signals)</li>
            <li>3. ⚡ <strong>Advanced:</strong> QuickNode Webhooks for real-time alerts</li>
            <li>4. 💰 <strong>Premium Upgrade:</strong> Arkham Intelligence ($99/month) for institutional tracking</li>
            <li>5. 📱 <strong>Social Layer:</strong> YouTube & Reddit APIs for sentiment analysis</li>
          </ol>
        </div>
        
        <div className="mt-4 p-4 bg-purple-50 border border-purple-200 rounded-lg">
          <h4 className="font-semibold text-purple-900 mb-2">🐋 Whale Signal Strategy:</h4>
          <div className="text-sm text-purple-800 space-y-1">
            <p><strong>Free Route:</strong> Start with Cryptocurrency Alerting + Bitquery (covers most whale activity)</p>
            <p><strong>Premium Route:</strong> Arkham Intelligence + QuickNode (institutional + real-time feeds)</p>
            <p><strong>Complete Setup:</strong> All sources for maximum AI market intelligence</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}