import { parseValueToCorrectTypes } from '../../utils/parse';
import { createLogger, ILogger } from '../../logging';
import { Request } from '../../interfaces/request';
import { APIGatewayEvent, Context } from "aws-lambda";
import { resolveEnvValueFor } from '../../utils/env';
import { ENV_KEYS } from '../../const';

type RecordWithOptionalValues = Record<string, any>;

export class RequestContext implements Request {

    private readonly _logger: ILogger;

    public body: any;
    public context: Context;
    public debugMode: boolean;
    public event: APIGatewayEvent;
    public headers: RecordWithOptionalValues;
    public httpMethod: string;
    public isBase64Encoded: boolean;
    public path: string;
    public pathParameters: RecordWithOptionalValues;
    public queryStringParameters: RecordWithOptionalValues;
    public requestContext: any;
    public resource: any;
    public stageVariables: any;
    public requestId: string;

    constructor(event: APIGatewayEvent, context: Context) {
        event = event || {};

        this.event = event;

        this._logger = createLogger({ name: `RequestContext: [${this.event.path}]` });

        this.path = event.path;
        this.context = context;

        this.resource = event.resource;
        this.httpMethod = event.httpMethod;

        this.requestContext = event.requestContext;
        this.stageVariables = event.stageVariables;

        this.isBase64Encoded = event.isBase64Encoded;

        this.pathParameters = event.pathParameters || {};
        this.queryStringParameters = this.parseQueryStringParameters(event.queryStringParameters || {});

        this.debugMode = this.checkDebugMode(this.queryStringParameters);

        this.headers = this.parseHeaders(event.headers || {});

        this.requestId = context.awsRequestId || `req-${Date.now()}`;

        const contentType = this.getHeader('content-type');

        this.body = this.parseBody(event.body, contentType, this.isBase64Encoded);
    }

    private parseQueryStringParameters(params: RecordWithOptionalValues): RecordWithOptionalValues {
        return Object.keys(params).reduce((acc: any, key) => {
            acc[ key ] = parseValueToCorrectTypes(params[ key ]);
            return acc;
        }, {});
    }

    private parseHeaders(headers: RecordWithOptionalValues): RecordWithOptionalValues {
        return Object.keys(headers).reduce((acc: any, key) => {
            acc[ key.toLowerCase() ] = headers[ key ].toLowerCase();
            return acc;
        }, {});
    }

    private checkDebugMode(params: RecordWithOptionalValues): boolean {
        const debugPassword = resolveEnvValueFor({ key: ENV_KEYS.DEBUG_PASSWORD }) ?? true;
        if (params?.debug === debugPassword) {
            delete params.debug;
            return true;
        }
        return false;
    }

    private parseBody(body: string | null, contentType: string, isBase64Encoded: boolean): any {
        this._logger.debug("Parsing the event body...", body, contentType);

        if (!body) return null;

        if (contentType == 'application/x-www-form-urlencoded') {

            if (isBase64Encoded) {
                body = Buffer.from(body, 'base64').toString('utf8');
            }

            return body.split('&').reduce((acc: any, param) => {
                const [ key, value ] = param.split('=');
                acc[ key ] = value;
                return acc;
            }, {});
        }

        if (contentType.startsWith('application/json')) {

            if (isBase64Encoded) {
                this._logger.info("Decoding the base64 encoded body...");
                body = Buffer.from(body, 'base64').toString('utf8');
            }

            try {
                return JSON.parse(body);
            } catch (e) {
                this._logger.error("Error in parsing the event body...", body);
                return body;
            }
        }

        if (contentType == 'multipart/form-data') {
            // TODO: parse multipart/form-data
            // return body;
        }

        return body;
    }

    getParam(key: string): any {
        return this.pathParameters[ key ] || this.queryStringParameters[ key ] || this.body[ key ];
    }

    hasParam(key: string): boolean {
        return !!(this.pathParameters[ key ] || this.queryStringParameters[ key ] || this.body[ key ]);
    }

    getPathParam(key: string): any {
        return this.pathParameters[ key ];
    }

    hasPathParam(key: string): boolean {
        return !!this.pathParameters[ key ];
    }

    getQueryParam(key: string): any {
        return this.queryStringParameters[ key ];
    }

    hasQueryParam(key: string): boolean {
        return !!this.queryStringParameters[ key ];
    }

    getHeader(key: string): any {
        return this.headers[ key ];
    }

    hasHeader(key: string): boolean {
        return !!this.headers[ key ];
    }

    getBodyParam(key: string): any {
        return this.body[ key ];
    }

    hasBodyParam(key: string): boolean {
        return !!this.body[ key ];
    }
}
