import { ServerError, BadRequestError, ErrorHandlerContext, ErrorHandlerResult } from '../../errors';
import { Request } from '../../interfaces';
import { HttpStatusCode } from '../../errors/http-status-code.enum';

/**
 * Base class for all search-related errors
 */
export class SearchError extends ServerError {
  constructor(message: string, details?: Record<string, any>, request?: Request) {
    super(HttpStatusCode.INTERNAL_SERVER_ERROR, message, details, request);
    this.name = 'SearchError';
  }

  handle(context: ErrorHandlerContext): ErrorHandlerResult {
    return {
      statusCode: HttpStatusCode.INTERNAL_SERVER_ERROR,
      body: this.createErrorResponse(
        HttpStatusCode.INTERNAL_SERVER_ERROR,
        this.message,
        {
          code: 'SEARCH_ERROR',
          ...this.details
        },
        context.options.includeStack
      )
    };
  }
}

/**
 * Base class for search validation errors
 */
export class SearchValidationError extends BadRequestError {
  constructor(message: string, details?: Record<string, any>, request?: Request) {
    super(message, details, request);
    this.name = 'SearchValidationError';
  }

  handle(context: ErrorHandlerContext): ErrorHandlerResult {
    return {
      statusCode: HttpStatusCode.BAD_REQUEST,
      body: this.createErrorResponse(
        HttpStatusCode.BAD_REQUEST,
        this.message,
        {
          code: 'SEARCH_VALIDATION_ERROR',
          ...this.details
        },
        context.options.includeStack
      )
    };
  }
} 