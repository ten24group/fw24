import { IValidator } from './validator.type';
import {Validator} from './validator';

export * from './validator';
export * from './validator.type'

export const Dummy: IValidator = {
    validate: () => { return Promise.resolve({pass:true}) },
};

export const DefaultValidator = new Validator();