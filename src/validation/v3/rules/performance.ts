/**
 * Performance validation rules for preventing DoS attacks
 */
import { ValidationRule } from '../core/types';
import { rule } from './index';

/**
 * Maximum string length to prevent excessive memory usage
 */
export const MAX_STRING_LENGTH = 50000; // 50KB

/**
 * Maximum array length to prevent excessive memory usage
 */
export const MAX_ARRAY_LENGTH = 10000; // 10K items

/**
 * Validates that a string is within safe size limits
 */
export function safeSizeString<TContext = unknown>(
  maxLength: number = MAX_STRING_LENGTH,
  options: { message?: string; messageId?: string } = {},
): ValidationRule<string | undefined | null, TContext> {
  return rule<string | undefined | null, TContext>(
    value => {
      if (!value) return true;
      return typeof value === 'string' && value.length <= maxLength;
    },
    {
      message: options.message || `String exceeds maximum safe length of ${maxLength} characters`,
      messageId: options.messageId || 'validation.performance.string',
    },
  );
}

/**
 * Validates that an array is within safe size limits
 */
export function safeSizeArray<TContext = unknown>(
  maxLength: number = MAX_ARRAY_LENGTH,
  options: { message?: string; messageId?: string } = {},
): ValidationRule<any[] | undefined | null, TContext> {
  return rule<any[] | undefined | null, TContext>(
    value => {
      if (!value) return true;
      return Array.isArray(value) && value.length <= maxLength;
    },
    {
      message: options.message || `Array exceeds maximum safe length of ${maxLength} items`,
      messageId: options.messageId || 'validation.performance.array',
    },
  );
}

/**
 * Validates that an object has a reasonable number of keys
 */
export function safeSizeObject<TContext = unknown>(
  maxKeys: number = 1000,
  options: { message?: string; messageId?: string } = {},
): ValidationRule<object | undefined | null, TContext> {
  return rule<object | undefined | null, TContext>(
    value => {
      if (!value) return true;
      if (typeof value !== 'object' || value === null) return false;
      return Object.keys(value).length <= maxKeys;
    },
    {
      message: options.message || `Object exceeds maximum safe number of ${maxKeys} properties`,
      messageId: options.messageId || 'validation.performance.object',
    },
  );
}

/**
 * Validates that JSON data size is within reasonable limits
 */
export function safeSizeJSON<TContext = unknown>(
  maxBytes: number = 1024 * 1024, // 1MB
  options: { message?: string; messageId?: string } = {},
): ValidationRule<unknown, TContext> {
  return rule<unknown, TContext>(
    value => {
      if (!value) return true;
      try {
        const jsonString = JSON.stringify(value);
        // Calculate approximate size (2 bytes per character in worst case)
        const approximateSize = jsonString.length * 2;
        return approximateSize <= maxBytes;
      } catch {
        return false;
      }
    },
    {
      message: options.message || `Data exceeds maximum safe size of ${maxBytes} bytes`,
      messageId: options.messageId || 'validation.performance.json',
    },
  );
}

/**
 * Validates the depth of a nested object to prevent stack overflow
 */
export function safeDepth<TContext = unknown>(
  maxDepth: number = 20,
  options: { message?: string; messageId?: string } = {},
): ValidationRule<unknown, TContext> {
  return rule<unknown, TContext>(
    value => {
      if (!value || typeof value !== 'object' || value === null) return true;

      // Helper function to measure object depth
      const measureDepth = (obj: any, currentDepth = 0): number => {
        if (currentDepth > maxDepth) return currentDepth;
        if (typeof obj !== 'object' || obj === null) return currentDepth;

        if (Array.isArray(obj)) {
          return obj.reduce((max: number, item) => {
            const depth = measureDepth(item, currentDepth + 1);
            return depth > max ? depth : max;
          }, currentDepth);
        }

        return Object.values(obj).reduce((max: number, item) => {
          const depth = measureDepth(item, currentDepth + 1);
          return depth > max ? depth : max;
        }, currentDepth);
      };

      return measureDepth(value) <= maxDepth;
    },
    {
      message: options.message || `Object exceeds maximum safe nesting depth of ${maxDepth}`,
      messageId: options.messageId || 'validation.performance.depth',
    },
  );
}
