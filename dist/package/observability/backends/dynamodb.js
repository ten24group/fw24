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
                // Serialize duplicate info with operations for debugging
                const duplicatesForLog = dupInfo.slice(0, 5).map(d => {
                    const items = grouped.get(d.id) ?? [];
                    return {
                        id: d.id,
                        count: d.count,
                        types: d.types.join(', '),
                        levels: d.levels.join(', '),
                        operations: items.map(i => i.operation).join(', '),
                    };
                });
                logger.error('Observability invariant violation: duplicate observabilityLogId(s) in a single DynamoDB batch.', {
                    duplicateIdCount: dupInfo.length,
                    duplicates: duplicatesForLog,
                    totalItems: validItems.length,
                    deduplicatedCount: chosenById.size,
                });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZHluYW1vZGIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9iYWNrZW5kcy9keW5hbW9kYi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7OztHQVNHOzs7Ozs7Ozs7Ozs7O0FBRUgsaUNBQTREO0FBQzVELDJDQUE2QztBQUM3QyxnREFBeUY7QUFFekYsOENBQWdEO0FBRWhELE1BQU0sTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyw4QkFBOEIsQ0FBQyxDQUFDO0FBT3JELElBQU0sNEJBQTRCLEdBQWxDLE1BQU0sNEJBQTRCOztJQVNhO0lBUnBDLElBQUksR0FBRyxVQUFVLENBQUM7SUFDbEIsUUFBUSxDQUFzQjtJQUN0QyxNQUFNLEdBQXlCLEVBQUUsQ0FBQztJQUN6QixNQUFNLENBQWlCO0lBRXhDLFlBQzBDLFFBQTRCLEVBQzVCLE1BQXNCLEVBQ1osT0FBZ0M7UUFBaEMsWUFBTyxHQUFQLE9BQU8sQ0FBeUI7UUFFbEYsSUFBSSxDQUFDLFFBQVEsR0FBRyxRQUFRLENBQUM7UUFDekIsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUM7UUFFckIsSUFBSSxNQUFNLENBQUMsVUFBVSxFQUFFLE9BQU8sRUFBRSxDQUFDO1lBQy9CLE1BQU0sQ0FBQyxJQUFJLENBQUMsMkNBQTJDLEVBQUU7Z0JBQ3ZELE1BQU0sRUFBRSxNQUFNLENBQUMsVUFBVSxDQUFDLE1BQU07Z0JBQ2hDLFFBQVEsRUFBRSxNQUFNLENBQUMsVUFBVSxDQUFDLFFBQVE7YUFDckMsQ0FBQyxDQUFDO1FBQ0wsQ0FBQztJQUNILENBQUM7SUFFRCxvQkFBb0I7UUFDbEIsSUFBSSxDQUFDLE1BQU0sR0FBRyxFQUFFLENBQUM7SUFDbkIsQ0FBQztJQUVELEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBeUI7UUFDckMsaUVBQWlFO1FBQ2pFLDhEQUE4RDtRQUM5RCxJQUFJLEtBQUssQ0FBQyxJQUFJLEtBQUssWUFBWSxF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S0FBSyxDQUFDLE9BQU87WUFDdEIsV0FBVyxFQUFFLEtBQUssQ0FBQyxXQUFXO1lBQzlCLFVBQVUsRUFBRSxLQUFLLENBQUMsVUFBVTtZQUM1QixNQUFNLEVBQUUsS0FBSyxDQUFDLE1BQU07WUFDcEIsSUFBSSxFQUFFLEtBQUssQ0FBQyxJQUFJO1lBQ2hCLEtBQUssRUFBRSxLQUFLLENBQUMsS0FBSztZQUNsQixJQUFJLEVBQUUsS0FBSyxDQUFDLElBQUk7WUFDaEIsVUFBVSxFQUFFLEtBQUssQ0FBQyxVQUFVO1lBQzVCLFFBQVEsRUFBRSxLQUFLLENBQUMsUUFBUTtZQUN4QixPQUFPLEVBQUUsS0FBSyxDQUFDLE9BQU87WUFDdEIsT0FBTyxFQUFFLEtBQUssQ0FBQyxPQUFPO1lBQ3RCLEtBQUssRUFBRSxLQUFLLENBQUMsS0FBSztZQUNsQixHQUFHLEVBQUUsVUFBVTtTQUNoQixDQUFDO0lBQ0osQ0FBQzs7QUE1UFUsb0VBQTRCO3VDQUE1Qiw0QkFBNEI7SUFMeEMsSUFBQSxlQUFVLEVBQUM7UUFDVixPQUFPLEVBQUUsc0JBQXNCO1FBQy9CLFVBQVUsRUFBRSxNQUFNO1FBQ2xCLElBQUksRUFBRSxDQUFFLGVBQWUsRUFBRSxTQUFTLEVBQUUsVUFBVSxDQUFFO0tBQ2pELENBQUM7SUFRRyxXQUFBLElBQUEsaUJBQVksRUFBQyx3QkFBd0IsQ0FBQyxDQUFBO0lBQ3RDLFdBQUEsSUFBQSxpQkFBWSxFQUFDLHdCQUF3QixDQUFDLENBQUE7SUFDdEMsV0FBQSxJQUFBLFdBQU0sRUFBQyxpQ0FBdUIsQ0FBQyxDQUFBO0dBVHZCLDRCQUE0QixDQTZQeEMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIER5bmFtb0RCIEJhY2tlbmQgZm9yIE9ic2VydmFiaWxpdHlcbiAqIFxuICogU3RvcmVzIGFsbCBvYnNlcnZhYmlsaXR5IGV2ZW50cyBpbiBEeW5hbW9EQi5cbiAqIFxuICogKipTaXplIE1hbmFnZW1lbnQ6KipcbiAqIC0gRW50aXR5IHNjaGVtYSBhdXRvLWNvbXByZXNzZXMgZmllbGRzIChkYXRhLCBtZXRhZGF0YSkgdmlhIGBjb21wcmVzc2VkOiB0cnVlYFxuICogLSBPcHRpb25hbCB0cnVuY2F0aW9uIGFwcGxpZWQgaGVyZSAoaWYgZW5hYmxlZCBpbiBjb25maWcpXG4gKiAtIEFsbCBjb25maWcgaW5qZWN0ZWQgdmlhIERJXG4gKi9cblxuaW1wb3J0IHsgSW5qZWN0LCBJbmplY3RhYmxlLCBJbmplY3RDb25maWcgfSBmcm9tICcuLi8uLi9kaSc7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIgfSBmcm9tICcuLi8uLi9sb2dnaW5nJztcbmltcG9ydCB7IE9ic2VydmFiaWxpdHlMb2dDcmVhdGVJdGVtLCBPYnNlcnZhYmlsaXR5TG9nU2VydmljZSB9IGZyb20gJy4uL3N0b3JhZ2Uvc2VydmljZSc7XG5pbXBvcnQgeyBPYnNlcnZhYmlsaXR5QmFja2VuZCwgT2JzZXJ2YWJpbGl0eUV2ZW50LCBPYnNlcnZhYmlsaXR5TGV2ZWwsIER5bmFtb0RCQ29uZmlnIH0gZnJvbSAnLi4vdHlwZXMnO1xuaW1wb3J0IHsgdHJ1bmNhdGVJdGVtIH0gZnJvbSAnLi4vdXRpbHMvcGF5bG9hZCc7XG5cbmNvbnN0IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignRHluYW1vREJPYnNlcnZhYmlsaXR5QmFja2VuZCcpO1xuXG5ASW5qZWN0YWJsZSh7XG4gIHByb3ZpZGU6ICdPYnNlcnZhYmlsaXR5QmFja2VuZCcsXG4gIHByb3ZpZGVkSW46ICdST09UJyxcbiAgdGFnczogWyAnb2JzZXJ2YWJpbGl0eScsICdiYWNrZW5kJywgJ2R5bmFtb2RiJyBdXG59KVxuZXhwb3J0IGNsYXNzIER5bmFtb0RCT2JzZXJ2YWJpbGl0eUJhY2tlbmQgaW1wbGVtZW50cyBPYnNlcnZhYmlsaXR5QmFja2VuZCB7XG4gIHB1YmxpYyByZWFkb25seSBuYW1lID0gJ2R5bmFtb2RiJztcbiAgcHVibGljIHJlYWRvbmx5IG1pbkxldmVsPzogT2JzZXJ2YWJpbGl0eUxldmVsO1xuICBwcml2YXRlIGJ1ZmZlcjogT2JzZXJ2YWJpbGl0eUV2ZW50W10gPSBbXTtcbiAgcHJpdmF0ZSByZWFkb25seSBjb25maWc6IER5bmFtb0RCQ29uZmlnO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIEBJbmplY3RDb25maWcoJ29ic2VydmFiaWxpdHkubWluTGV2ZWwnKSBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLFxuICAgIEBJbmplY3RDb25maWcoJ29ic2VydmFiaWxpdHkuZHluYW1vZGInKSBjb25maWc6IER5bmFtb0RCQ29uZmlnLFxuICAgIEBJbmplY3QoT2JzZXJ2YWJpbGl0eUxvZ1NlcnZpY2UpIHByaXZhdGUgcmVhZG9ubHkgc2VydmljZTogT2JzZXJ2YWJpbGl0eUxvZ1NlcnZpY2VcbiAgKSB7XG4gICAgdGhpcy5taW5MZXZlbCA9IG1pbkxldmVsO1xuICAgIHRoaXMuY29uZmlnID0gY29uZmlnO1xuXG4gICAgaWYgKGNvbmZpZy50cnVuY2F0aW9uPy5lbmFibGVkKSB7XG4gICAgICBsb2dnZXIuaW5mbygnVHJ1bmNhdGlvbiBlbmFibGVkIGZvciBvYnNlcnZhYmlsaXR5IGxvZ3MnLCB7XG4gICAgICAgIGZpZWxkczogY29uZmlnLnRydW5jYXRpb24uZmllbGRzLFxuICAgICAgICBtYXhCeXRlczogY29uZmlnLnRydW5jYXRpb24ubWF4Qnl0ZXNcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIGluaXRpYWxpemVJbnZvY2F0aW9uKCk6IHZvaWQge1xuICAgIHRoaXMuYnVmZmVyID0gW107XG4gIH1cblxuICBhc3luYyBjYXB0dXJlKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAvLyBDUklUSUNBTDogc3Bhbi5zdGFydCBldmVudHMgc2hvdWxkIE5FVkVSIGJlIHN0b3JlZCBpbiBEeW5hbW9EQlxuICAgIC8vIFRoZXkgYXJlIG9ubHkgZm9yIE9URUwncyBzcGFuIHRyYWNraW5nLiBTa2lwIHRoZW0gZW50aXJlbHkuXG4gICAgaWYgKGV2ZW50LnR5cGUgPT09ICdzcGFuLnN0YXJ0Jykge1xuICAgICAgLy8gVGhpcyBzaG91bGRuJ3QgaGFwcGVuIGlmIGZpbHRlcmluZyB3b3JrcywgYnV0IGd1YXJkIGFnYWluc3QgaXRcbiAgICAgIGxvZ2dlci5kZWJ1ZygnU2tpcHBpbmcgc3Bhbi5zdGFydCBldmVudCBpbiBEeW5hbW9EQiBiYWNrZW5kJywge1xuICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6IGV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZCxcbiAgICAgICAgb3BlcmF0aW9uOiBldmVudC5vcGVyYXRpb24sXG4gICAgICB9KTtcbiAgICAgIHJldHVybjsgLy8gU2tpcCAtIGRvIE5PVCBidWZmZXJcbiAgICB9XG5cbiAgICB0aGlzLmJ1ZmZlci5wdXNoKGV2ZW50KTtcblxuICAgIGlmICh0aGlzLmJ1ZmZlci5sZW5ndGggPj0gKHRoaXMuY29uZmlnLm1heEJhdGNoU2l6ZSA/PyAyNSkpIHtcbiAgICAgIGF3YWl0IHRoaXMuZmx1c2goKTtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5idWZmZXIubGVuZ3RoID49ICh0aGlzLmNvbmZpZy5tYXhCdWZmZXJTaXplID8/IDEwMDApKSB7XG4gICAgICBsb2dnZXIud2FybihgQnVmZmVyIG92ZXJmbG93ICgke3RoaXMuYnVmZmVyLmxlbmd0aH0gZXZlbnRzKSwgZm9yY2UgZmx1c2hpbmdgKTtcbiAgICAgIGF3YWl0IHRoaXMuZmx1c2goKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBmbHVzaCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAodGhpcy5idWZmZXIubGVuZ3RoID09PSAwKSByZXR1cm47XG5cbiAgICBjb25zdCBldmVudHMgPSB0aGlzLmJ1ZmZlci5zcGxpY2UoMCwgdGhpcy5idWZmZXIubGVuZ3RoKTtcbiAgICBjb25zdCBiYXRjaFNpemUgPSB0aGlzLmNvbmZpZy5tYXhCYXRjaFNpemUgPz8gMjU7XG5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGV2ZW50cy5sZW5ndGg7IGkgKz0gYmF0Y2hTaXplKSB7XG4gICAgICBjb25zdCBiYXRjaCA9IGV2ZW50cy5zbGljZShpLCBpICsgYmF0Y2hTaXplKTtcbiAgICAgIGF3YWl0IHRoaXMud3JpdGVCYXRjaChiYXRjaCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBzdGF0aWMgcmVhZG9ubHkgUkVUUllBQkxFX0VSUk9SUyA9IG5ldyBTZXQoW1xuICAgICdQcm92aXNpb25lZFRocm91Z2hwdXRFeGNlZWRlZEV4Y2VwdGlvbicsXG4gICAgJ1Rocm90dGxpbmdFeGNlcHRpb24nLFxuICAgICdSZXF1ZXN0TGltaXRFeGNlZWRlZCcsXG4gICAgJ0ludGVybmFsU2VydmVyRXJyb3InLFxuICAgICdTZXJ2aWNlVW5hdmFpbGFibGUnLFxuICBdKTtcblxuICBwcml2YXRlIGlzUmV0cnlhYmxlRXJyb3IoZXJyb3I6IHVua25vd24pOiBib29sZWFuIHtcbiAgICBpZiAoIWVycm9yIHx8IHR5cGVvZiBlcnJvciAhPT0gJ29iamVjdCcpIHJldHVybiBmYWxzZTtcblxuICAgIGNvbnN0IGVycm9yTmFtZSA9IChlcnJvciBhcyB7IG5hbWU/OiBzdHJpbmcgfSkubmFtZTtcbiAgICBpZiAoZXJyb3JOYW1lICYmIER5bmFtb0RCT2JzZXJ2YWJpbGl0eUJhY2tlbmQuUkVUUllBQkxFX0VSUk9SUy5oYXMoZXJyb3JOYW1lKSkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgY29uc3QgZXJyb3JDb2RlID0gKGVycm9yIGFzIHsgY29kZT86IHN0cmluZyB9KS5jb2RlO1xuICAgIGlmIChlcnJvckNvZGUgJiYgRHluYW1vREJPYnNlcnZhYmlsaXR5QmFja2VuZC5SRVRSWUFCTEVfRVJST1JTLmhhcyhlcnJvckNvZGUpKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICBjb25zdCBtZXRhZGF0YSA9IChlcnJvciBhcyB7ICRtZXRhZGF0YT86IHsgaHR0cFN0YXR1c0NvZGU/OiBudW1iZXIgfSB9KS4kbWV0YWRhdGE7XG4gICAgaWYgKG1ldGFkYXRhPy5odHRwU3RhdHVzQ29kZSAmJiBtZXRhZGF0YS5odHRwU3RhdHVzQ29kZSA+PSA1MDApIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgd3JpdGVCYXRjaChldmVudHM6IE9ic2VydmFiaWxpdHlFdmVudFtdLCByZXRyeUNvdW50ID0gMCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IE1BWF9SRVRSSUVTID0gMjtcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBub3dTZWNvbmRzID0gTWF0aC5mbG9vcihEYXRlLm5vdygpIC8gMTAwMCk7XG5cbiAgICAgIGNvbnN0IGl0ZW1zID0gZXZlbnRzLm1hcCgoZXZlbnQpID0+IHtcbiAgICAgICAgY29uc3QgdHRsRGF5cyA9IGV2ZW50LmNhcHR1cmU/LnR0bERheXMgPz8gdGhpcy5jb25maWcudHRsRGF5cztcbiAgICAgICAgY29uc3QgdHRsU2Vjb25kcyA9IG5vd1NlY29uZHMgKyB0dGxEYXlzICogMjQgKiA2MCAqIDYwO1xuICAgICAgICByZXR1cm4gdGhpcy5tYXBFdmVudFRvSXRlbShldmVudCwgdHRsU2Vjb25kcyk7XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgdmFsaWRJdGVtcyA9IGl0ZW1zLmZpbHRlcigoaXRlbSk6IGl0ZW0gaXMgT2JzZXJ2YWJpbGl0eUxvZ0NyZWF0ZUl0ZW0gJiB7IG9ic2VydmFiaWxpdHlMb2dJZDogc3RyaW5nIH0gPT4ge1xuICAgICAgICBpZiAoIWl0ZW0ub2JzZXJ2YWJpbGl0eUxvZ0lkKSB7XG4gICAgICAgICAgbG9nZ2VyLndhcm4oJ0l0ZW0gbWlzc2luZyBvYnNlcnZhYmlsaXR5TG9nSWQsIHNraXBwaW5nJyk7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfSk7XG5cbiAgICAgIGlmICh2YWxpZEl0ZW1zLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuXG4gICAgICAvLyBCYXRjaFdyaXRlSXRlbSBmYWlscyB3aGVuIHRoZSBzYW1lIFBLIGFwcGVhcnMgbXVsdGlwbGUgdGltZXMgaW4gYSBzaW5nbGUgYmF0Y2guXG4gICAgICAvLyBVbmRlciBGVzI0LCBvYnNlcnZhYmlsaXR5TG9nSWQgTVVTVCBiZSBnbG9iYWxseSB1bmlxdWUgcGVyIHJlY29yZC5cbiAgICAgIC8vIElmIGR1cGxpY2F0ZXMgaGFwcGVuLCBpdCBpcyBhbiBpbnZhcmlhbnQgdmlvbGF0aW9uLiBXZSBjaG9vc2UgYSBkZXRlcm1pbmlzdGljIHdpbm5lciBhbmQgbG9nIGxvdWRseS5cbiAgICAgIGNvbnN0IGxldmVsUmFuayA9IChsZXZlbDogdW5rbm93bik6IG51bWJlciA9PiB7XG4gICAgICAgIHN3aXRjaCAobGV2ZWwpIHtcbiAgICAgICAgICBjYXNlICdjcml0aWNhbCc6IHJldHVybiA1MDtcbiAgICAgICAgICBjYXNlICdlcnJvcic6IHJldHVybiA0MDtcbiAgICAgICAgICBjYXNlICd3YXJuJzogcmV0dXJuIDMwO1xuICAgICAgICAgIGNhc2UgJ2luZm8nOiByZXR1cm4gMjA7XG4gICAgICAgICAgY2FzZSAnZGVidWcnOiByZXR1cm4gMTA7XG4gICAgICAgICAgY2FzZSAndHJhY2UnOiByZXR1cm4gMDtcbiAgICAgICAgICBkZWZhdWx0OiByZXR1cm4gLTE7XG4gICAgICAgIH1cbiAgICAgIH07XG4gICAgICBjb25zdCBwaWNrV2lubmVyID0gKGE6IE9ic2VydmFiaWxpdHlMb2dDcmVhdGVJdGVtLCBiOiBPYnNlcnZhYmlsaXR5TG9nQ3JlYXRlSXRlbSk6IE9ic2VydmFiaWxpdHlMb2dDcmVhdGVJdGVtID0+IHtcbiAgICAgICAgY29uc3QgbGEgPSBsZXZlbFJhbmsoYS5sZXZlbCk7XG4gICAgICAgIGNvbnN0IGxiID0gbGV2ZWxSYW5rKGIubGV2ZWwpO1xuICAgICAgICBpZiAobGEgIT09IGxiKSByZXR1cm4gbGEgPiBsYiA/IGEgOiBiO1xuXG4gICAgICAgIC8vIERldGVybWluaXN0aWMgdGllLWJyZWFrZXI6IGtlZXAgZWFybGllciB0aW1lc3RhbXBNcy5cbiAgICAgICAgLy8gdGltZXN0YW1wTXMgaXMgZXhwZWN0ZWQgZm9yIHBlcnNpc3RlZCByZWNvcmRzOyBpZiBpdCdzIG1pc3NpbmcsIHRyZWF0IGl0IGFzIFwibGF0ZXN0XCIgKGtlZXAgdGhlIG90aGVyKS5cbiAgICAgICAgY29uc3QgdHNhID0gYS50aW1lc3RhbXBNcztcbiAgICAgICAgY29uc3QgdHNiID0gYi50aW1lc3RhbXBNcztcbiAgICAgICAgaWYgKHR5cGVvZiB0c2EgPT09ICdudW1iZXInICYmIHR5cGVvZiB0c2IgPT09ICdudW1iZXInKSB7XG4gICAgICAgICAgcmV0dXJuIHRzYSA8PSB0c2IgPyBhIDogYjtcbiAgICAgICAgfVxuICAgICAgICBpZiAodHlwZW9mIHRzYSA9PT0gJ251bWJlcicpIHJldHVybiBhO1xuICAgICAgICBpZiAodHlwZW9mIHRzYiA9PT0gJ251bWJlcicpIHJldHVybiBiO1xuICAgICAgICByZXR1cm4gYTtcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGNob3NlbkJ5SWQgPSBuZXcgTWFwPHN0cmluZywgT2JzZXJ2YWJpbGl0eUxvZ0NyZWF0ZUl0ZW0+KCk7XG4gICAgICBjb25zdCBkdXBJbmZvOiBBcnJheTx7IGlkOiBzdHJpbmc7IGNvdW50OiBudW1iZXI7IHR5cGVzOiBzdHJpbmdbXTsgbGV2ZWxzOiBzdHJpbmdbXSB9PiA9IFtdO1xuICAgICAgY29uc3QgZ3JvdXBlZCA9IG5ldyBNYXA8c3RyaW5nLCBPYnNlcnZhYmlsaXR5TG9nQ3JlYXRlSXRlbVtdPigpO1xuXG4gICAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgdmFsaWRJdGVtcykge1xuICAgICAgICBjb25zdCBsaXN0ID0gZ3JvdXBlZC5nZXQoaXRlbS5vYnNlcnZhYmlsaXR5TG9nSWQpO1xuICAgICAgICBpZiAobGlzdCkgbGlzdC5wdXNoKGl0ZW0pO1xuICAgICAgICBlbHNlIGdyb3VwZWQuc2V0KGl0ZW0ub2JzZXJ2YWJpbGl0eUxvZ0lkLCBbIGl0ZW0gXSk7XG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3QgWyBpZCwgbGlzdCBdIG9mIGdyb3VwZWQpIHtcbiAgICAgICAgaWYgKGxpc3QubGVuZ3RoID09PSAxKSB7XG4gICAgICAgICAgY2hvc2VuQnlJZC5zZXQoaWQsIGxpc3RbIDAgXSk7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgbGV0IHdpbm5lciA9IGxpc3RbIDAgXTtcbiAgICAgICAgZm9yIChsZXQgaSA9IDE7IGkgPCBsaXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgd2lubmVyID0gcGlja1dpbm5lcih3aW5uZXIsIGxpc3RbIGkgXSk7XG4gICAgICAgIH1cbiAgICAgICAgY2hvc2VuQnlJZC5zZXQoaWQsIHdpbm5lcik7XG4gICAgICAgIGR1cEluZm8ucHVzaCh7XG4gICAgICAgICAgaWQsXG4gICAgICAgICAgY291bnQ6IGxpc3QubGVuZ3RoLFxuICAgICAgICAgIHR5cGVzOiBsaXN0Lm1hcCgoeCkgPT4gU3RyaW5nKHgudHlwZSkpLFxuICAgICAgICAgIGxldmVsczogbGlzdC5tYXAoKHgpID0+IFN0cmluZyh4LmxldmVsKSksXG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICBpZiAoZHVwSW5mby5sZW5ndGggPiAwKSB7XG4gICAgICAgIC8vIFNlcmlhbGl6ZSBkdXBsaWNhdGUgaW5mbyB3aXRoIG9wZXJhdGlvbnMgZm9yIGRlYnVnZ2luZ1xuICAgICAgICBjb25zdCBkdXBsaWNhdGVzRm9yTG9nID0gZHVwSW5mby5zbGljZSgwLCA1KS5tYXAoZCA9PiB7XG4gICAgICAgICAgY29uc3QgaXRlbXMgPSBncm91cGVkLmdldChkLmlkKSA/PyBbXTtcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgaWQ6IGQuaWQsXG4gICAgICAgICAgICBjb3VudDogZC5jb3VudCxcbiAgICAgICAgICAgIHR5cGVzOiBkLnR5cGVzLmpvaW4oJywgJyksXG4gICAgICAgICAgICBsZXZlbHM6IGQubGV2ZWxzLmpvaW4oJywgJyksXG4gICAgICAgICAgICBvcGVyYXRpb25zOiBpdGVtcy5tYXAoaSA9PiBpLm9wZXJhdGlvbikuam9pbignLCAnKSxcbiAgICAgICAgICB9O1xuICAgICAgICB9KTtcbiAgICAgICAgbG9nZ2VyLmVycm9yKCdPYnNlcnZhYmlsaXR5IGludmFyaWFudCB2aW9sYXRpb246IGR1cGxpY2F0ZSBvYnNlcnZhYmlsaXR5TG9nSWQocykgaW4gYSBzaW5nbGUgRHluYW1vREIgYmF0Y2guJywge1xuICAgICAgICAgIGR1cGxpY2F0ZUlkQ291bnQ6IGR1cEluZm8ubGVuZ3RoLFxuICAgICAgICAgIGR1cGxpY2F0ZXM6IGR1cGxpY2F0ZXNGb3JMb2csXG4gICAgICAgICAgdG90YWxJdGVtczogdmFsaWRJdGVtcy5sZW5ndGgsXG4gICAgICAgICAgZGVkdXBsaWNhdGVkQ291bnQ6IGNob3NlbkJ5SWQuc2l6ZSxcbiAgICAgICAgfSk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGRlZHVwbGljYXRlZEl0ZW1zID0gQXJyYXkuZnJvbShjaG9zZW5CeUlkLnZhbHVlcygpKTtcbiAgICAgIGlmIChkZWR1cGxpY2F0ZWRJdGVtcy5sZW5ndGggPT09IDApIHJldHVybjtcblxuICAgICAgLy8gQXBwbHkgb3B0aW9uYWwgdHJ1bmNhdGlvbiAoZW50aXR5IHNjaGVtYSBoYW5kbGVzIGNvbXByZXNzaW9uIGF1dG9tYXRpY2FsbHkpXG4gICAgICBjb25zdCBpdGVtc1RvV3JpdGUgPSB0aGlzLmNvbmZpZy50cnVuY2F0aW9uPy5lbmFibGVkXG4gICAgICAgID8gZGVkdXBsaWNhdGVkSXRlbXMubWFwKGl0ZW0gPT4gdHJ1bmNhdGVJdGVtKGl0ZW0sIHRoaXMuY29uZmlnLnRydW5jYXRpb24hLmZpZWxkcywgdGhpcy5jb25maWcudHJ1bmNhdGlvbiEubWF4Qnl0ZXMpKVxuICAgICAgICA6IGRlZHVwbGljYXRlZEl0ZW1zO1xuXG4gICAgICAvLyBTZXJ2aWNlIGF1dG8tY29tcHJlc3NlcyB2aWEgZW50aXR5IHNjaGVtYSAoZGF0YSwgbWV0YWRhdGEgZmllbGRzKVxuICAgICAgYXdhaXQgdGhpcy5zZXJ2aWNlLmJhdGNoQ3JlYXRlKGl0ZW1zVG9Xcml0ZSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmICh0aGlzLmlzUmV0cnlhYmxlRXJyb3IoZXJyb3IpICYmIHJldHJ5Q291bnQgPCBNQVhfUkVUUklFUykge1xuICAgICAgICBsb2dnZXIud2FybihgRHluYW1vREIgdHJhbnNpZW50IGVycm9yLCByZXRyeWluZyAoJHtyZXRyeUNvdW50ICsgMX0vJHtNQVhfUkVUUklFU30pOmAsIHtcbiAgICAgICAgICBlcnJvck5hbWU6IChlcnJvciBhcyB7IG5hbWU/OiBzdHJpbmcgfSkubmFtZSxcbiAgICAgICAgICBlcnJvckNvZGU6IChlcnJvciBhcyB7IGNvZGU/OiBzdHJpbmcgfSkuY29kZSxcbiAgICAgICAgfSk7XG4gICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCAxMDAgKiAocmV0cnlDb3VudCArIDEpKSk7XG4gICAgICAgIHJldHVybiB0aGlzLndyaXRlQmF0Y2goZXZlbnRzLCByZXRyeUNvdW50ICsgMSk7XG4gICAgICB9XG5cbiAgICAgIGxvZ2dlci5lcnJvcignRHluYW1vREIgYmF0Y2ggd3JpdGUgZmFpbGVkOicsIHtcbiAgICAgICAgZXJyb3I6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKSxcbiAgICAgICAgZXJyb3JOYW1lOiAoZXJyb3IgYXMgeyBuYW1lPzogc3RyaW5nIH0pLm5hbWUsXG4gICAgICAgIGV2ZW50Q291bnQ6IGV2ZW50cy5sZW5ndGgsXG4gICAgICAgIGV2ZW50SWRzOiBldmVudHMubWFwKGUgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQpLFxuICAgICAgICByZXRyaWVkOiByZXRyeUNvdW50ID4gMCxcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgbWFwRXZlbnRUb0l0ZW0oZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCwgdHRsU2Vjb25kczogbnVtYmVyKTogT2JzZXJ2YWJpbGl0eUxvZ0NyZWF0ZUl0ZW0ge1xuICAgIHJldHVybiB7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6IGV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZCxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogdHlwZW9mIGV2ZW50LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ3N0cmluZydcbiAgICAgICAgPyBldmVudC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWRcbiAgICAgICAgOiB1bmRlZmluZWQsXG4gICAgICBjb3JyZWxhdGlvbklkOiBldmVudC5jb3JyZWxhdGlvbklkLFxuICAgICAgY2F1c2VkQnk6IGV2ZW50LmNhdXNlZEJ5LFxuICAgICAgcmVsYXRlZFRyYWNlczogZXZlbnQucmVsYXRlZFRyYWNlcyxcbiAgICAgIHR5cGU6IGV2ZW50LnR5cGUsXG4gICAgICBzdWJUeXBlOiBldmVudC5zdWJUeXBlLFxuICAgICAgbGV2ZWw6IGV2ZW50LmxldmVsLFxuICAgICAgZW50aXR5TmFtZTogZXZlbnQuZW50aXR5TmFtZSxcbiAgICAgIGVudGl0eUlkOiBldmVudC5lbnRpdHlJZCxcbiAgICAgIG9wZXJhdGlvbjogZXZlbnQub3BlcmF0aW9uLFxuICAgICAgc3RhdHVzOiBldmVudC5zdGF0dXMsXG4gICAgICBzdWNjZXNzOiBldmVudC5zdWNjZXNzLFxuICAgICAgdGltZXN0YW1wTXM6IGV2ZW50LnRpbWVzdGFtcE1zLFxuICAgICAgZHVyYXRpb25NczogZXZlbnQuZHVyYXRpb25NcyxcbiAgICAgIHNvdXJjZTogZXZlbnQuc291cmNlLFxuICAgICAgdGFnczogZXZlbnQudGFncyxcbiAgICAgIGFjdG9yOiBldmVudC5hY3RvcixcbiAgICAgIGRhdGE6IGV2ZW50LmRhdGEsXG4gICAgICBhdHRyaWJ1dGVzOiBldmVudC5hdHRyaWJ1dGVzLFxuICAgICAgbWV0YWRhdGE6IGV2ZW50Lm1ldGFkYXRhLFxuICAgICAgbWV0cmljczogZXZlbnQubWV0cmljcyxcbiAgICAgIGNvbnRleHQ6IGV2ZW50LmNvbnRleHQsXG4gICAgICBlcnJvcjogZXZlbnQuZXJyb3IsXG4gICAgICB0dGw6IHR0bFNlY29uZHMsXG4gICAgfTtcbiAgfVxufVxuIl19