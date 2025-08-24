import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface TestModeContextType {
  testMode: boolean;
  setTestMode: (enabled: boolean) => void;
  toggleTestMode: () => void;
}

const TestModeContext = createContext<TestModeContextType | undefined>(undefined);

export const TestModeProvider = ({ children }: { children: ReactNode }) => {
  console.log('🧪 TestModeProvider: COMPONENT INITIALIZING');
  console.log('🧪 TestModeProvider: localStorage check:', typeof localStorage, Object.keys(localStorage || {}));
  
  const [testMode, setTestModeState] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('global-test-mode');
      const initialMode = saved ? JSON.parse(saved) : false;
      console.log('🧪 TestModeProvider: Initializing with mode:', initialMode, 'from localStorage:', saved);
      return initialMode;
    } catch (error) {
      console.error('🧪 TestModeProvider: Error reading localStorage:', error);
      return false;
    }
  });

  const setTestMode = (enabled: boolean) => {
    console.log('🧪 TestModeProvider: Setting test mode to:', enabled);
    setTestModeState(enabled);
    localStorage.setItem('global-test-mode', JSON.stringify(enabled));
  };

  const toggleTestMode = () => {
    const newMode = !testMode;
    console.log('🧪 TestModeProvider: Toggling test mode from', testMode, 'to', newMode);
    setTestMode(newMode);
    return newMode;
  };

  useEffect(() => {
    console.log('🧪 TestModeProvider: useEffect triggered, saving mode:', testMode);
    localStorage.setItem('global-test-mode', JSON.stringify(testMode));
  }, [testMode]);

  console.log('🧪 TestModeProvider: Rendering with testMode:', testMode);

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