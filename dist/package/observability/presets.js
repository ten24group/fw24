"use strict";
/**
 * Observability Configuration Presets
 *
 * Pre-configured observability settings for common environments.
 * Provides sensible defaults that can be overridden as needed.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.minimalPreset = exports.debugPreset = exports.developmentPreset = exports.productionPreset = void 0;
exports.getPreset = getPreset;
exports.createObservabilityConfig = createObservabilityConfig;
const types_1 = require("./types");
/**
 * Production preset: Cost-optimized with smart sampling
 * - Smart sampling enabled with error context capture
 * - 10% sampling for normal traffic
 * - DynamoDB only for WARN+ logs
 * - Critical events always captured
 */
exports.productionPreset = {
    enabled: true,
    minLevel: types_1.ObservabilityLevel.INFO,
    serviceName: '', // Must be provided by user
    sampling: {
        enabled: true,
        smart: true,
        maxBufferSize: 1000,
        rates: {
            trace: 0.01, // 1% trace logs
            debug: 0.01, // 1% debug logs
            info: 0.1, // 10% info logs
            warn: 0.5, // 50% warnings
            error: 1.0, // 100% errors
            critical: 1.0, // 100% critical (always)
        },
    },
    backends: [
        {
            type: 'cloudwatch',
            enabled: true,
            minLevel: types_1.ObservabilityLevel.INFO,
        },
        {
            type: 'dynamodb',
            enabled: true,
            minLevel: types_1.ObservabilityLevel.WARN, // Only WARN+ to DynamoDB
            types: {
                metric: { enabled: false }, // No metrics to DynamoDB
            },
        },
        {
            type: 'otel',
            enabled: true,
            minLevel: types_1.ObservabilityLevel.INFO,
        },
    ],
    types: {
        span: {
            minLevel: types_1.ObservabilityLevel.INFO,
            sampling: { enabled: true, rate: 0.1 }, // 10% of spans
        },
        metric: {
            minLevel: types_1.ObservabilityLevel.INFO,
            sampling: { enabled: false, rate: 1.0 }, // All metrics (no sampling)
        },
        audit: {
            minLevel: types_1.ObservabilityLevel.INFO,
            sampling: { enabled: false, rate: 1.0 }, // All audit logs
        },
        log: {
            minLevel: types_1.ObservabilityLevel.INFO,
            sampling: { enabled: true, rate: 0.1 }, // 10% of logs
        },
    },
    cloudwatch: {
        namespace: 'Application',
    },
    dynamodb: {
        tableKey: 'observability',
        ttlDays: 30,
    },
    dataProtection: {
        enabled: true,
        fuzzyKeyMatch: true,
        caseSensitiveKeyMatch: false,
        blacklistedKeys: [
            'password',
            'token',
            'secret',
            'apiKey',
            'authorization',
            'creditCard',
            'ssn',
            /private/i,
        ],
    },
    sourceMap: {
        enabled: true, // Enable in production for better error debugging
    },
};
/**
 * Development preset: Balanced visibility and cost
 * - More verbose than production
 * - 50% sampling for most events
 * - All backends enabled
 * - Good for staging environments
 */
exports.developmentPreset = {
    enabled: true,
    minLevel: types_1.ObservabilityLevel.DEBUG,
    serviceName: '', // Must be provided by user
    sampling: {
        enabled: true,
        smart: true,
        maxBufferSize: 1000,
        rates: {
            trace: 0.1, // 10% trace logs
            debug: 0.3, // 30% debug logs
            info: 0.5, // 50% info logs
            warn: 1.0, // 100% warnings
            error: 1.0, // 100% errors
            critical: 1.0, // 100% critical
        },
    },
    backends: [
        {
            type: 'cloudwatch',
            enabled: true,
            minLevel: types_1.ObservabilityLevel.DEBUG,
        },
        {
            type: 'dynamodb',
            enabled: true,
            minLevel: types_1.ObservabilityLevel.INFO,
        },
        {
            type: 'otel',
            enabled: true,
            minLevel: types_1.ObservabilityLevel.DEBUG,
        },
    ],
    types: {
        span: {
            minLevel: types_1.ObservabilityLevel.DEBUG,
            sampling: { enabled: true, rate: 0.5 }, // 50% of spans
        },
        metric: {
            minLevel: types_1.ObservabilityLevel.DEBUG,
            sampling: { enabled: false, rate: 1.0 }, // All metrics
        },
        audit: {
            minLevel: types_1.ObservabilityLevel.DEBUG,
            sampling: { enabled: false, rate: 1.0 }, // All audit logs
        },
        log: {
            minLevel: types_1.ObservabilityLevel.DEBUG,
            sampling: { enabled: true, rate: 0.5 }, // 50% of logs
        },
    },
    cloudwatch: {
        namespace: 'Application',
    },
    dynamodb: {
        tableKey: 'observability',
        ttlDays: 7,
    },
    dataProtection: {
        enabled: true,
        fuzzyKeyMatch: true,
        caseSensitiveKeyMatch: false,
        blacklistedKeys: [
            'password',
            'token',
            'secret',
            'apiKey',
            'authorization',
            'creditCard',
            'ssn',
        ],
    },
    sourceMap: {
        enabled: true, // Enable for better error debugging
    },
};
/**
 * Debug preset: Maximum visibility, no sampling
 * - All events captured
 * - All log levels enabled
 * - Useful for troubleshooting
 * - ⚠️ WARNING: Very expensive, use only for debugging
 */
