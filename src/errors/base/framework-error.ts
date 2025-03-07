import { Request } from '../../interfaces/request';
import { ErrorHandlerContext, ErrorHandlerResult } from '../interfaces/error-handler.interface';
import { HttpStatusCode } from '../http-status-code.enum';
import { ServerError } from './server-error';

export class FrameworkError extends ServerError {
    constructor(message: string, details?: Record<string, any>, request?: Request) {
        super(HttpStatusCode.INTERNAL_SERVER_ERROR, message, details, request);
        this.name = 'FrameworkError';
    }

    handle(context: ErrorHandlerContext): ErrorHandlerResult {
        return {
            statusCode: HttpStatusCode.INTERNAL_SERVER_ERROR,
            body: this.createErrorResponse(
                HttpStatusCode.INTERNAL_SERVER_ERROR,
                'Framework Error',
                { message: this.message, ...this.details },
                context.options.includeStack
            )
        };
    }
} 