import { Request } from '../../interfaces/request';
import { ErrorHandlerContext, ErrorHandlerResult } from '../interfaces/error-handler.interface';
import { ClientError } from '../base/client-error';
export declare class UnauthorizedError extends ClientError {
    constructor(message?: string, request?: Request);
    handle(context: ErrorHandlerContext): ErrorHandlerResult;
}
