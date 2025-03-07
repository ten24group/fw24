import type { Request } from '../../interfaces/request';
import { BadRequestError } from '../../errors';
import { ErrorHandlerContext, ErrorHandlerResult } from '../../errors/interfaces/error-handler.interface';
import { HttpStatusCode } from '../../errors/http-status-code.enum';

export class EntityValidationError extends BadRequestError {
    constructor(message: string, details?: Record<string, any>, request?: Request) {
        super(message, details, request);
        this.name = 'EntityValidationError';
    }

    handle(context: ErrorHandlerContext): ErrorHandlerResult {
        return {
            statusCode: HttpStatusCode.BAD_REQUEST,
            body: this.createErrorResponse(
                HttpStatusCode.BAD_REQUEST,
                'Entity Validation Error',
                this.details,
                context.options.includeStack
            )
        };
    }
} 