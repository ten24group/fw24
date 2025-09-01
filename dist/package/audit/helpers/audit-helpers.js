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
        // Build metrics object
        const metrics = { ...options.metrics };
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
            ...(0, data_protection_1.getEnvironmentDataProtectionConfig)(),
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXVkaXQtaGVscGVycy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9hdWRpdC9oZWxwZXJzL2F1ZGl0LWhlbHBlcnMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBb0ZBLGdDQXdGQztBQU1ELG9DQWFDO0FBOUxELGdEQUF3RDtBQUd4RCxtQ0FBb0M7QUFFcEMsdURBQXlGO0FBdUV6Rjs7Ozs7O0dBTUc7QUFDSSxLQUFLLFVBQVUsVUFBVSxDQUFDLE9BQTBCO0lBQ3pELElBQUksQ0FBQztRQUNILE1BQU0sV0FBVyxHQUFHLDRCQUFrQixDQUFDLFdBQVcsRUFBRSxDQUFDLE1BQU0sRUFBRSxDQUFDO1FBRTlELDhCQUE4QjtRQUM5QixNQUFNLEtBQUssR0FBRyxPQUFPLENBQUMsS0FBSyxJQUFJLE9BQU8sQ0FBQyxHQUFHLEVBQUUsS0FBSyxDQUFDO1FBQ2xELE1BQU0sYUFBYSxHQUFHLE9BQU8sQ0FBQyxhQUFhLElBQUksT0FBTyxDQUFDLEdBQUcsRUFBRSxPQUFPLEVBQUUsU0FBUyxJQUFJLElBQUEsbUJBQVUsR0FBRSxDQUFDO1FBQy9GLE1BQU0sU0FBUyxHQUFHLE9BQU8sQ0FBQyxHQUFHLEVBQUUsS0FBSyxFQUFFLGNBQWMsRUFBRSxRQUFRLEVBQUUsUUFBUSxDQUFDO1FBRXpFLHVCQUF1QjtRQUN2QixNQUFNLE9BQU8sR0FBRyxFQUFFLEdBQUcsT0FBTyxDQUFDLE9BQU8sRUFBRSxDQUFDO1FBQ3ZDLElBQUksT0FBTyxDQUFDLFFBQVEsS0FBSyxTQUFTLEVBQUUsQ0FBQztZQUNuQyxPQUFPLENBQUMsUUFBUSxHQUFHLE9BQU8sQ0FBQyxRQUFRLENBQUM7UUFDdEMsQ0FBQztRQUVELHlDQUF5QztRQUN6QyxJQUFJLE1BQU0sR0FBRyxPQUFPLENBQUMsTUFBTSxDQUFDO1FBQzVCLElBQUksTUFBTSxLQUFLLFNBQVMsSUFBSSxPQUFPLENBQUMsT0FBTyxLQUFLLFNBQVMsRUFBRSxDQUFDO1lBQzFELE1BQU0s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QVE7Z0JBQ1IsR0FBRyxDQUFDLGVBQWUsQ0FBQyxDQUFDLENBQUM7b0JBQ3BCLFVBQVUsRUFBRSxlQUFlLENBQUMsVUFBVTtvQkFDdEMsWUFBWSxFQUFFLGVBQWUsQ0FBQyxZQUFZO2lCQUMzQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7YUFDUjtZQUNELE9BQU8sRUFBRTtnQkFDUCxXQUFXLEVBQUUsWUFBWSxDQUFDLFdBQVc7Z0JBQ3JDLEdBQUcsQ0FBQyxlQUFlLElBQUksRUFBRSxRQUFRLEVBQUUsZUFBZSxFQUFFLENBQUM7YUFDdEQ7WUFDRCxRQUFRLEVBQUUsWUFBWSxDQUFDLFdBQVcsQ0FBQyxhQUFhO1lBQ2hELEdBQUcsRUFBRSxZQUFZLENBQUMsV0FBVyxDQUFDLEdBQUc7WUFDakMsY0FBYyxFQUFFLFlBQVksQ0FBQyxXQUFXLENBQUMsY0FBYztZQUN2RCxJQUFJLEVBQUUsRUFBRSxLQUFLLEVBQUU7U0FDaEIsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBckZELGtEQXFGQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEF1ZGl0RW50cnksIEF1ZGl0T3B0aW9ucyB9IGZyb20gJy4uL2ludGVyZmFjZXMnO1xuaW1wb3J0IHsgQXVkaXRMb2dnZXJGYWN0b3J5IH0gZnJvbSAnLi4vbG9nZ2Vycy9mYWN0b3J5JztcbmltcG9ydCB7IEFjdG9yIH0gZnJvbSBcIi4uLy4uL2NvcmUvdHlwZXMvZXhlY3V0aW9uLWNvbnRleHRcIjtcbmltcG9ydCB7IEV4ZWN1dGlvbkNvbnRleHQgfSBmcm9tICcuLi8uLi9jb3JlL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0JztcbmltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tICdjcnlwdG8nO1xuaW1wb3J0IHsgQXVkaXRDb250ZXh0LCBSZXF1ZXN0QXVkaXRDb250ZXh0LCBRdWV1ZUF1ZGl0Q29udGV4dCwgVGFza0F1ZGl0Q29udGV4dCB9IGZyb20gJy4uLy4uL2Z3MjQnO1xuaW1wb3J0IHsgcHJvdGVjdEF1ZGl0RGF0YSwgZ2V0RW52aXJvbm1lbnREYXRhUHJvdGVjdGlvbkNvbmZpZyB9IGZyb20gJy4vZGF0YS1wcm90ZWN0aW9uJztcblxuLyoqXG4gKiBFbmhhbmNlZCBjYXB0dXJlIG9wdGlvbnMgZm9yIHRoZSBhdWRpdCBzeXN0ZW1cbiAqIFxuICogVGhpcyBpbnRlcmZhY2UgcHJvdmlkZXMgb3B0aW9ucyBmb3IgY2FwdHVyaW5nIGxvZ3Mgd2l0aCBhdXRvbWF0aWNcbiAqIGNvbnRleHQgZXh0cmFjdGlvbiB3aGlsZSBtYWludGFpbmluZyBiYWNrd2FyZCBjb21wYXRpYmlsaXR5LlxuICovXG5leHBvcnQgaW50ZXJmYWNlIENhcHR1cmVMb2dPcHRpb25zIHtcbiAgLy8gPT09IENMQVNTSUZJQ0FUSU9OID09PVxuICBsb2dUeXBlPzogJ2F1ZGl0JyB8ICdsb2cnIHwgJ2V2ZW50JyB8ICdtZXRyaWMnO1xuICBzdWJUeXBlPzogc3RyaW5nO1xuICBzZXZlcml0eT86ICdpbmZvJyB8ICd3YXJuJyB8ICdlcnJvcicgfCAnY3JpdGljYWwnO1xuICBjYXRlZ29yeT86IHN0cmluZztcbiAgXG4gIC8vID09PSBFTlRJVFkvUkVTT1VSQ0UgVFJBQ0tJTkcgPT09XG4gIGVudGl0eU5hbWU/OiBzdHJpbmc7XG4gIGVudGl0eUlkPzogc3RyaW5nO1xuICBldmVudFR5cGU/OiBzdHJpbmc7XG4gIG9wZXJhdGlvbj86IHN0cmluZztcbiAgXG4gIC8vID09PSBTRVJWSUNFIENPTlRFWFQgPT09XG4gIHNlcnZpY2U/OiBzdHJpbmc7XG4gIGV4dGVybmFsU3lzdGVtPzogc3RyaW5nO1xuICBleHRlcm5hbElkPzogc3RyaW5nO1xuICBcbiAgLy8gPT09IFNUQVRVUyAmIE9VVENPTUUgPT09XG4gIHN0YXR1cz86IHN0cmluZztcbiAgc3VjY2Vzcz86IGJvb2xlYW47XG4gIFxuICAvLyA9PT0gTUVUUklDUyA9PT1cbiAgbWV0cmljcz86IHtcbiAgICBkdXJhdGlvbj86IG51bWJlcjtcbiAgICBhbW91bnQ/OiBudW1iZXI7XG4gICAgY3VycmVuY3k/OiBzdHJpbmc7XG4gICAgcmVjb3JkQ291bnQ/OiBudW1iZXI7XG4gICAgZGF0YVNpemU/OiBudW1iZXI7XG4gICAgcmVzcG9uc2VUaW1lPzogbnVtYmVyO1xuICAgIHRocm91Z2hwdXQ/OiBudW1iZXI7XG4gICAgZXJyb3JSYXRlPzogbnVtYmVyO1xuICAgIFtrZXk6IHN0cmluZ106IGFueTtcbiAgfTtcbiAgXG4gIC8vID09PSBUUkFDS0lORyA9PT1cbiAgY29ycmVsYXRpb25JZD86IHN0cmluZztcbiAgXG4gIC8vID09PSBEQVRBIEJMT0NLUyA9PT1cbiAgZGF0YT86IGFueTtcbiAgbWV0YWRhdGE/OiBhbnk7XG4gIGNvbnRleHQ/OiBhbnk7XG4gIFxuICAvLyA9PT0gUlVOVElNRSBDT05URVhUID09PVxuICBjdHg/OiBFeGVjdXRpb25Db250ZXh0O1xuICBhY3Rvcj86IEFjdG9yO1xuICBcbiAgLy8gPT09IENPTlZFTklFTkNFID09PVxuICBkdXJhdGlvbj86IG51bWJlcjsgLy8gV2lsbCBiZSBhZGRlZCB0byBtZXRyaWNzXG4gIFxuICAvLyA9PT0gVFRMICYgREFUQSBQUk9URUNUSU9OID09PVxuICB0dGw/OiBudW1iZXI7ICAgICAgICAgICAgICAgICAgICAgIC8vIEN1c3RvbSBUVEwgdGltZXN0YW1wIChVbml4IHNlY29uZHMpXG4gIGRhdGFQcm90ZWN0aW9uPzoge1xuICAgIGVuYWJsZWQ/OiBib29sZWFuO1xuICAgIHJlZGFjdFBJST86IGJvb2xlYW47XG4gICAgcmVkYWN0U2Vuc2l0aXZlRmllbGRzPzogYm9vbGVhbjtcbiAgICBtYXhTdHJpbmdMZW5ndGg/OiBudW1iZXI7XG4gIH07XG4gIFxuICAvLyA9PT0gQ09OVFJPTCA9PT1cbiAgZW5hYmxlZD86IGJvb2xlYW47XG59XG5cbi8qKlxuICogRW5oYW5jZWQgY2FwdHVyZSBsb2cgZnVuY3Rpb24gZm9yIHRoZSBleGlzdGluZyBhdWRpdCBzeXN0ZW1cbiAqIFxuICogVGhpcyBpcyB0aGUgcHJpbWFyeSBpbnRlcmZhY2UgZm9yIGxvZ2dpbmcgdGhyb3VnaG91dCB0aGUgYXBwbGljYXRpb24uXG4gKiBJdCBhdXRvbWF0aWNhbGx5IGV4dHJhY3RzIGNvbnRleHQgZnJvbSB0aGUgZXhlY3V0aW9uIGVudmlyb25tZW50IGFuZFxuICogcHJvdmlkZXMgc2Vuc2libGUgZGVmYXVsdHMgZm9yIHJlcXVpcmVkIGZpZWxkcy5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNhcHR1cmVMb2cob3B0aW9uczogQ2FwdHVyZUxvZ09wdGlvbnMpOiBQcm9taXNlPHZvaWQ+IHtcbiAgdHJ5IHtcbiAgICBjb25zdCBhdWRpdExvZ2dlciA9IEF1ZGl0TG9nZ2VyRmFjdG9yeS5nZXRJbnN0YW5jZSgpLmNyZWF0ZSgpO1xuICAgIFxuICAgIC8vIEV4dHJhY3QgY29udGV4dCBpbmZvcm1hdGlvblxuICAgIGNvbnN0IGFjdG9yID0gb3B0aW9ucy5hY3RvciB8fCBvcHRpb25zLmN0eD8uYWN0b3I7XG4gICAgY29uc3QgY29ycmVsYXRpb25JZCA9IG9wdGlvbnMuY29ycmVsYXRpb25JZCB8fCBvcHRpb25zLmN0eD8ucmVxdWVzdD8ucmVxdWVzdElkIHx8IHJhbmRvbVVVSUQoKTtcbiAgICBjb25zdCBpcEFkZHJlc3MgPSBvcHRpb25zLmN0eD8uZXZlbnQ/LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8uc291cmNlSXA7XG4gICAgXG4gICAgLy8gQnVpbGQgbWV0cmljcyBvYmplY3RcbiAgICBjb25zdCBtZXRyaWNzID0geyAuLi5vcHRpb25zLm1ldHJpY3MgfTtcbiAgICBpZiAob3B0aW9ucy5kdXJhdGlvbiAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBtZXRyaWNzLmR1cmF0aW9uID0gb3B0aW9ucy5kdXJhdGlvbjtcbiAgICB9XG4gICAgXG4gICAgLy8gRGV0ZXJtaW5lIHN0YXR1cyBiYXNlZCBvbiBzdWNjZXNzIGZsYWdcbiAgICBsZXQgc3RhdHVzID0gb3B0aW9ucy5zdGF0dXM7XG4gICAgaWYgKHN0YXR1cyA9PT0gdW5kZWZpbmVkICYmIG9wdGlvbnMuc3VjY2VzcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBzdGF0dXMgPSBvcHRpb25zLnN1Y2Nlc3MgPyAnY29tcGxldGVkJyA6ICdmYWlsZWQnO1xuICAgIH1cbiAgICBcbiAgICAvLyBDcmVhdGUgdGhlIGVuaGFuY2VkIGF1ZGl0IGVudHJ5XG4gICAgY29uc3QgYXVkaXRFbnRyeTogQXVkaXRFbnRyeSA9IHtcbiAgICAgIC8vID09PSBDTEFTU0lGSUNBVElPTiA9PT1cbiAgICAgIGxvZ1R5cGU6IG9wdGlvbnMubG9nVHlwZSB8fCAnYXVkaXQnLFxuICAgICAgc3ViVHlwZTogb3B0aW9ucy5zdWJUeXBlLFxuICAgICAgc2V2ZXJpdHk6IG9wdGlvbnMuc2V2ZXJpdHkgfHwgJ2luZm8nLFxuICAgICAgY2F0ZWdvcnk6IG9wdGlvbnMuY2F0ZWdvcnksXG4gICAgICBcbiAgICAgIC8vID09PSBFTlRJVFkvUkVTT1VSQ0UgVFJBQ0tJTkcgPT09XG4gICAgICBlbnRpdHlOYW1lOiBvcHRpb25zLmVudGl0eU5hbWUgfHwgJ3Vua25vd24nLFxuICAgICAgZW50aXR5SWQ6IG9wdGlvbnMuZW50aXR5SWQsXG4gICAgICBldmVudFR5cGU6IG9wdGlvbnMuZXZlbnRUeXBlIHx8ICd1bmtub3duJyxcbiAgICAgIG9wZXJhdGlvbjogb3B0aW9ucy5vcGVyYXRpb24sXG4gICAgICBcbiAgICAgIC8vID09PSBTRVJWSUNFIENPTlRFWFQgPT09XG4gICAgICBzZXJ2aWNlOiBvcHRpb25zLnNlcnZpY2UsXG4gICAgICBleHRlcm5hbFN5c3RlbTogb3B0aW9ucy5leHRlcm5hbFN5c3RlbSxcbiAgICAgIGV4dGVybmFsSWQ6IG9wdGlvbnMuZXh0ZXJuYWxJZCxcbiAgICAgIFxuICAgICAgLy8gPT09IFNUQVRVUyAmIE9VVENPTUUgPT09XG4gICAgICBzdGF0dXMsXG4gICAgICBzdWNjZXNzOiBvcHRpb25zLnN1Y2Nlc3MsXG4gICAgICBpcEFkZHJlc3MsXG4gICAgICBcbiAgICAgIC8vID09PSBNRVRSSUNTID09PVxuICAgICAgbWV0cmljczogT2JqZWN0LmtleXMobWV0cmljcykubGVuZ3RoID4gMCA/IG1ldHJpY3MgOiB1bmRlZmluZWQsXG4gICAgICBcbiAgICAgIC8vID09PSBUUkFDS0lORyA9PT1cbiAgICAgIGNvcnJlbGF0aW9uSWQsXG4gICAgICBcbiAgICAgIC8vID09PSBBQ1RPUiA9PT1cbiAgICAgIGFjdG9yLFxuICAgICAgXG4gICAgICAvLyA9PT0gREFUQSBCTE9DS1MgPT09XG4gICAgICBkYXRhOiBvcHRpb25zLmRhdGEsXG4gICAgICBtZXRhZGF0YTogb3B0aW9ucy5tZXRhZGF0YSxcbiAgICAgIGNvbnRleHQ6IG9wdGlvbnMuY29udGV4dCxcbiAgICAgIFxuICAgICAgLy8gPT09IFRUTCA9PT1cbiAgICAgIHR0bDogb3B0aW9ucy50dGxcbiAgICB9O1xuICAgIFxuICAgIC8vIEFwcGx5IGRhdGEgcHJvdGVjdGlvblxuICAgIGNvbnN0IGRhdGFQcm90ZWN0aW9uQ29uZmlnID0ge1xuICAgICAgLi4uZ2V0RW52aXJvbm1lbnREYXRhUHJvdGVjdGlvbkNvbmZpZygpLFxuICAgICAgLi4ub3B0aW9ucy5kYXRhUHJvdGVjdGlvblxuICAgIH07XG4gICAgY29uc3QgcHJvdGVjdGVkQXVkaXRFbnRyeSA9IHByb3RlY3RBdWRpdERhdGEoYXVkaXRFbnRyeSwgZGF0YVByb3RlY3Rpb25Db25maWcpO1xuICAgIFxuICAgIC8vIENyZWF0ZSBhdWRpdCBvcHRpb25zXG4gICAgY29uc3QgYXVkaXRPcHRpb25zOiBBdWRpdE9wdGlvbnMgPSB7XG4gICAgICBlbmFibGVkOiBvcHRpb25zLmVuYWJsZWQsXG4gICAgICBhdWRpdEVudHJ5OiBwcm90ZWN0ZWRBdWRpdEVudHJ5XG4gICAgfTtcbiAgICBcbiAgICAvLyBMb2cgdGhlIGVudHJ5IHVzaW5nIHRoZSBleGlzdGluZyBhdWRpdCBzeXN0ZW1cbiAgICBhd2FpdCBhdWRpdExvZ2dlci5hdWRpdChhdWRpdE9wdGlvbnMpO1xuICAgIFxuICB9IGNhdGNoIChlcnJvcikge1xuICAgIC8vIERvbid0IGJyZWFrIGJ1c2luZXNzIGxvZ2ljIG9uIGxvZ2dpbmcgZmFpbHVyZXNcbiAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gY2FwdHVyZSBhdWRpdCBsb2c6JywgZXJyb3IsIHtcbiAgICAgIGxvZ1R5cGU6IG9wdGlvbnMubG9nVHlwZSxcbiAgICAgIHN1YlR5cGU6IG9wdGlvbnMuc3ViVHlwZSxcbiAgICAgIGVudGl0eU5hbWU6IG9wdGlvbnMuZW50aXR5TmFtZSxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IG9wdGlvbnMuY29ycmVsYXRpb25JZFxuICAgIH0pO1xuICB9XG59XG5cbi8qKlxuICogQ29udmVuaWVuY2UgZnVuY3Rpb24gZm9yIGNhcHR1cmluZyBlcnJvcnMgd2l0aCBwcm9wZXIgZXJyb3IgZm9ybWF0dGluZ1xuICogVGhpcyBpcyBhY3R1YWxseSB1c2VmdWwgc2luY2UgaXQgaGFuZGxlcyBlcnJvciBvYmplY3Qgc2VyaWFsaXphdGlvblxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY2FwdHVyZUVycm9yKFxuICBlcnJvcjogRXJyb3IgfCB1bmtub3duLCBcbiAgb3B0aW9uczogT21pdDxDYXB0dXJlTG9nT3B0aW9ucywgJ3NldmVyaXR5JyB8ICdzdWNjZXNzJyB8ICdzdGF0dXMnIHwgJ2RhdGEnPlxuKTogUHJvbWlzZTx2b2lkPiB7XG4gIHJldHVybiBjYXB0dXJlTG9nKHtcbiAgICAuLi5vcHRpb25zLFxuICAgIHNldmVyaXR5OiAnZXJyb3InLFxuICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgIHN0YXR1czogJ2ZhaWxlZCcsXG4gICAgZGF0YToge1xuICAgICAgZXJyb3I6IGVycm9yXG4gICAgfVxuICB9KTtcbn1cbi8qKlxuICogQXVkaXQgY2FwdHVyZSBzZXJ2aWNlIHRvIGhhbmRsZSBhdWRpdCBsb2dnaW5nIGZvciBhbGwgY29udHJvbGxlciB0eXBlc1xuICogVGhpcyBzZXJ2aWNlIGJyZWFrcyB0aGUgY2lyY3VsYXIgaW1wb3J0IGN5Y2xlIGJ5IGtlZXBpbmcgYXVkaXQgbG9naWMgc2VwYXJhdGUgZnJvbSBjb250cm9sbGVyc1xuICovXG5cbmV4cG9ydCBjbGFzcyBBdWRpdENhcHR1cmVTZXJ2aWNlIHtcblxuICAvKipcbiAgICogQ2FwdHVyZXMgYXVkaXQgbG9nIGZvciBvcGVyYXRpb24gc3RhcnRcbiAgICovXG4gIHN0YXRpYyBhc3luYyBjYXB0dXJlU3RhcnQoXG4gICAgYXVkaXRDb250ZXh0OiBBdWRpdENvbnRleHQsXG4gICAgb3BlcmF0aW9uQ29udGV4dDogUmVxdWVzdEF1ZGl0Q29udGV4dCB8IFF1ZXVlQXVkaXRDb250ZXh0IHwgVGFza0F1ZGl0Q29udGV4dFxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWF1ZGl0Q29udGV4dC5lbmFibGVkIHx8IGF1ZGl0Q29udGV4dC5hdWRpdENvbmZpZy5za2lwU3RhcnQpIHJldHVybjtcblxuICAgIC8vIENoZWNrIHNhbXBsaW5nXG4gICAgaWYgKGF1ZGl0Q29udGV4dC5hdWRpdENvbmZpZy5zYW1wbGluZ0ZuICYmXG4gICAgICAhYXVkaXRDb250ZXh0LmF1ZGl0Q29uZmlnLnNhbXBsaW5nRm4oYXVkaXRDb250ZXh0LmNvcnJlbGF0aW9uLmNvcnJlbGF0aW9uSWQsIGF1ZGl0Q29udGV4dC5vcGVyYXRpb24pKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgYXdhaXQgY2FwdHVyZUxvZyh7XG4gICAgICBsb2dUeXBlOiBhdWRpdENvbnRleHQubG9nVHlwZSxcbiAgICAgIHN1YlR5cGU6IGAke2F1ZGl0Q29udGV4dC5zdWJUeXBlfV9zdGFydGAsXG4gICAgICBlbnRpdHlOYW1lOiBhdWRpdENvbnRleHQuZW50aXR5TmFtZSxcbiAgICAgIGV2ZW50VHlwZTogJ3N0YXJ0JyxcbiAgICAgIG9wZXJhdGlvbjogYXVkaXRDb250ZXh0Lm9wZXJhdGlvbixcbiAgICAgIGNhdGVnb3J5OiBhdWRpdENvbnRleHQuY2F0ZWdvcnksXG4gICAgICBjb3JyZWxhdGlvbklkOiBhdWRpdENvbnRleHQuY29ycmVsYXRpb24uY29ycmVsYXRpb25JZCxcbiAgICAgIGFjdG9yOiBhdWRpdENvbnRleHQuYWN0b3IsXG4gICAgICBjb250ZXh0OiB7XG4gICAgICAgIGNvcnJlbGF0aW9uOiBhdWRpdENvbnRleHQuY29ycmVsYXRpb24sXG4gICAgICAgIFsgYXVkaXRDb250ZXh0LmNvcnJlbGF0aW9uLm9wZXJhdGlvblR5cGUgXTogb3BlcmF0aW9uQ29udGV4dFxuICAgICAgfSxcbiAgICAgIG1ldGFkYXRhOiBhdWRpdENvbnRleHQuYXVkaXRDb25maWcuY3VzdG9tQ29udGV4dCxcbiAgICAgIHR0bDogYXVkaXRDb250ZXh0LmF1ZGl0Q29uZmlnLnR0bCxcbiAgICAgIGRhdGFQcm90ZWN0aW9uOiBhdWRpdENvbnRleHQuYXVkaXRDb25maWcuZGF0YVByb3RlY3Rpb25cbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDYXB0dXJlcyBhdWRpdCBsb2cgZm9yIG9wZXJhdGlvbiBlbmQgKHN1Y2Nlc3Mgb3IgZXJyb3IpXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgY2FwdHVyZUVuZChcbiAgICBhdWRpdENvbnRleHQ6IEF1ZGl0Q29udGV4dCxcbiAgICBfcmVzdWx0OiBhbnksXG4gICAgZXJyb3I6IEVycm9yIHwgbnVsbCxcbiAgICByZXNwb25zZUNvbnRleHQ/OiBhbnlcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFhdWRpdENvbnRleHQuZW5hYmxlZCkgcmV0dXJuO1xuICAgIGlmIChlcnJvciAmJiBhdWRpdENvbnRleHQuYXVkaXRDb25maWcuc2tpcEVycm9ycykgcmV0dXJuO1xuICAgIGlmICghZXJyb3IgJiYgYXVkaXRDb250ZXh0LmF1ZGl0Q29uZmlnLnNraXBFbmQpIHJldHVybjtcblxuICAgIC8vIENoZWNrIHNhbXBsaW5nXG4gICAgaWYgKGF1ZGl0Q29udGV4dC5hdWRpdENvbmZpZy5zYW1wbGluZ0ZuICYmXG4gICAgICAhYXVkaXRDb250ZXh0LmF1ZGl0Q29uZmlnLnNhbXBsaW5nRm4oYXVkaXRDb250ZXh0LmNvcnJlbGF0aW9uLmNvcnJlbGF0aW9uSWQsIGF1ZGl0Q29udGV4dC5vcGVyYXRpb24pKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgZHVyYXRpb24gPSBEYXRlLm5vdygpIC0gbmV3IERhdGUoYXVkaXRDb250ZXh0LmNvcnJlbGF0aW9uLnN0YXJ0VGltZXN0YW1wKS5nZXRUaW1lKCk7XG5cbiAgICBhd2FpdCBjYXB0dXJlTG9nKHtcbiAgICAgIGxvZ1R5cGU6IGF1ZGl0Q29udGV4dC5sb2dUeXBlLFxuICAgICAgc3ViVHlwZTogZXJyb3IgPyBgJHthdWRpdENvbnRleHQuc3ViVHlwZX1fZXJyb3JgIDogYCR7YXVkaXRDb250ZXh0LnN1YlR5cGV9X2NvbXBsZXRlYCxcbiAgICAgIGVudGl0eU5hbWU6IGF1ZGl0Q29udGV4dC5lbnRpdHlOYW1lLFxuICAgICAgZXZlbnRUeXBlOiBlcnJvciA/ICdlcnJvcicgOiAnY29tcGxldGUnLFxuICAgICAgb3BlcmF0aW9uOiBhdWRpdENvbnRleHQub3BlcmF0aW9uLFxuICAgICAgY2F0ZWdvcnk6IGF1ZGl0Q29udGV4dC5jYXRlZ29yeSxcbiAgICAgIHN1Y2Nlc3M6ICFlcnJvcixcbiAgICAgIHN0YXR1czogZXJyb3IgPyAnZmFpbGVkJyA6ICdjb21wbGV0ZWQnLFxuICAgICAgY29ycmVsYXRpb25JZDogYXVkaXRDb250ZXh0LmNvcnJlbGF0aW9uLmNvcnJlbGF0aW9uSWQsXG4gICAgICBhY3RvcjogYXVkaXRDb250ZXh0LmFjdG9yLFxuICAgICAgbWV0cmljczoge1xuICAgICAgICBkdXJhdGlvbixcbiAgICAgICAgLi4uKHJlc3BvbnNlQ29udGV4dCA/IHtcbiAgICAgICAgICBzdGF0dXNDb2RlOiByZXNwb25zZUNvbnRleHQuc3RhdHVzQ29kZSxcbiAgICAgICAgICByZXNwb25zZVNpemU6IHJlc3BvbnNlQ29udGV4dC5yZXNwb25zZVNpemVcbiAgICAgICAgfSA6IHt9KVxuICAgICAgfSxcbiAgICAgIGNvbnRleHQ6IHtcbiAgICAgICAgY29ycmVsYXRpb246IGF1ZGl0Q29udGV4dC5jb3JyZWxhdGlvbixcbiAgICAgICAgLi4uKHJlc3BvbnNlQ29udGV4dCAmJiB7IHJlc3BvbnNlOiByZXNwb25zZUNvbnRleHQgfSlcbiAgICAgIH0sXG4gICAgICBtZXRhZGF0YTogYXVkaXRDb250ZXh0LmF1ZGl0Q29uZmlnLmN1c3RvbUNvbnRleHQsXG4gICAgICB0dGw6IGF1ZGl0Q29udGV4dC5hdWRpdENvbmZpZy50dGwsXG4gICAgICBkYXRhUHJvdGVjdGlvbjogYXVkaXRDb250ZXh0LmF1ZGl0Q29uZmlnLmRhdGFQcm90ZWN0aW9uLFxuICAgICAgZGF0YTogeyBlcnJvciB9XG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==