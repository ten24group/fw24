import { FrameworkError } from '../../errors';
export declare class InitializationMethodTypeError extends FrameworkError {
    constructor(initMethod: string, instanceName: string, containerId: string);
}
