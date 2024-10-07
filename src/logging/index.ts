
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

const logLevel = logLevels[(process.env.LOG_LEVEL || 'info').toLowerCase()];

export const createLogger = (_options: string | Function | ISettingsParam<ILogObj>) => {
    
    if(typeof _options == 'function'){
        _options = _options.name;
    }
    if (typeof _options == 'string') {
        _options = { name: _options, minLevel: logLevel};
    }
    // show line number only for debug and trace
    if(!_options.hideLogPositionForProduction && logLevel > 2){
        _options.hideLogPositionForProduction = true;
    }
    // set time format
    if(!_options.prettyLogTimeZone){
        _options.prettyLogTimeZone = 'local';
    }

    const logger = new Logger({
        ..._options, 
        // ensure min log level is always there
        minLevel: _options.minLevel ?? logLevel 
    });
    
    return logger;
}

export const DefaultLogger: ILogger = createLogger('[DefaultLogger]');

export {
    LogDuration
} from '../decorators/LogDuration';