import { APIGatewayEvent, Context } from 'aws-lambda';
import { Request, Response } from '../../interfaces';
import { Actor } from './actor';
export interface ExecutionContext<TObservability = unknown, TDebugInfo = unknown> {
    event: APIGatewayEvent;
    lambdaContext: Context;
    request: Request;
    response: Response;
    actor?: Actor;
    observability?: TObservability;
    debugInfo?: TDebugInfo;
    enhanceActor?: (enhancement: Partial<Actor>) => void;
}
export type { Actor };
