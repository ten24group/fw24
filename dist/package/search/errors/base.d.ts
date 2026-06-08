import { ServerError, BadRequestError, ErrorHandlerContext, ErrorHandlerResult } from '../../errors';
import { Request } from '../../interfaces';
/**
 * Base class for all search-related errors
 */
export declare class SearchError extends ServerError {
    constructor(message: string, details?: Record<string, any>, request?: Request);
    handle(context: ErrorHandlerContext): ErrorHandlerResult;
}
/**
 * Base class for search validation errors
 */
export declare class SearchValidationError extends BadRequestError {
    constructor(message: string, details?: Record<string, any>, request?: Request);
    handle(context: ErrorHandlerContext): ErrorHandlerResult;
}
