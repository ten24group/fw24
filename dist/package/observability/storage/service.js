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
const user_agent_1 = require("../../client/user-agent");
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
        const client = new client_dynamodb_1.DynamoDBClient({ userAgentAppId: user_agent_1.FW24_UA_APP_ID });
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
    /**
     * Batch create - used by DynamoDB backend
     * Auto-compresses fields marked with `compressed: true` in entity schema
     */
    async batchCreate(items) {
        const compressedItems = items.map(item => this.compressFields(item));
        const repo = this.getRepository();
        await repo.put(compressedItems).go();
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
    /**
     * Reconstruct span hierarchy from flat log records.
     * FW24 supports consolidated span records only (type='span').
     * No compatibility is provided for legacy span.* record formats.
     */
    reconstructSpans(records) {
        const spanMap = new Map();
        for (const record of records) {
            // Handle consolidated spans (type='span')
            if (record.type === 'span') {
                const spanId = String(record.observabilityLogId ?? record.entityId);
                const data = toRecord(record.data);
                const checkpointsRaw = data.checkpoints;
                const checkpoints = Array.isArray(checkpointsRaw)
                    ? checkpointsRaw.filter((c) => !!c && typeof c === 'object' && !Array.isArray(c))
                    : [];
                spanMap.set(spanId, {
                    spanId,
                    traceId: String(record.correlationId ?? ''),
                    parentObservabilityLogId: record.parentObservabilityLogId ? String(record.parentObservabilityLogId) : undefined,
                    operation: String(record.operation ?? 'unknown'),
                    // Consolidated spans store timestampMs as START time (for timeline ordering).
                    // Reconstruct endTime using durationMs when available.
                    startTime: Number(record.timestampMs ?? 0),
                    endTime: (record.durationMs && record.timestampMs)
                        ? Number(record.timestampMs) + Number(record.durationMs)
                        : Number(record.timestampMs ?? 0),
                    duration: record.durationMs ? Number(record.durationMs) : undefined,
                    status: record.status ? String(record.status) : undefined,
                    success: typeof record.success === 'boolean' ? record.success : undefined,
                    attributes: { ...toRecord(record.attributes), ...data },
                    // Derive timeline events from checkpoints (canonical format).
                    events: checkpoints.map((cp) => {
                        const name = typeof cp.name === 'string' ? cp.name : 'checkpoint';
                        const ts = typeof cp.ts === 'number' ? cp.ts : 0;
                        const attrs = {};
                        if (cp.tags && typeof cp.tags === 'object')
                            attrs.tags = cp.tags;
                        if (cp.metrics && typeof cp.metrics === 'object')
                            attrs.metrics = cp.metrics;
                        if (cp.data && typeof cp.data === 'object')
                            attrs.data = cp.data;
                        if (cp.error && typeof cp.error === 'object')
                            attrs.error = cp.error;
                        return { name, timestamp: ts, attributes: attrs };
                    }),
                    metrics: toNumberRecord(record.metrics),
                    children: [],
                });
                continue;
            }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VydmljZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L3N0b3JhZ2Uvc2VydmljZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7O0dBS0c7Ozs7Ozs7Ozs7OztBQUVILDhEQUEwRDtBQUMxRCx3REFBK0Q7QUFDL0Qsd0RBQXlEO0FBQ3pELGlEQUEyQztBQUMzQyxpQ0FBMEY7QUFDMUYsNERBQThEO0FBSTlELHlFQUFrRztBQUVsRyx5Q0FBcUQ7QUF1QnJELGlFQUFpRTtBQUNqRSxnQkFBVyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUM7SUFDeEIsSUFBSSxFQUFFLFFBQVE7SUFDZCxPQUFPLEVBQUUsd0JBQXdCO0lBQ2pDLFNBQVMsRUFBRSxrQkFBa0I7SUFDN0IsUUFBUSxFQUFFLHVEQUE0QjtDQUN2QyxDQUFDLENBQUM7QUFFSDs7Ozs7O0dBTUc7QUFFSSxJQUFNLHVCQUF1QixHQUE3QixNQUFNLHVCQUF3QixTQUFRLGdDQUF5QztJQUl6RTtJQUdBO0lBR0E7SUFHQTtJQVhYLFlBRVcsUUFBZ0IsRUFHaEIsT0FBZSxFQUdmLE1BQThCLEVBRzlCLFNBQXVCO1FBRWhDLE1BQU0sTUFBTSxHQUFHLElBQUksZ0NBQWMsQ0FBQyxFQUFFLGNBQWMsRUFBRSwyQkFBYyxFQUFFLENBQUMsQ0FBQztRQUN0RSxNQUFNLFNBQVMsR0FBRyxxQ0FBc0IsQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFFO1lBQ3BELGVBQWUsRUFBRSxFQUFFLHFCQUFxQixFQUFFLElBQUksRUFBRSxrQkFBa0IsRUFBRSxJQUFJLEVBQUU7U0FDM0UsQ0FBQyxDQUFDO1FBRUgsZ0VBQWdFO1FBQ2hFLDREQUE0RDtRQUM1RCxNQUFNLFNBQVMsR0FBRyxJQUFBLHdCQUFrQixFQUFDLEVBQUUsR0FBRyxFQUFFLFFBQVEsRUFBRSxNQUFNLEVBQUUsT0FBTyxFQUFFLFlBQVksRUFBRSxRQUFRLEVBQUUsQ0FBQyxDQUFDO1FB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QUFDLENBQUE7SUFHL0MsV0FBQSxJQUFBLGlCQUFZLEVBQUMsZ0NBQWdDLENBQUMsQ0FBQTtJQUc5QyxXQUFBLElBQUEsdUJBQWtCLEVBQUMsa0JBQWtCLENBQUMsQ0FBQTtJQUd0QyxXQUFBLElBQUEsb0JBQWUsR0FBRSxDQUFBO0dBWlQsdUJBQXVCLENBa0luQztBQUVELFNBQVMsUUFBUSxDQUFDLEtBQWM7SUFDOUIsT0FBTyxLQUFLLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUSxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBZ0MsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO0FBQzdHLENBQUM7QUFFRCxTQUFTLGNBQWMsQ0FBQyxLQUFjO0lBQ3BDLElBQUksQ0FBQyxLQUFLLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUSxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDO1FBQUUsT0FBTyxFQUFFLENBQUM7SUFDM0UsTUFBTSxNQUFNLEdBQTJCLEVBQUUsQ0FBQztJQUMxQyxLQUFLLE1BQU0sQ0FBRSxDQUFDLEVBQUUsQ0FBQyxDQUFFLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUM7UUFBRSxJQUFJLE9BQU8sQ0FBQyxLQUFLLFFBQVE7WUFBRSxNQUFNLENBQUUsQ0FBQyxDQUFFLEdBQUcsQ0FBQyxDQUFDO0lBQ3pGLE9BQU8sTUFBTSxDQUFDO0FBQ2hCLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIE9ic2VydmFiaWxpdHlMb2dTZXJ2aWNlIC0gU2VydmljZSBmb3Igb2JzZXJ2YWJpbGl0eSBkYXRhIHN0b3JhZ2VcbiAqIFxuICogUmVnaXN0ZXJlZCB2aWEgREkgd2l0aCBAU2VydmljZSBkZWNvcmF0b3IuXG4gKiBDb25maWcgaW5qZWN0ZWQgdmlhIEBJbmplY3RDb25maWcuXG4gKi9cblxuaW1wb3J0IHsgRHluYW1vREJDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInO1xuaW1wb3J0IHsgRHluYW1vREJEb2N1bWVudENsaWVudCB9IGZyb20gJ0Bhd3Mtc2RrL2xpYi1keW5hbW9kYic7XG5pbXBvcnQgeyBGVzI0X1VBX0FQUF9JRCB9IGZyb20gJy4uLy4uL2NsaWVudC91c2VyLWFnZW50JztcbmltcG9ydCB7IFNlcnZpY2UgfSBmcm9tICcuLi8uLi9kZWNvcmF0b3JzJztcbmltcG9ydCB7IERJQ29udGFpbmVyLCBJbmplY3RDb25maWcsIEluamVjdENvbnRhaW5lciwgSW5qZWN0RW50aXR5U2NoZW1hIH0gZnJvbSAnLi4vLi4vZGknO1xuaW1wb3J0IHsgQmFzZUVudGl0eVNlcnZpY2UgfSBmcm9tICcuLi8uLi9lbnRpdHkvYmFzZS1zZXJ2aWNlJztcbmltcG9ydCB7IEVudGl0eVF1ZXJ5IH0gZnJvbSAnLi4vLi4vZW50aXR5L3F1ZXJ5LXR5cGVzJztcbmltcG9ydCB7IEVudGl0eVNlYXJjaFF1ZXJ5IH0gZnJvbSAnLi4vLi4vc2VhcmNoL3R5cGVzJztcbmltcG9ydCB7IEV4ZWN1dGlvbkNvbnRleHQgfSBmcm9tICcuLi8uLi9jb3JlL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0JztcbmltcG9ydCB7IE9ic2VydmFiaWxpdHlMb2dFbnRpdHlTY2hlbWEsIE9ic2VydmFiaWxpdHlMb2dTY2hlbWEgfSBmcm9tICcuL29ic2VydmFiaWxpdHktbG9nLWVudGl0eSc7XG5pbXBvcnQgeyBDcmVhdGVFbnRpdHlJdGVtVHlwZUZyb21TY2hlbWEsIEVudGl0eVJlY29yZFR5cGVGcm9tU2NoZW1hIH0gZnJvbSAnLi4vLi4vZW50aXR5L2Jhc2UtZW50aXR5JztcbmltcG9ydCB7IHJlc29sdmVFbnZWYWx1ZUZvciB9IGZyb20gJy4uLy4uL3V0aWxzL2Vudic7XG5pbXBvcnQgeyBJRElDb250YWluZXIgfSBmcm9tICcuLi8uLi9pbnRlcmZhY2VzJztcblxuZXhwb3J0IHR5cGUgT2JzZXJ2YWJpbGl0eUxvZ0NyZWF0ZUl0ZW0gPSBDcmVhdGVFbnRpdHlJdGVtVHlwZUZyb21TY2hlbWE8T2JzZXJ2YWJpbGl0eUxvZ1NjaGVtYT47XG5leHBvcnQgdHlwZSBMb2dSZWNvcmQgPSBFbnRpdHlSZWNvcmRUeXBlRnJvbVNjaGVtYTxPYnNlcnZhYmlsaXR5TG9nU2NoZW1hPjtcblxuLyoqIFJlY29uc3RydWN0ZWQgc3BhbiB3aXRoIGhpZXJhcmNoeSBmb3IgdHJhY2UgdmlzdWFsaXphdGlvbiAqL1xuZXhwb3J0IGludGVyZmFjZSBSZWNvbnN0cnVjdGVkU3BhbiB7XG4gIHNwYW5JZDogc3RyaW5nO1xuICB0cmFjZUlkOiBzdHJpbmc7XG4gIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZD86IHN0cmluZztcbiAgb3BlcmF0aW9uOiBzdHJpbmc7XG4gIHN0YXJ0VGltZTogbnVtYmVyO1xuICBlbmRUaW1lPzogbnVtYmVyO1xuICBkdXJhdGlvbj86IG51bWJlcjtcbiAgc3RhdHVzPzogc3RyaW5nO1xuICBzdWNjZXNzPzogYm9vbGVhbjtcbiAgYXR0cmlidXRlczogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIGV2ZW50czogQXJyYXk8eyBuYW1lOiBzdHJpbmc7IHRpbWVzdGFtcDogbnVtYmVyOyBhdHRyaWJ1dGVzOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB9PjtcbiAgbWV0cmljczogUmVjb3JkPHN0cmluZywgbnVtYmVyPjtcbiAgY2hpbGRyZW46IFJlY29uc3RydWN0ZWRTcGFuW107XG59XG5cbi8vIG1hbnVhbCByZWdpc3RyYXRpb24gb2YgdGhlIHNjaGVtYSB0byBhdm9pZCBjaXJjdWxhciBkZXBlbmRlbmN5XG5ESUNvbnRhaW5lci5ST09ULnJlZ2lzdGVyKHtcbiAgdHlwZTogJ3NjaGVtYScsXG4gIHByb3ZpZGU6ICdvYnNlcnZhYmlsaXR5TG9nU2NoZW1hJyxcbiAgZm9yRW50aXR5OiAnb2JzZXJ2YWJpbGl0eUxvZycsXG4gIHVzZVZhbHVlOiBPYnNlcnZhYmlsaXR5TG9nRW50aXR5U2NoZW1hLFxufSk7XG5cbi8qKlxuICogT2JzZXJ2YWJpbGl0eUxvZ1NlcnZpY2VcbiAqIFxuICogREktbWFuYWdlZCBzZXJ2aWNlIGZvciBvYnNlcnZhYmlsaXR5IGxvZyBzdG9yYWdlLlxuICogdGFibGVOYW1lIGFuZCB0dGxEYXlzIGluamVjdGVkIHZpYSBASW5qZWN0Q29uZmlnLlxuICogXG4gKi9cbkBTZXJ2aWNlKHsgZm9yRW50aXR5OiAnb2JzZXJ2YWJpbGl0eUxvZycgfSlcbmV4cG9ydCBjbGFzcyBPYnNlcnZhYmlsaXR5TG9nU2VydmljZSBleHRlbmRzIEJhc2VFbnRpdHlTZXJ2aWNlPE9ic2VydmFiaWxpdHlMb2dTY2hlbWE+IHtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBASW5qZWN0Q29uZmlnKCdvYnNlcnZhYmlsaXR5LmR5bmFtb2RiLnRhYmxlS2V5JylcbiAgICByZWFkb25seSB0YWJsZUtleTogc3RyaW5nLFxuXG4gICAgQEluamVjdENvbmZpZygnb2JzZXJ2YWJpbGl0eS5keW5hbW9kYi50dGxEYXlzJylcbiAgICByZWFkb25seSB0dGxEYXlzOiBudW1iZXIsXG5cbiAgICBASW5qZWN0RW50aXR5U2NoZW1hKCdvYnNlcnZhYmlsaXR5TG9nJylcbiAgICByZWFkb25seSBzY2hlbWE6IE9ic2VydmFiaWxpdHlMb2dTY2hlbWEsXG5cbiAgICBASW5qZWN0Q29udGFpbmVyKClcbiAgICByZWFkb25seSBjb250YWluZXI6IElESUNvbnRhaW5lclxuICApIHtcbiAgICBjb25zdCBjbGllbnQgPSBuZXcgRHluYW1vREJDbGllbnQoeyB1c2VyQWdlbnRBcHBJZDogRlcyNF9VQV9BUFBfSUQgfSk7XG4gICAgY29uc3QgZG9jQ2xpZW50ID0gRHluYW1vREJEb2N1bWVudENsaWVudC5mcm9tKGNsaWVudCwge1xuICAgICAgbWFyc2hhbGxPcHRpb25zOiB7IHJlbW92ZVVuZGVmaW5lZFZhbHVlczogdHJ1ZSwgY29udmVydEVtcHR5VmFsdWVzOiB0cnVlIH0sXG4gICAgfSk7XG5cbiAgICAvLyBSZXNvbHZlIGFjdHVhbCB0YWJsZSBuYW1lIGZyb20gZW52IHVzaW5nIGZyYW1ld29yayBjb252ZW50aW9uXG4gICAgLy8gRW52IHZhcjoge3RhYmxlS2V5fV90YWJsZSAoc3BlY2lhbCBjaGFycyByZXBsYWNlZCB3aXRoIF8pXG4gICAgY29uc3QgdGFibGVOYW1lID0gcmVzb2x2ZUVudlZhbHVlRm9yKHsga2V5OiB0YWJsZUtleSwgc3VmZml4OiAndGFibGUnLCBkZWZhdWx0VmFsdWU6IHRhYmxlS2V5IH0pO1xuXG4gICAgc3VwZXIoc2NoZW1hLCB7XG4gICAgICB0YWJsZTogdGFibGVOYW1lLFxuICAgICAgY2xpZW50OiBkb2NDbGllbnQsXG4gICAgfSwgY29udGFpbmVyKTtcbiAgfVxuXG4gIC8qKiBcbiAgICogQmF0Y2ggY3JlYXRlIC0gdXNlZCBieSBEeW5hbW9EQiBiYWNrZW5kXG4gICAqIEF1dG8tY29tcHJlc3NlcyBmaWVsZHMgbWFya2VkIHdpdGggYGNvbXByZXNzZWQ6IHRydWVgIGluIGVudGl0eSBzY2hlbWFcbiAgICovXG4gIGFzeW5jIGJhdGNoQ3JlYXRlKGl0ZW1zOiBPYnNlcnZhYmlsaXR5TG9nQ3JlYXRlSXRlbVtdKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgY29tcHJlc3NlZEl0ZW1zID0gaXRlbXMubWFwKGl0ZW0gPT4gdGhpcy5jb21wcmVzc0ZpZWxkcyhpdGVtKSk7XG4gICAgY29uc3QgcmVwbyA9IHRoaXMuZ2V0UmVwb3NpdG9yeSgpO1xuICAgIGF3YWl0IHJlcG8ucHV0KGNvbXByZXNzZWRJdGVtcykuZ28oKTtcbiAgfVxuXG4gIC8qKiBPdmVycmlkZSBsaXN0IHRvIGRlZmF1bHQgdG8gZGVzYyBvcmRlciAobGF0ZXN0IGZpcnN0KSAqL1xuICBwdWJsaWMgYXN5bmMgbGlzdChxdWVyeTogRW50aXR5UXVlcnk8T2JzZXJ2YWJpbGl0eUxvZ1NjaGVtYT4gPSB7fSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCkge1xuICAgIHJldHVybiBzdXBlci5saXN0KHtcbiAgICAgIC4uLnF1ZXJ5LFxuICAgICAgcGFnaW5hdGlvbjogeyAuLi5xdWVyeS5wYWdpbmF0aW9uLCBvcmRlcjogcXVlcnkucGFnaW5hdGlvbj8ub3JkZXIgPz8gJ2Rlc2MnIH0sXG4gICAgfSwgY3R4KTtcbiAgfVxuXG4gIC8qKiBPdmVycmlkZSBzZWFyY2ggdG8gZGVmYXVsdCBzb3J0IGJ5IHRpbWVzdGFtcCBkZXNjICovXG4gIHB1YmxpYyBhc3luYyBzZWFyY2gocXVlcnk6IEVudGl0eVNlYXJjaFF1ZXJ5PE9ic2VydmFiaWxpdHlMb2dTY2hlbWE+LCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KSB7XG4gICAgcmV0dXJuIHN1cGVyLnNlYXJjaCh7XG4gICAgICAuLi5xdWVyeSxcbiAgICAgIHNvcnQ6IHF1ZXJ5LnNvcnQ/Lmxlbmd0aCA/IHF1ZXJ5LnNvcnQgOiBbIHsgZmllbGQ6ICd0aW1lc3RhbXBNcycgYXMgY29uc3QsIGRpcjogJ2Rlc2MnIGFzIGNvbnN0IH0gXSxcbiAgICB9LCBjdHgpO1xuICB9XG5cbiAgLyoqIEdldCB0cmFjZSB3aXRoIHJlY29uc3RydWN0ZWQgc3BhbiB0cmVlICovXG4gIGFzeW5jIGdldFRyYWNlV2l0aFNwYW5zKGNvcnJlbGF0aW9uSWQ6IHN0cmluZywgY3R4PzogRXhlY3V0aW9uQ29udGV4dCk6IFByb21pc2U8UmVjb25zdHJ1Y3RlZFNwYW5bXT4ge1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucXVlcnkoe1xuICAgICAgZmlsdGVyczogeyBjb3JyZWxhdGlvbklkOiB7IGVxOiBjb3JyZWxhdGlvbklkIH0gfSxcbiAgICAgIHBhZ2luYXRpb246IHsgb3JkZXI6ICdhc2MnIH0sXG4gICAgICBpbmRleDogeyBuYW1lOiAnYnlUcmFjZScgfSxcbiAgICB9LCBjdHgpO1xuICAgIHJldHVybiB0aGlzLnJlY29uc3RydWN0U3BhbnMoKHJlc3VsdC5kYXRhID8/IFtdKSBhcyBMb2dSZWNvcmRbXSk7XG4gIH1cblxuICAvKiogXG4gICAqIFJlY29uc3RydWN0IHNwYW4gaGllcmFyY2h5IGZyb20gZmxhdCBsb2cgcmVjb3Jkcy5cbiAgICogRlcyNCBzdXBwb3J0cyBjb25zb2xpZGF0ZWQgc3BhbiByZWNvcmRzIG9ubHkgKHR5cGU9J3NwYW4nKS5cbiAgICogTm8gY29tcGF0aWJpbGl0eSBpcyBwcm92aWRlZCBmb3IgbGVnYWN5IHNwYW4uKiByZWNvcmQgZm9ybWF0cy5cbiAgICovXG4gIHJlY29uc3RydWN0U3BhbnMocmVjb3JkczogUmVhZG9ubHlBcnJheTxMb2dSZWNvcmQ+KTogUmVjb25zdHJ1Y3RlZFNwYW5bXSB7XG4gICAgY29uc3Qgc3Bhbk1hcCA9IG5ldyBNYXA8c3RyaW5nLCBSZWNvbnN0cnVjdGVkU3Bhbj4oKTtcblxuICAgIGZvciAoY29uc3QgcmVjb3JkIG9mIHJlY29yZHMpIHtcbiAgICAgIC8vIEhhbmRsZSBjb25zb2xpZGF0ZWQgc3BhbnMgKHR5cGU9J3NwYW4nKVxuICAgICAgaWYgKHJlY29yZC50eXBlID09PSAnc3BhbicpIHtcbiAgICAgICAgY29uc3Qgc3BhbklkID0gU3RyaW5nKHJlY29yZC5vYnNlcnZhYmlsaXR5TG9nSWQgPz8gcmVjb3JkLmVudGl0eUlkKTtcbiAgICAgICAgY29uc3QgZGF0YSA9IHRvUmVjb3JkKHJlY29yZC5kYXRhKTtcbiAgICAgICAgY29uc3QgY2hlY2twb2ludHNSYXcgPSBkYXRhLmNoZWNrcG9pbnRzO1xuICAgICAgICBjb25zdCBjaGVja3BvaW50cyA9IEFycmF5LmlzQXJyYXkoY2hlY2twb2ludHNSYXcpXG4gICAgICAgICAgPyBjaGVja3BvaW50c1Jhdy5maWx0ZXIoKGMpOiBjIGlzIFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0+ICEhYyAmJiB0eXBlb2YgYyA9PT0gJ29iamVjdCcgJiYgIUFycmF5LmlzQXJyYXkoYykpXG4gICAgICAgICAgOiBbXTtcblxuICAgICAgICBzcGFuTWFwLnNldChzcGFuSWQsIHtcbiAgICAgICAgICBzcGFuSWQsXG4gICAgICAgICAgdHJhY2VJZDogU3RyaW5nKHJlY29yZC5jb3JyZWxhdGlvbklkID8/ICcnKSxcbiAgICAgICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHJlY29yZC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgPyBTdHJpbmcocmVjb3JkLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCkgOiB1bmRlZmluZWQsXG4gICAgICAgICAgb3BlcmF0aW9uOiBTdHJpbmcocmVjb3JkLm9wZXJhdGlvbiA/PyAndW5rbm93bicpLFxuICAgICAgICAgIC8vIENvbnNvbGlkYXRlZCBzcGFucyBzdG9yZSB0aW1lc3RhbXBNcyBhcyBTVEFSVCB0aW1lIChmb3IgdGltZWxpbmUgb3JkZXJpbmcpLlxuICAgICAgICAgIC8vIFJlY29uc3RydWN0IGVuZFRpbWUgdXNpbmcgZHVyYXRpb25NcyB3aGVuIGF2YWlsYWJsZS5cbiAgICAgICAgICBzdGFydFRpbWU6IE51bWJlcihyZWNvcmQudGltZXN0YW1wTXMgPz8gMCksXG4gICAgICAgICAgZW5kVGltZTogKHJlY29yZC5kdXJhdGlvbk1zICYmIHJlY29yZC50aW1lc3RhbXBNcylcbiAgICAgICAgICAgID8gTnVtYmVyKHJlY29yZC50aW1lc3RhbXBNcykgKyBOdW1iZXIocmVjb3JkLmR1cmF0aW9uTXMpXG4gICAgICAgICAgICA6IE51bWJlcihyZWNvcmQudGltZXN0YW1wTXMgPz8gMCksXG4gICAgICAgICAgZHVyYXRpb246IHJlY29yZC5kdXJhdGlvbk1zID8gTnVtYmVyKHJlY29yZC5kdXJhdGlvbk1zKSA6IHVuZGVmaW5lZCxcbiAgICAgICAgICBzdGF0dXM6IHJlY29yZC5zdGF0dXMgPyBTdHJpbmcocmVjb3JkLnN0YXR1cykgOiB1bmRlZmluZWQsXG4gICAgICAgICAgc3VjY2VzczogdHlwZW9mIHJlY29yZC5zdWNjZXNzID09PSAnYm9vbGVhbicgPyByZWNvcmQuc3VjY2VzcyA6IHVuZGVmaW5lZCxcbiAgICAgICAgICBhdHRyaWJ1dGVzOiB7IC4uLnRvUmVjb3JkKHJlY29yZC5hdHRyaWJ1dGVzKSwgLi4uZGF0YSB9LFxuICAgICAgICAgIC8vIERlcml2ZSB0aW1lbGluZSBldmVudHMgZnJvbSBjaGVja3BvaW50cyAoY2Fub25pY2FsIGZvcm1hdCkuXG4gICAgICAgICAgZXZlbnRzOiBjaGVja3BvaW50cy5tYXAoKGNwKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBuYW1lID0gdHlwZW9mIGNwLm5hbWUgPT09ICdzdHJpbmcnID8gY3AubmFtZSA6ICdjaGVja3BvaW50JztcbiAgICAgICAgICAgIGNvbnN0IHRzID0gdHlwZW9mIGNwLnRzID09PSAnbnVtYmVyJyA/IGNwLnRzIDogMDtcbiAgICAgICAgICAgIGNvbnN0IGF0dHJzOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHt9O1xuICAgICAgICAgICAgaWYgKGNwLnRhZ3MgJiYgdHlwZW9mIGNwLnRhZ3MgPT09ICdvYmplY3QnKSBhdHRycy50YWdzID0gY3AudGFncztcbiAgICAgICAgICAgIGlmIChjcC5tZXRyaWNzICYmIHR5cGVvZiBjcC5tZXRyaWNzID09PSAnb2JqZWN0JykgYXR0cnMubWV0cmljcyA9IGNwLm1ldHJpY3M7XG4gICAgICAgICAgICBpZiAoY3AuZGF0YSAmJiB0eXBlb2YgY3AuZGF0YSA9PT0gJ29iamVjdCcpIGF0dHJzLmRhdGEgPSBjcC5kYXRhO1xuICAgICAgICAgICAgaWYgKGNwLmVycm9yICYmIHR5cGVvZiBjcC5lcnJvciA9PT0gJ29iamVjdCcpIGF0dHJzLmVycm9yID0gY3AuZXJyb3I7XG4gICAgICAgICAgICByZXR1cm4geyBuYW1lLCB0aW1lc3RhbXA6IHRzLCBhdHRyaWJ1dGVzOiBhdHRycyB9O1xuICAgICAgICAgIH0pLFxuICAgICAgICAgIG1ldHJpY3M6IHRvTnVtYmVyUmVjb3JkKHJlY29yZC5tZXRyaWNzKSxcbiAgICAgICAgICBjaGlsZHJlbjogW10sXG4gICAgICAgIH0pO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCByb290czogUmVjb25zdHJ1Y3RlZFNwYW5bXSA9IFtdO1xuICAgIGZvciAoY29uc3Qgc3BhbiBvZiBzcGFuTWFwLnZhbHVlcygpKSB7XG4gICAgICBjb25zdCBwYXJlbnQgPSBzcGFuLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCAmJiBzcGFuTWFwLmdldChzcGFuLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCk7XG4gICAgICBwYXJlbnQgPyBwYXJlbnQuY2hpbGRyZW4ucHVzaChzcGFuKSA6IHJvb3RzLnB1c2goc3Bhbik7XG4gICAgfVxuXG4gICAgY29uc3Qgc29ydENoaWxkcmVuID0gKHM6IFJlY29uc3RydWN0ZWRTcGFuKTogdm9pZCA9PiB7XG4gICAgICBzLmNoaWxkcmVuLnNvcnQoKGEsIGIpID0+IGEuc3RhcnRUaW1lIC0gYi5zdGFydFRpbWUpLmZvckVhY2goc29ydENoaWxkcmVuKTtcbiAgICB9O1xuICAgIHJvb3RzLmZvckVhY2goc29ydENoaWxkcmVuKTtcblxuICAgIHJldHVybiByb290cztcbiAgfVxufVxuXG5mdW5jdGlvbiB0b1JlY29yZCh2YWx1ZTogdW5rbm93bik6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHtcbiAgcmV0dXJuIHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiYgIUFycmF5LmlzQXJyYXkodmFsdWUpID8gdmFsdWUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4gOiB7fTtcbn1cblxuZnVuY3Rpb24gdG9OdW1iZXJSZWNvcmQodmFsdWU6IHVua25vd24pOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+IHtcbiAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09ICdvYmplY3QnIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSByZXR1cm4ge307XG4gIGNvbnN0IHJlc3VsdDogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHt9O1xuICBmb3IgKGNvbnN0IFsgaywgdiBdIG9mIE9iamVjdC5lbnRyaWVzKHZhbHVlKSkgaWYgKHR5cGVvZiB2ID09PSAnbnVtYmVyJykgcmVzdWx0WyBrIF0gPSB2O1xuICByZXR1cm4gcmVzdWx0O1xufVxuIl19