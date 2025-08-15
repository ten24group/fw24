import { Request } from '../../interfaces/request';
import { ErrorHandlerContext, ErrorHandlerResult } from '../interfaces/error-handler.interface';
import { BadRequestError } from './bad-request-error';
export declare class BusinessError extends BadRequestError {
    constructor(message: string, details?: Record<string, any>, request?: Request);
    handle(context: ErrorHandlerContext): ErrorHandlerResult;
}
