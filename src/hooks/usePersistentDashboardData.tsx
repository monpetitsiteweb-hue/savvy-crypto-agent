import { useState, useEffect, useRef } from 'react';

interface PortfolioData {
  accounts: Array<{
    uuid: string;
    name: string;
    currency: string;
    available_balance: {
      value: string;
      currency: string;
    };
  }>;
}

export const usePersistentDashboardData = () => {
  const [portfolioData, setPortfolioData] = useState<PortfolioData | null>(null);
  const [lastFetchTime, setLastFetchTime] = useState<number | null>(null);
  const dataRef = useRef<PortfolioData | null>(null);
  const lastFetchRef = useRef<number | null>(null);

  // Auto-refresh data if it's older than 5 minutes
  const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

  useEffect(() => {
    // Restore data from refs when component mounts
    if (dataRef.current) {
      setPortfolioData(dataRef.current);
    }
    if (lastFetchRef.current) {
      setLastFetchTime(lastFetchRef.current);
    }
  }, []);

  useEffect(() => {
    // Keep refs updated
    dataRef.current = portfolioData;
    lastFetchRef.current = lastFetchTime;
  }, [portfolioData, lastFetchTime]);

  const updatePortfolioData = (data: PortfolioData | null) => {
    setPortfolioData(data);
    setLastFetchTime(Date.now());
  };

  const shouldRefresh = () => {
    if (!lastFetchTime || !portfolioData) return true;
    return Date.now() - lastFetchTime > REFRESH_INTERVAL;
  };

  const clearData = () => {
    setPortfolioData(null);
    setLastFetchTime(null);
  };

  return {
    portfolioData,
    lastFetchTime,
    updatePortfolioData,
    shouldRefresh,
    clearData,
  };
};
