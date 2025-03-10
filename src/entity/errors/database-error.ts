import type { Request } from '../../interfaces/request';
import { ServerError } from '../../errors';
import { ErrorHandlerContext, ErrorHandlerResult } from '../../errors/interfaces/error-handler.interface';
import { HttpStatusCode } from '../../errors/http-status-code.enum';

export class DatabaseError extends ServerError {
    constructor(message: string, details?: Record<string, any>, request?: Request) {
        super(500, message, details, request);
        this.name = 'DatabaseError';
    }

    handle(context: ErrorHandlerContext): ErrorHandlerResult {
        return {
            statusCode: HttpStatusCode.INTERNAL_SERVER_ERROR,
            body: this.createErrorResponse(
                HttpStatusCode.INTERNAL_SERVER_ERROR,
                'Database Error',
                { message: this.message, ...this.details },
                context.options.includeStack
            )
        };
    }
} 