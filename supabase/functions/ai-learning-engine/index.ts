// @ts-nocheck
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
      await analyzeCategoryPerformance(supabaseClient, userId);
      return new Response(JSON.stringify({ success: true, insights }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (action === 'update_category_performance') {
      await analyzeCategoryPerformance(supabaseClient, userId);
      return new Response(JSON.stringify({ success: true, message: 'Category performance updated' }), {
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
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function analyzeAndLearn(supabaseClient: any, userId: string) {
  console.log('🔍 Starting enhanced analysis and learning process...');
  
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

  // Get new data sources for enhanced analysis
  const { data: priceData } = await supabaseClient
    .from('price_data')
    .select('*')
    .eq('user_id', userId)
    .order('timestamp', { ascending: false })
    .limit(200);

  const { data: newsData } = await supabaseClient
    .from('crypto_news')
    .select('*')
    .eq('user_id', userId)
    .order('timestamp', { ascending: false })
    .limit(100);

  const { data: historicalData } = await supabaseClient
    .from('historical_market_data')
    .select('*')
    .eq('user_id', userId)
    .order('timestamp', { ascending: false })
    .limit(500);

  const { data: liveSignals } = await supabaseClient
    .from('live_signals')
    .select('*')
    .eq('user_id', userId)
    .order('timestamp', { ascending: false })
    .limit(50);

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

  // 5. Enhanced Analysis with New Data Sources
  if (priceData && priceData.length > 0) {
    const pricePatternInsight = analyzePricePatterns(priceData, allTrades);
    if (pricePatternInsight) {
      insights.push(pricePatternInsight);
      await saveInsight(supabaseClient, userId, pricePatternInsight);
    }
  }

  if (newsData && newsData.length > 0) {
    const sentimentInsight = analyzeSentimentCorrelation(newsData, allTrades);
    if (sentimentInsight) {
      insights.push(sentimentInsight);
      await saveInsight(supabaseClient, userId, sentimentInsight);
    }
  }

  if (historicalData && historicalData.length > 0) {
    const historicalPatternInsight = analyzeHistoricalPatterns(historicalData, allTrades);
    if (historicalPatternInsight) {
      insights.push(historicalPatternInsight);
      await saveInsight(supabaseClient, userId, historicalPatternInsight);
    }
  }

  if (liveSignals && liveSignals.length > 0) {
    const signalEffectivenessInsight = analyzeSignalEffectiveness(liveSignals, allTrades);
    if (signalEffectivenessInsight) {
      insights.push(signalEffectivenessInsight);
      await saveInsight(supabaseClient, userId, signalEffectivenessInsight);
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

async function analyzeCategoryPerformance(supabaseClient: any, userId: string) {
  console.log('📊 Analyzing category performance...');
  
  // Get enabled categories
  const { data: categories } = await supabaseClient
    .from('ai_data_categories')
    .select('*')
    .eq('is_enabled', true);

  if (!categories || categories.length === 0) {
    console.log('No enabled categories found');
    return;
  }

  // Get recent trades (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: trades } = await supabaseClient
    .from('mock_trades')
    .select('*')
    .eq('user_id', userId)
    .gte('executed_at', thirtyDaysAgo.toISOString())
    .order('executed_at', { ascending: false });

  if (!trades || trades.length === 0) {
    console.log('No recent trades found for analysis');
    return;
  }

  // Get external market data with category context
  const { data: marketData } = await supabaseClient
    .from('external_market_data')
    .select(`
      *,
      ai_data_sources!inner(
        category_id,
        ai_data_categories!inner(*)
      )
    `)
    .gte('timestamp', thirtyDaysAgo.toISOString());

  // Analyze correlation between categories and trade performance
  for (const category of categories) {
    const categoryData = marketData?.filter((d: any) => 
      d.ai_data_sources?.ai_data_categories?.id === category.id
    ) || [];

    if (categoryData.length === 0) continue;

    // Find trades that occurred within time windows of category signals
    const categoryInfluencedTrades = [];
    
    for (const trade of trades) {
      const tradeTime = new Date(trade.executed_at);
      
      // Look for category signals within 4 hours before the trade
      const relevantSignals = categoryData.filter(signal => {
        const signalTime = new Date(signal.timestamp);
        const timeDiff = tradeTime.getTime() - signalTime.getTime();
        return timeDiff >= 0 && timeDiff <= 4 * 60 * 60 * 1000; // 4 hours
      });

      if (relevantSignals.length > 0) {
        categoryInfluencedTrades.push({
          ...trade,
          categorySignals: relevantSignals
        });
      }
    }

    if (categoryInfluencedTrades.length === 0) continue;

    // Calculate performance metrics for this category
    const winningTrades = categoryInfluencedTrades.filter(t => (t.profit_loss || 0) > 0);
    const totalTrades = categoryInfluencedTrades.length;
    const winRate = winningTrades.length / totalTrades;
    const profitImpact = categoryInfluencedTrades.reduce((sum, t) => sum + (t.profit_loss || 0), 0);

    // Calculate influence weight based on performance
    const marketCondition = determineMarketCondition(categoryData);
    const accuracyScore = calculateAccuracyScore(categoryInfluencedTrades, categoryData);
    const influenceWeight = calculateInfluenceWeight(winRate, profitImpact, totalTrades);

    // Store category performance data
    await supabaseClient
      .from('ai_category_performance')
      .insert({
        category_id: category.id,
        user_id: userId,
        period_start: thirtyDaysAgo.toISOString(),
        period_end: new Date().toISOString(),
        winning_trades: winningTrades.length,
        total_trades: totalTrades,
        profit_impact: profitImpact,
        accuracy_score: accuracyScore,
        influence_weight: influenceWeight,
        market_condition: marketCondition
      });

    // Update category importance and confidence scores
    await supabaseClient
      .from('ai_data_categories')
      .update({
        importance_score: Math.max(0.1, Math.min(1.0, category.importance_score + (influenceWeight - 0.5) * 0.1)),
        confidence_level: Math.max(0.1, Math.min(1.0, accuracyScore)),
        last_performance_update: new Date().toISOString()
      })
      .eq('id', category.id);

    console.log(`📈 Category "${category.category_name}": ${winRate.toFixed(2)} win rate, €${profitImpact.toFixed(2)} impact`);
  }

  console.log('✅ Category performance analysis complete');
}

function determineMarketCondition(marketData: any[]) {
  // Simple market condition determination based on recent data trends
  if (!marketData.length) return 'neutral';
  
  const recentData = marketData.slice(-10);
  const avgValue = recentData.reduce((sum, d) => sum + (d.data_value || 0), 0) / recentData.length;
  
  if (avgValue > 70) return 'bullish';
  if (avgValue < 30) return 'bearish';
  return 'neutral';
}

function calculateAccuracyScore(trades: any[], signals: any[]) {
  // Calculate how accurately the category signals predicted trade outcomes
  const correctPredictions = trades.filter(trade => {
    const tradeProfit = trade.profit_loss || 0;
    const relevantSignals = trade.categorySignals || [];
    
    if (relevantSignals.length === 0) return false;
    
    // Check if signals correctly indicated trade direction
    const bullishSignals = relevantSignals.filter((s: any) => 
      s.category_context?.market_impact === 'bullish' || s.data_value > 60
    );
    const bearishSignals = relevantSignals.filter((s: any) => 
      s.category_context?.market_impact === 'bearish' || s.data_value < 40
    );
    
    if (bullishSignals.length > bearishSignals.length && tradeProfit > 0) return true;
    if (bearishSignals.length > bullishSignals.length && tradeProfit < 0) return true;
    
    return false;
  });

  return trades.length > 0 ? correctPredictions.length / trades.length : 0.5;
}

function calculateInfluenceWeight(winRate: number, profitImpact: number, totalTrades: number) {
  // Calculate how much this category should influence future trading decisions
  const winRateWeight = winRate * 0.4;
  const profitWeight = Math.min(1.0, Math.max(0.0, (profitImpact / 1000) + 0.5)) * 0.4;
  const volumeWeight = Math.min(1.0, totalTrades / 20) * 0.2;
  
  return Math.max(0.1, Math.min(1.0, winRateWeight + profitWeight + volumeWeight));
}

// ====== NEW ENHANCED ANALYSIS FUNCTIONS ======

function analyzePricePatterns(priceData: any[], trades: any[]) {
  if (!priceData || priceData.length < 10) return null;
  
  console.log('📊 Analyzing price patterns...');
  
  // Group price data by symbol
  const symbolData = priceData.reduce((acc, data) => {
    if (!acc[data.symbol]) acc[data.symbol] = [];
    acc[data.symbol].push(data);
    return acc;
  }, {});
  
  const patterns = [];
  
  for (const [symbol, prices] of Object.entries(symbolData)) {
    const sortedPrices = (prices as any[]).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    
    if (sortedPrices.length < 5) continue;
    
    // Detect breakout patterns
    const recent = sortedPrices.slice(-5);
    const priceChanges = recent.map((p, i) => i === 0 ? 0 : ((p.close_price - recent[i-1].close_price) / recent[i-1].close_price) * 100);
    const avgChange = priceChanges.reduce((sum, change) => sum + change, 0) / priceChanges.length;
    
    if (Math.abs(avgChange) > 3) {
      patterns.push({
        symbol,
        pattern: avgChange > 0 ? 'bullish_breakout' : 'bearish_breakout',
        strength: Math.abs(avgChange),
        confidence: Math.min(0.9, 0.5 + Math.abs(avgChange) / 20)
      });
    }
  }
  
  if (patterns.length > 0) {
    const strongestPattern = patterns.sort((a, b) => b.strength - a.strength)[0];
    
    return {
      type: 'price_pattern',
      title: 'Price Pattern Analysis',
      content: `Detected ${strongestPattern.pattern} pattern in ${strongestPattern.symbol} with ${strongestPattern.strength.toFixed(1)}% strength. This pattern historically correlates with ${strongestPattern.pattern.includes('bullish') ? 'positive' : 'negative'} trade outcomes.`,
      confidence: strongestPattern.confidence,
      dataPoints: priceData.length,
      metadata: { patterns, strongestPattern }
    };
  }
  
  return null;
}

function analyzeSentimentCorrelation(newsData: any[], trades: any[]) {
  if (!newsData || newsData.length < 5) return null;
  
  console.log('📰 Analyzing sentiment correlation...');
  
  // Find trades that occurred within 4 hours after news
  const correlatedTrades = [];
  
  for (const trade of trades) {
    const tradeTime = new Date(trade.executed_at);
    
    // Look for news within 4 hours before the trade
    const relevantNews = newsData.filter(news => {
      if (news.symbol !== trade.cryptocurrency) return false;
      
      const newsTime = new Date(news.timestamp);
      const timeDiff = tradeTime.getTime() - newsTime.getTime();
      return timeDiff >= 0 && timeDiff <= 4 * 60 * 60 * 1000; // 4 hours
    });
    
    if (relevantNews.length > 0) {
      const avgSentiment = relevantNews.reduce((sum, news) => sum + (news.sentiment_score || 0.5), 0) / relevantNews.length;
      correlatedTrades.push({
        ...trade,
        sentiment: avgSentiment,
        newsCount: relevantNews.length
      });
    }
  }
  
  if (correlatedTrades.length >= 3) {
    const positiveSentimentTrades = correlatedTrades.filter(t => t.sentiment > 0.6);
    const negativeSentimentTrades = correlatedTrades.filter(t => t.sentiment < 0.4);
    
    const positiveProfitRate = positiveSentimentTrades.length > 0 
      ? positiveSentimentTrades.filter(t => (t.profit_loss || 0) > 0).length / positiveSentimentTrades.length 
      : 0;
    
    const negativeProfitRate = negativeSentimentTrades.length > 0 
      ? negativeSentimentTrades.filter(t => (t.profit_loss || 0) > 0).length / negativeSentimentTrades.length 
      : 0;
    
    if (Math.abs(positiveProfitRate - negativeProfitRate) > 0.2) {
      return {
        type: 'sentiment_correlation',
        title: 'News Sentiment Trading Correlation',
        content: `Strong correlation detected: Positive sentiment news leads to ${(positiveProfitRate * 100).toFixed(1)}% profitable trades vs ${(negativeProfitRate * 100).toFixed(1)}% for negative sentiment. Consider weighting sentiment analysis in trading decisions.`,
        confidence: 0.8,
        dataPoints: correlatedTrades.length,
        metadata: { 
          positiveProfitRate, 
          negativeProfitRate, 
          correlatedTrades: correlatedTrades.length,
          totalNews: newsData.length
        }
      };
    }
  }
  
  return null;
}

function analyzeHistoricalPatterns(historicalData: any[], trades: any[]) {
  if (!historicalData || historicalData.length < 50) return null;
  
  console.log('📈 Analyzing historical patterns...');
  
  // Group historical data by symbol
  const symbolData = historicalData.reduce((acc, data) => {
    if (!acc[data.symbol]) acc[data.symbol] = [];
    acc[data.symbol].push(data);
    return acc;
  }, {});
  
  const insights = [];
  
  for (const [symbol, data] of Object.entries(symbolData)) {
    const sortedData = (data as any[]).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    
    if (sortedData.length < 30) continue;
    
    // Calculate historical volatility
    const prices = sortedData.map(d => d.price);
    const returns = prices.slice(1).map((price, i) => (price - prices[i]) / prices[i]);
    const volatility = Math.sqrt(returns.reduce((sum, r) => sum + r * r, 0) / returns.length) * Math.sqrt(252) * 100;
    
    // Find trades in this symbol
    const symbolTrades = trades.filter(t => t.cryptocurrency === symbol);
    
    if (symbolTrades.length >= 2) {
      const avgProfit = symbolTrades.reduce((sum, t) => sum + (t.profit_loss || 0), 0) / symbolTrades.length;
      
      insights.push({
        symbol,
        volatility,
        avgProfit,
        tradeCount: symbolTrades.length,
        riskAdjustedReturn: avgProfit / volatility
      });
    }
  }
  
  if (insights.length > 0) {
    const bestRiskAdjusted = insights.sort((a, b) => b.riskAdjustedReturn - a.riskAdjustedReturn)[0];
    
    return {
      type: 'historical_pattern',
      title: 'Historical Risk-Return Analysis',
      content: `Based on historical data, ${bestRiskAdjusted.symbol} shows the best risk-adjusted returns (${bestRiskAdjusted.riskAdjustedReturn.toFixed(3)}) with ${bestRiskAdjusted.volatility.toFixed(1)}% volatility. Historical patterns suggest focusing on low-volatility, consistent performers.`,
      confidence: 0.7,
      dataPoints: historicalData.length,
      metadata: { insights, bestPerformer: bestRiskAdjusted }
    };
  }
  
  return null;
}

function analyzeSignalEffectiveness(liveSignals: any[], trades: any[]) {
  if (!liveSignals || liveSignals.length < 5) return null;
  
  console.log('🚨 Analyzing signal effectiveness...');
  
  // Find trades that occurred within 1 hour after signals
  const signalTriggeredTrades = [];
  
  for (const trade of trades) {
    const tradeTime = new Date(trade.executed_at);
    
    // Look for signals within 1 hour before the trade
    const relevantSignals = liveSignals.filter(signal => {
      if (signal.symbol !== trade.cryptocurrency) return false;
      
      const signalTime = new Date(signal.timestamp);
      const timeDiff = tradeTime.getTime() - signalTime.getTime();
      return timeDiff >= 0 && timeDiff <= 60 * 60 * 1000; // 1 hour
    });
    
    if (relevantSignals.length > 0) {
      signalTriggeredTrades.push({
        ...trade,
        signals: relevantSignals,
        avgSignalStrength: relevantSignals.reduce((sum, s) => sum + s.signal_strength, 0) / relevantSignals.length
      });
    }
  }
  
  if (signalTriggeredTrades.length >= 3) {
    const strongSignalTrades = signalTriggeredTrades.filter(t => t.avgSignalStrength > 70);
    const weakSignalTrades = signalTriggeredTrades.filter(t => t.avgSignalStrength < 30);
    
    const strongSignalProfitRate = strongSignalTrades.length > 0 
      ? strongSignalTrades.filter(t => (t.profit_loss || 0) > 0).length / strongSignalTrades.length 
      : 0;
    
    const weakSignalProfitRate = weakSignalTrades.length > 0 
      ? weakSignalTrades.filter(t => (t.profit_loss || 0) > 0).length / weakSignalTrades.length 
      : 0;
    
    if (strongSignalProfitRate > weakSignalProfitRate + 0.2) {
      return {
        type: 'signal_effectiveness',
        title: 'Live Signal Performance Analysis',
        content: `Strong signals (>70 strength) lead to ${(strongSignalProfitRate * 100).toFixed(1)}% profitable trades vs ${(weakSignalProfitRate * 100).toFixed(1)}% for weak signals. Focus on high-strength signals for better trade outcomes.`,
        confidence: 0.8,
        dataPoints: signalTriggeredTrades.length,
        metadata: { 
          strongSignalProfitRate, 
          weakSignalProfitRate, 
          signalTriggeredTrades: signalTriggeredTrades.length,
          totalSignals: liveSignals.length
        }
      };
    }
  }
  
  return null;
}