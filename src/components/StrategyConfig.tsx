import React from 'react';

interface StrategyConfigProps {}

export const StrategyConfig: React.FC<StrategyConfigProps> = () => {
  return (
    <div style={{ background: 'red', padding: '20px', border: '5px solid yellow' }}>
      <h1 style={{ color: 'white', fontSize: '24px' }}>MINIMAL STRATEGY CONFIG TEST</h1>
      <button 
        onClick={() => alert('MINIMAL BUTTON WORKS!')}
        style={{ 
          background: 'blue', 
          color: 'white', 
          padding: '10px 20px', 
          border: 'none',
          cursor: 'pointer',
          fontSize: '16px',
          margin: '10px'
        }}
      >
        TEST BUTTON 1
      </button>
      <button 
        onClick={() => alert('BUTTON 2 WORKS TOO!')}
        style={{ 
          background: 'green', 
          color: 'white', 
          padding: '10px 20px', 
          border: 'none',
          cursor: 'pointer',
          fontSize: '16px',
          margin: '10px'
        }}
      >
        TEST BUTTON 2
      </button>
    </div>
  );
};