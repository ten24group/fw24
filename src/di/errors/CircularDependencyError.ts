import { FrameworkError } from '../../errors';

export class CircularDependencyError extends FrameworkError {
    constructor(path: string[], containerId: string) {
        super(`Circular dependency detected: ${path.join(' -> ')}. DIContainer[${containerId}]`);
    }
}
