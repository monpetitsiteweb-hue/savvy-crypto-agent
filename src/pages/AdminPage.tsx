
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
        <Alert className="mb-6 border-green-600 bg-green-950/20">
          <Shield className="h-4 w-4 text-white" />
          <AlertDescription className="text-green-300">
            Admin Dashboard - Manage system configurations and integrations.
          </AlertDescription>
        </Alert>
        
        <Alert className="mb-6 border-blue-600 bg-blue-950/20">
          <TrendingUp className="h-4 w-4 text-white" />
          <AlertDescription className="flex items-center justify-between text-blue-300">
            <span>Looking for Strategy Configuration? It's in the main user interface.</span>
            <Button variant="outline" size="sm" onClick={() => window.location.href = '/'} className="ml-4 border-blue-600 text-blue-400 hover:bg-blue-500/10">
              <ExternalLink className="w-4 h-4 mr-2" />
              Go to Main Dashboard
            </Button>
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
