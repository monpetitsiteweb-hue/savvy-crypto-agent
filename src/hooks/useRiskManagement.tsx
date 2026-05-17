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

      // Get today's trades (feeds dailyStats consumed by RiskManagementPanel)
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
    updateDailyStats,
    getRiskExplanation,
    loadDailyStats
  };
};
