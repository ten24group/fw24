import { CapabilityDescriptor, ResourceIntent } from './types';
export interface ExtractOptions {
    rootDir?: string;
    srcDirs?: string[];
    registriesDir?: string;
}
export declare function extractCapabilities(rootDir?: string): {
    capabilities: CapabilityDescriptor[];
    intents: ResourceIntent[];
};
export declare function extractToRegistries(options?: ExtractOptions): {
    capabilities: number;
    intents: number;
};
