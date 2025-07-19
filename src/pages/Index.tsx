
import { useAuth } from '@/hooks/useAuth';
import { AuthPage } from '@/components/auth/AuthPage';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { ConversationPanel } from '@/components/ConversationPanel';
import { MergedPortfolioDisplay } from '@/components/MergedPortfolioDisplay';
import { TradingHistory } from '@/components/TradingHistory';
import { StrategyConfig } from '@/components/StrategyConfig';
import { PerformanceOverview } from '@/components/PerformanceOverview';
import { AdminPage } from '@/components/admin/AdminPage';
import { useUserRole } from '@/hooks/useUserRole';
import { useTestMode } from '@/hooks/useTestMode';
import { useTestTrading } from '@/hooks/useTestTrading';
import { useActiveStrategy } from '@/hooks/useActiveStrategy';
import { Switch } from '@/components/ui/switch';
import { useState } from 'react';

const Index = () => {
  const { user, loading } = useAuth();
  const { role, loading: roleLoading } = useUserRole();
  const { testMode, setTestMode } = useTestMode();
  const { hasActiveStrategy } = useActiveStrategy();
  const [activeTab, setActiveTab] = useState('dashboard');
  
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
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 min-h-[calc(100vh-200px)]">
          {/* Left Panel - Conversation */}
          <div className="lg:col-span-1">
            <ConversationPanel />
          </div>
          
          {/* Right Panel - Dashboard/History/Config */}
          <div className="lg:col-span-2">
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
                
                {/* Global Test Mode Toggle */}
                <div className="flex items-center gap-3 px-6 py-4">
                  <span className={`text-sm font-medium ${testMode ? 'text-orange-400' : 'text-slate-400'}`}>
                    {testMode ? 'Test Mode' : 'Live Mode'}
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
                  <MergedPortfolioDisplay 
                    hasActiveStrategy={hasActiveStrategy}
                    onCreateStrategy={() => setActiveTab('strategy')}
                  />
                )}
                {activeTab === 'history' && (
                  <TradingHistory 
                    hasActiveStrategy={hasActiveStrategy}
                    onCreateStrategy={() => setActiveTab('strategy')}
                  />
                )}
                {activeTab === 'strategy' && <StrategyConfig />}
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
