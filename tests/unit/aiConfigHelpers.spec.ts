import { describe, it, expect } from 'vitest';
import { equalsWithin, detectPreset } from '@/utils/aiConfigHelpers';

describe('aiConfigHelpers', () => {
  describe('equalsWithin', () => {
    it('should return true for values within epsilon', () => {
      expect(equalsWithin(0.65, 0.65000001)).toBe(true);
      expect(equalsWithin(3.0, 3.0000001)).toBe(true);
      expect(equalsWithin(0.40, 0.40000001)).toBe(true);
    });

    it('should return false for values beyond epsilon', () => {
      expect(equalsWithin(0.65, 0.66)).toBe(false);
      expect(equalsWithin(3.0, 3.1)).toBe(false);
      expect(equalsWithin(0.40, 0.41)).toBe(false);
    });

    it('should handle custom epsilon values', () => {
      expect(equalsWithin(0.65, 0.651, 0.01)).toBe(true);
      expect(equalsWithin(0.65, 0.661, 0.01)).toBe(false);
    });
  });

  describe('detectPreset', () => {
    it('should detect microScalp preset correctly', () => {
      const microScalpConfig = {
        features: {
          fusion: {
            enabled: true,
            enterThreshold: 0.65,
            exitThreshold: 0.35,
            weights: { trend: 0.25, volatility: 0.20, momentum: 0.25, whale: 0.15, sentiment: 0.15 }
          },
          contextGates: {
            spreadThresholdBps: 12,
            minDepthRatio: 3.0,
            whaleConflictWindowMs: 300000
          },
          bracketPolicy: {
            stopLossPctWhenNotAtr: 0.40,
            trailBufferPct: 0.40,
            minTpSlRatio: 1.2
          }
        }
      };

      expect(detectPreset(microScalpConfig)).toBe('microScalp');
    });

    it('should detect microScalp preset with values within epsilon', () => {
      const microScalpConfigWithEpsilon = {
        features: {
          fusion: {
            enabled: true,
            enterThreshold: 0.65000001, // Within epsilon
            exitThreshold: 0.34999999,  // Within epsilon
            weights: { trend: 0.25, volatility: 0.20, momentum: 0.25, whale: 0.15, sentiment: 0.15 }
          },
          contextGates: {
            spreadThresholdBps: 12,
            minDepthRatio: 3.0000001,   // Within epsilon
            whaleConflictWindowMs: 300000
          },
          bracketPolicy: {
            stopLossPctWhenNotAtr: 0.39999999, // Within epsilon
            trailBufferPct: 0.40000001,        // Within epsilon
            minTpSlRatio: 1.2000001            // Within epsilon
          }
        }
      };

      expect(detectPreset(microScalpConfigWithEpsilon)).toBe('microScalp');
    });

    it('should detect aggressive preset correctly', () => {
      const aggressiveConfig = {
        features: {
          fusion: {
            enabled: true,
            enterThreshold: 0.55,
            exitThreshold: 0.25,
            weights: { trend: 0.30, volatility: 0.15, momentum: 0.30, whale: 0.10, sentiment: 0.15 }
          },
          contextGates: {
            spreadThresholdBps: 18,
            minDepthRatio: 2.5,
            whaleConflictWindowMs: 180000
          }
        }
      };

      expect(detectPreset(aggressiveConfig)).toBe('aggressive');
    });

    it('should detect conservative preset correctly', () => {
      const conservativeConfig = {
        features: {
          fusion: {
            enabled: false
          },
          contextGates: {
            spreadThresholdBps: 8,
            minDepthRatio: 4.0
          }
        }
      };

      expect(detectPreset(conservativeConfig)).toBe('conservative');
    });

    it('should return custom for modified preset values', () => {
      const modifiedConfig = {
        features: {
          fusion: {
            enabled: true,
            enterThreshold: 0.60, // Different from microScalp
            exitThreshold: 0.35,
            weights: { trend: 0.25, volatility: 0.20, momentum: 0.25, whale: 0.15, sentiment: 0.15 }
          },
          contextGates: {
            spreadThresholdBps: 12,
            minDepthRatio: 3.0,
            whaleConflictWindowMs: 300000
          },
          bracketPolicy: {
            stopLossPctWhenNotAtr: 0.40,
            trailBufferPct: 0.40,
            minTpSlRatio: 1.2
          }
        }
      };

      expect(detectPreset(modifiedConfig)).toBe('custom');
    });

    it('should return custom for config without features', () => {
      expect(detectPreset({})).toBe('custom');
      expect(detectPreset({ features: null })).toBe('custom');
      expect(detectPreset(null)).toBe('custom');
    });

    it('should handle values beyond epsilon as custom', () => {
      const beyondEpsilonConfig = {
        features: {
          fusion: {
            enabled: true,
            enterThreshold: 0.651, // Beyond epsilon from 0.65
            exitThreshold: 0.35,
            weights: { trend: 0.25, volatility: 0.20, momentum: 0.25, whale: 0.15, sentiment: 0.15 }
          },
          contextGates: {
            spreadThresholdBps: 12,
            minDepthRatio: 3.0,
            whaleConflictWindowMs: 300000
          },
          bracketPolicy: {
            stopLossPctWhenNotAtr: 0.40,
            trailBufferPct: 0.40,
            minTpSlRatio: 1.2
          }
        }
      };

      expect(detectPreset(beyondEpsilonConfig)).toBe('custom');
    });
  });
});