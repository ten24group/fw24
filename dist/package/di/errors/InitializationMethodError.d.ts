import { FrameworkError } from '../../errors';
export declare class InitializationMethodError extends FrameworkError {
    constructor(instanceName: string, errorMessage: string, containerId: string);
}
