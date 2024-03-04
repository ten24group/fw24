import { APIGatewayEvent, Context } from "aws-lambda";
/* TODO: refactor this and make easier to access the data */
export interface Request {
    event: APIGatewayEvent;
    context: Context;
    resource: any;
    body: any;
    path: string;
    queryStringParameters: any;
    headers: any;
    requestContext: any;
    stageVariables: any;
    pathParameters: any;
    isBase64Encoded: boolean;
    httpMethod: string;
}