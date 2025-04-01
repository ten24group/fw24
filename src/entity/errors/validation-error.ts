import type { Request } from '../../interfaces/request';
import { BadRequestError } from '../../errors';
import { ErrorHandlerContext, ErrorHandlerResult } from '../../errors/interfaces/error-handler.interface';
import { HttpStatusCode } from '../../errors/http-status-code.enum';
import { ValidationError } from '../../validation';

interface EntityValidationErrorDetails {
  errors: ValidationError[];
  [key: string]: any;
}

export class EntityValidationError extends BadRequestError {
  constructor(validationErrors: ValidationError[] = [], additionalDetails?: Record<string, any>, request?: Request) {
    const details: EntityValidationErrorDetails = {
      errors: validationErrors,
      ...additionalDetails,
    };
    super('Validation failed', details, request);
    this.name = 'EntityValidationError';
  }

  handle(context: ErrorHandlerContext): ErrorHandlerResult {
    const errorDetails = this.details || {};
    return {
      statusCode: HttpStatusCode.BAD_REQUEST,
      body: this.createErrorResponse(
        HttpStatusCode.BAD_REQUEST,
        'Validation Error',
        {
          message: this.message,
          errors: errorDetails.errors,
          ...errorDetails,
        },
        context.options.includeStack,
      ),
    };
  }
}
