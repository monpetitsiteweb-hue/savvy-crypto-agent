import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Bell, User, LogOut, Shield, Link, CheckCircle, Menu, X, Wallet, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { useUserTradingState } from '@/hooks/useUserTradingState';
import { useTestMode } from '@/hooks/useTradeViewFilter';
import { useNavigate, useLocation } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';

export const Header = () => {
  const { user, signOut } = useAuth();
  const { role } = useUserRole();
  const { state: tradingState, isLoading: isTradingStateLoading, isCoinbaseConnected } = useUserTradingState();
  const { testMode, toggleTestMode } = useTestMode();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [showDropdown, setShowDropdown] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  // Derive CTA action based on trading state
  const handleCoinbaseCTA = () => {
    // Always route to Profile -> Coinbase Connections tab
    navigate('/profile?tab=connections');
    
    if (!isCoinbaseConnected) {
      toast({
        title: "Connect to Coinbase",
        description: "Set up your Coinbase connection to enable live trading.",
      });
    }
  };

  // Get CTA label and style based on trading state
  const getCTAConfig = () => {
    if (isTradingStateLoading) {
      return { label: 'Checking...', icon: Loader2, variant: 'ghost' as const, className: 'text-slate-400' };
    }
    
    switch (tradingState) {
      case 'WALLET_FUNDED':
        return { 
          label: 'Wallet Ready', 
          icon: CheckCircle, 
          variant: 'outline' as const, 
          className: 'bg-green-600/20 text-green-400 border border-green-500/30 hover:bg-green-600/30' 
        };
      case 'WALLET_CREATED':
        return { 
          label: 'Fund Wallet', 
          icon: Wallet, 
          variant: 'default' as const, 
          className: 'bg-amber-500 hover:bg-amber-600 text-white' 
        };
      case 'COINBASE_CONNECTED':
        return { 
          label: 'Create Wallet', 
          icon: Wallet, 
          variant: 'default' as const, 
          className: 'bg-blue-500 hover:bg-blue-600 text-white' 
        };
      case 'TEST_ONLY':
      default:
        return { 
          label: 'Connect Coinbase', 
          icon: Link, 
          variant: 'default' as const, 
          className: 'bg-orange-500 hover:bg-orange-600 text-white' 
        };
    }
  };

  const ctaConfig = getCTAConfig();

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
            <div className="w-10 h-10 md:w-12 md:h-12 bg-green-500 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-base md:text-xl">AI</span>
            </div>
            <div className="hidden sm:block">
              <h1 className="text-lg md:text-xl font-bold text-white">My AI Crypto Assistant</h1>
              <p className="text-xs md:text-sm text-slate-400">Smart Trading Platform</p>
            </div>
          </div>

          {/* Desktop Actions */}
          <div className="hidden md:flex items-center gap-4">
            {/* Trade View Filter - UI only, does not affect backend execution */}
            <div className="flex items-center gap-2 bg-slate-700/50 px-3 py-2 rounded-lg border border-slate-600/50">
              <span className={`text-xs font-medium ${testMode ? 'text-orange-400' : 'text-emerald-400'}`}>
                {testMode ? 'Showing: Test Trades' : 'Showing: Live Trades'}
              </span>
              <Switch
                checked={testMode}
                onCheckedChange={toggleTestMode}
                className="data-[state=checked]:bg-orange-500"
              />
            </div>

            <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white">
              <Bell className="w-4 h-4" />
            </Button>

            {role === 'admin' && (
              <>
                <Button 
                  className={`text-white font-medium ${
                    location.pathname === '/admin' ? 'bg-green-600 hover:bg-green-700' : 'bg-green-500 hover:bg-green-600'
                  }`}
                  size="sm"
                  onClick={() => navigate(location.pathname === '/admin' ? '/' : '/admin')}
                >
                  {location.pathname === '/admin' ? 'Dashboard' : 'Admin'}
                </Button>

                <Button 
                  variant="outline"
                  size="sm"
                  onClick={() => navigate('/calibration')}
                  className="text-slate-300 hover:text-white border-slate-600"
                >
                  Calibration
                </Button>

                <Button 
                  variant="outline"
                  size="sm"
                  onClick={() => navigate('/dev/learning')}
                  className="text-slate-300 hover:text-white border-slate-600"
                >
                  Dev / Learning
                </Button>
              </>
            )}

            {/* Trading State CTA */}
            {user && (
              <Button
                onClick={handleCoinbaseCTA}
                size="sm"
                className={`flex items-center gap-2 font-medium ${ctaConfig.className}`}
                variant={ctaConfig.variant}
                disabled={isTradingStateLoading}
              >
                <ctaConfig.icon className={`w-4 h-4 ${isTradingStateLoading ? 'animate-spin' : ''}`} />
                <span>{ctaConfig.label}</span>
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
                  <span>{user?.email?.split('@')[0]}</span>
                </Button>
                
                {showDropdown && (
                  <div className="absolute right-0 mt-2 w-56 bg-slate-800 border border-slate-600 rounded-lg shadow-lg z-50">
                    <div className="p-2">
                      <div className="px-3 py-2 text-sm border-b border-slate-600">
                        <div className="text-white font-medium">{user?.email?.split('@')[0]}</div>
                        <div className="text-slate-400 text-xs mt-1">
                          {role === 'admin' ? 'Administrator' : 'Standard User'}
                        </div>
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
              size="lg"
              onClick={() => setShowMobileMenu(!showMobileMenu)}
              className="text-slate-300 hover:text-blue-600 p-3"
            >
              {showMobileMenu ? <X className="w-12 h-12" /> : <Menu className="w-12 h-12" />}
            </Button>
          </div>
        </div>

        {/* Mobile Menu */}
        {showMobileMenu && (
          <div className="md:hidden mt-4 pb-4 border-t border-slate-700 pt-4">
            <div className="space-y-3">
              {/* Trade View Filter - UI only */}
              <div className="flex items-center gap-2 bg-slate-700/50 px-3 py-2 rounded-lg border border-slate-600/50 mb-2">
                <span className={`text-xs font-medium ${testMode ? 'text-orange-400' : 'text-emerald-400'}`}>
                  {testMode ? 'Showing: Test Trades' : 'Showing: Live Trades'}
                </span>
                <Switch
                  checked={testMode}
                  onCheckedChange={toggleTestMode}
                  className="data-[state=checked]:bg-orange-500"
                />
              </div>

              {/* Trading State CTA - Mobile */}
              {user && (
                <Button
                  onClick={() => {
                    handleCoinbaseCTA();
                    setShowMobileMenu(false);
                  }}
                  size="sm"
                  className={`w-full flex items-center gap-2 font-medium ${ctaConfig.className}`}
                  variant={ctaConfig.variant}
                  disabled={isTradingStateLoading}
                >
                  <ctaConfig.icon className={`w-4 h-4 ${isTradingStateLoading ? 'animate-spin' : ''}`} />
                  <span>{ctaConfig.label}</span>
                </Button>
              )}

              {/* Admin Buttons */}
              {role === 'admin' && (
                <>
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

                  <Button 
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigate('/calibration');
                      setShowMobileMenu(false);
                    }}
                    className="w-full text-slate-300 hover:text-white border-slate-600"
                  >
                    Calibration
                  </Button>

                  <Button 
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigate('/dev/learning');
                      setShowMobileMenu(false);
                    }}
                    className="w-full text-slate-300 hover:text-white border-slate-600"
                  >
                    Dev / Learning
                  </Button>
                </>
              )}

              {/* User Actions */}
              {user && (
                <div className="space-y-2 pt-2 border-t border-slate-700">
                  <div className="flex items-center gap-3 px-3 py-2 text-slate-300">
                    <div className="w-8 h-8 bg-cyan-500 rounded-full flex items-center justify-center text-white text-sm font-medium">
                      {user?.email ? getInitials(user.email) : <User className="w-4 h-4" />}
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-white">{user?.email?.split('@')[0]}</div>
                      <div className="text-xs text-slate-400 mt-1">
                        {role === 'admin' ? 'Administrator' : 'Standard User'}
                      </div>
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