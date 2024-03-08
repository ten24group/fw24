export * as Validator from './';

export interface IValidatorResponse {
    pass: boolean;
    errors?: {[key:string]: any} 
}

export interface IValidator {
    validate (options: any): Promise<IValidatorResponse>;
}

export const Dummy: IValidator = {
    validate: () => { return Promise.resolve({pass:true}) },
};


export const Default: IValidator = {

    validate: async (options: any) => {
        console.log("Called default validator.validate()", options);

        return {pass: true};
    }
};