import { Request } from '../../interfaces/request';
import { ErrorHandlerContext, ErrorHandlerResult } from '../interfaces/error-handler.interface';
import { HttpStatusCode } from '../http-status-code.enum';
import { AppError } from './app-error';

export class ServerError extends AppError {
    constructor(statusCode: number, message: string, details?: Record<string, any>, request?: Request) {
        super(statusCode, message, details, request);
        this.name = 'ServerError';
    }

    handle(context: ErrorHandlerContext): ErrorHandlerResult {
        return {
            statusCode: this.statusCode,
            body: this.createErrorResponse(
                this.statusCode,
                this.message,
                this.details,
                context.options.includeStack
            )
        };
    }
} 