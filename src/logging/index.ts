
import { Logger as TLogger, LoggerService, LoggerConfig, LoggerFilter} from '@mu-ts/logger';

export interface ILogger extends TLogger {
}

export const DefaultLogger = LoggerService.named('--');

export const createLogger = (_options: string | LoggerConfig, filters?: LoggerFilter[]) => {
    if(typeof _options == 'string'){
        _options = { name: _options};
    }

    // *** Uncomment for debugging multiple instances of same class ***
    // _options.name = randomUUID().split('-').at(-1) + '>' + _options.name;

    return LoggerService.named(_options, filters);
}

export {
    inOut as LogInOut,
    duration as LogDuration,
} from '@mu-ts/logger';