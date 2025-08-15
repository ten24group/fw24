import { APIGatewayEvent, Context } from 'aws-lambda';
import { Request, Response } from '../../interfaces';
export interface ExecutionContext<Actor = unknown, Observability = unknown, DebugInfo = unknown> {
    event: APIGatewayEvent;
    lambdaContext: Context;
    request: Request;
    response: Response;
    actor?: Actor;
    observability?: Observability;
    debugInfo?: DebugInfo;
}
