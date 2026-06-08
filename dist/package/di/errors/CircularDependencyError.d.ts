import { FrameworkError } from '../../errors';
export declare class CircularDependencyError extends FrameworkError {
    constructor(path: string[], containerId: string);
}
