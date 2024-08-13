// decorators/layer-entry.ts
import type { LayerVersionProps } from 'aws-cdk-lib/aws-lambda';
import type { BuildOptions } from 'esbuild';

export type LayerEntryOptions = {
    layerName?: string,
    props?: LayerVersionProps,
    buildOptions?: BuildOptions
}

/**
 * Decorator to mark a class as an entry point for a Lambda layer.
 * @param props Optional properties for the layer version.
 * @param buildOptions Options for esbuild bundling.
 */
export function LayerEntry( options: LayerEntryOptions = {} ) {
    return function (target: Function) {

        let { layerName, props={}, buildOptions={} } = options;
        
        Reflect.set(target, 'isLayerEntry', true);
        Reflect.set(target, 'layerName', layerName);
        Reflect.set(target, 'layerProps', props);

        if(!buildOptions.external){
            buildOptions.external = []; // default external modules
        }
        
        Reflect.set(target, 'buildOptions', buildOptions);
    };
}
