import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface TestModeContextType {
  testMode: boolean;
  setTestMode: (enabled: boolean) => void;
}

const TestModeContext = createContext<TestModeContextType | undefined>(undefined);

export const TestModeProvider = ({ children }: { children: ReactNode }) => {
  const [testMode, setTestModeState] = useState<boolean>(() => {
    const saved = localStorage.getItem('global-test-mode');
    return saved ? JSON.parse(saved) : false;
  });

  const setTestMode = (enabled: boolean) => {
    setTestModeState(enabled);
    localStorage.setItem('global-test-mode', JSON.stringify(enabled));
  };

  useEffect(() => {
    localStorage.setItem('global-test-mode', JSON.stringify(testMode));
  }, [testMode]);

  return (
    <TestModeContext.Provider value={{ testMode, setTestMode }}>
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