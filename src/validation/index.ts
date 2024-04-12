import { IValidator } from './validator.type';
import {Validator} from './validator';

export * from './validator';
export * from './validator.type'

export const DefaultValidator = new Validator();