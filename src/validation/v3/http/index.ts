/**
 * HTTP validation exports
 */
export * from './types';
export * from './validator';

/**
 * HTTP validation implementation
 */
import { ValidationSchema, Validator, ValidateOptions } from '../validator';
import { ValidationResult } from '../core/types';

/**
 * Represents an HTTP request with headers, params, query, and body
 */
export interface HttpRequest {
  headers: Record<string, string>;
  params: Record<string, string>;
  query: Record<string, string>;
  body: Record<string, any>;
}

/**
 * HTTP validation schema for different parts of an HTTP request
 */
export interface HttpValidationSchema {
  headers?: ValidationSchema<Record<string, string>>;
  params?: ValidationSchema<Record<string, string>>;
  query?: ValidationSchema<Record<string, string>>;
  body?: ValidationSchema<Record<string, any>>;
}

/**
 * HTTP validation options
 */
export interface HttpValidateOptions extends ValidateOptions {
  /**
   * Stop validation after the first failed section (headers, params, query, body)
   */
  stopOnFirstSectionFailure?: boolean;
}

/**
 * Validator for HTTP requests
 */
export class HttpValidator {
  private validator = new Validator();

  /**
   * Validates an HTTP request against a schema
   *
   * @param request The HTTP request to validate
   * @param schema The HTTP validation schema
   * @param options Validation options
   */
  async validate(
    request: HttpRequest,
    schema: HttpValidationSchema,
    options: HttpValidateOptions = {},
  ): Promise<ValidationResult> {
    const {
      collectErrors = true,
      verboseErrors = true,
      overriddenErrorMessages,
      stopOnFirstSectionFailure = false,
    } = options;

    const result: ValidationResult = {
      pass: true,
      errors: [],
    };

    // Validate headers
    if (schema.headers) {
      const headersResult = await this.validator.validate(request.headers || {}, schema.headers, undefined, {
        collectErrors,
        verboseErrors,
        overriddenErrorMessages,
      });

      result.pass = result.pass && headersResult.pass;

      if (!headersResult.pass && headersResult.errors) {
        result.errors = [
          ...(result.errors || []),
          ...headersResult.errors.map(err => ({
            ...err,
            path: err.path && err.path[0] === 'headers' ? err.path : ['headers', ...(err.path || [])],
          })),
        ];

        if (stopOnFirstSectionFailure && !collectErrors) {
          return result;
        }
      }
    }

    // Validate params
    if (schema.params) {
      const paramsResult = await this.validator.validate(request.params || {}, schema.params, undefined, {
        collectErrors,
        verboseErrors,
        overriddenErrorMessages,
      });

      result.pass = result.pass && paramsResult.pass;

      if (!paramsResult.pass && paramsResult.errors) {
        result.errors = [
          ...(result.errors || []),
          ...paramsResult.errors.map(err => ({
            ...err,
            path: err.path && err.path[0] === 'params' ? err.path : ['params', ...(err.path || [])],
          })),
        ];

        if (stopOnFirstSectionFailure && !collectErrors) {
          return result;
        }
      }
    }

    // Validate query
    if (schema.query) {
      const queryResult = await this.validator.validate(request.query || {}, schema.query, undefined, {
        collectErrors,
        verboseErrors,
        overriddenErrorMessages,
      });

      result.pass = result.pass && queryResult.pass;

      if (!queryResult.pass && queryResult.errors) {
        result.errors = [
          ...(result.errors || []),
          ...queryResult.errors.map(err => ({
            ...err,
            path: err.path && err.path[0] === 'query' ? err.path : ['query', ...(err.path || [])],
          })),
        ];

        if (stopOnFirstSectionFailure && !collectErrors) {
          return result;
        }
      }
    }

    // Validate body
    if (schema.body) {
      const bodyResult = await this.validator.validate(request.body || {}, schema.body, undefined, {
        collectErrors,
        verboseErrors,
        overriddenErrorMessages,
      });

      result.pass = result.pass && bodyResult.pass;

      if (!bodyResult.pass && bodyResult.errors) {
        result.errors = [
          ...(result.errors || []),
          ...bodyResult.errors.map(err => ({
            ...err,
            path: err.path && err.path[0] === 'body' ? err.path : ['body', ...(err.path || [])],
          })),
        ];
      }
    }

    // If no errors, set errors to undefined
    if (result.errors?.length === 0) {
      result.errors = undefined;
    }

    return result;
  }
}
