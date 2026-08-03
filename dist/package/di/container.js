"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DIContainer = void 0;
const uuid_1 = require("uuid");
const metadata_1 = require("../utils/metadata");
const index_1 = require("./../logging/index");
const decorators_1 = require("./decorators");
const di_1 = require("./../utils/di");
const utils_1 = require("./utils");
const metadata_2 = require("./metadata");
const const_1 = require("../const");
const errors_1 = require("./errors");
class DIContainer {
    parentContainer;
    /**
     * Shared across ALL fw24 copies in the process (bundled in Lambda + layer), same as ROOT
     * below and for the same reason: ROOT is a global singleton, so a method invoked on it can
     * execute in a different fw24 copy than the one whose decorators wrote the metadata. With a
     * per-copy static store, that read misses ("Module X does not have any metadata") and the
     * entry-package load dies. Metadata is keyed by class NAME, so one shared store is correct.
     */
    static get DIMetadataStore() {
        const g = global;
        if (!g.__fw24_di_metadata_store__) {
            g.__fw24_di_metadata_store__ = new metadata_1.MetadataManager({ namespace: 'fw24:di' });
        }
        return g.__fw24_di_metadata_store__;
    }
    containerId;
    logger;
    middlewares = [];
    asyncMiddlewares = [];
    _resolving = new Map();
    get resolving() {
        if (this.proxyFor) {
            return this.proxyFor.resolving;
        }
        if (!this._resolving) {
            this._resolving = new Map();
        }
        return this._resolving;
    }
    _cache = new Map();
    get cache() {
        if (this.proxyFor) {
            return this.proxyFor.cache;
        }
        if (!this._cache) {
            this._cache = new Map();
        }
        return this._cache;
    }
    _providers;
    get providers() {
        if (this.proxyFor) {
            return this.proxyFor.providers;
        }
        if (!this._providers) {
            this._providers = new Map();
        }
        return this._providers;
    }
    _exports;
    get exports() {
        if (this.proxyFor) {
            return this.proxyFor.exports;
        }
        if (!this._exports) {
            this._exports = new Map();
        }
        return this._exports;
    }
    // when this container is a proxy for another container; the another container's ref will be stored here
    proxyFor;
    get parent() {
        return this.parentContainer;
    }
    _childContainers;
    get childContainers() {
        if (this.proxyFor) {
            return this.proxyFor.childContainers;
        }
        if (!this._childContainers) {
            this._childContainers = new Set();
        }
        return this._childContainers;
    }
    _proxies;
    get proxies() {
        if (this.proxyFor) {
            return this.proxyFor.proxies;
        }
        if (!this._proxies) {
            this._proxies = new Set();
        }
        return this._proxies;
    }
    /**
     * Global ROOT container shared across ALL fw24 instances (bundled + layer).
     * Stored in global object to ensure singleton behavior even when multiple
     * fw24 module graphs exist (e.g., bundled in Lambda + layer).
     */
    static _rootInstance;
    static get ROOT() {
        // Check global first for cross-instance sharing
        const globalRoot = global.__fw24_di_root_container__;
        if (globalRoot) {
            return globalRoot;
        }
        // Create if doesn't exist
        if (!this._rootInstance) {
            this._rootInstance = new DIContainer();
            // Store in global for cross-instance access
            global.__fw24_di_root_container__ = this._rootInstance;
        }
        return this._rootInstance;
    }
    searchEngine;
    constructor(parentContainer, identifier = 'ROOT') {
        this.parentContainer = parentContainer;
        // to ensure destructuring works correctly
        this.Injectable = this.Injectable.bind(this);
        this.containerId = identifier;
        this.logger = (0, index_1.createLogger)(`DIContainer[${identifier}]`);
    }
    Injectable(options = {}) {
        return (0, decorators_1.Injectable)({ ...options, providedIn: this });
    }
    createChildContainer(identifier) {
        const child = new DIContainer(this, identifier);
        this.childContainers.add(child);
        return child;
    }
    createChildContainerProxyIdentifier(parentContainer) {
        return `${this.containerId}:ProxyIn[${parentContainer.containerId}]`;
    }
    addProxyContainerIn = (parentContainer) => {
        const proxyContainerId = this.createChildContainerProxyIdentifier(parentContainer);
        // make sure to remove old proxy from the importing module if exists
        if (parentContainer.hasChildContainerById(proxyContainerId)) {
            this.logger.debug(`Found old proxy container: [${proxyContainerId}] in parent: [${parentContainer.containerId}]; replacing it`);
            const oldProxyContainer = parentContainer.getChildContainerById(proxyContainerId);
            parentContainer.removeChildContainerById(proxyContainerId);
            this.proxies.delete(oldProxyContainer);
        }
        const newProxyContainer = parentContainer.createChildContainer(proxyContainerId);
        newProxyContainer.proxyFor = this;
        this.proxies.add(newProxyContainer);
        return newProxyContainer;
    };
    hasChildContainerById(identifier) {
        let found = Array.from(this.childContainers).some(element => element.containerId.startsWith(identifier));
        if (!found && this.childContainers.size > 0) {
            found = Array.from(this.childContainers).some(cc => cc.hasChildContainerById(identifier));
        }
        return found;
    }
    removeChildContainerById(identifier) {
        const childContainer = this.getChildContainerById(identifier);
        this.childContainers.delete(childContainer);
    }
    getChildContainerById(identifier) {
        let foundContainer = Array.from(this.childContainers).find(element => {
            return element.containerId.startsWith(identifier);
        });
        if (!foundContainer && this.childContainers.size > 0) {
            for (const cc of this.childContainers) {
                foundContainer = cc.getChildContainerById(identifier);
                if (foundContainer) {
                    break;
                }
            }
        }
        return foundContainer;
    }
    module(target) {
        const moduleMeta = (0, metadata_2.getModuleMetadata)(target);
        if (!moduleMeta) {
            throw new errors_1.ModuleMetadataError(target.name, this.containerId);
        }
        const { imports = [], exports = [], providers = [], identifier } = moduleMeta;
        // if there's no container in the module metadata, create the main container for the module
        if (!moduleMeta.hasContainer()) {
            const moduleContainer = new DIContainer(undefined, identifier);
            // this.logger.info(`Module ${moduleMeta.identifier} metadata does not have a container, assigning one.`, { id: moduleContainer.containerId });
            moduleMeta.setContainer(moduleContainer);
            // make sure all the module providers are loaded into the module's container's providers
            for (const provider of providers) {
                moduleContainer.register(provider);
            }
            // and make sure all the module exports are also loaded into the module's container's providers
            for (const importedModule of imports) {
                moduleContainer.module(importedModule);
            }
            // load all the export from this module into the current container
            for (const exportedDep of exports) {
                moduleContainer.exportProvidersFor(exportedDep);
            }
            // TODO: module lifecycle hooks
        }
        const moduleProxyContainer = moduleMeta.container.addProxyContainerIn(this);
        return {
            identifier,
            container: moduleProxyContainer
        };
    }
    exportProvidersFor(exportedDep) {
        const token = this.createToken(exportedDep);
        let foundProvidersForToken = false;
        // Collect providers directly matching the export token
        const availableProviders = this.providers.get(token) || [];
        const childExportedProviders = Array.from(this.childContainers)
            .flatMap(child => child.exports.get(token) || []);
        // Combine available providers and child exported providers
        const allProviders = [...availableProviders, ...childExportedProviders];
        // Nested function to map and export providers
        const mapAndExportProviders = (providers, targetToken) => {
            foundProvidersForToken = true;
            const exported = providers.map(provider => {
                const { _container, _provider, _id } = provider;
                const { condition, provide, priority, override, singleton, tags, type, forEntity } = _provider;
                return {
                    _provider: {
                        useFactory: () => _container.resolve(provide),
                        condition,
                        provide,
                        priority,
                        override,
                        singleton,
                        tags,
                        type,
                        forEntity,
                    },
                    _id,
                    _container: this
                };
            });
            // Merge or set these exported providers under their respective keys
            const existingExports = this.exports.get(targetToken) || [];
            this.exports.set(targetToken, [...existingExports, ...exported]);
        };
        if (allProviders.length > 0) {
            // Export the standard and config providers directly matching the token
            mapAndExportProviders(allProviders, token);
        }
        // Find all config providers whose keys start with the token and export them
        for (const [configKey, configProviders] of this.providers.entries()) {
            if (configKey.startsWith(token) && configProviders.some(p => p._provider.type === 'config')) {
                mapAndExportProviders(configProviders, configKey);
            }
        }
        if (!foundProvidersForToken) {
            throw new errors_1.NothingToExportError(token, this.containerId);
        }
    }
    createToken(tokenOrType) {
        // maybe add a mechanism for adding extra metadata to the token like container ID and stuff?
        return (0, utils_1.makeDIToken)(tokenOrType);
    }
    register(options, container = this) {
        if (container !== this) {
            return container.register(options);
        }
        const token = this.createToken(options.provide);
        const optionsCopy = {
            ...options,
            type: options.type || 'unknown',
            priority: options.priority !== undefined ? options.priority : 0,
            singleton: options.singleton !== undefined ? options.singleton : true,
        };
        if (optionsCopy.condition && !optionsCopy.condition())
            return;
        (0, utils_1.validateProviderOptions)(optionsCopy, token);
        // Handle config providers
        if ((0, di_1.isConfigProviderOptions)(options)) {
            this.registerConfigProvider(options);
        }
        else {
            this.registerProvider({ _provider: optionsCopy });
        }
        return {
            provide: token,
            options: optionsCopy,
        };
    }
    registerConfigProvider(options) {
        const { useConfig, provide: provide, ...rest } = options;
        let provideToken = (0, utils_1.stripDITokenNamespace)(this.createToken(provide));
        const flattenedEntries = (0, utils_1.flattenConfig)(useConfig, provideToken);
        for (const [configPath, value] of flattenedEntries) {
            this.registerProvider({
                _provider: {
                    ...rest,
                    type: 'config',
                    provide: configPath,
                    useConfig: value,
                },
            });
        }
    }
    registerProvider(options) {
        const currentProvider = options._provider;
        const token = this.createToken(currentProvider.provide);
        currentProvider._token = token;
        const tokenProviders = this.providers.get(token) || [];
        const areBothValuesEqual = (value1, value2) => {
            return (value1 == null && value2 == null) || (value1 !== null && value1 !== undefined && value1 === value2);
        };
        const areBothArraysEqual = (arr1, arr2) => {
            if (arr1 == null && arr2 == null)
                return true;
            if (arr1 == null || arr2 == null || arr1.length !== arr2.length)
                return false;
            return [...arr1].sort().every((value, index) => value === arr2.slice().sort()[index]);
        };
        // if token providers already has a provider with same priority, type, forEntity and tags, log warning and replace it
        const existingProvider = tokenProviders.find(({ _provider: existingProvider }) => {
            return existingProvider.priority === currentProvider.priority
                && areBothValuesEqual(existingProvider.type, currentProvider.type)
                && areBothArraysEqual(existingProvider.tags, currentProvider.tags) // ! maybe be make it configurable to compare tags...
                && areBothValuesEqual(existingProvider.forEntity, currentProvider.forEntity);
        });
        if (existingProvider) {
            // const index = tokenProviders.indexOf(existingProvider);
            // delete the existing provider
            // tokenProviders.splice(index, 1);
            // DO NOT replace the existing provider, just log a warning
            // this.logger.warn(`Provider for ${token} with same priority, type, forEntity and tags already exists, replacing it. | Options[${JSON.stringify(options)}]`);
            return;
        }
        const internalProviderOptions = {
            ...options,
            _id: (0, uuid_1.v4)(),
            _container: this,
        };
        tokenProviders.push(internalProviderOptions);
        this.providers.set(token, tokenProviders);
    }
    removeProvidersFor(dependencyToken) {
        const token = this.createToken(dependencyToken);
        const providers = this.providers.get(token) || [];
        providers.forEach(provider => {
            this.cache.delete(provider._id);
        });
        this.providers.delete(token);
    }
    // Resolve a configuration path with flexible criteria, supporting wildcards and regex
    resolveConfig(query = '', criteria) {
        query = (0, utils_1.stripDITokenNamespace)(query);
        const matchingPaths = this.collectMatchingConfigPaths(query);
        const resolvedValues = this.resolveConfigPaths(matchingPaths, criteria);
        // Merge resolved values into a final configuration object
        const mergedConfig = {};
        resolvedValues.forEach((value, path) => {
            path = (0, utils_1.stripDITokenNamespace)(path);
            (0, utils_1.setPathValue)(mergedConfig, path, value);
        });
        return (0, utils_1.getPathValue)(mergedConfig, query);
    }
    // Collect all paths that match the query, supporting wildcards and regex
    collectMatchingConfigPaths(query) {
        const matchingPaths = new Set();
        const processKeys = (keys) => {
            for (const path of keys) {
                const actualPath = (0, utils_1.stripDITokenNamespace)(path);
                if ((0, utils_1.matchesPattern)(actualPath, query)) {
                    matchingPaths.add(path);
                }
            }
        };
        let current = this;
        while (current) {
            // Check the providers in the current container
            processKeys(current.providers.keys());
            // Check the exported providers from child containers
            current.childContainers.forEach(child => {
                processKeys(child.exports.keys());
            });
            // Move to the parent container
            current = current.parent;
        }
        return matchingPaths;
    }
    // Resolve values for all matching paths using the best provider from the hierarchy based on criteria
    resolveConfigPaths(paths, criteria) {
        const resolvedValues = new Map();
        const reduceProviders = (providers) => {
            if (providers.length === 0) {
                return undefined;
            }
            // Assume the highest-priority provider's value is the desired one
            const bestProvider = providers[0]._provider;
            return bestProvider.useConfig;
        };
        paths.forEach((path) => {
            const bestProviders = this.collectBestProvidersFor({
                ...criteria,
                token: path,
                type: 'config'
            });
            const resolvedValue = reduceProviders(bestProviders);
            resolvedValues.set(path, resolvedValue);
        });
        return resolvedValues;
    }
    // Collect all providers for a given path across the hierarchy
    collectBestProvidersFor(criteria) {
        const bestProviders = new Map();
        let current = this;
        let allProvidersFromChildContainers = criteria.allProvidersFromChildContainers || false;
        const visitedContainers = new Set();
        const criteriaString = JSON.stringify(criteria);
        while (current) {
            if (visitedContainers.has(current)) {
                throw new Error(`Circular reference detected in container hierarchy. DIContainer[${this.containerId}] | Criteria: [${criteriaString}]`);
            }
            visitedContainers.add(current);
            let pathProviders = criteria.token
                ? current.providers.get(criteria.token) || []
                : Array.from(current.providers.values()).flat();
            if (criteria?.type) {
                pathProviders = pathProviders.filter(p => p._provider.type === criteria.type);
            }
            if (criteria?.forEntity) {
                pathProviders = pathProviders.filter(p => p._provider.forEntity === criteria.forEntity);
            }
            pathProviders.forEach(provider => {
                if (bestProviders.has(provider._id)) {
                    // this.logger.info(`Provider with id ${provider._id} already exists in best-providers, skipping it. | Criteria: [${criteriaString}]`);
                    return;
                }
                bestProviders.set(provider._id, {
                    ...provider,
                    // when it's a proxy container make sure the provider has it's reference for resolving it later,
                    // that way the provider is resolved using the right hierarchy
                    _container: current
                });
            });
            // Collect exported providers from child containers
            current.childContainers.forEach(child => {
                // as we're moving from child to parent, make sure to skip over the visited containers
                if (visitedContainers.has(child)) {
                    return;
                }
                else {
                    visitedContainers.add(child);
                }
                const childProviders = allProvidersFromChildContainers ? child.providers : child.exports;
                let childExportedProviders = criteria.token ? (childProviders.get(criteria.token) || [])
                    : Array.from(childProviders.values()).flat();
                if (criteria?.type) {
                    childExportedProviders = childExportedProviders.filter(p => p._provider.type === criteria.type);
                }
                if (criteria?.forEntity) {
                    childExportedProviders = childExportedProviders.filter(p => p._provider.forEntity === criteria.forEntity);
                }
                childExportedProviders.forEach(provider => {
                    if (bestProviders.has(provider._id)) {
                        // this.logger.info(`Provider with id ${provider._id} already exists in best-providers, skipping exported-provider from child container: ${child.containerId} | Criteria: [${criteriaString}]`);
                        return;
                    }
                    bestProviders.set(provider._id, {
                        ...provider,
                        // when it's a proxy container make sure the provider has it's reference for resolving it later,
                        _container: child
                    });
                });
            });
            current = current.parent;
        }
        // Filter and sort providers based on criteria and conflict resolution strategies
        const bestProvidersArray = Array.from(bestProviders.values());
        const filteredAndSorted = (0, utils_1.filterAndSortProviders)(bestProvidersArray, criteria);
        // Deduplicate providers by composite key (provide, type, forEntity)
        // Keep only the highest priority provider for each unique combination
        const uniqueProviders = new Map();
        for (const provider of filteredAndSorted) {
            // Create a composite key from provide token, type, and forEntity
            const provideToken = this.createToken(provider._provider.provide);
            const type = provider._provider.type || 'default';
            const forEntity = provider._provider.forEntity || '';
            const compositeKey = `${provideToken}::${type}::${forEntity}`;
            if (!uniqueProviders.has(compositeKey)) {
                uniqueProviders.set(compositeKey, provider);
            }
            // Note: Since filteredAndSorted is already sorted by priority (highest first),
            // the first provider we encounter for each composite key is the best one
        }
        return Array.from(uniqueProviders.values());
    }
    resolve(dependencyToken, criteria, path = new Set(), async = false) {
        const token = this.createToken(dependencyToken);
        criteria = criteria ?? {};
        // if token is `DIContainer` return the current container
        if (const_1.DI_TOKENS.DI_CONTAINER === token || this.createToken(DIContainer) === token) {
            return (async ? Promise.resolve(this) : this);
        }
        const bestProviders = this.collectBestProvidersFor({
            ...criteria,
            token,
        });
        if (bestProviders.length === 0) {
            throw new errors_1.NoProviderFoundError(token, this, criteria);
        }
        const options = bestProviders[0];
        return this.resolveProviderValue(options, path, async);
    }
    resolveProviderValue(options, path = new Set(), async = false) {
        const { _id, _container, _provider: provider } = options;
        if (_container !== this) {
            return _container.resolveProviderValue(options, path, async);
        }
        if (provider.singleton && this.cache.has(_id)) {
            return this.cache.get(_id);
        }
        if (this.resolving.has(_id)) {
            return this.resolving.get(_id);
        }
        if (path.has(_id)) {
            throw new errors_1.CircularDependencyError(Array.from(path), this.containerId);
        }
        path.add(_id);
        if (async) {
            return (0, utils_1.applyMiddlewaresAsync)(this.asyncMiddlewares, () => this.createAndCacheInstanceAsync(options, path));
        }
        return (0, utils_1.applyMiddlewares)(this.middlewares, () => this.createAndCacheInstance(options, path));
    }
    createAndCacheInstance(options, path) {
        const { _id, _provider: provider } = options;
        const instance = this.createInstance(options, path);
        if (provider.singleton) {
            this.cache.set(_id, instance);
        }
        this.resolving.delete(_id);
        this.injectProperties(instance);
        this.initializeInstance(instance);
        path.delete(_id);
        return instance;
    }
    createInstance(options, path, async = false) {
        const { _id, _provider: provider } = options;
        if ((0, di_1.isAliasProviderOptions)(provider)) {
            return this.resolve(provider.useExisting, {}, path, async);
        }
        if ((0, di_1.isClassProviderOptions)(provider)) {
            return (async ? this.createClassInstance(options, path, true)
                : this.createClassInstance(options, path));
        }
        if ((0, di_1.isFactoryProviderOptions)(provider)) {
            return (async ? this.createFactoryInstanceAsync(provider, path)
                : this.createFactoryInstance(provider, path));
        }
        if ((0, di_1.isValueProviderOptions)(provider)) {
            return provider.useValue;
        }
        if ((0, di_1.isConfigProviderOptions)(provider)) {
            return provider.useConfig;
        }
        throw new errors_1.ProviderConfigurationError(_id, this.containerId);
    }
    createClassInstance(options, path, async = false) {
        const { _id, _provider: provider } = options;
        if (this.resolving.has(_id)) {
            return this.resolving.get(_id);
        }
        const { useClass } = provider;
        // Create a placeholder object and store it in the resolving map
        const instancePlaceholder = Object.create(useClass.prototype);
        this.resolving.set(_id, instancePlaceholder);
        if (async) {
            this.resolveDependenciesAsync(useClass, path).then(dependencies => {
                const actualInstance = new useClass(...dependencies);
                Object.assign(instancePlaceholder, actualInstance);
                this.resolving.set(_id, actualInstance);
                return actualInstance;
            });
        }
        const dependencies = this.resolveDependencies(useClass, path);
        const actualInstance = new useClass(...dependencies);
        Object.assign(instancePlaceholder, actualInstance);
        this.resolving.set(_id, actualInstance);
        return actualInstance;
    }
    createFactoryInstance(options, path) {
        const dependencies = (options.deps || []).map(dep => this.resolveDependency(dep, path));
        return options.useFactory(...dependencies);
    }
    getClassDependencies(target) {
        const constructorDependencies = (0, metadata_2.getConstructorDependenciesMetadata)(target);
        const propertyDependencies = (0, metadata_2.getPropertyDependenciesMetadata)(target);
        return {
            propertyDependencies,
            constructorDependencies
        };
    }
    resolveDependency(dep, path, async = false) {
        let normalizedDep = dep;
        if (!(0, di_1.isComplexDependencyIdentifier)(normalizedDep)) {
            normalizedDep = { token: normalizedDep };
        }
        try {
            if (normalizedDep.isConfig) {
                return this.resolveConfig(normalizedDep.token, normalizedDep);
            }
            if (normalizedDep.forEntity) {
                if (normalizedDep.type == 'schema') {
                    return this.resolveEntitySchema(normalizedDep.forEntity, normalizedDep, async);
                }
                if (normalizedDep.type == 'service') {
                    return this.resolveEntityService(normalizedDep.forEntity, normalizedDep, async);
                }
                throw new errors_1.InvalidDependencyCriteriaError(JSON.stringify(normalizedDep));
            }
            return this.resolve(normalizedDep.token, normalizedDep, path, async);
        }
        catch (e) {
            if (e instanceof errors_1.NoProviderFoundError
                &&
                    (normalizedDep.isOptional || normalizedDep.defaultValue !== undefined)) {
                // this.logger.info(`No provider found for ${JSON.stringify(dep)}`, { path })
                return normalizedDep.defaultValue ?? undefined;
            }
            throw e;
        }
    }
    resolveDependencies(target, path) {
        const injectMetadata = (0, metadata_2.getConstructorDependenciesMetadata)(target);
        return injectMetadata.map(dep => this.resolveDependency(dep, path));
    }
    initializeInstance(instance) {
        if (!(0, utils_1.hasConstructor)(instance))
            return;
        const initMethod = (0, metadata_2.getOnInitHookMetadata)(instance.constructor);
        if (initMethod) {
            const theInitMethod = instance[initMethod];
            if (typeof theInitMethod === 'function') {
                try {
                    theInitMethod.call(instance); // Bind 'this' context to the instance
                }
                catch (error) {
                    throw new errors_1.InitializationMethodError(instance.constructor.name, error.message, this.containerId);
                }
            }
            else {
                throw new errors_1.InitializationMethodTypeError(String(initMethod), instance.constructor.name, this.containerId);
            }
        }
    }
    injectProperties(instance) {
        if (!(0, utils_1.hasConstructor)(instance))
            return;
        const dependencies = (0, metadata_2.getPropertyDependenciesMetadata)(instance.constructor);
        for (const dep of dependencies) {
            const propertyValue = this.resolveDependency(dep, new Set());
            Object.defineProperty(instance, dep.propertyKey, {
                value: propertyValue,
                enumerable: true,
                configurable: true
            });
        }
    }
    has(dependencyToken, criteria) {
        const token = this.createToken(dependencyToken);
        const bestProviders = this.collectBestProvidersFor({
            ...criteria,
            token,
        });
        return bestProviders.length > 0;
    }
    hasEntityService(entityName, criteria) {
        const { tags, priority, allProvidersFromChildContainers } = criteria ?? {};
        const bestProviders = this.collectBestProvidersFor({
            tags,
            type: 'service',
            priority,
            forEntity: entityName,
            allProvidersFromChildContainers,
        });
        return bestProviders.length > 0;
    }
    resolveEntityService(entityName, criteria, async = false) {
        const { tags, priority, allProvidersFromChildContainers } = criteria ?? {};
        const bestProviders = this.collectBestProvidersFor({
            tags,
            type: 'service',
            priority,
            forEntity: entityName,
            allProvidersFromChildContainers,
        });
        if (bestProviders.length === 0) {
            throw new errors_1.NoEntityServiceProviderError(String(entityName), this.containerId);
        }
        const options = bestProviders[0];
        return this.resolveProviderValue(options, new Set(), async);
    }
    hasEntitySchema(entityName, criteria) {
        const { tags, priority, allProvidersFromChildContainers } = criteria ?? {};
        const bestProviders = this.collectBestProvidersFor({
            tags,
            type: 'schema',
            priority,
            forEntity: entityName,
            allProvidersFromChildContainers,
        });
        return bestProviders.length > 0;
    }
    resolveEntitySchema(entityName, criteria, async = false) {
        const { tags, priority, allProvidersFromChildContainers } = criteria ?? {};
        const bestProviders = this.collectBestProvidersFor({
            tags,
            type: 'schema',
            priority,
            forEntity: entityName,
            allProvidersFromChildContainers,
        });
        if (bestProviders.length === 0) {
            throw new errors_1.NoEntitySchemaProviderError(String(entityName), this.containerId);
        }
        const options = bestProviders[0];
        return this.resolveProviderValue(options, new Set(), async);
    }
    clear(clearChildContainers = true) {
        this.providers.clear();
        this.cache.clear();
        this.resolving.clear();
        if (clearChildContainers) {
            this.childContainers.forEach(container => container.clear());
        }
    }
    useMiddleware({ middleware, order = 1 }) {
        this.middlewares.push({ middleware, order });
        this.middlewares.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    }
    async resolveAsync(dependencyToken, criteria, path) {
        return await this.resolve(dependencyToken, criteria, path, true);
    }
    async createAndCacheInstanceAsync(options, path) {
        const { _id, _provider: provider } = options;
        const instance = await this.createInstance(options, path, true);
        if (provider.singleton) {
            this.cache.set(_id, instance);
        }
        this.resolving.delete(_id);
        await this.injectPropertiesAsync(instance);
        await this.initializeInstanceAsync(instance);
        path.delete(_id);
        return instance;
    }
    useMiddlewareAsync({ middleware, order = 1 }) {
        this.asyncMiddlewares.push({ middleware, order });
        this.asyncMiddlewares.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    }
    async resolveDependenciesAsync(target, path) {
        const injectMetadata = (0, metadata_2.getConstructorDependenciesMetadata)(target);
        return await Promise.all(injectMetadata.map(async (dep) => await this.resolveDependency(dep, path, true)));
    }
    async initializeInstanceAsync(instance) {
        if (!(0, utils_1.hasConstructor)(instance))
            return;
        const initMethod = (0, metadata_2.getOnInitHookMetadata)(instance.constructor);
        if (initMethod) {
            const theInitMethod = instance[initMethod];
            if (typeof theInitMethod === 'function') {
                try {
                    await theInitMethod.call(instance); // Bind 'this' context to the instance
                }
                catch (error) {
                    throw new errors_1.InitializationMethodError(instance.constructor.name, error.message, this.containerId);
                }
            }
            else {
                throw new errors_1.InitializationMethodTypeError(String(initMethod), instance.constructor.name, this.containerId);
            }
        }
    }
    async createFactoryInstanceAsync(options, path) {
        const dependencies = await Promise.all((options.deps || []).map(async (dep) => {
            return await this.resolveDependency(dep, path, true);
        }));
        return options.useFactory(...dependencies);
    }
    async injectPropertiesAsync(instance) {
        if (!(0, utils_1.hasConstructor)(instance))
            return;
        const dependencies = (0, metadata_2.getPropertyDependenciesMetadata)(instance.constructor);
        for (const dep of dependencies) {
            const propertyValue = await this.resolveDependency(dep, new Set(), true);
            Object.defineProperty(instance, dep.propertyKey, {
                value: propertyValue,
                enumerable: true,
                configurable: true
            });
        }
    }
    logChildContainers() {
        for (const container of this.childContainers) {
            this.logger.debug(`Child Container: ${container.containerId}`);
            container.logChildContainers();
        }
    }
    logProviders(allProvidersFromChildContainers = true) {
        const internalProviders = this.collectBestProvidersFor({
            allProvidersFromChildContainers,
        });
        this.logger.debug(`Parent Container Id, [Parent: ${this.parent?.containerId}]`);
        for (const ip of internalProviders) {
            let filtered = {
                ...ip,
                _container: ip._container.containerId,
                _provider: {
                    ...ip._provider,
                    useClass: ip._provider?.useClass?.name,
                    provide: ip._provider.provide.name ? ip._provider.provide.name : ip._provider.provide
                }
            };
            this.logger.debug(`Provider: [${ip._container.containerId}] - ${ip._provider._token}:`);
        }
    }
    logCache() {
        for (const [token, instance] of this.cache.entries()) {
            this.logger.debug(`Cache: [${this.containerId}] - ${token}:`, instance);
        }
        this.parent?.logCache();
    }
    setSearchEngine(engine) {
        this.searchEngine = engine;
    }
    resolveSearchEngine() {
        if (!this.searchEngine) {
            if (this.parent) {
                return this.parent.resolveSearchEngine();
            }
            throw new Error('Search engine not configured. Please call setSearchEngine() first.');
        }
        return this.searchEngine;
    }
}
exports.DIContainer = DIContainer;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udGFpbmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2RpL2NvbnRhaW5lci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSwrQkFBMEM7QUFDMUMsZ0RBQW9EO0FBRXBELDhDQUEyRDtBQUMzRCw2Q0FBMEM7QUFtQjFDLHNDQU91QjtBQUV2QixtQ0FZaUI7QUFFakIseUNBS29CO0FBRXBCLG9DQUFxQztBQUVyQyxxQ0FXa0I7QUFJbEIsTUFBYSxXQUFXO0lBbUlBO0lBaklwQjs7Ozs7O09BTUc7SUFDSCxNQUFNLEtBQUssZUFBZTtRQUN0QixNQUFNLENBQUMsR0FBRyxNQUFhLENBQUM7UUFDeEIsSUFBSSxDQUFDLENBQUMsQ0FBQywwQkFBMEIsRUFBRSxDQUFDO1lBQ2hDLENBQUMsQ0FBQywwQkFBMEIsR0FBRyxJQUFJLDBCQUFlLENBQUMsRUFBRSxTQUFTLEVBQUUsU0FBUyxFQUFFLENBQUMsQ0FBQztRQUNqRixDQUFDO1FBQ0QsT0FBTyxDQUFDLENBQUMsMEJBQTBCLENBQUM7SUFDeEMsQ0FBQztJQUVlLFdBQVcsQ0FBUztJQUNuQixNQUFNLENBQVU7SUFDaEIsV0FBVyxHQUF3QixFQUFFLENBQUM7SUFDdEMsZ0JBQWdCLEdBQTZCLEVBQUUsQ0FBQztJQUV6RCxVQUFVLEdBQUcsSUFBSSxHQUFHLEVBQWUsQ0FBQztJQUM1QyxJQUFjLFNBQVM7UUFFbkIsSUFBSSxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7WUFDaEIsT0FBTyxJQUFJLENBQUMsUUFBUSxDQUFDLFNBQVMsQ0FBQztRQUNuQyxDQUFDO1FBRUQsSUFBSSxDQUFDLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQztZQUNuQixJQUFJLENBQUMsVUFBVSxHQUFHLElBQUksR0FBRyxFQUFlLENBQUM7UUFDN0MsQ0FBQztRQUNELE9BQU8sSUFBSSxDQUFDLFVBQVUsQ0FBQztJQUMzQixDQUFDO0lBRU8sTUFBTSxHQUFHLElBQUksR0FBRyxFQUFlLENB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UTtRQUNKLEtBQUssTUFBTSxDQUFFLEtBQUssRUFBRSxRQUFRLENBQUUsSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sRUFBRSxFQUFFLENBQUM7WUFDckQsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsV0FBVyxJQUFJLENBQUMsV0FBVyxPQUFPLEtBQUssR0FBRyxFQUFFLFFBQVEsQ0FBQyxDQUFDO1FBQzVFLENBQUM7UUFDRCxJQUFJLENBQUMsTUFBTSxFQUFFLFFBQVEsRUFBRSxDQUFDO0lBQzVCLENBQUM7SUFFTSxlQUFlLENBQUMsTUFBd0I7UUFDM0MsSUFBSSxDQUFDLFlBQVksR0FBRyxNQUFNLENBQUM7SUFDL0IsQ0FBQztJQUVNLG1CQUFtQjtRQUN0QixJQUFJLENBQUMsSUFBSSxDQUFDLFlBQVksRUFBRSxDQUFDO1lBRXJCLElBQUksSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDO2dCQUNkLE9BQU8sSUFBSSxDQUFDLE1BQU0sQ0FBQyxtQkFBbUIsRUFBRSxDQUFDO1lBQzdDLENBQUM7WUFFRCxNQUFNLElBQUksS0FBSyxDQUFDLG9FQUFvRSxDQUFDLENBQUM7UUFDMUYsQ0FBQztRQUVELE9BQU8sSUFBSSxDQUFDLFlBQVksQ0FBQztJQUM3QixDQUFDO0NBQ0o7QUF0cENELGtDQXNwQ0MiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyB2NCBhcyBnZW5lcmF0ZVVVSUQgfSBmcm9tICd1dWlkJztcbmltcG9ydCB7IE1ldGFkYXRhTWFuYWdlciB9IGZyb20gJy4uL3V0aWxzL21ldGFkYXRhJztcbmltcG9ydCB7IHR5cGUgRGVlcFBhcnRpYWwsIHR5cGUgUGFydGlhbEJ5IH0gZnJvbSAnLi4vdXRpbHMvdHlwZXMnO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyLCBJTG9nZ2VyIH0gZnJvbSAnLi8uLi9sb2dnaW5nL2luZGV4JztcbmltcG9ydCB7IEluamVjdGFibGUgfSBmcm9tICcuL2RlY29yYXRvcnMnO1xuXG5pbXBvcnQge1xuICAgIEJhc2VQcm92aWRlck9wdGlvbnMsXG4gICAgQ2xhc3NDb25zdHJ1Y3RvcixcbiAgICBDbGFzc1Byb3ZpZGVyT3B0aW9ucyxcbiAgICBDb21wbGV4RGVwZW5kZW5jeUlkZW50aWZpZXIsXG4gICAgQ29uZmlnUHJvdmlkZXJPcHRpb25zLFxuICAgIERlcElkZW50aWZpZXIsXG4gICAgRmFjdG9yeVByb3ZpZGVyT3B0aW9ucyxcbiAgICBJRElDb250YWluZXIsXG4gICAgSW50ZXJuYWxQcm92aWRlck9wdGlvbnMsXG4gICAgRElNaWRkbGV3YXJlLFxuICAgIERJTWlkZGxld2FyZUFzeW5jLFxuICAgIFByaW9yaXR5Q3JpdGVyaWEsXG4gICAgUHJvdmlkZXJPcHRpb25zLFxuICAgIFRva2VuXG59IGZyb20gJy4vLi4vaW50ZXJmYWNlcy9kaSc7XG5cbmltcG9ydCB7XG4gICAgaXNBbGlhc1Byb3ZpZGVyT3B0aW9ucyxcbiAgICBpc0NsYXNzUHJvdmlkZXJPcHRpb25zLFxuICAgIGlzQ29tcGxleERlcGVuZGVuY3lJZGVudGlmaWVyLFxuICAgIGlzQ29uZmlnUHJvdmlkZXJPcHRpb25zLFxuICAgIGlzRmFjdG9yeVByb3ZpZGVyT3B0aW9ucyxcbiAgICBpc1ZhbHVlUHJvdmlkZXJPcHRpb25zLFxufSBmcm9tICcuLy4uL3V0aWxzL2RpJztcblxuaW1wb3J0IHtcbiAgICBhcHBseU1pZGRsZXdhcmVzLFxuICAgIGFwcGx5TWlkZGxld2FyZXNBc3luYyxcbiAgICBmaWx0ZXJBbmRTb3J0UHJvdmlkZXJzLFxuICAgIGZsYXR0ZW5Db25maWcsXG4gICAgZ2V0UGF0aFZhbHVlLFxuICAgIGhhc0NvbnN0cnVjdG9yLFxuICAgIG1ha2VESVRva2VuLFxuICAgIG1hdGNoZXNQYXR0ZXJuLFxuICAgIHNldFBhdGhWYWx1ZSxcbiAgICBzdHJpcERJVG9rZW5OYW1lc3BhY2UsXG4gICAgdmFsaWRhdGVQcm92aWRlck9wdGlvbnNcbn0gZnJvbSAnLi91dGlscyc7XG5cbmltcG9ydCB7XG4gICAgZ2V0Q29uc3RydWN0b3JEZXBlbmRlbmNpZXNNZXRhZGF0YSxcbiAgICBnZXRNb2R1bGVNZXRhZGF0YSxcbiAgICBnZXRPbkluaXRIb29rTWV0YWRhdGEsXG4gICAgZ2V0UHJvcGVydHlEZXBlbmRlbmNpZXNNZXRhZGF0YSxcbn0gZnJvbSAnLi9tZXRhZGF0YSc7XG5cbmltcG9ydCB7IERJX1RPS0VOUyB9IGZyb20gJy4uL2NvbnN0JztcblxuaW1wb3J0IHtcbiAgICBDaXJjdWxhckRlcGVuZGVuY3lFcnJvcixcbiAgICBJbml0aWFsaXphdGlvbk1ldGhvZEVycm9yLFxuICAgIEluaXRpYWxpemF0aW9uTWV0aG9kVHlwZUVycm9yLFxuICAgIEludmFsaWREZXBlbmRlbmN5Q3JpdGVyaWFFcnJvcixcbiAgICBNb2R1bGVNZXRhZGF0YUVycm9yLFxuICAgIE5vRW50aXR5U2NoZW1hUHJvdmlkZXJFcnJvcixcbiAgICBOb0VudGl0eVNlcnZpY2VQcm92aWRlckVycm9yLFxuICAgIE5vUHJvdmlkZXJGb3VuZEVycm9yLFxuICAgIE5vdGhpbmdUb0V4cG9ydEVycm9yLFxuICAgIFByb3ZpZGVyQ29uZmlndXJhdGlvbkVycm9yXG59IGZyb20gJy4vZXJyb3JzJztcbmltcG9ydCB7IEJhc2VTZWFyY2hFbmdpbmUgfSBmcm9tICcuLi9zZWFyY2gnO1xuXG5cbmV4cG9ydCBjbGFzcyBESUNvbnRhaW5lciBpbXBsZW1lbnRzIElESUNvbnRhaW5lciB7XG5cbiAgICAvKipcbiAgICAgKiBTaGFyZWQgYWNyb3NzIEFMTCBmdzI0IGNvcGllcyBpbiB0aGUgcHJvY2VzcyAoYnVuZGxlZCBpbiBMYW1iZGEgKyBsYXllciksIHNhbWUgYXMgUk9PVFxuICAgICAqIGJlbG93IGFuZCBmb3IgdGhlIHNhbWUgcmVhc29uOiBST09UIGlzIGEgZ2xvYmFsIHNpbmdsZXRvbiwgc28gYSBtZXRob2QgaW52b2tlZCBvbiBpdCBjYW5cbiAgICAgKiBleGVjdXRlIGluIGEgZGlmZmVyZW50IGZ3MjQgY29weSB0aGFuIHRoZSBvbmUgd2hvc2UgZGVjb3JhdG9ycyB3cm90ZSB0aGUgbWV0YWRhdGEuIFdpdGggYVxuICAgICAqIHBlci1jb3B5IHN0YXRpYyBzdG9yZSwgdGhhdCByZWFkIG1pc3NlcyAoXCJNb2R1bGUgWCBkb2VzIG5vdCBoYXZlIGFueSBtZXRhZGF0YVwiKSBhbmQgdGhlXG4gICAgICogZW50cnktcGFja2FnZSBsb2FkIGRpZXMuIE1ldGFkYXRhIGlzIGtleWVkIGJ5IGNsYXNzIE5BTUUsIHNvIG9uZSBzaGFyZWQgc3RvcmUgaXMgY29ycmVjdC5cbiAgICAgKi9cbiAgICBzdGF0aWMgZ2V0IERJTWV0YWRhdGFTdG9yZSgpOiBNZXRhZGF0YU1hbmFnZXIge1xuICAgICAgICBjb25zdCBnID0gZ2xvYmFsIGFzIGFueTtcbiAgICAgICAgaWYgKCFnLl9fZncyNF9kaV9tZXRhZGF0YV9zdG9yZV9fKSB7XG4gICAgICAgICAgICBnLl9fZncyNF9kaV9tZXRhZGF0YV9zdG9yZV9fID0gbmV3IE1ldGFkYXRhTWFuYWdlcih7IG5hbWVzcGFjZTogJ2Z3MjQ6ZGknIH0pO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBnLl9fZncyNF9kaV9tZXRhZGF0YV9zdG9yZV9fO1xuICAgIH1cblxuICAgIHB1YmxpYyByZWFkb25seSBjb250YWluZXJJZDogc3RyaW5nO1xuICAgIHByaXZhdGUgcmVhZG9ubHkgbG9nZ2VyOiBJTG9nZ2VyO1xuICAgIHByaXZhdGUgcmVhZG9ubHkgbWlkZGxld2FyZXM6IERJTWlkZGxld2FyZTxhbnk+W10gPSBbXTtcbiAgICBwcml2YXRlIHJlYWRvbmx5IGFzeW5jTWlkZGxld2FyZXM6IERJTWlkZGxld2FyZUFzeW5jPGFueT5bXSA9IFtdO1xuXG4gICAgcHJpdmF0ZSBfcmVzb2x2aW5nID0gbmV3IE1hcDxzdHJpbmcsIGFueT4oKTtcbiAgICBwcm90ZWN0ZWQgZ2V0IHJlc29sdmluZygpOiBNYXA8c3RyaW5nLCBhbnk+IHtcblxuICAgICAgICBpZiAodGhpcy5wcm94eUZvcikge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMucHJveHlGb3IucmVzb2x2aW5nO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCF0aGlzLl9yZXNvbHZpbmcpIHtcbiAgICAgICAgICAgIHRoaXMuX3Jlc29sdmluZyA9IG5ldyBNYXA8c3RyaW5nLCBhbnk+KCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuX3Jlc29sdmluZztcbiAgICB9XG5cbiAgICBwcml2YXRlIF9jYWNoZSA9IG5ldyBNYXA8c3RyaW5nLCBhbnk+KCk7XG4gICAgcHJvdGVjdGVkIGdldCBjYWNoZSgpOiBNYXA8c3RyaW5nLCBhbnk+IHtcblxuICAgICAgICBpZiAodGhpcy5wcm94eUZvcikge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMucHJveHlGb3IuY2FjaGU7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIXRoaXMuX2NhY2hlKSB7XG4gICAgICAgICAgICB0aGlzLl9jYWNoZSA9IG5ldyBNYXA8c3RyaW5nLCBhbnk+KCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuX2NhY2hlO1xuICAgIH1cblxuICAgIHByaXZhdGUgX3Byb3ZpZGVyczogTWFwPHN0cmluZywgSW50ZXJuYWxQcm92aWRlck9wdGlvbnNbXT4gfCB1bmRlZmluZWQ7XG4gICAgZ2V0IHByb3ZpZGVycygpOiBNYXA8c3RyaW5nLCBJbnRlcm5hbFByb3ZpZGVyT3B0aW9uc1tdPiB7XG5cbiAgICAgICAgaWYgKHRoaXMucHJveHlGb3IpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnByb3h5Rm9yLnByb3ZpZGVycztcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghdGhpcy5fcHJvdmlkZXJzKSB7XG4gICAgICAgICAgICB0aGlzLl9wcm92aWRlcnMgPSBuZXcgTWFwPHN0cmluZywgSW50ZXJuYWxQcm92aWRlck9wdGlvbnNbXT4oKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5fcHJvdmlkZXJzXG4gICAgfVxuXG4gICAgcHJpdmF0ZSBfZXhwb3J0czogTWFwPHN0cmluZywgSW50ZXJuYWxQcm92aWRlck9wdGlvbnNbXT4gfCB1bmRlZmluZWQ7XG4gICAgZ2V0IGV4cG9ydHMoKTogTWFwPHN0cmluZywgSW50ZXJuYWxQcm92aWRlck9wdGlvbnNbXT4ge1xuXG4gICAgICAgIGlmICh0aGlzLnByb3h5Rm9yKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5wcm94eUZvci5leHBvcnRzO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCF0aGlzLl9leHBvcnRzKSB7XG4gICAgICAgICAgICB0aGlzLl9leHBvcnRzID0gbmV3IE1hcDxzdHJpbmcsIEludGVybmFsUHJvdmlkZXJPcHRpb25zW10+KCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuX2V4cG9ydHNcbiAgICB9XG5cbiAgICAvLyB3aGVuIHRoaXMgY29udGFpbmVyIGlzIGEgcHJveHkgZm9yIGFub3RoZXIgY29udGFpbmVyOyB0aGUgYW5vdGhlciBjb250YWluZXIncyByZWYgd2lsbCBiZSBzdG9yZWQgaGVyZVxuICAgIHB1YmxpYyBwcm94eUZvcjogRElDb250YWluZXIgfCB1bmRlZmluZWQ7XG5cbiAgICBnZXQgcGFyZW50KCk6IERJQ29udGFpbmVyIHwgdW5kZWZpbmVkIHtcbiAgICAgICAgcmV0dXJuIHRoaXMucGFyZW50Q29udGFpbmVyXG4gICAgfVxuXG4gICAgcHJpdmF0ZSBfY2hpbGRDb250YWluZXJzOiBTZXQ8RElDb250YWluZXI+IHwgdW5kZWZpbmVkO1xuICAgIGdldCBjaGlsZENvbnRhaW5lcnMoKTogU2V0PERJQ29udGFpbmVyPiB7XG5cbiAgICAgICAgaWYgKHRoaXMucHJveHlGb3IpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnByb3h5Rm9yLmNoaWxkQ29udGFpbmVycztcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghdGhpcy5fY2hpbGRDb250YWluZXJzKSB7XG4gICAgICAgICAgICB0aGlzLl9jaGlsZENvbnRhaW5lcnMgPSBuZXcgU2V0PERJQ29udGFpbmVyPigpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLl9jaGlsZENvbnRhaW5lcnNcbiAgICB9XG5cbiAgICBwcml2YXRlIF9wcm94aWVzOiBTZXQ8RElDb250YWluZXI+IHwgdW5kZWZpbmVkO1xuICAgIGdldCBwcm94aWVzKCk6IFNldDxESUNvbnRhaW5lcj4ge1xuXG4gICAgICAgIGlmICh0aGlzLnByb3h5Rm9yKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5wcm94eUZvci5wcm94aWVzO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCF0aGlzLl9wcm94aWVzKSB7XG4gICAgICAgICAgICB0aGlzLl9wcm94aWVzID0gbmV3IFNldDxESUNvbnRhaW5lcj4oKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5fcHJveGllc1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdsb2JhbCBST09UIGNvbnRhaW5lciBzaGFyZWQgYWNyb3NzIEFMTCBmdzI0IGluc3RhbmNlcyAoYnVuZGxlZCArIGxheWVyKS5cbiAgICAgKiBTdG9yZWQgaW4gZ2xvYmFsIG9iamVjdCB0byBlbnN1cmUgc2luZ2xldG9uIGJlaGF2aW9yIGV2ZW4gd2hlbiBtdWx0aXBsZVxuICAgICAqIGZ3MjQgbW9kdWxlIGdyYXBocyBleGlzdCAoZS5nLiwgYnVuZGxlZCBpbiBMYW1iZGEgKyBsYXllcikuXG4gICAgICovXG4gICAgcHJpdmF0ZSBzdGF0aWMgX3Jvb3RJbnN0YW5jZTogRElDb250YWluZXI7XG4gICAgc3RhdGljIGdldCBST09UKCk6IElESUNvbnRhaW5lciB7XG4gICAgICAgIC8vIENoZWNrIGdsb2JhbCBmaXJzdCBmb3IgY3Jvc3MtaW5zdGFuY2Ugc2hhcmluZ1xuICAgICAgICBjb25zdCBnbG9iYWxSb290ID0gKGdsb2JhbCBhcyBhbnkpLl9fZncyNF9kaV9yb290X2NvbnRhaW5lcl9fO1xuICAgICAgICBpZiAoZ2xvYmFsUm9vdCkge1xuICAgICAgICAgICAgcmV0dXJuIGdsb2JhbFJvb3Q7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDcmVhdGUgaWYgZG9lc24ndCBleGlzdFxuICAgICAgICBpZiAoIXRoaXMuX3Jvb3RJbnN0YW5jZSkge1xuICAgICAgICAgICAgdGhpcy5fcm9vdEluc3RhbmNlID0gbmV3IERJQ29udGFpbmVyKCk7XG4gICAgICAgICAgICAvLyBTdG9yZSBpbiBnbG9iYWwgZm9yIGNyb3NzLWluc3RhbmNlIGFjY2Vzc1xuICAgICAgICAgICAgKGdsb2JhbCBhcyBhbnkpLl9fZncyNF9kaV9yb290X2NvbnRhaW5lcl9fID0gdGhpcy5fcm9vdEluc3RhbmNlO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLl9yb290SW5zdGFuY2U7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBzZWFyY2hFbmdpbmU/OiBCYXNlU2VhcmNoRW5naW5lO1xuXG4gICAgY29uc3RydWN0b3IocHJpdmF0ZSBwYXJlbnRDb250YWluZXI/OiBESUNvbnRhaW5lciwgaWRlbnRpZmllcjogc3RyaW5nID0gJ1JPT1QnKSB7XG4gICAgICAgIC8vIHRvIGVuc3VyZSBkZXN0cnVjdHVyaW5nIHdvcmtzIGNvcnJlY3RseVxuICAgICAgICB0aGlzLkluamVjdGFibGUgPSB0aGlzLkluamVjdGFibGUuYmluZCh0aGlzKTtcbiAgICAgICAgdGhpcy5jb250YWluZXJJZCA9IGlkZW50aWZpZXI7XG4gICAgICAgIHRoaXMubG9nZ2VyID0gY3JlYXRlTG9nZ2VyKGBESUNvbnRhaW5lclske2lkZW50aWZpZXJ9XWApO1xuICAgIH1cblxuICAgIEluamVjdGFibGUob3B0aW9uczogUGFydGlhbEJ5PEJhc2VQcm92aWRlck9wdGlvbnMsICdwcm92aWRlJz4gPSB7fSkge1xuICAgICAgICByZXR1cm4gSW5qZWN0YWJsZSh7IC4uLm9wdGlvbnMsIHByb3ZpZGVkSW46IHRoaXMgfSk7XG4gICAgfVxuXG4gICAgY3JlYXRlQ2hpbGRDb250YWluZXIoaWRlbnRpZmllcjogc3RyaW5nKTogRElDb250YWluZXIge1xuICAgICAgICBjb25zdCBjaGlsZCA9IG5ldyBESUNvbnRhaW5lcih0aGlzLCBpZGVudGlmaWVyKTtcbiAgICAgICAgdGhpcy5jaGlsZENvbnRhaW5lcnMuYWRkKGNoaWxkKTtcbiAgICAgICAgcmV0dXJuIGNoaWxkO1xuICAgIH1cblxuICAgIHByb3RlY3RlZCBjcmVhdGVDaGlsZENvbnRhaW5lclByb3h5SWRlbnRpZmllcihwYXJlbnRDb250YWluZXI6IERJQ29udGFpbmVyKTogc3RyaW5nIHtcbiAgICAgICAgcmV0dXJuIGAke3RoaXMuY29udGFpbmVySWR9OlByb3h5SW5bJHtwYXJlbnRDb250YWluZXIuY29udGFpbmVySWR9XWBcbiAgICB9XG5cbiAgICBwcm90ZWN0ZWQgYWRkUHJveHlDb250YWluZXJJbiA9IChwYXJlbnRDb250YWluZXI6IERJQ29udGFpbmVyKTogRElDb250YWluZXIgPT4ge1xuXG4gICAgICAgIGNvbnN0IHByb3h5Q29udGFpbmVySWQgPSB0aGlzLmNyZWF0ZUNoaWxkQ29udGFpbmVyUHJveHlJZGVudGlmaWVyKHBhcmVudENvbnRhaW5lcik7XG5cbiAgICAgICAgLy8gbWFrZSBzdXJlIHRvIHJlbW92ZSBvbGQgcHJveHkgZnJvbSB0aGUgaW1wb3J0aW5nIG1vZHVsZSBpZiBleGlzdHNcbiAgICAgICAgaWYgKHBhcmVudENvbnRhaW5lci5oYXNDaGlsZENvbnRhaW5lckJ5SWQocHJveHlDb250YWluZXJJZCkpIHtcblxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEZvdW5kIG9sZCBwcm94eSBjb250YWluZXI6IFske3Byb3h5Q29udGFpbmVySWR9XSBpbiBwYXJlbnQ6IFske3BhcmVudENvbnRhaW5lci5jb250YWluZXJJZH1dOyByZXBsYWNpbmcgaXRgKTtcblxuICAgICAgICAgICAgY29uc3Qgb2xkUHJveHlDb250YWluZXIgPSBwYXJlbnRDb250YWluZXIuZ2V0Q2hpbGRDb250YWluZXJCeUlkKHByb3h5Q29udGFpbmVySWQpO1xuXG4gICAgICAgICAgICBwYXJlbnRDb250YWluZXIucmVtb3ZlQ2hpbGRDb250YWluZXJCeUlkKHByb3h5Q29udGFpbmVySWQpO1xuXG4gICAgICAgICAgICB0aGlzLnByb3hpZXMuZGVsZXRlKG9sZFByb3h5Q29udGFpbmVyKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IG5ld1Byb3h5Q29udGFpbmVyID0gcGFyZW50Q29udGFpbmVyLmNyZWF0ZUNoaWxkQ29udGFpbmVyKHByb3h5Q29udGFpbmVySWQpO1xuXG4gICAgICAgIG5ld1Byb3h5Q29udGFpbmVyLnByb3h5Rm9yID0gdGhpcztcblxuICAgICAgICB0aGlzLnByb3hpZXMuYWRkKG5ld1Byb3h5Q29udGFpbmVyKTtcblxuICAgICAgICByZXR1cm4gbmV3UHJveHlDb250YWluZXI7XG4gICAgfVxuXG4gICAgaGFzQ2hpbGRDb250YWluZXJCeUlkKGlkZW50aWZpZXI6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgICAgICBsZXQgZm91bmQgPSBBcnJheS5mcm9tKHRoaXMuY2hpbGRDb250YWluZXJzKS5zb21lKFxuICAgICAgICAgICAgZWxlbWVudCA9PiBlbGVtZW50LmNvbnRhaW5lcklkLnN0YXJ0c1dpdGgoaWRlbnRpZmllcilcbiAgICAgICAgKTtcblxuICAgICAgICBpZiAoIWZvdW5kICYmIHRoaXMuY2hpbGRDb250YWluZXJzLnNpemUgPiAwKSB7XG4gICAgICAgICAgICBmb3VuZCA9IEFycmF5LmZyb20odGhpcy5jaGlsZENvbnRhaW5lcnMpLnNvbWUoY2MgPT4gY2MuaGFzQ2hpbGRDb250YWluZXJCeUlkKGlkZW50aWZpZXIpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBmb3VuZDtcbiAgICB9XG5cbiAgICByZW1vdmVDaGlsZENvbnRhaW5lckJ5SWQoaWRlbnRpZmllcjogc3RyaW5nKTogdm9pZCB7XG4gICAgICAgIGNvbnN0IGNoaWxkQ29udGFpbmVyID0gdGhpcy5nZXRDaGlsZENvbnRhaW5lckJ5SWQoaWRlbnRpZmllcik7XG4gICAgICAgIHRoaXMuY2hpbGRDb250YWluZXJzLmRlbGV0ZShjaGlsZENvbnRhaW5lcik7XG4gICAgfVxuXG4gICAgZ2V0Q2hpbGRDb250YWluZXJCeUlkKGlkZW50aWZpZXI6IHN0cmluZyk6IGFueSB7XG4gICAgICAgIGxldCBmb3VuZENvbnRhaW5lciA9IEFycmF5LmZyb20odGhpcy5jaGlsZENvbnRhaW5lcnMpLmZpbmQoZWxlbWVudCA9PiB7XG4gICAgICAgICAgICByZXR1cm4gZWxlbWVudC5jb250YWluZXJJZC5zdGFydHNXaXRoKGlkZW50aWZpZXIpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpZiAoIWZvdW5kQ29udGFpbmVyICYmIHRoaXMuY2hpbGRDb250YWluZXJzLnNpemUgPiAwKSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGNjIG9mIHRoaXMuY2hpbGRDb250YWluZXJzKSB7XG4gICAgICAgICAgICAgICAgZm91bmRDb250YWluZXIgPSBjYy5nZXRDaGlsZENvbnRhaW5lckJ5SWQoaWRlbnRpZmllcik7XG4gICAgICAgICAgICAgICAgaWYgKGZvdW5kQ29udGFpbmVyKSB7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBmb3VuZENvbnRhaW5lcjtcbiAgICB9XG5cbiAgICBtb2R1bGUodGFyZ2V0OiBDbGFzc0NvbnN0cnVjdG9yKSB7XG5cbiAgICAgICAgY29uc3QgbW9kdWxlTWV0YSA9IGdldE1vZHVsZU1ldGFkYXRhKHRhcmdldCk7XG5cbiAgICAgICAgaWYgKCFtb2R1bGVNZXRhKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgTW9kdWxlTWV0YWRhdGFFcnJvcih0YXJnZXQubmFtZSwgdGhpcy5jb250YWluZXJJZCk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB7IGltcG9ydHMgPSBbXSwgZXhwb3J0cyA9IFtdLCBwcm92aWRlcnMgPSBbXSwgaWRlbnRpZmllciB9ID0gbW9kdWxlTWV0YTtcblxuICAgICAgICAvLyBpZiB0aGVyZSdzIG5vIGNvbnRhaW5lciBpbiB0aGUgbW9kdWxlIG1ldGFkYXRhLCBjcmVhdGUgdGhlIG1haW4gY29udGFpbmVyIGZvciB0aGUgbW9kdWxlXG4gICAgICAgIGlmICghbW9kdWxlTWV0YS5oYXNDb250YWluZXIoKSkge1xuXG4gICAgICAgICAgICBjb25zdCBtb2R1bGVDb250YWluZXIgPSBuZXcgRElDb250YWluZXIodW5kZWZpbmVkLCBpZGVudGlmaWVyKTtcbiAgICAgICAgICAgIC8vIHRoaXMubG9nZ2VyLmluZm8oYE1vZHVsZSAke21vZHVsZU1ldGEuaWRlbnRpZmllcn0gbWV0YWRhdGEgZG9lcyBub3QgaGF2ZSBhIGNvbnRhaW5lciwgYXNzaWduaW5nIG9uZS5gLCB7IGlkOiBtb2R1bGVDb250YWluZXIuY29udGFpbmVySWQgfSk7XG5cbiAgICAgICAgICAgIG1vZHVsZU1ldGEuc2V0Q29udGFpbmVyKG1vZHVsZUNvbnRhaW5lcik7XG5cbiAgICAgICAgICAgIC8vIG1ha2Ugc3VyZSBhbGwgdGhlIG1vZHVsZSBwcm92aWRlcnMgYXJlIGxvYWRlZCBpbnRvIHRoZSBtb2R1bGUncyBjb250YWluZXIncyBwcm92aWRlcnNcbiAgICAgICAgICAgIGZvciAoY29uc3QgcHJvdmlkZXIgb2YgcHJvdmlkZXJzKSB7XG4gICAgICAgICAgICAgICAgbW9kdWxlQ29udGFpbmVyLnJlZ2lzdGVyKHByb3ZpZGVyKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIGFuZCBtYWtlIHN1cmUgYWxsIHRoZSBtb2R1bGUgZXhwb3J0cyBhcmUgYWxzbyBsb2FkZWQgaW50byB0aGUgbW9kdWxlJ3MgY29udGFpbmVyJ3MgcHJvdmlkZXJzXG4gICAgICAgICAgICBmb3IgKGNvbnN0IGltcG9ydGVkTW9kdWxlIG9mIGltcG9ydHMpIHtcbiAgICAgICAgICAgICAgICBtb2R1bGVDb250YWluZXIubW9kdWxlKGltcG9ydGVkTW9kdWxlKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gbG9hZCBhbGwgdGhlIGV4cG9ydCBmcm9tIHRoaXMgbW9kdWxlIGludG8gdGhlIGN1cnJlbnQgY29udGFpbmVyXG4gICAgICAgICAgICBmb3IgKGNvbnN0IGV4cG9ydGVkRGVwIG9mIGV4cG9ydHMpIHtcbiAgICAgICAgICAgICAgICBtb2R1bGVDb250YWluZXIuZXhwb3J0UHJvdmlkZXJzRm9yKGV4cG9ydGVkRGVwKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gVE9ETzogbW9kdWxlIGxpZmVjeWNsZSBob29rc1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgbW9kdWxlUHJveHlDb250YWluZXIgPSAobW9kdWxlTWV0YS5jb250YWluZXIgYXMgRElDb250YWluZXIpLmFkZFByb3h5Q29udGFpbmVySW4odGhpcyk7XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGlkZW50aWZpZXIsXG4gICAgICAgICAgICBjb250YWluZXI6IG1vZHVsZVByb3h5Q29udGFpbmVyXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwdWJsaWMgZXhwb3J0UHJvdmlkZXJzRm9yPFQ+KGV4cG9ydGVkRGVwOiBEZXBJZGVudGlmaWVyPFQ+KSB7XG4gICAgICAgIGNvbnN0IHRva2VuID0gdGhpcy5jcmVhdGVUb2tlbihleHBvcnRlZERlcCk7XG5cbiAgICAgICAgbGV0IGZvdW5kUHJvdmlkZXJzRm9yVG9rZW4gPSBmYWxzZTtcblxuICAgICAgICAvLyBDb2xsZWN0IHByb3ZpZGVycyBkaXJlY3RseSBtYXRjaGluZyB0aGUgZXhwb3J0IHRva2VuXG4gICAgICAgIGNvbnN0IGF2YWlsYWJsZVByb3ZpZGVycyA9IHRoaXMucHJvdmlkZXJzLmdldCh0b2tlbikgfHwgW107XG4gICAgICAgIGNvbnN0IGNoaWxkRXhwb3J0ZWRQcm92aWRlcnMgPSBBcnJheS5mcm9tKHRoaXMuY2hpbGRDb250YWluZXJzKVxuICAgICAgICAgICAgLmZsYXRNYXAoY2hpbGQgPT4gY2hpbGQuZXhwb3J0cy5nZXQodG9rZW4pIHx8IFtdKTtcblxuICAgICAgICAvLyBDb21iaW5lIGF2YWlsYWJsZSBwcm92aWRlcnMgYW5kIGNoaWxkIGV4cG9ydGVkIHByb3ZpZGVyc1xuICAgICAgICBjb25zdCBhbGxQcm92aWRlcnMgPSBbIC4uLmF2YWlsYWJsZVByb3ZpZGVycywgLi4uY2hpbGRFeHBvcnRlZFByb3ZpZGVycyBdO1xuXG4gICAgICAgIC8vIE5lc3RlZCBmdW5jdGlvbiB0byBtYXAgYW5kIGV4cG9ydCBwcm92aWRlcnNcbiAgICAgICAgY29uc3QgbWFwQW5kRXhwb3J0UHJvdmlkZXJzID0gKHByb3ZpZGVyczogSW50ZXJuYWxQcm92aWRlck9wdGlvbnNbXSwgdGFyZ2V0VG9rZW46IHN0cmluZykgPT4ge1xuXG4gICAgICAgICAgICBmb3VuZFByb3ZpZGVyc0ZvclRva2VuID0gdHJ1ZTtcblxuICAgICAgICAgICAgY29uc3QgZXhwb3J0ZWQgPSBwcm92aWRlcnMubWFwKHByb3ZpZGVyID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCB7IF9jb250YWluZXIsIF9wcm92aWRlciwgX2lkIH0gPSBwcm92aWRlcjtcbiAgICAgICAgICAgICAgICBjb25zdCB7IGNvbmRpdGlvbiwgcHJvdmlkZSwgcHJpb3JpdHksIG92ZXJyaWRlLCBzaW5nbGV0b24sIHRhZ3MsIHR5cGUsIGZvckVudGl0eSB9ID0gX3Byb3ZpZGVyO1xuXG4gICAgICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICAgICAgX3Byb3ZpZGVyOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICB1c2VGYWN0b3J5OiAoKSA9PiBfY29udGFpbmVyLnJlc29sdmUocHJvdmlkZSksXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25kaXRpb24sXG4gICAgICAgICAgICAgICAgICAgICAgICBwcm92aWRlLFxuICAgICAgICAgICAgICAgICAgICAgICAgcHJpb3JpdHksXG4gICAgICAgICAgICAgICAgICAgICAgICBvdmVycmlkZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHNpbmdsZXRvbixcbiAgICAgICAgICAgICAgICAgICAgICAgIHRhZ3MsXG4gICAgICAgICAgICAgICAgICAgICAgICB0eXBlLFxuICAgICAgICAgICAgICAgICAgICAgICAgZm9yRW50aXR5LFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBfaWQsXG4gICAgICAgICAgICAgICAgICAgIF9jb250YWluZXI6IHRoaXNcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIC8vIE1lcmdlIG9yIHNldCB0aGVzZSBleHBvcnRlZCBwcm92aWRlcnMgdW5kZXIgdGhlaXIgcmVzcGVjdGl2ZSBrZXlzXG4gICAgICAgICAgICBjb25zdCBleGlzdGluZ0V4cG9ydHMgPSB0aGlzLmV4cG9ydHMuZ2V0KHRhcmdldFRva2VuKSB8fCBbXTtcbiAgICAgICAgICAgIHRoaXMuZXhwb3J0cy5zZXQodGFyZ2V0VG9rZW4sIFsgLi4uZXhpc3RpbmdFeHBvcnRzLCAuLi5leHBvcnRlZCBdKTtcbiAgICAgICAgfTtcblxuICAgICAgICBpZiAoYWxsUHJvdmlkZXJzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIC8vIEV4cG9ydCB0aGUgc3RhbmRhcmQgYW5kIGNvbmZpZyBwcm92aWRlcnMgZGlyZWN0bHkgbWF0Y2hpbmcgdGhlIHRva2VuXG4gICAgICAgICAgICBtYXBBbmRFeHBvcnRQcm92aWRlcnMoYWxsUHJvdmlkZXJzLCB0b2tlbik7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBGaW5kIGFsbCBjb25maWcgcHJvdmlkZXJzIHdob3NlIGtleXMgc3RhcnQgd2l0aCB0aGUgdG9rZW4gYW5kIGV4cG9ydCB0aGVtXG4gICAgICAgIGZvciAoY29uc3QgWyBjb25maWdLZXksIGNvbmZpZ1Byb3ZpZGVycyBdIG9mIHRoaXMucHJvdmlkZXJzLmVudHJpZXMoKSkge1xuICAgICAgICAgICAgaWYgKGNvbmZpZ0tleS5zdGFydHNXaXRoKHRva2VuKSAmJiBjb25maWdQcm92aWRlcnMuc29tZShwID0+IHAuX3Byb3ZpZGVyLnR5cGUgPT09ICdjb25maWcnKSkge1xuICAgICAgICAgICAgICAgIG1hcEFuZEV4cG9ydFByb3ZpZGVycyhjb25maWdQcm92aWRlcnMsIGNvbmZpZ0tleSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIWZvdW5kUHJvdmlkZXJzRm9yVG9rZW4pIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBOb3RoaW5nVG9FeHBvcnRFcnJvcih0b2tlbiwgdGhpcy5jb250YWluZXJJZCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBjcmVhdGVUb2tlbjxUPih0b2tlbk9yVHlwZTogRGVwSWRlbnRpZmllcjxUPik6IFRva2VuIHtcbiAgICAgICAgLy8gbWF5YmUgYWRkIGEgbWVjaGFuaXNtIGZvciBhZGRpbmcgZXh0cmEgbWV0YWRhdGEgdG8gdGhlIHRva2VuIGxpa2UgY29udGFpbmVyIElEIGFuZCBzdHVmZj9cbiAgICAgICAgcmV0dXJuIG1ha2VESVRva2VuKHRva2VuT3JUeXBlKTtcbiAgICB9XG5cbiAgICByZWdpc3RlcjxUPihvcHRpb25zOiBQcm92aWRlck9wdGlvbnM8VD4sIGNvbnRhaW5lcjogRElDb250YWluZXIgPSB0aGlzKTogeyBwcm92aWRlOiBUb2tlbiwgb3B0aW9uczogUHJvdmlkZXJPcHRpb25zPFQ+IH0gfCB1bmRlZmluZWQge1xuICAgICAgICBpZiAoY29udGFpbmVyICE9PSB0aGlzKSB7XG4gICAgICAgICAgICByZXR1cm4gY29udGFpbmVyLnJlZ2lzdGVyKG9wdGlvbnMpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgdG9rZW4gPSB0aGlzLmNyZWF0ZVRva2VuKG9wdGlvbnMucHJvdmlkZSk7XG5cbiAgICAgICAgY29uc3Qgb3B0aW9uc0NvcHkgPSB7XG4gICAgICAgICAgICAuLi5vcHRpb25zLFxuICAgICAgICAgICAgdHlwZTogb3B0aW9ucy50eXBlIHx8ICd1bmtub3duJyxcbiAgICAgICAgICAgIHByaW9yaXR5OiBvcHRpb25zLnByaW9yaXR5ICE9PSB1bmRlZmluZWQgPyBvcHRpb25zLnByaW9yaXR5IDogMCxcbiAgICAgICAgICAgIHNpbmdsZXRvbjogb3B0aW9ucy5zaW5nbGV0b24gIT09IHVuZGVmaW5lZCA/IG9wdGlvbnMuc2luZ2xldG9uIDogdHJ1ZSxcbiAgICAgICAgfTtcblxuICAgICAgICBpZiAob3B0aW9uc0NvcHkuY29uZGl0aW9uICYmICFvcHRpb25zQ29weS5jb25kaXRpb24oKSkgcmV0dXJuO1xuXG4gICAgICAgIHZhbGlkYXRlUHJvdmlkZXJPcHRpb25zKG9wdGlvbnNDb3B5LCB0b2tlbik7XG5cbiAgICAgICAgLy8gSGFuZGxlIGNvbmZpZyBwcm92aWRlcnNcbiAgICAgICAgaWYgKGlzQ29uZmlnUHJvdmlkZXJPcHRpb25zKG9wdGlvbnMpKSB7XG4gICAgICAgICAgICB0aGlzLnJlZ2lzdGVyQ29uZmlnUHJvdmlkZXIob3B0aW9ucyk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLnJlZ2lzdGVyUHJvdmlkZXIoeyBfcHJvdmlkZXI6IG9wdGlvbnNDb3B5IH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHByb3ZpZGU6IHRva2VuLFxuICAgICAgICAgICAgb3B0aW9uczogb3B0aW9uc0NvcHksXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgcmVnaXN0ZXJDb25maWdQcm92aWRlcihvcHRpb25zOiBDb25maWdQcm92aWRlck9wdGlvbnMpIHtcbiAgICAgICAgY29uc3QgeyB1c2VDb25maWcsIHByb3ZpZGU6IHByb3ZpZGUsIC4uLnJlc3QgfSA9IG9wdGlvbnM7XG5cbiAgICAgICAgbGV0IHByb3ZpZGVUb2tlbiA9IHN0cmlwRElUb2tlbk5hbWVzcGFjZSh0aGlzLmNyZWF0ZVRva2VuKHByb3ZpZGUpKTtcbiAgICAgICAgY29uc3QgZmxhdHRlbmVkRW50cmllcyA9IGZsYXR0ZW5Db25maWcodXNlQ29uZmlnLCBwcm92aWRlVG9rZW4pO1xuXG4gICAgICAgIGZvciAoY29uc3QgWyBjb25maWdQYXRoLCB2YWx1ZSBdIG9mIGZsYXR0ZW5lZEVudHJpZXMpIHtcbiAgICAgICAgICAgIHRoaXMucmVnaXN0ZXJQcm92aWRlcih7XG4gICAgICAgICAgICAgICAgX3Byb3ZpZGVyOiB7XG4gICAgICAgICAgICAgICAgICAgIC4uLnJlc3QsXG4gICAgICAgICAgICAgICAgICAgIHR5cGU6ICdjb25maWcnLFxuICAgICAgICAgICAgICAgICAgICBwcm92aWRlOiBjb25maWdQYXRoLFxuICAgICAgICAgICAgICAgICAgICB1c2VDb25maWc6IHZhbHVlLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByb3RlY3RlZCByZWdpc3RlclByb3ZpZGVyKG9wdGlvbnM6IFBhcnRpYWxCeTxJbnRlcm5hbFByb3ZpZGVyT3B0aW9ucywgJ19pZCcgfCAnX2NvbnRhaW5lcic+KSB7XG4gICAgICAgIGNvbnN0IGN1cnJlbnRQcm92aWRlciA9IG9wdGlvbnMuX3Byb3ZpZGVyO1xuICAgICAgICBjb25zdCB0b2tlbiA9IHRoaXMuY3JlYXRlVG9rZW4oY3VycmVudFByb3ZpZGVyLnByb3ZpZGUpO1xuICAgICAgICBjdXJyZW50UHJvdmlkZXIuX3Rva2VuID0gdG9rZW47XG5cbiAgICAgICAgY29uc3QgdG9rZW5Qcm92aWRlcnMgPSB0aGlzLnByb3ZpZGVycy5nZXQodG9rZW4pIHx8IFtdO1xuXG4gICAgICAgIGNvbnN0IGFyZUJvdGhWYWx1ZXNFcXVhbCA9IDxUPih2YWx1ZTE6IFQgfCBudWxsIHwgdW5kZWZpbmVkLCB2YWx1ZTI6IFQgfCBudWxsIHwgdW5kZWZpbmVkKTogYm9vbGVhbiA9PiB7XG4gICAgICAgICAgICByZXR1cm4gKHZhbHVlMSA9PSBudWxsICYmIHZhbHVlMiA9PSBudWxsKSB8fCAodmFsdWUxICE9PSBudWxsICYmIHZhbHVlMSAhPT0gdW5kZWZpbmVkICYmIHZhbHVlMSA9PT0gdmFsdWUyKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGFyZUJvdGhBcnJheXNFcXVhbCA9IDxUPihhcnIxOiBUW10gfCBudWxsIHwgdW5kZWZpbmVkLCBhcnIyOiBUW10gfCBudWxsIHwgdW5kZWZpbmVkKTogYm9vbGVhbiA9PiB7XG4gICAgICAgICAgICBpZiAoYXJyMSA9PSBudWxsICYmIGFycjIgPT0gbnVsbCkgcmV0dXJuIHRydWU7XG4gICAgICAgICAgICBpZiAoYXJyMSA9PSBudWxsIHx8IGFycjIgPT0gbnVsbCB8fCBhcnIxLmxlbmd0aCAhPT0gYXJyMi5sZW5ndGgpIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgIHJldHVybiBbIC4uLmFycjEgXS5zb3J0KCkuZXZlcnkoKHZhbHVlLCBpbmRleCkgPT4gdmFsdWUgPT09IGFycjIuc2xpY2UoKS5zb3J0KClbIGluZGV4IF0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gaWYgdG9rZW4gcHJvdmlkZXJzIGFscmVhZHkgaGFzIGEgcHJvdmlkZXIgd2l0aCBzYW1lIHByaW9yaXR5LCB0eXBlLCBmb3JFbnRpdHkgYW5kIHRhZ3MsIGxvZyB3YXJuaW5nIGFuZCByZXBsYWNlIGl0XG4gICAgICAgIGNvbnN0IGV4aXN0aW5nUHJvdmlkZXIgPSB0b2tlblByb3ZpZGVycy5maW5kKCh7IF9wcm92aWRlcjogZXhpc3RpbmdQcm92aWRlciB9KSA9PiB7XG4gICAgICAgICAgICByZXR1cm4gZXhpc3RpbmdQcm92aWRlci5wcmlvcml0eSA9PT0gY3VycmVudFByb3ZpZGVyLnByaW9yaXR5XG4gICAgICAgICAgICAgICAgJiYgYXJlQm90aFZhbHVlc0VxdWFsKGV4aXN0aW5nUHJvdmlkZXIudHlwZSwgY3VycmVudFByb3ZpZGVyLnR5cGUpXG4gICAgICAgICAgICAgICAgJiYgYXJlQm90aEFycmF5c0VxdWFsKGV4aXN0aW5nUHJvdmlkZXIudGFncywgY3VycmVudFByb3ZpZGVyLnRhZ3MpIC8vICEgbWF5YmUgYmUgbWFrZSBpdCBjb25maWd1cmFibGUgdG8gY29tcGFyZSB0YWdzLi4uXG4gICAgICAgICAgICAgICAgJiYgYXJlQm90aFZhbHVlc0VxdWFsKGV4aXN0aW5nUHJvdmlkZXIuZm9yRW50aXR5LCBjdXJyZW50UHJvdmlkZXIuZm9yRW50aXR5KVxuICAgICAgICB9KTtcblxuICAgICAgICBpZiAoZXhpc3RpbmdQcm92aWRlcikge1xuICAgICAgICAgICAgLy8gY29uc3QgaW5kZXggPSB0b2tlblByb3ZpZGVycy5pbmRleE9mKGV4aXN0aW5nUHJvdmlkZXIpO1xuICAgICAgICAgICAgLy8gZGVsZXRlIHRoZSBleGlzdGluZyBwcm92aWRlclxuICAgICAgICAgICAgLy8gdG9rZW5Qcm92aWRlcnMuc3BsaWNlKGluZGV4LCAxKTtcblxuICAgICAgICAgICAgLy8gRE8gTk9UIHJlcGxhY2UgdGhlIGV4aXN0aW5nIHByb3ZpZGVyLCBqdXN0IGxvZyBhIHdhcm5pbmdcbiAgICAgICAgICAgIC8vIHRoaXMubG9nZ2VyLndhcm4oYFByb3ZpZGVyIGZvciAke3Rva2VufSB3aXRoIHNhbWUgcHJpb3JpdHksIHR5cGUsIGZvckVudGl0eSBhbmQgdGFncyBhbHJlYWR5IGV4aXN0cywgcmVwbGFjaW5nIGl0LiB8IE9wdGlvbnNbJHtKU09OLnN0cmluZ2lmeShvcHRpb25zKX1dYCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBpbnRlcm5hbFByb3ZpZGVyT3B0aW9ucyA9IHtcbiAgICAgICAgICAgIC4uLm9wdGlvbnMsXG4gICAgICAgICAgICBfaWQ6IGdlbmVyYXRlVVVJRCgpLFxuICAgICAgICAgICAgX2NvbnRhaW5lcjogdGhpcyxcbiAgICAgICAgfTtcblxuICAgICAgICB0b2tlblByb3ZpZGVycy5wdXNoKGludGVybmFsUHJvdmlkZXJPcHRpb25zKTtcbiAgICAgICAgdGhpcy5wcm92aWRlcnMuc2V0KHRva2VuLCB0b2tlblByb3ZpZGVycyk7XG4gICAgfVxuXG4gICAgcmVtb3ZlUHJvdmlkZXJzRm9yKGRlcGVuZGVuY3lUb2tlbjogRGVwSWRlbnRpZmllcikge1xuICAgICAgICBjb25zdCB0b2tlbiA9IHRoaXMuY3JlYXRlVG9rZW4oZGVwZW5kZW5jeVRva2VuKTtcbiAgICAgICAgY29uc3QgcHJvdmlkZXJzID0gdGhpcy5wcm92aWRlcnMuZ2V0KHRva2VuKSB8fCBbXTtcbiAgICAgICAgcHJvdmlkZXJzLmZvckVhY2gocHJvdmlkZXIgPT4ge1xuICAgICAgICAgICAgdGhpcy5jYWNoZS5kZWxldGUocHJvdmlkZXIuX2lkISk7XG4gICAgICAgIH0pO1xuICAgICAgICB0aGlzLnByb3ZpZGVycy5kZWxldGUodG9rZW4pO1xuICAgIH1cblxuICAgIC8vIFJlc29sdmUgYSBjb25maWd1cmF0aW9uIHBhdGggd2l0aCBmbGV4aWJsZSBjcml0ZXJpYSwgc3VwcG9ydGluZyB3aWxkY2FyZHMgYW5kIHJlZ2V4XG4gICAgcmVzb2x2ZUNvbmZpZzxUID0gYW55PihcbiAgICAgICAgcXVlcnk6IHN0cmluZyA9ICcnLFxuICAgICAgICBjcml0ZXJpYT86IHtcbiAgICAgICAgICAgIHByaW9yaXR5PzogUHJpb3JpdHlDcml0ZXJpYTtcbiAgICAgICAgICAgIHRhZ3M/OiBzdHJpbmdbXTtcbiAgICAgICAgfVxuICAgICk6IERlZXBQYXJ0aWFsPFQ+IHtcblxuICAgICAgICBxdWVyeSA9IHN0cmlwRElUb2tlbk5hbWVzcGFjZShxdWVyeSk7XG5cbiAgICAgICAgY29uc3QgbWF0Y2hpbmdQYXRocyA9IHRoaXMuY29sbGVjdE1hdGNoaW5nQ29uZmlnUGF0aHMocXVlcnkpO1xuXG4gICAgICAgIGNvbnN0IHJlc29sdmVkVmFsdWVzID0gdGhpcy5yZXNvbHZlQ29uZmlnUGF0aHMobWF0Y2hpbmdQYXRocywgY3JpdGVyaWEpO1xuXG4gICAgICAgIC8vIE1lcmdlIHJlc29sdmVkIHZhbHVlcyBpbnRvIGEgZmluYWwgY29uZmlndXJhdGlvbiBvYmplY3RcbiAgICAgICAgY29uc3QgbWVyZ2VkQ29uZmlnOiBSZWNvcmQ8YW55LCBhbnk+ID0ge307XG5cbiAgICAgICAgcmVzb2x2ZWRWYWx1ZXMuZm9yRWFjaCgodmFsdWUsIHBhdGgpID0+IHtcbiAgICAgICAgICAgIHBhdGggPSBzdHJpcERJVG9rZW5OYW1lc3BhY2UocGF0aCk7XG4gICAgICAgICAgICBzZXRQYXRoVmFsdWUobWVyZ2VkQ29uZmlnLCBwYXRoLCB2YWx1ZSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiBnZXRQYXRoVmFsdWUobWVyZ2VkQ29uZmlnLCBxdWVyeSkgYXMgRGVlcFBhcnRpYWw8VD47XG4gICAgfVxuXG4gICAgLy8gQ29sbGVjdCBhbGwgcGF0aHMgdGhhdCBtYXRjaCB0aGUgcXVlcnksIHN1cHBvcnRpbmcgd2lsZGNhcmRzIGFuZCByZWdleFxuICAgIHByaXZhdGUgY29sbGVjdE1hdGNoaW5nQ29uZmlnUGF0aHMocXVlcnk6IHN0cmluZyk6IFNldDxzdHJpbmc+IHtcbiAgICAgICAgY29uc3QgbWF0Y2hpbmdQYXRoczogU2V0PHN0cmluZz4gPSBuZXcgU2V0KCk7XG5cbiAgICAgICAgY29uc3QgcHJvY2Vzc0tleXMgPSAoa2V5czogSXRlcmFibGVJdGVyYXRvcjxzdHJpbmc+KSA9PiB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHBhdGggb2Yga2V5cykge1xuICAgICAgICAgICAgICAgIGNvbnN0IGFjdHVhbFBhdGggPSBzdHJpcERJVG9rZW5OYW1lc3BhY2UocGF0aCk7XG4gICAgICAgICAgICAgICAgaWYgKG1hdGNoZXNQYXR0ZXJuKGFjdHVhbFBhdGgsIHF1ZXJ5KSkge1xuICAgICAgICAgICAgICAgICAgICBtYXRjaGluZ1BhdGhzLmFkZChwYXRoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG5cbiAgICAgICAgbGV0IGN1cnJlbnQ6IERJQ29udGFpbmVyIHwgdW5kZWZpbmVkID0gdGhpcztcblxuICAgICAgICB3aGlsZSAoY3VycmVudCkge1xuICAgICAgICAgICAgLy8gQ2hlY2sgdGhlIHByb3ZpZGVycyBpbiB0aGUgY3VycmVudCBjb250YWluZXJcbiAgICAgICAgICAgIHByb2Nlc3NLZXlzKGN1cnJlbnQucHJvdmlkZXJzLmtleXMoKSk7XG5cbiAgICAgICAgICAgIC8vIENoZWNrIHRoZSBleHBvcnRlZCBwcm92aWRlcnMgZnJvbSBjaGlsZCBjb250YWluZXJzXG4gICAgICAgICAgICBjdXJyZW50LmNoaWxkQ29udGFpbmVycy5mb3JFYWNoKGNoaWxkID0+IHtcbiAgICAgICAgICAgICAgICBwcm9jZXNzS2V5cyhjaGlsZC5leHBvcnRzLmtleXMoKSk7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgLy8gTW92ZSB0byB0aGUgcGFyZW50IGNvbnRhaW5lclxuICAgICAgICAgICAgY3VycmVudCA9IGN1cnJlbnQucGFyZW50O1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIG1hdGNoaW5nUGF0aHM7XG4gICAgfVxuXG4gICAgLy8gUmVzb2x2ZSB2YWx1ZXMgZm9yIGFsbCBtYXRjaGluZyBwYXRocyB1c2luZyB0aGUgYmVzdCBwcm92aWRlciBmcm9tIHRoZSBoaWVyYXJjaHkgYmFzZWQgb24gY3JpdGVyaWFcbiAgICBwcml2YXRlIHJlc29sdmVDb25maWdQYXRocyhcbiAgICAgICAgcGF0aHM6IFNldDxzdHJpbmc+LFxuICAgICAgICBjcml0ZXJpYT86IHtcbiAgICAgICAgICAgIHByaW9yaXR5PzogUHJpb3JpdHlDcml0ZXJpYTtcbiAgICAgICAgICAgIHRhZ3M/OiBzdHJpbmdbXTtcbiAgICAgICAgICAgIGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnM/OiBib29sZWFuXG4gICAgICAgIH1cbiAgICApOiBNYXA8c3RyaW5nLCBhbnk+IHtcblxuICAgICAgICBjb25zdCByZXNvbHZlZFZhbHVlcyA9IG5ldyBNYXA8c3RyaW5nLCBhbnk+KCk7XG5cbiAgICAgICAgY29uc3QgcmVkdWNlUHJvdmlkZXJzID0gKHByb3ZpZGVyczogSW50ZXJuYWxQcm92aWRlck9wdGlvbnNbXSk6IGFueSA9PiB7XG4gICAgICAgICAgICBpZiAocHJvdmlkZXJzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIEFzc3VtZSB0aGUgaGlnaGVzdC1wcmlvcml0eSBwcm92aWRlcidzIHZhbHVlIGlzIHRoZSBkZXNpcmVkIG9uZVxuICAgICAgICAgICAgY29uc3QgYmVzdFByb3ZpZGVyID0gcHJvdmlkZXJzWyAwIF0uX3Byb3ZpZGVyIGFzIENvbmZpZ1Byb3ZpZGVyT3B0aW9uczxhbnk+O1xuICAgICAgICAgICAgcmV0dXJuIGJlc3RQcm92aWRlci51c2VDb25maWdcbiAgICAgICAgfVxuXG4gICAgICAgIHBhdGhzLmZvckVhY2goKHBhdGgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGJlc3RQcm92aWRlcnMgPSB0aGlzLmNvbGxlY3RCZXN0UHJvdmlkZXJzRm9yPENvbmZpZ1Byb3ZpZGVyT3B0aW9ucz4oe1xuICAgICAgICAgICAgICAgIC4uLmNyaXRlcmlhLFxuICAgICAgICAgICAgICAgIHRva2VuOiBwYXRoLFxuICAgICAgICAgICAgICAgIHR5cGU6ICdjb25maWcnXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY29uc3QgcmVzb2x2ZWRWYWx1ZSA9IHJlZHVjZVByb3ZpZGVycyhiZXN0UHJvdmlkZXJzKTtcblxuICAgICAgICAgICAgcmVzb2x2ZWRWYWx1ZXMuc2V0KHBhdGgsIHJlc29sdmVkVmFsdWUpO1xuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gcmVzb2x2ZWRWYWx1ZXM7XG4gICAgfVxuXG4gICAgLy8gQ29sbGVjdCBhbGwgcHJvdmlkZXJzIGZvciBhIGdpdmVuIHBhdGggYWNyb3NzIHRoZSBoaWVyYXJjaHlcbiAgICBwdWJsaWMgY29sbGVjdEJlc3RQcm92aWRlcnNGb3I8VD4oXG4gICAgICAgIGNyaXRlcmlhOiB7XG4gICAgICAgICAgICB0b2tlbj86IHN0cmluZyxcbiAgICAgICAgICAgIHRhZ3M/OiBzdHJpbmdbXSxcbiAgICAgICAgICAgIHR5cGU/OiBQcm92aWRlck9wdGlvbnNbICd0eXBlJyBdLFxuICAgICAgICAgICAgcHJpb3JpdHk/OiBQcmlvcml0eUNyaXRlcmlhLFxuICAgICAgICAgICAgZm9yRW50aXR5PzogUHJvdmlkZXJPcHRpb25zWyAnZm9yRW50aXR5JyBdLFxuICAgICAgICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVycz86IGJvb2xlYW5cbiAgICAgICAgfVxuICAgICk6IEludGVybmFsUHJvdmlkZXJPcHRpb25zPFQ+W10ge1xuICAgICAgICBjb25zdCBiZXN0UHJvdmlkZXJzID0gbmV3IE1hcDxzdHJpbmcsIEludGVybmFsUHJvdmlkZXJPcHRpb25zPFQ+PigpO1xuXG4gICAgICAgIGxldCBjdXJyZW50OiBESUNvbnRhaW5lciB8IHVuZGVmaW5lZCA9IHRoaXM7XG4gICAgICAgIGxldCBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzID0gY3JpdGVyaWEuYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVycyB8fCBmYWxzZTtcblxuICAgICAgICBjb25zdCB2aXNpdGVkQ29udGFpbmVycyA9IG5ldyBTZXQ8RElDb250YWluZXI+KCk7XG5cbiAgICAgICAgY29uc3QgY3JpdGVyaWFTdHJpbmcgPSBKU09OLnN0cmluZ2lmeShjcml0ZXJpYSk7XG5cbiAgICAgICAgd2hpbGUgKGN1cnJlbnQpIHtcbiAgICAgICAgICAgIGlmICh2aXNpdGVkQ29udGFpbmVycy5oYXMoY3VycmVudCkpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENpcmN1bGFyIHJlZmVyZW5jZSBkZXRlY3RlZCBpbiBjb250YWluZXIgaGllcmFyY2h5LiBESUNvbnRhaW5lclske3RoaXMuY29udGFpbmVySWR9XSB8IENyaXRlcmlhOiBbJHtjcml0ZXJpYVN0cmluZ31dYCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB2aXNpdGVkQ29udGFpbmVycy5hZGQoY3VycmVudCk7XG5cbiAgICAgICAgICAgIGxldCBwYXRoUHJvdmlkZXJzID0gY3JpdGVyaWEudG9rZW5cbiAgICAgICAgICAgICAgICA/IGN1cnJlbnQucHJvdmlkZXJzLmdldChjcml0ZXJpYS50b2tlbikgfHwgW11cbiAgICAgICAgICAgICAgICA6IEFycmF5LmZyb20oY3VycmVudC5wcm92aWRlcnMudmFsdWVzKCkpLmZsYXQoKTtcblxuICAgICAgICAgICAgaWYgKGNyaXRlcmlhPy50eXBlKSB7XG4gICAgICAgICAgICAgICAgcGF0aFByb3ZpZGVycyA9IHBhdGhQcm92aWRlcnMuZmlsdGVyKHAgPT4gcC5fcHJvdmlkZXIudHlwZSA9PT0gY3JpdGVyaWEudHlwZSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChjcml0ZXJpYT8uZm9yRW50aXR5KSB7XG4gICAgICAgICAgICAgICAgcGF0aFByb3ZpZGVycyA9IHBhdGhQcm92aWRlcnMuZmlsdGVyKHAgPT4gcC5fcHJvdmlkZXIuZm9yRW50aXR5ID09PSBjcml0ZXJpYS5mb3JFbnRpdHkpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHBhdGhQcm92aWRlcnMuZm9yRWFjaChwcm92aWRlciA9PiB7XG5cbiAgICAgICAgICAgICAgICBpZiAoYmVzdFByb3ZpZGVycy5oYXMocHJvdmlkZXIuX2lkKSkge1xuICAgICAgICAgICAgICAgICAgICAvLyB0aGlzLmxvZ2dlci5pbmZvKGBQcm92aWRlciB3aXRoIGlkICR7cHJvdmlkZXIuX2lkfSBhbHJlYWR5IGV4aXN0cyBpbiBiZXN0LXByb3ZpZGVycywgc2tpcHBpbmcgaXQuIHwgQ3JpdGVyaWE6IFske2NyaXRlcmlhU3RyaW5nfV1gKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGJlc3RQcm92aWRlcnMuc2V0KHByb3ZpZGVyLl9pZCwge1xuICAgICAgICAgICAgICAgICAgICAuLi5wcm92aWRlcixcbiAgICAgICAgICAgICAgICAgICAgLy8gd2hlbiBpdCdzIGEgcHJveHkgY29udGFpbmVyIG1ha2Ugc3VyZSB0aGUgcHJvdmlkZXIgaGFzIGl0J3MgcmVmZXJlbmNlIGZvciByZXNvbHZpbmcgaXQgbGF0ZXIsXG4gICAgICAgICAgICAgICAgICAgIC8vIHRoYXQgd2F5IHRoZSBwcm92aWRlciBpcyByZXNvbHZlZCB1c2luZyB0aGUgcmlnaHQgaGllcmFyY2h5XG4gICAgICAgICAgICAgICAgICAgIF9jb250YWluZXI6IGN1cnJlbnQgYXMgRElDb250YWluZXJcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAvLyBDb2xsZWN0IGV4cG9ydGVkIHByb3ZpZGVycyBmcm9tIGNoaWxkIGNvbnRhaW5lcnNcbiAgICAgICAgICAgIGN1cnJlbnQuY2hpbGRDb250YWluZXJzLmZvckVhY2goY2hpbGQgPT4ge1xuXG4gICAgICAgICAgICAgICAgLy8gYXMgd2UncmUgbW92aW5nIGZyb20gY2hpbGQgdG8gcGFyZW50LCBtYWtlIHN1cmUgdG8gc2tpcCBvdmVyIHRoZSB2aXNpdGVkIGNvbnRhaW5lcnNcbiAgICAgICAgICAgICAgICBpZiAodmlzaXRlZENvbnRhaW5lcnMuaGFzKGNoaWxkKSkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgdmlzaXRlZENvbnRhaW5lcnMuYWRkKGNoaWxkKTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBjb25zdCBjaGlsZFByb3ZpZGVycyA9IGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnMgPyBjaGlsZC5wcm92aWRlcnMgOiBjaGlsZC5leHBvcnRzO1xuXG4gICAgICAgICAgICAgICAgbGV0IGNoaWxkRXhwb3J0ZWRQcm92aWRlcnMgPSBjcml0ZXJpYS50b2tlbiA/IChjaGlsZFByb3ZpZGVycy5nZXQoY3JpdGVyaWEudG9rZW4pIHx8IFtdKVxuICAgICAgICAgICAgICAgICAgICA6IEFycmF5LmZyb20oY2hpbGRQcm92aWRlcnMudmFsdWVzKCkpLmZsYXQoKTtcblxuICAgICAgICAgICAgICAgIGlmIChjcml0ZXJpYT8udHlwZSkge1xuICAgICAgICAgICAgICAgICAgICBjaGlsZEV4cG9ydGVkUHJvdmlkZXJzID0gY2hpbGRFeHBvcnRlZFByb3ZpZGVycy5maWx0ZXIocCA9PiBwLl9wcm92aWRlci50eXBlID09PSBjcml0ZXJpYS50eXBlKTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAoY3JpdGVyaWE/LmZvckVudGl0eSkge1xuICAgICAgICAgICAgICAgICAgICBjaGlsZEV4cG9ydGVkUHJvdmlkZXJzID0gY2hpbGRFeHBvcnRlZFByb3ZpZGVycy5maWx0ZXIocCA9PiBwLl9wcm92aWRlci5mb3JFbnRpdHkgPT09IGNyaXRlcmlhLmZvckVudGl0eSlcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBjaGlsZEV4cG9ydGVkUHJvdmlkZXJzLmZvckVhY2gocHJvdmlkZXIgPT4ge1xuXG4gICAgICAgICAgICAgICAgICAgIGlmIChiZXN0UHJvdmlkZXJzLmhhcyhwcm92aWRlci5faWQpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyB0aGlzLmxvZ2dlci5pbmZvKGBQcm92aWRlciB3aXRoIGlkICR7cHJvdmlkZXIuX2lkfSBhbHJlYWR5IGV4aXN0cyBpbiBiZXN0LXByb3ZpZGVycywgc2tpcHBpbmcgZXhwb3J0ZWQtcHJvdmlkZXIgZnJvbSBjaGlsZCBjb250YWluZXI6ICR7Y2hpbGQuY29udGFpbmVySWR9IHwgQ3JpdGVyaWE6IFske2NyaXRlcmlhU3RyaW5nfV1gKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgIGJlc3RQcm92aWRlcnMuc2V0KHByb3ZpZGVyLl9pZCwge1xuICAgICAgICAgICAgICAgICAgICAgICAgLi4ucHJvdmlkZXIsXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyB3aGVuIGl0J3MgYSBwcm94eSBjb250YWluZXIgbWFrZSBzdXJlIHRoZSBwcm92aWRlciBoYXMgaXQncyByZWZlcmVuY2UgZm9yIHJlc29sdmluZyBpdCBsYXRlcixcbiAgICAgICAgICAgICAgICAgICAgICAgIF9jb250YWluZXI6IGNoaWxkXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY3VycmVudCA9IGN1cnJlbnQucGFyZW50O1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRmlsdGVyIGFuZCBzb3J0IHByb3ZpZGVycyBiYXNlZCBvbiBjcml0ZXJpYSBhbmQgY29uZmxpY3QgcmVzb2x1dGlvbiBzdHJhdGVnaWVzXG4gICAgICAgIGNvbnN0IGJlc3RQcm92aWRlcnNBcnJheSA9IEFycmF5LmZyb20oYmVzdFByb3ZpZGVycy52YWx1ZXMoKSk7XG4gICAgICAgIGNvbnN0IGZpbHRlcmVkQW5kU29ydGVkID0gZmlsdGVyQW5kU29ydFByb3ZpZGVycyhiZXN0UHJvdmlkZXJzQXJyYXksIGNyaXRlcmlhKTtcblxuICAgICAgICAvLyBEZWR1cGxpY2F0ZSBwcm92aWRlcnMgYnkgY29tcG9zaXRlIGtleSAocHJvdmlkZSwgdHlwZSwgZm9yRW50aXR5KVxuICAgICAgICAvLyBLZWVwIG9ubHkgdGhlIGhpZ2hlc3QgcHJpb3JpdHkgcHJvdmlkZXIgZm9yIGVhY2ggdW5pcXVlIGNvbWJpbmF0aW9uXG4gICAgICAgIGNvbnN0IHVuaXF1ZVByb3ZpZGVycyA9IG5ldyBNYXA8c3RyaW5nLCBJbnRlcm5hbFByb3ZpZGVyT3B0aW9uczxUPj4oKTtcblxuICAgICAgICBmb3IgKGNvbnN0IHByb3ZpZGVyIG9mIGZpbHRlcmVkQW5kU29ydGVkKSB7XG4gICAgICAgICAgICAvLyBDcmVhdGUgYSBjb21wb3NpdGUga2V5IGZyb20gcHJvdmlkZSB0b2tlbiwgdHlwZSwgYW5kIGZvckVudGl0eVxuICAgICAgICAgICAgY29uc3QgcHJvdmlkZVRva2VuID0gdGhpcy5jcmVhdGVUb2tlbihwcm92aWRlci5fcHJvdmlkZXIucHJvdmlkZSk7XG4gICAgICAgICAgICBjb25zdCB0eXBlID0gcHJvdmlkZXIuX3Byb3ZpZGVyLnR5cGUgfHwgJ2RlZmF1bHQnO1xuICAgICAgICAgICAgY29uc3QgZm9yRW50aXR5ID0gcHJvdmlkZXIuX3Byb3ZpZGVyLmZvckVudGl0eSB8fCAnJztcbiAgICAgICAgICAgIGNvbnN0IGNvbXBvc2l0ZUtleSA9IGAke3Byb3ZpZGVUb2tlbn06OiR7dHlwZX06OiR7Zm9yRW50aXR5fWA7XG5cbiAgICAgICAgICAgIGlmICghdW5pcXVlUHJvdmlkZXJzLmhhcyhjb21wb3NpdGVLZXkpKSB7XG4gICAgICAgICAgICAgICAgdW5pcXVlUHJvdmlkZXJzLnNldChjb21wb3NpdGVLZXksIHByb3ZpZGVyKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIE5vdGU6IFNpbmNlIGZpbHRlcmVkQW5kU29ydGVkIGlzIGFscmVhZHkgc29ydGVkIGJ5IHByaW9yaXR5IChoaWdoZXN0IGZpcnN0KSxcbiAgICAgICAgICAgIC8vIHRoZSBmaXJzdCBwcm92aWRlciB3ZSBlbmNvdW50ZXIgZm9yIGVhY2ggY29tcG9zaXRlIGtleSBpcyB0aGUgYmVzdCBvbmVcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBBcnJheS5mcm9tKHVuaXF1ZVByb3ZpZGVycy52YWx1ZXMoKSk7XG4gICAgfVxuXG4gICAgcmVzb2x2ZTxULCBBc3luYyBleHRlbmRzIGJvb2xlYW4gPSBmYWxzZT4oXG4gICAgICAgIGRlcGVuZGVuY3lUb2tlbjogRGVwSWRlbnRpZmllcjxUPixcbiAgICAgICAgY3JpdGVyaWE/OiB7XG4gICAgICAgICAgICB0YWdzPzogc3RyaW5nW107XG4gICAgICAgICAgICB0eXBlPzogUHJvdmlkZXJPcHRpb25zWyAndHlwZScgXSxcbiAgICAgICAgICAgIHByaW9yaXR5PzogUHJpb3JpdHlDcml0ZXJpYTtcbiAgICAgICAgICAgIGZvckVudGl0eT86IFByb3ZpZGVyT3B0aW9uc1sgJ2ZvckVudGl0eScgXSxcbiAgICAgICAgICAgIGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnM/OiBib29sZWFuXG4gICAgICAgIH0sXG4gICAgICAgIHBhdGg6IFNldDxUb2tlbj4gPSBuZXcgU2V0KCksXG4gICAgICAgIGFzeW5jOiBBc3luYyA9IGZhbHNlIGFzIEFzeW5jXG4gICAgKTogQXN5bmMgZXh0ZW5kcyB0cnVlID8gUHJvbWlzZTxUPiA6IFQge1xuXG4gICAgICAgIGNvbnN0IHRva2VuID0gdGhpcy5jcmVhdGVUb2tlbihkZXBlbmRlbmN5VG9rZW4pO1xuICAgICAgICBjcml0ZXJpYSA9IGNyaXRlcmlhID8/IHt9O1xuXG4gICAgICAgIC8vIGlmIHRva2VuIGlzIGBESUNvbnRhaW5lcmAgcmV0dXJuIHRoZSBjdXJyZW50IGNvbnRhaW5lclxuICAgICAgICBpZiAoRElfVE9LRU5TLkRJX0NPTlRBSU5FUiA9PT0gdG9rZW4gfHwgdGhpcy5jcmVhdGVUb2tlbihESUNvbnRhaW5lcikgPT09IHRva2VuKSB7XG4gICAgICAgICAgICByZXR1cm4gKGFzeW5jID8gUHJvbWlzZS5yZXNvbHZlKHRoaXMpIDogdGhpcykgYXMgQXN5bmMgZXh0ZW5kcyB0cnVlID8gUHJvbWlzZTxUPiA6IFQ7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBiZXN0UHJvdmlkZXJzID0gdGhpcy5jb2xsZWN0QmVzdFByb3ZpZGVyc0ZvcjxUPih7XG4gICAgICAgICAgICAuLi5jcml0ZXJpYSxcbiAgICAgICAgICAgIHRva2VuLFxuICAgICAgICB9KTtcblxuICAgICAgICBpZiAoYmVzdFByb3ZpZGVycy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBOb1Byb3ZpZGVyRm91bmRFcnJvcih0b2tlbiwgdGhpcywgY3JpdGVyaWEpO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IG9wdGlvbnMgPSBiZXN0UHJvdmlkZXJzWyAwIF07XG5cbiAgICAgICAgcmV0dXJuIHRoaXMucmVzb2x2ZVByb3ZpZGVyVmFsdWU8VCwgQXN5bmM+KG9wdGlvbnMsIHBhdGgsIGFzeW5jKTtcbiAgICB9XG5cbiAgICByZXNvbHZlUHJvdmlkZXJWYWx1ZTxULCBBc3luYyBleHRlbmRzIGJvb2xlYW4gPSBmYWxzZT4oXG4gICAgICAgIG9wdGlvbnM6IEludGVybmFsUHJvdmlkZXJPcHRpb25zPFQ+LFxuICAgICAgICBwYXRoOiBTZXQ8VG9rZW4+ID0gbmV3IFNldCgpLFxuICAgICAgICBhc3luYzogQXN5bmMgPSBmYWxzZSBhcyBBc3luY1xuICAgICk6IEFzeW5jIGV4dGVuZHMgdHJ1ZSA/IFByb21pc2U8VD4gOiBUIHtcblxuICAgICAgICBjb25zdCB7IF9pZCwgX2NvbnRhaW5lciwgX3Byb3ZpZGVyOiBwcm92aWRlciB9ID0gb3B0aW9ucztcblxuICAgICAgICBpZiAoX2NvbnRhaW5lciAhPT0gdGhpcykge1xuICAgICAgICAgICAgcmV0dXJuIChfY29udGFpbmVyIGFzIERJQ29udGFpbmVyKS5yZXNvbHZlUHJvdmlkZXJWYWx1ZShvcHRpb25zLCBwYXRoLCBhc3luYyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAocHJvdmlkZXIuc2luZ2xldG9uICYmIHRoaXMuY2FjaGUuaGFzKF9pZCkpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmNhY2hlLmdldChfaWQpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHRoaXMucmVzb2x2aW5nLmhhcyhfaWQpKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5yZXNvbHZpbmcuZ2V0KF9pZCk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAocGF0aC5oYXMoX2lkKSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IENpcmN1bGFyRGVwZW5kZW5jeUVycm9yKEFycmF5LmZyb20ocGF0aCksIHRoaXMuY29udGFpbmVySWQpO1xuICAgICAgICB9XG5cbiAgICAgICAgcGF0aC5hZGQoX2lkKTtcblxuICAgICAgICBpZiAoYXN5bmMpIHtcbiAgICAgICAgICAgIHJldHVybiBhcHBseU1pZGRsZXdhcmVzQXN5bmMoXG4gICAgICAgICAgICAgICAgdGhpcy5hc3luY01pZGRsZXdhcmVzLFxuICAgICAgICAgICAgICAgICgpID0+IHRoaXMuY3JlYXRlQW5kQ2FjaGVJbnN0YW5jZUFzeW5jPFQ+KG9wdGlvbnMsIHBhdGgpXG4gICAgICAgICAgICApIGFzIEFzeW5jIGV4dGVuZHMgdHJ1ZSA/IFByb21pc2U8VD4gOiBUO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGFwcGx5TWlkZGxld2FyZXMoXG4gICAgICAgICAgICB0aGlzLm1pZGRsZXdhcmVzLFxuICAgICAgICAgICAgKCkgPT4gdGhpcy5jcmVhdGVBbmRDYWNoZUluc3RhbmNlKG9wdGlvbnMsIHBhdGgpXG4gICAgICAgICkgYXMgQXN5bmMgZXh0ZW5kcyB0cnVlID8gUHJvbWlzZTxUPiA6IFQ7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBjcmVhdGVBbmRDYWNoZUluc3RhbmNlPFQ+KG9wdGlvbnM6IEludGVybmFsUHJvdmlkZXJPcHRpb25zPFQ+LCBwYXRoOiBTZXQ8VG9rZW4+KTogVCB7XG5cbiAgICAgICAgY29uc3QgeyBfaWQsIF9wcm92aWRlcjogcHJvdmlkZXIgfSA9IG9wdGlvbnM7XG5cbiAgICAgICAgY29uc3QgaW5zdGFuY2UgPSB0aGlzLmNyZWF0ZUluc3RhbmNlKG9wdGlvbnMsIHBhdGgpO1xuICAgICAgICBpZiAocHJvdmlkZXIuc2luZ2xldG9uKSB7XG4gICAgICAgICAgICB0aGlzLmNhY2hlLnNldChfaWQsIGluc3RhbmNlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMucmVzb2x2aW5nLmRlbGV0ZShfaWQpO1xuXG4gICAgICAgIHRoaXMuaW5qZWN0UHJvcGVydGllcyhpbnN0YW5jZSk7XG4gICAgICAgIHRoaXMuaW5pdGlhbGl6ZUluc3RhbmNlKGluc3RhbmNlKTtcblxuICAgICAgICBwYXRoLmRlbGV0ZShfaWQpO1xuXG4gICAgICAgIHJldHVybiBpbnN0YW5jZTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGNyZWF0ZUluc3RhbmNlPFQsIEFzeW5jIGV4dGVuZHMgYm9vbGVhbiA9IGZhbHNlPihcbiAgICAgICAgb3B0aW9uczogSW50ZXJuYWxQcm92aWRlck9wdGlvbnM8VD4sXG4gICAgICAgIHBhdGg6IFNldDxUb2tlbj4sXG4gICAgICAgIGFzeW5jOiBBc3luYyA9IGZhbHNlIGFzIEFzeW5jXG4gICAgKTogQXN5bmMgZXh0ZW5kcyB0cnVlID8gUHJvbWlzZTxUPiA6IFQge1xuXG4gICAgICAgIGNvbnN0IHsgX2lkLCBfcHJvdmlkZXI6IHByb3ZpZGVyIH0gPSBvcHRpb25zO1xuXG4gICAgICAgIGlmIChpc0FsaWFzUHJvdmlkZXJPcHRpb25zKHByb3ZpZGVyKSkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMucmVzb2x2ZShwcm92aWRlci51c2VFeGlzdGluZywge30sIHBhdGgsIGFzeW5jKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChpc0NsYXNzUHJvdmlkZXJPcHRpb25zKHByb3ZpZGVyKSkge1xuXG4gICAgICAgICAgICByZXR1cm4gKFxuICAgICAgICAgICAgICAgIGFzeW5jID8gdGhpcy5jcmVhdGVDbGFzc0luc3RhbmNlPFQsIHRydWU+KG9wdGlvbnMsIHBhdGgsIHRydWUpXG4gICAgICAgICAgICAgICAgICAgIDogdGhpcy5jcmVhdGVDbGFzc0luc3RhbmNlKG9wdGlvbnMsIHBhdGgpXG4gICAgICAgICAgICApIGFzIEFzeW5jIGV4dGVuZHMgdHJ1ZSA/IFByb21pc2U8VD4gOiBUO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGlzRmFjdG9yeVByb3ZpZGVyT3B0aW9ucyhwcm92aWRlcikpIHtcblxuICAgICAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICAgICAgICBhc3luYyA/IHRoaXMuY3JlYXRlRmFjdG9yeUluc3RhbmNlQXN5bmM8VD4ocHJvdmlkZXIsIHBhdGgpXG4gICAgICAgICAgICAgICAgICAgIDogdGhpcy5jcmVhdGVGYWN0b3J5SW5zdGFuY2UocHJvdmlkZXIsIHBhdGgpXG4gICAgICAgICAgICApIGFzIEFzeW5jIGV4dGVuZHMgdHJ1ZSA/IFByb21pc2U8VD4gOiBUO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGlzVmFsdWVQcm92aWRlck9wdGlvbnMocHJvdmlkZXIpKSB7XG4gICAgICAgICAgICByZXR1cm4gcHJvdmlkZXIudXNlVmFsdWUgYXMgQXN5bmMgZXh0ZW5kcyB0cnVlID8gUHJvbWlzZTxUPiA6IFQ7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoaXNDb25maWdQcm92aWRlck9wdGlvbnMocHJvdmlkZXIpKSB7XG4gICAgICAgICAgICByZXR1cm4gcHJvdmlkZXIudXNlQ29uZmlnIGFzIEFzeW5jIGV4dGVuZHMgdHJ1ZSA/IFByb21pc2U8VD4gOiBUO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhyb3cgbmV3IFByb3ZpZGVyQ29uZmlndXJhdGlvbkVycm9yKF9pZCwgdGhpcy5jb250YWluZXJJZCk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBjcmVhdGVDbGFzc0luc3RhbmNlPFQsIEFzeW5jIGV4dGVuZHMgYm9vbGVhbiA9IGZhbHNlPihcbiAgICAgICAgb3B0aW9uczogSW50ZXJuYWxQcm92aWRlck9wdGlvbnM8VD4sXG4gICAgICAgIHBhdGg6IFNldDxUb2tlbj4sXG4gICAgICAgIGFzeW5jOiBBc3luYyA9IGZhbHNlIGFzIEFzeW5jXG4gICAgKTogQXN5bmMgZXh0ZW5kcyB0cnVlID8gUHJvbWlzZTxUPiA6IFQge1xuXG4gICAgICAgIGNvbnN0IHsgX2lkLCBfcHJvdmlkZXI6IHByb3ZpZGVyIH0gPSBvcHRpb25zO1xuXG4gICAgICAgIGlmICh0aGlzLnJlc29sdmluZy5oYXMoX2lkKSkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMucmVzb2x2aW5nLmdldChfaWQpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgeyB1c2VDbGFzcyB9ID0gcHJvdmlkZXIgYXMgQ2xhc3NQcm92aWRlck9wdGlvbnM8VD47XG5cbiAgICAgICAgLy8gQ3JlYXRlIGEgcGxhY2Vob2xkZXIgb2JqZWN0IGFuZCBzdG9yZSBpdCBpbiB0aGUgcmVzb2x2aW5nIG1hcFxuICAgICAgICBjb25zdCBpbnN0YW5jZVBsYWNlaG9sZGVyOiBUID0gT2JqZWN0LmNyZWF0ZSh1c2VDbGFzcy5wcm90b3R5cGUpO1xuICAgICAgICB0aGlzLnJlc29sdmluZy5zZXQoX2lkLCBpbnN0YW5jZVBsYWNlaG9sZGVyKTtcblxuXG4gICAgICAgIGlmIChhc3luYykge1xuICAgICAgICAgICAgdGhpcy5yZXNvbHZlRGVwZW5kZW5jaWVzQXN5bmModXNlQ2xhc3MsIHBhdGgpLnRoZW4oZGVwZW5kZW5jaWVzID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBhY3R1YWxJbnN0YW5jZSA9IG5ldyB1c2VDbGFzcyguLi5kZXBlbmRlbmNpZXMpO1xuICAgICAgICAgICAgICAgIE9iamVjdC5hc3NpZ24oaW5zdGFuY2VQbGFjZWhvbGRlciBhcyBhbnksIGFjdHVhbEluc3RhbmNlKTtcbiAgICAgICAgICAgICAgICB0aGlzLnJlc29sdmluZy5zZXQoX2lkLCBhY3R1YWxJbnN0YW5jZSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGFjdHVhbEluc3RhbmNlO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGRlcGVuZGVuY2llcyA9IHRoaXMucmVzb2x2ZURlcGVuZGVuY2llcyh1c2VDbGFzcywgcGF0aCk7XG4gICAgICAgIGNvbnN0IGFjdHVhbEluc3RhbmNlID0gbmV3IHVzZUNsYXNzKC4uLmRlcGVuZGVuY2llcyk7XG4gICAgICAgIE9iamVjdC5hc3NpZ24oaW5zdGFuY2VQbGFjZWhvbGRlciBhcyBhbnksIGFjdHVhbEluc3RhbmNlKTtcbiAgICAgICAgdGhpcy5yZXNvbHZpbmcuc2V0KF9pZCwgYWN0dWFsSW5zdGFuY2UpO1xuXG4gICAgICAgIHJldHVybiBhY3R1YWxJbnN0YW5jZSBhcyBBc3luYyBleHRlbmRzIHRydWUgPyBQcm9taXNlPFQ+IDogVDtcbiAgICB9XG5cbiAgICBwcml2YXRlIGNyZWF0ZUZhY3RvcnlJbnN0YW5jZTxUPihvcHRpb25zOiBGYWN0b3J5UHJvdmlkZXJPcHRpb25zPFQ+LCBwYXRoOiBTZXQ8VG9rZW4+KTogVCB7XG4gICAgICAgIGNvbnN0IGRlcGVuZGVuY2llcyA9IChvcHRpb25zLmRlcHMgfHwgW10pLm1hcChkZXAgPT4gdGhpcy5yZXNvbHZlRGVwZW5kZW5jeShkZXAsIHBhdGgpKTtcbiAgICAgICAgcmV0dXJuIG9wdGlvbnMudXNlRmFjdG9yeSguLi5kZXBlbmRlbmNpZXMpO1xuICAgIH1cblxuICAgIGdldENsYXNzRGVwZW5kZW5jaWVzKHRhcmdldDogQ2xhc3NDb25zdHJ1Y3Rvcikge1xuICAgICAgICBjb25zdCBjb25zdHJ1Y3RvckRlcGVuZGVuY2llcyA9IGdldENvbnN0cnVjdG9yRGVwZW5kZW5jaWVzTWV0YWRhdGEodGFyZ2V0KTtcbiAgICAgICAgY29uc3QgcHJvcGVydHlEZXBlbmRlbmNpZXMgPSBnZXRQcm9wZXJ0eURlcGVuZGVuY2llc01ldGFkYXRhKHRhcmdldCk7XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHByb3BlcnR5RGVwZW5kZW5jaWVzLFxuICAgICAgICAgICAgY29uc3RydWN0b3JEZXBlbmRlbmNpZXNcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgcmVzb2x2ZURlcGVuZGVuY3k8VCwgQXN5bmMgZXh0ZW5kcyBib29sZWFuID0gZmFsc2U+KFxuICAgICAgICBkZXA6IERlcElkZW50aWZpZXIgfCBDb21wbGV4RGVwZW5kZW5jeUlkZW50aWZpZXIsXG4gICAgICAgIHBhdGg6IFNldDxUb2tlbj4sXG4gICAgICAgIGFzeW5jOiBBc3luYyA9IGZhbHNlIGFzIEFzeW5jXG4gICAgKTogQXN5bmMgZXh0ZW5kcyB0cnVlID8gUHJvbWlzZTxUPiA6IFQge1xuXG4gICAgICAgIGxldCBub3JtYWxpemVkRGVwID0gZGVwO1xuXG4gICAgICAgIGlmICghaXNDb21wbGV4RGVwZW5kZW5jeUlkZW50aWZpZXIobm9ybWFsaXplZERlcCkpIHtcbiAgICAgICAgICAgIG5vcm1hbGl6ZWREZXAgPSB7IHRva2VuOiBub3JtYWxpemVkRGVwIH0gYXMgQ29tcGxleERlcGVuZGVuY3lJZGVudGlmaWVyO1xuICAgICAgICB9XG5cbiAgICAgICAgdHJ5IHtcblxuICAgICAgICAgICAgaWYgKG5vcm1hbGl6ZWREZXAuaXNDb25maWcpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5yZXNvbHZlQ29uZmlnKG5vcm1hbGl6ZWREZXAudG9rZW4gYXMgc3RyaW5nLCBub3JtYWxpemVkRGVwKSBhcyBBc3luYyBleHRlbmRzIHRydWUgPyBQcm9taXNlPFQ+IDogVDtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKG5vcm1hbGl6ZWREZXAuZm9yRW50aXR5KSB7XG4gICAgICAgICAgICAgICAgaWYgKG5vcm1hbGl6ZWREZXAudHlwZSA9PSAnc2NoZW1hJykge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5yZXNvbHZlRW50aXR5U2NoZW1hKG5vcm1hbGl6ZWREZXAuZm9yRW50aXR5LCBub3JtYWxpemVkRGVwLCBhc3luYylcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKG5vcm1hbGl6ZWREZXAudHlwZSA9PSAnc2VydmljZScpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMucmVzb2x2ZUVudGl0eVNlcnZpY2Uobm9ybWFsaXplZERlcC5mb3JFbnRpdHksIG5vcm1hbGl6ZWREZXAsIGFzeW5jKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSW52YWxpZERlcGVuZGVuY3lDcml0ZXJpYUVycm9yKEpTT04uc3RyaW5naWZ5KG5vcm1hbGl6ZWREZXApKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIHRoaXMucmVzb2x2ZTxULCBBc3luYz4obm9ybWFsaXplZERlcC50b2tlbiwgbm9ybWFsaXplZERlcCwgcGF0aCwgYXN5bmMpXG5cbiAgICAgICAgfSBjYXRjaCAoZSkge1xuXG4gICAgICAgICAgICBpZiAoXG4gICAgICAgICAgICAgICAgZSBpbnN0YW5jZW9mIE5vUHJvdmlkZXJGb3VuZEVycm9yXG4gICAgICAgICAgICAgICAgJiZcbiAgICAgICAgICAgICAgICAobm9ybWFsaXplZERlcC5pc09wdGlvbmFsIHx8IG5vcm1hbGl6ZWREZXAuZGVmYXVsdFZhbHVlICE9PSB1bmRlZmluZWQpXG4gICAgICAgICAgICApIHtcbiAgICAgICAgICAgICAgICAvLyB0aGlzLmxvZ2dlci5pbmZvKGBObyBwcm92aWRlciBmb3VuZCBmb3IgJHtKU09OLnN0cmluZ2lmeShkZXApfWAsIHsgcGF0aCB9KVxuICAgICAgICAgICAgICAgIHJldHVybiBub3JtYWxpemVkRGVwLmRlZmF1bHRWYWx1ZSA/PyB1bmRlZmluZWQ7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHRocm93IGU7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIHJlc29sdmVEZXBlbmRlbmNpZXM8VCBleHRlbmRzIENsYXNzQ29uc3RydWN0b3I+KHRhcmdldDogVCwgcGF0aDogU2V0PFRva2VuPik6IGFueVtdIHtcblxuICAgICAgICBjb25zdCBpbmplY3RNZXRhZGF0YSA9IGdldENvbnN0cnVjdG9yRGVwZW5kZW5jaWVzTWV0YWRhdGEodGFyZ2V0KTtcblxuICAgICAgICByZXR1cm4gaW5qZWN0TWV0YWRhdGEubWFwKGRlcCA9PiB0aGlzLnJlc29sdmVEZXBlbmRlbmN5KGRlcCwgcGF0aCkpO1xuICAgIH1cblxuICAgIHByaXZhdGUgaW5pdGlhbGl6ZUluc3RhbmNlPFQ+KGluc3RhbmNlOiBUKTogdm9pZCB7XG4gICAgICAgIGlmICghaGFzQ29uc3RydWN0b3IoaW5zdGFuY2UpKSByZXR1cm47XG5cbiAgICAgICAgY29uc3QgaW5pdE1ldGhvZCA9IGdldE9uSW5pdEhvb2tNZXRhZGF0YShpbnN0YW5jZS5jb25zdHJ1Y3RvciBhcyBDbGFzc0NvbnN0cnVjdG9yKTtcblxuICAgICAgICBpZiAoaW5pdE1ldGhvZCkge1xuICAgICAgICAgICAgY29uc3QgdGhlSW5pdE1ldGhvZCA9IGluc3RhbmNlWyBpbml0TWV0aG9kIGFzIGtleW9mIHR5cGVvZiBpbnN0YW5jZSBdIGFzIEZ1bmN0aW9uO1xuICAgICAgICAgICAgaWYgKHR5cGVvZiB0aGVJbml0TWV0aG9kID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgdGhlSW5pdE1ldGhvZC5jYWxsKGluc3RhbmNlKTsgIC8vIEJpbmQgJ3RoaXMnIGNvbnRleHQgdG8gdGhlIGluc3RhbmNlXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSW5pdGlhbGl6YXRpb25NZXRob2RFcnJvcihpbnN0YW5jZS5jb25zdHJ1Y3Rvci5uYW1lLCBlcnJvci5tZXNzYWdlLCB0aGlzLmNvbnRhaW5lcklkKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBJbml0aWFsaXphdGlvbk1ldGhvZFR5cGVFcnJvcihTdHJpbmcoaW5pdE1ldGhvZCksIGluc3RhbmNlLmNvbnN0cnVjdG9yLm5hbWUsIHRoaXMuY29udGFpbmVySWQpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBpbmplY3RQcm9wZXJ0aWVzPFQ+KGluc3RhbmNlOiBUKTogdm9pZCB7XG4gICAgICAgIGlmICghaGFzQ29uc3RydWN0b3IoaW5zdGFuY2UpKSByZXR1cm47XG5cbiAgICAgICAgY29uc3QgZGVwZW5kZW5jaWVzID0gZ2V0UHJvcGVydHlEZXBlbmRlbmNpZXNNZXRhZGF0YShpbnN0YW5jZS5jb25zdHJ1Y3RvciBhcyBDbGFzc0NvbnN0cnVjdG9yKTtcblxuICAgICAgICBmb3IgKGNvbnN0IGRlcCBvZiBkZXBlbmRlbmNpZXMpIHtcbiAgICAgICAgICAgIGNvbnN0IHByb3BlcnR5VmFsdWUgPSB0aGlzLnJlc29sdmVEZXBlbmRlbmN5KGRlcCwgbmV3IFNldCgpKVxuXG4gICAgICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkoaW5zdGFuY2UsIGRlcC5wcm9wZXJ0eUtleSwge1xuICAgICAgICAgICAgICAgIHZhbHVlOiBwcm9wZXJ0eVZhbHVlLFxuICAgICAgICAgICAgICAgIGVudW1lcmFibGU6IHRydWUsXG4gICAgICAgICAgICAgICAgY29uZmlndXJhYmxlOiB0cnVlXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGhhcyhcbiAgICAgICAgZGVwZW5kZW5jeVRva2VuOiBEZXBJZGVudGlmaWVyLFxuICAgICAgICBjcml0ZXJpYT86IHtcbiAgICAgICAgICAgIHRhZ3M/OiBzdHJpbmdbXTtcbiAgICAgICAgICAgIHR5cGU/OiBQcm92aWRlck9wdGlvbnNbICd0eXBlJyBdLFxuICAgICAgICAgICAgcHJpb3JpdHk/OiBQcmlvcml0eUNyaXRlcmlhO1xuICAgICAgICAgICAgZm9yRW50aXR5PzogUHJvdmlkZXJPcHRpb25zWyAnZm9yRW50aXR5JyBdLFxuICAgICAgICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVycz86IGJvb2xlYW5cbiAgICAgICAgfVxuICAgICk6IGJvb2xlYW4ge1xuXG4gICAgICAgIGNvbnN0IHRva2VuID0gdGhpcy5jcmVhdGVUb2tlbihkZXBlbmRlbmN5VG9rZW4pO1xuXG4gICAgICAgIGNvbnN0IGJlc3RQcm92aWRlcnMgPSB0aGlzLmNvbGxlY3RCZXN0UHJvdmlkZXJzRm9yPGFueT4oe1xuICAgICAgICAgICAgLi4uY3JpdGVyaWEsXG4gICAgICAgICAgICB0b2tlbixcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIGJlc3RQcm92aWRlcnMubGVuZ3RoID4gMDtcbiAgICB9XG5cbiAgICBoYXNFbnRpdHlTZXJ2aWNlKFxuICAgICAgICBlbnRpdHlOYW1lOiBEZXBJZGVudGlmaWVyLFxuICAgICAgICBjcml0ZXJpYT86IHtcbiAgICAgICAgICAgIHRhZ3M/OiBzdHJpbmdbXTtcbiAgICAgICAgICAgIHByaW9yaXR5PzogUHJpb3JpdHlDcml0ZXJpYTtcbiAgICAgICAgICAgIGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnM/OiBib29sZWFuXG4gICAgICAgIH1cbiAgICApOiBib29sZWFuIHtcblxuICAgICAgICBjb25zdCB7IHRhZ3MsIHByaW9yaXR5LCBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzIH0gPSBjcml0ZXJpYSA/PyB7fTtcbiAgICAgICAgY29uc3QgYmVzdFByb3ZpZGVycyA9IHRoaXMuY29sbGVjdEJlc3RQcm92aWRlcnNGb3I8YW55Pih7XG4gICAgICAgICAgICB0YWdzLFxuICAgICAgICAgICAgdHlwZTogJ3NlcnZpY2UnLFxuICAgICAgICAgICAgcHJpb3JpdHksXG4gICAgICAgICAgICBmb3JFbnRpdHk6IGVudGl0eU5hbWUsXG4gICAgICAgICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzLFxuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gYmVzdFByb3ZpZGVycy5sZW5ndGggPiAwO1xuICAgIH1cblxuICAgIHJlc29sdmVFbnRpdHlTZXJ2aWNlPFQsIEFzeW5jIGV4dGVuZHMgYm9vbGVhbiA9IGZhbHNlPihcbiAgICAgICAgZW50aXR5TmFtZTogRGVwSWRlbnRpZmllcixcbiAgICAgICAgY3JpdGVyaWE/OiB7XG4gICAgICAgICAgICB0YWdzPzogc3RyaW5nW107XG4gICAgICAgICAgICBwcmlvcml0eT86IFByaW9yaXR5Q3JpdGVyaWE7XG4gICAgICAgICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzPzogYm9vbGVhblxuICAgICAgICB9LFxuICAgICAgICBhc3luYzogQXN5bmMgPSBmYWxzZSBhcyBBc3luY1xuICAgICk6IEFzeW5jIGV4dGVuZHMgdHJ1ZSA/IFByb21pc2U8VD4gOiBUIHtcblxuICAgICAgICBjb25zdCB7IHRhZ3MsIHByaW9yaXR5LCBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzIH0gPSBjcml0ZXJpYSA/PyB7fTtcbiAgICAgICAgY29uc3QgYmVzdFByb3ZpZGVycyA9IHRoaXMuY29sbGVjdEJlc3RQcm92aWRlcnNGb3I8YW55Pih7XG4gICAgICAgICAgICB0YWdzLFxuICAgICAgICAgICAgdHlwZTogJ3NlcnZpY2UnLFxuICAgICAgICAgICAgcHJpb3JpdHksXG4gICAgICAgICAgICBmb3JFbnRpdHk6IGVudGl0eU5hbWUsXG4gICAgICAgICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzLFxuICAgICAgICB9KTtcblxuICAgICAgICBpZiAoYmVzdFByb3ZpZGVycy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBOb0VudGl0eVNlcnZpY2VQcm92aWRlckVycm9yKFN0cmluZyhlbnRpdHlOYW1lKSwgdGhpcy5jb250YWluZXJJZCk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3Qgb3B0aW9ucyA9IGJlc3RQcm92aWRlcnNbIDAgXTtcblxuICAgICAgICByZXR1cm4gdGhpcy5yZXNvbHZlUHJvdmlkZXJWYWx1ZTxULCBBc3luYz4ob3B0aW9ucywgbmV3IFNldCgpLCBhc3luYyk7XG4gICAgfVxuXG4gICAgaGFzRW50aXR5U2NoZW1hKFxuICAgICAgICBlbnRpdHlOYW1lOiBEZXBJZGVudGlmaWVyLFxuICAgICAgICBjcml0ZXJpYT86IHtcbiAgICAgICAgICAgIHRhZ3M/OiBzdHJpbmdbXTtcbiAgICAgICAgICAgIHByaW9yaXR5PzogUHJpb3JpdHlDcml0ZXJpYTtcbiAgICAgICAgICAgIGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnM/OiBib29sZWFuXG4gICAgICAgIH1cbiAgICApOiBib29sZWFuIHtcblxuICAgICAgICBjb25zdCB7IHRhZ3MsIHByaW9yaXR5LCBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzIH0gPSBjcml0ZXJpYSA/PyB7fTtcbiAgICAgICAgY29uc3QgYmVzdFByb3ZpZGVycyA9IHRoaXMuY29sbGVjdEJlc3RQcm92aWRlcnNGb3I8YW55Pih7XG4gICAgICAgICAgICB0YWdzLFxuICAgICAgICAgICAgdHlwZTogJ3NjaGVtYScsXG4gICAgICAgICAgICBwcmlvcml0eSxcbiAgICAgICAgICAgIGZvckVudGl0eTogZW50aXR5TmFtZSxcbiAgICAgICAgICAgIGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnMsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiBiZXN0UHJvdmlkZXJzLmxlbmd0aCA+IDA7XG4gICAgfVxuXG4gICAgcmVzb2x2ZUVudGl0eVNjaGVtYTxULCBBc3luYyBleHRlbmRzIGJvb2xlYW4gPSBmYWxzZT4oXG4gICAgICAgIGVudGl0eU5hbWU6IERlcElkZW50aWZpZXIsXG4gICAgICAgIGNyaXRlcmlhPzoge1xuICAgICAgICAgICAgdGFncz86IHN0cmluZ1tdO1xuICAgICAgICAgICAgcHJpb3JpdHk/OiBQcmlvcml0eUNyaXRlcmlhO1xuICAgICAgICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVycz86IGJvb2xlYW5cbiAgICAgICAgfSxcbiAgICAgICAgYXN5bmM6IEFzeW5jID0gZmFsc2UgYXMgQXN5bmNcbiAgICApOiBBc3luYyBleHRlbmRzIHRydWUgPyBQcm9taXNlPFQ+IDogVCB7XG5cbiAgICAgICAgY29uc3QgeyB0YWdzLCBwcmlvcml0eSwgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVycyB9ID0gY3JpdGVyaWEgPz8ge307XG4gICAgICAgIGNvbnN0IGJlc3RQcm92aWRlcnMgPSB0aGlzLmNvbGxlY3RCZXN0UHJvdmlkZXJzRm9yPGFueT4oe1xuICAgICAgICAgICAgdGFncyxcbiAgICAgICAgICAgIHR5cGU6ICdzY2hlbWEnLFxuICAgICAgICAgICAgcHJpb3JpdHksXG4gICAgICAgICAgICBmb3JFbnRpdHk6IGVudGl0eU5hbWUsXG4gICAgICAgICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzLFxuICAgICAgICB9KTtcblxuICAgICAgICBpZiAoYmVzdFByb3ZpZGVycy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBOb0VudGl0eVNjaGVtYVByb3ZpZGVyRXJyb3IoU3RyaW5nKGVudGl0eU5hbWUpLCB0aGlzLmNvbnRhaW5lcklkKTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBvcHRpb25zID0gYmVzdFByb3ZpZGVyc1sgMCBdO1xuXG4gICAgICAgIHJldHVybiB0aGlzLnJlc29sdmVQcm92aWRlclZhbHVlPFQsIEFzeW5jPihvcHRpb25zLCBuZXcgU2V0KCksIGFzeW5jKTtcbiAgICB9XG5cbiAgICBjbGVhcihjbGVhckNoaWxkQ29udGFpbmVycyA9IHRydWUpIHtcbiAgICAgICAgdGhpcy5wcm92aWRlcnMuY2xlYXIoKTtcbiAgICAgICAgdGhpcy5jYWNoZS5jbGVhcigpO1xuICAgICAgICB0aGlzLnJlc29sdmluZy5jbGVhcigpO1xuICAgICAgICBpZiAoY2xlYXJDaGlsZENvbnRhaW5lcnMpIHtcbiAgICAgICAgICAgIHRoaXMuY2hpbGRDb250YWluZXJzLmZvckVhY2goY29udGFpbmVyID0+IGNvbnRhaW5lci5jbGVhcigpKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHVzZU1pZGRsZXdhcmUoeyBtaWRkbGV3YXJlLCBvcmRlciA9IDEgfTogUGFydGlhbEJ5PERJTWlkZGxld2FyZTxhbnk+LCAnb3JkZXInPikge1xuICAgICAgICB0aGlzLm1pZGRsZXdhcmVzLnB1c2goeyBtaWRkbGV3YXJlLCBvcmRlciB9KTtcbiAgICAgICAgdGhpcy5taWRkbGV3YXJlcy5zb3J0KChhLCBiKSA9PiAoYS5vcmRlciA/PyAwKSAtIChiLm9yZGVyID8/IDApKTtcbiAgICB9XG5cbiAgICBhc3luYyByZXNvbHZlQXN5bmM8VD4oXG4gICAgICAgIGRlcGVuZGVuY3lUb2tlbjogRGVwSWRlbnRpZmllcjxUPixcbiAgICAgICAgY3JpdGVyaWE/OiB7XG4gICAgICAgICAgICB0YWdzPzogc3RyaW5nW107XG4gICAgICAgICAgICB0eXBlPzogUHJvdmlkZXJPcHRpb25zWyAndHlwZScgXSxcbiAgICAgICAgICAgIHByaW9yaXR5PzogUHJpb3JpdHlDcml0ZXJpYTtcbiAgICAgICAgICAgIGZvckVudGl0eT86IFByb3ZpZGVyT3B0aW9uc1sgJ2ZvckVudGl0eScgXSxcbiAgICAgICAgICAgIGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnM/OiBib29sZWFuXG4gICAgICAgIH0sXG4gICAgICAgIHBhdGg/OiBTZXQ8VG9rZW4+XG4gICAgKSB7XG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLnJlc29sdmU8VCwgdHJ1ZT4oZGVwZW5kZW5jeVRva2VuLCBjcml0ZXJpYSwgcGF0aCwgdHJ1ZSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBjcmVhdGVBbmRDYWNoZUluc3RhbmNlQXN5bmM8VD4ob3B0aW9uczogSW50ZXJuYWxQcm92aWRlck9wdGlvbnM8VD4sIHBhdGg6IFNldDxUb2tlbj4pOiBQcm9taXNlPFQ+IHtcbiAgICAgICAgY29uc3QgeyBfaWQsIF9wcm92aWRlcjogcHJvdmlkZXIgfSA9IG9wdGlvbnM7XG5cbiAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBhd2FpdCB0aGlzLmNyZWF0ZUluc3RhbmNlKG9wdGlvbnMsIHBhdGgsIHRydWUpO1xuICAgICAgICBpZiAocHJvdmlkZXIuc2luZ2xldG9uKSB7XG4gICAgICAgICAgICB0aGlzLmNhY2hlLnNldChfaWQsIGluc3RhbmNlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMucmVzb2x2aW5nLmRlbGV0ZShfaWQpO1xuXG4gICAgICAgIGF3YWl0IHRoaXMuaW5qZWN0UHJvcGVydGllc0FzeW5jKGluc3RhbmNlKTtcbiAgICAgICAgYXdhaXQgdGhpcy5pbml0aWFsaXplSW5zdGFuY2VBc3luYyhpbnN0YW5jZSk7XG5cbiAgICAgICAgcGF0aC5kZWxldGUoX2lkKTtcblxuICAgICAgICByZXR1cm4gaW5zdGFuY2U7XG4gICAgfVxuXG4gICAgdXNlTWlkZGxld2FyZUFzeW5jKHsgbWlkZGxld2FyZSwgb3JkZXIgPSAxIH06IFBhcnRpYWxCeTxESU1pZGRsZXdhcmVBc3luYzxhbnk+LCAnb3JkZXInPikge1xuICAgICAgICB0aGlzLmFzeW5jTWlkZGxld2FyZXMucHVzaCh7IG1pZGRsZXdhcmUsIG9yZGVyIH0pO1xuICAgICAgICB0aGlzLmFzeW5jTWlkZGxld2FyZXMuc29ydCgoYSwgYikgPT4gKGEub3JkZXIgPz8gMCkgLSAoYi5vcmRlciA/PyAwKSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyByZXNvbHZlRGVwZW5kZW5jaWVzQXN5bmM8VCBleHRlbmRzIENsYXNzQ29uc3RydWN0b3I+KHRhcmdldDogVCwgcGF0aDogU2V0PFRva2VuPik6IFByb21pc2U8YW55W10+IHtcblxuICAgICAgICBjb25zdCBpbmplY3RNZXRhZGF0YSA9IGdldENvbnN0cnVjdG9yRGVwZW5kZW5jaWVzTWV0YWRhdGEodGFyZ2V0KTtcblxuICAgICAgICByZXR1cm4gYXdhaXQgUHJvbWlzZS5hbGwoaW5qZWN0TWV0YWRhdGEubWFwKGFzeW5jIGRlcCA9PiBhd2FpdCB0aGlzLnJlc29sdmVEZXBlbmRlbmN5KGRlcCwgcGF0aCwgdHJ1ZSkpKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIGluaXRpYWxpemVJbnN0YW5jZUFzeW5jPFQ+KGluc3RhbmNlOiBUKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGlmICghaGFzQ29uc3RydWN0b3IoaW5zdGFuY2UpKSByZXR1cm47XG5cbiAgICAgICAgY29uc3QgaW5pdE1ldGhvZCA9IGdldE9uSW5pdEhvb2tNZXRhZGF0YShpbnN0YW5jZS5jb25zdHJ1Y3RvciBhcyBDbGFzc0NvbnN0cnVjdG9yKTtcblxuICAgICAgICBpZiAoaW5pdE1ldGhvZCkge1xuICAgICAgICAgICAgY29uc3QgdGhlSW5pdE1ldGhvZCA9IGluc3RhbmNlWyBpbml0TWV0aG9kIGFzIGtleW9mIHR5cGVvZiBpbnN0YW5jZSBdIGFzIEZ1bmN0aW9uO1xuICAgICAgICAgICAgaWYgKHR5cGVvZiB0aGVJbml0TWV0aG9kID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgdGhlSW5pdE1ldGhvZC5jYWxsKGluc3RhbmNlKTsgIC8vIEJpbmQgJ3RoaXMnIGNvbnRleHQgdG8gdGhlIGluc3RhbmNlXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSW5pdGlhbGl6YXRpb25NZXRob2RFcnJvcihpbnN0YW5jZS5jb25zdHJ1Y3Rvci5uYW1lLCBlcnJvci5tZXNzYWdlLCB0aGlzLmNvbnRhaW5lcklkKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBJbml0aWFsaXphdGlvbk1ldGhvZFR5cGVFcnJvcihTdHJpbmcoaW5pdE1ldGhvZCksIGluc3RhbmNlLmNvbnN0cnVjdG9yLm5hbWUsIHRoaXMuY29udGFpbmVySWQpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBjcmVhdGVGYWN0b3J5SW5zdGFuY2VBc3luYzxUPihvcHRpb25zOiBGYWN0b3J5UHJvdmlkZXJPcHRpb25zPFQ+LCBwYXRoOiBTZXQ8VG9rZW4+KTogUHJvbWlzZTxUPiB7XG4gICAgICAgIGNvbnN0IGRlcGVuZGVuY2llcyA9IGF3YWl0IFByb21pc2UuYWxsKChvcHRpb25zLmRlcHMgfHwgW10pLm1hcChhc3luYyAoZGVwKSA9PiB7XG4gICAgICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5yZXNvbHZlRGVwZW5kZW5jeShkZXAsIHBhdGgsIHRydWUpO1xuICAgICAgICB9KSk7XG4gICAgICAgIHJldHVybiBvcHRpb25zLnVzZUZhY3RvcnkoLi4uZGVwZW5kZW5jaWVzKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIGluamVjdFByb3BlcnRpZXNBc3luYzxUPihpbnN0YW5jZTogVCk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBpZiAoIWhhc0NvbnN0cnVjdG9yKGluc3RhbmNlKSkgcmV0dXJuO1xuXG4gICAgICAgIGNvbnN0IGRlcGVuZGVuY2llcyA9IGdldFByb3BlcnR5RGVwZW5kZW5jaWVzTWV0YWRhdGEoaW5zdGFuY2UuY29uc3RydWN0b3IgYXMgQ2xhc3NDb25zdHJ1Y3Rvcik7XG5cbiAgICAgICAgZm9yIChjb25zdCBkZXAgb2YgZGVwZW5kZW5jaWVzKSB7XG4gICAgICAgICAgICBjb25zdCBwcm9wZXJ0eVZhbHVlID0gYXdhaXQgdGhpcy5yZXNvbHZlRGVwZW5kZW5jeShkZXAsIG5ldyBTZXQoKSwgdHJ1ZSlcblxuICAgICAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KGluc3RhbmNlLCBkZXAucHJvcGVydHlLZXksIHtcbiAgICAgICAgICAgICAgICB2YWx1ZTogcHJvcGVydHlWYWx1ZSxcbiAgICAgICAgICAgICAgICBlbnVtZXJhYmxlOiB0cnVlLFxuICAgICAgICAgICAgICAgIGNvbmZpZ3VyYWJsZTogdHJ1ZVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBsb2dDaGlsZENvbnRhaW5lcnMoKSB7XG4gICAgICAgIGZvciAoY29uc3QgY29udGFpbmVyIG9mIHRoaXMuY2hpbGRDb250YWluZXJzKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQ2hpbGQgQ29udGFpbmVyOiAke2NvbnRhaW5lci5jb250YWluZXJJZH1gKTtcbiAgICAgICAgICAgIGNvbnRhaW5lci5sb2dDaGlsZENvbnRhaW5lcnMoKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGxvZ1Byb3ZpZGVycyhhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzID0gdHJ1ZSkge1xuICAgICAgICBjb25zdCBpbnRlcm5hbFByb3ZpZGVycyA9IHRoaXMuY29sbGVjdEJlc3RQcm92aWRlcnNGb3I8YW55Pih7XG4gICAgICAgICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzLFxuICAgICAgICB9KTtcblxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgUGFyZW50IENvbnRhaW5lciBJZCwgW1BhcmVudDogJHt0aGlzLnBhcmVudD8uY29udGFpbmVySWR9XWApO1xuXG4gICAgICAgIGZvciAoY29uc3QgaXAgb2YgaW50ZXJuYWxQcm92aWRlcnMpIHtcbiAgICAgICAgICAgIGxldCBmaWx0ZXJlZCA9IHtcbiAgICAgICAgICAgICAgICAuLi5pcCxcbiAgICAgICAgICAgICAgICBfY29udGFpbmVyOiBpcC5fY29udGFpbmVyLmNvbnRhaW5lcklkLFxuICAgICAgICAgICAgICAgIF9wcm92aWRlcjoge1xuICAgICAgICAgICAgICAgICAgICAuLi5pcC5fcHJvdmlkZXIsXG4gICAgICAgICAgICAgICAgICAgIHVzZUNsYXNzOiAoaXAuX3Byb3ZpZGVyIGFzIGFueSk/LnVzZUNsYXNzPy5uYW1lLFxuICAgICAgICAgICAgICAgICAgICBwcm92aWRlOiAoaXAuX3Byb3ZpZGVyLnByb3ZpZGUgYXMgYW55KS5uYW1lID8gKGlwLl9wcm92aWRlci5wcm92aWRlIGFzIGFueSkubmFtZSA6IGlwLl9wcm92aWRlci5wcm92aWRlXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBQcm92aWRlcjogWyR7aXAuX2NvbnRhaW5lci5jb250YWluZXJJZH1dIC0gJHtpcC5fcHJvdmlkZXIuX3Rva2VufTpgKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGxvZ0NhY2hlKCkge1xuICAgICAgICBmb3IgKGNvbnN0IFsgdG9rZW4sIGluc3RhbmNlIF0gb2YgdGhpcy5jYWNoZS5lbnRyaWVzKCkpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDYWNoZTogWyR7dGhpcy5jb250YWluZXJJZH1dIC0gJHt0b2tlbn06YCwgaW5zdGFuY2UpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMucGFyZW50Py5sb2dDYWNoZSgpO1xuICAgIH1cblxuICAgIHB1YmxpYyBzZXRTZWFyY2hFbmdpbmUoZW5naW5lOiBCYXNlU2VhcmNoRW5naW5lKSB7XG4gICAgICAgIHRoaXMuc2VhcmNoRW5naW5lID0gZW5naW5lO1xuICAgIH1cblxuICAgIHB1YmxpYyByZXNvbHZlU2VhcmNoRW5naW5lKCk6IEJhc2VTZWFyY2hFbmdpbmUge1xuICAgICAgICBpZiAoIXRoaXMuc2VhcmNoRW5naW5lKSB7XG5cbiAgICAgICAgICAgIGlmICh0aGlzLnBhcmVudCkge1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLnBhcmVudC5yZXNvbHZlU2VhcmNoRW5naW5lKCk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignU2VhcmNoIGVuZ2luZSBub3QgY29uZmlndXJlZC4gUGxlYXNlIGNhbGwgc2V0U2VhcmNoRW5naW5lKCkgZmlyc3QuJyk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcy5zZWFyY2hFbmdpbmU7XG4gICAgfVxufVxuIl19