import { createEntitySchema, DefaultEntityOperations } from "./base-entity";
import { BaseEntityService } from "./base-service";
import { IDIContainer } from "../interfaces";
import { registerEntitySchema, Service } from "../decorators";
import { DIContainer, InjectContainer, InjectEntitySchema } from "../di";
import { EntityValidationError, DatabaseError } from "./errors";

// Mock AWS DynamoDB client
const mockDynamoDBClient = {
  send: jest.fn().mockImplementation(() => Promise.resolve({ Items: [] })),
};

const mockEntityConfigurations = {
  table: 'test-table',
  client: mockDynamoDBClient,
};

const testEntitySchema = createEntitySchema({
  model: {
    entity: 'test',
    entityNamePlural: 'tests',
    service: 'test',
    version: '1',
    entityOperations: DefaultEntityOperations,
  },
  attributes: {
    id: { type: 'string', isIdentifier: true },
    name: { type: 'string' },
    email: { type: 'string', isUnique: true }, // Legacy isUnique
    username: { type: 'string', ensureUnique: true }, // ensureUnique without makeUnique
    slug: { type: 'string', ensureUnique: true, makeUnique: true }, // ensureUnique with makeUnique
    description: { type: 'string' }, // No uniqueness
    category: { type: 'string', isFilterable: true },
    tags: { type: 'list', items: { type: 'string' } },
    metadata: { type: 'map', properties: { key: { type: 'string' }, value: { type: 'string' } } },
  },
  indexes: {
    primary: {
      pk: {
        field: 'pk',
        composite: [ 'id' ],
      },
      sk: {
        field: 'sk',
        composite: [],
      },
    },
    byName: {
      index: 'gsi_1',
      pk: {
        field: 'gsi_1_pk',
        composite: [ 'name' ],
      },
      sk: {
        field: 'gsi_1_sk',
        composite: [],
      },
    },
  },
});

registerEntitySchema({
  forEntity: 'testEntity',
  useValue: testEntitySchema,
});

@Service()
class TestEntityService extends BaseEntityService<typeof testEntitySchema> {
  constructor(
    @InjectEntitySchema('testEntity')
    schema: typeof testEntitySchema,

    @InjectContainer()
    diContainer: IDIContainer
  ) {
    super(schema, mockEntityConfigurations, diContainer);
  }

  // Mock methods for testing
  public async mockIsUniqueAttributeValue(attributeName: string, attributeValue: any, _ignoredEntityIdentifiers?: any) {
    // Simulate database check - in real implementation this would query the database
    if (attributeName === 'email' && attributeValue === 'existing@example.com') {
      return false;
    }
    if (attributeName === 'username' && attributeValue === 'existinguser') {
      return false;
    }
    if (attributeName === 'slug' && attributeValue === 'existing-slug') {
      return false;
    }
    return true;
  }

  // Override the isUniqueAttributeValue method for testing
  public async isUniqueAttributeValue(attributeName: string, attributeValue: any, ignoredEntityIdentifiers?: any) {
    return this.mockIsUniqueAttributeValue(attributeName, attributeValue, ignoredEntityIdentifiers);
  }
}

