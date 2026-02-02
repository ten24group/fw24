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
                // Filter out expected duplicates (span.start + span pairs)
                const unexpectedDuplicates = dupInfo.filter(d => {
                    const items = grouped.get(d.id) ?? [];
                    const types = new Set(items.map(i => i.type));
                    // Expected: span.start + span for same operation (lifecycle)
                    // Unexpected: Multiple 'span' or multiple 'span.start' with same ID
                    const hasSpanStart = types.has('span.start');
                    const hasSpan = types.has('span');
                    const isExpectedPair = hasSpanStart && hasSpan && types.size === 2;
                    return !isExpectedPair;
                });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZHluYW1vZGIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9iYWNrZW5kcy9keW5hbW9kYi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7OztHQVNHOzs7Ozs7Ozs7Ozs7O0FBRUgsaUNBQTREO0FBQzVELDJDQUE2QztBQUM3QyxnREFBeUY7QUFFekYsOENBQWdEO0FBRWhELE1BQU0sTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyw4QkFBOEIsQ0FBQyxDQUFDO0FBT3JELElBQU0sNEJBQTRCLEdBQWxDLE1BQU0sNEJBQTRCOztJQVNhO0lBUnBDLElBQUksR0FBRyxVQUFVLENBQUM7SUFDbEIsUUFBUSxDQUFzQjtJQUN0QyxNQUFNLEdBQXlCLEVBQUUsQ0FBQztJQUN6QixNQUFNLENBQWlCO0lBRXhDLFlBQzBDLFFBQTRCLEVBQzVCLE1BQXNCLEVBQ1osT0FBZ0M7UUFBaEMsWUFBTyxHQUFQLE9BQU8sQ0FBeUI7UUFFbEYsSUFBSSxDQUFDLFFBQVEsR0FBRyxRQUFRLENBQUM7UUFDekIsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUM7UUFFckIsSUFBSSxNQUFNLENBQUMsVUFBVSxFQUFFLE9BQU8sRUFBRSxDQUFDO1lBQy9CLE1BQU0sQ0FBQyxJQUFJLENBQUMsMkNBQTJDLEVBQUU7Z0JBQ3ZELE1BQU0sRUFBRSxNQUFNLENBQUMsVUFBVSxDQUFDLE1BQU07Z0JBQ2hDLFFBQVEsRUFBRSxNQUFNLENBQUMsVUFBVSxDQUFDLFFBQVE7YUFDckMsQ0FBQyxDQUFDO1FBQ0wsQ0FBQztJQUNILENBQUM7SUFFRCxvQkFBb0I7UUFDbEIsSUFBSSxDQUFDLE1BQU0sR0FBRyxFQUFFLENBQUM7SUFDbkIsQ0FBQztJQUVELEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBeUI7UUFDckMsaUVBQWlFO1FBQ2pFLDhEQUE4RDtRQUM5RCxJQUFJLEtBQUssQ0FBQyxJQUFJLEtBQUssWUFBWSxF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T0FBTztZQUN0QixPQUFPLEVBQUUsS0FBSyxDQUFDLE9BQU87WUFDdEIsS0FBSyxFQUFFLEtBQUssQ0FBQyxLQUFLO1lBQ2xCLEdBQUcsRUFBRSxVQUFVO1NBQ2hCLENBQUM7SUFDSixDQUFDOztBQTVRVSxvRUFBNEI7dUNBQTVCLDRCQUE0QjtJQUx4QyxJQUFBLGVBQVUsRUFBQztRQUNWLE9BQU8sRUFBRSxzQkFBc0I7UUFDL0IsVUFBVSxFQUFFLE1BQU07UUFDbEIsSUFBSSxFQUFFLENBQUUsZUFBZSxFQUFFLFNBQVMsRUFBRSxVQUFVLENBQUU7S0FDakQsQ0FBQztJQVFHLFdBQUEsSUFBQSxpQkFBWSxFQUFDLHdCQUF3QixDQUFDLENBQUE7SUFDdEMsV0FBQSxJQUFBLGlCQUFZLEVBQUMsd0JBQXdCLENBQUMsQ0FBQTtJQUN0QyxXQUFBLElBQUEsV0FBTSxFQUFDLGlDQUF1QixDQUFDLENBQUE7R0FUdkIsNEJBQTRCLENBNlF4QyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogRHluYW1vREIgQmFja2VuZCBmb3IgT2JzZXJ2YWJpbGl0eVxuICogXG4gKiBTdG9yZXMgYWxsIG9ic2VydmFiaWxpdHkgZXZlbnRzIGluIER5bmFtb0RCLlxuICogXG4gKiAqKlNpemUgTWFuYWdlbWVudDoqKlxuICogLSBFbnRpdHkgc2NoZW1hIGF1dG8tY29tcHJlc3NlcyBmaWVsZHMgKGRhdGEsIG1ldGFkYXRhKSB2aWEgYGNvbXByZXNzZWQ6IHRydWVgXG4gKiAtIE9wdGlvbmFsIHRydW5jYXRpb24gYXBwbGllZCBoZXJlIChpZiBlbmFibGVkIGluIGNvbmZpZylcbiAqIC0gQWxsIGNvbmZpZyBpbmplY3RlZCB2aWEgRElcbiAqL1xuXG5pbXBvcnQgeyBJbmplY3QsIEluamVjdGFibGUsIEluamVjdENvbmZpZyB9IGZyb20gJy4uLy4uL2RpJztcbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gJy4uLy4uL2xvZ2dpbmcnO1xuaW1wb3J0IHsgT2JzZXJ2YWJpbGl0eUxvZ0NyZWF0ZUl0ZW0sIE9ic2VydmFiaWxpdHlMb2dTZXJ2aWNlIH0gZnJvbSAnLi4vc3RvcmFnZS9zZXJ2aWNlJztcbmltcG9ydCB7IE9ic2VydmFiaWxpdHlCYWNrZW5kLCBPYnNlcnZhYmlsaXR5RXZlbnQsIE9ic2VydmFiaWxpdHlMZXZlbCwgRHluYW1vREJDb25maWcgfSBmcm9tICcuLi90eXBlcyc7XG5pbXBvcnQgeyB0cnVuY2F0ZUl0ZW0gfSBmcm9tICcuLi91dGlscy9wYXlsb2FkJztcblxuY29uc3QgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdEeW5hbW9EQk9ic2VydmFiaWxpdHlCYWNrZW5kJyk7XG5cbkBJbmplY3RhYmxlKHtcbiAgcHJvdmlkZTogJ09ic2VydmFiaWxpdHlCYWNrZW5kJyxcbiAgcHJvdmlkZWRJbjogJ1JPT1QnLFxuICB0YWdzOiBbICdvYnNlcnZhYmlsaXR5JywgJ2JhY2tlbmQnLCAnZHluYW1vZGInIF1cbn0pXG5leHBvcnQgY2xhc3MgRHluYW1vREJPYnNlcnZhYmlsaXR5QmFja2VuZCBpbXBsZW1lbnRzIE9ic2VydmFiaWxpdHlCYWNrZW5kIHtcbiAgcHVibGljIHJlYWRvbmx5IG5hbWUgPSAnZHluYW1vZGInO1xuICBwdWJsaWMgcmVhZG9ubHkgbWluTGV2ZWw/OiBPYnNlcnZhYmlsaXR5TGV2ZWw7XG4gIHByaXZhdGUgYnVmZmVyOiBPYnNlcnZhYmlsaXR5RXZlbnRbXSA9IFtdO1xuICBwcml2YXRlIHJlYWRvbmx5IGNvbmZpZzogRHluYW1vREJDb25maWc7XG5cbiAgY29uc3RydWN0b3IoXG4gICAgQEluamVjdENvbmZpZygnb2JzZXJ2YWJpbGl0eS5taW5MZXZlbCcpIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwsXG4gICAgQEluamVjdENvbmZpZygnb2JzZXJ2YWJpbGl0eS5keW5hbW9kYicpIGNvbmZpZzogRHluYW1vREJDb25maWcsXG4gICAgQEluamVjdChPYnNlcnZhYmlsaXR5TG9nU2VydmljZSkgcHJpdmF0ZSByZWFkb25seSBzZXJ2aWNlOiBPYnNlcnZhYmlsaXR5TG9nU2VydmljZVxuICApIHtcbiAgICB0aGlzLm1pbkxldmVsID0gbWluTGV2ZWw7XG4gICAgdGhpcy5jb25maWcgPSBjb25maWc7XG5cbiAgICBpZiAoY29uZmlnLnRydW5jYXRpb24/LmVuYWJsZWQpIHtcbiAgICAgIGxvZ2dlci5pbmZvKCdUcnVuY2F0aW9uIGVuYWJsZWQgZm9yIG9ic2VydmFiaWxpdHkgbG9ncycsIHtcbiAgICAgICAgZmllbGRzOiBjb25maWcudHJ1bmNhdGlvbi5maWVsZHMsXG4gICAgICAgIG1heEJ5dGVzOiBjb25maWcudHJ1bmNhdGlvbi5tYXhCeXRlc1xuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgaW5pdGlhbGl6ZUludm9jYXRpb24oKTogdm9pZCB7XG4gICAgdGhpcy5idWZmZXIgPSBbXTtcbiAgfVxuXG4gIGFzeW5jIGNhcHR1cmUoZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCk6IFByb21pc2U8dm9pZD4ge1xuICAgIC8vIENSSVRJQ0FMOiBzcGFuLnN0YXJ0IGV2ZW50cyBzaG91bGQgTkVWRVIgYmUgc3RvcmVkIGluIER5bmFtb0RCXG4gICAgLy8gVGhleSBhcmUgb25seSBmb3IgT1RFTCdzIHNwYW4gdHJhY2tpbmcuIFNraXAgdGhlbSBlbnRpcmVseS5cbiAgICBpZiAoZXZlbnQudHlwZSA9PT0gJ3NwYW4uc3RhcnQnKSB7XG4gICAgICAvLyBUaGlzIHNob3VsZG4ndCBoYXBwZW4gaWYgZmlsdGVyaW5nIHdvcmtzLCBidXQgZ3VhcmQgYWdhaW5zdCBpdFxuICAgICAgbG9nZ2VyLmRlYnVnKCdTa2lwcGluZyBzcGFuLnN0YXJ0IGV2ZW50IGluIER5bmFtb0RCIGJhY2tlbmQnLCB7XG4gICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogZXZlbnQub2JzZXJ2YWJpbGl0eUxvZ0lkLFxuICAgICAgICBvcGVyYXRpb246IGV2ZW50Lm9wZXJhdGlvbixcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuOyAvLyBTa2lwIC0gZG8gTk9UIGJ1ZmZlclxuICAgIH1cblxuICAgIHRoaXMuYnVmZmVyLnB1c2goZXZlbnQpO1xuXG4gICAgaWYgKHRoaXMuYnVmZmVyLmxlbmd0aCA+PSAodGhpcy5jb25maWcubWF4QmF0Y2hTaXplID8/IDI1KSkge1xuICAgICAgYXdhaXQgdGhpcy5mbHVzaCgpO1xuICAgIH1cblxuICAgIGlmICh0aGlzLmJ1ZmZlci5sZW5ndGggPj0gKHRoaXMuY29uZmlnLm1heEJ1ZmZlclNpemUgPz8gMTAwMCkpIHtcbiAgICAgIGxvZ2dlci53YXJuKGBCdWZmZXIgb3ZlcmZsb3cgKCR7dGhpcy5idWZmZXIubGVuZ3RofSBldmVudHMpLCBmb3JjZSBmbHVzaGluZ2ApO1xuICAgICAgYXdhaXQgdGhpcy5mbHVzaCgpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGZsdXNoKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICh0aGlzLmJ1ZmZlci5sZW5ndGggPT09IDApIHJldHVybjtcblxuICAgIGNvbnN0IGV2ZW50cyA9IHRoaXMuYnVmZmVyLnNwbGljZSgwLCB0aGlzLmJ1ZmZlci5sZW5ndGgpO1xuICAgIGNvbnN0IGJhdGNoU2l6ZSA9IHRoaXMuY29uZmlnLm1heEJhdGNoU2l6ZSA/PyAyNTtcblxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZXZlbnRzLmxlbmd0aDsgaSArPSBiYXRjaFNpemUpIHtcbiAgICAgIGNvbnN0IGJhdGNoID0gZXZlbnRzLnNsaWNlKGksIGkgKyBiYXRjaFNpemUpO1xuICAgICAgYXdhaXQgdGhpcy53cml0ZUJhdGNoKGJhdGNoKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHN0YXRpYyByZWFkb25seSBSRVRSWUFCTEVfRVJST1JTID0gbmV3IFNldChbXG4gICAgJ1Byb3Zpc2lvbmVkVGhyb3VnaHB1dEV4Y2VlZGVkRXhjZXB0aW9uJyxcbiAgICAnVGhyb3R0bGluZ0V4Y2VwdGlvbicsXG4gICAgJ1JlcXVlc3RMaW1pdEV4Y2VlZGVkJyxcbiAgICAnSW50ZXJuYWxTZXJ2ZXJFcnJvcicsXG4gICAgJ1NlcnZpY2VVbmF2YWlsYWJsZScsXG4gIF0pO1xuXG4gIHByaXZhdGUgaXNSZXRyeWFibGVFcnJvcihlcnJvcjogdW5rbm93bik6IGJvb2xlYW4ge1xuICAgIGlmICghZXJyb3IgfHwgdHlwZW9mIGVycm9yICE9PSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlO1xuXG4gICAgY29uc3QgZXJyb3JOYW1lID0gKGVycm9yIGFzIHsgbmFtZT86IHN0cmluZyB9KS5uYW1lO1xuICAgIGlmIChlcnJvck5hbWUgJiYgRHluYW1vREJPYnNlcnZhYmlsaXR5QmFja2VuZC5SRVRSWUFCTEVfRVJST1JTLmhhcyhlcnJvck5hbWUpKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICBjb25zdCBlcnJvckNvZGUgPSAoZXJyb3IgYXMgeyBjb2RlPzogc3RyaW5nIH0pLmNvZGU7XG4gICAgaWYgKGVycm9yQ29kZSAmJiBEeW5hbW9EQk9ic2VydmFiaWxpdHlCYWNrZW5kLlJFVFJZQUJMRV9FUlJPUlMuaGFzKGVycm9yQ29kZSkpIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIGNvbnN0IG1ldGFkYXRhID0gKGVycm9yIGFzIHsgJG1ldGFkYXRhPzogeyBodHRwU3RhdHVzQ29kZT86IG51bWJlciB9IH0pLiRtZXRhZGF0YTtcbiAgICBpZiAobWV0YWRhdGE/Lmh0dHBTdGF0dXNDb2RlICYmIG1ldGFkYXRhLmh0dHBTdGF0dXNDb2RlID49IDUwMCkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyB3cml0ZUJhdGNoKGV2ZW50czogT2JzZXJ2YWJpbGl0eUV2ZW50W10sIHJldHJ5Q291bnQgPSAwKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgTUFYX1JFVFJJRVMgPSAyO1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IG5vd1NlY29uZHMgPSBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKTtcblxuICAgICAgY29uc3QgaXRlbXMgPSBldmVudHMubWFwKChldmVudCkgPT4ge1xuICAgICAgICBjb25zdCB0dGxEYXlzID0gZXZlbnQuY2FwdHVyZT8udHRsRGF5cyA/PyB0aGlzLmNvbmZpZy50dGxEYXlzO1xuICAgICAgICBjb25zdCB0dGxTZWNvbmRzID0gbm93U2Vjb25kcyArIHR0bERheXMgKiAyNCAqIDYwICogNjA7XG4gICAgICAgIHJldHVybiB0aGlzLm1hcEV2ZW50VG9JdGVtKGV2ZW50LCB0dGxTZWNvbmRzKTtcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCB2YWxpZEl0ZW1zID0gaXRlbXMuZmlsdGVyKChpdGVtKTogaXRlbSBpcyBPYnNlcnZhYmlsaXR5TG9nQ3JlYXRlSXRlbSAmIHsgb2JzZXJ2YWJpbGl0eUxvZ0lkOiBzdHJpbmcgfSA9PiB7XG4gICAgICAgIGlmICghaXRlbS5vYnNlcnZhYmlsaXR5TG9nSWQpIHtcbiAgICAgICAgICBsb2dnZXIud2FybignSXRlbSBtaXNzaW5nIG9ic2VydmFiaWxpdHlMb2dJZCwgc2tpcHBpbmcnKTtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9KTtcblxuICAgICAgaWYgKHZhbGlkSXRlbXMubGVuZ3RoID09PSAwKSByZXR1cm47XG5cbiAgICAgIC8vIEJhdGNoV3JpdGVJdGVtIGZhaWxzIHdoZW4gdGhlIHNhbWUgUEsgYXBwZWFycyBtdWx0aXBsZSB0aW1lcyBpbiBhIHNpbmdsZSBiYXRjaC5cbiAgICAgIC8vIFVuZGVyIEZXMjQsIG9ic2VydmFiaWxpdHlMb2dJZCBNVVNUIGJlIGdsb2JhbGx5IHVuaXF1ZSBwZXIgcmVjb3JkLlxuICAgICAgLy8gSWYgZHVwbGljYXRlcyBoYXBwZW4sIGl0IGlzIGFuIGludmFyaWFudCB2aW9sYXRpb24uIFdlIGNob29zZSBhIGRldGVybWluaXN0aWMgd2lubmVyIGFuZCBsb2cgbG91ZGx5LlxuICAgICAgY29uc3QgbGV2ZWxSYW5rID0gKGxldmVsOiB1bmtub3duKTogbnVtYmVyID0+IHtcbiAgICAgICAgc3dpdGNoIChsZXZlbCkge1xuICAgICAgICAgIGNhc2UgJ2NyaXRpY2FsJzogcmV0dXJuIDUwO1xuICAgICAgICAgIGNhc2UgJ2Vycm9yJzogcmV0dXJuIDQwO1xuICAgICAgICAgIGNhc2UgJ3dhcm4nOiByZXR1cm4gMzA7XG4gICAgICAgICAgY2FzZSAnaW5mbyc6IHJldHVybiAyMDtcbiAgICAgICAgICBjYXNlICdkZWJ1Zyc6IHJldHVybiAxMDtcbiAgICAgICAgICBjYXNlICd0cmFjZSc6IHJldHVybiAwO1xuICAgICAgICAgIGRlZmF1bHQ6IHJldHVybiAtMTtcbiAgICAgICAgfVxuICAgICAgfTtcbiAgICAgIGNvbnN0IHBpY2tXaW5uZXIgPSAoYTogT2JzZXJ2YWJpbGl0eUxvZ0NyZWF0ZUl0ZW0sIGI6IE9ic2VydmFiaWxpdHlMb2dDcmVhdGVJdGVtKTogT2JzZXJ2YWJpbGl0eUxvZ0NyZWF0ZUl0ZW0gPT4ge1xuICAgICAgICBjb25zdCBsYSA9IGxldmVsUmFuayhhLmxldmVsKTtcbiAgICAgICAgY29uc3QgbGIgPSBsZXZlbFJhbmsoYi5sZXZlbCk7XG4gICAgICAgIGlmIChsYSAhPT0gbGIpIHJldHVybiBsYSA+IGxiID8gYSA6IGI7XG5cbiAgICAgICAgLy8gRGV0ZXJtaW5pc3RpYyB0aWUtYnJlYWtlcjoga2VlcCBlYXJsaWVyIHRpbWVzdGFtcE1zLlxuICAgICAgICAvLyB0aW1lc3RhbXBNcyBpcyBleHBlY3RlZCBmb3IgcGVyc2lzdGVkIHJlY29yZHM7IGlmIGl0J3MgbWlzc2luZywgdHJlYXQgaXQgYXMgXCJsYXRlc3RcIiAoa2VlcCB0aGUgb3RoZXIpLlxuICAgICAgICBjb25zdCB0c2EgPSBhLnRpbWVzdGFtcE1zO1xuICAgICAgICBjb25zdCB0c2IgPSBiLnRpbWVzdGFtcE1zO1xuICAgICAgICBpZiAodHlwZW9mIHRzYSA9PT0gJ251bWJlcicgJiYgdHlwZW9mIHRzYiA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgICByZXR1cm4gdHNhIDw9IHRzYiA/IGEgOiBiO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0eXBlb2YgdHNhID09PSAnbnVtYmVyJykgcmV0dXJuIGE7XG4gICAgICAgIGlmICh0eXBlb2YgdHNiID09PSAnbnVtYmVyJykgcmV0dXJuIGI7XG4gICAgICAgIHJldHVybiBhO1xuICAgICAgfTtcblxuICAgICAgY29uc3QgY2hvc2VuQnlJZCA9IG5ldyBNYXA8c3RyaW5nLCBPYnNlcnZhYmlsaXR5TG9nQ3JlYXRlSXRlbT4oKTtcbiAgICAgIGNvbnN0IGR1cEluZm86IEFycmF5PHsgaWQ6IHN0cmluZzsgY291bnQ6IG51bWJlcjsgdHlwZXM6IHN0cmluZ1tdOyBsZXZlbHM6IHN0cmluZ1tdIH0+ID0gW107XG4gICAgICBjb25zdCBncm91cGVkID0gbmV3IE1hcDxzdHJpbmcsIE9ic2VydmFiaWxpdHlMb2dDcmVhdGVJdGVtW10+KCk7XG5cbiAgICAgIGZvciAoY29uc3QgaXRlbSBvZiB2YWxpZEl0ZW1zKSB7XG4gICAgICAgIGNvbnN0IGxpc3QgPSBncm91cGVkLmdldChpdGVtLm9ic2VydmFiaWxpdHlMb2dJZCk7XG4gICAgICAgIGlmIChsaXN0KSBsaXN0LnB1c2goaXRlbSk7XG4gICAgICAgIGVsc2UgZ3JvdXBlZC5zZXQoaXRlbS5vYnNlcnZhYmlsaXR5TG9nSWQsIFsgaXRlbSBdKTtcbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCBbIGlkLCBsaXN0IF0gb2YgZ3JvdXBlZCkge1xuICAgICAgICBpZiAobGlzdC5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgICBjaG9zZW5CeUlkLnNldChpZCwgbGlzdFsgMCBdKTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBsZXQgd2lubmVyID0gbGlzdFsgMCBdO1xuICAgICAgICBmb3IgKGxldCBpID0gMTsgaSA8IGxpc3QubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICB3aW5uZXIgPSBwaWNrV2lubmVyKHdpbm5lciwgbGlzdFsgaSBdKTtcbiAgICAgICAgfVxuICAgICAgICBjaG9zZW5CeUlkLnNldChpZCwgd2lubmVyKTtcbiAgICAgICAgZHVwSW5mby5wdXNoKHtcbiAgICAgICAgICBpZCxcbiAgICAgICAgICBjb3VudDogbGlzdC5sZW5ndGgsXG4gICAgICAgICAgdHlwZXM6IGxpc3QubWFwKCh4KSA9PiBTdHJpbmcoeC50eXBlKSksXG4gICAgICAgICAgbGV2ZWxzOiBsaXN0Lm1hcCgoeCkgPT4gU3RyaW5nKHgubGV2ZWwpKSxcbiAgICAgICAgfSk7XG4gICAgICB9XG5cbiAgICAgIGlmIChkdXBJbmZvLmxlbmd0aCA+IDApIHtcbiAgICAgICAgLy8gRmlsdGVyIG91dCBleHBlY3RlZCBkdXBsaWNhdGVzIChzcGFuLnN0YXJ0ICsgc3BhbiBwYWlycylcbiAgICAgICAgY29uc3QgdW5leHBlY3RlZER1cGxpY2F0ZXMgPSBkdXBJbmZvLmZpbHRlcihkID0+IHtcbiAgICAgICAgICBjb25zdCBpdGVtcyA9IGdyb3VwZWQuZ2V0KGQuaWQpID8/IFtdO1xuICAgICAgICAgIGNvbnN0IHR5cGVzID0gbmV3IFNldChpdGVtcy5tYXAoaSA9PiBpLnR5cGUpKTtcbiAgICAgICAgICAvLyBFeHBlY3RlZDogc3Bhbi5zdGFydCArIHNwYW4gZm9yIHNhbWUgb3BlcmF0aW9uIChsaWZlY3ljbGUpXG4gICAgICAgICAgLy8gVW5leHBlY3RlZDogTXVsdGlwbGUgJ3NwYW4nIG9yIG11bHRpcGxlICdzcGFuLnN0YXJ0JyB3aXRoIHNhbWUgSURcbiAgICAgICAgICBjb25zdCBoYXNTcGFuU3RhcnQgPSB0eXBlcy5oYXMoJ3NwYW4uc3RhcnQnKTtcbiAgICAgICAgICBjb25zdCBoYXNTcGFuID0gdHlwZXMuaGFzKCdzcGFuJyk7XG4gICAgICAgICAgY29uc3QgaXNFeHBlY3RlZFBhaXIgPSBoYXNTcGFuU3RhcnQgJiYgaGFzU3BhbiAmJiB0eXBlcy5zaXplID09PSAyO1xuICAgICAgICAgIHJldHVybiAhaXNFeHBlY3RlZFBhaXI7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGlmICh1bmV4cGVjdGVkRHVwbGljYXRlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgLy8gU2VyaWFsaXplIHVuZXhwZWN0ZWQgZHVwbGljYXRlIGluZm8gZm9yIGRlYnVnZ2luZ1xuICAgICAgICAgIGNvbnN0IGR1cGxpY2F0ZXNGb3JMb2cgPSB1bmV4cGVjdGVkRHVwbGljYXRlcy5zbGljZSgwLCA1KS5tYXAoZCA9PiB7XG4gICAgICAgICAgICBjb25zdCBpdGVtcyA9IGdyb3VwZWQuZ2V0KGQuaWQpID8/IFtdO1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgaWQ6IGQuaWQsXG4gICAgICAgICAgICAgIGNvdW50OiBkLmNvdW50LFxuICAgICAgICAgICAgICB0eXBlczogZC50eXBlcy5qb2luKCcsICcpLFxuICAgICAgICAgICAgICBsZXZlbHM6IGQubGV2ZWxzLmpvaW4oJywgJyksXG4gICAgICAgICAgICAgIG9wZXJhdGlvbnM6IGl0ZW1zLm1hcChpID0+IGkub3BlcmF0aW9uKS5qb2luKCcsICcpLFxuICAgICAgICAgICAgfTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgICAvLyBOT1RFOiBUaGVzZSBhcmUgb2Z0ZW4gbGVnaXRpbWF0ZSByZXBlYXRlZCBvcGVyYXRpb25zIChlLmcuLCBkb3dubG9hZGluZyAyIGltYWdlcywgdXBkYXRpbmcgMyByZWNvcmRzKVxuICAgICAgICAgIC8vIFRoZSBkZWR1cGxpY2F0aW9uIHBpY2tzIGEgd2lubmVyIGNvcnJlY3RseSwgc28gdGhpcyBpcyBERUJVRywgbm90IGFuIEVSUk9SXG4gICAgICAgICAgbG9nZ2VyLmRlYnVnKCdEZWR1cGxpY2F0aW5nIG9ic2VydmFiaWxpdHkgZXZlbnRzIHdpdGggc2FtZSBJRCBpbiBiYXRjaCAocmVwZWF0ZWQgb3BlcmF0aW9ucykuJywge1xuICAgICAgICAgICAgZHVwbGljYXRlSWRDb3VudDogdW5leHBlY3RlZER1cGxpY2F0ZXMubGVuZ3RoLFxuICAgICAgICAgICAgZHVwbGljYXRlczogZHVwbGljYXRlc0ZvckxvZyxcbiAgICAgICAgICAgIHRvdGFsSXRlbXM6IHZhbGlkSXRlbXMubGVuZ3RoLFxuICAgICAgICAgICAgZGVkdXBsaWNhdGVkQ291bnQ6IGNob3NlbkJ5SWQuc2l6ZSxcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjb25zdCBkZWR1cGxpY2F0ZWRJdGVtcyA9IEFycmF5LmZyb20oY2hvc2VuQnlJZC52YWx1ZXMoKSk7XG4gICAgICBpZiAoZGVkdXBsaWNhdGVkSXRlbXMubGVuZ3RoID09PSAwKSByZXR1cm47XG5cbiAgICAgIC8vIEFwcGx5IG9wdGlvbmFsIHRydW5jYXRpb24gKGVudGl0eSBzY2hlbWEgaGFuZGxlcyBjb21wcmVzc2lvbiBhdXRvbWF0aWNhbGx5KVxuICAgICAgY29uc3QgaXRlbXNUb1dyaXRlID0gdGhpcy5jb25maWcudHJ1bmNhdGlvbj8uZW5hYmxlZFxuICAgICAgICA/IGRlZHVwbGljYXRlZEl0ZW1zLm1hcChpdGVtID0+IHRydW5jYXRlSXRlbShpdGVtLCB0aGlzLmNvbmZpZy50cnVuY2F0aW9uIS5maWVsZHMsIHRoaXMuY29uZmlnLnRydW5jYXRpb24hLm1heEJ5dGVzKSlcbiAgICAgICAgOiBkZWR1cGxpY2F0ZWRJdGVtcztcblxuICAgICAgLy8gU2VydmljZSBhdXRvLWNvbXByZXNzZXMgdmlhIGVudGl0eSBzY2hlbWEgKGRhdGEsIG1ldGFkYXRhIGZpZWxkcylcbiAgICAgIGF3YWl0IHRoaXMuc2VydmljZS5iYXRjaENyZWF0ZShpdGVtc1RvV3JpdGUpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAodGhpcy5pc1JldHJ5YWJsZUVycm9yKGVycm9yKSAmJiByZXRyeUNvdW50IDwgTUFYX1JFVFJJRVMpIHtcbiAgICAgICAgbG9nZ2VyLndhcm4oYER5bmFtb0RCIHRyYW5zaWVudCBlcnJvciwgcmV0cnlpbmcgKCR7cmV0cnlDb3VudCArIDF9LyR7TUFYX1JFVFJJRVN9KTpgLCB7XG4gICAgICAgICAgZXJyb3JOYW1lOiAoZXJyb3IgYXMgeyBuYW1lPzogc3RyaW5nIH0pLm5hbWUsXG4gICAgICAgICAgZXJyb3JDb2RlOiAoZXJyb3IgYXMgeyBjb2RlPzogc3RyaW5nIH0pLmNvZGUsXG4gICAgICAgIH0pO1xuICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgMTAwICogKHJldHJ5Q291bnQgKyAxKSkpO1xuICAgICAgICByZXR1cm4gdGhpcy53cml0ZUJhdGNoKGV2ZW50cywgcmV0cnlDb3VudCArIDEpO1xuICAgICAgfVxuXG4gICAgICBsb2dnZXIuZXJyb3IoJ0R5bmFtb0RCIGJhdGNoIHdyaXRlIGZhaWxlZDonLCB7XG4gICAgICAgIGVycm9yOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvciksXG4gICAgICAgIGVycm9yTmFtZTogKGVycm9yIGFzIHsgbmFtZT86IHN0cmluZyB9KS5uYW1lLFxuICAgICAgICBldmVudENvdW50OiBldmVudHMubGVuZ3RoLFxuICAgICAgICBldmVudElkczogZXZlbnRzLm1hcChlID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkKSxcbiAgICAgICAgcmV0cmllZDogcmV0cnlDb3VudCA+IDAsXG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIG1hcEV2ZW50VG9JdGVtKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQsIHR0bFNlY29uZHM6IG51bWJlcik6IE9ic2VydmFiaWxpdHlMb2dDcmVhdGVJdGVtIHtcbiAgICByZXR1cm4ge1xuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiBldmVudC5vYnNlcnZhYmlsaXR5TG9nSWQsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHR5cGVvZiBldmVudC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdzdHJpbmcnXG4gICAgICAgID8gZXZlbnQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkXG4gICAgICAgIDogdW5kZWZpbmVkLFxuICAgICAgY29ycmVsYXRpb25JZDogZXZlbnQuY29ycmVsYXRpb25JZCxcbiAgICAgIGNhdXNlZEJ5OiBldmVudC5jYXVzZWRCeSxcbiAgICAgIHJlbGF0ZWRUcmFjZXM6IGV2ZW50LnJlbGF0ZWRUcmFjZXMsXG4gICAgICB0eXBlOiBldmVudC50eXBlLFxuICAgICAgc3ViVHlwZTogZXZlbnQuc3ViVHlwZSxcbiAgICAgIGxldmVsOiBldmVudC5sZXZlbCxcbiAgICAgIGVudGl0eU5hbWU6IGV2ZW50LmVudGl0eU5hbWUsXG4gICAgICBlbnRpdHlJZDogZXZlbnQuZW50aXR5SWQsXG4gICAgICBvcGVyYXRpb246IGV2ZW50Lm9wZXJhdGlvbixcbiAgICAgIHN0YXR1czogZXZlbnQuc3RhdHVzLFxuICAgICAgc3VjY2VzczogZXZlbnQuc3VjY2VzcyxcbiAgICAgIHRpbWVzdGFtcE1zOiBldmVudC50aW1lc3RhbXBNcyxcbiAgICAgIGR1cmF0aW9uTXM6IGV2ZW50LmR1cmF0aW9uTXMsXG4gICAgICBzb3VyY2U6IGV2ZW50LnNvdXJjZSxcbiAgICAgIHRhZ3M6IGV2ZW50LnRhZ3MsXG4gICAgICBhY3RvcjogZXZlbnQuYWN0b3IsXG4gICAgICBkYXRhOiBldmVudC5kYXRhLFxuICAgICAgYXR0cmlidXRlczogZXZlbnQuYXR0cmlidXRlcyxcbiAgICAgIG1ldGFkYXRhOiBldmVudC5tZXRhZGF0YSxcbiAgICAgIG1ldHJpY3M6IGV2ZW50Lm1ldHJpY3MsXG4gICAgICBjb250ZXh0OiBldmVudC5jb250ZXh0LFxuICAgICAgZXJyb3I6IGV2ZW50LmVycm9yLFxuICAgICAgdHRsOiB0dGxTZWNvbmRzLFxuICAgIH07XG4gIH1cbn1cbiJdfQ==