"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DynamoDBObservabilityBackend = void 0;
const log_entity_1 = require("../storage/log-entity");
const payload_1 = require("../utils/payload");
const logging_1 = require("../../logging");
const logger = (0, logging_1.createLogger)('DynamoDBObservabilityBackend');
class DynamoDBObservabilityBackend {
    options;
    name = 'dynamodb';
    entity = (0, log_entity_1.ObservabilityLogEntity)();
    minLevel;
    buffer = [];
    BATCH_SIZE = 25; // DynamoDB max
    MAX_BUFFER_SIZE = 1000;
    constructor(options = {}) {
        this.options = options;
        this.minLevel = options.minLevel;
    }
    initializeInvocation() {
        // Clear buffer on warm start
        this.buffer = [];
    }
    async capture(event) {
        this.buffer.push(event);
        // Flush if buffer full
        if (this.buffer.length >= this.BATCH_SIZE) {
            await this.flush();
        }
        // Safety: Prevent memory overflow
        if (this.buffer.length >= this.MAX_BUFFER_SIZE) {
            logger.warn(`DynamoDB buffer overflow (${this.buffer.length} events), force flushing`);
            await this.flush();
        }
    }
    async flush() {
        if (this.buffer.length === 0)
            return;
        const events = this.buffer.splice(0, this.buffer.length);
        // Process in batches of 25 (DynamoDB limit)
        const batches = this.chunkArray(events, 25);
        for (const batch of batches) {
            await this.writeBatch(batch);
        }
    }
    async writeBatch(events) {
        try {
            const ttlSeconds = this.options.ttlDays !== undefined
                ? Math.floor(Date.now() / 1000) + this.options.ttlDays * 24 * 60 * 60
                : undefined;
            // Map events to entity records with complete field mapping
            const items = events.map((event) => ({
                // Identity fields
                logId: event.entityId, // For spans, use entityId as logId
                parentLogId: event.parentLogId,
                correlationId: event.correlationId,
                // Classification
                type: event.type,
                subType: event.subType,
                level: event.level,
                // Entity/Resource
                entityName: event.entityName,
                entityId: event.entityId,
                // Operation
                operation: event.operation,
                // Outcome
                success: event.success,
                status: event.status,
                durationMs: event.durationMs,
                // Time
                timestampMs: event.timestampMs,
                // Actor
                actor: event.actor ? (0, payload_1.truncatePayload)(event.actor) : undefined,
                // Payloads (keep separate, don't merge)
                data: event.data ? (0, payload_1.truncatePayload)(event.data) : undefined,
                attributes: event.attributes ? (0, payload_1.truncatePayload)(event.attributes) : undefined,
                metadata: event.metadata ? (0, payload_1.truncatePayload)(event.metadata) : undefined,
                metrics: event.metrics,
                // Error handling
                error: event.error,
                // Context (if present)
                context: event.context ? (0, payload_1.truncatePayload)(event.context) : undefined,
                // TTL
                ttl: ttlSeconds,
            }));
            // Write all items using ElectroDB batch write (true batch operation)
            await this.entity.put(items).go();
        }
        catch (error) {
            logger.error('DynamoDB batch write failed:', error);
            // Don't throw - observability should never break app
        }
    }
    chunkArray(array, size) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }
}
exports.DynamoDBObservabilityBackend = DynamoDBObservabilityBackend;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZHluYW1vZGIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9iYWNrZW5kcy9keW5hbW9kYi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSxzREFBK0Q7QUFDL0QsOENBQW1EO0FBQ25ELDJDQUE2QztBQUU3QyxNQUFNLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsOEJBQThCLENBQUMsQ0FBQztBQU81RCxNQUFhLDRCQUE0QjtJQVNWO0lBUmIsSUFBSSxHQUFHLFVBQVUsQ0FBQztJQUNqQixNQUFNLEdBQUcsSUFBQSxtQ0FBc0IsR0FBRSxDQUFDO0lBQ25DLFFBQVEsQ0FBc0I7SUFDdEMsTUFBTSxHQUF5QixFQUFFLENBQUM7SUFFekIsVUFBVSxHQUFHLEVBQUUsQ0FBQyxDQUFDLGVBQWU7SUFDaEMsZUFBZSxHQUFHLElBQUksQ0FBQztJQUV4QyxZQUE2QixVQUFrQyxFQUFFO1FBQXBDLFlBQU8sR0FBUCxPQUFPLENBQTZCO1FBQy9ELElBQUksQ0FBQyxRQUFRLEdBQUcsT0FBTyxDQUFDLFFBQVEsQ0FBQztJQUNuQyxDQUFDO0lBRUQsb0JBQW9CO1FBQ2xCLDZCQUE2QjtRQUM3QixJQUFJLENBQUMsTUFBTSxHQUFHLEVBQUUsQ0FBQztJQUNuQixDQUFDO0lBRUQsS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUF5QjtRQUNyQyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUV4Qix1QkFBdUI7UUFDdkIsSUFBSSxJQUFJLENBQUMsTUFBTSxDQUFDLE1BQU0sSUFBSSxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7WUFDMUMsTUFBTSxJQUFJLENBQUMsS0FBSyxFQUFFLENBQUM7UUFDckIsQ0FBQztRQUVELGtDQUFrQztRQUNsQyxJQUFJLElBQUksQ0FBQyxNQUFNLENBQUMsTUFBTSxJQUFJLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQztZQUMvQyxNQUFNLENBQUMsSUFBSSxDQUFDLDZCQUE2QixJQUFJLENBQUMsTUFBTSxDQUFDLE1BQU0sMEJBQTBCLENBQUMsQ0FBQztZQUN2RixNQUFNLElBQUksQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUNyQixDQUFDO0lBQ0gsQ0FBQztJQUVELEtBQUssQ0FBQyxLQUFLO1FBQ1QsSUFBSSxJQUFJLENBQUMsTUFBTSxDQUFDLE1BQU0sS0FBSyxDQUFDO1lBQUUsT0FBTztRQUVyQyxNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLEVBQUUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUV6RCw0Q0FBNEM7UUFDNUMsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLFVBQVUsQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDLENBQUM7UUFFNUMsS0FBSyxNQUFNLEtBQUssSUFBSSxPQUFPLEVBQUUsQ0FBQztZQUM1QixNQUFNLElBQUksQ0FBQyxVQUFVLENBQUMsS0FBSyxDQUFDLENBQUM7UUFDL0IsQ0FBQztJQUNILENBQUM7SUFFTyxLQUFLLENBQUMsVUFBVSxDQUFDLE1BQTRCO1FBQ25ELElBQUksQ0FBQztZQUNMLE1BQU0sVUFBVSxHQUNkLElBQUksQ0FBQyxPQUFPLENBQUMsT0FBTyxLQUFLLFNBQVM7Z0JBQ2hDLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsR0FBRyxJQUFJLENBQUMsR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU8sR0FBRyxFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUU7Z0JBQ3JFLENBQUMsQ0FBQyxTQUFTLENBQUM7WUFFZCwyREFBMkQ7WUFDM0QsTUFBTSxLQUFLLEdBQUcsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztnQkFDbkMsa0JBQWtCO2dCQUNsQixLQUFLLEVBQUUsS0FBSyxDQUFDLFFBQVEsRUFBRSxtQ0FBbUM7Z0JBQzFELFdBQVcsRUFBRSxLQUFLLENBQUMsV0FBVztnQkFDOUIsYUFBYSxFQUFFLEtBQUssQ0FBQyxhQUFhO2dCQUVsQyxpQkFBaUI7Z0JBQ2pCLElBQUksRUFBRSxLQUFLLENBQUMsSUFBSTtnQkFDaEIsT0FBTyxFQUFFLEtBQUssQ0FBQyxPQUFPO2dCQUN0QixLQUFLLEVBQUUsS0FBSyxDQUFDLEtBQUs7Z0JBRWxCLGtCQUFrQjtnQkFDbEIsVUFBVSxFQUFFLEtBQUssQ0FBQyxVQUFVO2dCQUM1QixRQUFRLEVBQUUsS0FBSyxDQUFDLFFBQVE7Z0JBRXhCLFlBQVk7Z0JBQ1osU0FBUyxFQUFFLEtBQUssQ0FBQyxTQUFTO2dCQUUxQixVQUFVO2dCQUNWLE9BQU8sRUFBRSxLQUFLLENBQUMsT0FBTztnQkFDdEIsTUFBTSxFQUFFLEtBQUssQ0FBQyxNQUFNO2dCQUNwQixVQUFVLEVBQUUsS0FBSyxDQUFDLFVBQVU7Z0JBRTVCLE9BQU87Z0JBQ1AsV0FBVyxFQUFFLEtBQUssQ0FBQyxXQUFXO2dCQUU5QixRQUFRO2dCQUNSLEtBQUssRUFBRSxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFBLHlCQUFlLEVBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTO2dCQUU3RCx3Q0FBd0M7Z0JBQ3hDLElBQUksRUFBRSxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFBLHlCQUFlLEVBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTO2dCQUMxRCxVQUFVLEVBQUUsS0FBSyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsSUFBQSx5QkFBZSxFQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUztnQkFDNUUsUUFBUSxFQUFFLEtBQUssQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLElBQUEseUJBQWUsRUFBQyxLQUFLLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVM7Z0JBQ3RFLE9BQU8sRUFBRSxLQUFLLENBQUMsT0FBTztnQkFFdEIsaUJBQWlCO2dCQUNqQixLQUFLLEVBQUUsS0FBSyxDQUFDLEtBQUs7Z0JBRWxCLHVCQUF1QjtnQkFDdkIsT0FBTyxFQUFFLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLElBQUEseUJBQWUsRUFBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVM7Z0JBRW5FLE1BQU07Z0JBQ04sR0FBRyxFQUFFLFVBQVU7YUFDaEIsQ0FBQyxDQUFDLENBQUM7WUFFSixxRUFBcUU7WUFDckUsTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQztRQUNwQyxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLE1BQU0sQ0FBQyxLQUFLLENBQUMsOEJBQThCLEVBQUUsS0FBSyxDQUFDLENBQUM7WUFDcEQscURBQXFEO1FBQ3ZELENBQUM7SUFDSCxDQUFDO0lBRU8sVUFBVSxDQUFJLEtBQVUsRUFBRSxJQUFZO1FBQzVDLE1BQU0sTUFBTSxHQUFVLEVBQUUsQ0FBQztRQUN6QixLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsS0FBSyxDQUFDLE1BQU0sRUFBRSxDQUFDLElBQUksSUFBSSxFQUFFLENBQUM7WUFDNUMsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxDQUFDLEdBQUcsSUFBSSxDQUFDLENBQUMsQ0FBQztRQUN4QyxDQUFDO1FBQ0QsT0FBTyxNQUFNLENBQUM7SUFDaEIsQ0FBQztDQUNGO0FBbEhELG9FQWtIQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IE9ic2VydmFiaWxpdHlCYWNrZW5kLCBPYnNlcnZhYmlsaXR5RXZlbnQsIE9ic2VydmFiaWxpdHlMZXZlbCB9IGZyb20gJy4uL3R5cGVzJztcbmltcG9ydCB7IE9ic2VydmFiaWxpdHlMb2dFbnRpdHkgfSBmcm9tICcuLi9zdG9yYWdlL2xvZy1lbnRpdHknO1xuaW1wb3J0IHsgdHJ1bmNhdGVQYXlsb2FkIH0gZnJvbSAnLi4vdXRpbHMvcGF5bG9hZCc7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIgfSBmcm9tICcuLi8uLi9sb2dnaW5nJztcblxuY29uc3QgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdEeW5hbW9EQk9ic2VydmFiaWxpdHlCYWNrZW5kJyk7XG5cbmV4cG9ydCBpbnRlcmZhY2UgRHluYW1vREJCYWNrZW5kT3B0aW9ucyB7XG4gIG1pbkxldmVsPzogT2JzZXJ2YWJpbGl0eUxldmVsO1xuICB0dGxEYXlzPzogbnVtYmVyO1xufVxuXG5leHBvcnQgY2xhc3MgRHluYW1vREJPYnNlcnZhYmlsaXR5QmFja2VuZCBpbXBsZW1lbnRzIE9ic2VydmFiaWxpdHlCYWNrZW5kIHtcbiAgcHVibGljIHJlYWRvbmx5IG5hbWUgPSAnZHluYW1vZGInO1xuICBwcml2YXRlIHJlYWRvbmx5IGVudGl0eSA9IE9ic2VydmFiaWxpdHlMb2dFbnRpdHkoKTtcbiAgcHVibGljIHJlYWRvbmx5IG1pbkxldmVsPzogT2JzZXJ2YWJpbGl0eUxldmVsO1xuICBwcml2YXRlIGJ1ZmZlcjogT2JzZXJ2YWJpbGl0eUV2ZW50W10gPSBbXTtcblxuICBwcml2YXRlIHJlYWRvbmx5IEJBVENIX1NJWkUgPSAyNTsgLy8gRHluYW1vREIgbWF4XG4gIHByaXZhdGUgcmVhZG9ubHkgTUFYX0JVRkZFUl9TSVpFID0gMTAwMDtcblxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IG9wdGlvbnM6IER5bmFtb0RCQmFja2VuZE9wdGlvbnMgPSB7fSkge1xuICAgIHRoaXMubWluTGV2ZWwgPSBvcHRpb25zLm1pbkxldmVsO1xuICB9XG5cbiAgaW5pdGlhbGl6ZUludm9jYXRpb24oKTogdm9pZCB7XG4gICAgLy8gQ2xlYXIgYnVmZmVyIG9uIHdhcm0gc3RhcnRcbiAgICB0aGlzLmJ1ZmZlciA9IFtdO1xuICB9XG5cbiAgYXN5bmMgY2FwdHVyZShldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5idWZmZXIucHVzaChldmVudCk7XG5cbiAgICAvLyBGbHVzaCBpZiBidWZmZXIgZnVsbFxuICAgIGlmICh0aGlzLmJ1ZmZlci5sZW5ndGggPj0gdGhpcy5CQVRDSF9TSVpFKSB7XG4gICAgICBhd2FpdCB0aGlzLmZsdXNoKCk7XG4gICAgfVxuXG4gICAgLy8gU2FmZXR5OiBQcmV2ZW50IG1lbW9yeSBvdmVyZmxvd1xuICAgIGlmICh0aGlzLmJ1ZmZlci5sZW5ndGggPj0gdGhpcy5NQVhfQlVGRkVSX1NJWkUpIHtcbiAgICAgIGxvZ2dlci53YXJuKGBEeW5hbW9EQiBidWZmZXIgb3ZlcmZsb3cgKCR7dGhpcy5idWZmZXIubGVuZ3RofSBldmVudHMpLCBmb3JjZSBmbHVzaGluZ2ApO1xuICAgICAgYXdhaXQgdGhpcy5mbHVzaCgpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGZsdXNoKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICh0aGlzLmJ1ZmZlci5sZW5ndGggPT09IDApIHJldHVybjtcblxuICAgIGNvbnN0IGV2ZW50cyA9IHRoaXMuYnVmZmVyLnNwbGljZSgwLCB0aGlzLmJ1ZmZlci5sZW5ndGgpO1xuXG4gICAgLy8gUHJvY2VzcyBpbiBiYXRjaGVzIG9mIDI1IChEeW5hbW9EQiBsaW1pdClcbiAgICBjb25zdCBiYXRjaGVzID0gdGhpcy5jaHVua0FycmF5KGV2ZW50cywgMjUpO1xuXG4gICAgZm9yIChjb25zdCBiYXRjaCBvZiBiYXRjaGVzKSB7XG4gICAgICBhd2FpdCB0aGlzLndyaXRlQmF0Y2goYmF0Y2gpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgd3JpdGVCYXRjaChldmVudHM6IE9ic2VydmFiaWxpdHlFdmVudFtdKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICBjb25zdCB0dGxTZWNvbmRzID1cbiAgICAgIHRoaXMub3B0aW9ucy50dGxEYXlzICE9PSB1bmRlZmluZWRcbiAgICAgICAgPyBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKSArIHRoaXMub3B0aW9ucy50dGxEYXlzICogMjQgKiA2MCAqIDYwXG4gICAgICAgIDogdW5kZWZpbmVkO1xuXG4gICAgICAvLyBNYXAgZXZlbnRzIHRvIGVudGl0eSByZWNvcmRzIHdpdGggY29tcGxldGUgZmllbGQgbWFwcGluZ1xuICAgICAgY29uc3QgaXRlbXMgPSBldmVudHMubWFwKChldmVudCkgPT4gKHtcbiAgICAgICAgLy8gSWRlbnRpdHkgZmllbGRzXG4gICAgICAgIGxvZ0lkOiBldmVudC5lbnRpdHlJZCwgLy8gRm9yIHNwYW5zLCB1c2UgZW50aXR5SWQgYXMgbG9nSWRcbiAgICAgICAgcGFyZW50TG9nSWQ6IGV2ZW50LnBhcmVudExvZ0lkLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiBldmVudC5jb3JyZWxhdGlvbklkLFxuICAgICAgICBcbiAgICAgICAgLy8gQ2xhc3NpZmljYXRpb25cbiAgICAgICAgdHlwZTogZXZlbnQudHlwZSxcbiAgICAgICAgc3ViVHlwZTogZXZlbnQuc3ViVHlwZSxcbiAgICAgICAgbGV2ZWw6IGV2ZW50LmxldmVsLFxuICAgICAgICBcbiAgICAgICAgLy8gRW50aXR5L1Jlc291cmNlXG4gICAgICAgIGVudGl0eU5hbWU6IGV2ZW50LmVudGl0eU5hbWUsXG4gICAgICAgIGVudGl0eUlkOiBldmVudC5lbnRpdHlJZCxcbiAgICAgICAgXG4gICAgICAgIC8vIE9wZXJhdGlvblxuICAgICAgICBvcGVyYXRpb246IGV2ZW50Lm9wZXJhdGlvbixcbiAgICAgICAgXG4gICAgICAgIC8vIE91dGNvbWVcbiAgICAgICAgc3VjY2VzczogZXZlbnQuc3VjY2VzcyxcbiAgICAgICAgc3RhdHVzOiBldmVudC5zdGF0dXMsXG4gICAgICAgIGR1cmF0aW9uTXM6IGV2ZW50LmR1cmF0aW9uTXMsXG4gICAgICAgIFxuICAgICAgICAvLyBUaW1lXG4gICAgICAgIHRpbWVzdGFtcE1zOiBldmVudC50aW1lc3RhbXBNcyxcbiAgICAgICAgXG4gICAgICAgIC8vIEFjdG9yXG4gICAgICAgIGFjdG9yOiBldmVudC5hY3RvciA/IHRydW5jYXRlUGF5bG9hZChldmVudC5hY3RvcikgOiB1bmRlZmluZWQsXG4gICAgICAgIFxuICAgICAgICAvLyBQYXlsb2FkcyAoa2VlcCBzZXBhcmF0ZSwgZG9uJ3QgbWVyZ2UpXG4gICAgICAgIGRhdGE6IGV2ZW50LmRhdGEgPyB0cnVuY2F0ZVBheWxvYWQoZXZlbnQuZGF0YSkgOiB1bmRlZmluZWQsXG4gICAgICAgIGF0dHJpYnV0ZXM6IGV2ZW50LmF0dHJpYnV0ZXMgPyB0cnVuY2F0ZVBheWxvYWQoZXZlbnQuYXR0cmlidXRlcykgOiB1bmRlZmluZWQsXG4gICAgICAgIG1ldGFkYXRhOiBldmVudC5tZXRhZGF0YSA/IHRydW5jYXRlUGF5bG9hZChldmVudC5tZXRhZGF0YSkgOiB1bmRlZmluZWQsXG4gICAgICAgIG1ldHJpY3M6IGV2ZW50Lm1ldHJpY3MsXG4gICAgICAgIFxuICAgICAgICAvLyBFcnJvciBoYW5kbGluZ1xuICAgICAgICBlcnJvcjogZXZlbnQuZXJyb3IsXG4gICAgICAgIFxuICAgICAgICAvLyBDb250ZXh0IChpZiBwcmVzZW50KVxuICAgICAgICBjb250ZXh0OiBldmVudC5jb250ZXh0ID8gdHJ1bmNhdGVQYXlsb2FkKGV2ZW50LmNvbnRleHQpIDogdW5kZWZpbmVkLFxuICAgICAgICBcbiAgICAgICAgLy8gVFRMXG4gICAgICAgIHR0bDogdHRsU2Vjb25kcyxcbiAgICAgIH0pKTtcblxuICAgICAgLy8gV3JpdGUgYWxsIGl0ZW1zIHVzaW5nIEVsZWN0cm9EQiBiYXRjaCB3cml0ZSAodHJ1ZSBiYXRjaCBvcGVyYXRpb24pXG4gICAgICBhd2FpdCB0aGlzLmVudGl0eS5wdXQoaXRlbXMpLmdvKCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGxvZ2dlci5lcnJvcignRHluYW1vREIgYmF0Y2ggd3JpdGUgZmFpbGVkOicsIGVycm9yKTtcbiAgICAgIC8vIERvbid0IHRocm93IC0gb2JzZXJ2YWJpbGl0eSBzaG91bGQgbmV2ZXIgYnJlYWsgYXBwXG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBjaHVua0FycmF5PFQ+KGFycmF5OiBUW10sIHNpemU6IG51bWJlcik6IFRbXVtdIHtcbiAgICBjb25zdCBjaHVua3M6IFRbXVtdID0gW107XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBhcnJheS5sZW5ndGg7IGkgKz0gc2l6ZSkge1xuICAgICAgY2h1bmtzLnB1c2goYXJyYXkuc2xpY2UoaSwgaSArIHNpemUpKTtcbiAgICB9XG4gICAgcmV0dXJuIGNodW5rcztcbiAgfVxufVxuIl19