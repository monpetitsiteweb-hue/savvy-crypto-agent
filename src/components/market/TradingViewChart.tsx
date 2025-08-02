import TradingViewWidget from 'react-tradingview-widget';

const TradingViewChart = () => {
  return (
    <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700 p-6 rounded-lg mb-8 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-white">Bitcoin Price</h2>
      </div>
      <div className="h-[400px] w-full">
        <TradingViewWidget
          symbol="BINANCE:BTCUSDT"
          theme="dark"
          locale="en"
          autosize
          hide_side_toolbar={false}
          allow_symbol_change={true}
          interval="D"
          toolbar_bg="#1e293b"
          enable_publishing={false}
          hide_top_toolbar={false}
          save_image={false}
          container_id="tradingview_chart"
          style="1"
          details={true}
          hotlist={true}
          calendar={true}
        />
      </div>
    </div>
  );
};

export default TradingViewChart;