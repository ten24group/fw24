import { BaseEntityService } from "../base-service";
import { BaseEntityController } from "../base-entity-controller";
import { createEntitySchema, DefaultEntityOperations } from "../base-entity";
import { DIContainer } from "../../di";
import { ExecutionContext } from "../../core/types/execution-context";

// Mock dependencies
const mockEntityConfigurations: any = {
  table: "test-table",
};

const testSchema = createEntitySchema({
  model: {
    entity: "test",
    entityNamePlural: "Tests",
    service: "testService",
    version: "1",
    entityOperations: {
      ...DefaultEntityOperations,
      customOp: {
        enabled: true,
        method: 'POST',
        path: '/custom-op',
        handler: 'customHandler',
        label: 'Custom Op'
      },
      disabledOp: {
        enabled: false,
        method: 'GET',
        path: '/disabled'
      }
    }
  },
  attributes: {
    id: { type: "string", required: true, isIdentifier: true },
    name: { type: "string", required: true },
    status: { type: "string" }
  },
  indexes: {
    primary: {
      pk: { field: "pk", composite: ["id"] },
      sk: { field: "sk", composite: [] }
    }
  }
} as const);

class TestService extends BaseEntityService<typeof testSchema> {
  constructor() {
    super(testSchema, mockEntityConfigurations, DIContainer.ROOT);
  }

  async customHandler(payload: any, ctx?: ExecutionContext) {
    return { success: true, payload, operation: 'customOp' };
  }

  // Hook overrides for testing
  public beforeHookCalled = false;
  public afterHookCalled = false;

  protected async onBeforeCreate(payload: any, ctx?: ExecutionContext) {
    this.beforeHookCalled = true;
    return await super.onBeforeCreate(payload, ctx);
  }

  protected async onAfterCreate(record: any, ctx?: ExecutionContext) {
    this.afterHookCalled = true;
    await super.onAfterCreate(record, ctx);
  }
}

describe("Entity Overhaul", () => {
  let service: TestService;

  beforeEach(() => {
    service = new TestService();
  });

  describe("BaseEntityService Operations & Hooks", () => {
    it("should correctly resolve operations config", () => {
      const config = service.getOperationsConfig();
      expect(config.get).toBeDefined();
      expect(config.customOp).toBeDefined();
      expect(config.customOp.enabled).toBe(true);
      expect(config.disabledOp.enabled).toBe(false);
    });

    it("should execute custom operation via executeOperation", async () => {
      const payload = { data: "test" };
      const result = await service.executeOperation('customOp', payload);
      expect(result).toEqual({ success: true, payload, operation: 'customOp' });
    });

    it("should throw error for disabled operation", async () => {
      await expect(service.executeOperation('disabledOp', {})).rejects.toThrow(/not enabled/);
    });

    it("should trigger hooks during create operation", async () => {
      // Mock repository create
      const mockRepo = {
        create: jest.fn().mockReturnValue({
          go: jest.fn().mockResolvedValue({ data: { id: "1", name: "test" } })
        }),
        // Mock internal methods needed by findMatchingIndex (called during uniqueness check)
        _findBestIndexKeyMatch: jest.fn().mockReturnValue({ keys: [], index: '', shouldScan: true }),
        scan: {
          where: jest.fn().mockReturnThis(),
          go: jest.fn().mockResolvedValue({ data: [] })
        }
      };
      jest.spyOn(service, 'getRepository').mockReturnValue(mockRepo as any);

      const payload = { id: "1", name: "test" };
      await service.executeOperation('create', payload);

      expect(service.beforeHookCalled).toBe(true);
      expect(service.afterHookCalled).toBe(true);
    });
  });

  describe("BaseEntityController Metadata Routing", () => {
    it("should register custom routes based on metadata", () => {
      const controller = new BaseEntityController(service);
      const routes = (controller as any).routes;

      expect(routes['POST|/custom-op']).toBeDefined();
      expect(routes['POST|/custom-op'].functionName).toBe('handleDynamicOperation');
    });

    it("should NOT register disabled routes", () => {
      const controller = new BaseEntityController(service);
      const routes = (controller as any).routes;

      expect(routes['GET|/disabled']).toBeUndefined();
    });

    it("should map standard routes to executeOperation", async () => {
        const controller = new BaseEntityController(service);
        const mockExecute = jest.spyOn(service, 'executeOperation').mockResolvedValue({ id: '1' });

        const req: any = { body: { name: 'test' }, path: '/tests' };
        const res: any = { json: jest.fn().mockImplementation(data => data) };

        // Pass a mock execution context
        const ctx: any = {};
        await controller.create(req, res, ctx);

        expect(mockExecute).toHaveBeenCalledWith('create', req.body, ctx);
    });
  });
});
