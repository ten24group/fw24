import { Request } from '../../interfaces/request';
import { ErrorHandlerContext, ErrorHandlerResult } from '../interfaces/error-handler.interface';
import { HttpStatusCode } from '../http-status-code.enum';
import { BadRequestError } from './bad-request-error';

export class BusinessError extends BadRequestError {
  constructor(message: string, details?: Record<string, any>, request?: Request) {
    super(message, details, request);
    this.name = 'BusinessError';
  }

  handle(context: ErrorHandlerContext): ErrorHandlerResult {
    return {
      statusCode: HttpStatusCode.BAD_REQUEST,
      body: this.createErrorResponse(
        HttpStatusCode.BAD_REQUEST,
        'Business Logic Error',
        { message: this.message, ...this.details },
        context.options.includeStack,
      ),
    };
  }
}
