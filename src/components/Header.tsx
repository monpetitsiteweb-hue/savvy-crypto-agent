import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Settings, Bell, User, LogOut, Shield, Link, CheckCircle, Menu, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { useNavigate, useLocation } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

export const Header = () => {
  const { user, signOut } = useAuth();
  const { role } = useUserRole();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [showDropdown, setShowDropdown] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [isConnectedToCoinbase, setIsConnectedToCoinbase] = useState(false);
  const [isCheckingConnection, setIsCheckingConnection] = useState(true);

  // Check Coinbase connection status
  useEffect(() => {
    const checkCoinbaseConnection = async () => {
      if (!user) {
        setIsCheckingConnection(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('user_coinbase_connections')
          .select('id, is_active')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .limit(1);

        if (error) {
          console.error('Error checking Coinbase connection:', error);
          setIsConnectedToCoinbase(false);
        } else {
          setIsConnectedToCoinbase(data && data.length > 0);
        }
      } catch (error) {
        console.error('Error checking Coinbase connection:', error);
        setIsConnectedToCoinbase(false);
      } finally {
        setIsCheckingConnection(false);
      }
    };

    checkCoinbaseConnection();
  }, [user]);

  const handleCoinbaseConnection = () => {
    if (isConnectedToCoinbase) {
      // If already connected, navigate to settings page to manage connections
      navigate('/profile?tab=settings');
    } else {
      // If not connected, navigate to profile to set up connection
      navigate('/profile?tab=settings');
      toast({
        title: "Connect to Coinbase",
        description: "Set up your Coinbase connection to enable live trading.",
      });
    }
  };

  const handleSignOut = async () => {
    await signOut();
  };

  const getInitials = (email: string) => {
    return email.split('@')[0].slice(0, 2).toUpperCase();
  };

  return (
    <header className="bg-slate-900/80 backdrop-blur-md border-b border-slate-700 sticky top-0 z-50">
      <div className="container mx-auto px-4 py-3 md:py-4">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate('/')}>
            <div className="w-8 h-8 md:w-10 md:h-10 bg-green-500 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm md:text-lg">AI</span>
            </div>
            <div className="hidden sm:block">
              <h1 className="text-lg md:text-xl font-bold text-white">My Little AI Assistant</h1>
              <p className="text-xs md:text-sm text-slate-400">Smart Trading Platform</p>
            </div>
          </div>

          {/* Desktop Actions */}
          <div className="hidden md:flex items-center gap-4">
            <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white">
              <Bell className="w-4 h-4" />
            </Button>

            {role === 'admin' && (
              <Button 
                className={`text-white font-medium ${
                  location.pathname === '/admin' ? 'bg-green-600 hover:bg-green-700' : 'bg-green-500 hover:bg-green-600'
                }`}
                size="sm"
                onClick={() => navigate(location.pathname === '/admin' ? '/' : '/admin')}
              >
                {location.pathname === '/admin' ? 'Dashboard' : 'Admin'}
              </Button>
            )}

            {/* Coinbase Connection Button */}
            {user && !isCheckingConnection && (
              <Button
                onClick={handleCoinbaseConnection}
                size="sm"
                className={`flex items-center gap-2 font-medium ${
                  isConnectedToCoinbase 
                    ? 'bg-green-600/20 text-green-400 border border-green-500/30 hover:bg-green-600/30' 
                    : 'bg-orange-500 hover:bg-orange-600 text-white'
                }`}
                variant={isConnectedToCoinbase ? "outline" : "default"}
              >
                {isConnectedToCoinbase ? (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    <span>Connected to Coinbase</span>
                  </>
                ) : (
                  <>
                    <Link className="w-4 h-4" />
                    <span>Connect to Coinbase</span>
                  </>
                )}
              </Button>
            )}

            {user && (
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
                  <span>{user?.email}</span>
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
                        My Account
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          navigate('/profile?tab=settings');
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
            )}
          </div>

          {/* Mobile Menu Button */}
          <div className="md:hidden">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowMobileMenu(!showMobileMenu)}
              className="text-slate-300 hover:text-white"
            >
              {showMobileMenu ? <X className="w-8 h-8" /> : <Menu className="w-8 h-8" />}
            </Button>
          </div>
        </div>

        {/* Mobile Menu */}
        {showMobileMenu && (
          <div className="md:hidden mt-4 pb-4 border-t border-slate-700 pt-4">
            <div className="space-y-3">
              {/* Coinbase Connection */}
              {user && !isCheckingConnection && (
                <Button
                  onClick={() => {
                    handleCoinbaseConnection();
                    setShowMobileMenu(false);
                  }}
                  size="sm"
                  className={`w-full flex items-center gap-2 font-medium ${
                    isConnectedToCoinbase 
                      ? 'bg-green-600/20 text-green-400 border border-green-500/30 hover:bg-green-600/30' 
                      : 'bg-orange-500 hover:bg-orange-600 text-white'
                  }`}
                  variant={isConnectedToCoinbase ? "outline" : "default"}
                >
                  {isConnectedToCoinbase ? (
                    <>
                      <CheckCircle className="w-4 h-4" />
                      <span>Connected to Coinbase</span>
                    </>
                  ) : (
                    <>
                      <Link className="w-4 h-4" />
                      <span>Connect to Coinbase</span>
                    </>
                  )}
                </Button>
              )}

              {/* Admin Button */}
              {role === 'admin' && (
                <Button 
                  className={`w-full text-white font-medium ${
                    location.pathname === '/admin' ? 'bg-green-600 hover:bg-green-700' : 'bg-green-500 hover:bg-green-600'
                  }`}
                  size="sm"
                  onClick={() => {
                    navigate(location.pathname === '/admin' ? '/' : '/admin');
                    setShowMobileMenu(false);
                  }}
                >
                  {location.pathname === '/admin' ? 'Dashboard' : 'Admin'}
                </Button>
              )}

              {/* User Actions */}
              {user && (
                <div className="space-y-2 pt-2 border-t border-slate-700">
                  <div className="flex items-center gap-3 px-3 py-2 text-slate-300">
                    <div className="w-8 h-8 bg-cyan-500 rounded-full flex items-center justify-center text-white text-sm font-medium">
                      {user?.email ? getInitials(user.email) : <User className="w-4 h-4" />}
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-white">{user?.email}</div>
                      {role === 'admin' && (
                        <div className="flex items-center gap-1 mt-1">
                          <Shield className="w-3 h-3 text-green-400" />
                          <span className="text-xs text-green-400">Admin</span>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      navigate('/profile');
                      setShowMobileMenu(false);
                    }}
                    className="w-full justify-start text-slate-300 hover:text-white"
                  >
                    <User className="w-4 h-4 mr-2" />
                    My Account
                  </Button>
                  
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      navigate('/profile?tab=settings');
                      setShowMobileMenu(false);
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
                      setShowMobileMenu(false);
                    }}
                    className="w-full justify-start text-slate-300 hover:text-white"
                  >
                    <LogOut className="w-4 h-4 mr-2" />
                    Sign Out
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </header>
  );
};