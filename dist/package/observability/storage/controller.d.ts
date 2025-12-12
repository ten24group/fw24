/**
 * ObservabilityLogController - Base controller for observability logs
 *
 * Extends BaseEntityController which provides standard CRUD + search.
 * Only adds trace-specific methods not covered by base.
 */
import { BaseEntityController } from '../../entity/base-entity-controller';
import { ObservabilityLogSchema } from './log-entity';
import { ObservabilityLogService, ReconstructedSpan } from './service';
/**
 * Base controller for observability log queries.
 * Extend this with @Controller decorator in your application.
 */
export declare class ObservabilityLogController extends BaseEntityController<ObservabilityLogSchema> {
    readonly logService: ObservabilityLogService;
    constructor(logService: ObservabilityLogService);
    /**
     * Get reconstructed span tree for a trace
     * GET /trace/:correlationId/spans
     */
    getTraceSpans(request: any, ctx: any): Promise<{
        correlationId: string;
        spans: ReconstructedSpan[];
    }>;
}
