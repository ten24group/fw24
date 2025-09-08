"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditCaptureService = void 0;
exports.captureLog = captureLog;
exports.captureError = captureError;
const factory_1 = require("../loggers/factory");
const crypto_1 = require("crypto");
const data_protection_1 = require("./data-protection");
/**
 * Enhanced capture log function for the existing audit system
 *
 * This is the primary interface for logging throughout the application.
 * It automatically extracts context from the execution environment and
 * provides sensible defaults for required fields.
 */
async function captureLog(options) {
    try {
        const auditLogger = factory_1.AuditLoggerFactory.getInstance().create();
        // Extract context information
        const actor = options.actor || options.ctx?.actor;
        const correlationId = options.correlationId || options.ctx?.request?.requestId || (0, crypto_1.randomUUID)();
        const ipAddress = options.ctx?.event?.requestContext?.identity?.sourceIp;
        // Build metrics object only if needed
        const metrics = {};
        if (options.metrics) {
            Object.assign(metrics, options.metrics);
        }
        if (options.duration !== undefined) {
            metrics.duration = options.duration;
        }
        // Determine status based on success flag
        let status = options.status;
        if (status === undefined && options.success !== undefined) {
            status = options.success ? 'completed' : 'failed';
        }
        // Create the enhanced audit entry
        const auditEntry = {
            // === CLASSIFICATION ===
            logType: options.logType || 'audit',
            subType: options.subType,
            severity: options.severity || 'info',
            category: options.category,
            // === ENTITY/RESOURCE TRACKING ===
            entityName: options.entityName || 'unknown',
            entityId: options.entityId,
            eventType: options.eventType || 'unknown',
            operation: options.operation,
            // === SERVICE CONTEXT ===
            service: options.service,
            externalSystem: options.externalSystem,
            externalId: options.externalId,
            // === STATUS & OUTCOME ===
            status,
            success: options.success,
            ipAddress,
            // === METRICS ===
            metrics: Object.keys(metrics).length > 0 ? metrics : undefined,
            // === TRACKING ===
            correlationId,
            // === ACTOR ===
            actor,
            // === DATA BLOCKS ===
            data: options.data,
            metadata: options.metadata,
            context: options.context,
            // === TTL ===
            ttl: options.ttl
        };
        // Apply data protection
        const dataProtectionConfig = {
            ...options.dataProtection
        };
        const protectedAuditEntry = (0, data_protection_1.protectAuditData)(auditEntry, dataProtectionConfig);
        // Create audit options
        const auditOptions = {
            enabled: options.enabled,
            auditEntry: protectedAuditEntry
        };
        // Log the entry using the existing audit system
        await auditLogger.audit(auditOptions);
    }
    catch (error) {
        // Don't break business logic on logging failures
        console.error('Failed to capture audit log:', error, {
            logType: options.logType,
            subType: options.subType,
            entityName: options.entityName,
            correlationId: options.correlationId
        });
    }
}
/**
 * Convenience function for capturing errors with proper error formatting
 * This is actually useful since it handles error object serialization
 */
async function captureError(error, options) {
    return captureLog({
        ...options,
        severity: 'error',
        success: false,
        status: 'failed',
        data: {
            error: error
        }
    });
}
/**
 * Audit capture service to handle audit logging for all controller types
 * This service breaks the circular import cycle by keeping audit logic separate from controllers
 */
