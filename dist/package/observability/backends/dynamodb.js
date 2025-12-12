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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZHluYW1vZGIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9iYWNrZW5kcy9keW5hbW9kYi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7O0dBS0c7Ozs7Ozs7Ozs7Ozs7QUFFSCxpQ0FBNEQ7QUFDNUQsMkNBQTZDO0FBQzdDLGdEQUF5RjtBQUV6Riw4Q0FBcUU7QUFFckUsTUFBTSxNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLDhCQUE4QixDQUFDLENBQUM7QUFFNUQsa0JBQWtCO0FBQ2xCLE1BQU0saUJBQWlCLEdBQUcsRUFBRSxDQUFDO0FBQzdCLE1BQU0sb0JBQW9CLEdBQUcsR0FBRyxHQUFHLElBQUksQ0FBQyxDQUFDLGlCQUFpQjtBQUMxRCxNQUFNLGVBQWUsR0FBRyxJQUFJLENBQUM7QUFPdEIsSUFBTSw0QkFBNEIsR0FBbEMsTUFBTSw0QkFBNEI7O0lBVWE7SUFUcEMsSUFBSSxHQUFHLFVBQVUsQ0FBQztJQUNsQixRQUFRLENBQXNCO0lBRXRDLE1BQU0sR0FBeUIsRUFBRSxDQUFDO0lBQ3pCLE9BQU8sQ0FBUztJQUVqQyxZQUNrRCxPQUFlLEVBQ3ZCLFFBQTRCLEVBQ2xCLE9BQWdDO1FBQWhDLFlBQU8sR0FBUCxPQUFPLENBQXlCO1FBRWxGLElBQUksQ0FBQyxRQUFRLEdBQUcsUUFBUSxDQUFDO1FBQ3pCLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFDO0lBQ3pCLENBQUM7SUFFRCxvQkFBb0I7UUFDbEIsSUFBSSxDQUFDLE1BQU0sR0FBRyxFQUFFLENBQUM7SUFDbkIsQ0FBQztJQUVELEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBeUI7UUFDckMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUM7UUFFeEIsSUFBSSxJQUFJLENBQUMsTUFBTSxDQUFDLE1BQU0sSUFBSSxpQkFBaUIsRUFBRSxDQUFDO1lBQzVDLE1BQU0sSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ3JCLENBQUM7UUFFRCxJQUFJLElBQUksQ0FBQyxNQUFNLENBQUMsTUFBTSxJQUFJLGVBQWUsRUFBRSxDQUFDO1lBQzFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsb0JBQW9CLElBQUksQ0FBQyxNQUFNLENBQUMsTUFBTSwwQkFBMEIsQ0FBQyxDQUFDO1lBQzlFLE1BQU0sSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ3JCLENBQUM7SUFDSCxDQUFDO0lBRUQsS0FBSyxDQUFDLEtBQUs7UUFDVCxJQUFJLElBQUksQ0FBQyxNQUFNLENBQUMsTUFBTSxLQUFLLENBQUM7WUFBRSxPQUFPO1FBRXJDLE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsRUFBRSxJQUFJLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBRXpELEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxNQUFNLENBQUMsTUFBTSxFQUFFLENBQUMsSUFBSSxpQkFBaUIsRUFBRSxDQUFDO1lBQzFELE1BQU0sS0FBSyxHQUFHLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLENBQUMsR0FBRyxpQkFBaUIsQ0FBQyxDQUFDO1lBQ3JELE1BQU0sSUFBSSxDQUFDLFVBQVUsQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUMvQixDQUFDO0lBQ0gsQ0FBQztJQUVPLE1BQU0sQ0FBVSxnQkFBZ0IsR0FBRyxJQUFJLEdBQUcsQ0FBQztRQUNqRCx3Q0FBd0M7UUFDeEMscUJBQXFCO1FBQ3JCLHNCQUFzQjtRQUN0QixxQkFBcUI7UUFDckIsb0JBQW9CO0tBQ3JCLENBQUMsQ0FBQztJQUVLLGdCQUFnQixDQUFDLEtBQWM7UUFDckMsSUFBSSxDQUFDLEtBQUssSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRO1lBQUUsT0FBTyxLQUFLLENBQUM7UUFFdEQsTUFBTSxTQUFTLEdBQUksS0FBMkIsQ0FBQyxJQUFJLENBQUM7UUFDcEQsSUFBSSxTQUFTLElBQUksOEJBQTRCLENBQUMsZ0JBQWdCLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUM7WUFDOUUsT0FBTyxJQUFJLENBQUM7UUFDZCxDQUFDO1FBRUQsTUFBTSxTQUFTLEdBQUksS0FBMkIsQ0FBQyxJQUFJLENBQUM7UUFDcEQsSUFBSSxTQUFTLElBQUksOEJBQTRCLENBQUMsZ0JBQWdCLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUM7WUFDOUUsT0FBTyxJQUFJLENBQUM7UUFDZCxDQUFDO1FBRUQsTUFBTSxRQUFRLEdBQUksS0FBcUQsQ0FBQyxTQUFTLENBQUM7UUFDbEYsSUFBSSxRQUFRLEVBQUUsY0FBYyxJQUFJLFFBQVEsQ0FBQyxjQUFjLElBQUksR0FBRyxFQUFFLENBQUM7WUFDL0QsT0FBTyxJQUFJLENBQUM7UUFDZCxDQUFDO1FBRUQsT0FBTyxLQUFLLENBQUM7SUFDZixDQUFDO0lBRU8sS0FBSyxDQUFDLFVBQVUsQ0FBQyxNQUE0QixFQUFFLFVBQVUsR0FBRyxDQUFDO1FBQ25FLE1BQU0sV0FBVyxHQUFHLENBQUMsQ0FBQztRQUV0QixJQUFJLENBQUM7WUFDSCxNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsR0FBRyxJQUFJLENBQUMsR0FBRyxJQUFJLENBQUMsT0FBTyxHQUFHLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRSxDQUFDO1lBRS9FLE1BQU0sS0FBSyxHQUFHLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLElBQUksQ0FBQyxjQUFjLENBQUMsS0FBSyxFQUFFLFVBQVUsQ0FBQyxDQUFDLENBQUM7WUFFNUUsTUFBTSxVQUFVLEdBQUcsS0FBSyxDQUFDLE1BQU0sQ0FBQyxDQUFDLElBQUksRUFBRSxFQUFFO2dCQUN2QyxNQUFNLElBQUksR0FBRyxJQUFBLDBCQUFnQixFQUFDLElBQUksQ0FBQyxDQUFDO2dCQUNwQyxJQUFJLElBQUksR0FBRyxvQkFBb0IsRUFBRSxDQUFDO29CQUNoQyxNQUFNLENBQUMsSUFBSSxDQUFDLG1CQUFtQixJQUFJLG9CQUFvQixFQUFFO3dCQUN2RCxrQkFBa0IsRUFBRSxJQUFJLENBQUMsa0JBQWtCO3dCQUMzQyxJQUFJLEVBQUUsSUFBSSxDQUFDLElBQUk7d0JBQ2YsSUFBSTtxQkFDTCxDQUFDLENBQUM7b0JBQ0gsT0FBTyxLQUFLLENBQUM7Z0JBQ2YsQ0FBQztnQkFDRCxPQUFPLElBQUksQ0FBQztZQUNkLENBQUMsQ0FBQyxDQUFDO1lBRUgsSUFBSSxVQUFVLENBQUMsTUFBTSxLQUFLLENBQUM7Z0JBQUUsT0FBTztZQUVwQyxNQUFNLElBQUksQ0FBQyxPQUFPLENBQUMsV0FBVyxDQUFDLFVBQVUsQ0FBQyxDQUFDO1FBQzdDLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsSUFBSSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsS0FBSyxDQUFDLElBQUksVUFBVSxHQUFHLFdBQVcsRUFBRSxDQUFDO2dCQUM3RCxNQUFNLENBQUMsSUFBSSxDQUFDLHVDQUF1QyxVQUFVLEdBQUcsQ0FBQyxJQUFJLFdBQVcsSUFBSSxFQUFFO29CQUNwRixTQUFTLEVBQUcsS0FBMkIsQ0FBQyxJQUFJO29CQUM1QyxTQUFTLEVBQUcsS0FBMkIsQ0FBQyxJQUFJO2lCQUM3QyxDQUFDLENBQUM7Z0JBQ0gsTUFBTSxJQUFJLE9BQU8sQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLFVBQVUsQ0FBQyxPQUFPLEVBQUUsR0FBRyxHQUFHLENBQUMsVUFBVSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztnQkFDMUUsT0FBTyxJQUFJLENBQUMsVUFBVSxDQUFDLE1BQU0sRUFBRSxVQUFVLEdBQUcsQ0FBQyxDQUFDLENBQUM7WUFDakQsQ0FBQztZQUVELE1BQU0sQ0FBQyxLQUFLLENBQUMsOEJBQThCLEVBQUU7Z0JBQzNDLEtBQUssRUFBRSxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDO2dCQUM3RCxTQUFTLEVBQUcsS0FBMkIsQ0FBQyxJQUFJO2dCQUM1QyxVQUFVLEVBQUUsTUFBTSxDQUFDLE1BQU07Z0JBQ3pCLFFBQVEsRUFBRSxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLGtCQUFrQixDQUFDO2dCQUMvQyxPQUFPLEVBQUUsVUFBVSxHQUFHLENBQUM7YUFDeEIsQ0FBQyxDQUFDO1FBQ0wsQ0FBQztJQUNILENBQUM7SUFFTyxjQUFjLENBQUMsS0FBeUIsRUFBRSxVQUFrQjtRQUNsRSxPQUFPO1lBQ0wsa0JBQWtCLEVBQUUsS0FBSyxDQUFDLGtCQUFrQjtZQUM1Qyx3QkFBd0IsRUFBRSxLQUFLLENBQUMsd0JBQXdCO1lBQ3hELGFBQWEsRUFBRSxLQUFLLENBQUMsYUFBYTtZQUNsQyxJQUFJLEVBQUUsS0FBSyxDQUFDLElBQUk7WUFDaEIsT0FBTyxFQUFFLEtBQUssQ0FBQyxPQUFPO1lBQ3RCLEtBQUssRUFBRSxLQUFLLENBQUMsS0FBSztZQUNsQixVQUFVLEVBQUUsS0FBSyxDQUFDLFVBQVU7WUFDNUIsUUFBUSxFQUFFLEtBQUssQ0FBQyxRQUFRO1lBQ3hCLFNBQVMsRUFBRSxLQUFLLENBQUMsU0FBUztZQUMxQixNQUFNLEVBQUUsS0FBSyxDQUFDLE1BQU07WUFDcEIsT0FBTyxFQUFFLEtBQUssQ0FBQyxPQUFPO1lBQ3RCLFdBQVcsRUFBRSxLQUFLLENBQUMsV0FBVztZQUM5QixVQUFVLEVBQUUsS0FBSyxDQUFDLFVBQVU7WUFDNUIsTUFBTSxFQUFFLEtBQUssQ0FBQyxNQUFNO1lBQ3BCLElBQUksRUFBRSxLQUFLLENBQUMsSUFBSTtZQUNoQixLQUFLLEVBQUUsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsSUFBQSx5QkFBZSxFQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUztZQUM3RCxJQUFJLEVBQUUsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsSUFBQSx5QkFBZSxFQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUztZQUMxRCxVQUFVLEVBQUUsS0FBSyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsSUFBQSx5QkFBZSxFQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUztZQUM1RSxRQUFRLEVBQUUsS0FBSyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsSUFBQSx5QkFBZSxFQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUztZQUN0RSxPQUFPLEVBQUUsS0FBSyxDQUFDLE9BQU87WUFDdEIsT0FBTyxFQUFFLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLElBQUEseUJBQWUsRUFBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVM7WUFDbkUsS0FBSyxFQUFFLEtBQUssQ0FBQyxLQUFLO1lBQ2xCLEdBQUcsRUFBRSxVQUFVO1NBQ2MsQ0FBQztJQUNsQyxDQUFDOztBQS9JVSxvRUFBNEI7dUNBQTVCLDRCQUE0QjtJQUx4QyxJQUFBLGVBQVUsRUFBQztRQUNWLE9BQU8sRUFBRSxzQkFBc0I7UUFDL0IsVUFBVSxFQUFFLE1BQU07UUFDbEIsSUFBSSxFQUFFLENBQUUsZUFBZSxFQUFFLFNBQVMsRUFBRSxVQUFVLENBQUU7S0FDakQsQ0FBQztJQVNHLFdBQUEsSUFBQSxpQkFBWSxFQUFDLGdDQUFnQyxDQUFDLENBQUE7SUFDOUMsV0FBQSxJQUFBLGlCQUFZLEVBQUMsd0JBQXdCLENBQUMsQ0FBQTtJQUN0QyxXQUFBLElBQUEsV0FBTSxFQUFDLGlDQUF1QixDQUFDLENBQUE7R0FWdkIsNEJBQTRCLENBZ0p4QyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogRHluYW1vREIgQmFja2VuZCBmb3IgT2JzZXJ2YWJpbGl0eVxuICogXG4gKiBTdG9yZXMgYWxsIG9ic2VydmFiaWxpdHkgZXZlbnRzIGluIER5bmFtb0RCLlxuICogQWxsIGNvbmZpZyBpbmplY3RlZCB2aWEgREkgLSBubyBmYWxsYmFja3MuXG4gKi9cblxuaW1wb3J0IHsgSW5qZWN0LCBJbmplY3RhYmxlLCBJbmplY3RDb25maWcgfSBmcm9tICcuLi8uLi9kaSc7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIgfSBmcm9tICcuLi8uLi9sb2dnaW5nJztcbmltcG9ydCB7IE9ic2VydmFiaWxpdHlMb2dDcmVhdGVJdGVtLCBPYnNlcnZhYmlsaXR5TG9nU2VydmljZSB9IGZyb20gJy4uL3N0b3JhZ2Uvc2VydmljZSc7XG5pbXBvcnQgeyBPYnNlcnZhYmlsaXR5QmFja2VuZCwgT2JzZXJ2YWJpbGl0eUV2ZW50LCBPYnNlcnZhYmlsaXR5TGV2ZWwgfSBmcm9tICcuLi90eXBlcyc7XG5pbXBvcnQgeyBlc3RpbWF0ZUl0ZW1TaXplLCB0cnVuY2F0ZVBheWxvYWQgfSBmcm9tICcuLi91dGlscy9wYXlsb2FkJztcblxuY29uc3QgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdEeW5hbW9EQk9ic2VydmFiaWxpdHlCYWNrZW5kJyk7XG5cbi8vIER5bmFtb0RCIGxpbWl0c1xuY29uc3QgRFlOQU1PX0JBVENIX1NJWkUgPSAyNTtcbmNvbnN0IERZTkFNT19NQVhfSVRFTV9TSVpFID0gNDAwICogMTAyNDsgLy8gNDAwS0IgcGVyIGl0ZW1cbmNvbnN0IE1BWF9CVUZGRVJfU0laRSA9IDEwMDA7XG5cbkBJbmplY3RhYmxlKHtcbiAgcHJvdmlkZTogJ09ic2VydmFiaWxpdHlCYWNrZW5kJyxcbiAgcHJvdmlkZWRJbjogJ1JPT1QnLFxuICB0YWdzOiBbICdvYnNlcnZhYmlsaXR5JywgJ2JhY2tlbmQnLCAnZHluYW1vZGInIF1cbn0pXG5leHBvcnQgY2xhc3MgRHluYW1vREJPYnNlcnZhYmlsaXR5QmFja2VuZCBpbXBsZW1lbnRzIE9ic2VydmFiaWxpdHlCYWNrZW5kIHtcbiAgcHVibGljIHJlYWRvbmx5IG5hbWUgPSAnZHluYW1vZGInO1xuICBwdWJsaWMgcmVhZG9ubHkgbWluTGV2ZWw/OiBPYnNlcnZhYmlsaXR5TGV2ZWw7XG5cbiAgcHJpdmF0ZSBidWZmZXI6IE9ic2VydmFiaWxpdHlFdmVudFtdID0gW107XG4gIHByaXZhdGUgcmVhZG9ubHkgdHRsRGF5czogbnVtYmVyO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIEBJbmplY3RDb25maWcoJ29ic2VydmFiaWxpdHkuZHluYW1vZGIudHRsRGF5cycpIHR0bERheXM6IG51bWJlcixcbiAgICBASW5qZWN0Q29uZmlnKCdvYnNlcnZhYmlsaXR5Lm1pbkxldmVsJykgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbCxcbiAgICBASW5qZWN0KE9ic2VydmFiaWxpdHlMb2dTZXJ2aWNlKSBwcml2YXRlIHJlYWRvbmx5IHNlcnZpY2U6IE9ic2VydmFiaWxpdHlMb2dTZXJ2aWNlXG4gICkge1xuICAgIHRoaXMubWluTGV2ZWwgPSBtaW5MZXZlbDtcbiAgICB0aGlzLnR0bERheXMgPSB0dGxEYXlzO1xuICB9XG5cbiAgaW5pdGlhbGl6ZUludm9jYXRpb24oKTogdm9pZCB7XG4gICAgdGhpcy5idWZmZXIgPSBbXTtcbiAgfVxuXG4gIGFzeW5jIGNhcHR1cmUoZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuYnVmZmVyLnB1c2goZXZlbnQpO1xuXG4gICAgaWYgKHRoaXMuYnVmZmVyLmxlbmd0aCA+PSBEWU5BTU9fQkFUQ0hfU0laRSkge1xuICAgICAgYXdhaXQgdGhpcy5mbHVzaCgpO1xuICAgIH1cblxuICAgIGlmICh0aGlzLmJ1ZmZlci5sZW5ndGggPj0gTUFYX0JVRkZFUl9TSVpFKSB7XG4gICAgICBsb2dnZXIud2FybihgQnVmZmVyIG92ZXJmbG93ICgke3RoaXMuYnVmZmVyLmxlbmd0aH0gZXZlbnRzKSwgZm9yY2UgZmx1c2hpbmdgKTtcbiAgICAgIGF3YWl0IHRoaXMuZmx1c2goKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBmbHVzaCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAodGhpcy5idWZmZXIubGVuZ3RoID09PSAwKSByZXR1cm47XG5cbiAgICBjb25zdCBldmVudHMgPSB0aGlzLmJ1ZmZlci5zcGxpY2UoMCwgdGhpcy5idWZmZXIubGVuZ3RoKTtcblxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZXZlbnRzLmxlbmd0aDsgaSArPSBEWU5BTU9fQkFUQ0hfU0laRSkge1xuICAgICAgY29uc3QgYmF0Y2ggPSBldmVudHMuc2xpY2UoaSwgaSArIERZTkFNT19CQVRDSF9TSVpFKTtcbiAgICAgIGF3YWl0IHRoaXMud3JpdGVCYXRjaChiYXRjaCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBzdGF0aWMgcmVhZG9ubHkgUkVUUllBQkxFX0VSUk9SUyA9IG5ldyBTZXQoW1xuICAgICdQcm92aXNpb25lZFRocm91Z2hwdXRFeGNlZWRlZEV4Y2VwdGlvbicsXG4gICAgJ1Rocm90dGxpbmdFeGNlcHRpb24nLFxuICAgICdSZXF1ZXN0TGltaXRFeGNlZWRlZCcsXG4gICAgJ0ludGVybmFsU2VydmVyRXJyb3InLFxuICAgICdTZXJ2aWNlVW5hdmFpbGFibGUnLFxuICBdKTtcblxuICBwcml2YXRlIGlzUmV0cnlhYmxlRXJyb3IoZXJyb3I6IHVua25vd24pOiBib29sZWFuIHtcbiAgICBpZiAoIWVycm9yIHx8IHR5cGVvZiBlcnJvciAhPT0gJ29iamVjdCcpIHJldHVybiBmYWxzZTtcblxuICAgIGNvbnN0IGVycm9yTmFtZSA9IChlcnJvciBhcyB7IG5hbWU/OiBzdHJpbmcgfSkubmFtZTtcbiAgICBpZiAoZXJyb3JOYW1lICYmIER5bmFtb0RCT2JzZXJ2YWJpbGl0eUJhY2tlbmQuUkVUUllBQkxFX0VSUk9SUy5oYXMoZXJyb3JOYW1lKSkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgY29uc3QgZXJyb3JDb2RlID0gKGVycm9yIGFzIHsgY29kZT86IHN0cmluZyB9KS5jb2RlO1xuICAgIGlmIChlcnJvckNvZGUgJiYgRHluYW1vREJPYnNlcnZhYmlsaXR5QmFja2VuZC5SRVRSWUFCTEVfRVJST1JTLmhhcyhlcnJvckNvZGUpKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICBjb25zdCBtZXRhZGF0YSA9IChlcnJvciBhcyB7ICRtZXRhZGF0YT86IHsgaHR0cFN0YXR1c0NvZGU/OiBudW1iZXIgfSB9KS4kbWV0YWRhdGE7XG4gICAgaWYgKG1ldGFkYXRhPy5odHRwU3RhdHVzQ29kZSAmJiBtZXRhZGF0YS5odHRwU3RhdHVzQ29kZSA+PSA1MDApIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgd3JpdGVCYXRjaChldmVudHM6IE9ic2VydmFiaWxpdHlFdmVudFtdLCByZXRyeUNvdW50ID0gMCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IE1BWF9SRVRSSUVTID0gMjtcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCB0dGxTZWNvbmRzID0gTWF0aC5mbG9vcihEYXRlLm5vdygpIC8gMTAwMCkgKyB0aGlzLnR0bERheXMgKiAyNCAqIDYwICogNjA7XG5cbiAgICAgIGNvbnN0IGl0ZW1zID0gZXZlbnRzLm1hcCgoZXZlbnQpID0+IHRoaXMubWFwRXZlbnRUb0l0ZW0oZXZlbnQsIHR0bFNlY29uZHMpKTtcblxuICAgICAgY29uc3QgdmFsaWRJdGVtcyA9IGl0ZW1zLmZpbHRlcigoaXRlbSkgPT4ge1xuICAgICAgICBjb25zdCBzaXplID0gZXN0aW1hdGVJdGVtU2l6ZShpdGVtKTtcbiAgICAgICAgaWYgKHNpemUgPiBEWU5BTU9fTUFYX0lURU1fU0laRSkge1xuICAgICAgICAgIGxvZ2dlci53YXJuKGBJdGVtIHRvbyBsYXJnZSAoJHtzaXplfSBieXRlcyksIHNraXBwaW5nOmAsIHtcbiAgICAgICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogaXRlbS5vYnNlcnZhYmlsaXR5TG9nSWQsXG4gICAgICAgICAgICB0eXBlOiBpdGVtLnR5cGUsXG4gICAgICAgICAgICBzaXplLFxuICAgICAgICAgIH0pO1xuICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH0pO1xuXG4gICAgICBpZiAodmFsaWRJdGVtcy5sZW5ndGggPT09IDApIHJldHVybjtcblxuICAgICAgYXdhaXQgdGhpcy5zZXJ2aWNlLmJhdGNoQ3JlYXRlKHZhbGlkSXRlbXMpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAodGhpcy5pc1JldHJ5YWJsZUVycm9yKGVycm9yKSAmJiByZXRyeUNvdW50IDwgTUFYX1JFVFJJRVMpIHtcbiAgICAgICAgbG9nZ2VyLndhcm4oYER5bmFtb0RCIHRyYW5zaWVudCBlcnJvciwgcmV0cnlpbmcgKCR7cmV0cnlDb3VudCArIDF9LyR7TUFYX1JFVFJJRVN9KTpgLCB7XG4gICAgICAgICAgZXJyb3JOYW1lOiAoZXJyb3IgYXMgeyBuYW1lPzogc3RyaW5nIH0pLm5hbWUsXG4gICAgICAgICAgZXJyb3JDb2RlOiAoZXJyb3IgYXMgeyBjb2RlPzogc3RyaW5nIH0pLmNvZGUsXG4gICAgICAgIH0pO1xuICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgMTAwICogKHJldHJ5Q291bnQgKyAxKSkpO1xuICAgICAgICByZXR1cm4gdGhpcy53cml0ZUJhdGNoKGV2ZW50cywgcmV0cnlDb3VudCArIDEpO1xuICAgICAgfVxuXG4gICAgICBsb2dnZXIuZXJyb3IoJ0R5bmFtb0RCIGJhdGNoIHdyaXRlIGZhaWxlZDonLCB7XG4gICAgICAgIGVycm9yOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvciksXG4gICAgICAgIGVycm9yTmFtZTogKGVycm9yIGFzIHsgbmFtZT86IHN0cmluZyB9KS5uYW1lLFxuICAgICAgICBldmVudENvdW50OiBldmVudHMubGVuZ3RoLFxuICAgICAgICBldmVudElkczogZXZlbnRzLm1hcChlID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkKSxcbiAgICAgICAgcmV0cmllZDogcmV0cnlDb3VudCA+IDAsXG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIG1hcEV2ZW50VG9JdGVtKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQsIHR0bFNlY29uZHM6IG51bWJlcik6IE9ic2VydmFiaWxpdHlMb2dDcmVhdGVJdGVtIHtcbiAgICByZXR1cm4ge1xuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiBldmVudC5vYnNlcnZhYmlsaXR5TG9nSWQsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IGV2ZW50LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IGV2ZW50LmNvcnJlbGF0aW9uSWQsXG4gICAgICB0eXBlOiBldmVudC50eXBlLFxuICAgICAgc3ViVHlwZTogZXZlbnQuc3ViVHlwZSxcbiAgICAgIGxldmVsOiBldmVudC5sZXZlbCxcbiAgICAgIGVudGl0eU5hbWU6IGV2ZW50LmVudGl0eU5hbWUsXG4gICAgICBlbnRpdHlJZDogZXZlbnQuZW50aXR5SWQsXG4gICAgICBvcGVyYXRpb246IGV2ZW50Lm9wZXJhdGlvbixcbiAgICAgIHN0YXR1czogZXZlbnQuc3RhdHVzLFxuICAgICAgc3VjY2VzczogZXZlbnQuc3VjY2VzcyxcbiAgICAgIHRpbWVzdGFtcE1zOiBldmVudC50aW1lc3RhbXBNcyxcbiAgICAgIGR1cmF0aW9uTXM6IGV2ZW50LmR1cmF0aW9uTXMsXG4gICAgICBzb3VyY2U6IGV2ZW50LnNvdXJjZSxcbiAgICAgIHRhZ3M6IGV2ZW50LnRhZ3MsXG4gICAgICBhY3RvcjogZXZlbnQuYWN0b3IgPyB0cnVuY2F0ZVBheWxvYWQoZXZlbnQuYWN0b3IpIDogdW5kZWZpbmVkLFxuICAgICAgZGF0YTogZXZlbnQuZGF0YSA/IHRydW5jYXRlUGF5bG9hZChldmVudC5kYXRhKSA6IHVuZGVmaW5lZCxcbiAgICAgIGF0dHJpYnV0ZXM6IGV2ZW50LmF0dHJpYnV0ZXMgPyB0cnVuY2F0ZVBheWxvYWQoZXZlbnQuYXR0cmlidXRlcykgOiB1bmRlZmluZWQsXG4gICAgICBtZXRhZGF0YTogZXZlbnQubWV0YWRhdGEgPyB0cnVuY2F0ZVBheWxvYWQoZXZlbnQubWV0YWRhdGEpIDogdW5kZWZpbmVkLFxuICAgICAgbWV0cmljczogZXZlbnQubWV0cmljcyxcbiAgICAgIGNvbnRleHQ6IGV2ZW50LmNvbnRleHQgPyB0cnVuY2F0ZVBheWxvYWQoZXZlbnQuY29udGV4dCkgOiB1bmRlZmluZWQsXG4gICAgICBlcnJvcjogZXZlbnQuZXJyb3IsXG4gICAgICB0dGw6IHR0bFNlY29uZHMsXG4gICAgfSBhcyBPYnNlcnZhYmlsaXR5TG9nQ3JlYXRlSXRlbTtcbiAgfVxufVxuIl19