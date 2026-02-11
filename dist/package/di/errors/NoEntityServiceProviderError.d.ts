import { FrameworkError } from '../../errors';
export declare class NoEntityServiceProviderError extends FrameworkError {
    constructor(entityName: string, containerId: string);
}
