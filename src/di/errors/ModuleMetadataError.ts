import { FrameworkError } from '../../errors';

// Define custom error classes
export class ModuleMetadataError extends FrameworkError {
    constructor(moduleName: string, containerId: string) {
        super(`Module ${moduleName} does not have any metadata, make sure it's decorated with @DIModule(). DIContainer[${containerId}]`);
    }
}
