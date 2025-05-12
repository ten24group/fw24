import { Request } from '../../interfaces/request';
import { ErrorHandlerContext, ErrorHandlerResult, IErrorHandler } from '../interfaces/error-handler.interface';
import { ErrorResponse } from '../interfaces/error-response.interface';

export abstract class AppError extends Error implements IErrorHandler {
    constructor(
        public readonly statusCode: number,
        message: string,
        public readonly details?: Record<string, any>,
        public readonly request?: Request
    ) {
        super(message);
        this.name = this.constructor.name;
    }

    abstract handle(context: ErrorHandlerContext): ErrorHandlerResult;

    public createErrorResponse(
        statusCode: number,
        message: string,
        details?: Record<string, any>,
        includeStack?: boolean
    ): ErrorResponse {
        const response: ErrorResponse = {
            status: 'error',
            statusCode,
            message
        };

        if (details) {
            response.details = details;
        }

        if (includeStack) {
            response.stack = this.stack;
        }

        return response;
    }
} 