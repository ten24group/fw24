import { Request } from '../../interfaces/request';
import { ErrorHandlerContext, ErrorHandlerResult } from '../interfaces/error-handler.interface';
import { HttpStatusCode } from '../http-status-code.enum';
import { ClientError } from '../base/client-error';

export class UnauthorizedError extends ClientError {
  constructor(message: string = 'Unauthorized access', request?: Request) {
    super(HttpStatusCode.UNAUTHORIZED, message, undefined, request);
    this.name = 'UnauthorizedError';
  }

  handle(context: ErrorHandlerContext): ErrorHandlerResult {
    return {
      statusCode: HttpStatusCode.UNAUTHORIZED,
      body: this.createErrorResponse(
        HttpStatusCode.UNAUTHORIZED,
        'Unauthorized Access',
        { message: this.message },
        context.options.includeStack,
      ),
    };
  }
}
