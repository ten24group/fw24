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
const types_1 = require("./types");
const config_1 = require("./config");
/**
 * Production preset: Cost-optimized with smart sampling
 * - Smart sampling enabled with error context capture
 * - 10% sampling for normal traffic
 * - DynamoDB only for WARN+ logs
 * - Critical events always captured
 * - Spans < 100ms are skipped (unless they have errors)
 */
exports.productionPreset = (0, config_1.createObservabilityConfig)({
    enabled: true,
    minLevel: types_1.ObservabilityLevel.INFO,
    // NOTE: presets use framework defaults for serviceName / namespaces / tableKey.
    // Apps can override serviceName via createObservabilityConfig({ serviceName: 'my-app', ... }).
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
            minLevel: types_1.ObservabilityLevel.INFO, // Only WARN+ to DynamoDB
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
    dynamodb: { ttlDays: 30 },
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
    // Span-specific config for production
    spans: {
        minDurationMs: 100, // Skip spans < 100ms (production: focus on slow ops)
        skipEmpty: true, // Skip spans with no events/errors
    },
    // Noise reduction defaults for FW24 hot paths
    noiseReduction: {
        enabled: true,
        presets: ['fw24.hotpaths', 'fw24.batch_processors'],
    },
});
/**
 * Development preset: Balanced visibility and cost
 * - More verbose than production
 * - 50% sampling for most events
 * - All backends enabled
 * - Spans < 50ms skipped (lower threshold than production)
 * - Good for staging environments
 */
exports.developmentPreset = (0, config_1.createObservabilityConfig)({
    enabled: true,
    minLevel: types_1.ObservabilityLevel.DEBUG,
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
    dynamodb: { ttlDays: 7 },
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
    // Span-specific config for development
    spans: {
        minDurationMs: 50, // Skip spans < 50ms (dev: more visibility)
        skipEmpty: true, // Still skip empty spans
    },
    // Noise reduction defaults (keep dev usable under hot paths)
    noiseReduction: {
        enabled: true,
        presets: ['fw24.hotpaths', 'fw24.batch_processors'],
    },
});
/**
 * Debug preset: Maximum visibility, no sampling
 * - All events captured
 * - All log levels enabled
 * - ALL spans captured regardless of duration
 * - Useful for troubleshooting
 * - ⚠️ WARNING: Very expensive, use only for debugging
 */
