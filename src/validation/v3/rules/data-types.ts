/**
 * Data type validators for common validations
 */
import { ValidationRule } from '../core/types';
import { rule } from './index';

/**
 * Validates if a string is a valid email address
 */
export function isEmail<TContext = unknown>(
  options: { message?: string; messageId?: string } = {},
): ValidationRule<string | undefined | null, TContext> {
  const emailRegex = /^[^@]+@[^@]+\.[^@]+$/;
  return rule<string | undefined | null, TContext>(value => typeof value === 'string' && emailRegex.test(value), {
    message: options.message || 'Must be a valid email address',
    messageId: options.messageId || 'validation.email',
  });
}

/**
 * Helper function to check if a string is a valid IPv4 address
 */
function checkIPv4(value: string): boolean {
  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

  if (!ipv4Regex.test(value)) return false;

  // Additional validation to check if octets are in the valid range
  const octets = value.split('.').map(Number);
  return octets.every(octet => octet >= 0 && octet <= 255);
}

/**
 * Helper function to check if a string is a valid IPv6 address
 */
function checkIPv6(value: string): boolean {
  // Simple regex for IPv6 - full validation would be more complex
  const ipv6Regex = /^([0-9a-f]{1,4}:){7}[0-9a-f]{1,4}$/i;
  return ipv6Regex.test(value);
}

/**
 * Validates if a string is a valid IP address (v4 or v6)
 */
export function isIP<TContext = unknown>(
  options: { message?: string; messageId?: string } = {},
): ValidationRule<string | undefined | null, TContext> {
  return rule<string | undefined | null, TContext>(
    value => typeof value === 'string' && (checkIPv4(value) || checkIPv6(value)),
    {
      message: options.message || 'Must be a valid IP address',
      messageId: options.messageId || 'validation.ip',
    },
  );
}

/**
 * Validates if a string is a valid IPv4 address
 */
export function isIPv4<TContext = unknown>(
  options: { message?: string; messageId?: string } = {},
): ValidationRule<string | undefined | null, TContext> {
  return rule<string | undefined | null, TContext>(value => typeof value === 'string' && checkIPv4(value), {
    message: options.message || 'Must be a valid IPv4 address',
    messageId: options.messageId || 'validation.ipv4',
  });
}

/**
 * Validates if a string is a valid IPv6 address
 */
export function isIPv6<TContext = unknown>(
  options: { message?: string; messageId?: string } = {},
): ValidationRule<string | undefined | null, TContext> {
  return rule<string | undefined | null, TContext>(value => typeof value === 'string' && checkIPv6(value), {
    message: options.message || 'Must be a valid IPv6 address',
    messageId: options.messageId || 'validation.ipv6',
  });
}

/**
 * Validates if a string is a valid UUID
 */
export function isUUID<TContext = unknown>(
  options: { message?: string; messageId?: string } = {},
): ValidationRule<string | undefined | null, TContext> {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  return rule<string | undefined | null, TContext>(value => typeof value === 'string' && uuidRegex.test(value), {
    message: options.message || 'Must be a valid UUID',
    messageId: options.messageId || 'validation.uuid',
  });
}

/**
 * Validates if a string is a valid date
 */
export function isDate<TContext = unknown>(
  options: { message?: string; messageId?: string } = {},
): ValidationRule<string | undefined | null, TContext> {
  return rule<string | undefined | null, TContext>(
    value => {
      if (typeof value !== 'string') return false;
      const date = new Date(value);
      return !isNaN(date.getTime());
    },
    {
      message: options.message || 'Must be a valid date',
      messageId: options.messageId || 'validation.date',
    },
  );
}

/**
 * Validates if a string contains a valid JSON
 */
