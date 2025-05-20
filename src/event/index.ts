import { EventDispatcher } from './dispatcher';

export { IEventDispatcher } from './dispatcher';

export const Default = new EventDispatcher();

export * as EventDispatcher from '.';