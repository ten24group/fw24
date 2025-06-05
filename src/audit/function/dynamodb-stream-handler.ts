import { DefaultAuditHandler } from '../loggers/default-audit-handler';

/**
 * Default audit handler export for framework usage
 * Uses the DefaultAuditHandler that extends AbstractLambdaHandler
 */
export const handler = DefaultAuditHandler.CreateHandler(DefaultAuditHandler);
