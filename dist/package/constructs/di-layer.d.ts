import { IBuildAndPackageConfig, LayerConstruct } from "./layer";
export type IDILayerConstructConfig = Omit<IBuildAndPackageConfig, 'mode' | 'sourcePath' | 'distDirectory'> & {
    /**
     * defaults to './src/di.ts'
     */
    sourcePath?: string;
    /**
     * defaults to './dist/layers/'
     */
    distDirectory?: string;
};
export declare class DILayerConstruct extends LayerConstruct {
    constructor(config?: IDILayerConstructConfig[]);
}
