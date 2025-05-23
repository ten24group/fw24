import { SearchValidationError } from './base';
import { Request } from '../../interfaces';
import { ErrorHandlerContext, ErrorHandlerResult } from '../../errors';
import { HttpStatusCode } from '../../errors/http-status-code.enum';

/**
 * Error thrown when there are issues with search query validation or execution
 */
export class SearchQueryError extends SearchValidationError {
  constructor(message: string, details?: Record<string, any>, request?: Request) {
    super(message, details, request);
    this.name = 'SearchQueryError';
  }

  handle(context: ErrorHandlerContext): ErrorHandlerResult {
    return {
      statusCode: HttpStatusCode.BAD_REQUEST,
      body: this.createErrorResponse(
        HttpStatusCode.BAD_REQUEST,
        this.message,
        {
          code: 'SEARCH_QUERY_ERROR',
          ...this.details
        },
        context.options.includeStack
      )
    };
  }
} 