exports.debugPreset = {
    enabled: true,
    minLevel: types_1.ObservabilityLevel.TRACE,
    serviceName: '', // Must be provided by user
    sampling: {
        enabled: false, // No sampling in debug mode
        smart: false,
        maxBufferSize: 2000,
    },
    backends: [
        {
            type: 'cloudwatch',
            enabled: true,
            minLevel: types_1.ObservabilityLevel.TRACE,
        },
        {
            type: 'dynamodb',
            enabled: true,
            minLevel: types_1.ObservabilityLevel.DEBUG,
        },
        {
            type: 'otel',
            enabled: true,
            minLevel: types_1.ObservabilityLevel.TRACE,
        },
    ],
    types: {
        span: {
            minLevel: types_1.ObservabilityLevel.TRACE,
            sampling: { enabled: false, rate: 1.0 },
        },
        metric: {
            minLevel: types_1.ObservabilityLevel.TRACE,
            sampling: { enabled: false, rate: 1.0 },
        },
        audit: {
            minLevel: types_1.ObservabilityLevel.TRACE,
            sampling: { enabled: false, rate: 1.0 },
        },
        log: {
            minLevel: types_1.ObservabilityLevel.TRACE,
            sampling: { enabled: false, rate: 1.0 },
        },
    },
    cloudwatch: {
        namespace: 'Application',
    },
    dynamodb: {
        tableKey: 'observability',
        ttlDays: 1,
    },
    dataProtection: {
        enabled: false, // No redaction in debug mode
    },
    sourceMap: {
        enabled: true, // Enable for maximum debugging
    },
};
/**
 * Minimal preset: Bare minimum observability
 * - Only errors and critical events
 * - No sampling needed (already filtered by level)
 * - CloudWatch only
 * - Lowest cost option
 */
exports.minimalPreset = {
    enabled: true,
    minLevel: types_1.ObservabilityLevel.ERROR,
    serviceName: '', // Must be provided by user
    sampling: {
        enabled: false,
        smart: false,
    },
    backends: [
        {
            type: 'cloudwatch',
            enabled: true,
            minLevel: types_1.ObservabilityLevel.ERROR,
        },
    ],
    types: {
        span: {
            minLevel: types_1.ObservabilityLevel.ERROR,
            sampling: { enabled: false, rate: 1.0 },
        },
        metric: {
            minLevel: types_1.ObservabilityLevel.ERROR,
            sampling: { enabled: false, rate: 1.0 },
        },
        audit: {
            minLevel: types_1.ObservabilityLevel.ERROR,
            sampling: { enabled: false, rate: 1.0 },
        },
        log: {
            minLevel: types_1.ObservabilityLevel.ERROR,
            sampling: { enabled: false, rate: 1.0 },
        },
    },
    cloudwatch: {
        namespace: 'Application',
    },
    dynamodb: {
        tableKey: 'observability',
        ttlDays: 7,
    },
    dataProtection: {
        enabled: true,
        blacklistedKeys: ['password', 'token', 'secret'],
    },
    sourceMap: {
        enabled: false, // Minimal preset disables optional features
    },
};
/**
 * Get preset configuration by name
 */
function getPreset(preset) {
    switch (preset) {
        case 'production':
            return { ...exports.productionPreset };
        case 'development':
            return { ...exports.developmentPreset };
        case 'debug':
            return { ...exports.debugPreset };
        case 'minimal':
            return { ...exports.minimalPreset };
        default:
            throw new Error(`Unknown observability preset: ${preset}`);
    }
}
/**
 * Deep merge helper for nested objects
 */
function deepMerge(target, source) {
    const result = { ...target };
    for (const key in source) {
        const sourceValue = source[key];
        const targetValue = result[key];
        if (sourceValue === undefined) {
            continue;
        }
        if (Array.isArray(sourceValue)) {
            result[key] = sourceValue;
        }
        else if (typeof sourceValue === 'object' && sourceValue !== null && !Array.isArray(sourceValue)) {
            if (typeof targetValue === 'object' && targetValue !== null) {
                result[key] = deepMerge(targetValue, sourceValue);
            }
            else {
                result[key] = sourceValue;
            }
        }
        else {
            result[key] = sourceValue;
        }
    }
    return result;
}
/**
 * Create observability configuration with preset and overrides
 *
 * @example
 * ```typescript
 * // Use production preset with custom service name
 * const config = createObservabilityConfig({
 *   preset: 'production',
 *   serviceName: 'my-api'
 * });
 *
 * // Use development preset with custom sampling
 * const config = createObservabilityConfig({
 *   preset: 'development',
 *   serviceName: 'my-api',
 *   sampling: {
 *     smart: true,
 *     rates: { info: 0.8 }
 *   }
 * });
 *
 * // Use debug preset temporarily
 * const config = createObservabilityConfig({
 *   preset: 'debug',
 *   serviceName: 'my-api'
 * });
 * ```
 */
