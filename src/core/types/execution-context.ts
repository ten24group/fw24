import { APIGatewayEvent, Context } from 'aws-lambda';
import { Request, Response } from '../../interfaces';
import { Actor } from './actor';

export interface ExecutionContext<TObservability = unknown, TDebugInfo = unknown> {
  event: APIGatewayEvent;
  lambdaContext: Context;
  request: Request;
  response: Response;
  actor?: Actor; // current actor extracted from request context
  observability?: TObservability; // TODO: observability, traces, metrics, etc.
  debugInfo?: TDebugInfo; // TODO: debug info 
}

// Re-export Actor for convenience
export type { Actor }; 