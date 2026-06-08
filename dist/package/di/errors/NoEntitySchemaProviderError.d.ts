import { FrameworkError } from '../../errors';
export declare class NoEntitySchemaProviderError extends FrameworkError {
    constructor(entityName: string, containerId: string);
}
