import { MarketStatsCards } from './MarketStatsCards';
import { BitcoinPriceChart } from './BitcoinPriceChart';
import { BitcoinPerformanceChart } from './BitcoinPerformanceChart';
import { CryptocurrencyTable } from './CryptocurrencyTable';

export const MarketDashboard = () => {
  return (
    <div className="space-y-6">
      {/* Market Stats Cards */}
      <MarketStatsCards />
      
      {/* Charts Section */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <BitcoinPriceChart />
        <BitcoinPerformanceChart />
      </div>
      
      {/* Cryptocurrency Table */}
      <CryptocurrencyTable />
    </div>
  );
};