
import { useState } from 'react';
import { Header } from '@/components/Header';
import { APIConnectionsPanel } from '@/components/admin/APIConnectionsPanel';
import { CoinbaseConnectionPanel } from '@/components/admin/CoinbaseConnectionPanel';
import { Settings, Wallet2, Link } from 'lucide-react';

const AdminPage = () => {
  const [activeTab, setActiveTab] = useState('api-connections');

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <Header />
      
      <div className="container mx-auto px-4 py-6">
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700">
          {/* Tab Navigation */}
          <div className="flex border-b border-slate-700">
            {[
              { id: 'api-connections', label: 'API Connections', icon: <Link className="w-4 h-4" /> },
              { id: 'coinbase', label: 'Coinbase', icon: <Wallet2 className="w-4 h-4" /> },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-6 py-4 text-sm font-medium transition-colors ${
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
            {activeTab === 'api-connections' && <APIConnectionsPanel />}
            {activeTab === 'coinbase' && <CoinbaseConnectionPanel />}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminPage;
