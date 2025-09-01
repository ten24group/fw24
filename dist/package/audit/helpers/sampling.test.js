"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sampling_1 = require("./sampling");
describe('Audit Sampling Functions', () => {
    describe('createHashBasedSampling', () => {
        it('should return consistent results for same input', () => {
            const sampler = (0, sampling_1.createHashBasedSampling)(0.5);
            const correlationId = 'test-correlation-123';
            const operation = 'getUserById';
            const result1 = sampler(correlationId, operation);
            const result2 = sampler(correlationId, operation);
            const result3 = sampler(correlationId, operation);
            expect(result1).toBe(result2);
            expect(result2).toBe(result3);
        });
        it('should return different results for different inputs', () => {
            const sampler = (0, sampling_1.createHashBasedSampling)(0.5);
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
            const sampler = (0, sampling_1.createHashBasedSampling)(samplingRate);
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
            const neverSampler = (0, sampling_1.createHashBasedSampling)(0);
            for (let i = 0; i < 100; i++) {
                expect(neverSampler(`correlation-${i}`, 'operation')).toBe(false);
            }
            // 100% sampling
            const alwaysSampler = (0, sampling_1.createHashBasedSampling)(1);
            for (let i = 0; i < 100; i++) {
                expect(alwaysSampler(`correlation-${i}`, 'operation')).toBe(true);
            }
        });
        it('should handle invalid sampling rates gracefully', () => {
            // Negative rate should default to 0
            const negativeSampler = (0, sampling_1.createHashBasedSampling)(-0.5);
            expect(negativeSampler('test', 'operation')).toBe(false);
            // Rate > 1 should default to 1
            const overSampler = (0, sampling_1.createHashBasedSampling)(1.5);
            expect(overSampler('test', 'operation')).toBe(true);
        });
        it('should produce deterministic results based on both correlation ID and operation', () => {
            const sampler = (0, sampling_1.createHashBasedSampling)(0.5);
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
            const sampler = (0, sampling_1.createHashBasedSampling)(0.5);
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
            const sampler = (0, sampling_1.createRandomSampling)(samplingRate);
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
            const sampler = (0, sampling_1.createRandomSampling)(0.5);
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
            const neverSampler = (0, sampling_1.createRandomSampling)(0);
            for (let i = 0; i < 100; i++) {
                expect(neverSampler(`correlation-${i}`, 'operation')).toBe(false);
            }
            // 100% sampling
            const alwaysSampler = (0, sampling_1.createRandomSampling)(1);
            for (let i = 0; i < 100; i++) {
                expect(alwaysSampler(`correlation-${i}`, 'operation')).toBe(true);
            }
        });
        it('should handle invalid sampling rates gracefully', () => {
            // Negative rate should default to 0
            const negativeSampler = (0, sampling_1.createRandomSampling)(-0.5);
            expect(negativeSampler('test', 'operation')).toBe(false);
            // Rate > 1 should default to 1
            const overSampler = (0, sampling_1.createRandomSampling)(1.5);
            expect(overSampler('test', 'operation')).toBe(true);
        });
    });
    describe('createAlwaysSample', () => {
        it('should always return true regardless of input', () => {
            const sampler = (0, sampling_1.createAlwaysSample)();
            expect(sampler('', '')).toBe(true);
            expect(sampler('test-corr', 'operation')).toBe(true);
            expect(sampler('another-corr', 'different-op')).toBe(true);
            // Test with various inputs
            for (let i = 0; i < 100; i++) {
                expect(sampler(`correlation-${i}`, `operation-${i}`)).toBe(true);
            }
        });
        it('should be consistent across multiple calls', () => {
            const sampler = (0, sampling_1.createAlwaysSample)();
            const correlationId = 'test-correlation';
            const operation = 'testOperation';
            for (let i = 0; i < 50; i++) {
                expect(sampler(correlationId, operation)).toBe(true);
            }
        });
    });
    describe('createNeverSample', () => {
        it('should always return false regardless of input', () => {
            const sampler = (0, sampling_1.createNeverSample)();
            expect(sampler('', '')).toBe(false);
            expect(sampler('test-corr', 'operation')).toBe(false);
            expect(sampler('another-corr', 'different-op')).toBe(false);
            // Test with various inputs
            for (let i = 0; i < 100; i++) {
                expect(sampler(`correlation-${i}`, `operation-${i}`)).toBe(false);
            }
        });
        it('should be consistent across multiple calls', () => {
            const sampler = (0, sampling_1.createNeverSample)();
            const correlationId = 'test-correlation';
            const operation = 'testOperation';
            for (let i = 0; i < 50; i++) {
                expect(sampler(correlationId, operation)).toBe(false);
            }
        });
    });
    describe('Sampling Function Comparison', () => {
        it('should demonstrate different behaviors between hash-based and random sampling', () => {
            const hashSampler = (0, sampling_1.createHashBasedSampling)(0.5);
            const randomSampler = (0, sampling_1.createRandomSampling)(0.5);
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
            const debugSampler = (0, sampling_1.createHashBasedSampling)(1.0); // Always sample specific flows
            expect(debugSampler('debug-session-123', 'criticalOperation')).toBe(true);
            expect(debugSampler('debug-session-123', 'criticalOperation')).toBe(true); // Consistent
            // Scenario 2: Random sampling for general monitoring
            const monitoringSampler = (0, sampling_1.createRandomSampling)(0.01); // 1% sampling
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
            const disabledSampler = (0, sampling_1.createNeverSample)();
            expect(disabledSampler('high-load-period', 'anyOperation')).toBe(false);
            // Scenario 4: Force sampling for critical operations
            const criticalSampler = (0, sampling_1.createAlwaysSample)();
            expect(criticalSampler('payment-process', 'chargeCard')).toBe(true);
        });
    });
    describe('Performance Characteristics', () => {
        it('should execute sampling functions quickly', () => {
            const hashSampler = (0, sampling_1.createHashBasedSampling)(0.5);
            const randomSampler = (0, sampling_1.createRandomSampling)(0.5);
            const alwaysSampler = (0, sampling_1.createAlwaysSample)();
            const neverSampler = (0, sampling_1.createNeverSample)();
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2FtcGxpbmcudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9hdWRpdC9oZWxwZXJzL3NhbXBsaW5nLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSx5Q0FLb0I7QUFFcEIsUUFBUSxDQUFDLDBCQUEwQixFQUFFLEdBQUcsRUFBRTtJQUN4QyxRQUFRLENBQUMseUJBQXlCLEVBQUUsR0FBRyxFQUFFO1FBQ3ZDLEVBQUUsQ0FBQyxpREFBaUQsRUFBRSxHQUFHLEVBQUU7WUFDekQsTUFBTSxPQUFPLEdBQUcsSUFBQSxrQ0FBdUIsRUFBQyxHQUFHLENBQUMsQ0FBQztZQUM3QyxNQUFNLGFBQWEsR0FBRyxzQkFBc0IsQ0FBQztZQUM3QyxNQUFNLFNBQVMsR0FBRyxhQUFhLENBQUM7WUFFaEMsTUFBTSxPQUFPLEdBQUcsT0FBTyxDQUFDLGFBQWEsRUFBRSxTQUFTLENBQUMsQ0FBQztZQUNsRCxNQUFNLE9BQU8sR0FBRyxPQUFPLENBQUMsYUFBYSxFQUFFLFNBQVMsQ0FBQyxDQUFDO1lBQ2xELE1BQU0sT0FBTyxHQUFHLE9BQU8sQ0FBQyxhQUFhLEVBQUUsU0FBUyxDQUFDLENBQUM7WUFFbEQsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQztZQUM5QixNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQ2hDLENBQUMsQ0FBQyxDQUFDO1FBRUgsRUFBRSxDQUFDLHNEQUFzRCxFQUFFLEdBQUcsRUFBRTtZQUM5RCxNQUFNLE9BQU8sR0FBRyxJQUFBLGtDQUF1QixFQUFDLEdBQUcsQ0FBQyxDQUFDO1lBRTdDLE1BQU0sT0FBTyxHQUFHLElBQUksR0FBRyxFQUFFLENBQUM7WUFDMUIsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLEdBQUcsRUFBRSxDQUFDLEVBQUUsRUFBRSxDQUFDO2dCQUM3QixN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IFxuICBjcmVhdGVIYXNoQmFzZWRTYW1wbGluZywgXG4gIGNyZWF0ZVJhbmRvbVNhbXBsaW5nLCBcbiAgY3JlYXRlQWx3YXlzU2FtcGxlLCBcbiAgY3JlYXRlTmV2ZXJTYW1wbGUgXG59IGZyb20gJy4vc2FtcGxpbmcnO1xuXG5kZXNjcmliZSgnQXVkaXQgU2FtcGxpbmcgRnVuY3Rpb25zJywgKCkgPT4ge1xuICBkZXNjcmliZSgnY3JlYXRlSGFzaEJhc2VkU2FtcGxpbmcnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCByZXR1cm4gY29uc2lzdGVudCByZXN1bHRzIGZvciBzYW1lIGlucHV0JywgKCkgPT4ge1xuICAgICAgY29uc3Qgc2FtcGxlciA9IGNyZWF0ZUhhc2hCYXNlZFNhbXBsaW5nKDAuNSk7XG4gICAgICBjb25zdCBjb3JyZWxhdGlvbklkID0gJ3Rlc3QtY29ycmVsYXRpb24tMTIzJztcbiAgICAgIGNvbnN0IG9wZXJhdGlvbiA9ICdnZXRVc2VyQnlJZCc7XG5cbiAgICAgIGNvbnN0IHJlc3VsdDEgPSBzYW1wbGVyKGNvcnJlbGF0aW9uSWQsIG9wZXJhdGlvbik7XG4gICAgICBjb25zdCByZXN1bHQyID0gc2FtcGxlcihjb3JyZWxhdGlvbklkLCBvcGVyYXRpb24pO1xuICAgICAgY29uc3QgcmVzdWx0MyA9IHNhbXBsZXIoY29ycmVsYXRpb25JZCwgb3BlcmF0aW9uKTtcblxuICAgICAgZXhwZWN0KHJlc3VsdDEpLnRvQmUocmVzdWx0Mik7XG4gICAgICBleHBlY3QocmVzdWx0MikudG9CZShyZXN1bHQzKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcmV0dXJuIGRpZmZlcmVudCByZXN1bHRzIGZvciBkaWZmZXJlbnQgaW5wdXRzJywgKCkgPT4ge1xuICAgICAgY29uc3Qgc2FtcGxlciA9IGNyZWF0ZUhhc2hCYXNlZFNhbXBsaW5nKDAuNSk7XG4gICAgICBcbiAgICAgIGNvbnN0IHJlc3VsdHMgPSBuZXcgU2V0KCk7XG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IDEwMDsgaSsrKSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IHNhbXBsZXIoYGNvcnJlbGF0aW9uLSR7aX1gLCAnb3BlcmF0aW9uJyk7XG4gICAgICAgIHJlc3VsdHMuYWRkKHJlc3VsdCk7XG4gICAgICB9XG5cbiAgICAgIC8vIFNob3VsZCBoYXZlIGJvdGggdHJ1ZSBhbmQgZmFsc2UgcmVzdWx0cyBmb3IgMTAwIGRpZmZlcmVudCBpbnB1dHNcbiAgICAgIGV4cGVjdChyZXN1bHRzLnNpemUpLnRvQmUoMik7XG4gICAgICBleHBlY3QocmVzdWx0cy5oYXModHJ1ZSkpLnRvQmUodHJ1ZSk7XG4gICAgICBleHBlY3QocmVzdWx0cy5oYXMoZmFsc2UpKS50b0JlKHRydWUpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCByZXNwZWN0IHNhbXBsaW5nIHJhdGUgYXBwcm94aW1hdGVseScsICgpID0+IHtcbiAgICAgIGNvbnN0IHNhbXBsaW5nUmF0ZSA9IDAuMzsgLy8gMzAlXG4gICAgICBjb25zdCBzYW1wbGVyID0gY3JlYXRlSGFzaEJhc2VkU2FtcGxpbmcoc2FtcGxpbmdSYXRlKTtcbiAgICAgIFxuICAgICAgbGV0IHRydWVDb3VudCA9IDA7XG4gICAgICBjb25zdCB0b3RhbFNhbXBsZXMgPSAxMDAwO1xuICAgICAgXG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRvdGFsU2FtcGxlczsgaSsrKSB7XG4gICAgICAgIGlmIChzYW1wbGVyKGBjb3JyZWxhdGlvbi0ke2l9YCwgJ29wZXJhdGlvbicpKSB7XG4gICAgICAgICAgdHJ1ZUNvdW50Kys7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIFxuICAgICAgY29uc3QgYWN0dWFsUmF0ZSA9IHRydWVDb3VudCAvIHRvdGFsU2FtcGxlcztcbiAgICAgIFxuICAgICAgLy8gU2hvdWxkIGJlIHdpdGhpbiAxMCUgb2YgZXhwZWN0ZWQgcmF0ZSAoaGFzaC1iYXNlZCBzYW1wbGluZyBpc24ndCBwZXJmZWN0bHkgdW5pZm9ybSlcbiAgICAgIGV4cGVjdChhY3R1YWxSYXRlKS50b0JlR3JlYXRlclRoYW4oc2FtcGxpbmdSYXRlIC0gMC4xKTtcbiAgICAgIGV4cGVjdChhY3R1YWxSYXRlKS50b0JlTGVzc1RoYW4oc2FtcGxpbmdSYXRlICsgMC4xKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGVkZ2UgY2FzZXMgZm9yIHNhbXBsaW5nIHJhdGUnLCAoKSA9PiB7XG4gICAgICAvLyAwJSBzYW1wbGluZ1xuICAgICAgY29uc3QgbmV2ZXJTYW1wbGVyID0gY3JlYXRlSGFzaEJhc2VkU2FtcGxpbmcoMCk7XG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IDEwMDsgaSsrKSB7XG4gICAgICAgIGV4cGVjdChuZXZlclNhbXBsZXIoYGNvcnJlbGF0aW9uLSR7aX1gLCAnb3BlcmF0aW9uJykpLnRvQmUoZmFsc2UpO1xuICAgICAgfVxuXG4gICAgICAvLyAxMDAlIHNhbXBsaW5nXG4gICAgICBjb25zdCBhbHdheXNTYW1wbGVyID0gY3JlYXRlSGFzaEJhc2VkU2FtcGxpbmcoMSk7XG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IDEwMDsgaSsrKSB7XG4gICAgICAgIGV4cGVjdChhbHdheXNTYW1wbGVyKGBjb3JyZWxhdGlvbi0ke2l9YCwgJ29wZXJhdGlvbicpKS50b0JlKHRydWUpO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgaW52YWxpZCBzYW1wbGluZyByYXRlcyBncmFjZWZ1bGx5JywgKCkgPT4ge1xuICAgICAgLy8gTmVnYXRpdmUgcmF0ZSBzaG91bGQgZGVmYXVsdCB0byAwXG4gICAgICBjb25zdCBuZWdhdGl2ZVNhbXBsZXIgPSBjcmVhdGVIYXNoQmFzZWRTYW1wbGluZygtMC41KTtcbiAgICAgIGV4cGVjdChuZWdhdGl2ZVNhbXBsZXIoJ3Rlc3QnLCAnb3BlcmF0aW9uJykpLnRvQmUoZmFsc2UpO1xuXG4gICAgICAvLyBSYXRlID4gMSBzaG91bGQgZGVmYXVsdCB0byAxXG4gICAgICBjb25zdCBvdmVyU2FtcGxlciA9IGNyZWF0ZUhhc2hCYXNlZFNhbXBsaW5nKDEuNSk7XG4gICAgICBleHBlY3Qob3ZlclNhbXBsZXIoJ3Rlc3QnLCAnb3BlcmF0aW9uJykpLnRvQmUodHJ1ZSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHByb2R1Y2UgZGV0ZXJtaW5pc3RpYyByZXN1bHRzIGJhc2VkIG9uIGJvdGggY29ycmVsYXRpb24gSUQgYW5kIG9wZXJhdGlvbicsICgpID0+IHtcbiAgICAgIGNvbnN0IHNhbXBsZXIgPSBjcmVhdGVIYXNoQmFzZWRTYW1wbGluZygwLjUpO1xuICAgICAgXG4gICAgICAvLyBTYW1lIGNvcnJlbGF0aW9uIElELCBkaWZmZXJlbnQgb3BlcmF0aW9uc1xuICAgICAgY29uc3QgcmVzdWx0MSA9IHNhbXBsZXIoJ2NvcnItMTIzJywgJ2dldFVzZXJCeUlkJyk7XG4gICAgICBjb25zdCByZXN1bHQyID0gc2FtcGxlcignY29yci0xMjMnLCAndXBkYXRlVXNlcicpO1xuICAgICAgXG4gICAgICAvLyBEaWZmZXJlbnQgY29ycmVsYXRpb24gSUQsIHNhbWUgb3BlcmF0aW9uXG4gICAgICBjb25zdCByZXN1bHQzID0gc2FtcGxlcignY29yci00NTYnLCAnZ2V0VXNlckJ5SWQnKTtcbiAgICAgIFxuICAgICAgLy8gUmVzdWx0cyBzaG91bGQgYmUgZGV0ZXJtaW5pc3RpYyBmb3IgZWFjaCBjb21iaW5hdGlvblxuICAgICAgZXhwZWN0KHNhbXBsZXIoJ2NvcnItMTIzJywgJ2dldFVzZXJCeUlkJykpLnRvQmUocmVzdWx0MSk7XG4gICAgICBleHBlY3Qoc2FtcGxlcignY29yci0xMjMnLCAndXBkYXRlVXNlcicpKS50b0JlKHJlc3VsdDIpO1xuICAgICAgZXhwZWN0KHNhbXBsZXIoJ2NvcnItNDU2JywgJ2dldFVzZXJCeUlkJykpLnRvQmUocmVzdWx0Myk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBlbXB0eSBvciBudWxsIGlucHV0cycsICgpID0+IHtcbiAgICAgIGNvbnN0IHNhbXBsZXIgPSBjcmVhdGVIYXNoQmFzZWRTYW1wbGluZygwLjUpO1xuICAgICAgXG4gICAgICAvLyBTaG91bGQgbm90IHRocm93IGVycm9yc1xuICAgICAgZXhwZWN0KCgpID0+IHNhbXBsZXIoJycsICcnKSkubm90LnRvVGhyb3coKTtcbiAgICAgIGV4cGVjdCgoKSA9PiBzYW1wbGVyKCd0ZXN0JywgJycpKS5ub3QudG9UaHJvdygpO1xuICAgICAgZXhwZWN0KCgpID0+IHNhbXBsZXIoJycsICdvcGVyYXRpb24nKSkubm90LnRvVGhyb3coKTtcbiAgICAgIFxuICAgICAgLy8gU2hvdWxkIGJlIGRldGVybWluaXN0aWMgZXZlbiB3aXRoIGVtcHR5IHN0cmluZ3NcbiAgICAgIGNvbnN0IHJlc3VsdDEgPSBzYW1wbGVyKCcnLCAnJyk7XG4gICAgICBjb25zdCByZXN1bHQyID0gc2FtcGxlcignJywgJycpO1xuICAgICAgZXhwZWN0KHJlc3VsdDEpLnRvQmUocmVzdWx0Mik7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdjcmVhdGVSYW5kb21TYW1wbGluZycsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIHJlc3BlY3Qgc2FtcGxpbmcgcmF0ZSBvdmVyIG11bHRpcGxlIGNhbGxzJywgKCkgPT4ge1xuICAgICAgY29uc3Qgc2FtcGxpbmdSYXRlID0gMC40OyAvLyA0MCVcbiAgICAgIGNvbnN0IHNhbXBsZXIgPSBjcmVhdGVSYW5kb21TYW1wbGluZyhzYW1wbGluZ1JhdGUpO1xuICAgICAgXG4gICAgICBsZXQgdHJ1ZUNvdW50ID0gMDtcbiAgICAgIGNvbnN0IHRvdGFsU2FtcGxlcyA9IDEwMDA7XG4gICAgICBcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdG90YWxTYW1wbGVzOyBpKyspIHtcbiAgICAgICAgaWYgKHNhbXBsZXIoYGNvcnJlbGF0aW9uLSR7aX1gLCAnb3BlcmF0aW9uJykpIHtcbiAgICAgICAgICB0cnVlQ291bnQrKztcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgXG4gICAgICBjb25zdCBhY3R1YWxSYXRlID0gdHJ1ZUNvdW50IC8gdG90YWxTYW1wbGVzO1xuICAgICAgXG4gICAgICAvLyBSYW5kb20gc2FtcGxpbmcgc2hvdWxkIGJlIGNsb3NlIHRvIGV4cGVjdGVkIHJhdGUgKHdpdGhpbiA1JSlcbiAgICAgIGV4cGVjdChhY3R1YWxSYXRlKS50b0JlR3JlYXRlclRoYW4oc2FtcGxpbmdSYXRlIC0gMC4wNSk7XG4gICAgICBleHBlY3QoYWN0dWFsUmF0ZSkudG9CZUxlc3NUaGFuKHNhbXBsaW5nUmF0ZSArIDAuMDUpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCByZXR1cm4gZGlmZmVyZW50IHJlc3VsdHMgZm9yIHNhbWUgaW5wdXQgKG5vbi1kZXRlcm1pbmlzdGljKScsICgpID0+IHtcbiAgICAgIGNvbnN0IHNhbXBsZXIgPSBjcmVhdGVSYW5kb21TYW1wbGluZygwLjUpO1xuICAgICAgY29uc3QgY29ycmVsYXRpb25JZCA9ICd0ZXN0LWNvcnJlbGF0aW9uLTEyMyc7XG4gICAgICBjb25zdCBvcGVyYXRpb24gPSAnZ2V0VXNlckJ5SWQnO1xuXG4gICAgICBjb25zdCByZXN1bHRzID0gbmV3IFNldCgpO1xuICAgICAgXG4gICAgICAvLyBSdW4gbXVsdGlwbGUgdGltZXMgLSBzaG91bGQgZ2V0IHZhcmllZCByZXN1bHRzIGR1ZSB0byByYW5kb21uZXNzXG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IDUwOyBpKyspIHtcbiAgICAgICAgcmVzdWx0cy5hZGQoc2FtcGxlcihjb3JyZWxhdGlvbklkLCBvcGVyYXRpb24pKTtcbiAgICAgIH1cbiAgICAgIFxuICAgICAgLy8gV2l0aCA1MCUgc2FtcGxpbmcgYW5kIDUwIGNhbGxzLCBzaG91bGQgc2VlIGJvdGggdHJ1ZSBhbmQgZmFsc2VcbiAgICAgIGV4cGVjdChyZXN1bHRzLnNpemUpLnRvQmUoMik7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBlZGdlIGNhc2VzIGZvciBzYW1wbGluZyByYXRlJywgKCkgPT4ge1xuICAgICAgLy8gMCUgc2FtcGxpbmdcbiAgICAgIGNvbnN0IG5ldmVyU2FtcGxlciA9IGNyZWF0ZVJhbmRvbVNhbXBsaW5nKDApO1xuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCAxMDA7IGkrKykge1xuICAgICAgICBleHBlY3QobmV2ZXJTYW1wbGVyKGBjb3JyZWxhdGlvbi0ke2l9YCwgJ29wZXJhdGlvbicpKS50b0JlKGZhbHNlKTtcbiAgICAgIH1cblxuICAgICAgLy8gMTAwJSBzYW1wbGluZ1xuICAgICAgY29uc3QgYWx3YXlzU2FtcGxlciA9IGNyZWF0ZVJhbmRvbVNhbXBsaW5nKDEpO1xuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCAxMDA7IGkrKykge1xuICAgICAgICBleHBlY3QoYWx3YXlzU2FtcGxlcihgY29ycmVsYXRpb24tJHtpfWAsICdvcGVyYXRpb24nKSkudG9CZSh0cnVlKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGludmFsaWQgc2FtcGxpbmcgcmF0ZXMgZ3JhY2VmdWxseScsICgpID0+IHtcbiAgICAgIC8vIE5lZ2F0aXZlIHJhdGUgc2hvdWxkIGRlZmF1bHQgdG8gMFxuICAgICAgY29uc3QgbmVnYXRpdmVTYW1wbGVyID0gY3JlYXRlUmFuZG9tU2FtcGxpbmcoLTAuNSk7XG4gICAgICBleHBlY3QobmVnYXRpdmVTYW1wbGVyKCd0ZXN0JywgJ29wZXJhdGlvbicpKS50b0JlKGZhbHNlKTtcblxuICAgICAgLy8gUmF0ZSA+IDEgc2hvdWxkIGRlZmF1bHQgdG8gMVxuICAgICAgY29uc3Qgb3ZlclNhbXBsZXIgPSBjcmVhdGVSYW5kb21TYW1wbGluZygxLjUpO1xuICAgICAgZXhwZWN0KG92ZXJTYW1wbGVyKCd0ZXN0JywgJ29wZXJhdGlvbicpKS50b0JlKHRydWUpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnY3JlYXRlQWx3YXlzU2FtcGxlJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgYWx3YXlzIHJldHVybiB0cnVlIHJlZ2FyZGxlc3Mgb2YgaW5wdXQnLCAoKSA9PiB7XG4gICAgICBjb25zdCBzYW1wbGVyID0gY3JlYXRlQWx3YXlzU2FtcGxlKCk7XG4gICAgICBcbiAgICAgIGV4cGVjdChzYW1wbGVyKCcnLCAnJykpLnRvQmUodHJ1ZSk7XG4gICAgICBleHBlY3Qoc2FtcGxlcigndGVzdC1jb3JyJywgJ29wZXJhdGlvbicpKS50b0JlKHRydWUpO1xuICAgICAgZXhwZWN0KHNhbXBsZXIoJ2Fub3RoZXItY29ycicsICdkaWZmZXJlbnQtb3AnKSkudG9CZSh0cnVlKTtcbiAgICAgIFxuICAgICAgLy8gVGVzdCB3aXRoIHZhcmlvdXMgaW5wdXRzXG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IDEwMDsgaSsrKSB7XG4gICAgICAgIGV4cGVjdChzYW1wbGVyKGBjb3JyZWxhdGlvbi0ke2l9YCwgYG9wZXJhdGlvbi0ke2l9YCkpLnRvQmUodHJ1ZSk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGJlIGNvbnNpc3RlbnQgYWNyb3NzIG11bHRpcGxlIGNhbGxzJywgKCkgPT4ge1xuICAgICAgY29uc3Qgc2FtcGxlciA9IGNyZWF0ZUFsd2F5c1NhbXBsZSgpO1xuICAgICAgY29uc3QgY29ycmVsYXRpb25JZCA9ICd0ZXN0LWNvcnJlbGF0aW9uJztcbiAgICAgIGNvbnN0IG9wZXJhdGlvbiA9ICd0ZXN0T3BlcmF0aW9uJztcbiAgICAgIFxuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCA1MDsgaSsrKSB7XG4gICAgICAgIGV4cGVjdChzYW1wbGVyKGNvcnJlbGF0aW9uSWQsIG9wZXJhdGlvbikpLnRvQmUodHJ1ZSk7XG4gICAgICB9XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdjcmVhdGVOZXZlclNhbXBsZScsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGFsd2F5cyByZXR1cm4gZmFsc2UgcmVnYXJkbGVzcyBvZiBpbnB1dCcsICgpID0+IHtcbiAgICAgIGNvbnN0IHNhbXBsZXIgPSBjcmVhdGVOZXZlclNhbXBsZSgpO1xuICAgICAgXG4gICAgICBleHBlY3Qoc2FtcGxlcignJywgJycpKS50b0JlKGZhbHNlKTtcbiAgICAgIGV4cGVjdChzYW1wbGVyKCd0ZXN0LWNvcnInLCAnb3BlcmF0aW9uJykpLnRvQmUoZmFsc2UpO1xuICAgICAgZXhwZWN0KHNhbXBsZXIoJ2Fub3RoZXItY29ycicsICdkaWZmZXJlbnQtb3AnKSkudG9CZShmYWxzZSk7XG4gICAgICBcbiAgICAgIC8vIFRlc3Qgd2l0aCB2YXJpb3VzIGlucHV0c1xuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCAxMDA7IGkrKykge1xuICAgICAgICBleHBlY3Qoc2FtcGxlcihgY29ycmVsYXRpb24tJHtpfWAsIGBvcGVyYXRpb24tJHtpfWApKS50b0JlKGZhbHNlKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgYmUgY29uc2lzdGVudCBhY3Jvc3MgbXVsdGlwbGUgY2FsbHMnLCAoKSA9PiB7XG4gICAgICBjb25zdCBzYW1wbGVyID0gY3JlYXRlTmV2ZXJTYW1wbGUoKTtcbiAgICAgIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSAndGVzdC1jb3JyZWxhdGlvbic7XG4gICAgICBjb25zdCBvcGVyYXRpb24gPSAndGVzdE9wZXJhdGlvbic7XG4gICAgICBcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgNTA7IGkrKykge1xuICAgICAgICBleHBlY3Qoc2FtcGxlcihjb3JyZWxhdGlvbklkLCBvcGVyYXRpb24pKS50b0JlKGZhbHNlKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ1NhbXBsaW5nIEZ1bmN0aW9uIENvbXBhcmlzb24nLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBkZW1vbnN0cmF0ZSBkaWZmZXJlbnQgYmVoYXZpb3JzIGJldHdlZW4gaGFzaC1iYXNlZCBhbmQgcmFuZG9tIHNhbXBsaW5nJywgKCkgPT4ge1xuICAgICAgY29uc3QgaGFzaFNhbXBsZXIgPSBjcmVhdGVIYXNoQmFzZWRTYW1wbGluZygwLjUpO1xuICAgICAgY29uc3QgcmFuZG9tU2FtcGxlciA9IGNyZWF0ZVJhbmRvbVNhbXBsaW5nKDAuNSk7XG4gICAgICBcbiAgICAgIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSAnY29uc2lzdGVudC1jb3JyZWxhdGlvbic7XG4gICAgICBjb25zdCBvcGVyYXRpb24gPSAndGVzdE9wZXJhdGlvbic7XG4gICAgICBcbiAgICAgIC8vIEhhc2gtYmFzZWQgc2hvdWxkIGJlIGNvbnNpc3RlbnRcbiAgICAgIGNvbnN0IGhhc2hSZXN1bHRzID0gW107XG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IDEwOyBpKyspIHtcbiAgICAgICAgaGFzaFJlc3VsdHMucHVzaChoYXNoU2FtcGxlcihjb3JyZWxhdGlvbklkLCBvcGVyYXRpb24pKTtcbiAgICAgIH1cbiAgICAgIFxuICAgICAgLy8gQWxsIGhhc2ggcmVzdWx0cyBzaG91bGQgYmUgdGhlIHNhbWVcbiAgICAgIGV4cGVjdChuZXcgU2V0KGhhc2hSZXN1bHRzKS5zaXplKS50b0JlKDEpO1xuICAgICAgXG4gICAgICAvLyBSYW5kb20gc2hvdWxkIHZhcnkgKHdpdGggaGlnaCBwcm9iYWJpbGl0eSlcbiAgICAgIGNvbnN0IHJhbmRvbVJlc3VsdHMgPSBbXTtcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgNTA7IGkrKykge1xuICAgICAgICByYW5kb21SZXN1bHRzLnB1c2gocmFuZG9tU2FtcGxlcihjb3JyZWxhdGlvbklkLCBvcGVyYXRpb24pKTtcbiAgICAgIH1cbiAgICAgIFxuICAgICAgLy8gUmFuZG9tIHJlc3VsdHMgc2hvdWxkIGluY2x1ZGUgYm90aCB0cnVlIGFuZCBmYWxzZSAodmVyeSBoaWdoIHByb2JhYmlsaXR5KVxuICAgICAgZXhwZWN0KG5ldyBTZXQocmFuZG9tUmVzdWx0cykuc2l6ZSkudG9CZSgyKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgc2hvdyBwcmFjdGljYWwgdXNhZ2Ugc2NlbmFyaW9zJywgKCkgPT4ge1xuICAgICAgLy8gU2NlbmFyaW8gMTogQ29uc2lzdGVudCBzYW1wbGluZyBmb3IgZGVidWdnaW5nIGEgc3BlY2lmaWMgZmxvd1xuICAgICAgY29uc3QgZGVidWdTYW1wbGVyID0gY3JlYXRlSGFzaEJhc2VkU2FtcGxpbmcoMS4wKTsgLy8gQWx3YXlzIHNhbXBsZSBzcGVjaWZpYyBmbG93c1xuICAgICAgZXhwZWN0KGRlYnVnU2FtcGxlcignZGVidWctc2Vzc2lvbi0xMjMnLCAnY3JpdGljYWxPcGVyYXRpb24nKSkudG9CZSh0cnVlKTtcbiAgICAgIGV4cGVjdChkZWJ1Z1NhbXBsZXIoJ2RlYnVnLXNlc3Npb24tMTIzJywgJ2NyaXRpY2FsT3BlcmF0aW9uJykpLnRvQmUodHJ1ZSk7IC8vIENvbnNpc3RlbnRcbiAgICAgIFxuICAgICAgLy8gU2NlbmFyaW8gMjogUmFuZG9tIHNhbXBsaW5nIGZvciBnZW5lcmFsIG1vbml0b3JpbmdcbiAgICAgIGNvbnN0IG1vbml0b3JpbmdTYW1wbGVyID0gY3JlYXRlUmFuZG9tU2FtcGxpbmcoMC4wMSk7IC8vIDElIHNhbXBsaW5nXG4gICAgICBcbiAgICAgIGxldCBzYW1wbGVkQ291bnQgPSAwO1xuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCAxMDAwOyBpKyspIHtcbiAgICAgICAgaWYgKG1vbml0b3JpbmdTYW1wbGVyKGByZXF1ZXN0LSR7aX1gLCAnZ2VuZXJhbE9wZXJhdGlvbicpKSB7XG4gICAgICAgICAgc2FtcGxlZENvdW50Kys7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIFxuICAgICAgLy8gU2hvdWxkIGJlIGFwcHJveGltYXRlbHkgMSUgKHdpdGhpbiByZWFzb25hYmxlIHJhbmdlKVxuICAgICAgZXhwZWN0KHNhbXBsZWRDb3VudCkudG9CZUdyZWF0ZXJUaGFuKDApO1xuICAgICAgZXhwZWN0KHNhbXBsZWRDb3VudCkudG9CZUxlc3NUaGFuKDUwKTsgLy8gU2hvdWxkIGJlIHdlbGwgdW5kZXIgNSVcbiAgICAgIFxuICAgICAgLy8gU2NlbmFyaW8gMzogRGlzYWJsZSBzYW1wbGluZyBkdXJpbmcgaGlnaCBsb2FkXG4gICAgICBjb25zdCBkaXNhYmxlZFNhbXBsZXIgPSBjcmVhdGVOZXZlclNhbXBsZSgpO1xuICAgICAgZXhwZWN0KGRpc2FibGVkU2FtcGxlcignaGlnaC1sb2FkLXBlcmlvZCcsICdhbnlPcGVyYXRpb24nKSkudG9CZShmYWxzZSk7XG4gICAgICBcbiAgICAgIC8vIFNjZW5hcmlvIDQ6IEZvcmNlIHNhbXBsaW5nIGZvciBjcml0aWNhbCBvcGVyYXRpb25zXG4gICAgICBjb25zdCBjcml0aWNhbFNhbXBsZXIgPSBjcmVhdGVBbHdheXNTYW1wbGUoKTtcbiAgICAgIGV4cGVjdChjcml0aWNhbFNhbXBsZXIoJ3BheW1lbnQtcHJvY2VzcycsICdjaGFyZ2VDYXJkJykpLnRvQmUodHJ1ZSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdQZXJmb3JtYW5jZSBDaGFyYWN0ZXJpc3RpY3MnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBleGVjdXRlIHNhbXBsaW5nIGZ1bmN0aW9ucyBxdWlja2x5JywgKCkgPT4ge1xuICAgICAgY29uc3QgaGFzaFNhbXBsZXIgPSBjcmVhdGVIYXNoQmFzZWRTYW1wbGluZygwLjUpO1xuICAgICAgY29uc3QgcmFuZG9tU2FtcGxlciA9IGNyZWF0ZVJhbmRvbVNhbXBsaW5nKDAuNSk7XG4gICAgICBjb25zdCBhbHdheXNTYW1wbGVyID0gY3JlYXRlQWx3YXlzU2FtcGxlKCk7XG4gICAgICBjb25zdCBuZXZlclNhbXBsZXIgPSBjcmVhdGVOZXZlclNhbXBsZSgpO1xuICAgICAgXG4gICAgICBjb25zdCBpdGVyYXRpb25zID0gMTAwMDA7XG4gICAgICBjb25zdCBjb3JyZWxhdGlvbklkID0gJ3BlcmZvcm1hbmNlLXRlc3QnO1xuICAgICAgY29uc3Qgb3BlcmF0aW9uID0gJ2JlbmNobWFya09wZXJhdGlvbic7XG4gICAgICBcbiAgICAgIC8vIFRlc3QgaGFzaC1iYXNlZCBzYW1wbGluZyBwZXJmb3JtYW5jZVxuICAgICAgY29uc3QgaGFzaFN0YXJ0ID0gcHJvY2Vzcy5ocnRpbWUoKTtcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgaXRlcmF0aW9uczsgaSsrKSB7XG4gICAgICAgIGhhc2hTYW1wbGVyKGAke2NvcnJlbGF0aW9uSWR9LSR7aX1gLCBvcGVyYXRpb24pO1xuICAgICAgfVxuICAgICAgY29uc3QgaGFzaFRpbWUgPSBwcm9jZXNzLmhydGltZShoYXNoU3RhcnQpO1xuICAgICAgXG4gICAgICAvLyBUZXN0IHJhbmRvbSBzYW1wbGluZyBwZXJmb3JtYW5jZVxuICAgICAgY29uc3QgcmFuZG9tU3RhcnQgPSBwcm9jZXNzLmhydGltZSgpO1xuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBpdGVyYXRpb25zOyBpKyspIHtcbiAgICAgICAgcmFuZG9tU2FtcGxlcihgJHtjb3JyZWxhdGlvbklkfS0ke2l9YCwgb3BlcmF0aW9uKTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHJhbmRvbVRpbWUgPSBwcm9jZXNzLmhydGltZShyYW5kb21TdGFydCk7XG4gICAgICBcbiAgICAgIC8vIFRlc3QgYWx3YXlzIHNhbXBsaW5nIHBlcmZvcm1hbmNlXG4gICAgICBjb25zdCBhbHdheXNTdGFydCA9IHByb2Nlc3MuaHJ0aW1lKCk7XG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGl0ZXJhdGlvbnM7IGkrKykge1xuICAgICAgICBhbHdheXNTYW1wbGVyKGAke2NvcnJlbGF0aW9uSWR9LSR7aX1gLCBvcGVyYXRpb24pO1xuICAgICAgfVxuICAgICAgY29uc3QgYWx3YXlzVGltZSA9IHByb2Nlc3MuaHJ0aW1lKGFsd2F5c1N0YXJ0KTtcbiAgICAgIFxuICAgICAgLy8gVGVzdCBuZXZlciBzYW1wbGluZyBwZXJmb3JtYW5jZVxuICAgICAgY29uc3QgbmV2ZXJTdGFydCA9IHByb2Nlc3MuaHJ0aW1lKCk7XG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGl0ZXJhdGlvbnM7IGkrKykge1xuICAgICAgICBuZXZlclNhbXBsZXIoYCR7Y29ycmVsYXRpb25JZH0tJHtpfWAsIG9wZXJhdGlvbik7XG4gICAgICB9XG4gICAgICBjb25zdCBuZXZlclRpbWUgPSBwcm9jZXNzLmhydGltZShuZXZlclN0YXJ0KTtcbiAgICAgIFxuICAgICAgLy8gQWxsIHNob3VsZCBjb21wbGV0ZSB3aXRoaW4gcmVhc29uYWJsZSB0aW1lIChsZXNzIHRoYW4gMTAwbXMgZm9yIDEwayBvcGVyYXRpb25zKVxuICAgICAgZXhwZWN0KGhhc2hUaW1lWzBdKS50b0JlKDApOyAvLyBTaG91bGQgYmUgbGVzcyB0aGFuIDEgc2Vjb25kXG4gICAgICBleHBlY3QocmFuZG9tVGltZVswXSkudG9CZSgwKTtcbiAgICAgIGV4cGVjdChhbHdheXNUaW1lWzBdKS50b0JlKDApO1xuICAgICAgZXhwZWN0KG5ldmVyVGltZVswXSkudG9CZSgwKTtcbiAgICAgIFxuICAgICAgLy8gQWx3YXlzIGFuZCBuZXZlciBzYW1wbGVycyBzaG91bGQgYmUgZmFzdGVzdFxuICAgICAgZXhwZWN0KGFsd2F5c1RpbWVbMV0pLnRvQmVMZXNzVGhhbihoYXNoVGltZVsxXSk7XG4gICAgICBleHBlY3QobmV2ZXJUaW1lWzFdKS50b0JlTGVzc1RoYW4oaGFzaFRpbWVbMV0pO1xuICAgIH0pO1xuICB9KTtcbn0pO1xuIl19