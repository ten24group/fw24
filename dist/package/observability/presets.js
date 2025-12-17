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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHJlc2V0cy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L3ByZXNldHMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7OztHQUtHOzs7QUFnVUgsOEJBYUM7QUE0REQsOERBdUJDO0FBOVpELG1DQUFrRTtBQU9sRTs7Ozs7O0dBTUc7QUFDVSxRQUFBLGdCQUFnQixHQUF3QjtJQUNuRCxPQUFPLEVBQUUsSUFBSTtJQUNiLFFBQVEsRUFBRSwwQkFBa0IsQ0FBQyxJQUFJO0lBQ2pDLFdBQVcsRUFBRSxFQUFFLEVBQUUsMkJBQTJCO0lBRTVDLFFBQVEsRUFBRTtRQUNSLE9BQU8sRUFBRSxJQUFJO1FBQ2IsS0FBSyxFQUFFLElBQUk7UUFDWCxhQUFhLEVBQUUsSUFBSTtRQUNuQixLQUFLLEVBQUU7WUFDTCxLQUFLLEVBQUUsSUFBSSxFQUFLLGdCQUFnQjtZQUNoQyxLQUFLLEVBQUUsSUFBSSxFQUFLLGdCQUFnQjtZQUNoQyxJQUFJLEVBQUUsR0FBRyxFQUFPLGdCQUFnQjtZQUNoQyxJQUFJLEVBQUUsR0FBRyxFQUFPLGVBQWU7WUFDL0IsS0FBSyxFQUFFLEdBQUcsRUFBTSxjQUFjO1lBQzlCLFFBQVEsRUFBRSxHQUFHLEVBQUcseUJBQXlCO1NBQzFDO0tBQ0Y7SUFFRCxRQUFRLEVBQUU7UUFDUjtZQUNFLElBQUksRUFBRSxZQUFZO1lBQ2xCLE9BQU8sRUFBRSxJQUFJO1lBQ2IsUUFBUSxFQUFFLDBCQUFrQixDQUFDLElBQUk7U0FDbEM7UUFDRDtZQUNFLElBQUksRUFBRSxVQUFVO1lBQ2hCLE9BQU8sRUFBRSxJQUFJO1lBQ2IsUUFBUSxFQUFFLDBCQUFrQixDQUFDLElBQUksRUFBRSx5QkFBeUI7WUFDNUQsS0FBSyxFQUFFO2dCQUNMLE1BQU0sRUFBRSxFQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUUsRUFBRSx5QkFBeUI7YUFDdEQ7U0FDRjtRQUNEO1lBQ0UsSUFBSSxFQUFFLE1BQU07WUFDWixP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QVMsQ0FBQyxXQUFXLEVBQUUsV0FBVyxDQUFRLENBQUM7WUFDN0QsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLE1BQU0sQ0FBRSxHQUFHLENBQUUsR0FBRyxXQUFrQixDQUFDO1lBQ3JDLENBQUM7UUFDSCxDQUFDO2FBQU0sQ0FBQztZQUNOLE1BQU0sQ0FBRSxHQUFHLENBQUUsR0FBRyxXQUFrQixDQUFDO1FBQ3JDLENBQUM7SUFDSCxDQUFDO0lBRUQsT0FBTyxNQUFNLENBQUM7QUFDaEIsQ0FBQztBQUVEOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0EyQkc7QUFDSCxTQUFnQix5QkFBeUIsQ0FBQyxPQUl6QztJQUNDLE1BQU0sRUFBRSxNQUFNLEVBQUUsV0FBVyxFQUFFLFNBQVMsR0FBRyxFQUFFLEVBQUUsR0FBRyxPQUFPLENBQUM7SUFFeEQsSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO1FBQ2pCLE1BQU0sSUFBSSxLQUFLLENBQUMseURBQXlELENBQUMsQ0FBQztJQUM3RSxDQUFDO0lBRUQseUJBQXlCO0lBQ3pCLE1BQU0sVUFBVSxHQUFHLFNBQVMsQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUVyQyxtQkFBbUI7SUFDbkIsVUFBVSxDQUFDLFdBQVcsR0FBRyxXQUFXLENBQUM7SUFFckMsOEJBQThCO0lBQzlCLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7UUFDdEMsT0FBTyxTQUFTLENBQUMsVUFBVSxFQUFFLFNBQVMsQ0FBQyxDQUFDO0lBQzFDLENBQUM7SUFFRCxPQUFPLFVBQVUsQ0FBQztBQUNwQixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBPYnNlcnZhYmlsaXR5IENvbmZpZ3VyYXRpb24gUHJlc2V0c1xuICogXG4gKiBQcmUtY29uZmlndXJlZCBvYnNlcnZhYmlsaXR5IHNldHRpbmdzIGZvciBjb21tb24gZW52aXJvbm1lbnRzLlxuICogUHJvdmlkZXMgc2Vuc2libGUgZGVmYXVsdHMgdGhhdCBjYW4gYmUgb3ZlcnJpZGRlbiBhcyBuZWVkZWQuXG4gKi9cblxuaW1wb3J0IHsgT2JzZXJ2YWJpbGl0eUNvbmZpZywgT2JzZXJ2YWJpbGl0eUxldmVsIH0gZnJvbSAnLi90eXBlcyc7XG5cbi8qKlxuICogUHJlc2V0IG5hbWVzIGZvciBjb21tb24gZW52aXJvbm1lbnRzXG4gKi9cbmV4cG9ydCB0eXBlIE9ic2VydmFiaWxpdHlQcmVzZXQgPSAncHJvZHVjdGlvbicgfCAnZGV2ZWxvcG1lbnQnIHwgJ2RlYnVnJyB8ICdtaW5pbWFsJztcblxuLyoqXG4gKiBQcm9kdWN0aW9uIHByZXNldDogQ29zdC1vcHRpbWl6ZWQgd2l0aCBzbWFydCBzYW1wbGluZ1xuICogLSBTbWFydCBzYW1wbGluZyBlbmFibGVkIHdpdGggZXJyb3IgY29udGV4dCBjYXB0dXJlXG4gKiAtIDEwJSBzYW1wbGluZyBmb3Igbm9ybWFsIHRyYWZmaWNcbiAqIC0gRHluYW1vREIgb25seSBmb3IgV0FSTisgbG9nc1xuICogLSBDcml0aWNhbCBldmVudHMgYWx3YXlzIGNhcHR1cmVkXG4gKi9cbmV4cG9ydCBjb25zdCBwcm9kdWN0aW9uUHJlc2V0OiBPYnNlcnZhYmlsaXR5Q29uZmlnID0ge1xuICBlbmFibGVkOiB0cnVlLFxuICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLklORk8sXG4gIHNlcnZpY2VOYW1lOiAnJywgLy8gTXVzdCBiZSBwcm92aWRlZCBieSB1c2VyXG5cbiAgc2FtcGxpbmc6IHtcbiAgICBlbmFibGVkOiB0cnVlLFxuICAgIHNtYXJ0OiB0cnVlLFxuICAgIG1heEJ1ZmZlclNpemU6IDEwMDAsXG4gICAgcmF0ZXM6IHtcbiAgICAgIHRyYWNlOiAwLjAxLCAgICAvLyAxJSB0cmFjZSBsb2dzXG4gICAgICBkZWJ1ZzogMC4wMSwgICAgLy8gMSUgZGVidWcgbG9nc1xuICAgICAgaW5mbzogMC4xLCAgICAgIC8vIDEwJSBpbmZvIGxvZ3NcbiAgICAgIHdhcm46IDAuNSwgICAgICAvLyA1MCUgd2FybmluZ3NcbiAgICAgIGVycm9yOiAxLjAsICAgICAvLyAxMDAlIGVycm9yc1xuICAgICAgY3JpdGljYWw6IDEuMCwgIC8vIDEwMCUgY3JpdGljYWwgKGFsd2F5cylcbiAgICB9LFxuICB9LFxuXG4gIGJhY2tlbmRzOiBbXG4gICAge1xuICAgICAgdHlwZTogJ2Nsb3Vkd2F0Y2gnLFxuICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwuSU5GTyxcbiAgICB9LFxuICAgIHtcbiAgICAgIHR5cGU6ICdkeW5hbW9kYicsXG4gICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbC5XQVJOLCAvLyBPbmx5IFdBUk4rIHRvIER5bmFtb0RCXG4gICAgICB0eXBlczoge1xuICAgICAgICBtZXRyaWM6IHsgZW5hYmxlZDogZmFsc2UgfSwgLy8gTm8gbWV0cmljcyB0byBEeW5hbW9EQlxuICAgICAgfSxcbiAgICB9LFxuICAgIHtcbiAgICAgIHR5cGU6ICdvdGVsJyxcbiAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLklORk8sXG4gICAgfSxcbiAgXSxcblxuICB0eXBlczoge1xuICAgIHNwYW46IHtcbiAgICAgIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwuSU5GTyxcbiAgICAgIHNhbXBsaW5nOiB7IGVuYWJsZWQ6IHRydWUsIHJhdGU6IDAuMSB9LCAvLyAxMCUgb2Ygc3BhbnNcbiAgICB9LFxuICAgIG1ldHJpYzoge1xuICAgICAgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbC5JTkZPLFxuICAgICAgc2FtcGxpbmc6IHsgZW5hYmxlZDogZmFsc2UsIHJhdGU6IDEuMCB9LCAvLyBBbGwgbWV0cmljcyAobm8gc2FtcGxpbmcpXG4gICAgfSxcbiAgICBhdWRpdDoge1xuICAgICAgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbC5JTkZPLFxuICAgICAgc2FtcGxpbmc6IHsgZW5hYmxlZDogZmFsc2UsIHJhdGU6IDEuMCB9LCAvLyBBbGwgYXVkaXQgbG9nc1xuICAgIH0sXG4gICAgbG9nOiB7XG4gICAgICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLklORk8sXG4gICAgICBzYW1wbGluZzogeyBlbmFibGVkOiB0cnVlLCByYXRlOiAwLjEgfSwgLy8gMTAlIG9mIGxvZ3NcbiAgICB9LFxuICB9LFxuXG4gIGNsb3Vkd2F0Y2g6IHtcbiAgICBuYW1lc3BhY2U6ICdBcHBsaWNhdGlvbicsXG4gIH0sXG5cbiAgZHluYW1vZGI6IHtcbiAgICB0YWJsZUtleTogJ29ic2VydmFiaWxpdHknLFxuICAgIHR0bERheXM6IDMwLFxuICB9LFxuXG4gIGRhdGFQcm90ZWN0aW9uOiB7XG4gICAgZW5hYmxlZDogdHJ1ZSxcbiAgICBmdXp6eUtleU1hdGNoOiB0cnVlLFxuICAgIGNhc2VTZW5zaXRpdmVLZXlNYXRjaDogZmFsc2UsXG4gICAgYmxhY2tsaXN0ZWRLZXlzOiBbXG4gICAgICAncGFzc3dvcmQnLFxuICAgICAgJ3Rva2VuJyxcbiAgICAgICdzZWNyZXQnLFxuICAgICAgJ2FwaUtleScsXG4gICAgICAnYXV0aG9yaXphdGlvbicsXG4gICAgICAnY3JlZGl0Q2FyZCcsXG4gICAgICAnc3NuJyxcbiAgICAgIC9wcml2YXRlL2ksXG4gICAgXSxcbiAgfSxcbn07XG5cbi8qKlxuICogRGV2ZWxvcG1lbnQgcHJlc2V0OiBCYWxhbmNlZCB2aXNpYmlsaXR5IGFuZCBjb3N0XG4gKiAtIE1vcmUgdmVyYm9zZSB0aGFuIHByb2R1Y3Rpb25cbiAqIC0gNTAlIHNhbXBsaW5nIGZvciBtb3N0IGV2ZW50c1xuICogLSBBbGwgYmFja2VuZHMgZW5hYmxlZFxuICogLSBHb29kIGZvciBzdGFnaW5nIGVudmlyb25tZW50c1xuICovXG5leHBvcnQgY29uc3QgZGV2ZWxvcG1lbnRQcmVzZXQ6IE9ic2VydmFiaWxpdHlDb25maWcgPSB7XG4gIGVuYWJsZWQ6IHRydWUsXG4gIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwuREVCVUcsXG4gIHNlcnZpY2VOYW1lOiAnJywgLy8gTXVzdCBiZSBwcm92aWRlZCBieSB1c2VyXG5cbiAgc2FtcGxpbmc6IHtcbiAgICBlbmFibGVkOiB0cnVlLFxuICAgIHNtYXJ0OiB0cnVlLFxuICAgIG1heEJ1ZmZlclNpemU6IDEwMDAsXG4gICAgcmF0ZXM6IHtcbiAgICAgIHRyYWNlOiAwLjEsICAgIC8vIDEwJSB0cmFjZSBsb2dzXG4gICAgICBkZWJ1ZzogMC4zLCAgICAvLyAzMCUgZGVidWcgbG9nc1xuICAgICAgaW5mbzogMC41LCAgICAgLy8gNTAlIGluZm8gbG9nc1xuICAgICAgd2FybjogMS4wLCAgICAgLy8gMTAwJSB3YXJuaW5nc1xuICAgICAgZXJyb3I6IDEuMCwgICAgLy8gMTAwJSBlcnJvcnNcbiAgICAgIGNyaXRpY2FsOiAxLjAsIC8vIDEwMCUgY3JpdGljYWxcbiAgICB9LFxuICB9LFxuXG4gIGJhY2tlbmRzOiBbXG4gICAge1xuICAgICAgdHlwZTogJ2Nsb3Vkd2F0Y2gnLFxuICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwuREVCVUcsXG4gICAgfSxcbiAgICB7XG4gICAgICB0eXBlOiAnZHluYW1vZGInLFxuICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwuSU5GTyxcbiAgICB9LFxuICAgIHtcbiAgICAgIHR5cGU6ICdvdGVsJyxcbiAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLkRFQlVHLFxuICAgIH0sXG4gIF0sXG5cbiAgdHlwZXM6IHtcbiAgICBzcGFuOiB7XG4gICAgICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLkRFQlVHLFxuICAgICAgc2FtcGxpbmc6IHsgZW5hYmxlZDogdHJ1ZSwgcmF0ZTogMC41IH0sIC8vIDUwJSBvZiBzcGFuc1xuICAgIH0sXG4gICAgbWV0cmljOiB7XG4gICAgICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLkRFQlVHLFxuICAgICAgc2FtcGxpbmc6IHsgZW5hYmxlZDogZmFsc2UsIHJhdGU6IDEuMCB9LCAvLyBBbGwgbWV0cmljc1xuICAgIH0sXG4gICAgYXVkaXQ6IHtcbiAgICAgIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwuREVCVUcsXG4gICAgICBzYW1wbGluZzogeyBlbmFibGVkOiBmYWxzZSwgcmF0ZTogMS4wIH0sIC8vIEFsbCBhdWRpdCBsb2dzXG4gICAgfSxcbiAgICBsb2c6IHtcbiAgICAgIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwuREVCVUcsXG4gICAgICBzYW1wbGluZzogeyBlbmFibGVkOiB0cnVlLCByYXRlOiAwLjUgfSwgLy8gNTAlIG9mIGxvZ3NcbiAgICB9LFxuICB9LFxuXG4gIGNsb3Vkd2F0Y2g6IHtcbiAgICBuYW1lc3BhY2U6ICdBcHBsaWNhdGlvbicsXG4gIH0sXG5cbiAgZHluYW1vZGI6IHtcbiAgICB0YWJsZUtleTogJ29ic2VydmFiaWxpdHknLFxuICAgIHR0bERheXM6IDcsXG4gIH0sXG5cbiAgZGF0YVByb3RlY3Rpb246IHtcbiAgICBlbmFibGVkOiB0cnVlLFxuICAgIGZ1enp5S2V5TWF0Y2g6IHRydWUsXG4gICAgY2FzZVNlbnNpdGl2ZUtleU1hdGNoOiBmYWxzZSxcbiAgICBibGFja2xpc3RlZEtleXM6IFtcbiAgICAgICdwYXNzd29yZCcsXG4gICAgICAndG9rZW4nLFxuICAgICAgJ3NlY3JldCcsXG4gICAgICAnYXBpS2V5JyxcbiAgICAgICdhdXRob3JpemF0aW9uJyxcbiAgICAgICdjcmVkaXRDYXJkJyxcbiAgICAgICdzc24nLFxuICAgIF0sXG4gIH0sXG59O1xuXG4vKipcbiAqIERlYnVnIHByZXNldDogTWF4aW11bSB2aXNpYmlsaXR5LCBubyBzYW1wbGluZ1xuICogLSBBbGwgZXZlbnRzIGNhcHR1cmVkXG4gKiAtIEFsbCBsb2cgbGV2ZWxzIGVuYWJsZWRcbiAqIC0gVXNlZnVsIGZvciB0cm91Ymxlc2hvb3RpbmdcbiAqIC0g4pqg77iPIFdBUk5JTkc6IFZlcnkgZXhwZW5zaXZlLCB1c2Ugb25seSBmb3IgZGVidWdnaW5nXG4gKi9cbmV4cG9ydCBjb25zdCBkZWJ1Z1ByZXNldDogT2JzZXJ2YWJpbGl0eUNvbmZpZyA9IHtcbiAgZW5hYmxlZDogdHJ1ZSxcbiAgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbC5UUkFDRSxcbiAgc2VydmljZU5hbWU6ICcnLCAvLyBNdXN0IGJlIHByb3ZpZGVkIGJ5IHVzZXJcblxuICBzYW1wbGluZzoge1xuICAgIGVuYWJsZWQ6IGZhbHNlLCAvLyBObyBzYW1wbGluZyBpbiBkZWJ1ZyBtb2RlXG4gICAgc21hcnQ6IGZhbHNlLFxuICAgIG1heEJ1ZmZlclNpemU6IDIwMDAsXG4gIH0sXG5cbiAgYmFja2VuZHM6IFtcbiAgICB7XG4gICAgICB0eXBlOiAnY2xvdWR3YXRjaCcsXG4gICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbC5UUkFDRSxcbiAgICB9LFxuICAgIHtcbiAgICAgIHR5cGU6ICdkeW5hbW9kYicsXG4gICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbC5ERUJVRyxcbiAgICB9LFxuICAgIHtcbiAgICAgIHR5cGU6ICdvdGVsJyxcbiAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLlRSQUNFLFxuICAgIH0sXG4gIF0sXG5cbiAgdHlwZXM6IHtcbiAgICBzcGFuOiB7XG4gICAgICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLlRSQUNFLFxuICAgICAgc2FtcGxpbmc6IHsgZW5hYmxlZDogZmFsc2UsIHJhdGU6IDEuMCB9LFxuICAgIH0sXG4gICAgbWV0cmljOiB7XG4gICAgICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLlRSQUNFLFxuICAgICAgc2FtcGxpbmc6IHsgZW5hYmxlZDogZmFsc2UsIHJhdGU6IDEuMCB9LFxuICAgIH0sXG4gICAgYXVkaXQ6IHtcbiAgICAgIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwuVFJBQ0UsXG4gICAgICBzYW1wbGluZzogeyBlbmFibGVkOiBmYWxzZSwgcmF0ZTogMS4wIH0sXG4gICAgfSxcbiAgICBsb2c6IHtcbiAgICAgIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwuVFJBQ0UsXG4gICAgICBzYW1wbGluZzogeyBlbmFibGVkOiBmYWxzZSwgcmF0ZTogMS4wIH0sXG4gICAgfSxcbiAgfSxcblxuICBjbG91ZHdhdGNoOiB7XG4gICAgbmFtZXNwYWNlOiAnQXBwbGljYXRpb24nLFxuICB9LFxuXG4gIGR5bmFtb2RiOiB7XG4gICAgdGFibGVLZXk6ICdvYnNlcnZhYmlsaXR5JyxcbiAgICB0dGxEYXlzOiAxLFxuICB9LFxuXG4gIGRhdGFQcm90ZWN0aW9uOiB7XG4gICAgZW5hYmxlZDogZmFsc2UsIC8vIE5vIHJlZGFjdGlvbiBpbiBkZWJ1ZyBtb2RlXG4gIH0sXG59O1xuXG4vKipcbiAqIE1pbmltYWwgcHJlc2V0OiBCYXJlIG1pbmltdW0gb2JzZXJ2YWJpbGl0eVxuICogLSBPbmx5IGVycm9ycyBhbmQgY3JpdGljYWwgZXZlbnRzXG4gKiAtIE5vIHNhbXBsaW5nIG5lZWRlZCAoYWxyZWFkeSBmaWx0ZXJlZCBieSBsZXZlbClcbiAqIC0gQ2xvdWRXYXRjaCBvbmx5XG4gKiAtIExvd2VzdCBjb3N0IG9wdGlvblxuICovXG5leHBvcnQgY29uc3QgbWluaW1hbFByZXNldDogT2JzZXJ2YWJpbGl0eUNvbmZpZyA9IHtcbiAgZW5hYmxlZDogdHJ1ZSxcbiAgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbC5FUlJPUixcbiAgc2VydmljZU5hbWU6ICcnLCAvLyBNdXN0IGJlIHByb3ZpZGVkIGJ5IHVzZXJcblxuICBzYW1wbGluZzoge1xuICAgIGVuYWJsZWQ6IGZhbHNlLFxuICAgIHNtYXJ0OiBmYWxzZSxcbiAgfSxcblxuICBiYWNrZW5kczogW1xuICAgIHtcbiAgICAgIHR5cGU6ICdjbG91ZHdhdGNoJyxcbiAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLkVSUk9SLFxuICAgIH0sXG4gIF0sXG5cbiAgdHlwZXM6IHtcbiAgICBzcGFuOiB7XG4gICAgICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLkVSUk9SLFxuICAgICAgc2FtcGxpbmc6IHsgZW5hYmxlZDogZmFsc2UsIHJhdGU6IDEuMCB9LFxuICAgIH0sXG4gICAgbWV0cmljOiB7XG4gICAgICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLkVSUk9SLFxuICAgICAgc2FtcGxpbmc6IHsgZW5hYmxlZDogZmFsc2UsIHJhdGU6IDEuMCB9LFxuICAgIH0sXG4gICAgYXVkaXQ6IHtcbiAgICAgIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwuRVJST1IsXG4gICAgICBzYW1wbGluZzogeyBlbmFibGVkOiBmYWxzZSwgcmF0ZTogMS4wIH0sXG4gICAgfSxcbiAgICBsb2c6IHtcbiAgICAgIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwuRVJST1IsXG4gICAgICBzYW1wbGluZzogeyBlbmFibGVkOiBmYWxzZSwgcmF0ZTogMS4wIH0sXG4gICAgfSxcbiAgfSxcblxuICBjbG91ZHdhdGNoOiB7XG4gICAgbmFtZXNwYWNlOiAnQXBwbGljYXRpb24nLFxuICB9LFxuXG4gIGR5bmFtb2RiOiB7XG4gICAgdGFibGVLZXk6ICdvYnNlcnZhYmlsaXR5JyxcbiAgICB0dGxEYXlzOiA3LFxuICB9LFxuXG4gIGRhdGFQcm90ZWN0aW9uOiB7XG4gICAgZW5hYmxlZDogdHJ1ZSxcbiAgICBibGFja2xpc3RlZEtleXM6IFsgJ3Bhc3N3b3JkJywgJ3Rva2VuJywgJ3NlY3JldCcgXSxcbiAgfSxcbn07XG5cbi8qKlxuICogR2V0IHByZXNldCBjb25maWd1cmF0aW9uIGJ5IG5hbWVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdldFByZXNldChwcmVzZXQ6IE9ic2VydmFiaWxpdHlQcmVzZXQpOiBPYnNlcnZhYmlsaXR5Q29uZmlnIHtcbiAgc3dpdGNoIChwcmVzZXQpIHtcbiAgICBjYXNlICdwcm9kdWN0aW9uJzpcbiAgICAgIHJldHVybiB7IC4uLnByb2R1Y3Rpb25QcmVzZXQgfTtcbiAgICBjYXNlICdkZXZlbG9wbWVudCc6XG4gICAgICByZXR1cm4geyAuLi5kZXZlbG9wbWVudFByZXNldCB9O1xuICAgIGNhc2UgJ2RlYnVnJzpcbiAgICAgIHJldHVybiB7IC4uLmRlYnVnUHJlc2V0IH07XG4gICAgY2FzZSAnbWluaW1hbCc6XG4gICAgICByZXR1cm4geyAuLi5taW5pbWFsUHJlc2V0IH07XG4gICAgZGVmYXVsdDpcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBvYnNlcnZhYmlsaXR5IHByZXNldDogJHtwcmVzZXR9YCk7XG4gIH1cbn1cblxuLyoqXG4gKiBEZWVwIG1lcmdlIGhlbHBlciBmb3IgbmVzdGVkIG9iamVjdHNcbiAqL1xuZnVuY3Rpb24gZGVlcE1lcmdlPFQgZXh0ZW5kcyBSZWNvcmQ8c3RyaW5nLCBhbnk+Pih0YXJnZXQ6IFQsIHNvdXJjZTogUGFydGlhbDxUPik6IFQge1xuICBjb25zdCByZXN1bHQgPSB7IC4uLnRhcmdldCB9O1xuXG4gIGZvciAoY29uc3Qga2V5IGluIHNvdXJjZSkge1xuICAgIGNvbnN0IHNvdXJjZVZhbHVlID0gc291cmNlWyBrZXkgXTtcbiAgICBjb25zdCB0YXJnZXRWYWx1ZSA9IHJlc3VsdFsga2V5IF07XG5cbiAgICBpZiAoc291cmNlVmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoc291cmNlVmFsdWUpKSB7XG4gICAgICByZXN1bHRbIGtleSBdID0gc291cmNlVmFsdWUgYXMgYW55O1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIHNvdXJjZVZhbHVlID09PSAnb2JqZWN0JyAmJiBzb3VyY2VWYWx1ZSAhPT0gbnVsbCAmJiAhQXJyYXkuaXNBcnJheShzb3VyY2VWYWx1ZSkpIHtcbiAgICAgIGlmICh0eXBlb2YgdGFyZ2V0VmFsdWUgPT09ICdvYmplY3QnICYmIHRhcmdldFZhbHVlICE9PSBudWxsKSB7XG4gICAgICAgIHJlc3VsdFsga2V5IF0gPSBkZWVwTWVyZ2UodGFyZ2V0VmFsdWUsIHNvdXJjZVZhbHVlKSBhcyBhbnk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXN1bHRbIGtleSBdID0gc291cmNlVmFsdWUgYXMgYW55O1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICByZXN1bHRbIGtleSBdID0gc291cmNlVmFsdWUgYXMgYW55O1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiByZXN1bHQ7XG59XG5cbi8qKlxuICogQ3JlYXRlIG9ic2VydmFiaWxpdHkgY29uZmlndXJhdGlvbiB3aXRoIHByZXNldCBhbmQgb3ZlcnJpZGVzXG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBVc2UgcHJvZHVjdGlvbiBwcmVzZXQgd2l0aCBjdXN0b20gc2VydmljZSBuYW1lXG4gKiBjb25zdCBjb25maWcgPSBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnKHtcbiAqICAgcHJlc2V0OiAncHJvZHVjdGlvbicsXG4gKiAgIHNlcnZpY2VOYW1lOiAnbXktYXBpJ1xuICogfSk7XG4gKiBcbiAqIC8vIFVzZSBkZXZlbG9wbWVudCBwcmVzZXQgd2l0aCBjdXN0b20gc2FtcGxpbmdcbiAqIGNvbnN0IGNvbmZpZyA9IGNyZWF0ZU9ic2VydmFiaWxpdHlDb25maWcoe1xuICogICBwcmVzZXQ6ICdkZXZlbG9wbWVudCcsXG4gKiAgIHNlcnZpY2VOYW1lOiAnbXktYXBpJyxcbiAqICAgc2FtcGxpbmc6IHtcbiAqICAgICBzbWFydDogdHJ1ZSxcbiAqICAgICByYXRlczogeyBpbmZvOiAwLjggfVxuICogICB9XG4gKiB9KTtcbiAqIFxuICogLy8gVXNlIGRlYnVnIHByZXNldCB0ZW1wb3JhcmlseVxuICogY29uc3QgY29uZmlnID0gY3JlYXRlT2JzZXJ2YWJpbGl0eUNvbmZpZyh7XG4gKiAgIHByZXNldDogJ2RlYnVnJyxcbiAqICAgc2VydmljZU5hbWU6ICdteS1hcGknXG4gKiB9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlT2JzZXJ2YWJpbGl0eUNvbmZpZyhvcHRpb25zOiB7XG4gIHByZXNldDogT2JzZXJ2YWJpbGl0eVByZXNldDtcbiAgc2VydmljZU5hbWU6IHN0cmluZztcbiAgb3ZlcnJpZGVzPzogUGFydGlhbDxPYnNlcnZhYmlsaXR5Q29uZmlnPjtcbn0pOiBPYnNlcnZhYmlsaXR5Q29uZmlnIHtcbiAgY29uc3QgeyBwcmVzZXQsIHNlcnZpY2VOYW1lLCBvdmVycmlkZXMgPSB7fSB9ID0gb3B0aW9ucztcblxuICBpZiAoIXNlcnZpY2VOYW1lKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdzZXJ2aWNlTmFtZSBpcyByZXF1aXJlZCBmb3Igb2JzZXJ2YWJpbGl0eSBjb25maWd1cmF0aW9uJyk7XG4gIH1cblxuICAvLyBHZXQgYmFzZSBwcmVzZXQgY29uZmlnXG4gIGNvbnN0IGJhc2VDb25maWcgPSBnZXRQcmVzZXQocHJlc2V0KTtcblxuICAvLyBTZXQgc2VydmljZSBuYW1lXG4gIGJhc2VDb25maWcuc2VydmljZU5hbWUgPSBzZXJ2aWNlTmFtZTtcblxuICAvLyBBcHBseSBvdmVycmlkZXMgaWYgcHJvdmlkZWRcbiAgaWYgKE9iamVjdC5rZXlzKG92ZXJyaWRlcykubGVuZ3RoID4gMCkge1xuICAgIHJldHVybiBkZWVwTWVyZ2UoYmFzZUNvbmZpZywgb3ZlcnJpZGVzKTtcbiAgfVxuXG4gIHJldHVybiBiYXNlQ29uZmlnO1xufVxuXG4iXX0=