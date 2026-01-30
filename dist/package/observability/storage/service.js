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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VydmljZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L3N0b3JhZ2Uvc2VydmljZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7O0dBS0c7Ozs7Ozs7Ozs7OztBQUVILDhEQUEwRDtBQUMxRCx3REFBK0Q7QUFDL0QsaURBQTJDO0FBQzNDLGlDQUEwRjtBQUMxRiw0REFBOEQ7QUFJOUQseUVBQWtHO0FBRWxHLHlDQUFxRDtBQXVCckQsaUVBQWlFO0FBQ2pFLGdCQUFXLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQztJQUN4QixJQUFJLEVBQUUsUUFBUTtJQUNkLE9BQU8sRUFBRSx3QkFBd0I7SUFDakMsU0FBUyxFQUFFLGtCQUFrQjtJQUM3QixRQUFRLEVBQUUsdURBQTRCO0NBQ3ZDLENBQUMsQ0FBQztBQUVIOzs7Ozs7R0FNRztBQUVJLElBQU0sdUJBQXVCLEdBQTdCLE1BQU0sdUJBQXdCLFNBQVEsZ0NBQXlDO0lBSXpFO0lBR0E7SUFHQTtJQUdBO0lBWFgsWUFFVyxRQUFnQixFQUdoQixPQUFlLEVBR2YsTUFBOEIsRUFHOUIsU0FBdUI7UUFFaEMsTUFBTSxNQUFNLEdBQUcsSUFBSSxnQ0FBYyxDQUFDLEVBQUUsQ0FBQyxDQUFDO1FBQ3RDLE1BQU0sU0FBUyxHQUFHLHFDQUFzQixDQUFDLElBQUksQ0FBQyxNQUFNLEVBQUU7WUFDcEQsZUFBZSxFQUFFLEVBQUUscUJBQXFCLEVBQUUsSUFBSSxFQUFFLGtCQUFrQixFQUFFLElBQUksRUFBRTtTQUMzRSxDQUFDLENBQUM7UUFFSCxnRUFBZ0U7UUFDaEUsNERBQTREO1FBQzVELE1BQU0sU0FBUyxHQUFHLElBQUEsd0JBQWtCLEVBQUMsRUFBRSxHQUFHLEVBQUUsUUFBUSxFQUFFLE1BQU0sRUFBRSxPQUFPLEVBQUUsWUFBWSxFQUFFLFFBQVEsRUFBRSxDQUFDLENBQUM7UUFFakcsS0FBSyxDQUFDLE1BQU0sRUFBRTtZQUNaLEtBQUss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QyxnQ0FBZ0MsQ0FBQyxDQUFBO0lBRzlDLFdBQUEsSUFBQSx1QkFBa0IsRUFBQyxrQkFBa0IsQ0FBQyxDQUFBO0lBR3RDLFdBQUEsSUFBQSxvQkFBZSxHQUFFLENBQUE7R0FaVCx1QkFBdUIsQ0FrSW5DO0FBRUQsU0FBUyxRQUFRLENBQUMsS0FBYztJQUM5QixPQUFPLEtBQUssSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFnQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7QUFDN0csQ0FBQztBQUVELFNBQVMsY0FBYyxDQUFDLEtBQWM7SUFDcEMsSUFBSSxDQUFDLEtBQUssSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUM7UUFBRSxPQUFPLEVBQUUsQ0FBQztJQUMzRSxNQUFNLE1BQU0sR0FBMkIsRUFBRSxDQUFDO0lBQzFDLEtBQUssTUFBTSxDQUFFLENBQUMsRUFBRSxDQUFDLENBQUUsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQztRQUFFLElBQUksT0FBTyxDQUFDLEtBQUssUUFBUTtZQUFFLE1BQU0sQ0FBRSxDQUFDLENBQUUsR0FBRyxDQUFDLENBQUM7SUFDekYsT0FBTyxNQUFNLENBQUM7QUFDaEIsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogT2JzZXJ2YWJpbGl0eUxvZ1NlcnZpY2UgLSBTZXJ2aWNlIGZvciBvYnNlcnZhYmlsaXR5IGRhdGEgc3RvcmFnZVxuICogXG4gKiBSZWdpc3RlcmVkIHZpYSBESSB3aXRoIEBTZXJ2aWNlIGRlY29yYXRvci5cbiAqIENvbmZpZyBpbmplY3RlZCB2aWEgQEluamVjdENvbmZpZy5cbiAqL1xuXG5pbXBvcnQgeyBEeW5hbW9EQkNsaWVudCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1keW5hbW9kYic7XG5pbXBvcnQgeyBEeW5hbW9EQkRvY3VtZW50Q2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvbGliLWR5bmFtb2RiJztcbmltcG9ydCB7IFNlcnZpY2UgfSBmcm9tICcuLi8uLi9kZWNvcmF0b3JzJztcbmltcG9ydCB7IERJQ29udGFpbmVyLCBJbmplY3RDb25maWcsIEluamVjdENvbnRhaW5lciwgSW5qZWN0RW50aXR5U2NoZW1hIH0gZnJvbSAnLi4vLi4vZGknO1xuaW1wb3J0IHsgQmFzZUVudGl0eVNlcnZpY2UgfSBmcm9tICcuLi8uLi9lbnRpdHkvYmFzZS1zZXJ2aWNlJztcbmltcG9ydCB7IEVudGl0eVF1ZXJ5IH0gZnJvbSAnLi4vLi4vZW50aXR5L3F1ZXJ5LXR5cGVzJztcbmltcG9ydCB7IEVudGl0eVNlYXJjaFF1ZXJ5IH0gZnJvbSAnLi4vLi4vc2VhcmNoL3R5cGVzJztcbmltcG9ydCB7IEV4ZWN1dGlvbkNvbnRleHQgfSBmcm9tICcuLi8uLi9jb3JlL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0JztcbmltcG9ydCB7IE9ic2VydmFiaWxpdHlMb2dFbnRpdHlTY2hlbWEsIE9ic2VydmFiaWxpdHlMb2dTY2hlbWEgfSBmcm9tICcuL29ic2VydmFiaWxpdHktbG9nLWVudGl0eSc7XG5pbXBvcnQgeyBDcmVhdGVFbnRpdHlJdGVtVHlwZUZyb21TY2hlbWEsIEVudGl0eVJlY29yZFR5cGVGcm9tU2NoZW1hIH0gZnJvbSAnLi4vLi4vZW50aXR5L2Jhc2UtZW50aXR5JztcbmltcG9ydCB7IHJlc29sdmVFbnZWYWx1ZUZvciB9IGZyb20gJy4uLy4uL3V0aWxzL2Vudic7XG5pbXBvcnQgeyBJRElDb250YWluZXIgfSBmcm9tICcuLi8uLi9pbnRlcmZhY2VzJztcblxuZXhwb3J0IHR5cGUgT2JzZXJ2YWJpbGl0eUxvZ0NyZWF0ZUl0ZW0gPSBDcmVhdGVFbnRpdHlJdGVtVHlwZUZyb21TY2hlbWE8T2JzZXJ2YWJpbGl0eUxvZ1NjaGVtYT47XG5leHBvcnQgdHlwZSBMb2dSZWNvcmQgPSBFbnRpdHlSZWNvcmRUeXBlRnJvbVNjaGVtYTxPYnNlcnZhYmlsaXR5TG9nU2NoZW1hPjtcblxuLyoqIFJlY29uc3RydWN0ZWQgc3BhbiB3aXRoIGhpZXJhcmNoeSBmb3IgdHJhY2UgdmlzdWFsaXphdGlvbiAqL1xuZXhwb3J0IGludGVyZmFjZSBSZWNvbnN0cnVjdGVkU3BhbiB7XG4gIHNwYW5JZDogc3RyaW5nO1xuICB0cmFjZUlkOiBzdHJpbmc7XG4gIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZD86IHN0cmluZztcbiAgb3BlcmF0aW9uOiBzdHJpbmc7XG4gIHN0YXJ0VGltZTogbnVtYmVyO1xuICBlbmRUaW1lPzogbnVtYmVyO1xuICBkdXJhdGlvbj86IG51bWJlcjtcbiAgc3RhdHVzPzogc3RyaW5nO1xuICBzdWNjZXNzPzogYm9vbGVhbjtcbiAgYXR0cmlidXRlczogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIGV2ZW50czogQXJyYXk8eyBuYW1lOiBzdHJpbmc7IHRpbWVzdGFtcDogbnVtYmVyOyBhdHRyaWJ1dGVzOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB9PjtcbiAgbWV0cmljczogUmVjb3JkPHN0cmluZywgbnVtYmVyPjtcbiAgY2hpbGRyZW46IFJlY29uc3RydWN0ZWRTcGFuW107XG59XG5cbi8vIG1hbnVhbCByZWdpc3RyYXRpb24gb2YgdGhlIHNjaGVtYSB0byBhdm9pZCBjaXJjdWxhciBkZXBlbmRlbmN5XG5ESUNvbnRhaW5lci5ST09ULnJlZ2lzdGVyKHtcbiAgdHlwZTogJ3NjaGVtYScsXG4gIHByb3ZpZGU6ICdvYnNlcnZhYmlsaXR5TG9nU2NoZW1hJyxcbiAgZm9yRW50aXR5OiAnb2JzZXJ2YWJpbGl0eUxvZycsXG4gIHVzZVZhbHVlOiBPYnNlcnZhYmlsaXR5TG9nRW50aXR5U2NoZW1hLFxufSk7XG5cbi8qKlxuICogT2JzZXJ2YWJpbGl0eUxvZ1NlcnZpY2VcbiAqIFxuICogREktbWFuYWdlZCBzZXJ2aWNlIGZvciBvYnNlcnZhYmlsaXR5IGxvZyBzdG9yYWdlLlxuICogdGFibGVOYW1lIGFuZCB0dGxEYXlzIGluamVjdGVkIHZpYSBASW5qZWN0Q29uZmlnLlxuICogXG4gKi9cbkBTZXJ2aWNlKHsgZm9yRW50aXR5OiAnb2JzZXJ2YWJpbGl0eUxvZycgfSlcbmV4cG9ydCBjbGFzcyBPYnNlcnZhYmlsaXR5TG9nU2VydmljZSBleHRlbmRzIEJhc2VFbnRpdHlTZXJ2aWNlPE9ic2VydmFiaWxpdHlMb2dTY2hlbWE+IHtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBASW5qZWN0Q29uZmlnKCdvYnNlcnZhYmlsaXR5LmR5bmFtb2RiLnRhYmxlS2V5JylcbiAgICByZWFkb25seSB0YWJsZUtleTogc3RyaW5nLFxuXG4gICAgQEluamVjdENvbmZpZygnb2JzZXJ2YWJpbGl0eS5keW5hbW9kYi50dGxEYXlzJylcbiAgICByZWFkb25seSB0dGxEYXlzOiBudW1iZXIsXG5cbiAgICBASW5qZWN0RW50aXR5U2NoZW1hKCdvYnNlcnZhYmlsaXR5TG9nJylcbiAgICByZWFkb25seSBzY2hlbWE6IE9ic2VydmFiaWxpdHlMb2dTY2hlbWEsXG5cbiAgICBASW5qZWN0Q29udGFpbmVyKClcbiAgICByZWFkb25seSBjb250YWluZXI6IElESUNvbnRhaW5lclxuICApIHtcbiAgICBjb25zdCBjbGllbnQgPSBuZXcgRHluYW1vREJDbGllbnQoe30pO1xuICAgIGNvbnN0IGRvY0NsaWVudCA9IER5bmFtb0RCRG9jdW1lbnRDbGllbnQuZnJvbShjbGllbnQsIHtcbiAgICAgIG1hcnNoYWxsT3B0aW9uczogeyByZW1vdmVVbmRlZmluZWRWYWx1ZXM6IHRydWUsIGNvbnZlcnRFbXB0eVZhbHVlczogdHJ1ZSB9LFxuICAgIH0pO1xuXG4gICAgLy8gUmVzb2x2ZSBhY3R1YWwgdGFibGUgbmFtZSBmcm9tIGVudiB1c2luZyBmcmFtZXdvcmsgY29udmVudGlvblxuICAgIC8vIEVudiB2YXI6IHt0YWJsZUtleX1fdGFibGUgKHNwZWNpYWwgY2hhcnMgcmVwbGFjZWQgd2l0aCBfKVxuICAgIGNvbnN0IHRhYmxlTmFtZSA9IHJlc29sdmVFbnZWYWx1ZUZvcih7IGtleTogdGFibGVLZXksIHN1ZmZpeDogJ3RhYmxlJywgZGVmYXVsdFZhbHVlOiB0YWJsZUtleSB9KTtcblxuICAgIHN1cGVyKHNjaGVtYSwge1xuICAgICAgdGFibGU6IHRhYmxlTmFtZSxcbiAgICAgIGNsaWVudDogZG9jQ2xpZW50LFxuICAgIH0sIGNvbnRhaW5lcik7XG4gIH1cblxuICAvKiogXG4gICAqIEJhdGNoIGNyZWF0ZSAtIHVzZWQgYnkgRHluYW1vREIgYmFja2VuZFxuICAgKiBBdXRvLWNvbXByZXNzZXMgZmllbGRzIG1hcmtlZCB3aXRoIGBjb21wcmVzc2VkOiB0cnVlYCBpbiBlbnRpdHkgc2NoZW1hXG4gICAqL1xuICBhc3luYyBiYXRjaENyZWF0ZShpdGVtczogT2JzZXJ2YWJpbGl0eUxvZ0NyZWF0ZUl0ZW1bXSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGNvbXByZXNzZWRJdGVtcyA9IGl0ZW1zLm1hcChpdGVtID0+IHRoaXMuY29tcHJlc3NGaWVsZHMoaXRlbSkpO1xuICAgIGNvbnN0IHJlcG8gPSB0aGlzLmdldFJlcG9zaXRvcnkoKTtcbiAgICBhd2FpdCByZXBvLnB1dChjb21wcmVzc2VkSXRlbXMpLmdvKCk7XG4gIH1cblxuICAvKiogT3ZlcnJpZGUgbGlzdCB0byBkZWZhdWx0IHRvIGRlc2Mgb3JkZXIgKGxhdGVzdCBmaXJzdCkgKi9cbiAgcHVibGljIGFzeW5jIGxpc3QocXVlcnk6IEVudGl0eVF1ZXJ5PE9ic2VydmFiaWxpdHlMb2dTY2hlbWE+ID0ge30sIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcbiAgICByZXR1cm4gc3VwZXIubGlzdCh7XG4gICAgICAuLi5xdWVyeSxcbiAgICAgIHBhZ2luYXRpb246IHsgLi4ucXVlcnkucGFnaW5hdGlvbiwgb3JkZXI6IHF1ZXJ5LnBhZ2luYXRpb24/Lm9yZGVyID8/ICdkZXNjJyB9LFxuICAgIH0sIGN0eCk7XG4gIH1cblxuICAvKiogT3ZlcnJpZGUgc2VhcmNoIHRvIGRlZmF1bHQgc29ydCBieSB0aW1lc3RhbXAgZGVzYyAqL1xuICBwdWJsaWMgYXN5bmMgc2VhcmNoKHF1ZXJ5OiBFbnRpdHlTZWFyY2hRdWVyeTxPYnNlcnZhYmlsaXR5TG9nU2NoZW1hPiwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCkge1xuICAgIHJldHVybiBzdXBlci5zZWFyY2goe1xuICAgICAgLi4ucXVlcnksXG4gICAgICBzb3J0OiBxdWVyeS5zb3J0Py5sZW5ndGggPyBxdWVyeS5zb3J0IDogWyB7IGZpZWxkOiAndGltZXN0YW1wTXMnIGFzIGNvbnN0LCBkaXI6ICdkZXNjJyBhcyBjb25zdCB9IF0sXG4gICAgfSwgY3R4KTtcbiAgfVxuXG4gIC8qKiBHZXQgdHJhY2Ugd2l0aCByZWNvbnN0cnVjdGVkIHNwYW4gdHJlZSAqL1xuICBhc3luYyBnZXRUcmFjZVdpdGhTcGFucyhjb3JyZWxhdGlvbklkOiBzdHJpbmcsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpOiBQcm9taXNlPFJlY29uc3RydWN0ZWRTcGFuW10+IHtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnF1ZXJ5KHtcbiAgICAgIGZpbHRlcnM6IHsgY29ycmVsYXRpb25JZDogeyBlcTogY29ycmVsYXRpb25JZCB9IH0sXG4gICAgICBwYWdpbmF0aW9uOiB7IG9yZGVyOiAnYXNjJyB9LFxuICAgICAgaW5kZXg6IHsgbmFtZTogJ2J5VHJhY2UnIH0sXG4gICAgfSwgY3R4KTtcbiAgICByZXR1cm4gdGhpcy5yZWNvbnN0cnVjdFNwYW5zKChyZXN1bHQuZGF0YSA/PyBbXSkgYXMgTG9nUmVjb3JkW10pO1xuICB9XG5cbiAgLyoqIFxuICAgKiBSZWNvbnN0cnVjdCBzcGFuIGhpZXJhcmNoeSBmcm9tIGZsYXQgbG9nIHJlY29yZHMuXG4gICAqIEZXMjQgc3VwcG9ydHMgY29uc29saWRhdGVkIHNwYW4gcmVjb3JkcyBvbmx5ICh0eXBlPSdzcGFuJykuXG4gICAqIE5vIGNvbXBhdGliaWxpdHkgaXMgcHJvdmlkZWQgZm9yIGxlZ2FjeSBzcGFuLiogcmVjb3JkIGZvcm1hdHMuXG4gICAqL1xuICByZWNvbnN0cnVjdFNwYW5zKHJlY29yZHM6IFJlYWRvbmx5QXJyYXk8TG9nUmVjb3JkPik6IFJlY29uc3RydWN0ZWRTcGFuW10ge1xuICAgIGNvbnN0IHNwYW5NYXAgPSBuZXcgTWFwPHN0cmluZywgUmVjb25zdHJ1Y3RlZFNwYW4+KCk7XG5cbiAgICBmb3IgKGNvbnN0IHJlY29yZCBvZiByZWNvcmRzKSB7XG4gICAgICAvLyBIYW5kbGUgY29uc29saWRhdGVkIHNwYW5zICh0eXBlPSdzcGFuJylcbiAgICAgIGlmIChyZWNvcmQudHlwZSA9PT0gJ3NwYW4nKSB7XG4gICAgICAgIGNvbnN0IHNwYW5JZCA9IFN0cmluZyhyZWNvcmQub2JzZXJ2YWJpbGl0eUxvZ0lkID8/IHJlY29yZC5lbnRpdHlJZCk7XG4gICAgICAgIGNvbnN0IGRhdGEgPSB0b1JlY29yZChyZWNvcmQuZGF0YSk7XG4gICAgICAgIGNvbnN0IGNoZWNrcG9pbnRzUmF3ID0gZGF0YS5jaGVja3BvaW50cztcbiAgICAgICAgY29uc3QgY2hlY2twb2ludHMgPSBBcnJheS5pc0FycmF5KGNoZWNrcG9pbnRzUmF3KVxuICAgICAgICAgID8gY2hlY2twb2ludHNSYXcuZmlsdGVyKChjKTogYyBpcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9PiAhIWMgJiYgdHlwZW9mIGMgPT09ICdvYmplY3QnICYmICFBcnJheS5pc0FycmF5KGMpKVxuICAgICAgICAgIDogW107XG5cbiAgICAgICAgc3Bhbk1hcC5zZXQoc3BhbklkLCB7XG4gICAgICAgICAgc3BhbklkLFxuICAgICAgICAgIHRyYWNlSWQ6IFN0cmluZyhyZWNvcmQuY29ycmVsYXRpb25JZCA/PyAnJyksXG4gICAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiByZWNvcmQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkID8gU3RyaW5nKHJlY29yZC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQpIDogdW5kZWZpbmVkLFxuICAgICAgICAgIG9wZXJhdGlvbjogU3RyaW5nKHJlY29yZC5vcGVyYXRpb24gPz8gJ3Vua25vd24nKSxcbiAgICAgICAgICAvLyBDb25zb2xpZGF0ZWQgc3BhbnMgc3RvcmUgdGltZXN0YW1wTXMgYXMgU1RBUlQgdGltZSAoZm9yIHRpbWVsaW5lIG9yZGVyaW5nKS5cbiAgICAgICAgICAvLyBSZWNvbnN0cnVjdCBlbmRUaW1lIHVzaW5nIGR1cmF0aW9uTXMgd2hlbiBhdmFpbGFibGUuXG4gICAgICAgICAgc3RhcnRUaW1lOiBOdW1iZXIocmVjb3JkLnRpbWVzdGFtcE1zID8/IDApLFxuICAgICAgICAgIGVuZFRpbWU6IChyZWNvcmQuZHVyYXRpb25NcyAmJiByZWNvcmQudGltZXN0YW1wTXMpXG4gICAgICAgICAgICA/IE51bWJlcihyZWNvcmQudGltZXN0YW1wTXMpICsgTnVtYmVyKHJlY29yZC5kdXJhdGlvbk1zKVxuICAgICAgICAgICAgOiBOdW1iZXIocmVjb3JkLnRpbWVzdGFtcE1zID8/IDApLFxuICAgICAgICAgIGR1cmF0aW9uOiByZWNvcmQuZHVyYXRpb25NcyA/IE51bWJlcihyZWNvcmQuZHVyYXRpb25NcykgOiB1bmRlZmluZWQsXG4gICAgICAgICAgc3RhdHVzOiByZWNvcmQuc3RhdHVzID8gU3RyaW5nKHJlY29yZC5zdGF0dXMpIDogdW5kZWZpbmVkLFxuICAgICAgICAgIHN1Y2Nlc3M6IHR5cGVvZiByZWNvcmQuc3VjY2VzcyA9PT0gJ2Jvb2xlYW4nID8gcmVjb3JkLnN1Y2Nlc3MgOiB1bmRlZmluZWQsXG4gICAgICAgICAgYXR0cmlidXRlczogeyAuLi50b1JlY29yZChyZWNvcmQuYXR0cmlidXRlcyksIC4uLmRhdGEgfSxcbiAgICAgICAgICAvLyBEZXJpdmUgdGltZWxpbmUgZXZlbnRzIGZyb20gY2hlY2twb2ludHMgKGNhbm9uaWNhbCBmb3JtYXQpLlxuICAgICAgICAgIGV2ZW50czogY2hlY2twb2ludHMubWFwKChjcCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgbmFtZSA9IHR5cGVvZiBjcC5uYW1lID09PSAnc3RyaW5nJyA/IGNwLm5hbWUgOiAnY2hlY2twb2ludCc7XG4gICAgICAgICAgICBjb25zdCB0cyA9IHR5cGVvZiBjcC50cyA9PT0gJ251bWJlcicgPyBjcC50cyA6IDA7XG4gICAgICAgICAgICBjb25zdCBhdHRyczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7fTtcbiAgICAgICAgICAgIGlmIChjcC50YWdzICYmIHR5cGVvZiBjcC50YWdzID09PSAnb2JqZWN0JykgYXR0cnMudGFncyA9IGNwLnRhZ3M7XG4gICAgICAgICAgICBpZiAoY3AubWV0cmljcyAmJiB0eXBlb2YgY3AubWV0cmljcyA9PT0gJ29iamVjdCcpIGF0dHJzLm1ldHJpY3MgPSBjcC5tZXRyaWNzO1xuICAgICAgICAgICAgaWYgKGNwLmRhdGEgJiYgdHlwZW9mIGNwLmRhdGEgPT09ICdvYmplY3QnKSBhdHRycy5kYXRhID0gY3AuZGF0YTtcbiAgICAgICAgICAgIGlmIChjcC5lcnJvciAmJiB0eXBlb2YgY3AuZXJyb3IgPT09ICdvYmplY3QnKSBhdHRycy5lcnJvciA9IGNwLmVycm9yO1xuICAgICAgICAgICAgcmV0dXJuIHsgbmFtZSwgdGltZXN0YW1wOiB0cywgYXR0cmlidXRlczogYXR0cnMgfTtcbiAgICAgICAgICB9KSxcbiAgICAgICAgICBtZXRyaWNzOiB0b051bWJlclJlY29yZChyZWNvcmQubWV0cmljcyksXG4gICAgICAgICAgY2hpbGRyZW46IFtdLFxuICAgICAgICB9KTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3Qgcm9vdHM6IFJlY29uc3RydWN0ZWRTcGFuW10gPSBbXTtcbiAgICBmb3IgKGNvbnN0IHNwYW4gb2Ygc3Bhbk1hcC52YWx1ZXMoKSkge1xuICAgICAgY29uc3QgcGFyZW50ID0gc3Bhbi5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgJiYgc3Bhbk1hcC5nZXQoc3Bhbi5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQpO1xuICAgICAgcGFyZW50ID8gcGFyZW50LmNoaWxkcmVuLnB1c2goc3BhbikgOiByb290cy5wdXNoKHNwYW4pO1xuICAgIH1cblxuICAgIGNvbnN0IHNvcnRDaGlsZHJlbiA9IChzOiBSZWNvbnN0cnVjdGVkU3Bhbik6IHZvaWQgPT4ge1xuICAgICAgcy5jaGlsZHJlbi5zb3J0KChhLCBiKSA9PiBhLnN0YXJ0VGltZSAtIGIuc3RhcnRUaW1lKS5mb3JFYWNoKHNvcnRDaGlsZHJlbik7XG4gICAgfTtcbiAgICByb290cy5mb3JFYWNoKHNvcnRDaGlsZHJlbik7XG5cbiAgICByZXR1cm4gcm9vdHM7XG4gIH1cbn1cblxuZnVuY3Rpb24gdG9SZWNvcmQodmFsdWU6IHVua25vd24pOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB7XG4gIHJldHVybiB2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmICFBcnJheS5pc0FycmF5KHZhbHVlKSA/IHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+IDoge307XG59XG5cbmZ1bmN0aW9uIHRvTnVtYmVyUmVjb3JkKHZhbHVlOiB1bmtub3duKTogUmVjb3JkPHN0cmluZywgbnVtYmVyPiB7XG4gIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSAnb2JqZWN0JyB8fCBBcnJheS5pc0FycmF5KHZhbHVlKSkgcmV0dXJuIHt9O1xuICBjb25zdCByZXN1bHQ6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fTtcbiAgZm9yIChjb25zdCBbIGssIHYgXSBvZiBPYmplY3QuZW50cmllcyh2YWx1ZSkpIGlmICh0eXBlb2YgdiA9PT0gJ251bWJlcicpIHJlc3VsdFsgayBdID0gdjtcbiAgcmV0dXJuIHJlc3VsdDtcbn1cbiJdfQ==