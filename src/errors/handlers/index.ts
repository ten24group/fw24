export * from './error-handler-service';

import { Request, Response } from '../../interfaces';
import { ErrorHandlerOptions } from './error-handler-service';
import { ErrorHandlerService } from './error-handler-service';
import { ErrorHandlerContext } from '../interfaces/error-handler.interface';

// Create a singleton instance
export const errorHandlerService = ErrorHandlerService.getInstance();

// Create error handler middleware for controllers
export const createErrorHandler = (
  options: ErrorHandlerOptions = {
    includeStack: false,
    logErrors: true,
    logRequestDetails: true,
  },
) => {
  return (error: any, req: Request, res: Response) => {
    const context: ErrorHandlerContext = { error, request: req, response: res, options };

    const result = errorHandlerService.handleError(context);

    return res.status(result.statusCode).json({ ...result.body });
  };
};
