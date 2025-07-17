import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { useToast } from '@/hooks/use-toast';
import { Activity, TrendingUp, AlertTriangle, BarChart3, Gauge } from 'lucide-react';

interface Category {
  id: string;
  category_name: string;
  category_type: string;
  description: string;
  is_enabled: boolean;
  importance_score: number;
  confidence_level: number;
  last_performance_update: string;
}

interface CategoryPerformance {
  category_id: string;
  winning_trades: number;
  total_trades: number;
  profit_impact: number;
  accuracy_score: number;
  influence_weight: number;
  market_condition: string;
}

const CategoryManagementPanel = () => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [performance, setPerformance] = useState<CategoryPerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    loadCategories();
    loadPerformance();
  }, []);

  const loadCategories = async () => {
    try {
      const { data, error } = await supabase
        .from('ai_data_categories')
        .select('*')
        .order('importance_score', { ascending: false });

      if (error) throw error;
      setCategories(data || []);
    } catch (error) {
      console.error('Error loading categories:', error);
      toast({
        title: "Error",
        description: "Failed to load categories",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const loadPerformance = async () => {
    try {
      // Get performance data for last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { data, error } = await supabase
        .from('ai_category_performance')
        .select('*')
        .gte('period_start', thirtyDaysAgo.toISOString())
        .order('profit_impact', { ascending: false });

      if (error) throw error;
      setPerformance(data || []);
    } catch (error) {
      console.error('Error loading performance:', error);
    }
  };

  const toggleCategory = async (categoryId: string, enabled: boolean) => {
    try {
      const { error } = await supabase
        .from('ai_data_categories')
        .update({ is_enabled: enabled })
        .eq('id', categoryId);

      if (error) throw error;

      setCategories(prev => prev.map(cat => 
        cat.id === categoryId ? { ...cat, is_enabled: enabled } : cat
      ));

      toast({
        title: "Success",
        description: `Category ${enabled ? 'enabled' : 'disabled'} successfully`,
      });
    } catch (error) {
      console.error('Error updating category:', error);
      toast({
        title: "Error",
        description: "Failed to update category",
        variant: "destructive",
      });
    }
  };

  const updateImportanceScore = async (categoryId: string, score: number) => {
    try {
      const { error } = await supabase
        .from('ai_data_categories')
        .update({ importance_score: score / 100 })
        .eq('id', categoryId);

      if (error) throw error;

      setCategories(prev => prev.map(cat => 
        cat.id === categoryId ? { ...cat, importance_score: score / 100 } : cat
      ));
    } catch (error) {
      console.error('Error updating importance score:', error);
      toast({
        title: "Error",
        description: "Failed to update importance score",
        variant: "destructive",
      });
    }
  };

  const updateCategoryPerformance = async () => {
    try {
      const { error } = await supabase.functions.invoke('ai-learning-engine', {
        body: { action: 'update_category_performance', userId: 'admin' }
      });

      if (error) throw error;

      await loadCategories();
      await loadPerformance();

      toast({
        title: "Success",
        description: "Category performance updated successfully",
      });
    } catch (error) {
      console.error('Error updating performance:', error);
      toast({
        title: "Error",
        description: "Failed to update category performance",
        variant: "destructive",
      });
    }
  };

  const getCategoryIcon = (type: string) => {
    switch (type) {
      case 'sentiment': return <TrendingUp className="h-4 w-4" />;
      case 'whale_tracking': return <Activity className="h-4 w-4" />;
      case 'institutional': return <BarChart3 className="h-4 w-4" />;
      case 'technical': return <Gauge className="h-4 w-4" />;
      default: return <AlertTriangle className="h-4 w-4" />;
    }
  };

  const getCategoryPerformance = (categoryId: string) => {
    return performance.find(p => p.category_id === categoryId);
  };

  if (loading) {
    return <div className="text-center py-8">Loading categories...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold text-white">Category Management</h3>
          <p className="text-sm text-slate-400">Configure data categories and their influence on AI decisions</p>
        </div>
        <Button onClick={updateCategoryPerformance} variant="outline">
          <Activity className="w-4 h-4 mr-2" />
          Update Performance
        </Button>
      </div>

      <div className="grid gap-4">
        {categories.map((category) => {
          const perf = getCategoryPerformance(category.id);
          const winRate = perf ? (perf.winning_trades / perf.total_trades) * 100 : 0;

          return (
            <Card key={category.id} className="bg-slate-800/50 border-slate-700">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {getCategoryIcon(category.category_type)}
                    <div>
                      <CardTitle className="text-white text-base">{category.category_name}</CardTitle>
                      <p className="text-sm text-slate-400">{category.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <Badge variant={category.is_enabled ? 'default' : 'secondary'}>
                      {category.is_enabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                    <Switch
                      checked={category.is_enabled}
                      onCheckedChange={(checked) => toggleCategory(category.id, checked)}
                    />
                  </div>
                </div>
              </CardHeader>
              
              <CardContent className="space-y-4">
                {/* Performance Metrics */}
                {perf && (
                  <div className="grid grid-cols-4 gap-4 p-3 bg-slate-900/50 rounded-lg">
                    <div className="text-center">
                      <div className="text-xs text-slate-400">Win Rate</div>
                      <div className="text-sm font-medium text-white">{winRate.toFixed(1)}%</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-slate-400">Total Trades</div>
                      <div className="text-sm font-medium text-white">{perf.total_trades}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-slate-400">Profit Impact</div>
                      <div className={`text-sm font-medium ${perf.profit_impact >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        €{perf.profit_impact.toFixed(2)}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-slate-400">Accuracy</div>
                      <div className="text-sm font-medium text-white">{(perf.accuracy_score * 100).toFixed(1)}%</div>
                    </div>
                  </div>
                )}

                {/* Importance Score Slider */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-sm text-slate-300">Importance Score</label>
                    <span className="text-sm text-slate-400">{(category.importance_score * 100).toFixed(0)}%</span>
                  </div>
                  <Slider
                    value={[category.importance_score * 100]}
                    onValueChange={([value]) => updateImportanceScore(category.id, value)}
                    max={100}
                    step={5}
                    className="w-full"
                  />
                  <p className="text-xs text-slate-500">
                    Higher importance means this category has more influence on AI trading decisions
                  </p>
                </div>

                {/* Confidence Level */}
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-300">Confidence Level</span>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${
                      category.confidence_level > 0.8 ? 'bg-green-400' :
                      category.confidence_level > 0.6 ? 'bg-yellow-400' : 'bg-red-400'
                    }`} />
                    <span className="text-sm text-white">{(category.confidence_level * 100).toFixed(0)}%</span>
                  </div>
                </div>

                {/* Last Update */}
                {category.last_performance_update && (
                  <div className="text-xs text-slate-500">
                    Last updated: {new Date(category.last_performance_update).toLocaleDateString()}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default CategoryManagementPanel;