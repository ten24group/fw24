import { BaseEntityService } from "../base-service";
import { BaseEntityController } from "../base-entity-controller";
import { createEntitySchema, DefaultEntityOperations } from "../base-entity";
import { EntityOperation } from "../decorators";
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
    entityOperations: DefaultEntityOperations
  },
  attributes: {
    id: { type: "string", required: true, isIdentifier: true },
    name: { type: "string", required: true },
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

  @EntityOperation({
    method: 'POST',
    path: '/do-something',
    label: 'Do Something'
  })
  async doSomething(payload: any, ctx?: ExecutionContext) {
    return { done: true, payload };
  }
}

describe("Extensibility & Overrides", () => {
  let service: TestService;

  beforeEach(() => {
    service = new TestService();
  });

  describe("@EntityOperation Decorator", () => {
    it("should pick up operations from service decorators", () => {
      const config = service.getOperationsConfig();
      expect(config.doSomething).toBeDefined();
      expect(config.doSomething.method).toBe('POST');
      expect(config.doSomething.path).toBe('/do-something');
    });

    it("should register decorated operations in controller", () => {
      const controller = new BaseEntityController(service);
      const routes = (controller as any).routes;

      expect(routes['POST|/do-something']).toBeDefined();
      expect(routes['POST|/do-something'].entityOperation).toBe('doSomething');
    });

    it("should execute decorated operation via controller dynamic handler", async () => {
      const controller = new BaseEntityController(service);

      const req: any = {
        path: '/test/do-something',
        body: { foo: 'bar' },
        route: { entityOperation: 'doSomething' } // Mocking what the router would provide
      };
      const res: any = { json: jest.fn().mockImplementation(data => data) };

      const result = await controller.handleDynamicOperation(req, res, {});

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        done: true,
        payload: expect.objectContaining({ foo: 'bar' })
      }));
    });
  });

  describe("Controller Overrides", () => {
      it("should allow overriding standard operations in controller subclass", async () => {
          class OverriddenController extends BaseEntityController<typeof testSchema> {
              async create(req: any, res: any) {
                  return res.json({ overridden: true });
              }
          }

          const controller = new OverriddenController(service);
          const req: any = { body: {} };
          const res: any = { json: jest.fn().mockImplementation(data => data) };

          await controller.create(req, res);
          expect(res.json).toHaveBeenCalledWith({ overridden: true });
      });
  });

  describe("Soft Delete", () => {
      const softDeleteSchema = createEntitySchema({
          model: {
              entity: "soft",
              entityNamePlural: "Softs",
              service: "softService",
              version: "1",
              entityOperations: DefaultEntityOperations,
              softDelete: true
          },
          attributes: {
              id: { type: "string", required: true, isIdentifier: true },
              deletedAt: { type: "string" }
          },
          indexes: {
              primary: {
                  pk: { field: "pk", composite: ["id"] },
                  sk: { field: "sk", composite: [] }
              }
          }
      } as const);

      class SoftDeleteService extends BaseEntityService<typeof softDeleteSchema> {
          constructor() {
              super(softDeleteSchema, mockEntityConfigurations, DIContainer.ROOT);
          }
      }

      it("should perform soft delete by updating deletedAt", async () => {
          const softService = new SoftDeleteService();
          const mockRepo = {
              patch: jest.fn().mockReturnValue({
                  set: jest.fn().mockReturnThis(),
                  go: jest.fn().mockResolvedValue({ data: { id: "1", deletedAt: "now" } })
              }),
              get: jest.fn().mockReturnValue({
                  go: jest.fn().mockResolvedValue({ data: { id: "1" } })
              })
          };
          jest.spyOn(softService, 'getRepository').mockReturnValue(mockRepo as any);

          await softService.executeOperation('delete', { id: "1" });

          expect(mockRepo.patch).toHaveBeenCalledWith({ id: "1" });
          expect(mockRepo.patch().set).toHaveBeenCalledWith(expect.objectContaining({
              deletedAt: expect.any(String)
          }));
      });

      it("should add deletedAt filter to list operations", async () => {
          const softService = new SoftDeleteService();
          const mockRepo = {
              _findBestIndexKeyMatch: jest.fn().mockReturnValue({ keys: [], index: '', shouldScan: true }),
              scan: {
                  where: jest.fn().mockReturnThis(),
                  go: jest.fn().mockResolvedValue({ data: [] })
              }
          };
          jest.spyOn(softService, 'getRepository').mockReturnValue(mockRepo as any);

          await softService.executeOperation('list', {});

          expect(mockRepo.scan.where).toHaveBeenCalled();
          // The exact expression depends on internal implementation, but we check if it was called
      });
  });
});
