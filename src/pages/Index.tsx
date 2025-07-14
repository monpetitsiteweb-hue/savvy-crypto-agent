
import { useAuth } from '@/hooks/useAuth';
import { AuthPage } from '@/components/auth/AuthPage';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { ConversationPanel } from '@/components/ConversationPanel';
import { DashboardPanel } from '@/components/DashboardPanel';
import { TradingHistory } from '@/components/TradingHistory';
import { StrategyConfig } from '@/components/StrategyConfig';
import { AdminPage } from '@/components/admin/AdminPage';
import { useUserRole } from '@/hooks/useUserRole';
import { useState } from 'react';

const Index = () => {
  const { user, loading } = useAuth();
  const { role, loading: roleLoading } = useUserRole();
  const [activeTab, setActiveTab] = useState('dashboard');

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
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-180px)]">
          {/* Left Panel - Conversation */}
          <div className="lg:col-span-1">
            <ConversationPanel />
          </div>
          
          {/* Right Panel - Dashboard/History/Config */}
          <div className="lg:col-span-2">
            <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700 h-full">
              {/* Tab Navigation */}
              <div className="flex border-b border-slate-700">
                {[
                  { id: 'dashboard', label: 'Dashboard', icon: '📊' },
                  { id: 'history', label: 'History', icon: '📋' },
                  { id: 'strategy', label: 'Strategy', icon: '⚙️' }
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setActiveTab(tab.id);
                    }}
                    className={`flex items-center gap-2 px-6 py-4 text-sm font-medium transition-colors ${
                      activeTab === tab.id
                        ? 'text-green-400 border-b-2 border-green-400 bg-slate-700/50'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/30'
                    }`}
                  >
                    <span>{tab.icon}</span>
                    {tab.label}
                  </button>
                ))}
              </div>
              
              {/* Tab Content */}
              <div className="p-6 h-[calc(100%-73px)] overflow-y-auto">
                {activeTab === 'dashboard' && <DashboardPanel />}
                {activeTab === 'history' && <TradingHistory />}
                {activeTab === 'strategy' && <StrategyConfig />}
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
