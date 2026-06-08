import { BaseEntityController } from './base-entity-controller';
import { BaseEntityService } from './base-service';
import { EntitySchema } from './base-entity';
import { LambdaTestHarness } from '../testing/lambda-test-harness';
import { SearchResult } from '../search';
import { CreateEntityResponse } from './crud-service';
import { Controller } from '../decorators';
import { NotFoundError } from '../errors';

// Mock the BaseEntityService
class MockEntityService extends BaseEntityService<any> {
  constructor() {
    super({} as EntitySchema<any, any, any>, {});
  }

  getEntityName() {
    return 'testEntity';
  }

  extractEntityIdentifiers(input: Record<string, string>) {
    return { id: input.id };
  }

  async create(payload: any) {
    return { id: 'test-id', ...payload };
  }

  async get(options: any) {
    if (options.identifiers.id === 'not-found') {
      throw new NotFoundError('TestEntity');
    }
    return { id: options.identifiers.id, name: 'Test Entity' };
  }

  async list(query: any) {
    // Create a mock response based on the query parameters
    interface MockEntity {
      id: string;
      name: string;
      status: string;
      [ key: string ]: string;
    }

    const mockData: MockEntity[] = [
      { id: '1', name: 'Entity 1', status: 'active' },
      { id: '2', name: 'Entity 2', status: 'inactive' }
    ];

    // Apply filters if present
    let filteredData = mockData;
    if (query.filters) {
      filteredData = mockData.filter(item => {
        return Object.entries(query.filters).every(([ key, value ]) => item[ key ] === value);
      });
    }

    // Apply pagination
    const limit = query.pagination?.limit || 10;
    const offset = query.pagination?.cursor ? parseInt(query.pagination.cursor) : 0;
    const paginatedData = filteredData.slice(offset, offset + limit);

    return {
      data: paginatedData,
      cursor: offset + limit < filteredData.length ? (offset + limit).toString() : null,
      query: query
    };
  }

  async update(identifiers: any, data: any) {
    if (identifiers.id === 'not-found') {
      throw new NotFoundError('TestEntity');
    }
    return { id: identifiers.id, ...data };
  }

  async delete(identifiers: any) {
    if (identifiers.id === 'not-found') {
      throw new NotFoundError('TestEntity');
    }
    return {
      data: {
        id: identifiers.id,
        name: 'Deleted Entity',
        pk: 'test',
        sk: 'test',
        gsi1pk: 'test',
        gsi1sk: 'test'
      }
    };
  }

  async query(query: any) {
    interface MockEntity {
      id: string;
      name: string;
      status: string;
      [ key: string ]: string;
    }

    const mockData: MockEntity[] = [
      { id: '1', name: 'Query Result 1', status: 'active' },
      { id: '2', name: 'Query Result 2', status: 'inactive' }
    ];

    // Apply filters if present
    let filteredData = mockData;
    if (query.filters) {
      filteredData = mockData.filter(item => {
        return Object.entries(query.filters).every(([ key, value ]) => item[ key ] === value);
      });
    }

    return {
      data: filteredData,
      cursor: 'query-next-cursor',
      query: query
    };
  }

  async search(query: any) {
    interface MockEntity {
      id: string;
      name: string;
      status: string;
      [ key: string ]: string;
    }

    const mockData: MockEntity[] = [
      { id: '1', name: 'Search Result 1', status: 'active' },
      { id: '2', name: 'Search Result 2', status: 'inactive' }
    ];

    // Apply filters if present
    let filteredData = mockData;
    // if (query.filters) {
    //   filteredData = mockData.filter(item => {
    //     return Object.entries(query.filters).every(([ key, value ]) => item[ key ] === value);
    //   });
    // }

    // Apply search if present
    if (query.search) {
      filteredData = filteredData.filter(item =>
        item.name.toLowerCase().includes(query.search.toLowerCase())
      );
    }

    return {
      hits: filteredData,
      facets: { status: { active: filteredData.filter(i => i.status === 'active').length } },
      total: filteredData.length,
      page: query.pagination?.pages || 1,
      hitsPerPage: query.pagination?.count || 10,
      processingTimeMs: 50
    } as SearchResult<any>;
  }

  async duplicate(identifiers: any) {
    if (identifiers.id === 'not-found') {
      throw new NotFoundError('TestEntity');
    }
    return {
      data: {
        id: 'duplicated-id',
        name: 'Duplicated Entity',
        pk: 'test',
        sk: 'test',
        gsi1pk: 'test',
        gsi1sk: 'test'
      }
    } as CreateEntityResponse<any>;
  }
}

// Create a concrete implementation of BaseEntityController for testing
@Controller('testentity')
class TestEntityController extends BaseEntityController<any> {
  constructor() {
    super(new MockEntityService());
  }
}

