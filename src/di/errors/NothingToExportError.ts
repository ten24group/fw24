import { FrameworkError } from '../../errors';

export class NothingToExportError extends FrameworkError {
    constructor(token: string, containerId: string) {
        super(`Nothing To export; No providers found for ${token}. DIContainer[${containerId}]`);
    }
}
