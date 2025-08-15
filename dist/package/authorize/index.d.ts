export * as Authorizer from '.';
export interface IAuthorizer {
    authorize(options: any): Promise<IAuthorizerResponse>;
}
export interface IAuthorizerResponse {
    pass: boolean;
    errors?: {
        [key: string]: any;
    };
}
export declare const Dummy: IAuthorizer;
export declare const Default: IAuthorizer;
