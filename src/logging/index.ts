import { Logger, ILogObj, ISettingsParam } from 'tslog';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ILogger extends Logger<ILogObj> {}

const logLevels: any = {
  silly: 0,
  trace: 1,
  debug: 2,
  info: 3,
  warn: 4,
  error: 5,
  fatal: 6,
};

const logLevel = logLevels[(process.env.LOG_LEVEL || 'info').toLowerCase()];

export const createLogger = (
  _options: string | Function | ISettingsParam<ILogObj>,
  _logLevel?: 0 | 1 | 2 | 3 | 4 | 5 | 6,
) => {
  _logLevel = _logLevel ?? logLevel;

  if (typeof _options == 'function') {
    _options = _options.name;
  }

  if (typeof _options == 'string') {
    _options = { name: _options, minLevel: logLevel };
  }

  // show line number only for debug and trace
  if (!_options.hideLogPositionForProduction && logLevel > 2) {
    _options.hideLogPositionForProduction = true;
  }

  // set time format
  if (!_options.prettyLogTimeZone) {
    _options.prettyLogTimeZone = 'local';
  }

  const logger = new Logger({
    stylePrettyLogs: false,
    maskValuesOfKeys: [
      'password',
      'confirmPassword',
      'secret',
      'token',
      'apiKey',
      'accessToken',
      'refreshToken',
      'clientSecret',
      'clientId',
      'clientToken',
      'clientCode',
      'clientKey',
      'clientSecret',
      'clientId',
      'clientToken',
      'clientCode',
      'clientKey',
    ],
    maskValuesOfKeysCaseInsensitive: true,
    maskValuesRegEx: [
      /password\s*:\s*([^\s]+)/gi,
      /confirmPassword\s*:\s*([^\s]+)/gi,
      /secret\s*:\s*([^\s]+)/gi,
      /token\s*:\s*([^\s]+)/gi,
      /apiKey\s*:\s*([^\s]+)/gi,
      /accessToken\s*:\s*([^\s]+)/gi,
      /refreshToken\s*:\s*([^\s]+)/gi,
      /clientSecret\s*:\s*([^\s]+)/gi,
      /clientId\s*:\s*([^\s]+)/gi,
      /clientToken\s*:\s*([^\s]+)/gi,
    ],
    ..._options,
    // ensure min log level is always there
    minLevel: _options.minLevel ?? logLevel,
  });

  return logger;
};

export const DefaultLogger: ILogger = createLogger('[*]');

export { LogDuration } from '../decorators/log-duration';
