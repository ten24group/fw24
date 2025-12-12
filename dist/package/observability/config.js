"use strict";
/**
 * Observability Configuration
 *
 * Factory function for creating typed, validated observability config.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONFIG_DEFAULTS = exports.VALID_BACKENDS = void 0;
exports.createObservabilityConfig = createObservabilityConfig;
exports.validateConfig = validateConfig;
const types_1 = require("./types");
const data_protection_1 = require("./utils/data-protection");
/**
 * Valid backend types
 */
exports.VALID_BACKENDS = ['cloudwatch', 'dynamodb', 'otel'];
/**
 * Centralized configuration defaults
 */
exports.CONFIG_DEFAULTS = {
    serviceName: 'fw24-service',
    cloudwatchNamespace: 'FW24',
    // tableKey is the logical table name used to derive env var key
    // Env var: {tableKey}_table = actual CDK table name
    tableKey: 'observabilitylogs',
    ttlDays: 90,
    minLevel: types_1.ObservabilityLevel.INFO,
    enabled: false,
};
/**
 * Create a complete, validated ObservabilityConfig from partial input
 *
 * @param input - Partial config from application
 * @returns Complete ObservabilityConfig with defaults merged
 * @throws Error if validation fails
 *
 * @example
 * ```typescript
 * // In your app's di.ts:
 * import { DIContainer } from '@ten24group/fw24';
 * import { createObservabilityConfig } from '@ten24group/fw24/observability';
 *
 * DIContainer.ROOT.registerConfigProvider({
 *   provide: 'observability',
 *   useConfig: createObservabilityConfig({
 *     serviceName: 'my-app',
 *     backends: [{ type: 'cloudwatch' }, { type: 'dynamodb' }],
 *     // tableKey defaults to 'observabilitylogs'
 *   }),
 *   priority: 10
 * });
 * ```
 */
function createObservabilityConfig(input = {}) {
    const serviceName = input.serviceName ?? exports.CONFIG_DEFAULTS.serviceName;
    const defaultTableKey = exports.CONFIG_DEFAULTS.tableKey;
    // Build complete config with defaults
    const config = {
        enabled: input.enabled ?? exports.CONFIG_DEFAULTS.enabled,
        minLevel: input.minLevel ?? exports.CONFIG_DEFAULTS.minLevel,
        serviceName,
        backends: normalizeBackends(input.backends),
        sampling: {
            enabled: input.sampling?.enabled ?? false,
            rates: input.sampling?.rates,
            operations: input.sampling?.operations,
        },
        cloudwatch: {
            namespace: input.cloudwatch?.namespace ?? exports.CONFIG_DEFAULTS.cloudwatchNamespace,
        },
        dynamodb: {
            tableKey: input.dynamodb?.tableKey ?? defaultTableKey,
            ttlDays: input.dynamodb?.ttlDays ?? exports.CONFIG_DEFAULTS.ttlDays,
        },
        dataProtection: {
            enabled: input.dataProtection?.enabled ?? true,
            blacklistedKeys: input.dataProtection?.blacklistedKeys ?? data_protection_1.DEFAULT_BLACKLISTED_KEYS,
            fuzzyKeyMatch: input.dataProtection?.fuzzyKeyMatch ?? true,
            caseSensitiveKeyMatch: input.dataProtection?.caseSensitiveKeyMatch ?? false,
            replacement: input.dataProtection?.replacement ?? '[REDACTED]',
            fields: input.dataProtection?.fields ?? ['data', 'attributes', 'metadata', 'context'],
        },
        types: input.types,
    };
    // Validate
    const errors = validateConfig(config);
    if (errors.length > 0) {
        throw new Error(`Invalid observability config: ${errors.join(', ')}`);
    }
    return config;
}
/**
 * Normalize backends input to full BackendConfig array
 */
function normalizeBackends(input) {
    if (!input || input.length === 0) {
        return [{ type: 'cloudwatch', enabled: true }];
    }
    return input.map(b => ({
        type: b.type,
        enabled: b.enabled ?? true,
        minLevel: b.minLevel,
    }));
}
/**
 * Validate observability configuration
 * Returns array of validation errors (empty if valid)
 */
