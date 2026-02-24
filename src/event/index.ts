import { defaultEventDispatcher } from './dispatcher';
import { IEventDispatcher } from './event-types';

export * from './decorator';
export * from './dispatcher';
export * from './event-types';
export * from './event-utils';

export const Dummy: IEventDispatcher = {
    dispatch: () => { return Promise.resolve() },
    on: () => { },
    onAsync: () => { },
    off: () => { },
    awaitAsyncHandlers: () => Promise.resolve()
};

export const Default: IEventDispatcher = defaultEventDispatcher;

// For backward compatibility with the placeholder EventDispatcher in develop branch
export * as EventDispatcher from './index';
