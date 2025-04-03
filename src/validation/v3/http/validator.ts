/**
 * HTTP request validator implementation
 */
import { ValidationResult, ValidationError } from '../core/types';
import { Validator, ValidateOptions } from '../validator';
import { HttpRequest, HttpValidationContext, HttpValidationSchema } from './types';

/**
 * Validator for HTTP requests
 */
export class HttpValidator {
  private validator = new Validator();

  /**
   * Validates an HTTP request against a schema
   *
   * @param request The HTTP request to validate
   * @param schema The validation schema
   * @param options Validation options
   */
  async validate(
    request: HttpRequest,
    schema: HttpValidationSchema,
    options: ValidateOptions = {},
  ): Promise<ValidationResult> {
    const { collectErrors = true, verboseErrors = false, overriddenErrorMessages = {} } = options;

    const context: HttpValidationContext = { request };
    const errors: ValidationError[] = [];
    let allPass = true;

    // Validate headers
    if (schema.headers) {
      const result = await this.validator.validate(request.headers, schema.headers, context, { collectErrors });

      if (!result.pass) {
        allPass = false;

        if (collectErrors && result.errors) {
          errors.push(
            ...result.errors.map(err => ({
              ...err,
              path: ['headers', ...(err.path || [])],
            })),
          );
        }
      }
    }

    // Validate params
    if (schema.params) {
      const result = await this.validator.validate(request.params, schema.params, context, { collectErrors });

      if (!result.pass) {
        allPass = false;

        if (collectErrors && result.errors) {
          errors.push(
            ...result.errors.map(err => ({
              ...err,
              path: ['params', ...(err.path || [])],
            })),
          );
        }
      }
    }

    // Validate query
    if (schema.query) {
      const result = await this.validator.validate(request.query, schema.query, context, { collectErrors });

      if (!result.pass) {
        allPass = false;

        if (collectErrors && result.errors) {
          errors.push(
            ...result.errors.map(err => ({
              ...err,
              path: ['query', ...(err.path || [])],
            })),
          );
        }
      }
    }

    // Validate body
    if (schema.body && request.body) {
      const result = await this.validator.validate(request.body, schema.body, context, { collectErrors });

      if (!result.pass) {
        allPass = false;

        if (collectErrors && result.errors) {
          errors.push(
            ...result.errors.map(err => ({
              ...err,
              path: ['body', ...(err.path || [])],
            })),
          );
        }
      }
    }

    // Apply custom error messages if provided
    if (overriddenErrorMessages && errors.length > 0) {
      for (const error of errors) {
        if (error.messageIds?.length) {
          for (const id of error.messageIds) {
            if (overriddenErrorMessages[id]) {
              error.message = overriddenErrorMessages[id];
              break;
            }
          }
        }
      }
    }

    return {
      pass: allPass,
      errors:
        errors.length > 0
          ? verboseErrors
            ? errors
            : errors.map(e => ({
                path: e.path,
                message: e.message || 'Validation failed',
              }))
          : undefined,
    };
  }
}
