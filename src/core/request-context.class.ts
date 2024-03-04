import { Request } from '../interfaces/request.interface';
import { APIGatewayEvent, Context } from "aws-lambda";

export class RequestContext implements Request {

    public event: APIGatewayEvent;
    public context: Context;
    public resource: any;
    public body: any;
    public path: string;
    public queryStringParameters: any;
    public headers: any;
    public requestContext: any;
    public stageVariables: any;
    public pathParameters: any;
    public isBase64Encoded: boolean;
    public httpMethod: string;

    constructor(event: APIGatewayEvent, context: Context) {
        this.event = event;
        this.context = context;
        this.resource = event.resource;
        //this.body = event.body;
        this.path = event.path;
        this.queryStringParameters = event.queryStringParameters;
        this.headers = event.headers || {};
        this.requestContext = event.requestContext;
        this.stageVariables = event.stageVariables;
        this.pathParameters = event.pathParameters;
        this.isBase64Encoded = event.isBase64Encoded;
        this.httpMethod = event.httpMethod;

        if (event.body) {
            // application/x-www-form-urlencoded
            if (event.headers['Content-Type'] === 'application/x-www-form-urlencoded') {
                this.body = {};
                event.body.split('&').forEach((param) => {
                    const [key, value] = param.split('=');
                    this.body[key] = value;
                });
            }
            //application/json
            else if (event.headers['Content-Type'] === 'application/json') {
                try{
                    this.body = JSON.parse(event.body);
                }catch(e){
                    this.body = event.body;
                }
            }
            //multipart/form-data
            else if (event.headers['Content-Type'] === 'multipart/form-data') {
                // TODO: parse multipart/form-data
                this.body = event.body;
            }else{
                this.body = event.body;
            }
        }
    }

    get(key: string): any {
        if (this.pathParameters && this.pathParameters[key]) {
            return this.pathParameters[key];
        }
        if (this.queryStringParameters && this.queryStringParameters[key]) {
            return this.queryStringParameters[key];
        }
        if (this.body && this.body[key]) {
            return this.body[key];
        }
    }

    param(key: string): any {
        if (this.pathParameters && this.pathParameters[key]) {
            return this.pathParameters[key];
        }
    }

    query(key: string): any {
        if (this.queryStringParameters && this.queryStringParameters[key]) {
            return this.queryStringParameters[key];
        }
    }

    post(key: string): any {
        if (this.body && this.body[key]) {
            return this.body[key];
        }
    }
}
