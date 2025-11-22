import type { LayerVersionProps } from 'aws-cdk-lib/aws-lambda';
import type { BuildOptions } from 'esbuild';
export type LayerEntryOptions = {
    /**
     * specify the layer version props for aws.
     */
    props?: LayerVersionProps;
    /**
     * specify the layer name, defaults to the name of the file.
     */
    layerName?: string;
    /**
     * specifies that this layer is not a global layer and the function/s that want to use this layer will specify it's name in their options.
     */
    notGlobal?: boolean;
    /**
     * Whether this layer should be loaded as an entry package (code executes at module initialization).
     * If false, the layer is only available for imports but doesn't execute.
     * Defaults to false.
     *
     * @example
     * // fw24 runtime layer - available for import but doesn't execute
     * @LayerEntry({ isEntryPackage: false })
     *
     * // di layer - executes DIContainer.ROOT.module() at init
     * @LayerEntry({ isEntryPackage: true })
     */
    isEntryPackage?: boolean;
    /**
     * specify esbuild options for this layer.
     */
    buildOptions?: BuildOptions;
};
/**
 * Decorator to mark a class as an entry point for a Lambda layer.
 * @param props Optional properties for the layer version.
 * @param buildOptions Options for esbuild bundling.
 */
export declare function LayerEntry(options?: LayerEntryOptions): (target: Function) => void;
