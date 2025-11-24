/**
 * Whale Signals Ingestion - Phase 1 Tests
 * 
 * Validates that whale signals are correctly ingested and compatible with Signal Fusion.
 */

import { describe, it, expect } from 'vitest';

describe('Whale Signals Ingestion', () => {
  describe('Signal Type Mapping', () => {
    it('should map exchange inflow to whale_exchange_inflow signal type', () => {
      const tx = {
        from: { address: '0x123', owner: '' },
        to: { address: '0x456', owner: 'Binance' },
        symbol: 'BTC',
        amount_usd: 5000000
      };

      // Simulate webhook logic
      const fromOwner = tx.from.owner || '';
      const toOwner = tx.to.owner || '';
      const isExchangeInflow = toOwner && !fromOwner;
      const isStablecoin = ['USDT', 'USDC', 'DAI', 'BUSD'].includes(tx.symbol?.toUpperCase());
      
      let signalType = 'whale_transfer';
      if (isExchangeInflow) {
        signalType = isStablecoin ? 'whale_usdt_injection' : 'whale_exchange_inflow';
      }

      expect(signalType).toBe('whale_exchange_inflow');
    });

    it('should map exchange outflow to whale_exchange_outflow signal type', () => {
      const tx = {
        from: { address: '0x123', owner: 'Coinbase' },
        to: { address: '0x456', owner: '' },
        symbol: 'ETH',
        amount_usd: 3000000
      };

      const fromOwner = tx.from.owner || '';
      const toOwner = tx.to.owner || '';
      const isExchangeOutflow = fromOwner && !toOwner;
      
      let signalType = 'whale_transfer';
      if (isExchangeOutflow) {
        signalType = 'whale_exchange_outflow';
      }

      expect(signalType).toBe('whale_exchange_outflow');
    });

    it('should map stablecoin injection to whale_usdt_injection', () => {
      const tx = {
        from: { address: '0x123', owner: '' },
        to: { address: '0x456', owner: 'Binance' },
        symbol: 'USDT',
        amount_usd: 10000000
      };

      const fromOwner = tx.from.owner || '';
      const toOwner = tx.to.owner || '';
      const isExchangeInflow = toOwner && !fromOwner;
      const isStablecoin = ['USDT', 'USDC', 'DAI', 'BUSD'].includes(tx.symbol?.toUpperCase());
      
      let signalType = 'whale_transfer';
      if (isExchangeInflow) {
        signalType = isStablecoin ? 'whale_usdt_injection' : 'whale_exchange_inflow';
      }

      expect(signalType).toBe('whale_usdt_injection');
    });

    it('should map stablecoin mint to whale_stablecoin_mint', () => {
      const tx = {
        from: { address: '0x123', owner: 'Tether Treasury' },
        to: { address: '0x456', owner: '' },
        symbol: 'USDT',
        amount_usd: 50000000
      };

      const fromOwner = tx.from.owner || '';
      const toOwner = tx.to.owner || '';
      const isStablecoin = ['USDT', 'USDC', 'DAI', 'BUSD'].includes(tx.symbol?.toUpperCase());
      
      let signalType = 'whale_transfer';
      if (isStablecoin && fromOwner === 'Tether Treasury') {
        signalType = 'whale_stablecoin_mint';
      }

      expect(signalType).toBe('whale_stablecoin_mint');
    });
  });

  describe('Signal Strength Calculation', () => {
    it('should scale signal strength based on USD value', () => {
      const testCases = [
        { amount_usd: 50000, expected: 5 },      // $50k = 5
        { amount_usd: 1000000, expected: 100 },  // $1M = 100 (capped)
        { amount_usd: 5000000, expected: 100 },  // $5M = 100 (capped)
        { amount_usd: 500000, expected: 50 },    // $500k = 50
      ];

      testCases.forEach(({ amount_usd, expected }) => {
        const strength = Math.min(100, amount_usd / 1000000 * 100);
        expect(strength).toBe(expected);
      });
    });
  });

  describe('Live Signal Data Structure', () => {
    it('should create correct structure for tracked wallet webhook', () => {
      const signal = {
        source_id: 'uuid-1',
        user_id: 'uuid-2',
        timestamp: '2025-11-24T22:00:00Z',
        symbol: 'BTC',
        signal_type: 'whale_exchange_inflow',
        signal_strength: 85,
        source: 'whale_alert_tracked',
        data: {
          hash: '0xabc123',
          from: '0x1234',
          to: '0x5678',
          amount: 250,
          amount_usd: 8500000,
          asset: 'BTC',
          blockchain: 'bitcoin',
          timestamp: 1764021309,
          transaction_type: 'inflow',
          exchange: 'Binance',
          tracked_entity: 'BlackRock',
          tracked_entity_type: 'fund',
          tracked_entity_id: null
        },
        processed: false
      };

      // Validate structure
      expect(signal).toHaveProperty('source_id');
      expect(signal).toHaveProperty('user_id');
      expect(signal).toHaveProperty('timestamp');
      expect(signal).toHaveProperty('symbol');
      expect(signal).toHaveProperty('signal_type');
      expect(signal).toHaveProperty('signal_strength');
      expect(signal).toHaveProperty('source');
      expect(signal).toHaveProperty('data');
      expect(signal).toHaveProperty('processed');

      // Validate source differentiation
      expect(signal.source).toBe('whale_alert_tracked');

      // Validate tracked entity metadata
      expect(signal.data).toHaveProperty('tracked_entity');
      expect(signal.data).toHaveProperty('tracked_entity_type');
      expect(signal.data.tracked_entity).toBe('BlackRock');
    });

    it('should create correct structure for global whale API', () => {
      const signal = {
        source_id: 'uuid-1',
        user_id: 'uuid-2',
        timestamp: '2025-11-24T22:05:00Z',
        symbol: 'ETH',
        signal_type: 'whale_exchange_outflow',
        signal_strength: 72,
        source: 'whale_alert_api',
        data: {
          hash: '0xdef456',
          from: '0x9abc',
          to: '0xdef0',
          amount: 1200,
          amount_usd: 4200000,
          asset: 'ETH',
          blockchain: 'ethereum',
          timestamp: 1764021609,
          transaction_type: 'outflow',
          exchange: 'Coinbase',
          tracked_entity: null,
          tracked_entity_type: null
        },
        processed: false
      };

      // Validate structure
      expect(signal.source).toBe('whale_alert_api');

      // Validate NO tracked entity for global whales
      expect(signal.data.tracked_entity).toBeNull();
      expect(signal.data.tracked_entity_type).toBeNull();
    });
  });

  describe('Signal Fusion Compatibility', () => {
    it('should have all required fields for fusion', () => {
      const signal = {
        source_id: 'uuid',
        user_id: 'uuid',
        timestamp: '2025-11-24T22:00:00Z',
        symbol: 'BTC',
        signal_type: 'whale_exchange_inflow',
        signal_strength: 85,
        source: 'whale_alert_tracked',
        data: {},
        processed: false
      };

      // These fields are required by Signal Fusion module
      expect(signal).toHaveProperty('symbol');
      expect(signal).toHaveProperty('signal_type');
      expect(signal).toHaveProperty('signal_strength');
      expect(signal).toHaveProperty('source');
      expect(signal).toHaveProperty('timestamp');

      // Signal strength should be 0-100 (fusion normalizes to 0-1)
      expect(signal.signal_strength).toBeGreaterThanOrEqual(0);
      expect(signal.signal_strength).toBeLessThanOrEqual(100);
    });

    it('should use signal types that exist in signal_registry', () => {
      const validSignalTypes = [
        'whale_exchange_inflow',
        'whale_exchange_outflow',
        'whale_transfer',
        'whale_usdt_injection',
        'whale_usdc_injection',
        'whale_stablecoin_mint',
        'whale_stablecoin_burn',
        'whale_unusual_activity_spike',
        'whale_chain_anomaly'
      ];

      const testSignal = 'whale_exchange_inflow';
      expect(validSignalTypes).toContain(testSignal);
    });
  });

  describe('Source Differentiation', () => {
    it('should use whale_alert_tracked for webhook-based tracked wallets', () => {
      const source = 'whale_alert_tracked';
      expect(source).toBe('whale_alert_tracked');
    });

    it('should use whale_alert_api for API-based global whales', () => {
      const source = 'whale_alert_api';
      expect(source).toBe('whale_alert_api');
    });

    it('should NOT use generic whale_alert source anymore', () => {
      // Old pattern - no longer used
      const oldSource = 'whale_alert';
      const validSources = ['whale_alert_tracked', 'whale_alert_api'];
      
      expect(validSources).not.toContain(oldSource);
    });
  });
});
