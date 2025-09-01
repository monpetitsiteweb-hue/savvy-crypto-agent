
import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/utils/logger';

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
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    
    const initializeAuth = async () => {
      try {
        if (!supabase?.auth) {
          logger.error('AUTHPROVIDER: CRITICAL - Supabase client or auth not available!');
          if (mounted) setLoading(false);
          return;
        }
        
        // FIXED: Force refresh session to ensure we get current state
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (mounted) {
          // FIXED: Properly extract user from session
          const extractedUser = session?.user || null;
          
          setSession(session);
          setUser(extractedUser);
          setLoading(false);
        }
      } catch (err) {
        logger.error('AUTHPROVIDER: ERROR in initializeAuth:', err);
        if (mounted) setLoading(false);
      }
    };
    
    // Set up auth state listener
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (mounted) {
        const extractedUser = session?.user || null;
        
        setSession(session);
        setUser(extractedUser);
        setLoading(false);
      }
    });

    // Initialize immediately
    initializeAuth();

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

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
