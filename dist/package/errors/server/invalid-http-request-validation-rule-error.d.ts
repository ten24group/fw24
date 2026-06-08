import { Request } from '../../interfaces/request';
import { ErrorHandlerContext, ErrorHandlerResult } from '../interfaces/error-handler.interface';
import { ServerError } from '../base/server-error';
export declare class InvalidHttpRequestValidationRuleError extends ServerError {
    constructor(details?: Record<string, any>, request?: Request);
    handle(context: ErrorHandlerContext): ErrorHandlerResult;
}
