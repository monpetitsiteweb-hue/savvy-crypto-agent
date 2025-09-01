import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface TestModeContextType {
  testMode: boolean;
  setTestMode: (enabled: boolean) => void;
  toggleTestMode: () => void;
}

const TestModeContext = createContext<TestModeContextType | undefined>(undefined);

export const TestModeProvider = ({ children }: { children: ReactNode }) => {
  const [testMode, setTestModeState] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('global-test-mode');
      const initialMode = saved ? JSON.parse(saved) : false;
      console.log('🧪 TESTMODE_PROVIDER_HYDRATED', { testMode: initialMode });
      return initialMode;
    } catch (error) {
      console.log('🧪 TESTMODE_PROVIDER_HYDRATED', { testMode: false, error: true });
      return false;
    }
  });

  const setTestMode = (enabled: boolean) => {
    setTestModeState(enabled);
    localStorage.setItem('global-test-mode', JSON.stringify(enabled));
  };

  const toggleTestMode = () => {
    const newMode = !testMode;
    setTestMode(newMode);
    return newMode;
  };

  useEffect(() => {
    localStorage.setItem('global-test-mode', JSON.stringify(testMode));
  }, [testMode]);

  return (
    <TestModeContext.Provider value={{ testMode, setTestMode, toggleTestMode }}>
      {children}
    </TestModeContext.Provider>
  );
};

export const useTestMode = () => {
  const context = useContext(TestModeContext);
  if (context === undefined) {
    throw new Error('useTestMode must be used within a TestModeProvider');
  }
  return context;
};