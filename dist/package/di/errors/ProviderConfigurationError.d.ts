import { FrameworkError } from '../../errors';
export declare class ProviderConfigurationError extends FrameworkError {
    constructor(providerId: string, containerId: string);
}
