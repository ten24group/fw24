import { DIContainer } from '../di/container';
import { DIModule } from '../di/decorators';
import { IDIContainer } from '../interfaces';

/**
 * Configuration for the framework bootstrap
 */
export interface BootstrapConfig {
    /**
     * Root module that serves as the entry point for the application
     */
    rootModule?: any;

    /**
     * Custom initialization function to configure the container
     */
    initialize?: (container: IDIContainer) => void;
}

// Track initialization state
let initialized = false;
let bootstrappingContainer: IDIContainer | null = null;

/**
 * Initialize the application container
 * 
 * @param config Bootstrap configuration
 * @returns The initialized root container
 */
export function bootstrap(config: BootstrapConfig = {}): IDIContainer {
    if (initialized && bootstrappingContainer) {
        throw new Error(`Container already initialized: ${bootstrappingContainer?.containerId}`);
    }

    // Get the root container
    bootstrappingContainer = DIContainer.ROOT as IDIContainer;

    // Apply custom initialization if provided
    if (config.initialize && typeof config.initialize === 'function') {
        config.initialize(bootstrappingContainer);
    }

    // Register root module if provided
    if (config.rootModule) {
        bootstrappingContainer = bootstrappingContainer.module(config.rootModule)?.container;
    }

    // Mark as initialized
    initialized = true;

    return bootstrappingContainer;
}

/**
 * Get the root container, bootstrapping it if necessary
 * 
 * @returns The root container
 */
export function getBootstrappingContainer(): IDIContainer {
    if (!initialized) {
        return bootstrap();
    }

    return bootstrappingContainer as IDIContainer;
}

/**
 * Create a bootstrap module that configures the application
 * 
 * @param config Bootstrap configuration
 * @returns The bootstrap module class
 */
export function createBootstrapModule(config: BootstrapConfig = {}): any {
    @DIModule()
    class BootstrapModule { }

    // Bootstrap with this module
    bootstrap({
        rootModule: BootstrapModule,
        ...config
    });

    return BootstrapModule;
}

/**
 * Reset the bootstrap state (mainly for testing)
 */
export function resetBootstrap(): void {
    initialized = false;
    bootstrappingContainer = null;
}