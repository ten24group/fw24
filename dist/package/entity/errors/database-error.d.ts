import type { Request } from '../../interfaces/request';
import { ServerError } from '../../errors';
import { ErrorHandlerContext, ErrorHandlerResult } from '../../errors/interfaces/error-handler.interface';
export declare class DatabaseError extends ServerError {
    constructor(message: string, details?: Record<string, any>, request?: Request);
    handle(context: ErrorHandlerContext): ErrorHandlerResult;
}