function createObservabilityConfig(options) {
    const { preset, serviceName, overrides = {} } = options;
    if (!serviceName) {
        throw new Error('serviceName is required for observability configuration');
    }
    // Get base preset config
    const baseConfig = getPreset(preset);
    // Set service name
    baseConfig.serviceName = serviceName;
    // Apply overrides if provided
    if (Object.keys(overrides).length > 0) {
        return deepMerge(baseConfig, overrides);
    }
    return baseConfig;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHJlc2V0cy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L3ByZXNldHMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7OztHQUtHOzs7QUFnVkgsOEJBYUM7QUE0REQsOERBdUJDO0FBOWFELG1DQUFrRTtBQU9sRTs7Ozs7O0dBTUc7QUFDVSxRQUFBLGdCQUFnQixHQUF3QjtJQUNuRCxPQUFPLEVBQUUsSUFBSTtJQUNiLFFBQVEsRUFBRSwwQkFBa0IsQ0FBQyxJQUFJO0lBQ2pDLFdBQVcsRUFBRSxFQUFFLEVBQUUsMkJBQTJCO0lBRTVDLFFBQVEsRUFBRTtRQUNSLE9BQU8sRUFBRSxJQUFJO1FBQ2IsS0FBSyxFQUFFLElBQUk7UUFDWCxhQUFhLEVBQUUsSUFBSTtRQUNuQixLQUFLLEVBQUU7WUFDTCxLQUFLLEVBQUUsSUFBSSxFQUFLLGdCQUFnQjtZQUNoQyxLQUFLLEVBQUUsSUFBSSxFQUFLLGdCQUFnQjtZQUNoQyxJQUFJLEVBQUUsR0FBRyxFQUFPLGdCQUFnQjtZQUNoQyxJQUFJLEVBQUUsR0FBRyxFQUFPLGVBQWU7WUFDL0IsS0FBSyxFQUFFLEdBQUcsRUFBTSxjQUFjO1lBQzlCLFFBQVEsRUFBRSxHQUFHLEVBQUcseUJBQXlCO1NBQzFDO0tBQ0Y7SUFFRCxRQUFRLEVBQUU7UUFDUjtZQUNFLElBQUksRUFBRSxZQUFZO1lBQ2xCLE9BQU8sRUFBRSxJQUFJO1lBQ2IsUUFBUSxFQUFFLDBCQUFrQixDQUFDLElBQUk7U0FDbEM7UUFDRDtZQUNFLElBQUksRUFBRSxVQUFVO1lBQ2hCLE9BQU8sRUFBRSxJQUFJO1lBQ2IsUUFBUSxFQUFFLDBCQUFrQixDQUFDLElBQUksRUFBRSx5QkFBeUI7WUFDNUQsS0FBSyxFQUFFO2dCQUNMLE1BQU0sRUFBRSxFQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUUsRUFBRSx5QkFBeUI7YUFDdEQ7U0FDRjtRQUNEO1lBQ0UsSUFBSSxFQUFFLE1BQU07WUFDWixP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QztJQUVELE9BQU8sVUFBVSxDQUFDO0FBQ3BCLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIE9ic2VydmFiaWxpdHkgQ29uZmlndXJhdGlvbiBQcmVzZXRzXG4gKiBcbiAqIFByZS1jb25maWd1cmVkIG9ic2VydmFiaWxpdHkgc2V0dGluZ3MgZm9yIGNvbW1vbiBlbnZpcm9ubWVudHMuXG4gKiBQcm92aWRlcyBzZW5zaWJsZSBkZWZhdWx0cyB0aGF0IGNhbiBiZSBvdmVycmlkZGVuIGFzIG5lZWRlZC5cbiAqL1xuXG5pbXBvcnQgeyBPYnNlcnZhYmlsaXR5Q29uZmlnLCBPYnNlcnZhYmlsaXR5TGV2ZWwgfSBmcm9tICcuL3R5cGVzJztcblxuLyoqXG4gKiBQcmVzZXQgbmFtZXMgZm9yIGNvbW1vbiBlbnZpcm9ubWVudHNcbiAqL1xuZXhwb3J0IHR5cGUgT2JzZXJ2YWJpbGl0eVByZXNldCA9ICdwcm9kdWN0aW9uJyB8ICdkZXZlbG9wbWVudCcgfCAnZGVidWcnIHwgJ21pbmltYWwnO1xuXG4vKipcbiAqIFByb2R1Y3Rpb24gcHJlc2V0OiBDb3N0LW9wdGltaXplZCB3aXRoIHNtYXJ0IHNhbXBsaW5nXG4gKiAtIFNtYXJ0IHNhbXBsaW5nIGVuYWJsZWQgd2l0aCBlcnJvciBjb250ZXh0IGNhcHR1cmVcbiAqIC0gMTAlIHNhbXBsaW5nIGZvciBub3JtYWwgdHJhZmZpY1xuICogLSBEeW5hbW9EQiBvbmx5IGZvciBXQVJOKyBsb2dzXG4gKiAtIENyaXRpY2FsIGV2ZW50cyBhbHdheXMgY2FwdHVyZWRcbiAqL1xuZXhwb3J0IGNvbnN0IHByb2R1Y3Rpb25QcmVzZXQ6IE9ic2VydmFiaWxpdHlDb25maWcgPSB7XG4gIGVuYWJsZWQ6IHRydWUsXG4gIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwuSU5GTyxcbiAgc2VydmljZU5hbWU6ICcnLCAvLyBNdXN0IGJlIHByb3ZpZGVkIGJ5IHVzZXJcblxuICBzYW1wbGluZzoge1xuICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgc21hcnQ6IHRydWUsXG4gICAgbWF4QnVmZmVyU2l6ZTogMTAwMCxcbiAgICByYXRlczoge1xuICAgICAgdHJhY2U6IDAuMDEsICAgIC8vIDElIHRyYWNlIGxvZ3NcbiAgICAgIGRlYnVnOiAwLjAxLCAgICAvLyAxJSBkZWJ1ZyBsb2dzXG4gICAgICBpbmZvOiAwLjEsICAgICAgLy8gMTAlIGluZm8gbG9nc1xuICAgICAgd2FybjogMC41LCAgICAgIC8vIDUwJSB3YXJuaW5nc1xuICAgICAgZXJyb3I6IDEuMCwgICAgIC8vIDEwMCUgZXJyb3JzXG4gICAgICBjcml0aWNhbDogMS4wLCAgLy8gMTAwJSBjcml0aWNhbCAoYWx3YXlzKVxuICAgIH0sXG4gIH0sXG5cbiAgYmFja2VuZHM6IFtcbiAgICB7XG4gICAgICB0eXBlOiAnY2xvdWR3YXRjaCcsXG4gICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbC5JTkZPLFxuICAgIH0sXG4gICAge1xuICAgICAgdHlwZTogJ2R5bmFtb2RiJyxcbiAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLldBUk4sIC8vIE9ubHkgV0FSTisgdG8gRHluYW1vREJcbiAgICAgIHR5cGVzOiB7XG4gICAgICAgIG1ldHJpYzogeyBlbmFibGVkOiBmYWxzZSB9LCAvLyBObyBtZXRyaWNzIHRvIER5bmFtb0RCXG4gICAgICB9LFxuICAgIH0sXG4gICAge1xuICAgICAgdHlwZTogJ290ZWwnLFxuICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwuSU5GTyxcbiAgICB9LFxuICBdLFxuXG4gIHR5cGVzOiB7XG4gICAgc3Bhbjoge1xuICAgICAgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbC5JTkZPLFxuICAgICAgc2FtcGxpbmc6IHsgZW5hYmxlZDogdHJ1ZSwgcmF0ZTogMC4xIH0sIC8vIDEwJSBvZiBzcGFuc1xuICAgIH0sXG4gICAgbWV0cmljOiB7XG4gICAgICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLklORk8sXG4gICAgICBzYW1wbGluZzogeyBlbmFibGVkOiBmYWxzZSwgcmF0ZTogMS4wIH0sIC8vIEFsbCBtZXRyaWNzIChubyBzYW1wbGluZylcbiAgICB9LFxuICAgIGF1ZGl0OiB7XG4gICAgICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLklORk8sXG4gICAgICBzYW1wbGluZzogeyBlbmFibGVkOiBmYWxzZSwgcmF0ZTogMS4wIH0sIC8vIEFsbCBhdWRpdCBsb2dzXG4gICAgfSxcbiAgICBsb2c6IHtcbiAgICAgIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwuSU5GTyxcbiAgICAgIHNhbXBsaW5nOiB7IGVuYWJsZWQ6IHRydWUsIHJhdGU6IDAuMSB9LCAvLyAxMCUgb2YgbG9nc1xuICAgIH0sXG4gIH0sXG5cbiAgY2xvdWR3YXRjaDoge1xuICAgIG5hbWVzcGFjZTogJ0FwcGxpY2F0aW9uJyxcbiAgfSxcblxuICBkeW5hbW9kYjoge1xuICAgIHRhYmxlS2V5OiAnb2JzZXJ2YWJpbGl0eScsXG4gICAgdHRsRGF5czogMzAsXG4gIH0sXG5cbiAgZGF0YVByb3RlY3Rpb246IHtcbiAgICBlbmFibGVkOiB0cnVlLFxuICAgIGZ1enp5S2V5TWF0Y2g6IHRydWUsXG4gICAgY2FzZVNlbnNpdGl2ZUtleU1hdGNoOiBmYWxzZSxcbiAgICBibGFja2xpc3RlZEtleXM6IFtcbiAgICAgICdwYXNzd29yZCcsXG4gICAgICAndG9rZW4nLFxuICAgICAgJ3NlY3JldCcsXG4gICAgICAnYXBpS2V5JyxcbiAgICAgICdhdXRob3JpemF0aW9uJyxcbiAgICAgICdjcmVkaXRDYXJkJyxcbiAgICAgICdzc24nLFxuICAgICAgL3ByaXZhdGUvaSxcbiAgICBdLFxuICB9LFxuXG4gIHNvdXJjZU1hcDoge1xuICAgIGVuYWJsZWQ6IHRydWUsIC8vIEVuYWJsZSBpbiBwcm9kdWN0aW9uIGZvciBiZXR0ZXIgZXJyb3IgZGVidWdnaW5nXG4gIH0sXG59O1xuXG4vKipcbiAqIERldmVsb3BtZW50IHByZXNldDogQmFsYW5jZWQgdmlzaWJpbGl0eSBhbmQgY29zdFxuICogLSBNb3JlIHZlcmJvc2UgdGhhbiBwcm9kdWN0aW9uXG4gKiAtIDUwJSBzYW1wbGluZyBmb3IgbW9zdCBldmVudHNcbiAqIC0gQWxsIGJhY2tlbmRzIGVuYWJsZWRcbiAqIC0gR29vZCBmb3Igc3RhZ2luZyBlbnZpcm9ubWVudHNcbiAqL1xuZXhwb3J0IGNvbnN0IGRldmVsb3BtZW50UHJlc2V0OiBPYnNlcnZhYmlsaXR5Q29uZmlnID0ge1xuICBlbmFibGVkOiB0cnVlLFxuICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLkRFQlVHLFxuICBzZXJ2aWNlTmFtZTogJycsIC8vIE11c3QgYmUgcHJvdmlkZWQgYnkgdXNlclxuXG4gIHNhbXBsaW5nOiB7XG4gICAgZW5hYmxlZDogdHJ1ZSxcbiAgICBzbWFydDogdHJ1ZSxcbiAgICBtYXhCdWZmZXJTaXplOiAxMDAwLFxuICAgIHJhdGVzOiB7XG4gICAgICB0cmFjZTogMC4xLCAgICAvLyAxMCUgdHJhY2UgbG9nc1xuICAgICAgZGVidWc6IDAuMywgICAgLy8gMzAlIGRlYnVnIGxvZ3NcbiAgICAgIGluZm86IDAuNSwgICAgIC8vIDUwJSBpbmZvIGxvZ3NcbiAgICAgIHdhcm46IDEuMCwgICAgIC8vIDEwMCUgd2FybmluZ3NcbiAgICAgIGVycm9yOiAxLjAsICAgIC8vIDEwMCUgZXJyb3JzXG4gICAgICBjcml0aWNhbDogMS4wLCAvLyAxMDAlIGNyaXRpY2FsXG4gICAgfSxcbiAgfSxcblxuICBiYWNrZW5kczogW1xuICAgIHtcbiAgICAgIHR5cGU6ICdjbG91ZHdhdGNoJyxcbiAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLkRFQlVHLFxuICAgIH0sXG4gICAge1xuICAgICAgdHlwZTogJ2R5bmFtb2RiJyxcbiAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLklORk8sXG4gICAgfSxcbiAgICB7XG4gICAgICB0eXBlOiAnb3RlbCcsXG4gICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbC5ERUJVRyxcbiAgICB9LFxuICBdLFxuXG4gIHR5cGVzOiB7XG4gICAgc3Bhbjoge1xuICAgICAgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbC5ERUJVRyxcbiAgICAgIHNhbXBsaW5nOiB7IGVuYWJsZWQ6IHRydWUsIHJhdGU6IDAuNSB9LCAvLyA1MCUgb2Ygc3BhbnNcbiAgICB9LFxuICAgIG1ldHJpYzoge1xuICAgICAgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbC5ERUJVRyxcbiAgICAgIHNhbXBsaW5nOiB7IGVuYWJsZWQ6IGZhbHNlLCByYXRlOiAxLjAgfSwgLy8gQWxsIG1ldHJpY3NcbiAgICB9LFxuICAgIGF1ZGl0OiB7XG4gICAgICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLkRFQlVHLFxuICAgICAgc2FtcGxpbmc6IHsgZW5hYmxlZDogZmFsc2UsIHJhdGU6IDEuMCB9LCAvLyBBbGwgYXVkaXQgbG9nc1xuICAgIH0sXG4gICAgbG9nOiB7XG4gICAgICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLkRFQlVHLFxuICAgICAgc2FtcGxpbmc6IHsgZW5hYmxlZDogdHJ1ZSwgcmF0ZTogMC41IH0sIC8vIDUwJSBvZiBsb2dzXG4gICAgfSxcbiAgfSxcblxuICBjbG91ZHdhdGNoOiB7XG4gICAgbmFtZXNwYWNlOiAnQXBwbGljYXRpb24nLFxuICB9LFxuXG4gIGR5bmFtb2RiOiB7XG4gICAgdGFibGVLZXk6ICdvYnNlcnZhYmlsaXR5JyxcbiAgICB0dGxEYXlzOiA3LFxuICB9LFxuXG4gIGRhdGFQcm90ZWN0aW9uOiB7XG4gICAgZW5hYmxlZDogdHJ1ZSxcbiAgICBmdXp6eUtleU1hdGNoOiB0cnVlLFxuICAgIGNhc2VTZW5zaXRpdmVLZXlNYXRjaDogZmFsc2UsXG4gICAgYmxhY2tsaXN0ZWRLZXlzOiBbXG4gICAgICAncGFzc3dvcmQnLFxuICAgICAgJ3Rva2VuJyxcbiAgICAgICdzZWNyZXQnLFxuICAgICAgJ2FwaUtleScsXG4gICAgICAnYXV0aG9yaXphdGlvbicsXG4gICAgICAnY3JlZGl0Q2FyZCcsXG4gICAgICAnc3NuJyxcbiAgICBdLFxuICB9LFxuXG4gIHNvdXJjZU1hcDoge1xuICAgIGVuYWJsZWQ6IHRydWUsIC8vIEVuYWJsZSBmb3IgYmV0dGVyIGVycm9yIGRlYnVnZ2luZ1xuICB9LFxufTtcblxuLyoqXG4gKiBEZWJ1ZyBwcmVzZXQ6IE1heGltdW0gdmlzaWJpbGl0eSwgbm8gc2FtcGxpbmdcbiAqIC0gQWxsIGV2ZW50cyBjYXB0dXJlZFxuICogLSBBbGwgbG9nIGxldmVscyBlbmFibGVkXG4gKiAtIFVzZWZ1bCBmb3IgdHJvdWJsZXNob290aW5nXG4gKiAtIOKaoO+4jyBXQVJOSU5HOiBWZXJ5IGV4cGVuc2l2ZSwgdXNlIG9ubHkgZm9yIGRlYnVnZ2luZ1xuICovXG5leHBvcnQgY29uc3QgZGVidWdQcmVzZXQ6IE9ic2VydmFiaWxpdHlDb25maWcgPSB7XG4gIGVuYWJsZWQ6IHRydWUsXG4gIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwuVFJBQ0UsXG4gIHNlcnZpY2VOYW1lOiAnJywgLy8gTXVzdCBiZSBwcm92aWRlZCBieSB1c2VyXG5cbiAgc2FtcGxpbmc6IHtcbiAgICBlbmFibGVkOiBmYWxzZSwgLy8gTm8gc2FtcGxpbmcgaW4gZGVidWcgbW9kZVxuICAgIHNtYXJ0OiBmYWxzZSxcbiAgICBtYXhCdWZmZXJTaXplOiAyMDAwLFxuICB9LFxuXG4gIGJhY2tlbmRzOiBbXG4gICAge1xuICAgICAgdHlwZTogJ2Nsb3Vkd2F0Y2gnLFxuICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwuVFJBQ0UsXG4gICAgfSxcbiAgICB7XG4gICAgICB0eXBlOiAnZHluYW1vZGInLFxuICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwuREVCVUcsXG4gICAgfSxcbiAgICB7XG4gICAgICB0eXBlOiAnb3RlbCcsXG4gICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbC5UUkFDRSxcbiAgICB9LFxuICBdLFxuXG4gIHR5cGVzOiB7XG4gICAgc3Bhbjoge1xuICAgICAgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbC5UUkFDRSxcbiAgICAgIHNhbXBsaW5nOiB7IGVuYWJsZWQ6IGZhbHNlLCByYXRlOiAxLjAgfSxcbiAgICB9LFxuICAgIG1ldHJpYzoge1xuICAgICAgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbC5UUkFDRSxcbiAgICAgIHNhbXBsaW5nOiB7IGVuYWJsZWQ6IGZhbHNlLCByYXRlOiAxLjAgfSxcbiAgICB9LFxuICAgIGF1ZGl0OiB7XG4gICAgICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLlRSQUNFLFxuICAgICAgc2FtcGxpbmc6IHsgZW5hYmxlZDogZmFsc2UsIHJhdGU6IDEuMCB9LFxuICAgIH0sXG4gICAgbG9nOiB7XG4gICAgICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLlRSQUNFLFxuICAgICAgc2FtcGxpbmc6IHsgZW5hYmxlZDogZmFsc2UsIHJhdGU6IDEuMCB9LFxuICAgIH0sXG4gIH0sXG5cbiAgY2xvdWR3YXRjaDoge1xuICAgIG5hbWVzcGFjZTogJ0FwcGxpY2F0aW9uJyxcbiAgfSxcblxuICBkeW5hbW9kYjoge1xuICAgIHRhYmxlS2V5OiAnb2JzZXJ2YWJpbGl0eScsXG4gICAgdHRsRGF5czogMSxcbiAgfSxcblxuICBkYXRhUHJvdGVjdGlvbjoge1xuICAgIGVuYWJsZWQ6IGZhbHNlLCAvLyBObyByZWRhY3Rpb24gaW4gZGVidWcgbW9kZVxuICB9LFxuXG4gIHNvdXJjZU1hcDoge1xuICAgIGVuYWJsZWQ6IHRydWUsIC8vIEVuYWJsZSBmb3IgbWF4aW11bSBkZWJ1Z2dpbmdcbiAgfSxcbn07XG5cbi8qKlxuICogTWluaW1hbCBwcmVzZXQ6IEJhcmUgbWluaW11bSBvYnNlcnZhYmlsaXR5XG4gKiAtIE9ubHkgZXJyb3JzIGFuZCBjcml0aWNhbCBldmVudHNcbiAqIC0gTm8gc2FtcGxpbmcgbmVlZGVkIChhbHJlYWR5IGZpbHRlcmVkIGJ5IGxldmVsKVxuICogLSBDbG91ZFdhdGNoIG9ubHlcbiAqIC0gTG93ZXN0IGNvc3Qgb3B0aW9uXG4gKi9cbmV4cG9ydCBjb25zdCBtaW5pbWFsUHJlc2V0OiBPYnNlcnZhYmlsaXR5Q29uZmlnID0ge1xuICBlbmFibGVkOiB0cnVlLFxuICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLkVSUk9SLFxuICBzZXJ2aWNlTmFtZTogJycsIC8vIE11c3QgYmUgcHJvdmlkZWQgYnkgdXNlclxuXG4gIHNhbXBsaW5nOiB7XG4gICAgZW5hYmxlZDogZmFsc2UsXG4gICAgc21hcnQ6IGZhbHNlLFxuICB9LFxuXG4gIGJhY2tlbmRzOiBbXG4gICAge1xuICAgICAgdHlwZTogJ2Nsb3Vkd2F0Y2gnLFxuICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwuRVJST1IsXG4gICAgfSxcbiAgXSxcblxuICB0eXBlczoge1xuICAgIHNwYW46IHtcbiAgICAgIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwuRVJST1IsXG4gICAgICBzYW1wbGluZzogeyBlbmFibGVkOiBmYWxzZSwgcmF0ZTogMS4wIH0sXG4gICAgfSxcbiAgICBtZXRyaWM6IHtcbiAgICAgIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwuRVJST1IsXG4gICAgICBzYW1wbGluZzogeyBlbmFibGVkOiBmYWxzZSwgcmF0ZTogMS4wIH0sXG4gICAgfSxcbiAgICBhdWRpdDoge1xuICAgICAgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbC5FUlJPUixcbiAgICAgIHNhbXBsaW5nOiB7IGVuYWJsZWQ6IGZhbHNlLCByYXRlOiAxLjAgfSxcbiAgICB9LFxuICAgIGxvZzoge1xuICAgICAgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbC5FUlJPUixcbiAgICAgIHNhbXBsaW5nOiB7IGVuYWJsZWQ6IGZhbHNlLCByYXRlOiAxLjAgfSxcbiAgICB9LFxuICB9LFxuXG4gIGNsb3Vkd2F0Y2g6IHtcbiAgICBuYW1lc3BhY2U6ICdBcHBsaWNhdGlvbicsXG4gIH0sXG5cbiAgZHluYW1vZGI6IHtcbiAgICB0YWJsZUtleTogJ29ic2VydmFiaWxpdHknLFxuICAgIHR0bERheXM6IDcsXG4gIH0sXG5cbiAgZGF0YVByb3RlY3Rpb246IHtcbiAgICBlbmFibGVkOiB0cnVlLFxuICAgIGJsYWNrbGlzdGVkS2V5czogWyAncGFzc3dvcmQnLCAndG9rZW4nLCAnc2VjcmV0JyBdLFxuICB9LFxuXG4gIHNvdXJjZU1hcDoge1xuICAgIGVuYWJsZWQ6IGZhbHNlLCAvLyBNaW5pbWFsIHByZXNldCBkaXNhYmxlcyBvcHRpb25hbCBmZWF0dXJlc1xuICB9LFxufTtcblxuLyoqXG4gKiBHZXQgcHJlc2V0IGNvbmZpZ3VyYXRpb24gYnkgbmFtZVxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2V0UHJlc2V0KHByZXNldDogT2JzZXJ2YWJpbGl0eVByZXNldCk6IE9ic2VydmFiaWxpdHlDb25maWcge1xuICBzd2l0Y2ggKHByZXNldCkge1xuICAgIGNhc2UgJ3Byb2R1Y3Rpb24nOlxuICAgICAgcmV0dXJuIHsgLi4ucHJvZHVjdGlvblByZXNldCB9O1xuICAgIGNhc2UgJ2RldmVsb3BtZW50JzpcbiAgICAgIHJldHVybiB7IC4uLmRldmVsb3BtZW50UHJlc2V0IH07XG4gICAgY2FzZSAnZGVidWcnOlxuICAgICAgcmV0dXJuIHsgLi4uZGVidWdQcmVzZXQgfTtcbiAgICBjYXNlICdtaW5pbWFsJzpcbiAgICAgIHJldHVybiB7IC4uLm1pbmltYWxQcmVzZXQgfTtcbiAgICBkZWZhdWx0OlxuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIG9ic2VydmFiaWxpdHkgcHJlc2V0OiAke3ByZXNldH1gKTtcbiAgfVxufVxuXG4vKipcbiAqIERlZXAgbWVyZ2UgaGVscGVyIGZvciBuZXN0ZWQgb2JqZWN0c1xuICovXG5mdW5jdGlvbiBkZWVwTWVyZ2U8VCBleHRlbmRzIFJlY29yZDxzdHJpbmcsIGFueT4+KHRhcmdldDogVCwgc291cmNlOiBQYXJ0aWFsPFQ+KTogVCB7XG4gIGNvbnN0IHJlc3VsdCA9IHsgLi4udGFyZ2V0IH07XG5cbiAgZm9yIChjb25zdCBrZXkgaW4gc291cmNlKSB7XG4gICAgY29uc3Qgc291cmNlVmFsdWUgPSBzb3VyY2VbIGtleSBdO1xuICAgIGNvbnN0IHRhcmdldFZhbHVlID0gcmVzdWx0WyBrZXkgXTtcblxuICAgIGlmIChzb3VyY2VWYWx1ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShzb3VyY2VWYWx1ZSkpIHtcbiAgICAgIHJlc3VsdFsga2V5IF0gPSBzb3VyY2VWYWx1ZSBhcyBhbnk7XG4gICAgfSBlbHNlIGlmICh0eXBlb2Ygc291cmNlVmFsdWUgPT09ICdvYmplY3QnICYmIHNvdXJjZVZhbHVlICE9PSBudWxsICYmICFBcnJheS5pc0FycmF5KHNvdXJjZVZhbHVlKSkge1xuICAgICAgaWYgKHR5cGVvZiB0YXJnZXRWYWx1ZSA9PT0gJ29iamVjdCcgJiYgdGFyZ2V0VmFsdWUgIT09IG51bGwpIHtcbiAgICAgICAgcmVzdWx0WyBrZXkgXSA9IGRlZXBNZXJnZSh0YXJnZXRWYWx1ZSwgc291cmNlVmFsdWUpIGFzIGFueTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJlc3VsdFsga2V5IF0gPSBzb3VyY2VWYWx1ZSBhcyBhbnk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlc3VsdFsga2V5IF0gPSBzb3VyY2VWYWx1ZSBhcyBhbnk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuLyoqXG4gKiBDcmVhdGUgb2JzZXJ2YWJpbGl0eSBjb25maWd1cmF0aW9uIHdpdGggcHJlc2V0IGFuZCBvdmVycmlkZXNcbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIFVzZSBwcm9kdWN0aW9uIHByZXNldCB3aXRoIGN1c3RvbSBzZXJ2aWNlIG5hbWVcbiAqIGNvbnN0IGNvbmZpZyA9IGNyZWF0ZU9ic2VydmFiaWxpdHlDb25maWcoe1xuICogICBwcmVzZXQ6ICdwcm9kdWN0aW9uJyxcbiAqICAgc2VydmljZU5hbWU6ICdteS1hcGknXG4gKiB9KTtcbiAqIFxuICogLy8gVXNlIGRldmVsb3BtZW50IHByZXNldCB3aXRoIGN1c3RvbSBzYW1wbGluZ1xuICogY29uc3QgY29uZmlnID0gY3JlYXRlT2JzZXJ2YWJpbGl0eUNvbmZpZyh7XG4gKiAgIHByZXNldDogJ2RldmVsb3BtZW50JyxcbiAqICAgc2VydmljZU5hbWU6ICdteS1hcGknLFxuICogICBzYW1wbGluZzoge1xuICogICAgIHNtYXJ0OiB0cnVlLFxuICogICAgIHJhdGVzOiB7IGluZm86IDAuOCB9XG4gKiAgIH1cbiAqIH0pO1xuICogXG4gKiAvLyBVc2UgZGVidWcgcHJlc2V0IHRlbXBvcmFyaWx5XG4gKiBjb25zdCBjb25maWcgPSBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnKHtcbiAqICAgcHJlc2V0OiAnZGVidWcnLFxuICogICBzZXJ2aWNlTmFtZTogJ215LWFwaSdcbiAqIH0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnKG9wdGlvbnM6IHtcbiAgcHJlc2V0OiBPYnNlcnZhYmlsaXR5UHJlc2V0O1xuICBzZXJ2aWNlTmFtZTogc3RyaW5nO1xuICBvdmVycmlkZXM/OiBQYXJ0aWFsPE9ic2VydmFiaWxpdHlDb25maWc+O1xufSk6IE9ic2VydmFiaWxpdHlDb25maWcge1xuICBjb25zdCB7IHByZXNldCwgc2VydmljZU5hbWUsIG92ZXJyaWRlcyA9IHt9IH0gPSBvcHRpb25zO1xuXG4gIGlmICghc2VydmljZU5hbWUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3NlcnZpY2VOYW1lIGlzIHJlcXVpcmVkIGZvciBvYnNlcnZhYmlsaXR5IGNvbmZpZ3VyYXRpb24nKTtcbiAgfVxuXG4gIC8vIEdldCBiYXNlIHByZXNldCBjb25maWdcbiAgY29uc3QgYmFzZUNvbmZpZyA9IGdldFByZXNldChwcmVzZXQpO1xuXG4gIC8vIFNldCBzZXJ2aWNlIG5hbWVcbiAgYmFzZUNvbmZpZy5zZXJ2aWNlTmFtZSA9IHNlcnZpY2VOYW1lO1xuXG4gIC8vIEFwcGx5IG92ZXJyaWRlcyBpZiBwcm92aWRlZFxuICBpZiAoT2JqZWN0LmtleXMob3ZlcnJpZGVzKS5sZW5ndGggPiAwKSB7XG4gICAgcmV0dXJuIGRlZXBNZXJnZShiYXNlQ29uZmlnLCBvdmVycmlkZXMpO1xuICB9XG5cbiAgcmV0dXJuIGJhc2VDb25maWc7XG59XG5cbiJdfQ==