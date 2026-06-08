import { Logger, ILogObj, ISettingsParam } from "tslog";
export interface ILogger extends Logger<ILogObj> {
}
export declare const createLogger: (_options: string | Function | ISettingsParam<ILogObj>, _logLevel?: 0 | 1 | 2 | 3 | 4 | 5 | 6) => Logger<ILogObj>;
export declare const DefaultLogger: ILogger;
export { LogDuration } from '../decorators/log-duration';
export { logtrailTransport, resolveLogtrailVectorIngest, setLogtrailVectorIngest, shipLogtrailVectorJson, type LogtrailVectorIngestConfig, } from './logtrail';
