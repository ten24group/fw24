import { Manifest } from './types';
import { DUMappingResult } from './du-mapping';
export interface BootstrapGenOptions {
    outputDir: string;
    rootDir: string;
}
export declare function generateDUBootstraps(manifest: Manifest, mapping: DUMappingResult, options: BootstrapGenOptions): void;
