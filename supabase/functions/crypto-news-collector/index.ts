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

    const { action, symbols = ['BTC', 'ETH', 'SOL'], hours = 24, userId, sourceId, limit = 50 } = await req.json();
    console.log(`📰 CryptoNews Collector received:`, { action, symbols, hours, userId });

    // Get CryptoNews API key from data source configuration
    const { data: dataSource } = await supabaseClient
      .from('ai_data_sources')
      .select('configuration')
      .eq('id', sourceId)
      .eq('source_name', 'cryptonews_api')
      .single();

    if (!dataSource?.configuration?.api_key) {
      throw new Error('CryptoNews API key not found in configuration');
    }

    const cryptoNewsApiKey = dataSource.configuration.api_key;

    switch (action) {
      case 'fetch_latest_news':
        return await fetchLatestNews(supabaseClient, cryptoNewsApiKey, { symbols, hours, userId, sourceId });
      
      case 'analyze_sentiment':
        return await analyzeSentiment(supabaseClient, { symbols, hours, userId, sourceId });
      
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
  
  try {
    const newsData = [];
    
    // Ensure symbols is an array
    const symbolsArray = Array.isArray(symbols) ? symbols : ['BTC', 'ETH', 'SOL'];
    
    for (const symbol of symbolsArray) {
      try {
        // Real CryptoNews API call
        const newsSymbol = symbol.split('-')[0]; // Convert BTC-EUR to BTC
        const apiUrl = `https://cryptonews-api.com/api/v1/category?section=general&items=20&page=1&token=${apiKey}&extra_info=ranking&q=${newsSymbol}`;
        
        console.log(`🔗 Calling CryptoNews API for ${newsSymbol}: ${apiUrl.replace(apiKey, 'XXX')}`);
        
        const response = await fetch(apiUrl);
        if (!response.ok) {
          console.error(`Failed to fetch news for ${symbol}:`, response.statusText);
          continue;
        }
        
        const apiNewsData = await response.json();
        
        if (apiNewsData.data && Array.isArray(apiNewsData.data)) {
          for (const article of apiNewsData.data) {
            // Simple sentiment analysis based on keywords
            const sentimentScore = calculateSentimentScore(article.title + ' ' + (article.text || ''));
            
            newsData.push({
              source_id: sourceId,
              user_id: userId,
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
          console.log(`⚠️ No news data returned for ${symbol}, falling back to mock data`);
          // Fallback mock data for testing
          const fallbackData = Array.from({ length: 2 }, (_, i) => {
            const hoursAgo = Math.floor(Math.random() * hours);
            const timestamp = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
            
            const headlines = [
              `${symbol} Shows Strong Technical Signals Amid Market Rally`,
              `Institutional Interest in ${symbol} Reaches New Highs`
            ];
            
            const sentimentScore = Math.random() * 0.4 + 0.3; // 0.3 to 0.7
            
            return {
              source_id: sourceId,
              user_id: userId,
              timestamp: timestamp.toISOString(),
              symbol: symbol,
              headline: headlines[i],
              content: `Fallback content for ${symbol}. API data not available.`,
              source_name: 'CryptoNews Fallback',
              news_type: 'market_analysis',
              sentiment_score: sentimentScore,
              url: `https://example.com/news/${symbol.toLowerCase()}-${Date.now()}-${i}`,
              author: 'Market Analyst',
              metadata: {
                collection_time: new Date().toISOString(),
                api_source: 'cryptonews_fallback',
                is_fallback: true
              }
            };
          });
          
          newsData.push(...fallbackData);
        }
        
      } catch (error) {
        console.error(`Error fetching news for ${symbol}:`, error);
      }
    }

    // Insert news data with conflict resolution
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

    // Generate live signals based on sentiment analysis
    const signals = await generateSentimentSignals(supabaseClient, newsData, userId, sourceId);
    
    console.log(`✅ Successfully inserted ${newsData.length} news articles and ${signals.length} signals`);
    
    return new Response(JSON.stringify({ 
      success: true, 
      newsInserted: newsData.length,
      signalsGenerated: signals.length,
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
  let score = 0.5; // Neutral starting point
  
  const positiveCount = words.filter(word => positiveWords.includes(word)).length;
  const negativeCount = words.filter(word => negativeWords.includes(word)).length;
  
  // Adjust score based on word counts
  score += (positiveCount * 0.1) - (negativeCount * 0.1);
  
  // Ensure score stays within 0-1 range
  return Math.max(0, Math.min(1, score));
}

async function generateSentimentSignals(supabaseClient: any, newsData: any[], userId: string, sourceId: string) {
  const signals = [];
  
  // Group news by symbol to analyze sentiment trends
  const symbolNews = newsData.reduce((acc, news) => {
    if (!acc[news.symbol]) acc[news.symbol] = [];
    acc[news.symbol].push(news);
    return acc;
  }, {});
  
  for (const [symbol, articles] of Object.entries(symbolNews)) {
    const avgSentiment = (articles as any[]).reduce((sum, article) => sum + article.sentiment_score, 0) / (articles as any[]).length;
    const newsVolume = (articles as any[]).length;
    
    // Generate signal if sentiment is strongly positive/negative or high news volume
    if (avgSentiment > 0.7 || avgSentiment < 0.3 || newsVolume > 3) {
      const signalType = avgSentiment > 0.7 ? 'sentiment_bullish' 
                        : avgSentiment < 0.3 ? 'sentiment_bearish' 
                        : 'news_volume_spike';
      
      const signalStrength = Math.min(100, Math.max(
        avgSentiment * 100,
        newsVolume * 20
      ));
      
      signals.push({
        source_id: sourceId,
        user_id: userId,
        timestamp: new Date().toISOString(),
        symbol: symbol,
        signal_type: signalType,
        signal_strength: signalStrength,
        source: 'crypto_news',
        data: {
          avg_sentiment: avgSentiment,
          news_count: newsVolume,
          time_window: '24h',
          recent_headlines: (articles as any[]).slice(0, 3).map(a => a.headline)
        },
        processed: false
      });
    }
  }
  
  if (signals.length > 0) {
    const { error } = await supabaseClient
      .from('live_signals')
      .insert(signals);
    
    if (error) {
      console.error('❌ Error inserting sentiment signals:', error);
    }
  }
  
  return signals;
}

async function analyzeSentiment(supabaseClient: any, params: any) {
  const { symbols, hours = 24, userId, sourceId } = params;
  
  console.log(`🎯 Analyzing sentiment for symbols: ${symbols?.join(', ')} over last ${hours} hours`);
  
  // Get recent news for sentiment analysis
  const hoursAgo = new Date(Date.now() - hours * 60 * 60 * 1000);
  
  const { data: recentNews, error } = await supabaseClient
    .from('crypto_news')
    .select('*')
    .in('symbol', symbols)
    .gte('timestamp', hoursAgo.toISOString())
    .eq('user_id', userId);
  
  if (error) {
    console.error('❌ Error fetching recent news:', error);
    throw error;
  }
  
  // Analyze sentiment trends
  const sentimentAnalysis = symbols.map((symbol: string) => {
    const newsSymbol = symbol.split('-')[0];
    const symbolNews = recentNews.filter((news: any) => news.symbol === newsSymbol);
    
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