import React from 'react';
import { formatEuro } from '@/utils/currencyFormatter';

export const TestEuroFormatting = () => {
  const testValues = [100, 1000, 12.45, 0, null, undefined, -50.75];
  
  return (
    <div className="p-4 bg-white rounded border">
      <h3 className="font-bold mb-4">Euro Formatting Test</h3>
      {testValues.map((value, index) => (
        <div key={index} className="mb-2">
          <span className="font-mono">
            formatEuro({JSON.stringify(value)}) = {formatEuro(value as any)}
          </span>
        </div>
      ))}
    </div>
  );
};