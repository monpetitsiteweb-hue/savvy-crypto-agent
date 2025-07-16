import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.5';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    );

    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    const { action, userId } = await req.json();
    console.log(`🧠 AI Learning Engine: ${action} for user ${userId}`);

    if (action === 'analyze_and_learn') {
      // Analyze trading history and generate insights
      const insights = await analyzeAndLearn(supabaseClient, userId);
      return new Response(JSON.stringify({ success: true, insights }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (action === 'get_knowledge') {
      // Get current knowledge for AI context
      const knowledge = await getKnowledgeForContext(supabaseClient, userId);
      return new Response(JSON.stringify({ knowledge }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (action === 'update_insight') {
      // Update or validate existing insights based on new data
      const { insightId, validation } = await req.json();
      await updateInsightValidation(supabaseClient, userId, insightId, validation);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    throw new Error('Invalid action');

  } catch (error) {
    console.error('AI Learning Engine Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function analyzeAndLearn(supabaseClient: any, userId: string) {
  console.log('🔍 Starting analysis and learning process...');
  
  // Get recent trading history and mock trades
  const { data: tradingHistory } = await supabaseClient
    .from('trading_history')
    .select('*')
    .eq('user_id', userId)
    .order('executed_at', { ascending: false })
    .limit(100);

  const { data: mockTrades } = await supabaseClient
    .from('mock_trades')
    .select('*')
    .eq('user_id', userId)
    .order('executed_at', { ascending: false })
    .limit(100);

  const { data: strategies } = await supabaseClient
    .from('trading_strategies')
    .select('*')
    .eq('user_id', userId);

  const allTrades = [...(tradingHistory || []), ...(mockTrades || [])];
  console.log(`📊 Analyzing ${allTrades.length} trades...`);

  const insights = [];

  // 1. Performance Pattern Analysis
  if (allTrades.length >= 5) {
    const performanceInsight = analyzePerformancePatterns(allTrades);
    if (performanceInsight) {
      insights.push(performanceInsight);
      await saveInsight(supabaseClient, userId, performanceInsight);
    }
  }

  // 2. Risk Management Analysis
  if (allTrades.length >= 3) {
    const riskInsight = analyzeRiskPatterns(allTrades, strategies);
    if (riskInsight) {
      insights.push(riskInsight);
      await saveInsight(supabaseClient, userId, riskInsight);
    }
  }

  // 3. Market Timing Analysis
  if (allTrades.length >= 10) {
    const timingInsight = analyzeMarketTiming(allTrades);
    if (timingInsight) {
      insights.push(timingInsight);
      await saveInsight(supabaseClient, userId, timingInsight);
    }
  }

  // 4. Strategy Effectiveness Analysis
  if (strategies && strategies.length > 0) {
    const strategyInsight = analyzeStrategyEffectiveness(allTrades, strategies);
    if (strategyInsight) {
      insights.push(strategyInsight);
      await saveInsight(supabaseClient, userId, strategyInsight);
    }
  }

  // Update learning metrics
  await updateLearningMetrics(supabaseClient, userId, allTrades.length, insights.length);

  console.log(`✅ Generated ${insights.length} new insights`);
  return insights;
}

function analyzePerformancePatterns(trades: any[]) {
  const profitableTrades = trades.filter(t => (t.profit_loss || 0) > 0);
  const winRate = profitableTrades.length / trades.length;
  
  if (winRate < 0.3) {
    return {
      type: 'performance_insight',
      title: 'Low Win Rate Pattern Detected',
      content: `Your current win rate is ${(winRate * 100).toFixed(1)}%. Analysis shows potential improvements in entry timing and risk management. Consider reducing position sizes and implementing stricter stop-loss rules.`,
      confidence: 0.8,
      dataPoints: trades.length,
      metadata: { 
        winRate,
        avgLoss: trades.filter(t => (t.profit_loss || 0) < 0).reduce((sum, t) => sum + Math.abs(t.profit_loss || 0), 0) / trades.filter(t => (t.profit_loss || 0) < 0).length,
        avgGain: profitableTrades.reduce((sum, t) => sum + (t.profit_loss || 0), 0) / profitableTrades.length
      }
    };
  } else if (winRate > 0.7) {
    return {
      type: 'performance_insight',
      title: 'Strong Performance Pattern',
      content: `Excellent win rate of ${(winRate * 100).toFixed(1)}%! Your current strategy is working well. Consider gradually increasing position sizes while maintaining strict risk management.`,
      confidence: 0.9,
      dataPoints: trades.length,
      metadata: { winRate, performance: 'excellent' }
    };
  }
  
  return null;
}

function analyzeRiskPatterns(trades: any[], strategies: any[]) {
  const losses = trades.filter(t => (t.profit_loss || 0) < 0);
  if (losses.length === 0) return null;
  
  const avgLoss = losses.reduce((sum, t) => sum + Math.abs(t.profit_loss || 0), 0) / losses.length;
  const maxLoss = Math.max(...losses.map(t => Math.abs(t.profit_loss || 0)));
  
  if (maxLoss > avgLoss * 3) {
    return {
      type: 'risk_assessment',
      title: 'Risk Management Alert',
      content: `Detected significant loss outliers. Your maximum loss (€${maxLoss.toFixed(2)}) is ${(maxLoss / avgLoss).toFixed(1)}x your average loss. Implement stricter stop-loss levels and position sizing rules.`,
      confidence: 0.85,
      dataPoints: losses.length,
      metadata: { avgLoss, maxLoss, riskRatio: maxLoss / avgLoss }
    };
  }
  
  return null;
}

function analyzeMarketTiming(trades: any[]) {
  // Group trades by hour of day
  const hourlyPerformance: { [hour: number]: { count: number, totalPL: number } } = {};
  
  trades.forEach(trade => {
    const hour = new Date(trade.executed_at).getHours();
    if (!hourlyPerformance[hour]) {
      hourlyPerformance[hour] = { count: 0, totalPL: 0 };
    }
    hourlyPerformance[hour].count++;
    hourlyPerformance[hour].totalPL += trade.profit_loss || 0;
  });
  
  // Find best and worst performing hours
  const hourlyAvg = Object.entries(hourlyPerformance)
    .map(([hour, data]) => ({
      hour: parseInt(hour),
      avgPL: data.totalPL / data.count,
      count: data.count
    }))
    .filter(h => h.count >= 2) // Only consider hours with multiple trades
    .sort((a, b) => b.avgPL - a.avgPL);
  
  if (hourlyAvg.length >= 3) {
    const bestHour = hourlyAvg[0];
    const worstHour = hourlyAvg[hourlyAvg.length - 1];
    
    if (bestHour.avgPL > 0 && worstHour.avgPL < 0) {
      return {
        type: 'market_pattern',
        title: 'Market Timing Pattern Identified',
        content: `Your trades perform best around ${bestHour.hour}:00 (avg: €${bestHour.avgPL.toFixed(2)}) and worst around ${worstHour.hour}:00 (avg: €${worstHour.avgPL.toFixed(2)}). Consider focusing trades during your high-performance hours.`,
        confidence: 0.7,
        dataPoints: trades.length,
        metadata: { bestHour: bestHour.hour, worstHour: worstHour.hour, hourlyData: hourlyPerformance }
      };
    }
  }
  
  return null;
}

function analyzeStrategyEffectiveness(trades: any[], strategies: any[]) {
  if (!strategies.length) return null;
  
  const strategyPerformance = strategies.map(strategy => {
    const strategyTrades = trades.filter(t => t.strategy_id === strategy.id);
    if (strategyTrades.length === 0) return null;
    
    const totalPL = strategyTrades.reduce((sum, t) => sum + (t.profit_loss || 0), 0);
    const winRate = strategyTrades.filter(t => (t.profit_loss || 0) > 0).length / strategyTrades.length;
    
    return {
      strategy,
      trades: strategyTrades.length,
      totalPL,
      winRate,
      avgPL: totalPL / strategyTrades.length
    };
  }).filter(Boolean);
  
  if (strategyPerformance.length > 1) {
    const best = strategyPerformance.sort((a, b) => b!.avgPL - a!.avgPL)[0];
    const worst = strategyPerformance[strategyPerformance.length - 1];
    
    return {
      type: 'trading_strategy',
      title: 'Strategy Performance Comparison',
      content: `Strategy "${best!.strategy.strategy_name}" is outperforming with €${best!.avgPL.toFixed(2)} average per trade vs "${worst!.strategy.strategy_name}" at €${worst!.avgPL.toFixed(2)}. Consider allocating more capital to your top-performing strategy.`,
      confidence: 0.8,
      dataPoints: trades.length,
      metadata: { bestStrategy: best!.strategy.id, worstStrategy: worst!.strategy.id, comparison: strategyPerformance }
    };
  }
  
  return null;
}

async function saveInsight(supabaseClient: any, userId: string, insight: any) {
  // Check if similar insight already exists
  const { data: existing } = await supabaseClient
    .from('ai_knowledge_base')
    .select('id, data_points, confidence_score')
    .eq('user_id', userId)
    .eq('knowledge_type', insight.type)
    .eq('title', insight.title)
    .maybeSingle();
  
  if (existing) {
    // Update existing insight with more data points and adjusted confidence
    const newDataPoints = existing.data_points + insight.dataPoints;
    const newConfidence = Math.min(0.95, existing.confidence_score + 0.05);
    
    await supabaseClient
      .from('ai_knowledge_base')
      .update({
        data_points: newDataPoints,
        confidence_score: newConfidence,
        content: insight.content,
        metadata: insight.metadata,
        last_validated_at: new Date().toISOString()
      })
      .eq('id', existing.id);
  } else {
    // Create new insight
    await supabaseClient
      .from('ai_knowledge_base')
      .insert({
        user_id: userId,
        knowledge_type: insight.type,
        title: insight.title,
        content: insight.content,
        confidence_score: insight.confidence,
        data_points: insight.dataPoints,
        metadata: insight.metadata
      });
  }
}

async function getKnowledgeForContext(supabaseClient: any, userId: string) {
  const { data: knowledge } = await supabaseClient
    .from('ai_knowledge_base')
    .select('*')
    .eq('user_id', userId)
    .gte('confidence_score', 0.6) // Only high-confidence insights
    .order('confidence_score', { ascending: false })
    .limit(10);
  
  return knowledge || [];
}

async function updateInsightValidation(supabaseClient: any, userId: string, insightId: string, validation: boolean) {
  const confidenceAdjustment = validation ? 0.1 : -0.1;
  
  await supabaseClient
    .from('ai_knowledge_base')
    .update({
      confidence_score: supabaseClient.raw(`GREATEST(0.1, LEAST(0.95, confidence_score + ${confidenceAdjustment}))`),
      last_validated_at: new Date().toISOString()
    })
    .eq('id', insightId)
    .eq('user_id', userId);
}

async function updateLearningMetrics(supabaseClient: any, userId: string, tradesAnalyzed: number, insightsGenerated: number) {
  const today = new Date();
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000 - 1);
  
  await supabaseClient
    .from('ai_learning_metrics')
    .insert({
      user_id: userId,
      metric_type: 'daily_analysis',
      metric_value: insightsGenerated,
      period_start: startOfDay.toISOString(),
      period_end: endOfDay.toISOString(),
      trades_analyzed: tradesAnalyzed,
      insights_generated: insightsGenerated
    });
}