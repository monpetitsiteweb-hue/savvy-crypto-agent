import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { action, symbols, timeframe = '24h', userId } = await req.json();
    console.log(`🧠 AI Correlation Engine received:`, { action, symbols, timeframe, userId });

    switch (action) {
      case 'analyze_correlations':
        return await analyzeCorrelations(supabaseClient, { symbols, timeframe, userId });
      
      case 'generate_insights':
        return await generateInsights(supabaseClient, { symbols, timeframe, userId });
      
      case 'update_learning_metrics':
        return await updateLearningMetrics(supabaseClient, { userId });
      
      default:
        return new Response(JSON.stringify({ error: 'Invalid action' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
  } catch (error) {
    console.error('❌ AI Correlation Engine error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function analyzeCorrelations(supabaseClient: any, params: any) {
  const { symbols = ['BTC-EUR', 'ETH-EUR', 'XRP-EUR'], timeframe, userId } = params;
  
  console.log(`🔍 Analyzing correlations for symbols: ${symbols.join(', ')}, timeframe: ${timeframe}`);
  
  // Calculate time window
  const hours = timeframe === '1h' ? 1 : timeframe === '24h' ? 24 : 168;
  const timeWindow = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  
  const correlations = [];
  
  for (const symbol of symbols) {
    const newsSymbol = symbol.split('-')[0];
    
    // Get recent news sentiment
    const { data: newsData } = await supabaseClient
      .from('crypto_news')
      .select('*')
      .eq('user_id', userId)
      .eq('symbol', newsSymbol)
      .gte('timestamp', timeWindow)
      .order('timestamp', { ascending: false });
    
    // Get recent price data
    const { data: priceData } = await supabaseClient
      .from('price_data')
      .select('*')
      .eq('user_id', userId)
      .eq('symbol', symbol)
      .gte('timestamp', timeWindow)
      .order('timestamp', { ascending: false });
    
    // Get recent signals
    const { data: signalsData } = await supabaseClient
      .from('live_signals')
      .select('*')
      .eq('user_id', userId)
      .eq('symbol', newsSymbol)
      .gte('timestamp', timeWindow)
      .order('timestamp', { ascending: false });
    
    if (newsData && priceData && newsData.length > 0 && priceData.length > 0) {
      const correlation = calculateNewsToPriceCorrelation(newsData, priceData);
      
      correlations.push({
        symbol: symbol,
        correlation_type: 'news_to_price',
        correlation_strength: correlation.strength,
        confidence_score: correlation.confidence,
        data_points: correlation.dataPoints,
        timeframe: timeframe,
        analysis_results: {
          avg_sentiment: correlation.avgSentiment,
          avg_price_change: correlation.avgPriceChange,
          correlation_coefficient: correlation.coefficient,
          significant_events: correlation.significantEvents
        }
      });
    }
    
    if (signalsData && signalsData.length > 0) {
      const signalAnalysis = analyzeSignalPatterns(signalsData, priceData || []);
      
      correlations.push({
        symbol: symbol,
        correlation_type: 'signals_to_outcomes',
        correlation_strength: signalAnalysis.accuracy,
        confidence_score: signalAnalysis.confidence,
        data_points: signalAnalysis.dataPoints,
        timeframe: timeframe,
        analysis_results: {
          signal_accuracy: signalAnalysis.accuracy,
          false_positive_rate: signalAnalysis.falsePositiveRate,
          most_reliable_signal_type: signalAnalysis.mostReliableSignal,
          pattern_insights: signalAnalysis.patterns
        }
      });
    }
  }
  
  // Store correlation insights
  if (correlations.length > 0) {
    const insights = correlations.map(corr => ({
      user_id: userId,
      knowledge_type: 'correlation_analysis',
      title: `${corr.correlation_type} correlation for ${corr.symbol}`,
      content: JSON.stringify(corr.analysis_results),
      confidence_score: corr.confidence_score,
      data_points: corr.data_points,
      metadata: {
        symbol: corr.symbol,
        correlation_type: corr.correlation_type,
        timeframe: timeframe,
        analysis_date: new Date().toISOString()
      }
    }));
    
    const { error } = await supabaseClient
      .from('ai_knowledge_base')
      .upsert(insights, { ignoreDuplicates: true });
    
    if (error) {
      console.error('❌ Error storing correlation insights:', error);
    } else {
      console.log(`✅ Stored ${insights.length} correlation insights`);
    }
  }
  
  return new Response(JSON.stringify({ 
    success: true,
    correlations_analyzed: correlations.length,
    correlations: correlations,
    message: 'Correlation analysis completed'
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

function calculateNewsToPriceCorrelation(newsData: any[], priceData: any[]) {
  // Group news and price data by time buckets (1-hour intervals)
  const timeBuckets = new Map();
  
  // Process news data
  newsData.forEach(news => {
    const hourBucket = new Date(news.timestamp);
    hourBucket.setMinutes(0, 0, 0);
    const bucketKey = hourBucket.toISOString();
    
    if (!timeBuckets.has(bucketKey)) {
      timeBuckets.set(bucketKey, { sentiment: [], priceChanges: [] });
    }
    
    timeBuckets.get(bucketKey).sentiment.push(news.sentiment_score);
  });
  
  // Process price data
  priceData.forEach((price, index) => {
    if (index === 0) return; // Skip first item as we need previous price
    
    const hourBucket = new Date(price.timestamp);
    hourBucket.setMinutes(0, 0, 0);
    const bucketKey = hourBucket.toISOString();
    
    const priceChange = ((price.close_price - price.open_price) / price.open_price) * 100;
    
    if (timeBuckets.has(bucketKey)) {
      timeBuckets.get(bucketKey).priceChanges.push(priceChange);
    }
  });
  
  // Calculate correlation
  const validBuckets = Array.from(timeBuckets.entries())
    .filter(([_, data]) => data.sentiment.length > 0 && data.priceChanges.length > 0)
    .map(([bucket, data]) => ({
      bucket,
      avgSentiment: data.sentiment.reduce((sum, s) => sum + s, 0) / data.sentiment.length,
      avgPriceChange: data.priceChanges.reduce((sum, p) => sum + p, 0) / data.priceChanges.length
    }));
  
  if (validBuckets.length < 3) {
    return {
      strength: 0,
      confidence: 0,
      dataPoints: validBuckets.length,
      avgSentiment: 0.5,
      avgPriceChange: 0,
      coefficient: 0,
      significantEvents: []
    };
  }
  
  // Calculate Pearson correlation coefficient
  const n = validBuckets.length;
  const sentiments = validBuckets.map(b => b.avgSentiment);
  const priceChanges = validBuckets.map(b => b.avgPriceChange);
  
  const sentimentMean = sentiments.reduce((sum, s) => sum + s, 0) / n;
  const priceMean = priceChanges.reduce((sum, p) => sum + p, 0) / n;
  
  let numerator = 0;
  let sentimentSumSq = 0;
  let priceSumSq = 0;
  
  for (let i = 0; i < n; i++) {
    const sentimentDiff = sentiments[i] - sentimentMean;
    const priceDiff = priceChanges[i] - priceMean;
    
    numerator += sentimentDiff * priceDiff;
    sentimentSumSq += sentimentDiff * sentimentDiff;
    priceSumSq += priceDiff * priceDiff;
  }
  
  const denominator = Math.sqrt(sentimentSumSq * priceSumSq);
  const correlation = denominator === 0 ? 0 : numerator / denominator;
  
  // Find significant events
  const significantEvents = validBuckets
    .filter(b => Math.abs(b.avgPriceChange) > 3 || Math.abs(b.avgSentiment - 0.5) > 0.3)
    .map(b => ({
      timestamp: b.bucket,
      sentiment: b.avgSentiment,
      price_change: b.avgPriceChange
    }));
  
  return {
    strength: Math.abs(correlation),
    confidence: Math.min(n / 10, 1), // Confidence increases with more data points
    dataPoints: n,
    avgSentiment: sentimentMean,
    avgPriceChange: priceMean,
    coefficient: correlation,
    significantEvents
  };
}

function analyzeSignalPatterns(signalsData: any[], priceData: any[]) {
  let correctPredictions = 0;
  let totalSignals = signalsData.length;
  
  const signalTypes = new Map();
  
  signalsData.forEach(signal => {
    const signalType = signal.signal_type;
    if (!signalTypes.has(signalType)) {
      signalTypes.set(signalType, { total: 0, correct: 0 });
    }
    
    signalTypes.get(signalType).total++;
    
    // Find price movement after signal (simplified)
    const signalTime = new Date(signal.timestamp);
    const futurePrice = priceData.find(p => 
      new Date(p.timestamp) > signalTime && 
      new Date(p.timestamp) <= new Date(signalTime.getTime() + 3600000) // 1 hour later
    );
    
    if (futurePrice) {
      const wasCorrect = validateSignalPrediction(signal, futurePrice);
      if (wasCorrect) {
        correctPredictions++;
        signalTypes.get(signalType).correct++;
      }
    }
  });
  
  const accuracy = totalSignals > 0 ? correctPredictions / totalSignals : 0;
  const falsePositiveRate = 1 - accuracy;
  
  // Find most reliable signal type
  let mostReliableSignal = 'none';
  let bestAccuracy = 0;
  
  signalTypes.forEach((stats, type) => {
    const typeAccuracy = stats.total > 0 ? stats.correct / stats.total : 0;
    if (typeAccuracy > bestAccuracy && stats.total >= 3) {
      bestAccuracy = typeAccuracy;
      mostReliableSignal = type;
    }
  });
  
  return {
    accuracy,
    confidence: Math.min(totalSignals / 20, 1),
    dataPoints: totalSignals,
    falsePositiveRate,
    mostReliableSignal,
    patterns: Array.from(signalTypes.entries()).map(([type, stats]) => ({
      signal_type: type,
      accuracy: stats.total > 0 ? stats.correct / stats.total : 0,
      sample_size: stats.total
    }))
  };
}

function validateSignalPrediction(signal: any, futurePrice: any): boolean {
  const signalType = signal.signal_type;
  const priceChange = ((futurePrice.close_price - futurePrice.open_price) / futurePrice.open_price) * 100;
  
  switch (signalType) {
    case 'sentiment_bullish':
    case 'price_surge':
      return priceChange > 1; // Expecting price increase
    case 'sentiment_bearish':
    case 'price_drop':
      return priceChange < -1; // Expecting price decrease
    case 'volume_spike':
    case 'news_volume_spike':
      return Math.abs(priceChange) > 2; // Expecting volatility
    default:
      return false;
  }
}

async function generateInsights(supabaseClient: any, params: any) {
  const { symbols, timeframe, userId } = params;
  
  console.log(`💡 Generating AI insights for user: ${userId}`);
  
  // Get recent correlations from knowledge base
  const { data: correlations } = await supabaseClient
    .from('ai_knowledge_base')
    .select('*')
    .eq('user_id', userId)
    .eq('knowledge_type', 'correlation_analysis')
    .order('created_at', { ascending: false })
    .limit(10);
  
  if (!correlations || correlations.length === 0) {
    return new Response(JSON.stringify({ 
      message: 'No correlation data available for insights generation'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  
  // Generate actionable insights
  const insights = correlations.map(corr => {
    const content = JSON.parse(corr.content);
    let insight = '';
    
    if (corr.metadata.correlation_type === 'news_to_price') {
      if (content.correlation_coefficient > 0.5) {
        insight = `Strong positive correlation detected between news sentiment and price movement for ${corr.metadata.symbol}. When sentiment is above 0.7, consider bullish positions.`;
      } else if (content.correlation_coefficient < -0.5) {
        insight = `Inverse correlation detected for ${corr.metadata.symbol}. Market may be contrarian to news sentiment.`;
      } else {
        insight = `Weak correlation between news and price for ${corr.metadata.symbol}. Consider other indicators.`;
      }
    } else if (corr.metadata.correlation_type === 'signals_to_outcomes') {
      if (content.signal_accuracy > 0.7) {
        insight = `High accuracy signals detected for ${corr.metadata.symbol}. ${content.most_reliable_signal_type} signals are ${(content.signal_accuracy * 100).toFixed(1)}% accurate.`;
      } else {
        insight = `Signal accuracy for ${corr.metadata.symbol} is low (${(content.signal_accuracy * 100).toFixed(1)}%). Review signal thresholds.`;
      }
    }
    
    return {
      symbol: corr.metadata.symbol,
      insight_type: corr.metadata.correlation_type,
      insight,
      confidence: corr.confidence_score,
      data_support: corr.data_points,
      generated_at: new Date().toISOString()
    };
  });
  
  return new Response(JSON.stringify({ 
    success: true,
    insights_generated: insights.length,
    insights,
    message: 'AI insights generated successfully'
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

async function updateLearningMetrics(supabaseClient: any, params: any) {
  const { userId } = params;
  
  console.log(`📊 Updating learning metrics for user: ${userId}`);
  
  const now = new Date();
  const periodStart = new Date(now.getTime() - 24 * 60 * 60 * 1000); // Last 24 hours
  
  // Count insights generated
  const { data: insightsCount } = await supabaseClient
    .from('ai_knowledge_base')
    .select('id', { count: 'exact' })
    .eq('user_id', userId)
    .gte('created_at', periodStart.toISOString());
  
  // Count signals processed
  const { data: signalsCount } = await supabaseClient
    .from('live_signals')
    .select('id', { count: 'exact' })
    .eq('user_id', userId)
    .gte('timestamp', periodStart.toISOString());
  
  const metrics = {
    user_id: userId,
    metric_type: 'daily_learning_summary',
    metric_value: insightsCount?.length || 0,
    period_start: periodStart.toISOString(),
    period_end: now.toISOString(),
    insights_generated: insightsCount?.length || 0,
    trades_analyzed: signalsCount?.length || 0
  };
  
  const { error } = await supabaseClient
    .from('ai_learning_metrics')
    .upsert([metrics], { ignoreDuplicates: true });
  
  if (error) {
    console.error('❌ Error updating learning metrics:', error);
    throw error;
  }
  
  console.log(`✅ Learning metrics updated successfully`);
  
  return new Response(JSON.stringify({ 
    success: true,
    metrics,
    message: 'Learning metrics updated successfully'
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}