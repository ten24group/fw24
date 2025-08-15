import { SearchError } from './base';
import { Request } from '../../interfaces';
import { ErrorHandlerContext, ErrorHandlerResult } from '../../errors';
/**
 * Error thrown when there are issues with the search engine operations
 */
export declare class SearchEngineError extends SearchError {
    constructor(message: string, details?: Record<string, any>, request?: Request);
    handle(context: ErrorHandlerContext): ErrorHandlerResult;
}
/**
 * Error thrown when the search engine is not available or responding
 */
export declare class SearchEngineConnectionError extends SearchEngineError {
    constructor(message?: string, details?: Record<string, any>, request?: Request);
    handle(context: ErrorHandlerContext): ErrorHandlerResult;
}
