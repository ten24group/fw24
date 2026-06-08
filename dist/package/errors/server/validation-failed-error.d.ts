import { Request } from '../../interfaces/request';
import { ErrorHandlerContext, ErrorHandlerResult } from '../interfaces/error-handler.interface';
import { ServerError } from '../base/server-error';
export declare class ValidationFailedError extends ServerError {
    constructor(validationErrors?: any[], additionalDetails?: Record<string, any>, request?: Request);
    handle(context: ErrorHandlerContext): ErrorHandlerResult;
}
