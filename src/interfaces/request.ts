import type { APIGatewayEvent, Context } from "aws-lambda";
export interface Request<TBody = any, TQuery extends Record<string, any> = Record<string, any>> {
    event: APIGatewayEvent;
    requestId: string;
    context: Context;
    resource: any;
    body: TBody;
    path: string;
    queryStringParameters: TQuery;
    headers: Record<string, any>;
    requestContext: any;
    stageVariables: any;
    pathParameters: Record<string, any>;
    isBase64Encoded: boolean;
    httpMethod: string;
    debugMode?: boolean;

    getParam(key: string): any;
    hasParam(key: string): boolean;

    getHeader(key: string): any;
    hasHeader(key: string): boolean;

    getPathParam(key: string): any;
    hasPathParam(key: string): boolean;

    getQueryParam(key: string): any;
    hasQueryParam(key: string): boolean;

    getBodyParam(key: string): any;
    hasBodyParam(key: string): boolean;
}