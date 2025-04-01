import { Request } from '../../interfaces/request';
import { ErrorHandlerContext, ErrorHandlerResult } from '../interfaces/error-handler.interface';
import { AppError } from './app-error';

export class ClientError extends AppError {
  constructor(statusCode: number, message: string, details?: Record<string, any>, request?: Request) {
    super(statusCode, message, details, request);
    this.name = 'ClientError';
  }

  handle(context: ErrorHandlerContext): ErrorHandlerResult {
    return {
      statusCode: this.statusCode,
      body: this.createErrorResponse(this.statusCode, this.message, this.details, context.options.includeStack),
    };
  }
}