class AuditCaptureService {
    /**
     * Captures audit log for operation start
     */
    static async captureStart(auditContext, operationContext) {
        if (!auditContext.enabled || auditContext.auditConfig.skipStart)
            return;
        // For 'single' strategy, don't log start - just store context for later
        if (auditContext.auditConfig.strategy === 'single') {
            // Store the operation context for later use in captureEnd
            if (!auditContext.auditConfig.customContext) {
                auditContext.auditConfig.customContext = {};
            }
            auditContext.auditConfig.customContext._operationContext = operationContext;
            return;
        }
        // Check sampling
        if (auditContext.auditConfig.samplingFn &&
            !auditContext.auditConfig.samplingFn(auditContext.correlation.correlationId, auditContext.operation)) {
            return;
        }
        await captureLog({
            logType: auditContext.logType,
            subType: `${auditContext.subType}_start`,
            entityName: auditContext.entityName,
            entityId: auditContext.entityId,
            eventType: 'start',
            operation: auditContext.operation,
            category: auditContext.category,
            correlationId: auditContext.correlation.correlationId,
            actor: auditContext.actor,
            context: {
                correlation: auditContext.correlation,
                [auditContext.correlation.operationType]: operationContext
            },
            metadata: auditContext.auditConfig.customContext,
            ttl: auditContext.auditConfig.ttl,
            dataProtection: auditContext.auditConfig.dataProtection
        });
    }
    /**
     * Captures audit log for operation end (success or error)
     */
    static async captureEnd(auditContext, _result, error, responseContext) {
        if (!auditContext.enabled)
            return;
        if (error && auditContext.auditConfig.skipErrors)
            return;
        if (!error && auditContext.auditConfig.skipEnd)
            return;
        // Check sampling
        if (auditContext.auditConfig.samplingFn &&
            !auditContext.auditConfig.samplingFn(auditContext.correlation.correlationId, auditContext.operation)) {
            return;
        }
        const duration = Date.now() - new Date(auditContext.correlation.startTimestamp).getTime();
        // For 'single' strategy, create comprehensive audit entry
        if (auditContext.auditConfig.strategy === 'single') {
            const operationContext = auditContext.auditConfig.customContext?._operationContext;
            await captureLog({
                logType: auditContext.logType,
                subType: auditContext.subType,
                entityName: auditContext.entityName,
                entityId: auditContext.entityId,
                eventType: error ? 'failed' : 'completed',
                operation: auditContext.operation,
                category: auditContext.category,
                success: !error,
                status: error ? 'failed' : 'completed',
                correlationId: auditContext.correlation.correlationId,
                actor: auditContext.actor,
                // Use existing fields for comprehensive data
                data: {
                    request: operationContext,
                    response: responseContext,
                    timing: {
                        startTime: auditContext.correlation.startTimestamp,
                        endTime: new Date().toISOString(),
                        duration
                    },
                    error: error ? {
                        name: error.name,
                        message: error.message,
                        stack: error.stack
                    } : undefined
                },
                metrics: {
                    duration,
                    ...(responseContext ? {
                        statusCode: responseContext.statusCode,
                        responseSize: responseContext.responseSize
                    } : {})
                },
                context: {
                    correlation: auditContext.correlation
                },
                metadata: auditContext.auditConfig.customContext,
                ttl: auditContext.auditConfig.ttl,
                dataProtection: auditContext.auditConfig.dataProtection
            });
            return;
        }
        // Default 'separate' strategy (existing behavior)
        await captureLog({
            logType: auditContext.logType,
            subType: error ? `${auditContext.subType}_error` : `${auditContext.subType}_complete`,
            entityName: auditContext.entityName,
            entityId: auditContext.entityId,
            eventType: error ? 'error' : 'complete',
            operation: auditContext.operation,
            category: auditContext.category,
            success: !error,
            status: error ? 'failed' : 'completed',
            correlationId: auditContext.correlation.correlationId,
            actor: auditContext.actor,
            metrics: {
                duration,
                ...(responseContext ? {
                    statusCode: responseContext.statusCode,
                    responseSize: responseContext.responseSize
                } : {})
            },
            context: {
                correlation: auditContext.correlation,
                ...(responseContext && { response: responseContext })
            },
            metadata: auditContext.auditConfig.customContext,
            ttl: auditContext.auditConfig.ttl,
            dataProtection: auditContext.auditConfig.dataProtection,
            data: { error }
        });
    }
}
exports.AuditCaptureService = AuditCaptureService;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXVkaXQtaGVscGVycy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9hdWRpdC9oZWxwZXJzL2F1ZGl0LWhlbHBlcnMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBK0VBLGdDQTBGQztBQU1ELG9DQWFDO0FBM0xELGdEQUF3RDtBQUd4RCxtQ0FBb0M7QUFFcEMsdURBQTJFO0FBa0UzRTs7Ozs7O0dBTUc7QUFDSSxLQUFLLFVBQVUsVUFBVSxDQUFDLE9BQTBCO0lBQ3pELElBQUksQ0FBQztRQUNILE1BQU0sV0FBVyxHQUFHLDRCQUFrQixDQUFDLFdBQVcsRUFBRSxDQUFDLE1BQU0sRUFBRSxDQUFDO1FBRTlELDhCQUE4QjtRQUM5QixNQUFNLEtBQUssR0FBRyxPQUFPLENBQUMsS0FBSyxJQUFJLE9BQU8sQ0FBQyxHQUFHLEVBQUUsS0FBSyxDQUFDO1FBQ2xELE1BQU0sYUFBYSxHQUFHLE9BQU8sQ0FBQyxhQUFhLElBQUksT0FBTyxDQUFDLEdBQUcsRUFBRSxPQUFPLEVBQUUsU0FBUyxJQUFJLElBQUEsbUJBQVUsR0FBRSxDQUFDO1FBQy9GLE1BQU0sU0FBUyxHQUFHLE9BQU8sQ0FBQyxHQUFHLEVBQUUsS0FBSyxFQUFFLGNBQWMsRUFBRSxRQUFRLEVBQUUsUUFBUSxDQUFDO1FBRXpFLHNDQUFzQztRQUN0QyxNQUFNLE9BQU8sR0FBd0IsRUFBRSxDQUFDO1FBQ3hDLElBQUksT0FBTyxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBQ3BCLE1BQU0sQ0FBQyxNQUFNLENBQUMsT0FBTyxFQUFFLE9BQU8sQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUMxQyxDQUFDO1FBQ0QsSUFBSSxPQUFPLENBQUMsUUFBUSxLQUFLLFNBQVMsRUFBRSxDQUFDO1lBQ25DLE9BQU8sQ0FBQyxRQUFRLEdBQUcsT0FBTyxDQUFDLFFBQVEsQ0FBQztRQUN0QyxDQUFDO1FBRUQseUNBQXlDO1FBQ3pDLElBQUksTUFBTSxHQUFHLE9BQU8sQ0FBQyxNQUFN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ZUFBZSxDQUFDLFlBQVk7aUJBQzNDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQzthQUNSO1lBQ0QsT0FBTyxFQUFFO2dCQUNQLFdBQVcsRUFBRSxZQUFZLENBQUMsV0FBVztnQkFDckMsR0FBRyxDQUFDLGVBQWUsSUFBSSxFQUFFLFFBQVEsRUFBRSxlQUFlLEVBQUUsQ0FBQzthQUN0RDtZQUNELFFBQVEsRUFBRSxZQUFZLENBQUMsV0FBVyxDQUFDLGFBQWE7WUFDaEQsR0FBRyxFQUFFLFlBQVksQ0FBQyxXQUFXLENBQUMsR0FBRztZQUNqQyxjQUFjLEVBQUUsWUFBWSxDQUFDLFdBQVcsQ0FBQyxjQUFjO1lBQ3ZELElBQUksRUFBRSxFQUFFLEtBQUssRUFBRTtTQUNoQixDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUF0SkQsa0RBc0pDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQXVkaXRFbnRyeSwgQXVkaXRPcHRpb25zIH0gZnJvbSAnLi4vaW50ZXJmYWNlcyc7XG5pbXBvcnQgeyBBdWRpdExvZ2dlckZhY3RvcnkgfSBmcm9tICcuLi9sb2dnZXJzL2ZhY3RvcnknO1xuaW1wb3J0IHsgQWN0b3IgfSBmcm9tIFwiLi4vLi4vY29yZS90eXBlcy9leGVjdXRpb24tY29udGV4dFwiO1xuaW1wb3J0IHsgRXhlY3V0aW9uQ29udGV4dCB9IGZyb20gJy4uLy4uL2NvcmUvdHlwZXMvZXhlY3V0aW9uLWNvbnRleHQnO1xuaW1wb3J0IHsgcmFuZG9tVVVJRCB9IGZyb20gJ2NyeXB0byc7XG5pbXBvcnQgeyBBdWRpdENvbnRleHQsIFJlcXVlc3RBdWRpdENvbnRleHQsIFF1ZXVlQXVkaXRDb250ZXh0LCBUYXNrQXVkaXRDb250ZXh0IH0gZnJvbSAnLi4vLi4vZncyNCc7XG5pbXBvcnQgeyBwcm90ZWN0QXVkaXREYXRhLCBEYXRhUHJvdGVjdGlvbkNvbmZpZyB9IGZyb20gJy4vZGF0YS1wcm90ZWN0aW9uJztcblxuLyoqXG4gKiBFbmhhbmNlZCBjYXB0dXJlIG9wdGlvbnMgZm9yIHRoZSBhdWRpdCBzeXN0ZW1cbiAqIFxuICogVGhpcyBpbnRlcmZhY2UgcHJvdmlkZXMgb3B0aW9ucyBmb3IgY2FwdHVyaW5nIGxvZ3Mgd2l0aCBhdXRvbWF0aWNcbiAqIGNvbnRleHQgZXh0cmFjdGlvbiB3aGlsZSBtYWludGFpbmluZyBiYWNrd2FyZCBjb21wYXRpYmlsaXR5LlxuICovXG5leHBvcnQgaW50ZXJmYWNlIENhcHR1cmVMb2dPcHRpb25zIHtcbiAgLy8gPT09IENMQVNTSUZJQ0FUSU9OID09PVxuICBsb2dUeXBlPzogJ2F1ZGl0JyB8ICdsb2cnIHwgJ2V2ZW50JyB8ICdtZXRyaWMnO1xuICBzdWJUeXBlPzogc3RyaW5nO1xuICBzZXZlcml0eT86ICdpbmZvJyB8ICd3YXJuJyB8ICdlcnJvcicgfCAnY3JpdGljYWwnO1xuICBjYXRlZ29yeT86IHN0cmluZztcbiAgXG4gIC8vID09PSBFTlRJVFkvUkVTT1VSQ0UgVFJBQ0tJTkcgPT09XG4gIGVudGl0eU5hbWU/OiBzdHJpbmc7XG4gIGVudGl0eUlkPzogc3RyaW5nO1xuICBldmVudFR5cGU/OiBzdHJpbmc7XG4gIG9wZXJhdGlvbj86IHN0cmluZztcbiAgXG4gIC8vID09PSBTRVJWSUNFIENPTlRFWFQgPT09XG4gIHNlcnZpY2U/OiBzdHJpbmc7XG4gIGV4dGVybmFsU3lzdGVtPzogc3RyaW5nO1xuICBleHRlcm5hbElkPzogc3RyaW5nO1xuICBcbiAgLy8gPT09IFNUQVRVUyAmIE9VVENPTUUgPT09XG4gIHN0YXR1cz86IHN0cmluZztcbiAgc3VjY2Vzcz86IGJvb2xlYW47XG4gIFxuICAvLyA9PT0gTUVUUklDUyA9PT1cbiAgbWV0cmljcz86IHtcbiAgICBkdXJhdGlvbj86IG51bWJlcjtcbiAgICBhbW91bnQ/OiBudW1iZXI7XG4gICAgY3VycmVuY3k/OiBzdHJpbmc7XG4gICAgcmVjb3JkQ291bnQ/OiBudW1iZXI7XG4gICAgZGF0YVNpemU/OiBudW1iZXI7XG4gICAgcmVzcG9uc2VUaW1lPzogbnVtYmVyO1xuICAgIHRocm91Z2hwdXQ/OiBudW1iZXI7XG4gICAgZXJyb3JSYXRlPzogbnVtYmVyO1xuICAgIFtrZXk6IHN0cmluZ106IGFueTtcbiAgfTtcbiAgXG4gIC8vID09PSBUUkFDS0lORyA9PT1cbiAgY29ycmVsYXRpb25JZD86IHN0cmluZztcbiAgXG4gIC8vID09PSBEQVRBIEJMT0NLUyA9PT1cbiAgZGF0YT86IGFueTtcbiAgbWV0YWRhdGE/OiBhbnk7XG4gIGNvbnRleHQ/OiBhbnk7XG4gIFxuICAvLyA9PT0gUlVOVElNRSBDT05URVhUID09PVxuICBjdHg/OiBFeGVjdXRpb25Db250ZXh0O1xuICBhY3Rvcj86IEFjdG9yO1xuICBcbiAgLy8gPT09IENPTlZFTklFTkNFID09PVxuICBkdXJhdGlvbj86IG51bWJlcjsgLy8gV2lsbCBiZSBhZGRlZCB0byBtZXRyaWNzXG4gIFxuICAvLyA9PT0gVFRMICYgREFUQSBQUk9URUNUSU9OID09PVxuICB0dGw/OiBudW1iZXI7ICAgICAgICAgICAgICAgICAgICAgIC8vIEN1c3RvbSBUVEwgdGltZXN0YW1wIChVbml4IHNlY29uZHMpXG4gIGRhdGFQcm90ZWN0aW9uPzogRGF0YVByb3RlY3Rpb25Db25maWc7XG4gIFxuICAvLyA9PT0gQ09OVFJPTCA9PT1cbiAgZW5hYmxlZD86IGJvb2xlYW47XG59XG5cbi8qKlxuICogRW5oYW5jZWQgY2FwdHVyZSBsb2cgZnVuY3Rpb24gZm9yIHRoZSBleGlzdGluZyBhdWRpdCBzeXN0ZW1cbiAqIFxuICogVGhpcyBpcyB0aGUgcHJpbWFyeSBpbnRlcmZhY2UgZm9yIGxvZ2dpbmcgdGhyb3VnaG91dCB0aGUgYXBwbGljYXRpb24uXG4gKiBJdCBhdXRvbWF0aWNhbGx5IGV4dHJhY3RzIGNvbnRleHQgZnJvbSB0aGUgZXhlY3V0aW9uIGVudmlyb25tZW50IGFuZFxuICogcHJvdmlkZXMgc2Vuc2libGUgZGVmYXVsdHMgZm9yIHJlcXVpcmVkIGZpZWxkcy5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNhcHR1cmVMb2cob3B0aW9uczogQ2FwdHVyZUxvZ09wdGlvbnMpOiBQcm9taXNlPHZvaWQ+IHtcbiAgdHJ5IHtcbiAgICBjb25zdCBhdWRpdExvZ2dlciA9IEF1ZGl0TG9nZ2VyRmFjdG9yeS5nZXRJbnN0YW5jZSgpLmNyZWF0ZSgpO1xuICAgIFxuICAgIC8vIEV4dHJhY3QgY29udGV4dCBpbmZvcm1hdGlvblxuICAgIGNvbnN0IGFjdG9yID0gb3B0aW9ucy5hY3RvciB8fCBvcHRpb25zLmN0eD8uYWN0b3I7XG4gICAgY29uc3QgY29ycmVsYXRpb25JZCA9IG9wdGlvbnMuY29ycmVsYXRpb25JZCB8fCBvcHRpb25zLmN0eD8ucmVxdWVzdD8ucmVxdWVzdElkIHx8IHJhbmRvbVVVSUQoKTtcbiAgICBjb25zdCBpcEFkZHJlc3MgPSBvcHRpb25zLmN0eD8uZXZlbnQ/LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8uc291cmNlSXA7XG4gICAgXG4gICAgLy8gQnVpbGQgbWV0cmljcyBvYmplY3Qgb25seSBpZiBuZWVkZWRcbiAgICBjb25zdCBtZXRyaWNzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG4gICAgaWYgKG9wdGlvbnMubWV0cmljcykge1xuICAgICAgT2JqZWN0LmFzc2lnbihtZXRyaWNzLCBvcHRpb25zLm1ldHJpY3MpO1xuICAgIH1cbiAgICBpZiAob3B0aW9ucy5kdXJhdGlvbiAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBtZXRyaWNzLmR1cmF0aW9uID0gb3B0aW9ucy5kdXJhdGlvbjtcbiAgICB9XG4gICAgXG4gICAgLy8gRGV0ZXJtaW5lIHN0YXR1cyBiYXNlZCBvbiBzdWNjZXNzIGZsYWdcbiAgICBsZXQgc3RhdHVzID0gb3B0aW9ucy5zdGF0dXM7XG4gICAgaWYgKHN0YXR1cyA9PT0gdW5kZWZpbmVkICYmIG9wdGlvbnMuc3VjY2VzcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBzdGF0dXMgPSBvcHRpb25zLnN1Y2Nlc3MgPyAnY29tcGxldGVkJyA6ICdmYWlsZWQnO1xuICAgIH1cbiAgICBcbiAgICAvLyBDcmVhdGUgdGhlIGVuaGFuY2VkIGF1ZGl0IGVudHJ5XG4gICAgY29uc3QgYXVkaXRFbnRyeTogQXVkaXRFbnRyeSA9IHtcbiAgICAgIC8vID09PSBDTEFTU0lGSUNBVElPTiA9PT1cbiAgICAgIGxvZ1R5cGU6IG9wdGlvbnMubG9nVHlwZSB8fCAnYXVkaXQnLFxuICAgICAgc3ViVHlwZTogb3B0aW9ucy5zdWJUeXBlLFxuICAgICAgc2V2ZXJpdHk6IG9wdGlvbnMuc2V2ZXJpdHkgfHwgJ2luZm8nLFxuICAgICAgY2F0ZWdvcnk6IG9wdGlvbnMuY2F0ZWdvcnksXG4gICAgICBcbiAgICAgIC8vID09PSBFTlRJVFkvUkVTT1VSQ0UgVFJBQ0tJTkcgPT09XG4gICAgICBlbnRpdHlOYW1lOiBvcHRpb25zLmVudGl0eU5hbWUgfHwgJ3Vua25vd24nLFxuICAgICAgZW50aXR5SWQ6IG9wdGlvbnMuZW50aXR5SWQsXG4gICAgICBldmVudFR5cGU6IG9wdGlvbnMuZXZlbnRUeXBlIHx8ICd1bmtub3duJyxcbiAgICAgIG9wZXJhdGlvbjogb3B0aW9ucy5vcGVyYXRpb24sXG4gICAgICBcbiAgICAgIC8vID09PSBTRVJWSUNFIENPTlRFWFQgPT09XG4gICAgICBzZXJ2aWNlOiBvcHRpb25zLnNlcnZpY2UsXG4gICAgICBleHRlcm5hbFN5c3RlbTogb3B0aW9ucy5leHRlcm5hbFN5c3RlbSxcbiAgICAgIGV4dGVybmFsSWQ6IG9wdGlvbnMuZXh0ZXJuYWxJZCxcbiAgICAgIFxuICAgICAgLy8gPT09IFNUQVRVUyAmIE9VVENPTUUgPT09XG4gICAgICBzdGF0dXMsXG4gICAgICBzdWNjZXNzOiBvcHRpb25zLnN1Y2Nlc3MsXG4gICAgICBpcEFkZHJlc3MsXG4gICAgICBcbiAgICAgIC8vID09PSBNRVRSSUNTID09PVxuICAgICAgbWV0cmljczogT2JqZWN0LmtleXMobWV0cmljcykubGVuZ3RoID4gMCA/IG1ldHJpY3MgOiB1bmRlZmluZWQsXG4gICAgICBcbiAgICAgIC8vID09PSBUUkFDS0lORyA9PT1cbiAgICAgIGNvcnJlbGF0aW9uSWQsXG4gICAgICBcbiAgICAgIC8vID09PSBBQ1RPUiA9PT1cbiAgICAgIGFjdG9yLFxuICAgICAgXG4gICAgICAvLyA9PT0gREFUQSBCTE9DS1MgPT09XG4gICAgICBkYXRhOiBvcHRpb25zLmRhdGEsXG4gICAgICBtZXRhZGF0YTogb3B0aW9ucy5tZXRhZGF0YSxcbiAgICAgIGNvbnRleHQ6IG9wdGlvbnMuY29udGV4dCxcbiAgICAgIFxuICAgICAgLy8gPT09IFRUTCA9PT1cbiAgICAgIHR0bDogb3B0aW9ucy50dGxcbiAgICB9O1xuICAgIFxuICAgIC8vIEFwcGx5IGRhdGEgcHJvdGVjdGlvblxuICAgIGNvbnN0IGRhdGFQcm90ZWN0aW9uQ29uZmlnID0ge1xuICAgICAgLi4ub3B0aW9ucy5kYXRhUHJvdGVjdGlvblxuICAgIH07XG4gICAgY29uc3QgcHJvdGVjdGVkQXVkaXRFbnRyeSA9IHByb3RlY3RBdWRpdERhdGEoYXVkaXRFbnRyeSwgZGF0YVByb3RlY3Rpb25Db25maWcpO1xuICAgIFxuICAgIC8vIENyZWF0ZSBhdWRpdCBvcHRpb25zXG4gICAgY29uc3QgYXVkaXRPcHRpb25zOiBBdWRpdE9wdGlvbnMgPSB7XG4gICAgICBlbmFibGVkOiBvcHRpb25zLmVuYWJsZWQsXG4gICAgICBhdWRpdEVudHJ5OiBwcm90ZWN0ZWRBdWRpdEVudHJ5XG4gICAgfTtcbiAgICBcbiAgICAvLyBMb2cgdGhlIGVudHJ5IHVzaW5nIHRoZSBleGlzdGluZyBhdWRpdCBzeXN0ZW1cbiAgICBhd2FpdCBhdWRpdExvZ2dlci5hdWRpdChhdWRpdE9wdGlvbnMpO1xuICAgIFxuICB9IGNhdGNoIChlcnJvcikge1xuICAgIC8vIERvbid0IGJyZWFrIGJ1c2luZXNzIGxvZ2ljIG9uIGxvZ2dpbmcgZmFpbHVyZXNcbiAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gY2FwdHVyZSBhdWRpdCBsb2c6JywgZXJyb3IsIHtcbiAgICAgIGxvZ1R5cGU6IG9wdGlvbnMubG9nVHlwZSxcbiAgICAgIHN1YlR5cGU6IG9wdGlvbnMuc3ViVHlwZSxcbiAgICAgIGVudGl0eU5hbWU6IG9wdGlvbnMuZW50aXR5TmFtZSxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IG9wdGlvbnMuY29ycmVsYXRpb25JZFxuICAgIH0pO1xuICB9XG59XG5cbi8qKlxuICogQ29udmVuaWVuY2UgZnVuY3Rpb24gZm9yIGNhcHR1cmluZyBlcnJvcnMgd2l0aCBwcm9wZXIgZXJyb3IgZm9ybWF0dGluZ1xuICogVGhpcyBpcyBhY3R1YWxseSB1c2VmdWwgc2luY2UgaXQgaGFuZGxlcyBlcnJvciBvYmplY3Qgc2VyaWFsaXphdGlvblxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY2FwdHVyZUVycm9yKFxuICBlcnJvcjogRXJyb3IgfCB1bmtub3duLCBcbiAgb3B0aW9uczogT21pdDxDYXB0dXJlTG9nT3B0aW9ucywgJ3NldmVyaXR5JyB8ICdzdWNjZXNzJyB8ICdzdGF0dXMnIHwgJ2RhdGEnPlxuKTogUHJvbWlzZTx2b2lkPiB7XG4gIHJldHVybiBjYXB0dXJlTG9nKHtcbiAgICAuLi5vcHRpb25zLFxuICAgIHNldmVyaXR5OiAnZXJyb3InLFxuICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgIHN0YXR1czogJ2ZhaWxlZCcsXG4gICAgZGF0YToge1xuICAgICAgZXJyb3I6IGVycm9yXG4gICAgfVxuICB9KTtcbn1cbi8qKlxuICogQXVkaXQgY2FwdHVyZSBzZXJ2aWNlIHRvIGhhbmRsZSBhdWRpdCBsb2dnaW5nIGZvciBhbGwgY29udHJvbGxlciB0eXBlc1xuICogVGhpcyBzZXJ2aWNlIGJyZWFrcyB0aGUgY2lyY3VsYXIgaW1wb3J0IGN5Y2xlIGJ5IGtlZXBpbmcgYXVkaXQgbG9naWMgc2VwYXJhdGUgZnJvbSBjb250cm9sbGVyc1xuICovXG5cbmV4cG9ydCBjbGFzcyBBdWRpdENhcHR1cmVTZXJ2aWNlIHtcblxuICAvKipcbiAgICogQ2FwdHVyZXMgYXVkaXQgbG9nIGZvciBvcGVyYXRpb24gc3RhcnRcbiAgICovXG4gIHN0YXRpYyBhc3luYyBjYXB0dXJlU3RhcnQoXG4gICAgYXVkaXRDb250ZXh0OiBBdWRpdENvbnRleHQsXG4gICAgb3BlcmF0aW9uQ29udGV4dDogUmVxdWVzdEF1ZGl0Q29udGV4dCB8IFF1ZXVlQXVkaXRDb250ZXh0IHwgVGFza0F1ZGl0Q29udGV4dFxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWF1ZGl0Q29udGV4dC5lbmFibGVkIHx8IGF1ZGl0Q29udGV4dC5hdWRpdENvbmZpZy5za2lwU3RhcnQpIHJldHVybjtcbiAgICBcbiAgICAvLyBGb3IgJ3NpbmdsZScgc3RyYXRlZ3ksIGRvbid0IGxvZyBzdGFydCAtIGp1c3Qgc3RvcmUgY29udGV4dCBmb3IgbGF0ZXJcbiAgICBpZiAoYXVkaXRDb250ZXh0LmF1ZGl0Q29uZmlnLnN0cmF0ZWd5ID09PSAnc2luZ2xlJykge1xuICAgICAgLy8gU3RvcmUgdGhlIG9wZXJhdGlvbiBjb250ZXh0IGZvciBsYXRlciB1c2UgaW4gY2FwdHVyZUVuZFxuICAgICAgaWYgKCFhdWRpdENvbnRleHQuYXVkaXRDb25maWcuY3VzdG9tQ29udGV4dCkge1xuICAgICAgICBhdWRpdENvbnRleHQuYXVkaXRDb25maWcuY3VzdG9tQ29udGV4dCA9IHt9O1xuICAgICAgfVxuICAgICAgYXVkaXRDb250ZXh0LmF1ZGl0Q29uZmlnLmN1c3RvbUNvbnRleHQuX29wZXJhdGlvbkNvbnRleHQgPSBvcGVyYXRpb25Db250ZXh0O1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIENoZWNrIHNhbXBsaW5nXG4gICAgaWYgKGF1ZGl0Q29udGV4dC5hdWRpdENvbmZpZy5zYW1wbGluZ0ZuICYmXG4gICAgICAhYXVkaXRDb250ZXh0LmF1ZGl0Q29uZmlnLnNhbXBsaW5nRm4oYXVkaXRDb250ZXh0LmNvcnJlbGF0aW9uLmNvcnJlbGF0aW9uSWQsIGF1ZGl0Q29udGV4dC5vcGVyYXRpb24pKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgYXdhaXQgY2FwdHVyZUxvZyh7XG4gICAgICBsb2dUeXBlOiBhdWRpdENvbnRleHQubG9nVHlwZSxcbiAgICAgIHN1YlR5cGU6IGAke2F1ZGl0Q29udGV4dC5zdWJUeXBlfV9zdGFydGAsXG4gICAgICBlbnRpdHlOYW1lOiBhdWRpdENvbnRleHQuZW50aXR5TmFtZSxcbiAgICAgIGVudGl0eUlkOiBhdWRpdENvbnRleHQuZW50aXR5SWQsXG4gICAgICBldmVudFR5cGU6ICdzdGFydCcsXG4gICAgICBvcGVyYXRpb246IGF1ZGl0Q29udGV4dC5vcGVyYXRpb24sXG4gICAgICBjYXRlZ29yeTogYXVkaXRDb250ZXh0LmNhdGVnb3J5LFxuICAgICAgY29ycmVsYXRpb25JZDogYXVkaXRDb250ZXh0LmNvcnJlbGF0aW9uLmNvcnJlbGF0aW9uSWQsXG4gICAgICBhY3RvcjogYXVkaXRDb250ZXh0LmFjdG9yLFxuICAgICAgY29udGV4dDoge1xuICAgICAgICBjb3JyZWxhdGlvbjogYXVkaXRDb250ZXh0LmNvcnJlbGF0aW9uLFxuICAgICAgICBbIGF1ZGl0Q29udGV4dC5jb3JyZWxhdGlvbi5vcGVyYXRpb25UeXBlIF06IG9wZXJhdGlvbkNvbnRleHRcbiAgICAgIH0sXG4gICAgICBtZXRhZGF0YTogYXVkaXRDb250ZXh0LmF1ZGl0Q29uZmlnLmN1c3RvbUNvbnRleHQsXG4gICAgICB0dGw6IGF1ZGl0Q29udGV4dC5hdWRpdENvbmZpZy50dGwsXG4gICAgICBkYXRhUHJvdGVjdGlvbjogYXVkaXRDb250ZXh0LmF1ZGl0Q29uZmlnLmRhdGFQcm90ZWN0aW9uXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogQ2FwdHVyZXMgYXVkaXQgbG9nIGZvciBvcGVyYXRpb24gZW5kIChzdWNjZXNzIG9yIGVycm9yKVxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGNhcHR1cmVFbmQoXG4gICAgYXVkaXRDb250ZXh0OiBBdWRpdENvbnRleHQsXG4gICAgX3Jlc3VsdDogYW55LFxuICAgIGVycm9yOiBFcnJvciB8IG51bGwsXG4gICAgcmVzcG9uc2VDb250ZXh0PzogYW55XG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghYXVkaXRDb250ZXh0LmVuYWJsZWQpIHJldHVybjtcbiAgICBpZiAoZXJyb3IgJiYgYXVkaXRDb250ZXh0LmF1ZGl0Q29uZmlnLnNraXBFcnJvcnMpIHJldHVybjtcbiAgICBpZiAoIWVycm9yICYmIGF1ZGl0Q29udGV4dC5hdWRpdENvbmZpZy5za2lwRW5kKSByZXR1cm47XG5cbiAgICAvLyBDaGVjayBzYW1wbGluZ1xuICAgIGlmIChhdWRpdENvbnRleHQuYXVkaXRDb25maWcuc2FtcGxpbmdGbiAmJlxuICAgICAgIWF1ZGl0Q29udGV4dC5hdWRpdENvbmZpZy5zYW1wbGluZ0ZuKGF1ZGl0Q29udGV4dC5jb3JyZWxhdGlvbi5jb3JyZWxhdGlvbklkLCBhdWRpdENvbnRleHQub3BlcmF0aW9uKSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGR1cmF0aW9uID0gRGF0ZS5ub3coKSAtIG5ldyBEYXRlKGF1ZGl0Q29udGV4dC5jb3JyZWxhdGlvbi5zdGFydFRpbWVzdGFtcCkuZ2V0VGltZSgpO1xuXG4gICAgLy8gRm9yICdzaW5nbGUnIHN0cmF0ZWd5LCBjcmVhdGUgY29tcHJlaGVuc2l2ZSBhdWRpdCBlbnRyeVxuICAgIGlmIChhdWRpdENvbnRleHQuYXVkaXRDb25maWcuc3RyYXRlZ3kgPT09ICdzaW5nbGUnKSB7XG4gICAgICBjb25zdCBvcGVyYXRpb25Db250ZXh0ID0gYXVkaXRDb250ZXh0LmF1ZGl0Q29uZmlnLmN1c3RvbUNvbnRleHQ/Ll9vcGVyYXRpb25Db250ZXh0O1xuICAgICAgXG4gICAgICBhd2FpdCBjYXB0dXJlTG9nKHtcbiAgICAgICAgbG9nVHlwZTogYXVkaXRDb250ZXh0LmxvZ1R5cGUsXG4gICAgICAgIHN1YlR5cGU6IGF1ZGl0Q29udGV4dC5zdWJUeXBlLFxuICAgICAgICBlbnRpdHlOYW1lOiBhdWRpdENvbnRleHQuZW50aXR5TmFtZSxcbiAgICAgICAgZW50aXR5SWQ6IGF1ZGl0Q29udGV4dC5lbnRpdHlJZCxcbiAgICAgICAgZXZlbnRUeXBlOiBlcnJvciA/ICdmYWlsZWQnIDogJ2NvbXBsZXRlZCcsXG4gICAgICAgIG9wZXJhdGlvbjogYXVkaXRDb250ZXh0Lm9wZXJhdGlvbixcbiAgICAgICAgY2F0ZWdvcnk6IGF1ZGl0Q29udGV4dC5jYXRlZ29yeSxcbiAgICAgICAgc3VjY2VzczogIWVycm9yLFxuICAgICAgICBzdGF0dXM6IGVycm9yID8gJ2ZhaWxlZCcgOiAnY29tcGxldGVkJyxcbiAgICAgICAgY29ycmVsYXRpb25JZDogYXVkaXRDb250ZXh0LmNvcnJlbGF0aW9uLmNvcnJlbGF0aW9uSWQsXG4gICAgICAgIGFjdG9yOiBhdWRpdENvbnRleHQuYWN0b3IsXG4gICAgICAgIFxuICAgICAgICAvLyBVc2UgZXhpc3RpbmcgZmllbGRzIGZvciBjb21wcmVoZW5zaXZlIGRhdGFcbiAgICAgICAgZGF0YToge1xuICAgICAgICAgIHJlcXVlc3Q6IG9wZXJhdGlvbkNvbnRleHQsXG4gICAgICAgICAgcmVzcG9uc2U6IHJlc3BvbnNlQ29udGV4dCxcbiAgICAgICAgICB0aW1pbmc6IHtcbiAgICAgICAgICAgIHN0YXJ0VGltZTogYXVkaXRDb250ZXh0LmNvcnJlbGF0aW9uLnN0YXJ0VGltZXN0YW1wLFxuICAgICAgICAgICAgZW5kVGltZTogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICAgICAgZHVyYXRpb25cbiAgICAgICAgICB9LFxuICAgICAgICAgIGVycm9yOiBlcnJvciA/IHtcbiAgICAgICAgICAgIG5hbWU6IGVycm9yLm5hbWUsXG4gICAgICAgICAgICBtZXNzYWdlOiBlcnJvci5tZXNzYWdlLFxuICAgICAgICAgICAgc3RhY2s6IGVycm9yLnN0YWNrXG4gICAgICAgICAgfSA6IHVuZGVmaW5lZFxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgbWV0cmljczoge1xuICAgICAgICAgIGR1cmF0aW9uLFxuICAgICAgICAgIC4uLihyZXNwb25zZUNvbnRleHQgPyB7XG4gICAgICAgICAgICBzdGF0dXNDb2RlOiByZXNwb25zZUNvbnRleHQuc3RhdHVzQ29kZSxcbiAgICAgICAgICAgIHJlc3BvbnNlU2l6ZTogcmVzcG9uc2VDb250ZXh0LnJlc3BvbnNlU2l6ZVxuICAgICAgICAgIH0gOiB7fSlcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIGNvbnRleHQ6IHtcbiAgICAgICAgICBjb3JyZWxhdGlvbjogYXVkaXRDb250ZXh0LmNvcnJlbGF0aW9uXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBtZXRhZGF0YTogYXVkaXRDb250ZXh0LmF1ZGl0Q29uZmlnLmN1c3RvbUNvbnRleHQsXG4gICAgICAgIHR0bDogYXVkaXRDb250ZXh0LmF1ZGl0Q29uZmlnLnR0bCxcbiAgICAgICAgZGF0YVByb3RlY3Rpb246IGF1ZGl0Q29udGV4dC5hdWRpdENvbmZpZy5kYXRhUHJvdGVjdGlvblxuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gRGVmYXVsdCAnc2VwYXJhdGUnIHN0cmF0ZWd5IChleGlzdGluZyBiZWhhdmlvcilcbiAgICBhd2FpdCBjYXB0dXJlTG9nKHtcbiAgICAgIGxvZ1R5cGU6IGF1ZGl0Q29udGV4dC5sb2dUeXBlLFxuICAgICAgc3ViVHlwZTogZXJyb3IgPyBgJHthdWRpdENvbnRleHQuc3ViVHlwZX1fZXJyb3JgIDogYCR7YXVkaXRDb250ZXh0LnN1YlR5cGV9X2NvbXBsZXRlYCxcbiAgICAgIGVudGl0eU5hbWU6IGF1ZGl0Q29udGV4dC5lbnRpdHlOYW1lLFxuICAgICAgZW50aXR5SWQ6IGF1ZGl0Q29udGV4dC5lbnRpdHlJZCxcbiAgICAgIGV2ZW50VHlwZTogZXJyb3IgPyAnZXJyb3InIDogJ2NvbXBsZXRlJyxcbiAgICAgIG9wZXJhdGlvbjogYXVkaXRDb250ZXh0Lm9wZXJhdGlvbixcbiAgICAgIGNhdGVnb3J5OiBhdWRpdENvbnRleHQuY2F0ZWdvcnksXG4gICAgICBzdWNjZXNzOiAhZXJyb3IsXG4gICAgICBzdGF0dXM6IGVycm9yID8gJ2ZhaWxlZCcgOiAnY29tcGxldGVkJyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IGF1ZGl0Q29udGV4dC5jb3JyZWxhdGlvbi5jb3JyZWxhdGlvbklkLFxuICAgICAgYWN0b3I6IGF1ZGl0Q29udGV4dC5hY3RvcixcbiAgICAgIG1ldHJpY3M6IHtcbiAgICAgICAgZHVyYXRpb24sXG4gICAgICAgIC4uLihyZXNwb25zZUNvbnRleHQgPyB7XG4gICAgICAgICAgc3RhdHVzQ29kZTogcmVzcG9uc2VDb250ZXh0LnN0YXR1c0NvZGUsXG4gICAgICAgICAgcmVzcG9uc2VTaXplOiByZXNwb25zZUNvbnRleHQucmVzcG9uc2VTaXplXG4gICAgICAgIH0gOiB7fSlcbiAgICAgIH0sXG4gICAgICBjb250ZXh0OiB7XG4gICAgICAgIGNvcnJlbGF0aW9uOiBhdWRpdENvbnRleHQuY29ycmVsYXRpb24sXG4gICAgICAgIC4uLihyZXNwb25zZUNvbnRleHQgJiYgeyByZXNwb25zZTogcmVzcG9uc2VDb250ZXh0IH0pXG4gICAgICB9LFxuICAgICAgbWV0YWRhdGE6IGF1ZGl0Q29udGV4dC5hdWRpdENvbmZpZy5jdXN0b21Db250ZXh0LFxuICAgICAgdHRsOiBhdWRpdENvbnRleHQuYXVkaXRDb25maWcudHRsLFxuICAgICAgZGF0YVByb3RlY3Rpb246IGF1ZGl0Q29udGV4dC5hdWRpdENvbmZpZy5kYXRhUHJvdGVjdGlvbixcbiAgICAgIGRhdGE6IHsgZXJyb3IgfVxuICAgIH0pO1xuICB9XG59XG4iXX0=