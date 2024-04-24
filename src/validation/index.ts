import { IValidator } from './types';
import {Validator} from './validator';

export * from './validator';
export * from './types'

export const DefaultValidator = new Validator();