describe('BaseEntityController', () => {
  let controller: TestEntityController;
  let harness: LambdaTestHarness;

  beforeEach(() => {
    controller = new TestEntityController();
    // (controller as any).controllerName = 'testEntity';
    harness = new LambdaTestHarness(controller as any);
  });

  describe('create', () => {
    it('should create a new entity', async () => {
      const response = await harness.post('', {
        body: { name: 'New Entity' }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.testEntity).toBeDefined();
      expect(body.testEntity.id).toBe('test-id');
      expect(body.testEntity.name).toBe('New Entity');
      expect(body.message).toBe('Created successfully');
    });
  });

  describe('find', () => {
    it('should find an entity by id', async () => {
      const response = await harness.get('/123', {
        pathParameters: { id: '123' },
        resourcePath: '/{id}'
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.testEntity).toBeDefined();
      expect(body.testEntity.id).toBe('123');
      expect(body.testEntity.name).toBe('Test Entity');
    });

    it('should return 404 when entity is not found', async () => {
      const response = await harness.get('/not-found', {
        pathParameters: { id: 'not-found' },
        resourcePath: '/{id}'
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('error');
      expect(body.message).toContain('Resource Not Found');
    });
  });

  describe('list', () => {
    it('should list entities', async () => {
      const response = await harness.get('', {
        queryStringParameters: {
          limit: '10',
          order: 'desc'
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items).toBeDefined();
      expect(body.items.length).toBe(2);
      expect(body.cursor).toBeDefined();
    });

    it('should handle filters', async () => {
      const response = await harness.get('', {
        queryStringParameters: {
          filters: JSON.stringify({ status: 'active' })
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items).toBeDefined();
      expect(body.items.length).toBe(1);
      expect(body.items[ 0 ].status).toBe('active');
    });
  });

  describe('update', () => {
    it('should update an entity', async () => {
      const response = await harness.patch('/123', {
        pathParameters: { id: '123' },
        resourcePath: '/{id}',
        body: { name: 'Updated Entity' }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.testEntity).toBeDefined();
      expect(body.testEntity.id).toBe('123');
      expect(body.testEntity.name).toBe('Updated Entity');
      expect(body.message).toBe('Updated successfully');
    });

    it('should return 404 when entity to update is not found', async () => {
      const response = await harness.patch('/not-found', {
        pathParameters: { id: 'not-found' },
        resourcePath: '/{id}',
        body: { name: 'Updated Entity' }
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('error');
      expect(body.message).toContain('Resource Not Found');
    });
  });

  describe('delete', () => {
    it('should delete an entity', async () => {
      const response = await harness.delete('/123', {
        pathParameters: { id: '123' },
        resourcePath: '/{id}'
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.testEntity).toBeDefined();
      expect(body.testEntity.data.id).toBe('123');
      expect(body.testEntity.data.name).toBe('Deleted Entity');
      expect(body.message).toBe('Deleted successfully');
    });

    it('should return 404 when entity to delete is not found', async () => {
      const response = await harness.delete('/not-found', {
        pathParameters: { id: 'not-found' },
        resourcePath: '/{id}'
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('error');
      expect(body.message).toContain('Resource Not Found');
    });
  });

  describe('query', () => {
    it('should perform a query', async () => {
      const response = await harness.post('/query', {
        body: {
          filters: { status: 'active' }
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items).toBeDefined();
      expect(body.items.length).toBe(1);
      expect(body.cursor).toBe('query-next-cursor');
    });
  });

  describe('search', () => {
    it('should perform a search', async () => {
      const response = await harness.post('/search', {
        body: {
          search: 'Result',
          filters: { status: 'active' }
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items).toBeDefined();
      expect(body.items.length).toBe(2);
      expect(body.total).toBe(2);
      expect(body.facets).toBeDefined();
      expect(body.facets.status.active).toBe(1);
    });

    it('should perform a search via GET', async () => {
      const response = await harness.get('/search', {
        queryStringParameters: {
          q: 'result 1',
          status: 'active',
          hitsPerPage: '10',
          page: '1'
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items).toBeDefined();
      expect(body.items.length).toBe(1);
      expect(body.facets).toBeDefined();
      expect(body.total).toBe(1);
      expect(body.page).toBe(1);
      expect(body.hitsPerPage).toBe(10);
    });
  });

  describe('duplicate', () => {
    it('should duplicate an entity', async () => {
      const response = await harness.get('/duplicate/123', {
        pathParameters: { id: '123' },
        resourcePath: '/duplicate/{id}'
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.testEntity).toBeDefined();
      expect(body.testEntity.data).toBeDefined();
      expect(body.testEntity.data.id).toBe('duplicated-id');
      expect(body.testEntity.data.name).toBe('Duplicated Entity');
    });

    it('should return 404 when entity to duplicate is not found', async () => {
      const response = await harness.get('/duplicate/not-found', {
        pathParameters: { id: 'not-found' },
        resourcePath: '/duplicate/{id}'
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('error');
      expect(body.message).toContain('Resource Not Found');
    });
  });

  describe('getSignedUrlForFileUpload', () => {
    it('should get a signed URL for file upload', async () => {
      // Mock the getSignedUrlForFileUpload function
      jest.spyOn(require('../client/s3'), 'getSignedUrlForFileUpload').mockResolvedValue('https://example.com/signed-url');

      const response = await harness.get('/getSignedUrlForFileUpload', {
        resourcePath: '/getSignedUrlForFileUpload',
        queryStringParameters: {
          fileName: 'test.jpg',
          bucketName: 'test-bucket',
          expiresIn: '900',
          fileNamePrefix: 'prefix-',
          contentType: 'image/jpeg',
          metadata: JSON.stringify({ key: 'value' })
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.fileName).toBeDefined();
      expect(body.fileName).toContain('prefix-');
      expect(body.fileName).toContain('.jpg');
      expect(body.expiresIn).toBe(900);
      expect(body.contentType).toBe('image/jpeg');
      expect(body.signedUploadURL).toBe('https://example.com/signed-url');
    });

    it('should handle missing required parameters', async () => {
      const response = await harness.get('/getSignedUrlForFileUpload', {
        resourcePath: '/getSignedUrlForFileUpload',
        queryStringParameters: {
          // Missing required fileName and bucketName
        }
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('error');
      expect(body.message).toBe('Validation Failed');
      expect(body.details).toBeDefined();
      expect(body.details.errors).toBeDefined();
    });
  });
}); 