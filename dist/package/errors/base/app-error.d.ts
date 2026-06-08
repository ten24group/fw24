import { Request } from '../../interfaces/request';
import { ErrorHandlerContext, ErrorHandlerResult, IErrorHandler } from '../interfaces/error-handler.interface';
import { ErrorResponse } from '../interfaces/error-response.interface';
export declare abstract class AppError extends Error implements IErrorHandler {
    readonly statusCode: number;
    readonly details?: Record<string, any> | undefined;
    readonly request?: Request | undefined;
    constructor(statusCode: number, message: string, details?: Record<string, any> | undefined, request?: Request | undefined);
    abstract handle(context: ErrorHandlerContext): ErrorHandlerResult;
    createErrorResponse(statusCode: number, message: string, details?: Record<string, any>, includeStack?: boolean): ErrorResponse;
}
