/**
 * HTTP validator
 * Validates HTTP requests against validation schemas
 */

import { IValidator } from '../core/types';
import { Validator } from '../core/validator';
import {
  Body,
  Cookies,
  Headers,
  HttpTargetSchema,
  HttpValidationContext,
  HttpValidationResult,
  HttpValidationSchema,
  HttpValidationTarget,
  Method,
  Params,
  Query,
} from './types';

/**
 * Options for the HTTP validator
 */
export interface HttpValidatorOptions {
  /** Custom validator instance */
  validator?: IValidator;

  /** Whether to collect all errors or stop on first error */
  collectErrors?: boolean;

  /** Whether to include verbose error information */
  verboseErrors?: boolean;
}

/**
 * Parameters for HTTP validation
 */
export interface HttpValidationParams {
  /** The HTTP method */
  method?: Method;

  /** The validation schema */
  schema: HttpValidationSchema;

  /** The request URL */
  url?: string;

  /** The request path */
  path?: string;

  /** The request body */
  body?: Body;

  /** The request headers */
  headers?: Headers;

  /** The route parameters */
  params?: Params;

  /** The query parameters */
  query?: Query;

  /** The cookies */
  cookies?: Cookies;
}

/**
 * HTTP validator
 * Validates HTTP requests against validation schemas
 */
export class HttpValidator {
  private validator: IValidator;
  private options: HttpValidatorOptions;

  /**
   * Creates a new HTTP validator
   * @param options Options for the validator
   */
  constructor(options: HttpValidatorOptions = {}) {
    this.validator = options.validator || new Validator();
    this.options = options;
  }

  /**
   * Validates an HTTP request against a schema
   * @param params Validation parameters
   */
  async validate(params: HttpValidationParams): Promise<HttpValidationResult> {
    const { schema, method, url, path, body, headers, params: routeParams, query, cookies } = params;

    // Check if the schema applies to this method
    if (schema.methods && method && !schema.methods.includes(method)) {
      return { pass: true };
    }

    // Create validation context
    const context: HttpValidationContext = {
      method,
      url,
      path,
      body,
      headers,
      params: routeParams,
      query,
      cookies,
      conditions: schema.conditions,
    };

    // Track validation errors
    const validationErrors: HttpValidationResult['errors'] = [];
    let valid = true;

    // Helper to validate a target
    const validateTarget = async <T>(
      target: HttpValidationTarget,
      data: T | undefined,
      schema: HttpTargetSchema<T> | undefined,
    ): Promise<boolean> => {
      if (!data || !schema) {
        return true;
      }

      let isValid = true;

      for (const field in schema) {
        if (Object.prototype.hasOwnProperty.call(schema, field)) {
          const rule = schema[field];

          if (!rule) {
            continue;
          }

          const fieldKey = field as Extract<keyof T, string>;
          const value = data[fieldKey];
          const result = await this.validator.validate(value, rule, context as any);

          if (!result.pass) {
            isValid = false;

            if (result.errors) {
              for (const error of result.errors) {
                validationErrors.push({
                  message: error.message || error.customMessage || `Validation failed for ${target}.${field}`,
                  path: [target, field, ...(error.path || [])],
                  target,
                });
              }
            } else {
              validationErrors.push({
                message: `Validation failed for ${target}.${field}`,
                path: [target, field],
                target,
              });
            }

            if (!this.options.collectErrors) {
              return false;
            }
          }
        }
      }

      return isValid;
    };

    // Validate each target
    const bodyValid = await validateTarget('body', body, schema.body);
    if (!bodyValid && !this.options.collectErrors) {
      return { pass: false, errors: validationErrors };
    }
    valid = valid && bodyValid;

    const headersValid = await validateTarget('headers', headers, schema.headers);
    if (!headersValid && !this.options.collectErrors) {
      return { pass: false, errors: validationErrors };
    }
    valid = valid && headersValid;

    const paramsValid = await validateTarget('params', routeParams, schema.params);
    if (!paramsValid && !this.options.collectErrors) {
      return { pass: false, errors: validationErrors };
    }
    valid = valid && paramsValid;

    const queryValid = await validateTarget('query', query, schema.query);
    if (!queryValid && !this.options.collectErrors) {
      return { pass: false, errors: validationErrors };
    }
    valid = valid && queryValid;

    const cookiesValid = await validateTarget('cookies', cookies, schema.cookies);
    valid = valid && cookiesValid;

    return {
      pass: valid,
      errors: validationErrors.length > 0 ? validationErrors : undefined,
    };
  }
}

/**
 * Creates a new HTTP validator
 * @param options Options for the validator
 */
export function createHttpValidator(options: HttpValidatorOptions = {}): HttpValidator {
  return new HttpValidator(options);
}
