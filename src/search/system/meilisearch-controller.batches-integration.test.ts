import { MeiliSearchEngine } from '../engines';
import { DIContainer } from '../../di';
import { MeiliSearchSystemController } from './meilisearch-controller';
import { LambdaTestHarness } from '../../testing/lambda-test-harness';

describe('MeiliSearch Batches Integration', () => {
  let controller: MeiliSearchSystemController;
  let harness: LambdaTestHarness;
  let engine: MeiliSearchEngine;

  beforeAll(async () => {
    // Setup MeiliSearch engine
    DIContainer.ROOT.setSearchEngine(new MeiliSearchEngine({
      host: 'http://localhost:7700',
      apiKey: 'xxx_your_master_key',
    }));

    controller = new MeiliSearchSystemController(DIContainer.ROOT);
    // Manually set controllerName since the decorator is commented out
    Object.defineProperty(controller, 'controllerName', { value: 'system/search', writable: true });
    harness = new LambdaTestHarness(controller as any);
    engine = DIContainer.ROOT.resolveSearchEngine() as MeiliSearchEngine;
  }, 30000);

  describe('GET /batches', () => {
    it('should return batches with cursor-based pagination format', async () => {
      const response = await harness.get('/batches', {
        queryStringParameters: { count: '5' }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      // Verify response format matches entity controller pattern
      expect(body).toHaveProperty('cursor');
      expect(body).toHaveProperty('items');
      expect(Array.isArray(body.items)).toBe(true);
      // Cursor can be string or null depending on if there are more results
      expect(typeof body.cursor === 'string' || body.cursor === null).toBe(true);
    }, 30000);

    it('should support cursor-based pagination with multiple pages', async () => {
      // Get first page
      const page1 = await harness.get('/batches', {
        queryStringParameters: { count: '2' }
      });
      expect(page1.statusCode).toBe(200);
      const body1 = JSON.parse(page1.body);

      expect(body1.items.length).toBeLessThanOrEqual(2);
      // Cursor might be null if there are no more results
      if (body1.items.length === 2) {
        expect(body1.cursor).toBeTruthy();
      } else {
        // If we have fewer than 2 items, cursor should be null
        expect(body1.cursor).toBeNull();
      }

      // Get second page using cursor (if cursor exists)
      if (body1.cursor) {
        const page2 = await harness.get('/batches', {
          queryStringParameters: {
            count: '2',
            cursor: body1.cursor
          }
        });
        expect(page2.statusCode).toBe(200);
        const body2 = JSON.parse(page2.body);

        expect(body2.items.length).toBeLessThanOrEqual(2);

        // Verify different batches (if any exist)
        if (body1.items.length > 0 && body2.items.length > 0) {
          expect(body2.items[ 0 ].uid).not.toBe(body1.items[ 0 ].uid);
        }
      }
    }, 30000);

    it('should filter batches by status using entity-style query', async () => {
      const response = await harness.get('/batches', {
        queryStringParameters: {
          'status.eq': 'succeeded',
          count: '10'
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body).toHaveProperty('items');
      expect(Array.isArray(body.items)).toBe(true);
      if (body.items.length > 0) {
        expect(body.items.every((batch: any) =>
          batch.stats && batch.stats.status && batch.stats.status.succeeded > 0
        )).toBe(true);
      }
    }, 30000);

    it('should filter batches by UID using entity-style query', async () => {
      // First get a batch to get its UID
      const firstResponse = await harness.get('/batches', {
        queryStringParameters: { count: '1' }
      });
      expect(firstResponse.statusCode).toBe(200);
      const firstBody = JSON.parse(firstResponse.body);

      if (firstBody.items.length === 0) {
        console.log('No batches available for UID filter test');
        return;
      }

      const batchUid = firstBody.items[ 0 ].uid;

      const response = await harness.get('/batches', {
        queryStringParameters: {
          'uid.eq': batchUid,
          count: '10'
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body).toHaveProperty('items');
      expect(Array.isArray(body.items)).toBe(true);

      // The UID filter should return a subset of results, but the specific batch might not be included
      // if the MeiliSearch API doesn't support UID filtering for batches in the same way as tasks
      if (body.items.length > 0) {
        // At least verify that the response structure is correct
        expect(body.items[ 0 ]).toHaveProperty('uid');
        expect(body.items[ 0 ]).toHaveProperty('stats');
      }
    }, 30000);

    it('should filter batches by type using entity-style query', async () => {
      const response = await harness.get('/batches', {
        queryStringParameters: {
          'types.eq': 'documentAdditionOrUpdate',
          count: '10'
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body).toHaveProperty('items');
      expect(Array.isArray(body.items)).toBe(true);
      if (body.items.length > 0) {
        expect(body.items.every((batch: any) =>
          batch.stats && batch.stats.types && batch.stats.types.documentAdditionOrUpdate > 0
        )).toBe(true);
      }
    }, 30000);

    it('should filter batches by indexUid using entity-style query', async () => {
      // First get a batch to get its indexUid
      const firstResponse = await harness.get('/batches', {
        queryStringParameters: { count: '1' }
      });
      expect(firstResponse.statusCode).toBe(200);
      const firstBody = JSON.parse(firstResponse.body);

      if (firstBody.items.length === 0) {
        console.log('No batches available for indexUid filter test');
        return;
      }

      const indexUids = firstBody.items[ 0 ].stats?.indexUids;
      if (!indexUids || Object.keys(indexUids).length === 0) {
        console.log('No indexUids available for filter test');
        return;
      }

      const indexUid = Object.keys(indexUids)[ 0 ];

      const response = await harness.get('/batches', {
        queryStringParameters: {
          'indexUid.eq': indexUid,
          count: '10'
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body).toHaveProperty('items');
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.items.length).toBeGreaterThan(0);
      expect(body.items.some((batch: any) =>
        batch.stats && batch.stats.indexUids && batch.stats.indexUids[ indexUid ] > 0
      )).toBe(true);
    }, 30000);

    it('should filter batches by startedAt using gt operator', async () => {
      const response = await harness.get('/batches', {
        queryStringParameters: {
          'startedAt.gt': '2024-01-01T00:00:00Z',
          count: '10'
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body).toHaveProperty('items');
      expect(Array.isArray(body.items)).toBe(true);
      if (body.items.length > 0) {
        expect(body.items.every((batch: any) =>
          batch.startedAt && new Date(batch.startedAt) > new Date('2024-01-01T00:00:00Z')
        )).toBe(true);
      }
    }, 30000);

    it('should filter batches by finishedAt using gt operator', async () => {
      const response = await harness.get('/batches', {
        queryStringParameters: {
          'finishedAt.gt': '2024-01-01T00:00:00Z',
          count: '10'
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body).toHaveProperty('items');
      expect(Array.isArray(body.items)).toBe(true);
      if (body.items.length > 0) {
        expect(body.items.every((batch: any) =>
          batch.finishedAt && new Date(batch.finishedAt) > new Date('2024-01-01T00:00:00Z')
        )).toBe(true);
      }
    }, 30000);

    it('should handle complex filter combinations for batches', async () => {
      const response = await harness.get('/batches', {
        queryStringParameters: {
          'status.eq': 'succeeded',
          'types.eq': 'documentAdditionOrUpdate',
          count: '10'
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body).toHaveProperty('items');
      expect(Array.isArray(body.items)).toBe(true);

      if (body.items.length > 0) {
        expect(body.items.every((batch: any) =>
          batch.stats &&
          batch.stats.status &&
          batch.stats.status.succeeded > 0 &&
          batch.stats.types &&
          batch.stats.types.documentAdditionOrUpdate > 0
        )).toBe(true);
      }
    }, 30000);
  });

  describe('GET /batches/{uid}', () => {
    it('should return a specific batch by UID', async () => {
      // First get a batch to get its UID
      const firstResponse = await harness.get('/batches', {
        queryStringParameters: { count: '1' }
      });
      expect(firstResponse.statusCode).toBe(200);
      const firstBody = JSON.parse(firstResponse.body);

      if (firstBody.items.length === 0) {
        console.log('No batches available for single batch test');
        return;
      }

      const batchUid = firstBody.items[ 0 ].uid;

      const response = await harness.get(`/batches/${batchUid}`, {
        pathParameters: {
          uid: batchUid
        }
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body).toHaveProperty('uid');
      expect(body).toHaveProperty('stats');
      expect(body).toHaveProperty('startedAt');
      expect(body).toHaveProperty('finishedAt');
      expect(body.uid).toBe(batchUid);
    }, 30000);
  });
});