export * as EventDispatcher from './';

export interface IEventDispatcher {
  dispatch(options: any): Promise<void>;
}

export const Dummy: IEventDispatcher = {
  dispatch: () => {
    return Promise.resolve();
  },
};

export const Default: IEventDispatcher = {
  dispatch: async (options: any) => {
    console.log('Called default-event-dispatcher.dispatch()', options);
  },
};
