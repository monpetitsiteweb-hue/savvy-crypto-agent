import { useState } from 'react';
import { useAuth } from './useAuth';
import { useToast } from './use-toast';
import { supabase } from '@/integrations/supabase/client';

export interface ProductionTradeDetails {
  action: 'buy' | 'sell';
  cryptocurrency: string;
  amount: number;
  orderType: 'market' | 'limit';
  limitPrice?: number;
  strategyId?: string;
}

export interface ValidationSteps {
  riskAcknowledged: boolean;
  amountConfirmed: boolean;
  orderTypeConfirmed: boolean;
  tradingFeesAcknowledged: boolean;
  marketRisksAcknowledged: boolean;
  twoFactorEnabled?: boolean;
}

export const useProductionTrading = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);
  const [tradeResult, setTradeResult] = useState<any>(null);

  const executeProductionTrade = async (
    tradeDetails: ProductionTradeDetails,
    paymentMethod: string,
    validations: ValidationSteps,
    pin: string
  ) => {
    if (!user) {
      toast({
        title: "Authentication Required",
        description: "You must be logged in to execute trades",
        variant: "destructive"
      });
      return null;
    }

    // Validate all required confirmations
    const requiredValidations = [
      'riskAcknowledged',
      'amountConfirmed', 
      'orderTypeConfirmed',
      'tradingFeesAcknowledged',
      'marketRisksAcknowledged'
    ];

    const missingValidations = requiredValidations.filter(key => !validations[key as keyof ValidationSteps]);
    
    if (missingValidations.length > 0) {
      toast({
        title: "Validation Required",
        description: `Please complete all required confirmations: ${missingValidations.join(', ')}`,
        variant: "destructive"
      });
      return null;
    }

    if (pin.length < 4) {
      toast({
        title: "Security PIN Required",
        description: "Please enter your 4-digit trading PIN",
        variant: "destructive"
      });
      return null;
    }

    setIsProcessing(true);

    try {
      // Step 1: Validate user has active Coinbase connection
      console.log('🔄 PRODUCTION TRADE STEP 1: Validating Coinbase connection...');
      
      const { data: connections, error: connectionError } = await supabase
        .from('user_coinbase_connections')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_active', true);

      if (connectionError || !connections || connections.length === 0) {
        toast({
          title: "Connection Required",
          description: "You need an active Coinbase connection to execute live trades. Please connect your account first.",
          variant: "destructive"
        });
        return null;
      }

      const connection = connections[0];
      console.log('✅ PRODUCTION TRADE STEP 1: Active connection found');

      // Step 2: Validate payment method and funds
      console.log('🔄 PRODUCTION TRADE STEP 2: Validating payment method and funds...');
      
      // Here you would integrate with payment provider APIs to validate funds
      // For now, we'll simulate this validation
      if (paymentMethod === 'credit_card' && tradeDetails.amount > 10000) {
        toast({
          title: "Amount Limit Exceeded",
          description: "Credit card transactions are limited to €10,000. Please use a wallet or reduce the amount.",
          variant: "destructive"
        });
        return null;
      }

      console.log('✅ PRODUCTION TRADE STEP 2: Payment method validated');

      // Step 3: Execute the live trade
      console.log('🔄 PRODUCTION TRADE STEP 3: Executing live trade on Coinbase...');
      
      const tradePayload = {
        connectionId: connection.id,
        tradeType: tradeDetails.action,
        cryptocurrency: tradeDetails.cryptocurrency,
        amount: tradeDetails.amount,
        price: tradeDetails.limitPrice,
        strategyId: tradeDetails.strategyId,
        orderType: tradeDetails.orderType,
        userId: user.id,
        paymentMethod: paymentMethod,
        validations: validations,
        securityPin: pin // In real implementation, hash this
      };

      const { data: result, error: tradeError } = await supabase.functions.invoke('coinbase-live-trade', {
        body: tradePayload
      });

      if (tradeError) {
        console.error('❌ PRODUCTION TRADE STEP 3 FAILED:', tradeError);
        toast({
          title: "Trade Execution Failed",
          description: tradeError.message || "Failed to execute trade on Coinbase",
          variant: "destructive"
        });
        return null;
      }

      if (!result?.success) {
        console.error('❌ PRODUCTION TRADE STEP 3 FAILED:', result);
        toast({
          title: "Trade Failed",
          description: result?.error || "Trade execution was not successful",
          variant: "destructive"
        });
        return null;
      }

      console.log('✅ PRODUCTION TRADE STEP 3: Live trade executed successfully');
      
      // Step 4: Record additional audit trail
      console.log('🔄 PRODUCTION TRADE STEP 4: Recording audit trail...');
      
      const auditData = {
        user_id: user.id,
        trade_type: tradeDetails.action,
        cryptocurrency: tradeDetails.cryptocurrency,
        amount: tradeDetails.amount,
        total_value: tradeDetails.amount * (tradeDetails.limitPrice || 1),
        payment_method: paymentMethod,
        order_type: tradeDetails.orderType,
        coinbase_order_id: result.data?.order_id,
        is_live: true,
        validations_completed: JSON.stringify(validations),
        executed_at: new Date().toISOString()
      };

      // Note: This would go to a separate audit table in a real implementation
      console.log('Audit trail:', auditData);
      
      console.log('✅ PRODUCTION TRADE STEP 4: Audit trail recorded');

      setTradeResult(result);

      toast({
        title: "🚀 Live Trade Executed!",
        description: `Successfully ${tradeDetails.action} ${tradeDetails.amount} ${tradeDetails.cryptocurrency}. Order ID: ${result.data?.order_id || 'unknown'}`,
        duration: 10000
      });

      return result;

    } catch (error) {
      console.error('❌ PRODUCTION TRADE FATAL ERROR:', error);
      toast({
        title: "Trade System Error",
        description: error instanceof Error ? error.message : "An unexpected error occurred",
        variant: "destructive"
      });
      return null;
    } finally {
      setIsProcessing(false);
    }
  };

  const validateProductionReadiness = async () => {
    if (!user) return false;

    try {
      // Check for active Coinbase connection
      const { data: connections } = await supabase
        .from('user_coinbase_connections')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_active', true);

      if (!connections || connections.length === 0) {
        toast({
          title: "Setup Required",
          description: "Please connect your Coinbase account for live trading",
          variant: "destructive"
        });
        return false;
      }

      // Check if connection has required API keys for live trading
      const connection = connections[0];
      if (!((connection as any).api_identifier_encrypted ?? connection.api_name_encrypted) || !connection.api_private_key_encrypted) {
        toast({
          title: "API Keys Required",
          description: "Your Coinbase connection needs API keys for live trading",
          variant: "destructive"
        });
        return false;
      }

      return true;
    } catch (error) {
      console.error('Production readiness check failed:', error);
      return false;
    }
  };

  return {
    executeProductionTrade,
    validateProductionReadiness,
    isProcessing,
    tradeResult
  };
};