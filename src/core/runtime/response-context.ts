import { Response } from '../../interfaces/response';

export class ResponseContext implements Response {
    public headers: any = {};
    public body: string = '';
    public statusCode: number = 200;
    public isBase64Encoded: boolean = false;

    send(body:string): Response {
        this.body = body;
        return this;
    }
    json(body:any): Response  {
        this.body = JSON.stringify(body);
        this.headers['Content-Type'] = 'application/json';
        return this;
    }
    status(statusCode:number): Response  {
        this.statusCode = statusCode;
        return this;
    }
    setHeader(key:string, value:any): Response  {
        this.headers[key] = value;
        return this;
    }
    getHeader(key:any) {
        return this.headers[key];
    }
    getHeaders() {
        return this.headers;
    }
    getBody() {
        return this.body;
    }
    getStatusCode() {
        return this.statusCode;
    }
    set(body:string, statusCode:number = 200): Response {
        this.body = body;
        this.statusCode = statusCode;
        return this;
    }
    redirect(location:string): Response {
        this.statusCode = 302;
        this.headers['Location'] = location;
        return this;
    }
    end(body:string): Response {
        this.body = body;
        return this;
    }
}