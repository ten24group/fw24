import type { PartialBy } from '../../utils/types';
import type { BaseProviderOptions, ClassConstructor, IDIContainer } from './../../interfaces/di';
export type InjectableOptions = PartialBy<BaseProviderOptions, 'provide'> & {
    providedIn?: 'ROOT' | IDIContainer | ClassConstructor;
};
export declare function tryRegisterInjectable(target: ClassConstructor, options: InjectableOptions): void;
