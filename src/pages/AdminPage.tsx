
import { useState } from 'react';
import { Header } from '@/components/Header';
import { CoinbaseOAuthPanel } from '@/components/admin/CoinbaseOAuthPanel';
import { CoinbaseSandboxPanel } from '@/components/admin/CoinbaseSandboxPanel';
import { LLMConfigPanel } from '@/components/admin/LLMConfigPanel';
import { DataSourcesPanel } from '@/components/admin/DataSourcesPanel';
import { DataSourceStatusPanel } from '@/components/admin/DataSourceStatusPanel';
import { WhaleSignalPanel } from '@/components/admin/WhaleSignalPanel';
import { useUserRole } from '@/hooks/useUserRole';
import { Settings, Bot, Database, Shield, TrendingUp, ExternalLink, Key, Activity } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

const AdminPage = () => {
  const [activeTab, setActiveTab] = useState('oauth-setup');
  const { isAdmin, loading } = useUserRole();

  if (loading) {
    return <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
      <div className="text-white">Loading...</div>
    </div>;
  }

  // Admin-only tabs
  const tabs = [
    { id: 'oauth-setup', label: 'OAuth Setup', icon: <Settings className="w-4 h-4" /> },
    { id: 'llm-config', label: 'AI Configuration', icon: <Bot className="w-4 h-4" /> },
    { id: 'data-sources', label: 'Data Sources', icon: <Database className="w-4 h-4" /> },
    { id: 'whale-signals', label: 'Whale Signals', icon: <Activity className="w-4 h-4" /> },
    { id: 'data-status', label: 'Setup Guide', icon: <TrendingUp className="w-4 h-4" /> },
    { id: 'sandbox-api', label: 'Sandbox API', icon: <Key className="w-4 h-4" /> },
  ];

  // Redirect non-admins to main page
  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-white mb-2">Access Denied</h2>
          <p className="text-slate-400">You need admin privileges to access this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <Header />
      
      <div className="container mx-auto px-4 py-6">
        <Alert className="mb-6 bg-white border-0">
          <AlertDescription className="text-black">
            Admin Dashboard - Manage system configurations and integrations.
          </AlertDescription>
        </Alert>
        
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700">
          {/* Tab Navigation */}
          <div className="flex border-b border-slate-700 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-6 py-4 text-sm font-medium transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'text-white border-b-2 border-green-400 bg-slate-700/50'
                    : 'text-slate-400 hover:text-white hover:bg-slate-700/30'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
          
          {/* Tab Content */}
          <div className="p-6">
            {activeTab === 'oauth-setup' && <CoinbaseOAuthPanel />}
            {activeTab === 'llm-config' && <LLMConfigPanel />}
            {activeTab === 'data-sources' && <DataSourcesPanel />}
            {activeTab === 'whale-signals' && <WhaleSignalPanel />}
            {activeTab === 'data-status' && <DataSourceStatusPanel />}
            {activeTab === 'sandbox-api' && <CoinbaseSandboxPanel />}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminPage;
