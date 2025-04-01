import { ErrorHandlerContext, ErrorHandlerResult } from '../interfaces/error-handler.interface';
import { AppError } from '../base/app-error';
import { HttpStatusCode } from '../http-status-code.enum';
import { createLogger } from '../../logging';

export interface ErrorHandlerOptions {
  includeStack?: boolean;
  logErrors?: boolean;
  logRequestDetails?: boolean;
}

export class ErrorHandlerService {
  private static instance: ErrorHandlerService;
  private defaultHandler: (context: ErrorHandlerContext) => ErrorHandlerResult;

  private constructor() {
    this.defaultHandler = (context: ErrorHandlerContext) => ({
      statusCode: HttpStatusCode.INTERNAL_SERVER_ERROR,
      body: {
        status: 'error',
        statusCode: HttpStatusCode.INTERNAL_SERVER_ERROR,
        message: 'Internal Server Error',
        details: { message: context.error.message },
        ...(context.options.includeStack && { stack: context.error.stack }),
      },
    });
  }

  static getInstance(): ErrorHandlerService {
    if (!ErrorHandlerService.instance) {
      ErrorHandlerService.instance = new ErrorHandlerService();
    }
    return ErrorHandlerService.instance;
  }

  handleError(context: ErrorHandlerContext): ErrorHandlerResult {
    if (context.options.logErrors) {
      this.logError(context);
    }

    if (context.error instanceof AppError) {
      return context.error.handle(context);
    }

    return this.defaultHandler(context);
  }

  private logError(context: ErrorHandlerContext): void {
    const { error, request, options } = context;
    console.error('Error:', {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...(options.logRequestDetails &&
        request && {
          request: {
            method: request.httpMethod,
            path: request.path,
            query: request.queryStringParameters,
            params: request.pathParameters,
          },
        }),
    });
  }
}
