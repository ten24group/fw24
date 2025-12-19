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
        // Pass entire options - buildCommonFields extracts only the fields it needs
        const fields = (0, base_1.buildCommonFields)(OBSERVER_NAME, options);
        return (0, base_1.captureEvent)(fields, {
            type: 'audit',
            subType: options.subType,
            level: options.level ?? 'info',
            operation: options.operation,
            entityName: options.entityName,
            entityId: options.entityId,
            data: options.data,
            metrics: options.metrics,
            attributes: options.attributes,
            tags: { ...fields.tags, audit: 'true' },
        });
    }
    /**
     * Record compliance audit (PII access, data export, etc.)
     *
     * @param options.metadata - Flexible metadata for compliance info (reason, justification, etc.)
     */
    static compliance(options) {
        const fields = (0, base_1.buildCommonFields)(OBSERVER_NAME, options);
        // Compliance events are critical - must not be sampled out
        return (0, base_1.captureEvent)(fields, {
            type: 'audit.compliance',
            subType: options.subType,
            level: 'info',
            operation: options.operation,
            entityName: options.entityName,
            entityId: options.entityId,
            data: options.data,
            metrics: options.metrics,
            attributes: options.attributes,
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
        const fields = (0, base_1.buildCommonFields)(OBSERVER_NAME, options);
        return (0, base_1.captureEventAsync)(fields, {
            type: 'audit.compliance',
            subType: options.subType,
            level: 'info',
            operation: options.operation,
            entityName: options.entityName,
            entityId: options.entityId,
            data: options.data,
            metrics: options.metrics,
            attributes: options.attributes,
            tags: { ...fields.tags, audit: 'true', compliance: 'true' },
        }, { critical: true });
    }
    /**
     * Record access audit (for sensitive resources)
     */
    static access(options) {
        const fields = (0, base_1.buildCommonFields)(OBSERVER_NAME, options);
        return (0, base_1.captureEvent)(fields, {
            type: 'audit.access',
            subType: options.action,
            level: options.allowed ? 'info' : 'warn',
            operation: options.operation,
            entityName: options.resource,
            entityId: options.resourceId,
            success: options.allowed,
            data: options.data,
            metrics: options.metrics,
            attributes: options.attributes,
            tags: { ...fields.tags, audit: 'true', access: 'true' },
        });
    }
}
exports.AuditObserver = AuditObserver;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXVkaXQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9vYnNlcnZlcnMvYXVkaXQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0E4Qkc7OztBQUlILGlDQU9nQjtBQUVoQixNQUFNLGFBQWEsR0FBRyxlQUFlLENBQUM7QUF1Q3RDLE1BQWEsYUFBYTtJQUV4Qjs7T0FFRztJQUNILE1BQU0sQ0FBQyxZQUFZLENBQ2pCLFVBQWtCLEVBQ2xCLFFBQWdCLEVBQ2hCLElBQWEsRUFDYixHQUE2QztRQUU3QyxNQUFNLE9BQU8sR0FBRyxJQUFBLDZCQUFzQixFQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQzVDLE1BQU0sTUFBTSxHQUFHLElBQUEsd0JBQWlCLEVBQUMsYUFBYSxFQUFFLE9BQU8sQ0FBQyxDQUFDO1FBRXpELE9BQU8sSUFBQSxtQkFBWSxFQUFDLE1BQU0sRUFBRTtZQUMxQixJQUFJLEVBQUUsY0FBYztZQUNwQixPQUFPLEVBQUUsUUFBUTtZQUNqQixLQUFLLEVBQUUsTUFBTTtZQUNiLFNBQVMsRUFBRSxHQUFHLFVBQVUsU0FBUztZQUNqQyxVQUFVO1lBQ1YsUUFBUTtZQUNSLElBQUksRUFBRSxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUU7WUFDdkIsSUFBSSxFQUFFLEVBQUUsR0FBRyxNQUFNLENBQUMsSUFBSSxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsZUFBZSxFQUFFLFFBQVEsRUFBRTtTQUNuRSxDQUFDLENBQUM7SUFDTCxDQUFDO0lBRUQ7O09BRUc7SUFDSCxNQUFNLENBQUMsWUFBWSxDQUNqQixVQUFrQixFQUNsQixRQUFnQixFQUNoQixPQUE4RCxFQUM5RCxHQUE2QztRQUU3QyxNQUFNLE9BQU8sR0FBRyxJQUFBLDZCQUFzQixFQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQzVDLE1BQU0sTUFBTSxHQUFHLElBQUEsd0JBQWlCLEVB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Q3hCLElBQUksRUFBRSxPQUFPLENBQUMsSUFBSTtZQUNsQixPQUFPLEVBQUUsT0FBTyxDQUFDLE9BQU87WUFDeEIsVUFBVSxFQUFFLE9BQU8sQ0FBQyxVQUFVO1lBQzlCLElBQUksRUFBRSxFQUFFLEdBQUcsTUFBTSxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUU7U0FDeEQsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBN09ELHNDQTZPQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQXVkaXRPYnNlcnZlciAtIEZvciBlbnRpdHkgYW5kIGFjdGlvbiBhdWRpdGluZ1xuICogXG4gKiBERVNJR04gUFJJTkNJUExFUzpcbiAqIC0gUmVxdWlyZXMgY29ycmVsYXRpb25JZCBmcm9tIGNvbnRleHQgb3IgZXhwbGljaXQgb3B0aW9uXG4gKiAtIEludGVncmF0ZXMgd2l0aCBleGlzdGluZyBGVzI0IEFjdG9yIHR5cGVcbiAqIC0gU3VwcG9ydHMgZW50aXR5IGxpZmVjeWNsZSBhdWRpdHMgYW5kIGN1c3RvbSBhdWRpdHNcbiAqIC0gUmVwbGFjZXMgb2xkIGF1ZGl0IHN5c3RlbVxuICogXG4gKiBVc2FnZTpcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIEZJUlNUOiBFc3RhYmxpc2ggY29udGV4dFxuICogYXdhaXQgcnVuV2l0aENvbnRleHQoXG4gKiAgIGNyZWF0ZU9ic2VydmF0aW9uQ29udGV4dChyZXF1ZXN0SWQsIHsgYWN0b3IgfSksXG4gKiAgIGFzeW5jICgpID0+IHtcbiAqICAgICAvLyBFbnRpdHkgb3BlcmF0aW9uc1xuICogICAgIEF1ZGl0T2JzZXJ2ZXIuZW50aXR5Q3JlYXRlKCdVc2VyJywgdXNlcklkLCB1c2VyRGF0YSk7XG4gKiAgICAgQXVkaXRPYnNlcnZlci5lbnRpdHlVcGRhdGUoJ1VzZXInLCB1c2VySWQsIHsgYmVmb3JlLCBhZnRlciB9KTtcbiAqICAgICBBdWRpdE9ic2VydmVyLmVudGl0eURlbGV0ZSgnVXNlcicsIHVzZXJJZCk7XG4gKiAgICAgXG4gKiAgICAgLy8gQ3VzdG9tIGF1ZGl0c1xuICogICAgIEF1ZGl0T2JzZXJ2ZXIucmVjb3JkKHtcbiAqICAgICAgIG9wZXJhdGlvbjogJ3Blcm1pc3Npb24uZ3JhbnRlZCcsXG4gKiAgICAgICBlbnRpdHlOYW1lOiAnVXNlcicsXG4gKiAgICAgICBlbnRpdHlJZDogdXNlcklkLFxuICogICAgICAgZGF0YTogeyByb2xlOiAnYWRtaW4nIH0sXG4gKiAgICAgfSk7XG4gKiAgIH1cbiAqICk7XG4gKiBgYGBcbiAqL1xuXG5pbXBvcnQgeyBFeGVjdXRpb25Db250ZXh0IH0gZnJvbSAnLi4vLi4vY29yZS90eXBlcy9leGVjdXRpb24tY29udGV4dCc7XG5pbXBvcnQgeyBPYnNlcnZhYmlsaXR5TGV2ZWxTdHJpbmcgfSBmcm9tICcuLi90eXBlcyc7XG5pbXBvcnQge1xuICBidWlsZENvbW1vbkZpZWxkcyxcbiAgY2FwdHVyZUV2ZW50LFxuICBjYXB0dXJlRXZlbnRBc3luYyxcbiAgZXh0cmFjdE9ic2VydmVyT3B0aW9ucyxcbiAgQmFzZU9ic2VydmVyT3B0aW9ucyxcbiAgT2JzZXJ2YWJpbGl0eVBheWxvYWQsXG59IGZyb20gJy4vYmFzZSc7XG5cbmNvbnN0IE9CU0VSVkVSX05BTUUgPSAnQXVkaXRPYnNlcnZlcic7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQXVkaXRPYnNlcnZlck9wdGlvbnMgZXh0ZW5kcyBCYXNlT2JzZXJ2ZXJPcHRpb25zIHtcbiAgLy8gSW5oZXJpdHM6IGNvcnJlbGF0aW9uSWQsIGNhdXNlZEJ5LCByZWxhdGVkVHJhY2VzLCBhY3Rvciwgc291cmNlLCB0YWdzLCBtZXRhZGF0YVxufVxuXG4vKipcbiAqIE9wdGlvbnMgZm9yIGN1c3RvbSBhdWRpdCByZWNvcmRzXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQXVkaXRSZWNvcmRPcHRpb25zIGV4dGVuZHMgQmFzZU9ic2VydmVyT3B0aW9ucywgT2JzZXJ2YWJpbGl0eVBheWxvYWQge1xuICBvcGVyYXRpb246IHN0cmluZztcbiAgZW50aXR5TmFtZT86IHN0cmluZztcbiAgZW50aXR5SWQ/OiBzdHJpbmc7XG4gIHN1YlR5cGU/OiBzdHJpbmc7XG4gIGxldmVsPzogT2JzZXJ2YWJpbGl0eUxldmVsU3RyaW5nO1xufVxuXG4vKipcbiAqIE9wdGlvbnMgZm9yIGNvbXBsaWFuY2UgYXVkaXRzXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ29tcGxpYW5jZUF1ZGl0T3B0aW9ucyBleHRlbmRzIEJhc2VPYnNlcnZlck9wdGlvbnMsIE9ic2VydmFiaWxpdHlQYXlsb2FkIHtcbiAgb3BlcmF0aW9uOiBzdHJpbmc7XG4gIC8qKiBDb21wbGlhbmNlIGV2ZW50IHR5cGUgKi9cbiAgc3ViVHlwZTogJ3BpaV9hY2Nlc3MnIHwgJ2RhdGFfZXhwb3J0JyB8ICdjb25zZW50X2NoYW5nZScgfCAnZGF0YV9kZWxldGlvbicgfCBzdHJpbmc7XG4gIGVudGl0eU5hbWU/OiBzdHJpbmc7XG4gIGVudGl0eUlkPzogc3RyaW5nO1xufVxuXG4vKipcbiAqIE9wdGlvbnMgZm9yIGFjY2VzcyBhdWRpdHNcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBBY2Nlc3NBdWRpdE9wdGlvbnMgZXh0ZW5kcyBCYXNlT2JzZXJ2ZXJPcHRpb25zLCBPYnNlcnZhYmlsaXR5UGF5bG9hZCB7XG4gIG9wZXJhdGlvbjogc3RyaW5nO1xuICByZXNvdXJjZTogc3RyaW5nO1xuICByZXNvdXJjZUlkPzogc3RyaW5nO1xuICBhY3Rpb246ICd2aWV3JyB8ICdkb3dubG9hZCcgfCAnbW9kaWZ5JyB8ICdzaGFyZScgfCBzdHJpbmc7XG4gIGFsbG93ZWQ6IGJvb2xlYW47XG59XG5cbmV4cG9ydCBjbGFzcyBBdWRpdE9ic2VydmVyIHtcblxuICAvKipcbiAgICogUmVjb3JkIGVudGl0eSBjcmVhdGlvblxuICAgKi9cbiAgc3RhdGljIGVudGl0eUNyZWF0ZShcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmcsXG4gICAgZW50aXR5SWQ6IHN0cmluZyxcbiAgICBkYXRhOiB1bmtub3duLFxuICAgIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQgfCBBdWRpdE9ic2VydmVyT3B0aW9uc1xuICApOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IG9wdGlvbnMgPSBleHRyYWN0T2JzZXJ2ZXJPcHRpb25zKGN0eCk7XG4gICAgY29uc3QgZmllbGRzID0gYnVpbGRDb21tb25GaWVsZHMoT0JTRVJWRVJfTkFNRSwgb3B0aW9ucyk7XG5cbiAgICByZXR1cm4gY2FwdHVyZUV2ZW50KGZpZWxkcywge1xuICAgICAgdHlwZTogJ2F1ZGl0LmVudGl0eScsXG4gICAgICBzdWJUeXBlOiAnY3JlYXRlJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICBvcGVyYXRpb246IGAke2VudGl0eU5hbWV9LmNyZWF0ZWAsXG4gICAgICBlbnRpdHlOYW1lLFxuICAgICAgZW50aXR5SWQsXG4gICAgICBkYXRhOiB7IGNyZWF0ZWQ6IGRhdGEgfSxcbiAgICAgIHRhZ3M6IHsgLi4uZmllbGRzLnRhZ3MsIGF1ZGl0OiAndHJ1ZScsIGVudGl0eU9wZXJhdGlvbjogJ2NyZWF0ZScgfSxcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmQgZW50aXR5IHVwZGF0ZVxuICAgKi9cbiAgc3RhdGljIGVudGl0eVVwZGF0ZShcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmcsXG4gICAgZW50aXR5SWQ6IHN0cmluZyxcbiAgICBjaGFuZ2VzOiB7IGJlZm9yZT86IHVua25vd247IGFmdGVyPzogdW5rbm93bjsgZGlmZj86IHVua25vd24gfSxcbiAgICBjdHg/OiBFeGVjdXRpb25Db250ZXh0IHwgQXVkaXRPYnNlcnZlck9wdGlvbnNcbiAgKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBvcHRpb25zID0gZXh0cmFjdE9ic2VydmVyT3B0aW9ucyhjdHgpO1xuICAgIGNvbnN0IGZpZWxkcyA9IGJ1aWxkQ29tbW9uRmllbGRzKE9CU0VSVkVSX05BTUUsIG9wdGlvbnMpO1xuXG4gICAgcmV0dXJuIGNhcHR1cmVFdmVudChmaWVsZHMsIHtcbiAgICAgIHR5cGU6ICdhdWRpdC5lbnRpdHknLFxuICAgICAgc3ViVHlwZTogJ3VwZGF0ZScsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgb3BlcmF0aW9uOiBgJHtlbnRpdHlOYW1lfS51cGRhdGVgLFxuICAgICAgZW50aXR5TmFtZSxcbiAgICAgIGVudGl0eUlkLFxuICAgICAgZGF0YTogY2hhbmdlcyxcbiAgICAgIHRhZ3M6IHsgLi4uZmllbGRzLnRhZ3MsIGF1ZGl0OiAndHJ1ZScsIGVudGl0eU9wZXJhdGlvbjogJ3VwZGF0ZScgfSxcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmQgZW50aXR5IGRlbGV0aW9uXG4gICAqIFxuICAgKiBOb3RlOiBkZWxldGVkRGF0YSBjb21lcyBiZWZvcmUgY3R4IGZvciBjb25zaXN0ZW5jeSB3aXRoIGVudGl0eUNyZWF0ZS9lbnRpdHlVcGRhdGVcbiAgICovXG4gIHN0YXRpYyBlbnRpdHlEZWxldGUoXG4gICAgZW50aXR5TmFtZTogc3RyaW5nLFxuICAgIGVudGl0eUlkOiBzdHJpbmcsXG4gICAgZGVsZXRlZERhdGE/OiB1bmtub3duLFxuICAgIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQgfCBBdWRpdE9ic2VydmVyT3B0aW9uc1xuICApOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IG9wdGlvbnMgPSBleHRyYWN0T2JzZXJ2ZXJPcHRpb25zKGN0eCk7XG4gICAgY29uc3QgZmllbGRzID0gYnVpbGRDb21tb25GaWVsZHMoT0JTRVJWRVJfTkFNRSwgb3B0aW9ucyk7XG5cbiAgICAvLyBEZWxldGlvbnMgYXJlIGNyaXRpY2FsIC0gbXVzdCBub3QgYmUgc2FtcGxlZCBvdXRcbiAgICByZXR1cm4gY2FwdHVyZUV2ZW50KGZpZWxkcywge1xuICAgICAgdHlwZTogJ2F1ZGl0LmVudGl0eScsXG4gICAgICBzdWJUeXBlOiAnZGVsZXRlJyxcbiAgICAgIGxldmVsOiAnd2FybicsIC8vIERlbGV0aW9ucyBhcmUgbm90YWJsZVxuICAgICAgb3BlcmF0aW9uOiBgJHtlbnRpdHlOYW1lfS5kZWxldGVgLFxuICAgICAgZW50aXR5TmFtZSxcbiAgICAgIGVudGl0eUlkLFxuICAgICAgZGF0YTogZGVsZXRlZERhdGEgPyB7IGRlbGV0ZWQ6IGRlbGV0ZWREYXRhIH0gOiB1bmRlZmluZWQsXG4gICAgICB0YWdzOiB7IC4uLmZpZWxkcy50YWdzLCBhdWRpdDogJ3RydWUnLCBlbnRpdHlPcGVyYXRpb246ICdkZWxldGUnIH0sXG4gICAgfSwgeyBjcml0aWNhbDogdHJ1ZSB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmQgZW50aXR5IGRlbGV0aW9uIChhc3luYyB2ZXJzaW9uIC0gd2FpdHMgZm9yIGJhY2tlbmQgY29tcGxldGlvbilcbiAgICogXG4gICAqIFVzZSB3aGVuIHlvdSBuZWVkIHRvIGVuc3VyZSB0aGUgYXVkaXQgaXMgcGVyc2lzdGVkIGJlZm9yZSBjb250aW51aW5nLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGVudGl0eURlbGV0ZUFzeW5jKFxuICAgIGVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBlbnRpdHlJZDogc3RyaW5nLFxuICAgIGRlbGV0ZWREYXRhPzogdW5rbm93bixcbiAgICBjdHg/OiBFeGVjdXRpb25Db250ZXh0IHwgQXVkaXRPYnNlcnZlck9wdGlvbnNcbiAgKTogUHJvbWlzZTxzdHJpbmcgfCB1bmRlZmluZWQ+IHtcbiAgICBjb25zdCBvcHRpb25zID0gZXh0cmFjdE9ic2VydmVyT3B0aW9ucyhjdHgpO1xuICAgIGNvbnN0IGZpZWxkcyA9IGJ1aWxkQ29tbW9uRmllbGRzKE9CU0VSVkVSX05BTUUsIG9wdGlvbnMpO1xuXG4gICAgcmV0dXJuIGNhcHR1cmVFdmVudEFzeW5jKGZpZWxkcywge1xuICAgICAgdHlwZTogJ2F1ZGl0LmVudGl0eScsXG4gICAgICBzdWJUeXBlOiAnZGVsZXRlJyxcbiAgICAgIGxldmVsOiAnd2FybicsXG4gICAgICBvcGVyYXRpb246IGAke2VudGl0eU5hbWV9LmRlbGV0ZWAsXG4gICAgICBlbnRpdHlOYW1lLFxuICAgICAgZW50aXR5SWQsXG4gICAgICBkYXRhOiBkZWxldGVkRGF0YSA/IHsgZGVsZXRlZDogZGVsZXRlZERhdGEgfSA6IHVuZGVmaW5lZCxcbiAgICAgIHRhZ3M6IHsgLi4uZmllbGRzLnRhZ3MsIGF1ZGl0OiAndHJ1ZScsIGVudGl0eU9wZXJhdGlvbjogJ2RlbGV0ZScgfSxcbiAgICB9LCB7IGNyaXRpY2FsOiB0cnVlIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZCBlbnRpdHkgcmVhZCAoaGlnaCB2b2x1bWUgLSB1c2Ugc3BhcmluZ2x5KVxuICAgKi9cbiAgc3RhdGljIGVudGl0eVJlYWQoXG4gICAgZW50aXR5TmFtZTogc3RyaW5nLFxuICAgIGVudGl0eUlkOiBzdHJpbmcsXG4gICAgY3R4PzogRXhlY3V0aW9uQ29udGV4dCB8IEF1ZGl0T2JzZXJ2ZXJPcHRpb25zXG4gICk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3Qgb3B0aW9ucyA9IGV4dHJhY3RPYnNlcnZlck9wdGlvbnMoY3R4KTtcbiAgICBjb25zdCBmaWVsZHMgPSBidWlsZENvbW1vbkZpZWxkcyhPQlNFUlZFUl9OQU1FLCBvcHRpb25zKTtcblxuICAgIHJldHVybiBjYXB0dXJlRXZlbnQoZmllbGRzLCB7XG4gICAgICB0eXBlOiAnYXVkaXQuZW50aXR5JyxcbiAgICAgIHN1YlR5cGU6ICdyZWFkJyxcbiAgICAgIGxldmVsOiAnZGVidWcnLCAvLyBMb3dlciBsZXZlbCAtIGhpZ2ggdm9sdW1lLCBjYW4gYmUgc2FtcGxlZFxuICAgICAgb3BlcmF0aW9uOiBgJHtlbnRpdHlOYW1lfS5yZWFkYCxcbiAgICAgIGVudGl0eU5hbWUsXG4gICAgICBlbnRpdHlJZCxcbiAgICAgIHRhZ3M6IHsgLi4uZmllbGRzLnRhZ3MsIGF1ZGl0OiAndHJ1ZScsIGVudGl0eU9wZXJhdGlvbjogJ3JlYWQnIH0sXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkIGVudGl0eSBsaXN0L3F1ZXJ5IChoaWdoIHZvbHVtZSAtIHVzZSBzcGFyaW5nbHkpXG4gICAqL1xuICBzdGF0aWMgZW50aXR5TGlzdChcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmcsXG4gICAgcXVlcnk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+LFxuICAgIHJlc3VsdENvdW50OiBudW1iZXIsXG4gICAgY3R4PzogRXhlY3V0aW9uQ29udGV4dCB8IEF1ZGl0T2JzZXJ2ZXJPcHRpb25zXG4gICk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3Qgb3B0aW9ucyA9IGV4dHJhY3RPYnNlcnZlck9wdGlvbnMoY3R4KTtcbiAgICBjb25zdCBmaWVsZHMgPSBidWlsZENvbW1vbkZpZWxkcyhPQlNFUlZFUl9OQU1FLCBvcHRpb25zKTtcblxuICAgIHJldHVybiBjYXB0dXJlRXZlbnQoZmllbGRzLCB7XG4gICAgICB0eXBlOiAnYXVkaXQuZW50aXR5JyxcbiAgICAgIHN1YlR5cGU6ICdsaXN0JyxcbiAgICAgIGxldmVsOiAnZGVidWcnLFxuICAgICAgb3BlcmF0aW9uOiBgJHtlbnRpdHlOYW1lfS5saXN0YCxcbiAgICAgIGVudGl0eU5hbWUsXG4gICAgICBkYXRhOiB7IHF1ZXJ5LCByZXN1bHRDb3VudCB9LFxuICAgICAgdGFnczogeyAuLi5maWVsZHMudGFncywgYXVkaXQ6ICd0cnVlJywgZW50aXR5T3BlcmF0aW9uOiAnbGlzdCcgfSxcbiAgICAgIG1ldHJpY3M6IHsgcmVzdWx0Q291bnQgfSxcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmQgY3VzdG9tIGF1ZGl0IGV2ZW50XG4gICAqL1xuICBzdGF0aWMgcmVjb3JkKG9wdGlvbnM6IEF1ZGl0UmVjb3JkT3B0aW9ucyk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgLy8gUGFzcyBlbnRpcmUgb3B0aW9ucyAtIGJ1aWxkQ29tbW9uRmllbGRzIGV4dHJhY3RzIG9ubHkgdGhlIGZpZWxkcyBpdCBuZWVkc1xuICAgIGNvbnN0IGZpZWxkcyA9IGJ1aWxkQ29tbW9uRmllbGRzKE9CU0VSVkVSX05BTUUsIG9wdGlvbnMpO1xuXG4gICAgcmV0dXJuIGNhcHR1cmVFdmVudChmaWVsZHMsIHtcbiAgICAgIHR5cGU6ICdhdWRpdCcsXG4gICAgICBzdWJUeXBlOiBvcHRpb25zLnN1YlR5cGUsXG4gICAgICBsZXZlbDogb3B0aW9ucy5sZXZlbCA/PyAnaW5mbycsXG4gICAgICBvcGVyYXRpb246IG9wdGlvbnMub3BlcmF0aW9uLFxuICAgICAgZW50aXR5TmFtZTogb3B0aW9ucy5lbnRpdHlOYW1lLFxuICAgICAgZW50aXR5SWQ6IG9wdGlvbnMuZW50aXR5SWQsXG4gICAgICBkYXRhOiBvcHRpb25zLmRhdGEsXG4gICAgICBtZXRyaWNzOiBvcHRpb25zLm1ldHJpY3MsXG4gICAgICBhdHRyaWJ1dGVzOiBvcHRpb25zLmF0dHJpYnV0ZXMsXG4gICAgICB0YWdzOiB7IC4uLmZpZWxkcy50YWdzLCBhdWRpdDogJ3RydWUnIH0sXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkIGNvbXBsaWFuY2UgYXVkaXQgKFBJSSBhY2Nlc3MsIGRhdGEgZXhwb3J0LCBldGMuKVxuICAgKiBcbiAgICogQHBhcmFtIG9wdGlvbnMubWV0YWRhdGEgLSBGbGV4aWJsZSBtZXRhZGF0YSBmb3IgY29tcGxpYW5jZSBpbmZvIChyZWFzb24sIGp1c3RpZmljYXRpb24sIGV0Yy4pXG4gICAqL1xuICBzdGF0aWMgY29tcGxpYW5jZShvcHRpb25zOiBDb21wbGlhbmNlQXVkaXRPcHRpb25zKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBmaWVsZHMgPSBidWlsZENvbW1vbkZpZWxkcyhPQlNFUlZFUl9OQU1FLCBvcHRpb25zKTtcblxuICAgIC8vIENvbXBsaWFuY2UgZXZlbnRzIGFyZSBjcml0aWNhbCAtIG11c3Qgbm90IGJlIHNhbXBsZWQgb3V0XG4gICAgcmV0dXJuIGNhcHR1cmVFdmVudChmaWVsZHMsIHtcbiAgICAgIHR5cGU6ICdhdWRpdC5jb21wbGlhbmNlJyxcbiAgICAgIHN1YlR5cGU6IG9wdGlvbnMuc3ViVHlwZSxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICBvcGVyYXRpb246IG9wdGlvbnMub3BlcmF0aW9uLFxuICAgICAgZW50aXR5TmFtZTogb3B0aW9ucy5lbnRpdHlOYW1lLFxuICAgICAgZW50aXR5SWQ6IG9wdGlvbnMuZW50aXR5SWQsXG4gICAgICBkYXRhOiBvcHRpb25zLmRhdGEsXG4gICAgICBtZXRyaWNzOiBvcHRpb25zLm1ldHJpY3MsXG4gICAgICBhdHRyaWJ1dGVzOiBvcHRpb25zLmF0dHJpYnV0ZXMsXG4gICAgICB0YWdzOiB7IC4uLmZpZWxkcy50YWdzLCBhdWRpdDogJ3RydWUnLCBjb21wbGlhbmNlOiAndHJ1ZScgfSxcbiAgICB9LCB7IGNyaXRpY2FsOiB0cnVlIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZCBjb21wbGlhbmNlIGF1ZGl0IChhc3luYyB2ZXJzaW9uIC0gd2FpdHMgZm9yIGJhY2tlbmQgY29tcGxldGlvbilcbiAgICogXG4gICAqIFVzZSB3aGVuIHlvdSBuZWVkIHRvIGVuc3VyZSB0aGUgYXVkaXQgaXMgcGVyc2lzdGVkIGJlZm9yZSBjb250aW51aW5nLlxuICAgKiBcbiAgICogQHBhcmFtIG9wdGlvbnMubWV0YWRhdGEgLSBGbGV4aWJsZSBtZXRhZGF0YSBmb3IgY29tcGxpYW5jZSBpbmZvIChyZWFzb24sIGp1c3RpZmljYXRpb24sIGV0Yy4pXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgY29tcGxpYW5jZUFzeW5jKG9wdGlvbnM6IENvbXBsaWFuY2VBdWRpdE9wdGlvbnMpOiBQcm9taXNlPHN0cmluZyB8IHVuZGVmaW5lZD4ge1xuICAgIGNvbnN0IGZpZWxkcyA9IGJ1aWxkQ29tbW9uRmllbGRzKE9CU0VSVkVSX05BTUUsIG9wdGlvbnMpO1xuXG4gICAgcmV0dXJuIGNhcHR1cmVFdmVudEFzeW5jKGZpZWxkcywge1xuICAgICAgdHlwZTogJ2F1ZGl0LmNvbXBsaWFuY2UnLFxuICAgICAgc3ViVHlwZTogb3B0aW9ucy5zdWJUeXBlLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIG9wZXJhdGlvbjogb3B0aW9ucy5vcGVyYXRpb24sXG4gICAgICBlbnRpdHlOYW1lOiBvcHRpb25zLmVudGl0eU5hbWUsXG4gICAgICBlbnRpdHlJZDogb3B0aW9ucy5lbnRpdHlJZCxcbiAgICAgIGRhdGE6IG9wdGlvbnMuZGF0YSxcbiAgICAgIG1ldHJpY3M6IG9wdGlvbnMubWV0cmljcyxcbiAgICAgIGF0dHJpYnV0ZXM6IG9wdGlvbnMuYXR0cmlidXRlcyxcbiAgICAgIHRhZ3M6IHsgLi4uZmllbGRzLnRhZ3MsIGF1ZGl0OiAndHJ1ZScsIGNvbXBsaWFuY2U6ICd0cnVlJyB9LFxuICAgIH0sIHsgY3JpdGljYWw6IHRydWUgfSk7XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkIGFjY2VzcyBhdWRpdCAoZm9yIHNlbnNpdGl2ZSByZXNvdXJjZXMpXG4gICAqL1xuICBzdGF0aWMgYWNjZXNzKG9wdGlvbnM6IEFjY2Vzc0F1ZGl0T3B0aW9ucyk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3QgZmllbGRzID0gYnVpbGRDb21tb25GaWVsZHMoT0JTRVJWRVJfTkFNRSwgb3B0aW9ucyk7XG5cbiAgICByZXR1cm4gY2FwdHVyZUV2ZW50KGZpZWxkcywge1xuICAgICAgdHlwZTogJ2F1ZGl0LmFjY2VzcycsXG4gICAgICBzdWJUeXBlOiBvcHRpb25zLmFjdGlvbixcbiAgICAgIGxldmVsOiBvcHRpb25zLmFsbG93ZWQgPyAnaW5mbycgOiAnd2FybicsXG4gICAgICBvcGVyYXRpb246IG9wdGlvbnMub3BlcmF0aW9uLFxuICAgICAgZW50aXR5TmFtZTogb3B0aW9ucy5yZXNvdXJjZSxcbiAgICAgIGVudGl0eUlkOiBvcHRpb25zLnJlc291cmNlSWQsXG4gICAgICBzdWNjZXNzOiBvcHRpb25zLmFsbG93ZWQsXG4gICAgICBkYXRhOiBvcHRpb25zLmRhdGEsXG4gICAgICBtZXRyaWNzOiBvcHRpb25zLm1ldHJpY3MsXG4gICAgICBhdHRyaWJ1dGVzOiBvcHRpb25zLmF0dHJpYnV0ZXMsXG4gICAgICB0YWdzOiB7IC4uLmZpZWxkcy50YWdzLCBhdWRpdDogJ3RydWUnLCBhY2Nlc3M6ICd0cnVlJyB9LFxuICAgIH0pO1xuICB9XG59XG4iXX0=