export function isJSON<TContext = unknown>(
  options: { message?: string; messageId?: string } = {},
): ValidationRule<string | undefined | null, TContext> {
  return rule<string | undefined | null, TContext>(
    value => {
      if (typeof value !== 'string') return false;
      try {
        JSON.parse(value);
        return true;

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (e) {
        // ignore the error
        return false;
      }
    },
    {
      message: options.message || 'Must be valid JSON',
      messageId: options.messageId || 'validation.json',
    },
  );
}

const urlRegex =
  /^https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_+.~#?&/=]*)$/;

/**
 * Validates if a string is a valid HTTP URL
 */
export function isURL<TContext = unknown>(
  options: { message?: string; messageId?: string } = {},
): ValidationRule<string | undefined | null, TContext> {
  // Fix unnecessary escape characters in the regex

  return rule<string | undefined | null, TContext>(value => typeof value === 'string' && urlRegex.test(value), {
    message: options.message || 'Must be a valid URL',
    messageId: options.messageId || 'validation.url',
  });
}

/**
 * Validates if a string contains only numbers
 */
export function isNumeric<TContext = unknown>(
  options: { message?: string; messageId?: string } = {},
): ValidationRule<string | undefined | null, TContext> {
  const numericRegex = /^[0-9]+$/;

  return rule<string | undefined | null, TContext>(value => typeof value === 'string' && numericRegex.test(value), {
    message: options.message || 'Must contain only numbers',
    messageId: options.messageId || 'validation.numeric',
  });
}

/**
 * Helper function to check if a value is unique in an array
 */
export function isUnique<T>(value: T): boolean {
  if (!value) return false;

  if (typeof value === 'string' || Array.isArray(value)) {
    const set = new Set(value);
    return set.size === value.length;
  }

  return true;
}

/**
 * Validates if an array or string contains unique values
 */
export function unique<TContext = unknown>(
  options: { message?: string; messageId?: string } = {},
): ValidationRule<string | any[] | undefined | null, TContext> {
  return rule<string | any[] | undefined | null, TContext>(
    value => {
      if (!value) return false;
      return isUnique(value);
    },
    {
      message: options.message || 'Must contain only unique values',
      messageId: options.messageId || 'validation.unique',
    },
  );
}

/**
 * Validates data against a specified type
 */
export function isType<TContext = unknown>(
  type:
    | 'string'
    | 'number'
    | 'boolean'
    | 'object'
    | 'array'
    | 'email'
    | 'ip'
    | 'ipv4'
    | 'ipv6'
    | 'uuid'
    | 'date'
    | 'json'
    | 'url'
    | 'numeric',
  options: { message?: string; messageId?: string } = {},
): ValidationRule<unknown, TContext> {
  return rule<unknown, TContext>(
    (value: unknown) => {
      if (value === undefined || value === null) return false;

      switch (type) {
        case 'string':
          return typeof value === 'string';
        case 'number':
          return typeof value === 'number';
        case 'boolean':
          return typeof value === 'boolean';
        case 'object':
          return typeof value === 'object' && !Array.isArray(value);
        case 'array':
          return Array.isArray(value);
        case 'email':
          return typeof value === 'string' && /^[^@]+@[^@]+\.[^@]+$/.test(value);
        case 'ip':
          return typeof value === 'string' && (checkIPv4(value) || checkIPv6(value));
        case 'ipv4':
          return typeof value === 'string' && checkIPv4(value);
        case 'ipv6':
          return typeof value === 'string' && checkIPv6(value);
        case 'uuid':
          return (
            typeof value === 'string' &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
          );
        case 'date':
          return typeof value === 'string' && !isNaN(new Date(value).getTime());
        case 'json':
          if (typeof value !== 'string') return false;
          try {
            JSON.parse(value);
            return true;
          } catch {
            return false;
          }
        case 'url':
          // Fix unnecessary escape characters in the regex
          return typeof value === 'string' && urlRegex.test(value);
        case 'numeric':
          return typeof value === 'string' && /^[0-9]+$/.test(value);
        default:
          return false;
      }
    },
    {
      message: options.message || `Must be of type ${type}`,
      messageId: options.messageId || 'validation.type',
    },
  );
}
