import { Request } from '../../interfaces/request';
import { ErrorHandlerContext, ErrorHandlerResult } from '../interfaces/error-handler.interface';
import { HttpStatusCode } from '../http-status-code.enum';
import { ServerError } from '../base/server-error';
import { type ValidationError } from '../../validation';

interface ValidationErrorDetails {
    errors: ValidationError[];
    [ key: string ]: any;
}

export class ValidationFailedError extends ServerError {

    constructor(validationErrors: any[] = [], additionalDetails?: Record<string, any>, request?: Request) {

        const details: ValidationErrorDetails = {
            errors: validationErrors,
            ...additionalDetails
        };

        super(HttpStatusCode.BAD_REQUEST, 'Validation failed', details, request);

        this.name = 'ValidationFailedError';
    }

    handle(context: ErrorHandlerContext): ErrorHandlerResult {
        const errorDetails = this.details || {};
        return {
            statusCode: HttpStatusCode.BAD_REQUEST,
            body: this.createErrorResponse(
                HttpStatusCode.BAD_REQUEST,
                'Validation Failed',
                {
                    message: this.message,
                    errors: errorDetails.errors,
                    ...errorDetails
                },
                context.options.includeStack
            )
        };
    }
} 