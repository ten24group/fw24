
import { Logger, ILogObj, ISettingsParam} from "tslog";

export interface ILogger extends Logger<ILogObj> {
}

const logLevels: any = {
    "silly": 0,
    "trace": 1,
    "debug": 2,
    "info": 3,
    "warn": 4,
    "error": 5,
    "fatal": 6,
};

const logLevel = logLevels[process.env.LOG_LEVEL || 'info'];
export const DefaultLogger: ILogger = new Logger();

export const createLogger = (_options: string | ISettingsParam<ILogObj>) => {
    if (typeof _options == 'string') {
        _options = { name: _options, minLevel: logLevel};
    }
    // show line number only for debug and trace
    if(!_options.hideLogPositionForProduction && logLevel > 2){
        _options.hideLogPositionForProduction = true;
    }

    const logger = new Logger(_options);
    return logger;
}

export {
    inOut as LogInOut,
    duration as LogDuration,
} from '@mu-ts/logger';