import { IValidator } from './validator.type';
import {Validator} from './validator';

export * from './validator';
export * from './validator.type'

export * as Validator from "./";

export const Dummy: IValidator = {
    validate: () => { return Promise.resolve({pass:true}) },
};

export const Default = new Validator();