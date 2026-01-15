import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  User, 
  Settings, 
  Bell, 
  CreditCard, 
  Key, 
  Shield, 
  Users, 
  Gift,
  ArrowLeft,
  Save,
  Eye,
  EyeOff,
  Wallet,
  Copy,
  CheckCircle,
  AlertCircle
} from 'lucide-react';
import { useUserTradingState } from '@/hooks/useUserTradingState';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useNavigate, useLocation } from 'react-router-dom';
import { FeeSettings } from '@/components/FeeSettings';

interface ProfileData {
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
}

interface ConnectionData {
  id: string;
  api_name_encrypted: string | null;
  is_active: boolean;
  connected_at: string;
}

const ProfilePage = () => {
  const { user } = useAuth();
  const { role } = useUserRole();
  const { 
    state: tradingState, 
    walletAddress, 
    isWalletFunded,
    hasWallet,
    refresh: refreshTradingState
  } = useUserTradingState();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  
  const [activeSection, setActiveSection] = useState('profile');
  const [profileData, setProfileData] = useState<ProfileData>({
    full_name: '',
    username: '',
    avatar_url: ''
  });
  const [connections, setConnections] = useState<ConnectionData[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showApiKeys, setShowApiKeys] = useState(false);

  useEffect(() => {
    // Handle URL query parameters for direct tab navigation
    const searchParams = new URLSearchParams(location.search);
    const tab = searchParams.get('tab');
    const success = searchParams.get('success');
    const error = searchParams.get('error');
    
    if (tab) {
      setActiveSection(tab);
    }
    
    // Handle OAuth callback messages
    if (success === 'connected') {
      toast({
        title: "Connection successful",
        description: "Your Coinbase account has been connected successfully!",
      });
      // Clear the URL parameters
      navigate(location.pathname + '?tab=connections', { replace: true });
    }
    
    if (error) {
      const errorMessages = {
        oauth_failed: "OAuth authorization was declined or failed",
        missing_params: "Invalid OAuth response received",
        config_error: "OAuth configuration error. Please contact administrator.",
        token_failed: "Failed to exchange authorization code for tokens",
        storage_failed: "Failed to store connection. Please try again.",
        server_error: "Server error during OAuth process"
      };
      
      toast({
        title: "Connection failed",
        description: errorMessages[error as keyof typeof errorMessages] || "An unknown error occurred",
        variant: "destructive"
      });
      // Clear the URL parameters
      navigate(location.pathname + '?tab=connections', { replace: true });
    }
  }, [location.search, navigate, toast]);

  useEffect(() => {
    if (user) {
      loadProfileData();
      loadConnections();
    }
  }, [user]);

  const loadProfileData = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') throw error;

      if (data) {
        setProfileData(data);
      }
    } catch (error) {
      console.error('Error loading profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadConnections = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('user_coinbase_connections')
        .select('id, api_name_encrypted, is_active, connected_at')
        .eq('user_id', user.id)
        .order('connected_at', { ascending: false });

      if (error) throw error;
      setConnections(data || []);
    } catch (error) {
      console.error('Error loading connections:', error);
    }
  };

  const saveProfile = async () => {
    if (!user) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .upsert({
          id: user.id,
          ...profileData,
          updated_at: new Date().toISOString()
        });

      if (error) throw error;

      toast({
        title: "Profile updated",
        description: "Your profile has been saved successfully.",
      });
    } catch (error) {
      console.error('Error saving profile:', error);
      toast({
        title: "Error",
        description: "Failed to save profile. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const menuItems = [
    { id: 'profile', label: 'User Profile', icon: User, description: 'Manage your personal information and preferences' },
    { id: 'wallet', label: 'Trading Wallet', icon: Wallet, description: 'View your dedicated trading wallet' },
    { id: 'fees', label: 'Fee Settings', icon: CreditCard, description: 'Configure your trading fee rates' },
    { id: 'connections', label: 'Coinbase Connections', icon: Key, description: 'Choose and manage your Coinbase connections' },
    { id: 'notifications', label: 'Notifications', icon: Bell, description: 'Configure your notification preferences' },
    { id: 'security', label: 'Security', icon: Shield, description: 'Account security and authentication settings' },
    { id: 'subscription', label: 'Subscription', icon: CreditCard, description: 'Manage your trading plan and billing' },
    { id: 'referrals', label: 'Referral Program', icon: Users, description: 'Invite friends and earn rewards' },
    { id: 'gifts', label: 'Gift Cards', icon: Gift, description: 'Redeem gift cards and promotional codes' }
  ];

  const getInitials = (email: string) => {
    return email.split('@')[0].slice(0, 2).toUpperCase();
  };

  const renderContent = () => {
    switch (activeSection) {
      case 'profile':
        return (
          <div className="space-y-6">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-20 h-20 bg-cyan-500 rounded-full flex items-center justify-center text-white text-2xl font-bold">
                {user?.email ? getInitials(user.email) : 'U'}
              </div>
              <div>
                <h3 className="text-xl font-semibold text-white">{profileData.full_name || user?.email}</h3>
                <p className="text-slate-400">{user?.email}</p>
                {role === 'admin' && (
                  <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 mt-1">
                    <Shield className="w-3 h-3 mr-1" />
                    Administrator
                  </Badge>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label className="text-slate-300 mb-2 block">Full Name</Label>
                <Input
                  value={profileData.full_name || ''}
                  onChange={(e) => setProfileData(prev => ({ ...prev, full_name: e.target.value }))}
                  placeholder="Enter your full name"
                  className="bg-slate-700 border-slate-600 text-white"
                />
              </div>
              
              <div>
                <Label className="text-slate-300 mb-2 block">Username</Label>
                <Input
                  value={profileData.username || ''}
                  onChange={(e) => setProfileData(prev => ({ ...prev, username: e.target.value }))}
                  placeholder="Choose a username"
                  className="bg-slate-700 border-slate-600 text-white"
                />
              </div>

              <div className="md:col-span-2">
                <Label className="text-slate-300 mb-2 block">Email Address</Label>
                <Input
                  value={user?.email || ''}
                  disabled
                  className="bg-slate-800 border-slate-600 text-slate-400"
                />
                <p className="text-xs text-slate-500 mt-1">Email cannot be changed from this interface</p>
              </div>
            </div>

            <Button 
              onClick={saveProfile} 
              disabled={saving}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              <Save className="w-4 h-4 mr-2" />
              {saving ? 'Saving...' : 'Save Profile'}
            </Button>
          </div>
        );

      case 'wallet':
        // Use the new ExecutionWalletPanel component
        const ExecutionWalletPanel = React.lazy(() => 
          import('@/components/wallet/ExecutionWalletPanel').then(module => ({ 
            default: module.ExecutionWalletPanel 
          }))
        );
        
        return (
          <React.Suspense fallback={
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          }>
            <ExecutionWalletPanel />
          </React.Suspense>
        );

      case 'fees':
        return <FeeSettings />;

      case 'connections':
        // Import and use both connection components
        const CoinbaseConnectionManager = React.lazy(() => import('@/components/CoinbaseConnectionManager').then(module => ({ default: module.CoinbaseConnectionManager })));
        const CoinbaseConnectionSelector = React.lazy(() => import('@/components/CoinbaseConnectionSelector').then(module => ({ default: module.CoinbaseConnectionSelector })));
        
        return (
          <React.Suspense fallback={<div className="text-slate-400">Loading connection manager...</div>}>
            <div className="space-y-6">
              <CoinbaseConnectionManager />
              <div className="pt-6 border-t border-slate-600">
                <h3 className="text-lg font-semibold text-white mb-4">Add New Connection</h3>
                <CoinbaseConnectionSelector 
                  onConnectionEstablished={() => {
                    // Refresh the connection manager after adding a new connection
                    window.location.reload();
                  }}
                />
              </div>
            </div>
          </React.Suspense>
        );

      case 'security':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-white mb-2">Security Settings</h3>
              <p className="text-slate-400 mb-4">Manage your account security and authentication</p>
            </div>

            <Card className="p-6 bg-slate-700/30 border-slate-600">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h4 className="font-medium text-white">Two-Factor Authentication</h4>
                  <p className="text-sm text-slate-400">Add an extra layer of security to your account</p>
                </div>
                <Badge variant="secondary" className="bg-red-500/20 text-red-400">
                  Not Enabled
                </Badge>
              </div>
              <Button variant="outline" className="border-slate-600 text-slate-300">
                Enable 2FA
              </Button>
            </Card>

            <Card className="p-6 bg-slate-700/30 border-slate-600">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h4 className="font-medium text-white">API Key Access</h4>
                  <p className="text-sm text-slate-400">View and manage your API access keys</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowApiKeys(!showApiKeys)}
                  className="text-slate-300"
                >
                  {showApiKeys ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
              {showApiKeys && (
                <div className="text-sm text-slate-400 font-mono bg-slate-800 p-3 rounded">
                  No API keys configured
                </div>
              )}
            </Card>
          </div>
        );

      default:
        return (
          <Card className="p-8 bg-slate-700/30 border-slate-600 text-center">
            <Settings className="w-12 h-12 mx-auto mb-4 text-slate-500" />
            <h4 className="text-lg font-medium text-white mb-2">Coming Soon</h4>
            <p className="text-slate-400">This section is under development</p>
          </Card>
        );
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <div className="text-white">Loading profile...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="container mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Button
            variant="ghost"
            onClick={() => navigate('/')}
            className="text-slate-300 hover:text-white"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Button>
          <h1 className="text-2xl font-bold text-white">My Account</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Sidebar */}
          <div className="lg:col-span-1">
            <Card className="bg-slate-800/50 border-slate-700 p-4">
              <div className="space-y-2">
                {menuItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeSection === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setActiveSection(item.id)}
                      className={`w-full flex items-center gap-3 p-3 rounded-lg text-left transition-colors ${
                        isActive 
                          ? 'bg-cyan-500 text-white' 
                          : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      <span className="text-sm font-medium">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </Card>
          </div>

          {/* Main Content */}
          <div className="lg:col-span-3">
            <Card className="bg-slate-800/50 border-slate-700 p-6">
              <div className="mb-6">
                <h2 className="text-xl font-semibold text-white mb-2">
                  {menuItems.find(item => item.id === activeSection)?.label}
                </h2>
                <p className="text-slate-400">
                  {menuItems.find(item => item.id === activeSection)?.description}
                </p>
              </div>
              
              <Separator className="bg-slate-700 mb-6" />
              
              {renderContent()}
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfilePage;