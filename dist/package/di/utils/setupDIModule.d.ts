import { type RegisterDIModuleMetadataOptions } from "../metadata";
import { ClassConstructor, IDIContainer } from "../../interfaces/di";
/**
 * Sets up Dependency Injection (DI) for a class and returns the DI container.
 *
 * @param target - The class for which DI is being set up.
 * @param options - DI options including the container and module configurations.
 * @param fallbackToRootContainer - Whether to use the default DIContainer.ROOT if resolvingContainer is not specified in di options.
 * @returns The DI container used for the setup.
 */
export declare function setupDIModule<T>(options: {
    target: ClassConstructor<T>;
    module: RegisterDIModuleMetadataOptions;
    fallbackToRootContainer?: boolean;
}): IDIContainer | undefined;