exports.debugPreset = (0, config_1.createObservabilityConfig)({
    enabled: true,
    minLevel: types_1.ObservabilityLevel.TRACE,
    sampling: {
        enabled: false, // No sampling in debug mode
        smart: false,
        maxBufferSize: 5000,
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
    dynamodb: { ttlDays: 1 },
    dataProtection: {
        enabled: false, // No redaction in debug mode
    },
    sourceMap: {
        enabled: true, // Enable for maximum debugging
    },
    // Span-specific config for debug - capture EVERYTHING
    spans: {
        minDurationMs: 0, // Capture ALL spans regardless of duration
        skipEmpty: false, // Don't skip empty spans in debug
    },
    // Debug: do not reduce noise unless developer explicitly turns it on
    noiseReduction: {
        enabled: false,
    },
    // Debug: keep raw operation names for maximum fidelity unless developer opts-in.
    operationNormalization: {
        enabled: false,
        rules: [],
        storeOriginal: true,
    },
});
/**
 * Minimal preset: Bare minimum observability
 * - Only errors and critical events
 * - No sampling needed (already filtered by level)
 * - CloudWatch only
 * - Only capture failed/slow spans
 * - Lowest cost option
 */
exports.minimalPreset = (0, config_1.createObservabilityConfig)({
    enabled: true,
    minLevel: types_1.ObservabilityLevel.ERROR,
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
    dynamodb: { ttlDays: 7 },
    dataProtection: {
        enabled: true,
        blacklistedKeys: ['password', 'token', 'secret'],
    },
    // Span-specific config for minimal - only capture slow/failed spans
    spans: {
        minDurationMs: 500, // Only capture spans > 500ms (slow operations)
        skipEmpty: true, // Skip empty spans
    },
    noiseReduction: {
        enabled: true,
        presets: ['fw24.hotpaths', 'fw24.batch_processors'],
    },
    sourceMap: {
        enabled: false, // Minimal preset disables optional features
    },
});
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHJlc2V0cy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L3ByZXNldHMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7OztHQUtHOzs7QUE0V0gsOEJBYUM7QUF2WEQsbUNBQWtFO0FBQ2xFLHFDQUEyRjtBQU8zRjs7Ozs7OztHQU9HO0FBQ1UsUUFBQSxnQkFBZ0IsR0FBd0IsSUFBQSxrQ0FBa0MsRUFBQztJQUN0RixPQUFPLEVBQUUsSUFBSTtJQUNiLFFBQVEsRUFBRSwwQkFBa0IsQ0FBQyxJQUFJO0lBQ2pDLGdGQUFnRjtJQUNoRiwrRkFBK0Y7SUFFL0YsUUFBUSxFQUFFO1FBQ1IsT0FBTyxFQUFFLElBQUk7UUFDYixLQUFLLEVBQUUsSUFBSTtRQUNYLGFBQWEsRUFBRSxJQUFJO1FBQ25CLEtBQUssRUFBRTtZQUNMLEtBQUssRUFBRSxJQUFJLEVBQUssZ0JBQWdCO1lBQ2hDLEtBQUssRUFBRSxJQUFJLEVBQUssZ0JBQWdCO1lBQ2hDLElBQUksRUFBRSxHQUFHLEVBQU8sZ0JBQWdCO1lBQ2hDLElBQUksRUFBRSxHQUFHLEVBQU8sZUFBZTtZQUMvQixLQUFLLEVBQUUsR0FBRyxFQUFNLGNBQWM7WUFDOUIsUUFBUSxFQUFFLEdBQUcsRUFBRyx5QkFBeUI7U0FDMUM7S0FDRjtJQUVELFFBQVEsRUFBRTtRQUNSO1lBQ0UsSUFBSSxFQUFFLFlBQVk7WUFDbEIsT0FBTyxFQUFFLElBQUk7WUFDYixRQUFRLEVBQUUsMEJBQWtCLENBQUMsSUFBSTtTQUNsQztRQUNEO1lBQ0UsSUFBSSxFQUFFLFVBQVU7WUFDaEIsT0FBTyxFQUFFLElBQUk7WUFDYixRQUFRLEVBQUUsMEJBQWtCLENBQUMsSUFBSSxFQUFFLHlCQUF5QjtZQUM1RCxLQUFLLEVBQUU7Z0JBQ0wsTUFBTSxFQUFFLEVBQUUsT0FBTyxFQUFFLEtBQUssRUFBRSxFQUFFLHlCQUF5QjthQUN0RDtTQUNGO1FBQ0Q7WUFDRSxJQUFJLEVBQUUs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RUFBRSxDQUFDO1FBQ2xDLEtBQUssT0FBTztZQUNWLE9BQU8sRUFBRSxHQUFHLG1CQUFXLEVBQUUsQ0FBQztRQUM1QixLQUFLLFNBQVM7WUFDWixPQUFPLEVBQUUsR0FBRyxxQkFBYSxFQUFFLENBQUM7UUFDOUI7WUFDRSxNQUFNLElBQUksS0FBSyxDQUFDLGlDQUFpQyxNQUFNLEVBQUUsQ0FBQyxDQUFDO0lBQy9ELENBQUM7QUFDSCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBPYnNlcnZhYmlsaXR5IENvbmZpZ3VyYXRpb24gUHJlc2V0c1xuICogXG4gKiBQcmUtY29uZmlndXJlZCBvYnNlcnZhYmlsaXR5IHNldHRpbmdzIGZvciBjb21tb24gZW52aXJvbm1lbnRzLlxuICogUHJvdmlkZXMgc2Vuc2libGUgZGVmYXVsdHMgdGhhdCBjYW4gYmUgb3ZlcnJpZGRlbiBhcyBuZWVkZWQuXG4gKi9cblxuaW1wb3J0IHsgT2JzZXJ2YWJpbGl0eUNvbmZpZywgT2JzZXJ2YWJpbGl0eUxldmVsIH0gZnJvbSAnLi90eXBlcyc7XG5pbXBvcnQgeyBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnIGFzIGNyZWF0ZU9ic2VydmFiaWxpdHlDb25maWdGcm9tSW5wdXQgfSBmcm9tICcuL2NvbmZpZyc7XG5cbi8qKlxuICogUHJlc2V0IG5hbWVzIGZvciBjb21tb24gZW52aXJvbm1lbnRzXG4gKi9cbmV4cG9ydCB0eXBlIE9ic2VydmFiaWxpdHlQcmVzZXQgPSAncHJvZHVjdGlvbicgfCAnZGV2ZWxvcG1lbnQnIHwgJ2RlYnVnJyB8ICdtaW5pbWFsJztcblxuLyoqXG4gKiBQcm9kdWN0aW9uIHByZXNldDogQ29zdC1vcHRpbWl6ZWQgd2l0aCBzbWFydCBzYW1wbGluZ1xuICogLSBTbWFydCBzYW1wbGluZyBlbmFibGVkIHdpdGggZXJyb3IgY29udGV4dCBjYXB0dXJlXG4gKiAtIDEwJSBzYW1wbGluZyBmb3Igbm9ybWFsIHRyYWZmaWNcbiAqIC0gRHluYW1vREIgb25seSBmb3IgV0FSTisgbG9nc1xuICogLSBDcml0aWNhbCBldmVudHMgYWx3YXlzIGNhcHR1cmVkXG4gKiAtIFNwYW5zIDwgMTAwbXMgYXJlIHNraXBwZWQgKHVubGVzcyB0aGV5IGhhdmUgZXJyb3JzKVxuICovXG5leHBvcnQgY29uc3QgcHJvZHVjdGlvblByZXNldDogT2JzZXJ2YWJpbGl0eUNvbmZpZyA9IGNyZWF0ZU9ic2VydmFiaWxpdHlDb25maWdGcm9tSW5wdXQoe1xuICBlbmFibGVkOiB0cnVlLFxuICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLklORk8sXG4gIC8vIE5PVEU6IHByZXNldHMgdXNlIGZyYW1ld29yayBkZWZhdWx0cyBmb3Igc2VydmljZU5hbWUgLyBuYW1lc3BhY2VzIC8gdGFibGVLZXkuXG4gIC8vIEFwcHMgY2FuIG92ZXJyaWRlIHNlcnZpY2VOYW1lIHZpYSBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnKHsgc2VydmljZU5hbWU6ICdteS1hcHAnLCAuLi4gfSkuXG5cbiAgc2FtcGxpbmc6IHtcbiAgICBlbmFibGVkOiB0cnVlLFxuICAgIHNtYXJ0OiB0cnVlLFxuICAgIG1heEJ1ZmZlclNpemU6IDEwMDAsXG4gICAgcmF0ZXM6IHtcbiAgICAgIHRyYWNlOiAwLjAxLCAgICAvLyAxJSB0cmFjZSBsb2dzXG4gICAgICBkZWJ1ZzogMC4wMSwgICAgLy8gMSUgZGVidWcgbG9nc1xuICAgICAgaW5mbzogMC4xLCAgICAgIC8vIDEwJSBpbmZvIGxvZ3NcbiAgICAgIHdhcm46IDAuNSwgICAgICAvLyA1MCUgd2FybmluZ3NcbiAgICAgIGVycm9yOiAxLjAsICAgICAvLyAxMDAlIGVycm9yc1xuICAgICAgY3JpdGljYWw6IDEuMCwgIC8vIDEwMCUgY3JpdGljYWwgKGFsd2F5cylcbiAgICB9LFxuICB9LFxuXG4gIGJhY2tlbmRzOiBbXG4gICAge1xuICAgICAgdHlwZTogJ2Nsb3Vkd2F0Y2gnLFxuICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwuSU5GTyxcbiAgICB9LFxuICAgIHtcbiAgICAgIHR5cGU6ICdkeW5hbW9kYicsXG4gICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbC5JTkZPLCAvLyBPbmx5IFdBUk4rIHRvIER5bmFtb0RCXG4gICAgICB0eXBlczoge1xuICAgICAgICBtZXRyaWM6IHsgZW5hYmxlZDogZmFsc2UgfSwgLy8gTm8gbWV0cmljcyB0byBEeW5hbW9EQlxuICAgICAgfSxcbiAgICB9LFxuICAgIHtcbiAgICAgIHR5cGU6ICdvdGVsJyxcbiAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLklORk8sXG4gICAgfSxcbiAgXSxcblxuICB0eXBlczoge1xuICAgIHNwYW46IHtcbiAgICAgIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwuSU5GTyxcbiAgICAgIHNhbXBsaW5nOiB7IGVuYWJsZWQ6IHRydWUsIHJhdGU6IDAuMSB9LCAvLyAxMCUgb2Ygc3BhbnNcbiAgICB9LFxuICAgIG1ldHJpYzoge1xuICAgICAgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbC5JTkZPLFxuICAgICAgc2FtcGxpbmc6IHsgZW5hYmxlZDogZmFsc2UsIHJhdGU6IDEuMCB9LCAvLyBBbGwgbWV0cmljcyAobm8gc2FtcGxpbmcpXG4gICAgfSxcbiAgICBhdWRpdDoge1xuICAgICAgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbC5JTkZPLFxuICAgICAgc2FtcGxpbmc6IHsgZW5hYmxlZDogZmFsc2UsIHJhdGU6IDEuMCB9LCAvLyBBbGwgYXVkaXQgbG9nc1xuICAgIH0sXG4gICAgbG9nOiB7XG4gICAgICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLklORk8sXG4gICAgICBzYW1wbGluZzogeyBlbmFibGVkOiB0cnVlLCByYXRlOiAwLjEgfSwgLy8gMTAlIG9mIGxvZ3NcbiAgICB9LFxuICB9LFxuXG4gIGR5bmFtb2RiOiB7IHR0bERheXM6IDMwIH0sXG5cbiAgZGF0YVByb3RlY3Rpb246IHtcbiAgICBlbmFibGVkOiB0cnVlLFxuICAgIGZ1enp5S2V5TWF0Y2g6IHRydWUsXG4gICAgY2FzZVNlbnNpdGl2ZUtleU1hdGNoOiBmYWxzZSxcbiAgICBibGFja2xpc3RlZEtleXM6IFtcbiAgICAgICdwYXNzd29yZCcsXG4gICAgICAndG9rZW4nLFxuICAgICAgJ3NlY3JldCcsXG4gICAgICAnYXBpS2V5JyxcbiAgICAgICdhdXRob3JpemF0aW9uJyxcbiAgICAgICdjcmVkaXRDYXJkJyxcbiAgICAgICdzc24nLFxuICAgICAgL3ByaXZhdGUvaSxcbiAgICBdLFxuICB9LFxuXG4gIHNvdXJjZU1hcDoge1xuICAgIGVuYWJsZWQ6IHRydWUsIC8vIEVuYWJsZSBpbiBwcm9kdWN0aW9uIGZvciBiZXR0ZXIgZXJyb3IgZGVidWdnaW5nXG4gIH0sXG5cbiAgLy8gU3Bhbi1zcGVjaWZpYyBjb25maWcgZm9yIHByb2R1Y3Rpb25cbiAgc3BhbnM6IHtcbiAgICBtaW5EdXJhdGlvbk1zOiAxMDAsICAgLy8gU2tpcCBzcGFucyA8IDEwMG1zIChwcm9kdWN0aW9uOiBmb2N1cyBvbiBzbG93IG9wcylcbiAgICBza2lwRW1wdHk6IHRydWUsICAgICAgLy8gU2tpcCBzcGFucyB3aXRoIG5vIGV2ZW50cy9lcnJvcnNcbiAgfSxcblxuICAvLyBOb2lzZSByZWR1Y3Rpb24gZGVmYXVsdHMgZm9yIEZXMjQgaG90IHBhdGhzXG4gIG5vaXNlUmVkdWN0aW9uOiB7XG4gICAgZW5hYmxlZDogdHJ1ZSxcbiAgICBwcmVzZXRzOiBbICdmdzI0LmhvdHBhdGhzJywgJ2Z3MjQuYmF0Y2hfcHJvY2Vzc29ycycgXSxcbiAgfSxcbn0pO1xuXG4vKipcbiAqIERldmVsb3BtZW50IHByZXNldDogQmFsYW5jZWQgdmlzaWJpbGl0eSBhbmQgY29zdFxuICogLSBNb3JlIHZlcmJvc2UgdGhhbiBwcm9kdWN0aW9uXG4gKiAtIDUwJSBzYW1wbGluZyBmb3IgbW9zdCBldmVudHNcbiAqIC0gQWxsIGJhY2tlbmRzIGVuYWJsZWRcbiAqIC0gU3BhbnMgPCA1MG1zIHNraXBwZWQgKGxvd2VyIHRocmVzaG9sZCB0aGFuIHByb2R1Y3Rpb24pXG4gKiAtIEdvb2QgZm9yIHN0YWdpbmcgZW52aXJvbm1lbnRzXG4gKi9cbmV4cG9ydCBjb25zdCBkZXZlbG9wbWVudFByZXNldDogT2JzZXJ2YWJpbGl0eUNvbmZpZyA9IGNyZWF0ZU9ic2VydmFiaWxpdHlDb25maWdGcm9tSW5wdXQoe1xuICBlbmFibGVkOiB0cnVlLFxuICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLkRFQlVHLFxuXG4gIHNhbXBsaW5nOiB7XG4gICAgZW5hYmxlZDogdHJ1ZSxcbiAgICBzbWFydDogdHJ1ZSxcbiAgICBtYXhCdWZmZXJTaXplOiAxMDAwLFxuICAgIHJhdGVzOiB7XG4gICAgICB0cmFjZTogMC4xLCAgICAvLyAxMCUgdHJhY2UgbG9nc1xuICAgICAgZGVidWc6IDAuMywgICAgLy8gMzAlIGRlYnVnIGxvZ3NcbiAgICAgIGluZm86IDAuNSwgICAgIC8vIDUwJSBpbmZvIGxvZ3NcbiAgICAgIHdhcm46IDEuMCwgICAgIC8vIDEwMCUgd2FybmluZ3NcbiAgICAgIGVycm9yOiAxLjAsICAgIC8vIDEwMCUgZXJyb3JzXG4gICAgICBjcml0aWNhbDogMS4wLCAvLyAxMDAlIGNyaXRpY2FsXG4gICAgfSxcbiAgfSxcblxuICBiYWNrZW5kczogW1xuICAgIHtcbiAgICAgIHR5cGU6ICdjbG91ZHdhdGNoJyxcbiAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLkRFQlVHLFxuICAgIH0sXG4gICAge1xuICAgICAgdHlwZTogJ2R5bmFtb2RiJyxcbiAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLklORk8sXG4gICAgfSxcbiAgICB7XG4gICAgICB0eXBlOiAnb3RlbCcsXG4gICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbC5ERUJVRyxcbiAgICB9LFxuICBdLFxuXG4gIHR5cGVzOiB7XG4gICAgc3Bhbjoge1xuICAgICAgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbC5ERUJVRyxcbiAgICAgIHNhbXBsaW5nOiB7IGVuYWJsZWQ6IHRydWUsIHJhdGU6IDAuNSB9LCAvLyA1MCUgb2Ygc3BhbnNcbiAgICB9LFxuICAgIG1ldHJpYzoge1xuICAgICAgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbC5ERUJVRyxcbiAgICAgIHNhbXBsaW5nOiB7IGVuYWJsZWQ6IGZhbHNlLCByYXRlOiAxLjAgfSwgLy8gQWxsIG1ldHJpY3NcbiAgICB9LFxuICAgIGF1ZGl0OiB7XG4gICAgICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLkRFQlVHLFxuICAgICAgc2FtcGxpbmc6IHsgZW5hYmxlZDogZmFsc2UsIHJhdGU6IDEuMCB9LCAvLyBBbGwgYXVkaXQgbG9nc1xuICAgIH0sXG4gICAgbG9nOiB7XG4gICAgICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLkRFQlVHLFxuICAgICAgc2FtcGxpbmc6IHsgZW5hYmxlZDogdHJ1ZSwgcmF0ZTogMC41IH0sIC8vIDUwJSBvZiBsb2dzXG4gICAgfSxcbiAgfSxcblxuICBkeW5hbW9kYjogeyB0dGxEYXlzOiA3IH0sXG5cbiAgZGF0YVByb3RlY3Rpb246IHtcbiAgICBlbmFibGVkOiB0cnVlLFxuICAgIGZ1enp5S2V5TWF0Y2g6IHRydWUsXG4gICAgY2FzZVNlbnNpdGl2ZUtleU1hdGNoOiBmYWxzZSxcbiAgICBibGFja2xpc3RlZEtleXM6IFtcbiAgICAgICdwYXNzd29yZCcsXG4gICAgICAndG9rZW4nLFxuICAgICAgJ3NlY3JldCcsXG4gICAgICAnYXBpS2V5JyxcbiAgICAgICdhdXRob3JpemF0aW9uJyxcbiAgICAgICdjcmVkaXRDYXJkJyxcbiAgICAgICdzc24nLFxuICAgIF0sXG4gIH0sXG5cbiAgc291cmNlTWFwOiB7XG4gICAgZW5hYmxlZDogdHJ1ZSwgLy8gRW5hYmxlIGZvciBiZXR0ZXIgZXJyb3IgZGVidWdnaW5nXG4gIH0sXG5cbiAgLy8gU3Bhbi1zcGVjaWZpYyBjb25maWcgZm9yIGRldmVsb3BtZW50XG4gIHNwYW5zOiB7XG4gICAgbWluRHVyYXRpb25NczogNTAsICAgIC8vIFNraXAgc3BhbnMgPCA1MG1zIChkZXY6IG1vcmUgdmlzaWJpbGl0eSlcbiAgICBza2lwRW1wdHk6IHRydWUsICAgICAgLy8gU3RpbGwgc2tpcCBlbXB0eSBzcGFuc1xuICB9LFxuXG4gIC8vIE5vaXNlIHJlZHVjdGlvbiBkZWZhdWx0cyAoa2VlcCBkZXYgdXNhYmxlIHVuZGVyIGhvdCBwYXRocylcbiAgbm9pc2VSZWR1Y3Rpb246IHtcbiAgICBlbmFibGVkOiB0cnVlLFxuICAgIHByZXNldHM6IFsgJ2Z3MjQuaG90cGF0aHMnLCAnZncyNC5iYXRjaF9wcm9jZXNzb3JzJyBdLFxuICB9LFxufSk7XG5cbi8qKlxuICogRGVidWcgcHJlc2V0OiBNYXhpbXVtIHZpc2liaWxpdHksIG5vIHNhbXBsaW5nXG4gKiAtIEFsbCBldmVudHMgY2FwdHVyZWRcbiAqIC0gQWxsIGxvZyBsZXZlbHMgZW5hYmxlZFxuICogLSBBTEwgc3BhbnMgY2FwdHVyZWQgcmVnYXJkbGVzcyBvZiBkdXJhdGlvblxuICogLSBVc2VmdWwgZm9yIHRyb3VibGVzaG9vdGluZ1xuICogLSDimqDvuI8gV0FSTklORzogVmVyeSBleHBlbnNpdmUsIHVzZSBvbmx5IGZvciBkZWJ1Z2dpbmdcbiAqL1xuZXhwb3J0IGNvbnN0IGRlYnVnUHJlc2V0OiBPYnNlcnZhYmlsaXR5Q29uZmlnID0gY3JlYXRlT2JzZXJ2YWJpbGl0eUNvbmZpZ0Zyb21JbnB1dCh7XG4gIGVuYWJsZWQ6IHRydWUsXG4gIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwuVFJBQ0UsXG5cbiAgc2FtcGxpbmc6IHtcbiAgICBlbmFibGVkOiBmYWxzZSwgLy8gTm8gc2FtcGxpbmcgaW4gZGVidWcgbW9kZVxuICAgIHNtYXJ0OiBmYWxzZSxcbiAgICBtYXhCdWZmZXJTaXplOiA1MDAwLFxuICB9LFxuXG4gIGJhY2tlbmRzOiBbXG4gICAge1xuICAgICAgdHlwZTogJ2Nsb3Vkd2F0Y2gnLFxuICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwuVFJBQ0UsXG4gICAgfSxcbiAgICB7XG4gICAgICB0eXBlOiAnZHluYW1vZGInLFxuICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwuREVCVUcsXG4gICAgfSxcbiAgICB7XG4gICAgICB0eXBlOiAnb3RlbCcsXG4gICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbC5UUkFDRSxcbiAgICB9LFxuICBdLFxuXG4gIHR5cGVzOiB7XG4gICAgc3Bhbjoge1xuICAgICAgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbC5UUkFDRSxcbiAgICAgIHNhbXBsaW5nOiB7IGVuYWJsZWQ6IGZhbHNlLCByYXRlOiAxLjAgfSxcbiAgICB9LFxuICAgIG1ldHJpYzoge1xuICAgICAgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbC5UUkFDRSxcbiAgICAgIHNhbXBsaW5nOiB7IGVuYWJsZWQ6IGZhbHNlLCByYXRlOiAxLjAgfSxcbiAgICB9LFxuICAgIGF1ZGl0OiB7XG4gICAgICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLlRSQUNFLFxuICAgICAgc2FtcGxpbmc6IHsgZW5hYmxlZDogZmFsc2UsIHJhdGU6IDEuMCB9LFxuICAgIH0sXG4gICAgbG9nOiB7XG4gICAgICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLlRSQUNFLFxuICAgICAgc2FtcGxpbmc6IHsgZW5hYmxlZDogZmFsc2UsIHJhdGU6IDEuMCB9LFxuICAgIH0sXG4gIH0sXG5cbiAgZHluYW1vZGI6IHsgdHRsRGF5czogMSB9LFxuXG4gIGRhdGFQcm90ZWN0aW9uOiB7XG4gICAgZW5hYmxlZDogZmFsc2UsIC8vIE5vIHJlZGFjdGlvbiBpbiBkZWJ1ZyBtb2RlXG4gIH0sXG5cbiAgc291cmNlTWFwOiB7XG4gICAgZW5hYmxlZDogdHJ1ZSwgLy8gRW5hYmxlIGZvciBtYXhpbXVtIGRlYnVnZ2luZ1xuICB9LFxuXG4gIC8vIFNwYW4tc3BlY2lmaWMgY29uZmlnIGZvciBkZWJ1ZyAtIGNhcHR1cmUgRVZFUllUSElOR1xuICBzcGFuczoge1xuICAgIG1pbkR1cmF0aW9uTXM6IDAsICAgICAvLyBDYXB0dXJlIEFMTCBzcGFucyByZWdhcmRsZXNzIG9mIGR1cmF0aW9uXG4gICAgc2tpcEVtcHR5OiBmYWxzZSwgICAgIC8vIERvbid0IHNraXAgZW1wdHkgc3BhbnMgaW4gZGVidWdcbiAgfSxcblxuICAvLyBEZWJ1ZzogZG8gbm90IHJlZHVjZSBub2lzZSB1bmxlc3MgZGV2ZWxvcGVyIGV4cGxpY2l0bHkgdHVybnMgaXQgb25cbiAgbm9pc2VSZWR1Y3Rpb246IHtcbiAgICBlbmFibGVkOiBmYWxzZSxcbiAgfSxcblxuICAvLyBEZWJ1Zzoga2VlcCByYXcgb3BlcmF0aW9uIG5hbWVzIGZvciBtYXhpbXVtIGZpZGVsaXR5IHVubGVzcyBkZXZlbG9wZXIgb3B0cy1pbi5cbiAgb3BlcmF0aW9uTm9ybWFsaXphdGlvbjoge1xuICAgIGVuYWJsZWQ6IGZhbHNlLFxuICAgIHJ1bGVzOiBbXSxcbiAgICBzdG9yZU9yaWdpbmFsOiB0cnVlLFxuICB9LFxufSk7XG5cbi8qKlxuICogTWluaW1hbCBwcmVzZXQ6IEJhcmUgbWluaW11bSBvYnNlcnZhYmlsaXR5XG4gKiAtIE9ubHkgZXJyb3JzIGFuZCBjcml0aWNhbCBldmVudHNcbiAqIC0gTm8gc2FtcGxpbmcgbmVlZGVkIChhbHJlYWR5IGZpbHRlcmVkIGJ5IGxldmVsKVxuICogLSBDbG91ZFdhdGNoIG9ubHlcbiAqIC0gT25seSBjYXB0dXJlIGZhaWxlZC9zbG93IHNwYW5zXG4gKiAtIExvd2VzdCBjb3N0IG9wdGlvblxuICovXG5leHBvcnQgY29uc3QgbWluaW1hbFByZXNldDogT2JzZXJ2YWJpbGl0eUNvbmZpZyA9IGNyZWF0ZU9ic2VydmFiaWxpdHlDb25maWdGcm9tSW5wdXQoe1xuICBlbmFibGVkOiB0cnVlLFxuICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLkVSUk9SLFxuXG4gIHNhbXBsaW5nOiB7XG4gICAgZW5hYmxlZDogZmFsc2UsXG4gICAgc21hcnQ6IGZhbHNlLFxuICB9LFxuXG4gIGJhY2tlbmRzOiBbXG4gICAge1xuICAgICAgdHlwZTogJ2Nsb3Vkd2F0Y2gnLFxuICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwuRVJST1IsXG4gICAgfSxcbiAgXSxcblxuICB0eXBlczoge1xuICAgIHNwYW46IHtcbiAgICAgIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwuRVJST1IsXG4gICAgICBzYW1wbGluZzogeyBlbmFibGVkOiBmYWxzZSwgcmF0ZTogMS4wIH0sXG4gICAgfSxcbiAgICBtZXRyaWM6IHtcbiAgICAgIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwuRVJST1IsXG4gICAgICBzYW1wbGluZzogeyBlbmFibGVkOiBmYWxzZSwgcmF0ZTogMS4wIH0sXG4gICAgfSxcbiAgICBhdWRpdDoge1xuICAgICAgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbC5FUlJPUixcbiAgICAgIHNhbXBsaW5nOiB7IGVuYWJsZWQ6IGZhbHNlLCByYXRlOiAxLjAgfSxcbiAgICB9LFxuICAgIGxvZzoge1xuICAgICAgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbC5FUlJPUixcbiAgICAgIHNhbXBsaW5nOiB7IGVuYWJsZWQ6IGZhbHNlLCByYXRlOiAxLjAgfSxcbiAgICB9LFxuICB9LFxuXG4gIGR5bmFtb2RiOiB7IHR0bERheXM6IDcgfSxcblxuICBkYXRhUHJvdGVjdGlvbjoge1xuICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgYmxhY2tsaXN0ZWRLZXlzOiBbICdwYXNzd29yZCcsICd0b2tlbicsICdzZWNyZXQnIF0sXG4gIH0sXG5cbiAgLy8gU3Bhbi1zcGVjaWZpYyBjb25maWcgZm9yIG1pbmltYWwgLSBvbmx5IGNhcHR1cmUgc2xvdy9mYWlsZWQgc3BhbnNcbiAgc3BhbnM6IHtcbiAgICBtaW5EdXJhdGlvbk1zOiA1MDAsICAgLy8gT25seSBjYXB0dXJlIHNwYW5zID4gNTAwbXMgKHNsb3cgb3BlcmF0aW9ucylcbiAgICBza2lwRW1wdHk6IHRydWUsICAgICAgLy8gU2tpcCBlbXB0eSBzcGFuc1xuICB9LFxuXG4gIG5vaXNlUmVkdWN0aW9uOiB7XG4gICAgZW5hYmxlZDogdHJ1ZSxcbiAgICBwcmVzZXRzOiBbICdmdzI0LmhvdHBhdGhzJywgJ2Z3MjQuYmF0Y2hfcHJvY2Vzc29ycycgXSxcbiAgfSxcblxuICBzb3VyY2VNYXA6IHtcbiAgICBlbmFibGVkOiBmYWxzZSwgLy8gTWluaW1hbCBwcmVzZXQgZGlzYWJsZXMgb3B0aW9uYWwgZmVhdHVyZXNcbiAgfSxcbn0pO1xuXG4vKipcbiAqIEdldCBwcmVzZXQgY29uZmlndXJhdGlvbiBieSBuYW1lXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZXRQcmVzZXQocHJlc2V0OiBPYnNlcnZhYmlsaXR5UHJlc2V0KTogT2JzZXJ2YWJpbGl0eUNvbmZpZyB7XG4gIHN3aXRjaCAocHJlc2V0KSB7XG4gICAgY2FzZSAncHJvZHVjdGlvbic6XG4gICAgICByZXR1cm4geyAuLi5wcm9kdWN0aW9uUHJlc2V0IH07XG4gICAgY2FzZSAnZGV2ZWxvcG1lbnQnOlxuICAgICAgcmV0dXJuIHsgLi4uZGV2ZWxvcG1lbnRQcmVzZXQgfTtcbiAgICBjYXNlICdkZWJ1Zyc6XG4gICAgICByZXR1cm4geyAuLi5kZWJ1Z1ByZXNldCB9O1xuICAgIGNhc2UgJ21pbmltYWwnOlxuICAgICAgcmV0dXJuIHsgLi4ubWluaW1hbFByZXNldCB9O1xuICAgIGRlZmF1bHQ6XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gb2JzZXJ2YWJpbGl0eSBwcmVzZXQ6ICR7cHJlc2V0fWApO1xuICB9XG59Il19