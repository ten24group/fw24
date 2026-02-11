import { FrameworkError } from '../../errors';
export declare class NothingToExportError extends FrameworkError {
    constructor(token: string, containerId: string);
}
