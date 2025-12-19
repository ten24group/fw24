"use strict";
/**
 * DynamoDB Backend for Observability
 *
 * Stores all observability events in DynamoDB.
 * All config injected via DI - no fallbacks.
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
// DynamoDB limits
const DYNAMO_BATCH_SIZE = 25;
const DYNAMO_MAX_ITEM_SIZE = 400 * 1024; // 400KB per item
const MAX_BUFFER_SIZE = 1000;
let DynamoDBObservabilityBackend = class DynamoDBObservabilityBackend {
    static { DynamoDBObservabilityBackend_1 = this; }
    service;
    name = 'dynamodb';
    minLevel;
    buffer = [];
    ttlDays;
    constructor(ttlDays, minLevel, service) {
        this.service = service;
        this.minLevel = minLevel;
        this.ttlDays = ttlDays;
    }
    initializeInvocation() {
        this.buffer = [];
    }
    async capture(event) {
        this.buffer.push(event);
        if (this.buffer.length >= DYNAMO_BATCH_SIZE) {
            await this.flush();
        }
        if (this.buffer.length >= MAX_BUFFER_SIZE) {
            logger.warn(`Buffer overflow (${this.buffer.length} events), force flushing`);
            await this.flush();
        }
    }
    async flush() {
        if (this.buffer.length === 0)
            return;
        const events = this.buffer.splice(0, this.buffer.length);
        for (let i = 0; i < events.length; i += DYNAMO_BATCH_SIZE) {
            const batch = events.slice(i, i + DYNAMO_BATCH_SIZE);
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
            const ttlSeconds = Math.floor(Date.now() / 1000) + this.ttlDays * 24 * 60 * 60;
            const items = events.map((event) => this.mapEventToItem(event, ttlSeconds));
            const validItems = items.filter((item) => {
                const size = (0, payload_1.estimateItemSize)(item);
                if (size > DYNAMO_MAX_ITEM_SIZE) {
                    logger.warn(`Item too large (${size} bytes), skipping:`, {
                        observabilityLogId: item.observabilityLogId,
                        type: item.type,
                        size,
                    });
                    return false;
                }
                return true;
            });
            if (validItems.length === 0)
                return;
            await this.service.batchCreate(validItems);
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
            parentObservabilityLogId: event.parentObservabilityLogId,
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
            actor: event.actor ? (0, payload_1.truncatePayload)(event.actor) : undefined,
            data: event.data ? (0, payload_1.truncatePayload)(event.data) : undefined,
            attributes: event.attributes ? (0, payload_1.truncatePayload)(event.attributes) : undefined,
            metadata: event.metadata ? (0, payload_1.truncatePayload)(event.metadata) : undefined,
            metrics: event.metrics,
            context: event.context ? (0, payload_1.truncatePayload)(event.context) : undefined,
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
    __param(0, (0, di_1.InjectConfig)('observability.dynamodb.ttlDays')),
    __param(1, (0, di_1.InjectConfig)('observability.minLevel')),
    __param(2, (0, di_1.Inject)(service_1.ObservabilityLogService))
], DynamoDBObservabilityBackend);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZHluYW1vZGIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9iYWNrZW5kcy9keW5hbW9kYi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7O0dBS0c7Ozs7Ozs7Ozs7Ozs7QUFFSCxpQ0FBNEQ7QUFDNUQsMkNBQTZDO0FBQzdDLGdEQUF5RjtBQUV6Riw4Q0FBcUU7QUFFckUsTUFBTSxNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLDhCQUE4QixDQUFDLENBQUM7QUFFNUQsa0JBQWtCO0FBQ2xCLE1BQU0saUJBQWlCLEdBQUcsRUFBRSxDQUFDO0FBQzdCLE1BQU0sb0JBQW9CLEdBQUcsR0FBRyxHQUFHLElBQUksQ0FBQyxDQUFDLGlCQUFpQjtBQUMxRCxNQUFNLGVBQWUsR0FBRyxJQUFJLENBQUM7QUFPdEIsSUFBTSw0QkFBNEIsR0FBbEMsTUFBTSw0QkFBNEI7O0lBVWE7SUFUcEMsSUFBSSxHQUFHLFVBQVUsQ0FBQztJQUNsQixRQUFRLENBQXNCO0lBRXRDLE1BQU0sR0FBeUIsRUFBRSxDQUFDO0lBQ3pCLE9BQU8sQ0FBUztJQUVqQyxZQUNrRCxPQUFlLEVBQ3ZCLFFBQTRCLEVBQ2xCLE9BQWdDO1FBQWhDLFlBQU8sR0FBUCxPQUFPLENBQXlCO1FBRWxGLElBQUksQ0FBQyxRQUFRLEdBQUcsUUFBUSxDQUFDO1FBQ3pCLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFDO0lBQ3pCLENBQUM7SUFFRCxvQkFBb0I7UUFDbEIsSUFBSSxDQUFDLE1BQU0sR0FBRyxFQUFFLENBQUM7SUFDbkIsQ0FBQztJQUVELEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBeUI7UUFDckMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUM7UUFFeEIsSUFBSSxJQUFJLENBQUMsTUFBTSxDQUFDLE1BQU0sSUFBSSxpQkFBaUIsRUFBRSxDQUFDO1lBQzVDLE1BQU0sSUFBSSxDQUFD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LElBQUksRUFBRSxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFBLHlCQUFlLEVBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTO1lBQzFELFVBQVUsRUFBRSxLQUFLLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxJQUFBLHlCQUFlLEVBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTO1lBQzVFLFFBQVEsRUFBRSxLQUFLLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxJQUFBLHlCQUFlLEVBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTO1lBQ3RFLE9BQU8sRUFBRSxLQUFLLENBQUMsT0FBTztZQUN0QixPQUFPLEVBQUUsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsSUFBQSx5QkFBZSxFQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUztZQUNuRSxLQUFLLEVBQUUsS0FBSyxDQUFDLEtBQUs7WUFDbEIsR0FBRyxFQUFFLFVBQVU7U0FDYyxDQUFDO0lBQ2xDLENBQUM7O0FBakpVLG9FQUE0Qjt1Q0FBNUIsNEJBQTRCO0lBTHhDLElBQUEsZUFBVSxFQUFDO1FBQ1YsT0FBTyxFQUFFLHNCQUFzQjtRQUMvQixVQUFVLEVBQUUsTUFBTTtRQUNsQixJQUFJLEVBQUUsQ0FBRSxlQUFlLEVBQUUsU0FBUyxFQUFFLFVBQVUsQ0FBRTtLQUNqRCxDQUFDO0lBU0csV0FBQSxJQUFBLGlCQUFZLEVBQUMsZ0NBQWdDLENBQUMsQ0FBQTtJQUM5QyxXQUFBLElBQUEsaUJBQVksRUFBQyx3QkFBd0IsQ0FBQyxDQUFBO0lBQ3RDLFdBQUEsSUFBQSxXQUFNLEVBQUMsaUNBQXVCLENBQUMsQ0FBQTtHQVZ2Qiw0QkFBNEIsQ0FrSnhDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBEeW5hbW9EQiBCYWNrZW5kIGZvciBPYnNlcnZhYmlsaXR5XG4gKiBcbiAqIFN0b3JlcyBhbGwgb2JzZXJ2YWJpbGl0eSBldmVudHMgaW4gRHluYW1vREIuXG4gKiBBbGwgY29uZmlnIGluamVjdGVkIHZpYSBESSAtIG5vIGZhbGxiYWNrcy5cbiAqL1xuXG5pbXBvcnQgeyBJbmplY3QsIEluamVjdGFibGUsIEluamVjdENvbmZpZyB9IGZyb20gJy4uLy4uL2RpJztcbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gJy4uLy4uL2xvZ2dpbmcnO1xuaW1wb3J0IHsgT2JzZXJ2YWJpbGl0eUxvZ0NyZWF0ZUl0ZW0sIE9ic2VydmFiaWxpdHlMb2dTZXJ2aWNlIH0gZnJvbSAnLi4vc3RvcmFnZS9zZXJ2aWNlJztcbmltcG9ydCB7IE9ic2VydmFiaWxpdHlCYWNrZW5kLCBPYnNlcnZhYmlsaXR5RXZlbnQsIE9ic2VydmFiaWxpdHlMZXZlbCB9IGZyb20gJy4uL3R5cGVzJztcbmltcG9ydCB7IGVzdGltYXRlSXRlbVNpemUsIHRydW5jYXRlUGF5bG9hZCB9IGZyb20gJy4uL3V0aWxzL3BheWxvYWQnO1xuXG5jb25zdCBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ0R5bmFtb0RCT2JzZXJ2YWJpbGl0eUJhY2tlbmQnKTtcblxuLy8gRHluYW1vREIgbGltaXRzXG5jb25zdCBEWU5BTU9fQkFUQ0hfU0laRSA9IDI1O1xuY29uc3QgRFlOQU1PX01BWF9JVEVNX1NJWkUgPSA0MDAgKiAxMDI0OyAvLyA0MDBLQiBwZXIgaXRlbVxuY29uc3QgTUFYX0JVRkZFUl9TSVpFID0gMTAwMDtcblxuQEluamVjdGFibGUoe1xuICBwcm92aWRlOiAnT2JzZXJ2YWJpbGl0eUJhY2tlbmQnLFxuICBwcm92aWRlZEluOiAnUk9PVCcsXG4gIHRhZ3M6IFsgJ29ic2VydmFiaWxpdHknLCAnYmFja2VuZCcsICdkeW5hbW9kYicgXVxufSlcbmV4cG9ydCBjbGFzcyBEeW5hbW9EQk9ic2VydmFiaWxpdHlCYWNrZW5kIGltcGxlbWVudHMgT2JzZXJ2YWJpbGl0eUJhY2tlbmQge1xuICBwdWJsaWMgcmVhZG9ubHkgbmFtZSA9ICdkeW5hbW9kYic7XG4gIHB1YmxpYyByZWFkb25seSBtaW5MZXZlbD86IE9ic2VydmFiaWxpdHlMZXZlbDtcblxuICBwcml2YXRlIGJ1ZmZlcjogT2JzZXJ2YWJpbGl0eUV2ZW50W10gPSBbXTtcbiAgcHJpdmF0ZSByZWFkb25seSB0dGxEYXlzOiBudW1iZXI7XG5cbiAgY29uc3RydWN0b3IoXG4gICAgQEluamVjdENvbmZpZygnb2JzZXJ2YWJpbGl0eS5keW5hbW9kYi50dGxEYXlzJykgdHRsRGF5czogbnVtYmVyLFxuICAgIEBJbmplY3RDb25maWcoJ29ic2VydmFiaWxpdHkubWluTGV2ZWwnKSBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLFxuICAgIEBJbmplY3QoT2JzZXJ2YWJpbGl0eUxvZ1NlcnZpY2UpIHByaXZhdGUgcmVhZG9ubHkgc2VydmljZTogT2JzZXJ2YWJpbGl0eUxvZ1NlcnZpY2VcbiAgKSB7XG4gICAgdGhpcy5taW5MZXZlbCA9IG1pbkxldmVsO1xuICAgIHRoaXMudHRsRGF5cyA9IHR0bERheXM7XG4gIH1cblxuICBpbml0aWFsaXplSW52b2NhdGlvbigpOiB2b2lkIHtcbiAgICB0aGlzLmJ1ZmZlciA9IFtdO1xuICB9XG5cbiAgYXN5bmMgY2FwdHVyZShldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5idWZmZXIucHVzaChldmVudCk7XG5cbiAgICBpZiAodGhpcy5idWZmZXIubGVuZ3RoID49IERZTkFNT19CQVRDSF9TSVpFKSB7XG4gICAgICBhd2FpdCB0aGlzLmZsdXNoKCk7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuYnVmZmVyLmxlbmd0aCA+PSBNQVhfQlVGRkVSX1NJWkUpIHtcbiAgICAgIGxvZ2dlci53YXJuKGBCdWZmZXIgb3ZlcmZsb3cgKCR7dGhpcy5idWZmZXIubGVuZ3RofSBldmVudHMpLCBmb3JjZSBmbHVzaGluZ2ApO1xuICAgICAgYXdhaXQgdGhpcy5mbHVzaCgpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGZsdXNoKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICh0aGlzLmJ1ZmZlci5sZW5ndGggPT09IDApIHJldHVybjtcblxuICAgIGNvbnN0IGV2ZW50cyA9IHRoaXMuYnVmZmVyLnNwbGljZSgwLCB0aGlzLmJ1ZmZlci5sZW5ndGgpO1xuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBldmVudHMubGVuZ3RoOyBpICs9IERZTkFNT19CQVRDSF9TSVpFKSB7XG4gICAgICBjb25zdCBiYXRjaCA9IGV2ZW50cy5zbGljZShpLCBpICsgRFlOQU1PX0JBVENIX1NJWkUpO1xuICAgICAgYXdhaXQgdGhpcy53cml0ZUJhdGNoKGJhdGNoKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHN0YXRpYyByZWFkb25seSBSRVRSWUFCTEVfRVJST1JTID0gbmV3IFNldChbXG4gICAgJ1Byb3Zpc2lvbmVkVGhyb3VnaHB1dEV4Y2VlZGVkRXhjZXB0aW9uJyxcbiAgICAnVGhyb3R0bGluZ0V4Y2VwdGlvbicsXG4gICAgJ1JlcXVlc3RMaW1pdEV4Y2VlZGVkJyxcbiAgICAnSW50ZXJuYWxTZXJ2ZXJFcnJvcicsXG4gICAgJ1NlcnZpY2VVbmF2YWlsYWJsZScsXG4gIF0pO1xuXG4gIHByaXZhdGUgaXNSZXRyeWFibGVFcnJvcihlcnJvcjogdW5rbm93bik6IGJvb2xlYW4ge1xuICAgIGlmICghZXJyb3IgfHwgdHlwZW9mIGVycm9yICE9PSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlO1xuXG4gICAgY29uc3QgZXJyb3JOYW1lID0gKGVycm9yIGFzIHsgbmFtZT86IHN0cmluZyB9KS5uYW1lO1xuICAgIGlmIChlcnJvck5hbWUgJiYgRHluYW1vREJPYnNlcnZhYmlsaXR5QmFja2VuZC5SRVRSWUFCTEVfRVJST1JTLmhhcyhlcnJvck5hbWUpKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICBjb25zdCBlcnJvckNvZGUgPSAoZXJyb3IgYXMgeyBjb2RlPzogc3RyaW5nIH0pLmNvZGU7XG4gICAgaWYgKGVycm9yQ29kZSAmJiBEeW5hbW9EQk9ic2VydmFiaWxpdHlCYWNrZW5kLlJFVFJZQUJMRV9FUlJPUlMuaGFzKGVycm9yQ29kZSkpIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIGNvbnN0IG1ldGFkYXRhID0gKGVycm9yIGFzIHsgJG1ldGFkYXRhPzogeyBodHRwU3RhdHVzQ29kZT86IG51bWJlciB9IH0pLiRtZXRhZGF0YTtcbiAgICBpZiAobWV0YWRhdGE/Lmh0dHBTdGF0dXNDb2RlICYmIG1ldGFkYXRhLmh0dHBTdGF0dXNDb2RlID49IDUwMCkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyB3cml0ZUJhdGNoKGV2ZW50czogT2JzZXJ2YWJpbGl0eUV2ZW50W10sIHJldHJ5Q291bnQgPSAwKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgTUFYX1JFVFJJRVMgPSAyO1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHR0bFNlY29uZHMgPSBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKSArIHRoaXMudHRsRGF5cyAqIDI0ICogNjAgKiA2MDtcblxuICAgICAgY29uc3QgaXRlbXMgPSBldmVudHMubWFwKChldmVudCkgPT4gdGhpcy5tYXBFdmVudFRvSXRlbShldmVudCwgdHRsU2Vjb25kcykpO1xuXG4gICAgICBjb25zdCB2YWxpZEl0ZW1zID0gaXRlbXMuZmlsdGVyKChpdGVtKSA9PiB7XG4gICAgICAgIGNvbnN0IHNpemUgPSBlc3RpbWF0ZUl0ZW1TaXplKGl0ZW0pO1xuICAgICAgICBpZiAoc2l6ZSA+IERZTkFNT19NQVhfSVRFTV9TSVpFKSB7XG4gICAgICAgICAgbG9nZ2VyLndhcm4oYEl0ZW0gdG9vIGxhcmdlICgke3NpemV9IGJ5dGVzKSwgc2tpcHBpbmc6YCwge1xuICAgICAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiBpdGVtLm9ic2VydmFiaWxpdHlMb2dJZCxcbiAgICAgICAgICAgIHR5cGU6IGl0ZW0udHlwZSxcbiAgICAgICAgICAgIHNpemUsXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfSk7XG5cbiAgICAgIGlmICh2YWxpZEl0ZW1zLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuXG4gICAgICBhd2FpdCB0aGlzLnNlcnZpY2UuYmF0Y2hDcmVhdGUodmFsaWRJdGVtcyk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmICh0aGlzLmlzUmV0cnlhYmxlRXJyb3IoZXJyb3IpICYmIHJldHJ5Q291bnQgPCBNQVhfUkVUUklFUykge1xuICAgICAgICBsb2dnZXIud2FybihgRHluYW1vREIgdHJhbnNpZW50IGVycm9yLCByZXRyeWluZyAoJHtyZXRyeUNvdW50ICsgMX0vJHtNQVhfUkVUUklFU30pOmAsIHtcbiAgICAgICAgICBlcnJvck5hbWU6IChlcnJvciBhcyB7IG5hbWU/OiBzdHJpbmcgfSkubmFtZSxcbiAgICAgICAgICBlcnJvckNvZGU6IChlcnJvciBhcyB7IGNvZGU/OiBzdHJpbmcgfSkuY29kZSxcbiAgICAgICAgfSk7XG4gICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCAxMDAgKiAocmV0cnlDb3VudCArIDEpKSk7XG4gICAgICAgIHJldHVybiB0aGlzLndyaXRlQmF0Y2goZXZlbnRzLCByZXRyeUNvdW50ICsgMSk7XG4gICAgICB9XG5cbiAgICAgIGxvZ2dlci5lcnJvcignRHluYW1vREIgYmF0Y2ggd3JpdGUgZmFpbGVkOicsIHtcbiAgICAgICAgZXJyb3I6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKSxcbiAgICAgICAgZXJyb3JOYW1lOiAoZXJyb3IgYXMgeyBuYW1lPzogc3RyaW5nIH0pLm5hbWUsXG4gICAgICAgIGV2ZW50Q291bnQ6IGV2ZW50cy5sZW5ndGgsXG4gICAgICAgIGV2ZW50SWRzOiBldmVudHMubWFwKGUgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQpLFxuICAgICAgICByZXRyaWVkOiByZXRyeUNvdW50ID4gMCxcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgbWFwRXZlbnRUb0l0ZW0oZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCwgdHRsU2Vjb25kczogbnVtYmVyKTogT2JzZXJ2YWJpbGl0eUxvZ0NyZWF0ZUl0ZW0ge1xuICAgIHJldHVybiB7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6IGV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZCxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogZXZlbnQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkLFxuICAgICAgY29ycmVsYXRpb25JZDogZXZlbnQuY29ycmVsYXRpb25JZCxcbiAgICAgIGNhdXNlZEJ5OiBldmVudC5jYXVzZWRCeSxcbiAgICAgIHJlbGF0ZWRUcmFjZXM6IGV2ZW50LnJlbGF0ZWRUcmFjZXMsXG4gICAgICB0eXBlOiBldmVudC50eXBlLFxuICAgICAgc3ViVHlwZTogZXZlbnQuc3ViVHlwZSxcbiAgICAgIGxldmVsOiBldmVudC5sZXZlbCxcbiAgICAgIGVudGl0eU5hbWU6IGV2ZW50LmVudGl0eU5hbWUsXG4gICAgICBlbnRpdHlJZDogZXZlbnQuZW50aXR5SWQsXG4gICAgICBvcGVyYXRpb246IGV2ZW50Lm9wZXJhdGlvbixcbiAgICAgIHN0YXR1czogZXZlbnQuc3RhdHVzLFxuICAgICAgc3VjY2VzczogZXZlbnQuc3VjY2VzcyxcbiAgICAgIHRpbWVzdGFtcE1zOiBldmVudC50aW1lc3RhbXBNcyxcbiAgICAgIGR1cmF0aW9uTXM6IGV2ZW50LmR1cmF0aW9uTXMsXG4gICAgICBzb3VyY2U6IGV2ZW50LnNvdXJjZSxcbiAgICAgIHRhZ3M6IGV2ZW50LnRhZ3MsXG4gICAgICBhY3RvcjogZXZlbnQuYWN0b3IgPyB0cnVuY2F0ZVBheWxvYWQoZXZlbnQuYWN0b3IpIDogdW5kZWZpbmVkLFxuICAgICAgZGF0YTogZXZlbnQuZGF0YSA/IHRydW5jYXRlUGF5bG9hZChldmVudC5kYXRhKSA6IHVuZGVmaW5lZCxcbiAgICAgIGF0dHJpYnV0ZXM6IGV2ZW50LmF0dHJpYnV0ZXMgPyB0cnVuY2F0ZVBheWxvYWQoZXZlbnQuYXR0cmlidXRlcykgOiB1bmRlZmluZWQsXG4gICAgICBtZXRhZGF0YTogZXZlbnQubWV0YWRhdGEgPyB0cnVuY2F0ZVBheWxvYWQoZXZlbnQubWV0YWRhdGEpIDogdW5kZWZpbmVkLFxuICAgICAgbWV0cmljczogZXZlbnQubWV0cmljcyxcbiAgICAgIGNvbnRleHQ6IGV2ZW50LmNvbnRleHQgPyB0cnVuY2F0ZVBheWxvYWQoZXZlbnQuY29udGV4dCkgOiB1bmRlZmluZWQsXG4gICAgICBlcnJvcjogZXZlbnQuZXJyb3IsXG4gICAgICB0dGw6IHR0bFNlY29uZHMsXG4gICAgfSBhcyBPYnNlcnZhYmlsaXR5TG9nQ3JlYXRlSXRlbTtcbiAgfVxufVxuIl19