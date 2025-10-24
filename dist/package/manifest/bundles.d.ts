export interface BundleReportOptions {
    rootDir?: string;
    reportsDir?: string;
    metafilePath?: string;
}
export declare function writeBundleReport(options?: BundleReportOptions): {
    ok: false;
    outPath: string;
} | {
    ok: true;
    outPath: string;
};
