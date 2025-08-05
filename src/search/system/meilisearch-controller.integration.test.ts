import { MeiliSearchEngine } from '../engines';
import { DIContainer } from '../../di';
import { MeiliSearchSystemController } from './meilisearch-controller';
import { LambdaTestHarness } from '../../testing/lambda-test-harness';

describe('MeiliSearch Tasks API Integration', () => {
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
    harness = new LambdaTestHarness(controller as any);
    engine = DIContainer.ROOT.resolveSearchEngine() as MeiliSearchEngine;
  }, 30000);

  describe('GET /tasks', () => {
    it('should return tasks with cursor-based pagination format', async () => {
      const response = await harness.get('/tasks', {
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
      const page1 = await harness.get('/tasks', {
        queryStringParameters: { count: '2' }
      });
      expect(page1.statusCode).toBe(200);
      const body1 = JSON.parse(page1.body);
      
      expect(body1.items.length).toBeLessThanOrEqual(2);
      // Cursor might be null if there are no more results
      if (body1.items.length === 2) {
        expect(body1.cursor).toBeTruthy();
      }

      // Get second page using cursor (if cursor exists)
      if (body1.cursor) {
        const page2 = await harness.get('/tasks', {
          queryStringParameters: { 
            count: '2',
            cursor: body1.cursor
          }
        });
        expect(page2.statusCode).toBe(200);
        const body2 = JSON.parse(page2.body);
        
        expect(body2.items.length).toBeLessThanOrEqual(2);
        
        // Verify different tasks (if any exist)
        if (body1.items.length > 0 && body2.items.length > 0) {
          expect(body2.items[0].uid).not.toBe(body1.items[0].uid);
        }
      }
    }, 30000);



    it('should handle invalid cursor gracefully', async () => {
      const response = await harness.get('/tasks', {
        queryStringParameters: { 
          count: '10',
          cursor: 'invalid-cursor'
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      
      expect(body).toHaveProperty('items');
      expect(Array.isArray(body.items)).toBe(true);
      // Invalid cursor should start from beginning, cursor can be string or null
      expect(typeof body.cursor === 'string' || body.cursor === null).toBe(true);
    }, 30000);

    it('should handle cursor pagination logic correctly', async () => {
      // Test with a small count to see cursor behavior
      const response = await harness.get('/tasks', {
        queryStringParameters: { count: '1' }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      
      expect(body).toHaveProperty('items');
      expect(body).toHaveProperty('cursor');
      expect(Array.isArray(body.items)).toBe(true);
      
      // Cursor logic: if we got exactly the count number of items, there might be more
      // If we got fewer items than the count, cursor should be null
      if (body.items.length < 1) {
        expect(body.cursor).toBeNull();
      } else if (body.items.length === 1) {
        // Got exactly 1 item, cursor can be string (more items) or null (no more items)
        expect(typeof body.cursor === 'string' || body.cursor === null).toBe(true);
      } else {
        expect(typeof body.cursor).toBe('string');
      }
    }, 30000);

    it('should handle default pagination when no parameters provided', async () => {
      const response = await harness.get('/tasks', {
        queryStringParameters: {}
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      
      expect(body).toHaveProperty('cursor');
      expect(body).toHaveProperty('items');
      expect(Array.isArray(body.items)).toBe(true);
    }, 30000);

    it('should handle large count values', async () => {
      const response = await harness.get('/tasks', {
        queryStringParameters: { 
          count: '1000'
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      
      expect(body).toHaveProperty('cursor');
      expect(body).toHaveProperty('items');
      expect(Array.isArray(body.items)).toBe(true);
    }, 30000);

    it('should handle count parameter (same as entity controller)', async () => {
      const response = await harness.get('/tasks', {
        queryStringParameters: { 
          count: '10'
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      
      expect(body).toHaveProperty('cursor');
      expect(body).toHaveProperty('items');
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.items.length).toBeLessThanOrEqual(10);
    }, 30000);

    it('should prioritize count over limit parameter', async () => {
      const response = await harness.get('/tasks', {
        queryStringParameters: { 
          count: '5',
          limit: '20'
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      
      expect(body).toHaveProperty('cursor');
      expect(body).toHaveProperty('items');
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.items.length).toBeLessThanOrEqual(5); // Should use count, not limit
    }, 30000);



    // New filter tests for entity-style query parameters
    it('should filter tasks by type using entity-style query', async () => {
      const response = await harness.get('/tasks', {
        queryStringParameters: { 
          count: '10',
          'type.eq': 'documentAdditionOrUpdate'
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      
      if (body.items.length > 0) {
        expect(body.items.every((task: any) => task.type === 'documentAdditionOrUpdate')).toBe(true);
      }
    }, 30000);

    it('should filter tasks by type using IN operator', async () => {
      const response = await harness.get('/tasks', {
        queryStringParameters: { 
          count: '10',
          'type.in': 'documentAdditionOrUpdate,settingsUpdate'
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      
      if (body.items.length > 0) {
        expect(body.items.every((task: any) => 
          ['documentAdditionOrUpdate', 'settingsUpdate'].includes(task.type)
        )).toBe(true);
      }
    }, 30000);

    it('should filter tasks by status using entity-style query', async () => {
      const response = await harness.get('/tasks', {
        queryStringParameters: { 
          count: '10',
          'status.eq': 'succeeded'
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      
      if (body.items.length > 0) {
        expect(body.items.every((task: any) => task.status === 'succeeded')).toBe(true);
      }
    }, 30000);

    it('should filter tasks by status using IN operator', async () => {
      const response = await harness.get('/tasks', {
        queryStringParameters: { 
          count: '10',
          'status.in': 'succeeded,failed'
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      
      if (body.items.length > 0) {
        expect(body.items.every((task: any) => 
          ['succeeded', 'failed'].includes(task.status)
        )).toBe(true);
      }
    }, 30000);

    it('should filter tasks by UID using entity-style query', async () => {
      // First get a task to use its UID
      const allTasks = await harness.get('/tasks', {
        queryStringParameters: { count: '1' }
      });
      expect(allTasks.statusCode).toBe(200);
      const allTasksBody = JSON.parse(allTasks.body);
      
      if (allTasksBody.items.length > 0) {
        const taskUid = allTasksBody.items[0].uid;
        
        const response = await harness.get('/tasks', {
          queryStringParameters: { 
            count: '10',
            'uid.eq': taskUid.toString()
          }
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        
        expect(body.items.length).toBe(1);
        expect(body.items[0].uid).toBe(taskUid);
      }
    }, 30000);

    it('should filter tasks by UID using IN operator', async () => {
      // First get some tasks to use their UIDs
      const allTasks = await harness.get('/tasks', {
        queryStringParameters: { count: '3' }
      });
      expect(allTasks.statusCode).toBe(200);
      const allTasksBody = JSON.parse(allTasks.body);
      
      if (allTasksBody.items.length > 0) {
        const taskUids = allTasksBody.items.map((task: any) => task.uid).slice(0, 2);
        
        const response = await harness.get('/tasks', {
          queryStringParameters: { 
            count: '10',
            'uid.in': taskUids.join(',')
          }
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        
        if (body.items.length > 0) {
          expect(body.items.every((task: any) => taskUids.includes(task.uid))).toBe(true);
        }
      }
    }, 30000);

    it('should filter tasks by indexUid using entity-style query', async () => {
      const response = await harness.get('/tasks', {
        queryStringParameters: { 
          count: '10',
          'indexUid.eq': 'test-index'
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      
      if (body.items.length > 0) {
        expect(body.items.every((task: any) => task.indexUid === 'test-index')).toBe(true);
      }
    }, 30000);

    it('should filter tasks by indexUid using IN operator', async () => {
      const response = await harness.get('/tasks', {
        queryStringParameters: { 
          count: '10',
          'indexUid.in': 'test-index,other-index'
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      
      if (body.items.length > 0) {
        expect(body.items.every((task: any) => 
          ['test-index', 'other-index'].includes(task.indexUid)
        )).toBe(true);
      }
    }, 30000);

    it('should filter tasks by enqueuedAt using LT operator', async () => {
      const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000); // Tomorrow
      
      const response = await harness.get('/tasks', {
        queryStringParameters: { 
          count: '10',
          'enqueuedAt.lt': futureDate.toISOString()
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      
      if (body.items.length > 0) {
        expect(body.items.every((task: any) => {
          const enqueuedAt = new Date(task.enqueuedAt);
          return enqueuedAt < futureDate;
        })).toBe(true);
      }
    }, 30000);

    it('should filter tasks by enqueuedAt using GT operator', async () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // Yesterday
      
      const response = await harness.get('/tasks', {
        queryStringParameters: { 
          count: '10',
          'enqueuedAt.gt': pastDate.toISOString()
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      
      if (body.items.length > 0) {
        expect(body.items.every((task: any) => {
          const enqueuedAt = new Date(task.enqueuedAt);
          return enqueuedAt > pastDate;
        })).toBe(true);
      }
    }, 30000);

    it('should filter tasks by startedAt using LT operator', async () => {
      const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000); // Tomorrow
      
      const response = await harness.get('/tasks', {
        queryStringParameters: { 
          count: '10',
          'startedAt.lt': futureDate.toISOString()
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      
      if (body.items.length > 0) {
        expect(body.items.every((task: any) => {
          if (!task.startedAt) return true; // Skip tasks without startedAt
          const startedAt = new Date(task.startedAt);
          return startedAt < futureDate;
        })).toBe(true);
      }
    }, 30000);

    it('should filter tasks by startedAt using GT operator', async () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // Yesterday
      
      const response = await harness.get('/tasks', {
        queryStringParameters: { 
          count: '10',
          'startedAt.gt': pastDate.toISOString()
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      
      if (body.items.length > 0) {
        expect(body.items.every((task: any) => {
          if (!task.startedAt) return false; // Only include tasks with startedAt
          const startedAt = new Date(task.startedAt);
          return startedAt > pastDate;
        })).toBe(true);
      }
    }, 30000);

    it('should filter tasks by finishedAt using LT operator', async () => {
      const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000); // Tomorrow
      
      const response = await harness.get('/tasks', {
        queryStringParameters: { 
          count: '10',
          'finishedAt.lt': futureDate.toISOString()
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      
      if (body.items.length > 0) {
        expect(body.items.every((task: any) => {
          if (!task.finishedAt) return true; // Skip tasks without finishedAt
          const finishedAt = new Date(task.finishedAt);
          return finishedAt < futureDate;
        })).toBe(true);
      }
    }, 30000);

    it('should filter tasks by finishedAt using GT operator', async () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // Yesterday
      
      const response = await harness.get('/tasks', {
        queryStringParameters: { 
          count: '10',
          'finishedAt.gt': pastDate.toISOString()
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      
      if (body.items.length > 0) {
        expect(body.items.every((task: any) => {
          if (!task.finishedAt) return false; // Only include tasks with finishedAt
          const finishedAt = new Date(task.finishedAt);
          return finishedAt > pastDate;
        })).toBe(true);
      }
    }, 30000);

    it('should filter tasks by canceledBy using entity-style query', async () => {
      const response = await harness.get('/tasks', {
        queryStringParameters: { 
          count: '10',
          'canceledBy.eq': '123'
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      
      expect(body).toHaveProperty('cursor');
      expect(body).toHaveProperty('items');
      expect(Array.isArray(body.items)).toBe(true);
    }, 30000);

    it('should filter tasks by batchUid using entity-style query', async () => {
      const response = await harness.get('/tasks', {
        queryStringParameters: { 
          count: '10',
          'batchUid.eq': '456'
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      
      expect(body).toHaveProperty('cursor');
      expect(body).toHaveProperty('items');
      expect(Array.isArray(body.items)).toBe(true);
    }, 30000);

    it('should filter tasks by batchUid using IN operator', async () => {
      const response = await harness.get('/tasks', {
        queryStringParameters: { 
          count: '10',
          'batchUid.in': '456,789'
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      
      expect(body).toHaveProperty('cursor');
      expect(body).toHaveProperty('items');
      expect(Array.isArray(body.items)).toBe(true);
    }, 30000);

    it('should handle complex entity-style filter combinations', async () => {
      const response = await harness.get('/tasks', {
        queryStringParameters: { 
          count: '10',
          'type.eq': 'documentAdditionOrUpdate',
          'status.eq': 'succeeded',
          'enqueuedAt.gt': new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // Last 7 days
          cursor: '',
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      
      expect(body).toHaveProperty('cursor');
      expect(body).toHaveProperty('items');
      expect(Array.isArray(body.items)).toBe(true);
      
      if (body.items.length > 0) {
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        expect(body.items.every((task: any) => {
          const enqueuedAt = new Date(task.enqueuedAt);
          return task.type === 'documentAdditionOrUpdate' && 
                 task.status === 'succeeded' && 
                 enqueuedAt > weekAgo;
        })).toBe(true);
      }
    }, 30000);

    it('should handle attributes parameter', async () => {
      const response = await harness.get('/tasks', {
        queryStringParameters: { 
          count: '5',
          attributes: 'uid,indexUid,status,type,enqueuedAt,startedAt,finishedAt'
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      
      expect(body).toHaveProperty('cursor');
      expect(body).toHaveProperty('items');
      expect(Array.isArray(body.items)).toBe(true);
      
      if (body.items.length > 0) {
        const task = body.items[0];
        expect(task).toHaveProperty('uid');
        expect(task).toHaveProperty('indexUid');
        expect(task).toHaveProperty('status');
        expect(task).toHaveProperty('type');
        expect(task).toHaveProperty('enqueuedAt');
        expect(task).toHaveProperty('startedAt');
        expect(task).toHaveProperty('finishedAt');
      }
    }, 30000);
  });
}); 