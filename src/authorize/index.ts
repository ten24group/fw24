export * as Authorizer from '.';

export interface IAuthorizer {
    authorize (options: any): Promise<IAuthorizerResponse>;
}

export interface IAuthorizerResponse {
    pass: boolean;
    errors?: {[key:string]: any} 
}

export const Dummy: IAuthorizer = {
    authorize: () => { return Promise.resolve({pass:true}) },
};


export const Default: IAuthorizer = {
    authorize: async (options: any) => {
        console.log("Called default authorizer.authorize()", options);
        return {pass: true};
    }
};
