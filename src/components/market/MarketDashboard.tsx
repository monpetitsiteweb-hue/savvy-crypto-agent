import { MarketStatsCards } from './MarketStatsCards';
import { BitcoinPriceChart } from './BitcoinPriceChart';
import { CryptocurrencyTable } from './CryptocurrencyTable';

export const MarketDashboard = () => {
  return (
    <div className="space-y-6">
      {/* Market Stats Cards */}
      <MarketStatsCards />
      
      {/* Bitcoin Price Chart - Full Width */}
      <BitcoinPriceChart />
      
      {/* Cryptocurrency Table */}
      <CryptocurrencyTable />
    </div>
  );
};