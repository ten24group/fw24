"use strict";
/**
 * AuditObserver - For entity and action auditing
 *
 * DESIGN PRINCIPLES:
 * - Requires correlationId from context or explicit option
 * - Integrates with existing FW24 Actor type
 * - Supports entity lifecycle audits and custom audits
 * - Replaces old audit system
 *
 * Usage:
 * ```typescript
 * // FIRST: Establish context
 * await runWithContext(
 *   createObservationContext(requestId, { actor }),
 *   async () => {
 *     // Entity operations
 *     AuditObserver.entityCreate('User', userId, userData);
 *     AuditObserver.entityUpdate('User', userId, { before, after });
 *     AuditObserver.entityDelete('User', userId);
 *
 *     // Custom audits
 *     AuditObserver.record({
 *       operation: 'permission.granted',
 *       entityName: 'User',
 *       entityId: userId,
 *       data: { role: 'admin' },
 *     });
 *   }
 * );
 * ```
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditObserver = void 0;
const base_1 = require("./base");
const OBSERVER_NAME = 'AuditObserver';
class AuditObserver {
    /**
     * Record entity creation
     */
    static entityCreate(entityName, entityId, data, ctx) {
        const options = (0, base_1.extractObserverOptions)(ctx);
        const fields = (0, base_1.buildCommonFields)(OBSERVER_NAME, options);
        if (!fields)
            return undefined;
        return (0, base_1.captureEvent)(fields, {
            type: 'audit.entity',
            subType: 'create',
            level: 'info',
            operation: `${entityName}.create`,
            entityName,
            entityId,
            data: { created: data },
            tags: { ...fields.tags, audit: 'true', entityOperation: 'create' },
        });
    }
    /**
     * Record entity update
     */
    static entityUpdate(entityName, entityId, changes, ctx) {
        const options = (0, base_1.extractObserverOptions)(ctx);
        const fields = (0, base_1.buildCommonFields)(OBSERVER_NAME, options);
        if (!fields)
            return undefined;
        return (0, base_1.captureEvent)(fields, {
            type: 'audit.entity',
            subType: 'update',
            level: 'info',
            operation: `${entityName}.update`,
            entityName,
            entityId,
            data: changes,
            tags: { ...fields.tags, audit: 'true', entityOperation: 'update' },
        });
    }
    /**
     * Record entity deletion
     *
     * Note: deletedData comes before ctx for consistency with entityCreate/entityUpdate
     */
    static entityDelete(entityName, entityId, deletedData, ctx) {
        const options = (0, base_1.extractObserverOptions)(ctx);
        const fields = (0, base_1.buildCommonFields)(OBSERVER_NAME, options);
        if (!fields)
            return undefined;
        // Deletions are critical - must not be sampled out
        return (0, base_1.captureEvent)(fields, {
            type: 'audit.entity',
            subType: 'delete',
            level: 'warn', // Deletions are notable
            operation: `${entityName}.delete`,
            entityName,
            entityId,
            data: deletedData ? { deleted: deletedData } : undefined,
            tags: { ...fields.tags, audit: 'true', entityOperation: 'delete' },
        }, { critical: true });
    }
    /**
     * Record entity deletion (async version - waits for backend completion)
     *
     * Use when you need to ensure the audit is persisted before continuing.
     */
    static async entityDeleteAsync(entityName, entityId, deletedData, ctx) {
        const options = (0, base_1.extractObserverOptions)(ctx);
        const fields = (0, base_1.buildCommonFields)(OBSERVER_NAME, options);
        if (!fields)
            return undefined;
        return (0, base_1.captureEventAsync)(fields, {
            type: 'audit.entity',
            subType: 'delete',
            level: 'warn',
            operation: `${entityName}.delete`,
            entityName,
            entityId,
            data: deletedData ? { deleted: deletedData } : undefined,
            tags: { ...fields.tags, audit: 'true', entityOperation: 'delete' },
        }, { critical: true });
    }
    /**
     * Record entity read (high volume - use sparingly)
     */
    static entityRead(entityName, entityId, ctx) {
        const options = (0, base_1.extractObserverOptions)(ctx);
        const fields = (0, base_1.buildCommonFields)(OBSERVER_NAME, options);
        if (!fields)
            return undefined;
        return (0, base_1.captureEvent)(fields, {
            type: 'audit.entity',
            subType: 'read',
            level: 'debug', // Lower level - high volume, can be sampled
            operation: `${entityName}.read`,
            entityName,
            entityId,
            tags: { ...fields.tags, audit: 'true', entityOperation: 'read' },
        });
    }
    /**
     * Record entity list/query (high volume - use sparingly)
     */
    static entityList(entityName, query, resultCount, ctx) {
        const options = (0, base_1.extractObserverOptions)(ctx);
        const fields = (0, base_1.buildCommonFields)(OBSERVER_NAME, options);
        if (!fields)
            return undefined;
        return (0, base_1.captureEvent)(fields, {
            type: 'audit.entity',
            subType: 'list',
            level: 'debug',
            operation: `${entityName}.list`,
            entityName,
            data: { query, resultCount },
            tags: { ...fields.tags, audit: 'true', entityOperation: 'list' },
            metrics: { resultCount },
        });
    }
    /**
     * Record custom audit event
     */
    static record(options) {
        const fields = (0, base_1.buildCommonFields)(OBSERVER_NAME, {
            correlationId: options.correlationId,
            actor: options.actor,
            source: options.source,
            tags: options.tags,
            metadata: options.metadata,
        });
        if (!fields)
            return undefined;
        return (0, base_1.captureEvent)(fields, {
            type: 'audit',
            subType: options.subType,
            level: options.level ?? 'info',
            operation: options.operation,
            entityName: options.entityName,
            entityId: options.entityId,
            data: options.data,
            tags: { ...fields.tags, audit: 'true' },
        });
    }
    /**
     * Record compliance audit (PII access, data export, etc.)
     *
     * @param options.metadata - Flexible metadata for compliance info (reason, justification, etc.)
     */
    static compliance(options) {
        const fields = (0, base_1.buildCommonFields)(OBSERVER_NAME, {
            actor: options.actor,
            tags: options.tags,
            metadata: options.metadata,
        });
        if (!fields)
            return undefined;
        // Compliance events are critical - must not be sampled out
        return (0, base_1.captureEvent)(fields, {
            type: 'audit.compliance',
            subType: options.subType,
            level: 'info',
            operation: options.operation,
            entityName: options.entityName,
            entityId: options.entityId,
            data: options.data,
            tags: { ...fields.tags, audit: 'true', compliance: 'true' },
        }, { critical: true });
    }
    /**
     * Record compliance audit (async version - waits for backend completion)
     *
     * Use when you need to ensure the audit is persisted before continuing.
     *
     * @param options.metadata - Flexible metadata for compliance info (reason, justification, etc.)
     */
    static async complianceAsync(options) {
        const fields = (0, base_1.buildCommonFields)(OBSERVER_NAME, {
            actor: options.actor,
            tags: options.tags,
            metadata: options.metadata,
        });
        if (!fields)
            return undefined;
        return (0, base_1.captureEventAsync)(fields, {
            type: 'audit.compliance',
            subType: options.subType,
            level: 'info',
            operation: options.operation,
            entityName: options.entityName,
            entityId: options.entityId,
            data: options.data,
            tags: { ...fields.tags, audit: 'true', compliance: 'true' },
        }, { critical: true });
    }
    /**
     * Record access audit (for sensitive resources)
     */
    static access(options) {
        const fields = (0, base_1.buildCommonFields)(OBSERVER_NAME, {
            actor: options.actor,
            tags: options.tags,
            metadata: options.metadata,
        });
        if (!fields)
            return undefined;
        return (0, base_1.captureEvent)(fields, {
            type: 'audit.access',
            subType: options.action,
            level: options.allowed ? 'info' : 'warn',
            operation: options.operation,
            entityName: options.resource,
            entityId: options.resourceId,
            success: options.allowed,
            data: options.data,
            tags: { ...fields.tags, audit: 'true', access: 'true' },
        });
    }
}
exports.AuditObserver = AuditObserver;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXVkaXQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9vYnNlcnZlcnMvYXVkaXQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0E4Qkc7OztBQUdILGlDQU1nQjtBQUVoQixNQUFNLGFBQWEsR0FBRyxlQUFlLENBQUM7QUFNdEMsTUFBYSxhQUFhO0lBRXhCOztPQUVHO0lBQ0gsTUFBTSxDQUFDLFlBQVksQ0FDakIsVUFBa0IsRUFDbEIsUUFBZ0IsRUFDaEIsSUFBYSxFQUNiLEdBQTZDO1FBRTdDLE1BQU0sT0FBTyxHQUFHLElBQUEsNkJBQXNCLEVBQUMsR0FBRyxDQUFDLENBQUM7UUFDNUMsTUFBTSxNQUFNLEdBQUcsSUFBQSx3QkFBaUIsRUFBQyxhQUFhLEVBQUUsT0FBTyxDQUFDLENBQUM7UUFDekQsSUFBSSxDQUFDLE1BQU07WUFBRSxPQUFPLFNBQVMsQ0FBQztRQUU5QixPQUFPLElBQUEsbUJBQVksRUFBQyxNQUFNLEVBQUU7WUFDMUIsSUFBSSxFQUFFLGNBQWM7WUFDcEIsT0FBTyxFQUFFLFFBQVE7WUFDakIsS0FBSyxFQUFFLE1BQU07WUFDYixTQUFTLEVBQUUsR0FBRyxVQUFVLFNBQVM7WUFDakMsVUFBVTtZQUNWLFFBQVE7WUFDUixJQUFJLEVBQUUsRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFO1lBQ3ZCLElBQUksRUFBRSxFQUFFLEdBQUcsTUFBTSxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLGVBQWUsRUFBRSxRQUFRLEVBQUU7U0FDbkUsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVEOztPQUVHO0lBQ0gsTUFBTSxDQUFDLFlBQVksQ0FDakIsVUFBa0IsRUFDbEIsUUFBZ0IsRUFDaEIsT0FBOEQsRUFDOUQsR0FBNkM7UUFFN0MsTUFBTSxPQUFPLEdBQUcsSUFBQSw2QkFBc0IsRUFBQyxHQUFHLENBQUMs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QU0sQ0FBQyxJQUFJLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSxVQUFVLEVBQUUsTUFBTSxFQUFFO1NBQzVELEVBQUUsRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQztJQUN6QixDQUFDO0lBRUQ7O09BRUc7SUFDSCxNQUFNLENBQUMsTUFBTSxDQUFDLE9BVWI7UUFDQyxNQUFNLE1BQU0sR0FBRyxJQUFBLHdCQUFpQixFQUFDLGFBQWEsRUFBRTtZQUM5QyxLQUFLLEVBQUUsT0FBTyxDQUFDLEtBQUs7WUFDcEIsSUFBSSxFQUFFLE9BQU8sQ0FBQyxJQUFJO1lBQ2xCLFFBQVEsRUFBRSxPQUFPLENBQUMsUUFBUTtTQUMzQixDQUFDLENBQUM7UUFDSCxJQUFJLENBQUMsTUFBTTtZQUFFLE9BQU8sU0FBUyxDQUFDO1FBRTlCLE9BQU8sSUFBQSxtQkFBWSxFQUFDLE1BQU0sRUFBRTtZQUMxQixJQUFJLEVBQUUsY0FBYztZQUNwQixPQUFPLEVBQUUsT0FBTyxDQUFDLE1BQU07WUFDdkIsS0FBSyxFQUFFLE9BQU8sQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsTUFBTTtZQUN4QyxTQUFTLEVBQUUsT0FBTyxDQUFDLFNBQVM7WUFDNUIsVUFBVSxFQUFFLE9BQU8sQ0FBQyxRQUFRO1lBQzVCLFFBQVEsRUFBRSxPQUFPLENBQUMsVUFBVTtZQUM1QixPQUFPLEVBQUUsT0FBTyxDQUFDLE9BQU87WUFDeEIsSUFBSSxFQUFFLE9BQU8sQ0FBQyxJQUFJO1lBQ2xCLElBQUksRUFBRSxFQUFFLEdBQUcsTUFBTSxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUU7U0FDeEQsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBNVNELHNDQTRTQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQXVkaXRPYnNlcnZlciAtIEZvciBlbnRpdHkgYW5kIGFjdGlvbiBhdWRpdGluZ1xuICogXG4gKiBERVNJR04gUFJJTkNJUExFUzpcbiAqIC0gUmVxdWlyZXMgY29ycmVsYXRpb25JZCBmcm9tIGNvbnRleHQgb3IgZXhwbGljaXQgb3B0aW9uXG4gKiAtIEludGVncmF0ZXMgd2l0aCBleGlzdGluZyBGVzI0IEFjdG9yIHR5cGVcbiAqIC0gU3VwcG9ydHMgZW50aXR5IGxpZmVjeWNsZSBhdWRpdHMgYW5kIGN1c3RvbSBhdWRpdHNcbiAqIC0gUmVwbGFjZXMgb2xkIGF1ZGl0IHN5c3RlbVxuICogXG4gKiBVc2FnZTpcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIEZJUlNUOiBFc3RhYmxpc2ggY29udGV4dFxuICogYXdhaXQgcnVuV2l0aENvbnRleHQoXG4gKiAgIGNyZWF0ZU9ic2VydmF0aW9uQ29udGV4dChyZXF1ZXN0SWQsIHsgYWN0b3IgfSksXG4gKiAgIGFzeW5jICgpID0+IHtcbiAqICAgICAvLyBFbnRpdHkgb3BlcmF0aW9uc1xuICogICAgIEF1ZGl0T2JzZXJ2ZXIuZW50aXR5Q3JlYXRlKCdVc2VyJywgdXNlcklkLCB1c2VyRGF0YSk7XG4gKiAgICAgQXVkaXRPYnNlcnZlci5lbnRpdHlVcGRhdGUoJ1VzZXInLCB1c2VySWQsIHsgYmVmb3JlLCBhZnRlciB9KTtcbiAqICAgICBBdWRpdE9ic2VydmVyLmVudGl0eURlbGV0ZSgnVXNlcicsIHVzZXJJZCk7XG4gKiAgICAgXG4gKiAgICAgLy8gQ3VzdG9tIGF1ZGl0c1xuICogICAgIEF1ZGl0T2JzZXJ2ZXIucmVjb3JkKHtcbiAqICAgICAgIG9wZXJhdGlvbjogJ3Blcm1pc3Npb24uZ3JhbnRlZCcsXG4gKiAgICAgICBlbnRpdHlOYW1lOiAnVXNlcicsXG4gKiAgICAgICBlbnRpdHlJZDogdXNlcklkLFxuICogICAgICAgZGF0YTogeyByb2xlOiAnYWRtaW4nIH0sXG4gKiAgICAgfSk7XG4gKiAgIH1cbiAqICk7XG4gKiBgYGBcbiAqL1xuXG5pbXBvcnQgeyBBY3RvciwgRXhlY3V0aW9uQ29udGV4dCB9IGZyb20gJy4uLy4uL2NvcmUvdHlwZXMvZXhlY3V0aW9uLWNvbnRleHQnO1xuaW1wb3J0IHtcbiAgYnVpbGRDb21tb25GaWVsZHMsXG4gIGNhcHR1cmVFdmVudCxcbiAgY2FwdHVyZUV2ZW50QXN5bmMsXG4gIGV4dHJhY3RPYnNlcnZlck9wdGlvbnMsXG4gIEJhc2VPYnNlcnZlck9wdGlvbnMsXG59IGZyb20gJy4vYmFzZSc7XG5cbmNvbnN0IE9CU0VSVkVSX05BTUUgPSAnQXVkaXRPYnNlcnZlcic7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQXVkaXRPYnNlcnZlck9wdGlvbnMgZXh0ZW5kcyBCYXNlT2JzZXJ2ZXJPcHRpb25zIHtcbiAgLy8gSW5oZXJpdHM6IGNvcnJlbGF0aW9uSWQsIGFjdG9yLCBzb3VyY2UsIHRhZ3MsIG1ldGFkYXRhXG59XG5cbmV4cG9ydCBjbGFzcyBBdWRpdE9ic2VydmVyIHtcblxuICAvKipcbiAgICogUmVjb3JkIGVudGl0eSBjcmVhdGlvblxuICAgKi9cbiAgc3RhdGljIGVudGl0eUNyZWF0ZShcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmcsXG4gICAgZW50aXR5SWQ6IHN0cmluZyxcbiAgICBkYXRhOiB1bmtub3duLFxuICAgIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQgfCBBdWRpdE9ic2VydmVyT3B0aW9uc1xuICApOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IG9wdGlvbnMgPSBleHRyYWN0T2JzZXJ2ZXJPcHRpb25zKGN0eCk7XG4gICAgY29uc3QgZmllbGRzID0gYnVpbGRDb21tb25GaWVsZHMoT0JTRVJWRVJfTkFNRSwgb3B0aW9ucyk7XG4gICAgaWYgKCFmaWVsZHMpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgICByZXR1cm4gY2FwdHVyZUV2ZW50KGZpZWxkcywge1xuICAgICAgdHlwZTogJ2F1ZGl0LmVudGl0eScsXG4gICAgICBzdWJUeXBlOiAnY3JlYXRlJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICBvcGVyYXRpb246IGAke2VudGl0eU5hbWV9LmNyZWF0ZWAsXG4gICAgICBlbnRpdHlOYW1lLFxuICAgICAgZW50aXR5SWQsXG4gICAgICBkYXRhOiB7IGNyZWF0ZWQ6IGRhdGEgfSxcbiAgICAgIHRhZ3M6IHsgLi4uZmllbGRzLnRhZ3MsIGF1ZGl0OiAndHJ1ZScsIGVudGl0eU9wZXJhdGlvbjogJ2NyZWF0ZScgfSxcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmQgZW50aXR5IHVwZGF0ZVxuICAgKi9cbiAgc3RhdGljIGVudGl0eVVwZGF0ZShcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmcsXG4gICAgZW50aXR5SWQ6IHN0cmluZyxcbiAgICBjaGFuZ2VzOiB7IGJlZm9yZT86IHVua25vd247IGFmdGVyPzogdW5rbm93bjsgZGlmZj86IHVua25vd24gfSxcbiAgICBjdHg/OiBFeGVjdXRpb25Db250ZXh0IHwgQXVkaXRPYnNlcnZlck9wdGlvbnNcbiAgKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBvcHRpb25zID0gZXh0cmFjdE9ic2VydmVyT3B0aW9ucyhjdHgpO1xuICAgIGNvbnN0IGZpZWxkcyA9IGJ1aWxkQ29tbW9uRmllbGRzKE9CU0VSVkVSX05BTUUsIG9wdGlvbnMpO1xuICAgIGlmICghZmllbGRzKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gICAgcmV0dXJuIGNhcHR1cmVFdmVudChmaWVsZHMsIHtcbiAgICAgIHR5cGU6ICdhdWRpdC5lbnRpdHknLFxuICAgICAgc3ViVHlwZTogJ3VwZGF0ZScsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgb3BlcmF0aW9uOiBgJHtlbnRpdHlOYW1lfS51cGRhdGVgLFxuICAgICAgZW50aXR5TmFtZSxcbiAgICAgIGVudGl0eUlkLFxuICAgICAgZGF0YTogY2hhbmdlcyxcbiAgICAgIHRhZ3M6IHsgLi4uZmllbGRzLnRhZ3MsIGF1ZGl0OiAndHJ1ZScsIGVudGl0eU9wZXJhdGlvbjogJ3VwZGF0ZScgfSxcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmQgZW50aXR5IGRlbGV0aW9uXG4gICAqIFxuICAgKiBOb3RlOiBkZWxldGVkRGF0YSBjb21lcyBiZWZvcmUgY3R4IGZvciBjb25zaXN0ZW5jeSB3aXRoIGVudGl0eUNyZWF0ZS9lbnRpdHlVcGRhdGVcbiAgICovXG4gIHN0YXRpYyBlbnRpdHlEZWxldGUoXG4gICAgZW50aXR5TmFtZTogc3RyaW5nLFxuICAgIGVudGl0eUlkOiBzdHJpbmcsXG4gICAgZGVsZXRlZERhdGE/OiB1bmtub3duLFxuICAgIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQgfCBBdWRpdE9ic2VydmVyT3B0aW9uc1xuICApOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IG9wdGlvbnMgPSBleHRyYWN0T2JzZXJ2ZXJPcHRpb25zKGN0eCk7XG4gICAgY29uc3QgZmllbGRzID0gYnVpbGRDb21tb25GaWVsZHMoT0JTRVJWRVJfTkFNRSwgb3B0aW9ucyk7XG4gICAgaWYgKCFmaWVsZHMpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgICAvLyBEZWxldGlvbnMgYXJlIGNyaXRpY2FsIC0gbXVzdCBub3QgYmUgc2FtcGxlZCBvdXRcbiAgICByZXR1cm4gY2FwdHVyZUV2ZW50KGZpZWxkcywge1xuICAgICAgdHlwZTogJ2F1ZGl0LmVudGl0eScsXG4gICAgICBzdWJUeXBlOiAnZGVsZXRlJyxcbiAgICAgIGxldmVsOiAnd2FybicsIC8vIERlbGV0aW9ucyBhcmUgbm90YWJsZVxuICAgICAgb3BlcmF0aW9uOiBgJHtlbnRpdHlOYW1lfS5kZWxldGVgLFxuICAgICAgZW50aXR5TmFtZSxcbiAgICAgIGVudGl0eUlkLFxuICAgICAgZGF0YTogZGVsZXRlZERhdGEgPyB7IGRlbGV0ZWQ6IGRlbGV0ZWREYXRhIH0gOiB1bmRlZmluZWQsXG4gICAgICB0YWdzOiB7IC4uLmZpZWxkcy50YWdzLCBhdWRpdDogJ3RydWUnLCBlbnRpdHlPcGVyYXRpb246ICdkZWxldGUnIH0sXG4gICAgfSwgeyBjcml0aWNhbDogdHJ1ZSB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmQgZW50aXR5IGRlbGV0aW9uIChhc3luYyB2ZXJzaW9uIC0gd2FpdHMgZm9yIGJhY2tlbmQgY29tcGxldGlvbilcbiAgICogXG4gICAqIFVzZSB3aGVuIHlvdSBuZWVkIHRvIGVuc3VyZSB0aGUgYXVkaXQgaXMgcGVyc2lzdGVkIGJlZm9yZSBjb250aW51aW5nLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGVudGl0eURlbGV0ZUFzeW5jKFxuICAgIGVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBlbnRpdHlJZDogc3RyaW5nLFxuICAgIGRlbGV0ZWREYXRhPzogdW5rbm93bixcbiAgICBjdHg/OiBFeGVjdXRpb25Db250ZXh0IHwgQXVkaXRPYnNlcnZlck9wdGlvbnNcbiAgKTogUHJvbWlzZTxzdHJpbmcgfCB1bmRlZmluZWQ+IHtcbiAgICBjb25zdCBvcHRpb25zID0gZXh0cmFjdE9ic2VydmVyT3B0aW9ucyhjdHgpO1xuICAgIGNvbnN0IGZpZWxkcyA9IGJ1aWxkQ29tbW9uRmllbGRzKE9CU0VSVkVSX05BTUUsIG9wdGlvbnMpO1xuICAgIGlmICghZmllbGRzKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gICAgcmV0dXJuIGNhcHR1cmVFdmVudEFzeW5jKGZpZWxkcywge1xuICAgICAgdHlwZTogJ2F1ZGl0LmVudGl0eScsXG4gICAgICBzdWJUeXBlOiAnZGVsZXRlJyxcbiAgICAgIGxldmVsOiAnd2FybicsXG4gICAgICBvcGVyYXRpb246IGAke2VudGl0eU5hbWV9LmRlbGV0ZWAsXG4gICAgICBlbnRpdHlOYW1lLFxuICAgICAgZW50aXR5SWQsXG4gICAgICBkYXRhOiBkZWxldGVkRGF0YSA/IHsgZGVsZXRlZDogZGVsZXRlZERhdGEgfSA6IHVuZGVmaW5lZCxcbiAgICAgIHRhZ3M6IHsgLi4uZmllbGRzLnRhZ3MsIGF1ZGl0OiAndHJ1ZScsIGVudGl0eU9wZXJhdGlvbjogJ2RlbGV0ZScgfSxcbiAgICB9LCB7IGNyaXRpY2FsOiB0cnVlIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZCBlbnRpdHkgcmVhZCAoaGlnaCB2b2x1bWUgLSB1c2Ugc3BhcmluZ2x5KVxuICAgKi9cbiAgc3RhdGljIGVudGl0eVJlYWQoXG4gICAgZW50aXR5TmFtZTogc3RyaW5nLFxuICAgIGVudGl0eUlkOiBzdHJpbmcsXG4gICAgY3R4PzogRXhlY3V0aW9uQ29udGV4dCB8IEF1ZGl0T2JzZXJ2ZXJPcHRpb25zXG4gICk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3Qgb3B0aW9ucyA9IGV4dHJhY3RPYnNlcnZlck9wdGlvbnMoY3R4KTtcbiAgICBjb25zdCBmaWVsZHMgPSBidWlsZENvbW1vbkZpZWxkcyhPQlNFUlZFUl9OQU1FLCBvcHRpb25zKTtcbiAgICBpZiAoIWZpZWxkcykgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAgIHJldHVybiBjYXB0dXJlRXZlbnQoZmllbGRzLCB7XG4gICAgICB0eXBlOiAnYXVkaXQuZW50aXR5JyxcbiAgICAgIHN1YlR5cGU6ICdyZWFkJyxcbiAgICAgIGxldmVsOiAnZGVidWcnLCAvLyBMb3dlciBsZXZlbCAtIGhpZ2ggdm9sdW1lLCBjYW4gYmUgc2FtcGxlZFxuICAgICAgb3BlcmF0aW9uOiBgJHtlbnRpdHlOYW1lfS5yZWFkYCxcbiAgICAgIGVudGl0eU5hbWUsXG4gICAgICBlbnRpdHlJZCxcbiAgICAgIHRhZ3M6IHsgLi4uZmllbGRzLnRhZ3MsIGF1ZGl0OiAndHJ1ZScsIGVudGl0eU9wZXJhdGlvbjogJ3JlYWQnIH0sXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkIGVudGl0eSBsaXN0L3F1ZXJ5IChoaWdoIHZvbHVtZSAtIHVzZSBzcGFyaW5nbHkpXG4gICAqL1xuICBzdGF0aWMgZW50aXR5TGlzdChcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmcsXG4gICAgcXVlcnk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+LFxuICAgIHJlc3VsdENvdW50OiBudW1iZXIsXG4gICAgY3R4PzogRXhlY3V0aW9uQ29udGV4dCB8IEF1ZGl0T2JzZXJ2ZXJPcHRpb25zXG4gICk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3Qgb3B0aW9ucyA9IGV4dHJhY3RPYnNlcnZlck9wdGlvbnMoY3R4KTtcbiAgICBjb25zdCBmaWVsZHMgPSBidWlsZENvbW1vbkZpZWxkcyhPQlNFUlZFUl9OQU1FLCBvcHRpb25zKTtcbiAgICBpZiAoIWZpZWxkcykgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAgIHJldHVybiBjYXB0dXJlRXZlbnQoZmllbGRzLCB7XG4gICAgICB0eXBlOiAnYXVkaXQuZW50aXR5JyxcbiAgICAgIHN1YlR5cGU6ICdsaXN0JyxcbiAgICAgIGxldmVsOiAnZGVidWcnLFxuICAgICAgb3BlcmF0aW9uOiBgJHtlbnRpdHlOYW1lfS5saXN0YCxcbiAgICAgIGVudGl0eU5hbWUsXG4gICAgICBkYXRhOiB7IHF1ZXJ5LCByZXN1bHRDb3VudCB9LFxuICAgICAgdGFnczogeyAuLi5maWVsZHMudGFncywgYXVkaXQ6ICd0cnVlJywgZW50aXR5T3BlcmF0aW9uOiAnbGlzdCcgfSxcbiAgICAgIG1ldHJpY3M6IHsgcmVzdWx0Q291bnQgfSxcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmQgY3VzdG9tIGF1ZGl0IGV2ZW50XG4gICAqL1xuICBzdGF0aWMgcmVjb3JkKG9wdGlvbnM6IHtcbiAgICBvcGVyYXRpb246IHN0cmluZztcbiAgICBlbnRpdHlOYW1lPzogc3RyaW5nO1xuICAgIGVudGl0eUlkPzogc3RyaW5nO1xuICAgIHN1YlR5cGU/OiBzdHJpbmc7XG4gICAgZGF0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIGFjdG9yPzogQWN0b3I7XG4gICAgc291cmNlPzogc3RyaW5nO1xuICAgIHRhZ3M/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICAgIG1ldGFkYXRhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgY29ycmVsYXRpb25JZD86IHN0cmluZztcbiAgICBsZXZlbD86ICdpbmZvJyB8ICd3YXJuJyB8ICdlcnJvcic7XG4gIH0pOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IGZpZWxkcyA9IGJ1aWxkQ29tbW9uRmllbGRzKE9CU0VSVkVSX05BTUUsIHtcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IG9wdGlvbnMuY29ycmVsYXRpb25JZCxcbiAgICAgIGFjdG9yOiBvcHRpb25zLmFjdG9yLFxuICAgICAgc291cmNlOiBvcHRpb25zLnNvdXJjZSxcbiAgICAgIHRhZ3M6IG9wdGlvbnMudGFncyxcbiAgICAgIG1ldGFkYXRhOiBvcHRpb25zLm1ldGFkYXRhLFxuICAgIH0pO1xuICAgIGlmICghZmllbGRzKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gICAgcmV0dXJuIGNhcHR1cmVFdmVudChmaWVsZHMsIHtcbiAgICAgIHR5cGU6ICdhdWRpdCcsXG4gICAgICBzdWJUeXBlOiBvcHRpb25zLnN1YlR5cGUsXG4gICAgICBsZXZlbDogb3B0aW9ucy5sZXZlbCA/PyAnaW5mbycsXG4gICAgICBvcGVyYXRpb246IG9wdGlvbnMub3BlcmF0aW9uLFxuICAgICAgZW50aXR5TmFtZTogb3B0aW9ucy5lbnRpdHlOYW1lLFxuICAgICAgZW50aXR5SWQ6IG9wdGlvbnMuZW50aXR5SWQsXG4gICAgICBkYXRhOiBvcHRpb25zLmRhdGEsXG4gICAgICB0YWdzOiB7IC4uLmZpZWxkcy50YWdzLCBhdWRpdDogJ3RydWUnIH0sXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkIGNvbXBsaWFuY2UgYXVkaXQgKFBJSSBhY2Nlc3MsIGRhdGEgZXhwb3J0LCBldGMuKVxuICAgKiBcbiAgICogQHBhcmFtIG9wdGlvbnMubWV0YWRhdGEgLSBGbGV4aWJsZSBtZXRhZGF0YSBmb3IgY29tcGxpYW5jZSBpbmZvIChyZWFzb24sIGp1c3RpZmljYXRpb24sIGV0Yy4pXG4gICAqL1xuICBzdGF0aWMgY29tcGxpYW5jZShvcHRpb25zOiB7XG4gICAgb3BlcmF0aW9uOiBzdHJpbmc7XG4gICAgLyoqIENvbXBsaWFuY2UgZXZlbnQgdHlwZSAqL1xuICAgIHN1YlR5cGU6ICdwaWlfYWNjZXNzJyB8ICdkYXRhX2V4cG9ydCcgfCAnY29uc2VudF9jaGFuZ2UnIHwgJ2RhdGFfZGVsZXRpb24nO1xuICAgIGVudGl0eU5hbWU/OiBzdHJpbmc7XG4gICAgZW50aXR5SWQ/OiBzdHJpbmc7XG4gICAgZGF0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIGFjdG9yPzogQWN0b3I7XG4gICAgdGFncz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gICAgLyoqIENvbXBsaWFuY2UgbWV0YWRhdGEgLSBmbGV4aWJsZSBmb3IgYXBwLXNwZWNpZmljIHJlcXVpcmVtZW50cyAqL1xuICAgIG1ldGFkYXRhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIH0pOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IGZpZWxkcyA9IGJ1aWxkQ29tbW9uRmllbGRzKE9CU0VSVkVSX05BTUUsIHtcbiAgICAgIGFjdG9yOiBvcHRpb25zLmFjdG9yLFxuICAgICAgdGFnczogb3B0aW9ucy50YWdzLFxuICAgICAgbWV0YWRhdGE6IG9wdGlvbnMubWV0YWRhdGEsXG4gICAgfSk7XG4gICAgaWYgKCFmaWVsZHMpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgICAvLyBDb21wbGlhbmNlIGV2ZW50cyBhcmUgY3JpdGljYWwgLSBtdXN0IG5vdCBiZSBzYW1wbGVkIG91dFxuICAgIHJldHVybiBjYXB0dXJlRXZlbnQoZmllbGRzLCB7XG4gICAgICB0eXBlOiAnYXVkaXQuY29tcGxpYW5jZScsXG4gICAgICBzdWJUeXBlOiBvcHRpb25zLnN1YlR5cGUsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgb3BlcmF0aW9uOiBvcHRpb25zLm9wZXJhdGlvbixcbiAgICAgIGVudGl0eU5hbWU6IG9wdGlvbnMuZW50aXR5TmFtZSxcbiAgICAgIGVudGl0eUlkOiBvcHRpb25zLmVudGl0eUlkLFxuICAgICAgZGF0YTogb3B0aW9ucy5kYXRhLFxuICAgICAgdGFnczogeyAuLi5maWVsZHMudGFncywgYXVkaXQ6ICd0cnVlJywgY29tcGxpYW5jZTogJ3RydWUnIH0sXG4gICAgfSwgeyBjcml0aWNhbDogdHJ1ZSB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmQgY29tcGxpYW5jZSBhdWRpdCAoYXN5bmMgdmVyc2lvbiAtIHdhaXRzIGZvciBiYWNrZW5kIGNvbXBsZXRpb24pXG4gICAqIFxuICAgKiBVc2Ugd2hlbiB5b3UgbmVlZCB0byBlbnN1cmUgdGhlIGF1ZGl0IGlzIHBlcnNpc3RlZCBiZWZvcmUgY29udGludWluZy5cbiAgICogXG4gICAqIEBwYXJhbSBvcHRpb25zLm1ldGFkYXRhIC0gRmxleGlibGUgbWV0YWRhdGEgZm9yIGNvbXBsaWFuY2UgaW5mbyAocmVhc29uLCBqdXN0aWZpY2F0aW9uLCBldGMuKVxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGNvbXBsaWFuY2VBc3luYyhvcHRpb25zOiB7XG4gICAgb3BlcmF0aW9uOiBzdHJpbmc7XG4gICAgLyoqIENvbXBsaWFuY2UgZXZlbnQgdHlwZSAqL1xuICAgIHN1YlR5cGU6ICdwaWlfYWNjZXNzJyB8ICdkYXRhX2V4cG9ydCcgfCAnY29uc2VudF9jaGFuZ2UnIHwgJ2RhdGFfZGVsZXRpb24nO1xuICAgIGVudGl0eU5hbWU/OiBzdHJpbmc7XG4gICAgZW50aXR5SWQ/OiBzdHJpbmc7XG4gICAgZGF0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIGFjdG9yPzogQWN0b3I7XG4gICAgdGFncz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gICAgLyoqIENvbXBsaWFuY2UgbWV0YWRhdGEgLSBmbGV4aWJsZSBmb3IgYXBwLXNwZWNpZmljIHJlcXVpcmVtZW50cyAqL1xuICAgIG1ldGFkYXRhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIH0pOiBQcm9taXNlPHN0cmluZyB8IHVuZGVmaW5lZD4ge1xuICAgIGNvbnN0IGZpZWxkcyA9IGJ1aWxkQ29tbW9uRmllbGRzKE9CU0VSVkVSX05BTUUsIHtcbiAgICAgIGFjdG9yOiBvcHRpb25zLmFjdG9yLFxuICAgICAgdGFnczogb3B0aW9ucy50YWdzLFxuICAgICAgbWV0YWRhdGE6IG9wdGlvbnMubWV0YWRhdGEsXG4gICAgfSk7XG4gICAgaWYgKCFmaWVsZHMpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgICByZXR1cm4gY2FwdHVyZUV2ZW50QXN5bmMoZmllbGRzLCB7XG4gICAgICB0eXBlOiAnYXVkaXQuY29tcGxpYW5jZScsXG4gICAgICBzdWJUeXBlOiBvcHRpb25zLnN1YlR5cGUsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgb3BlcmF0aW9uOiBvcHRpb25zLm9wZXJhdGlvbixcbiAgICAgIGVudGl0eU5hbWU6IG9wdGlvbnMuZW50aXR5TmFtZSxcbiAgICAgIGVudGl0eUlkOiBvcHRpb25zLmVudGl0eUlkLFxuICAgICAgZGF0YTogb3B0aW9ucy5kYXRhLFxuICAgICAgdGFnczogeyAuLi5maWVsZHMudGFncywgYXVkaXQ6ICd0cnVlJywgY29tcGxpYW5jZTogJ3RydWUnIH0sXG4gICAgfSwgeyBjcml0aWNhbDogdHJ1ZSB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmQgYWNjZXNzIGF1ZGl0IChmb3Igc2Vuc2l0aXZlIHJlc291cmNlcylcbiAgICovXG4gIHN0YXRpYyBhY2Nlc3Mob3B0aW9uczoge1xuICAgIG9wZXJhdGlvbjogc3RyaW5nO1xuICAgIHJlc291cmNlOiBzdHJpbmc7XG4gICAgcmVzb3VyY2VJZD86IHN0cmluZztcbiAgICBhY3Rpb246ICd2aWV3JyB8ICdkb3dubG9hZCcgfCAnbW9kaWZ5JyB8ICdzaGFyZScgfCBzdHJpbmc7XG4gICAgYWxsb3dlZDogYm9vbGVhbjtcbiAgICBhY3Rvcj86IEFjdG9yO1xuICAgIHRhZ3M/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICAgIG1ldGFkYXRhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgZGF0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICB9KTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBmaWVsZHMgPSBidWlsZENvbW1vbkZpZWxkcyhPQlNFUlZFUl9OQU1FLCB7XG4gICAgICBhY3Rvcjogb3B0aW9ucy5hY3RvcixcbiAgICAgIHRhZ3M6IG9wdGlvbnMudGFncyxcbiAgICAgIG1ldGFkYXRhOiBvcHRpb25zLm1ldGFkYXRhLFxuICAgIH0pO1xuICAgIGlmICghZmllbGRzKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gICAgcmV0dXJuIGNhcHR1cmVFdmVudChmaWVsZHMsIHtcbiAgICAgIHR5cGU6ICdhdWRpdC5hY2Nlc3MnLFxuICAgICAgc3ViVHlwZTogb3B0aW9ucy5hY3Rpb24sXG4gICAgICBsZXZlbDogb3B0aW9ucy5hbGxvd2VkID8gJ2luZm8nIDogJ3dhcm4nLFxuICAgICAgb3BlcmF0aW9uOiBvcHRpb25zLm9wZXJhdGlvbixcbiAgICAgIGVudGl0eU5hbWU6IG9wdGlvbnMucmVzb3VyY2UsXG4gICAgICBlbnRpdHlJZDogb3B0aW9ucy5yZXNvdXJjZUlkLFxuICAgICAgc3VjY2Vzczogb3B0aW9ucy5hbGxvd2VkLFxuICAgICAgZGF0YTogb3B0aW9ucy5kYXRhLFxuICAgICAgdGFnczogeyAuLi5maWVsZHMudGFncywgYXVkaXQ6ICd0cnVlJywgYWNjZXNzOiAndHJ1ZScgfSxcbiAgICB9KTtcbiAgfVxufVxuIl19