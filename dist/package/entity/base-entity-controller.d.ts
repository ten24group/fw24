import type { Request, Response } from '../interfaces';
import type { EntitySchema } from './base-entity';
import type { BaseEntityService } from './base-service';
import { APIController } from '../core/runtime/api-gateway-controller';
import { ExecutionContext } from '../core/types/execution-context';
type seconds = number;
export type GetSignedUrlForFileUploadSchema = {
    fileName: string;
    bucketName: string;
    expiresIn?: seconds;
    fileNamePrefix?: string;
    contentType?: string;
    metadata?: Record<string, string> | string;
};
/**
 * Abstract base class for entity controllers.
 * @template Sch - The entity schema type.
 */
export declare class BaseEntityController<Sch extends EntitySchema<any, any, any>> extends APIController {
    protected readonly entityService: BaseEntityService<Sch>;
    private entityName;
    /**
     * Creates an instance of BaseEntityController.
     * @param {BaseEntityService<Sch>} entityService - The entity-service.
     * @param {string} entityName - The name of the entity.
     */
    constructor(entityService: BaseEntityService<Sch>, entityName?: Sch["model"]["entity"]);
    protected getEntityName(): string;
    /**
     * Initializes the entity controller.
     * Note: It's not an ideal place to initialize the app state/DI/routes, and should be refactored to an ideal component.
     * @param {any} event - The event object.
     * @param {any} context - The context object.
     * @returns {Promise<void>} A promise that resolves when the initialization is complete.
     */
    initialize(_event: any, _context: any): Promise<void>;
    /**
     * Gets the entity service for the controller.
     * @template S - The type of the entity service.
     * @returns {S} The entity service.
     */
    getEntityService<S extends BaseEntityService<Sch>>(): S;
    /**
     * Creates a new entity.
     * Top-level `null` in the body omits optional attributes on the new item (not stored as null).
     * @param {Request} req - The request object.
     * @param {Response} res - The response object.
     * @returns {Promise<Response>} A promise that resolves with the response.
     */
    create(req: Request, res: Response, ctx?: ExecutionContext): Promise<Response>;
    getSignedUrlForFileUpload(req: Request, res: Response, _ctx?: ExecutionContext): Promise<Response>;
    duplicate(req: Request, res: Response, ctx?: ExecutionContext): Promise<Response>;
    /**
     * Finds an entity by ID.
     * @param {Request} req - The request object.
     * @param {Response} res - The response object.
     * @returns {Promise<Response>} A promise that resolves with the response.
     */
    find(req: Request, res: Response, ctx?: ExecutionContext): Promise<Response>;
    /**
     * Lists entities.
     * @param {Request} req - The request object.
     * @param {Response} res - The response object.
     * @returns {Promise<Response>} A promise that resolves with the response.
     */
    list(req: Request, res: Response, ctx?: ExecutionContext): Promise<Response>;
    /**
     * Updates an entity by ID.
     * Request body uses JSON Merge Patch semantics for top-level keys: `null` clears an optional attribute
     * (DynamoDB REMOVE), rather than storing null (ElectroDB rejects null for most scalar types).
     * @param {Request} req - The request object.
     * @param {Response} res - The response object.
     * @returns {Promise<Response>} A promise that resolves with the response.
     */
    update(req: Request, res: Response, ctx?: ExecutionContext): Promise<Response>;
    /**
     * Deletes an entity by ID.
     * @param {Request} req - The request object.
     * @param {Response} res - The response object.
     * @returns {Promise<Response>} A promise that resolves with the response.
     */
    delete(req: Request, res: Response, ctx?: ExecutionContext): Promise<Response>;
    /**
     * BULK DELETE OPERATIONS
     * =======================
     *
     * The following methods are commented out by default as they are dangerous operations
     * that can delete multiple records at once. To enable them in your controller:
     *
     * 1. Uncomment the method(s) you need
     * 2. Add appropriate authorization checks
     * 3. Consider adding additional safety measures (e.g., dry-run mode, confirmation tokens)
     * 4. Add audit logging
     *
     * Example usage in a specific entity controller:
     *
     * ```typescript
     * export class MyEntityController extends BaseEntityController<MyEntitySchema> {
     *     // Uncomment and customize the bulk delete methods below
     * }
     * ```
     */
    /**
     * Batch deletes multiple entities by their IDs.
     *
     * ⚠️ DANGEROUS OPERATION - Enable only in specific controllers with proper authorization
     *
     * @param {Request} req - The request object with body: { ids: Array<identifiers>, concurrent?: number }
     * @param {Response} res - The response object.
     * @returns {Promise<Response>} A promise that resolves with the response.
     *
     * @example
     * // Request body:
     * {
     *   "ids": [
     *     { "id": "item1" },
     *     { "id": "item2" },
     *     { "id": "item3" }
     *   ],
     *   "concurrent": 2
     * }
     */
    batchDelete(req: Request, res: Response, ctx?: ExecutionContext): Promise<Response>;
    /**
     * Deletes entities based on filter criteria.
     *
     * ⚠️ EXTREMELY DANGEROUS OPERATION - Enable only in specific controllers with strict authorization
     *
     * This endpoint queries for entities matching the filters and batch deletes them.
     * It includes safety measures like requiring filters and optional maxItems limit.
     *
     * @param {Request} req - The request object with body containing filters and options
     * @param {Response} res - The response object.
     * @returns {Promise<Response>} A promise that resolves with the response.
     *
     * @example
     * // Request body:
     * {
     *   "filters": {
     *     "status": { "eq": "inactive" },
     *     "lastLoginAt": { "lt": "2023-01-01" }
     *   },
     *   "batchSize": 50,
     *   "concurrent": 2,
     *   "maxItems": 1000
     * }
     */
    deleteByQuery(req: Request, res: Response, ctx?: ExecutionContext): Promise<Response>;
    /**
     * Performs a custom query on the entity.
     * @param {Request} req - The request object.
     * @param {Response} res - The response object.
     * @returns {Promise<Response>} A promise that resolves with the response.
     */
    query(req: Request, res: Response, ctx?: ExecutionContext): Promise<Response>;
    search(req: Request, res: Response, ctx?: ExecutionContext): Promise<Response>;
    searchGet(req: Request, res: Response, ctx?: ExecutionContext): Promise<Response>;
}
export {};
