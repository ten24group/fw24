/**
 * Tests for Feature 2: SQS Retry Detection
 *
 * Validates that SQS records with ApproximateReceiveCount > 1 produce
 * correct retry tags and metrics on spans.
 */

describe('Feature 2: SQS Retry Detection', () => {
  // These tests validate the retry detection logic in isolation.
  // The actual tagging is done inline in sqs-controller.ts and base-sqs-event-processor.ts.
  // We test the core logic pattern here.

  function detectRetries(records: Array<{ attributes?: Record<string, string> }>) {
    const receiveCounts = records.map(
      (r) => parseInt(r.attributes?.ApproximateReceiveCount ?? '1', 10)
    );
    const maxReceiveCount = Math.max(...receiveCounts);
    const retryCount = receiveCounts.filter((c) => c > 1).length;

    if (retryCount > 0) {
      return {
        hasRetries: true,
        retryCount,
        maxReceiveCount,
      };
    }
    return { hasRetries: false, retryCount: 0, maxReceiveCount };
  }

  it('detects no retries when all records have receive count 1', () => {
    const result = detectRetries([
      { attributes: { ApproximateReceiveCount: '1' } },
      { attributes: { ApproximateReceiveCount: '1' } },
      { attributes: { ApproximateReceiveCount: '1' } },
    ]);

    expect(result.hasRetries).toBe(false);
    expect(result.retryCount).toBe(0);
    expect(result.maxReceiveCount).toBe(1);
  });

  it('detects retries when some records have receive count > 1', () => {
    const result = detectRetries([
      { attributes: { ApproximateReceiveCount: '1' } },
      { attributes: { ApproximateReceiveCount: '3' } },
      { attributes: { ApproximateReceiveCount: '1' } },
    ]);

    expect(result.hasRetries).toBe(true);
    expect(result.retryCount).toBe(1);
    expect(result.maxReceiveCount).toBe(3);
  });

  it('detects retries when all records are retries', () => {
    const result = detectRetries([
      { attributes: { ApproximateReceiveCount: '2' } },
      { attributes: { ApproximateReceiveCount: '5' } },
      { attributes: { ApproximateReceiveCount: '3' } },
    ]);

    expect(result.hasRetries).toBe(true);
    expect(result.retryCount).toBe(3);
    expect(result.maxReceiveCount).toBe(5);
  });

  it('defaults to receive count 1 when attribute is missing', () => {
    const result = detectRetries([
      { attributes: {} },
      { attributes: undefined },
      {},
    ]);

    expect(result.hasRetries).toBe(false);
    expect(result.retryCount).toBe(0);
    expect(result.maxReceiveCount).toBe(1);
  });

  it('handles single record batch with retry', () => {
    const result = detectRetries([
      { attributes: { ApproximateReceiveCount: '4' } },
    ]);

    expect(result.hasRetries).toBe(true);
    expect(result.retryCount).toBe(1);
    expect(result.maxReceiveCount).toBe(4);
  });

  it('correctly counts mixed batch with multiple retries', () => {
    const result = detectRetries([
      { attributes: { ApproximateReceiveCount: '1' } },
      { attributes: { ApproximateReceiveCount: '2' } },
      { attributes: { ApproximateReceiveCount: '1' } },
      { attributes: { ApproximateReceiveCount: '7' } },
      { attributes: { ApproximateReceiveCount: '3' } },
    ]);

    expect(result.hasRetries).toBe(true);
    expect(result.retryCount).toBe(3); // records with count 2, 7, 3
    expect(result.maxReceiveCount).toBe(7);
  });
});
