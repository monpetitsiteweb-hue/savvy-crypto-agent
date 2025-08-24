import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Shield, Settings, Database, Bot, Zap, Brain, Users, Monitor } from 'lucide-react';
import { CoinbaseOAuthPanel } from './CoinbaseOAuthPanel';
import { CoinbaseSandboxPanel } from './CoinbaseSandboxPanel';
import { LLMConfigPanel } from './LLMConfigPanel';
import { DataSourcesPanel } from './DataSourcesPanel';
import { AILearningPanel } from './AILearningPanel';
import { CustomerManagementPanel } from './CustomerManagementPanel';
import { PLMonitoringPanel } from './PLMonitoringPanel';
import { Header } from '../Header';
import { Footer } from '../Footer';

export const AdminPage = () => {
  return (
    <div className="min-h-screen bg-slate-900 flex flex-col">
      <Header />
      <div className="flex-1 p-6">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white">Admin Dashboard</h1>
              <p className="text-slate-400 mt-1">Manage system configuration and integrations</p>
            </div>
            <Badge variant="outline" className="bg-green-500/20 text-green-400 border-green-500/30">
              <Shield className="w-4 h-4 mr-1" />
              Admin Access
            </Badge>
          </div>

          {/* Admin Tabs */}
          <Tabs defaultValue="customers" className="space-y-6">
            <TabsList className="w-full bg-slate-800 overflow-x-auto">
              <div className="grid grid-cols-3 md:grid-cols-7 gap-1 min-w-full">{/* Gap for smaller screens */}
                <TabsTrigger value="customers" className="flex items-center gap-1 md:gap-2 text-xs md:text-sm">
                  <Users className="w-4 h-4" />
                  <span className="hidden sm:inline">Customers</span>
                  <span className="sm:hidden">Users</span>
                </TabsTrigger>
                <TabsTrigger value="monitoring" className="flex items-center gap-1 md:gap-2 text-xs md:text-sm">
                  <Monitor className="w-4 h-4" />
                  <span className="hidden sm:inline">P&L Monitor</span>
                  <span className="sm:hidden">P&L</span>
                </TabsTrigger>
                <TabsTrigger value="llm" className="flex items-center gap-1 md:gap-2 text-xs md:text-sm">
                  <Bot className="w-4 h-4" />
                  <span className="hidden sm:inline">AI Config</span>
                  <span className="sm:hidden">AI</span>
                </TabsTrigger>
                <TabsTrigger value="learning" className="flex items-center gap-1 md:gap-2 text-xs md:text-sm">
                  <Brain className="w-4 h-4" />
                  <span className="hidden sm:inline">AI Learning</span>
                  <span className="sm:hidden">Learn</span>
                </TabsTrigger>
                <TabsTrigger value="data" className="flex items-center gap-1 md:gap-2 text-xs md:text-sm">
                  <Database className="w-4 h-4" />
                  <span className="hidden sm:inline">Data Sources</span>
                  <span className="sm:hidden">Data</span>
                </TabsTrigger>
                <TabsTrigger value="coinbase" className="flex items-center gap-1 md:gap-2 text-xs md:text-sm">
                  <Zap className="w-4 h-4" />
                  <span className="hidden sm:inline">Coinbase OAuth</span>
                  <span className="sm:hidden">OAuth</span>
                </TabsTrigger>
                <TabsTrigger value="sandbox" className="flex items-center gap-1 md:gap-2 text-xs md:text-sm">
                  <Settings className="w-4 h-4" />
                  <span className="hidden sm:inline">Sandbox API</span>
                  <span className="sm:hidden">API</span>
                </TabsTrigger>
              </div>
            </TabsList>

            <TabsContent value="customers">
              <CustomerManagementPanel />
            </TabsContent>

            <TabsContent value="monitoring">
              <PLMonitoringPanel />
            </TabsContent>

            <TabsContent value="llm">
              <LLMConfigPanel />
            </TabsContent>

            <TabsContent value="learning">
              <AILearningPanel />
            </TabsContent>

            <TabsContent value="data">
              <DataSourcesPanel />
            </TabsContent>

            <TabsContent value="coinbase">
              <CoinbaseOAuthPanel />
            </TabsContent>

            <TabsContent value="sandbox">
              <CoinbaseSandboxPanel />
            </TabsContent>
          </Tabs>
        </div>
      </div>
      
      <Footer />
    </div>
  );
};