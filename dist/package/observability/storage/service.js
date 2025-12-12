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
/** Register the observability log entity schema into the DI container;
 * so the app have option to override things if needed
 */
(0, decorators_1.registerEntitySchema)({
    forEntity: 'observabilityLog',
    providedIn: di_1.DIContainer.ROOT,
    useValue: observability_log_entity_1.ObservabilityLogEntitySchema,
});
/**
 * ObservabilityLogService
 *
 * DI-managed service for observability log storage.
 * tableName and ttlDays injected via @InjectConfig.
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VydmljZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L3N0b3JhZ2Uvc2VydmljZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7O0dBS0c7Ozs7Ozs7Ozs7OztBQUVILDhEQUEwRDtBQUMxRCx3REFBK0Q7QUFDL0QsaURBQWlFO0FBQ2pFLGlDQUEwRjtBQUMxRiw0REFBOEQ7QUFJOUQseUVBQWtHO0FBRWxHLHlDQUFxRDtBQXVCckQ7O0dBRUc7QUFDSCxJQUFBLGlDQUFvQixFQUFDO0lBQ25CLFNBQVMsRUFBRSxrQkFBa0I7SUFDN0IsVUFBVSxFQUFFLGdCQUFXLENBQUMsSUFBSTtJQUM1QixRQUFRLEVBQUUsdURBQTRCO0NBQ3ZDLENBQUMsQ0FBQztBQUVIOzs7OztHQUtHO0FBRUksSUFBTSx1QkFBdUIsR0FBN0IsTUFBTSx1QkFBd0IsU0FBUSxnQ0FBeUM7SUFJekU7SUFHQTtJQUdBO0lBR0E7SUFYWCxZQUVXLFFBQWdCLEVBR2hCLE9BQWUsRUFHZixNQUE4QixFQUc5QixTQUF1QjtRQUdoQyxNQUFNLE1BQU0sR0FBRyxJQUFJLGdDQUFjLENBQUMsRUFBRSxDQUFDLENBQUM7UUFDdEMsTUFBTSxTQUFTLEdBQUcscUNBQXNCLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRTtZQUNwRCxlQUFlLEVBQUUsRUFBRSxxQkFBcUIsRUFBRSxJQUFJLEVBQUUsa0JBQWtCLEVBQUUsSUFBSSxFQUFFO1NBQzNFLENBQUMsQ0FBQztRQUVILGdFQUFnRTtRQUNoRSw0REFBNEQ7UUFDNUQsTUFBTSxTQUFTLEdBQUcsSUFBQSx3QkFBa0IsRUFBQyxFQUFFLEdBQUcsRUFBRSxRQUFRLEVBQUUsTUFBTSxFQUFFLE9BQU8sRUFBRSxZQUFZLEVBQUUsUUFBUSxFQUFFLENBQUMsQ0FBQztRQUVqRyxLQUFLLENBQUMsTUFBTSxFQUFFO1lBQ1osS0FBSyxFQUFFLFNBQVM7WUFDaEIsTUFBTSxFQUFFLFNB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KipcbiAqIE9ic2VydmFiaWxpdHlMb2dTZXJ2aWNlIC0gU2VydmljZSBmb3Igb2JzZXJ2YWJpbGl0eSBkYXRhIHN0b3JhZ2VcbiAqIFxuICogUmVnaXN0ZXJlZCB2aWEgREkgd2l0aCBAU2VydmljZSBkZWNvcmF0b3IuXG4gKiBDb25maWcgaW5qZWN0ZWQgdmlhIEBJbmplY3RDb25maWcuXG4gKi9cblxuaW1wb3J0IHsgRHluYW1vREJDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInO1xuaW1wb3J0IHsgRHluYW1vREJEb2N1bWVudENsaWVudCB9IGZyb20gJ0Bhd3Mtc2RrL2xpYi1keW5hbW9kYic7XG5pbXBvcnQgeyByZWdpc3RlckVudGl0eVNjaGVtYSwgU2VydmljZSB9IGZyb20gJy4uLy4uL2RlY29yYXRvcnMnO1xuaW1wb3J0IHsgRElDb250YWluZXIsIEluamVjdENvbmZpZywgSW5qZWN0Q29udGFpbmVyLCBJbmplY3RFbnRpdHlTY2hlbWEgfSBmcm9tICcuLi8uLi9kaSc7XG5pbXBvcnQgeyBCYXNlRW50aXR5U2VydmljZSB9IGZyb20gJy4uLy4uL2VudGl0eS9iYXNlLXNlcnZpY2UnO1xuaW1wb3J0IHsgRW50aXR5UXVlcnkgfSBmcm9tICcuLi8uLi9lbnRpdHkvcXVlcnktdHlwZXMnO1xuaW1wb3J0IHsgRW50aXR5U2VhcmNoUXVlcnkgfSBmcm9tICcuLi8uLi9zZWFyY2gvdHlwZXMnO1xuaW1wb3J0IHsgRXhlY3V0aW9uQ29udGV4dCB9IGZyb20gJy4uLy4uL2NvcmUvdHlwZXMvZXhlY3V0aW9uLWNvbnRleHQnO1xuaW1wb3J0IHsgT2JzZXJ2YWJpbGl0eUxvZ0VudGl0eVNjaGVtYSwgT2JzZXJ2YWJpbGl0eUxvZ1NjaGVtYSB9IGZyb20gJy4vb2JzZXJ2YWJpbGl0eS1sb2ctZW50aXR5JztcbmltcG9ydCB7IENyZWF0ZUVudGl0eUl0ZW1UeXBlRnJvbVNjaGVtYSwgRW50aXR5UmVjb3JkVHlwZUZyb21TY2hlbWEgfSBmcm9tICcuLi8uLi9lbnRpdHkvYmFzZS1lbnRpdHknO1xuaW1wb3J0IHsgcmVzb2x2ZUVudlZhbHVlRm9yIH0gZnJvbSAnLi4vLi4vdXRpbHMvZW52JztcbmltcG9ydCB7IElESUNvbnRhaW5lciB9IGZyb20gJy4uLy4uL2ludGVyZmFjZXMnO1xuXG5leHBvcnQgdHlwZSBPYnNlcnZhYmlsaXR5TG9nQ3JlYXRlSXRlbSA9IENyZWF0ZUVudGl0eUl0ZW1UeXBlRnJvbVNjaGVtYTxPYnNlcnZhYmlsaXR5TG9nU2NoZW1hPjtcbmV4cG9ydCB0eXBlIExvZ1JlY29yZCA9IEVudGl0eVJlY29yZFR5cGVGcm9tU2NoZW1hPE9ic2VydmFiaWxpdHlMb2dTY2hlbWE+O1xuXG4vKiogUmVjb25zdHJ1Y3RlZCBzcGFuIHdpdGggaGllcmFyY2h5IGZvciB0cmFjZSB2aXN1YWxpemF0aW9uICovXG5leHBvcnQgaW50ZXJmYWNlIFJlY29uc3RydWN0ZWRTcGFuIHtcbiAgc3BhbklkOiBzdHJpbmc7XG4gIHRyYWNlSWQ6IHN0cmluZztcbiAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkPzogc3RyaW5nO1xuICBvcGVyYXRpb246IHN0cmluZztcbiAgc3RhcnRUaW1lOiBudW1iZXI7XG4gIGVuZFRpbWU/OiBudW1iZXI7XG4gIGR1cmF0aW9uPzogbnVtYmVyO1xuICBzdGF0dXM/OiBzdHJpbmc7XG4gIHN1Y2Nlc3M/OiBib29sZWFuO1xuICBhdHRyaWJ1dGVzOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgZXZlbnRzOiBBcnJheTx7IG5hbWU6IHN0cmluZzsgdGltZXN0YW1wOiBudW1iZXI7IGF0dHJpYnV0ZXM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IH0+O1xuICBtZXRyaWNzOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+O1xuICBjaGlsZHJlbjogUmVjb25zdHJ1Y3RlZFNwYW5bXTtcbn1cblxuLyoqIFJlZ2lzdGVyIHRoZSBvYnNlcnZhYmlsaXR5IGxvZyBlbnRpdHkgc2NoZW1hIGludG8gdGhlIERJIGNvbnRhaW5lcjsgXG4gKiBzbyB0aGUgYXBwIGhhdmUgb3B0aW9uIHRvIG92ZXJyaWRlIHRoaW5ncyBpZiBuZWVkZWQgXG4gKi9cbnJlZ2lzdGVyRW50aXR5U2NoZW1hKHtcbiAgZm9yRW50aXR5OiAnb2JzZXJ2YWJpbGl0eUxvZycsXG4gIHByb3ZpZGVkSW46IERJQ29udGFpbmVyLlJPT1QsXG4gIHVzZVZhbHVlOiBPYnNlcnZhYmlsaXR5TG9nRW50aXR5U2NoZW1hLFxufSk7XG5cbi8qKlxuICogT2JzZXJ2YWJpbGl0eUxvZ1NlcnZpY2VcbiAqIFxuICogREktbWFuYWdlZCBzZXJ2aWNlIGZvciBvYnNlcnZhYmlsaXR5IGxvZyBzdG9yYWdlLlxuICogdGFibGVOYW1lIGFuZCB0dGxEYXlzIGluamVjdGVkIHZpYSBASW5qZWN0Q29uZmlnLlxuICovXG5AU2VydmljZSh7IGZvckVudGl0eTogJ29ic2VydmFiaWxpdHlMb2cnIH0pXG5leHBvcnQgY2xhc3MgT2JzZXJ2YWJpbGl0eUxvZ1NlcnZpY2UgZXh0ZW5kcyBCYXNlRW50aXR5U2VydmljZTxPYnNlcnZhYmlsaXR5TG9nU2NoZW1hPiB7XG5cbiAgY29uc3RydWN0b3IoXG4gICAgQEluamVjdENvbmZpZygnb2JzZXJ2YWJpbGl0eS5keW5hbW9kYi50YWJsZUtleScpXG4gICAgcmVhZG9ubHkgdGFibGVLZXk6IHN0cmluZyxcblxuICAgIEBJbmplY3RDb25maWcoJ29ic2VydmFiaWxpdHkuZHluYW1vZGIudHRsRGF5cycpXG4gICAgcmVhZG9ubHkgdHRsRGF5czogbnVtYmVyLFxuXG4gICAgQEluamVjdEVudGl0eVNjaGVtYSgnb2JzZXJ2YWJpbGl0eUxvZycpXG4gICAgcmVhZG9ubHkgc2NoZW1hOiBPYnNlcnZhYmlsaXR5TG9nU2NoZW1hLFxuXG4gICAgQEluamVjdENvbnRhaW5lcigpXG4gICAgcmVhZG9ubHkgY29udGFpbmVyOiBJRElDb250YWluZXJcbiAgKSB7XG5cbiAgICBjb25zdCBjbGllbnQgPSBuZXcgRHluYW1vREJDbGllbnQoe30pO1xuICAgIGNvbnN0IGRvY0NsaWVudCA9IER5bmFtb0RCRG9jdW1lbnRDbGllbnQuZnJvbShjbGllbnQsIHtcbiAgICAgIG1hcnNoYWxsT3B0aW9uczogeyByZW1vdmVVbmRlZmluZWRWYWx1ZXM6IHRydWUsIGNvbnZlcnRFbXB0eVZhbHVlczogdHJ1ZSB9LFxuICAgIH0pO1xuXG4gICAgLy8gUmVzb2x2ZSBhY3R1YWwgdGFibGUgbmFtZSBmcm9tIGVudiB1c2luZyBmcmFtZXdvcmsgY29udmVudGlvblxuICAgIC8vIEVudiB2YXI6IHt0YWJsZUtleX1fdGFibGUgKHNwZWNpYWwgY2hhcnMgcmVwbGFjZWQgd2l0aCBfKVxuICAgIGNvbnN0IHRhYmxlTmFtZSA9IHJlc29sdmVFbnZWYWx1ZUZvcih7IGtleTogdGFibGVLZXksIHN1ZmZpeDogJ3RhYmxlJywgZGVmYXVsdFZhbHVlOiB0YWJsZUtleSB9KTtcblxuICAgIHN1cGVyKHNjaGVtYSwge1xuICAgICAgdGFibGU6IHRhYmxlTmFtZSxcbiAgICAgIGNsaWVudDogZG9jQ2xpZW50LFxuICAgIH0sIGNvbnRhaW5lcik7XG4gIH1cblxuICAvKiogQmF0Y2ggY3JlYXRlIC0gdXNlZCBieSBEeW5hbW9EQiBiYWNrZW5kICovXG4gIGFzeW5jIGJhdGNoQ3JlYXRlKGl0ZW1zOiBPYnNlcnZhYmlsaXR5TG9nQ3JlYXRlSXRlbVtdKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgcmVwbyA9IHRoaXMuZ2V0UmVwb3NpdG9yeSgpO1xuICAgIGF3YWl0IHJlcG8ucHV0KGl0ZW1zKS5nbygpO1xuICB9XG5cbiAgLyoqIE92ZXJyaWRlIGxpc3QgdG8gZGVmYXVsdCB0byBkZXNjIG9yZGVyIChsYXRlc3QgZmlyc3QpICovXG4gIHB1YmxpYyBhc3luYyBsaXN0KHF1ZXJ5OiBFbnRpdHlRdWVyeTxPYnNlcnZhYmlsaXR5TG9nU2NoZW1hPiA9IHt9LCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KSB7XG4gICAgcmV0dXJuIHN1cGVyLmxpc3Qoe1xuICAgICAgLi4ucXVlcnksXG4gICAgICBwYWdpbmF0aW9uOiB7IC4uLnF1ZXJ5LnBhZ2luYXRpb24sIG9yZGVyOiBxdWVyeS5wYWdpbmF0aW9uPy5vcmRlciA/PyAnZGVzYycgfSxcbiAgICB9LCBjdHgpO1xuICB9XG5cbiAgLyoqIE92ZXJyaWRlIHNlYXJjaCB0byBkZWZhdWx0IHNvcnQgYnkgdGltZXN0YW1wIGRlc2MgKi9cbiAgcHVibGljIGFzeW5jIHNlYXJjaChxdWVyeTogRW50aXR5U2VhcmNoUXVlcnk8T2JzZXJ2YWJpbGl0eUxvZ1NjaGVtYT4sIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcbiAgICByZXR1cm4gc3VwZXIuc2VhcmNoKHtcbiAgICAgIC4uLnF1ZXJ5LFxuICAgICAgc29ydDogcXVlcnkuc29ydD8ubGVuZ3RoID8gcXVlcnkuc29ydCA6IFsgeyBmaWVsZDogJ3RpbWVzdGFtcE1zJyBhcyBjb25zdCwgZGlyOiAnZGVzYycgYXMgY29uc3QgfSBdLFxuICAgIH0sIGN0eCk7XG4gIH1cblxuICAvKiogR2V0IHRyYWNlIHdpdGggcmVjb25zdHJ1Y3RlZCBzcGFuIHRyZWUgKi9cbiAgYXN5bmMgZ2V0VHJhY2VXaXRoU3BhbnMoY29ycmVsYXRpb25JZDogc3RyaW5nLCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KTogUHJvbWlzZTxSZWNvbnN0cnVjdGVkU3BhbltdPiB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5xdWVyeSh7XG4gICAgICBmaWx0ZXJzOiB7IGNvcnJlbGF0aW9uSWQ6IHsgZXE6IGNvcnJlbGF0aW9uSWQgfSB9LFxuICAgICAgcGFnaW5hdGlvbjogeyBvcmRlcjogJ2FzYycgfSxcbiAgICAgIGluZGV4OiB7IG5hbWU6ICdieVRyYWNlJyB9LFxuICAgIH0sIGN0eCk7XG4gICAgcmV0dXJuIHRoaXMucmVjb25zdHJ1Y3RTcGFucygocmVzdWx0LmRhdGEgPz8gW10pIGFzIExvZ1JlY29yZFtdKTtcbiAgfVxuXG4gIC8qKiBSZWNvbnN0cnVjdCBzcGFuIGhpZXJhcmNoeSBmcm9tIGZsYXQgbG9nIHJlY29yZHMgKi9cbiAgcmVjb25zdHJ1Y3RTcGFucyhyZWNvcmRzOiBSZWFkb25seUFycmF5PExvZ1JlY29yZD4pOiBSZWNvbnN0cnVjdGVkU3BhbltdIHtcbiAgICBjb25zdCBzcGFuTWFwID0gbmV3IE1hcDxzdHJpbmcsIFJlY29uc3RydWN0ZWRTcGFuPigpO1xuICAgIGNvbnN0IGdyb3VwZWQgPSBuZXcgTWFwPHN0cmluZywgTG9nUmVjb3JkW10+KCk7XG5cbiAgICBmb3IgKGNvbnN0IHJlY29yZCBvZiByZWNvcmRzKSB7XG4gICAgICAvLyBGaWx0ZXIgYnkgdHlwZSAoc3Bhbi5zdGFydCwgc3Bhbi5lbmQsIHNwYW4uZXZlbnQpIGFuZCBncm91cCBieSBlbnRpdHlJZCAoc3BhbklkKVxuICAgICAgaWYgKCFyZWNvcmQudHlwZT8uc3RhcnRzV2l0aCgnc3Bhbi4nKSkgY29udGludWU7XG4gICAgICBjb25zdCBpZCA9IFN0cmluZyhyZWNvcmQuZW50aXR5SWQpO1xuICAgICAgKGdyb3VwZWQuZ2V0KGlkKSA/PyBncm91cGVkLnNldChpZCwgW10pLmdldChpZCkhKS5wdXNoKHJlY29yZCk7XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBbIHNwYW5JZCwgc3BhblJlY29yZHMgXSBvZiBncm91cGVkKSB7XG4gICAgICBjb25zdCBzdGFydCA9IHNwYW5SZWNvcmRzLmZpbmQociA9PiByLnR5cGUgPT09ICdzcGFuLnN0YXJ0Jyk7XG4gICAgICBjb25zdCBlbmQgPSBzcGFuUmVjb3Jkcy5maW5kKHIgPT4gci50eXBlID09PSAnc3Bhbi5lbmQnKTtcbiAgICAgIGlmICghc3RhcnQpIGNvbnRpbnVlO1xuXG4gICAgICBzcGFuTWFwLnNldChzcGFuSWQsIHtcbiAgICAgICAgc3BhbklkLFxuICAgICAgICB0cmFjZUlkOiBTdHJpbmcoc3RhcnQuY29ycmVsYXRpb25JZCA/PyAnJyksXG4gICAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogc3RhcnQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkID8gU3RyaW5nKHN0YXJ0LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCkgOiB1bmRlZmluZWQsXG4gICAgICAgIG9wZXJhdGlvbjogU3RyaW5nKHN0YXJ0Lm9wZXJhdGlvbiA/PyAndW5rbm93bicpLFxuICAgICAgICBzdGFydFRpbWU6IE51bWJlcihzdGFydC50aW1lc3RhbXBNcyA/PyAwKSxcbiAgICAgICAgZW5kVGltZTogZW5kPy50aW1lc3RhbXBNcyA/IE51bWJlcihlbmQudGltZXN0YW1wTXMpIDogdW5kZWZpbmVkLFxuICAgICAgICBkdXJhdGlvbjogZW5kPy5kdXJhdGlvbk1zID8gTnVtYmVyKGVuZC5kdXJhdGlvbk1zKSA6IHVuZGVmaW5lZCxcbiAgICAgICAgc3RhdHVzOiBlbmQ/LnN0YXR1cyA/IFN0cmluZyhlbmQuc3RhdHVzKSA6IHVuZGVmaW5lZCxcbiAgICAgICAgc3VjY2VzczogdHlwZW9mIGVuZD8uc3VjY2VzcyA9PT0gJ2Jvb2xlYW4nID8gZW5kLnN1Y2Nlc3MgOiB1bmRlZmluZWQsXG4gICAgICAgIGF0dHJpYnV0ZXM6IHsgLi4udG9SZWNvcmQoc3RhcnQuZGF0YSksIC4uLnRvUmVjb3JkKGVuZD8uZGF0YSkgfSxcbiAgICAgICAgZXZlbnRzOiBzcGFuUmVjb3Jkcy5maWx0ZXIociA9PiByLnR5cGUgPT09ICdzcGFuLmV2ZW50JykubWFwKGUgPT4gKHtcbiAgICAgICAgICBuYW1lOiBTdHJpbmcoZS5vcGVyYXRpb24gPz8gJ2V2ZW50JyksXG4gICAgICAgICAgdGltZXN0YW1wOiBOdW1iZXIoZS50aW1lc3RhbXBNcyA/PyAwKSxcbiAgICAgICAgICBhdHRyaWJ1dGVzOiB0b1JlY29yZChlLmRhdGEpLFxuICAgICAgICB9KSksXG4gICAgICAgIG1ldHJpY3M6IHRvTnVtYmVyUmVjb3JkKGVuZD8ubWV0cmljcyksXG4gICAgICAgIGNoaWxkcmVuOiBbXSxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IHJvb3RzOiBSZWNvbnN0cnVjdGVkU3BhbltdID0gW107XG4gICAgZm9yIChjb25zdCBzcGFuIG9mIHNwYW5NYXAudmFsdWVzKCkpIHtcbiAgICAgIGNvbnN0IHBhcmVudCA9IHNwYW4ucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkICYmIHNwYW5NYXAuZ2V0KHNwYW4ucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKTtcbiAgICAgIHBhcmVudCA/IHBhcmVudC5jaGlsZHJlbi5wdXNoKHNwYW4pIDogcm9vdHMucHVzaChzcGFuKTtcbiAgICB9XG5cbiAgICBjb25zdCBzb3J0Q2hpbGRyZW4gPSAoczogUmVjb25zdHJ1Y3RlZFNwYW4pOiB2b2lkID0+IHtcbiAgICAgIHMuY2hpbGRyZW4uc29ydCgoYSwgYikgPT4gYS5zdGFydFRpbWUgLSBiLnN0YXJ0VGltZSkuZm9yRWFjaChzb3J0Q2hpbGRyZW4pO1xuICAgIH07XG4gICAgcm9vdHMuZm9yRWFjaChzb3J0Q2hpbGRyZW4pO1xuXG4gICAgcmV0dXJuIHJvb3RzO1xuICB9XG59XG5cbmZ1bmN0aW9uIHRvUmVjb3JkKHZhbHVlOiB1bmtub3duKTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4ge1xuICByZXR1cm4gdmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiAhQXJyYXkuaXNBcnJheSh2YWx1ZSkgPyB2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA6IHt9O1xufVxuXG5mdW5jdGlvbiB0b051bWJlclJlY29yZCh2YWx1ZTogdW5rbm93bik6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4ge1xuICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gJ29iamVjdCcgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHJldHVybiB7fTtcbiAgY29uc3QgcmVzdWx0OiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+ID0ge307XG4gIGZvciAoY29uc3QgWyBrLCB2IF0gb2YgT2JqZWN0LmVudHJpZXModmFsdWUpKSBpZiAodHlwZW9mIHYgPT09ICdudW1iZXInKSByZXN1bHRbIGsgXSA9IHY7XG4gIHJldHVybiByZXN1bHQ7XG59XG4iXX0=