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
    static DIMetadataStore = new metadata_1.MetadataManager({ namespace: 'fw24:di' });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udGFpbmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2RpL2NvbnRhaW5lci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSwrQkFBMEM7QUFDMUMsZ0RBQW9EO0FBRXBELDhDQUEyRDtBQUMzRCw2Q0FBMEM7QUFtQjFDLHNDQU91QjtBQUV2QixtQ0FZaUI7QUFFakIseUNBS29CO0FBRXBCLG9DQUFxQztBQUVyQyxxQ0FXa0I7QUFJbEIsTUFBYSxXQUFXO0lBc0hBO0lBcEhwQixNQUFNLENBQVUsZUFBZSxHQUFHLElBQUksMEJBQWUsQ0FBQyxFQUFFLFNBQVMsRUFBRSxTQUFTLEVBQUUsQ0FBQyxDQUFDO0lBRWhFLFdBQVcsQ0FBUztJQUNuQixNQUFNLENBQVU7SUFDaEIsV0FBVyxHQUF3QixFQUFFLENBQUM7SUFDdEMsZ0JBQWdCLEdBQTZCLEVBQUUsQ0FBQztJQUV6RCxVQUFVLEdBQUcsSUFBSSxHQUFHLEVBQWUsQ0FBQztJQUM1QyxJQUFjLFNBQVM7UUFFbkIsSUFBSSxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7WUFDaEIsT0FBTyxJQUFJLENBQUMsUUFBUSxDQUFDLFNBQVMsQ0FBQztRQUNuQyxDQUFDO1FBRUQsSUFBSSxDQUFDLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQztZQUNuQixJQUFJLENBQUMsVUFBVSxHQUFHLElBQUksR0FBRyxFQUFlLENBQUM7UUFDN0MsQ0FBQztRQUNELE9BQU8sSUFBSSxDQUFDLFVBQVUsQ0FBQztJQUMzQixDQUFDO0lBRU8sTUFBTSxHQUFHLElBQUksR0FBRyxFQUFlLENBQUM7SUFDeEMsSUFBYyxLQUFLO1FBRWYsSUFBSSxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7WUFDaEIsT0FBTyxJQUFJLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQztRQUMvQixDQUFDO1FBRUQsSUFBSSxDQUFDLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQztZQUNmLElBQUksQ0FBQyxNQUFN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QVEsQ0FBQyxDQUFDO1FBQzVFLENBQUM7UUFDRCxJQUFJLENBQUMsTUFBTSxFQUFFLFFBQVEsRUFBRSxDQUFDO0lBQzVCLENBQUM7SUFFTSxlQUFlLENBQUMsTUFBd0I7UUFDM0MsSUFBSSxDQUFDLFlBQVksR0FBRyxNQUFNLENBQUM7SUFDL0IsQ0FBQztJQUVNLG1CQUFtQjtRQUN0QixJQUFJLENBQUMsSUFBSSxDQUFDLFlBQVksRUFBRSxDQUFDO1lBRXJCLElBQUksSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDO2dCQUNkLE9BQU8sSUFBSSxDQUFDLE1BQU0sQ0FBQyxtQkFBbUIsRUFBRSxDQUFDO1lBQzdDLENBQUM7WUFFRCxNQUFNLElBQUksS0FBSyxDQUFDLG9FQUFvRSxDQUFDLENBQUM7UUFDMUYsQ0FBQztRQUVELE9BQU8sSUFBSSxDQUFDLFlBQVksQ0FBQztJQUM3QixDQUFDOztBQXhvQ0wsa0NBeW9DQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IHY0IGFzIGdlbmVyYXRlVVVJRCB9IGZyb20gJ3V1aWQnO1xuaW1wb3J0IHsgTWV0YWRhdGFNYW5hZ2VyIH0gZnJvbSAnLi4vdXRpbHMvbWV0YWRhdGEnO1xuaW1wb3J0IHsgdHlwZSBEZWVwUGFydGlhbCwgdHlwZSBQYXJ0aWFsQnkgfSBmcm9tICcuLi91dGlscy90eXBlcyc7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIsIElMb2dnZXIgfSBmcm9tICcuLy4uL2xvZ2dpbmcvaW5kZXgnO1xuaW1wb3J0IHsgSW5qZWN0YWJsZSB9IGZyb20gJy4vZGVjb3JhdG9ycyc7XG5cbmltcG9ydCB7XG4gICAgQmFzZVByb3ZpZGVyT3B0aW9ucyxcbiAgICBDbGFzc0NvbnN0cnVjdG9yLFxuICAgIENsYXNzUHJvdmlkZXJPcHRpb25zLFxuICAgIENvbXBsZXhEZXBlbmRlbmN5SWRlbnRpZmllcixcbiAgICBDb25maWdQcm92aWRlck9wdGlvbnMsXG4gICAgRGVwSWRlbnRpZmllcixcbiAgICBGYWN0b3J5UHJvdmlkZXJPcHRpb25zLFxuICAgIElESUNvbnRhaW5lcixcbiAgICBJbnRlcm5hbFByb3ZpZGVyT3B0aW9ucyxcbiAgICBESU1pZGRsZXdhcmUsXG4gICAgRElNaWRkbGV3YXJlQXN5bmMsXG4gICAgUHJpb3JpdHlDcml0ZXJpYSxcbiAgICBQcm92aWRlck9wdGlvbnMsXG4gICAgVG9rZW5cbn0gZnJvbSAnLi8uLi9pbnRlcmZhY2VzL2RpJztcblxuaW1wb3J0IHtcbiAgICBpc0FsaWFzUHJvdmlkZXJPcHRpb25zLFxuICAgIGlzQ2xhc3NQcm92aWRlck9wdGlvbnMsXG4gICAgaXNDb21wbGV4RGVwZW5kZW5jeUlkZW50aWZpZXIsXG4gICAgaXNDb25maWdQcm92aWRlck9wdGlvbnMsXG4gICAgaXNGYWN0b3J5UHJvdmlkZXJPcHRpb25zLFxuICAgIGlzVmFsdWVQcm92aWRlck9wdGlvbnMsXG59IGZyb20gJy4vLi4vdXRpbHMvZGknO1xuXG5pbXBvcnQge1xuICAgIGFwcGx5TWlkZGxld2FyZXMsXG4gICAgYXBwbHlNaWRkbGV3YXJlc0FzeW5jLFxuICAgIGZpbHRlckFuZFNvcnRQcm92aWRlcnMsXG4gICAgZmxhdHRlbkNvbmZpZyxcbiAgICBnZXRQYXRoVmFsdWUsXG4gICAgaGFzQ29uc3RydWN0b3IsXG4gICAgbWFrZURJVG9rZW4sXG4gICAgbWF0Y2hlc1BhdHRlcm4sXG4gICAgc2V0UGF0aFZhbHVlLFxuICAgIHN0cmlwRElUb2tlbk5hbWVzcGFjZSxcbiAgICB2YWxpZGF0ZVByb3ZpZGVyT3B0aW9uc1xufSBmcm9tICcuL3V0aWxzJztcblxuaW1wb3J0IHtcbiAgICBnZXRDb25zdHJ1Y3RvckRlcGVuZGVuY2llc01ldGFkYXRhLFxuICAgIGdldE1vZHVsZU1ldGFkYXRhLFxuICAgIGdldE9uSW5pdEhvb2tNZXRhZGF0YSxcbiAgICBnZXRQcm9wZXJ0eURlcGVuZGVuY2llc01ldGFkYXRhLFxufSBmcm9tICcuL21ldGFkYXRhJztcblxuaW1wb3J0IHsgRElfVE9LRU5TIH0gZnJvbSAnLi4vY29uc3QnO1xuXG5pbXBvcnQge1xuICAgIENpcmN1bGFyRGVwZW5kZW5jeUVycm9yLFxuICAgIEluaXRpYWxpemF0aW9uTWV0aG9kRXJyb3IsXG4gICAgSW5pdGlhbGl6YXRpb25NZXRob2RUeXBlRXJyb3IsXG4gICAgSW52YWxpZERlcGVuZGVuY3lDcml0ZXJpYUVycm9yLFxuICAgIE1vZHVsZU1ldGFkYXRhRXJyb3IsXG4gICAgTm9FbnRpdHlTY2hlbWFQcm92aWRlckVycm9yLFxuICAgIE5vRW50aXR5U2VydmljZVByb3ZpZGVyRXJyb3IsXG4gICAgTm9Qcm92aWRlckZvdW5kRXJyb3IsXG4gICAgTm90aGluZ1RvRXhwb3J0RXJyb3IsXG4gICAgUHJvdmlkZXJDb25maWd1cmF0aW9uRXJyb3Jcbn0gZnJvbSAnLi9lcnJvcnMnO1xuaW1wb3J0IHsgQmFzZVNlYXJjaEVuZ2luZSB9IGZyb20gJy4uL3NlYXJjaCc7XG5cblxuZXhwb3J0IGNsYXNzIERJQ29udGFpbmVyIGltcGxlbWVudHMgSURJQ29udGFpbmVyIHtcblxuICAgIHN0YXRpYyByZWFkb25seSBESU1ldGFkYXRhU3RvcmUgPSBuZXcgTWV0YWRhdGFNYW5hZ2VyKHsgbmFtZXNwYWNlOiAnZncyNDpkaScgfSk7XG5cbiAgICBwdWJsaWMgcmVhZG9ubHkgY29udGFpbmVySWQ6IHN0cmluZztcbiAgICBwcml2YXRlIHJlYWRvbmx5IGxvZ2dlcjogSUxvZ2dlcjtcbiAgICBwcml2YXRlIHJlYWRvbmx5IG1pZGRsZXdhcmVzOiBESU1pZGRsZXdhcmU8YW55PltdID0gW107XG4gICAgcHJpdmF0ZSByZWFkb25seSBhc3luY01pZGRsZXdhcmVzOiBESU1pZGRsZXdhcmVBc3luYzxhbnk+W10gPSBbXTtcblxuICAgIHByaXZhdGUgX3Jlc29sdmluZyA9IG5ldyBNYXA8c3RyaW5nLCBhbnk+KCk7XG4gICAgcHJvdGVjdGVkIGdldCByZXNvbHZpbmcoKTogTWFwPHN0cmluZywgYW55PiB7XG5cbiAgICAgICAgaWYgKHRoaXMucHJveHlGb3IpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnByb3h5Rm9yLnJlc29sdmluZztcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghdGhpcy5fcmVzb2x2aW5nKSB7XG4gICAgICAgICAgICB0aGlzLl9yZXNvbHZpbmcgPSBuZXcgTWFwPHN0cmluZywgYW55PigpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLl9yZXNvbHZpbmc7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBfY2FjaGUgPSBuZXcgTWFwPHN0cmluZywgYW55PigpO1xuICAgIHByb3RlY3RlZCBnZXQgY2FjaGUoKTogTWFwPHN0cmluZywgYW55PiB7XG5cbiAgICAgICAgaWYgKHRoaXMucHJveHlGb3IpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnByb3h5Rm9yLmNhY2hlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCF0aGlzLl9jYWNoZSkge1xuICAgICAgICAgICAgdGhpcy5fY2FjaGUgPSBuZXcgTWFwPHN0cmluZywgYW55PigpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLl9jYWNoZTtcbiAgICB9XG5cbiAgICBwcml2YXRlIF9wcm92aWRlcnM6IE1hcDxzdHJpbmcsIEludGVybmFsUHJvdmlkZXJPcHRpb25zW10+IHwgdW5kZWZpbmVkO1xuICAgIGdldCBwcm92aWRlcnMoKTogTWFwPHN0cmluZywgSW50ZXJuYWxQcm92aWRlck9wdGlvbnNbXT4ge1xuXG4gICAgICAgIGlmICh0aGlzLnByb3h5Rm9yKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5wcm94eUZvci5wcm92aWRlcnM7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIXRoaXMuX3Byb3ZpZGVycykge1xuICAgICAgICAgICAgdGhpcy5fcHJvdmlkZXJzID0gbmV3IE1hcDxzdHJpbmcsIEludGVybmFsUHJvdmlkZXJPcHRpb25zW10+KCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuX3Byb3ZpZGVyc1xuICAgIH1cblxuICAgIHByaXZhdGUgX2V4cG9ydHM6IE1hcDxzdHJpbmcsIEludGVybmFsUHJvdmlkZXJPcHRpb25zW10+IHwgdW5kZWZpbmVkO1xuICAgIGdldCBleHBvcnRzKCk6IE1hcDxzdHJpbmcsIEludGVybmFsUHJvdmlkZXJPcHRpb25zW10+IHtcblxuICAgICAgICBpZiAodGhpcy5wcm94eUZvcikge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMucHJveHlGb3IuZXhwb3J0cztcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghdGhpcy5fZXhwb3J0cykge1xuICAgICAgICAgICAgdGhpcy5fZXhwb3J0cyA9IG5ldyBNYXA8c3RyaW5nLCBJbnRlcm5hbFByb3ZpZGVyT3B0aW9uc1tdPigpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLl9leHBvcnRzXG4gICAgfVxuXG4gICAgLy8gd2hlbiB0aGlzIGNvbnRhaW5lciBpcyBhIHByb3h5IGZvciBhbm90aGVyIGNvbnRhaW5lcjsgdGhlIGFub3RoZXIgY29udGFpbmVyJ3MgcmVmIHdpbGwgYmUgc3RvcmVkIGhlcmVcbiAgICBwdWJsaWMgcHJveHlGb3I6IERJQ29udGFpbmVyIHwgdW5kZWZpbmVkO1xuXG4gICAgZ2V0IHBhcmVudCgpOiBESUNvbnRhaW5lciB8IHVuZGVmaW5lZCB7XG4gICAgICAgIHJldHVybiB0aGlzLnBhcmVudENvbnRhaW5lclxuICAgIH1cblxuICAgIHByaXZhdGUgX2NoaWxkQ29udGFpbmVyczogU2V0PERJQ29udGFpbmVyPiB8IHVuZGVmaW5lZDtcbiAgICBnZXQgY2hpbGRDb250YWluZXJzKCk6IFNldDxESUNvbnRhaW5lcj4ge1xuXG4gICAgICAgIGlmICh0aGlzLnByb3h5Rm9yKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5wcm94eUZvci5jaGlsZENvbnRhaW5lcnM7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIXRoaXMuX2NoaWxkQ29udGFpbmVycykge1xuICAgICAgICAgICAgdGhpcy5fY2hpbGRDb250YWluZXJzID0gbmV3IFNldDxESUNvbnRhaW5lcj4oKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5fY2hpbGRDb250YWluZXJzXG4gICAgfVxuXG4gICAgcHJpdmF0ZSBfcHJveGllczogU2V0PERJQ29udGFpbmVyPiB8IHVuZGVmaW5lZDtcbiAgICBnZXQgcHJveGllcygpOiBTZXQ8RElDb250YWluZXI+IHtcblxuICAgICAgICBpZiAodGhpcy5wcm94eUZvcikge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMucHJveHlGb3IucHJveGllcztcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghdGhpcy5fcHJveGllcykge1xuICAgICAgICAgICAgdGhpcy5fcHJveGllcyA9IG5ldyBTZXQ8RElDb250YWluZXI+KCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuX3Byb3hpZXNcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHbG9iYWwgUk9PVCBjb250YWluZXIgc2hhcmVkIGFjcm9zcyBBTEwgZncyNCBpbnN0YW5jZXMgKGJ1bmRsZWQgKyBsYXllcikuXG4gICAgICogU3RvcmVkIGluIGdsb2JhbCBvYmplY3QgdG8gZW5zdXJlIHNpbmdsZXRvbiBiZWhhdmlvciBldmVuIHdoZW4gbXVsdGlwbGVcbiAgICAgKiBmdzI0IG1vZHVsZSBncmFwaHMgZXhpc3QgKGUuZy4sIGJ1bmRsZWQgaW4gTGFtYmRhICsgbGF5ZXIpLlxuICAgICAqL1xuICAgIHByaXZhdGUgc3RhdGljIF9yb290SW5zdGFuY2U6IERJQ29udGFpbmVyO1xuICAgIHN0YXRpYyBnZXQgUk9PVCgpOiBJRElDb250YWluZXIge1xuICAgICAgICAvLyBDaGVjayBnbG9iYWwgZmlyc3QgZm9yIGNyb3NzLWluc3RhbmNlIHNoYXJpbmdcbiAgICAgICAgY29uc3QgZ2xvYmFsUm9vdCA9IChnbG9iYWwgYXMgYW55KS5fX2Z3MjRfZGlfcm9vdF9jb250YWluZXJfXztcbiAgICAgICAgaWYgKGdsb2JhbFJvb3QpIHtcbiAgICAgICAgICAgIHJldHVybiBnbG9iYWxSb290O1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ3JlYXRlIGlmIGRvZXNuJ3QgZXhpc3RcbiAgICAgICAgaWYgKCF0aGlzLl9yb290SW5zdGFuY2UpIHtcbiAgICAgICAgICAgIHRoaXMuX3Jvb3RJbnN0YW5jZSA9IG5ldyBESUNvbnRhaW5lcigpO1xuICAgICAgICAgICAgLy8gU3RvcmUgaW4gZ2xvYmFsIGZvciBjcm9zcy1pbnN0YW5jZSBhY2Nlc3NcbiAgICAgICAgICAgIChnbG9iYWwgYXMgYW55KS5fX2Z3MjRfZGlfcm9vdF9jb250YWluZXJfXyA9IHRoaXMuX3Jvb3RJbnN0YW5jZTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5fcm9vdEluc3RhbmNlO1xuICAgIH1cblxuICAgIHByaXZhdGUgc2VhcmNoRW5naW5lPzogQmFzZVNlYXJjaEVuZ2luZTtcblxuICAgIGNvbnN0cnVjdG9yKHByaXZhdGUgcGFyZW50Q29udGFpbmVyPzogRElDb250YWluZXIsIGlkZW50aWZpZXI6IHN0cmluZyA9ICdST09UJykge1xuICAgICAgICAvLyB0byBlbnN1cmUgZGVzdHJ1Y3R1cmluZyB3b3JrcyBjb3JyZWN0bHlcbiAgICAgICAgdGhpcy5JbmplY3RhYmxlID0gdGhpcy5JbmplY3RhYmxlLmJpbmQodGhpcyk7XG4gICAgICAgIHRoaXMuY29udGFpbmVySWQgPSBpZGVudGlmaWVyO1xuICAgICAgICB0aGlzLmxvZ2dlciA9IGNyZWF0ZUxvZ2dlcihgRElDb250YWluZXJbJHtpZGVudGlmaWVyfV1gKTtcbiAgICB9XG5cbiAgICBJbmplY3RhYmxlKG9wdGlvbnM6IFBhcnRpYWxCeTxCYXNlUHJvdmlkZXJPcHRpb25zLCAncHJvdmlkZSc+ID0ge30pIHtcbiAgICAgICAgcmV0dXJuIEluamVjdGFibGUoeyAuLi5vcHRpb25zLCBwcm92aWRlZEluOiB0aGlzIH0pO1xuICAgIH1cblxuICAgIGNyZWF0ZUNoaWxkQ29udGFpbmVyKGlkZW50aWZpZXI6IHN0cmluZyk6IERJQ29udGFpbmVyIHtcbiAgICAgICAgY29uc3QgY2hpbGQgPSBuZXcgRElDb250YWluZXIodGhpcywgaWRlbnRpZmllcik7XG4gICAgICAgIHRoaXMuY2hpbGRDb250YWluZXJzLmFkZChjaGlsZCk7XG4gICAgICAgIHJldHVybiBjaGlsZDtcbiAgICB9XG5cbiAgICBwcm90ZWN0ZWQgY3JlYXRlQ2hpbGRDb250YWluZXJQcm94eUlkZW50aWZpZXIocGFyZW50Q29udGFpbmVyOiBESUNvbnRhaW5lcik6IHN0cmluZyB7XG4gICAgICAgIHJldHVybiBgJHt0aGlzLmNvbnRhaW5lcklkfTpQcm94eUluWyR7cGFyZW50Q29udGFpbmVyLmNvbnRhaW5lcklkfV1gXG4gICAgfVxuXG4gICAgcHJvdGVjdGVkIGFkZFByb3h5Q29udGFpbmVySW4gPSAocGFyZW50Q29udGFpbmVyOiBESUNvbnRhaW5lcik6IERJQ29udGFpbmVyID0+IHtcblxuICAgICAgICBjb25zdCBwcm94eUNvbnRhaW5lcklkID0gdGhpcy5jcmVhdGVDaGlsZENvbnRhaW5lclByb3h5SWRlbnRpZmllcihwYXJlbnRDb250YWluZXIpO1xuXG4gICAgICAgIC8vIG1ha2Ugc3VyZSB0byByZW1vdmUgb2xkIHByb3h5IGZyb20gdGhlIGltcG9ydGluZyBtb2R1bGUgaWYgZXhpc3RzXG4gICAgICAgIGlmIChwYXJlbnRDb250YWluZXIuaGFzQ2hpbGRDb250YWluZXJCeUlkKHByb3h5Q29udGFpbmVySWQpKSB7XG5cbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBGb3VuZCBvbGQgcHJveHkgY29udGFpbmVyOiBbJHtwcm94eUNvbnRhaW5lcklkfV0gaW4gcGFyZW50OiBbJHtwYXJlbnRDb250YWluZXIuY29udGFpbmVySWR9XTsgcmVwbGFjaW5nIGl0YCk7XG5cbiAgICAgICAgICAgIGNvbnN0IG9sZFByb3h5Q29udGFpbmVyID0gcGFyZW50Q29udGFpbmVyLmdldENoaWxkQ29udGFpbmVyQnlJZChwcm94eUNvbnRhaW5lcklkKTtcblxuICAgICAgICAgICAgcGFyZW50Q29udGFpbmVyLnJlbW92ZUNoaWxkQ29udGFpbmVyQnlJZChwcm94eUNvbnRhaW5lcklkKTtcblxuICAgICAgICAgICAgdGhpcy5wcm94aWVzLmRlbGV0ZShvbGRQcm94eUNvbnRhaW5lcik7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBuZXdQcm94eUNvbnRhaW5lciA9IHBhcmVudENvbnRhaW5lci5jcmVhdGVDaGlsZENvbnRhaW5lcihwcm94eUNvbnRhaW5lcklkKTtcblxuICAgICAgICBuZXdQcm94eUNvbnRhaW5lci5wcm94eUZvciA9IHRoaXM7XG5cbiAgICAgICAgdGhpcy5wcm94aWVzLmFkZChuZXdQcm94eUNvbnRhaW5lcik7XG5cbiAgICAgICAgcmV0dXJuIG5ld1Byb3h5Q29udGFpbmVyO1xuICAgIH1cblxuICAgIGhhc0NoaWxkQ29udGFpbmVyQnlJZChpZGVudGlmaWVyOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICAgICAgbGV0IGZvdW5kID0gQXJyYXkuZnJvbSh0aGlzLmNoaWxkQ29udGFpbmVycykuc29tZShcbiAgICAgICAgICAgIGVsZW1lbnQgPT4gZWxlbWVudC5jb250YWluZXJJZC5zdGFydHNXaXRoKGlkZW50aWZpZXIpXG4gICAgICAgICk7XG5cbiAgICAgICAgaWYgKCFmb3VuZCAmJiB0aGlzLmNoaWxkQ29udGFpbmVycy5zaXplID4gMCkge1xuICAgICAgICAgICAgZm91bmQgPSBBcnJheS5mcm9tKHRoaXMuY2hpbGRDb250YWluZXJzKS5zb21lKGNjID0+IGNjLmhhc0NoaWxkQ29udGFpbmVyQnlJZChpZGVudGlmaWVyKSk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gZm91bmQ7XG4gICAgfVxuXG4gICAgcmVtb3ZlQ2hpbGRDb250YWluZXJCeUlkKGlkZW50aWZpZXI6IHN0cmluZyk6IHZvaWQge1xuICAgICAgICBjb25zdCBjaGlsZENvbnRhaW5lciA9IHRoaXMuZ2V0Q2hpbGRDb250YWluZXJCeUlkKGlkZW50aWZpZXIpO1xuICAgICAgICB0aGlzLmNoaWxkQ29udGFpbmVycy5kZWxldGUoY2hpbGRDb250YWluZXIpO1xuICAgIH1cblxuICAgIGdldENoaWxkQ29udGFpbmVyQnlJZChpZGVudGlmaWVyOiBzdHJpbmcpOiBhbnkge1xuICAgICAgICBsZXQgZm91bmRDb250YWluZXIgPSBBcnJheS5mcm9tKHRoaXMuY2hpbGRDb250YWluZXJzKS5maW5kKGVsZW1lbnQgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIGVsZW1lbnQuY29udGFpbmVySWQuc3RhcnRzV2l0aChpZGVudGlmaWVyKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKCFmb3VuZENvbnRhaW5lciAmJiB0aGlzLmNoaWxkQ29udGFpbmVycy5zaXplID4gMCkge1xuICAgICAgICAgICAgZm9yIChjb25zdCBjYyBvZiB0aGlzLmNoaWxkQ29udGFpbmVycykge1xuICAgICAgICAgICAgICAgIGZvdW5kQ29udGFpbmVyID0gY2MuZ2V0Q2hpbGRDb250YWluZXJCeUlkKGlkZW50aWZpZXIpO1xuICAgICAgICAgICAgICAgIGlmIChmb3VuZENvbnRhaW5lcikge1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gZm91bmRDb250YWluZXI7XG4gICAgfVxuXG4gICAgbW9kdWxlKHRhcmdldDogQ2xhc3NDb25zdHJ1Y3Rvcikge1xuXG4gICAgICAgIGNvbnN0IG1vZHVsZU1ldGEgPSBnZXRNb2R1bGVNZXRhZGF0YSh0YXJnZXQpO1xuXG4gICAgICAgIGlmICghbW9kdWxlTWV0YSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IE1vZHVsZU1ldGFkYXRhRXJyb3IodGFyZ2V0Lm5hbWUsIHRoaXMuY29udGFpbmVySWQpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgeyBpbXBvcnRzID0gW10sIGV4cG9ydHMgPSBbXSwgcHJvdmlkZXJzID0gW10sIGlkZW50aWZpZXIgfSA9IG1vZHVsZU1ldGE7XG5cbiAgICAgICAgLy8gaWYgdGhlcmUncyBubyBjb250YWluZXIgaW4gdGhlIG1vZHVsZSBtZXRhZGF0YSwgY3JlYXRlIHRoZSBtYWluIGNvbnRhaW5lciBmb3IgdGhlIG1vZHVsZVxuICAgICAgICBpZiAoIW1vZHVsZU1ldGEuaGFzQ29udGFpbmVyKCkpIHtcblxuICAgICAgICAgICAgY29uc3QgbW9kdWxlQ29udGFpbmVyID0gbmV3IERJQ29udGFpbmVyKHVuZGVmaW5lZCwgaWRlbnRpZmllcik7XG4gICAgICAgICAgICAvLyB0aGlzLmxvZ2dlci5pbmZvKGBNb2R1bGUgJHttb2R1bGVNZXRhLmlkZW50aWZpZXJ9IG1ldGFkYXRhIGRvZXMgbm90IGhhdmUgYSBjb250YWluZXIsIGFzc2lnbmluZyBvbmUuYCwgeyBpZDogbW9kdWxlQ29udGFpbmVyLmNvbnRhaW5lcklkIH0pO1xuXG4gICAgICAgICAgICBtb2R1bGVNZXRhLnNldENvbnRhaW5lcihtb2R1bGVDb250YWluZXIpO1xuXG4gICAgICAgICAgICAvLyBtYWtlIHN1cmUgYWxsIHRoZSBtb2R1bGUgcHJvdmlkZXJzIGFyZSBsb2FkZWQgaW50byB0aGUgbW9kdWxlJ3MgY29udGFpbmVyJ3MgcHJvdmlkZXJzXG4gICAgICAgICAgICBmb3IgKGNvbnN0IHByb3ZpZGVyIG9mIHByb3ZpZGVycykge1xuICAgICAgICAgICAgICAgIG1vZHVsZUNvbnRhaW5lci5yZWdpc3Rlcihwcm92aWRlcik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyBhbmQgbWFrZSBzdXJlIGFsbCB0aGUgbW9kdWxlIGV4cG9ydHMgYXJlIGFsc28gbG9hZGVkIGludG8gdGhlIG1vZHVsZSdzIGNvbnRhaW5lcidzIHByb3ZpZGVyc1xuICAgICAgICAgICAgZm9yIChjb25zdCBpbXBvcnRlZE1vZHVsZSBvZiBpbXBvcnRzKSB7XG4gICAgICAgICAgICAgICAgbW9kdWxlQ29udGFpbmVyLm1vZHVsZShpbXBvcnRlZE1vZHVsZSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIGxvYWQgYWxsIHRoZSBleHBvcnQgZnJvbSB0aGlzIG1vZHVsZSBpbnRvIHRoZSBjdXJyZW50IGNvbnRhaW5lclxuICAgICAgICAgICAgZm9yIChjb25zdCBleHBvcnRlZERlcCBvZiBleHBvcnRzKSB7XG4gICAgICAgICAgICAgICAgbW9kdWxlQ29udGFpbmVyLmV4cG9ydFByb3ZpZGVyc0ZvcihleHBvcnRlZERlcCk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIFRPRE86IG1vZHVsZSBsaWZlY3ljbGUgaG9va3NcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IG1vZHVsZVByb3h5Q29udGFpbmVyID0gKG1vZHVsZU1ldGEuY29udGFpbmVyIGFzIERJQ29udGFpbmVyKS5hZGRQcm94eUNvbnRhaW5lckluKHRoaXMpO1xuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBpZGVudGlmaWVyLFxuICAgICAgICAgICAgY29udGFpbmVyOiBtb2R1bGVQcm94eUNvbnRhaW5lclxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHVibGljIGV4cG9ydFByb3ZpZGVyc0ZvcjxUPihleHBvcnRlZERlcDogRGVwSWRlbnRpZmllcjxUPikge1xuICAgICAgICBjb25zdCB0b2tlbiA9IHRoaXMuY3JlYXRlVG9rZW4oZXhwb3J0ZWREZXApO1xuXG4gICAgICAgIGxldCBmb3VuZFByb3ZpZGVyc0ZvclRva2VuID0gZmFsc2U7XG5cbiAgICAgICAgLy8gQ29sbGVjdCBwcm92aWRlcnMgZGlyZWN0bHkgbWF0Y2hpbmcgdGhlIGV4cG9ydCB0b2tlblxuICAgICAgICBjb25zdCBhdmFpbGFibGVQcm92aWRlcnMgPSB0aGlzLnByb3ZpZGVycy5nZXQodG9rZW4pIHx8IFtdO1xuICAgICAgICBjb25zdCBjaGlsZEV4cG9ydGVkUHJvdmlkZXJzID0gQXJyYXkuZnJvbSh0aGlzLmNoaWxkQ29udGFpbmVycylcbiAgICAgICAgICAgIC5mbGF0TWFwKGNoaWxkID0+IGNoaWxkLmV4cG9ydHMuZ2V0KHRva2VuKSB8fCBbXSk7XG5cbiAgICAgICAgLy8gQ29tYmluZSBhdmFpbGFibGUgcHJvdmlkZXJzIGFuZCBjaGlsZCBleHBvcnRlZCBwcm92aWRlcnNcbiAgICAgICAgY29uc3QgYWxsUHJvdmlkZXJzID0gWyAuLi5hdmFpbGFibGVQcm92aWRlcnMsIC4uLmNoaWxkRXhwb3J0ZWRQcm92aWRlcnMgXTtcblxuICAgICAgICAvLyBOZXN0ZWQgZnVuY3Rpb24gdG8gbWFwIGFuZCBleHBvcnQgcHJvdmlkZXJzXG4gICAgICAgIGNvbnN0IG1hcEFuZEV4cG9ydFByb3ZpZGVycyA9IChwcm92aWRlcnM6IEludGVybmFsUHJvdmlkZXJPcHRpb25zW10sIHRhcmdldFRva2VuOiBzdHJpbmcpID0+IHtcblxuICAgICAgICAgICAgZm91bmRQcm92aWRlcnNGb3JUb2tlbiA9IHRydWU7XG5cbiAgICAgICAgICAgIGNvbnN0IGV4cG9ydGVkID0gcHJvdmlkZXJzLm1hcChwcm92aWRlciA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgeyBfY29udGFpbmVyLCBfcHJvdmlkZXIsIF9pZCB9ID0gcHJvdmlkZXI7XG4gICAgICAgICAgICAgICAgY29uc3QgeyBjb25kaXRpb24sIHByb3ZpZGUsIHByaW9yaXR5LCBvdmVycmlkZSwgc2luZ2xldG9uLCB0YWdzLCB0eXBlLCBmb3JFbnRpdHkgfSA9IF9wcm92aWRlcjtcblxuICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgIF9wcm92aWRlcjoge1xuICAgICAgICAgICAgICAgICAgICAgICAgdXNlRmFjdG9yeTogKCkgPT4gX2NvbnRhaW5lci5yZXNvbHZlKHByb3ZpZGUpLFxuICAgICAgICAgICAgICAgICAgICAgICAgY29uZGl0aW9uLFxuICAgICAgICAgICAgICAgICAgICAgICAgcHJvdmlkZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHByaW9yaXR5LFxuICAgICAgICAgICAgICAgICAgICAgICAgb3ZlcnJpZGUsXG4gICAgICAgICAgICAgICAgICAgICAgICBzaW5nbGV0b24sXG4gICAgICAgICAgICAgICAgICAgICAgICB0YWdzLFxuICAgICAgICAgICAgICAgICAgICAgICAgdHlwZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvckVudGl0eSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgX2lkLFxuICAgICAgICAgICAgICAgICAgICBfY29udGFpbmVyOiB0aGlzXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAvLyBNZXJnZSBvciBzZXQgdGhlc2UgZXhwb3J0ZWQgcHJvdmlkZXJzIHVuZGVyIHRoZWlyIHJlc3BlY3RpdmUga2V5c1xuICAgICAgICAgICAgY29uc3QgZXhpc3RpbmdFeHBvcnRzID0gdGhpcy5leHBvcnRzLmdldCh0YXJnZXRUb2tlbikgfHwgW107XG4gICAgICAgICAgICB0aGlzLmV4cG9ydHMuc2V0KHRhcmdldFRva2VuLCBbIC4uLmV4aXN0aW5nRXhwb3J0cywgLi4uZXhwb3J0ZWQgXSk7XG4gICAgICAgIH07XG5cbiAgICAgICAgaWYgKGFsbFByb3ZpZGVycy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAvLyBFeHBvcnQgdGhlIHN0YW5kYXJkIGFuZCBjb25maWcgcHJvdmlkZXJzIGRpcmVjdGx5IG1hdGNoaW5nIHRoZSB0b2tlblxuICAgICAgICAgICAgbWFwQW5kRXhwb3J0UHJvdmlkZXJzKGFsbFByb3ZpZGVycywgdG9rZW4pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRmluZCBhbGwgY29uZmlnIHByb3ZpZGVycyB3aG9zZSBrZXlzIHN0YXJ0IHdpdGggdGhlIHRva2VuIGFuZCBleHBvcnQgdGhlbVxuICAgICAgICBmb3IgKGNvbnN0IFsgY29uZmlnS2V5LCBjb25maWdQcm92aWRlcnMgXSBvZiB0aGlzLnByb3ZpZGVycy5lbnRyaWVzKCkpIHtcbiAgICAgICAgICAgIGlmIChjb25maWdLZXkuc3RhcnRzV2l0aCh0b2tlbikgJiYgY29uZmlnUHJvdmlkZXJzLnNvbWUocCA9PiBwLl9wcm92aWRlci50eXBlID09PSAnY29uZmlnJykpIHtcbiAgICAgICAgICAgICAgICBtYXBBbmRFeHBvcnRQcm92aWRlcnMoY29uZmlnUHJvdmlkZXJzLCBjb25maWdLZXkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFmb3VuZFByb3ZpZGVyc0ZvclRva2VuKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgTm90aGluZ1RvRXhwb3J0RXJyb3IodG9rZW4sIHRoaXMuY29udGFpbmVySWQpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgY3JlYXRlVG9rZW48VD4odG9rZW5PclR5cGU6IERlcElkZW50aWZpZXI8VD4pOiBUb2tlbiB7XG4gICAgICAgIC8vIG1heWJlIGFkZCBhIG1lY2hhbmlzbSBmb3IgYWRkaW5nIGV4dHJhIG1ldGFkYXRhIHRvIHRoZSB0b2tlbiBsaWtlIGNvbnRhaW5lciBJRCBhbmQgc3R1ZmY/XG4gICAgICAgIHJldHVybiBtYWtlRElUb2tlbih0b2tlbk9yVHlwZSk7XG4gICAgfVxuXG4gICAgcmVnaXN0ZXI8VD4ob3B0aW9uczogUHJvdmlkZXJPcHRpb25zPFQ+LCBjb250YWluZXI6IERJQ29udGFpbmVyID0gdGhpcyk6IHsgcHJvdmlkZTogVG9rZW4sIG9wdGlvbnM6IFByb3ZpZGVyT3B0aW9uczxUPiB9IHwgdW5kZWZpbmVkIHtcbiAgICAgICAgaWYgKGNvbnRhaW5lciAhPT0gdGhpcykge1xuICAgICAgICAgICAgcmV0dXJuIGNvbnRhaW5lci5yZWdpc3RlcihvcHRpb25zKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHRva2VuID0gdGhpcy5jcmVhdGVUb2tlbihvcHRpb25zLnByb3ZpZGUpO1xuXG4gICAgICAgIGNvbnN0IG9wdGlvbnNDb3B5ID0ge1xuICAgICAgICAgICAgLi4ub3B0aW9ucyxcbiAgICAgICAgICAgIHR5cGU6IG9wdGlvbnMudHlwZSB8fCAndW5rbm93bicsXG4gICAgICAgICAgICBwcmlvcml0eTogb3B0aW9ucy5wcmlvcml0eSAhPT0gdW5kZWZpbmVkID8gb3B0aW9ucy5wcmlvcml0eSA6IDAsXG4gICAgICAgICAgICBzaW5nbGV0b246IG9wdGlvbnMuc2luZ2xldG9uICE9PSB1bmRlZmluZWQgPyBvcHRpb25zLnNpbmdsZXRvbiA6IHRydWUsXG4gICAgICAgIH07XG5cbiAgICAgICAgaWYgKG9wdGlvbnNDb3B5LmNvbmRpdGlvbiAmJiAhb3B0aW9uc0NvcHkuY29uZGl0aW9uKCkpIHJldHVybjtcblxuICAgICAgICB2YWxpZGF0ZVByb3ZpZGVyT3B0aW9ucyhvcHRpb25zQ29weSwgdG9rZW4pO1xuXG4gICAgICAgIC8vIEhhbmRsZSBjb25maWcgcHJvdmlkZXJzXG4gICAgICAgIGlmIChpc0NvbmZpZ1Byb3ZpZGVyT3B0aW9ucyhvcHRpb25zKSkge1xuICAgICAgICAgICAgdGhpcy5yZWdpc3RlckNvbmZpZ1Byb3ZpZGVyKG9wdGlvbnMpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5yZWdpc3RlclByb3ZpZGVyKHsgX3Byb3ZpZGVyOiBvcHRpb25zQ29weSB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBwcm92aWRlOiB0b2tlbixcbiAgICAgICAgICAgIG9wdGlvbnM6IG9wdGlvbnNDb3B5LFxuICAgICAgICB9O1xuICAgIH1cblxuICAgIHJlZ2lzdGVyQ29uZmlnUHJvdmlkZXIob3B0aW9uczogQ29uZmlnUHJvdmlkZXJPcHRpb25zKSB7XG4gICAgICAgIGNvbnN0IHsgdXNlQ29uZmlnLCBwcm92aWRlOiBwcm92aWRlLCAuLi5yZXN0IH0gPSBvcHRpb25zO1xuXG4gICAgICAgIGxldCBwcm92aWRlVG9rZW4gPSBzdHJpcERJVG9rZW5OYW1lc3BhY2UodGhpcy5jcmVhdGVUb2tlbihwcm92aWRlKSk7XG4gICAgICAgIGNvbnN0IGZsYXR0ZW5lZEVudHJpZXMgPSBmbGF0dGVuQ29uZmlnKHVzZUNvbmZpZywgcHJvdmlkZVRva2VuKTtcblxuICAgICAgICBmb3IgKGNvbnN0IFsgY29uZmlnUGF0aCwgdmFsdWUgXSBvZiBmbGF0dGVuZWRFbnRyaWVzKSB7XG4gICAgICAgICAgICB0aGlzLnJlZ2lzdGVyUHJvdmlkZXIoe1xuICAgICAgICAgICAgICAgIF9wcm92aWRlcjoge1xuICAgICAgICAgICAgICAgICAgICAuLi5yZXN0LFxuICAgICAgICAgICAgICAgICAgICB0eXBlOiAnY29uZmlnJyxcbiAgICAgICAgICAgICAgICAgICAgcHJvdmlkZTogY29uZmlnUGF0aCxcbiAgICAgICAgICAgICAgICAgICAgdXNlQ29uZmlnOiB2YWx1ZSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcm90ZWN0ZWQgcmVnaXN0ZXJQcm92aWRlcihvcHRpb25zOiBQYXJ0aWFsQnk8SW50ZXJuYWxQcm92aWRlck9wdGlvbnMsICdfaWQnIHwgJ19jb250YWluZXInPikge1xuICAgICAgICBjb25zdCBjdXJyZW50UHJvdmlkZXIgPSBvcHRpb25zLl9wcm92aWRlcjtcbiAgICAgICAgY29uc3QgdG9rZW4gPSB0aGlzLmNyZWF0ZVRva2VuKGN1cnJlbnRQcm92aWRlci5wcm92aWRlKTtcbiAgICAgICAgY3VycmVudFByb3ZpZGVyLl90b2tlbiA9IHRva2VuO1xuXG4gICAgICAgIGNvbnN0IHRva2VuUHJvdmlkZXJzID0gdGhpcy5wcm92aWRlcnMuZ2V0KHRva2VuKSB8fCBbXTtcblxuICAgICAgICBjb25zdCBhcmVCb3RoVmFsdWVzRXF1YWwgPSA8VD4odmFsdWUxOiBUIHwgbnVsbCB8IHVuZGVmaW5lZCwgdmFsdWUyOiBUIHwgbnVsbCB8IHVuZGVmaW5lZCk6IGJvb2xlYW4gPT4ge1xuICAgICAgICAgICAgcmV0dXJuICh2YWx1ZTEgPT0gbnVsbCAmJiB2YWx1ZTIgPT0gbnVsbCkgfHwgKHZhbHVlMSAhPT0gbnVsbCAmJiB2YWx1ZTEgIT09IHVuZGVmaW5lZCAmJiB2YWx1ZTEgPT09IHZhbHVlMik7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBhcmVCb3RoQXJyYXlzRXF1YWwgPSA8VD4oYXJyMTogVFtdIHwgbnVsbCB8IHVuZGVmaW5lZCwgYXJyMjogVFtdIHwgbnVsbCB8IHVuZGVmaW5lZCk6IGJvb2xlYW4gPT4ge1xuICAgICAgICAgICAgaWYgKGFycjEgPT0gbnVsbCAmJiBhcnIyID09IG51bGwpIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgaWYgKGFycjEgPT0gbnVsbCB8fCBhcnIyID09IG51bGwgfHwgYXJyMS5sZW5ndGggIT09IGFycjIubGVuZ3RoKSByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICByZXR1cm4gWyAuLi5hcnIxIF0uc29ydCgpLmV2ZXJ5KCh2YWx1ZSwgaW5kZXgpID0+IHZhbHVlID09PSBhcnIyLnNsaWNlKCkuc29ydCgpWyBpbmRleCBdKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGlmIHRva2VuIHByb3ZpZGVycyBhbHJlYWR5IGhhcyBhIHByb3ZpZGVyIHdpdGggc2FtZSBwcmlvcml0eSwgdHlwZSwgZm9yRW50aXR5IGFuZCB0YWdzLCBsb2cgd2FybmluZyBhbmQgcmVwbGFjZSBpdFxuICAgICAgICBjb25zdCBleGlzdGluZ1Byb3ZpZGVyID0gdG9rZW5Qcm92aWRlcnMuZmluZCgoeyBfcHJvdmlkZXI6IGV4aXN0aW5nUHJvdmlkZXIgfSkgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIGV4aXN0aW5nUHJvdmlkZXIucHJpb3JpdHkgPT09IGN1cnJlbnRQcm92aWRlci5wcmlvcml0eVxuICAgICAgICAgICAgICAgICYmIGFyZUJvdGhWYWx1ZXNFcXVhbChleGlzdGluZ1Byb3ZpZGVyLnR5cGUsIGN1cnJlbnRQcm92aWRlci50eXBlKVxuICAgICAgICAgICAgICAgICYmIGFyZUJvdGhBcnJheXNFcXVhbChleGlzdGluZ1Byb3ZpZGVyLnRhZ3MsIGN1cnJlbnRQcm92aWRlci50YWdzKSAvLyAhIG1heWJlIGJlIG1ha2UgaXQgY29uZmlndXJhYmxlIHRvIGNvbXBhcmUgdGFncy4uLlxuICAgICAgICAgICAgICAgICYmIGFyZUJvdGhWYWx1ZXNFcXVhbChleGlzdGluZ1Byb3ZpZGVyLmZvckVudGl0eSwgY3VycmVudFByb3ZpZGVyLmZvckVudGl0eSlcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKGV4aXN0aW5nUHJvdmlkZXIpIHtcbiAgICAgICAgICAgIC8vIGNvbnN0IGluZGV4ID0gdG9rZW5Qcm92aWRlcnMuaW5kZXhPZihleGlzdGluZ1Byb3ZpZGVyKTtcbiAgICAgICAgICAgIC8vIGRlbGV0ZSB0aGUgZXhpc3RpbmcgcHJvdmlkZXJcbiAgICAgICAgICAgIC8vIHRva2VuUHJvdmlkZXJzLnNwbGljZShpbmRleCwgMSk7XG5cbiAgICAgICAgICAgIC8vIERPIE5PVCByZXBsYWNlIHRoZSBleGlzdGluZyBwcm92aWRlciwganVzdCBsb2cgYSB3YXJuaW5nXG4gICAgICAgICAgICAvLyB0aGlzLmxvZ2dlci53YXJuKGBQcm92aWRlciBmb3IgJHt0b2tlbn0gd2l0aCBzYW1lIHByaW9yaXR5LCB0eXBlLCBmb3JFbnRpdHkgYW5kIHRhZ3MgYWxyZWFkeSBleGlzdHMsIHJlcGxhY2luZyBpdC4gfCBPcHRpb25zWyR7SlNPTi5zdHJpbmdpZnkob3B0aW9ucyl9XWApO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgaW50ZXJuYWxQcm92aWRlck9wdGlvbnMgPSB7XG4gICAgICAgICAgICAuLi5vcHRpb25zLFxuICAgICAgICAgICAgX2lkOiBnZW5lcmF0ZVVVSUQoKSxcbiAgICAgICAgICAgIF9jb250YWluZXI6IHRoaXMsXG4gICAgICAgIH07XG5cbiAgICAgICAgdG9rZW5Qcm92aWRlcnMucHVzaChpbnRlcm5hbFByb3ZpZGVyT3B0aW9ucyk7XG4gICAgICAgIHRoaXMucHJvdmlkZXJzLnNldCh0b2tlbiwgdG9rZW5Qcm92aWRlcnMpO1xuICAgIH1cblxuICAgIHJlbW92ZVByb3ZpZGVyc0ZvcihkZXBlbmRlbmN5VG9rZW46IERlcElkZW50aWZpZXIpIHtcbiAgICAgICAgY29uc3QgdG9rZW4gPSB0aGlzLmNyZWF0ZVRva2VuKGRlcGVuZGVuY3lUb2tlbik7XG4gICAgICAgIGNvbnN0IHByb3ZpZGVycyA9IHRoaXMucHJvdmlkZXJzLmdldCh0b2tlbikgfHwgW107XG4gICAgICAgIHByb3ZpZGVycy5mb3JFYWNoKHByb3ZpZGVyID0+IHtcbiAgICAgICAgICAgIHRoaXMuY2FjaGUuZGVsZXRlKHByb3ZpZGVyLl9pZCEpO1xuICAgICAgICB9KTtcbiAgICAgICAgdGhpcy5wcm92aWRlcnMuZGVsZXRlKHRva2VuKTtcbiAgICB9XG5cbiAgICAvLyBSZXNvbHZlIGEgY29uZmlndXJhdGlvbiBwYXRoIHdpdGggZmxleGlibGUgY3JpdGVyaWEsIHN1cHBvcnRpbmcgd2lsZGNhcmRzIGFuZCByZWdleFxuICAgIHJlc29sdmVDb25maWc8VCA9IGFueT4oXG4gICAgICAgIHF1ZXJ5OiBzdHJpbmcgPSAnJyxcbiAgICAgICAgY3JpdGVyaWE/OiB7XG4gICAgICAgICAgICBwcmlvcml0eT86IFByaW9yaXR5Q3JpdGVyaWE7XG4gICAgICAgICAgICB0YWdzPzogc3RyaW5nW107XG4gICAgICAgIH1cbiAgICApOiBEZWVwUGFydGlhbDxUPiB7XG5cbiAgICAgICAgcXVlcnkgPSBzdHJpcERJVG9rZW5OYW1lc3BhY2UocXVlcnkpO1xuXG4gICAgICAgIGNvbnN0IG1hdGNoaW5nUGF0aHMgPSB0aGlzLmNvbGxlY3RNYXRjaGluZ0NvbmZpZ1BhdGhzKHF1ZXJ5KTtcblxuICAgICAgICBjb25zdCByZXNvbHZlZFZhbHVlcyA9IHRoaXMucmVzb2x2ZUNvbmZpZ1BhdGhzKG1hdGNoaW5nUGF0aHMsIGNyaXRlcmlhKTtcblxuICAgICAgICAvLyBNZXJnZSByZXNvbHZlZCB2YWx1ZXMgaW50byBhIGZpbmFsIGNvbmZpZ3VyYXRpb24gb2JqZWN0XG4gICAgICAgIGNvbnN0IG1lcmdlZENvbmZpZzogUmVjb3JkPGFueSwgYW55PiA9IHt9O1xuXG4gICAgICAgIHJlc29sdmVkVmFsdWVzLmZvckVhY2goKHZhbHVlLCBwYXRoKSA9PiB7XG4gICAgICAgICAgICBwYXRoID0gc3RyaXBESVRva2VuTmFtZXNwYWNlKHBhdGgpO1xuICAgICAgICAgICAgc2V0UGF0aFZhbHVlKG1lcmdlZENvbmZpZywgcGF0aCwgdmFsdWUpO1xuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gZ2V0UGF0aFZhbHVlKG1lcmdlZENvbmZpZywgcXVlcnkpIGFzIERlZXBQYXJ0aWFsPFQ+O1xuICAgIH1cblxuICAgIC8vIENvbGxlY3QgYWxsIHBhdGhzIHRoYXQgbWF0Y2ggdGhlIHF1ZXJ5LCBzdXBwb3J0aW5nIHdpbGRjYXJkcyBhbmQgcmVnZXhcbiAgICBwcml2YXRlIGNvbGxlY3RNYXRjaGluZ0NvbmZpZ1BhdGhzKHF1ZXJ5OiBzdHJpbmcpOiBTZXQ8c3RyaW5nPiB7XG4gICAgICAgIGNvbnN0IG1hdGNoaW5nUGF0aHM6IFNldDxzdHJpbmc+ID0gbmV3IFNldCgpO1xuXG4gICAgICAgIGNvbnN0IHByb2Nlc3NLZXlzID0gKGtleXM6IEl0ZXJhYmxlSXRlcmF0b3I8c3RyaW5nPikgPT4ge1xuICAgICAgICAgICAgZm9yIChjb25zdCBwYXRoIG9mIGtleXMpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBhY3R1YWxQYXRoID0gc3RyaXBESVRva2VuTmFtZXNwYWNlKHBhdGgpO1xuICAgICAgICAgICAgICAgIGlmIChtYXRjaGVzUGF0dGVybihhY3R1YWxQYXRoLCBxdWVyeSkpIHtcbiAgICAgICAgICAgICAgICAgICAgbWF0Y2hpbmdQYXRocy5hZGQocGF0aCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuXG4gICAgICAgIGxldCBjdXJyZW50OiBESUNvbnRhaW5lciB8IHVuZGVmaW5lZCA9IHRoaXM7XG5cbiAgICAgICAgd2hpbGUgKGN1cnJlbnQpIHtcbiAgICAgICAgICAgIC8vIENoZWNrIHRoZSBwcm92aWRlcnMgaW4gdGhlIGN1cnJlbnQgY29udGFpbmVyXG4gICAgICAgICAgICBwcm9jZXNzS2V5cyhjdXJyZW50LnByb3ZpZGVycy5rZXlzKCkpO1xuXG4gICAgICAgICAgICAvLyBDaGVjayB0aGUgZXhwb3J0ZWQgcHJvdmlkZXJzIGZyb20gY2hpbGQgY29udGFpbmVyc1xuICAgICAgICAgICAgY3VycmVudC5jaGlsZENvbnRhaW5lcnMuZm9yRWFjaChjaGlsZCA9PiB7XG4gICAgICAgICAgICAgICAgcHJvY2Vzc0tleXMoY2hpbGQuZXhwb3J0cy5rZXlzKCkpO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIC8vIE1vdmUgdG8gdGhlIHBhcmVudCBjb250YWluZXJcbiAgICAgICAgICAgIGN1cnJlbnQgPSBjdXJyZW50LnBhcmVudDtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBtYXRjaGluZ1BhdGhzO1xuICAgIH1cblxuICAgIC8vIFJlc29sdmUgdmFsdWVzIGZvciBhbGwgbWF0Y2hpbmcgcGF0aHMgdXNpbmcgdGhlIGJlc3QgcHJvdmlkZXIgZnJvbSB0aGUgaGllcmFyY2h5IGJhc2VkIG9uIGNyaXRlcmlhXG4gICAgcHJpdmF0ZSByZXNvbHZlQ29uZmlnUGF0aHMoXG4gICAgICAgIHBhdGhzOiBTZXQ8c3RyaW5nPixcbiAgICAgICAgY3JpdGVyaWE/OiB7XG4gICAgICAgICAgICBwcmlvcml0eT86IFByaW9yaXR5Q3JpdGVyaWE7XG4gICAgICAgICAgICB0YWdzPzogc3RyaW5nW107XG4gICAgICAgICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzPzogYm9vbGVhblxuICAgICAgICB9XG4gICAgKTogTWFwPHN0cmluZywgYW55PiB7XG5cbiAgICAgICAgY29uc3QgcmVzb2x2ZWRWYWx1ZXMgPSBuZXcgTWFwPHN0cmluZywgYW55PigpO1xuXG4gICAgICAgIGNvbnN0IHJlZHVjZVByb3ZpZGVycyA9IChwcm92aWRlcnM6IEludGVybmFsUHJvdmlkZXJPcHRpb25zW10pOiBhbnkgPT4ge1xuICAgICAgICAgICAgaWYgKHByb3ZpZGVycy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBBc3N1bWUgdGhlIGhpZ2hlc3QtcHJpb3JpdHkgcHJvdmlkZXIncyB2YWx1ZSBpcyB0aGUgZGVzaXJlZCBvbmVcbiAgICAgICAgICAgIGNvbnN0IGJlc3RQcm92aWRlciA9IHByb3ZpZGVyc1sgMCBdLl9wcm92aWRlciBhcyBDb25maWdQcm92aWRlck9wdGlvbnM8YW55PjtcbiAgICAgICAgICAgIHJldHVybiBiZXN0UHJvdmlkZXIudXNlQ29uZmlnXG4gICAgICAgIH1cblxuICAgICAgICBwYXRocy5mb3JFYWNoKChwYXRoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBiZXN0UHJvdmlkZXJzID0gdGhpcy5jb2xsZWN0QmVzdFByb3ZpZGVyc0ZvcjxDb25maWdQcm92aWRlck9wdGlvbnM+KHtcbiAgICAgICAgICAgICAgICAuLi5jcml0ZXJpYSxcbiAgICAgICAgICAgICAgICB0b2tlbjogcGF0aCxcbiAgICAgICAgICAgICAgICB0eXBlOiAnY29uZmlnJ1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnN0IHJlc29sdmVkVmFsdWUgPSByZWR1Y2VQcm92aWRlcnMoYmVzdFByb3ZpZGVycyk7XG5cbiAgICAgICAgICAgIHJlc29sdmVkVmFsdWVzLnNldChwYXRoLCByZXNvbHZlZFZhbHVlKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIHJlc29sdmVkVmFsdWVzO1xuICAgIH1cblxuICAgIC8vIENvbGxlY3QgYWxsIHByb3ZpZGVycyBmb3IgYSBnaXZlbiBwYXRoIGFjcm9zcyB0aGUgaGllcmFyY2h5XG4gICAgcHVibGljIGNvbGxlY3RCZXN0UHJvdmlkZXJzRm9yPFQ+KFxuICAgICAgICBjcml0ZXJpYToge1xuICAgICAgICAgICAgdG9rZW4/OiBzdHJpbmcsXG4gICAgICAgICAgICB0YWdzPzogc3RyaW5nW10sXG4gICAgICAgICAgICB0eXBlPzogUHJvdmlkZXJPcHRpb25zWyAndHlwZScgXSxcbiAgICAgICAgICAgIHByaW9yaXR5PzogUHJpb3JpdHlDcml0ZXJpYSxcbiAgICAgICAgICAgIGZvckVudGl0eT86IFByb3ZpZGVyT3B0aW9uc1sgJ2ZvckVudGl0eScgXSxcbiAgICAgICAgICAgIGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnM/OiBib29sZWFuXG4gICAgICAgIH1cbiAgICApOiBJbnRlcm5hbFByb3ZpZGVyT3B0aW9uczxUPltdIHtcbiAgICAgICAgY29uc3QgYmVzdFByb3ZpZGVycyA9IG5ldyBNYXA8c3RyaW5nLCBJbnRlcm5hbFByb3ZpZGVyT3B0aW9uczxUPj4oKTtcblxuICAgICAgICBsZXQgY3VycmVudDogRElDb250YWluZXIgfCB1bmRlZmluZWQgPSB0aGlzO1xuICAgICAgICBsZXQgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVycyA9IGNyaXRlcmlhLmFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnMgfHwgZmFsc2U7XG5cbiAgICAgICAgY29uc3QgdmlzaXRlZENvbnRhaW5lcnMgPSBuZXcgU2V0PERJQ29udGFpbmVyPigpO1xuXG4gICAgICAgIGNvbnN0IGNyaXRlcmlhU3RyaW5nID0gSlNPTi5zdHJpbmdpZnkoY3JpdGVyaWEpO1xuXG4gICAgICAgIHdoaWxlIChjdXJyZW50KSB7XG4gICAgICAgICAgICBpZiAodmlzaXRlZENvbnRhaW5lcnMuaGFzKGN1cnJlbnQpKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDaXJjdWxhciByZWZlcmVuY2UgZGV0ZWN0ZWQgaW4gY29udGFpbmVyIGhpZXJhcmNoeS4gRElDb250YWluZXJbJHt0aGlzLmNvbnRhaW5lcklkfV0gfCBDcml0ZXJpYTogWyR7Y3JpdGVyaWFTdHJpbmd9XWApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdmlzaXRlZENvbnRhaW5lcnMuYWRkKGN1cnJlbnQpO1xuXG4gICAgICAgICAgICBsZXQgcGF0aFByb3ZpZGVycyA9IGNyaXRlcmlhLnRva2VuXG4gICAgICAgICAgICAgICAgPyBjdXJyZW50LnByb3ZpZGVycy5nZXQoY3JpdGVyaWEudG9rZW4pIHx8IFtdXG4gICAgICAgICAgICAgICAgOiBBcnJheS5mcm9tKGN1cnJlbnQucHJvdmlkZXJzLnZhbHVlcygpKS5mbGF0KCk7XG5cbiAgICAgICAgICAgIGlmIChjcml0ZXJpYT8udHlwZSkge1xuICAgICAgICAgICAgICAgIHBhdGhQcm92aWRlcnMgPSBwYXRoUHJvdmlkZXJzLmZpbHRlcihwID0+IHAuX3Byb3ZpZGVyLnR5cGUgPT09IGNyaXRlcmlhLnR5cGUpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoY3JpdGVyaWE/LmZvckVudGl0eSkge1xuICAgICAgICAgICAgICAgIHBhdGhQcm92aWRlcnMgPSBwYXRoUHJvdmlkZXJzLmZpbHRlcihwID0+IHAuX3Byb3ZpZGVyLmZvckVudGl0eSA9PT0gY3JpdGVyaWEuZm9yRW50aXR5KVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBwYXRoUHJvdmlkZXJzLmZvckVhY2gocHJvdmlkZXIgPT4ge1xuXG4gICAgICAgICAgICAgICAgaWYgKGJlc3RQcm92aWRlcnMuaGFzKHByb3ZpZGVyLl9pZCkpIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gdGhpcy5sb2dnZXIuaW5mbyhgUHJvdmlkZXIgd2l0aCBpZCAke3Byb3ZpZGVyLl9pZH0gYWxyZWFkeSBleGlzdHMgaW4gYmVzdC1wcm92aWRlcnMsIHNraXBwaW5nIGl0LiB8IENyaXRlcmlhOiBbJHtjcml0ZXJpYVN0cmluZ31dYCk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBiZXN0UHJvdmlkZXJzLnNldChwcm92aWRlci5faWQsIHtcbiAgICAgICAgICAgICAgICAgICAgLi4ucHJvdmlkZXIsXG4gICAgICAgICAgICAgICAgICAgIC8vIHdoZW4gaXQncyBhIHByb3h5IGNvbnRhaW5lciBtYWtlIHN1cmUgdGhlIHByb3ZpZGVyIGhhcyBpdCdzIHJlZmVyZW5jZSBmb3IgcmVzb2x2aW5nIGl0IGxhdGVyLFxuICAgICAgICAgICAgICAgICAgICAvLyB0aGF0IHdheSB0aGUgcHJvdmlkZXIgaXMgcmVzb2x2ZWQgdXNpbmcgdGhlIHJpZ2h0IGhpZXJhcmNoeVxuICAgICAgICAgICAgICAgICAgICBfY29udGFpbmVyOiBjdXJyZW50IGFzIERJQ29udGFpbmVyXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgLy8gQ29sbGVjdCBleHBvcnRlZCBwcm92aWRlcnMgZnJvbSBjaGlsZCBjb250YWluZXJzXG4gICAgICAgICAgICBjdXJyZW50LmNoaWxkQ29udGFpbmVycy5mb3JFYWNoKGNoaWxkID0+IHtcblxuICAgICAgICAgICAgICAgIC8vIGFzIHdlJ3JlIG1vdmluZyBmcm9tIGNoaWxkIHRvIHBhcmVudCwgbWFrZSBzdXJlIHRvIHNraXAgb3ZlciB0aGUgdmlzaXRlZCBjb250YWluZXJzXG4gICAgICAgICAgICAgICAgaWYgKHZpc2l0ZWRDb250YWluZXJzLmhhcyhjaGlsZCkpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHZpc2l0ZWRDb250YWluZXJzLmFkZChjaGlsZCk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgY29uc3QgY2hpbGRQcm92aWRlcnMgPSBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzID8gY2hpbGQucHJvdmlkZXJzIDogY2hpbGQuZXhwb3J0cztcblxuICAgICAgICAgICAgICAgIGxldCBjaGlsZEV4cG9ydGVkUHJvdmlkZXJzID0gY3JpdGVyaWEudG9rZW4gPyAoY2hpbGRQcm92aWRlcnMuZ2V0KGNyaXRlcmlhLnRva2VuKSB8fCBbXSlcbiAgICAgICAgICAgICAgICAgICAgOiBBcnJheS5mcm9tKGNoaWxkUHJvdmlkZXJzLnZhbHVlcygpKS5mbGF0KCk7XG5cbiAgICAgICAgICAgICAgICBpZiAoY3JpdGVyaWE/LnR5cGUpIHtcbiAgICAgICAgICAgICAgICAgICAgY2hpbGRFeHBvcnRlZFByb3ZpZGVycyA9IGNoaWxkRXhwb3J0ZWRQcm92aWRlcnMuZmlsdGVyKHAgPT4gcC5fcHJvdmlkZXIudHlwZSA9PT0gY3JpdGVyaWEudHlwZSk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKGNyaXRlcmlhPy5mb3JFbnRpdHkpIHtcbiAgICAgICAgICAgICAgICAgICAgY2hpbGRFeHBvcnRlZFByb3ZpZGVycyA9IGNoaWxkRXhwb3J0ZWRQcm92aWRlcnMuZmlsdGVyKHAgPT4gcC5fcHJvdmlkZXIuZm9yRW50aXR5ID09PSBjcml0ZXJpYS5mb3JFbnRpdHkpXG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgY2hpbGRFeHBvcnRlZFByb3ZpZGVycy5mb3JFYWNoKHByb3ZpZGVyID0+IHtcblxuICAgICAgICAgICAgICAgICAgICBpZiAoYmVzdFByb3ZpZGVycy5oYXMocHJvdmlkZXIuX2lkKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gdGhpcy5sb2dnZXIuaW5mbyhgUHJvdmlkZXIgd2l0aCBpZCAke3Byb3ZpZGVyLl9pZH0gYWxyZWFkeSBleGlzdHMgaW4gYmVzdC1wcm92aWRlcnMsIHNraXBwaW5nIGV4cG9ydGVkLXByb3ZpZGVyIGZyb20gY2hpbGQgY29udGFpbmVyOiAke2NoaWxkLmNvbnRhaW5lcklkfSB8IENyaXRlcmlhOiBbJHtjcml0ZXJpYVN0cmluZ31dYCk7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICBiZXN0UHJvdmlkZXJzLnNldChwcm92aWRlci5faWQsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC4uLnByb3ZpZGVyLFxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gd2hlbiBpdCdzIGEgcHJveHkgY29udGFpbmVyIG1ha2Ugc3VyZSB0aGUgcHJvdmlkZXIgaGFzIGl0J3MgcmVmZXJlbmNlIGZvciByZXNvbHZpbmcgaXQgbGF0ZXIsXG4gICAgICAgICAgICAgICAgICAgICAgICBfY29udGFpbmVyOiBjaGlsZFxuICAgICAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGN1cnJlbnQgPSBjdXJyZW50LnBhcmVudDtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEZpbHRlciBhbmQgc29ydCBwcm92aWRlcnMgYmFzZWQgb24gY3JpdGVyaWEgYW5kIGNvbmZsaWN0IHJlc29sdXRpb24gc3RyYXRlZ2llc1xuICAgICAgICBjb25zdCBiZXN0UHJvdmlkZXJzQXJyYXkgPSBBcnJheS5mcm9tKGJlc3RQcm92aWRlcnMudmFsdWVzKCkpO1xuICAgICAgICBjb25zdCBmaWx0ZXJlZEFuZFNvcnRlZCA9IGZpbHRlckFuZFNvcnRQcm92aWRlcnMoYmVzdFByb3ZpZGVyc0FycmF5LCBjcml0ZXJpYSk7XG5cbiAgICAgICAgLy8gRGVkdXBsaWNhdGUgcHJvdmlkZXJzIGJ5IGNvbXBvc2l0ZSBrZXkgKHByb3ZpZGUsIHR5cGUsIGZvckVudGl0eSlcbiAgICAgICAgLy8gS2VlcCBvbmx5IHRoZSBoaWdoZXN0IHByaW9yaXR5IHByb3ZpZGVyIGZvciBlYWNoIHVuaXF1ZSBjb21iaW5hdGlvblxuICAgICAgICBjb25zdCB1bmlxdWVQcm92aWRlcnMgPSBuZXcgTWFwPHN0cmluZywgSW50ZXJuYWxQcm92aWRlck9wdGlvbnM8VD4+KCk7XG5cbiAgICAgICAgZm9yIChjb25zdCBwcm92aWRlciBvZiBmaWx0ZXJlZEFuZFNvcnRlZCkge1xuICAgICAgICAgICAgLy8gQ3JlYXRlIGEgY29tcG9zaXRlIGtleSBmcm9tIHByb3ZpZGUgdG9rZW4sIHR5cGUsIGFuZCBmb3JFbnRpdHlcbiAgICAgICAgICAgIGNvbnN0IHByb3ZpZGVUb2tlbiA9IHRoaXMuY3JlYXRlVG9rZW4ocHJvdmlkZXIuX3Byb3ZpZGVyLnByb3ZpZGUpO1xuICAgICAgICAgICAgY29uc3QgdHlwZSA9IHByb3ZpZGVyLl9wcm92aWRlci50eXBlIHx8ICdkZWZhdWx0JztcbiAgICAgICAgICAgIGNvbnN0IGZvckVudGl0eSA9IHByb3ZpZGVyLl9wcm92aWRlci5mb3JFbnRpdHkgfHwgJyc7XG4gICAgICAgICAgICBjb25zdCBjb21wb3NpdGVLZXkgPSBgJHtwcm92aWRlVG9rZW59Ojoke3R5cGV9Ojoke2ZvckVudGl0eX1gO1xuXG4gICAgICAgICAgICBpZiAoIXVuaXF1ZVByb3ZpZGVycy5oYXMoY29tcG9zaXRlS2V5KSkge1xuICAgICAgICAgICAgICAgIHVuaXF1ZVByb3ZpZGVycy5zZXQoY29tcG9zaXRlS2V5LCBwcm92aWRlcik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyBOb3RlOiBTaW5jZSBmaWx0ZXJlZEFuZFNvcnRlZCBpcyBhbHJlYWR5IHNvcnRlZCBieSBwcmlvcml0eSAoaGlnaGVzdCBmaXJzdCksXG4gICAgICAgICAgICAvLyB0aGUgZmlyc3QgcHJvdmlkZXIgd2UgZW5jb3VudGVyIGZvciBlYWNoIGNvbXBvc2l0ZSBrZXkgaXMgdGhlIGJlc3Qgb25lXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gQXJyYXkuZnJvbSh1bmlxdWVQcm92aWRlcnMudmFsdWVzKCkpO1xuICAgIH1cblxuICAgIHJlc29sdmU8VCwgQXN5bmMgZXh0ZW5kcyBib29sZWFuID0gZmFsc2U+KFxuICAgICAgICBkZXBlbmRlbmN5VG9rZW46IERlcElkZW50aWZpZXI8VD4sXG4gICAgICAgIGNyaXRlcmlhPzoge1xuICAgICAgICAgICAgdGFncz86IHN0cmluZ1tdO1xuICAgICAgICAgICAgdHlwZT86IFByb3ZpZGVyT3B0aW9uc1sgJ3R5cGUnIF0sXG4gICAgICAgICAgICBwcmlvcml0eT86IFByaW9yaXR5Q3JpdGVyaWE7XG4gICAgICAgICAgICBmb3JFbnRpdHk/OiBQcm92aWRlck9wdGlvbnNbICdmb3JFbnRpdHknIF0sXG4gICAgICAgICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzPzogYm9vbGVhblxuICAgICAgICB9LFxuICAgICAgICBwYXRoOiBTZXQ8VG9rZW4+ID0gbmV3IFNldCgpLFxuICAgICAgICBhc3luYzogQXN5bmMgPSBmYWxzZSBhcyBBc3luY1xuICAgICk6IEFzeW5jIGV4dGVuZHMgdHJ1ZSA/IFByb21pc2U8VD4gOiBUIHtcblxuICAgICAgICBjb25zdCB0b2tlbiA9IHRoaXMuY3JlYXRlVG9rZW4oZGVwZW5kZW5jeVRva2VuKTtcbiAgICAgICAgY3JpdGVyaWEgPSBjcml0ZXJpYSA/PyB7fTtcblxuICAgICAgICAvLyBpZiB0b2tlbiBpcyBgRElDb250YWluZXJgIHJldHVybiB0aGUgY3VycmVudCBjb250YWluZXJcbiAgICAgICAgaWYgKERJX1RPS0VOUy5ESV9DT05UQUlORVIgPT09IHRva2VuIHx8IHRoaXMuY3JlYXRlVG9rZW4oRElDb250YWluZXIpID09PSB0b2tlbikge1xuICAgICAgICAgICAgcmV0dXJuIChhc3luYyA/IFByb21pc2UucmVzb2x2ZSh0aGlzKSA6IHRoaXMpIGFzIEFzeW5jIGV4dGVuZHMgdHJ1ZSA/IFByb21pc2U8VD4gOiBUO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgYmVzdFByb3ZpZGVycyA9IHRoaXMuY29sbGVjdEJlc3RQcm92aWRlcnNGb3I8VD4oe1xuICAgICAgICAgICAgLi4uY3JpdGVyaWEsXG4gICAgICAgICAgICB0b2tlbixcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKGJlc3RQcm92aWRlcnMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgTm9Qcm92aWRlckZvdW5kRXJyb3IodG9rZW4sIHRoaXMsIGNyaXRlcmlhKTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBvcHRpb25zID0gYmVzdFByb3ZpZGVyc1sgMCBdO1xuXG4gICAgICAgIHJldHVybiB0aGlzLnJlc29sdmVQcm92aWRlclZhbHVlPFQsIEFzeW5jPihvcHRpb25zLCBwYXRoLCBhc3luYyk7XG4gICAgfVxuXG4gICAgcmVzb2x2ZVByb3ZpZGVyVmFsdWU8VCwgQXN5bmMgZXh0ZW5kcyBib29sZWFuID0gZmFsc2U+KFxuICAgICAgICBvcHRpb25zOiBJbnRlcm5hbFByb3ZpZGVyT3B0aW9uczxUPixcbiAgICAgICAgcGF0aDogU2V0PFRva2VuPiA9IG5ldyBTZXQoKSxcbiAgICAgICAgYXN5bmM6IEFzeW5jID0gZmFsc2UgYXMgQXN5bmNcbiAgICApOiBBc3luYyBleHRlbmRzIHRydWUgPyBQcm9taXNlPFQ+IDogVCB7XG5cbiAgICAgICAgY29uc3QgeyBfaWQsIF9jb250YWluZXIsIF9wcm92aWRlcjogcHJvdmlkZXIgfSA9IG9wdGlvbnM7XG5cbiAgICAgICAgaWYgKF9jb250YWluZXIgIT09IHRoaXMpIHtcbiAgICAgICAgICAgIHJldHVybiAoX2NvbnRhaW5lciBhcyBESUNvbnRhaW5lcikucmVzb2x2ZVByb3ZpZGVyVmFsdWUob3B0aW9ucywgcGF0aCwgYXN5bmMpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHByb3ZpZGVyLnNpbmdsZXRvbiAmJiB0aGlzLmNhY2hlLmhhcyhfaWQpKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5jYWNoZS5nZXQoX2lkKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0aGlzLnJlc29sdmluZy5oYXMoX2lkKSkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMucmVzb2x2aW5nLmdldChfaWQpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHBhdGguaGFzKF9pZCkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBDaXJjdWxhckRlcGVuZGVuY3lFcnJvcihBcnJheS5mcm9tKHBhdGgpLCB0aGlzLmNvbnRhaW5lcklkKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHBhdGguYWRkKF9pZCk7XG5cbiAgICAgICAgaWYgKGFzeW5jKSB7XG4gICAgICAgICAgICByZXR1cm4gYXBwbHlNaWRkbGV3YXJlc0FzeW5jKFxuICAgICAgICAgICAgICAgIHRoaXMuYXN5bmNNaWRkbGV3YXJlcyxcbiAgICAgICAgICAgICAgICAoKSA9PiB0aGlzLmNyZWF0ZUFuZENhY2hlSW5zdGFuY2VBc3luYzxUPihvcHRpb25zLCBwYXRoKVxuICAgICAgICAgICAgKSBhcyBBc3luYyBleHRlbmRzIHRydWUgPyBQcm9taXNlPFQ+IDogVDtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBhcHBseU1pZGRsZXdhcmVzKFxuICAgICAgICAgICAgdGhpcy5taWRkbGV3YXJlcyxcbiAgICAgICAgICAgICgpID0+IHRoaXMuY3JlYXRlQW5kQ2FjaGVJbnN0YW5jZShvcHRpb25zLCBwYXRoKVxuICAgICAgICApIGFzIEFzeW5jIGV4dGVuZHMgdHJ1ZSA/IFByb21pc2U8VD4gOiBUO1xuICAgIH1cblxuICAgIHByaXZhdGUgY3JlYXRlQW5kQ2FjaGVJbnN0YW5jZTxUPihvcHRpb25zOiBJbnRlcm5hbFByb3ZpZGVyT3B0aW9uczxUPiwgcGF0aDogU2V0PFRva2VuPik6IFQge1xuXG4gICAgICAgIGNvbnN0IHsgX2lkLCBfcHJvdmlkZXI6IHByb3ZpZGVyIH0gPSBvcHRpb25zO1xuXG4gICAgICAgIGNvbnN0IGluc3RhbmNlID0gdGhpcy5jcmVhdGVJbnN0YW5jZShvcHRpb25zLCBwYXRoKTtcbiAgICAgICAgaWYgKHByb3ZpZGVyLnNpbmdsZXRvbikge1xuICAgICAgICAgICAgdGhpcy5jYWNoZS5zZXQoX2lkLCBpbnN0YW5jZSk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLnJlc29sdmluZy5kZWxldGUoX2lkKTtcblxuICAgICAgICB0aGlzLmluamVjdFByb3BlcnRpZXMoaW5zdGFuY2UpO1xuICAgICAgICB0aGlzLmluaXRpYWxpemVJbnN0YW5jZShpbnN0YW5jZSk7XG5cbiAgICAgICAgcGF0aC5kZWxldGUoX2lkKTtcblxuICAgICAgICByZXR1cm4gaW5zdGFuY2U7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBjcmVhdGVJbnN0YW5jZTxULCBBc3luYyBleHRlbmRzIGJvb2xlYW4gPSBmYWxzZT4oXG4gICAgICAgIG9wdGlvbnM6IEludGVybmFsUHJvdmlkZXJPcHRpb25zPFQ+LFxuICAgICAgICBwYXRoOiBTZXQ8VG9rZW4+LFxuICAgICAgICBhc3luYzogQXN5bmMgPSBmYWxzZSBhcyBBc3luY1xuICAgICk6IEFzeW5jIGV4dGVuZHMgdHJ1ZSA/IFByb21pc2U8VD4gOiBUIHtcblxuICAgICAgICBjb25zdCB7IF9pZCwgX3Byb3ZpZGVyOiBwcm92aWRlciB9ID0gb3B0aW9ucztcblxuICAgICAgICBpZiAoaXNBbGlhc1Byb3ZpZGVyT3B0aW9ucyhwcm92aWRlcikpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnJlc29sdmUocHJvdmlkZXIudXNlRXhpc3RpbmcsIHt9LCBwYXRoLCBhc3luYyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoaXNDbGFzc1Byb3ZpZGVyT3B0aW9ucyhwcm92aWRlcikpIHtcblxuICAgICAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICAgICAgICBhc3luYyA/IHRoaXMuY3JlYXRlQ2xhc3NJbnN0YW5jZTxULCB0cnVlPihvcHRpb25zLCBwYXRoLCB0cnVlKVxuICAgICAgICAgICAgICAgICAgICA6IHRoaXMuY3JlYXRlQ2xhc3NJbnN0YW5jZShvcHRpb25zLCBwYXRoKVxuICAgICAgICAgICAgKSBhcyBBc3luYyBleHRlbmRzIHRydWUgPyBQcm9taXNlPFQ+IDogVDtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChpc0ZhY3RvcnlQcm92aWRlck9wdGlvbnMocHJvdmlkZXIpKSB7XG5cbiAgICAgICAgICAgIHJldHVybiAoXG4gICAgICAgICAgICAgICAgYXN5bmMgPyB0aGlzLmNyZWF0ZUZhY3RvcnlJbnN0YW5jZUFzeW5jPFQ+KHByb3ZpZGVyLCBwYXRoKVxuICAgICAgICAgICAgICAgICAgICA6IHRoaXMuY3JlYXRlRmFjdG9yeUluc3RhbmNlKHByb3ZpZGVyLCBwYXRoKVxuICAgICAgICAgICAgKSBhcyBBc3luYyBleHRlbmRzIHRydWUgPyBQcm9taXNlPFQ+IDogVDtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChpc1ZhbHVlUHJvdmlkZXJPcHRpb25zKHByb3ZpZGVyKSkge1xuICAgICAgICAgICAgcmV0dXJuIHByb3ZpZGVyLnVzZVZhbHVlIGFzIEFzeW5jIGV4dGVuZHMgdHJ1ZSA/IFByb21pc2U8VD4gOiBUO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGlzQ29uZmlnUHJvdmlkZXJPcHRpb25zKHByb3ZpZGVyKSkge1xuICAgICAgICAgICAgcmV0dXJuIHByb3ZpZGVyLnVzZUNvbmZpZyBhcyBBc3luYyBleHRlbmRzIHRydWUgPyBQcm9taXNlPFQ+IDogVDtcbiAgICAgICAgfVxuXG4gICAgICAgIHRocm93IG5ldyBQcm92aWRlckNvbmZpZ3VyYXRpb25FcnJvcihfaWQsIHRoaXMuY29udGFpbmVySWQpO1xuICAgIH1cblxuICAgIHByaXZhdGUgY3JlYXRlQ2xhc3NJbnN0YW5jZTxULCBBc3luYyBleHRlbmRzIGJvb2xlYW4gPSBmYWxzZT4oXG4gICAgICAgIG9wdGlvbnM6IEludGVybmFsUHJvdmlkZXJPcHRpb25zPFQ+LFxuICAgICAgICBwYXRoOiBTZXQ8VG9rZW4+LFxuICAgICAgICBhc3luYzogQXN5bmMgPSBmYWxzZSBhcyBBc3luY1xuICAgICk6IEFzeW5jIGV4dGVuZHMgdHJ1ZSA/IFByb21pc2U8VD4gOiBUIHtcblxuICAgICAgICBjb25zdCB7IF9pZCwgX3Byb3ZpZGVyOiBwcm92aWRlciB9ID0gb3B0aW9ucztcblxuICAgICAgICBpZiAodGhpcy5yZXNvbHZpbmcuaGFzKF9pZCkpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnJlc29sdmluZy5nZXQoX2lkKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHsgdXNlQ2xhc3MgfSA9IHByb3ZpZGVyIGFzIENsYXNzUHJvdmlkZXJPcHRpb25zPFQ+O1xuXG4gICAgICAgIC8vIENyZWF0ZSBhIHBsYWNlaG9sZGVyIG9iamVjdCBhbmQgc3RvcmUgaXQgaW4gdGhlIHJlc29sdmluZyBtYXBcbiAgICAgICAgY29uc3QgaW5zdGFuY2VQbGFjZWhvbGRlcjogVCA9IE9iamVjdC5jcmVhdGUodXNlQ2xhc3MucHJvdG90eXBlKTtcbiAgICAgICAgdGhpcy5yZXNvbHZpbmcuc2V0KF9pZCwgaW5zdGFuY2VQbGFjZWhvbGRlcik7XG5cblxuICAgICAgICBpZiAoYXN5bmMpIHtcbiAgICAgICAgICAgIHRoaXMucmVzb2x2ZURlcGVuZGVuY2llc0FzeW5jKHVzZUNsYXNzLCBwYXRoKS50aGVuKGRlcGVuZGVuY2llcyA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgYWN0dWFsSW5zdGFuY2UgPSBuZXcgdXNlQ2xhc3MoLi4uZGVwZW5kZW5jaWVzKTtcbiAgICAgICAgICAgICAgICBPYmplY3QuYXNzaWduKGluc3RhbmNlUGxhY2Vob2xkZXIgYXMgYW55LCBhY3R1YWxJbnN0YW5jZSk7XG4gICAgICAgICAgICAgICAgdGhpcy5yZXNvbHZpbmcuc2V0KF9pZCwgYWN0dWFsSW5zdGFuY2UpO1xuICAgICAgICAgICAgICAgIHJldHVybiBhY3R1YWxJbnN0YW5jZTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBkZXBlbmRlbmNpZXMgPSB0aGlzLnJlc29sdmVEZXBlbmRlbmNpZXModXNlQ2xhc3MsIHBhdGgpO1xuICAgICAgICBjb25zdCBhY3R1YWxJbnN0YW5jZSA9IG5ldyB1c2VDbGFzcyguLi5kZXBlbmRlbmNpZXMpO1xuICAgICAgICBPYmplY3QuYXNzaWduKGluc3RhbmNlUGxhY2Vob2xkZXIgYXMgYW55LCBhY3R1YWxJbnN0YW5jZSk7XG4gICAgICAgIHRoaXMucmVzb2x2aW5nLnNldChfaWQsIGFjdHVhbEluc3RhbmNlKTtcblxuICAgICAgICByZXR1cm4gYWN0dWFsSW5zdGFuY2UgYXMgQXN5bmMgZXh0ZW5kcyB0cnVlID8gUHJvbWlzZTxUPiA6IFQ7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBjcmVhdGVGYWN0b3J5SW5zdGFuY2U8VD4ob3B0aW9uczogRmFjdG9yeVByb3ZpZGVyT3B0aW9uczxUPiwgcGF0aDogU2V0PFRva2VuPik6IFQge1xuICAgICAgICBjb25zdCBkZXBlbmRlbmNpZXMgPSAob3B0aW9ucy5kZXBzIHx8IFtdKS5tYXAoZGVwID0+IHRoaXMucmVzb2x2ZURlcGVuZGVuY3koZGVwLCBwYXRoKSk7XG4gICAgICAgIHJldHVybiBvcHRpb25zLnVzZUZhY3RvcnkoLi4uZGVwZW5kZW5jaWVzKTtcbiAgICB9XG5cbiAgICBnZXRDbGFzc0RlcGVuZGVuY2llcyh0YXJnZXQ6IENsYXNzQ29uc3RydWN0b3IpIHtcbiAgICAgICAgY29uc3QgY29uc3RydWN0b3JEZXBlbmRlbmNpZXMgPSBnZXRDb25zdHJ1Y3RvckRlcGVuZGVuY2llc01ldGFkYXRhKHRhcmdldCk7XG4gICAgICAgIGNvbnN0IHByb3BlcnR5RGVwZW5kZW5jaWVzID0gZ2V0UHJvcGVydHlEZXBlbmRlbmNpZXNNZXRhZGF0YSh0YXJnZXQpO1xuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBwcm9wZXJ0eURlcGVuZGVuY2llcyxcbiAgICAgICAgICAgIGNvbnN0cnVjdG9yRGVwZW5kZW5jaWVzXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIHJlc29sdmVEZXBlbmRlbmN5PFQsIEFzeW5jIGV4dGVuZHMgYm9vbGVhbiA9IGZhbHNlPihcbiAgICAgICAgZGVwOiBEZXBJZGVudGlmaWVyIHwgQ29tcGxleERlcGVuZGVuY3lJZGVudGlmaWVyLFxuICAgICAgICBwYXRoOiBTZXQ8VG9rZW4+LFxuICAgICAgICBhc3luYzogQXN5bmMgPSBmYWxzZSBhcyBBc3luY1xuICAgICk6IEFzeW5jIGV4dGVuZHMgdHJ1ZSA/IFByb21pc2U8VD4gOiBUIHtcblxuICAgICAgICBsZXQgbm9ybWFsaXplZERlcCA9IGRlcDtcblxuICAgICAgICBpZiAoIWlzQ29tcGxleERlcGVuZGVuY3lJZGVudGlmaWVyKG5vcm1hbGl6ZWREZXApKSB7XG4gICAgICAgICAgICBub3JtYWxpemVkRGVwID0geyB0b2tlbjogbm9ybWFsaXplZERlcCB9IGFzIENvbXBsZXhEZXBlbmRlbmN5SWRlbnRpZmllcjtcbiAgICAgICAgfVxuXG4gICAgICAgIHRyeSB7XG5cbiAgICAgICAgICAgIGlmIChub3JtYWxpemVkRGVwLmlzQ29uZmlnKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMucmVzb2x2ZUNvbmZpZyhub3JtYWxpemVkRGVwLnRva2VuIGFzIHN0cmluZywgbm9ybWFsaXplZERlcCkgYXMgQXN5bmMgZXh0ZW5kcyB0cnVlID8gUHJvbWlzZTxUPiA6IFQ7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChub3JtYWxpemVkRGVwLmZvckVudGl0eSkge1xuICAgICAgICAgICAgICAgIGlmIChub3JtYWxpemVkRGVwLnR5cGUgPT0gJ3NjaGVtYScpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMucmVzb2x2ZUVudGl0eVNjaGVtYShub3JtYWxpemVkRGVwLmZvckVudGl0eSwgbm9ybWFsaXplZERlcCwgYXN5bmMpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmIChub3JtYWxpemVkRGVwLnR5cGUgPT0gJ3NlcnZpY2UnKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLnJlc29sdmVFbnRpdHlTZXJ2aWNlKG5vcm1hbGl6ZWREZXAuZm9yRW50aXR5LCBub3JtYWxpemVkRGVwLCBhc3luYylcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEludmFsaWREZXBlbmRlbmN5Q3JpdGVyaWFFcnJvcihKU09OLnN0cmluZ2lmeShub3JtYWxpemVkRGVwKSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiB0aGlzLnJlc29sdmU8VCwgQXN5bmM+KG5vcm1hbGl6ZWREZXAudG9rZW4sIG5vcm1hbGl6ZWREZXAsIHBhdGgsIGFzeW5jKVxuXG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcblxuICAgICAgICAgICAgaWYgKFxuICAgICAgICAgICAgICAgIGUgaW5zdGFuY2VvZiBOb1Byb3ZpZGVyRm91bmRFcnJvclxuICAgICAgICAgICAgICAgICYmXG4gICAgICAgICAgICAgICAgKG5vcm1hbGl6ZWREZXAuaXNPcHRpb25hbCB8fCBub3JtYWxpemVkRGVwLmRlZmF1bHRWYWx1ZSAhPT0gdW5kZWZpbmVkKVxuICAgICAgICAgICAgKSB7XG4gICAgICAgICAgICAgICAgLy8gdGhpcy5sb2dnZXIuaW5mbyhgTm8gcHJvdmlkZXIgZm91bmQgZm9yICR7SlNPTi5zdHJpbmdpZnkoZGVwKX1gLCB7IHBhdGggfSlcbiAgICAgICAgICAgICAgICByZXR1cm4gbm9ybWFsaXplZERlcC5kZWZhdWx0VmFsdWUgPz8gdW5kZWZpbmVkO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB0aHJvdyBlO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSByZXNvbHZlRGVwZW5kZW5jaWVzPFQgZXh0ZW5kcyBDbGFzc0NvbnN0cnVjdG9yPih0YXJnZXQ6IFQsIHBhdGg6IFNldDxUb2tlbj4pOiBhbnlbXSB7XG5cbiAgICAgICAgY29uc3QgaW5qZWN0TWV0YWRhdGEgPSBnZXRDb25zdHJ1Y3RvckRlcGVuZGVuY2llc01ldGFkYXRhKHRhcmdldCk7XG5cbiAgICAgICAgcmV0dXJuIGluamVjdE1ldGFkYXRhLm1hcChkZXAgPT4gdGhpcy5yZXNvbHZlRGVwZW5kZW5jeShkZXAsIHBhdGgpKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGluaXRpYWxpemVJbnN0YW5jZTxUPihpbnN0YW5jZTogVCk6IHZvaWQge1xuICAgICAgICBpZiAoIWhhc0NvbnN0cnVjdG9yKGluc3RhbmNlKSkgcmV0dXJuO1xuXG4gICAgICAgIGNvbnN0IGluaXRNZXRob2QgPSBnZXRPbkluaXRIb29rTWV0YWRhdGEoaW5zdGFuY2UuY29uc3RydWN0b3IgYXMgQ2xhc3NDb25zdHJ1Y3Rvcik7XG5cbiAgICAgICAgaWYgKGluaXRNZXRob2QpIHtcbiAgICAgICAgICAgIGNvbnN0IHRoZUluaXRNZXRob2QgPSBpbnN0YW5jZVsgaW5pdE1ldGhvZCBhcyBrZXlvZiB0eXBlb2YgaW5zdGFuY2UgXSBhcyBGdW5jdGlvbjtcbiAgICAgICAgICAgIGlmICh0eXBlb2YgdGhlSW5pdE1ldGhvZCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIHRoZUluaXRNZXRob2QuY2FsbChpbnN0YW5jZSk7ICAvLyBCaW5kICd0aGlzJyBjb250ZXh0IHRvIHRoZSBpbnN0YW5jZVxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEluaXRpYWxpemF0aW9uTWV0aG9kRXJyb3IoaW5zdGFuY2UuY29uc3RydWN0b3IubmFtZSwgZXJyb3IubWVzc2FnZSwgdGhpcy5jb250YWluZXJJZCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSW5pdGlhbGl6YXRpb25NZXRob2RUeXBlRXJyb3IoU3RyaW5nKGluaXRNZXRob2QpLCBpbnN0YW5jZS5jb25zdHJ1Y3Rvci5uYW1lLCB0aGlzLmNvbnRhaW5lcklkKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgaW5qZWN0UHJvcGVydGllczxUPihpbnN0YW5jZTogVCk6IHZvaWQge1xuICAgICAgICBpZiAoIWhhc0NvbnN0cnVjdG9yKGluc3RhbmNlKSkgcmV0dXJuO1xuXG4gICAgICAgIGNvbnN0IGRlcGVuZGVuY2llcyA9IGdldFByb3BlcnR5RGVwZW5kZW5jaWVzTWV0YWRhdGEoaW5zdGFuY2UuY29uc3RydWN0b3IgYXMgQ2xhc3NDb25zdHJ1Y3Rvcik7XG5cbiAgICAgICAgZm9yIChjb25zdCBkZXAgb2YgZGVwZW5kZW5jaWVzKSB7XG4gICAgICAgICAgICBjb25zdCBwcm9wZXJ0eVZhbHVlID0gdGhpcy5yZXNvbHZlRGVwZW5kZW5jeShkZXAsIG5ldyBTZXQoKSlcblxuICAgICAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KGluc3RhbmNlLCBkZXAucHJvcGVydHlLZXksIHtcbiAgICAgICAgICAgICAgICB2YWx1ZTogcHJvcGVydHlWYWx1ZSxcbiAgICAgICAgICAgICAgICBlbnVtZXJhYmxlOiB0cnVlLFxuICAgICAgICAgICAgICAgIGNvbmZpZ3VyYWJsZTogdHJ1ZVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBoYXMoXG4gICAgICAgIGRlcGVuZGVuY3lUb2tlbjogRGVwSWRlbnRpZmllcixcbiAgICAgICAgY3JpdGVyaWE/OiB7XG4gICAgICAgICAgICB0YWdzPzogc3RyaW5nW107XG4gICAgICAgICAgICB0eXBlPzogUHJvdmlkZXJPcHRpb25zWyAndHlwZScgXSxcbiAgICAgICAgICAgIHByaW9yaXR5PzogUHJpb3JpdHlDcml0ZXJpYTtcbiAgICAgICAgICAgIGZvckVudGl0eT86IFByb3ZpZGVyT3B0aW9uc1sgJ2ZvckVudGl0eScgXSxcbiAgICAgICAgICAgIGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnM/OiBib29sZWFuXG4gICAgICAgIH1cbiAgICApOiBib29sZWFuIHtcblxuICAgICAgICBjb25zdCB0b2tlbiA9IHRoaXMuY3JlYXRlVG9rZW4oZGVwZW5kZW5jeVRva2VuKTtcblxuICAgICAgICBjb25zdCBiZXN0UHJvdmlkZXJzID0gdGhpcy5jb2xsZWN0QmVzdFByb3ZpZGVyc0Zvcjxhbnk+KHtcbiAgICAgICAgICAgIC4uLmNyaXRlcmlhLFxuICAgICAgICAgICAgdG9rZW4sXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiBiZXN0UHJvdmlkZXJzLmxlbmd0aCA+IDA7XG4gICAgfVxuXG4gICAgaGFzRW50aXR5U2VydmljZShcbiAgICAgICAgZW50aXR5TmFtZTogRGVwSWRlbnRpZmllcixcbiAgICAgICAgY3JpdGVyaWE/OiB7XG4gICAgICAgICAgICB0YWdzPzogc3RyaW5nW107XG4gICAgICAgICAgICBwcmlvcml0eT86IFByaW9yaXR5Q3JpdGVyaWE7XG4gICAgICAgICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzPzogYm9vbGVhblxuICAgICAgICB9XG4gICAgKTogYm9vbGVhbiB7XG5cbiAgICAgICAgY29uc3QgeyB0YWdzLCBwcmlvcml0eSwgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVycyB9ID0gY3JpdGVyaWEgPz8ge307XG4gICAgICAgIGNvbnN0IGJlc3RQcm92aWRlcnMgPSB0aGlzLmNvbGxlY3RCZXN0UHJvdmlkZXJzRm9yPGFueT4oe1xuICAgICAgICAgICAgdGFncyxcbiAgICAgICAgICAgIHR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgICAgICAgIHByaW9yaXR5LFxuICAgICAgICAgICAgZm9yRW50aXR5OiBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVycyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIGJlc3RQcm92aWRlcnMubGVuZ3RoID4gMDtcbiAgICB9XG5cbiAgICByZXNvbHZlRW50aXR5U2VydmljZTxULCBBc3luYyBleHRlbmRzIGJvb2xlYW4gPSBmYWxzZT4oXG4gICAgICAgIGVudGl0eU5hbWU6IERlcElkZW50aWZpZXIsXG4gICAgICAgIGNyaXRlcmlhPzoge1xuICAgICAgICAgICAgdGFncz86IHN0cmluZ1tdO1xuICAgICAgICAgICAgcHJpb3JpdHk/OiBQcmlvcml0eUNyaXRlcmlhO1xuICAgICAgICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVycz86IGJvb2xlYW5cbiAgICAgICAgfSxcbiAgICAgICAgYXN5bmM6IEFzeW5jID0gZmFsc2UgYXMgQXN5bmNcbiAgICApOiBBc3luYyBleHRlbmRzIHRydWUgPyBQcm9taXNlPFQ+IDogVCB7XG5cbiAgICAgICAgY29uc3QgeyB0YWdzLCBwcmlvcml0eSwgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVycyB9ID0gY3JpdGVyaWEgPz8ge307XG4gICAgICAgIGNvbnN0IGJlc3RQcm92aWRlcnMgPSB0aGlzLmNvbGxlY3RCZXN0UHJvdmlkZXJzRm9yPGFueT4oe1xuICAgICAgICAgICAgdGFncyxcbiAgICAgICAgICAgIHR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgICAgICAgIHByaW9yaXR5LFxuICAgICAgICAgICAgZm9yRW50aXR5OiBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVycyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKGJlc3RQcm92aWRlcnMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgTm9FbnRpdHlTZXJ2aWNlUHJvdmlkZXJFcnJvcihTdHJpbmcoZW50aXR5TmFtZSksIHRoaXMuY29udGFpbmVySWQpO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IG9wdGlvbnMgPSBiZXN0UHJvdmlkZXJzWyAwIF07XG5cbiAgICAgICAgcmV0dXJuIHRoaXMucmVzb2x2ZVByb3ZpZGVyVmFsdWU8VCwgQXN5bmM+KG9wdGlvbnMsIG5ldyBTZXQoKSwgYXN5bmMpO1xuICAgIH1cblxuICAgIGhhc0VudGl0eVNjaGVtYShcbiAgICAgICAgZW50aXR5TmFtZTogRGVwSWRlbnRpZmllcixcbiAgICAgICAgY3JpdGVyaWE/OiB7XG4gICAgICAgICAgICB0YWdzPzogc3RyaW5nW107XG4gICAgICAgICAgICBwcmlvcml0eT86IFByaW9yaXR5Q3JpdGVyaWE7XG4gICAgICAgICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzPzogYm9vbGVhblxuICAgICAgICB9XG4gICAgKTogYm9vbGVhbiB7XG5cbiAgICAgICAgY29uc3QgeyB0YWdzLCBwcmlvcml0eSwgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVycyB9ID0gY3JpdGVyaWEgPz8ge307XG4gICAgICAgIGNvbnN0IGJlc3RQcm92aWRlcnMgPSB0aGlzLmNvbGxlY3RCZXN0UHJvdmlkZXJzRm9yPGFueT4oe1xuICAgICAgICAgICAgdGFncyxcbiAgICAgICAgICAgIHR5cGU6ICdzY2hlbWEnLFxuICAgICAgICAgICAgcHJpb3JpdHksXG4gICAgICAgICAgICBmb3JFbnRpdHk6IGVudGl0eU5hbWUsXG4gICAgICAgICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzLFxuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gYmVzdFByb3ZpZGVycy5sZW5ndGggPiAwO1xuICAgIH1cblxuICAgIHJlc29sdmVFbnRpdHlTY2hlbWE8VCwgQXN5bmMgZXh0ZW5kcyBib29sZWFuID0gZmFsc2U+KFxuICAgICAgICBlbnRpdHlOYW1lOiBEZXBJZGVudGlmaWVyLFxuICAgICAgICBjcml0ZXJpYT86IHtcbiAgICAgICAgICAgIHRhZ3M/OiBzdHJpbmdbXTtcbiAgICAgICAgICAgIHByaW9yaXR5PzogUHJpb3JpdHlDcml0ZXJpYTtcbiAgICAgICAgICAgIGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnM/OiBib29sZWFuXG4gICAgICAgIH0sXG4gICAgICAgIGFzeW5jOiBBc3luYyA9IGZhbHNlIGFzIEFzeW5jXG4gICAgKTogQXN5bmMgZXh0ZW5kcyB0cnVlID8gUHJvbWlzZTxUPiA6IFQge1xuXG4gICAgICAgIGNvbnN0IHsgdGFncywgcHJpb3JpdHksIGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnMgfSA9IGNyaXRlcmlhID8/IHt9O1xuICAgICAgICBjb25zdCBiZXN0UHJvdmlkZXJzID0gdGhpcy5jb2xsZWN0QmVzdFByb3ZpZGVyc0Zvcjxhbnk+KHtcbiAgICAgICAgICAgIHRhZ3MsXG4gICAgICAgICAgICB0eXBlOiAnc2NoZW1hJyxcbiAgICAgICAgICAgIHByaW9yaXR5LFxuICAgICAgICAgICAgZm9yRW50aXR5OiBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVycyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKGJlc3RQcm92aWRlcnMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgTm9FbnRpdHlTY2hlbWFQcm92aWRlckVycm9yKFN0cmluZyhlbnRpdHlOYW1lKSwgdGhpcy5jb250YWluZXJJZCk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3Qgb3B0aW9ucyA9IGJlc3RQcm92aWRlcnNbIDAgXTtcblxuICAgICAgICByZXR1cm4gdGhpcy5yZXNvbHZlUHJvdmlkZXJWYWx1ZTxULCBBc3luYz4ob3B0aW9ucywgbmV3IFNldCgpLCBhc3luYyk7XG4gICAgfVxuXG4gICAgY2xlYXIoY2xlYXJDaGlsZENvbnRhaW5lcnMgPSB0cnVlKSB7XG4gICAgICAgIHRoaXMucHJvdmlkZXJzLmNsZWFyKCk7XG4gICAgICAgIHRoaXMuY2FjaGUuY2xlYXIoKTtcbiAgICAgICAgdGhpcy5yZXNvbHZpbmcuY2xlYXIoKTtcbiAgICAgICAgaWYgKGNsZWFyQ2hpbGRDb250YWluZXJzKSB7XG4gICAgICAgICAgICB0aGlzLmNoaWxkQ29udGFpbmVycy5mb3JFYWNoKGNvbnRhaW5lciA9PiBjb250YWluZXIuY2xlYXIoKSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICB1c2VNaWRkbGV3YXJlKHsgbWlkZGxld2FyZSwgb3JkZXIgPSAxIH06IFBhcnRpYWxCeTxESU1pZGRsZXdhcmU8YW55PiwgJ29yZGVyJz4pIHtcbiAgICAgICAgdGhpcy5taWRkbGV3YXJlcy5wdXNoKHsgbWlkZGxld2FyZSwgb3JkZXIgfSk7XG4gICAgICAgIHRoaXMubWlkZGxld2FyZXMuc29ydCgoYSwgYikgPT4gKGEub3JkZXIgPz8gMCkgLSAoYi5vcmRlciA/PyAwKSk7XG4gICAgfVxuXG4gICAgYXN5bmMgcmVzb2x2ZUFzeW5jPFQ+KFxuICAgICAgICBkZXBlbmRlbmN5VG9rZW46IERlcElkZW50aWZpZXI8VD4sXG4gICAgICAgIGNyaXRlcmlhPzoge1xuICAgICAgICAgICAgdGFncz86IHN0cmluZ1tdO1xuICAgICAgICAgICAgdHlwZT86IFByb3ZpZGVyT3B0aW9uc1sgJ3R5cGUnIF0sXG4gICAgICAgICAgICBwcmlvcml0eT86IFByaW9yaXR5Q3JpdGVyaWE7XG4gICAgICAgICAgICBmb3JFbnRpdHk/OiBQcm92aWRlck9wdGlvbnNbICdmb3JFbnRpdHknIF0sXG4gICAgICAgICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzPzogYm9vbGVhblxuICAgICAgICB9LFxuICAgICAgICBwYXRoPzogU2V0PFRva2VuPlxuICAgICkge1xuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5yZXNvbHZlPFQsIHRydWU+KGRlcGVuZGVuY3lUb2tlbiwgY3JpdGVyaWEsIHBhdGgsIHRydWUpO1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgY3JlYXRlQW5kQ2FjaGVJbnN0YW5jZUFzeW5jPFQ+KG9wdGlvbnM6IEludGVybmFsUHJvdmlkZXJPcHRpb25zPFQ+LCBwYXRoOiBTZXQ8VG9rZW4+KTogUHJvbWlzZTxUPiB7XG4gICAgICAgIGNvbnN0IHsgX2lkLCBfcHJvdmlkZXI6IHByb3ZpZGVyIH0gPSBvcHRpb25zO1xuXG4gICAgICAgIGNvbnN0IGluc3RhbmNlID0gYXdhaXQgdGhpcy5jcmVhdGVJbnN0YW5jZShvcHRpb25zLCBwYXRoLCB0cnVlKTtcbiAgICAgICAgaWYgKHByb3ZpZGVyLnNpbmdsZXRvbikge1xuICAgICAgICAgICAgdGhpcy5jYWNoZS5zZXQoX2lkLCBpbnN0YW5jZSk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLnJlc29sdmluZy5kZWxldGUoX2lkKTtcblxuICAgICAgICBhd2FpdCB0aGlzLmluamVjdFByb3BlcnRpZXNBc3luYyhpbnN0YW5jZSk7XG4gICAgICAgIGF3YWl0IHRoaXMuaW5pdGlhbGl6ZUluc3RhbmNlQXN5bmMoaW5zdGFuY2UpO1xuXG4gICAgICAgIHBhdGguZGVsZXRlKF9pZCk7XG5cbiAgICAgICAgcmV0dXJuIGluc3RhbmNlO1xuICAgIH1cblxuICAgIHVzZU1pZGRsZXdhcmVBc3luYyh7IG1pZGRsZXdhcmUsIG9yZGVyID0gMSB9OiBQYXJ0aWFsQnk8RElNaWRkbGV3YXJlQXN5bmM8YW55PiwgJ29yZGVyJz4pIHtcbiAgICAgICAgdGhpcy5hc3luY01pZGRsZXdhcmVzLnB1c2goeyBtaWRkbGV3YXJlLCBvcmRlciB9KTtcbiAgICAgICAgdGhpcy5hc3luY01pZGRsZXdhcmVzLnNvcnQoKGEsIGIpID0+IChhLm9yZGVyID8/IDApIC0gKGIub3JkZXIgPz8gMCkpO1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgcmVzb2x2ZURlcGVuZGVuY2llc0FzeW5jPFQgZXh0ZW5kcyBDbGFzc0NvbnN0cnVjdG9yPih0YXJnZXQ6IFQsIHBhdGg6IFNldDxUb2tlbj4pOiBQcm9taXNlPGFueVtdPiB7XG5cbiAgICAgICAgY29uc3QgaW5qZWN0TWV0YWRhdGEgPSBnZXRDb25zdHJ1Y3RvckRlcGVuZGVuY2llc01ldGFkYXRhKHRhcmdldCk7XG5cbiAgICAgICAgcmV0dXJuIGF3YWl0IFByb21pc2UuYWxsKGluamVjdE1ldGFkYXRhLm1hcChhc3luYyBkZXAgPT4gYXdhaXQgdGhpcy5yZXNvbHZlRGVwZW5kZW5jeShkZXAsIHBhdGgsIHRydWUpKSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBpbml0aWFsaXplSW5zdGFuY2VBc3luYzxUPihpbnN0YW5jZTogVCk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBpZiAoIWhhc0NvbnN0cnVjdG9yKGluc3RhbmNlKSkgcmV0dXJuO1xuXG4gICAgICAgIGNvbnN0IGluaXRNZXRob2QgPSBnZXRPbkluaXRIb29rTWV0YWRhdGEoaW5zdGFuY2UuY29uc3RydWN0b3IgYXMgQ2xhc3NDb25zdHJ1Y3Rvcik7XG5cbiAgICAgICAgaWYgKGluaXRNZXRob2QpIHtcbiAgICAgICAgICAgIGNvbnN0IHRoZUluaXRNZXRob2QgPSBpbnN0YW5jZVsgaW5pdE1ldGhvZCBhcyBrZXlvZiB0eXBlb2YgaW5zdGFuY2UgXSBhcyBGdW5jdGlvbjtcbiAgICAgICAgICAgIGlmICh0eXBlb2YgdGhlSW5pdE1ldGhvZCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IHRoZUluaXRNZXRob2QuY2FsbChpbnN0YW5jZSk7ICAvLyBCaW5kICd0aGlzJyBjb250ZXh0IHRvIHRoZSBpbnN0YW5jZVxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEluaXRpYWxpemF0aW9uTWV0aG9kRXJyb3IoaW5zdGFuY2UuY29uc3RydWN0b3IubmFtZSwgZXJyb3IubWVzc2FnZSwgdGhpcy5jb250YWluZXJJZCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSW5pdGlhbGl6YXRpb25NZXRob2RUeXBlRXJyb3IoU3RyaW5nKGluaXRNZXRob2QpLCBpbnN0YW5jZS5jb25zdHJ1Y3Rvci5uYW1lLCB0aGlzLmNvbnRhaW5lcklkKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgY3JlYXRlRmFjdG9yeUluc3RhbmNlQXN5bmM8VD4ob3B0aW9uczogRmFjdG9yeVByb3ZpZGVyT3B0aW9uczxUPiwgcGF0aDogU2V0PFRva2VuPik6IFByb21pc2U8VD4ge1xuICAgICAgICBjb25zdCBkZXBlbmRlbmNpZXMgPSBhd2FpdCBQcm9taXNlLmFsbCgob3B0aW9ucy5kZXBzIHx8IFtdKS5tYXAoYXN5bmMgKGRlcCkgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMucmVzb2x2ZURlcGVuZGVuY3koZGVwLCBwYXRoLCB0cnVlKTtcbiAgICAgICAgfSkpO1xuICAgICAgICByZXR1cm4gb3B0aW9ucy51c2VGYWN0b3J5KC4uLmRlcGVuZGVuY2llcyk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBpbmplY3RQcm9wZXJ0aWVzQXN5bmM8VD4oaW5zdGFuY2U6IFQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgaWYgKCFoYXNDb25zdHJ1Y3RvcihpbnN0YW5jZSkpIHJldHVybjtcblxuICAgICAgICBjb25zdCBkZXBlbmRlbmNpZXMgPSBnZXRQcm9wZXJ0eURlcGVuZGVuY2llc01ldGFkYXRhKGluc3RhbmNlLmNvbnN0cnVjdG9yIGFzIENsYXNzQ29uc3RydWN0b3IpO1xuXG4gICAgICAgIGZvciAoY29uc3QgZGVwIG9mIGRlcGVuZGVuY2llcykge1xuICAgICAgICAgICAgY29uc3QgcHJvcGVydHlWYWx1ZSA9IGF3YWl0IHRoaXMucmVzb2x2ZURlcGVuZGVuY3koZGVwLCBuZXcgU2V0KCksIHRydWUpXG5cbiAgICAgICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShpbnN0YW5jZSwgZGVwLnByb3BlcnR5S2V5LCB7XG4gICAgICAgICAgICAgICAgdmFsdWU6IHByb3BlcnR5VmFsdWUsXG4gICAgICAgICAgICAgICAgZW51bWVyYWJsZTogdHJ1ZSxcbiAgICAgICAgICAgICAgICBjb25maWd1cmFibGU6IHRydWVcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgbG9nQ2hpbGRDb250YWluZXJzKCkge1xuICAgICAgICBmb3IgKGNvbnN0IGNvbnRhaW5lciBvZiB0aGlzLmNoaWxkQ29udGFpbmVycykge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENoaWxkIENvbnRhaW5lcjogJHtjb250YWluZXIuY29udGFpbmVySWR9YCk7XG4gICAgICAgICAgICBjb250YWluZXIubG9nQ2hpbGRDb250YWluZXJzKCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBsb2dQcm92aWRlcnMoYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVycyA9IHRydWUpIHtcbiAgICAgICAgY29uc3QgaW50ZXJuYWxQcm92aWRlcnMgPSB0aGlzLmNvbGxlY3RCZXN0UHJvdmlkZXJzRm9yPGFueT4oe1xuICAgICAgICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVycyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFBhcmVudCBDb250YWluZXIgSWQsIFtQYXJlbnQ6ICR7dGhpcy5wYXJlbnQ/LmNvbnRhaW5lcklkfV1gKTtcblxuICAgICAgICBmb3IgKGNvbnN0IGlwIG9mIGludGVybmFsUHJvdmlkZXJzKSB7XG4gICAgICAgICAgICBsZXQgZmlsdGVyZWQgPSB7XG4gICAgICAgICAgICAgICAgLi4uaXAsXG4gICAgICAgICAgICAgICAgX2NvbnRhaW5lcjogaXAuX2NvbnRhaW5lci5jb250YWluZXJJZCxcbiAgICAgICAgICAgICAgICBfcHJvdmlkZXI6IHtcbiAgICAgICAgICAgICAgICAgICAgLi4uaXAuX3Byb3ZpZGVyLFxuICAgICAgICAgICAgICAgICAgICB1c2VDbGFzczogKGlwLl9wcm92aWRlciBhcyBhbnkpPy51c2VDbGFzcz8ubmFtZSxcbiAgICAgICAgICAgICAgICAgICAgcHJvdmlkZTogKGlwLl9wcm92aWRlci5wcm92aWRlIGFzIGFueSkubmFtZSA/IChpcC5fcHJvdmlkZXIucHJvdmlkZSBhcyBhbnkpLm5hbWUgOiBpcC5fcHJvdmlkZXIucHJvdmlkZVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgUHJvdmlkZXI6IFske2lwLl9jb250YWluZXIuY29udGFpbmVySWR9XSAtICR7aXAuX3Byb3ZpZGVyLl90b2tlbn06YCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBsb2dDYWNoZSgpIHtcbiAgICAgICAgZm9yIChjb25zdCBbIHRva2VuLCBpbnN0YW5jZSBdIG9mIHRoaXMuY2FjaGUuZW50cmllcygpKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQ2FjaGU6IFske3RoaXMuY29udGFpbmVySWR9XSAtICR7dG9rZW59OmAsIGluc3RhbmNlKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLnBhcmVudD8ubG9nQ2FjaGUoKTtcbiAgICB9XG5cbiAgICBwdWJsaWMgc2V0U2VhcmNoRW5naW5lKGVuZ2luZTogQmFzZVNlYXJjaEVuZ2luZSkge1xuICAgICAgICB0aGlzLnNlYXJjaEVuZ2luZSA9IGVuZ2luZTtcbiAgICB9XG5cbiAgICBwdWJsaWMgcmVzb2x2ZVNlYXJjaEVuZ2luZSgpOiBCYXNlU2VhcmNoRW5naW5lIHtcbiAgICAgICAgaWYgKCF0aGlzLnNlYXJjaEVuZ2luZSkge1xuXG4gICAgICAgICAgICBpZiAodGhpcy5wYXJlbnQpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5wYXJlbnQucmVzb2x2ZVNlYXJjaEVuZ2luZSgpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1NlYXJjaCBlbmdpbmUgbm90IGNvbmZpZ3VyZWQuIFBsZWFzZSBjYWxsIHNldFNlYXJjaEVuZ2luZSgpIGZpcnN0LicpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuc2VhcmNoRW5naW5lO1xuICAgIH1cbn1cbiJdfQ==