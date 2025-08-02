import { ArrowUpIcon, ArrowDownIcon, TrendingUpIcon } from "lucide-react";

const MarketStats = () => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8 animate-fade-in">
      <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700 p-6 rounded-lg">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-slate-400">Market Cap</h3>
          <TrendingUpIcon className="w-4 h-4 text-green-500" />
        </div>
        <p className="text-2xl font-semibold mt-2 text-white">$2.1T</p>
        <span className="text-sm text-green-400 flex items-center gap-1">
          <ArrowUpIcon className="w-3 h-3" />
          2.4%
        </span>
      </div>

      <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700 p-6 rounded-lg">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-slate-400">24h Volume</h3>
          <TrendingUpIcon className="w-4 h-4 text-green-500" />
        </div>
        <p className="text-2xl font-semibold mt-2 text-white">$84.2B</p>
        <span className="text-sm text-green-400 flex items-center gap-1">
          <ArrowUpIcon className="w-3 h-3" />
          5.1%
        </span>
      </div>

      <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700 p-6 rounded-lg">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-slate-400">BTC Dominance</h3>
          <TrendingUpIcon className="w-4 h-4 text-orange-500" />
        </div>
        <p className="text-2xl font-semibold mt-2 text-white">42.1%</p>
        <span className="text-sm text-orange-400 flex items-center gap-1">
          <ArrowDownIcon className="w-3 h-3" />
          0.8%
        </span>
      </div>
    </div>
  );
};

export default MarketStats;