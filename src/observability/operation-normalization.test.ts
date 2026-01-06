import {
  MockBackend,
  setupTestObservability,
  createTestContext,
  cleanupTestObservability,
} from './testing';
import { LogObserver } from './observers/log';
import { ObservabilityManager } from './manager';

describe('Operation normalization', () => {
  let backend: MockBackend;

  beforeEach(() => {
    backend = setupTestObservability();
  });

  afterEach(() => {
    cleanupTestObservability();
  });

  it('normalizes high-cardinality operation strings and stores original metadata', async () => {
    await createTestContext(async () => {
      LogObserver.info('GET /users/2f80c4f0-3ffb-4aa6-9f7b-7c8fd2c3b93a/orders/8fd381f26e14820d', {
        hello: 'world',
      });

      await ObservabilityManager.flush();
    });

    const events = backend.getEventsMatching({ type: 'log' });
    expect(events.length).toBe(1);

    const e = events[ 0 ];
    expect(e.operation).toBe('GET /users/:uuid/orders/:id');
    expect(e.data && (e.data as any).operationNormalization).toMatchObject({
      from: 'GET /users/2f80c4f0-3ffb-4aa6-9f7b-7c8fd2c3b93a/orders/8fd381f26e14820d',
      to: 'GET /users/:uuid/orders/:id',
    });
  });
});


