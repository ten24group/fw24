import { Request } from '../../interfaces/request';
import { ErrorHandlerContext, ErrorHandlerResult } from '../interfaces/error-handler.interface';
import { AppError } from './app-error';
export declare class ServerError extends AppError {
    constructor(statusCode: number, message: string, details?: Record<string, any>, request?: Request);
    handle(context: ErrorHandlerContext): ErrorHandlerResult;
}
