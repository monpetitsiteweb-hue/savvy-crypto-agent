
import { useAuth } from '@/hooks/useAuth';
import { AuthPage } from '@/components/auth/AuthPage';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { ConversationPanel } from '@/components/ConversationPanel';
import { DebugPanel } from '@/components/DebugPanel';
import { MergedPortfolioDisplay } from '@/components/MergedPortfolioDisplay';
import { TradingHistory } from '@/components/TradingHistory';
import { StrategyConfig } from '@/components/StrategyConfig';
import { TestStrategyConfig } from '@/components/TestStrategyConfig';
import { PerformanceOverview } from '@/components/PerformanceOverview';
import { LiveIndicatorKPI } from '@/components/strategy/LiveIndicatorKPI';
import { AdminPage } from '@/components/admin/AdminPage';
import { MarketDashboard } from '@/components/market/MarketDashboard';
import { TradingViewMarketDashboard } from '@/components/market/TradingViewMarketDashboard';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useUserRole } from '@/hooks/useUserRole';
import { useTestMode } from '@/hooks/useTestMode';
import { useTestTrading } from '@/hooks/useTestTrading';
import { useActiveStrategy } from '@/hooks/useActiveStrategy';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Link2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BackfillTestRunner } from '@/components/BackfillTestRunner';

const Index = () => {
  console.log('🔵 INDEX: Component rendering started');
  const { user, loading } = useAuth();
  const { role, loading: roleLoading } = useUserRole();
  const { testMode, setTestMode } = useTestMode();
  const { hasActiveStrategy } = useActiveStrategy();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isStrategyFullWidth, setIsStrategyFullWidth] = useState(false);
  
  console.log('🔵 INDEX: Before useTestTrading call', { user: !!user, loading, testMode });
  // Initialize test trading when component mounts
  useTestTrading();
  console.log('🔵 INDEX: After useTestTrading call');

  if (loading || roleLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <div className="text-white">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex flex-col">
      <Header />
      
      <div className="container mx-auto px-4 py-6 flex-1">
        {/* Debug Panel */}
        <div className="mb-6">
          <DebugPanel />
        </div>
        
        <div className={`${isStrategyFullWidth && activeTab === 'strategy' ? 'w-full' : 'grid grid-cols-1 lg:grid-cols-3 gap-6'} min-h-[calc(100vh-200px)]`}>
          {/* Left Panel - Conversation */}
          {!(isStrategyFullWidth && activeTab === 'strategy') && (
            <div className="lg:col-span-1">
              <ConversationPanel />
            </div>
          )}
          
          {/* Right Panel - Dashboard/History/Config */}
          <div className={isStrategyFullWidth && activeTab === 'strategy' ? 'w-full' : 'lg:col-span-2'}>
            <div className="bg-slate-800/80 backdrop-blur-sm rounded-xl border border-slate-700 h-full flex flex-col">
              {/* Tab Navigation - Mobile Responsive */}
              <div className="border-b border-slate-700 flex-shrink-0">
                {/* Mobile: Full width tabs */}
                <div className="md:hidden grid grid-cols-5 w-full">
                  {[
                    { id: 'dashboard', label: 'Dashboard' },
                    { id: 'market', label: 'Market' },
                    { id: 'history', label: 'History' },
                    { id: 'strategy', label: 'Strategy' },
                    { id: 'performance', label: 'Performance' }
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        setActiveTab(tab.id);
                      }}
                      className={`px-2 py-4 text-sm font-medium transition-colors ${
                        activeTab === tab.id
                          ? 'text-green-400 border-b-2 border-green-400 bg-slate-700/50'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/30'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Desktop: Normal tabs + toggle */}
                <div className="hidden md:flex justify-between items-center">
                  <div className="flex">
                    {[
                      { id: 'dashboard', label: 'Dashboard' },
                      { id: 'market', label: 'Market' },
                      { id: 'history', label: 'History' },
                      { id: 'strategy', label: 'Strategy' },
                      { id: 'performance', label: 'Performance' }
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          setActiveTab(tab.id);
                        }}
                        className={`px-6 py-4 text-sm font-medium transition-colors whitespace-nowrap ${
                          activeTab === tab.id
                            ? 'text-green-400 border-b-2 border-green-400 bg-slate-700/50'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/30'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  
                  {/* Test Mode Toggle - Desktop */}
                  <div className="flex items-center gap-3 px-6 py-4">
                    <span className={`text-sm font-medium ${testMode ? 'text-orange-400' : 'text-slate-400'}`}>
                      {testMode ? 'Test' : 'Live'}
                    </span>
                    <Switch
                      checked={testMode}
                      onCheckedChange={setTestMode}
                      className="data-[state=checked]:bg-orange-500"
                    />
                  </div>
                </div>

                {/* Test Mode Toggle - Mobile */}
                <div className="md:hidden p-4 border-t border-slate-600">
                  <div className="bg-slate-700/50 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className={`text-sm font-medium ${testMode ? 'text-orange-400' : 'text-slate-400'}`}>
                          Trading Mode
                        </span>
                        <p className="text-xs text-slate-500 mt-1">
                          {testMode ? 'Using simulated money' : 'Using real money'}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`text-sm font-medium ${testMode ? 'text-orange-400' : 'text-slate-400'}`}>
                          {testMode ? 'Test' : 'Live'}
                        </span>
                        <Switch
                          checked={testMode}
                          onCheckedChange={setTestMode}
                          className="data-[state=checked]:bg-orange-500"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Tab Content */}
              <div className="p-6 flex-1 overflow-y-auto min-h-0">
                {activeTab === 'dashboard' && (
                  <div className="space-y-6">
                    <ErrorBoundary>
                      <MergedPortfolioDisplay 
                        hasActiveStrategy={hasActiveStrategy}
                        onCreateStrategy={() => setActiveTab('strategy')}
                      />
                    </ErrorBoundary>
                    <ErrorBoundary>
                      <LiveIndicatorKPI />
                    </ErrorBoundary>
                  </div>
                )}
                {activeTab === 'market' && (
                  <ErrorBoundary>
                    <TradingViewMarketDashboard />
                  </ErrorBoundary>
                )}
                {activeTab === 'history' && (
                  <ErrorBoundary>
                    <TradingHistory 
                      hasActiveStrategy={hasActiveStrategy}
                      onCreateStrategy={() => setActiveTab('strategy')}
                    />
                  </ErrorBoundary>
                )}
                {activeTab === 'strategy' && (
                  <ErrorBoundary>
                    <StrategyConfig onLayoutChange={setIsStrategyFullWidth} />
                  </ErrorBoundary>
                )}
                 {activeTab === 'performance' && (
                   <ErrorBoundary>
                     <PerformanceOverview 
                       hasActiveStrategy={hasActiveStrategy}
                       onCreateStrategy={() => setActiveTab('strategy')}
                     />
                   </ErrorBoundary>
                 )}
                 
                 {/* TEMP: Backfill Test Runner */}
                 {role === 'admin' && (
                   <div className="mt-8 border-t border-slate-600 pt-6">
                     <BackfillTestRunner />
                   </div>
                 )}
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <Footer />
    </div>
  );
};

export default Index;
