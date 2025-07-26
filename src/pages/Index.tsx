
import { useAuth } from '@/hooks/useAuth';
import { AuthPage } from '@/components/auth/AuthPage';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { ConversationPanel } from '@/components/ConversationPanel';
import { MergedPortfolioDisplay } from '@/components/MergedPortfolioDisplay';
import { TradingHistory } from '@/components/TradingHistory';
import { StrategyConfig } from '@/components/StrategyConfig';
import { TestStrategyConfig } from '@/components/TestStrategyConfig';
import { PerformanceOverview } from '@/components/PerformanceOverview';
import { LiveIndicatorKPI } from '@/components/strategy/LiveIndicatorKPI';
import { AdminPage } from '@/components/admin/AdminPage';
import { useUserRole } from '@/hooks/useUserRole';
import { useTestMode } from '@/hooks/useTestMode';
import { useTestTrading } from '@/hooks/useTestTrading';
import { useActiveStrategy } from '@/hooks/useActiveStrategy';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Link2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

const Index = () => {
  const { user, loading } = useAuth();
  const { role, loading: roleLoading } = useUserRole();
  const { testMode, setTestMode } = useTestMode();
  const { hasActiveStrategy } = useActiveStrategy();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isStrategyFullWidth, setIsStrategyFullWidth] = useState(false);
  
  // Initialize test trading when component mounts
  useTestTrading();

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
              {/* Tab Navigation */}
              <div className="flex justify-between items-center border-b border-slate-700 flex-shrink-0">
                <div className="flex">
                  {[
                    { id: 'dashboard', label: 'Dashboard' },
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
                      className={`px-6 py-4 text-sm font-medium transition-colors ${
                        activeTab === tab.id
                          ? 'text-green-400 border-b-2 border-green-400 bg-slate-700/50'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/30'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                
                {/* Connect to Coinbase Button and Test Mode Toggle */}
                <div className="flex items-center gap-3 px-6 py-4">
                  <Link to="/profile?tab=settings">
                    <Button 
                      variant="outline" 
                      size="sm"
                      className="text-blue-400 border-blue-400 hover:bg-blue-400 hover:text-white"
                    >
                      <Link2 className="h-4 w-4 mr-2" />
                      Connect to Coinbase
                    </Button>
                  </Link>
                  
                  <span className={`text-sm font-medium ${testMode ? 'text-orange-400' : 'text-slate-400'}`}>
                    {testMode ? 'Test View' : 'Live View'}
                  </span>
                  <Switch
                    checked={testMode}
                    onCheckedChange={setTestMode}
                    className="data-[state=checked]:bg-orange-500"
                  />
                </div>
              </div>
              
              {/* Tab Content */}
              <div className="p-6 flex-1 overflow-y-auto min-h-0">
                {activeTab === 'dashboard' && (
                  <div className="space-y-6">
                    <MergedPortfolioDisplay 
                      hasActiveStrategy={hasActiveStrategy}
                      onCreateStrategy={() => setActiveTab('strategy')}
                    />
                    <LiveIndicatorKPI />
                  </div>
                )}
                {activeTab === 'history' && (
                  <TradingHistory 
                    hasActiveStrategy={hasActiveStrategy}
                    onCreateStrategy={() => setActiveTab('strategy')}
                  />
                )}
                {activeTab === 'strategy' && (
                  <StrategyConfig onLayoutChange={setIsStrategyFullWidth} />
                )}
                {activeTab === 'performance' && (
                  <PerformanceOverview 
                    hasActiveStrategy={hasActiveStrategy}
                    onCreateStrategy={() => setActiveTab('strategy')}
                  />
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
