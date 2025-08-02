import TradingViewMarketStats from './TradingViewMarketStats';
import TradingViewChart from './TradingViewChart';
import TradingViewCryptoList from './TradingViewCryptoList';

export const TradingViewMarketDashboard = () => {
  return (
    <div className="space-y-6">
      {/* Market Stats Cards */}
      <TradingViewMarketStats />
      
      {/* TradingView Chart - Full Width */}
      <TradingViewChart />
      
      {/* Cryptocurrency Table */}
      <TradingViewCryptoList />
    </div>
  );
};