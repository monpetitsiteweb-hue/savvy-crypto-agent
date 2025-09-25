import { logger } from '@/utils/logger';
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
import { normalizeStrategy, StrategyData } from '@/types/strategy';

interface Message {
  id: string;
  type: 'user' | 'ai';
  content: string;
  timestamp: Date;
}

export const ConversationPanel = () => {
  const { user } = useAuth();
  const { testMode } = useTestMode();
  const { activeStrategy, hasActiveStrategy, loading: strategyLoading } = useActiveStrategy();
  const { executeProductionTrade, validateProductionReadiness, isProcessing } = useProductionTrading();
  const { marketData } = useRealTimeMarketData();
  const { indicators, indicatorConfig, updateIndicatorConfig, isLoadingHistoricalData } = useTechnicalIndicators(activeStrategy?.configuration);
  
  const [messages, setMessages] = useState<Message[]>([]);
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
      if (!user) return;
      
      const { data, error } = await supabase
        .from('trading_strategies')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (data && !error) {
        setUserStrategies((data || []).map(normalizeStrategy));
      } else {
        logger.error('Error loading strategies:', error);
      }
    };

    loadStrategies();
  }, [user]);

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

    try {
      const { data, error } = await supabase.functions.invoke('ai-trading-assistant', {
        body: {
          userId: user.id,
          message: currentInput,
          strategyId: activeStrategy?.id || null,
          testMode
        }
      });

      let aiMessage = '';
      
      if (error) {
        logger.error('AI assistant error:', error);
        aiMessage = `❌ **AI Assistant Error**\n\nError: ${error.message || 'Unknown error occurred'}`;
      } else if (data) {
        aiMessage = data.response || data.message || 'AI response received successfully.';
      } else {
        aiMessage = '❌ **No response from AI assistant**';
      }

      const aiResponseMessage: Message = {
        id: Date.now().toString(),
        type: 'ai',
        content: aiMessage,
        timestamp: new Date()
      };

      setMessages(prev => [...prev, aiResponseMessage]);
    } catch (error) {
      logger.error('Error sending message:', error);
      const errorMessage: Message = {
        id: Date.now().toString(),
        type: 'ai',
        content: `❌ **Error**\n\nSorry, I encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    }

    setIsLoading(false);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 p-4">
        <ScrollArea className="h-full pr-4">
          <div className="space-y-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex items-start gap-3 ${
                  message.type === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                <div className={`flex items-start gap-3 max-w-[80%] ${message.type === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                  <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                    message.type === 'user' 
                      ? 'bg-primary text-primary-foreground' 
                      : 'bg-muted text-muted-foreground'
                  }`}>
                    {message.type === 'user' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                  </div>
                  <div className={`px-4 py-3 rounded-lg ${
                    message.type === 'user'
                      ? 'bg-primary text-primary-foreground ml-auto'
                      : 'bg-muted text-muted-foreground'
                  }`}>
                    <div className="prose prose-sm max-w-none text-inherit">
                      {message.content.split('\n').map((line, index) => (
                        <div key={index}>
                          {line.startsWith('**') && line.endsWith('**') ? (
                            <strong className="font-semibold">{line.slice(2, -2)}</strong>
                          ) : line.startsWith('•') ? (
                            <div className="ml-4">{line}</div>
                          ) : (
                            line
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="text-xs opacity-70 mt-2">
                      {message.timestamp.toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex items-start gap-3 justify-start">
                <div className="flex items-start gap-3 max-w-[80%]">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-muted text-muted-foreground">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div className="px-4 py-3 rounded-lg bg-muted text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <div className="animate-pulse">Thinking...</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>
      </div>
      
      <div className="p-4 border-t">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask me anything about trading, strategies, or request configuration changes..."
            className="resize-none"
            rows={2}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <div className="flex flex-col gap-2">
            <Button onClick={handleSend} disabled={!input.trim() || isLoading}>
              <Send className="h-4 w-4" />
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setMessages([])}
              title="Clear conversation"
            >
              Clear
            </Button>
          </div>
        </div>
      </div>

      {showProductionConfirmation && pendingTradeDetails && (
        <ProductionTradeConfirmation
          tradeDetails={pendingTradeDetails}
          onConfirm={async () => {}}
          onCancel={() => setShowProductionConfirmation(false)}
          isProcessing={isProcessing}
        />
      )}
    </div>
  );
};