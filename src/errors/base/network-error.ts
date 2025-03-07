import { Request } from '../../interfaces/request';
import { ErrorHandlerContext, ErrorHandlerResult } from '../interfaces/error-handler.interface';
import { HttpStatusCode } from '../http-status-code.enum';
import { FrameworkError } from './framework-error';

export class NetworkError extends FrameworkError {
    constructor(message: string, details?: Record<string, any>, request?: Request) {
        super(message, details, request);
        this.name = 'NetworkError';
    }

    handle(context: ErrorHandlerContext): ErrorHandlerResult {
        return {
            statusCode: HttpStatusCode.SERVICE_UNAVAILABLE,
            body: this.createErrorResponse(
                HttpStatusCode.SERVICE_UNAVAILABLE,
                'Network Error',
                { message: this.message, ...this.details },
                context.options.includeStack
            )
        };
    }
} 