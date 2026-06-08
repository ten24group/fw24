export * from './error-handler-service';
import { Request, Response } from '../../interfaces';
import { ErrorHandlerOptions } from './error-handler-service';
import { ErrorHandlerService } from './error-handler-service';
export declare const errorHandlerService: ErrorHandlerService;
export declare const createErrorHandler: (options?: ErrorHandlerOptions) => (error: any, req: Request, res: Response) => Response;