describe('BaseEntityService', () => {
  let baseService: TestEntityService;
  let mockDiContainer: any;

  beforeEach(() => {
    // Reset mock implementations
    mockDynamoDBClient.send.mockClear();
    mockDynamoDBClient.send.mockImplementation(() => Promise.resolve({ Items: [] }));

    mockDiContainer = {
      resolveEntityService: jest.fn(),
      hasEntityService: jest.fn(),
      resolveEntitySchema: jest.fn(),
      hasEntitySchema: jest.fn(),
    };

    baseService = new TestEntityService(
      testEntitySchema,
      mockDiContainer
    );
  });

  it('should be defined', () => {
    expect(baseService).toBeDefined();
  });

  it('should have the correct entity schema', () => {
    expect(baseService.getEntitySchema()).toEqual(testEntitySchema);
  });

  it('should have the correct entity name', () => {
    expect(baseService.getEntityName()).toBe('test');
  });

  it('should have the correct entity primary id property name', () => {
    expect(baseService.getEntityPrimaryIdPropertyName()).toBe('id');
  });

  describe('getUniqueAttributes', () => {
    it('should return attributes with isUnique flag', () => {
      const uniqueAttributes = baseService.getUniqueAttributes();

      // Should include email (isUnique), username (ensureUnique), and slug (ensureUnique+makeUnique)
      expect(uniqueAttributes.length).toBe(3);

      // Check email attribute
      const emailAttr = uniqueAttributes.find(attr => attr.name === 'email');
      expect(emailAttr).toBeDefined();
      expect(emailAttr?.isUnique).toBe(true);

      // Check username attribute
      const usernameAttr = uniqueAttributes.find(attr => attr.name === 'username');
      expect(usernameAttr).toBeDefined();
      expect(usernameAttr?.ensureUnique).toBe(true);
      expect(usernameAttr?.makeUnique).toBe(false);

      // Check slug attribute
      const slugAttr = uniqueAttributes.find(attr => attr.name === 'slug');
      expect(slugAttr).toBeDefined();
      expect(slugAttr?.ensureUnique).toBe(true);
      expect(slugAttr?.makeUnique).toBe(true);
    });
  });

  describe('checkUniquenessAndUpdate', () => {
    it('should return true for non-unique attributes', async () => {
      const result = await baseService.checkUniquenessAndUpdate({
        payloadToUpdate: {},
        attributeName: 'description',
        attributeValue: 'some description',
        maxAttemptsForCreatingUniqueAttributeValue: 5
      });

      expect(result).toBe(true);
    });

    it('should handle legacy isUnique attribute - unique value', async () => {
      const payload: Record<string, any> = {};
      const result = await baseService.checkUniquenessAndUpdate({
        payloadToUpdate: payload,
        attributeName: 'email',
        attributeValue: 'new@example.com',
        maxAttemptsForCreatingUniqueAttributeValue: 5
      });

      expect(result).toBe(true);
      expect(payload[ 'email' ]).toBe('new@example.com');
    });

    it('should handle legacy isUnique attribute - non-unique value with makeUnique', async () => {
      const payload: Record<string, any> = {};
      const result = await baseService.checkUniquenessAndUpdate({
        payloadToUpdate: payload,
        attributeName: 'email',
        attributeValue: 'existing@example.com',
        maxAttemptsForCreatingUniqueAttributeValue: 5
      });

      expect(result).toBe(true);
      expect(payload[ 'email' ]).toMatch(/existing@example\.com-\d+/);
    });

    it('should handle ensureUnique without makeUnique - unique value', async () => {
      const payload: Record<string, any> = {};
      const result = await baseService.checkUniquenessAndUpdate({
        payloadToUpdate: payload,
        attributeName: 'username',
        attributeValue: 'newuser',
        maxAttemptsForCreatingUniqueAttributeValue: 5
      });

      expect(result).toBe(true);
      expect(payload[ 'username' ]).toBe('newuser');
    });

    it('should throw error for ensureUnique without makeUnique - non-unique value', async () => {
      const payload: Record<string, any> = {};

      await expect(baseService.checkUniquenessAndUpdate({
        payloadToUpdate: payload,
        attributeName: 'username',
        attributeValue: 'existinguser',
        maxAttemptsForCreatingUniqueAttributeValue: 5
      })).rejects.toThrow(EntityValidationError);

      expect(payload[ 'username' ]).toBeUndefined();
    });

    it('should handle ensureUnique with makeUnique - unique value', async () => {
      const payload: Record<string, any> = {};
      const result = await baseService.checkUniquenessAndUpdate({
        payloadToUpdate: payload,
        attributeName: 'slug',
        attributeValue: 'new-slug',
        maxAttemptsForCreatingUniqueAttributeValue: 5
      });

      expect(result).toBe(true);
      expect(payload[ 'slug' ]).toBe('new-slug');
    });

    it('should handle ensureUnique with makeUnique - non-unique value', async () => {
      const payload: Record<string, any> = {};
      const result = await baseService.checkUniquenessAndUpdate({
        payloadToUpdate: payload,
        attributeName: 'slug',
        attributeValue: 'existing-slug',
        maxAttemptsForCreatingUniqueAttributeValue: 5
      });

      expect(result).toBe(true);
      expect(payload[ 'slug' ]).toMatch(/existing-slug-\d+/);
    });

    it('should respect ignoredEntityIdentifiers when checking uniqueness', async () => {
      const payload: Record<string, any> = {};
      const result = await baseService.checkUniquenessAndUpdate({
        payloadToUpdate: payload,
        attributeName: 'email',
        attributeValue: 'existing@example.com',
        ignoredEntityIdentifiers: { id: 'current-id' },
        maxAttemptsForCreatingUniqueAttributeValue: 5
      });

      // In a real implementation, this would check if the value is unique excluding the current entity
      // For our mock, we just return true to simulate this behavior
      expect(result).toBe(true);
    });

    it('should handle attribute provided directly', async () => {
      const payload: Record<string, any> = {};
      const result = await baseService.checkUniquenessAndUpdate({
        payloadToUpdate: payload,
        attributeName: 'email',
        attributeValue: 'new@example.com',
        maxAttemptsForCreatingUniqueAttributeValue: 5,
        attribute: { type: 'string', isUnique: true, name: 'email' }
      });

      expect(result).toBe(true);
      expect(payload[ 'email' ]).toBe('new@example.com');
    });
  });

  describe('generateUniqueValue', () => {
    it('should generate a unique value with a suffix', () => {
      const originalValue = 'test-value';
      const uniqueValue = baseService.generateUniqueValue(originalValue, 1);

      expect(uniqueValue).toMatch(/test-value-\d+/);
    });

    it('should generate a unique value with a random suffix when no attempt is provided', () => {
      const originalValue = 'test-value';
      const uniqueValue = baseService.generateUniqueValue(originalValue);

      expect(uniqueValue).toMatch(/test-value-\d+/);
    });
  });

  describe('getSearchableAttributeNames', () => {
    it('should return string attributes that are not hidden or identifiers', () => {
      const searchableAttributes = baseService.getSearchableAttributeNames();

      // Should include name, email, username, slug, description, category
      expect(searchableAttributes).toContain('name');
      expect(searchableAttributes).toContain('email');
      expect(searchableAttributes).toContain('username');
      expect(searchableAttributes).toContain('slug');
      expect(searchableAttributes).toContain('description');
      expect(searchableAttributes).toContain('category');

      // Should not include id (identifier) or non-string attributes
      expect(searchableAttributes).not.toContain('id');
      expect(searchableAttributes).not.toContain('tags');
      expect(searchableAttributes).not.toContain('metadata');
    });
  });

  describe('serializeRecord', () => {
    it('should serialize a record with default attributes', () => {
      const record = {
        id: '123',
        name: 'Test Record',
        email: 'test@example.com',
        username: 'testuser',
        slug: 'test-record',
        description: 'Test description',
        category: 'Test Category',
        tags: [ 'tag1', 'tag2' ],
        metadata: { key: 'value' }
      };

      const serialized = baseService.serializeRecord(record);

      // Should include all attributes by default
      expect(serialized).toHaveProperty('id');
      expect(serialized).toHaveProperty('name');
      expect(serialized).toHaveProperty('email');
      expect(serialized).toHaveProperty('username');
      expect(serialized).toHaveProperty('slug');
      expect(serialized).toHaveProperty('description');
      expect(serialized).toHaveProperty('category');
      expect(serialized).toHaveProperty('tags');
      expect(serialized).toHaveProperty('metadata');
    });

    it('should serialize a record with specific attributes', () => {
      const record = {
        id: '123',
        name: 'Test Record',
        email: 'test@example.com',
        username: 'testuser',
        slug: 'test-record',
        description: 'Test description',
        category: 'Test Category',
        tags: [ 'tag1', 'tag2' ],
        metadata: { key: 'value' }
      };

      const serialized = baseService.serializeRecord(record, [ 'name', 'email', 'description' ] as any);

      // Should only include specified attributes
      expect(serialized).toHaveProperty('name');
      expect(serialized).toHaveProperty('email');
      expect(serialized).toHaveProperty('description');

      // Should not include other attributes
      expect(serialized).not.toHaveProperty('id');
      expect(serialized).not.toHaveProperty('username');
      expect(serialized).not.toHaveProperty('slug');
      expect(serialized).not.toHaveProperty('category');
      expect(serialized).not.toHaveProperty('tags');
      expect(serialized).not.toHaveProperty('metadata');
    });
  });

  describe('serializeRecords', () => {
    it('should serialize multiple records', () => {
      const records = [
        {
          id: '123',
          name: 'Test Record 1',
          email: 'test1@example.com'
        },
        {
          id: '456',
          name: 'Test Record 2',
          email: 'test2@example.com'
        }
      ];

      const serialized = baseService.serializeRecords(records, [ 'name', 'email' ] as any);

      expect(serialized).toHaveLength(2);
      expect(serialized[ 0 ]).toHaveProperty('name', 'Test Record 1');
      expect(serialized[ 0 ]).toHaveProperty('email', 'test1@example.com');
      expect(serialized[ 1 ]).toHaveProperty('name', 'Test Record 2');
      expect(serialized[ 1 ]).toHaveProperty('email', 'test2@example.com');
    });
  });

  describe('extractEntityIdentifiers', () => {
    it('should extract identifiers from input object', () => {
      const input = { id: '123', description: 'Test Record' };
      const identifiers = baseService.extractEntityIdentifiers(input);

      expect(identifiers).toEqual({ id: '123' });
    });

    it('should extract identifiers from input array', () => {
      const input = [
        { id: '123', description: 'Test Record 1' },
        { id: '456', description: 'Test Record 2' }
      ];
      const identifiers = baseService.extractEntityIdentifiers(input);

      expect(identifiers).toEqual([
        { id: '123' },
        { id: '456' }
      ]);
    });

    it('should handle id field as primary identifier', () => {
      const input = { id: '123', description: 'Test Record' };
      const identifiers = baseService.extractEntityIdentifiers(input);

      expect(identifiers).toEqual({ id: '123' });
    });
  });

  describe('getEntityServiceByEntityName', () => {
    it('should resolve entity service by name', () => {
      const mockService = {};
      mockDiContainer.resolveEntityService.mockReturnValue(mockService);
      const result = baseService.getEntityServiceByEntityName('testEntity');
      expect(result).toBe(mockService);
      expect(mockDiContainer.resolveEntityService).toHaveBeenCalledWith('testEntity');
    });
  });

  describe('hasEntityServiceByEntityName', () => {
    it('should check if entity service exists', () => {
      mockDiContainer.hasEntityService.mockReturnValue(true);
      const result = baseService.hasEntityServiceByEntityName('testEntity');
      expect(result).toBe(true);
      expect(mockDiContainer.hasEntityService).toHaveBeenCalledWith('testEntity');
    });
  });

  describe('getEntitySchemaByEntityName', () => {
    it('should resolve entity schema by name', () => {
      const mockSchema = {};
      mockDiContainer.resolveEntitySchema.mockReturnValue(mockSchema);
      const result = baseService.getEntitySchemaByEntityName('testEntity');
      expect(result).toBe(mockSchema);
      expect(mockDiContainer.resolveEntitySchema).toHaveBeenCalledWith('testEntity');
    });
  });

  describe('hasEntitySchemaByEntityName', () => {
    it('should check if entity schema exists', () => {
      mockDiContainer.hasEntitySchema.mockReturnValue(true);
      const result = baseService.hasEntitySchemaByEntityName('testEntity');
      expect(result).toBe(true);
      expect(mockDiContainer.hasEntitySchema).toHaveBeenCalledWith('testEntity');
    });
  });

  describe('getEntityName', () => {
    it('should return entity name from schema', () => {
      const result = baseService.getEntityName();
      expect(result).toBe('test');
    });
  });

  describe('getRepository', () => {
    it('should create and return repository if not exists', () => {
      const result = baseService.getRepository();
      expect(result).toBeDefined();
    });

    it('should return existing repository if already created', () => {
      const firstCall = baseService.getRepository();
      const secondCall = baseService.getRepository();
      expect(firstCall).toBe(secondCall);
    });
  });

  describe('getEntityValidations', () => {
    it('should return empty validations by default', () => {
      const result = baseService.getEntityValidations();
      expect(result).toEqual({});
    });
  });

  describe('getOverriddenEntityValidationErrorMessages', () => {
    it('should return empty map by default', async () => {
      const result = await baseService.getOverriddenEntityValidationErrorMessages();
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });
  });

  describe('getEntityPrimaryIdPropertyName', () => {
    it('should return primary ID property name', () => {
      const result = baseService.getEntityPrimaryIdPropertyName();
      expect(result).toBe('id');
    });
  });
});