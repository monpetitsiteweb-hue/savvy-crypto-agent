import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Brain, TrendingUp, Shield, Clock, BarChart3, AlertTriangle } from "lucide-react";

interface AIKnowledge {
  id: string;
  knowledge_type: string;
  title: string;
  content: string;
  confidence_score: number;
  data_points: number;
  created_at: string;
  last_validated_at?: string;
}

interface LearningMetrics {
  id: string;
  metric_type: string;
  metric_value: number;
  trades_analyzed: number;
  insights_generated: number;
  created_at: string;
}

export function AILearningPanel() {
  const [knowledge, setKnowledge] = useState<AIKnowledge[]>([]);
  const [metrics, setMetrics] = useState<LearningMetrics[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    loadLearningData();
  }, []);

  const loadLearningData = async () => {
    try {
      // Load AI knowledge
      const { data: knowledgeData, error: knowledgeError } = await supabase
        .from('ai_knowledge_base')
        .select('*')
        .order('confidence_score', { ascending: false });

      if (knowledgeError) throw knowledgeError;

      // Load learning metrics
      const { data: metricsData, error: metricsError } = await supabase
        .from('ai_learning_metrics')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

      if (metricsError) throw metricsError;

      setKnowledge(knowledgeData || []);
      setMetrics(metricsData || []);
    } catch (error) {
      console.error('Error loading learning data:', error);
      toast({
        title: "Error",
        description: "Failed to load AI learning data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const triggerLearningAnalysis = async () => {
    setIsAnalyzing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase.functions.invoke('ai-learning-engine', {
        body: { action: 'analyze_and_learn', userId: user.id }
      });

      if (error) throw error;

      toast({
        title: "Analysis Complete",
        description: `Generated ${data.insights?.length || 0} new insights from your trading data`,
      });

      // Reload data
      await loadLearningData();
    } catch (error) {
      console.error('Learning analysis error:', error);
      toast({
        title: "Analysis Failed",
        description: "Could not analyze trading data. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const getKnowledgeIcon = (type: string) => {
    switch (type) {
      case 'performance_insight': return <TrendingUp className="h-4 w-4" />;
      case 'risk_assessment': return <Shield className="h-4 w-4" />;
      case 'market_pattern': return <BarChart3 className="h-4 w-4" />;
      case 'trading_strategy': return <Brain className="h-4 w-4" />;
      default: return <AlertTriangle className="h-4 w-4" />;
    }
  };

  const getKnowledgeColor = (type: string) => {
    switch (type) {
      case 'performance_insight': return 'bg-green-500/10 text-green-700';
      case 'risk_assessment': return 'bg-red-500/10 text-red-700';
      case 'market_pattern': return 'bg-blue-500/10 text-blue-700';
      case 'trading_strategy': return 'bg-purple-500/10 text-purple-700';
      default: return 'bg-gray-500/10 text-gray-700';
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            AI Learning Engine
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

  const totalInsights = knowledge.length;
  const highConfidenceInsights = knowledge.filter(k => k.confidence_score > 0.7).length;
  const avgConfidence = knowledge.length > 0 
    ? knowledge.reduce((sum, k) => sum + k.confidence_score, 0) / knowledge.length 
    : 0;

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center space-x-2">
              <Brain className="h-8 w-8 text-primary" />
              <div>
                <p className="text-2xl font-bold">{totalInsights}</p>
                <p className="text-sm text-muted-foreground">Total Insights</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center space-x-2">
              <TrendingUp className="h-8 w-8 text-green-600" />
              <div>
                <p className="text-2xl font-bold">{highConfidenceInsights}</p>
                <p className="text-sm text-muted-foreground">High Confidence</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center space-x-2">
              <BarChart3 className="h-8 w-8 text-blue-600" />
              <div>
                <p className="text-2xl font-bold">{(avgConfidence * 100).toFixed(0)}%</p>
                <p className="text-sm text-muted-foreground">Avg Confidence</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Panel */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Brain className="h-5 w-5" />
                AI Learning Engine
              </CardTitle>
              <CardDescription>
                Your AI agent continuously learns from trading patterns and improves over time
              </CardDescription>
            </div>
            <Button 
              onClick={triggerLearningAnalysis}
              disabled={isAnalyzing}
              className="flex items-center gap-2"
            >
              {isAnalyzing ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Analyzing...
                </>
              ) : (
                <>
                  <Brain className="h-4 w-4" />
                  Analyze Now
                </>
              )}
            </Button>
          </div>
        </CardHeader>

        <CardContent>
          <Tabs defaultValue="insights" className="space-y-4">
            <TabsList>
              <TabsTrigger value="insights">AI Insights</TabsTrigger>
              <TabsTrigger value="metrics">Learning Metrics</TabsTrigger>
            </TabsList>

            <TabsContent value="insights" className="space-y-4">
              {knowledge.length === 0 ? (
                <div className="text-center py-8">
                  <Brain className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-semibold">No Insights Yet</h3>
                  <p className="text-muted-foreground mb-4">
                    Your AI agent will learn from your trading patterns once you have enough data.
                  </p>
                  <Button onClick={triggerLearningAnalysis} disabled={isAnalyzing}>
                    Start Learning Analysis
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {knowledge.map((insight) => (
                    <Card key={insight.id} className="p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2">
                          {getKnowledgeIcon(insight.knowledge_type)}
                          <h4 className="font-semibold">{insight.title}</h4>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge 
                            variant="secondary" 
                            className={getKnowledgeColor(insight.knowledge_type)}
                          >
                            {insight.knowledge_type.replace('_', ' ')}
                          </Badge>
                          <Badge variant="outline">
                            {(insight.confidence_score * 100).toFixed(0)}% confidence
                          </Badge>
                        </div>
                      </div>
                      
                      <p className="text-sm text-muted-foreground mb-3">
                        {insight.content}
                      </p>
                      
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Based on {insight.data_points} data points</span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {new Date(insight.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      
                      <div className="mt-2">
                        <Progress 
                          value={insight.confidence_score * 100} 
                          className="h-1"
                        />
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="metrics" className="space-y-4">
              {metrics.length === 0 ? (
                <div className="text-center py-8">
                  <BarChart3 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-semibold">No Metrics Yet</h3>
                  <p className="text-muted-foreground">
                    Learning metrics will appear here as your AI agent analyzes data.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {metrics.map((metric) => (
                    <Card key={metric.id} className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-semibold capitalize">
                          {metric.metric_type.replace('_', ' ')}
                        </h4>
                        <Badge variant="outline">
                          {metric.metric_value} insights
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-sm text-muted-foreground">
                        <div>
                          <span className="font-medium">Trades Analyzed:</span> {metric.trades_analyzed}
                        </div>
                        <div>
                          <span className="font-medium">Date:</span> {new Date(metric.created_at).toLocaleDateString()}
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}