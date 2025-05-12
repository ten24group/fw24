import { ErrorResponse } from '..';
import { Request, Response } from '../../interfaces';

export interface ErrorHandlerContext {
    error: Error;
    request: Request;
    response: Response;
    options: {
        includeStack?: boolean;
        logErrors?: boolean;
        logRequestDetails?: boolean;
    };
}

export interface ErrorHandlerResult {
    statusCode: number;
    body: ErrorResponse;
}

export interface IErrorHandler {
    handle(context: ErrorHandlerContext): ErrorHandlerResult;
} 