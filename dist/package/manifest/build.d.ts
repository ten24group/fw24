export interface BuildOptions {
    rootDir?: string;
    outDir?: string;
    reportsDir?: string;
}
export declare function ensureDir(path: string): void;
export declare function buildManifest(options?: BuildOptions): Promise<{
    readonly ok: true;
    readonly manifestPath: string;
    readonly errors?: undefined;
} | {
    readonly ok: false;
    readonly errors: string[];
    readonly manifestPath: string;
}>;
