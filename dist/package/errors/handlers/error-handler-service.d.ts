import { ErrorHandlerContext, ErrorHandlerResult } from '../interfaces/error-handler.interface';
export interface ErrorHandlerOptions {
    includeStack?: boolean;
    logErrors?: boolean;
    logRequestDetails?: boolean;
}
export declare class ErrorHandlerService {
    private static instance;
    private defaultHandler;
    private constructor();
    static getInstance(): ErrorHandlerService;
    handleError(context: ErrorHandlerContext): ErrorHandlerResult;
    private logError;
}
