import { useState, useEffect } from 'react';
import { useAuth } from './useAuth';
import { useToast } from './use-toast';
import { supabase } from '@/integrations/supabase/client';

export interface RiskLimits {
  maxDailyLoss: number;
  maxTradesPerDay: number;
  maxPositionSize: number; // % of portfolio
  stopLossPercentage: number;
  takeProfitPercentage?: number;
  maxPortfolioAllocation: number; // % per strategy
}

export interface UserPreferences {
  tradingMode: 'mock' | 'live';
  confidenceThreshold: number;
  maxTradeSize: number;
  dailyTradeCap: number;
  riskLevel: 'conservative' | 'moderate' | 'aggressive';
  enabledStrategies: string[];
  riskLimits: RiskLimits;
}

export interface TradeRiskAssessment {
  riskLevel: 'low' | 'medium' | 'high';
  positionSize: number;
  stopLoss: number;
  takeProfit?: number;
  maxLoss: number;
  riskRating: number; // 1-10
  canExecute: boolean;
  blockingReasons: string[];
  recommendation: string;
}

export const useRiskManagement = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [dailyStats, setDailyStats] = useState({
    trades: 0,
    pnl: 0,
    lastReset: new Date().toDateString()
  });

  const defaultPreferences: UserPreferences = {
    tradingMode: 'mock',
    confidenceThreshold: 0.7,
    maxTradeSize: 500,
    dailyTradeCap: 10,
    riskLevel: 'moderate',
    enabledStrategies: [],
    riskLimits: {
      maxDailyLoss: 500,
      maxTradesPerDay: 10,
      maxPositionSize: 5, // 5% of portfolio
      stopLossPercentage: 3, // 3% stop loss
      takeProfitPercentage: 6, // 6% take profit
      maxPortfolioAllocation: 20 // 20% per strategy
    }
  };

  useEffect(() => {
    if (user) {
      loadUserPreferences();
      loadDailyStats();
    }
  }, [user]);

  const loadUserPreferences = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error loading preferences:', error);
        return;
      }

      // Check if user has preferences stored in profile metadata
      const storedPrefs = data?.username ? JSON.parse(data.username) : null;
      
      if (storedPrefs && storedPrefs.riskPreferences) {
        setPreferences({ ...defaultPreferences, ...storedPrefs.riskPreferences });
      } else {
        setPreferences(defaultPreferences);
      }
    } catch (error) {
      console.error('Error loading preferences:', error);
      setPreferences(defaultPreferences);
    }
  };

  const saveUserPreferences = async (newPreferences: UserPreferences) => {
    if (!user) return;

    try {
      // Store preferences in profile username field (as JSON)
      const profileData = { riskPreferences: newPreferences };
      
      const { error } = await supabase
        .from('profiles')
        .upsert({
          id: user.id,
          username: JSON.stringify(profileData),
          updated_at: new Date().toISOString()
        });

      if (error) throw error;

      setPreferences(newPreferences);
      
      toast({
        title: "Preferences Saved",
        description: "Your risk management preferences have been updated",
      });
    } catch (error) {
      console.error('Error saving preferences:', error);
      toast({
        title: "Error",
        description: "Failed to save preferences",
        variant: "destructive",
      });
    }
  };

  const loadDailyStats = async () => {
    if (!user) return;

    try {
      const today = new Date().toDateString();
      
      // Reset stats if it's a new day
      if (dailyStats.lastReset !== today) {
        setDailyStats({ trades: 0, pnl: 0, lastReset: today });
        return;
      }

      // Get today's trades
      const { data: todayTrades, error } = await supabase
        .from('mock_trades')
        .select('*')
        .eq('user_id', user.id)
        .gte('executed_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString());

      if (error) throw error;

      const trades = todayTrades?.length || 0;
      const pnl = todayTrades?.reduce((sum, trade) => sum + (trade.profit_loss || 0), 0) || 0;

      setDailyStats({ trades, pnl, lastReset: today });
    } catch (error) {
      console.error('Error loading daily stats:', error);
    }
  };

  const assessTradeRisk = async (
    tradeDetails: {
      action: 'buy' | 'sell';
      cryptocurrency: string;
      amount: number;
      price: number;
      strategyId?: string;
    }
  ): Promise<TradeRiskAssessment> => {
    if (!preferences) {
      throw new Error('User preferences not loaded');
    }

    const blockingReasons: string[] = [];
    let canExecute = true;

    // Check daily limits
    if (dailyStats.trades >= preferences.riskLimits.maxTradesPerDay) {
      blockingReasons.push(`Daily trade limit reached (${preferences.riskLimits.maxTradesPerDay})`);
      canExecute = false;
    }

    if (Math.abs(dailyStats.pnl) >= preferences.riskLimits.maxDailyLoss && dailyStats.pnl < 0) {
      blockingReasons.push(`Daily loss limit reached (€${preferences.riskLimits.maxDailyLoss})`);
      canExecute = false;
    }

    // Check position size
    const tradeValue = tradeDetails.amount * tradeDetails.price;
    if (tradeValue > preferences.maxTradeSize) {
      blockingReasons.push(`Trade size exceeds limit (€${preferences.maxTradeSize})`);
      canExecute = false;
    }

    // Calculate position sizing based on risk
    const portfolioValue = await getPortfolioValue();
    const maxPositionValue = portfolioValue * (preferences.riskLimits.maxPositionSize / 100);
    
    let adjustedAmount = tradeDetails.amount;
    if (tradeValue > maxPositionValue) {
      adjustedAmount = maxPositionValue / tradeDetails.price;
    }

    // Calculate stop loss and take profit
    const stopLossPrice = tradeDetails.action === 'buy' 
      ? tradeDetails.price * (1 - preferences.riskLimits.stopLossPercentage / 100)
      : tradeDetails.price * (1 + preferences.riskLimits.stopLossPercentage / 100);

    const takeProfitPrice = preferences.riskLimits.takeProfitPercentage
      ? tradeDetails.action === 'buy'
        ? tradeDetails.price * (1 + preferences.riskLimits.takeProfitPercentage / 100)
        : tradeDetails.price * (1 - preferences.riskLimits.takeProfitPercentage / 100)
      : undefined;

    const maxLoss = adjustedAmount * tradeDetails.price * (preferences.riskLimits.stopLossPercentage / 100);

    // Calculate risk level
    const riskFactors = [
      tradeValue / portfolioValue > 0.1 ? 1 : 0, // Large position
      preferences.riskLevel === 'aggressive' ? 1 : 0, // Aggressive mode
      dailyStats.trades > 5 ? 1 : 0, // High frequency
      Math.abs(dailyStats.pnl) > 200 ? 1 : 0 // Significant P&L
    ];

    const riskScore = riskFactors.reduce((sum, factor) => sum + factor, 0);
    const riskLevel = riskScore <= 1 ? 'low' : riskScore <= 2 ? 'medium' : 'high';

    // Generate recommendation
    let recommendation = '';
    if (!canExecute) {
      recommendation = `Trade blocked: ${blockingReasons.join(', ')}`;
    } else if (riskLevel === 'high') {
      recommendation = `High-risk trade - consider reducing position size. Max loss: €${maxLoss.toFixed(2)}`;
    } else if (riskLevel === 'medium') {
      recommendation = `Moderate-risk trade with €${maxLoss.toFixed(2)} max loss. Stop at €${stopLossPrice.toFixed(2)}`;
    } else {
      recommendation = `Low-risk trade opportunity. Stop loss at €${stopLossPrice.toFixed(2)}`;
    }

    return {
      riskLevel,
      positionSize: adjustedAmount,
      stopLoss: stopLossPrice,
      takeProfit: takeProfitPrice,
      maxLoss,
      riskRating: Math.min(10, riskScore * 2 + 1),
      canExecute,
      blockingReasons,
      recommendation
    };
  };

  const getPortfolioValue = async (): Promise<number> => {
    // In a real implementation, this would fetch current portfolio value
    // For now, return a mock value
    return 10000;
  };

  const checkDailyLimits = async (): Promise<boolean> => {
    await loadDailyStats();
    
    if (!preferences) return false;

    const limitsExceeded = 
      dailyStats.trades >= preferences.riskLimits.maxTradesPerDay ||
      (dailyStats.pnl < 0 && Math.abs(dailyStats.pnl) >= preferences.riskLimits.maxDailyLoss);

    return !limitsExceeded;
  };

  const updateDailyStats = (tradeValue: number, pnl: number) => {
    setDailyStats(prev => ({
      ...prev,
      trades: prev.trades + 1,
      pnl: prev.pnl + pnl
    }));
  };

  const getRiskExplanation = (assessment: TradeRiskAssessment): string => {
    const explanations = [
      `Risk Level: ${assessment.riskLevel.toUpperCase()}`,
      `Position Size: ${assessment.positionSize.toFixed(6)} ${preferences?.riskLimits ? 'tokens' : ''}`,
      `Stop Loss: €${assessment.stopLoss.toFixed(2)}`,
      assessment.takeProfit ? `Take Profit: €${assessment.takeProfit.toFixed(2)}` : '',
      `Maximum Loss: €${assessment.maxLoss.toFixed(2)}`,
      `Risk Rating: ${assessment.riskRating}/10`
    ].filter(Boolean);

    return explanations.join(' | ');
  };

  return {
    preferences,
    dailyStats,
    loadUserPreferences,
    saveUserPreferences,
    assessTradeRisk,
    checkDailyLimits,
    updateDailyStats,
    getRiskExplanation,
    loadDailyStats
  };
};