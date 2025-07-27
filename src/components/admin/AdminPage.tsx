import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Shield, Settings, Database, Bot, Zap, Brain, Users } from 'lucide-react';
import { CoinbaseOAuthPanel } from './CoinbaseOAuthPanel';
import { CoinbaseSandboxPanel } from './CoinbaseSandboxPanel';
import { LLMConfigPanel } from './LLMConfigPanel';
import { DataSourcesPanel } from './DataSourcesPanel';
import { AILearningPanel } from './AILearningPanel';
import { CustomerManagementPanel } from './CustomerManagementPanel';
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
            <TabsList className="grid w-full grid-cols-6 bg-slate-800">
              <TabsTrigger value="customers" className="flex items-center gap-2">
                <Users className="w-4 h-4" />
                Customers
              </TabsTrigger>
              <TabsTrigger value="llm" className="flex items-center gap-2">
                <Bot className="w-4 h-4" />
                AI Config
              </TabsTrigger>
              <TabsTrigger value="learning" className="flex items-center gap-2">
                <Brain className="w-4 h-4" />
                AI Learning
              </TabsTrigger>
              <TabsTrigger value="data" className="flex items-center gap-2">
                <Database className="w-4 h-4" />
                Data Sources
              </TabsTrigger>
              <TabsTrigger value="coinbase" className="flex items-center gap-2">
                <Zap className="w-4 h-4" />
                Coinbase OAuth
              </TabsTrigger>
              <TabsTrigger value="sandbox" className="flex items-center gap-2">
                <Settings className="w-4 h-4" />
                Sandbox API
              </TabsTrigger>
            </TabsList>

            <TabsContent value="customers">
              <CustomerManagementPanel />
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