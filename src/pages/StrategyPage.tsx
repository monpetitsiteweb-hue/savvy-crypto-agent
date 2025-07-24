import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ComprehensiveStrategyConfig } from "@/components/strategy/ComprehensiveStrategyConfig";
import { StrategyBacktest } from "@/components/strategy/StrategyBacktest";
import { PerformanceDashboard } from "@/components/strategy/PerformanceDashboard";
import { StrategyAutomation } from "@/components/strategy/StrategyAutomation";
import { Bot, BarChart3, Activity, Settings } from 'lucide-react';

export default function StrategyPage() {
  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Strategy Center</h1>
        <p className="text-muted-foreground">
          Configure, automate, and analyze your trading strategies with AI-powered insights
        </p>
      </div>

      <Tabs defaultValue="automation" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="automation" className="flex items-center gap-2">
            <Bot className="h-4 w-4" />
            Automation
          </TabsTrigger>
          <TabsTrigger value="configuration" className="flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Configuration
          </TabsTrigger>
          <TabsTrigger value="backtesting" className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Backtesting
          </TabsTrigger>
          <TabsTrigger value="performance" className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Performance
          </TabsTrigger>
        </TabsList>

        <TabsContent value="automation" className="space-y-6">
          <StrategyAutomation />
        </TabsContent>

        <TabsContent value="configuration" className="space-y-6">
          <ComprehensiveStrategyConfig onBack={() => {}} />
        </TabsContent>

        <TabsContent value="backtesting" className="space-y-6">
          <StrategyBacktest />
        </TabsContent>

        <TabsContent value="performance" className="space-y-6">
          <PerformanceDashboard />
        </TabsContent>
      </Tabs>
    </div>
  );
}