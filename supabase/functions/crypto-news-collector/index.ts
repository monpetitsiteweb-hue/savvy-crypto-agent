// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// =============================================================================
// CRYPTO NEWS COLLECTOR
// Fetches crypto news from CryptoNews API, analyzes sentiment, and generates
// trading signals into live_signals table.
//
// FIX (Dec 2024): Added fallback user_id resolution when source.user_id is NULL.
// System-level sources have user_id = NULL but crypto_news and live_signals
// tables require NOT NULL user_id.
// =============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { action, symbols = ['BTC', 'ETH', 'SOL', 'XRP'], hours = 24, userId, sourceId, limit = 50 } = await req.json();
    console.log(`📰 CryptoNews Collector received:`, { action, symbols, hours, userId });

    // FIX: Use .limit(1) instead of .single() to handle potential duplicates
    const { data: dataSources } = await supabaseClient
      .from('ai_data_sources')
      .select('*')
      .eq('source_name', 'cryptonews_api')
      .eq('is_active', true)
      .limit(1);

    const dataSource = dataSources?.[0];

    if (!dataSource?.configuration?.api_key) {
      throw new Error('CryptoNews API key not found in configuration');
    }

    // FIX: Resolve user_id from multiple fallback sources
    let resolvedUserId = userId || dataSource.user_id;
    
    if (!resolvedUserId) {
      console.log('⚠️ No userId from request or source, finding active trading user...');
      const { data: activeUsers } = await supabaseClient
        .from('trading_strategies')
        .select('user_id')
        .or('is_active_test.eq.true,is_active.eq.true')
        .limit(1);
      
      if (activeUsers && activeUsers.length > 0) {
        resolvedUserId = activeUsers[0].user_id;
        console.log(`✅ Using active trading user: ${resolvedUserId}`);
      } else {
        resolvedUserId = '25a0c221-1f0e-431d-8d79-db9fb4db9cb3'; // Known system user
        console.log(`⚠️ Using fallback system user: ${resolvedUserId}`);
      }
    }

    const actualSourceId = sourceId || dataSource.id;
    const cryptoNewsApiKey = dataSource.configuration.api_key;

    console.log(`👤 Using userId: ${resolvedUserId}, sourceId: ${actualSourceId}`);

    switch (action) {
      case 'fetch_latest_news':
        return await fetchLatestNews(supabaseClient, cryptoNewsApiKey, { 
          symbols, 
          hours, 
          userId: resolvedUserId, 
          sourceId: actualSourceId 
        });
      
      case 'analyze_sentiment':
        return await analyzeSentiment(supabaseClient, { 
          symbols, 
          hours, 
          userId: resolvedUserId, 
          sourceId: actualSourceId 
        });
      
      default:
        return new Response(JSON.stringify({ error: 'Invalid action' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
  } catch (error) {
    console.error('❌ CryptoNews Collector error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function fetchLatestNews(supabaseClient: any, apiKey: string, params: any) {
  const { symbols, hours = 24, userId, sourceId } = params;
  
  console.log(`📡 Fetching CryptoNews for symbols: ${symbols?.join(', ')} over last ${hours} hours`);
  console.log(`👤 Will insert with userId: ${userId}`);
  
  try {
    const newsData = [];
    const symbolsArray = Array.isArray(symbols) ? symbols : ['BTC', 'ETH', 'SOL'];
    
    for (const symbol of symbolsArray) {
      try {
        const newsSymbol = symbol.split('-')[0];
        const apiUrl1 = `https://cryptonews-api.com/api/v1/category?section=general&items=3&page=1&token=${apiKey}&q=${newsSymbol}`;
        
        console.log(`🔗 Trying CryptoNews API for ${newsSymbol}`);
        console.log(`📡 Method 1 URL: ${apiUrl1.replace(apiKey, 'XXX')}`);
        
        let response;
        
        try {
          response = await fetch(apiUrl1, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'TradingBot/1.0'
            }
          });
          
          console.log(`📡 Method 1 Response: ${response.status} ${response.statusText}`);
          
          if (!response.ok) {
            console.error(`❌ API failed for ${symbol}: ${response.status}`);
            continue;
          }
        } catch (fetchError) {
          console.error(`❌ Network error for ${symbol}:`, fetchError);
          continue;
        }
        
        const apiNewsData = await response.json();
        
        if (apiNewsData.data && Array.isArray(apiNewsData.data)) {
          for (const article of apiNewsData.data) {
            const sentimentScore = calculateSentimentScore(article.title + ' ' + (article.text || ''));
            
            newsData.push({
              source_id: sourceId,
              user_id: userId, // FIX: Always use resolved userId
              timestamp: new Date(article.date).toISOString(),
              symbol: newsSymbol,
              headline: article.title,
              content: article.text || '',
              source_name: article.source_name || 'CryptoNews API',
              news_type: 'general',
              sentiment_score: sentimentScore,
              url: article.news_url,
              author: article.source_name,
              metadata: {
                collection_time: new Date().toISOString(),
                api_source: 'cryptonews_api',
                image_url: article.image_url,
                ranking: article.ranking
              }
            });
          }
          
          console.log(`✅ Fetched ${apiNewsData.data.length} news articles for ${newsSymbol}`);
        } else {
          console.log(`⚠️ No news data returned for ${symbol}`);
        }
        
      } catch (error) {
        console.error(`Error fetching news for ${symbol}:`, error);
      }
    }

    // Insert news data with conflict resolution
    if (newsData.length > 0) {
      const { data, error } = await supabaseClient
        .from('crypto_news')
        .upsert(newsData, { 
          onConflict: 'headline,timestamp,source_name',
          ignoreDuplicates: true 
        });

      if (error) {
        console.error('❌ Error inserting news data:', error);
        throw error;
      }
      
      console.log(`✅ Inserted ${newsData.length} news articles`);
    }

    // Generate live signals based on sentiment analysis
    const signals = await generateSentimentSignals(supabaseClient, newsData, userId, sourceId);
    
    // Update last_sync timestamp
    await supabaseClient
      .from('ai_data_sources')
      .update({ last_sync: new Date().toISOString() })
      .eq('id', sourceId);
    
    console.log(`✅ Successfully inserted ${newsData.length} news articles and ${signals.length} signals`);
    
    return new Response(JSON.stringify({ 
      success: true, 
      newsInserted: newsData.length,
      signalsGenerated: signals.length,
      userId: userId,
      message: 'News data and sentiment signals created successfully'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('❌ Error fetching news:', error);
    throw error;
  }
}

function calculateSentimentScore(text: string): number {
  const positiveWords = [
    'bullish', 'surge', 'rise', 'increase', 'gain', 'profit', 'bull', 'up', 'high',
    'breakthrough', 'success', 'adoption', 'growth', 'rally', 'moon', 'pump',
    'positive', 'optimistic', 'buy', 'invest', 'opportunity', 'breakthrough'
  ];
  
  const negativeWords = [
    'bearish', 'crash', 'fall', 'decrease', 'loss', 'bear', 'down', 'low',
    'decline', 'dump', 'sell', 'fear', 'panic', 'risk', 'regulation',
    'negative', 'pessimistic', 'concern', 'warning', 'drop', 'plunge'
  ];
  
  const words = text.toLowerCase().split(/\s+/);
  let score = 0.5;
  
  const positiveCount = words.filter(word => positiveWords.includes(word)).length;
  const negativeCount = words.filter(word => negativeWords.includes(word)).length;
  
  score += (positiveCount * 0.1) - (negativeCount * 0.1);
  
  return Math.max(0, Math.min(1, score));
}

async function generateSentimentSignals(supabaseClient: any, newsData: any[], userId: string, sourceId: string) {
  const signals: any[] = [];
  
  // Group news by symbol
  const symbolNews = newsData.reduce((acc, news) => {
    if (!acc[news.symbol]) acc[news.symbol] = [];
    acc[news.symbol].push(news);
    return acc;
  }, {} as Record<string, any[]>);
  
  for (const [symbol, articles] of Object.entries(symbolNews)) {
    const articleList = articles as any[];
    const avgSentiment = articleList.reduce((sum, article) => sum + article.sentiment_score, 0) / articleList.length;
    const newsVolume = articleList.length;
    
    console.log(`📊 Sentiment analysis for ${symbol}: avg=${avgSentiment.toFixed(3)}, volume=${newsVolume}`);
    
    const signalsToAdd: any[] = [];
    
    // Strong sentiment signals
    if (avgSentiment > 0.7) {
      signalsToAdd.push({
        signal_type: 'sentiment_bullish_strong',
        signal_strength: Math.min(100, avgSentiment * 100),
        description: 'Strong bullish sentiment detected'
      });
    } else if (avgSentiment < 0.3) {
      signalsToAdd.push({
        signal_type: 'sentiment_bearish_strong', 
        signal_strength: Math.min(100, (1 - avgSentiment) * 100),
        description: 'Strong bearish sentiment detected'
      });
    }
    
    // Moderate sentiment signals
    if (avgSentiment > 0.6 && avgSentiment <= 0.7) {
      signalsToAdd.push({
        signal_type: 'sentiment_bullish_moderate',
        signal_strength: Math.min(80, avgSentiment * 80),
        description: 'Moderate bullish sentiment detected'
      });
    } else if (avgSentiment < 0.4 && avgSentiment >= 0.3) {
      signalsToAdd.push({
        signal_type: 'sentiment_bearish_moderate',
        signal_strength: Math.min(80, (1 - avgSentiment) * 80),
        description: 'Moderate bearish sentiment detected'
      });
    }
    
    // News volume signals
    if (newsVolume >= 5) {
      signalsToAdd.push({
        signal_type: 'news_volume_high',
        signal_strength: Math.min(100, newsVolume * 15),
        description: 'High news volume detected'
      });
    } else if (newsVolume >= 3) {
      signalsToAdd.push({
        signal_type: 'news_volume_spike',
        signal_strength: Math.min(80, newsVolume * 20),
        description: 'News volume spike detected'
      });
    }
    
    // Create signals
    for (const signalConfig of signalsToAdd) {
      signals.push({
        source_id: sourceId,
        user_id: userId, // FIX: Always use resolved userId
        timestamp: new Date().toISOString(),
        symbol: symbol,
        signal_type: signalConfig.signal_type,
        signal_strength: signalConfig.signal_strength,
        source: 'crypto_news',
        data: {
          avg_sentiment: avgSentiment,
          news_count: newsVolume,
          time_window: '24h',
          recent_headlines: articleList.slice(0, 3).map(a => a.headline),
          description: signalConfig.description
        },
        processed: false
      });
      
      console.log(`📡 Generated signal: ${signalConfig.signal_type} for ${symbol}`);
    }
  }
  
  if (signals.length > 0) {
    const { error } = await supabaseClient
      .from('live_signals')
      .insert(signals);
    
    if (error) {
      console.error('❌ Error inserting sentiment signals:', error);
    } else {
      console.log(`✅ Inserted ${signals.length} sentiment signals`);
    }
  }
  
  return signals;
}

async function analyzeSentiment(supabaseClient: any, params: any) {
  const { symbols, hours = 24, userId, sourceId } = params;
  
  console.log(`🎯 Analyzing sentiment for symbols: ${symbols?.join(', ')} over last ${hours} hours`);
  
  const hoursAgo = new Date(Date.now() - hours * 60 * 60 * 1000);
  
  const { data: recentNews, error } = await supabaseClient
    .from('crypto_news')
    .select('*')
    .in('symbol', symbols.map((s: string) => s.split('-')[0]))
    .gte('timestamp', hoursAgo.toISOString())
    .eq('user_id', userId);
  
  if (error) {
    console.error('❌ Error fetching recent news:', error);
    throw error;
  }
  
  const sentimentAnalysis = symbols.map((symbol: string) => {
    const newsSymbol = symbol.split('-')[0];
    const symbolNews = recentNews?.filter((news: any) => news.symbol === newsSymbol) || [];
    
    if (symbolNews.length === 0) {
      return {
        symbol,
        avg_sentiment: 0.5,
        news_count: 0,
        trend: 'neutral'
      };
    }
    
    const avgSentiment = symbolNews.reduce((sum: number, news: any) => sum + news.sentiment_score, 0) / symbolNews.length;
    const trend = avgSentiment > 0.6 ? 'bullish' : avgSentiment < 0.4 ? 'bearish' : 'neutral';
    
    return {
      symbol,
      avg_sentiment: avgSentiment,
      news_count: symbolNews.length,
      trend,
      latest_headlines: symbolNews.slice(0, 3).map((n: any) => n.headline)
    };
  });
  
  return new Response(JSON.stringify({ 
    success: true, 
    sentiment_analysis: sentimentAnalysis,
    time_window: `${hours} hours`,
    message: 'Sentiment analysis completed'
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}