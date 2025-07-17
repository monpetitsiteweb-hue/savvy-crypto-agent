import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity, Database, Brain, TrendingUp, AlertCircle } from 'lucide-react';

const SystemSummaryPanel = () => {
  const [summary, setSummary] = useState({
    activeCategories: 0,
    activeSources: 0,
    totalInsights: 0,
    avgConfidence: 0,
    categories: [],
    recentPerformance: []
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSystemSummary();
  }, []);

  const loadSystemSummary = async () => {
    try {
      // Get active categories
      const { data: categories } = await supabase
        .from('ai_data_categories')
        .select('*')
        .eq('is_enabled', true);

      // Get active data sources
      const { data: sources } = await supabase
        .from('ai_data_sources')
        .select('*')
        .eq('is_active', true);

      // Get AI insights
      const { data: insights } = await supabase
        .from('ai_knowledge_base')
        .select('confidence_score');

      // Get recent category performance
      const { data: performance } = await supabase
        .from('ai_category_performance')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);

      const avgConfidence = insights?.length ? 
        insights.reduce((sum, i) => sum + i.confidence_score, 0) / insights.length : 0;

      setSummary({
        activeCategories: categories?.length || 0,
        activeSources: sources?.length || 0,
        totalInsights: insights?.length || 0,
        avgConfidence,
        categories: categories || [],
        recentPerformance: performance || []
      });
    } catch (error) {
      console.error('Error loading system summary:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="text-center py-8">Loading system summary...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-white">System Summary</h3>
        <p className="text-sm text-slate-400">Overview of AI agent configuration and performance</p>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="p-4 text-center">
            <Database className="h-6 w-6 mx-auto mb-2 text-blue-400" />
            <div className="text-2xl font-bold text-white">{summary.activeCategories}</div>
            <div className="text-xs text-slate-400">Active Categories</div>
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="p-4 text-center">
            <Activity className="h-6 w-6 mx-auto mb-2 text-green-400" />
            <div className="text-2xl font-bold text-white">{summary.activeSources}</div>
            <div className="text-xs text-slate-400">Data Sources</div>
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="p-4 text-center">
            <Brain className="h-6 w-6 mx-auto mb-2 text-purple-400" />
            <div className="text-2xl font-bold text-white">{summary.totalInsights}</div>
            <div className="text-xs text-slate-400">AI Insights</div>
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="p-4 text-center">
            <TrendingUp className="h-6 w-6 mx-auto mb-2 text-yellow-400" />
            <div className="text-2xl font-bold text-white">{(summary.avgConfidence * 100).toFixed(0)}%</div>
            <div className="text-xs text-slate-400">Avg Confidence</div>
          </CardContent>
        </Card>
      </div>

      {/* Active Categories */}
      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <AlertCircle className="h-5 w-5" />
            Active Categories Influencing AI
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {summary.categories.map((category: any) => (
              <Badge key={category.id} variant="outline" className="text-green-400 border-green-400">
                {category.category_name} ({(category.importance_score * 100).toFixed(0)}%)
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Recent Performance */}
      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Recent Category Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {summary.recentPerformance.map((perf: any, index) => {
              const winRate = perf.total_trades > 0 ? (perf.winning_trades / perf.total_trades) * 100 : 0;
              return (
                <div key={index} className="flex justify-between items-center p-2 bg-slate-900/50 rounded">
                  <span className="text-sm text-slate-300">
                    Category Performance #{index + 1}
                  </span>
                  <div className="flex gap-4 text-xs">
                    <span className="text-slate-400">Win Rate: {winRate.toFixed(1)}%</span>
                    <span className={perf.profit_impact >= 0 ? 'text-green-400' : 'text-red-400'}>
                      €{perf.profit_impact.toFixed(2)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default SystemSummaryPanel;