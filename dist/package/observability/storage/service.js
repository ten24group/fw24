"use strict";
/**
 * ObservabilityLogService - Service for observability data storage
 *
 * Registered via DI with @Service decorator.
 * Config injected via @InjectConfig.
 */
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ObservabilityLogService = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const decorators_1 = require("../../decorators");
const di_1 = require("../../di");
const base_service_1 = require("../../entity/base-service");
const observability_log_entity_1 = require("./observability-log-entity");
const env_1 = require("../../utils/env");
// manual registration of the schema to avoid circular dependency
di_1.DIContainer.ROOT.register({
    type: 'schema',
    provide: 'observabilityLogSchema',
    forEntity: 'observabilityLog',
    useValue: observability_log_entity_1.ObservabilityLogEntitySchema,
});
/**
 * ObservabilityLogService
 *
 * DI-managed service for observability log storage.
 * tableName and ttlDays injected via @InjectConfig.
 *
 */
let ObservabilityLogService = class ObservabilityLogService extends base_service_1.BaseEntityService {
    tableKey;
    ttlDays;
    schema;
    container;
    constructor(tableKey, ttlDays, schema, container) {
        const client = new client_dynamodb_1.DynamoDBClient({});
        const docClient = lib_dynamodb_1.DynamoDBDocumentClient.from(client, {
            marshallOptions: { removeUndefinedValues: true, convertEmptyValues: true },
        });
        // Resolve actual table name from env using framework convention
        // Env var: {tableKey}_table (special chars replaced with _)
        const tableName = (0, env_1.resolveEnvValueFor)({ key: tableKey, suffix: 'table', defaultValue: tableKey });
        super(schema, {
            table: tableName,
            client: docClient,
        }, container);
        this.tableKey = tableKey;
        this.ttlDays = ttlDays;
        this.schema = schema;
        this.container = container;
    }
    /** Batch create - used by DynamoDB backend */
    async batchCreate(items) {
        const repo = this.getRepository();
        await repo.put(items).go();
    }
    /** Override list to default to desc order (latest first) */
    async list(query = {}, ctx) {
        return super.list({
            ...query,
            pagination: { ...query.pagination, order: query.pagination?.order ?? 'desc' },
        }, ctx);
    }
    /** Override search to default sort by timestamp desc */
    async search(query, ctx) {
        return super.search({
            ...query,
            sort: query.sort?.length ? query.sort : [{ field: 'timestampMs', dir: 'desc' }],
        }, ctx);
    }
    /** Get trace with reconstructed span tree */
    async getTraceWithSpans(correlationId, ctx) {
        const result = await this.query({
            filters: { correlationId: { eq: correlationId } },
            pagination: { order: 'asc' },
            index: { name: 'byTrace' },
        }, ctx);
        return this.reconstructSpans((result.data ?? []));
    }
    /** Reconstruct span hierarchy from flat log records */
    reconstructSpans(records) {
        const spanMap = new Map();
        const grouped = new Map();
        for (const record of records) {
            // Filter by type (span.start, span.end, span.event) and group by entityId (spanId)
            if (!record.type?.startsWith('span.'))
                continue;
            const id = String(record.entityId);
            (grouped.get(id) ?? grouped.set(id, []).get(id)).push(record);
        }
        for (const [spanId, spanRecords] of grouped) {
            const start = spanRecords.find(r => r.type === 'span.start');
            const end = spanRecords.find(r => r.type === 'span.end');
            if (!start)
                continue;
            spanMap.set(spanId, {
                spanId,
                traceId: String(start.correlationId ?? ''),
                parentObservabilityLogId: start.parentObservabilityLogId ? String(start.parentObservabilityLogId) : undefined,
                operation: String(start.operation ?? 'unknown'),
                startTime: Number(start.timestampMs ?? 0),
                endTime: end?.timestampMs ? Number(end.timestampMs) : undefined,
                duration: end?.durationMs ? Number(end.durationMs) : undefined,
                status: end?.status ? String(end.status) : undefined,
                success: typeof end?.success === 'boolean' ? end.success : undefined,
                attributes: { ...toRecord(start.data), ...toRecord(end?.data) },
                events: spanRecords.filter(r => r.type === 'span.event').map(e => ({
                    name: String(e.operation ?? 'event'),
                    timestamp: Number(e.timestampMs ?? 0),
                    attributes: toRecord(e.data),
                })),
                metrics: toNumberRecord(end?.metrics),
                children: [],
            });
        }
        const roots = [];
        for (const span of spanMap.values()) {
            const parent = span.parentObservabilityLogId && spanMap.get(span.parentObservabilityLogId);
            parent ? parent.children.push(span) : roots.push(span);
        }
        const sortChildren = (s) => {
            s.children.sort((a, b) => a.startTime - b.startTime).forEach(sortChildren);
        };
        roots.forEach(sortChildren);
        return roots;
    }
};
exports.ObservabilityLogService = ObservabilityLogService;
exports.ObservabilityLogService = ObservabilityLogService = __decorate([
    (0, decorators_1.Service)({ forEntity: 'observabilityLog' }),
    __param(0, (0, di_1.InjectConfig)('observability.dynamodb.tableKey')),
    __param(1, (0, di_1.InjectConfig)('observability.dynamodb.ttlDays')),
    __param(2, (0, di_1.InjectEntitySchema)('observabilityLog')),
    __param(3, (0, di_1.InjectContainer)())
], ObservabilityLogService);
function toRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function toNumberRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return {};
    const result = {};
    for (const [k, v] of Object.entries(value))
        if (typeof v === 'number')
            result[k] = v;
    return result;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VydmljZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L3N0b3JhZ2Uvc2VydmljZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7O0dBS0c7Ozs7Ozs7Ozs7OztBQUVILDhEQUEwRDtBQUMxRCx3REFBK0Q7QUFDL0QsaURBQTJDO0FBQzNDLGlDQUEwRjtBQUMxRiw0REFBOEQ7QUFJOUQseUVBQWtHO0FBRWxHLHlDQUFxRDtBQXVCckQsaUVBQWlFO0FBQ2pFLGdCQUFXLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQztJQUN4QixJQUFJLEVBQUUsUUFBUTtJQUNkLE9BQU8sRUFBRSx3QkFBd0I7SUFDakMsU0FBUyxFQUFFLGtCQUFrQjtJQUM3QixRQUFRLEVBQUUsdURBQTRCO0NBQ3ZDLENBQUMsQ0FBQztBQUVIOzs7Ozs7R0FNRztBQUVJLElBQU0sdUJBQXVCLEdBQTdCLE1BQU0sdUJBQXdCLFNBQVEsZ0NBQXlDO0lBSXpFO0lBR0E7SUFHQTtJQUdBO0lBWFgsWUFFVyxRQUFnQixFQUdoQixPQUFlLEVBR2YsTUFBOEIsRUFHOUIsU0FBdUI7UUFFaEMsTUFBTSxNQUFNLEdBQUcsSUFBSSxnQ0FBYyxDQUFDLEVBQUUsQ0FBQyxDQUFDO1FBQ3RDLE1BQU0sU0FBUyxHQUFHLHFDQUFzQixDQUFDLElBQUksQ0FBQyxNQUFNLEVBQUU7WUFDcEQsZUFBZSxFQUFFLEVBQUUscUJBQXFCLEVBQUUsSUFBSSxFQUFFLGtCQUFrQixFQUFFLElBQUksRUFBRTtTQUMzRSxDQUFDLENBQUM7UUFFSCxnRUFBZ0U7UUFDaEUsNERBQTREO1FBQzVELE1BQU0sU0FBUyxHQUFHLElBQUEsd0JBQWtCLEVBQUMsRUFBRSxHQUFHLEVBQUUsUUFBUSxFQUFFLE1BQU0sRUFBRSxPQUFPLEVBQUUsWUFBWSxFQUFFLFFBQVEsRUFBRSxDQUFDLENBQUM7UUFFakcsS0FBSyxDQUFDLE1BQU0sRUFBRTtZQUNaLEtBQUss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LENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIE9ic2VydmFiaWxpdHlMb2dTZXJ2aWNlIC0gU2VydmljZSBmb3Igb2JzZXJ2YWJpbGl0eSBkYXRhIHN0b3JhZ2VcbiAqIFxuICogUmVnaXN0ZXJlZCB2aWEgREkgd2l0aCBAU2VydmljZSBkZWNvcmF0b3IuXG4gKiBDb25maWcgaW5qZWN0ZWQgdmlhIEBJbmplY3RDb25maWcuXG4gKi9cblxuaW1wb3J0IHsgRHluYW1vREJDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInO1xuaW1wb3J0IHsgRHluYW1vREJEb2N1bWVudENsaWVudCB9IGZyb20gJ0Bhd3Mtc2RrL2xpYi1keW5hbW9kYic7XG5pbXBvcnQgeyBTZXJ2aWNlIH0gZnJvbSAnLi4vLi4vZGVjb3JhdG9ycyc7XG5pbXBvcnQgeyBESUNvbnRhaW5lciwgSW5qZWN0Q29uZmlnLCBJbmplY3RDb250YWluZXIsIEluamVjdEVudGl0eVNjaGVtYSB9IGZyb20gJy4uLy4uL2RpJztcbmltcG9ydCB7IEJhc2VFbnRpdHlTZXJ2aWNlIH0gZnJvbSAnLi4vLi4vZW50aXR5L2Jhc2Utc2VydmljZSc7XG5pbXBvcnQgeyBFbnRpdHlRdWVyeSB9IGZyb20gJy4uLy4uL2VudGl0eS9xdWVyeS10eXBlcyc7XG5pbXBvcnQgeyBFbnRpdHlTZWFyY2hRdWVyeSB9IGZyb20gJy4uLy4uL3NlYXJjaC90eXBlcyc7XG5pbXBvcnQgeyBFeGVjdXRpb25Db250ZXh0IH0gZnJvbSAnLi4vLi4vY29yZS90eXBlcy9leGVjdXRpb24tY29udGV4dCc7XG5pbXBvcnQgeyBPYnNlcnZhYmlsaXR5TG9nRW50aXR5U2NoZW1hLCBPYnNlcnZhYmlsaXR5TG9nU2NoZW1hIH0gZnJvbSAnLi9vYnNlcnZhYmlsaXR5LWxvZy1lbnRpdHknO1xuaW1wb3J0IHsgQ3JlYXRlRW50aXR5SXRlbVR5cGVGcm9tU2NoZW1hLCBFbnRpdHlSZWNvcmRUeXBlRnJvbVNjaGVtYSB9IGZyb20gJy4uLy4uL2VudGl0eS9iYXNlLWVudGl0eSc7XG5pbXBvcnQgeyByZXNvbHZlRW52VmFsdWVGb3IgfSBmcm9tICcuLi8uLi91dGlscy9lbnYnO1xuaW1wb3J0IHsgSURJQ29udGFpbmVyIH0gZnJvbSAnLi4vLi4vaW50ZXJmYWNlcyc7XG5cbmV4cG9ydCB0eXBlIE9ic2VydmFiaWxpdHlMb2dDcmVhdGVJdGVtID0gQ3JlYXRlRW50aXR5SXRlbVR5cGVGcm9tU2NoZW1hPE9ic2VydmFiaWxpdHlMb2dTY2hlbWE+O1xuZXhwb3J0IHR5cGUgTG9nUmVjb3JkID0gRW50aXR5UmVjb3JkVHlwZUZyb21TY2hlbWE8T2JzZXJ2YWJpbGl0eUxvZ1NjaGVtYT47XG5cbi8qKiBSZWNvbnN0cnVjdGVkIHNwYW4gd2l0aCBoaWVyYXJjaHkgZm9yIHRyYWNlIHZpc3VhbGl6YXRpb24gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUmVjb25zdHJ1Y3RlZFNwYW4ge1xuICBzcGFuSWQ6IHN0cmluZztcbiAgdHJhY2VJZDogc3RyaW5nO1xuICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ/OiBzdHJpbmc7XG4gIG9wZXJhdGlvbjogc3RyaW5nO1xuICBzdGFydFRpbWU6IG51bWJlcjtcbiAgZW5kVGltZT86IG51bWJlcjtcbiAgZHVyYXRpb24/OiBudW1iZXI7XG4gIHN0YXR1cz86IHN0cmluZztcbiAgc3VjY2Vzcz86IGJvb2xlYW47XG4gIGF0dHJpYnV0ZXM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICBldmVudHM6IEFycmF5PHsgbmFtZTogc3RyaW5nOyB0aW1lc3RhbXA6IG51bWJlcjsgYXR0cmlidXRlczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfT47XG4gIG1ldHJpY3M6IFJlY29yZDxzdHJpbmcsIG51bWJlcj47XG4gIGNoaWxkcmVuOiBSZWNvbnN0cnVjdGVkU3BhbltdO1xufVxuXG4vLyBtYW51YWwgcmVnaXN0cmF0aW9uIG9mIHRoZSBzY2hlbWEgdG8gYXZvaWQgY2lyY3VsYXIgZGVwZW5kZW5jeVxuRElDb250YWluZXIuUk9PVC5yZWdpc3Rlcih7XG4gIHR5cGU6ICdzY2hlbWEnLFxuICBwcm92aWRlOiAnb2JzZXJ2YWJpbGl0eUxvZ1NjaGVtYScsXG4gIGZvckVudGl0eTogJ29ic2VydmFiaWxpdHlMb2cnLFxuICB1c2VWYWx1ZTogT2JzZXJ2YWJpbGl0eUxvZ0VudGl0eVNjaGVtYSxcbn0pO1xuXG4vKipcbiAqIE9ic2VydmFiaWxpdHlMb2dTZXJ2aWNlXG4gKiBcbiAqIERJLW1hbmFnZWQgc2VydmljZSBmb3Igb2JzZXJ2YWJpbGl0eSBsb2cgc3RvcmFnZS5cbiAqIHRhYmxlTmFtZSBhbmQgdHRsRGF5cyBpbmplY3RlZCB2aWEgQEluamVjdENvbmZpZy5cbiAqIFxuICovXG5AU2VydmljZSh7IGZvckVudGl0eTogJ29ic2VydmFiaWxpdHlMb2cnIH0pXG5leHBvcnQgY2xhc3MgT2JzZXJ2YWJpbGl0eUxvZ1NlcnZpY2UgZXh0ZW5kcyBCYXNlRW50aXR5U2VydmljZTxPYnNlcnZhYmlsaXR5TG9nU2NoZW1hPiB7XG5cbiAgY29uc3RydWN0b3IoXG4gICAgQEluamVjdENvbmZpZygnb2JzZXJ2YWJpbGl0eS5keW5hbW9kYi50YWJsZUtleScpXG4gICAgcmVhZG9ubHkgdGFibGVLZXk6IHN0cmluZyxcblxuICAgIEBJbmplY3RDb25maWcoJ29ic2VydmFiaWxpdHkuZHluYW1vZGIudHRsRGF5cycpXG4gICAgcmVhZG9ubHkgdHRsRGF5czogbnVtYmVyLFxuXG4gICAgQEluamVjdEVudGl0eVNjaGVtYSgnb2JzZXJ2YWJpbGl0eUxvZycpXG4gICAgcmVhZG9ubHkgc2NoZW1hOiBPYnNlcnZhYmlsaXR5TG9nU2NoZW1hLFxuXG4gICAgQEluamVjdENvbnRhaW5lcigpXG4gICAgcmVhZG9ubHkgY29udGFpbmVyOiBJRElDb250YWluZXJcbiAgKSB7XG4gICAgY29uc3QgY2xpZW50ID0gbmV3IER5bmFtb0RCQ2xpZW50KHt9KTtcbiAgICBjb25zdCBkb2NDbGllbnQgPSBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LmZyb20oY2xpZW50LCB7XG4gICAgICBtYXJzaGFsbE9wdGlvbnM6IHsgcmVtb3ZlVW5kZWZpbmVkVmFsdWVzOiB0cnVlLCBjb252ZXJ0RW1wdHlWYWx1ZXM6IHRydWUgfSxcbiAgICB9KTtcblxuICAgIC8vIFJlc29sdmUgYWN0dWFsIHRhYmxlIG5hbWUgZnJvbSBlbnYgdXNpbmcgZnJhbWV3b3JrIGNvbnZlbnRpb25cbiAgICAvLyBFbnYgdmFyOiB7dGFibGVLZXl9X3RhYmxlIChzcGVjaWFsIGNoYXJzIHJlcGxhY2VkIHdpdGggXylcbiAgICBjb25zdCB0YWJsZU5hbWUgPSByZXNvbHZlRW52VmFsdWVGb3IoeyBrZXk6IHRhYmxlS2V5LCBzdWZmaXg6ICd0YWJsZScsIGRlZmF1bHRWYWx1ZTogdGFibGVLZXkgfSk7XG5cbiAgICBzdXBlcihzY2hlbWEsIHtcbiAgICAgIHRhYmxlOiB0YWJsZU5hbWUsXG4gICAgICBjbGllbnQ6IGRvY0NsaWVudCxcbiAgICB9LCBjb250YWluZXIpO1xuICB9XG5cbiAgLyoqIEJhdGNoIGNyZWF0ZSAtIHVzZWQgYnkgRHluYW1vREIgYmFja2VuZCAqL1xuICBhc3luYyBiYXRjaENyZWF0ZShpdGVtczogT2JzZXJ2YWJpbGl0eUxvZ0NyZWF0ZUl0ZW1bXSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHJlcG8gPSB0aGlzLmdldFJlcG9zaXRvcnkoKTtcbiAgICBhd2FpdCByZXBvLnB1dChpdGVtcykuZ28oKTtcbiAgfVxuXG4gIC8qKiBPdmVycmlkZSBsaXN0IHRvIGRlZmF1bHQgdG8gZGVzYyBvcmRlciAobGF0ZXN0IGZpcnN0KSAqL1xuICBwdWJsaWMgYXN5bmMgbGlzdChxdWVyeTogRW50aXR5UXVlcnk8T2JzZXJ2YWJpbGl0eUxvZ1NjaGVtYT4gPSB7fSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCkge1xuICAgIHJldHVybiBzdXBlci5saXN0KHtcbiAgICAgIC4uLnF1ZXJ5LFxuICAgICAgcGFnaW5hdGlvbjogeyAuLi5xdWVyeS5wYWdpbmF0aW9uLCBvcmRlcjogcXVlcnkucGFnaW5hdGlvbj8ub3JkZXIgPz8gJ2Rlc2MnIH0sXG4gICAgfSwgY3R4KTtcbiAgfVxuXG4gIC8qKiBPdmVycmlkZSBzZWFyY2ggdG8gZGVmYXVsdCBzb3J0IGJ5IHRpbWVzdGFtcCBkZXNjICovXG4gIHB1YmxpYyBhc3luYyBzZWFyY2gocXVlcnk6IEVudGl0eVNlYXJjaFF1ZXJ5PE9ic2VydmFiaWxpdHlMb2dTY2hlbWE+LCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KSB7XG4gICAgcmV0dXJuIHN1cGVyLnNlYXJjaCh7XG4gICAgICAuLi5xdWVyeSxcbiAgICAgIHNvcnQ6IHF1ZXJ5LnNvcnQ/Lmxlbmd0aCA/IHF1ZXJ5LnNvcnQgOiBbIHsgZmllbGQ6ICd0aW1lc3RhbXBNcycgYXMgY29uc3QsIGRpcjogJ2Rlc2MnIGFzIGNvbnN0IH0gXSxcbiAgICB9LCBjdHgpO1xuICB9XG5cbiAgLyoqIEdldCB0cmFjZSB3aXRoIHJlY29uc3RydWN0ZWQgc3BhbiB0cmVlICovXG4gIGFzeW5jIGdldFRyYWNlV2l0aFNwYW5zKGNvcnJlbGF0aW9uSWQ6IHN0cmluZywgY3R4PzogRXhlY3V0aW9uQ29udGV4dCk6IFByb21pc2U8UmVjb25zdHJ1Y3RlZFNwYW5bXT4ge1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucXVlcnkoe1xuICAgICAgZmlsdGVyczogeyBjb3JyZWxhdGlvbklkOiB7IGVxOiBjb3JyZWxhdGlvbklkIH0gfSxcbiAgICAgIHBhZ2luYXRpb246IHsgb3JkZXI6ICdhc2MnIH0sXG4gICAgICBpbmRleDogeyBuYW1lOiAnYnlUcmFjZScgfSxcbiAgICB9LCBjdHgpO1xuICAgIHJldHVybiB0aGlzLnJlY29uc3RydWN0U3BhbnMoKHJlc3VsdC5kYXRhID8/IFtdKSBhcyBMb2dSZWNvcmRbXSk7XG4gIH1cblxuICAvKiogUmVjb25zdHJ1Y3Qgc3BhbiBoaWVyYXJjaHkgZnJvbSBmbGF0IGxvZyByZWNvcmRzICovXG4gIHJlY29uc3RydWN0U3BhbnMocmVjb3JkczogUmVhZG9ubHlBcnJheTxMb2dSZWNvcmQ+KTogUmVjb25zdHJ1Y3RlZFNwYW5bXSB7XG4gICAgY29uc3Qgc3Bhbk1hcCA9IG5ldyBNYXA8c3RyaW5nLCBSZWNvbnN0cnVjdGVkU3Bhbj4oKTtcbiAgICBjb25zdCBncm91cGVkID0gbmV3IE1hcDxzdHJpbmcsIExvZ1JlY29yZFtdPigpO1xuXG4gICAgZm9yIChjb25zdCByZWNvcmQgb2YgcmVjb3Jkcykge1xuICAgICAgLy8gRmlsdGVyIGJ5IHR5cGUgKHNwYW4uc3RhcnQsIHNwYW4uZW5kLCBzcGFuLmV2ZW50KSBhbmQgZ3JvdXAgYnkgZW50aXR5SWQgKHNwYW5JZClcbiAgICAgIGlmICghcmVjb3JkLnR5cGU/LnN0YXJ0c1dpdGgoJ3NwYW4uJykpIGNvbnRpbnVlO1xuICAgICAgY29uc3QgaWQgPSBTdHJpbmcocmVjb3JkLmVudGl0eUlkKTtcbiAgICAgIChncm91cGVkLmdldChpZCkgPz8gZ3JvdXBlZC5zZXQoaWQsIFtdKS5nZXQoaWQpISkucHVzaChyZWNvcmQpO1xuICAgIH1cblxuICAgIGZvciAoY29uc3QgWyBzcGFuSWQsIHNwYW5SZWNvcmRzIF0gb2YgZ3JvdXBlZCkge1xuICAgICAgY29uc3Qgc3RhcnQgPSBzcGFuUmVjb3Jkcy5maW5kKHIgPT4gci50eXBlID09PSAnc3Bhbi5zdGFydCcpO1xuICAgICAgY29uc3QgZW5kID0gc3BhblJlY29yZHMuZmluZChyID0+IHIudHlwZSA9PT0gJ3NwYW4uZW5kJyk7XG4gICAgICBpZiAoIXN0YXJ0KSBjb250aW51ZTtcblxuICAgICAgc3Bhbk1hcC5zZXQoc3BhbklkLCB7XG4gICAgICAgIHNwYW5JZCxcbiAgICAgICAgdHJhY2VJZDogU3RyaW5nKHN0YXJ0LmNvcnJlbGF0aW9uSWQgPz8gJycpLFxuICAgICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHN0YXJ0LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCA/IFN0cmluZyhzdGFydC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQpIDogdW5kZWZpbmVkLFxuICAgICAgICBvcGVyYXRpb246IFN0cmluZyhzdGFydC5vcGVyYXRpb24gPz8gJ3Vua25vd24nKSxcbiAgICAgICAgc3RhcnRUaW1lOiBOdW1iZXIoc3RhcnQudGltZXN0YW1wTXMgPz8gMCksXG4gICAgICAgIGVuZFRpbWU6IGVuZD8udGltZXN0YW1wTXMgPyBOdW1iZXIoZW5kLnRpbWVzdGFtcE1zKSA6IHVuZGVmaW5lZCxcbiAgICAgICAgZHVyYXRpb246IGVuZD8uZHVyYXRpb25NcyA/IE51bWJlcihlbmQuZHVyYXRpb25NcykgOiB1bmRlZmluZWQsXG4gICAgICAgIHN0YXR1czogZW5kPy5zdGF0dXMgPyBTdHJpbmcoZW5kLnN0YXR1cykgOiB1bmRlZmluZWQsXG4gICAgICAgIHN1Y2Nlc3M6IHR5cGVvZiBlbmQ/LnN1Y2Nlc3MgPT09ICdib29sZWFuJyA/IGVuZC5zdWNjZXNzIDogdW5kZWZpbmVkLFxuICAgICAgICBhdHRyaWJ1dGVzOiB7IC4uLnRvUmVjb3JkKHN0YXJ0LmRhdGEpLCAuLi50b1JlY29yZChlbmQ/LmRhdGEpIH0sXG4gICAgICAgIGV2ZW50czogc3BhblJlY29yZHMuZmlsdGVyKHIgPT4gci50eXBlID09PSAnc3Bhbi5ldmVudCcpLm1hcChlID0+ICh7XG4gICAgICAgICAgbmFtZTogU3RyaW5nKGUub3BlcmF0aW9uID8/ICdldmVudCcpLFxuICAgICAgICAgIHRpbWVzdGFtcDogTnVtYmVyKGUudGltZXN0YW1wTXMgPz8gMCksXG4gICAgICAgICAgYXR0cmlidXRlczogdG9SZWNvcmQoZS5kYXRhKSxcbiAgICAgICAgfSkpLFxuICAgICAgICBtZXRyaWNzOiB0b051bWJlclJlY29yZChlbmQ/Lm1ldHJpY3MpLFxuICAgICAgICBjaGlsZHJlbjogW10sXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBjb25zdCByb290czogUmVjb25zdHJ1Y3RlZFNwYW5bXSA9IFtdO1xuICAgIGZvciAoY29uc3Qgc3BhbiBvZiBzcGFuTWFwLnZhbHVlcygpKSB7XG4gICAgICBjb25zdCBwYXJlbnQgPSBzcGFuLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCAmJiBzcGFuTWFwLmdldChzcGFuLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCk7XG4gICAgICBwYXJlbnQgPyBwYXJlbnQuY2hpbGRyZW4ucHVzaChzcGFuKSA6IHJvb3RzLnB1c2goc3Bhbik7XG4gICAgfVxuXG4gICAgY29uc3Qgc29ydENoaWxkcmVuID0gKHM6IFJlY29uc3RydWN0ZWRTcGFuKTogdm9pZCA9PiB7XG4gICAgICBzLmNoaWxkcmVuLnNvcnQoKGEsIGIpID0+IGEuc3RhcnRUaW1lIC0gYi5zdGFydFRpbWUpLmZvckVhY2goc29ydENoaWxkcmVuKTtcbiAgICB9O1xuICAgIHJvb3RzLmZvckVhY2goc29ydENoaWxkcmVuKTtcblxuICAgIHJldHVybiByb290cztcbiAgfVxufVxuXG5mdW5jdGlvbiB0b1JlY29yZCh2YWx1ZTogdW5rbm93bik6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHtcbiAgcmV0dXJuIHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiYgIUFycmF5LmlzQXJyYXkodmFsdWUpID8gdmFsdWUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4gOiB7fTtcbn1cblxuZnVuY3Rpb24gdG9OdW1iZXJSZWNvcmQodmFsdWU6IHVua25vd24pOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+IHtcbiAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09ICdvYmplY3QnIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSByZXR1cm4ge307XG4gIGNvbnN0IHJlc3VsdDogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHt9O1xuICBmb3IgKGNvbnN0IFsgaywgdiBdIG9mIE9iamVjdC5lbnRyaWVzKHZhbHVlKSkgaWYgKHR5cGVvZiB2ID09PSAnbnVtYmVyJykgcmVzdWx0WyBrIF0gPSB2O1xuICByZXR1cm4gcmVzdWx0O1xufVxuIl19