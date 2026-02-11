export * as EventDispatcher from './';
export interface IEventDispatcher {
    dispatch(options: any): Promise<void>;
}
export declare const Dummy: IEventDispatcher;
export declare const Default: IEventDispatcher;
