import type { Request } from '../../interfaces/request';
import { BadRequestError } from '../../errors';
import { ErrorHandlerContext, ErrorHandlerResult } from '../../errors/interfaces/error-handler.interface';
export declare class QueryError extends BadRequestError {
    constructor(message: string, details?: Record<string, any>, request?: Request);
    handle(context: ErrorHandlerContext): ErrorHandlerResult;
}
