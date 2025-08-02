import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Send, Bot, User } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTestMode } from '@/hooks/useTestMode';
import { useActiveStrategy } from '@/hooks/useActiveStrategy';
import { useRealTimeMarketData } from '@/hooks/useRealTimeMarketData';
import { useTechnicalIndicators } from '@/hooks/useTechnicalIndicators';
import { useProductionTrading, ProductionTradeDetails } from '@/hooks/useProductionTrading';
import { ProductionTradeConfirmation } from './ProductionTradeConfirmation';
import { supabase } from '@/integrations/supabase/client';

interface Message {
  id: string;
  type: 'user' | 'ai';
  content: string;
  timestamp: Date;
}

interface StrategyData {
  id: string;
  strategy_name: string;
  configuration: any;
  is_active: boolean; // Keep for backward compatibility
  is_active_test: boolean;
  is_active_live: boolean;
  created_at: string;
  test_mode: boolean;
}

export const ConversationPanel = () => {
  console.log('ConversationPanel component loaded');
  const { user } = useAuth();
  const { testMode } = useTestMode();
  const { activeStrategy, hasActiveStrategy, loading: strategyLoading } = useActiveStrategy();
  const { executeProductionTrade, validateProductionReadiness, isProcessing } = useProductionTrading();
  const { marketData } = useRealTimeMarketData();
  const { indicators, indicatorConfig, updateIndicatorConfig, isLoadingHistoricalData } = useTechnicalIndicators(activeStrategy?.configuration);
  
  const [messages, setMessages] = useState<Message[]>([]);
  
  // Load conversation from session storage on mount, but wait for strategy loading
  useEffect(() => {
    // Don't show initial message until strategy loading is complete
    if (strategyLoading) return;
    
    const savedMessages = sessionStorage.getItem('trading-conversation');
    if (savedMessages) {
      try {
        const parsed = JSON.parse(savedMessages);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed.map(msg => ({
            ...msg,
            timestamp: new Date(msg.timestamp)
          })));
          return;
        }
      } catch (error) {
        console.error('Failed to parse saved conversation:', error);
      }
    }
    
    // Send a "system health check" to the AI assistant to get proper welcome message
    const initializeConversation = async () => {
      if (!user) return;
      
      try {
        const { data, error } = await supabase.functions.invoke('ai-trading-assistant', {
          body: {
            userId: user.id,
            message: 'system health check',
            strategyId: activeStrategy?.id || null,
            testMode
          }
        });

        if (data && !error) {
          setMessages([{
            id: '1',
            type: 'ai',
            content: data.message || "Hello! I'm your AI trading assistant ready to help.",
            timestamp: new Date()
          }]);
        } else {
          // Fallback if AI call fails
          setMessages([{
            id: '1',
            type: 'ai',
            content: "Hello! I'm your AI trading assistant ready to help.",
            timestamp: new Date()
          }]);
        }
      } catch (error) {
        console.error('Failed to initialize AI conversation:', error);
        // Fallback message
        setMessages([{
          id: '1',
          type: 'ai',
          content: "Hello! I'm your AI trading assistant ready to help.",
          timestamp: new Date()
        }]);
      }
    };

    initializeConversation();
  }, [strategyLoading, hasActiveStrategy, testMode, user, activeStrategy?.id]);

  // Save conversation to session storage whenever messages change
  useEffect(() => {
    if (messages.length > 0) {
      sessionStorage.setItem('trading-conversation', JSON.stringify(messages));
    }
  }, [messages]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [userStrategies, setUserStrategies] = useState<StrategyData[]>([]);
  const [showProductionConfirmation, setShowProductionConfirmation] = useState(false);
  const [pendingTradeDetails, setPendingTradeDetails] = useState<ProductionTradeDetails | null>(null);
  const [pendingConfigChanges, setPendingConfigChanges] = useState<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Load user strategies
  useEffect(() => {
    const loadStrategies = async () => {
      console.log('Loading strategies, user:', user);
      if (!user) {
        console.log('No user found, returning');
        return;
      }
      
      console.log('Fetching strategies for user ID:', user.id);
      const { data, error } = await supabase
        .from('trading_strategies')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      console.log('Strategies response:', { data, error });
      if (data && !error) {
        setUserStrategies(data);
        console.log('Set user strategies:', data);
      } else {
        console.error('Error loading strategies:', error);
      }
    };

    loadStrategies();
  }, [user]);

  // Get the active strategy context to send to the AI
  const getActiveStrategyContext = () => {
    const activeStrategies = userStrategies.filter(s => 
      testMode ? s.is_active_test : s.is_active_live
    );
    
    if (activeStrategies.length === 0 && userStrategies.length === 0) {
      return null; // No strategies at all
    }
    
    if (activeStrategies.length === 0 && userStrategies.length > 0) {
      return { hasStrategies: true, activeCount: 0 }; // Has strategies but none active
    }
    
    if (activeStrategies.length > 1) {
      return { hasStrategies: true, activeCount: activeStrategies.length, multipleActive: true };
    }
    
    return activeStrategies[0]; // Single active strategy
  };

  const detectTradeRequest = (message: string): ProductionTradeDetails | null => {
    const lowerMessage = message.toLowerCase();
    
    // Parse trade requests like "buy 1000 euros of BTC" or "sell 0.5 ETH" or "sell all my XRP"
    const buyMatch = lowerMessage.match(/buy\s+(\d+(?:\.\d+)?)\s+(?:euros?|eur|€)\s+(?:of\s+)?([a-z]{3,4})/i);
    const sellMatch = lowerMessage.match(/sell\s+(\d+(?:\.\d+)?)\s+([a-z]{3,4})/i);
    const sellAllMatch = lowerMessage.match(/sell\s+all\s+(?:my\s+)?([a-z]{3,4})/i);
    
    if (buyMatch) {
      const [, amount, crypto] = buyMatch;
      return {
        action: 'buy',
        cryptocurrency: crypto.toLowerCase(),
        amount: parseFloat(amount),
        orderType: 'market'
      };
    }
    
    if (sellMatch) {
      const [, amount, crypto] = sellMatch;
      return {
        action: 'sell',
        cryptocurrency: crypto.toLowerCase(),
        amount: parseFloat(amount),
        orderType: 'market'
      };
    }
    
    if (sellAllMatch) {
      const [, crypto] = sellAllMatch;
      return {
        action: 'sell',
        cryptocurrency: crypto.toLowerCase(),
        amount: -1, // Special flag for "sell all"
        orderType: 'market'
      };
    }
    
    return null;
  };

  // Helper function to execute test trades
  const executeTestTrade = async (tradeRequest: ProductionTradeDetails, strategy: StrategyData): Promise<string> => {
    try {
      // Get current market price (simplified - using mock price for now)
      const cryptoSymbol = tradeRequest.cryptocurrency.toUpperCase();
      const mockPrices = { BTC: 101367, ETH: 3176, XRP: 2.99 };
      const currentPrice = mockPrices[cryptoSymbol] || 1;
      
      const cryptoAmount = tradeRequest.action === 'buy' 
        ? tradeRequest.amount / currentPrice
        : tradeRequest.amount;
      
      // Record the trade in mock_trades table
      const { error } = await supabase
        .from('mock_trades')
        .insert({
          user_id: user?.id,
          strategy_id: strategy.id,
          trade_type: tradeRequest.action,
          cryptocurrency: cryptoSymbol,
          amount: cryptoAmount,
          price: currentPrice,
          total_value: tradeRequest.action === 'buy' ? tradeRequest.amount : tradeRequest.amount * currentPrice,
          fees: 0,
          executed_at: new Date().toISOString(),
          is_test_mode: true,
          market_conditions: {
            price: currentPrice,
            timestamp: new Date().toISOString()
          }
        });

      if (error) {
        console.error('Test trade recording error:', error);
        return `❌ **Test Trade Failed**\n\nError recording the trade: ${error.message}`;
      }

      return `✅ **${tradeRequest.action.toUpperCase()} Order Executed Successfully** 🧪\n\n**Details:**\n• Amount: ${cryptoAmount.toFixed(6)} ${cryptoSymbol}\n• Value: €${tradeRequest.action === 'buy' ? tradeRequest.amount.toLocaleString() : (tradeRequest.amount * currentPrice).toLocaleString()}\n• Price: €${currentPrice.toLocaleString()} per ${cryptoSymbol}\n• Environment: 🧪 Test Mode (Simulated)\n\n**Note:** This was a simulated trade for testing purposes. Check your Dashboard to see the updated mock portfolio!`;
    } catch (error) {
      console.error('Test trade execution error:', error);
      return `❌ **Test Trade Failed**\n\nError: ${error.message}`;
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    const currentInput = input;
    setInput('');
    setIsLoading(true);

    // Check if this is a trade request first (keep this for safety)
    const tradeRequest = detectTradeRequest(currentInput);
    
    if (tradeRequest && !testMode) {
      // Production trade detected - show warning that we're focusing on test mode for now
      const productionWarning: Message = {
        id: Date.now().toString(),
        type: 'ai',
        content: "🚧 **Production trading is under development**\n\nFor now, please enable Test Mode to try trading features safely. Production trading with real money will be available soon!\n\nTo enable test mode, look for the test mode toggle in your interface.",
        timestamp: new Date()
      };
      setMessages(prev => [...prev, productionWarning]);
      setIsLoading(false);
      return;
    }

    // Handle test mode trades directly
    if (tradeRequest && testMode) {
      const activeStrategy = userStrategies.find(s => s.is_active_test);
      
      if (!activeStrategy) {
        const noStrategyMessage: Message = {
          id: Date.now().toString(),
          type: 'ai',
          content: "❌ **No Active Strategy**\n\nI can't execute trades without an active strategy. Please activate a strategy in the Strategy tab first, then try your trade again.",
          timestamp: new Date()
        };
        setMessages(prev => [...prev, noStrategyMessage]);
        setIsLoading(false);
        return;
      }

      try {
        const tradeResult = await executeTestTrade(tradeRequest, activeStrategy);
        const tradeMessage: Message = {
          id: Date.now().toString(),
          type: 'ai',
          content: tradeResult,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, tradeMessage]);
        setIsLoading(false);
        return;
      } catch (error) {
        const errorMessage: Message = {
          id: Date.now().toString(),
          type: 'ai',
          content: `❌ **Test Trade Failed**\n\nError: ${error instanceof Error ? error.message : 'Unknown error'}`,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, errorMessage]);
        setIsLoading(false);
        return;
      }
    }

    try {
      // =============================================
      // FULLY LLM-FIRST ROUTING - NO REGEX LOGIC
      // =============================================
      console.log('🤖 MASTER AI ROUTING: All messages go through LLM first');
      
      // Get target strategy for context
      let targetStrategy = activeStrategy;
      if (!targetStrategy && userStrategies.length > 0) {
        targetStrategy = userStrategies[0];
      }
      
      // Check if indicators are still loading historical data
      const hasEnabledIndicators = indicatorConfig && (
        indicatorConfig.rsi?.enabled ||
        indicatorConfig.macd?.enabled ||
        indicatorConfig.ema?.enabled ||
        indicatorConfig.sma?.enabled ||
        indicatorConfig.bollinger?.enabled ||
        indicatorConfig.adx?.enabled ||
        indicatorConfig.stochasticRSI?.enabled
      );
      
      // Use the new loading state from the hook
      if (hasEnabledIndicators && isLoadingHistoricalData) {
        const loadingMessage: Message = {
          id: Date.now().toString(),
          type: 'ai',
          content: "📊 **Loading Historical Market Data**\n\nI'm retrieving recent price history from the database to calculate your technical indicators (RSI, MACD, EMA).\n\n⏳ This should complete within a few seconds...",
          timestamp: new Date()
        };
        setMessages(prev => [...prev, loadingMessage]);
        setIsLoading(false);
        return;
      }
      
      const hasIndicatorData = indicators && Object.keys(indicators).length > 0;
      
      // If indicators are enabled but calculations haven't finished yet
      if (hasEnabledIndicators && !hasIndicatorData) {
        const loadingMessage: Message = {
          id: Date.now().toString(),
          type: 'ai',
          content: "📊 **Calculating Technical Indicators**\n\nPrice data loaded, now calculating RSI, MACD, and other indicators. This requires a minimum of 26 data points per symbol.\n\n⏳ Please try your question again in a moment.",
          timestamp: new Date()
        };
        setMessages(prev => [...prev, loadingMessage]);
        setIsLoading(false);
        return;
      }

      // Get recent trades for strategy context
      let recentTrades = [];
      if (targetStrategy?.id) {
        const { data: trades } = await supabase
          .from('mock_trades')
          .select('*')
          .eq('strategy_id', targetStrategy.id)
          .eq('user_id', user.id)
          .order('executed_at', { ascending: false })
          .limit(5);
        
        if (trades) {
          recentTrades = trades;
        }
      }
      
      // Build comprehensive context payload for the LLM
      const payload = {
        userId: user.id,
        message: currentInput,
        strategyId: targetStrategy?.id || null,
        testMode,
        currentConfig: targetStrategy?.configuration || {},
        recentTrades,
        marketData: marketData || {},
        indicatorContext: indicators,
        indicatorConfig,
        // Interface awareness context
        activeFields: Object.keys(targetStrategy?.configuration || {}),
        fieldDescriptions: {
          riskLevel: 'Strategy Configuration → Risk Management tab',
          perTradeAllocation: 'Strategy Configuration → Coins & Amounts tab → "Amount Per Trade" field',
          stopLossPercentage: 'Strategy Configuration → Risk Management tab → Stop Loss field',
          takeProfitPercentage: 'Strategy Configuration → Risk Management tab → Take Profit field',
          selectedCoins: 'Strategy Configuration → Coins & Amounts tab → Coin selection checkboxes',
          enableAI: 'Strategy Configuration → AI Intelligence Settings'
        }
      };
      
      console.log('🚀 Sending comprehensive payload to AI assistant:', payload);
      
      const { data, error } = await supabase.functions.invoke('ai-trading-assistant', {
        body: payload
      });

      let aiMessage = '';
      
      if (error) {
        console.error('AI assistant error:', error);
        aiMessage = `❌ **AI Assistant Error**\n\nError: ${error.message || 'Unknown error occurred'}\n\nPlease try again or check the system logs for more details.`;
      } else if (data && data.message) {
        aiMessage = data.message;
        
        // Handle config updates returned by the upgraded AI system
        if (data.hasConfigUpdates && data.configUpdates && targetStrategy) {
          console.log('🔄 VALIDATED CONFIG UPDATE from AI:', {
            configUpdates: data.configUpdates,
            strategyId: targetStrategy.id,
            userId: user.id
          });
          
          console.log('🔄 VALIDATED CONFIG UPDATE from AI:', {
            configUpdates: data.configUpdates,
            strategyId: targetStrategy.id,
            userId: user.id
          });
          
          // The AI system has already validated these updates - MERGE PROPERLY
          const updatedConfig = { ...targetStrategy.configuration };
          
          // Handle nested object merging properly
          Object.keys(data.configUpdates).forEach(key => {
            if (key === 'aiIntelligenceConfig' && typeof data.configUpdates[key] === 'object') {
              // Merge AI config instead of replacing
              updatedConfig.aiIntelligenceConfig = {
                ...updatedConfig.aiIntelligenceConfig,
                ...data.configUpdates[key]
              };
              console.log('🔧 MERGED aiIntelligenceConfig:', updatedConfig.aiIntelligenceConfig);
            } else {
              updatedConfig[key] = data.configUpdates[key];
            }
          });
          
          console.log('📝 Applying validated config:', updatedConfig);
          
          try {
            const { data: updateResult, error: updateError } = await supabase
              .from('trading_strategies')
              .update({ 
                configuration: updatedConfig,
                updated_at: new Date().toISOString()
              })
              .eq('id', targetStrategy.id)
              .eq('user_id', user.id)
              .select();

            console.log('📊 Config update result:', { updateResult, updateError });

            if (updateError) {
              console.error('❌ CONFIG UPDATE FAILED:', updateError);
              aiMessage = `❌ Failed to update strategy. Please try again or contact support.`;
            } else if (updateResult && updateResult.length > 0) {
              console.log('✅ CONFIG UPDATE SUCCESS:', updateResult[0]);
              
              // Refresh strategies to reflect changes
              const { data: updatedStrategies, error: refreshError } = await supabase
                .from('trading_strategies')
                .select('*')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false });
              
              console.log('🔄 Strategy refresh result:', { updatedStrategies, refreshError });
              
              if (updatedStrategies && !refreshError) {
                setUserStrategies(updatedStrategies);
                console.log('✅ Strategies refreshed in state');
                
                // If technicalIndicators were updated, sync with the hook
                if (data.configUpdates.technicalIndicators) {
                  updateIndicatorConfig(data.configUpdates.technicalIndicators);
                }
              }
              
              // The AI system now generates its own comprehensive success message for compound updates
              // We should use that message directly instead of overriding it
              if (aiMessage && aiMessage.includes('Strategy Configuration Updated')) {
                // AI generated a compound update message - use it as is
                console.log('✅ Using AI-generated compound update message');
              } else {
                // Fallback for simple updates or if AI message is missing
                const riskLevel = data.configUpdates.riskLevel || data.configUpdates.riskProfile;
                if (riskLevel) {
                  const riskLevelCapitalized = riskLevel.charAt(0).toUpperCase() + riskLevel.slice(1);
                  aiMessage = `✅ Risk profile updated to ${riskLevelCapitalized} for your strategy`;
                } else {
                  const updateCount = countConfigUpdates(data.configUpdates);
                  if (updateCount > 1) {
                    aiMessage = `✅ Strategy updated with ${updateCount} configuration changes successfully applied!`;
                  } else {
                    const updatedFields = Object.keys(data.configUpdates).map(key => {
                      const value = data.configUpdates[key];
                      if (key === 'aiIntelligenceConfig') {
                        // Check what specific AI config was updated
                        if (value?.aiAutonomyLevel !== undefined) {
                          return `AI autonomy level: ${value.aiAutonomyLevel}%`;
                        } else if (value?.enableAIOverride !== undefined) {
                          return `AI decision override: ${value.enableAIOverride ? 'enabled' : 'disabled'}`;
                        } else {
                          return `AI configuration updated`;
                        }
                      }
                      if (typeof value === 'object' && value !== null) {
                        return `${key}: ${JSON.stringify(value)}`;
                      }
                      return `${key}: ${value}`;
                    }).join(', ');
                    aiMessage = `✅ Strategy updated: ${updatedFields}`;
                  }
                }
              }
            } else {
              console.error('❌ NO ROWS UPDATED - This indicates a database permission or query issue');
              aiMessage = `❌ Failed to update strategy. Please try again or contact support.`;
            }
          } catch (dbError) {
            console.error('❌ DATABASE ERROR:', dbError);
            aiMessage = `❌ Failed to update strategy. Please try again or contact support.`;
          }
          
          // Clear any pending changes since we attempted to apply them
          setPendingConfigChanges(null);
        } else if (data.configUpdates && !targetStrategy) {
          console.error('❌ CONFIG UPDATES RECEIVED BUT NO TARGET STRATEGY');
          aiMessage = `❌ No strategy found to update. Please create a strategy first.`;
        }
        
        // Clear pending changes if this is a different request  
        if (!data.configUpdates) {
          setPendingConfigChanges(null);
        }
      } else {
        console.error('Unexpected response format:', data);
        aiMessage = `❌ **Unexpected Response**\n\nReceived: ${JSON.stringify(data)}\n\nPlease try again.`;
      }

      const aiResponse: Message = {
        id: (Date.now() + 1).toString(),
        type: 'ai',
        content: aiMessage,
        timestamp: new Date()
      };
      
      setMessages(prev => [...prev, aiResponse]);
      
    } catch (error) {
      console.error('Error calling AI assistant:', error);
      const errorResponse: Message = {
        id: (Date.now() + 1).toString(),
        type: 'ai',
        content: `❌ **System Error**\n\nFailed to connect to AI assistant: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorResponse]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleProductionTradeConfirm = async (paymentMethod: string, validations: any) => {
    if (!pendingTradeDetails) return;
    
    try {
      const result = await executeProductionTrade(
        pendingTradeDetails,
        paymentMethod, 
        validations,
        '1234' // In real app, this would be entered by user
      );
      
      if (result) {
        const successMessage: Message = {
          id: Date.now().toString(),
          type: 'ai',
          content: `🚀 **Production Trade Executed Successfully!**\n\n${result.message}\n\nOrder ID: ${result.data?.order_id || 'Unknown'}\nEnvironment: LIVE PRODUCTION`,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, successMessage]);
      }
    } catch (error) {
      const errorMessage: Message = {
        id: Date.now().toString(),
        type: 'ai',
        content: `❌ **Production Trade Failed**\n\n${error instanceof Error ? error.message : 'Unknown error occurred'}`,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setShowProductionConfirmation(false);
      setPendingTradeDetails(null);
    }
  };

  const handleProductionTradeCancel = () => {
    setShowProductionConfirmation(false);
    setPendingTradeDetails(null);
    
    const cancelMessage: Message = {
      id: Date.now().toString(),
      type: 'ai',
      content: "Production trade cancelled. Your order was not executed.",
      timestamp: new Date()
    };
    setMessages(prev => [...prev, cancelMessage]);
  };

  // Utility function to count configuration updates
  const countConfigUpdates = (configUpdates: any): number => {
    let count = 0;
    
    for (const [key, value] of Object.entries(configUpdates)) {
      if (key === 'aiIntelligenceConfig' && typeof value === 'object' && value !== null) {
        // Count individual AI config updates
        count += Object.keys(value).length;
      } else if (key === 'technicalIndicators' && typeof value === 'object' && value !== null) {
        // Count individual technical indicator updates
        for (const indicator of Object.values(value)) {
          if (typeof indicator === 'object' && indicator !== null) {
            count += Object.keys(indicator).length;
          }
        }
      } else {
        count++;
      }
    }
    
    return count;
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (showProductionConfirmation && pendingTradeDetails) {
    return (
      <div className="h-full">
        <ProductionTradeConfirmation
          tradeDetails={pendingTradeDetails}
          onConfirm={handleProductionTradeConfirm}
          onCancel={handleProductionTradeCancel}
          isProcessing={isProcessing}
        />
      </div>
    );
  }

  return (
    <div className="bg-slate-800/80 backdrop-blur-sm rounded-xl border border-slate-700 h-full max-h-screen flex flex-col min-h-[500px]">
      {/* iOS Safari fix: Added min-h-[500px] for visibility */}
      {/* Header */}
      <div className="p-4 border-b border-slate-700 flex-shrink-0">
        <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
          <Bot className="w-5 h-5 text-green-400" />
          AI Trading Assistant
          {!testMode && (
            <span className="ml-2 px-2 py-1 bg-red-600 text-white text-xs rounded-full">
              LIVE MODE
            </span>
          )}
          {testMode && (
            <span className="ml-2 px-2 py-1 bg-blue-600 text-white text-xs rounded-full">
              TEST MODE
            </span>
          )}
        </h2>
        <p className="text-sm text-slate-300 mt-1">
          {userStrategies.length > 0 
            ? `Analyzing your ${userStrategies.filter(s => testMode ? s.is_active_test : s.is_active_live).length > 0 ? 'active' : ''} trading strategies`
            : 'Ask me about trading strategies and risk management'
          }
        </p>
        {testMode && (
          <p className="text-xs text-blue-300 mt-1">
            🧪 Test mode: All trades are simulated with mock money - perfect for learning!
          </p>
        )}
        {!testMode && (
          <p className="text-xs text-amber-300 mt-1">
            🚧 Live mode: Production trading under development - please enable Test Mode for now
          </p>
        )}
      </div>

      {/* Messages - Scrollable Area with Fixed Height */}
      <div className="flex-1 min-h-0">
        {/* iOS Safari fix: Replaced ScrollArea with div for better compatibility */}
        <div className="h-full overflow-y-auto">
          <div className="p-4 space-y-4 min-h-[200px]">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex gap-3 ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {message.type === 'ai' && (
                  <div className="w-8 h-8 bg-green-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                    <Bot className="w-4 h-4 text-green-400" />
                  </div>
                )}
                
                <div
                  className={`max-w-[80%] p-3 rounded-lg whitespace-pre-wrap ${
                    message.type === 'user'
                      ? 'bg-blue-600/30 text-blue-50 border border-blue-500/40'
                      : 'bg-slate-700/70 text-slate-50 border border-slate-600/60'
                  }`}
                >
                  {message.content}
                  <div className="text-xs text-slate-300 mt-2">
                    {message.timestamp.toLocaleTimeString()}
                  </div>
                </div>

                {message.type === 'user' && (
                  <div className="w-8 h-8 bg-blue-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                    <User className="w-4 h-4 text-blue-400" />
                  </div>
                )}
              </div>
            ))}
            
            {isLoading && (
              <div className="flex gap-3 justify-start">
                <div className="w-8 h-8 bg-green-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                  <Bot className="w-4 h-4 text-green-400" />
                </div>
                <div className="bg-slate-700/50 text-slate-100 border border-slate-600/50 p-3 rounded-lg">
                  <div className="flex space-x-1">
                    <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                    <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                  </div>
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>
        </div>
      </div>

      {/* Input - Fixed at bottom */}
      <div className="p-4 border-t border-slate-700 flex-shrink-0">
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Message My AI Crypto Assistant..."
              className="min-h-[60px] max-h-[120px] resize-none bg-slate-800/50 border-slate-600 text-white placeholder:text-slate-400 text-base leading-relaxed px-4 py-3"
              disabled={isLoading}
            />
          </div>
          <Button 
            onClick={handleSend}
            className="bg-green-500 hover:bg-green-600 text-white h-[60px] px-6"
            disabled={!input.trim() || isLoading}
          >
            {isLoading ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};
