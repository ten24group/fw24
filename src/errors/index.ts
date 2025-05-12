// Export interfaces and types
export * from './interfaces/error-handler.interface';
export * from './interfaces/error-response.interface';
export * from './http-status-code.enum';

// Export base error classes
export * from './base/app-error';
export * from './base/client-error';
export * from './base/bad-request-error';
export * from './base/server-error';
export * from './base/framework-error';
export * from './base/network-error';
export * from './base/business-error';

// Export specific error classes
export * from './client/unauthorized-error';
export * from './client/forbidden-error';
export * from './client/not-found-error';

export * from './server/internal-server-error';
export * from './server/validation-failed-error';
export * from './server/invalid-http-request-validation-rule-error';

// Export entity-specific errors
export * from '../entity/errors';

// Export error handlers
export * from './handlers/error-handler-service';
export * from './handlers/index';