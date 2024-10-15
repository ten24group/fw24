import { IBuildAndPackageConfig, LayerConstruct } from "./layer";

export type IDILayerConstructConfig =  Omit<IBuildAndPackageConfig, 'mode' | 'sourcePath' | 'distDirectory'> & {
    /**
     * defaults to './src/di.ts'
     */
    sourcePath ?: string,

    /**
     * defaults to './dist/layers/'
     */
    distDirectory ?: string
    
};

export class DILayerConstruct extends LayerConstruct{

    constructor(config?: IDILayerConstructConfig[]){
        
        config = config?.length  ? config : [{ sourcePath: './src/di.ts' }];

        super( config.map(c => ({
            ...c,
            mode: 'BUILD_AND_PACKAGE',
            sourcePath: c.sourcePath || './src/di.ts',
            distDirectory: c.distDirectory || './dist/layers/',
        })))
    }

}