function validateConfig(config) {
    const errors = [];
    // Validate minLevel
    const validLevels = Object.values(types_1.ObservabilityLevel).filter((v) => typeof v === 'number');
    if (!validLevels.includes(config.minLevel)) {
        errors.push(`Invalid minLevel: ${config.minLevel}`);
    }
    // Validate sampling rates
    if (config.sampling?.enabled && config.sampling.rates) {
        Object.entries(config.sampling.rates).forEach(([level, rate]) => {
            if (typeof rate !== 'number' || rate < 0 || rate > 1) {
                errors.push(`Invalid sampling rate for ${level}: ${rate}. Must be between 0 and 1.`);
            }
        });
    }
    // Validate backend types
    config.backends?.forEach((backend, index) => {
        if (!exports.VALID_BACKENDS.includes(backend.type)) {
            errors.push(`Invalid backend type at index ${index}: ${backend.type}`);
        }
    });
    // Validate serviceName
    if (!config.serviceName || config.serviceName.trim() === '') {
        errors.push('serviceName is required and cannot be empty');
    }
    // Validate cloudwatch.namespace
    if (!config.cloudwatch?.namespace || config.cloudwatch.namespace.trim() === '') {
        errors.push('cloudwatch.namespace is required and cannot be empty');
    }
    // Validate dynamodb.tableKey
    if (!config.dynamodb?.tableKey || config.dynamodb.tableKey.trim() === '') {
        errors.push('dynamodb.tableKey is required and cannot be empty');
    }
    // Validate dynamodb.ttlDays
    if (config.dynamodb && (typeof config.dynamodb.ttlDays !== 'number' || config.dynamodb.ttlDays < 1)) {
        errors.push(`Invalid dynamodb.ttlDays: ${config.dynamodb.ttlDays}. Must be a positive number.`);
    }
    return errors;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29uZmlnLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvY29uZmlnLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7OztHQUlHOzs7QUEwRUgsOERBd0NDO0FBdUJELHdDQThDQztBQXJMRCxtQ0FNaUI7QUFDakIsNkRBQW1FO0FBRW5FOztHQUVHO0FBQ1UsUUFBQSxjQUFjLEdBQUcsQ0FBRSxZQUFZLEVBQUUsVUFBVSxFQUFFLE1BQU0sQ0FBVyxDQUFDO0FBRzVFOztHQUVHO0FBQ1UsUUFBQSxlQUFlLEdBQUc7SUFDN0IsV0FBVyxFQUFFLGNBQWM7SUFDM0IsbUJBQW1CLEVBQUUsTUFBTTtJQUMzQixnRUFBZ0U7SUFDaEUsb0RBQW9EO0lBQ3BELFFBQVEsRUFBRSxtQkFBbUI7SUFDN0IsT0FBTyxFQUFFLEVBQUU7SUFDWCxRQUFRLEVBQUUsMEJBQWtCLENBQUMsSUFBSTtJQUNqQyxPQUFPLEVBQUUsS0FBSztDQUNOLENBQUM7QUFxQlg7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBdUJHO0FBQ0gsU0FBZ0IseUJBQXlCLENBQUMsUUFBa0MsRUFBRTtJQUM1RSxNQUFNLFdBQVcsR0FBRyxLQUFLLENBQUMsV0FBVyxJQUFJLHVCQUFlLENBQUMsV0FBVyxDQUFDO0lBQ3JFLE1BQU0sZUFBZSxHQUFHLHVCQUFlLENBQUMsUUFBUSxDQUFDO0lBRWpELHNDQUFzQztJQUN0QyxNQUFNLE1BQU0sR0FBd0I7UUFDbEMsT0FBTyxFQUFFLEtBQUssQ0FBQyxPQUFPLElBQUksdUJBQWUsQ0FBQyxPQUFPO1FBQ2pELFFBQVEsRUFBRSxLQUFLLENBQUMsUUFBUSxJQUFJLHVCQUFlLENBQUMsUUFBUTtRQUNwRCxXQUFXO1FBQ1gsUUFBUSxFQUFFLGlCQUFpQixDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUM7UUFDM0MsUUFBUSxFQUFFO1lBQ1IsT0FBTyxFQUFFLEtBQUssQ0FBQyxRQUFRLEVBQUUsT0FBTyxJQUFJLEtBQUs7WUFDekMsS0FBSyxFQUFFLEtBQUssQ0FBQyxRQUFRLEVBQUUsS0FBSztZQUM1QixVQUFVLEVBQUUsS0FBSyxDQUFDLFFBQVEsRUFBRSxVQUFVO1NBQ3ZDO1FBQ0QsVUFBVSxFQUFFO1lBQ1YsU0FBUyxFQUFFLEtBQUssQ0FBQyxVQUFVLEVBQUUsU0FBUyxJQUFJLHVCQUFlLENBQUMsbUJBQW1CO1NBQzlFO1FBQ0QsUUFBUSxFQUFFO1lBQ1IsUUFBUSxFQUFFLEtBQUssQ0FBQyxRQUFRLEVBQUUsUUFBUSxJQUFJLGVBQWU7WUFDckQsT0FBTyxFQUFFLEtBQUssQ0FBQyxRQUFRLEVBQUUsT0FBTyxJQUFJLHVCQUFlLENBQUMsT0FBTztTQUM1RDtRQUNELGNBQWMsRUFBRTtZQUNkLE9BQU8sRUFBRSxLQUFLLENBQUMsY0FBYyxFQUFFLE9BQU8sSUFBSSxJQUFJO1lBQzlDLGVBQWUsRUFBRSxLQUFLLENBQUMsY0FBYyxFQUFFLGVBQWUsSUFBSSwwQ0FBd0I7WUFDbEYsYUFBYSxFQUFFLEtBQUssQ0FBQyxjQUFjLEVBQUUsYUFBYSxJQUFJLElBQUk7WUFDMUQscUJBQXFCLEVBQUUsS0FBSyxDQUFDLGNBQWMsRUFBRSxxQkFBcUIsSUFBSSxLQUFLO1lBQzNFLFdBQVcsRUFBRSxLQUFLLENBQUMsY0FBYyxFQUFFLFdBQVcsSUFBSSxZQUFZO1lBQzlELE1BQU0sRUFBRSxLQUFLLENBQUMsY0FBYyxFQUFFLE1BQU0sSUFBSSxDQUFFLE1BQU0sRUFBRSxZQUFZLEVBQUUsVUFBVSxFQUFFLFNBQVMsQ0FBRTtTQUN4RjtRQUNELEtBQUssRUFBRSxLQUFLLENBQUMsS0FBSztLQUNuQixDQUFDO0lBRUYsV0FBVztJQUNYLE1BQU0sTUFBTSxHQUFHLGNBQWMsQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUN0QyxJQUFJLE1BQU0sQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7UUFDdEIsTUFBTSxJQUFJLEtBQUssQ0FBQyxpQ0FBaUMsTUFBTSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUM7SUFDeEUsQ0FBQztJQUVELE9BQU8sTUFBTSxDQUFDO0FBQ2hCLENBQUM7QUFFRDs7R0FFRztBQUNILFNBQVMsaUJBQWlCLENBQ3hCLEtBQXVGO0lBRXZGLElBQUksQ0FBQyxLQUFLLElBQUksS0FBSyxDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUUsQ0FBQztRQUNqQyxPQUFPLENBQUUsRUFBRSxJQUFJLEVBQUUsWUFBWSxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUUsQ0FBRSxDQUFDO0lBQ25ELENBQUM7SUFFRCxPQUFPLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDO1FBQ3JCLElBQUksRUFBRSxDQUFDLENBQUMsSUFBSTtRQUNaLE9BQU8sRUFBRSxDQUFDLENBQUMsT0FBTyxJQUFJLElBQUk7UUFDMUIsUUFBUSxFQUFFLENBQUMsQ0FBQyxRQUFRO0tBQ3JCLENBQUMsQ0FBaUMsQ0FBQztBQUN0QyxDQUFDO0FBRUQ7OztHQUdHO0FBQ0gsU0FBZ0IsY0FBYyxDQUFDLE1BQTJCO0lBQ3hELE1BQU0sTUFBTSxHQUFhLEVBQUUsQ0FBQztJQUU1QixvQkFBb0I7SUFDcEIsTUFBTSxXQUFXLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQywwQkFBa0IsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsT0FBTyxDQUFDLEtBQUssUUFBUSxDQUFDLENBQUM7SUFDM0YsSUFBSSxDQUFDLFdBQVcsQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUM7UUFDM0MsTUFBTSxDQUFDLElBQUksQ0FBQyxxQkFBcUIsTUFBTSxDQUFDLFFBQVEsRUFBRSxDQUFDLENBQUM7SUFDdEQsQ0FBQztJQUVELDBCQUEwQjtJQUMxQixJQUFJLE1BQU0sQ0FBQyxRQUFRLEVBQUUsT0FBTyxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsS0FBSyxFQUFFLENBQUM7UUFDdEQsTUFBTSxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUUsS0FBSyxFQUFFLElBQUksQ0FBRSxFQUFFLEVBQUU7WUFDaEUsSUFBSSxPQUFPLElBQUksS0FBSyxRQUFRLElBQUksSUFBSSxHQUFHLENBQUMsSUFBSSxJQUFJLEdBQUcsQ0FBQyxFQUFFLENBQUM7Z0JBQ3JELE1BQU0sQ0FBQyxJQUFJLENBQUMsNkJBQTZCLEtBQUssS0FBSyxJQUFJLDRCQUE0QixDQUFDLENBQUM7WUFDdkYsQ0FBQztRQUNILENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVELHlCQUF5QjtJQUN6QixNQUFNLENBQUMsUUFBUSxFQUFFLE9BQU8sQ0FBQyxDQUFDLE9BQU8sRUFBRSxLQUFLLEVBQUUsRUFBRTtRQUMxQyxJQUFJLENBQUMsc0JBQWMsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLElBQW9CLENBQUMsRUFBRSxDQUFDO1lBQzNELE1BQU0sQ0FBQyxJQUFJLENBQUMsaUNBQWlDLEtBQUssS0FBSyxPQUFPLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQztRQUN6RSxDQUFDO0lBQ0gsQ0FBQyxDQUFDLENBQUM7SUFFSCx1QkFBdUI7SUFDdkIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxXQUFXLElBQUksTUFBTSxDQUFDLFdBQVcsQ0FBQyxJQUFJLEVBQUUsS0FBSyxFQUFFLEVBQUUsQ0FBQztRQUM1RCxNQUFNLENBQUMsSUFBSSxDQUFDLDZDQUE2QyxDQUFDLENBQUM7SUFDN0QsQ0FBQztJQUVELGdDQUFnQztJQUNoQyxJQUFJLENBQUMsTUFBTSxDQUFDLFVBQVUsRUFBRSxTQUFTLElBQUksTUFBTSxDQUFDLFVBQVUsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLEtBQUssRUFBRSxFQUFFLENBQUM7UUFDL0UsTUFBTSxDQUFDLElBQUksQ0FBQyxzREFBc0QsQ0FBQyxDQUFDO0lBQ3RFLENBQUM7SUFFRCw2QkFBNkI7SUFDN0IsSUFBSSxDQUFDLE1BQU0sQ0FBQyxRQUFRLEVBQUUsUUFBUSxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUUsRUFBRSxDQUFDO1FBQ3pFLE1BQU0sQ0FBQyxJQUFJLENBQUMsbURBQW1ELENBQUMsQ0FBQztJQUNuRSxDQUFDO0lBRUQsNEJBQTRCO0lBQzVCLElBQUksTUFBTSxDQUFDLFFBQVEsSUFBSSxDQUFDLE9BQU8sTUFBTSxDQUFDLFFBQVEsQ0FBQyxPQUFPLEtBQUssUUFBUSxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsT0FBTyxHQUFHLENBQUMsQ0FBQyxFQUFFLENBQUM7UUFDcEcsTUFBTSxDQUFDLElBQUksQ0FBQyw2QkFBNkIsTUFBTSxDQUFDLFFBQVEsQ0FBQyxPQUFPLDhCQUE4QixDQUFDLENBQUM7SUFDbEcsQ0FBQztJQUVELE9BQU8sTUFBTSxDQUFDO0FBQ2hCLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIE9ic2VydmFiaWxpdHkgQ29uZmlndXJhdGlvblxuICogXG4gKiBGYWN0b3J5IGZ1bmN0aW9uIGZvciBjcmVhdGluZyB0eXBlZCwgdmFsaWRhdGVkIG9ic2VydmFiaWxpdHkgY29uZmlnLlxuICovXG5cbmltcG9ydCB7XG4gIE9ic2VydmFiaWxpdHlDb25maWcsXG4gIE9ic2VydmFiaWxpdHlMZXZlbCxcbiAgT2JzZXJ2YWJpbGl0eUJhY2tlbmRDb25maWcsXG4gIFNhbXBsaW5nQ29uZmlnLFxuICBPYnNlcnZhYmlsaXR5RGF0YVByb3RlY3Rpb25Db25maWcsXG59IGZyb20gJy4vdHlwZXMnO1xuaW1wb3J0IHsgREVGQVVMVF9CTEFDS0xJU1RFRF9LRVlTIH0gZnJvbSAnLi91dGlscy9kYXRhLXByb3RlY3Rpb24nO1xuXG4vKipcbiAqIFZhbGlkIGJhY2tlbmQgdHlwZXNcbiAqL1xuZXhwb3J0IGNvbnN0IFZBTElEX0JBQ0tFTkRTID0gWyAnY2xvdWR3YXRjaCcsICdkeW5hbW9kYicsICdvdGVsJyBdIGFzIGNvbnN0O1xuZXhwb3J0IHR5cGUgVmFsaWRCYWNrZW5kID0gdHlwZW9mIFZBTElEX0JBQ0tFTkRTWyBudW1iZXIgXTtcblxuLyoqXG4gKiBDZW50cmFsaXplZCBjb25maWd1cmF0aW9uIGRlZmF1bHRzXG4gKi9cbmV4cG9ydCBjb25zdCBDT05GSUdfREVGQVVMVFMgPSB7XG4gIHNlcnZpY2VOYW1lOiAnZncyNC1zZXJ2aWNlJyxcbiAgY2xvdWR3YXRjaE5hbWVzcGFjZTogJ0ZXMjQnLFxuICAvLyB0YWJsZUtleSBpcyB0aGUgbG9naWNhbCB0YWJsZSBuYW1lIHVzZWQgdG8gZGVyaXZlIGVudiB2YXIga2V5XG4gIC8vIEVudiB2YXI6IHt0YWJsZUtleX1fdGFibGUgPSBhY3R1YWwgQ0RLIHRhYmxlIG5hbWVcbiAgdGFibGVLZXk6ICdvYnNlcnZhYmlsaXR5bG9ncycsXG4gIHR0bERheXM6IDkwLFxuICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLklORk8sXG4gIGVuYWJsZWQ6IGZhbHNlLFxufSBhcyBjb25zdDtcblxuLyoqXG4gKiBJbnB1dCB0eXBlIGZvciBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnIC0gYWxsIGZpZWxkcyBvcHRpb25hbFxuICovXG5leHBvcnQgaW50ZXJmYWNlIE9ic2VydmFiaWxpdHlDb25maWdJbnB1dCB7XG4gIGVuYWJsZWQ/OiBib29sZWFuO1xuICBtaW5MZXZlbD86IE9ic2VydmFiaWxpdHlMZXZlbDtcbiAgc2VydmljZU5hbWU/OiBzdHJpbmc7XG4gIGJhY2tlbmRzPzogQXJyYXk8eyB0eXBlOiBWYWxpZEJhY2tlbmQ7IGVuYWJsZWQ/OiBib29sZWFuOyBtaW5MZXZlbD86IE9ic2VydmFiaWxpdHlMZXZlbCB9PjtcbiAgc2FtcGxpbmc/OiBQYXJ0aWFsPFNhbXBsaW5nQ29uZmlnPjtcbiAgY2xvdWR3YXRjaD86IHsgbmFtZXNwYWNlPzogc3RyaW5nIH07XG4gIGR5bmFtb2RiPzoge1xuICAgIC8qKiBMb2dpY2FsIHRhYmxlIGtleSAtIHJlc29sdmVkIHRvIGFjdHVhbCB0YWJsZSBuYW1lIHZpYSBlbnYgdmFyIHt0YWJsZUtleX1fdGFibGUgKi9cbiAgICB0YWJsZUtleT86IHN0cmluZztcbiAgICB0dGxEYXlzPzogbnVtYmVyO1xuICB9O1xuICBkYXRhUHJvdGVjdGlvbj86IFBhcnRpYWw8T2JzZXJ2YWJpbGl0eURhdGFQcm90ZWN0aW9uQ29uZmlnPjtcbiAgdHlwZXM/OiBPYnNlcnZhYmlsaXR5Q29uZmlnWyAndHlwZXMnIF07XG59XG5cbi8qKlxuICogQ3JlYXRlIGEgY29tcGxldGUsIHZhbGlkYXRlZCBPYnNlcnZhYmlsaXR5Q29uZmlnIGZyb20gcGFydGlhbCBpbnB1dFxuICogXG4gKiBAcGFyYW0gaW5wdXQgLSBQYXJ0aWFsIGNvbmZpZyBmcm9tIGFwcGxpY2F0aW9uXG4gKiBAcmV0dXJucyBDb21wbGV0ZSBPYnNlcnZhYmlsaXR5Q29uZmlnIHdpdGggZGVmYXVsdHMgbWVyZ2VkXG4gKiBAdGhyb3dzIEVycm9yIGlmIHZhbGlkYXRpb24gZmFpbHNcbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIEluIHlvdXIgYXBwJ3MgZGkudHM6XG4gKiBpbXBvcnQgeyBESUNvbnRhaW5lciB9IGZyb20gJ0B0ZW4yNGdyb3VwL2Z3MjQnO1xuICogaW1wb3J0IHsgY3JlYXRlT2JzZXJ2YWJpbGl0eUNvbmZpZyB9IGZyb20gJ0B0ZW4yNGdyb3VwL2Z3MjQvb2JzZXJ2YWJpbGl0eSc7XG4gKiBcbiAqIERJQ29udGFpbmVyLlJPT1QucmVnaXN0ZXJDb25maWdQcm92aWRlcih7XG4gKiAgIHByb3ZpZGU6ICdvYnNlcnZhYmlsaXR5JyxcbiAqICAgdXNlQ29uZmlnOiBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnKHtcbiAqICAgICBzZXJ2aWNlTmFtZTogJ215LWFwcCcsXG4gKiAgICAgYmFja2VuZHM6IFt7IHR5cGU6ICdjbG91ZHdhdGNoJyB9LCB7IHR5cGU6ICdkeW5hbW9kYicgfV0sXG4gKiAgICAgLy8gdGFibGVLZXkgZGVmYXVsdHMgdG8gJ29ic2VydmFiaWxpdHlsb2dzJ1xuICogICB9KSxcbiAqICAgcHJpb3JpdHk6IDEwXG4gKiB9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlT2JzZXJ2YWJpbGl0eUNvbmZpZyhpbnB1dDogT2JzZXJ2YWJpbGl0eUNvbmZpZ0lucHV0ID0ge30pOiBPYnNlcnZhYmlsaXR5Q29uZmlnIHtcbiAgY29uc3Qgc2VydmljZU5hbWUgPSBpbnB1dC5zZXJ2aWNlTmFtZSA/PyBDT05GSUdfREVGQVVMVFMuc2VydmljZU5hbWU7XG4gIGNvbnN0IGRlZmF1bHRUYWJsZUtleSA9IENPTkZJR19ERUZBVUxUUy50YWJsZUtleTtcblxuICAvLyBCdWlsZCBjb21wbGV0ZSBjb25maWcgd2l0aCBkZWZhdWx0c1xuICBjb25zdCBjb25maWc6IE9ic2VydmFiaWxpdHlDb25maWcgPSB7XG4gICAgZW5hYmxlZDogaW5wdXQuZW5hYmxlZCA/PyBDT05GSUdfREVGQVVMVFMuZW5hYmxlZCxcbiAgICBtaW5MZXZlbDogaW5wdXQubWluTGV2ZWwgPz8gQ09ORklHX0RFRkFVTFRTLm1pbkxldmVsLFxuICAgIHNlcnZpY2VOYW1lLFxuICAgIGJhY2tlbmRzOiBub3JtYWxpemVCYWNrZW5kcyhpbnB1dC5iYWNrZW5kcyksXG4gICAgc2FtcGxpbmc6IHtcbiAgICAgIGVuYWJsZWQ6IGlucHV0LnNhbXBsaW5nPy5lbmFibGVkID8/IGZhbHNlLFxuICAgICAgcmF0ZXM6IGlucHV0LnNhbXBsaW5nPy5yYXRlcyxcbiAgICAgIG9wZXJhdGlvbnM6IGlucHV0LnNhbXBsaW5nPy5vcGVyYXRpb25zLFxuICAgIH0sXG4gICAgY2xvdWR3YXRjaDoge1xuICAgICAgbmFtZXNwYWNlOiBpbnB1dC5jbG91ZHdhdGNoPy5uYW1lc3BhY2UgPz8gQ09ORklHX0RFRkFVTFRTLmNsb3Vkd2F0Y2hOYW1lc3BhY2UsXG4gICAgfSxcbiAgICBkeW5hbW9kYjoge1xuICAgICAgdGFibGVLZXk6IGlucHV0LmR5bmFtb2RiPy50YWJsZUtleSA/PyBkZWZhdWx0VGFibGVLZXksXG4gICAgICB0dGxEYXlzOiBpbnB1dC5keW5hbW9kYj8udHRsRGF5cyA/PyBDT05GSUdfREVGQVVMVFMudHRsRGF5cyxcbiAgICB9LFxuICAgIGRhdGFQcm90ZWN0aW9uOiB7XG4gICAgICBlbmFibGVkOiBpbnB1dC5kYXRhUHJvdGVjdGlvbj8uZW5hYmxlZCA/PyB0cnVlLFxuICAgICAgYmxhY2tsaXN0ZWRLZXlzOiBpbnB1dC5kYXRhUHJvdGVjdGlvbj8uYmxhY2tsaXN0ZWRLZXlzID8/IERFRkFVTFRfQkxBQ0tMSVNURURfS0VZUyxcbiAgICAgIGZ1enp5S2V5TWF0Y2g6IGlucHV0LmRhdGFQcm90ZWN0aW9uPy5mdXp6eUtleU1hdGNoID8/IHRydWUsXG4gICAgICBjYXNlU2Vuc2l0aXZlS2V5TWF0Y2g6IGlucHV0LmRhdGFQcm90ZWN0aW9uPy5jYXNlU2Vuc2l0aXZlS2V5TWF0Y2ggPz8gZmFsc2UsXG4gICAgICByZXBsYWNlbWVudDogaW5wdXQuZGF0YVByb3RlY3Rpb24/LnJlcGxhY2VtZW50ID8/ICdbUkVEQUNURURdJyxcbiAgICAgIGZpZWxkczogaW5wdXQuZGF0YVByb3RlY3Rpb24/LmZpZWxkcyA/PyBbICdkYXRhJywgJ2F0dHJpYnV0ZXMnLCAnbWV0YWRhdGEnLCAnY29udGV4dCcgXSxcbiAgICB9LFxuICAgIHR5cGVzOiBpbnB1dC50eXBlcyxcbiAgfTtcblxuICAvLyBWYWxpZGF0ZVxuICBjb25zdCBlcnJvcnMgPSB2YWxpZGF0ZUNvbmZpZyhjb25maWcpO1xuICBpZiAoZXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgb2JzZXJ2YWJpbGl0eSBjb25maWc6ICR7ZXJyb3JzLmpvaW4oJywgJyl9YCk7XG4gIH1cblxuICByZXR1cm4gY29uZmlnO1xufVxuXG4vKipcbiAqIE5vcm1hbGl6ZSBiYWNrZW5kcyBpbnB1dCB0byBmdWxsIEJhY2tlbmRDb25maWcgYXJyYXlcbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplQmFja2VuZHMoXG4gIGlucHV0PzogQXJyYXk8eyB0eXBlOiBWYWxpZEJhY2tlbmQ7IGVuYWJsZWQ/OiBib29sZWFuOyBtaW5MZXZlbD86IE9ic2VydmFiaWxpdHlMZXZlbCB9PlxuKTogT2JzZXJ2YWJpbGl0eUJhY2tlbmRDb25maWdbXSB7XG4gIGlmICghaW5wdXQgfHwgaW5wdXQubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuIFsgeyB0eXBlOiAnY2xvdWR3YXRjaCcsIGVuYWJsZWQ6IHRydWUgfSBdO1xuICB9XG5cbiAgcmV0dXJuIGlucHV0Lm1hcChiID0+ICh7XG4gICAgdHlwZTogYi50eXBlLFxuICAgIGVuYWJsZWQ6IGIuZW5hYmxlZCA/PyB0cnVlLFxuICAgIG1pbkxldmVsOiBiLm1pbkxldmVsLFxuICB9KSkgYXMgT2JzZXJ2YWJpbGl0eUJhY2tlbmRDb25maWdbXTtcbn1cblxuLyoqXG4gKiBWYWxpZGF0ZSBvYnNlcnZhYmlsaXR5IGNvbmZpZ3VyYXRpb25cbiAqIFJldHVybnMgYXJyYXkgb2YgdmFsaWRhdGlvbiBlcnJvcnMgKGVtcHR5IGlmIHZhbGlkKVxuICovXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVDb25maWcoY29uZmlnOiBPYnNlcnZhYmlsaXR5Q29uZmlnKTogc3RyaW5nW10ge1xuICBjb25zdCBlcnJvcnM6IHN0cmluZ1tdID0gW107XG5cbiAgLy8gVmFsaWRhdGUgbWluTGV2ZWxcbiAgY29uc3QgdmFsaWRMZXZlbHMgPSBPYmplY3QudmFsdWVzKE9ic2VydmFiaWxpdHlMZXZlbCkuZmlsdGVyKCh2KSA9PiB0eXBlb2YgdiA9PT0gJ251bWJlcicpO1xuICBpZiAoIXZhbGlkTGV2ZWxzLmluY2x1ZGVzKGNvbmZpZy5taW5MZXZlbCkpIHtcbiAgICBlcnJvcnMucHVzaChgSW52YWxpZCBtaW5MZXZlbDogJHtjb25maWcubWluTGV2ZWx9YCk7XG4gIH1cblxuICAvLyBWYWxpZGF0ZSBzYW1wbGluZyByYXRlc1xuICBpZiAoY29uZmlnLnNhbXBsaW5nPy5lbmFibGVkICYmIGNvbmZpZy5zYW1wbGluZy5yYXRlcykge1xuICAgIE9iamVjdC5lbnRyaWVzKGNvbmZpZy5zYW1wbGluZy5yYXRlcykuZm9yRWFjaCgoWyBsZXZlbCwgcmF0ZSBdKSA9PiB7XG4gICAgICBpZiAodHlwZW9mIHJhdGUgIT09ICdudW1iZXInIHx8IHJhdGUgPCAwIHx8IHJhdGUgPiAxKSB7XG4gICAgICAgIGVycm9ycy5wdXNoKGBJbnZhbGlkIHNhbXBsaW5nIHJhdGUgZm9yICR7bGV2ZWx9OiAke3JhdGV9LiBNdXN0IGJlIGJldHdlZW4gMCBhbmQgMS5gKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIC8vIFZhbGlkYXRlIGJhY2tlbmQgdHlwZXNcbiAgY29uZmlnLmJhY2tlbmRzPy5mb3JFYWNoKChiYWNrZW5kLCBpbmRleCkgPT4ge1xuICAgIGlmICghVkFMSURfQkFDS0VORFMuaW5jbHVkZXMoYmFja2VuZC50eXBlIGFzIFZhbGlkQmFja2VuZCkpIHtcbiAgICAgIGVycm9ycy5wdXNoKGBJbnZhbGlkIGJhY2tlbmQgdHlwZSBhdCBpbmRleCAke2luZGV4fTogJHtiYWNrZW5kLnR5cGV9YCk7XG4gICAgfVxuICB9KTtcblxuICAvLyBWYWxpZGF0ZSBzZXJ2aWNlTmFtZVxuICBpZiAoIWNvbmZpZy5zZXJ2aWNlTmFtZSB8fCBjb25maWcuc2VydmljZU5hbWUudHJpbSgpID09PSAnJykge1xuICAgIGVycm9ycy5wdXNoKCdzZXJ2aWNlTmFtZSBpcyByZXF1aXJlZCBhbmQgY2Fubm90IGJlIGVtcHR5Jyk7XG4gIH1cblxuICAvLyBWYWxpZGF0ZSBjbG91ZHdhdGNoLm5hbWVzcGFjZVxuICBpZiAoIWNvbmZpZy5jbG91ZHdhdGNoPy5uYW1lc3BhY2UgfHwgY29uZmlnLmNsb3Vkd2F0Y2gubmFtZXNwYWNlLnRyaW0oKSA9PT0gJycpIHtcbiAgICBlcnJvcnMucHVzaCgnY2xvdWR3YXRjaC5uYW1lc3BhY2UgaXMgcmVxdWlyZWQgYW5kIGNhbm5vdCBiZSBlbXB0eScpO1xuICB9XG5cbiAgLy8gVmFsaWRhdGUgZHluYW1vZGIudGFibGVLZXlcbiAgaWYgKCFjb25maWcuZHluYW1vZGI/LnRhYmxlS2V5IHx8IGNvbmZpZy5keW5hbW9kYi50YWJsZUtleS50cmltKCkgPT09ICcnKSB7XG4gICAgZXJyb3JzLnB1c2goJ2R5bmFtb2RiLnRhYmxlS2V5IGlzIHJlcXVpcmVkIGFuZCBjYW5ub3QgYmUgZW1wdHknKTtcbiAgfVxuXG4gIC8vIFZhbGlkYXRlIGR5bmFtb2RiLnR0bERheXNcbiAgaWYgKGNvbmZpZy5keW5hbW9kYiAmJiAodHlwZW9mIGNvbmZpZy5keW5hbW9kYi50dGxEYXlzICE9PSAnbnVtYmVyJyB8fCBjb25maWcuZHluYW1vZGIudHRsRGF5cyA8IDEpKSB7XG4gICAgZXJyb3JzLnB1c2goYEludmFsaWQgZHluYW1vZGIudHRsRGF5czogJHtjb25maWcuZHluYW1vZGIudHRsRGF5c30uIE11c3QgYmUgYSBwb3NpdGl2ZSBudW1iZXIuYCk7XG4gIH1cblxuICByZXR1cm4gZXJyb3JzO1xufVxuIl19