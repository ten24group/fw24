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
        // Check sampling
        if (auditContext.auditConfig.samplingFn &&
            !auditContext.auditConfig.samplingFn(auditContext.correlation.correlationId, auditContext.operation)) {
            return;
        }
        await captureLog({
            logType: auditContext.logType,
            subType: `${auditContext.subType}_start`,
            entityName: auditContext.entityName,
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
        await captureLog({
            logType: auditContext.logType,
            subType: error ? `${auditContext.subType}_error` : `${auditContext.subType}_complete`,
            entityName: auditContext.entityName,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXVkaXQtaGVscGVycy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9hdWRpdC9oZWxwZXJzL2F1ZGl0LWhlbHBlcnMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBK0VBLGdDQTBGQztBQU1ELG9DQWFDO0FBM0xELGdEQUF3RDtBQUd4RCxtQ0FBb0M7QUFFcEMsdURBQTJFO0FBa0UzRTs7Ozs7O0dBTUc7QUFDSSxLQUFLLFVBQVUsVUFBVSxDQUFDLE9BQTBCO0lBQ3pELElBQUksQ0FBQztRQUNILE1BQU0sV0FBVyxHQUFHLDRCQUFrQixDQUFDLFdBQVcsRUFBRSxDQUFDLE1BQU0sRUFBRSxDQUFDO1FBRTlELDhCQUE4QjtRQUM5QixNQUFNLEtBQUssR0FBRyxPQUFPLENBQUMsS0FBSyxJQUFJLE9BQU8sQ0FBQyxHQUFHLEVBQUUsS0FBSyxDQUFDO1FBQ2xELE1BQU0sYUFBYSxHQUFHLE9BQU8sQ0FBQyxhQUFhLElBQUksT0FBTyxDQUFDLEdBQUcsRUFBRSxPQUFPLEVBQUUsU0FBUyxJQUFJLElBQUEsbUJBQVUsR0FBRSxDQUFDO1FBQy9GLE1BQU0sU0FBUyxHQUFHLE9BQU8sQ0FBQyxHQUFHLEVBQUUsS0FBSyxFQUFFLGNBQWMsRUFBRSxRQUFRLEVBQUUsUUFBUSxDQUFDO1FBRXpFLHNDQUFzQztRQUN0QyxNQUFNLE9BQU8sR0FBd0IsRUFBRSxDQUFDO1FBQ3hDLElBQUksT0FBTyxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBQ3BCLE1BQU0sQ0FBQyxNQUFNLENBQUMsT0FBTyxFQUFFLE9BQU8sQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUMxQyxDQUFDO1FBQ0QsSUFBSSxPQUFPLENBQUMsUUFBUSxLQUFLLFNBQVMsRUFBRSxDQUFDO1lBQ25DLE9BQU8sQ0FBQyxRQUFRLEdBQUcsT0FBTyxDQUFDLFFBQVEsQ0FBQztRQUN0QyxDQUFDO1FBRUQseUNBQXlDO1FBQ3pDLElBQUksTUFBTSxHQUFHLE9BQU8sQ0FBQyxNQUFN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WUFDckQsS0FBSyxFQUFFLFlBQVksQ0FBQyxLQUFLO1lBQ3pCLE9BQU8sRUFBRTtnQkFDUCxRQUFRO2dCQUNSLEdBQUcsQ0FBQyxlQUFlLENBQUMsQ0FBQyxDQUFDO29CQUNwQixVQUFVLEVBQUUsZUFBZSxDQUFDLFVBQVU7b0JBQ3RDLFlBQVksRUFBRSxlQUFlLENBQUMsWUFBWTtpQkFDM0MsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO2FBQ1I7WUFDRCxPQUFPLEVBQUU7Z0JBQ1AsV0FBVyxFQUFFLFlBQVksQ0FBQyxXQUFXO2dCQUNyQyxHQUFHLENBQUMsZUFBZSxJQUFJLEVBQUUsUUFBUSxFQUFFLGVBQWUsRUFBRSxDQUFDO2FBQ3REO1lBQ0QsUUFBUSxFQUFFLFlBQVksQ0FBQyxXQUFXLENBQUMsYUFBYTtZQUNoRCxHQUFHLEVBQUUsWUFBWSxDQUFDLFdBQVcsQ0FBQyxHQUFHO1lBQ2pDLGNBQWMsRUFBRSxZQUFZLENBQUMsV0FBVyxDQUFDLGNBQWM7WUFDdkQsSUFBSSxFQUFFLEVBQUUsS0FBSyxFQUFFO1NBQ2hCLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQXJGRCxrREFxRkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBBdWRpdEVudHJ5LCBBdWRpdE9wdGlvbnMgfSBmcm9tICcuLi9pbnRlcmZhY2VzJztcbmltcG9ydCB7IEF1ZGl0TG9nZ2VyRmFjdG9yeSB9IGZyb20gJy4uL2xvZ2dlcnMvZmFjdG9yeSc7XG5pbXBvcnQgeyBBY3RvciB9IGZyb20gXCIuLi8uLi9jb3JlL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0XCI7XG5pbXBvcnQgeyBFeGVjdXRpb25Db250ZXh0IH0gZnJvbSAnLi4vLi4vY29yZS90eXBlcy9leGVjdXRpb24tY29udGV4dCc7XG5pbXBvcnQgeyByYW5kb21VVUlEIH0gZnJvbSAnY3J5cHRvJztcbmltcG9ydCB7IEF1ZGl0Q29udGV4dCwgUmVxdWVzdEF1ZGl0Q29udGV4dCwgUXVldWVBdWRpdENvbnRleHQsIFRhc2tBdWRpdENvbnRleHQgfSBmcm9tICcuLi8uLi9mdzI0JztcbmltcG9ydCB7IHByb3RlY3RBdWRpdERhdGEsIERhdGFQcm90ZWN0aW9uQ29uZmlnIH0gZnJvbSAnLi9kYXRhLXByb3RlY3Rpb24nO1xuXG4vKipcbiAqIEVuaGFuY2VkIGNhcHR1cmUgb3B0aW9ucyBmb3IgdGhlIGF1ZGl0IHN5c3RlbVxuICogXG4gKiBUaGlzIGludGVyZmFjZSBwcm92aWRlcyBvcHRpb25zIGZvciBjYXB0dXJpbmcgbG9ncyB3aXRoIGF1dG9tYXRpY1xuICogY29udGV4dCBleHRyYWN0aW9uIHdoaWxlIG1haW50YWluaW5nIGJhY2t3YXJkIGNvbXBhdGliaWxpdHkuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ2FwdHVyZUxvZ09wdGlvbnMge1xuICAvLyA9PT0gQ0xBU1NJRklDQVRJT04gPT09XG4gIGxvZ1R5cGU/OiAnYXVkaXQnIHwgJ2xvZycgfCAnZXZlbnQnIHwgJ21ldHJpYyc7XG4gIHN1YlR5cGU/OiBzdHJpbmc7XG4gIHNldmVyaXR5PzogJ2luZm8nIHwgJ3dhcm4nIHwgJ2Vycm9yJyB8ICdjcml0aWNhbCc7XG4gIGNhdGVnb3J5Pzogc3RyaW5nO1xuICBcbiAgLy8gPT09IEVOVElUWS9SRVNPVVJDRSBUUkFDS0lORyA9PT1cbiAgZW50aXR5TmFtZT86IHN0cmluZztcbiAgZW50aXR5SWQ/OiBzdHJpbmc7XG4gIGV2ZW50VHlwZT86IHN0cmluZztcbiAgb3BlcmF0aW9uPzogc3RyaW5nO1xuICBcbiAgLy8gPT09IFNFUlZJQ0UgQ09OVEVYVCA9PT1cbiAgc2VydmljZT86IHN0cmluZztcbiAgZXh0ZXJuYWxTeXN0ZW0/OiBzdHJpbmc7XG4gIGV4dGVybmFsSWQ/OiBzdHJpbmc7XG4gIFxuICAvLyA9PT0gU1RBVFVTICYgT1VUQ09NRSA9PT1cbiAgc3RhdHVzPzogc3RyaW5nO1xuICBzdWNjZXNzPzogYm9vbGVhbjtcbiAgXG4gIC8vID09PSBNRVRSSUNTID09PVxuICBtZXRyaWNzPzoge1xuICAgIGR1cmF0aW9uPzogbnVtYmVyO1xuICAgIGFtb3VudD86IG51bWJlcjtcbiAgICBjdXJyZW5jeT86IHN0cmluZztcbiAgICByZWNvcmRDb3VudD86IG51bWJlcjtcbiAgICBkYXRhU2l6ZT86IG51bWJlcjtcbiAgICByZXNwb25zZVRpbWU/OiBudW1iZXI7XG4gICAgdGhyb3VnaHB1dD86IG51bWJlcjtcbiAgICBlcnJvclJhdGU/OiBudW1iZXI7XG4gICAgW2tleTogc3RyaW5nXTogYW55O1xuICB9O1xuICBcbiAgLy8gPT09IFRSQUNLSU5HID09PVxuICBjb3JyZWxhdGlvbklkPzogc3RyaW5nO1xuICBcbiAgLy8gPT09IERBVEEgQkxPQ0tTID09PVxuICBkYXRhPzogYW55O1xuICBtZXRhZGF0YT86IGFueTtcbiAgY29udGV4dD86IGFueTtcbiAgXG4gIC8vID09PSBSVU5USU1FIENPTlRFWFQgPT09XG4gIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQ7XG4gIGFjdG9yPzogQWN0b3I7XG4gIFxuICAvLyA9PT0gQ09OVkVOSUVOQ0UgPT09XG4gIGR1cmF0aW9uPzogbnVtYmVyOyAvLyBXaWxsIGJlIGFkZGVkIHRvIG1ldHJpY3NcbiAgXG4gIC8vID09PSBUVEwgJiBEQVRBIFBST1RFQ1RJT04gPT09XG4gIHR0bD86IG51bWJlcjsgICAgICAgICAgICAgICAgICAgICAgLy8gQ3VzdG9tIFRUTCB0aW1lc3RhbXAgKFVuaXggc2Vjb25kcylcbiAgZGF0YVByb3RlY3Rpb24/OiBEYXRhUHJvdGVjdGlvbkNvbmZpZztcbiAgXG4gIC8vID09PSBDT05UUk9MID09PVxuICBlbmFibGVkPzogYm9vbGVhbjtcbn1cblxuLyoqXG4gKiBFbmhhbmNlZCBjYXB0dXJlIGxvZyBmdW5jdGlvbiBmb3IgdGhlIGV4aXN0aW5nIGF1ZGl0IHN5c3RlbVxuICogXG4gKiBUaGlzIGlzIHRoZSBwcmltYXJ5IGludGVyZmFjZSBmb3IgbG9nZ2luZyB0aHJvdWdob3V0IHRoZSBhcHBsaWNhdGlvbi5cbiAqIEl0IGF1dG9tYXRpY2FsbHkgZXh0cmFjdHMgY29udGV4dCBmcm9tIHRoZSBleGVjdXRpb24gZW52aXJvbm1lbnQgYW5kXG4gKiBwcm92aWRlcyBzZW5zaWJsZSBkZWZhdWx0cyBmb3IgcmVxdWlyZWQgZmllbGRzLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY2FwdHVyZUxvZyhvcHRpb25zOiBDYXB0dXJlTG9nT3B0aW9ucyk6IFByb21pc2U8dm9pZD4ge1xuICB0cnkge1xuICAgIGNvbnN0IGF1ZGl0TG9nZ2VyID0gQXVkaXRMb2dnZXJGYWN0b3J5LmdldEluc3RhbmNlKCkuY3JlYXRlKCk7XG4gICAgXG4gICAgLy8gRXh0cmFjdCBjb250ZXh0IGluZm9ybWF0aW9uXG4gICAgY29uc3QgYWN0b3IgPSBvcHRpb25zLmFjdG9yIHx8IG9wdGlvbnMuY3R4Py5hY3RvcjtcbiAgICBjb25zdCBjb3JyZWxhdGlvbklkID0gb3B0aW9ucy5jb3JyZWxhdGlvbklkIHx8IG9wdGlvbnMuY3R4Py5yZXF1ZXN0Py5yZXF1ZXN0SWQgfHwgcmFuZG9tVVVJRCgpO1xuICAgIGNvbnN0IGlwQWRkcmVzcyA9IG9wdGlvbnMuY3R4Py5ldmVudD8ucmVxdWVzdENvbnRleHQ/LmlkZW50aXR5Py5zb3VyY2VJcDtcbiAgICBcbiAgICAvLyBCdWlsZCBtZXRyaWNzIG9iamVjdCBvbmx5IGlmIG5lZWRlZFxuICAgIGNvbnN0IG1ldHJpY3M6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgICBpZiAob3B0aW9ucy5tZXRyaWNzKSB7XG4gICAgICBPYmplY3QuYXNzaWduKG1ldHJpY3MsIG9wdGlvbnMubWV0cmljcyk7XG4gICAgfVxuICAgIGlmIChvcHRpb25zLmR1cmF0aW9uICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIG1ldHJpY3MuZHVyYXRpb24gPSBvcHRpb25zLmR1cmF0aW9uO1xuICAgIH1cbiAgICBcbiAgICAvLyBEZXRlcm1pbmUgc3RhdHVzIGJhc2VkIG9uIHN1Y2Nlc3MgZmxhZ1xuICAgIGxldCBzdGF0dXMgPSBvcHRpb25zLnN0YXR1cztcbiAgICBpZiAoc3RhdHVzID09PSB1bmRlZmluZWQgJiYgb3B0aW9ucy5zdWNjZXNzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHN0YXR1cyA9IG9wdGlvbnMuc3VjY2VzcyA/ICdjb21wbGV0ZWQnIDogJ2ZhaWxlZCc7XG4gICAgfVxuICAgIFxuICAgIC8vIENyZWF0ZSB0aGUgZW5oYW5jZWQgYXVkaXQgZW50cnlcbiAgICBjb25zdCBhdWRpdEVudHJ5OiBBdWRpdEVudHJ5ID0ge1xuICAgICAgLy8gPT09IENMQVNTSUZJQ0FUSU9OID09PVxuICAgICAgbG9nVHlwZTogb3B0aW9ucy5sb2dUeXBlIHx8ICdhdWRpdCcsXG4gICAgICBzdWJUeXBlOiBvcHRpb25zLnN1YlR5cGUsXG4gICAgICBzZXZlcml0eTogb3B0aW9ucy5zZXZlcml0eSB8fCAnaW5mbycsXG4gICAgICBjYXRlZ29yeTogb3B0aW9ucy5jYXRlZ29yeSxcbiAgICAgIFxuICAgICAgLy8gPT09IEVOVElUWS9SRVNPVVJDRSBUUkFDS0lORyA9PT1cbiAgICAgIGVudGl0eU5hbWU6IG9wdGlvbnMuZW50aXR5TmFtZSB8fCAndW5rbm93bicsXG4gICAgICBlbnRpdHlJZDogb3B0aW9ucy5lbnRpdHlJZCxcbiAgICAgIGV2ZW50VHlwZTogb3B0aW9ucy5ldmVudFR5cGUgfHwgJ3Vua25vd24nLFxuICAgICAgb3BlcmF0aW9uOiBvcHRpb25zLm9wZXJhdGlvbixcbiAgICAgIFxuICAgICAgLy8gPT09IFNFUlZJQ0UgQ09OVEVYVCA9PT1cbiAgICAgIHNlcnZpY2U6IG9wdGlvbnMuc2VydmljZSxcbiAgICAgIGV4dGVybmFsU3lzdGVtOiBvcHRpb25zLmV4dGVybmFsU3lzdGVtLFxuICAgICAgZXh0ZXJuYWxJZDogb3B0aW9ucy5leHRlcm5hbElkLFxuICAgICAgXG4gICAgICAvLyA9PT0gU1RBVFVTICYgT1VUQ09NRSA9PT1cbiAgICAgIHN0YXR1cyxcbiAgICAgIHN1Y2Nlc3M6IG9wdGlvbnMuc3VjY2VzcyxcbiAgICAgIGlwQWRkcmVzcyxcbiAgICAgIFxuICAgICAgLy8gPT09IE1FVFJJQ1MgPT09XG4gICAgICBtZXRyaWNzOiBPYmplY3Qua2V5cyhtZXRyaWNzKS5sZW5ndGggPiAwID8gbWV0cmljcyA6IHVuZGVmaW5lZCxcbiAgICAgIFxuICAgICAgLy8gPT09IFRSQUNLSU5HID09PVxuICAgICAgY29ycmVsYXRpb25JZCxcbiAgICAgIFxuICAgICAgLy8gPT09IEFDVE9SID09PVxuICAgICAgYWN0b3IsXG4gICAgICBcbiAgICAgIC8vID09PSBEQVRBIEJMT0NLUyA9PT1cbiAgICAgIGRhdGE6IG9wdGlvbnMuZGF0YSxcbiAgICAgIG1ldGFkYXRhOiBvcHRpb25zLm1ldGFkYXRhLFxuICAgICAgY29udGV4dDogb3B0aW9ucy5jb250ZXh0LFxuICAgICAgXG4gICAgICAvLyA9PT0gVFRMID09PVxuICAgICAgdHRsOiBvcHRpb25zLnR0bFxuICAgIH07XG4gICAgXG4gICAgLy8gQXBwbHkgZGF0YSBwcm90ZWN0aW9uXG4gICAgY29uc3QgZGF0YVByb3RlY3Rpb25Db25maWcgPSB7XG4gICAgICAuLi5vcHRpb25zLmRhdGFQcm90ZWN0aW9uXG4gICAgfTtcbiAgICBjb25zdCBwcm90ZWN0ZWRBdWRpdEVudHJ5ID0gcHJvdGVjdEF1ZGl0RGF0YShhdWRpdEVudHJ5LCBkYXRhUHJvdGVjdGlvbkNvbmZpZyk7XG4gICAgXG4gICAgLy8gQ3JlYXRlIGF1ZGl0IG9wdGlvbnNcbiAgICBjb25zdCBhdWRpdE9wdGlvbnM6IEF1ZGl0T3B0aW9ucyA9IHtcbiAgICAgIGVuYWJsZWQ6IG9wdGlvbnMuZW5hYmxlZCxcbiAgICAgIGF1ZGl0RW50cnk6IHByb3RlY3RlZEF1ZGl0RW50cnlcbiAgICB9O1xuICAgIFxuICAgIC8vIExvZyB0aGUgZW50cnkgdXNpbmcgdGhlIGV4aXN0aW5nIGF1ZGl0IHN5c3RlbVxuICAgIGF3YWl0IGF1ZGl0TG9nZ2VyLmF1ZGl0KGF1ZGl0T3B0aW9ucyk7XG4gICAgXG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgLy8gRG9uJ3QgYnJlYWsgYnVzaW5lc3MgbG9naWMgb24gbG9nZ2luZyBmYWlsdXJlc1xuICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byBjYXB0dXJlIGF1ZGl0IGxvZzonLCBlcnJvciwge1xuICAgICAgbG9nVHlwZTogb3B0aW9ucy5sb2dUeXBlLFxuICAgICAgc3ViVHlwZTogb3B0aW9ucy5zdWJUeXBlLFxuICAgICAgZW50aXR5TmFtZTogb3B0aW9ucy5lbnRpdHlOYW1lLFxuICAgICAgY29ycmVsYXRpb25JZDogb3B0aW9ucy5jb3JyZWxhdGlvbklkXG4gICAgfSk7XG4gIH1cbn1cblxuLyoqXG4gKiBDb252ZW5pZW5jZSBmdW5jdGlvbiBmb3IgY2FwdHVyaW5nIGVycm9ycyB3aXRoIHByb3BlciBlcnJvciBmb3JtYXR0aW5nXG4gKiBUaGlzIGlzIGFjdHVhbGx5IHVzZWZ1bCBzaW5jZSBpdCBoYW5kbGVzIGVycm9yIG9iamVjdCBzZXJpYWxpemF0aW9uXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjYXB0dXJlRXJyb3IoXG4gIGVycm9yOiBFcnJvciB8IHVua25vd24sIFxuICBvcHRpb25zOiBPbWl0PENhcHR1cmVMb2dPcHRpb25zLCAnc2V2ZXJpdHknIHwgJ3N1Y2Nlc3MnIHwgJ3N0YXR1cycgfCAnZGF0YSc+XG4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgcmV0dXJuIGNhcHR1cmVMb2coe1xuICAgIC4uLm9wdGlvbnMsXG4gICAgc2V2ZXJpdHk6ICdlcnJvcicsXG4gICAgc3VjY2VzczogZmFsc2UsXG4gICAgc3RhdHVzOiAnZmFpbGVkJyxcbiAgICBkYXRhOiB7XG4gICAgICBlcnJvcjogZXJyb3JcbiAgICB9XG4gIH0pO1xufVxuLyoqXG4gKiBBdWRpdCBjYXB0dXJlIHNlcnZpY2UgdG8gaGFuZGxlIGF1ZGl0IGxvZ2dpbmcgZm9yIGFsbCBjb250cm9sbGVyIHR5cGVzXG4gKiBUaGlzIHNlcnZpY2UgYnJlYWtzIHRoZSBjaXJjdWxhciBpbXBvcnQgY3ljbGUgYnkga2VlcGluZyBhdWRpdCBsb2dpYyBzZXBhcmF0ZSBmcm9tIGNvbnRyb2xsZXJzXG4gKi9cblxuZXhwb3J0IGNsYXNzIEF1ZGl0Q2FwdHVyZVNlcnZpY2Uge1xuXG4gIC8qKlxuICAgKiBDYXB0dXJlcyBhdWRpdCBsb2cgZm9yIG9wZXJhdGlvbiBzdGFydFxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGNhcHR1cmVTdGFydChcbiAgICBhdWRpdENvbnRleHQ6IEF1ZGl0Q29udGV4dCxcbiAgICBvcGVyYXRpb25Db250ZXh0OiBSZXF1ZXN0QXVkaXRDb250ZXh0IHwgUXVldWVBdWRpdENvbnRleHQgfCBUYXNrQXVkaXRDb250ZXh0XG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghYXVkaXRDb250ZXh0LmVuYWJsZWQgfHwgYXVkaXRDb250ZXh0LmF1ZGl0Q29uZmlnLnNraXBTdGFydCkgcmV0dXJuO1xuXG4gICAgLy8gQ2hlY2sgc2FtcGxpbmdcbiAgICBpZiAoYXVkaXRDb250ZXh0LmF1ZGl0Q29uZmlnLnNhbXBsaW5nRm4gJiZcbiAgICAgICFhdWRpdENvbnRleHQuYXVkaXRDb25maWcuc2FtcGxpbmdGbihhdWRpdENvbnRleHQuY29ycmVsYXRpb24uY29ycmVsYXRpb25JZCwgYXVkaXRDb250ZXh0Lm9wZXJhdGlvbikpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBhd2FpdCBjYXB0dXJlTG9nKHtcbiAgICAgIGxvZ1R5cGU6IGF1ZGl0Q29udGV4dC5sb2dUeXBlLFxuICAgICAgc3ViVHlwZTogYCR7YXVkaXRDb250ZXh0LnN1YlR5cGV9X3N0YXJ0YCxcbiAgICAgIGVudGl0eU5hbWU6IGF1ZGl0Q29udGV4dC5lbnRpdHlOYW1lLFxuICAgICAgZXZlbnRUeXBlOiAnc3RhcnQnLFxuICAgICAgb3BlcmF0aW9uOiBhdWRpdENvbnRleHQub3BlcmF0aW9uLFxuICAgICAgY2F0ZWdvcnk6IGF1ZGl0Q29udGV4dC5jYXRlZ29yeSxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IGF1ZGl0Q29udGV4dC5jb3JyZWxhdGlvbi5jb3JyZWxhdGlvbklkLFxuICAgICAgYWN0b3I6IGF1ZGl0Q29udGV4dC5hY3RvcixcbiAgICAgIGNvbnRleHQ6IHtcbiAgICAgICAgY29ycmVsYXRpb246IGF1ZGl0Q29udGV4dC5jb3JyZWxhdGlvbixcbiAgICAgICAgWyBhdWRpdENvbnRleHQuY29ycmVsYXRpb24ub3BlcmF0aW9uVHlwZSBdOiBvcGVyYXRpb25Db250ZXh0XG4gICAgICB9LFxuICAgICAgbWV0YWRhdGE6IGF1ZGl0Q29udGV4dC5hdWRpdENvbmZpZy5jdXN0b21Db250ZXh0LFxuICAgICAgdHRsOiBhdWRpdENvbnRleHQuYXVkaXRDb25maWcudHRsLFxuICAgICAgZGF0YVByb3RlY3Rpb246IGF1ZGl0Q29udGV4dC5hdWRpdENvbmZpZy5kYXRhUHJvdGVjdGlvblxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIENhcHR1cmVzIGF1ZGl0IGxvZyBmb3Igb3BlcmF0aW9uIGVuZCAoc3VjY2VzcyBvciBlcnJvcilcbiAgICovXG4gIHN0YXRpYyBhc3luYyBjYXB0dXJlRW5kKFxuICAgIGF1ZGl0Q29udGV4dDogQXVkaXRDb250ZXh0LFxuICAgIF9yZXN1bHQ6IGFueSxcbiAgICBlcnJvcjogRXJyb3IgfCBudWxsLFxuICAgIHJlc3BvbnNlQ29udGV4dD86IGFueVxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWF1ZGl0Q29udGV4dC5lbmFibGVkKSByZXR1cm47XG4gICAgaWYgKGVycm9yICYmIGF1ZGl0Q29udGV4dC5hdWRpdENvbmZpZy5za2lwRXJyb3JzKSByZXR1cm47XG4gICAgaWYgKCFlcnJvciAmJiBhdWRpdENvbnRleHQuYXVkaXRDb25maWcuc2tpcEVuZCkgcmV0dXJuO1xuXG4gICAgLy8gQ2hlY2sgc2FtcGxpbmdcbiAgICBpZiAoYXVkaXRDb250ZXh0LmF1ZGl0Q29uZmlnLnNhbXBsaW5nRm4gJiZcbiAgICAgICFhdWRpdENvbnRleHQuYXVkaXRDb25maWcuc2FtcGxpbmdGbihhdWRpdENvbnRleHQuY29ycmVsYXRpb24uY29ycmVsYXRpb25JZCwgYXVkaXRDb250ZXh0Lm9wZXJhdGlvbikpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBkdXJhdGlvbiA9IERhdGUubm93KCkgLSBuZXcgRGF0ZShhdWRpdENvbnRleHQuY29ycmVsYXRpb24uc3RhcnRUaW1lc3RhbXApLmdldFRpbWUoKTtcblxuICAgIGF3YWl0IGNhcHR1cmVMb2coe1xuICAgICAgbG9nVHlwZTogYXVkaXRDb250ZXh0LmxvZ1R5cGUsXG4gICAgICBzdWJUeXBlOiBlcnJvciA/IGAke2F1ZGl0Q29udGV4dC5zdWJUeXBlfV9lcnJvcmAgOiBgJHthdWRpdENvbnRleHQuc3ViVHlwZX1fY29tcGxldGVgLFxuICAgICAgZW50aXR5TmFtZTogYXVkaXRDb250ZXh0LmVudGl0eU5hbWUsXG4gICAgICBldmVudFR5cGU6IGVycm9yID8gJ2Vycm9yJyA6ICdjb21wbGV0ZScsXG4gICAgICBvcGVyYXRpb246IGF1ZGl0Q29udGV4dC5vcGVyYXRpb24sXG4gICAgICBjYXRlZ29yeTogYXVkaXRDb250ZXh0LmNhdGVnb3J5LFxuICAgICAgc3VjY2VzczogIWVycm9yLFxuICAgICAgc3RhdHVzOiBlcnJvciA/ICdmYWlsZWQnIDogJ2NvbXBsZXRlZCcsXG4gICAgICBjb3JyZWxhdGlvbklkOiBhdWRpdENvbnRleHQuY29ycmVsYXRpb24uY29ycmVsYXRpb25JZCxcbiAgICAgIGFjdG9yOiBhdWRpdENvbnRleHQuYWN0b3IsXG4gICAgICBtZXRyaWNzOiB7XG4gICAgICAgIGR1cmF0aW9uLFxuICAgICAgICAuLi4ocmVzcG9uc2VDb250ZXh0ID8ge1xuICAgICAgICAgIHN0YXR1c0NvZGU6IHJlc3BvbnNlQ29udGV4dC5zdGF0dXNDb2RlLFxuICAgICAgICAgIHJlc3BvbnNlU2l6ZTogcmVzcG9uc2VDb250ZXh0LnJlc3BvbnNlU2l6ZVxuICAgICAgICB9IDoge30pXG4gICAgICB9LFxuICAgICAgY29udGV4dDoge1xuICAgICAgICBjb3JyZWxhdGlvbjogYXVkaXRDb250ZXh0LmNvcnJlbGF0aW9uLFxuICAgICAgICAuLi4ocmVzcG9uc2VDb250ZXh0ICYmIHsgcmVzcG9uc2U6IHJlc3BvbnNlQ29udGV4dCB9KVxuICAgICAgfSxcbiAgICAgIG1ldGFkYXRhOiBhdWRpdENvbnRleHQuYXVkaXRDb25maWcuY3VzdG9tQ29udGV4dCxcbiAgICAgIHR0bDogYXVkaXRDb250ZXh0LmF1ZGl0Q29uZmlnLnR0bCxcbiAgICAgIGRhdGFQcm90ZWN0aW9uOiBhdWRpdENvbnRleHQuYXVkaXRDb25maWcuZGF0YVByb3RlY3Rpb24sXG4gICAgICBkYXRhOiB7IGVycm9yIH1cbiAgICB9KTtcbiAgfVxufVxuIl19