import { FrameworkError } from '../../errors';

export class ProviderConfigurationError extends FrameworkError {
    constructor(providerId: string, containerId: string) {
        super(`Provider for '${providerId}' is not correctly configured. DIContainer[${containerId}]`);
    }
}
