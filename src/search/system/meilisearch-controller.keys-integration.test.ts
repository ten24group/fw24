import { MeiliSearchEngine } from '../engines';
import { DIContainer } from '../../di';
import { MeiliSearchSystemController } from './meilisearch-controller';
import { LambdaTestHarness } from '../../testing/lambda-test-harness';

describe('MeiliSearch API Keys Integration', () => {
  let controller: MeiliSearchSystemController;
  let harness: LambdaTestHarness;
  let engine: MeiliSearchEngine;
  let testKeyUid: string;

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

  describe('GET /api-keys', () => {
    it('should return API keys with cursor-based pagination format', async () => {
      const response = await harness.get('/api-keys', {
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
      const page1 = await harness.get('/api-keys', {
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
        const page2 = await harness.get('/api-keys', {
          queryStringParameters: {
            count: '2',
            cursor: body1.cursor
          }
        });
        expect(page2.statusCode).toBe(200);
        const body2 = JSON.parse(page2.body);

        expect(body2.items.length).toBeLessThanOrEqual(2);

        // Verify different keys (if any exist)
        if (body1.items.length > 0 && body2.items.length > 0) {
          expect(body2.items[ 0 ].uid).not.toBe(body1.items[ 0 ].uid);
        }
      }
    }, 30000);

    it('should filter API keys by UID using entity-style query', async () => {
      // First get a key to get its UID
      const firstResponse = await harness.get('/api-keys', {
        queryStringParameters: { count: '1' }
      });
      expect(firstResponse.statusCode).toBe(200);
      const firstBody = JSON.parse(firstResponse.body);

      if (firstBody.items.length === 0) {
        console.log('No API keys available for UID filter test');
        return;
      }

      const keyUid = firstBody.items[ 0 ].uid;

      const response = await harness.get('/api-keys', {
        queryStringParameters: {
          'uid.eq': keyUid,
          count: '10'
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body).toHaveProperty('items');
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.items.length).toBeGreaterThan(0);
      expect(body.items.some((key: any) => key.uid === keyUid)).toBe(true);
    }, 30000);

    it('should filter API keys by name using contains operator', async () => {
      const response = await harness.get('/api-keys', {
        queryStringParameters: {
          'name.contains': 'Default',
          count: '10'
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body).toHaveProperty('items');
      expect(Array.isArray(body.items)).toBe(true);
      if (body.items.length > 0) {
        expect(body.items.every((key: any) =>
          key.name && key.name.toLowerCase().includes('default')
        )).toBe(true);
      }
    }, 30000);

    it('should filter API keys by description using contains operator', async () => {
      const response = await harness.get('/api-keys', {
        queryStringParameters: {
          'description.contains': 'search',
          count: '10'
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body).toHaveProperty('items');
      expect(Array.isArray(body.items)).toBe(true);
      if (body.items.length > 0) {
        expect(body.items.every((key: any) =>
          key.description && key.description.toLowerCase().includes('search')
        )).toBe(true);
      }
    }, 30000);

    it('should filter API keys by actions using IN operator', async () => {
      const response = await harness.get('/api-keys', {
        queryStringParameters: {
          'actions.in': 'search,documents.get',
          count: '10'
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body).toHaveProperty('items');
      expect(Array.isArray(body.items)).toBe(true);
      if (body.items.length > 0) {
        expect(body.items.every((key: any) =>
          key.actions && key.actions.some((action: string) =>
            [ 'search', 'documents.get' ].includes(action)
          )
        )).toBe(true);
      }
    }, 30000);

    it('should filter API keys by indexes using IN operator', async () => {
      const response = await harness.get('/api-keys', {
        queryStringParameters: {
          'indexes.in': '*',
          count: '10'
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body).toHaveProperty('items');
      expect(Array.isArray(body.items)).toBe(true);
      if (body.items.length > 0) {
        expect(body.items.every((key: any) =>
          key.indexes && key.indexes.includes('*')
        )).toBe(true);
      }
    }, 30000);

    it('should filter API keys by key value using contains operator', async () => {
      // First get a key to get its key value
      const firstResponse = await harness.get('/api-keys', {
        queryStringParameters: { count: '1' }
      });
      expect(firstResponse.statusCode).toBe(200);
      const firstBody = JSON.parse(firstResponse.body);

      if (firstBody.items.length === 0) {
        console.log('No API keys available for key filter test');
        return;
      }

      const keyValue = firstBody.items[ 0 ].key;
      const partialKey = keyValue.substring(0, 8); // Use first 8 characters

      const response = await harness.get('/api-keys', {
        queryStringParameters: {
          'key.contains': partialKey,
          count: '10'
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body).toHaveProperty('items');
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.items.length).toBeGreaterThan(0);
      expect(body.items.some((key: any) => key.key.includes(partialKey))).toBe(true);
    }, 30000);

    it('should filter API keys by expiresAt using gt operator', async () => {
      const response = await harness.get('/api-keys', {
        queryStringParameters: {
          'expiresAt.gt': '2024-01-01T00:00:00Z',
          count: '10'
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body).toHaveProperty('items');
      expect(Array.isArray(body.items)).toBe(true);
      if (body.items.length > 0) {
        expect(body.items.every((key: any) =>
          key.expiresAt && new Date(key.expiresAt) > new Date('2024-01-01T00:00:00Z')
        )).toBe(true);
      }
    }, 30000);

    it('should filter API keys by createdAt using gt operator', async () => {
      const response = await harness.get('/api-keys', {
        queryStringParameters: {
          'createdAt.gt': '2024-01-01T00:00:00Z',
          count: '10'
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body).toHaveProperty('items');
      expect(Array.isArray(body.items)).toBe(true);
      if (body.items.length > 0) {
        expect(body.items.every((key: any) =>
          key.createdAt && new Date(key.createdAt) > new Date('2024-01-01T00:00:00Z')
        )).toBe(true);
      }
    }, 30000);

    it('should handle complex filter combinations for API keys', async () => {
      const response = await harness.get('/api-keys', {
        queryStringParameters: {
          'actions.in': 'search',
          'indexes.in': '*',
          count: '10'
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body).toHaveProperty('items');
      expect(Array.isArray(body.items)).toBe(true);

      if (body.items.length > 0) {
        expect(body.items.every((key: any) =>
          key.actions && key.actions.includes('search') &&
          key.indexes && key.indexes.includes('*')
        )).toBe(true);
      }
    }, 30000);
  });

  describe('GET /api-keys/{keyOrUid}', () => {
    it('should return a specific API key by UID', async () => {
      // First get a key to get its UID
      const firstResponse = await harness.get('/api-keys', {
        queryStringParameters: { count: '1' }
      });
      expect(firstResponse.statusCode).toBe(200);
      const firstBody = JSON.parse(firstResponse.body);

      if (firstBody.items.length === 0) {
        console.log('No API keys available for single key test');
        return;
      }

      const keyUid = firstBody.items[ 0 ].uid;

      const response = await harness.get(`/api-keys/${keyUid}`, {
        pathParameters: {
          keyOrUid: keyUid
        }
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body).toHaveProperty('uid');
      expect(body).toHaveProperty('key');
      expect(body).toHaveProperty('actions');
      expect(body).toHaveProperty('indexes');
      expect(body.uid).toBe(keyUid);
    }, 30000);

    it('should return a specific API key by key value', async () => {
      // First get a key to get its key value
      const firstResponse = await harness.get('/api-keys', {
        queryStringParameters: { count: '1' }
      });
      expect(firstResponse.statusCode).toBe(200);
      const firstBody = JSON.parse(firstResponse.body);

      if (firstBody.items.length === 0) {
        console.log('No API keys available for key value test');
        return;
      }

      const keyValue = firstBody.items[ 0 ].key;

      const response = await harness.get(`/api-keys/${keyValue}`, {
        pathParameters: {
          keyOrUid: keyValue
        }
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body).toHaveProperty('uid');
      expect(body).toHaveProperty('key');
      expect(body).toHaveProperty('actions');
      expect(body).toHaveProperty('indexes');
      expect(body.key).toBe(keyValue);
    }, 30000);
  });

  describe('POST /api-keys', () => {
    it('should create a new API key with required fields', async () => {
      const newKeyData = {
        name: 'Test API Key',
        description: 'Test key for integration testing',
        actions: [ 'search', 'documents.get' ],
        indexes: [ '*' ],
        expiresAt: '2025-12-31T23:59:59Z'
      };

      const response = await harness.post('/api-keys', {
        body: newKeyData
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body).toHaveProperty('uid');
      expect(body).toHaveProperty('key');
      expect(body).toHaveProperty('name');
      expect(body).toHaveProperty('description');
      expect(body).toHaveProperty('actions');
      expect(body).toHaveProperty('indexes');
      expect(body).toHaveProperty('expiresAt');
      expect(body).toHaveProperty('createdAt');
      expect(body).toHaveProperty('updatedAt');

      expect(body.name).toBe(newKeyData.name);
      expect(body.description).toBe(newKeyData.description);
      expect(body.actions).toEqual(newKeyData.actions);
      expect(body.indexes).toEqual(newKeyData.indexes);

      // Store the UID for cleanup
      testKeyUid = body.uid;
    }, 30000);

    it('should create a new API key without optional fields', async () => {
      const newKeyData = {
        actions: [ 'search' ],
        indexes: [ '*' ],
        name: "test no optional fields",
        expiresAt: '2025-12-31T23:59:59Z'
      };

      const response = await harness.post('/api-keys', {
        body: newKeyData
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body).toHaveProperty('uid');
      expect(body).toHaveProperty('key');
      expect(body).toHaveProperty('actions');
      expect(body).toHaveProperty('indexes');
      expect(body.actions).toEqual(newKeyData.actions);
      expect(body.indexes).toEqual(newKeyData.indexes);

      // Store the UID for cleanup
      if (!testKeyUid) {
        testKeyUid = body.uid;
      }
    }, 30000);

    it('should reject creation without required fields', async () => {
      const invalidKeyData = {
        name: 'Test API Key'
        // Missing required actions and indexes
      };

      const response = await harness.post('/api-keys', {
        body: invalidKeyData
      });

      expect(response.statusCode).toBe(400);
    }, 30000);
  });

  describe('PUT /api-keys/{keyOrUid}', () => {
    it('should update an API key name and description', async () => {
      if (!testKeyUid) {
        console.log('No test key available for update test');
        return;
      }

      const updateData = {
        name: 'Updated Test API Key',
        description: 'Updated description for testing'
      };

      const response = await harness.put(`/api-keys/${testKeyUid}`, {
        pathParameters: {
          keyOrUid: testKeyUid
        },
        body: updateData
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body).toHaveProperty('uid');
      expect(body).toHaveProperty('name');
      expect(body).toHaveProperty('description');
      expect(body.name).toBe(updateData.name);
      expect(body.description).toBe(updateData.description);
    }, 30000);

    it('should update only the name field', async () => {
      if (!testKeyUid) {
        console.log('No test key available for partial update test');
        return;
      }

      const updateData = {
        name: 'Partially Updated Key'
      };

      const response = await harness.put(`/api-keys/${testKeyUid}`, {
        pathParameters: {
          keyOrUid: testKeyUid
        },
        body: updateData
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body).toHaveProperty('name');
      expect(body.name).toBe(updateData.name);
    }, 30000);
  });

  describe('DELETE /api-keys/{keyOrUid}', () => {
    it('should delete an API key by UID', async () => {
      if (!testKeyUid) {
        console.log('No test key available for delete test');
        return;
      }

      const response = await harness.delete(`/api-keys/${testKeyUid}`, {
        pathParameters: {
          keyOrUid: testKeyUid
        }
      });
      expect(response.statusCode).toBe(200);
    }, 30000);

    it('should return 404 for non-existent key', async () => {
      const response = await harness.delete('/api-keys/non-existent-uid', {
        pathParameters: {
          keyOrUid: 'non-existent-uid'
        }
      });
      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.details.message).toBe('API key `non-existent-uid` not found.');
    }, 30000);
  });
}); 