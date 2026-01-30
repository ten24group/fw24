import type { Request } from '../../interfaces/request';
import { BadRequestError } from '../../errors';
import { ErrorHandlerContext, ErrorHandlerResult } from '../../errors/interfaces/error-handler.interface';
import { ValidationError } from '../../validation';
export declare class EntityValidationError extends BadRequestError {
    constructor(validationErrors?: ValidationError[], additionalDetails?: Record<string, any>, request?: Request);
    handle(context: ErrorHandlerContext): ErrorHandlerResult;
}
