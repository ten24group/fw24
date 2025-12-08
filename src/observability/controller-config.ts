/**
 * Controller Observability Configuration
 * 
 * Configures what request/response data to capture in spans.
 * 
 * Usage:
 * ```typescript
 * @Controller('payments', {
 *   observability: {
 *     includes: {
 *       request: { headers: ['content-type'], body: true },
 *       response: { body: ['id', 'status'] }
 *     },
 *     dataProtection: { enabled: true }
 *   }
 * })
 * export class PaymentsController extends APIController { }
 * ```
 */

import { DataProtectionConfig } from './utils/data-protection';

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
 */
export interface ControllerObservabilityConfig {
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
export function mergeObservabilityConfigs(
  controllerConfig?: ControllerObservabilityConfig,
  methodConfig?: ControllerObservabilityConfig
): ControllerObservabilityConfig | undefined {
  if (!controllerConfig && !methodConfig) return undefined;
  if (!controllerConfig) return methodConfig;
  if (!methodConfig) return controllerConfig;

  const merged: ControllerObservabilityConfig = {
    enabled: methodConfig.enabled ?? controllerConfig.enabled,
  };

  // Method includes takes full precedence if defined
  if (methodConfig.includes !== undefined) {
    merged.includes = methodConfig.includes;
  } else if (controllerConfig.includes !== undefined) {
    merged.includes = controllerConfig.includes;
  }

  // Merge data protection
  if (controllerConfig.dataProtection || methodConfig.dataProtection) {
    merged.dataProtection = {
      ...controllerConfig.dataProtection,
      ...methodConfig.dataProtection,
    };
  }

  return merged;
}

/**
 * Normalize includes config to object form for processing.
 */
export function normalizeIncludes(includes?: ObservabilityIncludesConfig): {
  request: { headers: string[] | boolean; body: string[] | boolean; query: string[] | boolean };
  response: { headers: string[] | boolean; body: string[] | boolean };
} {
  if (!includes) {
    return {
      request: { headers: false, body: false, query: false },
      response: { headers: false, body: false },
    };
  }

  return {
    request: normalizeRequestIncludes(includes.request),
    response: normalizeResponseIncludes(includes.response),
  };
}

function normalizeRequestIncludes(
  config?: boolean | ('headers' | 'body' | 'query')[] | { headers?: boolean | string[]; body?: boolean | string[]; query?: boolean | string[] }
): { headers: string[] | boolean; body: string[] | boolean; query: string[] | boolean } {
  if (config === undefined || config === false) {
    return { headers: false, body: false, query: false };
  }
  if (config === true) {
    return { headers: true, body: true, query: true };
  }
  if (Array.isArray(config)) {
    return {
      headers: config.includes('headers'),
      body: config.includes('body'),
      query: config.includes('query'),
    };
  }
  return {
    headers: config.headers ?? false,
    body: config.body ?? false,
    query: config.query ?? false,
  };
}

function normalizeResponseIncludes(
  config?: boolean | ('headers' | 'body')[] | { headers?: boolean | string[]; body?: boolean | string[] }
): { headers: string[] | boolean; body: string[] | boolean } {
  if (config === undefined || config === false) {
    return { headers: false, body: false };
  }
  if (config === true) {
    return { headers: true, body: true };
  }
  if (Array.isArray(config)) {
    return {
      headers: config.includes('headers'),
      body: config.includes('body'),
    };
  }
  return {
    headers: config.headers ?? false,
    body: config.body ?? false,
  };
}

/**
 * Select specific fields from an object.
 */
export function selectFields(
  obj: Record<string, unknown> | undefined, 
  fields: string[] | boolean
): Record<string, unknown> | undefined {
  if (!obj || fields === false) return undefined;
  if (fields === true) return obj;
  
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    if (field in obj) {
      result[field] = obj[field];
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Select fields from a JSON string body.
 */
export function selectFieldsFromBody(
  body: string | undefined, 
  fields: string[] | boolean
): unknown {
  if (!body || fields === false) return undefined;
  
  try {
    const parsed = JSON.parse(body);
    if (fields === true) return parsed;
    if (typeof parsed === 'object' && parsed !== null) {
      return selectFields(parsed as Record<string, unknown>, fields);
    }
  } catch {
    // Not JSON
    if (fields === true) return body;
  }
  return undefined;
}
