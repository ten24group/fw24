/**
 * Observability Configuration
 *
 * Shared types for configuring observability across controllers, tasks, and queues.
 */
import type { DataProtectionConfig } from './types';
/**
 * Base span metadata configuration.
 * Used by @Task, @Queue, and @Controller decorators for custom span context.
 */
export interface SpanMetadata {
    /**
     * Custom source identifier for observability context.
     * Defaults to handler name (task/queue/controller).
     * @example 'sports:scheduler:frequent'
     */
    source?: string;
    /**
     * Custom tags to add to spans and context.
     * @example { domain: 'sports', priority: 'high' }
     */
    tags?: Record<string, string>;
    /**
     * Additional attributes to add to the span.
     * @example { 'task.category': 'data-sync' }
     */
    attributes?: Record<string, unknown>;
}
/**
 * Request/response include configuration.
 * Controls what data is captured in spans.
 */
export interface ObservabilityIncludesConfig {
    /**
     * Request data to include in span attributes.
     * - `true` - include all (headers, body, query)
     * - `false` / undefined - include nothing (default)
     * - Array - include specific parts: ['headers', 'body', 'query']
     * - Object - include specific fields from each part
     */
    request?: boolean | ('headers' | 'body' | 'query')[] | {
        /** Include all headers (true) or specific header names */
        headers?: boolean | string[];
        /** Include full body (true) or specific field names */
        body?: boolean | string[];
        /** Include all query params (true) or specific param names */
        query?: boolean | string[];
    };
    /**
     * Response data to include in span attributes.
     * - `true` - include all (headers, body)
     * - `false` / undefined - include nothing (default)
     * - Array - include specific parts: ['headers', 'body']
     * - Object - include specific fields from each part
     */
    response?: boolean | ('headers' | 'body')[] | {
        /** Include all headers (true) or specific header names */
        headers?: boolean | string[];
        /** Include full body (true) or specific field names */
        body?: boolean | string[];
    };
}
/**
 * Controller/method observability configuration.
 * Extends base span metadata with HTTP request/response data capture options.
 */
export interface ControllerObservabilityConfig extends SpanMetadata {
    /**
     * Disable request/response capture for this controller/method.
     * Spans are still created; this only controls data capture.
     * @default true
     */
    enabled?: boolean;
    /** What request/response data to capture in span attributes */
    includes?: ObservabilityIncludesConfig;
    /** Data protection for captured request/response data */
    dataProtection?: DataProtectionConfig;
}
/**
 * Merge controller-level and method-level observability configs.
 * Method config takes precedence.
 */
export declare function mergeObservabilityConfigs(controllerConfig?: ControllerObservabilityConfig, methodConfig?: ControllerObservabilityConfig): ControllerObservabilityConfig | undefined;
/**
 * Normalize includes config to object form for processing.
 */
export declare function normalizeIncludes(includes?: ObservabilityIncludesConfig): {
    request: {
        headers: string[] | boolean;
        body: string[] | boolean;
        query: string[] | boolean;
    };
    response: {
        headers: string[] | boolean;
        body: string[] | boolean;
    };
};
/**
 * Select specific fields from an object.
 */
export declare function selectFields(obj: Record<string, unknown> | undefined, fields: string[] | boolean): Record<string, unknown> | undefined;
/**
 * Select fields from a JSON string body.
 */
export declare function selectFieldsFromBody(body: string | undefined, fields: string[] | boolean): unknown;
