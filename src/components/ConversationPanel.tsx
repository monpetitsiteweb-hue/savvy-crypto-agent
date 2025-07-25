import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Send, Bot, User } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTestMode } from '@/hooks/useTestMode';
import { useActiveStrategy } from '@/hooks/useActiveStrategy';
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
  const { hasActiveStrategy } = useActiveStrategy();
  const { executeProductionTrade, validateProductionReadiness, isProcessing } = useProductionTrading();
  
  const [messages, setMessages] = useState<Message[]>([]);
  
  // Update messages when strategy state changes
  useEffect(() => {
    const getInitialMessage = () => {
      if (!hasActiveStrategy) {
        return "Hello! I'm your AI trading assistant. Currently on standby as no strategy is active. Enable a strategy in Test Mode or Live Mode to begin automated trading and I'll help you monitor and optimize your trades!";
      }
      
      return testMode 
        ? "Hello! I'm your AI trading assistant in **TEST MODE** 🧪. I can help you practice trading safely with mock money, analyze strategies, and provide advice. Try asking me to 'buy 1000 euros of BTC' or 'change stop loss to 2.5%' - all trades will be simulated!"
        : "Hello! I'm your AI trading assistant. Currently in LIVE MODE - production trading is under development. Please enable Test Mode to safely practice trading features. I can analyze your strategies and provide trading advice!";
    };

    setMessages([{
      id: '1',
      type: 'ai',
      content: getInitialMessage(),
      timestamp: new Date()
    }]);
  }, [hasActiveStrategy, testMode]);
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
      // Check if this is a confirmation for pending config changes
      const isConfirmation = /^(ok|yes|do it|confirm|apply|proceed)$/i.test(currentInput.trim());
      
      if (isConfirmation && pendingConfigChanges && pendingConfigChanges.strategyId) {
        console.log('🔄 Applying pending config changes:', pendingConfigChanges);
        
        // Apply the stored config changes
        const { error: updateError } = await supabase
          .from('trading_strategies')
          .update({ 
            configuration: {
              ...pendingConfigChanges.currentConfig,
              ...pendingConfigChanges.configUpdates
            },
            updated_at: new Date().toISOString()
          })
          .eq('id', pendingConfigChanges.strategyId)
          .eq('user_id', user.id);

        if (updateError) {
          console.error('Config update error:', updateError);
          const errorMessage: Message = {
            id: Date.now().toString(),
            type: 'ai',
            content: `❌ **Configuration Update Failed**\n\nError: ${updateError.message}`,
            timestamp: new Date()
          };
          setMessages(prev => [...prev, errorMessage]);
        } else {
          // Refresh strategies and show success
          const { data: updatedStrategies } = await supabase
            .from('trading_strategies')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });
          
          if (updatedStrategies) {
            setUserStrategies(updatedStrategies);
          }
          
          const successMessage: Message = {
            id: Date.now().toString(),
            type: 'ai',
            content: `✅ **Strategy Configuration Updated Successfully**\n\nApplied changes: ${Object.keys(pendingConfigChanges.configUpdates).join(', ')}\n\nYour strategy settings have been saved and are now active.`,
            timestamp: new Date()
          };
          setMessages(prev => [...prev, successMessage]);
        }
        
        // Clear pending changes
        setPendingConfigChanges(null);
        setIsLoading(false);
        return;
      }

      // Get strategy context for the AI
      const strategyContext = getActiveStrategyContext();

      // Route ALL messages through the AI assistant
      console.log('🤖 Routing to AI assistant:', { 
        userId: user.id, 
        message: currentInput,
        testMode,
        strategyContext,
        pendingConfigChanges: !!pendingConfigChanges
      });
      
      // Get active strategy details for the AI
      const activeStrategy = userStrategies.find(s => testMode ? s.is_active_test : s.is_active_live);
      
      const { data, error } = await supabase.functions.invoke('ai-trading-assistant', {
        body: {
          userId: user.id,
          message: currentInput,
          testMode,
          strategyId: activeStrategy?.id,
          currentConfig: activeStrategy?.configuration,
          pendingConfigChanges
        }
      });

      let aiMessage = '';
      
      if (error) {
        console.error('AI assistant error:', error);
        aiMessage = `❌ **AI Assistant Error**\n\nError: ${error.message || 'Unknown error occurred'}\n\nPlease try again or check the system logs for more details.`;
      } else if (data && data.message) {
        aiMessage = data.message;
        
        // Apply config updates immediately when AI returns them
        if (data.configUpdates && activeStrategy) {
          console.log('🔄 ATTEMPTING CONFIG UPDATE:', {
            configUpdates: data.configUpdates,
            strategyId: activeStrategy.id,
            userId: user.id,
            currentConfig: activeStrategy.configuration
          });
          
          const updatedConfig = {
            ...activeStrategy.configuration,
            ...data.configUpdates
          };
          
          console.log('📝 New config to save:', updatedConfig);
          
          try {
            const { data: updateResult, error: updateError } = await supabase
              .from('trading_strategies')
              .update({ 
                configuration: updatedConfig,
                updated_at: new Date().toISOString()
              })
              .eq('id', activeStrategy.id)
              .eq('user_id', user.id)
              .select();

            console.log('📊 Supabase update result:', { updateResult, updateError });

            if (updateError) {
              console.error('❌ CONFIG UPDATE FAILED:', updateError);
              aiMessage += `\n\n❌ **Database Update Failed**\n\nError: ${updateError.message}`;
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
              }
              
              // Show specific update confirmation
              const updatedFields = Object.keys(data.configUpdates).map(key => 
                `${key}: ${data.configUpdates[key]}`
              ).join(', ');
              
              aiMessage += `\n\n✅ **Strategy Configuration Updated Successfully**\n\nUpdated: ${updatedFields}\n\nChanges have been saved to the database.`;
            } else {
              console.error('❌ NO ROWS UPDATED - This indicates a database permission or query issue');
              aiMessage += `\n\n❌ **Database Update Failed**\n\nNo rows were updated. Please check strategy permissions.`;
            }
          } catch (dbError) {
            console.error('❌ DATABASE ERROR:', dbError);
            aiMessage += `\n\n❌ **Database Update Failed**\n\nError: ${dbError instanceof Error ? dbError.message : 'Unknown database error'}`;
          }
          
          // Clear any pending changes since we attempted to apply them
          setPendingConfigChanges(null);
        } else if (data.configUpdates && !activeStrategy) {
          console.error('❌ CONFIG UPDATES RECEIVED BUT NO ACTIVE STRATEGY');
          aiMessage += `\n\n❌ **No Active Strategy**\n\nCannot apply configuration changes without an active strategy.`;
        }
        
        // Clear pending changes if this is a different request  
        if (!data.configUpdates && !isConfirmation) {
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
    <div className="bg-slate-800/80 backdrop-blur-sm rounded-xl border border-slate-700 h-full max-h-screen flex flex-col">
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
      <ScrollArea className="flex-1 h-0">
        <div className="p-4 space-y-4">
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
      </ScrollArea>

      {/* Input - Fixed at bottom */}
      <div className="p-4 border-t border-slate-700 flex-shrink-0">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={testMode 
              ? "🧪 TEST MODE: Try 'buy 1000 euros of BTC', 'change risk profile to high', or ask me anything about crypto trading..."
              : "🚧 Enable Test Mode to try trading features safely. Ask me about strategy settings or trading advice..."
            }
            className="flex-1 min-h-[60px] bg-slate-700/50 border-slate-600 text-white placeholder-slate-400 resize-none"
            disabled={isLoading}
          />
          <Button 
            onClick={handleSend}
            className="bg-green-500 hover:bg-green-600 text-white"
            disabled={!input.trim() || isLoading}
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};
