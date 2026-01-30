import { FrameworkError } from '../../errors';
export declare class ModuleMetadataError extends FrameworkError {
    constructor(moduleName: string, containerId: string);
}
