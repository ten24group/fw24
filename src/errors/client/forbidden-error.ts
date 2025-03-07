import { Request } from '../../interfaces/request';
import { ErrorHandlerContext, ErrorHandlerResult } from '../interfaces/error-handler.interface';
import { HttpStatusCode } from '../http-status-code.enum';
import { ClientError } from '../base/client-error';

export class ForbiddenError extends ClientError {
    constructor(message: string = 'Access forbidden', request?: Request) {
        super(HttpStatusCode.FORBIDDEN, message, undefined, request);
        this.name = 'ForbiddenError';
    }

    handle(context: ErrorHandlerContext): ErrorHandlerResult {
        return {
            statusCode: HttpStatusCode.FORBIDDEN,
            body: this.createErrorResponse(
                HttpStatusCode.FORBIDDEN,
                'Access Forbidden',
                { message: this.message },
                context.options.includeStack
            )
        };
    }
} 