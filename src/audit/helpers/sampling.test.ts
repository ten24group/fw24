import { 
  createHashBasedSampling, 
  createRandomSampling, 
  createAlwaysSample, 
  createNeverSample 
} from './sampling';

describe('Audit Sampling Functions', () => {
  describe('createHashBasedSampling', () => {
    it('should return consistent results for same input', () => {
      const sampler = createHashBasedSampling(0.5);
      const correlationId = 'test-correlation-123';
      const operation = 'getUserById';

      const result1 = sampler(correlationId, operation);
      const result2 = sampler(correlationId, operation);
      const result3 = sampler(correlationId, operation);

      expect(result1).toBe(result2);
      expect(result2).toBe(result3);
    });

    it('should return different results for different inputs', () => {
      const sampler = createHashBasedSampling(0.5);
      
      const results = new Set();
      for (let i = 0; i < 100; i++) {
        const result = sampler(`correlation-${i}`, 'operation');
        results.add(result);
      }

      // Should have both true and false results for 100 different inputs
      expect(results.size).toBe(2);
      expect(results.has(true)).toBe(true);
      expect(results.has(false)).toBe(true);
    });

    it('should respect sampling rate approximately', () => {
      const samplingRate = 0.3; // 30%
      const sampler = createHashBasedSampling(samplingRate);
      
      let trueCount = 0;
      const totalSamples = 1000;
      
      for (let i = 0; i < totalSamples; i++) {
        if (sampler(`correlation-${i}`, 'operation')) {
          trueCount++;
        }
      }
      
      const actualRate = trueCount / totalSamples;
      
      // Should be within 10% of expected rate (hash-based sampling isn't perfectly uniform)
      expect(actualRate).toBeGreaterThan(samplingRate - 0.1);
      expect(actualRate).toBeLessThan(samplingRate + 0.1);
    });

    it('should handle edge cases for sampling rate', () => {
      // 0% sampling
      const neverSampler = createHashBasedSampling(0);
      for (let i = 0; i < 100; i++) {
        expect(neverSampler(`correlation-${i}`, 'operation')).toBe(false);
      }

      // 100% sampling
      const alwaysSampler = createHashBasedSampling(1);
      for (let i = 0; i < 100; i++) {
        expect(alwaysSampler(`correlation-${i}`, 'operation')).toBe(true);
      }
    });

    it('should handle invalid sampling rates gracefully', () => {
      // Negative rate should default to 0
      const negativeSampler = createHashBasedSampling(-0.5);
      expect(negativeSampler('test', 'operation')).toBe(false);

      // Rate > 1 should default to 1
      const overSampler = createHashBasedSampling(1.5);
      expect(overSampler('test', 'operation')).toBe(true);
    });

    it('should produce deterministic results based on both correlation ID and operation', () => {
      const sampler = createHashBasedSampling(0.5);
      
      // Same correlation ID, different operations
      const result1 = sampler('corr-123', 'getUserById');
      const result2 = sampler('corr-123', 'updateUser');
      
      // Different correlation ID, same operation
      const result3 = sampler('corr-456', 'getUserById');
      
      // Results should be deterministic for each combination
      expect(sampler('corr-123', 'getUserById')).toBe(result1);
      expect(sampler('corr-123', 'updateUser')).toBe(result2);
      expect(sampler('corr-456', 'getUserById')).toBe(result3);
    });

    it('should handle empty or null inputs', () => {
      const sampler = createHashBasedSampling(0.5);
      
      // Should not throw errors
      expect(() => sampler('', '')).not.toThrow();
      expect(() => sampler('test', '')).not.toThrow();
      expect(() => sampler('', 'operation')).not.toThrow();
      
      // Should be deterministic even with empty strings
      const result1 = sampler('', '');
      const result2 = sampler('', '');
      expect(result1).toBe(result2);
    });
  });

  describe('createRandomSampling', () => {
    it('should respect sampling rate over multiple calls', () => {
      const samplingRate = 0.4; // 40%
      const sampler = createRandomSampling(samplingRate);
      
      let trueCount = 0;
      const totalSamples = 1000;
      
      for (let i = 0; i < totalSamples; i++) {
        if (sampler(`correlation-${i}`, 'operation')) {
          trueCount++;
        }
      }
      
      const actualRate = trueCount / totalSamples;
      
      // Random sampling should be close to expected rate (within 5%)
      expect(actualRate).toBeGreaterThan(samplingRate - 0.05);
      expect(actualRate).toBeLessThan(samplingRate + 0.05);
    });

    it('should return different results for same input (non-deterministic)', () => {
      const sampler = createRandomSampling(0.5);
      const correlationId = 'test-correlation-123';
      const operation = 'getUserById';

      const results = new Set();
      
      // Run multiple times - should get varied results due to randomness
      for (let i = 0; i < 50; i++) {
        results.add(sampler(correlationId, operation));
      }
      
      // With 50% sampling and 50 calls, should see both true and false
      expect(results.size).toBe(2);
    });

    it('should handle edge cases for sampling rate', () => {
      // 0% sampling
      const neverSampler = createRandomSampling(0);
      for (let i = 0; i < 100; i++) {
        expect(neverSampler(`correlation-${i}`, 'operation')).toBe(false);
      }

      // 100% sampling
      const alwaysSampler = createRandomSampling(1);
      for (let i = 0; i < 100; i++) {
        expect(alwaysSampler(`correlation-${i}`, 'operation')).toBe(true);
      }
    });

    it('should handle invalid sampling rates gracefully', () => {
      // Negative rate should default to 0
      const negativeSampler = createRandomSampling(-0.5);
      expect(negativeSampler('test', 'operation')).toBe(false);

      // Rate > 1 should default to 1
      const overSampler = createRandomSampling(1.5);
      expect(overSampler('test', 'operation')).toBe(true);
    });
  });

  describe('createAlwaysSample', () => {
    it('should always return true regardless of input', () => {
      const sampler = createAlwaysSample();
      
      expect(sampler('', '')).toBe(true);
      expect(sampler('test-corr', 'operation')).toBe(true);
      expect(sampler('another-corr', 'different-op')).toBe(true);
      
      // Test with various inputs
      for (let i = 0; i < 100; i++) {
        expect(sampler(`correlation-${i}`, `operation-${i}`)).toBe(true);
      }
    });

    it('should be consistent across multiple calls', () => {
      const sampler = createAlwaysSample();
      const correlationId = 'test-correlation';
      const operation = 'testOperation';
      
      for (let i = 0; i < 50; i++) {
        expect(sampler(correlationId, operation)).toBe(true);
      }
    });
  });

  describe('createNeverSample', () => {
    it('should always return false regardless of input', () => {
      const sampler = createNeverSample();
      
      expect(sampler('', '')).toBe(false);
      expect(sampler('test-corr', 'operation')).toBe(false);
      expect(sampler('another-corr', 'different-op')).toBe(false);
      
      // Test with various inputs
      for (let i = 0; i < 100; i++) {
        expect(sampler(`correlation-${i}`, `operation-${i}`)).toBe(false);
      }
    });

    it('should be consistent across multiple calls', () => {
      const sampler = createNeverSample();
      const correlationId = 'test-correlation';
      const operation = 'testOperation';
      
      for (let i = 0; i < 50; i++) {
        expect(sampler(correlationId, operation)).toBe(false);
      }
    });
  });

  describe('Sampling Function Comparison', () => {
    it('should demonstrate different behaviors between hash-based and random sampling', () => {
      const hashSampler = createHashBasedSampling(0.5);
      const randomSampler = createRandomSampling(0.5);
      
      const correlationId = 'consistent-correlation';
      const operation = 'testOperation';
      
      // Hash-based should be consistent
      const hashResults = [];
      for (let i = 0; i < 10; i++) {
        hashResults.push(hashSampler(correlationId, operation));
      }
      
      // All hash results should be the same
      expect(new Set(hashResults).size).toBe(1);
      
      // Random should vary (with high probability)
      const randomResults = [];
      for (let i = 0; i < 50; i++) {
        randomResults.push(randomSampler(correlationId, operation));
      }
      
      // Random results should include both true and false (very high probability)
      expect(new Set(randomResults).size).toBe(2);
    });

    it('should show practical usage scenarios', () => {
      // Scenario 1: Consistent sampling for debugging a specific flow
      const debugSampler = createHashBasedSampling(1.0); // Always sample specific flows
      expect(debugSampler('debug-session-123', 'criticalOperation')).toBe(true);
      expect(debugSampler('debug-session-123', 'criticalOperation')).toBe(true); // Consistent
      
      // Scenario 2: Random sampling for general monitoring
      const monitoringSampler = createRandomSampling(0.01); // 1% sampling
      
      let sampledCount = 0;
      for (let i = 0; i < 1000; i++) {
        if (monitoringSampler(`request-${i}`, 'generalOperation')) {
          sampledCount++;
        }
      }
      
      // Should be approximately 1% (within reasonable range)
      expect(sampledCount).toBeGreaterThan(0);
      expect(sampledCount).toBeLessThan(50); // Should be well under 5%
      
      // Scenario 3: Disable sampling during high load
      const disabledSampler = createNeverSample();
      expect(disabledSampler('high-load-period', 'anyOperation')).toBe(false);
      
      // Scenario 4: Force sampling for critical operations
      const criticalSampler = createAlwaysSample();
      expect(criticalSampler('payment-process', 'chargeCard')).toBe(true);
    });
  });

  describe('Performance Characteristics', () => {
    it('should execute sampling functions quickly', () => {
      const hashSampler = createHashBasedSampling(0.5);
      const randomSampler = createRandomSampling(0.5);
      const alwaysSampler = createAlwaysSample();
      const neverSampler = createNeverSample();
      
      const iterations = 10000;
      const correlationId = 'performance-test';
      const operation = 'benchmarkOperation';
      
      // Test hash-based sampling performance
      const hashStart = process.hrtime();
      for (let i = 0; i < iterations; i++) {
        hashSampler(`${correlationId}-${i}`, operation);
      }
      const hashTime = process.hrtime(hashStart);
      
      // Test random sampling performance
      const randomStart = process.hrtime();
      for (let i = 0; i < iterations; i++) {
        randomSampler(`${correlationId}-${i}`, operation);
      }
      const randomTime = process.hrtime(randomStart);
      
      // Test always sampling performance
      const alwaysStart = process.hrtime();
      for (let i = 0; i < iterations; i++) {
        alwaysSampler(`${correlationId}-${i}`, operation);
      }
      const alwaysTime = process.hrtime(alwaysStart);
      
      // Test never sampling performance
      const neverStart = process.hrtime();
      for (let i = 0; i < iterations; i++) {
        neverSampler(`${correlationId}-${i}`, operation);
      }
      const neverTime = process.hrtime(neverStart);
      
      // All should complete within reasonable time (less than 100ms for 10k operations)
      expect(hashTime[0]).toBe(0); // Should be less than 1 second
      expect(randomTime[0]).toBe(0);
      expect(alwaysTime[0]).toBe(0);
      expect(neverTime[0]).toBe(0);
      
      // Always and never samplers should be fastest
      expect(alwaysTime[1]).toBeLessThan(hashTime[1]);
      expect(neverTime[1]).toBeLessThan(hashTime[1]);
    });
  });
});
