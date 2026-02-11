"use strict";
/**
 * DynamoDB Backend for Observability
 *
 * Stores all observability events in DynamoDB.
 *
 * **Size Management:**
 * - Entity schema auto-compresses fields (data, metadata) via `compressed: true`
 * - Optional truncation applied here (if enabled in config)
 * - All config injected via DI
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
var DynamoDBObservabilityBackend_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DynamoDBObservabilityBackend = void 0;
const di_1 = require("../../di");
const logging_1 = require("../../logging");
const service_1 = require("../storage/service");
const payload_1 = require("../utils/payload");
const logger = (0, logging_1.createLogger)('DynamoDBObservabilityBackend');
let DynamoDBObservabilityBackend = class DynamoDBObservabilityBackend {
    static { DynamoDBObservabilityBackend_1 = this; }
    service;
    name = 'dynamodb';
    minLevel;
    buffer = [];
    config;
    constructor(minLevel, config, service) {
        this.service = service;
        this.minLevel = minLevel;
        this.config = config;
        if (config.truncation?.enabled) {
            logger.info('Truncation enabled for observability logs', {
                fields: config.truncation.fields,
                maxBytes: config.truncation.maxBytes
            });
        }
    }
    initializeInvocation() {
        this.buffer = [];
    }
    async capture(event) {
        // CRITICAL: span.start events should NEVER be stored in DynamoDB
        // They are only for OTEL's span tracking. Skip them entirely.
        if (event.type === 'span.start') {
            // This shouldn't happen if filtering works, but guard against it
            logger.debug('Skipping span.start event in DynamoDB backend', {
                observabilityLogId: event.observabilityLogId,
                operation: event.operation,
            });
            return; // Skip - do NOT buffer
        }
        this.buffer.push(event);
        if (this.buffer.length >= (this.config.maxBatchSize ?? 25)) {
            await this.flush();
        }
        if (this.buffer.length >= (this.config.maxBufferSize ?? 1000)) {
            logger.warn(`Buffer overflow (${this.buffer.length} events), force flushing`);
            await this.flush();
        }
    }
    async flush() {
        if (this.buffer.length === 0)
            return;
        const events = this.buffer.splice(0, this.buffer.length);
        const batchSize = this.config.maxBatchSize ?? 25;
        for (let i = 0; i < events.length; i += batchSize) {
            const batch = events.slice(i, i + batchSize);
            await this.writeBatch(batch);
        }
    }
    static RETRYABLE_ERRORS = new Set([
        'ProvisionedThroughputExceededException',
        'ThrottlingException',
        'RequestLimitExceeded',
        'InternalServerError',
        'ServiceUnavailable',
    ]);
    isRetryableError(error) {
        if (!error || typeof error !== 'object')
            return false;
        const errorName = error.name;
        if (errorName && DynamoDBObservabilityBackend_1.RETRYABLE_ERRORS.has(errorName)) {
            return true;
        }
        const errorCode = error.code;
        if (errorCode && DynamoDBObservabilityBackend_1.RETRYABLE_ERRORS.has(errorCode)) {
            return true;
        }
        const metadata = error.$metadata;
        if (metadata?.httpStatusCode && metadata.httpStatusCode >= 500) {
            return true;
        }
        return false;
    }
    async writeBatch(events, retryCount = 0) {
        const MAX_RETRIES = 2;
        try {
            const nowSeconds = Math.floor(Date.now() / 1000);
            const items = events.map((event) => {
                const ttlDays = event.capture?.ttlDays ?? this.config.ttlDays;
                const ttlSeconds = nowSeconds + ttlDays * 24 * 60 * 60;
                return this.mapEventToItem(event, ttlSeconds);
            });
            const validItems = items.filter((item) => {
                if (!item.observabilityLogId) {
                    logger.warn('Item missing observabilityLogId, skipping');
                    return false;
                }
                return true;
            });
            if (validItems.length === 0)
                return;
            // BatchWriteItem fails when the same PK appears multiple times in a single batch.
            // Under FW24, observabilityLogId MUST be globally unique per record.
            // If duplicates happen, it is an invariant violation. We choose a deterministic winner and log loudly.
            const levelRank = (level) => {
                switch (level) {
                    case 'critical': return 50;
                    case 'error': return 40;
                    case 'warn': return 30;
                    case 'info': return 20;
                    case 'debug': return 10;
                    case 'trace': return 0;
                    default: return -1;
                }
            };
            const pickWinner = (a, b) => {
                const la = levelRank(a.level);
                const lb = levelRank(b.level);
                if (la !== lb)
                    return la > lb ? a : b;
                // Deterministic tie-breaker: keep earlier timestampMs.
                // timestampMs is expected for persisted records; if it's missing, treat it as "latest" (keep the other).
                const tsa = a.timestampMs;
                const tsb = b.timestampMs;
                if (typeof tsa === 'number' && typeof tsb === 'number') {
                    return tsa <= tsb ? a : b;
                }
                if (typeof tsa === 'number')
                    return a;
                if (typeof tsb === 'number')
                    return b;
                return a;
            };
            const chosenById = new Map();
            const dupInfo = [];
            const grouped = new Map();
            for (const item of validItems) {
                const list = grouped.get(item.observabilityLogId);
                if (list)
                    list.push(item);
                else
                    grouped.set(item.observabilityLogId, [item]);
            }
            for (const [id, list] of grouped) {
                if (list.length === 1) {
                    chosenById.set(id, list[0]);
                    continue;
                }
                let winner = list[0];
                for (let i = 1; i < list.length; i++) {
                    winner = pickWinner(winner, list[i]);
                }
                chosenById.set(id, winner);
                dupInfo.push({
                    id,
                    count: list.length,
                    types: list.map((x) => String(x.type)),
                    levels: list.map((x) => String(x.level)),
                });
            }
            if (dupInfo.length > 0) {
                // All duplicates reaching DynamoDB are unexpected (span.start is filtered out in capture())
                const unexpectedDuplicates = dupInfo;
                if (unexpectedDuplicates.length > 0) {
                    // Serialize unexpected duplicate info for debugging
                    const duplicatesForLog = unexpectedDuplicates.slice(0, 5).map(d => {
                        const items = grouped.get(d.id) ?? [];
                        return {
                            id: d.id,
                            count: d.count,
                            types: d.types.join(', '),
                            levels: d.levels.join(', '),
                            operations: items.map(i => i.operation).join(', '),
                        };
                    });
                    // NOTE: These are often legitimate repeated operations (e.g., downloading 2 images, updating 3 records)
                    // The deduplication picks a winner correctly, so this is DEBUG, not an ERROR
                    logger.debug('Deduplicating observability events with same ID in batch (repeated operations).', {
                        duplicateIdCount: unexpectedDuplicates.length,
                        duplicates: duplicatesForLog,
                        totalItems: validItems.length,
                        deduplicatedCount: chosenById.size,
                    });
                }
            }
            const deduplicatedItems = Array.from(chosenById.values());
            if (deduplicatedItems.length === 0)
                return;
            // Apply optional truncation (entity schema handles compression automatically)
            const itemsToWrite = this.config.truncation?.enabled
                ? deduplicatedItems.map(item => (0, payload_1.truncateItem)(item, this.config.truncation.fields, this.config.truncation.maxBytes))
                : deduplicatedItems;
            // Service auto-compresses via entity schema (data, metadata fields)
            await this.service.batchCreate(itemsToWrite);
        }
        catch (error) {
            if (this.isRetryableError(error) && retryCount < MAX_RETRIES) {
                logger.warn(`DynamoDB transient error, retrying (${retryCount + 1}/${MAX_RETRIES}):`, {
                    errorName: error.name,
                    errorCode: error.code,
                });
                await new Promise(resolve => setTimeout(resolve, 100 * (retryCount + 1)));
                return this.writeBatch(events, retryCount + 1);
            }
            logger.error('DynamoDB batch write failed:', {
                error: error instanceof Error ? error.message : String(error),
                errorName: error.name,
                eventCount: events.length,
                eventIds: events.map(e => e.observabilityLogId),
                retried: retryCount > 0,
            });
        }
    }
    mapEventToItem(event, ttlSeconds) {
        return {
            observabilityLogId: event.observabilityLogId,
            parentObservabilityLogId: typeof event.parentObservabilityLogId === 'string'
                ? event.parentObservabilityLogId
                : undefined,
            correlationId: event.correlationId,
            causedBy: event.causedBy,
            relatedTraces: event.relatedTraces,
            type: event.type,
            subType: event.subType,
            level: event.level,
            entityName: event.entityName,
            entityId: event.entityId,
            operation: event.operation,
            status: event.status,
            success: event.success,
            timestampMs: event.timestampMs,
            durationMs: event.durationMs,
            source: event.source,
            tags: event.tags,
            actor: event.actor,
            data: event.data,
            attributes: event.attributes,
            metadata: event.metadata,
            metrics: event.metrics,
            context: event.context,
            error: event.error,
            fingerprint: event.fingerprint,
            // absorbed data lives inside event.data.absorbed — no separate field
            ttl: ttlSeconds,
        };
    }
};
exports.DynamoDBObservabilityBackend = DynamoDBObservabilityBackend;
exports.DynamoDBObservabilityBackend = DynamoDBObservabilityBackend = DynamoDBObservabilityBackend_1 = __decorate([
    (0, di_1.Injectable)({
        provide: 'ObservabilityBackend',
        providedIn: 'ROOT',
        tags: ['observability', 'backend', 'dynamodb']
    }),
    __param(0, (0, di_1.InjectConfig)('observability.minLevel')),
    __param(1, (0, di_1.InjectConfig)('observability.dynamodb')),
    __param(2, (0, di_1.Inject)(service_1.ObservabilityLogService))
], DynamoDBObservabilityBackend);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZHluYW1vZGIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9iYWNrZW5kcy9keW5hbW9kYi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7OztHQVNHOzs7Ozs7Ozs7Ozs7O0FBRUgsaUNBQTREO0FBQzVELDJDQUE2QztBQUM3QyxnREFBeUY7QUFFekYsOENBQWdEO0FBRWhELE1BQU0sTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyw4QkFBOEIsQ0FBQyxDQUFDO0FBT3JELElBQU0sNEJBQTRCLEdBQWxDLE1BQU0sNEJBQTRCOztJQVNhO0lBUnBDLElBQUksR0FBRyxVQUFVLENBQUM7SUFDbEIsUUFBUSxDQUFzQjtJQUN0QyxNQUFNLEdBQXlCLEVBQUUsQ0FBQztJQUN6QixNQUFNLENBQWlCO0lBRXhDLFlBQzBDLFFBQTRCLEVBQzVCLE1BQXNCLEVBQ1osT0FBZ0M7UUFBaEMsWUFBTyxHQUFQLE9BQU8sQ0FBeUI7UUFFbEYsSUFBSSxDQUFDLFFBQVEsR0FBRyxRQUFRLENBQUM7UUFDekIsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUM7UUFFckIsSUFBSSxNQUFNLENBQUMsVUFBVSxFQUFFLE9BQU8sRUFBRSxDQUFDO1lBQy9CLE1BQU0sQ0FBQyxJQUFJLENBQUMsMkNBQTJDLEVBQUU7Z0JBQ3ZELE1BQU0sRUFBRSxNQUFNLENBQUMsVUFBVSxDQUFDLE1BQU07Z0JBQ2hDLFFBQVEsRUFBRSxNQUFNLENBQUMsVUFBVSxDQUFDLFFBQVE7YUFDckMsQ0FBQyxDQUFDO1FBQ0wsQ0FBQztJQUNILENBQUM7SUFFRCxvQkFBb0I7UUFDbEIsSUFBSSxDQUFDLE1BQU0sR0FBRyxFQUFFLENBQUM7SUFDbkIsQ0FBQztJQUVELEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBeUI7UUFDckMsaUVBQWlFO1FBQ2pFLDhEQUE4RDtRQUM5RCxJQUFJLEtBQUssQ0FBQyxJQUFJLEtBQUssWUFBWSxF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bnQiOlsiLyoqXG4gKiBEeW5hbW9EQiBCYWNrZW5kIGZvciBPYnNlcnZhYmlsaXR5XG4gKiBcbiAqIFN0b3JlcyBhbGwgb2JzZXJ2YWJpbGl0eSBldmVudHMgaW4gRHluYW1vREIuXG4gKiBcbiAqICoqU2l6ZSBNYW5hZ2VtZW50OioqXG4gKiAtIEVudGl0eSBzY2hlbWEgYXV0by1jb21wcmVzc2VzIGZpZWxkcyAoZGF0YSwgbWV0YWRhdGEpIHZpYSBgY29tcHJlc3NlZDogdHJ1ZWBcbiAqIC0gT3B0aW9uYWwgdHJ1bmNhdGlvbiBhcHBsaWVkIGhlcmUgKGlmIGVuYWJsZWQgaW4gY29uZmlnKVxuICogLSBBbGwgY29uZmlnIGluamVjdGVkIHZpYSBESVxuICovXG5cbmltcG9ydCB7IEluamVjdCwgSW5qZWN0YWJsZSwgSW5qZWN0Q29uZmlnIH0gZnJvbSAnLi4vLi4vZGknO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi4vLi4vbG9nZ2luZyc7XG5pbXBvcnQgeyBPYnNlcnZhYmlsaXR5TG9nQ3JlYXRlSXRlbSwgT2JzZXJ2YWJpbGl0eUxvZ1NlcnZpY2UgfSBmcm9tICcuLi9zdG9yYWdlL3NlcnZpY2UnO1xuaW1wb3J0IHsgT2JzZXJ2YWJpbGl0eUJhY2tlbmQsIE9ic2VydmFiaWxpdHlFdmVudCwgT2JzZXJ2YWJpbGl0eUxldmVsLCBEeW5hbW9EQkNvbmZpZyB9IGZyb20gJy4uL3R5cGVzJztcbmltcG9ydCB7IHRydW5jYXRlSXRlbSB9IGZyb20gJy4uL3V0aWxzL3BheWxvYWQnO1xuXG5jb25zdCBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ0R5bmFtb0RCT2JzZXJ2YWJpbGl0eUJhY2tlbmQnKTtcblxuQEluamVjdGFibGUoe1xuICBwcm92aWRlOiAnT2JzZXJ2YWJpbGl0eUJhY2tlbmQnLFxuICBwcm92aWRlZEluOiAnUk9PVCcsXG4gIHRhZ3M6IFsgJ29ic2VydmFiaWxpdHknLCAnYmFja2VuZCcsICdkeW5hbW9kYicgXVxufSlcbmV4cG9ydCBjbGFzcyBEeW5hbW9EQk9ic2VydmFiaWxpdHlCYWNrZW5kIGltcGxlbWVudHMgT2JzZXJ2YWJpbGl0eUJhY2tlbmQge1xuICBwdWJsaWMgcmVhZG9ubHkgbmFtZSA9ICdkeW5hbW9kYic7XG4gIHB1YmxpYyByZWFkb25seSBtaW5MZXZlbD86IE9ic2VydmFiaWxpdHlMZXZlbDtcbiAgcHJpdmF0ZSBidWZmZXI6IE9ic2VydmFiaWxpdHlFdmVudFtdID0gW107XG4gIHByaXZhdGUgcmVhZG9ubHkgY29uZmlnOiBEeW5hbW9EQkNvbmZpZztcblxuICBjb25zdHJ1Y3RvcihcbiAgICBASW5qZWN0Q29uZmlnKCdvYnNlcnZhYmlsaXR5Lm1pbkxldmVsJykgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbCxcbiAgICBASW5qZWN0Q29uZmlnKCdvYnNlcnZhYmlsaXR5LmR5bmFtb2RiJykgY29uZmlnOiBEeW5hbW9EQkNvbmZpZyxcbiAgICBASW5qZWN0KE9ic2VydmFiaWxpdHlMb2dTZXJ2aWNlKSBwcml2YXRlIHJlYWRvbmx5IHNlcnZpY2U6IE9ic2VydmFiaWxpdHlMb2dTZXJ2aWNlXG4gICkge1xuICAgIHRoaXMubWluTGV2ZWwgPSBtaW5MZXZlbDtcbiAgICB0aGlzLmNvbmZpZyA9IGNvbmZpZztcblxuICAgIGlmIChjb25maWcudHJ1bmNhdGlvbj8uZW5hYmxlZCkge1xuICAgICAgbG9nZ2VyLmluZm8oJ1RydW5jYXRpb24gZW5hYmxlZCBmb3Igb2JzZXJ2YWJpbGl0eSBsb2dzJywge1xuICAgICAgICBmaWVsZHM6IGNvbmZpZy50cnVuY2F0aW9uLmZpZWxkcyxcbiAgICAgICAgbWF4Qnl0ZXM6IGNvbmZpZy50cnVuY2F0aW9uLm1heEJ5dGVzXG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICBpbml0aWFsaXplSW52b2NhdGlvbigpOiB2b2lkIHtcbiAgICB0aGlzLmJ1ZmZlciA9IFtdO1xuICB9XG5cbiAgYXN5bmMgY2FwdHVyZShldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgLy8gQ1JJVElDQUw6IHNwYW4uc3RhcnQgZXZlbnRzIHNob3VsZCBORVZFUiBiZSBzdG9yZWQgaW4gRHluYW1vREJcbiAgICAvLyBUaGV5IGFyZSBvbmx5IGZvciBPVEVMJ3Mgc3BhbiB0cmFja2luZy4gU2tpcCB0aGVtIGVudGlyZWx5LlxuICAgIGlmIChldmVudC50eXBlID09PSAnc3Bhbi5zdGFydCcpIHtcbiAgICAgIC8vIFRoaXMgc2hvdWxkbid0IGhhcHBlbiBpZiBmaWx0ZXJpbmcgd29ya3MsIGJ1dCBndWFyZCBhZ2FpbnN0IGl0XG4gICAgICBsb2dnZXIuZGVidWcoJ1NraXBwaW5nIHNwYW4uc3RhcnQgZXZlbnQgaW4gRHluYW1vREIgYmFja2VuZCcsIHtcbiAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiBldmVudC5vYnNlcnZhYmlsaXR5TG9nSWQsXG4gICAgICAgIG9wZXJhdGlvbjogZXZlbnQub3BlcmF0aW9uLFxuICAgICAgfSk7XG4gICAgICByZXR1cm47IC8vIFNraXAgLSBkbyBOT1QgYnVmZmVyXG4gICAgfVxuXG4gICAgdGhpcy5idWZmZXIucHVzaChldmVudCk7XG5cbiAgICBpZiAodGhpcy5idWZmZXIubGVuZ3RoID49ICh0aGlzLmNvbmZpZy5tYXhCYXRjaFNpemUgPz8gMjUpKSB7XG4gICAgICBhd2FpdCB0aGlzLmZsdXNoKCk7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuYnVmZmVyLmxlbmd0aCA+PSAodGhpcy5jb25maWcubWF4QnVmZmVyU2l6ZSA/PyAxMDAwKSkge1xuICAgICAgbG9nZ2VyLndhcm4oYEJ1ZmZlciBvdmVyZmxvdyAoJHt0aGlzLmJ1ZmZlci5sZW5ndGh9IGV2ZW50cyksIGZvcmNlIGZsdXNoaW5nYCk7XG4gICAgICBhd2FpdCB0aGlzLmZsdXNoKCk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgZmx1c2goKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKHRoaXMuYnVmZmVyLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuXG4gICAgY29uc3QgZXZlbnRzID0gdGhpcy5idWZmZXIuc3BsaWNlKDAsIHRoaXMuYnVmZmVyLmxlbmd0aCk7XG4gICAgY29uc3QgYmF0Y2hTaXplID0gdGhpcy5jb25maWcubWF4QmF0Y2hTaXplID8/IDI1O1xuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBldmVudHMubGVuZ3RoOyBpICs9IGJhdGNoU2l6ZSkge1xuICAgICAgY29uc3QgYmF0Y2ggPSBldmVudHMuc2xpY2UoaSwgaSArIGJhdGNoU2l6ZSk7XG4gICAgICBhd2FpdCB0aGlzLndyaXRlQmF0Y2goYmF0Y2gpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgc3RhdGljIHJlYWRvbmx5IFJFVFJZQUJMRV9FUlJPUlMgPSBuZXcgU2V0KFtcbiAgICAnUHJvdmlzaW9uZWRUaHJvdWdocHV0RXhjZWVkZWRFeGNlcHRpb24nLFxuICAgICdUaHJvdHRsaW5nRXhjZXB0aW9uJyxcbiAgICAnUmVxdWVzdExpbWl0RXhjZWVkZWQnLFxuICAgICdJbnRlcm5hbFNlcnZlckVycm9yJyxcbiAgICAnU2VydmljZVVuYXZhaWxhYmxlJyxcbiAgXSk7XG5cbiAgcHJpdmF0ZSBpc1JldHJ5YWJsZUVycm9yKGVycm9yOiB1bmtub3duKTogYm9vbGVhbiB7XG4gICAgaWYgKCFlcnJvciB8fCB0eXBlb2YgZXJyb3IgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XG5cbiAgICBjb25zdCBlcnJvck5hbWUgPSAoZXJyb3IgYXMgeyBuYW1lPzogc3RyaW5nIH0pLm5hbWU7XG4gICAgaWYgKGVycm9yTmFtZSAmJiBEeW5hbW9EQk9ic2VydmFiaWxpdHlCYWNrZW5kLlJFVFJZQUJMRV9FUlJPUlMuaGFzKGVycm9yTmFtZSkpIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIGNvbnN0IGVycm9yQ29kZSA9IChlcnJvciBhcyB7IGNvZGU/OiBzdHJpbmcgfSkuY29kZTtcbiAgICBpZiAoZXJyb3JDb2RlICYmIER5bmFtb0RCT2JzZXJ2YWJpbGl0eUJhY2tlbmQuUkVUUllBQkxFX0VSUk9SUy5oYXMoZXJyb3JDb2RlKSkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgY29uc3QgbWV0YWRhdGEgPSAoZXJyb3IgYXMgeyAkbWV0YWRhdGE/OiB7IGh0dHBTdGF0dXNDb2RlPzogbnVtYmVyIH0gfSkuJG1ldGFkYXRhO1xuICAgIGlmIChtZXRhZGF0YT8uaHR0cFN0YXR1c0NvZGUgJiYgbWV0YWRhdGEuaHR0cFN0YXR1c0NvZGUgPj0gNTAwKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHdyaXRlQmF0Y2goZXZlbnRzOiBPYnNlcnZhYmlsaXR5RXZlbnRbXSwgcmV0cnlDb3VudCA9IDApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBNQVhfUkVUUklFUyA9IDI7XG5cbiAgICB0cnkge1xuICAgICAgY29uc3Qgbm93U2Vjb25kcyA9IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApO1xuXG4gICAgICBjb25zdCBpdGVtcyA9IGV2ZW50cy5tYXAoKGV2ZW50KSA9PiB7XG4gICAgICAgIGNvbnN0IHR0bERheXMgPSBldmVudC5jYXB0dXJlPy50dGxEYXlzID8/IHRoaXMuY29uZmlnLnR0bERheXM7XG4gICAgICAgIGNvbnN0IHR0bFNlY29uZHMgPSBub3dTZWNvbmRzICsgdHRsRGF5cyAqIDI0ICogNjAgKiA2MDtcbiAgICAgICAgcmV0dXJuIHRoaXMubWFwRXZlbnRUb0l0ZW0oZXZlbnQsIHR0bFNlY29uZHMpO1xuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHZhbGlkSXRlbXMgPSBpdGVtcy5maWx0ZXIoKGl0ZW0pOiBpdGVtIGlzIE9ic2VydmFiaWxpdHlMb2dDcmVhdGVJdGVtICYgeyBvYnNlcnZhYmlsaXR5TG9nSWQ6IHN0cmluZyB9ID0+IHtcbiAgICAgICAgaWYgKCFpdGVtLm9ic2VydmFiaWxpdHlMb2dJZCkge1xuICAgICAgICAgIGxvZ2dlci53YXJuKCdJdGVtIG1pc3Npbmcgb2JzZXJ2YWJpbGl0eUxvZ0lkLCBza2lwcGluZycpO1xuICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH0pO1xuXG4gICAgICBpZiAodmFsaWRJdGVtcy5sZW5ndGggPT09IDApIHJldHVybjtcblxuICAgICAgLy8gQmF0Y2hXcml0ZUl0ZW0gZmFpbHMgd2hlbiB0aGUgc2FtZSBQSyBhcHBlYXJzIG11bHRpcGxlIHRpbWVzIGluIGEgc2luZ2xlIGJhdGNoLlxuICAgICAgLy8gVW5kZXIgRlcyNCwgb2JzZXJ2YWJpbGl0eUxvZ0lkIE1VU1QgYmUgZ2xvYmFsbHkgdW5pcXVlIHBlciByZWNvcmQuXG4gICAgICAvLyBJZiBkdXBsaWNhdGVzIGhhcHBlbiwgaXQgaXMgYW4gaW52YXJpYW50IHZpb2xhdGlvbi4gV2UgY2hvb3NlIGEgZGV0ZXJtaW5pc3RpYyB3aW5uZXIgYW5kIGxvZyBsb3VkbHkuXG4gICAgICBjb25zdCBsZXZlbFJhbmsgPSAobGV2ZWw6IHVua25vd24pOiBudW1iZXIgPT4ge1xuICAgICAgICBzd2l0Y2ggKGxldmVsKSB7XG4gICAgICAgICAgY2FzZSAnY3JpdGljYWwnOiByZXR1cm4gNTA7XG4gICAgICAgICAgY2FzZSAnZXJyb3InOiByZXR1cm4gNDA7XG4gICAgICAgICAgY2FzZSAnd2Fybic6IHJldHVybiAzMDtcbiAgICAgICAgICBjYXNlICdpbmZvJzogcmV0dXJuIDIwO1xuICAgICAgICAgIGNhc2UgJ2RlYnVnJzogcmV0dXJuIDEwO1xuICAgICAgICAgIGNhc2UgJ3RyYWNlJzogcmV0dXJuIDA7XG4gICAgICAgICAgZGVmYXVsdDogcmV0dXJuIC0xO1xuICAgICAgICB9XG4gICAgICB9O1xuICAgICAgY29uc3QgcGlja1dpbm5lciA9IChhOiBPYnNlcnZhYmlsaXR5TG9nQ3JlYXRlSXRlbSwgYjogT2JzZXJ2YWJpbGl0eUxvZ0NyZWF0ZUl0ZW0pOiBPYnNlcnZhYmlsaXR5TG9nQ3JlYXRlSXRlbSA9PiB7XG4gICAgICAgIGNvbnN0IGxhID0gbGV2ZWxSYW5rKGEubGV2ZWwpO1xuICAgICAgICBjb25zdCBsYiA9IGxldmVsUmFuayhiLmxldmVsKTtcbiAgICAgICAgaWYgKGxhICE9PSBsYikgcmV0dXJuIGxhID4gbGIgPyBhIDogYjtcblxuICAgICAgICAvLyBEZXRlcm1pbmlzdGljIHRpZS1icmVha2VyOiBrZWVwIGVhcmxpZXIgdGltZXN0YW1wTXMuXG4gICAgICAgIC8vIHRpbWVzdGFtcE1zIGlzIGV4cGVjdGVkIGZvciBwZXJzaXN0ZWQgcmVjb3JkczsgaWYgaXQncyBtaXNzaW5nLCB0cmVhdCBpdCBhcyBcImxhdGVzdFwiIChrZWVwIHRoZSBvdGhlcikuXG4gICAgICAgIGNvbnN0IHRzYSA9IGEudGltZXN0YW1wTXM7XG4gICAgICAgIGNvbnN0IHRzYiA9IGIudGltZXN0YW1wTXM7XG4gICAgICAgIGlmICh0eXBlb2YgdHNhID09PSAnbnVtYmVyJyAmJiB0eXBlb2YgdHNiID09PSAnbnVtYmVyJykge1xuICAgICAgICAgIHJldHVybiB0c2EgPD0gdHNiID8gYSA6IGI7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHR5cGVvZiB0c2EgPT09ICdudW1iZXInKSByZXR1cm4gYTtcbiAgICAgICAgaWYgKHR5cGVvZiB0c2IgPT09ICdudW1iZXInKSByZXR1cm4gYjtcbiAgICAgICAgcmV0dXJuIGE7XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBjaG9zZW5CeUlkID0gbmV3IE1hcDxzdHJpbmcsIE9ic2VydmFiaWxpdHlMb2dDcmVhdGVJdGVtPigpO1xuICAgICAgY29uc3QgZHVwSW5mbzogQXJyYXk8eyBpZDogc3RyaW5nOyBjb3VudDogbnVtYmVyOyB0eXBlczogc3RyaW5nW107IGxldmVsczogc3RyaW5nW10gfT4gPSBbXTtcbiAgICAgIGNvbnN0IGdyb3VwZWQgPSBuZXcgTWFwPHN0cmluZywgT2JzZXJ2YWJpbGl0eUxvZ0NyZWF0ZUl0ZW1bXT4oKTtcblxuICAgICAgZm9yIChjb25zdCBpdGVtIG9mIHZhbGlkSXRlbXMpIHtcbiAgICAgICAgY29uc3QgbGlzdCA9IGdyb3VwZWQuZ2V0KGl0ZW0ub2JzZXJ2YWJpbGl0eUxvZ0lkKTtcbiAgICAgICAgaWYgKGxpc3QpIGxpc3QucHVzaChpdGVtKTtcbiAgICAgICAgZWxzZSBncm91cGVkLnNldChpdGVtLm9ic2VydmFiaWxpdHlMb2dJZCwgWyBpdGVtIF0pO1xuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IFsgaWQsIGxpc3QgXSBvZiBncm91cGVkKSB7XG4gICAgICAgIGlmIChsaXN0Lmxlbmd0aCA9PT0gMSkge1xuICAgICAgICAgIGNob3NlbkJ5SWQuc2V0KGlkLCBsaXN0WyAwIF0pO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGxldCB3aW5uZXIgPSBsaXN0WyAwIF07XG4gICAgICAgIGZvciAobGV0IGkgPSAxOyBpIDwgbGlzdC5sZW5ndGg7IGkrKykge1xuICAgICAgICAgIHdpbm5lciA9IHBpY2tXaW5uZXIod2lubmVyLCBsaXN0WyBpIF0pO1xuICAgICAgICB9XG4gICAgICAgIGNob3NlbkJ5SWQuc2V0KGlkLCB3aW5uZXIpO1xuICAgICAgICBkdXBJbmZvLnB1c2goe1xuICAgICAgICAgIGlkLFxuICAgICAgICAgIGNvdW50OiBsaXN0Lmxlbmd0aCxcbiAgICAgICAgICB0eXBlczogbGlzdC5tYXAoKHgpID0+IFN0cmluZyh4LnR5cGUpKSxcbiAgICAgICAgICBsZXZlbHM6IGxpc3QubWFwKCh4KSA9PiBTdHJpbmcoeC5sZXZlbCkpLFxuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgaWYgKGR1cEluZm8ubGVuZ3RoID4gMCkge1xuICAgICAgICAvLyBBbGwgZHVwbGljYXRlcyByZWFjaGluZyBEeW5hbW9EQiBhcmUgdW5leHBlY3RlZCAoc3Bhbi5zdGFydCBpcyBmaWx0ZXJlZCBvdXQgaW4gY2FwdHVyZSgpKVxuICAgICAgICBjb25zdCB1bmV4cGVjdGVkRHVwbGljYXRlcyA9IGR1cEluZm87XG5cbiAgICAgICAgaWYgKHVuZXhwZWN0ZWREdXBsaWNhdGVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAvLyBTZXJpYWxpemUgdW5leHBlY3RlZCBkdXBsaWNhdGUgaW5mbyBmb3IgZGVidWdnaW5nXG4gICAgICAgICAgY29uc3QgZHVwbGljYXRlc0ZvckxvZyA9IHVuZXhwZWN0ZWREdXBsaWNhdGVzLnNsaWNlKDAsIDUpLm1hcChkID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGl0ZW1zID0gZ3JvdXBlZC5nZXQoZC5pZCkgPz8gW107XG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICBpZDogZC5pZCxcbiAgICAgICAgICAgICAgY291bnQ6IGQuY291bnQsXG4gICAgICAgICAgICAgIHR5cGVzOiBkLnR5cGVzLmpvaW4oJywgJyksXG4gICAgICAgICAgICAgIGxldmVsczogZC5sZXZlbHMuam9pbignLCAnKSxcbiAgICAgICAgICAgICAgb3BlcmF0aW9uczogaXRlbXMubWFwKGkgPT4gaS5vcGVyYXRpb24pLmpvaW4oJywgJyksXG4gICAgICAgICAgICB9O1xuICAgICAgICAgIH0pO1xuICAgICAgICAgIC8vIE5PVEU6IFRoZXNlIGFyZSBvZnRlbiBsZWdpdGltYXRlIHJlcGVhdGVkIG9wZXJhdGlvbnMgKGUuZy4sIGRvd25sb2FkaW5nIDIgaW1hZ2VzLCB1cGRhdGluZyAzIHJlY29yZHMpXG4gICAgICAgICAgLy8gVGhlIGRlZHVwbGljYXRpb24gcGlja3MgYSB3aW5uZXIgY29ycmVjdGx5LCBzbyB0aGlzIGlzIERFQlVHLCBub3QgYW4gRVJST1JcbiAgICAgICAgICBsb2dnZXIuZGVidWcoJ0RlZHVwbGljYXRpbmcgb2JzZXJ2YWJpbGl0eSBldmVudHMgd2l0aCBzYW1lIElEIGluIGJhdGNoIChyZXBlYXRlZCBvcGVyYXRpb25zKS4nLCB7XG4gICAgICAgICAgICBkdXBsaWNhdGVJZENvdW50OiB1bmV4cGVjdGVkRHVwbGljYXRlcy5sZW5ndGgsXG4gICAgICAgICAgICBkdXBsaWNhdGVzOiBkdXBsaWNhdGVzRm9yTG9nLFxuICAgICAgICAgICAgdG90YWxJdGVtczogdmFsaWRJdGVtcy5sZW5ndGgsXG4gICAgICAgICAgICBkZWR1cGxpY2F0ZWRDb3VudDogY2hvc2VuQnlJZC5zaXplLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGRlZHVwbGljYXRlZEl0ZW1zID0gQXJyYXkuZnJvbShjaG9zZW5CeUlkLnZhbHVlcygpKTtcbiAgICAgIGlmIChkZWR1cGxpY2F0ZWRJdGVtcy5sZW5ndGggPT09IDApIHJldHVybjtcblxuICAgICAgLy8gQXBwbHkgb3B0aW9uYWwgdHJ1bmNhdGlvbiAoZW50aXR5IHNjaGVtYSBoYW5kbGVzIGNvbXByZXNzaW9uIGF1dG9tYXRpY2FsbHkpXG4gICAgICBjb25zdCBpdGVtc1RvV3JpdGUgPSB0aGlzLmNvbmZpZy50cnVuY2F0aW9uPy5lbmFibGVkXG4gICAgICAgID8gZGVkdXBsaWNhdGVkSXRlbXMubWFwKGl0ZW0gPT4gdHJ1bmNhdGVJdGVtKGl0ZW0sIHRoaXMuY29uZmlnLnRydW5jYXRpb24hLmZpZWxkcywgdGhpcy5jb25maWcudHJ1bmNhdGlvbiEubWF4Qnl0ZXMpKVxuICAgICAgICA6IGRlZHVwbGljYXRlZEl0ZW1zO1xuXG4gICAgICAvLyBTZXJ2aWNlIGF1dG8tY29tcHJlc3NlcyB2aWEgZW50aXR5IHNjaGVtYSAoZGF0YSwgbWV0YWRhdGEgZmllbGRzKVxuICAgICAgYXdhaXQgdGhpcy5zZXJ2aWNlLmJhdGNoQ3JlYXRlKGl0ZW1zVG9Xcml0ZSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmICh0aGlzLmlzUmV0cnlhYmxlRXJyb3IoZXJyb3IpICYmIHJldHJ5Q291bnQgPCBNQVhfUkVUUklFUykge1xuICAgICAgICBsb2dnZXIud2FybihgRHluYW1vREIgdHJhbnNpZW50IGVycm9yLCByZXRyeWluZyAoJHtyZXRyeUNvdW50ICsgMX0vJHtNQVhfUkVUUklFU30pOmAsIHtcbiAgICAgICAgICBlcnJvck5hbWU6IChlcnJvciBhcyB7IG5hbWU/OiBzdHJpbmcgfSkubmFtZSxcbiAgICAgICAgICBlcnJvckNvZGU6IChlcnJvciBhcyB7IGNvZGU/OiBzdHJpbmcgfSkuY29kZSxcbiAgICAgICAgfSk7XG4gICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCAxMDAgKiAocmV0cnlDb3VudCArIDEpKSk7XG4gICAgICAgIHJldHVybiB0aGlzLndyaXRlQmF0Y2goZXZlbnRzLCByZXRyeUNvdW50ICsgMSk7XG4gICAgICB9XG5cbiAgICAgIGxvZ2dlci5lcnJvcignRHluYW1vREIgYmF0Y2ggd3JpdGUgZmFpbGVkOicsIHtcbiAgICAgICAgZXJyb3I6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKSxcbiAgICAgICAgZXJyb3JOYW1lOiAoZXJyb3IgYXMgeyBuYW1lPzogc3RyaW5nIH0pLm5hbWUsXG4gICAgICAgIGV2ZW50Q291bnQ6IGV2ZW50cy5sZW5ndGgsXG4gICAgICAgIGV2ZW50SWRzOiBldmVudHMubWFwKGUgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQpLFxuICAgICAgICByZXRyaWVkOiByZXRyeUNvdW50ID4gMCxcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgbWFwRXZlbnRUb0l0ZW0oZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCwgdHRsU2Vjb25kczogbnVtYmVyKTogT2JzZXJ2YWJpbGl0eUxvZ0NyZWF0ZUl0ZW0ge1xuICAgIHJldHVybiB7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6IGV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZCxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogdHlwZW9mIGV2ZW50LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ3N0cmluZydcbiAgICAgICAgPyBldmVudC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWRcbiAgICAgICAgOiB1bmRlZmluZWQsXG4gICAgICBjb3JyZWxhdGlvbklkOiBldmVudC5jb3JyZWxhdGlvbklkLFxuICAgICAgY2F1c2VkQnk6IGV2ZW50LmNhdXNlZEJ5LFxuICAgICAgcmVsYXRlZFRyYWNlczogZXZlbnQucmVsYXRlZFRyYWNlcyxcbiAgICAgIHR5cGU6IGV2ZW50LnR5cGUsXG4gICAgICBzdWJUeXBlOiBldmVudC5zdWJUeXBlLFxuICAgICAgbGV2ZWw6IGV2ZW50LmxldmVsLFxuICAgICAgZW50aXR5TmFtZTogZXZlbnQuZW50aXR5TmFtZSxcbiAgICAgIGVudGl0eUlkOiBldmVudC5lbnRpdHlJZCxcbiAgICAgIG9wZXJhdGlvbjogZXZlbnQub3BlcmF0aW9uLFxuICAgICAgc3RhdHVzOiBldmVudC5zdGF0dXMsXG4gICAgICBzdWNjZXNzOiBldmVudC5zdWNjZXNzLFxuICAgICAgdGltZXN0YW1wTXM6IGV2ZW50LnRpbWVzdGFtcE1zLFxuICAgICAgZHVyYXRpb25NczogZXZlbnQuZHVyYXRpb25NcyxcbiAgICAgIHNvdXJjZTogZXZlbnQuc291cmNlLFxuICAgICAgdGFnczogZXZlbnQudGFncyxcbiAgICAgIGFjdG9yOiBldmVudC5hY3RvcixcbiAgICAgIGRhdGE6IGV2ZW50LmRhdGEsXG4gICAgICBhdHRyaWJ1dGVzOiBldmVudC5hdHRyaWJ1dGVzLFxuICAgICAgbWV0YWRhdGE6IGV2ZW50Lm1ldGFkYXRhLFxuICAgICAgbWV0cmljczogZXZlbnQubWV0cmljcyxcbiAgICAgIGNvbnRleHQ6IGV2ZW50LmNvbnRleHQsXG4gICAgICBlcnJvcjogZXZlbnQuZXJyb3IsXG4gICAgICBmaW5nZXJwcmludDogZXZlbnQuZmluZ2VycHJpbnQsXG4gICAgICAvLyBhYnNvcmJlZCBkYXRhIGxpdmVzIGluc2lkZSBldmVudC5kYXRhLmFic29yYmVkIOKAlCBubyBzZXBhcmF0ZSBmaWVsZFxuICAgICAgdHRsOiB0dGxTZWNvbmRzLFxuICAgIH07XG4gIH1cbn1cbiJdfQ==