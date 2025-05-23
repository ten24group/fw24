import { SearchError } from './base';
import { Request } from '../../interfaces';
import { ErrorHandlerContext, ErrorHandlerResult } from '../../errors';
import { HttpStatusCode } from '../../errors/http-status-code.enum';

/**
 * Error thrown when there are issues with the search engine operations
 */
export class SearchEngineError extends SearchError {
  constructor(message: string, details?: Record<string, any>, request?: Request) {
    super(message, details, request);
    this.name = 'SearchEngineError';
  }

  handle(context: ErrorHandlerContext): ErrorHandlerResult {
    return {
      statusCode: HttpStatusCode.INTERNAL_SERVER_ERROR,
      body: this.createErrorResponse(
        HttpStatusCode.INTERNAL_SERVER_ERROR,
        this.message,
        {
          code: 'SEARCH_ENGINE_ERROR',
          ...this.details
        },
        context.options.includeStack
      )
    };
  }
}

/**
 * Error thrown when the search engine is not available or responding
 */
export class SearchEngineConnectionError extends SearchEngineError {
  constructor(message: string = 'Search engine is not available', details?: Record<string, any>, request?: Request) {
    super(message, details, request);
    this.name = 'SearchEngineConnectionError';
  }

  handle(context: ErrorHandlerContext): ErrorHandlerResult {
    return {
      statusCode: HttpStatusCode.SERVICE_UNAVAILABLE,
      body: this.createErrorResponse(
        HttpStatusCode.SERVICE_UNAVAILABLE,
        this.message,
        {
          code: 'SEARCH_ENGINE_CONNECTION_ERROR',
          ...this.details
        },
        context.options.includeStack
      )
    };
  }
} 