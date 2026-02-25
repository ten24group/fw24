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
    static get DIMetadataStore() {
        const globalKey = '__fw24_di_metadata_store__';
        if (!global[globalKey]) {
            global[globalKey] = new metadata_1.MetadataManager({ namespace: 'fw24:di' });
        }
        return global[globalKey];
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udGFpbmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2RpL2NvbnRhaW5lci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSwrQkFBMEM7QUFDMUMsZ0RBQW9EO0FBRXBELDhDQUEyRDtBQUMzRCw2Q0FBMEM7QUFtQjFDLHNDQU91QjtBQUV2QixtQ0FZaUI7QUFFakIseUNBS29CO0FBRXBCLG9DQUFxQztBQUVyQyxxQ0FXa0I7QUFJbEIsTUFBYSxXQUFXO0lBNEhBO0lBMUhwQixNQUFNLEtBQUssZUFBZTtRQUN0QixNQUFNLFNBQVMsR0FBRyw0QkFBNEIsQ0FBQztRQUMvQyxJQUFJLENBQUUsTUFBYyxDQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUM7WUFDN0IsTUFBYyxDQUFDLFNBQVMsQ0FBQyxHQUFHLElBQUksMEJBQWUsQ0FBQyxFQUFFLFNBQVMsRUFBRSxTQUFTLEVBQUUsQ0FBQyxDQUFDO1FBQy9FLENBQUM7UUFDRCxPQUFRLE1BQWMsQ0FBQyxTQUFTLENBQUMsQ0FBQztJQUN0QyxDQUFDO0lBRWUsV0FBVyxDQUFTO0lBQ25CLE1BQU0sQ0FBVTtJQUNoQixXQUFXLEdBQXdCLEVBQUUsQ0FBQztJQUN0QyxnQkFBZ0IsR0FBNkIsRUFBRSxDQUFDO0lBRXpELFVBQVUsR0FBRyxJQUFJLEdBQUcsRUFBZSxDQUFDO0lBQzVDLElBQWMsU0FBUztRQUVuQixJQUFJLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQztZQUNoQixPQUFPLElBQUksQ0FBQyxRQUFRLENBQUMsU0FBUyxDQUFDO1FBQ25DLENBQUM7UUFFRCxJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDO1lBQ25CLElBQUksQ0FBQyxVQUFVLEdBQUcsSUFBSSxHQUFHLEVBQWUsQ0FBQztRQUM3QyxDQUFDO1FBQ0QsT0FBTyxJQUFJLENBQUMsVUFBVSxDQUFDO0lBQzNCLENBQUM7SUFFTyxNQUFNLEdBQUcsSUFBSSxHQUFHLEVBQWUsQ0FBQztJ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Q0osS0FBSyxNQUFNLENBQUUsS0FBSyxFQUFFLFFBQVEsQ0FBRSxJQUFJLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxFQUFFLEVBQUUsQ0FBQztZQUNyRCxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxXQUFXLElBQUksQ0FBQyxXQUFXLE9BQU8sS0FBSyxHQUFHLEVBQUUsUUFBUSxDQUFDLENBQUM7UUFDNUUsQ0FBQztRQUNELElBQUksQ0FBQyxNQUFNLEVBQUUsUUFBUSxFQUFFLENBQUM7SUFDNUIsQ0FBQztJQUVNLGVBQWUsQ0FBQyxNQUF3QjtRQUMzQyxJQUFJLENBQUMsWUFBWSxHQUFHLE1BQU0sQ0FBQztJQUMvQixDQUFDO0lBRU0sbUJBQW1CO1FBQ3RCLElBQUksQ0FBQyxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUM7WUFFckIsSUFBSSxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUM7Z0JBQ2QsT0FBTyxJQUFJLENBQUMsTUFBTSxDQUFDLG1CQUFtQixFQUFFLENBQUM7WUFDN0MsQ0FBQztZQUVELE1BQU0sSUFBSSxLQUFLLENBQUMsb0VBQW9FLENBQUMsQ0FBQztRQUMxRixDQUFDO1FBRUQsT0FBTyxJQUFJLENBQUMsWUFBWSxDQUFDO0lBQzdCLENBQUM7Q0FDSjtBQS9vQ0Qsa0NBK29DQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IHY0IGFzIGdlbmVyYXRlVVVJRCB9IGZyb20gJ3V1aWQnO1xuaW1wb3J0IHsgTWV0YWRhdGFNYW5hZ2VyIH0gZnJvbSAnLi4vdXRpbHMvbWV0YWRhdGEnO1xuaW1wb3J0IHsgdHlwZSBEZWVwUGFydGlhbCwgdHlwZSBQYXJ0aWFsQnkgfSBmcm9tICcuLi91dGlscy90eXBlcyc7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIsIElMb2dnZXIgfSBmcm9tICcuLy4uL2xvZ2dpbmcvaW5kZXgnO1xuaW1wb3J0IHsgSW5qZWN0YWJsZSB9IGZyb20gJy4vZGVjb3JhdG9ycyc7XG5cbmltcG9ydCB7XG4gICAgQmFzZVByb3ZpZGVyT3B0aW9ucyxcbiAgICBDbGFzc0NvbnN0cnVjdG9yLFxuICAgIENsYXNzUHJvdmlkZXJPcHRpb25zLFxuICAgIENvbXBsZXhEZXBlbmRlbmN5SWRlbnRpZmllcixcbiAgICBDb25maWdQcm92aWRlck9wdGlvbnMsXG4gICAgRGVwSWRlbnRpZmllcixcbiAgICBGYWN0b3J5UHJvdmlkZXJPcHRpb25zLFxuICAgIElESUNvbnRhaW5lcixcbiAgICBJbnRlcm5hbFByb3ZpZGVyT3B0aW9ucyxcbiAgICBESU1pZGRsZXdhcmUsXG4gICAgRElNaWRkbGV3YXJlQXN5bmMsXG4gICAgUHJpb3JpdHlDcml0ZXJpYSxcbiAgICBQcm92aWRlck9wdGlvbnMsXG4gICAgVG9rZW5cbn0gZnJvbSAnLi8uLi9pbnRlcmZhY2VzL2RpJztcblxuaW1wb3J0IHtcbiAgICBpc0FsaWFzUHJvdmlkZXJPcHRpb25zLFxuICAgIGlzQ2xhc3NQcm92aWRlck9wdGlvbnMsXG4gICAgaXNDb21wbGV4RGVwZW5kZW5jeUlkZW50aWZpZXIsXG4gICAgaXNDb25maWdQcm92aWRlck9wdGlvbnMsXG4gICAgaXNGYWN0b3J5UHJvdmlkZXJPcHRpb25zLFxuICAgIGlzVmFsdWVQcm92aWRlck9wdGlvbnMsXG59IGZyb20gJy4vLi4vdXRpbHMvZGknO1xuXG5pbXBvcnQge1xuICAgIGFwcGx5TWlkZGxld2FyZXMsXG4gICAgYXBwbHlNaWRkbGV3YXJlc0FzeW5jLFxuICAgIGZpbHRlckFuZFNvcnRQcm92aWRlcnMsXG4gICAgZmxhdHRlbkNvbmZpZyxcbiAgICBnZXRQYXRoVmFsdWUsXG4gICAgaGFzQ29uc3RydWN0b3IsXG4gICAgbWFrZURJVG9rZW4sXG4gICAgbWF0Y2hlc1BhdHRlcm4sXG4gICAgc2V0UGF0aFZhbHVlLFxuICAgIHN0cmlwRElUb2tlbk5hbWVzcGFjZSxcbiAgICB2YWxpZGF0ZVByb3ZpZGVyT3B0aW9uc1xufSBmcm9tICcuL3V0aWxzJztcblxuaW1wb3J0IHtcbiAgICBnZXRDb25zdHJ1Y3RvckRlcGVuZGVuY2llc01ldGFkYXRhLFxuICAgIGdldE1vZHVsZU1ldGFkYXRhLFxuICAgIGdldE9uSW5pdEhvb2tNZXRhZGF0YSxcbiAgICBnZXRQcm9wZXJ0eURlcGVuZGVuY2llc01ldGFkYXRhLFxufSBmcm9tICcuL21ldGFkYXRhJztcblxuaW1wb3J0IHsgRElfVE9LRU5TIH0gZnJvbSAnLi4vY29uc3QnO1xuXG5pbXBvcnQge1xuICAgIENpcmN1bGFyRGVwZW5kZW5jeUVycm9yLFxuICAgIEluaXRpYWxpemF0aW9uTWV0aG9kRXJyb3IsXG4gICAgSW5pdGlhbGl6YXRpb25NZXRob2RUeXBlRXJyb3IsXG4gICAgSW52YWxpZERlcGVuZGVuY3lDcml0ZXJpYUVycm9yLFxuICAgIE1vZHVsZU1ldGFkYXRhRXJyb3IsXG4gICAgTm9FbnRpdHlTY2hlbWFQcm92aWRlckVycm9yLFxuICAgIE5vRW50aXR5U2VydmljZVByb3ZpZGVyRXJyb3IsXG4gICAgTm9Qcm92aWRlckZvdW5kRXJyb3IsXG4gICAgTm90aGluZ1RvRXhwb3J0RXJyb3IsXG4gICAgUHJvdmlkZXJDb25maWd1cmF0aW9uRXJyb3Jcbn0gZnJvbSAnLi9lcnJvcnMnO1xuaW1wb3J0IHsgQmFzZVNlYXJjaEVuZ2luZSB9IGZyb20gJy4uL3NlYXJjaCc7XG5cblxuZXhwb3J0IGNsYXNzIERJQ29udGFpbmVyIGltcGxlbWVudHMgSURJQ29udGFpbmVyIHtcblxuICAgIHN0YXRpYyBnZXQgRElNZXRhZGF0YVN0b3JlKCk6IE1ldGFkYXRhTWFuYWdlciB7XG4gICAgICAgIGNvbnN0IGdsb2JhbEtleSA9ICdfX2Z3MjRfZGlfbWV0YWRhdGFfc3RvcmVfXyc7XG4gICAgICAgIGlmICghKGdsb2JhbCBhcyBhbnkpW2dsb2JhbEtleV0pIHtcbiAgICAgICAgICAgIChnbG9iYWwgYXMgYW55KVtnbG9iYWxLZXldID0gbmV3IE1ldGFkYXRhTWFuYWdlcih7IG5hbWVzcGFjZTogJ2Z3MjQ6ZGknIH0pO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiAoZ2xvYmFsIGFzIGFueSlbZ2xvYmFsS2V5XTtcbiAgICB9XG5cbiAgICBwdWJsaWMgcmVhZG9ubHkgY29udGFpbmVySWQ6IHN0cmluZztcbiAgICBwcml2YXRlIHJlYWRvbmx5IGxvZ2dlcjogSUxvZ2dlcjtcbiAgICBwcml2YXRlIHJlYWRvbmx5IG1pZGRsZXdhcmVzOiBESU1pZGRsZXdhcmU8YW55PltdID0gW107XG4gICAgcHJpdmF0ZSByZWFkb25seSBhc3luY01pZGRsZXdhcmVzOiBESU1pZGRsZXdhcmVBc3luYzxhbnk+W10gPSBbXTtcblxuICAgIHByaXZhdGUgX3Jlc29sdmluZyA9IG5ldyBNYXA8c3RyaW5nLCBhbnk+KCk7XG4gICAgcHJvdGVjdGVkIGdldCByZXNvbHZpbmcoKTogTWFwPHN0cmluZywgYW55PiB7XG5cbiAgICAgICAgaWYgKHRoaXMucHJveHlGb3IpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnByb3h5Rm9yLnJlc29sdmluZztcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghdGhpcy5fcmVzb2x2aW5nKSB7XG4gICAgICAgICAgICB0aGlzLl9yZXNvbHZpbmcgPSBuZXcgTWFwPHN0cmluZywgYW55PigpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLl9yZXNvbHZpbmc7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBfY2FjaGUgPSBuZXcgTWFwPHN0cmluZywgYW55PigpO1xuICAgIHByb3RlY3RlZCBnZXQgY2FjaGUoKTogTWFwPHN0cmluZywgYW55PiB7XG5cbiAgICAgICAgaWYgKHRoaXMucHJveHlGb3IpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnByb3h5Rm9yLmNhY2hlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCF0aGlzLl9jYWNoZSkge1xuICAgICAgICAgICAgdGhpcy5fY2FjaGUgPSBuZXcgTWFwPHN0cmluZywgYW55PigpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLl9jYWNoZTtcbiAgICB9XG5cbiAgICBwcml2YXRlIF9wcm92aWRlcnM6IE1hcDxzdHJpbmcsIEludGVybmFsUHJvdmlkZXJPcHRpb25zW10+IHwgdW5kZWZpbmVkO1xuICAgIGdldCBwcm92aWRlcnMoKTogTWFwPHN0cmluZywgSW50ZXJuYWxQcm92aWRlck9wdGlvbnNbXT4ge1xuXG4gICAgICAgIGlmICh0aGlzLnByb3h5Rm9yKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5wcm94eUZvci5wcm92aWRlcnM7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIXRoaXMuX3Byb3ZpZGVycykge1xuICAgICAgICAgICAgdGhpcy5fcHJvdmlkZXJzID0gbmV3IE1hcDxzdHJpbmcsIEludGVybmFsUHJvdmlkZXJPcHRpb25zW10+KCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuX3Byb3ZpZGVyc1xuICAgIH1cblxuICAgIHByaXZhdGUgX2V4cG9ydHM6IE1hcDxzdHJpbmcsIEludGVybmFsUHJvdmlkZXJPcHRpb25zW10+IHwgdW5kZWZpbmVkO1xuICAgIGdldCBleHBvcnRzKCk6IE1hcDxzdHJpbmcsIEludGVybmFsUHJvdmlkZXJPcHRpb25zW10+IHtcblxuICAgICAgICBpZiAodGhpcy5wcm94eUZvcikge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMucHJveHlGb3IuZXhwb3J0cztcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghdGhpcy5fZXhwb3J0cykge1xuICAgICAgICAgICAgdGhpcy5fZXhwb3J0cyA9IG5ldyBNYXA8c3RyaW5nLCBJbnRlcm5hbFByb3ZpZGVyT3B0aW9uc1tdPigpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLl9leHBvcnRzXG4gICAgfVxuXG4gICAgLy8gd2hlbiB0aGlzIGNvbnRhaW5lciBpcyBhIHByb3h5IGZvciBhbm90aGVyIGNvbnRhaW5lcjsgdGhlIGFub3RoZXIgY29udGFpbmVyJ3MgcmVmIHdpbGwgYmUgc3RvcmVkIGhlcmVcbiAgICBwdWJsaWMgcHJveHlGb3I6IERJQ29udGFpbmVyIHwgdW5kZWZpbmVkO1xuXG4gICAgZ2V0IHBhcmVudCgpOiBESUNvbnRhaW5lciB8IHVuZGVmaW5lZCB7XG4gICAgICAgIHJldHVybiB0aGlzLnBhcmVudENvbnRhaW5lclxuICAgIH1cblxuICAgIHByaXZhdGUgX2NoaWxkQ29udGFpbmVyczogU2V0PERJQ29udGFpbmVyPiB8IHVuZGVmaW5lZDtcbiAgICBnZXQgY2hpbGRDb250YWluZXJzKCk6IFNldDxESUNvbnRhaW5lcj4ge1xuXG4gICAgICAgIGlmICh0aGlzLnByb3h5Rm9yKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5wcm94eUZvci5jaGlsZENvbnRhaW5lcnM7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIXRoaXMuX2NoaWxkQ29udGFpbmVycykge1xuICAgICAgICAgICAgdGhpcy5fY2hpbGRDb250YWluZXJzID0gbmV3IFNldDxESUNvbnRhaW5lcj4oKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5fY2hpbGRDb250YWluZXJzXG4gICAgfVxuXG4gICAgcHJpdmF0ZSBfcHJveGllczogU2V0PERJQ29udGFpbmVyPiB8IHVuZGVmaW5lZDtcbiAgICBnZXQgcHJveGllcygpOiBTZXQ8RElDb250YWluZXI+IHtcblxuICAgICAgICBpZiAodGhpcy5wcm94eUZvcikge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMucHJveHlGb3IucHJveGllcztcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghdGhpcy5fcHJveGllcykge1xuICAgICAgICAgICAgdGhpcy5fcHJveGllcyA9IG5ldyBTZXQ8RElDb250YWluZXI+KCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuX3Byb3hpZXNcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHbG9iYWwgUk9PVCBjb250YWluZXIgc2hhcmVkIGFjcm9zcyBBTEwgZncyNCBpbnN0YW5jZXMgKGJ1bmRsZWQgKyBsYXllcikuXG4gICAgICogU3RvcmVkIGluIGdsb2JhbCBvYmplY3QgdG8gZW5zdXJlIHNpbmdsZXRvbiBiZWhhdmlvciBldmVuIHdoZW4gbXVsdGlwbGVcbiAgICAgKiBmdzI0IG1vZHVsZSBncmFwaHMgZXhpc3QgKGUuZy4sIGJ1bmRsZWQgaW4gTGFtYmRhICsgbGF5ZXIpLlxuICAgICAqL1xuICAgIHByaXZhdGUgc3RhdGljIF9yb290SW5zdGFuY2U6IERJQ29udGFpbmVyO1xuICAgIHN0YXRpYyBnZXQgUk9PVCgpOiBJRElDb250YWluZXIge1xuICAgICAgICAvLyBDaGVjayBnbG9iYWwgZmlyc3QgZm9yIGNyb3NzLWluc3RhbmNlIHNoYXJpbmdcbiAgICAgICAgY29uc3QgZ2xvYmFsUm9vdCA9IChnbG9iYWwgYXMgYW55KS5fX2Z3MjRfZGlfcm9vdF9jb250YWluZXJfXztcbiAgICAgICAgaWYgKGdsb2JhbFJvb3QpIHtcbiAgICAgICAgICAgIHJldHVybiBnbG9iYWxSb290O1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ3JlYXRlIGlmIGRvZXNuJ3QgZXhpc3RcbiAgICAgICAgaWYgKCF0aGlzLl9yb290SW5zdGFuY2UpIHtcbiAgICAgICAgICAgIHRoaXMuX3Jvb3RJbnN0YW5jZSA9IG5ldyBESUNvbnRhaW5lcigpO1xuICAgICAgICAgICAgLy8gU3RvcmUgaW4gZ2xvYmFsIGZvciBjcm9zcy1pbnN0YW5jZSBhY2Nlc3NcbiAgICAgICAgICAgIChnbG9iYWwgYXMgYW55KS5fX2Z3MjRfZGlfcm9vdF9jb250YWluZXJfXyA9IHRoaXMuX3Jvb3RJbnN0YW5jZTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5fcm9vdEluc3RhbmNlO1xuICAgIH1cblxuICAgIHByaXZhdGUgc2VhcmNoRW5naW5lPzogQmFzZVNlYXJjaEVuZ2luZTtcblxuICAgIGNvbnN0cnVjdG9yKHByaXZhdGUgcGFyZW50Q29udGFpbmVyPzogRElDb250YWluZXIsIGlkZW50aWZpZXI6IHN0cmluZyA9ICdST09UJykge1xuICAgICAgICAvLyB0byBlbnN1cmUgZGVzdHJ1Y3R1cmluZyB3b3JrcyBjb3JyZWN0bHlcbiAgICAgICAgdGhpcy5JbmplY3RhYmxlID0gdGhpcy5JbmplY3RhYmxlLmJpbmQodGhpcyk7XG4gICAgICAgIHRoaXMuY29udGFpbmVySWQgPSBpZGVudGlmaWVyO1xuICAgICAgICB0aGlzLmxvZ2dlciA9IGNyZWF0ZUxvZ2dlcihgRElDb250YWluZXJbJHtpZGVudGlmaWVyfV1gKTtcbiAgICB9XG5cbiAgICBJbmplY3RhYmxlKG9wdGlvbnM6IFBhcnRpYWxCeTxCYXNlUHJvdmlkZXJPcHRpb25zLCAncHJvdmlkZSc+ID0ge30pIHtcbiAgICAgICAgcmV0dXJuIEluamVjdGFibGUoeyAuLi5vcHRpb25zLCBwcm92aWRlZEluOiB0aGlzIH0pO1xuICAgIH1cblxuICAgIGNyZWF0ZUNoaWxkQ29udGFpbmVyKGlkZW50aWZpZXI6IHN0cmluZyk6IERJQ29udGFpbmVyIHtcbiAgICAgICAgY29uc3QgY2hpbGQgPSBuZXcgRElDb250YWluZXIodGhpcywgaWRlbnRpZmllcik7XG4gICAgICAgIHRoaXMuY2hpbGRDb250YWluZXJzLmFkZChjaGlsZCk7XG4gICAgICAgIHJldHVybiBjaGlsZDtcbiAgICB9XG5cbiAgICBwcm90ZWN0ZWQgY3JlYXRlQ2hpbGRDb250YWluZXJQcm94eUlkZW50aWZpZXIocGFyZW50Q29udGFpbmVyOiBESUNvbnRhaW5lcik6IHN0cmluZyB7XG4gICAgICAgIHJldHVybiBgJHt0aGlzLmNvbnRhaW5lcklkfTpQcm94eUluWyR7cGFyZW50Q29udGFpbmVyLmNvbnRhaW5lcklkfV1gXG4gICAgfVxuXG4gICAgcHJvdGVjdGVkIGFkZFByb3h5Q29udGFpbmVySW4gPSAocGFyZW50Q29udGFpbmVyOiBESUNvbnRhaW5lcik6IERJQ29udGFpbmVyID0+IHtcblxuICAgICAgICBjb25zdCBwcm94eUNvbnRhaW5lcklkID0gdGhpcy5jcmVhdGVDaGlsZENvbnRhaW5lclByb3h5SWRlbnRpZmllcihwYXJlbnRDb250YWluZXIpO1xuXG4gICAgICAgIC8vIG1ha2Ugc3VyZSB0byByZW1vdmUgb2xkIHByb3h5IGZyb20gdGhlIGltcG9ydGluZyBtb2R1bGUgaWYgZXhpc3RzXG4gICAgICAgIGlmIChwYXJlbnRDb250YWluZXIuaGFzQ2hpbGRDb250YWluZXJCeUlkKHByb3h5Q29udGFpbmVySWQpKSB7XG5cbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBGb3VuZCBvbGQgcHJveHkgY29udGFpbmVyOiBbJHtwcm94eUNvbnRhaW5lcklkfV0gaW4gcGFyZW50OiBbJHtwYXJlbnRDb250YWluZXIuY29udGFpbmVySWR9XTsgcmVwbGFjaW5nIGl0YCk7XG5cbiAgICAgICAgICAgIGNvbnN0IG9sZFByb3h5Q29udGFpbmVyID0gcGFyZW50Q29udGFpbmVyLmdldENoaWxkQ29udGFpbmVyQnlJZChwcm94eUNvbnRhaW5lcklkKTtcblxuICAgICAgICAgICAgcGFyZW50Q29udGFpbmVyLnJlbW92ZUNoaWxkQ29udGFpbmVyQnlJZChwcm94eUNvbnRhaW5lcklkKTtcblxuICAgICAgICAgICAgdGhpcy5wcm94aWVzLmRlbGV0ZShvbGRQcm94eUNvbnRhaW5lcik7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBuZXdQcm94eUNvbnRhaW5lciA9IHBhcmVudENvbnRhaW5lci5jcmVhdGVDaGlsZENvbnRhaW5lcihwcm94eUNvbnRhaW5lcklkKTtcblxuICAgICAgICBuZXdQcm94eUNvbnRhaW5lci5wcm94eUZvciA9IHRoaXM7XG5cbiAgICAgICAgdGhpcy5wcm94aWVzLmFkZChuZXdQcm94eUNvbnRhaW5lcik7XG5cbiAgICAgICAgcmV0dXJuIG5ld1Byb3h5Q29udGFpbmVyO1xuICAgIH1cblxuICAgIGhhc0NoaWxkQ29udGFpbmVyQnlJZChpZGVudGlmaWVyOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICAgICAgbGV0IGZvdW5kID0gQXJyYXkuZnJvbSh0aGlzLmNoaWxkQ29udGFpbmVycykuc29tZShcbiAgICAgICAgICAgIGVsZW1lbnQgPT4gZWxlbWVudC5jb250YWluZXJJZC5zdGFydHNXaXRoKGlkZW50aWZpZXIpXG4gICAgICAgICk7XG5cbiAgICAgICAgaWYgKCFmb3VuZCAmJiB0aGlzLmNoaWxkQ29udGFpbmVycy5zaXplID4gMCkge1xuICAgICAgICAgICAgZm91bmQgPSBBcnJheS5mcm9tKHRoaXMuY2hpbGRDb250YWluZXJzKS5zb21lKGNjID0+IGNjLmhhc0NoaWxkQ29udGFpbmVyQnlJZChpZGVudGlmaWVyKSk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gZm91bmQ7XG4gICAgfVxuXG4gICAgcmVtb3ZlQ2hpbGRDb250YWluZXJCeUlkKGlkZW50aWZpZXI6IHN0cmluZyk6IHZvaWQge1xuICAgICAgICBjb25zdCBjaGlsZENvbnRhaW5lciA9IHRoaXMuZ2V0Q2hpbGRDb250YWluZXJCeUlkKGlkZW50aWZpZXIpO1xuICAgICAgICB0aGlzLmNoaWxkQ29udGFpbmVycy5kZWxldGUoY2hpbGRDb250YWluZXIpO1xuICAgIH1cblxuICAgIGdldENoaWxkQ29udGFpbmVyQnlJZChpZGVudGlmaWVyOiBzdHJpbmcpOiBhbnkge1xuICAgICAgICBsZXQgZm91bmRDb250YWluZXIgPSBBcnJheS5mcm9tKHRoaXMuY2hpbGRDb250YWluZXJzKS5maW5kKGVsZW1lbnQgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIGVsZW1lbnQuY29udGFpbmVySWQuc3RhcnRzV2l0aChpZGVudGlmaWVyKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKCFmb3VuZENvbnRhaW5lciAmJiB0aGlzLmNoaWxkQ29udGFpbmVycy5zaXplID4gMCkge1xuICAgICAgICAgICAgZm9yIChjb25zdCBjYyBvZiB0aGlzLmNoaWxkQ29udGFpbmVycykge1xuICAgICAgICAgICAgICAgIGZvdW5kQ29udGFpbmVyID0gY2MuZ2V0Q2hpbGRDb250YWluZXJCeUlkKGlkZW50aWZpZXIpO1xuICAgICAgICAgICAgICAgIGlmIChmb3VuZENvbnRhaW5lcikge1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gZm91bmRDb250YWluZXI7XG4gICAgfVxuXG4gICAgbW9kdWxlKHRhcmdldDogQ2xhc3NDb25zdHJ1Y3Rvcikge1xuXG4gICAgICAgIGNvbnN0IG1vZHVsZU1ldGEgPSBnZXRNb2R1bGVNZXRhZGF0YSh0YXJnZXQpO1xuXG4gICAgICAgIGlmICghbW9kdWxlTWV0YSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IE1vZHVsZU1ldGFkYXRhRXJyb3IodGFyZ2V0Lm5hbWUsIHRoaXMuY29udGFpbmVySWQpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgeyBpbXBvcnRzID0gW10sIGV4cG9ydHMgPSBbXSwgcHJvdmlkZXJzID0gW10sIGlkZW50aWZpZXIgfSA9IG1vZHVsZU1ldGE7XG5cbiAgICAgICAgLy8gaWYgdGhlcmUncyBubyBjb250YWluZXIgaW4gdGhlIG1vZHVsZSBtZXRhZGF0YSwgY3JlYXRlIHRoZSBtYWluIGNvbnRhaW5lciBmb3IgdGhlIG1vZHVsZVxuICAgICAgICBpZiAoIW1vZHVsZU1ldGEuaGFzQ29udGFpbmVyKCkpIHtcblxuICAgICAgICAgICAgY29uc3QgbW9kdWxlQ29udGFpbmVyID0gbmV3IERJQ29udGFpbmVyKHVuZGVmaW5lZCwgaWRlbnRpZmllcik7XG4gICAgICAgICAgICAvLyB0aGlzLmxvZ2dlci5pbmZvKGBNb2R1bGUgJHttb2R1bGVNZXRhLmlkZW50aWZpZXJ9IG1ldGFkYXRhIGRvZXMgbm90IGhhdmUgYSBjb250YWluZXIsIGFzc2lnbmluZyBvbmUuYCwgeyBpZDogbW9kdWxlQ29udGFpbmVyLmNvbnRhaW5lcklkIH0pO1xuXG4gICAgICAgICAgICBtb2R1bGVNZXRhLnNldENvbnRhaW5lcihtb2R1bGVDb250YWluZXIpO1xuXG4gICAgICAgICAgICAvLyBtYWtlIHN1cmUgYWxsIHRoZSBtb2R1bGUgcHJvdmlkZXJzIGFyZSBsb2FkZWQgaW50byB0aGUgbW9kdWxlJ3MgY29udGFpbmVyJ3MgcHJvdmlkZXJzXG4gICAgICAgICAgICBmb3IgKGNvbnN0IHByb3ZpZGVyIG9mIHByb3ZpZGVycykge1xuICAgICAgICAgICAgICAgIG1vZHVsZUNvbnRhaW5lci5yZWdpc3Rlcihwcm92aWRlcik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyBhbmQgbWFrZSBzdXJlIGFsbCB0aGUgbW9kdWxlIGV4cG9ydHMgYXJlIGFsc28gbG9hZGVkIGludG8gdGhlIG1vZHVsZSdzIGNvbnRhaW5lcidzIHByb3ZpZGVyc1xuICAgICAgICAgICAgZm9yIChjb25zdCBpbXBvcnRlZE1vZHVsZSBvZiBpbXBvcnRzKSB7XG4gICAgICAgICAgICAgICAgbW9kdWxlQ29udGFpbmVyLm1vZHVsZShpbXBvcnRlZE1vZHVsZSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIGxvYWQgYWxsIHRoZSBleHBvcnQgZnJvbSB0aGlzIG1vZHVsZSBpbnRvIHRoZSBjdXJyZW50IGNvbnRhaW5lclxuICAgICAgICAgICAgZm9yIChjb25zdCBleHBvcnRlZERlcCBvZiBleHBvcnRzKSB7XG4gICAgICAgICAgICAgICAgbW9kdWxlQ29udGFpbmVyLmV4cG9ydFByb3ZpZGVyc0ZvcihleHBvcnRlZERlcCk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIFRPRE86IG1vZHVsZSBsaWZlY3ljbGUgaG9va3NcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IG1vZHVsZVByb3h5Q29udGFpbmVyID0gKG1vZHVsZU1ldGEuY29udGFpbmVyIGFzIERJQ29udGFpbmVyKS5hZGRQcm94eUNvbnRhaW5lckluKHRoaXMpO1xuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBpZGVudGlmaWVyLFxuICAgICAgICAgICAgY29udGFpbmVyOiBtb2R1bGVQcm94eUNvbnRhaW5lclxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHVibGljIGV4cG9ydFByb3ZpZGVyc0ZvcjxUPihleHBvcnRlZERlcDogRGVwSWRlbnRpZmllcjxUPikge1xuICAgICAgICBjb25zdCB0b2tlbiA9IHRoaXMuY3JlYXRlVG9rZW4oZXhwb3J0ZWREZXApO1xuXG4gICAgICAgIGxldCBmb3VuZFByb3ZpZGVyc0ZvclRva2VuID0gZmFsc2U7XG5cbiAgICAgICAgLy8gQ29sbGVjdCBwcm92aWRlcnMgZGlyZWN0bHkgbWF0Y2hpbmcgdGhlIGV4cG9ydCB0b2tlblxuICAgICAgICBjb25zdCBhdmFpbGFibGVQcm92aWRlcnMgPSB0aGlzLnByb3ZpZGVycy5nZXQodG9rZW4pIHx8IFtdO1xuICAgICAgICBjb25zdCBjaGlsZEV4cG9ydGVkUHJvdmlkZXJzID0gQXJyYXkuZnJvbSh0aGlzLmNoaWxkQ29udGFpbmVycylcbiAgICAgICAgICAgIC5mbGF0TWFwKGNoaWxkID0+IGNoaWxkLmV4cG9ydHMuZ2V0KHRva2VuKSB8fCBbXSk7XG5cbiAgICAgICAgLy8gQ29tYmluZSBhdmFpbGFibGUgcHJvdmlkZXJzIGFuZCBjaGlsZCBleHBvcnRlZCBwcm92aWRlcnNcbiAgICAgICAgY29uc3QgYWxsUHJvdmlkZXJzID0gWyAuLi5hdmFpbGFibGVQcm92aWRlcnMsIC4uLmNoaWxkRXhwb3J0ZWRQcm92aWRlcnMgXTtcblxuICAgICAgICAvLyBOZXN0ZWQgZnVuY3Rpb24gdG8gbWFwIGFuZCBleHBvcnQgcHJvdmlkZXJzXG4gICAgICAgIGNvbnN0IG1hcEFuZEV4cG9ydFByb3ZpZGVycyA9IChwcm92aWRlcnM6IEludGVybmFsUHJvdmlkZXJPcHRpb25zW10sIHRhcmdldFRva2VuOiBzdHJpbmcpID0+IHtcblxuICAgICAgICAgICAgZm91bmRQcm92aWRlcnNGb3JUb2tlbiA9IHRydWU7XG5cbiAgICAgICAgICAgIGNvbnN0IGV4cG9ydGVkID0gcHJvdmlkZXJzLm1hcChwcm92aWRlciA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgeyBfY29udGFpbmVyLCBfcHJvdmlkZXIsIF9pZCB9ID0gcHJvdmlkZXI7XG4gICAgICAgICAgICAgICAgY29uc3QgeyBjb25kaXRpb24sIHByb3ZpZGUsIHByaW9yaXR5LCBvdmVycmlkZSwgc2luZ2xldG9uLCB0YWdzLCB0eXBlLCBmb3JFbnRpdHkgfSA9IF9wcm92aWRlcjtcblxuICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgIF9wcm92aWRlcjoge1xuICAgICAgICAgICAgICAgICAgICAgICAgdXNlRmFjdG9yeTogKCkgPT4gX2NvbnRhaW5lci5yZXNvbHZlKHByb3ZpZGUpLFxuICAgICAgICAgICAgICAgICAgICAgICAgY29uZGl0aW9uLFxuICAgICAgICAgICAgICAgICAgICAgICAgcHJvdmlkZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHByaW9yaXR5LFxuICAgICAgICAgICAgICAgICAgICAgICAgb3ZlcnJpZGUsXG4gICAgICAgICAgICAgICAgICAgICAgICBzaW5nbGV0b24sXG4gICAgICAgICAgICAgICAgICAgICAgICB0YWdzLFxuICAgICAgICAgICAgICAgICAgICAgICAgdHlwZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvckVudGl0eSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgX2lkLFxuICAgICAgICAgICAgICAgICAgICBfY29udGFpbmVyOiB0aGlzXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAvLyBNZXJnZSBvciBzZXQgdGhlc2UgZXhwb3J0ZWQgcHJvdmlkZXJzIHVuZGVyIHRoZWlyIHJlc3BlY3RpdmUga2V5c1xuICAgICAgICAgICAgY29uc3QgZXhpc3RpbmdFeHBvcnRzID0gdGhpcy5leHBvcnRzLmdldCh0YXJnZXRUb2tlbikgfHwgW107XG4gICAgICAgICAgICB0aGlzLmV4cG9ydHMuc2V0KHRhcmdldFRva2VuLCBbIC4uLmV4aXN0aW5nRXhwb3J0cywgLi4uZXhwb3J0ZWQgXSk7XG4gICAgICAgIH07XG5cbiAgICAgICAgaWYgKGFsbFByb3ZpZGVycy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAvLyBFeHBvcnQgdGhlIHN0YW5kYXJkIGFuZCBjb25maWcgcHJvdmlkZXJzIGRpcmVjdGx5IG1hdGNoaW5nIHRoZSB0b2tlblxuICAgICAgICAgICAgbWFwQW5kRXhwb3J0UHJvdmlkZXJzKGFsbFByb3ZpZGVycywgdG9rZW4pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRmluZCBhbGwgY29uZmlnIHByb3ZpZGVycyB3aG9zZSBrZXlzIHN0YXJ0IHdpdGggdGhlIHRva2VuIGFuZCBleHBvcnQgdGhlbVxuICAgICAgICBmb3IgKGNvbnN0IFsgY29uZmlnS2V5LCBjb25maWdQcm92aWRlcnMgXSBvZiB0aGlzLnByb3ZpZGVycy5lbnRyaWVzKCkpIHtcbiAgICAgICAgICAgIGlmIChjb25maWdLZXkuc3RhcnRzV2l0aCh0b2tlbikgJiYgY29uZmlnUHJvdmlkZXJzLnNvbWUocCA9PiBwLl9wcm92aWRlci50eXBlID09PSAnY29uZmlnJykpIHtcbiAgICAgICAgICAgICAgICBtYXBBbmRFeHBvcnRQcm92aWRlcnMoY29uZmlnUHJvdmlkZXJzLCBjb25maWdLZXkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFmb3VuZFByb3ZpZGVyc0ZvclRva2VuKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgTm90aGluZ1RvRXhwb3J0RXJyb3IodG9rZW4sIHRoaXMuY29udGFpbmVySWQpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgY3JlYXRlVG9rZW48VD4odG9rZW5PclR5cGU6IERlcElkZW50aWZpZXI8VD4pOiBUb2tlbiB7XG4gICAgICAgIC8vIG1heWJlIGFkZCBhIG1lY2hhbmlzbSBmb3IgYWRkaW5nIGV4dHJhIG1ldGFkYXRhIHRvIHRoZSB0b2tlbiBsaWtlIGNvbnRhaW5lciBJRCBhbmQgc3R1ZmY/XG4gICAgICAgIHJldHVybiBtYWtlRElUb2tlbih0b2tlbk9yVHlwZSk7XG4gICAgfVxuXG4gICAgcmVnaXN0ZXI8VD4ob3B0aW9uczogUHJvdmlkZXJPcHRpb25zPFQ+LCBjb250YWluZXI6IERJQ29udGFpbmVyID0gdGhpcyk6IHsgcHJvdmlkZTogVG9rZW4sIG9wdGlvbnM6IFByb3ZpZGVyT3B0aW9uczxUPiB9IHwgdW5kZWZpbmVkIHtcbiAgICAgICAgaWYgKGNvbnRhaW5lciAhPT0gdGhpcykge1xuICAgICAgICAgICAgcmV0dXJuIGNvbnRhaW5lci5yZWdpc3RlcihvcHRpb25zKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHRva2VuID0gdGhpcy5jcmVhdGVUb2tlbihvcHRpb25zLnByb3ZpZGUpO1xuXG4gICAgICAgIGNvbnN0IG9wdGlvbnNDb3B5ID0ge1xuICAgICAgICAgICAgLi4ub3B0aW9ucyxcbiAgICAgICAgICAgIHR5cGU6IG9wdGlvbnMudHlwZSB8fCAndW5rbm93bicsXG4gICAgICAgICAgICBwcmlvcml0eTogb3B0aW9ucy5wcmlvcml0eSAhPT0gdW5kZWZpbmVkID8gb3B0aW9ucy5wcmlvcml0eSA6IDAsXG4gICAgICAgICAgICBzaW5nbGV0b246IG9wdGlvbnMuc2luZ2xldG9uICE9PSB1bmRlZmluZWQgPyBvcHRpb25zLnNpbmdsZXRvbiA6IHRydWUsXG4gICAgICAgIH07XG5cbiAgICAgICAgaWYgKG9wdGlvbnNDb3B5LmNvbmRpdGlvbiAmJiAhb3B0aW9uc0NvcHkuY29uZGl0aW9uKCkpIHJldHVybjtcblxuICAgICAgICB2YWxpZGF0ZVByb3ZpZGVyT3B0aW9ucyhvcHRpb25zQ29weSwgdG9rZW4pO1xuXG4gICAgICAgIC8vIEhhbmRsZSBjb25maWcgcHJvdmlkZXJzXG4gICAgICAgIGlmIChpc0NvbmZpZ1Byb3ZpZGVyT3B0aW9ucyhvcHRpb25zKSkge1xuICAgICAgICAgICAgdGhpcy5yZWdpc3RlckNvbmZpZ1Byb3ZpZGVyKG9wdGlvbnMpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5yZWdpc3RlclByb3ZpZGVyKHsgX3Byb3ZpZGVyOiBvcHRpb25zQ29weSB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBwcm92aWRlOiB0b2tlbixcbiAgICAgICAgICAgIG9wdGlvbnM6IG9wdGlvbnNDb3B5LFxuICAgICAgICB9O1xuICAgIH1cblxuICAgIHJlZ2lzdGVyQ29uZmlnUHJvdmlkZXIob3B0aW9uczogQ29uZmlnUHJvdmlkZXJPcHRpb25zKSB7XG4gICAgICAgIGNvbnN0IHsgdXNlQ29uZmlnLCBwcm92aWRlOiBwcm92aWRlLCAuLi5yZXN0IH0gPSBvcHRpb25zO1xuXG4gICAgICAgIGxldCBwcm92aWRlVG9rZW4gPSBzdHJpcERJVG9rZW5OYW1lc3BhY2UodGhpcy5jcmVhdGVUb2tlbihwcm92aWRlKSk7XG4gICAgICAgIGNvbnN0IGZsYXR0ZW5lZEVudHJpZXMgPSBmbGF0dGVuQ29uZmlnKHVzZUNvbmZpZywgcHJvdmlkZVRva2VuKTtcblxuICAgICAgICBmb3IgKGNvbnN0IFsgY29uZmlnUGF0aCwgdmFsdWUgXSBvZiBmbGF0dGVuZWRFbnRyaWVzKSB7XG4gICAgICAgICAgICB0aGlzLnJlZ2lzdGVyUHJvdmlkZXIoe1xuICAgICAgICAgICAgICAgIF9wcm92aWRlcjoge1xuICAgICAgICAgICAgICAgICAgICAuLi5yZXN0LFxuICAgICAgICAgICAgICAgICAgICB0eXBlOiAnY29uZmlnJyxcbiAgICAgICAgICAgICAgICAgICAgcHJvdmlkZTogY29uZmlnUGF0aCxcbiAgICAgICAgICAgICAgICAgICAgdXNlQ29uZmlnOiB2YWx1ZSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcm90ZWN0ZWQgcmVnaXN0ZXJQcm92aWRlcihvcHRpb25zOiBQYXJ0aWFsQnk8SW50ZXJuYWxQcm92aWRlck9wdGlvbnMsICdfaWQnIHwgJ19jb250YWluZXInPikge1xuICAgICAgICBjb25zdCBjdXJyZW50UHJvdmlkZXIgPSBvcHRpb25zLl9wcm92aWRlcjtcbiAgICAgICAgY29uc3QgdG9rZW4gPSB0aGlzLmNyZWF0ZVRva2VuKGN1cnJlbnRQcm92aWRlci5wcm92aWRlKTtcbiAgICAgICAgY3VycmVudFByb3ZpZGVyLl90b2tlbiA9IHRva2VuO1xuXG4gICAgICAgIGNvbnN0IHRva2VuUHJvdmlkZXJzID0gdGhpcy5wcm92aWRlcnMuZ2V0KHRva2VuKSB8fCBbXTtcblxuICAgICAgICBjb25zdCBhcmVCb3RoVmFsdWVzRXF1YWwgPSA8VD4odmFsdWUxOiBUIHwgbnVsbCB8IHVuZGVmaW5lZCwgdmFsdWUyOiBUIHwgbnVsbCB8IHVuZGVmaW5lZCk6IGJvb2xlYW4gPT4ge1xuICAgICAgICAgICAgcmV0dXJuICh2YWx1ZTEgPT0gbnVsbCAmJiB2YWx1ZTIgPT0gbnVsbCkgfHwgKHZhbHVlMSAhPT0gbnVsbCAmJiB2YWx1ZTEgIT09IHVuZGVmaW5lZCAmJiB2YWx1ZTEgPT09IHZhbHVlMik7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBhcmVCb3RoQXJyYXlzRXF1YWwgPSA8VD4oYXJyMTogVFtdIHwgbnVsbCB8IHVuZGVmaW5lZCwgYXJyMjogVFtdIHwgbnVsbCB8IHVuZGVmaW5lZCk6IGJvb2xlYW4gPT4ge1xuICAgICAgICAgICAgaWYgKGFycjEgPT0gbnVsbCAmJiBhcnIyID09IG51bGwpIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgaWYgKGFycjEgPT0gbnVsbCB8fCBhcnIyID09IG51bGwgfHwgYXJyMS5sZW5ndGggIT09IGFycjIubGVuZ3RoKSByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICByZXR1cm4gWyAuLi5hcnIxIF0uc29ydCgpLmV2ZXJ5KCh2YWx1ZSwgaW5kZXgpID0+IHZhbHVlID09PSBhcnIyLnNsaWNlKCkuc29ydCgpWyBpbmRleCBdKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGlmIHRva2VuIHByb3ZpZGVycyBhbHJlYWR5IGhhcyBhIHByb3ZpZGVyIHdpdGggc2FtZSBwcmlvcml0eSwgdHlwZSwgZm9yRW50aXR5IGFuZCB0YWdzLCBsb2cgd2FybmluZyBhbmQgcmVwbGFjZSBpdFxuICAgICAgICBjb25zdCBleGlzdGluZ1Byb3ZpZGVyID0gdG9rZW5Qcm92aWRlcnMuZmluZCgoeyBfcHJvdmlkZXI6IGV4aXN0aW5nUHJvdmlkZXIgfSkgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIGV4aXN0aW5nUHJvdmlkZXIucHJpb3JpdHkgPT09IGN1cnJlbnRQcm92aWRlci5wcmlvcml0eVxuICAgICAgICAgICAgICAgICYmIGFyZUJvdGhWYWx1ZXNFcXVhbChleGlzdGluZ1Byb3ZpZGVyLnR5cGUsIGN1cnJlbnRQcm92aWRlci50eXBlKVxuICAgICAgICAgICAgICAgICYmIGFyZUJvdGhBcnJheXNFcXVhbChleGlzdGluZ1Byb3ZpZGVyLnRhZ3MsIGN1cnJlbnRQcm92aWRlci50YWdzKSAvLyAhIG1heWJlIGJlIG1ha2UgaXQgY29uZmlndXJhYmxlIHRvIGNvbXBhcmUgdGFncy4uLlxuICAgICAgICAgICAgICAgICYmIGFyZUJvdGhWYWx1ZXNFcXVhbChleGlzdGluZ1Byb3ZpZGVyLmZvckVudGl0eSwgY3VycmVudFByb3ZpZGVyLmZvckVudGl0eSlcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKGV4aXN0aW5nUHJvdmlkZXIpIHtcbiAgICAgICAgICAgIC8vIGNvbnN0IGluZGV4ID0gdG9rZW5Qcm92aWRlcnMuaW5kZXhPZihleGlzdGluZ1Byb3ZpZGVyKTtcbiAgICAgICAgICAgIC8vIGRlbGV0ZSB0aGUgZXhpc3RpbmcgcHJvdmlkZXJcbiAgICAgICAgICAgIC8vIHRva2VuUHJvdmlkZXJzLnNwbGljZShpbmRleCwgMSk7XG5cbiAgICAgICAgICAgIC8vIERPIE5PVCByZXBsYWNlIHRoZSBleGlzdGluZyBwcm92aWRlciwganVzdCBsb2cgYSB3YXJuaW5nXG4gICAgICAgICAgICAvLyB0aGlzLmxvZ2dlci53YXJuKGBQcm92aWRlciBmb3IgJHt0b2tlbn0gd2l0aCBzYW1lIHByaW9yaXR5LCB0eXBlLCBmb3JFbnRpdHkgYW5kIHRhZ3MgYWxyZWFkeSBleGlzdHMsIHJlcGxhY2luZyBpdC4gfCBPcHRpb25zWyR7SlNPTi5zdHJpbmdpZnkob3B0aW9ucyl9XWApO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgaW50ZXJuYWxQcm92aWRlck9wdGlvbnMgPSB7XG4gICAgICAgICAgICAuLi5vcHRpb25zLFxuICAgICAgICAgICAgX2lkOiBnZW5lcmF0ZVVVSUQoKSxcbiAgICAgICAgICAgIF9jb250YWluZXI6IHRoaXMsXG4gICAgICAgIH07XG5cbiAgICAgICAgdG9rZW5Qcm92aWRlcnMucHVzaChpbnRlcm5hbFByb3ZpZGVyT3B0aW9ucyk7XG4gICAgICAgIHRoaXMucHJvdmlkZXJzLnNldCh0b2tlbiwgdG9rZW5Qcm92aWRlcnMpO1xuICAgIH1cblxuICAgIHJlbW92ZVByb3ZpZGVyc0ZvcihkZXBlbmRlbmN5VG9rZW46IERlcElkZW50aWZpZXIpIHtcbiAgICAgICAgY29uc3QgdG9rZW4gPSB0aGlzLmNyZWF0ZVRva2VuKGRlcGVuZGVuY3lUb2tlbik7XG4gICAgICAgIGNvbnN0IHByb3ZpZGVycyA9IHRoaXMucHJvdmlkZXJzLmdldCh0b2tlbikgfHwgW107XG4gICAgICAgIHByb3ZpZGVycy5mb3JFYWNoKHByb3ZpZGVyID0+IHtcbiAgICAgICAgICAgIHRoaXMuY2FjaGUuZGVsZXRlKHByb3ZpZGVyLl9pZCEpO1xuICAgICAgICB9KTtcbiAgICAgICAgdGhpcy5wcm92aWRlcnMuZGVsZXRlKHRva2VuKTtcbiAgICB9XG5cbiAgICAvLyBSZXNvbHZlIGEgY29uZmlndXJhdGlvbiBwYXRoIHdpdGggZmxleGlibGUgY3JpdGVyaWEsIHN1cHBvcnRpbmcgd2lsZGNhcmRzIGFuZCByZWdleFxuICAgIHJlc29sdmVDb25maWc8VCA9IGFueT4oXG4gICAgICAgIHF1ZXJ5OiBzdHJpbmcgPSAnJyxcbiAgICAgICAgY3JpdGVyaWE/OiB7XG4gICAgICAgICAgICBwcmlvcml0eT86IFByaW9yaXR5Q3JpdGVyaWE7XG4gICAgICAgICAgICB0YWdzPzogc3RyaW5nW107XG4gICAgICAgIH1cbiAgICApOiBEZWVwUGFydGlhbDxUPiB7XG5cbiAgICAgICAgcXVlcnkgPSBzdHJpcERJVG9rZW5OYW1lc3BhY2UocXVlcnkpO1xuXG4gICAgICAgIGNvbnN0IG1hdGNoaW5nUGF0aHMgPSB0aGlzLmNvbGxlY3RNYXRjaGluZ0NvbmZpZ1BhdGhzKHF1ZXJ5KTtcblxuICAgICAgICBjb25zdCByZXNvbHZlZFZhbHVlcyA9IHRoaXMucmVzb2x2ZUNvbmZpZ1BhdGhzKG1hdGNoaW5nUGF0aHMsIGNyaXRlcmlhKTtcblxuICAgICAgICAvLyBNZXJnZSByZXNvbHZlZCB2YWx1ZXMgaW50byBhIGZpbmFsIGNvbmZpZ3VyYXRpb24gb2JqZWN0XG4gICAgICAgIGNvbnN0IG1lcmdlZENvbmZpZzogUmVjb3JkPGFueSwgYW55PiA9IHt9O1xuXG4gICAgICAgIHJlc29sdmVkVmFsdWVzLmZvckVhY2goKHZhbHVlLCBwYXRoKSA9PiB7XG4gICAgICAgICAgICBwYXRoID0gc3RyaXBESVRva2VuTmFtZXNwYWNlKHBhdGgpO1xuICAgICAgICAgICAgc2V0UGF0aFZhbHVlKG1lcmdlZENvbmZpZywgcGF0aCwgdmFsdWUpO1xuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gZ2V0UGF0aFZhbHVlKG1lcmdlZENvbmZpZywgcXVlcnkpIGFzIERlZXBQYXJ0aWFsPFQ+O1xuICAgIH1cblxuICAgIC8vIENvbGxlY3QgYWxsIHBhdGhzIHRoYXQgbWF0Y2ggdGhlIHF1ZXJ5LCBzdXBwb3J0aW5nIHdpbGRjYXJkcyBhbmQgcmVnZXhcbiAgICBwcml2YXRlIGNvbGxlY3RNYXRjaGluZ0NvbmZpZ1BhdGhzKHF1ZXJ5OiBzdHJpbmcpOiBTZXQ8c3RyaW5nPiB7XG4gICAgICAgIGNvbnN0IG1hdGNoaW5nUGF0aHM6IFNldDxzdHJpbmc+ID0gbmV3IFNldCgpO1xuXG4gICAgICAgIGNvbnN0IHByb2Nlc3NLZXlzID0gKGtleXM6IEl0ZXJhYmxlSXRlcmF0b3I8c3RyaW5nPikgPT4ge1xuICAgICAgICAgICAgZm9yIChjb25zdCBwYXRoIG9mIGtleXMpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBhY3R1YWxQYXRoID0gc3RyaXBESVRva2VuTmFtZXNwYWNlKHBhdGgpO1xuICAgICAgICAgICAgICAgIGlmIChtYXRjaGVzUGF0dGVybihhY3R1YWxQYXRoLCBxdWVyeSkpIHtcbiAgICAgICAgICAgICAgICAgICAgbWF0Y2hpbmdQYXRocy5hZGQocGF0aCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuXG4gICAgICAgIGxldCBjdXJyZW50OiBESUNvbnRhaW5lciB8IHVuZGVmaW5lZCA9IHRoaXM7XG5cbiAgICAgICAgd2hpbGUgKGN1cnJlbnQpIHtcbiAgICAgICAgICAgIC8vIENoZWNrIHRoZSBwcm92aWRlcnMgaW4gdGhlIGN1cnJlbnQgY29udGFpbmVyXG4gICAgICAgICAgICBwcm9jZXNzS2V5cyhjdXJyZW50LnByb3ZpZGVycy5rZXlzKCkpO1xuXG4gICAgICAgICAgICAvLyBDaGVjayB0aGUgZXhwb3J0ZWQgcHJvdmlkZXJzIGZyb20gY2hpbGQgY29udGFpbmVyc1xuICAgICAgICAgICAgY3VycmVudC5jaGlsZENvbnRhaW5lcnMuZm9yRWFjaChjaGlsZCA9PiB7XG4gICAgICAgICAgICAgICAgcHJvY2Vzc0tleXMoY2hpbGQuZXhwb3J0cy5rZXlzKCkpO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIC8vIE1vdmUgdG8gdGhlIHBhcmVudCBjb250YWluZXJcbiAgICAgICAgICAgIGN1cnJlbnQgPSBjdXJyZW50LnBhcmVudDtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBtYXRjaGluZ1BhdGhzO1xuICAgIH1cblxuICAgIC8vIFJlc29sdmUgdmFsdWVzIGZvciBhbGwgbWF0Y2hpbmcgcGF0aHMgdXNpbmcgdGhlIGJlc3QgcHJvdmlkZXIgZnJvbSB0aGUgaGllcmFyY2h5IGJhc2VkIG9uIGNyaXRlcmlhXG4gICAgcHJpdmF0ZSByZXNvbHZlQ29uZmlnUGF0aHMoXG4gICAgICAgIHBhdGhzOiBTZXQ8c3RyaW5nPixcbiAgICAgICAgY3JpdGVyaWE/OiB7XG4gICAgICAgICAgICBwcmlvcml0eT86IFByaW9yaXR5Q3JpdGVyaWE7XG4gICAgICAgICAgICB0YWdzPzogc3RyaW5nW107XG4gICAgICAgICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzPzogYm9vbGVhblxuICAgICAgICB9XG4gICAgKTogTWFwPHN0cmluZywgYW55PiB7XG5cbiAgICAgICAgY29uc3QgcmVzb2x2ZWRWYWx1ZXMgPSBuZXcgTWFwPHN0cmluZywgYW55PigpO1xuXG4gICAgICAgIGNvbnN0IHJlZHVjZVByb3ZpZGVycyA9IChwcm92aWRlcnM6IEludGVybmFsUHJvdmlkZXJPcHRpb25zW10pOiBhbnkgPT4ge1xuICAgICAgICAgICAgaWYgKHByb3ZpZGVycy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBBc3N1bWUgdGhlIGhpZ2hlc3QtcHJpb3JpdHkgcHJvdmlkZXIncyB2YWx1ZSBpcyB0aGUgZGVzaXJlZCBvbmVcbiAgICAgICAgICAgIGNvbnN0IGJlc3RQcm92aWRlciA9IHByb3ZpZGVyc1sgMCBdLl9wcm92aWRlciBhcyBDb25maWdQcm92aWRlck9wdGlvbnM8YW55PjtcbiAgICAgICAgICAgIHJldHVybiBiZXN0UHJvdmlkZXIudXNlQ29uZmlnXG4gICAgICAgIH1cblxuICAgICAgICBwYXRocy5mb3JFYWNoKChwYXRoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBiZXN0UHJvdmlkZXJzID0gdGhpcy5jb2xsZWN0QmVzdFByb3ZpZGVyc0ZvcjxDb25maWdQcm92aWRlck9wdGlvbnM+KHtcbiAgICAgICAgICAgICAgICAuLi5jcml0ZXJpYSxcbiAgICAgICAgICAgICAgICB0b2tlbjogcGF0aCxcbiAgICAgICAgICAgICAgICB0eXBlOiAnY29uZmlnJ1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnN0IHJlc29sdmVkVmFsdWUgPSByZWR1Y2VQcm92aWRlcnMoYmVzdFByb3ZpZGVycyk7XG5cbiAgICAgICAgICAgIHJlc29sdmVkVmFsdWVzLnNldChwYXRoLCByZXNvbHZlZFZhbHVlKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIHJlc29sdmVkVmFsdWVzO1xuICAgIH1cblxuICAgIC8vIENvbGxlY3QgYWxsIHByb3ZpZGVycyBmb3IgYSBnaXZlbiBwYXRoIGFjcm9zcyB0aGUgaGllcmFyY2h5XG4gICAgcHVibGljIGNvbGxlY3RCZXN0UHJvdmlkZXJzRm9yPFQ+KFxuICAgICAgICBjcml0ZXJpYToge1xuICAgICAgICAgICAgdG9rZW4/OiBzdHJpbmcsXG4gICAgICAgICAgICB0YWdzPzogc3RyaW5nW10sXG4gICAgICAgICAgICB0eXBlPzogUHJvdmlkZXJPcHRpb25zWyAndHlwZScgXSxcbiAgICAgICAgICAgIHByaW9yaXR5PzogUHJpb3JpdHlDcml0ZXJpYSxcbiAgICAgICAgICAgIGZvckVudGl0eT86IFByb3ZpZGVyT3B0aW9uc1sgJ2ZvckVudGl0eScgXSxcbiAgICAgICAgICAgIGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnM/OiBib29sZWFuXG4gICAgICAgIH1cbiAgICApOiBJbnRlcm5hbFByb3ZpZGVyT3B0aW9uczxUPltdIHtcbiAgICAgICAgY29uc3QgYmVzdFByb3ZpZGVycyA9IG5ldyBNYXA8c3RyaW5nLCBJbnRlcm5hbFByb3ZpZGVyT3B0aW9uczxUPj4oKTtcblxuICAgICAgICBsZXQgY3VycmVudDogRElDb250YWluZXIgfCB1bmRlZmluZWQgPSB0aGlzO1xuICAgICAgICBsZXQgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVycyA9IGNyaXRlcmlhLmFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnMgfHwgZmFsc2U7XG5cbiAgICAgICAgY29uc3QgdmlzaXRlZENvbnRhaW5lcnMgPSBuZXcgU2V0PERJQ29udGFpbmVyPigpO1xuXG4gICAgICAgIGNvbnN0IGNyaXRlcmlhU3RyaW5nID0gSlNPTi5zdHJpbmdpZnkoY3JpdGVyaWEpO1xuXG4gICAgICAgIHdoaWxlIChjdXJyZW50KSB7XG4gICAgICAgICAgICBpZiAodmlzaXRlZENvbnRhaW5lcnMuaGFzKGN1cnJlbnQpKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDaXJjdWxhciByZWZlcmVuY2UgZGV0ZWN0ZWQgaW4gY29udGFpbmVyIGhpZXJhcmNoeS4gRElDb250YWluZXJbJHt0aGlzLmNvbnRhaW5lcklkfV0gfCBDcml0ZXJpYTogWyR7Y3JpdGVyaWFTdHJpbmd9XWApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdmlzaXRlZENvbnRhaW5lcnMuYWRkKGN1cnJlbnQpO1xuXG4gICAgICAgICAgICBsZXQgcGF0aFByb3ZpZGVycyA9IGNyaXRlcmlhLnRva2VuXG4gICAgICAgICAgICAgICAgPyBjdXJyZW50LnByb3ZpZGVycy5nZXQoY3JpdGVyaWEudG9rZW4pIHx8IFtdXG4gICAgICAgICAgICAgICAgOiBBcnJheS5mcm9tKGN1cnJlbnQucHJvdmlkZXJzLnZhbHVlcygpKS5mbGF0KCk7XG5cbiAgICAgICAgICAgIGlmIChjcml0ZXJpYT8udHlwZSkge1xuICAgICAgICAgICAgICAgIHBhdGhQcm92aWRlcnMgPSBwYXRoUHJvdmlkZXJzLmZpbHRlcihwID0+IHAuX3Byb3ZpZGVyLnR5cGUgPT09IGNyaXRlcmlhLnR5cGUpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoY3JpdGVyaWE/LmZvckVudGl0eSkge1xuICAgICAgICAgICAgICAgIHBhdGhQcm92aWRlcnMgPSBwYXRoUHJvdmlkZXJzLmZpbHRlcihwID0+IHAuX3Byb3ZpZGVyLmZvckVudGl0eSA9PT0gY3JpdGVyaWEuZm9yRW50aXR5KVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBwYXRoUHJvdmlkZXJzLmZvckVhY2gocHJvdmlkZXIgPT4ge1xuXG4gICAgICAgICAgICAgICAgaWYgKGJlc3RQcm92aWRlcnMuaGFzKHByb3ZpZGVyLl9pZCkpIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gdGhpcy5sb2dnZXIuaW5mbyhgUHJvdmlkZXIgd2l0aCBpZCAke3Byb3ZpZGVyLl9pZH0gYWxyZWFkeSBleGlzdHMgaW4gYmVzdC1wcm92aWRlcnMsIHNraXBwaW5nIGl0LiB8IENyaXRlcmlhOiBbJHtjcml0ZXJpYVN0cmluZ31dYCk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBiZXN0UHJvdmlkZXJzLnNldChwcm92aWRlci5faWQsIHtcbiAgICAgICAgICAgICAgICAgICAgLi4ucHJvdmlkZXIsXG4gICAgICAgICAgICAgICAgICAgIC8vIHdoZW4gaXQncyBhIHByb3h5IGNvbnRhaW5lciBtYWtlIHN1cmUgdGhlIHByb3ZpZGVyIGhhcyBpdCdzIHJlZmVyZW5jZSBmb3IgcmVzb2x2aW5nIGl0IGxhdGVyLFxuICAgICAgICAgICAgICAgICAgICAvLyB0aGF0IHdheSB0aGUgcHJvdmlkZXIgaXMgcmVzb2x2ZWQgdXNpbmcgdGhlIHJpZ2h0IGhpZXJhcmNoeVxuICAgICAgICAgICAgICAgICAgICBfY29udGFpbmVyOiBjdXJyZW50IGFzIERJQ29udGFpbmVyXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgLy8gQ29sbGVjdCBleHBvcnRlZCBwcm92aWRlcnMgZnJvbSBjaGlsZCBjb250YWluZXJzXG4gICAgICAgICAgICBjdXJyZW50LmNoaWxkQ29udGFpbmVycy5mb3JFYWNoKGNoaWxkID0+IHtcblxuICAgICAgICAgICAgICAgIC8vIGFzIHdlJ3JlIG1vdmluZyBmcm9tIGNoaWxkIHRvIHBhcmVudCwgbWFrZSBzdXJlIHRvIHNraXAgb3ZlciB0aGUgdmlzaXRlZCBjb250YWluZXJzXG4gICAgICAgICAgICAgICAgaWYgKHZpc2l0ZWRDb250YWluZXJzLmhhcyhjaGlsZCkpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHZpc2l0ZWRDb250YWluZXJzLmFkZChjaGlsZCk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgY29uc3QgY2hpbGRQcm92aWRlcnMgPSBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzID8gY2hpbGQucHJvdmlkZXJzIDogY2hpbGQuZXhwb3J0cztcblxuICAgICAgICAgICAgICAgIGxldCBjaGlsZEV4cG9ydGVkUHJvdmlkZXJzID0gY3JpdGVyaWEudG9rZW4gPyAoY2hpbGRQcm92aWRlcnMuZ2V0KGNyaXRlcmlhLnRva2VuKSB8fCBbXSlcbiAgICAgICAgICAgICAgICAgICAgOiBBcnJheS5mcm9tKGNoaWxkUHJvdmlkZXJzLnZhbHVlcygpKS5mbGF0KCk7XG5cbiAgICAgICAgICAgICAgICBpZiAoY3JpdGVyaWE/LnR5cGUpIHtcbiAgICAgICAgICAgICAgICAgICAgY2hpbGRFeHBvcnRlZFByb3ZpZGVycyA9IGNoaWxkRXhwb3J0ZWRQcm92aWRlcnMuZmlsdGVyKHAgPT4gcC5fcHJvdmlkZXIudHlwZSA9PT0gY3JpdGVyaWEudHlwZSk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKGNyaXRlcmlhPy5mb3JFbnRpdHkpIHtcbiAgICAgICAgICAgICAgICAgICAgY2hpbGRFeHBvcnRlZFByb3ZpZGVycyA9IGNoaWxkRXhwb3J0ZWRQcm92aWRlcnMuZmlsdGVyKHAgPT4gcC5fcHJvdmlkZXIuZm9yRW50aXR5ID09PSBjcml0ZXJpYS5mb3JFbnRpdHkpXG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgY2hpbGRFeHBvcnRlZFByb3ZpZGVycy5mb3JFYWNoKHByb3ZpZGVyID0+IHtcblxuICAgICAgICAgICAgICAgICAgICBpZiAoYmVzdFByb3ZpZGVycy5oYXMocHJvdmlkZXIuX2lkKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gdGhpcy5sb2dnZXIuaW5mbyhgUHJvdmlkZXIgd2l0aCBpZCAke3Byb3ZpZGVyLl9pZH0gYWxyZWFkeSBleGlzdHMgaW4gYmVzdC1wcm92aWRlcnMsIHNraXBwaW5nIGV4cG9ydGVkLXByb3ZpZGVyIGZyb20gY2hpbGQgY29udGFpbmVyOiAke2NoaWxkLmNvbnRhaW5lcklkfSB8IENyaXRlcmlhOiBbJHtjcml0ZXJpYVN0cmluZ31dYCk7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICBiZXN0UHJvdmlkZXJzLnNldChwcm92aWRlci5faWQsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC4uLnByb3ZpZGVyLFxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gd2hlbiBpdCdzIGEgcHJveHkgY29udGFpbmVyIG1ha2Ugc3VyZSB0aGUgcHJvdmlkZXIgaGFzIGl0J3MgcmVmZXJlbmNlIGZvciByZXNvbHZpbmcgaXQgbGF0ZXIsXG4gICAgICAgICAgICAgICAgICAgICAgICBfY29udGFpbmVyOiBjaGlsZFxuICAgICAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGN1cnJlbnQgPSBjdXJyZW50LnBhcmVudDtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEZpbHRlciBhbmQgc29ydCBwcm92aWRlcnMgYmFzZWQgb24gY3JpdGVyaWEgYW5kIGNvbmZsaWN0IHJlc29sdXRpb24gc3RyYXRlZ2llc1xuICAgICAgICBjb25zdCBiZXN0UHJvdmlkZXJzQXJyYXkgPSBBcnJheS5mcm9tKGJlc3RQcm92aWRlcnMudmFsdWVzKCkpO1xuICAgICAgICBjb25zdCBmaWx0ZXJlZEFuZFNvcnRlZCA9IGZpbHRlckFuZFNvcnRQcm92aWRlcnMoYmVzdFByb3ZpZGVyc0FycmF5LCBjcml0ZXJpYSk7XG5cbiAgICAgICAgLy8gRGVkdXBsaWNhdGUgcHJvdmlkZXJzIGJ5IGNvbXBvc2l0ZSBrZXkgKHByb3ZpZGUsIHR5cGUsIGZvckVudGl0eSlcbiAgICAgICAgLy8gS2VlcCBvbmx5IHRoZSBoaWdoZXN0IHByaW9yaXR5IHByb3ZpZGVyIGZvciBlYWNoIHVuaXF1ZSBjb21iaW5hdGlvblxuICAgICAgICBjb25zdCB1bmlxdWVQcm92aWRlcnMgPSBuZXcgTWFwPHN0cmluZywgSW50ZXJuYWxQcm92aWRlck9wdGlvbnM8VD4+KCk7XG5cbiAgICAgICAgZm9yIChjb25zdCBwcm92aWRlciBvZiBmaWx0ZXJlZEFuZFNvcnRlZCkge1xuICAgICAgICAgICAgLy8gQ3JlYXRlIGEgY29tcG9zaXRlIGtleSBmcm9tIHByb3ZpZGUgdG9rZW4sIHR5cGUsIGFuZCBmb3JFbnRpdHlcbiAgICAgICAgICAgIGNvbnN0IHByb3ZpZGVUb2tlbiA9IHRoaXMuY3JlYXRlVG9rZW4ocHJvdmlkZXIuX3Byb3ZpZGVyLnByb3ZpZGUpO1xuICAgICAgICAgICAgY29uc3QgdHlwZSA9IHByb3ZpZGVyLl9wcm92aWRlci50eXBlIHx8ICdkZWZhdWx0JztcbiAgICAgICAgICAgIGNvbnN0IGZvckVudGl0eSA9IHByb3ZpZGVyLl9wcm92aWRlci5mb3JFbnRpdHkgfHwgJyc7XG4gICAgICAgICAgICBjb25zdCBjb21wb3NpdGVLZXkgPSBgJHtwcm92aWRlVG9rZW59Ojoke3R5cGV9Ojoke2ZvckVudGl0eX1gO1xuXG4gICAgICAgICAgICBpZiAoIXVuaXF1ZVByb3ZpZGVycy5oYXMoY29tcG9zaXRlS2V5KSkge1xuICAgICAgICAgICAgICAgIHVuaXF1ZVByb3ZpZGVycy5zZXQoY29tcG9zaXRlS2V5LCBwcm92aWRlcik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyBOb3RlOiBTaW5jZSBmaWx0ZXJlZEFuZFNvcnRlZCBpcyBhbHJlYWR5IHNvcnRlZCBieSBwcmlvcml0eSAoaGlnaGVzdCBmaXJzdCksXG4gICAgICAgICAgICAvLyB0aGUgZmlyc3QgcHJvdmlkZXIgd2UgZW5jb3VudGVyIGZvciBlYWNoIGNvbXBvc2l0ZSBrZXkgaXMgdGhlIGJlc3Qgb25lXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gQXJyYXkuZnJvbSh1bmlxdWVQcm92aWRlcnMudmFsdWVzKCkpO1xuICAgIH1cblxuICAgIHJlc29sdmU8VCwgQXN5bmMgZXh0ZW5kcyBib29sZWFuID0gZmFsc2U+KFxuICAgICAgICBkZXBlbmRlbmN5VG9rZW46IERlcElkZW50aWZpZXI8VD4sXG4gICAgICAgIGNyaXRlcmlhPzoge1xuICAgICAgICAgICAgdGFncz86IHN0cmluZ1tdO1xuICAgICAgICAgICAgdHlwZT86IFByb3ZpZGVyT3B0aW9uc1sgJ3R5cGUnIF0sXG4gICAgICAgICAgICBwcmlvcml0eT86IFByaW9yaXR5Q3JpdGVyaWE7XG4gICAgICAgICAgICBmb3JFbnRpdHk/OiBQcm92aWRlck9wdGlvbnNbICdmb3JFbnRpdHknIF0sXG4gICAgICAgICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzPzogYm9vbGVhblxuICAgICAgICB9LFxuICAgICAgICBwYXRoOiBTZXQ8VG9rZW4+ID0gbmV3IFNldCgpLFxuICAgICAgICBhc3luYzogQXN5bmMgPSBmYWxzZSBhcyBBc3luY1xuICAgICk6IEFzeW5jIGV4dGVuZHMgdHJ1ZSA/IFByb21pc2U8VD4gOiBUIHtcblxuICAgICAgICBjb25zdCB0b2tlbiA9IHRoaXMuY3JlYXRlVG9rZW4oZGVwZW5kZW5jeVRva2VuKTtcbiAgICAgICAgY3JpdGVyaWEgPSBjcml0ZXJpYSA/PyB7fTtcblxuICAgICAgICAvLyBpZiB0b2tlbiBpcyBgRElDb250YWluZXJgIHJldHVybiB0aGUgY3VycmVudCBjb250YWluZXJcbiAgICAgICAgaWYgKERJX1RPS0VOUy5ESV9DT05UQUlORVIgPT09IHRva2VuIHx8IHRoaXMuY3JlYXRlVG9rZW4oRElDb250YWluZXIpID09PSB0b2tlbikge1xuICAgICAgICAgICAgcmV0dXJuIChhc3luYyA/IFByb21pc2UucmVzb2x2ZSh0aGlzKSA6IHRoaXMpIGFzIEFzeW5jIGV4dGVuZHMgdHJ1ZSA/IFByb21pc2U8VD4gOiBUO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgYmVzdFByb3ZpZGVycyA9IHRoaXMuY29sbGVjdEJlc3RQcm92aWRlcnNGb3I8VD4oe1xuICAgICAgICAgICAgLi4uY3JpdGVyaWEsXG4gICAgICAgICAgICB0b2tlbixcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKGJlc3RQcm92aWRlcnMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgTm9Qcm92aWRlckZvdW5kRXJyb3IodG9rZW4sIHRoaXMsIGNyaXRlcmlhKTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBvcHRpb25zID0gYmVzdFByb3ZpZGVyc1sgMCBdO1xuXG4gICAgICAgIHJldHVybiB0aGlzLnJlc29sdmVQcm92aWRlclZhbHVlPFQsIEFzeW5jPihvcHRpb25zLCBwYXRoLCBhc3luYyk7XG4gICAgfVxuXG4gICAgcmVzb2x2ZVByb3ZpZGVyVmFsdWU8VCwgQXN5bmMgZXh0ZW5kcyBib29sZWFuID0gZmFsc2U+KFxuICAgICAgICBvcHRpb25zOiBJbnRlcm5hbFByb3ZpZGVyT3B0aW9uczxUPixcbiAgICAgICAgcGF0aDogU2V0PFRva2VuPiA9IG5ldyBTZXQoKSxcbiAgICAgICAgYXN5bmM6IEFzeW5jID0gZmFsc2UgYXMgQXN5bmNcbiAgICApOiBBc3luYyBleHRlbmRzIHRydWUgPyBQcm9taXNlPFQ+IDogVCB7XG5cbiAgICAgICAgY29uc3QgeyBfaWQsIF9jb250YWluZXIsIF9wcm92aWRlcjogcHJvdmlkZXIgfSA9IG9wdGlvbnM7XG5cbiAgICAgICAgaWYgKF9jb250YWluZXIgIT09IHRoaXMpIHtcbiAgICAgICAgICAgIHJldHVybiAoX2NvbnRhaW5lciBhcyBESUNvbnRhaW5lcikucmVzb2x2ZVByb3ZpZGVyVmFsdWUob3B0aW9ucywgcGF0aCwgYXN5bmMpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHByb3ZpZGVyLnNpbmdsZXRvbiAmJiB0aGlzLmNhY2hlLmhhcyhfaWQpKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5jYWNoZS5nZXQoX2lkKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0aGlzLnJlc29sdmluZy5oYXMoX2lkKSkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMucmVzb2x2aW5nLmdldChfaWQpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHBhdGguaGFzKF9pZCkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBDaXJjdWxhckRlcGVuZGVuY3lFcnJvcihBcnJheS5mcm9tKHBhdGgpLCB0aGlzLmNvbnRhaW5lcklkKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHBhdGguYWRkKF9pZCk7XG5cbiAgICAgICAgaWYgKGFzeW5jKSB7XG4gICAgICAgICAgICByZXR1cm4gYXBwbHlNaWRkbGV3YXJlc0FzeW5jKFxuICAgICAgICAgICAgICAgIHRoaXMuYXN5bmNNaWRkbGV3YXJlcyxcbiAgICAgICAgICAgICAgICAoKSA9PiB0aGlzLmNyZWF0ZUFuZENhY2hlSW5zdGFuY2VBc3luYzxUPihvcHRpb25zLCBwYXRoKVxuICAgICAgICAgICAgKSBhcyBBc3luYyBleHRlbmRzIHRydWUgPyBQcm9taXNlPFQ+IDogVDtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBhcHBseU1pZGRsZXdhcmVzKFxuICAgICAgICAgICAgdGhpcy5taWRkbGV3YXJlcyxcbiAgICAgICAgICAgICgpID0+IHRoaXMuY3JlYXRlQW5kQ2FjaGVJbnN0YW5jZShvcHRpb25zLCBwYXRoKVxuICAgICAgICApIGFzIEFzeW5jIGV4dGVuZHMgdHJ1ZSA/IFByb21pc2U8VD4gOiBUO1xuICAgIH1cblxuICAgIHByaXZhdGUgY3JlYXRlQW5kQ2FjaGVJbnN0YW5jZTxUPihvcHRpb25zOiBJbnRlcm5hbFByb3ZpZGVyT3B0aW9uczxUPiwgcGF0aDogU2V0PFRva2VuPik6IFQge1xuXG4gICAgICAgIGNvbnN0IHsgX2lkLCBfcHJvdmlkZXI6IHByb3ZpZGVyIH0gPSBvcHRpb25zO1xuXG4gICAgICAgIGNvbnN0IGluc3RhbmNlID0gdGhpcy5jcmVhdGVJbnN0YW5jZShvcHRpb25zLCBwYXRoKTtcbiAgICAgICAgaWYgKHByb3ZpZGVyLnNpbmdsZXRvbikge1xuICAgICAgICAgICAgdGhpcy5jYWNoZS5zZXQoX2lkLCBpbnN0YW5jZSk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLnJlc29sdmluZy5kZWxldGUoX2lkKTtcblxuICAgICAgICB0aGlzLmluamVjdFByb3BlcnRpZXMoaW5zdGFuY2UpO1xuICAgICAgICB0aGlzLmluaXRpYWxpemVJbnN0YW5jZShpbnN0YW5jZSk7XG5cbiAgICAgICAgcGF0aC5kZWxldGUoX2lkKTtcblxuICAgICAgICByZXR1cm4gaW5zdGFuY2U7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBjcmVhdGVJbnN0YW5jZTxULCBBc3luYyBleHRlbmRzIGJvb2xlYW4gPSBmYWxzZT4oXG4gICAgICAgIG9wdGlvbnM6IEludGVybmFsUHJvdmlkZXJPcHRpb25zPFQ+LFxuICAgICAgICBwYXRoOiBTZXQ8VG9rZW4+LFxuICAgICAgICBhc3luYzogQXN5bmMgPSBmYWxzZSBhcyBBc3luY1xuICAgICk6IEFzeW5jIGV4dGVuZHMgdHJ1ZSA/IFByb21pc2U8VD4gOiBUIHtcblxuICAgICAgICBjb25zdCB7IF9pZCwgX3Byb3ZpZGVyOiBwcm92aWRlciB9ID0gb3B0aW9ucztcblxuICAgICAgICBpZiAoaXNBbGlhc1Byb3ZpZGVyT3B0aW9ucyhwcm92aWRlcikpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnJlc29sdmUocHJvdmlkZXIudXNlRXhpc3RpbmcsIHt9LCBwYXRoLCBhc3luYyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoaXNDbGFzc1Byb3ZpZGVyT3B0aW9ucyhwcm92aWRlcikpIHtcblxuICAgICAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICAgICAgICBhc3luYyA/IHRoaXMuY3JlYXRlQ2xhc3NJbnN0YW5jZTxULCB0cnVlPihvcHRpb25zLCBwYXRoLCB0cnVlKVxuICAgICAgICAgICAgICAgICAgICA6IHRoaXMuY3JlYXRlQ2xhc3NJbnN0YW5jZShvcHRpb25zLCBwYXRoKVxuICAgICAgICAgICAgKSBhcyBBc3luYyBleHRlbmRzIHRydWUgPyBQcm9taXNlPFQ+IDogVDtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChpc0ZhY3RvcnlQcm92aWRlck9wdGlvbnMocHJvdmlkZXIpKSB7XG5cbiAgICAgICAgICAgIHJldHVybiAoXG4gICAgICAgICAgICAgICAgYXN5bmMgPyB0aGlzLmNyZWF0ZUZhY3RvcnlJbnN0YW5jZUFzeW5jPFQ+KHByb3ZpZGVyLCBwYXRoKVxuICAgICAgICAgICAgICAgICAgICA6IHRoaXMuY3JlYXRlRmFjdG9yeUluc3RhbmNlKHByb3ZpZGVyLCBwYXRoKVxuICAgICAgICAgICAgKSBhcyBBc3luYyBleHRlbmRzIHRydWUgPyBQcm9taXNlPFQ+IDogVDtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChpc1ZhbHVlUHJvdmlkZXJPcHRpb25zKHByb3ZpZGVyKSkge1xuICAgICAgICAgICAgcmV0dXJuIHByb3ZpZGVyLnVzZVZhbHVlIGFzIEFzeW5jIGV4dGVuZHMgdHJ1ZSA/IFByb21pc2U8VD4gOiBUO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGlzQ29uZmlnUHJvdmlkZXJPcHRpb25zKHByb3ZpZGVyKSkge1xuICAgICAgICAgICAgcmV0dXJuIHByb3ZpZGVyLnVzZUNvbmZpZyBhcyBBc3luYyBleHRlbmRzIHRydWUgPyBQcm9taXNlPFQ+IDogVDtcbiAgICAgICAgfVxuXG4gICAgICAgIHRocm93IG5ldyBQcm92aWRlckNvbmZpZ3VyYXRpb25FcnJvcihfaWQsIHRoaXMuY29udGFpbmVySWQpO1xuICAgIH1cblxuICAgIHByaXZhdGUgY3JlYXRlQ2xhc3NJbnN0YW5jZTxULCBBc3luYyBleHRlbmRzIGJvb2xlYW4gPSBmYWxzZT4oXG4gICAgICAgIG9wdGlvbnM6IEludGVybmFsUHJvdmlkZXJPcHRpb25zPFQ+LFxuICAgICAgICBwYXRoOiBTZXQ8VG9rZW4+LFxuICAgICAgICBhc3luYzogQXN5bmMgPSBmYWxzZSBhcyBBc3luY1xuICAgICk6IEFzeW5jIGV4dGVuZHMgdHJ1ZSA/IFByb21pc2U8VD4gOiBUIHtcblxuICAgICAgICBjb25zdCB7IF9pZCwgX3Byb3ZpZGVyOiBwcm92aWRlciB9ID0gb3B0aW9ucztcblxuICAgICAgICBpZiAodGhpcy5yZXNvbHZpbmcuaGFzKF9pZCkpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnJlc29sdmluZy5nZXQoX2lkKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHsgdXNlQ2xhc3MgfSA9IHByb3ZpZGVyIGFzIENsYXNzUHJvdmlkZXJPcHRpb25zPFQ+O1xuXG4gICAgICAgIC8vIENyZWF0ZSBhIHBsYWNlaG9sZGVyIG9iamVjdCBhbmQgc3RvcmUgaXQgaW4gdGhlIHJlc29sdmluZyBtYXBcbiAgICAgICAgY29uc3QgaW5zdGFuY2VQbGFjZWhvbGRlcjogVCA9IE9iamVjdC5jcmVhdGUodXNlQ2xhc3MucHJvdG90eXBlKTtcbiAgICAgICAgdGhpcy5yZXNvbHZpbmcuc2V0KF9pZCwgaW5zdGFuY2VQbGFjZWhvbGRlcik7XG5cblxuICAgICAgICBpZiAoYXN5bmMpIHtcbiAgICAgICAgICAgIHRoaXMucmVzb2x2ZURlcGVuZGVuY2llc0FzeW5jKHVzZUNsYXNzLCBwYXRoKS50aGVuKGRlcGVuZGVuY2llcyA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgYWN0dWFsSW5zdGFuY2UgPSBuZXcgdXNlQ2xhc3MoLi4uZGVwZW5kZW5jaWVzKTtcbiAgICAgICAgICAgICAgICBPYmplY3QuYXNzaWduKGluc3RhbmNlUGxhY2Vob2xkZXIgYXMgYW55LCBhY3R1YWxJbnN0YW5jZSk7XG4gICAgICAgICAgICAgICAgdGhpcy5yZXNvbHZpbmcuc2V0KF9pZCwgYWN0dWFsSW5zdGFuY2UpO1xuICAgICAgICAgICAgICAgIHJldHVybiBhY3R1YWxJbnN0YW5jZTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBkZXBlbmRlbmNpZXMgPSB0aGlzLnJlc29sdmVEZXBlbmRlbmNpZXModXNlQ2xhc3MsIHBhdGgpO1xuICAgICAgICBjb25zdCBhY3R1YWxJbnN0YW5jZSA9IG5ldyB1c2VDbGFzcyguLi5kZXBlbmRlbmNpZXMpO1xuICAgICAgICBPYmplY3QuYXNzaWduKGluc3RhbmNlUGxhY2Vob2xkZXIgYXMgYW55LCBhY3R1YWxJbnN0YW5jZSk7XG4gICAgICAgIHRoaXMucmVzb2x2aW5nLnNldChfaWQsIGFjdHVhbEluc3RhbmNlKTtcblxuICAgICAgICByZXR1cm4gYWN0dWFsSW5zdGFuY2UgYXMgQXN5bmMgZXh0ZW5kcyB0cnVlID8gUHJvbWlzZTxUPiA6IFQ7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBjcmVhdGVGYWN0b3J5SW5zdGFuY2U8VD4ob3B0aW9uczogRmFjdG9yeVByb3ZpZGVyT3B0aW9uczxUPiwgcGF0aDogU2V0PFRva2VuPik6IFQge1xuICAgICAgICBjb25zdCBkZXBlbmRlbmNpZXMgPSAob3B0aW9ucy5kZXBzIHx8IFtdKS5tYXAoZGVwID0+IHRoaXMucmVzb2x2ZURlcGVuZGVuY3koZGVwLCBwYXRoKSk7XG4gICAgICAgIHJldHVybiBvcHRpb25zLnVzZUZhY3RvcnkoLi4uZGVwZW5kZW5jaWVzKTtcbiAgICB9XG5cbiAgICBnZXRDbGFzc0RlcGVuZGVuY2llcyh0YXJnZXQ6IENsYXNzQ29uc3RydWN0b3IpIHtcbiAgICAgICAgY29uc3QgY29uc3RydWN0b3JEZXBlbmRlbmNpZXMgPSBnZXRDb25zdHJ1Y3RvckRlcGVuZGVuY2llc01ldGFkYXRhKHRhcmdldCk7XG4gICAgICAgIGNvbnN0IHByb3BlcnR5RGVwZW5kZW5jaWVzID0gZ2V0UHJvcGVydHlEZXBlbmRlbmNpZXNNZXRhZGF0YSh0YXJnZXQpO1xuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBwcm9wZXJ0eURlcGVuZGVuY2llcyxcbiAgICAgICAgICAgIGNvbnN0cnVjdG9yRGVwZW5kZW5jaWVzXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIHJlc29sdmVEZXBlbmRlbmN5PFQsIEFzeW5jIGV4dGVuZHMgYm9vbGVhbiA9IGZhbHNlPihcbiAgICAgICAgZGVwOiBEZXBJZGVudGlmaWVyIHwgQ29tcGxleERlcGVuZGVuY3lJZGVudGlmaWVyLFxuICAgICAgICBwYXRoOiBTZXQ8VG9rZW4+LFxuICAgICAgICBhc3luYzogQXN5bmMgPSBmYWxzZSBhcyBBc3luY1xuICAgICk6IEFzeW5jIGV4dGVuZHMgdHJ1ZSA/IFByb21pc2U8VD4gOiBUIHtcblxuICAgICAgICBsZXQgbm9ybWFsaXplZERlcCA9IGRlcDtcblxuICAgICAgICBpZiAoIWlzQ29tcGxleERlcGVuZGVuY3lJZGVudGlmaWVyKG5vcm1hbGl6ZWREZXApKSB7XG4gICAgICAgICAgICBub3JtYWxpemVkRGVwID0geyB0b2tlbjogbm9ybWFsaXplZERlcCB9IGFzIENvbXBsZXhEZXBlbmRlbmN5SWRlbnRpZmllcjtcbiAgICAgICAgfVxuXG4gICAgICAgIHRyeSB7XG5cbiAgICAgICAgICAgIGlmIChub3JtYWxpemVkRGVwLmlzQ29uZmlnKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMucmVzb2x2ZUNvbmZpZyhub3JtYWxpemVkRGVwLnRva2VuIGFzIHN0cmluZywgbm9ybWFsaXplZERlcCkgYXMgQXN5bmMgZXh0ZW5kcyB0cnVlID8gUHJvbWlzZTxUPiA6IFQ7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChub3JtYWxpemVkRGVwLmZvckVudGl0eSkge1xuICAgICAgICAgICAgICAgIGlmIChub3JtYWxpemVkRGVwLnR5cGUgPT0gJ3NjaGVtYScpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMucmVzb2x2ZUVudGl0eVNjaGVtYShub3JtYWxpemVkRGVwLmZvckVudGl0eSwgbm9ybWFsaXplZERlcCwgYXN5bmMpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmIChub3JtYWxpemVkRGVwLnR5cGUgPT0gJ3NlcnZpY2UnKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLnJlc29sdmVFbnRpdHlTZXJ2aWNlKG5vcm1hbGl6ZWREZXAuZm9yRW50aXR5LCBub3JtYWxpemVkRGVwLCBhc3luYylcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEludmFsaWREZXBlbmRlbmN5Q3JpdGVyaWFFcnJvcihKU09OLnN0cmluZ2lmeShub3JtYWxpemVkRGVwKSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiB0aGlzLnJlc29sdmU8VCwgQXN5bmM+KG5vcm1hbGl6ZWREZXAudG9rZW4sIG5vcm1hbGl6ZWREZXAsIHBhdGgsIGFzeW5jKVxuXG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcblxuICAgICAgICAgICAgaWYgKFxuICAgICAgICAgICAgICAgIGUgaW5zdGFuY2VvZiBOb1Byb3ZpZGVyRm91bmRFcnJvclxuICAgICAgICAgICAgICAgICYmXG4gICAgICAgICAgICAgICAgKG5vcm1hbGl6ZWREZXAuaXNPcHRpb25hbCB8fCBub3JtYWxpemVkRGVwLmRlZmF1bHRWYWx1ZSAhPT0gdW5kZWZpbmVkKVxuICAgICAgICAgICAgKSB7XG4gICAgICAgICAgICAgICAgLy8gdGhpcy5sb2dnZXIuaW5mbyhgTm8gcHJvdmlkZXIgZm91bmQgZm9yICR7SlNPTi5zdHJpbmdpZnkoZGVwKX1gLCB7IHBhdGggfSlcbiAgICAgICAgICAgICAgICByZXR1cm4gbm9ybWFsaXplZERlcC5kZWZhdWx0VmFsdWUgPz8gdW5kZWZpbmVkO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB0aHJvdyBlO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSByZXNvbHZlRGVwZW5kZW5jaWVzPFQgZXh0ZW5kcyBDbGFzc0NvbnN0cnVjdG9yPih0YXJnZXQ6IFQsIHBhdGg6IFNldDxUb2tlbj4pOiBhbnlbXSB7XG5cbiAgICAgICAgY29uc3QgaW5qZWN0TWV0YWRhdGEgPSBnZXRDb25zdHJ1Y3RvckRlcGVuZGVuY2llc01ldGFkYXRhKHRhcmdldCk7XG5cbiAgICAgICAgcmV0dXJuIGluamVjdE1ldGFkYXRhLm1hcChkZXAgPT4gdGhpcy5yZXNvbHZlRGVwZW5kZW5jeShkZXAsIHBhdGgpKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGluaXRpYWxpemVJbnN0YW5jZTxUPihpbnN0YW5jZTogVCk6IHZvaWQge1xuICAgICAgICBpZiAoIWhhc0NvbnN0cnVjdG9yKGluc3RhbmNlKSkgcmV0dXJuO1xuXG4gICAgICAgIGNvbnN0IGluaXRNZXRob2QgPSBnZXRPbkluaXRIb29rTWV0YWRhdGEoaW5zdGFuY2UuY29uc3RydWN0b3IgYXMgQ2xhc3NDb25zdHJ1Y3Rvcik7XG5cbiAgICAgICAgaWYgKGluaXRNZXRob2QpIHtcbiAgICAgICAgICAgIGNvbnN0IHRoZUluaXRNZXRob2QgPSBpbnN0YW5jZVsgaW5pdE1ldGhvZCBhcyBrZXlvZiB0eXBlb2YgaW5zdGFuY2UgXSBhcyBGdW5jdGlvbjtcbiAgICAgICAgICAgIGlmICh0eXBlb2YgdGhlSW5pdE1ldGhvZCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIHRoZUluaXRNZXRob2QuY2FsbChpbnN0YW5jZSk7ICAvLyBCaW5kICd0aGlzJyBjb250ZXh0IHRvIHRoZSBpbnN0YW5jZVxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEluaXRpYWxpemF0aW9uTWV0aG9kRXJyb3IoaW5zdGFuY2UuY29uc3RydWN0b3IubmFtZSwgZXJyb3IubWVzc2FnZSwgdGhpcy5jb250YWluZXJJZCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSW5pdGlhbGl6YXRpb25NZXRob2RUeXBlRXJyb3IoU3RyaW5nKGluaXRNZXRob2QpLCBpbnN0YW5jZS5jb25zdHJ1Y3Rvci5uYW1lLCB0aGlzLmNvbnRhaW5lcklkKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgaW5qZWN0UHJvcGVydGllczxUPihpbnN0YW5jZTogVCk6IHZvaWQge1xuICAgICAgICBpZiAoIWhhc0NvbnN0cnVjdG9yKGluc3RhbmNlKSkgcmV0dXJuO1xuXG4gICAgICAgIGNvbnN0IGRlcGVuZGVuY2llcyA9IGdldFByb3BlcnR5RGVwZW5kZW5jaWVzTWV0YWRhdGEoaW5zdGFuY2UuY29uc3RydWN0b3IgYXMgQ2xhc3NDb25zdHJ1Y3Rvcik7XG5cbiAgICAgICAgZm9yIChjb25zdCBkZXAgb2YgZGVwZW5kZW5jaWVzKSB7XG4gICAgICAgICAgICBjb25zdCBwcm9wZXJ0eVZhbHVlID0gdGhpcy5yZXNvbHZlRGVwZW5kZW5jeShkZXAsIG5ldyBTZXQoKSlcblxuICAgICAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KGluc3RhbmNlLCBkZXAucHJvcGVydHlLZXksIHtcbiAgICAgICAgICAgICAgICB2YWx1ZTogcHJvcGVydHlWYWx1ZSxcbiAgICAgICAgICAgICAgICBlbnVtZXJhYmxlOiB0cnVlLFxuICAgICAgICAgICAgICAgIGNvbmZpZ3VyYWJsZTogdHJ1ZVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBoYXMoXG4gICAgICAgIGRlcGVuZGVuY3lUb2tlbjogRGVwSWRlbnRpZmllcixcbiAgICAgICAgY3JpdGVyaWE/OiB7XG4gICAgICAgICAgICB0YWdzPzogc3RyaW5nW107XG4gICAgICAgICAgICB0eXBlPzogUHJvdmlkZXJPcHRpb25zWyAndHlwZScgXSxcbiAgICAgICAgICAgIHByaW9yaXR5PzogUHJpb3JpdHlDcml0ZXJpYTtcbiAgICAgICAgICAgIGZvckVudGl0eT86IFByb3ZpZGVyT3B0aW9uc1sgJ2ZvckVudGl0eScgXSxcbiAgICAgICAgICAgIGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnM/OiBib29sZWFuXG4gICAgICAgIH1cbiAgICApOiBib29sZWFuIHtcblxuICAgICAgICBjb25zdCB0b2tlbiA9IHRoaXMuY3JlYXRlVG9rZW4oZGVwZW5kZW5jeVRva2VuKTtcblxuICAgICAgICBjb25zdCBiZXN0UHJvdmlkZXJzID0gdGhpcy5jb2xsZWN0QmVzdFByb3ZpZGVyc0Zvcjxhbnk+KHtcbiAgICAgICAgICAgIC4uLmNyaXRlcmlhLFxuICAgICAgICAgICAgdG9rZW4sXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiBiZXN0UHJvdmlkZXJzLmxlbmd0aCA+IDA7XG4gICAgfVxuXG4gICAgaGFzRW50aXR5U2VydmljZShcbiAgICAgICAgZW50aXR5TmFtZTogRGVwSWRlbnRpZmllcixcbiAgICAgICAgY3JpdGVyaWE/OiB7XG4gICAgICAgICAgICB0YWdzPzogc3RyaW5nW107XG4gICAgICAgICAgICBwcmlvcml0eT86IFByaW9yaXR5Q3JpdGVyaWE7XG4gICAgICAgICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzPzogYm9vbGVhblxuICAgICAgICB9XG4gICAgKTogYm9vbGVhbiB7XG5cbiAgICAgICAgY29uc3QgeyB0YWdzLCBwcmlvcml0eSwgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVycyB9ID0gY3JpdGVyaWEgPz8ge307XG4gICAgICAgIGNvbnN0IGJlc3RQcm92aWRlcnMgPSB0aGlzLmNvbGxlY3RCZXN0UHJvdmlkZXJzRm9yPGFueT4oe1xuICAgICAgICAgICAgdGFncyxcbiAgICAgICAgICAgIHR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgICAgICAgIHByaW9yaXR5LFxuICAgICAgICAgICAgZm9yRW50aXR5OiBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVycyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIGJlc3RQcm92aWRlcnMubGVuZ3RoID4gMDtcbiAgICB9XG5cbiAgICByZXNvbHZlRW50aXR5U2VydmljZTxULCBBc3luYyBleHRlbmRzIGJvb2xlYW4gPSBmYWxzZT4oXG4gICAgICAgIGVudGl0eU5hbWU6IERlcElkZW50aWZpZXIsXG4gICAgICAgIGNyaXRlcmlhPzoge1xuICAgICAgICAgICAgdGFncz86IHN0cmluZ1tdO1xuICAgICAgICAgICAgcHJpb3JpdHk/OiBQcmlvcml0eUNyaXRlcmlhO1xuICAgICAgICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVycz86IGJvb2xlYW5cbiAgICAgICAgfSxcbiAgICAgICAgYXN5bmM6IEFzeW5jID0gZmFsc2UgYXMgQXN5bmNcbiAgICApOiBBc3luYyBleHRlbmRzIHRydWUgPyBQcm9taXNlPFQ+IDogVCB7XG5cbiAgICAgICAgY29uc3QgeyB0YWdzLCBwcmlvcml0eSwgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVycyB9ID0gY3JpdGVyaWEgPz8ge307XG4gICAgICAgIGNvbnN0IGJlc3RQcm92aWRlcnMgPSB0aGlzLmNvbGxlY3RCZXN0UHJvdmlkZXJzRm9yPGFueT4oe1xuICAgICAgICAgICAgdGFncyxcbiAgICAgICAgICAgIHR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgICAgICAgIHByaW9yaXR5LFxuICAgICAgICAgICAgZm9yRW50aXR5OiBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVycyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKGJlc3RQcm92aWRlcnMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgTm9FbnRpdHlTZXJ2aWNlUHJvdmlkZXJFcnJvcihTdHJpbmcoZW50aXR5TmFtZSksIHRoaXMuY29udGFpbmVySWQpO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IG9wdGlvbnMgPSBiZXN0UHJvdmlkZXJzWyAwIF07XG5cbiAgICAgICAgcmV0dXJuIHRoaXMucmVzb2x2ZVByb3ZpZGVyVmFsdWU8VCwgQXN5bmM+KG9wdGlvbnMsIG5ldyBTZXQoKSwgYXN5bmMpO1xuICAgIH1cblxuICAgIGhhc0VudGl0eVNjaGVtYShcbiAgICAgICAgZW50aXR5TmFtZTogRGVwSWRlbnRpZmllcixcbiAgICAgICAgY3JpdGVyaWE/OiB7XG4gICAgICAgICAgICB0YWdzPzogc3RyaW5nW107XG4gICAgICAgICAgICBwcmlvcml0eT86IFByaW9yaXR5Q3JpdGVyaWE7XG4gICAgICAgICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzPzogYm9vbGVhblxuICAgICAgICB9XG4gICAgKTogYm9vbGVhbiB7XG5cbiAgICAgICAgY29uc3QgeyB0YWdzLCBwcmlvcml0eSwgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVycyB9ID0gY3JpdGVyaWEgPz8ge307XG4gICAgICAgIGNvbnN0IGJlc3RQcm92aWRlcnMgPSB0aGlzLmNvbGxlY3RCZXN0UHJvdmlkZXJzRm9yPGFueT4oe1xuICAgICAgICAgICAgdGFncyxcbiAgICAgICAgICAgIHR5cGU6ICdzY2hlbWEnLFxuICAgICAgICAgICAgcHJpb3JpdHksXG4gICAgICAgICAgICBmb3JFbnRpdHk6IGVudGl0eU5hbWUsXG4gICAgICAgICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzLFxuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gYmVzdFByb3ZpZGVycy5sZW5ndGggPiAwO1xuICAgIH1cblxuICAgIHJlc29sdmVFbnRpdHlTY2hlbWE8VCwgQXN5bmMgZXh0ZW5kcyBib29sZWFuID0gZmFsc2U+KFxuICAgICAgICBlbnRpdHlOYW1lOiBEZXBJZGVudGlmaWVyLFxuICAgICAgICBjcml0ZXJpYT86IHtcbiAgICAgICAgICAgIHRhZ3M/OiBzdHJpbmdbXTtcbiAgICAgICAgICAgIHByaW9yaXR5PzogUHJpb3JpdHlDcml0ZXJpYTtcbiAgICAgICAgICAgIGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnM/OiBib29sZWFuXG4gICAgICAgIH0sXG4gICAgICAgIGFzeW5jOiBBc3luYyA9IGZhbHNlIGFzIEFzeW5jXG4gICAgKTogQXN5bmMgZXh0ZW5kcyB0cnVlID8gUHJvbWlzZTxUPiA6IFQge1xuXG4gICAgICAgIGNvbnN0IHsgdGFncywgcHJpb3JpdHksIGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnMgfSA9IGNyaXRlcmlhID8/IHt9O1xuICAgICAgICBjb25zdCBiZXN0UHJvdmlkZXJzID0gdGhpcy5jb2xsZWN0QmVzdFByb3ZpZGVyc0Zvcjxhbnk+KHtcbiAgICAgICAgICAgIHRhZ3MsXG4gICAgICAgICAgICB0eXBlOiAnc2NoZW1hJyxcbiAgICAgICAgICAgIHByaW9yaXR5LFxuICAgICAgICAgICAgZm9yRW50aXR5OiBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVycyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKGJlc3RQcm92aWRlcnMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgTm9FbnRpdHlTY2hlbWFQcm92aWRlckVycm9yKFN0cmluZyhlbnRpdHlOYW1lKSwgdGhpcy5jb250YWluZXJJZCk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3Qgb3B0aW9ucyA9IGJlc3RQcm92aWRlcnNbIDAgXTtcblxuICAgICAgICByZXR1cm4gdGhpcy5yZXNvbHZlUHJvdmlkZXJWYWx1ZTxULCBBc3luYz4ob3B0aW9ucywgbmV3IFNldCgpLCBhc3luYyk7XG4gICAgfVxuXG4gICAgY2xlYXIoY2xlYXJDaGlsZENvbnRhaW5lcnMgPSB0cnVlKSB7XG4gICAgICAgIHRoaXMucHJvdmlkZXJzLmNsZWFyKCk7XG4gICAgICAgIHRoaXMuY2FjaGUuY2xlYXIoKTtcbiAgICAgICAgdGhpcy5yZXNvbHZpbmcuY2xlYXIoKTtcbiAgICAgICAgaWYgKGNsZWFyQ2hpbGRDb250YWluZXJzKSB7XG4gICAgICAgICAgICB0aGlzLmNoaWxkQ29udGFpbmVycy5mb3JFYWNoKGNvbnRhaW5lciA9PiBjb250YWluZXIuY2xlYXIoKSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICB1c2VNaWRkbGV3YXJlKHsgbWlkZGxld2FyZSwgb3JkZXIgPSAxIH06IFBhcnRpYWxCeTxESU1pZGRsZXdhcmU8YW55PiwgJ29yZGVyJz4pIHtcbiAgICAgICAgdGhpcy5taWRkbGV3YXJlcy5wdXNoKHsgbWlkZGxld2FyZSwgb3JkZXIgfSk7XG4gICAgICAgIHRoaXMubWlkZGxld2FyZXMuc29ydCgoYSwgYikgPT4gKGEub3JkZXIgPz8gMCkgLSAoYi5vcmRlciA/PyAwKSk7XG4gICAgfVxuXG4gICAgYXN5bmMgcmVzb2x2ZUFzeW5jPFQ+KFxuICAgICAgICBkZXBlbmRlbmN5VG9rZW46IERlcElkZW50aWZpZXI8VD4sXG4gICAgICAgIGNyaXRlcmlhPzoge1xuICAgICAgICAgICAgdGFncz86IHN0cmluZ1tdO1xuICAgICAgICAgICAgdHlwZT86IFByb3ZpZGVyT3B0aW9uc1sgJ3R5cGUnIF0sXG4gICAgICAgICAgICBwcmlvcml0eT86IFByaW9yaXR5Q3JpdGVyaWE7XG4gICAgICAgICAgICBmb3JFbnRpdHk/OiBQcm92aWRlck9wdGlvbnNbICdmb3JFbnRpdHknIF0sXG4gICAgICAgICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzPzogYm9vbGVhblxuICAgICAgICB9LFxuICAgICAgICBwYXRoPzogU2V0PFRva2VuPlxuICAgICkge1xuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5yZXNvbHZlPFQsIHRydWU+KGRlcGVuZGVuY3lUb2tlbiwgY3JpdGVyaWEsIHBhdGgsIHRydWUpO1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgY3JlYXRlQW5kQ2FjaGVJbnN0YW5jZUFzeW5jPFQ+KG9wdGlvbnM6IEludGVybmFsUHJvdmlkZXJPcHRpb25zPFQ+LCBwYXRoOiBTZXQ8VG9rZW4+KTogUHJvbWlzZTxUPiB7XG4gICAgICAgIGNvbnN0IHsgX2lkLCBfcHJvdmlkZXI6IHByb3ZpZGVyIH0gPSBvcHRpb25zO1xuXG4gICAgICAgIGNvbnN0IGluc3RhbmNlID0gYXdhaXQgdGhpcy5jcmVhdGVJbnN0YW5jZShvcHRpb25zLCBwYXRoLCB0cnVlKTtcbiAgICAgICAgaWYgKHByb3ZpZGVyLnNpbmdsZXRvbikge1xuICAgICAgICAgICAgdGhpcy5jYWNoZS5zZXQoX2lkLCBpbnN0YW5jZSk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLnJlc29sdmluZy5kZWxldGUoX2lkKTtcblxuICAgICAgICBhd2FpdCB0aGlzLmluamVjdFByb3BlcnRpZXNBc3luYyhpbnN0YW5jZSk7XG4gICAgICAgIGF3YWl0IHRoaXMuaW5pdGlhbGl6ZUluc3RhbmNlQXN5bmMoaW5zdGFuY2UpO1xuXG4gICAgICAgIHBhdGguZGVsZXRlKF9pZCk7XG5cbiAgICAgICAgcmV0dXJuIGluc3RhbmNlO1xuICAgIH1cblxuICAgIHVzZU1pZGRsZXdhcmVBc3luYyh7IG1pZGRsZXdhcmUsIG9yZGVyID0gMSB9OiBQYXJ0aWFsQnk8RElNaWRkbGV3YXJlQXN5bmM8YW55PiwgJ29yZGVyJz4pIHtcbiAgICAgICAgdGhpcy5hc3luY01pZGRsZXdhcmVzLnB1c2goeyBtaWRkbGV3YXJlLCBvcmRlciB9KTtcbiAgICAgICAgdGhpcy5hc3luY01pZGRsZXdhcmVzLnNvcnQoKGEsIGIpID0+IChhLm9yZGVyID8/IDApIC0gKGIub3JkZXIgPz8gMCkpO1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgcmVzb2x2ZURlcGVuZGVuY2llc0FzeW5jPFQgZXh0ZW5kcyBDbGFzc0NvbnN0cnVjdG9yPih0YXJnZXQ6IFQsIHBhdGg6IFNldDxUb2tlbj4pOiBQcm9taXNlPGFueVtdPiB7XG5cbiAgICAgICAgY29uc3QgaW5qZWN0TWV0YWRhdGEgPSBnZXRDb25zdHJ1Y3RvckRlcGVuZGVuY2llc01ldGFkYXRhKHRhcmdldCk7XG5cbiAgICAgICAgcmV0dXJuIGF3YWl0IFByb21pc2UuYWxsKGluamVjdE1ldGFkYXRhLm1hcChhc3luYyBkZXAgPT4gYXdhaXQgdGhpcy5yZXNvbHZlRGVwZW5kZW5jeShkZXAsIHBhdGgsIHRydWUpKSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBpbml0aWFsaXplSW5zdGFuY2VBc3luYzxUPihpbnN0YW5jZTogVCk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBpZiAoIWhhc0NvbnN0cnVjdG9yKGluc3RhbmNlKSkgcmV0dXJuO1xuXG4gICAgICAgIGNvbnN0IGluaXRNZXRob2QgPSBnZXRPbkluaXRIb29rTWV0YWRhdGEoaW5zdGFuY2UuY29uc3RydWN0b3IgYXMgQ2xhc3NDb25zdHJ1Y3Rvcik7XG5cbiAgICAgICAgaWYgKGluaXRNZXRob2QpIHtcbiAgICAgICAgICAgIGNvbnN0IHRoZUluaXRNZXRob2QgPSBpbnN0YW5jZVsgaW5pdE1ldGhvZCBhcyBrZXlvZiB0eXBlb2YgaW5zdGFuY2UgXSBhcyBGdW5jdGlvbjtcbiAgICAgICAgICAgIGlmICh0eXBlb2YgdGhlSW5pdE1ldGhvZCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IHRoZUluaXRNZXRob2QuY2FsbChpbnN0YW5jZSk7ICAvLyBCaW5kICd0aGlzJyBjb250ZXh0IHRvIHRoZSBpbnN0YW5jZVxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEluaXRpYWxpemF0aW9uTWV0aG9kRXJyb3IoaW5zdGFuY2UuY29uc3RydWN0b3IubmFtZSwgZXJyb3IubWVzc2FnZSwgdGhpcy5jb250YWluZXJJZCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSW5pdGlhbGl6YXRpb25NZXRob2RUeXBlRXJyb3IoU3RyaW5nKGluaXRNZXRob2QpLCBpbnN0YW5jZS5jb25zdHJ1Y3Rvci5uYW1lLCB0aGlzLmNvbnRhaW5lcklkKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgY3JlYXRlRmFjdG9yeUluc3RhbmNlQXN5bmM8VD4ob3B0aW9uczogRmFjdG9yeVByb3ZpZGVyT3B0aW9uczxUPiwgcGF0aDogU2V0PFRva2VuPik6IFByb21pc2U8VD4ge1xuICAgICAgICBjb25zdCBkZXBlbmRlbmNpZXMgPSBhd2FpdCBQcm9taXNlLmFsbCgob3B0aW9ucy5kZXBzIHx8IFtdKS5tYXAoYXN5bmMgKGRlcCkgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMucmVzb2x2ZURlcGVuZGVuY3koZGVwLCBwYXRoLCB0cnVlKTtcbiAgICAgICAgfSkpO1xuICAgICAgICByZXR1cm4gb3B0aW9ucy51c2VGYWN0b3J5KC4uLmRlcGVuZGVuY2llcyk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBpbmplY3RQcm9wZXJ0aWVzQXN5bmM8VD4oaW5zdGFuY2U6IFQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgaWYgKCFoYXNDb25zdHJ1Y3RvcihpbnN0YW5jZSkpIHJldHVybjtcblxuICAgICAgICBjb25zdCBkZXBlbmRlbmNpZXMgPSBnZXRQcm9wZXJ0eURlcGVuZGVuY2llc01ldGFkYXRhKGluc3RhbmNlLmNvbnN0cnVjdG9yIGFzIENsYXNzQ29uc3RydWN0b3IpO1xuXG4gICAgICAgIGZvciAoY29uc3QgZGVwIG9mIGRlcGVuZGVuY2llcykge1xuICAgICAgICAgICAgY29uc3QgcHJvcGVydHlWYWx1ZSA9IGF3YWl0IHRoaXMucmVzb2x2ZURlcGVuZGVuY3koZGVwLCBuZXcgU2V0KCksIHRydWUpXG5cbiAgICAgICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShpbnN0YW5jZSwgZGVwLnByb3BlcnR5S2V5LCB7XG4gICAgICAgICAgICAgICAgdmFsdWU6IHByb3BlcnR5VmFsdWUsXG4gICAgICAgICAgICAgICAgZW51bWVyYWJsZTogdHJ1ZSxcbiAgICAgICAgICAgICAgICBjb25maWd1cmFibGU6IHRydWVcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgbG9nQ2hpbGRDb250YWluZXJzKCkge1xuICAgICAgICBmb3IgKGNvbnN0IGNvbnRhaW5lciBvZiB0aGlzLmNoaWxkQ29udGFpbmVycykge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENoaWxkIENvbnRhaW5lcjogJHtjb250YWluZXIuY29udGFpbmVySWR9YCk7XG4gICAgICAgICAgICBjb250YWluZXIubG9nQ2hpbGRDb250YWluZXJzKCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBsb2dQcm92aWRlcnMoYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVycyA9IHRydWUpIHtcbiAgICAgICAgY29uc3QgaW50ZXJuYWxQcm92aWRlcnMgPSB0aGlzLmNvbGxlY3RCZXN0UHJvdmlkZXJzRm9yPGFueT4oe1xuICAgICAgICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVycyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFBhcmVudCBDb250YWluZXIgSWQsIFtQYXJlbnQ6ICR7dGhpcy5wYXJlbnQ/LmNvbnRhaW5lcklkfV1gKTtcblxuICAgICAgICBmb3IgKGNvbnN0IGlwIG9mIGludGVybmFsUHJvdmlkZXJzKSB7XG4gICAgICAgICAgICBsZXQgZmlsdGVyZWQgPSB7XG4gICAgICAgICAgICAgICAgLi4uaXAsXG4gICAgICAgICAgICAgICAgX2NvbnRhaW5lcjogaXAuX2NvbnRhaW5lci5jb250YWluZXJJZCxcbiAgICAgICAgICAgICAgICBfcHJvdmlkZXI6IHtcbiAgICAgICAgICAgICAgICAgICAgLi4uaXAuX3Byb3ZpZGVyLFxuICAgICAgICAgICAgICAgICAgICB1c2VDbGFzczogKGlwLl9wcm92aWRlciBhcyBhbnkpPy51c2VDbGFzcz8ubmFtZSxcbiAgICAgICAgICAgICAgICAgICAgcHJvdmlkZTogKGlwLl9wcm92aWRlci5wcm92aWRlIGFzIGFueSkubmFtZSA/IChpcC5fcHJvdmlkZXIucHJvdmlkZSBhcyBhbnkpLm5hbWUgOiBpcC5fcHJvdmlkZXIucHJvdmlkZVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgUHJvdmlkZXI6IFske2lwLl9jb250YWluZXIuY29udGFpbmVySWR9XSAtICR7aXAuX3Byb3ZpZGVyLl90b2tlbn06YCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBsb2dDYWNoZSgpIHtcbiAgICAgICAgZm9yIChjb25zdCBbIHRva2VuLCBpbnN0YW5jZSBdIG9mIHRoaXMuY2FjaGUuZW50cmllcygpKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQ2FjaGU6IFske3RoaXMuY29udGFpbmVySWR9XSAtICR7dG9rZW59OmAsIGluc3RhbmNlKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLnBhcmVudD8ubG9nQ2FjaGUoKTtcbiAgICB9XG5cbiAgICBwdWJsaWMgc2V0U2VhcmNoRW5naW5lKGVuZ2luZTogQmFzZVNlYXJjaEVuZ2luZSkge1xuICAgICAgICB0aGlzLnNlYXJjaEVuZ2luZSA9IGVuZ2luZTtcbiAgICB9XG5cbiAgICBwdWJsaWMgcmVzb2x2ZVNlYXJjaEVuZ2luZSgpOiBCYXNlU2VhcmNoRW5naW5lIHtcbiAgICAgICAgaWYgKCF0aGlzLnNlYXJjaEVuZ2luZSkge1xuXG4gICAgICAgICAgICBpZiAodGhpcy5wYXJlbnQpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5wYXJlbnQucmVzb2x2ZVNlYXJjaEVuZ2luZSgpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1NlYXJjaCBlbmdpbmUgbm90IGNvbmZpZ3VyZWQuIFBsZWFzZSBjYWxsIHNldFNlYXJjaEVuZ2luZSgpIGZpcnN0LicpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuc2VhcmNoRW5naW5lO1xuICAgIH1cbn1cbiJdfQ==