
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Wallet, Settings, Bell, User, LogOut } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';

export const Header = () => {
  const [isConnected, setIsConnected] = useState(false);
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
  };

  const handleAdminClick = () => {
    navigate('/admin');
  };

  return (
    <header className="bg-slate-900/80 backdrop-blur-md border-b border-slate-700 sticky top-0 z-50">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate('/')}>
            <div className="w-10 h-10 bg-gradient-to-br from-green-400 to-blue-500 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-lg">AI</span>
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">CryptoAI Assistant</h1>
              <p className="text-sm text-slate-400">Smart Trading Platform</p>
            </div>
          </div>

          {/* Status & Actions */}
          <div className="flex items-center gap-4">
            {/* Portfolio Value */}
            <div className="text-right hidden sm:block">
              <p className="text-sm text-slate-400">Portfolio Value</p>
              <p className="text-lg font-bold text-green-400">€12,450.32</p>
            </div>

            {/* Connection Status */}
            <Badge 
              variant={isConnected ? "default" : "secondary"}
              className={isConnected ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"}
            >
              <div className={`w-2 h-2 rounded-full mr-2 ${isConnected ? "bg-green-400" : "bg-red-400"}`} />
              {isConnected ? "Connected" : "Disconnected"}
            </Badge>

            {/* Action Buttons */}
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => setIsConnected(!isConnected)}
              className="border-slate-600 text-slate-300 hover:bg-slate-700"
            >
              <Wallet className="w-4 h-4 mr-2" />
              {isConnected ? "Disconnect" : "Connect Coinbase"}
            </Button>

            <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white">
              <Bell className="w-4 h-4" />
            </Button>

            <Button 
              variant="ghost" 
              size="sm" 
              className="text-slate-400 hover:text-white"
              onClick={handleAdminClick}
            >
              <Settings className="w-4 h-4" />
            </Button>

            {user && (
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-slate-400 hover:text-white"
                onClick={handleSignOut}
              >
                <LogOut className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
