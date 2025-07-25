import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Wallet, Settings, Bell, User, LogOut, Shield, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export const Header = () => {
  const { user, signOut } = useAuth();
  const { role } = useUserRole();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [showDropdown, setShowDropdown] = useState(false);
  const [emergencyStop, setEmergencyStop] = useState(false);

  const handleSignOut = async () => {
    await signOut();
  };

  const handleEmergencyStop = async () => {
    if (!user) return;
    
    try {
      // Disable all active strategies
      const { error } = await supabase
        .from('trading_strategies')
        .update({ is_active: false })
        .eq('user_id', user.id)
        .eq('is_active', true);

      if (error) throw error;

      setEmergencyStop(true);
      toast({
        title: "Emergency Stop Activated",
        description: "All trading strategies have been deactivated immediately.",
        variant: "destructive",
      });
    } catch (error) {
      console.error('Error stopping strategies:', error);
      toast({
        title: "Error",
        description: "Failed to stop strategies. Please try again.",
        variant: "destructive",
      });
    }
  };

  const getInitials = (email: string) => {
    return email.split('@')[0].slice(0, 2).toUpperCase();
  };

  return (
    <header className="bg-slate-900/80 backdrop-blur-md border-b border-slate-700 sticky top-0 z-50">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate('/')}>
            <div className="w-10 h-10 bg-green-500 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-lg">AI</span>
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">My Little AI Assistant</h1>
              <p className="text-sm text-slate-400">Smart Trading Platform</p>
            </div>
          </div>

          {/* Status & Actions */}
          <div className="flex items-center gap-4">
            {/* Emergency Stop Button */}
            <Button
              onClick={handleEmergencyStop}
              disabled={emergencyStop}
              className="bg-red-600 hover:bg-red-700 text-white font-medium"
              size="sm"
            >
              <AlertTriangle className="w-4 h-4 mr-2" />
              {emergencyStop ? 'STOPPED' : 'EMERGENCY STOP'}
            </Button>

            <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white">
              <Bell className="w-4 h-4" />
            </Button>

            {role === 'admin' && (
              <Button 
                variant="ghost" 
                size="sm" 
                className={`text-slate-400 hover:text-white ${
                  location.pathname === '/admin' ? 'text-green-400' : ''
                }`}
                onClick={() => navigate(location.pathname === '/admin' ? '/' : '/admin')}
              >
                <Settings className="w-4 h-4 mr-1" />
                {location.pathname === '/admin' ? 'Dashboard' : 'Admin'}
              </Button>
            )}

            {user && (
              <div className="flex items-center gap-4">
                
                {/* Profile Dropdown */}
                <div className="relative">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowDropdown(!showDropdown)}
                    className="flex items-center gap-2 text-slate-300 hover:text-white"
                  >
                    <div className="w-8 h-8 bg-cyan-500 rounded-full flex items-center justify-center text-white text-sm font-medium">
                      {user?.email ? getInitials(user.email) : <User className="w-4 h-4" />}
                    </div>
                    <span className="hidden md:block">{user?.email}</span>
                  </Button>
                  
                  {showDropdown && (
                    <div className="absolute right-0 mt-2 w-48 bg-slate-800 border border-slate-600 rounded-lg shadow-lg z-50">
                      <div className="p-2">
                        <div className="px-3 py-2 text-sm text-slate-400 border-b border-slate-600 flex items-center justify-between">
                          <span>{user?.email}</span>
                          {role === 'admin' && (
                            <Badge variant="outline" className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">
                              <Shield className="w-3 h-3 mr-1" />
                              Admin
                            </Badge>
                          )}
                        </div>
                         <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            navigate('/profile');
                            setShowDropdown(false);
                          }}
                          className="w-full justify-start text-slate-300 hover:text-white mt-1"
                        >
                          <User className="w-4 h-4 mr-2" />
                          My Profile
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            navigate('/settings');
                            setShowDropdown(false);
                          }}
                          className="w-full justify-start text-slate-300 hover:text-white"
                        >
                          <Settings className="w-4 h-4 mr-2" />
                          Settings
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            handleSignOut();
                            setShowDropdown(false);
                          }}
                          className="w-full justify-start text-slate-300 hover:text-white"
                        >
                          <LogOut className="w-4 h-4 mr-2" />
                          Sign Out
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};