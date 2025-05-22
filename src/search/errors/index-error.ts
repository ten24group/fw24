import { SearchError } from './base';
import { Request } from '../../interfaces';
import { ErrorHandlerContext, ErrorHandlerResult } from '../../errors';
import { HttpStatusCode } from '../../errors/http-status-code.enum';

/**
 * Error thrown when there are issues with search index operations
 */
export class SearchIndexError extends SearchError {
  constructor(message: string, details?: Record<string, any>, request?: Request) {
    super(message, details, request);
    this.name = 'SearchIndexError';
  }

  handle(context: ErrorHandlerContext): ErrorHandlerResult {
    return {
      statusCode: HttpStatusCode.INTERNAL_SERVER_ERROR,
      body: this.createErrorResponse(
        HttpStatusCode.INTERNAL_SERVER_ERROR,
        this.message,
        {
          code: 'SEARCH_INDEX_ERROR',
          ...this.details
        },
        context.options.includeStack
      )
    };
  }
} 