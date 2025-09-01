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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXVkaXQtaGVscGVycy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9hdWRpdC9oZWxwZXJzL2F1ZGl0LWhlbHBlcnMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBK0VBLGdDQTBGQztBQU1ELG9DQWFDO0FBM0xELGdEQUF3RDtBQUd4RCxtQ0FBb0M7QUFFcEMsdURBQTJFO0FBa0UzRTs7Ozs7O0dBTUc7QUFDSSxLQUFLLFVBQVUsVUFBVSxDQUFDLE9BQTBCO0lBQ3pELElBQUksQ0FBQztRQUNILE1BQU0sV0FBVyxHQUFHLDRCQUFrQixDQUFDLFdBQVcsRUFBRSxDQUFDLE1BQU0sRUFBRSxDQUFDO1FBRTlELDhCQUE4QjtRQUM5QixNQUFNLEtBQUssR0FBRyxPQUFPLENBQUMsS0FBSyxJQUFJLE9BQU8sQ0FBQyxHQUFHLEVBQUUsS0FBSyxDQUFDO1FBQ2xELE1BQU0sYUFBYSxHQUFHLE9BQU8sQ0FBQyxhQUFhLElBQUksT0FBTyxDQUFDLEdBQUcsRUFBRSxPQUFPLEVBQUUsU0FBUyxJQUFJLElBQUEsbUJBQVUsR0FBRSxDQUFDO1FBQy9GLE1BQU0sU0FBUyxHQUFHLE9BQU8sQ0FBQyxHQUFHLEVBQUUsS0FBSyxFQUFFLGNBQWMsRUFBRSxRQUFRLEVBQUUsUUFBUSxDQUFDO1FBRXpFLHNDQUFzQztRQUN0QyxNQUFNLE9BQU8sR0FBd0IsRUFBRSxDQUFDO1FBQ3hDLElBQUksT0FBTyxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBQ3BCLE1BQU0sQ0FBQyxNQUFNLENBQUMsT0FBTyxFQUFFLE9BQU8sQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUMxQyxDQUFDO1FBQ0QsSUFBSSxPQUFPLENBQUMsUUFBUSxLQUFLLFNBQVMsRUFBRSxDQUFDO1lBQ25DLE9BQU8sQ0FBQyxRQUFRLEdBQUcsT0FBTyxDQUFDLFFBQVEsQ0FBQztRQUN0QyxDQUFDO1FBRUQseUNBQXlDO1FBQ3pDLElBQUksTUFBTSxHQUFHLE9BQU8sQ0FBQyxNQUFN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LENBQUMsQ0FBQyxDQUFDLFdBQVc7WUFDdEMsYUFBYSxFQUFFLFlBQVksQ0FBQyxXQUFXLENBQUMsYUFBYTtZQUNyRCxLQUFLLEVBQUUsWUFBWSxDQUFDLEtBQUs7WUFDekIsT0FBTyxFQUFFO2dCQUNQLFFBQVE7Z0JBQ1IsR0FBRyxDQUFDLGVBQWUsQ0FBQyxDQUFDLENBQUM7b0JBQ3BCLFVBQVUsRUFBRSxlQUFlLENBQUMsVUFBVTtvQkFDdEMsWUFBWSxFQUFFLGVBQWUsQ0FBQyxZQUFZO2lCQUMzQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7YUFDUjtZQUNELE9BQU8sRUFBRTtnQkFDUCxXQUFXLEVBQUUsWUFBWSxDQUFDLFdBQVc7Z0JBQ3JDLEdBQUcsQ0FBQyxlQUFlLElBQUksRUFBRSxRQUFRLEVBQUUsZUFBZSxFQUFFLENBQUM7YUFDdEQ7WUFDRCxRQUFRLEVBQUUsWUFBWSxDQUFDLFdBQVcsQ0FBQyxhQUFhO1lBQ2hELEdBQUcsRUFBRSxZQUFZLENBQUMsV0FBVyxDQUFDLEdBQUc7WUFDakMsY0FBYyxFQUFFLFlBQVksQ0FBQyxXQUFXLENBQUMsY0FBYztZQUN2RCxJQUFJLEVBQUUsRUFBRSxLQUFLLEVBQUU7U0FDaEIsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBdkZELGtEQXVGQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEF1ZGl0RW50cnksIEF1ZGl0T3B0aW9ucyB9IGZyb20gJy4uL2ludGVyZmFjZXMnO1xuaW1wb3J0IHsgQXVkaXRMb2dnZXJGYWN0b3J5IH0gZnJvbSAnLi4vbG9nZ2Vycy9mYWN0b3J5JztcbmltcG9ydCB7IEFjdG9yIH0gZnJvbSBcIi4uLy4uL2NvcmUvdHlwZXMvZXhlY3V0aW9uLWNvbnRleHRcIjtcbmltcG9ydCB7IEV4ZWN1dGlvbkNvbnRleHQgfSBmcm9tICcuLi8uLi9jb3JlL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0JztcbmltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tICdjcnlwdG8nO1xuaW1wb3J0IHsgQXVkaXRDb250ZXh0LCBSZXF1ZXN0QXVkaXRDb250ZXh0LCBRdWV1ZUF1ZGl0Q29udGV4dCwgVGFza0F1ZGl0Q29udGV4dCB9IGZyb20gJy4uLy4uL2Z3MjQnO1xuaW1wb3J0IHsgcHJvdGVjdEF1ZGl0RGF0YSwgRGF0YVByb3RlY3Rpb25Db25maWcgfSBmcm9tICcuL2RhdGEtcHJvdGVjdGlvbic7XG5cbi8qKlxuICogRW5oYW5jZWQgY2FwdHVyZSBvcHRpb25zIGZvciB0aGUgYXVkaXQgc3lzdGVtXG4gKiBcbiAqIFRoaXMgaW50ZXJmYWNlIHByb3ZpZGVzIG9wdGlvbnMgZm9yIGNhcHR1cmluZyBsb2dzIHdpdGggYXV0b21hdGljXG4gKiBjb250ZXh0IGV4dHJhY3Rpb24gd2hpbGUgbWFpbnRhaW5pbmcgYmFja3dhcmQgY29tcGF0aWJpbGl0eS5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBDYXB0dXJlTG9nT3B0aW9ucyB7XG4gIC8vID09PSBDTEFTU0lGSUNBVElPTiA9PT1cbiAgbG9nVHlwZT86ICdhdWRpdCcgfCAnbG9nJyB8ICdldmVudCcgfCAnbWV0cmljJztcbiAgc3ViVHlwZT86IHN0cmluZztcbiAgc2V2ZXJpdHk/OiAnaW5mbycgfCAnd2FybicgfCAnZXJyb3InIHwgJ2NyaXRpY2FsJztcbiAgY2F0ZWdvcnk/OiBzdHJpbmc7XG4gIFxuICAvLyA9PT0gRU5USVRZL1JFU09VUkNFIFRSQUNLSU5HID09PVxuICBlbnRpdHlOYW1lPzogc3RyaW5nO1xuICBlbnRpdHlJZD86IHN0cmluZztcbiAgZXZlbnRUeXBlPzogc3RyaW5nO1xuICBvcGVyYXRpb24/OiBzdHJpbmc7XG4gIFxuICAvLyA9PT0gU0VSVklDRSBDT05URVhUID09PVxuICBzZXJ2aWNlPzogc3RyaW5nO1xuICBleHRlcm5hbFN5c3RlbT86IHN0cmluZztcbiAgZXh0ZXJuYWxJZD86IHN0cmluZztcbiAgXG4gIC8vID09PSBTVEFUVVMgJiBPVVRDT01FID09PVxuICBzdGF0dXM/OiBzdHJpbmc7XG4gIHN1Y2Nlc3M/OiBib29sZWFuO1xuICBcbiAgLy8gPT09IE1FVFJJQ1MgPT09XG4gIG1ldHJpY3M/OiB7XG4gICAgZHVyYXRpb24/OiBudW1iZXI7XG4gICAgYW1vdW50PzogbnVtYmVyO1xuICAgIGN1cnJlbmN5Pzogc3RyaW5nO1xuICAgIHJlY29yZENvdW50PzogbnVtYmVyO1xuICAgIGRhdGFTaXplPzogbnVtYmVyO1xuICAgIHJlc3BvbnNlVGltZT86IG51bWJlcjtcbiAgICB0aHJvdWdocHV0PzogbnVtYmVyO1xuICAgIGVycm9yUmF0ZT86IG51bWJlcjtcbiAgICBba2V5OiBzdHJpbmddOiBhbnk7XG4gIH07XG4gIFxuICAvLyA9PT0gVFJBQ0tJTkcgPT09XG4gIGNvcnJlbGF0aW9uSWQ/OiBzdHJpbmc7XG4gIFxuICAvLyA9PT0gREFUQSBCTE9DS1MgPT09XG4gIGRhdGE/OiBhbnk7XG4gIG1ldGFkYXRhPzogYW55O1xuICBjb250ZXh0PzogYW55O1xuICBcbiAgLy8gPT09IFJVTlRJTUUgQ09OVEVYVCA9PT1cbiAgY3R4PzogRXhlY3V0aW9uQ29udGV4dDtcbiAgYWN0b3I/OiBBY3RvcjtcbiAgXG4gIC8vID09PSBDT05WRU5JRU5DRSA9PT1cbiAgZHVyYXRpb24/OiBudW1iZXI7IC8vIFdpbGwgYmUgYWRkZWQgdG8gbWV0cmljc1xuICBcbiAgLy8gPT09IFRUTCAmIERBVEEgUFJPVEVDVElPTiA9PT1cbiAgdHRsPzogbnVtYmVyOyAgICAgICAgICAgICAgICAgICAgICAvLyBDdXN0b20gVFRMIHRpbWVzdGFtcCAoVW5peCBzZWNvbmRzKVxuICBkYXRhUHJvdGVjdGlvbj86IERhdGFQcm90ZWN0aW9uQ29uZmlnO1xuICBcbiAgLy8gPT09IENPTlRST0wgPT09XG4gIGVuYWJsZWQ/OiBib29sZWFuO1xufVxuXG4vKipcbiAqIEVuaGFuY2VkIGNhcHR1cmUgbG9nIGZ1bmN0aW9uIGZvciB0aGUgZXhpc3RpbmcgYXVkaXQgc3lzdGVtXG4gKiBcbiAqIFRoaXMgaXMgdGhlIHByaW1hcnkgaW50ZXJmYWNlIGZvciBsb2dnaW5nIHRocm91Z2hvdXQgdGhlIGFwcGxpY2F0aW9uLlxuICogSXQgYXV0b21hdGljYWxseSBleHRyYWN0cyBjb250ZXh0IGZyb20gdGhlIGV4ZWN1dGlvbiBlbnZpcm9ubWVudCBhbmRcbiAqIHByb3ZpZGVzIHNlbnNpYmxlIGRlZmF1bHRzIGZvciByZXF1aXJlZCBmaWVsZHMuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjYXB0dXJlTG9nKG9wdGlvbnM6IENhcHR1cmVMb2dPcHRpb25zKTogUHJvbWlzZTx2b2lkPiB7XG4gIHRyeSB7XG4gICAgY29uc3QgYXVkaXRMb2dnZXIgPSBBdWRpdExvZ2dlckZhY3RvcnkuZ2V0SW5zdGFuY2UoKS5jcmVhdGUoKTtcbiAgICBcbiAgICAvLyBFeHRyYWN0IGNvbnRleHQgaW5mb3JtYXRpb25cbiAgICBjb25zdCBhY3RvciA9IG9wdGlvbnMuYWN0b3IgfHwgb3B0aW9ucy5jdHg/LmFjdG9yO1xuICAgIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSBvcHRpb25zLmNvcnJlbGF0aW9uSWQgfHwgb3B0aW9ucy5jdHg/LnJlcXVlc3Q/LnJlcXVlc3RJZCB8fCByYW5kb21VVUlEKCk7XG4gICAgY29uc3QgaXBBZGRyZXNzID0gb3B0aW9ucy5jdHg/LmV2ZW50Py5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LnNvdXJjZUlwO1xuICAgIFxuICAgIC8vIEJ1aWxkIG1ldHJpY3Mgb2JqZWN0IG9ubHkgaWYgbmVlZGVkXG4gICAgY29uc3QgbWV0cmljczogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9O1xuICAgIGlmIChvcHRpb25zLm1ldHJpY3MpIHtcbiAgICAgIE9iamVjdC5hc3NpZ24obWV0cmljcywgb3B0aW9ucy5tZXRyaWNzKTtcbiAgICB9XG4gICAgaWYgKG9wdGlvbnMuZHVyYXRpb24gIT09IHVuZGVmaW5lZCkge1xuICAgICAgbWV0cmljcy5kdXJhdGlvbiA9IG9wdGlvbnMuZHVyYXRpb247XG4gICAgfVxuICAgIFxuICAgIC8vIERldGVybWluZSBzdGF0dXMgYmFzZWQgb24gc3VjY2VzcyBmbGFnXG4gICAgbGV0IHN0YXR1cyA9IG9wdGlvbnMuc3RhdHVzO1xuICAgIGlmIChzdGF0dXMgPT09IHVuZGVmaW5lZCAmJiBvcHRpb25zLnN1Y2Nlc3MgIT09IHVuZGVmaW5lZCkge1xuICAgICAgc3RhdHVzID0gb3B0aW9ucy5zdWNjZXNzID8gJ2NvbXBsZXRlZCcgOiAnZmFpbGVkJztcbiAgICB9XG4gICAgXG4gICAgLy8gQ3JlYXRlIHRoZSBlbmhhbmNlZCBhdWRpdCBlbnRyeVxuICAgIGNvbnN0IGF1ZGl0RW50cnk6IEF1ZGl0RW50cnkgPSB7XG4gICAgICAvLyA9PT0gQ0xBU1NJRklDQVRJT04gPT09XG4gICAgICBsb2dUeXBlOiBvcHRpb25zLmxvZ1R5cGUgfHwgJ2F1ZGl0JyxcbiAgICAgIHN1YlR5cGU6IG9wdGlvbnMuc3ViVHlwZSxcbiAgICAgIHNldmVyaXR5OiBvcHRpb25zLnNldmVyaXR5IHx8ICdpbmZvJyxcbiAgICAgIGNhdGVnb3J5OiBvcHRpb25zLmNhdGVnb3J5LFxuICAgICAgXG4gICAgICAvLyA9PT0gRU5USVRZL1JFU09VUkNFIFRSQUNLSU5HID09PVxuICAgICAgZW50aXR5TmFtZTogb3B0aW9ucy5lbnRpdHlOYW1lIHx8ICd1bmtub3duJyxcbiAgICAgIGVudGl0eUlkOiBvcHRpb25zLmVudGl0eUlkLFxuICAgICAgZXZlbnRUeXBlOiBvcHRpb25zLmV2ZW50VHlwZSB8fCAndW5rbm93bicsXG4gICAgICBvcGVyYXRpb246IG9wdGlvbnMub3BlcmF0aW9uLFxuICAgICAgXG4gICAgICAvLyA9PT0gU0VSVklDRSBDT05URVhUID09PVxuICAgICAgc2VydmljZTogb3B0aW9ucy5zZXJ2aWNlLFxuICAgICAgZXh0ZXJuYWxTeXN0ZW06IG9wdGlvbnMuZXh0ZXJuYWxTeXN0ZW0sXG4gICAgICBleHRlcm5hbElkOiBvcHRpb25zLmV4dGVybmFsSWQsXG4gICAgICBcbiAgICAgIC8vID09PSBTVEFUVVMgJiBPVVRDT01FID09PVxuICAgICAgc3RhdHVzLFxuICAgICAgc3VjY2Vzczogb3B0aW9ucy5zdWNjZXNzLFxuICAgICAgaXBBZGRyZXNzLFxuICAgICAgXG4gICAgICAvLyA9PT0gTUVUUklDUyA9PT1cbiAgICAgIG1ldHJpY3M6IE9iamVjdC5rZXlzKG1ldHJpY3MpLmxlbmd0aCA+IDAgPyBtZXRyaWNzIDogdW5kZWZpbmVkLFxuICAgICAgXG4gICAgICAvLyA9PT0gVFJBQ0tJTkcgPT09XG4gICAgICBjb3JyZWxhdGlvbklkLFxuICAgICAgXG4gICAgICAvLyA9PT0gQUNUT1IgPT09XG4gICAgICBhY3RvcixcbiAgICAgIFxuICAgICAgLy8gPT09IERBVEEgQkxPQ0tTID09PVxuICAgICAgZGF0YTogb3B0aW9ucy5kYXRhLFxuICAgICAgbWV0YWRhdGE6IG9wdGlvbnMubWV0YWRhdGEsXG4gICAgICBjb250ZXh0OiBvcHRpb25zLmNvbnRleHQsXG4gICAgICBcbiAgICAgIC8vID09PSBUVEwgPT09XG4gICAgICB0dGw6IG9wdGlvbnMudHRsXG4gICAgfTtcbiAgICBcbiAgICAvLyBBcHBseSBkYXRhIHByb3RlY3Rpb25cbiAgICBjb25zdCBkYXRhUHJvdGVjdGlvbkNvbmZpZyA9IHtcbiAgICAgIC4uLm9wdGlvbnMuZGF0YVByb3RlY3Rpb25cbiAgICB9O1xuICAgIGNvbnN0IHByb3RlY3RlZEF1ZGl0RW50cnkgPSBwcm90ZWN0QXVkaXREYXRhKGF1ZGl0RW50cnksIGRhdGFQcm90ZWN0aW9uQ29uZmlnKTtcbiAgICBcbiAgICAvLyBDcmVhdGUgYXVkaXQgb3B0aW9uc1xuICAgIGNvbnN0IGF1ZGl0T3B0aW9uczogQXVkaXRPcHRpb25zID0ge1xuICAgICAgZW5hYmxlZDogb3B0aW9ucy5lbmFibGVkLFxuICAgICAgYXVkaXRFbnRyeTogcHJvdGVjdGVkQXVkaXRFbnRyeVxuICAgIH07XG4gICAgXG4gICAgLy8gTG9nIHRoZSBlbnRyeSB1c2luZyB0aGUgZXhpc3RpbmcgYXVkaXQgc3lzdGVtXG4gICAgYXdhaXQgYXVkaXRMb2dnZXIuYXVkaXQoYXVkaXRPcHRpb25zKTtcbiAgICBcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAvLyBEb24ndCBicmVhayBidXNpbmVzcyBsb2dpYyBvbiBsb2dnaW5nIGZhaWx1cmVzXG4gICAgY29uc29sZS5lcnJvcignRmFpbGVkIHRvIGNhcHR1cmUgYXVkaXQgbG9nOicsIGVycm9yLCB7XG4gICAgICBsb2dUeXBlOiBvcHRpb25zLmxvZ1R5cGUsXG4gICAgICBzdWJUeXBlOiBvcHRpb25zLnN1YlR5cGUsXG4gICAgICBlbnRpdHlOYW1lOiBvcHRpb25zLmVudGl0eU5hbWUsXG4gICAgICBjb3JyZWxhdGlvbklkOiBvcHRpb25zLmNvcnJlbGF0aW9uSWRcbiAgICB9KTtcbiAgfVxufVxuXG4vKipcbiAqIENvbnZlbmllbmNlIGZ1bmN0aW9uIGZvciBjYXB0dXJpbmcgZXJyb3JzIHdpdGggcHJvcGVyIGVycm9yIGZvcm1hdHRpbmdcbiAqIFRoaXMgaXMgYWN0dWFsbHkgdXNlZnVsIHNpbmNlIGl0IGhhbmRsZXMgZXJyb3Igb2JqZWN0IHNlcmlhbGl6YXRpb25cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNhcHR1cmVFcnJvcihcbiAgZXJyb3I6IEVycm9yIHwgdW5rbm93biwgXG4gIG9wdGlvbnM6IE9taXQ8Q2FwdHVyZUxvZ09wdGlvbnMsICdzZXZlcml0eScgfCAnc3VjY2VzcycgfCAnc3RhdHVzJyB8ICdkYXRhJz5cbik6IFByb21pc2U8dm9pZD4ge1xuICByZXR1cm4gY2FwdHVyZUxvZyh7XG4gICAgLi4ub3B0aW9ucyxcbiAgICBzZXZlcml0eTogJ2Vycm9yJyxcbiAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICBzdGF0dXM6ICdmYWlsZWQnLFxuICAgIGRhdGE6IHtcbiAgICAgIGVycm9yOiBlcnJvclxuICAgIH1cbiAgfSk7XG59XG4vKipcbiAqIEF1ZGl0IGNhcHR1cmUgc2VydmljZSB0byBoYW5kbGUgYXVkaXQgbG9nZ2luZyBmb3IgYWxsIGNvbnRyb2xsZXIgdHlwZXNcbiAqIFRoaXMgc2VydmljZSBicmVha3MgdGhlIGNpcmN1bGFyIGltcG9ydCBjeWNsZSBieSBrZWVwaW5nIGF1ZGl0IGxvZ2ljIHNlcGFyYXRlIGZyb20gY29udHJvbGxlcnNcbiAqL1xuXG5leHBvcnQgY2xhc3MgQXVkaXRDYXB0dXJlU2VydmljZSB7XG5cbiAgLyoqXG4gICAqIENhcHR1cmVzIGF1ZGl0IGxvZyBmb3Igb3BlcmF0aW9uIHN0YXJ0XG4gICAqL1xuICBzdGF0aWMgYXN5bmMgY2FwdHVyZVN0YXJ0KFxuICAgIGF1ZGl0Q29udGV4dDogQXVkaXRDb250ZXh0LFxuICAgIG9wZXJhdGlvbkNvbnRleHQ6IFJlcXVlc3RBdWRpdENvbnRleHQgfCBRdWV1ZUF1ZGl0Q29udGV4dCB8IFRhc2tBdWRpdENvbnRleHRcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFhdWRpdENvbnRleHQuZW5hYmxlZCB8fCBhdWRpdENvbnRleHQuYXVkaXRDb25maWcuc2tpcFN0YXJ0KSByZXR1cm47XG5cbiAgICAvLyBDaGVjayBzYW1wbGluZ1xuICAgIGlmIChhdWRpdENvbnRleHQuYXVkaXRDb25maWcuc2FtcGxpbmdGbiAmJlxuICAgICAgIWF1ZGl0Q29udGV4dC5hdWRpdENvbmZpZy5zYW1wbGluZ0ZuKGF1ZGl0Q29udGV4dC5jb3JyZWxhdGlvbi5jb3JyZWxhdGlvbklkLCBhdWRpdENvbnRleHQub3BlcmF0aW9uKSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGF3YWl0IGNhcHR1cmVMb2coe1xuICAgICAgbG9nVHlwZTogYXVkaXRDb250ZXh0LmxvZ1R5cGUsXG4gICAgICBzdWJUeXBlOiBgJHthdWRpdENvbnRleHQuc3ViVHlwZX1fc3RhcnRgLFxuICAgICAgZW50aXR5TmFtZTogYXVkaXRDb250ZXh0LmVudGl0eU5hbWUsXG4gICAgICBlbnRpdHlJZDogYXVkaXRDb250ZXh0LmVudGl0eUlkLFxuICAgICAgZXZlbnRUeXBlOiAnc3RhcnQnLFxuICAgICAgb3BlcmF0aW9uOiBhdWRpdENvbnRleHQub3BlcmF0aW9uLFxuICAgICAgY2F0ZWdvcnk6IGF1ZGl0Q29udGV4dC5jYXRlZ29yeSxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IGF1ZGl0Q29udGV4dC5jb3JyZWxhdGlvbi5jb3JyZWxhdGlvbklkLFxuICAgICAgYWN0b3I6IGF1ZGl0Q29udGV4dC5hY3RvcixcbiAgICAgIGNvbnRleHQ6IHtcbiAgICAgICAgY29ycmVsYXRpb246IGF1ZGl0Q29udGV4dC5jb3JyZWxhdGlvbixcbiAgICAgICAgWyBhdWRpdENvbnRleHQuY29ycmVsYXRpb24ub3BlcmF0aW9uVHlwZSBdOiBvcGVyYXRpb25Db250ZXh0XG4gICAgICB9LFxuICAgICAgbWV0YWRhdGE6IGF1ZGl0Q29udGV4dC5hdWRpdENvbmZpZy5jdXN0b21Db250ZXh0LFxuICAgICAgdHRsOiBhdWRpdENvbnRleHQuYXVkaXRDb25maWcudHRsLFxuICAgICAgZGF0YVByb3RlY3Rpb246IGF1ZGl0Q29udGV4dC5hdWRpdENvbmZpZy5kYXRhUHJvdGVjdGlvblxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIENhcHR1cmVzIGF1ZGl0IGxvZyBmb3Igb3BlcmF0aW9uIGVuZCAoc3VjY2VzcyBvciBlcnJvcilcbiAgICovXG4gIHN0YXRpYyBhc3luYyBjYXB0dXJlRW5kKFxuICAgIGF1ZGl0Q29udGV4dDogQXVkaXRDb250ZXh0LFxuICAgIF9yZXN1bHQ6IGFueSxcbiAgICBlcnJvcjogRXJyb3IgfCBudWxsLFxuICAgIHJlc3BvbnNlQ29udGV4dD86IGFueVxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWF1ZGl0Q29udGV4dC5lbmFibGVkKSByZXR1cm47XG4gICAgaWYgKGVycm9yICYmIGF1ZGl0Q29udGV4dC5hdWRpdENvbmZpZy5za2lwRXJyb3JzKSByZXR1cm47XG4gICAgaWYgKCFlcnJvciAmJiBhdWRpdENvbnRleHQuYXVkaXRDb25maWcuc2tpcEVuZCkgcmV0dXJuO1xuXG4gICAgLy8gQ2hlY2sgc2FtcGxpbmdcbiAgICBpZiAoYXVkaXRDb250ZXh0LmF1ZGl0Q29uZmlnLnNhbXBsaW5nRm4gJiZcbiAgICAgICFhdWRpdENvbnRleHQuYXVkaXRDb25maWcuc2FtcGxpbmdGbihhdWRpdENvbnRleHQuY29ycmVsYXRpb24uY29ycmVsYXRpb25JZCwgYXVkaXRDb250ZXh0Lm9wZXJhdGlvbikpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBkdXJhdGlvbiA9IERhdGUubm93KCkgLSBuZXcgRGF0ZShhdWRpdENvbnRleHQuY29ycmVsYXRpb24uc3RhcnRUaW1lc3RhbXApLmdldFRpbWUoKTtcblxuICAgIGF3YWl0IGNhcHR1cmVMb2coe1xuICAgICAgbG9nVHlwZTogYXVkaXRDb250ZXh0LmxvZ1R5cGUsXG4gICAgICBzdWJUeXBlOiBlcnJvciA/IGAke2F1ZGl0Q29udGV4dC5zdWJUeXBlfV9lcnJvcmAgOiBgJHthdWRpdENvbnRleHQuc3ViVHlwZX1fY29tcGxldGVgLFxuICAgICAgZW50aXR5TmFtZTogYXVkaXRDb250ZXh0LmVudGl0eU5hbWUsXG4gICAgICBlbnRpdHlJZDogYXVkaXRDb250ZXh0LmVudGl0eUlkLFxuICAgICAgZXZlbnRUeXBlOiBlcnJvciA/ICdlcnJvcicgOiAnY29tcGxldGUnLFxuICAgICAgb3BlcmF0aW9uOiBhdWRpdENvbnRleHQub3BlcmF0aW9uLFxuICAgICAgY2F0ZWdvcnk6IGF1ZGl0Q29udGV4dC5jYXRlZ29yeSxcbiAgICAgIHN1Y2Nlc3M6ICFlcnJvcixcbiAgICAgIHN0YXR1czogZXJyb3IgPyAnZmFpbGVkJyA6ICdjb21wbGV0ZWQnLFxuICAgICAgY29ycmVsYXRpb25JZDogYXVkaXRDb250ZXh0LmNvcnJlbGF0aW9uLmNvcnJlbGF0aW9uSWQsXG4gICAgICBhY3RvcjogYXVkaXRDb250ZXh0LmFjdG9yLFxuICAgICAgbWV0cmljczoge1xuICAgICAgICBkdXJhdGlvbixcbiAgICAgICAgLi4uKHJlc3BvbnNlQ29udGV4dCA/IHtcbiAgICAgICAgICBzdGF0dXNDb2RlOiByZXNwb25zZUNvbnRleHQuc3RhdHVzQ29kZSxcbiAgICAgICAgICByZXNwb25zZVNpemU6IHJlc3BvbnNlQ29udGV4dC5yZXNwb25zZVNpemVcbiAgICAgICAgfSA6IHt9KVxuICAgICAgfSxcbiAgICAgIGNvbnRleHQ6IHtcbiAgICAgICAgY29ycmVsYXRpb246IGF1ZGl0Q29udGV4dC5jb3JyZWxhdGlvbixcbiAgICAgICAgLi4uKHJlc3BvbnNlQ29udGV4dCAmJiB7IHJlc3BvbnNlOiByZXNwb25zZUNvbnRleHQgfSlcbiAgICAgIH0sXG4gICAgICBtZXRhZGF0YTogYXVkaXRDb250ZXh0LmF1ZGl0Q29uZmlnLmN1c3RvbUNvbnRleHQsXG4gICAgICB0dGw6IGF1ZGl0Q29udGV4dC5hdWRpdENvbmZpZy50dGwsXG4gICAgICBkYXRhUHJvdGVjdGlvbjogYXVkaXRDb250ZXh0LmF1ZGl0Q29uZmlnLmRhdGFQcm90ZWN0aW9uLFxuICAgICAgZGF0YTogeyBlcnJvciB9XG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==