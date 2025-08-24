
import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
  console.log('🚨🚨🚨 AUTHPROVIDER: COMPONENT IS RENDERING!!! 🚨🚨🚨');
  
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  console.log('🔑 AUTHPROVIDER: State initialized - Current values:', { user: !!user, session: !!session, loading });
  console.log('🔑 AUTHPROVIDER: About to run useEffect');

  useEffect(() => {
    console.log('🔑 AUTHPROVIDER: === USEEFFECT STARTED ===');
    let mounted = true;
    
    const initializeAuth = async () => {
      console.log('🔑 AUTHPROVIDER: initializeAuth starting');
      try {
        console.log('🔑 AUTHPROVIDER: Calling supabase.auth.getSession()');
        const { data: { session }, error } = await supabase.auth.getSession();
        console.log('🔑 AUTHPROVIDER: Session result - User:', session?.user?.email, 'Error:', error);
        
        if (mounted) {
          console.log('🔑 AUTHPROVIDER: Setting states - mounted is true');
          setSession(session);
          setUser(session?.user ?? null);
          setLoading(false);
          console.log('🔑 AUTHPROVIDER: States updated successfully');
        } else {
          console.log('🔑 AUTHPROVIDER: Component unmounted, skipping state update');
        }
      } catch (err) {
        console.error('🔑 AUTHPROVIDER: ERROR in initializeAuth:', err);
        if (mounted) {
          setLoading(false);
        }
      }
    };
    
    console.log('🔑 AUTHPROVIDER: Setting up auth state listener');
    // Set up auth state listener first
    try {
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange(async (event, session) => {
        console.log('🔑 AUTHPROVIDER: Auth state change event:', event);
        if (mounted) {
          setSession(session);
          setUser(session?.user ?? null);
          setLoading(false);
          console.log('🔑 AUTHPROVIDER: Auth state updated via listener');
        }
      });

      console.log('🔑 AUTHPROVIDER: Auth listener set up, calling initializeAuth');
      // Initialize auth after setting up listener
      initializeAuth();

      return () => {
        console.log('🔑 AUTHPROVIDER: Cleanup function called');
        mounted = false;
        subscription.unsubscribe();
      };
    } catch (err) {
      console.error('🔑 AUTHPROVIDER: ERROR setting up auth listener:', err);
      setLoading(false);
    }
  }, []);

  console.log('🔑 AUTHPROVIDER: About to render with user:', !!user, 'loading:', loading);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const value = {
    user,
    session,
    loading,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
