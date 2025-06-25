import type { APIGatewayEvent, Context } from "aws-lambda";

export type RequestDataType = {
    body?: any,
    query?: Record<string, any>,
    path?: Record<string, any>,
    headers?: Record<string, any>,
}

export interface Request<T extends RequestDataType = RequestDataType> {
    event: APIGatewayEvent;
    requestId: string;
    context: Context;
    resource: any;
    body: T[ 'body' ];
    path: string;
    queryStringParameters: T[ 'query' ] & Record<string, any>;
    headers: T[ 'headers' ] & Record<string, any>;
    requestContext: any;
    stageVariables: any;
    pathParameters: T[ 'path' ] & Record<string, any>;
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