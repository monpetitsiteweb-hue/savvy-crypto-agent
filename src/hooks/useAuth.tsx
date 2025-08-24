
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
  console.log('🔑 AUTHPROVIDER: Supabase client check:', !!supabase);
  
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
        if (!supabase?.auth) {
          console.error('🔑 AUTHPROVIDER: CRITICAL - Supabase client or auth not available!');
          if (mounted) setLoading(false);
          return;
        }
        
        // FIXED: Force refresh session to ensure we get current state
        const { data: { session }, error } = await supabase.auth.refreshSession();
        console.log('🔑 AUTHPROVIDER: FORCED REFRESH - Session result:', !!session, 'User:', session?.user?.email, 'Error:', error);
        
        if (mounted) {
          setSession(session);
          setUser(session?.user ?? null);
          setLoading(false);
          console.log('🔑 AUTHPROVIDER: ✅ Auth state FIXED - User authenticated:', !!session?.user);
        }
      } catch (err) {
        console.error('🔑 AUTHPROVIDER: ERROR in initializeAuth:', err);
        if (mounted) setLoading(false);
      }
    };
    
    // Set up auth state listener
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('🔑 AUTHPROVIDER: Auth event:', event, 'Session exists:', !!session);
      if (mounted) {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
        console.log('🔑 AUTHPROVIDER: ✅ Auth state synced via listener - User:', !!session?.user);
      }
    });

    // Initialize immediately
    initializeAuth();

    return () => {
      console.log('🔑 AUTHPROVIDER: Cleanup');
      mounted = false;
      subscription.unsubscribe();
    };
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
