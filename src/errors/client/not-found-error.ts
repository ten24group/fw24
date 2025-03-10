import { Request } from '../../interfaces/request';
import { ErrorHandlerContext, ErrorHandlerResult } from '../interfaces/error-handler.interface';
import { HttpStatusCode } from '../http-status-code.enum';
import { ClientError } from '../base/client-error';

export class NotFoundError extends ClientError {
    constructor(resource: string, message?: string, request?: Request) {
        super(
            HttpStatusCode.NOT_FOUND,
            message || `${resource} not found`,
            { resource },
            request
        );
        this.name = 'NotFoundError';
    }

    handle(context: ErrorHandlerContext): ErrorHandlerResult {
        return {
            statusCode: HttpStatusCode.NOT_FOUND,
            body: this.createErrorResponse(
                HttpStatusCode.NOT_FOUND,
                'Resource Not Found',
                { message: this.message, ...this.details },
                context.options.includeStack
            )
        };
    }
}
