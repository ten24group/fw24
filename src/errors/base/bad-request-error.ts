import { Request } from '../../interfaces/request';
import { ErrorHandlerContext, ErrorHandlerResult } from '../interfaces/error-handler.interface';
import { HttpStatusCode } from '../http-status-code.enum';
import { AppError } from './app-error';

export class BadRequestError extends AppError {
  constructor(message: string, details?: Record<string, any>, request?: Request) {
    super(HttpStatusCode.BAD_REQUEST, message, details, request);
    this.name = 'BadRequestError';
  }

  handle(context: ErrorHandlerContext): ErrorHandlerResult {
    return {
      statusCode: HttpStatusCode.BAD_REQUEST,
      body: this.createErrorResponse(
        HttpStatusCode.BAD_REQUEST,
        this.message,
        this.details,
        context.options.includeStack,
      ),
    };
  }
}
