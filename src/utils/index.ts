import { FrameworkError } from '../errors';

export * from './cases';
export * from './datatypes';
export * from './exclude';
export * from './merge';
export * from './parse';
export * from './serialize';
export * from './types';
export * from './timer';

export * from './metadata';
export * from './keys';
export * from './env';
export * from './compression';

export class ValueByPathError extends FrameworkError {
    constructor(message: string, details?: Record<string, any>) {
        super(message, {
            ...details,
            errorType: 'ValueByPathError',
            timestamp: new Date().toISOString()
        });
    }
}

export function getValueByPath<T = any>(obj: Record<string, any>, path: string, defaultValue?: T): T {
    if (!obj || typeof obj !== 'object') {
        throw new ValueByPathError('Object must be a valid object', {
            obj,
            type: typeof obj,
            isNull: obj === null
        });
    }

    if (!path || typeof path !== 'string') {
        throw new ValueByPathError('Path must be a non-empty string', {
            path,
            type: typeof path
        });
    }

    try {
        const keys = path.split('.');
        let current = obj;

        for (const key of keys) {
            if (!key) {
                throw new ValueByPathError('Invalid path segment: empty key', { path });
            }

            if (current === undefined || current === null) {
                return defaultValue as T;
            }

            if (!(key in current)) {
                throw new ValueByPathError(`Key not found in object: ${key}`, {
                    path,
                    key,
                    availableKeys: Object.keys(current)
                });
            }

            current = current[ key ];
        }

        return (current === undefined ? defaultValue : current) as T;
    } catch (error) {
        if (error instanceof ValueByPathError) {
            throw error;
        }
        throw new ValueByPathError(`Failed to get value at path: ${path}`, {
            path,
            object: obj,
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined
        });
    }
}
/**
 * Sanitizes a request object for safe inclusion in debug responses/logs.
 * Removes potentially large or circular properties.
 */
export function sanitizeRequestForDebug(request: any): any {
  if (!request || typeof request !== 'object') return request;

  const sanitized: any = {};
  const includeKeys = ['path', 'method', 'headers', 'queryStringParameters', 'pathParameters', 'body', 'actor'];

  for (const key of includeKeys) {
    if (key in request) {
      sanitized[key] = request[key];
    }
  }

  // Sanitize body if it's a string
  if (typeof sanitized.body === 'string' && sanitized.body.length > 2000) {
    sanitized.body = sanitized.body.substring(0, 2000) + '... (truncated)';
  }

  // Sanitize headers (remove sensitive info)
  if (sanitized.headers) {
    const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key'];
    const filteredHeaders = { ...sanitized.headers };
    for (const h of sensitiveHeaders) {
      if (h in filteredHeaders) filteredHeaders[h] = '[REDACTED]';
    }
    sanitized.headers = filteredHeaders;
  }

  return sanitized;
}
