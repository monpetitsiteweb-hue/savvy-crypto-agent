
import { useState } from 'react';
import { Header } from '@/components/Header';
import { CoinbaseOAuthPanel } from '@/components/admin/CoinbaseOAuthPanel';
import { LLMConfigPanel } from '@/components/admin/LLMConfigPanel';
import { DataSourcesPanel } from '@/components/admin/DataSourcesPanel';
import { StrategyConfig } from '@/components/StrategyConfig';
import { useUserRole } from '@/hooks/useUserRole';
import { Settings, Wallet2, Bot, Database, Shield, TrendingUp } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

const AdminPage = () => {
  const [activeTab, setActiveTab] = useState('my-connections');
  const { isAdmin, loading } = useUserRole();

  if (loading) {
    return <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
      <div className="text-white">Loading...</div>
    </div>;
  }

  // Define tabs based on user role
  const userTabs = [
    { id: 'my-connections', label: 'My Connections', icon: <Wallet2 className="w-4 h-4" /> },
    { id: 'strategies', label: 'Strategy', icon: <TrendingUp className="w-4 h-4" /> },
  ];

  const adminTabs = [
    ...userTabs,
    { id: 'oauth-setup', label: 'OAuth Setup', icon: <Settings className="w-4 h-4" /> },
    { id: 'llm-config', label: 'AI Configuration', icon: <Bot className="w-4 h-4" /> },
    { id: 'data-sources', label: 'Data Sources', icon: <Database className="w-4 h-4" /> },
  ];

  const tabs = isAdmin ? adminTabs : userTabs;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <Header />
      
      <div className="container mx-auto px-4 py-6">
        {isAdmin && (
          <Alert className="mb-6 border-green-600 bg-green-950/20">
            <Shield className="h-4 w-4" />
            <AlertDescription>
              You have admin privileges. You can access both user and admin functionality.
            </AlertDescription>
          </Alert>
        )}
        
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700">
          {/* Tab Navigation */}
          <div className="flex border-b border-slate-700 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-6 py-4 text-sm font-medium transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'text-green-400 border-b-2 border-green-400 bg-slate-700/50'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/30'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
          
          {/* Tab Content */}
          <div className="p-6">
            {activeTab === 'my-connections' && (
              <div className="text-center py-8">
                <Wallet2 className="w-12 h-12 text-slate-600 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-white mb-2">My Coinbase Connections</h3>
                <p className="text-slate-400">Use the main dashboard to connect your Coinbase account via OAuth.</p>
              </div>
            )}
            {activeTab === 'strategies' && <StrategyConfig />}
            {activeTab === 'oauth-setup' && isAdmin && <CoinbaseOAuthPanel />}
            {activeTab === 'llm-config' && isAdmin && <LLMConfigPanel />}
            {activeTab === 'data-sources' && isAdmin && <DataSourcesPanel />}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminPage;
