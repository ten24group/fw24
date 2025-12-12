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
        const fields = (0, base_1.buildCommonFields)(OBSERVER_NAME, {
            correlationId: options.correlationId,
            actor: options.actor,
            source: options.source,
            tags: options.tags,
            metadata: options.metadata,
        });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXVkaXQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9vYnNlcnZlcnMvYXVkaXQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0E4Qkc7OztBQUdILGlDQU1nQjtBQUVoQixNQUFNLGFBQWEsR0FBRyxlQUFlLENBQUM7QUFNdEMsTUFBYSxhQUFhO0lBRXhCOztPQUVHO0lBQ0gsTUFBTSxDQUFDLFlBQVksQ0FDakIsVUFBa0IsRUFDbEIsUUFBZ0IsRUFDaEIsSUFBYSxFQUNiLEdBQTZDO1FBRTdDLE1BQU0sT0FBTyxHQUFHLElBQUEsNkJBQXNCLEVBQUMsR0FBRyxDQUFDLENBQUM7UUFDNUMsTUFBTSxNQUFNLEdBQUcsSUFBQSx3QkFBaUIsRUFBQyxhQUFhLEVBQUUsT0FBTyxDQUFDLENBQUM7UUFFekQsT0FBTyxJQUFBLG1CQUFZLEVBQUMsTUFBTSxFQUFFO1lBQzFCLElBQUksRUFBRSxjQUFjO1lBQ3BCLE9BQU8sRUFBRSxRQUFRO1lBQ2pCLEtBQUssRUFBRSxNQUFNO1lBQ2IsU0FBUyxFQUFFLEdBQUcsVUFBVSxTQUFTO1lBQ2pDLFVBQVU7WUFDVixRQUFRO1lBQ1IsSUFBSSxFQUFFLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRTtZQUN2QixJQUFJLEVBQUUsRUFBRSxHQUFHLE1BQU0sQ0FBQyxJQUFJLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSxlQUFlLEVBQUUsUUFBUSxFQUFFO1NBQ25FLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFRDs7T0FFRztJQUNILE1BQU0sQ0FBQyxZQUFZLENBQ2pCLFVBQWtCLEVBQ2xCLFFBQWdCLEVBQ2hCLE9BQThELEVBQzlELEdBQTZDO1FBRTdDLE1BQU0sT0FBTyxHQUFHLElBQUEsNkJBQXNCLEVBQUMsR0FBRyxDQUFDLENBQUM7UUFDNUMsTUFBTSxNQUFNLEdBQUcsSUFBQSx3QkFBaUIsRUFB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WUFDcEIsT0FBTyxFQUFFLE9BQU8sQ0FBQyxNQUFNO1lBQ3ZCLEtBQUssRUFBRSxPQUFPLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLE1BQU07WUFDeEMsU0FBUyxFQUFFLE9BQU8sQ0FBQyxTQUFTO1lBQzVCLFVBQVUsRUFBRSxPQUFPLENBQUMsUUFBUTtZQUM1QixRQUFRLEVBQUUsT0FBTyxDQUFDLFVBQVU7WUFDNUIsT0FBTyxFQUFFLE9BQU8sQ0FBQyxPQUFPO1lBQ3hCLElBQUksRUFBRSxPQUFPLENBQUMsSUFBSTtZQUNsQixJQUFJLEVBQUUsRUFBRSxHQUFHLE1BQU0sQ0FBQyxJQUFJLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFO1NBQ3hELENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQWxTRCxzQ0FrU0MiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEF1ZGl0T2JzZXJ2ZXIgLSBGb3IgZW50aXR5IGFuZCBhY3Rpb24gYXVkaXRpbmdcbiAqIFxuICogREVTSUdOIFBSSU5DSVBMRVM6XG4gKiAtIFJlcXVpcmVzIGNvcnJlbGF0aW9uSWQgZnJvbSBjb250ZXh0IG9yIGV4cGxpY2l0IG9wdGlvblxuICogLSBJbnRlZ3JhdGVzIHdpdGggZXhpc3RpbmcgRlcyNCBBY3RvciB0eXBlXG4gKiAtIFN1cHBvcnRzIGVudGl0eSBsaWZlY3ljbGUgYXVkaXRzIGFuZCBjdXN0b20gYXVkaXRzXG4gKiAtIFJlcGxhY2VzIG9sZCBhdWRpdCBzeXN0ZW1cbiAqIFxuICogVXNhZ2U6XG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBGSVJTVDogRXN0YWJsaXNoIGNvbnRleHRcbiAqIGF3YWl0IHJ1bldpdGhDb250ZXh0KFxuICogICBjcmVhdGVPYnNlcnZhdGlvbkNvbnRleHQocmVxdWVzdElkLCB7IGFjdG9yIH0pLFxuICogICBhc3luYyAoKSA9PiB7XG4gKiAgICAgLy8gRW50aXR5IG9wZXJhdGlvbnNcbiAqICAgICBBdWRpdE9ic2VydmVyLmVudGl0eUNyZWF0ZSgnVXNlcicsIHVzZXJJZCwgdXNlckRhdGEpO1xuICogICAgIEF1ZGl0T2JzZXJ2ZXIuZW50aXR5VXBkYXRlKCdVc2VyJywgdXNlcklkLCB7IGJlZm9yZSwgYWZ0ZXIgfSk7XG4gKiAgICAgQXVkaXRPYnNlcnZlci5lbnRpdHlEZWxldGUoJ1VzZXInLCB1c2VySWQpO1xuICogICAgIFxuICogICAgIC8vIEN1c3RvbSBhdWRpdHNcbiAqICAgICBBdWRpdE9ic2VydmVyLnJlY29yZCh7XG4gKiAgICAgICBvcGVyYXRpb246ICdwZXJtaXNzaW9uLmdyYW50ZWQnLFxuICogICAgICAgZW50aXR5TmFtZTogJ1VzZXInLFxuICogICAgICAgZW50aXR5SWQ6IHVzZXJJZCxcbiAqICAgICAgIGRhdGE6IHsgcm9sZTogJ2FkbWluJyB9LFxuICogICAgIH0pO1xuICogICB9XG4gKiApO1xuICogYGBgXG4gKi9cblxuaW1wb3J0IHsgQWN0b3IsIEV4ZWN1dGlvbkNvbnRleHQgfSBmcm9tICcuLi8uLi9jb3JlL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0JztcbmltcG9ydCB7XG4gIGJ1aWxkQ29tbW9uRmllbGRzLFxuICBjYXB0dXJlRXZlbnQsXG4gIGNhcHR1cmVFdmVudEFzeW5jLFxuICBleHRyYWN0T2JzZXJ2ZXJPcHRpb25zLFxuICBCYXNlT2JzZXJ2ZXJPcHRpb25zLFxufSBmcm9tICcuL2Jhc2UnO1xuXG5jb25zdCBPQlNFUlZFUl9OQU1FID0gJ0F1ZGl0T2JzZXJ2ZXInO1xuXG5leHBvcnQgaW50ZXJmYWNlIEF1ZGl0T2JzZXJ2ZXJPcHRpb25zIGV4dGVuZHMgQmFzZU9ic2VydmVyT3B0aW9ucyB7XG4gIC8vIEluaGVyaXRzOiBjb3JyZWxhdGlvbklkLCBhY3Rvciwgc291cmNlLCB0YWdzLCBtZXRhZGF0YVxufVxuXG5leHBvcnQgY2xhc3MgQXVkaXRPYnNlcnZlciB7XG5cbiAgLyoqXG4gICAqIFJlY29yZCBlbnRpdHkgY3JlYXRpb25cbiAgICovXG4gIHN0YXRpYyBlbnRpdHlDcmVhdGUoXG4gICAgZW50aXR5TmFtZTogc3RyaW5nLFxuICAgIGVudGl0eUlkOiBzdHJpbmcsXG4gICAgZGF0YTogdW5rbm93bixcbiAgICBjdHg/OiBFeGVjdXRpb25Db250ZXh0IHwgQXVkaXRPYnNlcnZlck9wdGlvbnNcbiAgKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBvcHRpb25zID0gZXh0cmFjdE9ic2VydmVyT3B0aW9ucyhjdHgpO1xuICAgIGNvbnN0IGZpZWxkcyA9IGJ1aWxkQ29tbW9uRmllbGRzKE9CU0VSVkVSX05BTUUsIG9wdGlvbnMpO1xuXG4gICAgcmV0dXJuIGNhcHR1cmVFdmVudChmaWVsZHMsIHtcbiAgICAgIHR5cGU6ICdhdWRpdC5lbnRpdHknLFxuICAgICAgc3ViVHlwZTogJ2NyZWF0ZScsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgb3BlcmF0aW9uOiBgJHtlbnRpdHlOYW1lfS5jcmVhdGVgLFxuICAgICAgZW50aXR5TmFtZSxcbiAgICAgIGVudGl0eUlkLFxuICAgICAgZGF0YTogeyBjcmVhdGVkOiBkYXRhIH0sXG4gICAgICB0YWdzOiB7IC4uLmZpZWxkcy50YWdzLCBhdWRpdDogJ3RydWUnLCBlbnRpdHlPcGVyYXRpb246ICdjcmVhdGUnIH0sXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkIGVudGl0eSB1cGRhdGVcbiAgICovXG4gIHN0YXRpYyBlbnRpdHlVcGRhdGUoXG4gICAgZW50aXR5TmFtZTogc3RyaW5nLFxuICAgIGVudGl0eUlkOiBzdHJpbmcsXG4gICAgY2hhbmdlczogeyBiZWZvcmU/OiB1bmtub3duOyBhZnRlcj86IHVua25vd247IGRpZmY/OiB1bmtub3duIH0sXG4gICAgY3R4PzogRXhlY3V0aW9uQ29udGV4dCB8IEF1ZGl0T2JzZXJ2ZXJPcHRpb25zXG4gICk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3Qgb3B0aW9ucyA9IGV4dHJhY3RPYnNlcnZlck9wdGlvbnMoY3R4KTtcbiAgICBjb25zdCBmaWVsZHMgPSBidWlsZENvbW1vbkZpZWxkcyhPQlNFUlZFUl9OQU1FLCBvcHRpb25zKTtcblxuICAgIHJldHVybiBjYXB0dXJlRXZlbnQoZmllbGRzLCB7XG4gICAgICB0eXBlOiAnYXVkaXQuZW50aXR5JyxcbiAgICAgIHN1YlR5cGU6ICd1cGRhdGUnLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIG9wZXJhdGlvbjogYCR7ZW50aXR5TmFtZX0udXBkYXRlYCxcbiAgICAgIGVudGl0eU5hbWUsXG4gICAgICBlbnRpdHlJZCxcbiAgICAgIGRhdGE6IGNoYW5nZXMsXG4gICAgICB0YWdzOiB7IC4uLmZpZWxkcy50YWdzLCBhdWRpdDogJ3RydWUnLCBlbnRpdHlPcGVyYXRpb246ICd1cGRhdGUnIH0sXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkIGVudGl0eSBkZWxldGlvblxuICAgKiBcbiAgICogTm90ZTogZGVsZXRlZERhdGEgY29tZXMgYmVmb3JlIGN0eCBmb3IgY29uc2lzdGVuY3kgd2l0aCBlbnRpdHlDcmVhdGUvZW50aXR5VXBkYXRlXG4gICAqL1xuICBzdGF0aWMgZW50aXR5RGVsZXRlKFxuICAgIGVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBlbnRpdHlJZDogc3RyaW5nLFxuICAgIGRlbGV0ZWREYXRhPzogdW5rbm93bixcbiAgICBjdHg/OiBFeGVjdXRpb25Db250ZXh0IHwgQXVkaXRPYnNlcnZlck9wdGlvbnNcbiAgKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBvcHRpb25zID0gZXh0cmFjdE9ic2VydmVyT3B0aW9ucyhjdHgpO1xuICAgIGNvbnN0IGZpZWxkcyA9IGJ1aWxkQ29tbW9uRmllbGRzKE9CU0VSVkVSX05BTUUsIG9wdGlvbnMpO1xuXG4gICAgLy8gRGVsZXRpb25zIGFyZSBjcml0aWNhbCAtIG11c3Qgbm90IGJlIHNhbXBsZWQgb3V0XG4gICAgcmV0dXJuIGNhcHR1cmVFdmVudChmaWVsZHMsIHtcbiAgICAgIHR5cGU6ICdhdWRpdC5lbnRpdHknLFxuICAgICAgc3ViVHlwZTogJ2RlbGV0ZScsXG4gICAgICBsZXZlbDogJ3dhcm4nLCAvLyBEZWxldGlvbnMgYXJlIG5vdGFibGVcbiAgICAgIG9wZXJhdGlvbjogYCR7ZW50aXR5TmFtZX0uZGVsZXRlYCxcbiAgICAgIGVudGl0eU5hbWUsXG4gICAgICBlbnRpdHlJZCxcbiAgICAgIGRhdGE6IGRlbGV0ZWREYXRhID8geyBkZWxldGVkOiBkZWxldGVkRGF0YSB9IDogdW5kZWZpbmVkLFxuICAgICAgdGFnczogeyAuLi5maWVsZHMudGFncywgYXVkaXQ6ICd0cnVlJywgZW50aXR5T3BlcmF0aW9uOiAnZGVsZXRlJyB9LFxuICAgIH0sIHsgY3JpdGljYWw6IHRydWUgfSk7XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkIGVudGl0eSBkZWxldGlvbiAoYXN5bmMgdmVyc2lvbiAtIHdhaXRzIGZvciBiYWNrZW5kIGNvbXBsZXRpb24pXG4gICAqIFxuICAgKiBVc2Ugd2hlbiB5b3UgbmVlZCB0byBlbnN1cmUgdGhlIGF1ZGl0IGlzIHBlcnNpc3RlZCBiZWZvcmUgY29udGludWluZy5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBlbnRpdHlEZWxldGVBc3luYyhcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmcsXG4gICAgZW50aXR5SWQ6IHN0cmluZyxcbiAgICBkZWxldGVkRGF0YT86IHVua25vd24sXG4gICAgY3R4PzogRXhlY3V0aW9uQ29udGV4dCB8IEF1ZGl0T2JzZXJ2ZXJPcHRpb25zXG4gICk6IFByb21pc2U8c3RyaW5nIHwgdW5kZWZpbmVkPiB7XG4gICAgY29uc3Qgb3B0aW9ucyA9IGV4dHJhY3RPYnNlcnZlck9wdGlvbnMoY3R4KTtcbiAgICBjb25zdCBmaWVsZHMgPSBidWlsZENvbW1vbkZpZWxkcyhPQlNFUlZFUl9OQU1FLCBvcHRpb25zKTtcblxuICAgIHJldHVybiBjYXB0dXJlRXZlbnRBc3luYyhmaWVsZHMsIHtcbiAgICAgIHR5cGU6ICdhdWRpdC5lbnRpdHknLFxuICAgICAgc3ViVHlwZTogJ2RlbGV0ZScsXG4gICAgICBsZXZlbDogJ3dhcm4nLFxuICAgICAgb3BlcmF0aW9uOiBgJHtlbnRpdHlOYW1lfS5kZWxldGVgLFxuICAgICAgZW50aXR5TmFtZSxcbiAgICAgIGVudGl0eUlkLFxuICAgICAgZGF0YTogZGVsZXRlZERhdGEgPyB7IGRlbGV0ZWQ6IGRlbGV0ZWREYXRhIH0gOiB1bmRlZmluZWQsXG4gICAgICB0YWdzOiB7IC4uLmZpZWxkcy50YWdzLCBhdWRpdDogJ3RydWUnLCBlbnRpdHlPcGVyYXRpb246ICdkZWxldGUnIH0sXG4gICAgfSwgeyBjcml0aWNhbDogdHJ1ZSB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmQgZW50aXR5IHJlYWQgKGhpZ2ggdm9sdW1lIC0gdXNlIHNwYXJpbmdseSlcbiAgICovXG4gIHN0YXRpYyBlbnRpdHlSZWFkKFxuICAgIGVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBlbnRpdHlJZDogc3RyaW5nLFxuICAgIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQgfCBBdWRpdE9ic2VydmVyT3B0aW9uc1xuICApOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IG9wdGlvbnMgPSBleHRyYWN0T2JzZXJ2ZXJPcHRpb25zKGN0eCk7XG4gICAgY29uc3QgZmllbGRzID0gYnVpbGRDb21tb25GaWVsZHMoT0JTRVJWRVJfTkFNRSwgb3B0aW9ucyk7XG5cbiAgICByZXR1cm4gY2FwdHVyZUV2ZW50KGZpZWxkcywge1xuICAgICAgdHlwZTogJ2F1ZGl0LmVudGl0eScsXG4gICAgICBzdWJUeXBlOiAncmVhZCcsXG4gICAgICBsZXZlbDogJ2RlYnVnJywgLy8gTG93ZXIgbGV2ZWwgLSBoaWdoIHZvbHVtZSwgY2FuIGJlIHNhbXBsZWRcbiAgICAgIG9wZXJhdGlvbjogYCR7ZW50aXR5TmFtZX0ucmVhZGAsXG4gICAgICBlbnRpdHlOYW1lLFxuICAgICAgZW50aXR5SWQsXG4gICAgICB0YWdzOiB7IC4uLmZpZWxkcy50YWdzLCBhdWRpdDogJ3RydWUnLCBlbnRpdHlPcGVyYXRpb246ICdyZWFkJyB9LFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZCBlbnRpdHkgbGlzdC9xdWVyeSAoaGlnaCB2b2x1bWUgLSB1c2Ugc3BhcmluZ2x5KVxuICAgKi9cbiAgc3RhdGljIGVudGl0eUxpc3QoXG4gICAgZW50aXR5TmFtZTogc3RyaW5nLFxuICAgIHF1ZXJ5OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPixcbiAgICByZXN1bHRDb3VudDogbnVtYmVyLFxuICAgIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQgfCBBdWRpdE9ic2VydmVyT3B0aW9uc1xuICApOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IG9wdGlvbnMgPSBleHRyYWN0T2JzZXJ2ZXJPcHRpb25zKGN0eCk7XG4gICAgY29uc3QgZmllbGRzID0gYnVpbGRDb21tb25GaWVsZHMoT0JTRVJWRVJfTkFNRSwgb3B0aW9ucyk7XG5cbiAgICByZXR1cm4gY2FwdHVyZUV2ZW50KGZpZWxkcywge1xuICAgICAgdHlwZTogJ2F1ZGl0LmVudGl0eScsXG4gICAgICBzdWJUeXBlOiAnbGlzdCcsXG4gICAgICBsZXZlbDogJ2RlYnVnJyxcbiAgICAgIG9wZXJhdGlvbjogYCR7ZW50aXR5TmFtZX0ubGlzdGAsXG4gICAgICBlbnRpdHlOYW1lLFxuICAgICAgZGF0YTogeyBxdWVyeSwgcmVzdWx0Q291bnQgfSxcbiAgICAgIHRhZ3M6IHsgLi4uZmllbGRzLnRhZ3MsIGF1ZGl0OiAndHJ1ZScsIGVudGl0eU9wZXJhdGlvbjogJ2xpc3QnIH0sXG4gICAgICBtZXRyaWNzOiB7IHJlc3VsdENvdW50IH0sXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkIGN1c3RvbSBhdWRpdCBldmVudFxuICAgKi9cbiAgc3RhdGljIHJlY29yZChvcHRpb25zOiB7XG4gICAgb3BlcmF0aW9uOiBzdHJpbmc7XG4gICAgZW50aXR5TmFtZT86IHN0cmluZztcbiAgICBlbnRpdHlJZD86IHN0cmluZztcbiAgICBzdWJUeXBlPzogc3RyaW5nO1xuICAgIGRhdGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICBhY3Rvcj86IEFjdG9yO1xuICAgIHNvdXJjZT86IHN0cmluZztcbiAgICB0YWdzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgICBtZXRhZGF0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIGNvcnJlbGF0aW9uSWQ/OiBzdHJpbmc7XG4gICAgbGV2ZWw/OiAnaW5mbycgfCAnd2FybicgfCAnZXJyb3InO1xuICB9KTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBmaWVsZHMgPSBidWlsZENvbW1vbkZpZWxkcyhPQlNFUlZFUl9OQU1FLCB7XG4gICAgICBjb3JyZWxhdGlvbklkOiBvcHRpb25zLmNvcnJlbGF0aW9uSWQsXG4gICAgICBhY3Rvcjogb3B0aW9ucy5hY3RvcixcbiAgICAgIHNvdXJjZTogb3B0aW9ucy5zb3VyY2UsXG4gICAgICB0YWdzOiBvcHRpb25zLnRhZ3MsXG4gICAgICBtZXRhZGF0YTogb3B0aW9ucy5tZXRhZGF0YSxcbiAgICB9KTtcblxuICAgIHJldHVybiBjYXB0dXJlRXZlbnQoZmllbGRzLCB7XG4gICAgICB0eXBlOiAnYXVkaXQnLFxuICAgICAgc3ViVHlwZTogb3B0aW9ucy5zdWJUeXBlLFxuICAgICAgbGV2ZWw6IG9wdGlvbnMubGV2ZWwgPz8gJ2luZm8nLFxuICAgICAgb3BlcmF0aW9uOiBvcHRpb25zLm9wZXJhdGlvbixcbiAgICAgIGVudGl0eU5hbWU6IG9wdGlvbnMuZW50aXR5TmFtZSxcbiAgICAgIGVudGl0eUlkOiBvcHRpb25zLmVudGl0eUlkLFxuICAgICAgZGF0YTogb3B0aW9ucy5kYXRhLFxuICAgICAgdGFnczogeyAuLi5maWVsZHMudGFncywgYXVkaXQ6ICd0cnVlJyB9LFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZCBjb21wbGlhbmNlIGF1ZGl0IChQSUkgYWNjZXNzLCBkYXRhIGV4cG9ydCwgZXRjLilcbiAgICogXG4gICAqIEBwYXJhbSBvcHRpb25zLm1ldGFkYXRhIC0gRmxleGlibGUgbWV0YWRhdGEgZm9yIGNvbXBsaWFuY2UgaW5mbyAocmVhc29uLCBqdXN0aWZpY2F0aW9uLCBldGMuKVxuICAgKi9cbiAgc3RhdGljIGNvbXBsaWFuY2Uob3B0aW9uczoge1xuICAgIG9wZXJhdGlvbjogc3RyaW5nO1xuICAgIC8qKiBDb21wbGlhbmNlIGV2ZW50IHR5cGUgKi9cbiAgICBzdWJUeXBlOiAncGlpX2FjY2VzcycgfCAnZGF0YV9leHBvcnQnIHwgJ2NvbnNlbnRfY2hhbmdlJyB8ICdkYXRhX2RlbGV0aW9uJztcbiAgICBlbnRpdHlOYW1lPzogc3RyaW5nO1xuICAgIGVudGl0eUlkPzogc3RyaW5nO1xuICAgIGRhdGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICBhY3Rvcj86IEFjdG9yO1xuICAgIHRhZ3M/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICAgIC8qKiBDb21wbGlhbmNlIG1ldGFkYXRhIC0gZmxleGlibGUgZm9yIGFwcC1zcGVjaWZpYyByZXF1aXJlbWVudHMgKi9cbiAgICBtZXRhZGF0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICB9KTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBmaWVsZHMgPSBidWlsZENvbW1vbkZpZWxkcyhPQlNFUlZFUl9OQU1FLCB7XG4gICAgICBhY3Rvcjogb3B0aW9ucy5hY3RvcixcbiAgICAgIHRhZ3M6IG9wdGlvbnMudGFncyxcbiAgICAgIG1ldGFkYXRhOiBvcHRpb25zLm1ldGFkYXRhLFxuICAgIH0pO1xuXG4gICAgLy8gQ29tcGxpYW5jZSBldmVudHMgYXJlIGNyaXRpY2FsIC0gbXVzdCBub3QgYmUgc2FtcGxlZCBvdXRcbiAgICByZXR1cm4gY2FwdHVyZUV2ZW50KGZpZWxkcywge1xuICAgICAgdHlwZTogJ2F1ZGl0LmNvbXBsaWFuY2UnLFxuICAgICAgc3ViVHlwZTogb3B0aW9ucy5zdWJUeXBlLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIG9wZXJhdGlvbjogb3B0aW9ucy5vcGVyYXRpb24sXG4gICAgICBlbnRpdHlOYW1lOiBvcHRpb25zLmVudGl0eU5hbWUsXG4gICAgICBlbnRpdHlJZDogb3B0aW9ucy5lbnRpdHlJZCxcbiAgICAgIGRhdGE6IG9wdGlvbnMuZGF0YSxcbiAgICAgIHRhZ3M6IHsgLi4uZmllbGRzLnRhZ3MsIGF1ZGl0OiAndHJ1ZScsIGNvbXBsaWFuY2U6ICd0cnVlJyB9LFxuICAgIH0sIHsgY3JpdGljYWw6IHRydWUgfSk7XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkIGNvbXBsaWFuY2UgYXVkaXQgKGFzeW5jIHZlcnNpb24gLSB3YWl0cyBmb3IgYmFja2VuZCBjb21wbGV0aW9uKVxuICAgKiBcbiAgICogVXNlIHdoZW4geW91IG5lZWQgdG8gZW5zdXJlIHRoZSBhdWRpdCBpcyBwZXJzaXN0ZWQgYmVmb3JlIGNvbnRpbnVpbmcuXG4gICAqIFxuICAgKiBAcGFyYW0gb3B0aW9ucy5tZXRhZGF0YSAtIEZsZXhpYmxlIG1ldGFkYXRhIGZvciBjb21wbGlhbmNlIGluZm8gKHJlYXNvbiwganVzdGlmaWNhdGlvbiwgZXRjLilcbiAgICovXG4gIHN0YXRpYyBhc3luYyBjb21wbGlhbmNlQXN5bmMob3B0aW9uczoge1xuICAgIG9wZXJhdGlvbjogc3RyaW5nO1xuICAgIC8qKiBDb21wbGlhbmNlIGV2ZW50IHR5cGUgKi9cbiAgICBzdWJUeXBlOiAncGlpX2FjY2VzcycgfCAnZGF0YV9leHBvcnQnIHwgJ2NvbnNlbnRfY2hhbmdlJyB8ICdkYXRhX2RlbGV0aW9uJztcbiAgICBlbnRpdHlOYW1lPzogc3RyaW5nO1xuICAgIGVudGl0eUlkPzogc3RyaW5nO1xuICAgIGRhdGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICBhY3Rvcj86IEFjdG9yO1xuICAgIHRhZ3M/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICAgIC8qKiBDb21wbGlhbmNlIG1ldGFkYXRhIC0gZmxleGlibGUgZm9yIGFwcC1zcGVjaWZpYyByZXF1aXJlbWVudHMgKi9cbiAgICBtZXRhZGF0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICB9KTogUHJvbWlzZTxzdHJpbmcgfCB1bmRlZmluZWQ+IHtcbiAgICBjb25zdCBmaWVsZHMgPSBidWlsZENvbW1vbkZpZWxkcyhPQlNFUlZFUl9OQU1FLCB7XG4gICAgICBhY3Rvcjogb3B0aW9ucy5hY3RvcixcbiAgICAgIHRhZ3M6IG9wdGlvbnMudGFncyxcbiAgICAgIG1ldGFkYXRhOiBvcHRpb25zLm1ldGFkYXRhLFxuICAgIH0pO1xuXG4gICAgcmV0dXJuIGNhcHR1cmVFdmVudEFzeW5jKGZpZWxkcywge1xuICAgICAgdHlwZTogJ2F1ZGl0LmNvbXBsaWFuY2UnLFxuICAgICAgc3ViVHlwZTogb3B0aW9ucy5zdWJUeXBlLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIG9wZXJhdGlvbjogb3B0aW9ucy5vcGVyYXRpb24sXG4gICAgICBlbnRpdHlOYW1lOiBvcHRpb25zLmVudGl0eU5hbWUsXG4gICAgICBlbnRpdHlJZDogb3B0aW9ucy5lbnRpdHlJZCxcbiAgICAgIGRhdGE6IG9wdGlvbnMuZGF0YSxcbiAgICAgIHRhZ3M6IHsgLi4uZmllbGRzLnRhZ3MsIGF1ZGl0OiAndHJ1ZScsIGNvbXBsaWFuY2U6ICd0cnVlJyB9LFxuICAgIH0sIHsgY3JpdGljYWw6IHRydWUgfSk7XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkIGFjY2VzcyBhdWRpdCAoZm9yIHNlbnNpdGl2ZSByZXNvdXJjZXMpXG4gICAqL1xuICBzdGF0aWMgYWNjZXNzKG9wdGlvbnM6IHtcbiAgICBvcGVyYXRpb246IHN0cmluZztcbiAgICByZXNvdXJjZTogc3RyaW5nO1xuICAgIHJlc291cmNlSWQ/OiBzdHJpbmc7XG4gICAgYWN0aW9uOiAndmlldycgfCAnZG93bmxvYWQnIHwgJ21vZGlmeScgfCAnc2hhcmUnIHwgc3RyaW5nO1xuICAgIGFsbG93ZWQ6IGJvb2xlYW47XG4gICAgYWN0b3I/OiBBY3RvcjtcbiAgICB0YWdzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgICBtZXRhZGF0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIGRhdGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgfSk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3QgZmllbGRzID0gYnVpbGRDb21tb25GaWVsZHMoT0JTRVJWRVJfTkFNRSwge1xuICAgICAgYWN0b3I6IG9wdGlvbnMuYWN0b3IsXG4gICAgICB0YWdzOiBvcHRpb25zLnRhZ3MsXG4gICAgICBtZXRhZGF0YTogb3B0aW9ucy5tZXRhZGF0YSxcbiAgICB9KTtcblxuICAgIHJldHVybiBjYXB0dXJlRXZlbnQoZmllbGRzLCB7XG4gICAgICB0eXBlOiAnYXVkaXQuYWNjZXNzJyxcbiAgICAgIHN1YlR5cGU6IG9wdGlvbnMuYWN0aW9uLFxuICAgICAgbGV2ZWw6IG9wdGlvbnMuYWxsb3dlZCA/ICdpbmZvJyA6ICd3YXJuJyxcbiAgICAgIG9wZXJhdGlvbjogb3B0aW9ucy5vcGVyYXRpb24sXG4gICAgICBlbnRpdHlOYW1lOiBvcHRpb25zLnJlc291cmNlLFxuICAgICAgZW50aXR5SWQ6IG9wdGlvbnMucmVzb3VyY2VJZCxcbiAgICAgIHN1Y2Nlc3M6IG9wdGlvbnMuYWxsb3dlZCxcbiAgICAgIGRhdGE6IG9wdGlvbnMuZGF0YSxcbiAgICAgIHRhZ3M6IHsgLi4uZmllbGRzLnRhZ3MsIGF1ZGl0OiAndHJ1ZScsIGFjY2VzczogJ3RydWUnIH0sXG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==