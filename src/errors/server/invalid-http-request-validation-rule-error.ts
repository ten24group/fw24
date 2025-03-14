import { Request } from '../../interfaces/request';
import { ErrorHandlerContext, ErrorHandlerResult } from '../interfaces/error-handler.interface';
import { HttpStatusCode } from '../http-status-code.enum';
import { ServerError } from '../base/server-error';

export class InvalidHttpRequestValidationRuleError extends ServerError {
    constructor(details?: Record<string, any>, request?: Request) {
        const message = 'Invalid HTTP request validation rule';
        super(HttpStatusCode.INTERNAL_SERVER_ERROR, message, details, request);
        this.name = 'InvalidHttpRequestValidationRuleError';
    }

    handle(context: ErrorHandlerContext): ErrorHandlerResult {
        return {
            statusCode: HttpStatusCode.BAD_REQUEST,
            body: this.createErrorResponse(
                HttpStatusCode.BAD_REQUEST,
                'Bad Request',
                { message: this.message, ...this.details },
                context.options.includeStack
            )
        };
    }
} 