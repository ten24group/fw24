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
    sourceMapEnabled: false,
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
        sourceMap: {
            enabled: input.sourceMap?.enabled ?? exports.CONFIG_DEFAULTS.sourceMapEnabled,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29uZmlnLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvY29uZmlnLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7OztHQUlHOzs7QUErRUgsOERBMkNDO0FBdUJELHdDQThDQztBQTdMRCxtQ0FNaUI7QUFDakIsNkRBQW1FO0FBRW5FOztHQUVHO0FBQ1UsUUFBQSxjQUFjLEdBQUcsQ0FBRSxZQUFZLEVBQUUsVUFBVSxFQUFFLE1BQU0sQ0FBVyxDQUFDO0FBRzVFOztHQUVHO0FBQ1UsUUFBQSxlQUFlLEdBQUc7SUFDN0IsV0FBVyxFQUFFLGNBQWM7SUFDM0IsbUJBQW1CLEVBQUUsTUFBTTtJQUMzQixnRUFBZ0U7SUFDaEUsb0RBQW9EO0lBQ3BELFFBQVEsRUFBRSxtQkFBbUI7SUFDN0IsT0FBTyxFQUFFLEVBQUU7SUFDWCxRQUFRLEVBQUUsMEJBQWtCLENBQUMsSUFBSTtJQUNqQyxPQUFPLEVBQUUsS0FBSztJQUNkLGdCQUFnQixFQUFFLEtBQUs7Q0FDZixDQUFDO0FBeUJYOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQXVCRztBQUNILFNBQWdCLHlCQUF5QixDQUFDLFFBQWtDLEVBQUU7SUFDNUUsTUFBTSxXQUFXLEdBQUcsS0FBSyxDQUFDLFdBQVcsSUFBSSx1QkFBZSxDQUFDLFdBQVcsQ0FBQztJQUNyRSxNQUFNLGVBQWUsR0FBRyx1QkFBZSxDQUFDLFFBQVEsQ0FBQztJQUVqRCxzQ0FBc0M7SUFDdEMsTUFBTSxNQUFNLEdBQXdCO1FBQ2xDLE9BQU8sRUFBRSxLQUFLLENBQUMsT0FBTyxJQUFJLHVCQUFlLENBQUMsT0FBTztRQUNqRCxRQUFRLEVBQUUsS0FBSyxDQUFDLFFBQVEsSUFBSSx1QkFBZSxDQUFDLFFBQVE7UUFDcEQsV0FBVztRQUNYLFFBQVEsRUFBRSxpQkFBaUIsQ0FBQyxLQUFLLENBQUMsUUFBUSxDQUFDO1FBQzNDLFFBQVEsRUFBRTtZQUNSLE9BQU8sRUFBRSxLQUFLLENB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QUMsc0RBQXNELENBQUMsQ0FBQztJQUN0RSxDQUFDO0lBRUQsNkJBQTZCO0lBQzdCLElBQUksQ0FBQyxNQUFNLENBQUMsUUFBUSxFQUFFLFFBQVEsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsS0FBSyxFQUFFLEVBQUUsQ0FBQztRQUN6RSxNQUFNLENBQUMsSUFBSSxDQUFDLG1EQUFtRCxDQUFDLENBQUM7SUFDbkUsQ0FBQztJQUVELDRCQUE0QjtJQUM1QixJQUFJLE1BQU0sQ0FBQyxRQUFRLElBQUksQ0FBQyxPQUFPLE1BQU0sQ0FBQyxRQUFRLENBQUMsT0FBTyxLQUFLLFFBQVEsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLE9BQU8sR0FBRyxDQUFDLENBQUMsRUFBRSxDQUFDO1FBQ3BHLE1BQU0sQ0FBQyxJQUFJLENBQUMsNkJBQTZCLE1BQU0sQ0FBQyxRQUFRLENBQUMsT0FBTyw4QkFBOEIsQ0FBQyxDQUFDO0lBQ2xHLENBQUM7SUFFRCxPQUFPLE1BQU0sQ0FBQztBQUNoQixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBPYnNlcnZhYmlsaXR5IENvbmZpZ3VyYXRpb25cbiAqIFxuICogRmFjdG9yeSBmdW5jdGlvbiBmb3IgY3JlYXRpbmcgdHlwZWQsIHZhbGlkYXRlZCBvYnNlcnZhYmlsaXR5IGNvbmZpZy5cbiAqL1xuXG5pbXBvcnQge1xuICBPYnNlcnZhYmlsaXR5Q29uZmlnLFxuICBPYnNlcnZhYmlsaXR5TGV2ZWwsXG4gIE9ic2VydmFiaWxpdHlCYWNrZW5kQ29uZmlnLFxuICBTYW1wbGluZ0NvbmZpZyxcbiAgT2JzZXJ2YWJpbGl0eURhdGFQcm90ZWN0aW9uQ29uZmlnLFxufSBmcm9tICcuL3R5cGVzJztcbmltcG9ydCB7IERFRkFVTFRfQkxBQ0tMSVNURURfS0VZUyB9IGZyb20gJy4vdXRpbHMvZGF0YS1wcm90ZWN0aW9uJztcblxuLyoqXG4gKiBWYWxpZCBiYWNrZW5kIHR5cGVzXG4gKi9cbmV4cG9ydCBjb25zdCBWQUxJRF9CQUNLRU5EUyA9IFsgJ2Nsb3Vkd2F0Y2gnLCAnZHluYW1vZGInLCAnb3RlbCcgXSBhcyBjb25zdDtcbmV4cG9ydCB0eXBlIFZhbGlkQmFja2VuZCA9IHR5cGVvZiBWQUxJRF9CQUNLRU5EU1sgbnVtYmVyIF07XG5cbi8qKlxuICogQ2VudHJhbGl6ZWQgY29uZmlndXJhdGlvbiBkZWZhdWx0c1xuICovXG5leHBvcnQgY29uc3QgQ09ORklHX0RFRkFVTFRTID0ge1xuICBzZXJ2aWNlTmFtZTogJ2Z3MjQtc2VydmljZScsXG4gIGNsb3Vkd2F0Y2hOYW1lc3BhY2U6ICdGVzI0JyxcbiAgLy8gdGFibGVLZXkgaXMgdGhlIGxvZ2ljYWwgdGFibGUgbmFtZSB1c2VkIHRvIGRlcml2ZSBlbnYgdmFyIGtleVxuICAvLyBFbnYgdmFyOiB7dGFibGVLZXl9X3RhYmxlID0gYWN0dWFsIENESyB0YWJsZSBuYW1lXG4gIHRhYmxlS2V5OiAnb2JzZXJ2YWJpbGl0eWxvZ3MnLFxuICB0dGxEYXlzOiA5MCxcbiAgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbC5JTkZPLFxuICBlbmFibGVkOiBmYWxzZSxcbiAgc291cmNlTWFwRW5hYmxlZDogZmFsc2UsXG59IGFzIGNvbnN0O1xuXG4vKipcbiAqIElucHV0IHR5cGUgZm9yIGNyZWF0ZU9ic2VydmFiaWxpdHlDb25maWcgLSBhbGwgZmllbGRzIG9wdGlvbmFsXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgT2JzZXJ2YWJpbGl0eUNvbmZpZ0lucHV0IHtcbiAgZW5hYmxlZD86IGJvb2xlYW47XG4gIG1pbkxldmVsPzogT2JzZXJ2YWJpbGl0eUxldmVsO1xuICBzZXJ2aWNlTmFtZT86IHN0cmluZztcbiAgYmFja2VuZHM/OiBBcnJheTx7IHR5cGU6IFZhbGlkQmFja2VuZDsgZW5hYmxlZD86IGJvb2xlYW47IG1pbkxldmVsPzogT2JzZXJ2YWJpbGl0eUxldmVsIH0+O1xuICBzYW1wbGluZz86IFBhcnRpYWw8U2FtcGxpbmdDb25maWc+O1xuICBjbG91ZHdhdGNoPzogeyBuYW1lc3BhY2U/OiBzdHJpbmcgfTtcbiAgZHluYW1vZGI/OiB7XG4gICAgLyoqIExvZ2ljYWwgdGFibGUga2V5IC0gcmVzb2x2ZWQgdG8gYWN0dWFsIHRhYmxlIG5hbWUgdmlhIGVudiB2YXIge3RhYmxlS2V5fV90YWJsZSAqL1xuICAgIHRhYmxlS2V5Pzogc3RyaW5nO1xuICAgIHR0bERheXM/OiBudW1iZXI7XG4gIH07XG4gIGRhdGFQcm90ZWN0aW9uPzogUGFydGlhbDxPYnNlcnZhYmlsaXR5RGF0YVByb3RlY3Rpb25Db25maWc+O1xuICB0eXBlcz86IE9ic2VydmFiaWxpdHlDb25maWdbICd0eXBlcycgXTtcbiAgc291cmNlTWFwPzoge1xuICAgIC8qKiBFbmFibGUgc291cmNlLW1hcC1zdXBwb3J0IGZvciBiZXR0ZXIgZXJyb3Igc3RhY2sgdHJhY2VzIChyZXF1aXJlcyBzb3VyY2UtbWFwLXN1cHBvcnQgcGFja2FnZSkgKi9cbiAgICBlbmFibGVkPzogYm9vbGVhbjtcbiAgfTtcbn1cblxuLyoqXG4gKiBDcmVhdGUgYSBjb21wbGV0ZSwgdmFsaWRhdGVkIE9ic2VydmFiaWxpdHlDb25maWcgZnJvbSBwYXJ0aWFsIGlucHV0XG4gKiBcbiAqIEBwYXJhbSBpbnB1dCAtIFBhcnRpYWwgY29uZmlnIGZyb20gYXBwbGljYXRpb25cbiAqIEByZXR1cm5zIENvbXBsZXRlIE9ic2VydmFiaWxpdHlDb25maWcgd2l0aCBkZWZhdWx0cyBtZXJnZWRcbiAqIEB0aHJvd3MgRXJyb3IgaWYgdmFsaWRhdGlvbiBmYWlsc1xuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gSW4geW91ciBhcHAncyBkaS50czpcbiAqIGltcG9ydCB7IERJQ29udGFpbmVyIH0gZnJvbSAnQHRlbjI0Z3JvdXAvZncyNCc7XG4gKiBpbXBvcnQgeyBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnIH0gZnJvbSAnQHRlbjI0Z3JvdXAvZncyNC9vYnNlcnZhYmlsaXR5JztcbiAqIFxuICogRElDb250YWluZXIuUk9PVC5yZWdpc3RlckNvbmZpZ1Byb3ZpZGVyKHtcbiAqICAgcHJvdmlkZTogJ29ic2VydmFiaWxpdHknLFxuICogICB1c2VDb25maWc6IGNyZWF0ZU9ic2VydmFiaWxpdHlDb25maWcoe1xuICogICAgIHNlcnZpY2VOYW1lOiAnbXktYXBwJyxcbiAqICAgICBiYWNrZW5kczogW3sgdHlwZTogJ2Nsb3Vkd2F0Y2gnIH0sIHsgdHlwZTogJ2R5bmFtb2RiJyB9XSxcbiAqICAgICAvLyB0YWJsZUtleSBkZWZhdWx0cyB0byAnb2JzZXJ2YWJpbGl0eWxvZ3MnXG4gKiAgIH0pLFxuICogICBwcmlvcml0eTogMTBcbiAqIH0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnKGlucHV0OiBPYnNlcnZhYmlsaXR5Q29uZmlnSW5wdXQgPSB7fSk6IE9ic2VydmFiaWxpdHlDb25maWcge1xuICBjb25zdCBzZXJ2aWNlTmFtZSA9IGlucHV0LnNlcnZpY2VOYW1lID8/IENPTkZJR19ERUZBVUxUUy5zZXJ2aWNlTmFtZTtcbiAgY29uc3QgZGVmYXVsdFRhYmxlS2V5ID0gQ09ORklHX0RFRkFVTFRTLnRhYmxlS2V5O1xuXG4gIC8vIEJ1aWxkIGNvbXBsZXRlIGNvbmZpZyB3aXRoIGRlZmF1bHRzXG4gIGNvbnN0IGNvbmZpZzogT2JzZXJ2YWJpbGl0eUNvbmZpZyA9IHtcbiAgICBlbmFibGVkOiBpbnB1dC5lbmFibGVkID8/IENPTkZJR19ERUZBVUxUUy5lbmFibGVkLFxuICAgIG1pbkxldmVsOiBpbnB1dC5taW5MZXZlbCA/PyBDT05GSUdfREVGQVVMVFMubWluTGV2ZWwsXG4gICAgc2VydmljZU5hbWUsXG4gICAgYmFja2VuZHM6IG5vcm1hbGl6ZUJhY2tlbmRzKGlucHV0LmJhY2tlbmRzKSxcbiAgICBzYW1wbGluZzoge1xuICAgICAgZW5hYmxlZDogaW5wdXQuc2FtcGxpbmc/LmVuYWJsZWQgPz8gZmFsc2UsXG4gICAgICByYXRlczogaW5wdXQuc2FtcGxpbmc/LnJhdGVzLFxuICAgICAgb3BlcmF0aW9uczogaW5wdXQuc2FtcGxpbmc/Lm9wZXJhdGlvbnMsXG4gICAgfSxcbiAgICBjbG91ZHdhdGNoOiB7XG4gICAgICBuYW1lc3BhY2U6IGlucHV0LmNsb3Vkd2F0Y2g/Lm5hbWVzcGFjZSA/PyBDT05GSUdfREVGQVVMVFMuY2xvdWR3YXRjaE5hbWVzcGFjZSxcbiAgICB9LFxuICAgIGR5bmFtb2RiOiB7XG4gICAgICB0YWJsZUtleTogaW5wdXQuZHluYW1vZGI/LnRhYmxlS2V5ID8/IGRlZmF1bHRUYWJsZUtleSxcbiAgICAgIHR0bERheXM6IGlucHV0LmR5bmFtb2RiPy50dGxEYXlzID8/IENPTkZJR19ERUZBVUxUUy50dGxEYXlzLFxuICAgIH0sXG4gICAgZGF0YVByb3RlY3Rpb246IHtcbiAgICAgIGVuYWJsZWQ6IGlucHV0LmRhdGFQcm90ZWN0aW9uPy5lbmFibGVkID8/IHRydWUsXG4gICAgICBibGFja2xpc3RlZEtleXM6IGlucHV0LmRhdGFQcm90ZWN0aW9uPy5ibGFja2xpc3RlZEtleXMgPz8gREVGQVVMVF9CTEFDS0xJU1RFRF9LRVlTLFxuICAgICAgZnV6enlLZXlNYXRjaDogaW5wdXQuZGF0YVByb3RlY3Rpb24/LmZ1enp5S2V5TWF0Y2ggPz8gdHJ1ZSxcbiAgICAgIGNhc2VTZW5zaXRpdmVLZXlNYXRjaDogaW5wdXQuZGF0YVByb3RlY3Rpb24/LmNhc2VTZW5zaXRpdmVLZXlNYXRjaCA/PyBmYWxzZSxcbiAgICAgIHJlcGxhY2VtZW50OiBpbnB1dC5kYXRhUHJvdGVjdGlvbj8ucmVwbGFjZW1lbnQgPz8gJ1tSRURBQ1RFRF0nLFxuICAgICAgZmllbGRzOiBpbnB1dC5kYXRhUHJvdGVjdGlvbj8uZmllbGRzID8/IFsgJ2RhdGEnLCAnYXR0cmlidXRlcycsICdtZXRhZGF0YScsICdjb250ZXh0JyBdLFxuICAgIH0sXG4gICAgc291cmNlTWFwOiB7XG4gICAgICBlbmFibGVkOiBpbnB1dC5zb3VyY2VNYXA/LmVuYWJsZWQgPz8gQ09ORklHX0RFRkFVTFRTLnNvdXJjZU1hcEVuYWJsZWQsXG4gICAgfSxcbiAgICB0eXBlczogaW5wdXQudHlwZXMsXG4gIH07XG5cbiAgLy8gVmFsaWRhdGVcbiAgY29uc3QgZXJyb3JzID0gdmFsaWRhdGVDb25maWcoY29uZmlnKTtcbiAgaWYgKGVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIG9ic2VydmFiaWxpdHkgY29uZmlnOiAke2Vycm9ycy5qb2luKCcsICcpfWApO1xuICB9XG5cbiAgcmV0dXJuIGNvbmZpZztcbn1cblxuLyoqXG4gKiBOb3JtYWxpemUgYmFja2VuZHMgaW5wdXQgdG8gZnVsbCBCYWNrZW5kQ29uZmlnIGFycmF5XG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUJhY2tlbmRzKFxuICBpbnB1dD86IEFycmF5PHsgdHlwZTogVmFsaWRCYWNrZW5kOyBlbmFibGVkPzogYm9vbGVhbjsgbWluTGV2ZWw/OiBPYnNlcnZhYmlsaXR5TGV2ZWwgfT5cbik6IE9ic2VydmFiaWxpdHlCYWNrZW5kQ29uZmlnW10ge1xuICBpZiAoIWlucHV0IHx8IGlucHV0Lmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBbIHsgdHlwZTogJ2Nsb3Vkd2F0Y2gnLCBlbmFibGVkOiB0cnVlIH0gXTtcbiAgfVxuXG4gIHJldHVybiBpbnB1dC5tYXAoYiA9PiAoe1xuICAgIHR5cGU6IGIudHlwZSxcbiAgICBlbmFibGVkOiBiLmVuYWJsZWQgPz8gdHJ1ZSxcbiAgICBtaW5MZXZlbDogYi5taW5MZXZlbCxcbiAgfSkpIGFzIE9ic2VydmFiaWxpdHlCYWNrZW5kQ29uZmlnW107XG59XG5cbi8qKlxuICogVmFsaWRhdGUgb2JzZXJ2YWJpbGl0eSBjb25maWd1cmF0aW9uXG4gKiBSZXR1cm5zIGFycmF5IG9mIHZhbGlkYXRpb24gZXJyb3JzIChlbXB0eSBpZiB2YWxpZClcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlQ29uZmlnKGNvbmZpZzogT2JzZXJ2YWJpbGl0eUNvbmZpZyk6IHN0cmluZ1tdIHtcbiAgY29uc3QgZXJyb3JzOiBzdHJpbmdbXSA9IFtdO1xuXG4gIC8vIFZhbGlkYXRlIG1pbkxldmVsXG4gIGNvbnN0IHZhbGlkTGV2ZWxzID0gT2JqZWN0LnZhbHVlcyhPYnNlcnZhYmlsaXR5TGV2ZWwpLmZpbHRlcigodikgPT4gdHlwZW9mIHYgPT09ICdudW1iZXInKTtcbiAgaWYgKCF2YWxpZExldmVscy5pbmNsdWRlcyhjb25maWcubWluTGV2ZWwpKSB7XG4gICAgZXJyb3JzLnB1c2goYEludmFsaWQgbWluTGV2ZWw6ICR7Y29uZmlnLm1pbkxldmVsfWApO1xuICB9XG5cbiAgLy8gVmFsaWRhdGUgc2FtcGxpbmcgcmF0ZXNcbiAgaWYgKGNvbmZpZy5zYW1wbGluZz8uZW5hYmxlZCAmJiBjb25maWcuc2FtcGxpbmcucmF0ZXMpIHtcbiAgICBPYmplY3QuZW50cmllcyhjb25maWcuc2FtcGxpbmcucmF0ZXMpLmZvckVhY2goKFsgbGV2ZWwsIHJhdGUgXSkgPT4ge1xuICAgICAgaWYgKHR5cGVvZiByYXRlICE9PSAnbnVtYmVyJyB8fCByYXRlIDwgMCB8fCByYXRlID4gMSkge1xuICAgICAgICBlcnJvcnMucHVzaChgSW52YWxpZCBzYW1wbGluZyByYXRlIGZvciAke2xldmVsfTogJHtyYXRlfS4gTXVzdCBiZSBiZXR3ZWVuIDAgYW5kIDEuYCk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICAvLyBWYWxpZGF0ZSBiYWNrZW5kIHR5cGVzXG4gIGNvbmZpZy5iYWNrZW5kcz8uZm9yRWFjaCgoYmFja2VuZCwgaW5kZXgpID0+IHtcbiAgICBpZiAoIVZBTElEX0JBQ0tFTkRTLmluY2x1ZGVzKGJhY2tlbmQudHlwZSBhcyBWYWxpZEJhY2tlbmQpKSB7XG4gICAgICBlcnJvcnMucHVzaChgSW52YWxpZCBiYWNrZW5kIHR5cGUgYXQgaW5kZXggJHtpbmRleH06ICR7YmFja2VuZC50eXBlfWApO1xuICAgIH1cbiAgfSk7XG5cbiAgLy8gVmFsaWRhdGUgc2VydmljZU5hbWVcbiAgaWYgKCFjb25maWcuc2VydmljZU5hbWUgfHwgY29uZmlnLnNlcnZpY2VOYW1lLnRyaW0oKSA9PT0gJycpIHtcbiAgICBlcnJvcnMucHVzaCgnc2VydmljZU5hbWUgaXMgcmVxdWlyZWQgYW5kIGNhbm5vdCBiZSBlbXB0eScpO1xuICB9XG5cbiAgLy8gVmFsaWRhdGUgY2xvdWR3YXRjaC5uYW1lc3BhY2VcbiAgaWYgKCFjb25maWcuY2xvdWR3YXRjaD8ubmFtZXNwYWNlIHx8IGNvbmZpZy5jbG91ZHdhdGNoLm5hbWVzcGFjZS50cmltKCkgPT09ICcnKSB7XG4gICAgZXJyb3JzLnB1c2goJ2Nsb3Vkd2F0Y2gubmFtZXNwYWNlIGlzIHJlcXVpcmVkIGFuZCBjYW5ub3QgYmUgZW1wdHknKTtcbiAgfVxuXG4gIC8vIFZhbGlkYXRlIGR5bmFtb2RiLnRhYmxlS2V5XG4gIGlmICghY29uZmlnLmR5bmFtb2RiPy50YWJsZUtleSB8fCBjb25maWcuZHluYW1vZGIudGFibGVLZXkudHJpbSgpID09PSAnJykge1xuICAgIGVycm9ycy5wdXNoKCdkeW5hbW9kYi50YWJsZUtleSBpcyByZXF1aXJlZCBhbmQgY2Fubm90IGJlIGVtcHR5Jyk7XG4gIH1cblxuICAvLyBWYWxpZGF0ZSBkeW5hbW9kYi50dGxEYXlzXG4gIGlmIChjb25maWcuZHluYW1vZGIgJiYgKHR5cGVvZiBjb25maWcuZHluYW1vZGIudHRsRGF5cyAhPT0gJ251bWJlcicgfHwgY29uZmlnLmR5bmFtb2RiLnR0bERheXMgPCAxKSkge1xuICAgIGVycm9ycy5wdXNoKGBJbnZhbGlkIGR5bmFtb2RiLnR0bERheXM6ICR7Y29uZmlnLmR5bmFtb2RiLnR0bERheXN9LiBNdXN0IGJlIGEgcG9zaXRpdmUgbnVtYmVyLmApO1xuICB9XG5cbiAgcmV0dXJuIGVycm9ycztcbn1cbiJdfQ==