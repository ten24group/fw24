import { APIGatewayEvent, Context } from 'aws-lambda';
import { Request, Response } from '../../interfaces';

export interface ExecutionContext<Actor = unknown, Observability = unknown, DebugInfo = unknown> {
  event: APIGatewayEvent;
  lambdaContext: Context;
  request: Request;
  response: Response;
  actor?: Actor; // current actor, e.g., from Cognito context or middleware
  observability?: Observability; // TODO: observability, traces, metrics, etc.
  debugInfo?: DebugInfo; // TODO: debug info 
} 