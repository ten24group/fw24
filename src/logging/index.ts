
export * as Logger from './'

export type Level = 'debug' | 'info' | 'warn' | 'error';

export interface ILogger {
  trace(message?: any, ...optionalParams: any[]): void;
  debug(message?: any, ...optionalParams: any[]): void;
  info(message?: any, ...optionalParams: any[]): void;
  warn(message?: any, ...optionalParams: any[]): void;
  error(message?: any, ...optionalParams: any[]): void;
  [x: string]: any;
}

export const Dummy: ILogger = {
    trace: (_message?: any, ..._optionalParams: any[]) => {},
    debug: (_message?: any, ..._optionalParams: any[]) => {},
    info: (_message?: any, ..._optionalParams: any[]) => {},
    warn: (_message?: any, ..._optionalParams: any[]) => {},
    error: (_message?: any, ..._optionalParams: any[]) => {},
};

export const Default: ILogger = {
    trace: (_message?: any, ..._optionalParams: any[]) => {
        console.log(_message, _optionalParams);
    },
    debug: (_message?: any, ..._optionalParams: any[]) => {
        console.debug(_message, _optionalParams);
    },
    info: (_message?: any, ..._optionalParams: any[]) => {
        console.info(_message, _optionalParams);
    },
    warn: (_message?: any, ..._optionalParams: any[]) => {
        console.warn(_message, _optionalParams);
    },
    error: (_message?: any, ..._optionalParams: any[]) => {
        console.error(_message, _optionalParams);
    },
};