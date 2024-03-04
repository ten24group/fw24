export interface Response {
    body: string;
    statusCode: number;
    headers?: any;
    send: (body: any) => Response;
    json: (body: any) => Response;
    status: (statusCode: number) => Response;
    set: (headers: any) => Response;
    redirect: (location: string) => Response;
    end: (body?: any) => Response;
    
}
