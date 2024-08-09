// decorators/layer-entry.ts
import { LayerVersionProps } from 'aws-cdk-lib/aws-lambda';
import { BuildOptions } from 'esbuild';


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

        let { layerName, props, buildOptions } = options;
        
        layerName = layerName || target.name; // maybe use some internal token to avoid conflicts

        Reflect.set(target, 'layerName', layerName);
        Reflect.set(target, 'layerProps', props);
        Reflect.set(target, 'buildOptions', buildOptions);
    };
}
