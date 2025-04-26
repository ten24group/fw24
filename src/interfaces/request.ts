import type { APIGatewayEvent, Context } from "aws-lambda";
export interface Request {
    event: APIGatewayEvent;
    requestId: string;
    context: Context;
    resource: any;
    body: any;
    path: string;
    queryStringParameters: Record<string, any>;
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