import { SearchValidationError } from './base';
import { Request } from '../../interfaces';
import { ErrorHandlerContext, ErrorHandlerResult } from '../../errors';
/**
 * Error thrown when there are issues with search query validation or execution
 */
export declare class SearchQueryError extends SearchValidationError {
    constructor(message: string, details?: Record<string, any>, request?: Request);
    handle(context: ErrorHandlerContext): ErrorHandlerResult;
}
