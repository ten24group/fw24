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
    static _rootInstance;
    static get ROOT() {
        if (!this._rootInstance) {
            this._rootInstance = new DIContainer();
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
            this.logger.warn(`Found old proxy container: [${proxyContainerId}] in parent: [${parentContainer.containerId}]; replacing it`);
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
        return (0, utils_1.filterAndSortProviders)(bestProvidersArray, criteria);
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
            this.logProviders(true);
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
            this.logger.debug(`Provider: [${ip._container.containerId}] - ${ip._provider._token}:`, { options: filtered });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udGFpbmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2RpL2NvbnRhaW5lci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSwrQkFBMEM7QUFDMUMsZ0RBQW9EO0FBRXBELDhDQUEyRDtBQUMzRCw2Q0FBMEM7QUFtQjFDLHNDQU91QjtBQUV2QixtQ0FZaUI7QUFFakIseUNBS29CO0FBRXBCLG9DQUFxQztBQUVyQyxxQ0FXa0I7QUFJbEIsTUFBYSxXQUFXO0lBd0dBO0lBdEdwQixNQUFNLENBQVUsZUFBZSxHQUFHLElBQUksMEJBQWUsQ0FBQyxFQUFFLFNBQVMsRUFBRSxTQUFTLEVBQUUsQ0FBQyxDQUFDO0lBRWhFLFdBQVcsQ0FBUztJQUNuQixNQUFNLENBQVU7SUFDaEIsV0FBVyxHQUF3QixFQUFFLENBQUM7SUFDdEMsZ0JBQWdCLEdBQTZCLEVBQUUsQ0FBQztJQUV6RCxVQUFVLEdBQUcsSUFBSSxHQUFHLEVBQWUsQ0FBQztJQUM1QyxJQUFjLFNBQVM7UUFFbkIsSUFBSSxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7WUFDaEIsT0FBTyxJQUFJLENBQUMsUUFBUSxDQUFDLFNBQVMsQ0FBQztRQUNuQyxDQUFDO1FBRUQsSUFBSSxDQUFDLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQztZQUNuQixJQUFJLENBQUMsVUFBVSxHQUFHLElBQUksR0FBRyxFQUFlLENBQUM7UUFDN0MsQ0FBQztRQUNELE9BQU8sSUFBSSxDQUFDLFVBQVUsQ0FBQztJQUMzQixDQUFDO0lBRU8sTUFBTSxHQUFHLElBQUksR0FBRyxFQUFlLENBQUM7SUFDeEMsSUFBYyxLQUFLO1FBRWYsSUFBSSxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7WUFDaEIsT0FBTyxJQUFJLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQztRQUMvQixDQUFDO1FBRUQsSUFBSSxDQUFDLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQztZQUNmLElBQUksQ0FBQyxNQUFN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QUNKLEtBQUssTUFBTSxDQUFFLEtBQUssRUFBRSxRQUFRLENBQUUsSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sRUFBRSxFQUFFLENBQUM7WUFDckQsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsV0FBVyxJQUFJLENBQUMsV0FBVyxPQUFPLEtBQUssR0FBRyxFQUFFLFFBQVEsQ0FBQyxDQUFDO1FBQzVFLENBQUM7UUFDRCxJQUFJLENBQUMsTUFBTSxFQUFFLFFBQVEsRUFBRSxDQUFDO0lBQzVCLENBQUM7SUFFTSxlQUFlLENBQUMsTUFBd0I7UUFDM0MsSUFBSSxDQUFDLFlBQVksR0FBRyxNQUFNLENBQUM7SUFDL0IsQ0FBQztJQUVNLG1CQUFtQjtRQUN0QixJQUFJLENBQUMsSUFBSSxDQUFDLFlBQVksRUFBRSxDQUFDO1lBRXJCLElBQUksSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDO2dCQUNkLE9BQU8sSUFBSSxDQUFDLE1BQU0sQ0FBQyxtQkFBbUIsRUFBRSxDQUFDO1lBQzdDLENBQUM7WUFFRCxNQUFNLElBQUksS0FBSyxDQUFDLG9FQUFvRSxDQUFDLENBQUM7UUFDMUYsQ0FBQztRQUVELE9BQU8sSUFBSSxDQUFDLFlBQVksQ0FBQztJQUM3QixDQUFDOztBQXZtQ0wsa0NBd21DQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IHY0IGFzIGdlbmVyYXRlVVVJRCB9IGZyb20gJ3V1aWQnO1xuaW1wb3J0IHsgTWV0YWRhdGFNYW5hZ2VyIH0gZnJvbSAnLi4vdXRpbHMvbWV0YWRhdGEnO1xuaW1wb3J0IHsgdHlwZSBEZWVwUGFydGlhbCwgdHlwZSBQYXJ0aWFsQnkgfSBmcm9tICcuLi91dGlscy90eXBlcyc7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIsIElMb2dnZXIgfSBmcm9tICcuLy4uL2xvZ2dpbmcvaW5kZXgnO1xuaW1wb3J0IHsgSW5qZWN0YWJsZSB9IGZyb20gJy4vZGVjb3JhdG9ycyc7XG5cbmltcG9ydCB7XG4gICAgQmFzZVByb3ZpZGVyT3B0aW9ucyxcbiAgICBDbGFzc0NvbnN0cnVjdG9yLFxuICAgIENsYXNzUHJvdmlkZXJPcHRpb25zLFxuICAgIENvbXBsZXhEZXBlbmRlbmN5SWRlbnRpZmllcixcbiAgICBDb25maWdQcm92aWRlck9wdGlvbnMsXG4gICAgRGVwSWRlbnRpZmllcixcbiAgICBGYWN0b3J5UHJvdmlkZXJPcHRpb25zLFxuICAgIElESUNvbnRhaW5lcixcbiAgICBJbnRlcm5hbFByb3ZpZGVyT3B0aW9ucyxcbiAgICBESU1pZGRsZXdhcmUsXG4gICAgRElNaWRkbGV3YXJlQXN5bmMsXG4gICAgUHJpb3JpdHlDcml0ZXJpYSxcbiAgICBQcm92aWRlck9wdGlvbnMsXG4gICAgVG9rZW5cbn0gZnJvbSAnLi8uLi9pbnRlcmZhY2VzL2RpJztcblxuaW1wb3J0IHtcbiAgICBpc0FsaWFzUHJvdmlkZXJPcHRpb25zLFxuICAgIGlzQ2xhc3NQcm92aWRlck9wdGlvbnMsXG4gICAgaXNDb21wbGV4RGVwZW5kZW5jeUlkZW50aWZpZXIsXG4gICAgaXNDb25maWdQcm92aWRlck9wdGlvbnMsXG4gICAgaXNGYWN0b3J5UHJvdmlkZXJPcHRpb25zLFxuICAgIGlzVmFsdWVQcm92aWRlck9wdGlvbnMsXG59IGZyb20gJy4vLi4vdXRpbHMvZGknO1xuXG5pbXBvcnQge1xuICAgIGFwcGx5TWlkZGxld2FyZXMsXG4gICAgYXBwbHlNaWRkbGV3YXJlc0FzeW5jLFxuICAgIGZpbHRlckFuZFNvcnRQcm92aWRlcnMsXG4gICAgZmxhdHRlbkNvbmZpZyxcbiAgICBnZXRQYXRoVmFsdWUsXG4gICAgaGFzQ29uc3RydWN0b3IsXG4gICAgbWFrZURJVG9rZW4sXG4gICAgbWF0Y2hlc1BhdHRlcm4sXG4gICAgc2V0UGF0aFZhbHVlLFxuICAgIHN0cmlwRElUb2tlbk5hbWVzcGFjZSxcbiAgICB2YWxpZGF0ZVByb3ZpZGVyT3B0aW9uc1xufSBmcm9tICcuL3V0aWxzJztcblxuaW1wb3J0IHtcbiAgICBnZXRDb25zdHJ1Y3RvckRlcGVuZGVuY2llc01ldGFkYXRhLFxuICAgIGdldE1vZHVsZU1ldGFkYXRhLFxuICAgIGdldE9uSW5pdEhvb2tNZXRhZGF0YSxcbiAgICBnZXRQcm9wZXJ0eURlcGVuZGVuY2llc01ldGFkYXRhLFxufSBmcm9tICcuL21ldGFkYXRhJztcblxuaW1wb3J0IHsgRElfVE9LRU5TIH0gZnJvbSAnLi4vY29uc3QnO1xuXG5pbXBvcnQge1xuICAgIENpcmN1bGFyRGVwZW5kZW5jeUVycm9yLFxuICAgIEluaXRpYWxpemF0aW9uTWV0aG9kRXJyb3IsXG4gICAgSW5pdGlhbGl6YXRpb25NZXRob2RUeXBlRXJyb3IsXG4gICAgSW52YWxpZERlcGVuZGVuY3lDcml0ZXJpYUVycm9yLFxuICAgIE1vZHVsZU1ldGFkYXRhRXJyb3IsXG4gICAgTm9FbnRpdHlTY2hlbWFQcm92aWRlckVycm9yLFxuICAgIE5vRW50aXR5U2VydmljZVByb3ZpZGVyRXJyb3IsXG4gICAgTm9Qcm92aWRlckZvdW5kRXJyb3IsXG4gICAgTm90aGluZ1RvRXhwb3J0RXJyb3IsXG4gICAgUHJvdmlkZXJDb25maWd1cmF0aW9uRXJyb3Jcbn0gZnJvbSAnLi9lcnJvcnMnO1xuaW1wb3J0IHsgQmFzZVNlYXJjaEVuZ2luZSB9IGZyb20gJy4uL3NlYXJjaCc7XG5cblxuZXhwb3J0IGNsYXNzIERJQ29udGFpbmVyIGltcGxlbWVudHMgSURJQ29udGFpbmVyIHtcblxuICAgIHN0YXRpYyByZWFkb25seSBESU1ldGFkYXRhU3RvcmUgPSBuZXcgTWV0YWRhdGFNYW5hZ2VyKHsgbmFtZXNwYWNlOiAnZncyNDpkaScgfSk7XG5cbiAgICBwdWJsaWMgcmVhZG9ubHkgY29udGFpbmVySWQ6IHN0cmluZztcbiAgICBwcml2YXRlIHJlYWRvbmx5IGxvZ2dlcjogSUxvZ2dlcjtcbiAgICBwcml2YXRlIHJlYWRvbmx5IG1pZGRsZXdhcmVzOiBESU1pZGRsZXdhcmU8YW55PltdID0gW107XG4gICAgcHJpdmF0ZSByZWFkb25seSBhc3luY01pZGRsZXdhcmVzOiBESU1pZGRsZXdhcmVBc3luYzxhbnk+W10gPSBbXTtcblxuICAgIHByaXZhdGUgX3Jlc29sdmluZyA9IG5ldyBNYXA8c3RyaW5nLCBhbnk+KCk7XG4gICAgcHJvdGVjdGVkIGdldCByZXNvbHZpbmcoKTogTWFwPHN0cmluZywgYW55PiB7XG5cbiAgICAgICAgaWYgKHRoaXMucHJveHlGb3IpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnByb3h5Rm9yLnJlc29sdmluZztcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghdGhpcy5fcmVzb2x2aW5nKSB7XG4gICAgICAgICAgICB0aGlzLl9yZXNvbHZpbmcgPSBuZXcgTWFwPHN0cmluZywgYW55PigpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLl9yZXNvbHZpbmc7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBfY2FjaGUgPSBuZXcgTWFwPHN0cmluZywgYW55PigpO1xuICAgIHByb3RlY3RlZCBnZXQgY2FjaGUoKTogTWFwPHN0cmluZywgYW55PiB7XG5cbiAgICAgICAgaWYgKHRoaXMucHJveHlGb3IpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnByb3h5Rm9yLmNhY2hlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCF0aGlzLl9jYWNoZSkge1xuICAgICAgICAgICAgdGhpcy5fY2FjaGUgPSBuZXcgTWFwPHN0cmluZywgYW55PigpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLl9jYWNoZTtcbiAgICB9XG5cbiAgICBwcml2YXRlIF9wcm92aWRlcnM6IE1hcDxzdHJpbmcsIEludGVybmFsUHJvdmlkZXJPcHRpb25zW10+IHwgdW5kZWZpbmVkO1xuICAgIGdldCBwcm92aWRlcnMoKTogTWFwPHN0cmluZywgSW50ZXJuYWxQcm92aWRlck9wdGlvbnNbXT4ge1xuXG4gICAgICAgIGlmICh0aGlzLnByb3h5Rm9yKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5wcm94eUZvci5wcm92aWRlcnM7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIXRoaXMuX3Byb3ZpZGVycykge1xuICAgICAgICAgICAgdGhpcy5fcHJvdmlkZXJzID0gbmV3IE1hcDxzdHJpbmcsIEludGVybmFsUHJvdmlkZXJPcHRpb25zW10+KCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuX3Byb3ZpZGVyc1xuICAgIH1cblxuICAgIHByaXZhdGUgX2V4cG9ydHM6IE1hcDxzdHJpbmcsIEludGVybmFsUHJvdmlkZXJPcHRpb25zW10+IHwgdW5kZWZpbmVkO1xuICAgIGdldCBleHBvcnRzKCk6IE1hcDxzdHJpbmcsIEludGVybmFsUHJvdmlkZXJPcHRpb25zW10+IHtcblxuICAgICAgICBpZiAodGhpcy5wcm94eUZvcikge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMucHJveHlGb3IuZXhwb3J0cztcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghdGhpcy5fZXhwb3J0cykge1xuICAgICAgICAgICAgdGhpcy5fZXhwb3J0cyA9IG5ldyBNYXA8c3RyaW5nLCBJbnRlcm5hbFByb3ZpZGVyT3B0aW9uc1tdPigpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLl9leHBvcnRzXG4gICAgfVxuXG4gICAgLy8gd2hlbiB0aGlzIGNvbnRhaW5lciBpcyBhIHByb3h5IGZvciBhbm90aGVyIGNvbnRhaW5lcjsgdGhlIGFub3RoZXIgY29udGFpbmVyJ3MgcmVmIHdpbGwgYmUgc3RvcmVkIGhlcmVcbiAgICBwdWJsaWMgcHJveHlGb3I6IERJQ29udGFpbmVyIHwgdW5kZWZpbmVkO1xuXG4gICAgZ2V0IHBhcmVudCgpOiBESUNvbnRhaW5lciB8IHVuZGVmaW5lZCB7XG4gICAgICAgIHJldHVybiB0aGlzLnBhcmVudENvbnRhaW5lclxuICAgIH1cblxuICAgIHByaXZhdGUgX2NoaWxkQ29udGFpbmVyczogU2V0PERJQ29udGFpbmVyPiB8IHVuZGVmaW5lZDtcbiAgICBnZXQgY2hpbGRDb250YWluZXJzKCk6IFNldDxESUNvbnRhaW5lcj4ge1xuXG4gICAgICAgIGlmICh0aGlzLnByb3h5Rm9yKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5wcm94eUZvci5jaGlsZENvbnRhaW5lcnM7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIXRoaXMuX2NoaWxkQ29udGFpbmVycykge1xuICAgICAgICAgICAgdGhpcy5fY2hpbGRDb250YWluZXJzID0gbmV3IFNldDxESUNvbnRhaW5lcj4oKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5fY2hpbGRDb250YWluZXJzXG4gICAgfVxuXG4gICAgcHJpdmF0ZSBfcHJveGllczogU2V0PERJQ29udGFpbmVyPiB8IHVuZGVmaW5lZDtcbiAgICBnZXQgcHJveGllcygpOiBTZXQ8RElDb250YWluZXI+IHtcblxuICAgICAgICBpZiAodGhpcy5wcm94eUZvcikge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMucHJveHlGb3IucHJveGllcztcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghdGhpcy5fcHJveGllcykge1xuICAgICAgICAgICAgdGhpcy5fcHJveGllcyA9IG5ldyBTZXQ8RElDb250YWluZXI+KCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuX3Byb3hpZXNcbiAgICB9XG5cbiAgICBwcml2YXRlIHN0YXRpYyBfcm9vdEluc3RhbmNlOiBESUNvbnRhaW5lcjtcbiAgICBzdGF0aWMgZ2V0IFJPT1QoKTogSURJQ29udGFpbmVyIHtcbiAgICAgICAgaWYgKCF0aGlzLl9yb290SW5zdGFuY2UpIHtcbiAgICAgICAgICAgIHRoaXMuX3Jvb3RJbnN0YW5jZSA9IG5ldyBESUNvbnRhaW5lcigpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLl9yb290SW5zdGFuY2U7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBzZWFyY2hFbmdpbmU/OiBCYXNlU2VhcmNoRW5naW5lO1xuXG4gICAgY29uc3RydWN0b3IocHJpdmF0ZSBwYXJlbnRDb250YWluZXI/OiBESUNvbnRhaW5lciwgaWRlbnRpZmllcjogc3RyaW5nID0gJ1JPT1QnKSB7XG4gICAgICAgIC8vIHRvIGVuc3VyZSBkZXN0cnVjdHVyaW5nIHdvcmtzIGNvcnJlY3RseVxuICAgICAgICB0aGlzLkluamVjdGFibGUgPSB0aGlzLkluamVjdGFibGUuYmluZCh0aGlzKTtcbiAgICAgICAgdGhpcy5jb250YWluZXJJZCA9IGlkZW50aWZpZXI7XG4gICAgICAgIHRoaXMubG9nZ2VyID0gY3JlYXRlTG9nZ2VyKGBESUNvbnRhaW5lclske2lkZW50aWZpZXJ9XWApO1xuICAgIH1cblxuICAgIEluamVjdGFibGUob3B0aW9uczogUGFydGlhbEJ5PEJhc2VQcm92aWRlck9wdGlvbnMsICdwcm92aWRlJz4gPSB7fSkge1xuICAgICAgICByZXR1cm4gSW5qZWN0YWJsZSh7IC4uLm9wdGlvbnMsIHByb3ZpZGVkSW46IHRoaXMgfSk7XG4gICAgfVxuXG4gICAgY3JlYXRlQ2hpbGRDb250YWluZXIoaWRlbnRpZmllcjogc3RyaW5nKTogRElDb250YWluZXIge1xuICAgICAgICBjb25zdCBjaGlsZCA9IG5ldyBESUNvbnRhaW5lcih0aGlzLCBpZGVudGlmaWVyKTtcbiAgICAgICAgdGhpcy5jaGlsZENvbnRhaW5lcnMuYWRkKGNoaWxkKTtcbiAgICAgICAgcmV0dXJuIGNoaWxkO1xuICAgIH1cblxuICAgIHByb3RlY3RlZCBjcmVhdGVDaGlsZENvbnRhaW5lclByb3h5SWRlbnRpZmllcihwYXJlbnRDb250YWluZXI6IERJQ29udGFpbmVyKTogc3RyaW5nIHtcbiAgICAgICAgcmV0dXJuIGAke3RoaXMuY29udGFpbmVySWR9OlByb3h5SW5bJHtwYXJlbnRDb250YWluZXIuY29udGFpbmVySWR9XWBcbiAgICB9XG5cbiAgICBwcm90ZWN0ZWQgYWRkUHJveHlDb250YWluZXJJbiA9IChwYXJlbnRDb250YWluZXI6IERJQ29udGFpbmVyKTogRElDb250YWluZXIgPT4ge1xuXG4gICAgICAgIGNvbnN0IHByb3h5Q29udGFpbmVySWQgPSB0aGlzLmNyZWF0ZUNoaWxkQ29udGFpbmVyUHJveHlJZGVudGlmaWVyKHBhcmVudENvbnRhaW5lcik7XG5cbiAgICAgICAgLy8gbWFrZSBzdXJlIHRvIHJlbW92ZSBvbGQgcHJveHkgZnJvbSB0aGUgaW1wb3J0aW5nIG1vZHVsZSBpZiBleGlzdHNcbiAgICAgICAgaWYgKHBhcmVudENvbnRhaW5lci5oYXNDaGlsZENvbnRhaW5lckJ5SWQocHJveHlDb250YWluZXJJZCkpIHtcblxuICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgRm91bmQgb2xkIHByb3h5IGNvbnRhaW5lcjogWyR7cHJveHlDb250YWluZXJJZH1dIGluIHBhcmVudDogWyR7cGFyZW50Q29udGFpbmVyLmNvbnRhaW5lcklkfV07IHJlcGxhY2luZyBpdGApO1xuXG4gICAgICAgICAgICBjb25zdCBvbGRQcm94eUNvbnRhaW5lciA9IHBhcmVudENvbnRhaW5lci5nZXRDaGlsZENvbnRhaW5lckJ5SWQocHJveHlDb250YWluZXJJZCk7XG5cbiAgICAgICAgICAgIHBhcmVudENvbnRhaW5lci5yZW1vdmVDaGlsZENvbnRhaW5lckJ5SWQocHJveHlDb250YWluZXJJZCk7XG5cbiAgICAgICAgICAgIHRoaXMucHJveGllcy5kZWxldGUob2xkUHJveHlDb250YWluZXIpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgbmV3UHJveHlDb250YWluZXIgPSBwYXJlbnRDb250YWluZXIuY3JlYXRlQ2hpbGRDb250YWluZXIocHJveHlDb250YWluZXJJZCk7XG5cbiAgICAgICAgbmV3UHJveHlDb250YWluZXIucHJveHlGb3IgPSB0aGlzO1xuXG4gICAgICAgIHRoaXMucHJveGllcy5hZGQobmV3UHJveHlDb250YWluZXIpO1xuXG4gICAgICAgIHJldHVybiBuZXdQcm94eUNvbnRhaW5lcjtcbiAgICB9XG5cbiAgICBoYXNDaGlsZENvbnRhaW5lckJ5SWQoaWRlbnRpZmllcjogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgICAgIGxldCBmb3VuZCA9IEFycmF5LmZyb20odGhpcy5jaGlsZENvbnRhaW5lcnMpLnNvbWUoXG4gICAgICAgICAgICBlbGVtZW50ID0+IGVsZW1lbnQuY29udGFpbmVySWQuc3RhcnRzV2l0aChpZGVudGlmaWVyKVxuICAgICAgICApO1xuXG4gICAgICAgIGlmICghZm91bmQgJiYgdGhpcy5jaGlsZENvbnRhaW5lcnMuc2l6ZSA+IDApIHtcbiAgICAgICAgICAgIGZvdW5kID0gQXJyYXkuZnJvbSh0aGlzLmNoaWxkQ29udGFpbmVycykuc29tZShjYyA9PiBjYy5oYXNDaGlsZENvbnRhaW5lckJ5SWQoaWRlbnRpZmllcikpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGZvdW5kO1xuICAgIH1cblxuICAgIHJlbW92ZUNoaWxkQ29udGFpbmVyQnlJZChpZGVudGlmaWVyOiBzdHJpbmcpOiB2b2lkIHtcbiAgICAgICAgY29uc3QgY2hpbGRDb250YWluZXIgPSB0aGlzLmdldENoaWxkQ29udGFpbmVyQnlJZChpZGVudGlmaWVyKTtcbiAgICAgICAgdGhpcy5jaGlsZENvbnRhaW5lcnMuZGVsZXRlKGNoaWxkQ29udGFpbmVyKTtcbiAgICB9XG5cbiAgICBnZXRDaGlsZENvbnRhaW5lckJ5SWQoaWRlbnRpZmllcjogc3RyaW5nKTogYW55IHtcbiAgICAgICAgbGV0IGZvdW5kQ29udGFpbmVyID0gQXJyYXkuZnJvbSh0aGlzLmNoaWxkQ29udGFpbmVycykuZmluZChlbGVtZW50ID0+IHtcbiAgICAgICAgICAgIHJldHVybiBlbGVtZW50LmNvbnRhaW5lcklkLnN0YXJ0c1dpdGgoaWRlbnRpZmllcik7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGlmICghZm91bmRDb250YWluZXIgJiYgdGhpcy5jaGlsZENvbnRhaW5lcnMuc2l6ZSA+IDApIHtcbiAgICAgICAgICAgIGZvciAoY29uc3QgY2Mgb2YgdGhpcy5jaGlsZENvbnRhaW5lcnMpIHtcbiAgICAgICAgICAgICAgICBmb3VuZENvbnRhaW5lciA9IGNjLmdldENoaWxkQ29udGFpbmVyQnlJZChpZGVudGlmaWVyKTtcbiAgICAgICAgICAgICAgICBpZiAoZm91bmRDb250YWluZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGZvdW5kQ29udGFpbmVyO1xuICAgIH1cblxuICAgIG1vZHVsZSh0YXJnZXQ6IENsYXNzQ29uc3RydWN0b3IpIHtcblxuICAgICAgICBjb25zdCBtb2R1bGVNZXRhID0gZ2V0TW9kdWxlTWV0YWRhdGEodGFyZ2V0KTtcblxuICAgICAgICBpZiAoIW1vZHVsZU1ldGEpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBNb2R1bGVNZXRhZGF0YUVycm9yKHRhcmdldC5uYW1lLCB0aGlzLmNvbnRhaW5lcklkKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHsgaW1wb3J0cyA9IFtdLCBleHBvcnRzID0gW10sIHByb3ZpZGVycyA9IFtdLCBpZGVudGlmaWVyIH0gPSBtb2R1bGVNZXRhO1xuXG4gICAgICAgIC8vIGlmIHRoZXJlJ3Mgbm8gY29udGFpbmVyIGluIHRoZSBtb2R1bGUgbWV0YWRhdGEsIGNyZWF0ZSB0aGUgbWFpbiBjb250YWluZXIgZm9yIHRoZSBtb2R1bGVcbiAgICAgICAgaWYgKCFtb2R1bGVNZXRhLmhhc0NvbnRhaW5lcigpKSB7XG5cbiAgICAgICAgICAgIGNvbnN0IG1vZHVsZUNvbnRhaW5lciA9IG5ldyBESUNvbnRhaW5lcih1bmRlZmluZWQsIGlkZW50aWZpZXIpO1xuICAgICAgICAgICAgLy8gdGhpcy5sb2dnZXIuaW5mbyhgTW9kdWxlICR7bW9kdWxlTWV0YS5pZGVudGlmaWVyfSBtZXRhZGF0YSBkb2VzIG5vdCBoYXZlIGEgY29udGFpbmVyLCBhc3NpZ25pbmcgb25lLmAsIHsgaWQ6IG1vZHVsZUNvbnRhaW5lci5jb250YWluZXJJZCB9KTtcblxuICAgICAgICAgICAgbW9kdWxlTWV0YS5zZXRDb250YWluZXIobW9kdWxlQ29udGFpbmVyKTtcblxuICAgICAgICAgICAgLy8gbWFrZSBzdXJlIGFsbCB0aGUgbW9kdWxlIHByb3ZpZGVycyBhcmUgbG9hZGVkIGludG8gdGhlIG1vZHVsZSdzIGNvbnRhaW5lcidzIHByb3ZpZGVyc1xuICAgICAgICAgICAgZm9yIChjb25zdCBwcm92aWRlciBvZiBwcm92aWRlcnMpIHtcbiAgICAgICAgICAgICAgICBtb2R1bGVDb250YWluZXIucmVnaXN0ZXIocHJvdmlkZXIpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gYW5kIG1ha2Ugc3VyZSBhbGwgdGhlIG1vZHVsZSBleHBvcnRzIGFyZSBhbHNvIGxvYWRlZCBpbnRvIHRoZSBtb2R1bGUncyBjb250YWluZXIncyBwcm92aWRlcnNcbiAgICAgICAgICAgIGZvciAoY29uc3QgaW1wb3J0ZWRNb2R1bGUgb2YgaW1wb3J0cykge1xuICAgICAgICAgICAgICAgIG1vZHVsZUNvbnRhaW5lci5tb2R1bGUoaW1wb3J0ZWRNb2R1bGUpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBsb2FkIGFsbCB0aGUgZXhwb3J0IGZyb20gdGhpcyBtb2R1bGUgaW50byB0aGUgY3VycmVudCBjb250YWluZXJcbiAgICAgICAgICAgIGZvciAoY29uc3QgZXhwb3J0ZWREZXAgb2YgZXhwb3J0cykge1xuICAgICAgICAgICAgICAgIG1vZHVsZUNvbnRhaW5lci5leHBvcnRQcm92aWRlcnNGb3IoZXhwb3J0ZWREZXApO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBUT0RPOiBtb2R1bGUgbGlmZWN5Y2xlIGhvb2tzXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBtb2R1bGVQcm94eUNvbnRhaW5lciA9IChtb2R1bGVNZXRhLmNvbnRhaW5lciBhcyBESUNvbnRhaW5lcikuYWRkUHJveHlDb250YWluZXJJbih0aGlzKTtcblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgaWRlbnRpZmllcixcbiAgICAgICAgICAgIGNvbnRhaW5lcjogbW9kdWxlUHJveHlDb250YWluZXJcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHB1YmxpYyBleHBvcnRQcm92aWRlcnNGb3I8VD4oZXhwb3J0ZWREZXA6IERlcElkZW50aWZpZXI8VD4pIHtcbiAgICAgICAgY29uc3QgdG9rZW4gPSB0aGlzLmNyZWF0ZVRva2VuKGV4cG9ydGVkRGVwKTtcblxuICAgICAgICBsZXQgZm91bmRQcm92aWRlcnNGb3JUb2tlbiA9IGZhbHNlO1xuXG4gICAgICAgIC8vIENvbGxlY3QgcHJvdmlkZXJzIGRpcmVjdGx5IG1hdGNoaW5nIHRoZSBleHBvcnQgdG9rZW5cbiAgICAgICAgY29uc3QgYXZhaWxhYmxlUHJvdmlkZXJzID0gdGhpcy5wcm92aWRlcnMuZ2V0KHRva2VuKSB8fCBbXTtcbiAgICAgICAgY29uc3QgY2hpbGRFeHBvcnRlZFByb3ZpZGVycyA9IEFycmF5LmZyb20odGhpcy5jaGlsZENvbnRhaW5lcnMpXG4gICAgICAgICAgICAuZmxhdE1hcChjaGlsZCA9PiBjaGlsZC5leHBvcnRzLmdldCh0b2tlbikgfHwgW10pO1xuXG4gICAgICAgIC8vIENvbWJpbmUgYXZhaWxhYmxlIHByb3ZpZGVycyBhbmQgY2hpbGQgZXhwb3J0ZWQgcHJvdmlkZXJzXG4gICAgICAgIGNvbnN0IGFsbFByb3ZpZGVycyA9IFsgLi4uYXZhaWxhYmxlUHJvdmlkZXJzLCAuLi5jaGlsZEV4cG9ydGVkUHJvdmlkZXJzIF07XG5cbiAgICAgICAgLy8gTmVzdGVkIGZ1bmN0aW9uIHRvIG1hcCBhbmQgZXhwb3J0IHByb3ZpZGVyc1xuICAgICAgICBjb25zdCBtYXBBbmRFeHBvcnRQcm92aWRlcnMgPSAocHJvdmlkZXJzOiBJbnRlcm5hbFByb3ZpZGVyT3B0aW9uc1tdLCB0YXJnZXRUb2tlbjogc3RyaW5nKSA9PiB7XG5cbiAgICAgICAgICAgIGZvdW5kUHJvdmlkZXJzRm9yVG9rZW4gPSB0cnVlO1xuXG4gICAgICAgICAgICBjb25zdCBleHBvcnRlZCA9IHByb3ZpZGVycy5tYXAocHJvdmlkZXIgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IHsgX2NvbnRhaW5lciwgX3Byb3ZpZGVyLCBfaWQgfSA9IHByb3ZpZGVyO1xuICAgICAgICAgICAgICAgIGNvbnN0IHsgY29uZGl0aW9uLCBwcm92aWRlLCBwcmlvcml0eSwgb3ZlcnJpZGUsIHNpbmdsZXRvbiwgdGFncywgdHlwZSwgZm9yRW50aXR5IH0gPSBfcHJvdmlkZXI7XG5cbiAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICBfcHJvdmlkZXI6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHVzZUZhY3Rvcnk6ICgpID0+IF9jb250YWluZXIucmVzb2x2ZShwcm92aWRlKSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbmRpdGlvbixcbiAgICAgICAgICAgICAgICAgICAgICAgIHByb3ZpZGUsXG4gICAgICAgICAgICAgICAgICAgICAgICBwcmlvcml0eSxcbiAgICAgICAgICAgICAgICAgICAgICAgIG92ZXJyaWRlLFxuICAgICAgICAgICAgICAgICAgICAgICAgc2luZ2xldG9uLFxuICAgICAgICAgICAgICAgICAgICAgICAgdGFncyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHR5cGUsXG4gICAgICAgICAgICAgICAgICAgICAgICBmb3JFbnRpdHksXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIF9pZCxcbiAgICAgICAgICAgICAgICAgICAgX2NvbnRhaW5lcjogdGhpc1xuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgLy8gTWVyZ2Ugb3Igc2V0IHRoZXNlIGV4cG9ydGVkIHByb3ZpZGVycyB1bmRlciB0aGVpciByZXNwZWN0aXZlIGtleXNcbiAgICAgICAgICAgIGNvbnN0IGV4aXN0aW5nRXhwb3J0cyA9IHRoaXMuZXhwb3J0cy5nZXQodGFyZ2V0VG9rZW4pIHx8IFtdO1xuICAgICAgICAgICAgdGhpcy5leHBvcnRzLnNldCh0YXJnZXRUb2tlbiwgWyAuLi5leGlzdGluZ0V4cG9ydHMsIC4uLmV4cG9ydGVkIF0pO1xuICAgICAgICB9O1xuXG4gICAgICAgIGlmIChhbGxQcm92aWRlcnMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgLy8gRXhwb3J0IHRoZSBzdGFuZGFyZCBhbmQgY29uZmlnIHByb3ZpZGVycyBkaXJlY3RseSBtYXRjaGluZyB0aGUgdG9rZW5cbiAgICAgICAgICAgIG1hcEFuZEV4cG9ydFByb3ZpZGVycyhhbGxQcm92aWRlcnMsIHRva2VuKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEZpbmQgYWxsIGNvbmZpZyBwcm92aWRlcnMgd2hvc2Uga2V5cyBzdGFydCB3aXRoIHRoZSB0b2tlbiBhbmQgZXhwb3J0IHRoZW1cbiAgICAgICAgZm9yIChjb25zdCBbIGNvbmZpZ0tleSwgY29uZmlnUHJvdmlkZXJzIF0gb2YgdGhpcy5wcm92aWRlcnMuZW50cmllcygpKSB7XG4gICAgICAgICAgICBpZiAoY29uZmlnS2V5LnN0YXJ0c1dpdGgodG9rZW4pICYmIGNvbmZpZ1Byb3ZpZGVycy5zb21lKHAgPT4gcC5fcHJvdmlkZXIudHlwZSA9PT0gJ2NvbmZpZycpKSB7XG4gICAgICAgICAgICAgICAgbWFwQW5kRXhwb3J0UHJvdmlkZXJzKGNvbmZpZ1Byb3ZpZGVycywgY29uZmlnS2V5KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghZm91bmRQcm92aWRlcnNGb3JUb2tlbikge1xuICAgICAgICAgICAgdGhyb3cgbmV3IE5vdGhpbmdUb0V4cG9ydEVycm9yKHRva2VuLCB0aGlzLmNvbnRhaW5lcklkKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGNyZWF0ZVRva2VuPFQ+KHRva2VuT3JUeXBlOiBEZXBJZGVudGlmaWVyPFQ+KTogVG9rZW4ge1xuICAgICAgICAvLyBtYXliZSBhZGQgYSBtZWNoYW5pc20gZm9yIGFkZGluZyBleHRyYSBtZXRhZGF0YSB0byB0aGUgdG9rZW4gbGlrZSBjb250YWluZXIgSUQgYW5kIHN0dWZmP1xuICAgICAgICByZXR1cm4gbWFrZURJVG9rZW4odG9rZW5PclR5cGUpO1xuICAgIH1cblxuICAgIHJlZ2lzdGVyPFQ+KG9wdGlvbnM6IFByb3ZpZGVyT3B0aW9uczxUPiwgY29udGFpbmVyOiBESUNvbnRhaW5lciA9IHRoaXMpOiB7IHByb3ZpZGU6IFRva2VuLCBvcHRpb25zOiBQcm92aWRlck9wdGlvbnM8VD4gfSB8IHVuZGVmaW5lZCB7XG4gICAgICAgIGlmIChjb250YWluZXIgIT09IHRoaXMpIHtcbiAgICAgICAgICAgIHJldHVybiBjb250YWluZXIucmVnaXN0ZXIob3B0aW9ucyk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB0b2tlbiA9IHRoaXMuY3JlYXRlVG9rZW4ob3B0aW9ucy5wcm92aWRlKTtcblxuICAgICAgICBjb25zdCBvcHRpb25zQ29weSA9IHtcbiAgICAgICAgICAgIC4uLm9wdGlvbnMsXG4gICAgICAgICAgICB0eXBlOiBvcHRpb25zLnR5cGUgfHwgJ3Vua25vd24nLFxuICAgICAgICAgICAgcHJpb3JpdHk6IG9wdGlvbnMucHJpb3JpdHkgIT09IHVuZGVmaW5lZCA/IG9wdGlvbnMucHJpb3JpdHkgOiAwLFxuICAgICAgICAgICAgc2luZ2xldG9uOiBvcHRpb25zLnNpbmdsZXRvbiAhPT0gdW5kZWZpbmVkID8gb3B0aW9ucy5zaW5nbGV0b24gOiB0cnVlLFxuICAgICAgICB9O1xuXG4gICAgICAgIGlmIChvcHRpb25zQ29weS5jb25kaXRpb24gJiYgIW9wdGlvbnNDb3B5LmNvbmRpdGlvbigpKSByZXR1cm47XG5cbiAgICAgICAgdmFsaWRhdGVQcm92aWRlck9wdGlvbnMob3B0aW9uc0NvcHksIHRva2VuKTtcblxuICAgICAgICAvLyBIYW5kbGUgY29uZmlnIHByb3ZpZGVyc1xuICAgICAgICBpZiAoaXNDb25maWdQcm92aWRlck9wdGlvbnMob3B0aW9ucykpIHtcbiAgICAgICAgICAgIHRoaXMucmVnaXN0ZXJDb25maWdQcm92aWRlcihvcHRpb25zKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMucmVnaXN0ZXJQcm92aWRlcih7IF9wcm92aWRlcjogb3B0aW9uc0NvcHkgfSk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgcHJvdmlkZTogdG9rZW4sXG4gICAgICAgICAgICBvcHRpb25zOiBvcHRpb25zQ29weSxcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICByZWdpc3RlckNvbmZpZ1Byb3ZpZGVyKG9wdGlvbnM6IENvbmZpZ1Byb3ZpZGVyT3B0aW9ucykge1xuICAgICAgICBjb25zdCB7IHVzZUNvbmZpZywgcHJvdmlkZTogcHJvdmlkZSwgLi4ucmVzdCB9ID0gb3B0aW9ucztcblxuICAgICAgICBsZXQgcHJvdmlkZVRva2VuID0gc3RyaXBESVRva2VuTmFtZXNwYWNlKHRoaXMuY3JlYXRlVG9rZW4ocHJvdmlkZSkpO1xuICAgICAgICBjb25zdCBmbGF0dGVuZWRFbnRyaWVzID0gZmxhdHRlbkNvbmZpZyh1c2VDb25maWcsIHByb3ZpZGVUb2tlbik7XG5cbiAgICAgICAgZm9yIChjb25zdCBbIGNvbmZpZ1BhdGgsIHZhbHVlIF0gb2YgZmxhdHRlbmVkRW50cmllcykge1xuICAgICAgICAgICAgdGhpcy5yZWdpc3RlclByb3ZpZGVyKHtcbiAgICAgICAgICAgICAgICBfcHJvdmlkZXI6IHtcbiAgICAgICAgICAgICAgICAgICAgLi4ucmVzdCxcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogJ2NvbmZpZycsXG4gICAgICAgICAgICAgICAgICAgIHByb3ZpZGU6IGNvbmZpZ1BhdGgsXG4gICAgICAgICAgICAgICAgICAgIHVzZUNvbmZpZzogdmFsdWUsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJvdGVjdGVkIHJlZ2lzdGVyUHJvdmlkZXIob3B0aW9uczogUGFydGlhbEJ5PEludGVybmFsUHJvdmlkZXJPcHRpb25zLCAnX2lkJyB8ICdfY29udGFpbmVyJz4pIHtcbiAgICAgICAgY29uc3QgY3VycmVudFByb3ZpZGVyID0gb3B0aW9ucy5fcHJvdmlkZXI7XG4gICAgICAgIGNvbnN0IHRva2VuID0gdGhpcy5jcmVhdGVUb2tlbihjdXJyZW50UHJvdmlkZXIucHJvdmlkZSk7XG4gICAgICAgIGN1cnJlbnRQcm92aWRlci5fdG9rZW4gPSB0b2tlbjtcblxuICAgICAgICBjb25zdCB0b2tlblByb3ZpZGVycyA9IHRoaXMucHJvdmlkZXJzLmdldCh0b2tlbikgfHwgW107XG5cbiAgICAgICAgY29uc3QgYXJlQm90aFZhbHVlc0VxdWFsID0gPFQ+KHZhbHVlMTogVCB8IG51bGwgfCB1bmRlZmluZWQsIHZhbHVlMjogVCB8IG51bGwgfCB1bmRlZmluZWQpOiBib29sZWFuID0+IHtcbiAgICAgICAgICAgIHJldHVybiAodmFsdWUxID09IG51bGwgJiYgdmFsdWUyID09IG51bGwpIHx8ICh2YWx1ZTEgIT09IG51bGwgJiYgdmFsdWUxICE9PSB1bmRlZmluZWQgJiYgdmFsdWUxID09PSB2YWx1ZTIpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgYXJlQm90aEFycmF5c0VxdWFsID0gPFQ+KGFycjE6IFRbXSB8IG51bGwgfCB1bmRlZmluZWQsIGFycjI6IFRbXSB8IG51bGwgfCB1bmRlZmluZWQpOiBib29sZWFuID0+IHtcbiAgICAgICAgICAgIGlmIChhcnIxID09IG51bGwgJiYgYXJyMiA9PSBudWxsKSByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgIGlmIChhcnIxID09IG51bGwgfHwgYXJyMiA9PSBudWxsIHx8IGFycjEubGVuZ3RoICE9PSBhcnIyLmxlbmd0aCkgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgcmV0dXJuIFsgLi4uYXJyMSBdLnNvcnQoKS5ldmVyeSgodmFsdWUsIGluZGV4KSA9PiB2YWx1ZSA9PT0gYXJyMi5zbGljZSgpLnNvcnQoKVsgaW5kZXggXSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBpZiB0b2tlbiBwcm92aWRlcnMgYWxyZWFkeSBoYXMgYSBwcm92aWRlciB3aXRoIHNhbWUgcHJpb3JpdHksIHR5cGUsIGZvckVudGl0eSBhbmQgdGFncywgbG9nIHdhcm5pbmcgYW5kIHJlcGxhY2UgaXRcbiAgICAgICAgY29uc3QgZXhpc3RpbmdQcm92aWRlciA9IHRva2VuUHJvdmlkZXJzLmZpbmQoKHsgX3Byb3ZpZGVyOiBleGlzdGluZ1Byb3ZpZGVyIH0pID0+IHtcbiAgICAgICAgICAgIHJldHVybiBleGlzdGluZ1Byb3ZpZGVyLnByaW9yaXR5ID09PSBjdXJyZW50UHJvdmlkZXIucHJpb3JpdHlcbiAgICAgICAgICAgICAgICAmJiBhcmVCb3RoVmFsdWVzRXF1YWwoZXhpc3RpbmdQcm92aWRlci50eXBlLCBjdXJyZW50UHJvdmlkZXIudHlwZSlcbiAgICAgICAgICAgICAgICAmJiBhcmVCb3RoQXJyYXlzRXF1YWwoZXhpc3RpbmdQcm92aWRlci50YWdzLCBjdXJyZW50UHJvdmlkZXIudGFncykgLy8gISBtYXliZSBiZSBtYWtlIGl0IGNvbmZpZ3VyYWJsZSB0byBjb21wYXJlIHRhZ3MuLi5cbiAgICAgICAgICAgICAgICAmJiBhcmVCb3RoVmFsdWVzRXF1YWwoZXhpc3RpbmdQcm92aWRlci5mb3JFbnRpdHksIGN1cnJlbnRQcm92aWRlci5mb3JFbnRpdHkpXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGlmIChleGlzdGluZ1Byb3ZpZGVyKSB7XG4gICAgICAgICAgICAvLyBjb25zdCBpbmRleCA9IHRva2VuUHJvdmlkZXJzLmluZGV4T2YoZXhpc3RpbmdQcm92aWRlcik7XG4gICAgICAgICAgICAvLyBkZWxldGUgdGhlIGV4aXN0aW5nIHByb3ZpZGVyXG4gICAgICAgICAgICAvLyB0b2tlblByb3ZpZGVycy5zcGxpY2UoaW5kZXgsIDEpO1xuXG4gICAgICAgICAgICAvLyBETyBOT1QgcmVwbGFjZSB0aGUgZXhpc3RpbmcgcHJvdmlkZXIsIGp1c3QgbG9nIGEgd2FybmluZ1xuICAgICAgICAgICAgLy8gdGhpcy5sb2dnZXIud2FybihgUHJvdmlkZXIgZm9yICR7dG9rZW59IHdpdGggc2FtZSBwcmlvcml0eSwgdHlwZSwgZm9yRW50aXR5IGFuZCB0YWdzIGFscmVhZHkgZXhpc3RzLCByZXBsYWNpbmcgaXQuIHwgT3B0aW9uc1ske0pTT04uc3RyaW5naWZ5KG9wdGlvbnMpfV1gKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGludGVybmFsUHJvdmlkZXJPcHRpb25zID0ge1xuICAgICAgICAgICAgLi4ub3B0aW9ucyxcbiAgICAgICAgICAgIF9pZDogZ2VuZXJhdGVVVUlEKCksXG4gICAgICAgICAgICBfY29udGFpbmVyOiB0aGlzLFxuICAgICAgICB9O1xuXG4gICAgICAgIHRva2VuUHJvdmlkZXJzLnB1c2goaW50ZXJuYWxQcm92aWRlck9wdGlvbnMpO1xuICAgICAgICB0aGlzLnByb3ZpZGVycy5zZXQodG9rZW4sIHRva2VuUHJvdmlkZXJzKTtcbiAgICB9XG5cbiAgICByZW1vdmVQcm92aWRlcnNGb3IoZGVwZW5kZW5jeVRva2VuOiBEZXBJZGVudGlmaWVyKSB7XG4gICAgICAgIGNvbnN0IHRva2VuID0gdGhpcy5jcmVhdGVUb2tlbihkZXBlbmRlbmN5VG9rZW4pO1xuICAgICAgICBjb25zdCBwcm92aWRlcnMgPSB0aGlzLnByb3ZpZGVycy5nZXQodG9rZW4pIHx8IFtdO1xuICAgICAgICBwcm92aWRlcnMuZm9yRWFjaChwcm92aWRlciA9PiB7XG4gICAgICAgICAgICB0aGlzLmNhY2hlLmRlbGV0ZShwcm92aWRlci5faWQhKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHRoaXMucHJvdmlkZXJzLmRlbGV0ZSh0b2tlbik7XG4gICAgfVxuXG4gICAgLy8gUmVzb2x2ZSBhIGNvbmZpZ3VyYXRpb24gcGF0aCB3aXRoIGZsZXhpYmxlIGNyaXRlcmlhLCBzdXBwb3J0aW5nIHdpbGRjYXJkcyBhbmQgcmVnZXhcbiAgICByZXNvbHZlQ29uZmlnPFQgPSBhbnk+KFxuICAgICAgICBxdWVyeTogc3RyaW5nID0gJycsXG4gICAgICAgIGNyaXRlcmlhPzoge1xuICAgICAgICAgICAgcHJpb3JpdHk/OiBQcmlvcml0eUNyaXRlcmlhO1xuICAgICAgICAgICAgdGFncz86IHN0cmluZ1tdO1xuICAgICAgICB9XG4gICAgKTogRGVlcFBhcnRpYWw8VD4ge1xuXG4gICAgICAgIHF1ZXJ5ID0gc3RyaXBESVRva2VuTmFtZXNwYWNlKHF1ZXJ5KTtcblxuICAgICAgICBjb25zdCBtYXRjaGluZ1BhdGhzID0gdGhpcy5jb2xsZWN0TWF0Y2hpbmdDb25maWdQYXRocyhxdWVyeSk7XG5cbiAgICAgICAgY29uc3QgcmVzb2x2ZWRWYWx1ZXMgPSB0aGlzLnJlc29sdmVDb25maWdQYXRocyhtYXRjaGluZ1BhdGhzLCBjcml0ZXJpYSk7XG5cbiAgICAgICAgLy8gTWVyZ2UgcmVzb2x2ZWQgdmFsdWVzIGludG8gYSBmaW5hbCBjb25maWd1cmF0aW9uIG9iamVjdFxuICAgICAgICBjb25zdCBtZXJnZWRDb25maWc6IFJlY29yZDxhbnksIGFueT4gPSB7fTtcblxuICAgICAgICByZXNvbHZlZFZhbHVlcy5mb3JFYWNoKCh2YWx1ZSwgcGF0aCkgPT4ge1xuICAgICAgICAgICAgcGF0aCA9IHN0cmlwRElUb2tlbk5hbWVzcGFjZShwYXRoKTtcbiAgICAgICAgICAgIHNldFBhdGhWYWx1ZShtZXJnZWRDb25maWcsIHBhdGgsIHZhbHVlKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIGdldFBhdGhWYWx1ZShtZXJnZWRDb25maWcsIHF1ZXJ5KSBhcyBEZWVwUGFydGlhbDxUPjtcbiAgICB9XG5cbiAgICAvLyBDb2xsZWN0IGFsbCBwYXRocyB0aGF0IG1hdGNoIHRoZSBxdWVyeSwgc3VwcG9ydGluZyB3aWxkY2FyZHMgYW5kIHJlZ2V4XG4gICAgcHJpdmF0ZSBjb2xsZWN0TWF0Y2hpbmdDb25maWdQYXRocyhxdWVyeTogc3RyaW5nKTogU2V0PHN0cmluZz4ge1xuICAgICAgICBjb25zdCBtYXRjaGluZ1BhdGhzOiBTZXQ8c3RyaW5nPiA9IG5ldyBTZXQoKTtcblxuICAgICAgICBjb25zdCBwcm9jZXNzS2V5cyA9IChrZXlzOiBJdGVyYWJsZUl0ZXJhdG9yPHN0cmluZz4pID0+IHtcbiAgICAgICAgICAgIGZvciAoY29uc3QgcGF0aCBvZiBrZXlzKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgYWN0dWFsUGF0aCA9IHN0cmlwRElUb2tlbk5hbWVzcGFjZShwYXRoKTtcbiAgICAgICAgICAgICAgICBpZiAobWF0Y2hlc1BhdHRlcm4oYWN0dWFsUGF0aCwgcXVlcnkpKSB7XG4gICAgICAgICAgICAgICAgICAgIG1hdGNoaW5nUGF0aHMuYWRkKHBhdGgpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcblxuICAgICAgICBsZXQgY3VycmVudDogRElDb250YWluZXIgfCB1bmRlZmluZWQgPSB0aGlzO1xuXG4gICAgICAgIHdoaWxlIChjdXJyZW50KSB7XG4gICAgICAgICAgICAvLyBDaGVjayB0aGUgcHJvdmlkZXJzIGluIHRoZSBjdXJyZW50IGNvbnRhaW5lclxuICAgICAgICAgICAgcHJvY2Vzc0tleXMoY3VycmVudC5wcm92aWRlcnMua2V5cygpKTtcblxuICAgICAgICAgICAgLy8gQ2hlY2sgdGhlIGV4cG9ydGVkIHByb3ZpZGVycyBmcm9tIGNoaWxkIGNvbnRhaW5lcnNcbiAgICAgICAgICAgIGN1cnJlbnQuY2hpbGRDb250YWluZXJzLmZvckVhY2goY2hpbGQgPT4ge1xuICAgICAgICAgICAgICAgIHByb2Nlc3NLZXlzKGNoaWxkLmV4cG9ydHMua2V5cygpKTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAvLyBNb3ZlIHRvIHRoZSBwYXJlbnQgY29udGFpbmVyXG4gICAgICAgICAgICBjdXJyZW50ID0gY3VycmVudC5wYXJlbnQ7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gbWF0Y2hpbmdQYXRocztcbiAgICB9XG5cbiAgICAvLyBSZXNvbHZlIHZhbHVlcyBmb3IgYWxsIG1hdGNoaW5nIHBhdGhzIHVzaW5nIHRoZSBiZXN0IHByb3ZpZGVyIGZyb20gdGhlIGhpZXJhcmNoeSBiYXNlZCBvbiBjcml0ZXJpYVxuICAgIHByaXZhdGUgcmVzb2x2ZUNvbmZpZ1BhdGhzKFxuICAgICAgICBwYXRoczogU2V0PHN0cmluZz4sXG4gICAgICAgIGNyaXRlcmlhPzoge1xuICAgICAgICAgICAgcHJpb3JpdHk/OiBQcmlvcml0eUNyaXRlcmlhO1xuICAgICAgICAgICAgdGFncz86IHN0cmluZ1tdO1xuICAgICAgICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVycz86IGJvb2xlYW5cbiAgICAgICAgfVxuICAgICk6IE1hcDxzdHJpbmcsIGFueT4ge1xuXG4gICAgICAgIGNvbnN0IHJlc29sdmVkVmFsdWVzID0gbmV3IE1hcDxzdHJpbmcsIGFueT4oKTtcblxuICAgICAgICBjb25zdCByZWR1Y2VQcm92aWRlcnMgPSAocHJvdmlkZXJzOiBJbnRlcm5hbFByb3ZpZGVyT3B0aW9uc1tdKTogYW55ID0+IHtcbiAgICAgICAgICAgIGlmIChwcm92aWRlcnMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gQXNzdW1lIHRoZSBoaWdoZXN0LXByaW9yaXR5IHByb3ZpZGVyJ3MgdmFsdWUgaXMgdGhlIGRlc2lyZWQgb25lXG4gICAgICAgICAgICBjb25zdCBiZXN0UHJvdmlkZXIgPSBwcm92aWRlcnNbIDAgXS5fcHJvdmlkZXIgYXMgQ29uZmlnUHJvdmlkZXJPcHRpb25zPGFueT47XG4gICAgICAgICAgICByZXR1cm4gYmVzdFByb3ZpZGVyLnVzZUNvbmZpZ1xuICAgICAgICB9XG5cbiAgICAgICAgcGF0aHMuZm9yRWFjaCgocGF0aCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgYmVzdFByb3ZpZGVycyA9IHRoaXMuY29sbGVjdEJlc3RQcm92aWRlcnNGb3I8Q29uZmlnUHJvdmlkZXJPcHRpb25zPih7XG4gICAgICAgICAgICAgICAgLi4uY3JpdGVyaWEsXG4gICAgICAgICAgICAgICAgdG9rZW46IHBhdGgsXG4gICAgICAgICAgICAgICAgdHlwZTogJ2NvbmZpZydcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBjb25zdCByZXNvbHZlZFZhbHVlID0gcmVkdWNlUHJvdmlkZXJzKGJlc3RQcm92aWRlcnMpO1xuXG4gICAgICAgICAgICByZXNvbHZlZFZhbHVlcy5zZXQocGF0aCwgcmVzb2x2ZWRWYWx1ZSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiByZXNvbHZlZFZhbHVlcztcbiAgICB9XG5cbiAgICAvLyBDb2xsZWN0IGFsbCBwcm92aWRlcnMgZm9yIGEgZ2l2ZW4gcGF0aCBhY3Jvc3MgdGhlIGhpZXJhcmNoeVxuICAgIHB1YmxpYyBjb2xsZWN0QmVzdFByb3ZpZGVyc0ZvcjxUPihcbiAgICAgICAgY3JpdGVyaWE6IHtcbiAgICAgICAgICAgIHRva2VuPzogc3RyaW5nLFxuICAgICAgICAgICAgdGFncz86IHN0cmluZ1tdLFxuICAgICAgICAgICAgdHlwZT86IFByb3ZpZGVyT3B0aW9uc1sgJ3R5cGUnIF0sXG4gICAgICAgICAgICBwcmlvcml0eT86IFByaW9yaXR5Q3JpdGVyaWEsXG4gICAgICAgICAgICBmb3JFbnRpdHk/OiBQcm92aWRlck9wdGlvbnNbICdmb3JFbnRpdHknIF0sXG4gICAgICAgICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzPzogYm9vbGVhblxuICAgICAgICB9XG4gICAgKTogSW50ZXJuYWxQcm92aWRlck9wdGlvbnM8VD5bXSB7XG4gICAgICAgIGNvbnN0IGJlc3RQcm92aWRlcnMgPSBuZXcgTWFwPHN0cmluZywgSW50ZXJuYWxQcm92aWRlck9wdGlvbnM8VD4+KCk7XG5cbiAgICAgICAgbGV0IGN1cnJlbnQ6IERJQ29udGFpbmVyIHwgdW5kZWZpbmVkID0gdGhpcztcbiAgICAgICAgbGV0IGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnMgPSBjcml0ZXJpYS5hbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzIHx8IGZhbHNlO1xuXG4gICAgICAgIGNvbnN0IHZpc2l0ZWRDb250YWluZXJzID0gbmV3IFNldDxESUNvbnRhaW5lcj4oKTtcblxuICAgICAgICBjb25zdCBjcml0ZXJpYVN0cmluZyA9IEpTT04uc3RyaW5naWZ5KGNyaXRlcmlhKTtcblxuICAgICAgICB3aGlsZSAoY3VycmVudCkge1xuICAgICAgICAgICAgaWYgKHZpc2l0ZWRDb250YWluZXJzLmhhcyhjdXJyZW50KSkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgQ2lyY3VsYXIgcmVmZXJlbmNlIGRldGVjdGVkIGluIGNvbnRhaW5lciBoaWVyYXJjaHkuIERJQ29udGFpbmVyWyR7dGhpcy5jb250YWluZXJJZH1dIHwgQ3JpdGVyaWE6IFske2NyaXRlcmlhU3RyaW5nfV1gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHZpc2l0ZWRDb250YWluZXJzLmFkZChjdXJyZW50KTtcblxuICAgICAgICAgICAgbGV0IHBhdGhQcm92aWRlcnMgPSBjcml0ZXJpYS50b2tlblxuICAgICAgICAgICAgICAgID8gY3VycmVudC5wcm92aWRlcnMuZ2V0KGNyaXRlcmlhLnRva2VuKSB8fCBbXVxuICAgICAgICAgICAgICAgIDogQXJyYXkuZnJvbShjdXJyZW50LnByb3ZpZGVycy52YWx1ZXMoKSkuZmxhdCgpO1xuXG4gICAgICAgICAgICBpZiAoY3JpdGVyaWE/LnR5cGUpIHtcbiAgICAgICAgICAgICAgICBwYXRoUHJvdmlkZXJzID0gcGF0aFByb3ZpZGVycy5maWx0ZXIocCA9PiBwLl9wcm92aWRlci50eXBlID09PSBjcml0ZXJpYS50eXBlKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGNyaXRlcmlhPy5mb3JFbnRpdHkpIHtcbiAgICAgICAgICAgICAgICBwYXRoUHJvdmlkZXJzID0gcGF0aFByb3ZpZGVycy5maWx0ZXIocCA9PiBwLl9wcm92aWRlci5mb3JFbnRpdHkgPT09IGNyaXRlcmlhLmZvckVudGl0eSlcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcGF0aFByb3ZpZGVycy5mb3JFYWNoKHByb3ZpZGVyID0+IHtcblxuICAgICAgICAgICAgICAgIGlmIChiZXN0UHJvdmlkZXJzLmhhcyhwcm92aWRlci5faWQpKSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIHRoaXMubG9nZ2VyLmluZm8oYFByb3ZpZGVyIHdpdGggaWQgJHtwcm92aWRlci5faWR9IGFscmVhZHkgZXhpc3RzIGluIGJlc3QtcHJvdmlkZXJzLCBza2lwcGluZyBpdC4gfCBDcml0ZXJpYTogWyR7Y3JpdGVyaWFTdHJpbmd9XWApO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgYmVzdFByb3ZpZGVycy5zZXQocHJvdmlkZXIuX2lkLCB7XG4gICAgICAgICAgICAgICAgICAgIC4uLnByb3ZpZGVyLFxuICAgICAgICAgICAgICAgICAgICAvLyB3aGVuIGl0J3MgYSBwcm94eSBjb250YWluZXIgbWFrZSBzdXJlIHRoZSBwcm92aWRlciBoYXMgaXQncyByZWZlcmVuY2UgZm9yIHJlc29sdmluZyBpdCBsYXRlcixcbiAgICAgICAgICAgICAgICAgICAgLy8gdGhhdCB3YXkgdGhlIHByb3ZpZGVyIGlzIHJlc29sdmVkIHVzaW5nIHRoZSByaWdodCBoaWVyYXJjaHlcbiAgICAgICAgICAgICAgICAgICAgX2NvbnRhaW5lcjogY3VycmVudCBhcyBESUNvbnRhaW5lclxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIC8vIENvbGxlY3QgZXhwb3J0ZWQgcHJvdmlkZXJzIGZyb20gY2hpbGQgY29udGFpbmVyc1xuICAgICAgICAgICAgY3VycmVudC5jaGlsZENvbnRhaW5lcnMuZm9yRWFjaChjaGlsZCA9PiB7XG5cbiAgICAgICAgICAgICAgICAvLyBhcyB3ZSdyZSBtb3ZpbmcgZnJvbSBjaGlsZCB0byBwYXJlbnQsIG1ha2Ugc3VyZSB0byBza2lwIG92ZXIgdGhlIHZpc2l0ZWQgY29udGFpbmVyc1xuICAgICAgICAgICAgICAgIGlmICh2aXNpdGVkQ29udGFpbmVycy5oYXMoY2hpbGQpKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICB2aXNpdGVkQ29udGFpbmVycy5hZGQoY2hpbGQpO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGNvbnN0IGNoaWxkUHJvdmlkZXJzID0gYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVycyA/IGNoaWxkLnByb3ZpZGVycyA6IGNoaWxkLmV4cG9ydHM7XG5cbiAgICAgICAgICAgICAgICBsZXQgY2hpbGRFeHBvcnRlZFByb3ZpZGVycyA9IGNyaXRlcmlhLnRva2VuID8gKGNoaWxkUHJvdmlkZXJzLmdldChjcml0ZXJpYS50b2tlbikgfHwgW10pXG4gICAgICAgICAgICAgICAgICAgIDogQXJyYXkuZnJvbShjaGlsZFByb3ZpZGVycy52YWx1ZXMoKSkuZmxhdCgpO1xuXG4gICAgICAgICAgICAgICAgaWYgKGNyaXRlcmlhPy50eXBlKSB7XG4gICAgICAgICAgICAgICAgICAgIGNoaWxkRXhwb3J0ZWRQcm92aWRlcnMgPSBjaGlsZEV4cG9ydGVkUHJvdmlkZXJzLmZpbHRlcihwID0+IHAuX3Byb3ZpZGVyLnR5cGUgPT09IGNyaXRlcmlhLnR5cGUpO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmIChjcml0ZXJpYT8uZm9yRW50aXR5KSB7XG4gICAgICAgICAgICAgICAgICAgIGNoaWxkRXhwb3J0ZWRQcm92aWRlcnMgPSBjaGlsZEV4cG9ydGVkUHJvdmlkZXJzLmZpbHRlcihwID0+IHAuX3Byb3ZpZGVyLmZvckVudGl0eSA9PT0gY3JpdGVyaWEuZm9yRW50aXR5KVxuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGNoaWxkRXhwb3J0ZWRQcm92aWRlcnMuZm9yRWFjaChwcm92aWRlciA9PiB7XG5cbiAgICAgICAgICAgICAgICAgICAgaWYgKGJlc3RQcm92aWRlcnMuaGFzKHByb3ZpZGVyLl9pZCkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIHRoaXMubG9nZ2VyLmluZm8oYFByb3ZpZGVyIHdpdGggaWQgJHtwcm92aWRlci5faWR9IGFscmVhZHkgZXhpc3RzIGluIGJlc3QtcHJvdmlkZXJzLCBza2lwcGluZyBleHBvcnRlZC1wcm92aWRlciBmcm9tIGNoaWxkIGNvbnRhaW5lcjogJHtjaGlsZC5jb250YWluZXJJZH0gfCBDcml0ZXJpYTogWyR7Y3JpdGVyaWFTdHJpbmd9XWApO1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgYmVzdFByb3ZpZGVycy5zZXQocHJvdmlkZXIuX2lkLCB7XG4gICAgICAgICAgICAgICAgICAgICAgICAuLi5wcm92aWRlcixcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIHdoZW4gaXQncyBhIHByb3h5IGNvbnRhaW5lciBtYWtlIHN1cmUgdGhlIHByb3ZpZGVyIGhhcyBpdCdzIHJlZmVyZW5jZSBmb3IgcmVzb2x2aW5nIGl0IGxhdGVyLFxuICAgICAgICAgICAgICAgICAgICAgICAgX2NvbnRhaW5lcjogY2hpbGRcbiAgICAgICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBjdXJyZW50ID0gY3VycmVudC5wYXJlbnQ7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBGaWx0ZXIgYW5kIHNvcnQgcHJvdmlkZXJzIGJhc2VkIG9uIGNyaXRlcmlhIGFuZCBjb25mbGljdCByZXNvbHV0aW9uIHN0cmF0ZWdpZXNcbiAgICAgICAgY29uc3QgYmVzdFByb3ZpZGVyc0FycmF5ID0gQXJyYXkuZnJvbShiZXN0UHJvdmlkZXJzLnZhbHVlcygpKTtcbiAgICAgICAgcmV0dXJuIGZpbHRlckFuZFNvcnRQcm92aWRlcnMoYmVzdFByb3ZpZGVyc0FycmF5LCBjcml0ZXJpYSk7XG4gICAgfVxuXG4gICAgcmVzb2x2ZTxULCBBc3luYyBleHRlbmRzIGJvb2xlYW4gPSBmYWxzZT4oXG4gICAgICAgIGRlcGVuZGVuY3lUb2tlbjogRGVwSWRlbnRpZmllcjxUPixcbiAgICAgICAgY3JpdGVyaWE/OiB7XG4gICAgICAgICAgICB0YWdzPzogc3RyaW5nW107XG4gICAgICAgICAgICB0eXBlPzogUHJvdmlkZXJPcHRpb25zWyAndHlwZScgXSxcbiAgICAgICAgICAgIHByaW9yaXR5PzogUHJpb3JpdHlDcml0ZXJpYTtcbiAgICAgICAgICAgIGZvckVudGl0eT86IFByb3ZpZGVyT3B0aW9uc1sgJ2ZvckVudGl0eScgXSxcbiAgICAgICAgICAgIGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnM/OiBib29sZWFuXG4gICAgICAgIH0sXG4gICAgICAgIHBhdGg6IFNldDxUb2tlbj4gPSBuZXcgU2V0KCksXG4gICAgICAgIGFzeW5jOiBBc3luYyA9IGZhbHNlIGFzIEFzeW5jXG4gICAgKTogQXN5bmMgZXh0ZW5kcyB0cnVlID8gUHJvbWlzZTxUPiA6IFQge1xuXG4gICAgICAgIGNvbnN0IHRva2VuID0gdGhpcy5jcmVhdGVUb2tlbihkZXBlbmRlbmN5VG9rZW4pO1xuICAgICAgICBjcml0ZXJpYSA9IGNyaXRlcmlhID8/IHt9O1xuXG4gICAgICAgIC8vIGlmIHRva2VuIGlzIGBESUNvbnRhaW5lcmAgcmV0dXJuIHRoZSBjdXJyZW50IGNvbnRhaW5lclxuICAgICAgICBpZiAoRElfVE9LRU5TLkRJX0NPTlRBSU5FUiA9PT0gdG9rZW4gfHwgdGhpcy5jcmVhdGVUb2tlbihESUNvbnRhaW5lcikgPT09IHRva2VuKSB7XG4gICAgICAgICAgICByZXR1cm4gKGFzeW5jID8gUHJvbWlzZS5yZXNvbHZlKHRoaXMpIDogdGhpcykgYXMgQXN5bmMgZXh0ZW5kcyB0cnVlID8gUHJvbWlzZTxUPiA6IFQ7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBiZXN0UHJvdmlkZXJzID0gdGhpcy5jb2xsZWN0QmVzdFByb3ZpZGVyc0ZvcjxUPih7XG4gICAgICAgICAgICAuLi5jcml0ZXJpYSxcbiAgICAgICAgICAgIHRva2VuLFxuICAgICAgICB9KTtcblxuICAgICAgICBpZiAoYmVzdFByb3ZpZGVycy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIHRoaXMubG9nUHJvdmlkZXJzKHRydWUpO1xuICAgICAgICAgICAgdGhyb3cgbmV3IE5vUHJvdmlkZXJGb3VuZEVycm9yKHRva2VuLCB0aGlzLCBjcml0ZXJpYSk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3Qgb3B0aW9ucyA9IGJlc3RQcm92aWRlcnNbIDAgXTtcblxuICAgICAgICByZXR1cm4gdGhpcy5yZXNvbHZlUHJvdmlkZXJWYWx1ZTxULCBBc3luYz4ob3B0aW9ucywgcGF0aCwgYXN5bmMpO1xuICAgIH1cblxuICAgIHJlc29sdmVQcm92aWRlclZhbHVlPFQsIEFzeW5jIGV4dGVuZHMgYm9vbGVhbiA9IGZhbHNlPihcbiAgICAgICAgb3B0aW9uczogSW50ZXJuYWxQcm92aWRlck9wdGlvbnM8VD4sXG4gICAgICAgIHBhdGg6IFNldDxUb2tlbj4gPSBuZXcgU2V0KCksXG4gICAgICAgIGFzeW5jOiBBc3luYyA9IGZhbHNlIGFzIEFzeW5jXG4gICAgKTogQXN5bmMgZXh0ZW5kcyB0cnVlID8gUHJvbWlzZTxUPiA6IFQge1xuXG4gICAgICAgIGNvbnN0IHsgX2lkLCBfY29udGFpbmVyLCBfcHJvdmlkZXI6IHByb3ZpZGVyIH0gPSBvcHRpb25zO1xuXG4gICAgICAgIGlmIChfY29udGFpbmVyICE9PSB0aGlzKSB7XG4gICAgICAgICAgICByZXR1cm4gKF9jb250YWluZXIgYXMgRElDb250YWluZXIpLnJlc29sdmVQcm92aWRlclZhbHVlKG9wdGlvbnMsIHBhdGgsIGFzeW5jKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChwcm92aWRlci5zaW5nbGV0b24gJiYgdGhpcy5jYWNoZS5oYXMoX2lkKSkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuY2FjaGUuZ2V0KF9pZCk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAodGhpcy5yZXNvbHZpbmcuaGFzKF9pZCkpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnJlc29sdmluZy5nZXQoX2lkKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChwYXRoLmhhcyhfaWQpKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgQ2lyY3VsYXJEZXBlbmRlbmN5RXJyb3IoQXJyYXkuZnJvbShwYXRoKSwgdGhpcy5jb250YWluZXJJZCk7XG4gICAgICAgIH1cblxuICAgICAgICBwYXRoLmFkZChfaWQpO1xuXG4gICAgICAgIGlmIChhc3luYykge1xuICAgICAgICAgICAgcmV0dXJuIGFwcGx5TWlkZGxld2FyZXNBc3luYyhcbiAgICAgICAgICAgICAgICB0aGlzLmFzeW5jTWlkZGxld2FyZXMsXG4gICAgICAgICAgICAgICAgKCkgPT4gdGhpcy5jcmVhdGVBbmRDYWNoZUluc3RhbmNlQXN5bmM8VD4ob3B0aW9ucywgcGF0aClcbiAgICAgICAgICAgICkgYXMgQXN5bmMgZXh0ZW5kcyB0cnVlID8gUHJvbWlzZTxUPiA6IFQ7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gYXBwbHlNaWRkbGV3YXJlcyhcbiAgICAgICAgICAgIHRoaXMubWlkZGxld2FyZXMsXG4gICAgICAgICAgICAoKSA9PiB0aGlzLmNyZWF0ZUFuZENhY2hlSW5zdGFuY2Uob3B0aW9ucywgcGF0aClcbiAgICAgICAgKSBhcyBBc3luYyBleHRlbmRzIHRydWUgPyBQcm9taXNlPFQ+IDogVDtcbiAgICB9XG5cbiAgICBwcml2YXRlIGNyZWF0ZUFuZENhY2hlSW5zdGFuY2U8VD4ob3B0aW9uczogSW50ZXJuYWxQcm92aWRlck9wdGlvbnM8VD4sIHBhdGg6IFNldDxUb2tlbj4pOiBUIHtcblxuICAgICAgICBjb25zdCB7IF9pZCwgX3Byb3ZpZGVyOiBwcm92aWRlciB9ID0gb3B0aW9ucztcblxuICAgICAgICBjb25zdCBpbnN0YW5jZSA9IHRoaXMuY3JlYXRlSW5zdGFuY2Uob3B0aW9ucywgcGF0aCk7XG4gICAgICAgIGlmIChwcm92aWRlci5zaW5nbGV0b24pIHtcbiAgICAgICAgICAgIHRoaXMuY2FjaGUuc2V0KF9pZCwgaW5zdGFuY2UpO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5yZXNvbHZpbmcuZGVsZXRlKF9pZCk7XG5cbiAgICAgICAgdGhpcy5pbmplY3RQcm9wZXJ0aWVzKGluc3RhbmNlKTtcbiAgICAgICAgdGhpcy5pbml0aWFsaXplSW5zdGFuY2UoaW5zdGFuY2UpO1xuXG4gICAgICAgIHBhdGguZGVsZXRlKF9pZCk7XG5cbiAgICAgICAgcmV0dXJuIGluc3RhbmNlO1xuICAgIH1cblxuICAgIHByaXZhdGUgY3JlYXRlSW5zdGFuY2U8VCwgQXN5bmMgZXh0ZW5kcyBib29sZWFuID0gZmFsc2U+KFxuICAgICAgICBvcHRpb25zOiBJbnRlcm5hbFByb3ZpZGVyT3B0aW9uczxUPixcbiAgICAgICAgcGF0aDogU2V0PFRva2VuPixcbiAgICAgICAgYXN5bmM6IEFzeW5jID0gZmFsc2UgYXMgQXN5bmNcbiAgICApOiBBc3luYyBleHRlbmRzIHRydWUgPyBQcm9taXNlPFQ+IDogVCB7XG5cbiAgICAgICAgY29uc3QgeyBfaWQsIF9wcm92aWRlcjogcHJvdmlkZXIgfSA9IG9wdGlvbnM7XG5cbiAgICAgICAgaWYgKGlzQWxpYXNQcm92aWRlck9wdGlvbnMocHJvdmlkZXIpKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5yZXNvbHZlKHByb3ZpZGVyLnVzZUV4aXN0aW5nLCB7fSwgcGF0aCwgYXN5bmMpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGlzQ2xhc3NQcm92aWRlck9wdGlvbnMocHJvdmlkZXIpKSB7XG5cbiAgICAgICAgICAgIHJldHVybiAoXG4gICAgICAgICAgICAgICAgYXN5bmMgPyB0aGlzLmNyZWF0ZUNsYXNzSW5zdGFuY2U8VCwgdHJ1ZT4ob3B0aW9ucywgcGF0aCwgdHJ1ZSlcbiAgICAgICAgICAgICAgICAgICAgOiB0aGlzLmNyZWF0ZUNsYXNzSW5zdGFuY2Uob3B0aW9ucywgcGF0aClcbiAgICAgICAgICAgICkgYXMgQXN5bmMgZXh0ZW5kcyB0cnVlID8gUHJvbWlzZTxUPiA6IFQ7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoaXNGYWN0b3J5UHJvdmlkZXJPcHRpb25zKHByb3ZpZGVyKSkge1xuXG4gICAgICAgICAgICByZXR1cm4gKFxuICAgICAgICAgICAgICAgIGFzeW5jID8gdGhpcy5jcmVhdGVGYWN0b3J5SW5zdGFuY2VBc3luYzxUPihwcm92aWRlciwgcGF0aClcbiAgICAgICAgICAgICAgICAgICAgOiB0aGlzLmNyZWF0ZUZhY3RvcnlJbnN0YW5jZShwcm92aWRlciwgcGF0aClcbiAgICAgICAgICAgICkgYXMgQXN5bmMgZXh0ZW5kcyB0cnVlID8gUHJvbWlzZTxUPiA6IFQ7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoaXNWYWx1ZVByb3ZpZGVyT3B0aW9ucyhwcm92aWRlcikpIHtcbiAgICAgICAgICAgIHJldHVybiBwcm92aWRlci51c2VWYWx1ZSBhcyBBc3luYyBleHRlbmRzIHRydWUgPyBQcm9taXNlPFQ+IDogVDtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChpc0NvbmZpZ1Byb3ZpZGVyT3B0aW9ucyhwcm92aWRlcikpIHtcbiAgICAgICAgICAgIHJldHVybiBwcm92aWRlci51c2VDb25maWcgYXMgQXN5bmMgZXh0ZW5kcyB0cnVlID8gUHJvbWlzZTxUPiA6IFQ7XG4gICAgICAgIH1cblxuICAgICAgICB0aHJvdyBuZXcgUHJvdmlkZXJDb25maWd1cmF0aW9uRXJyb3IoX2lkLCB0aGlzLmNvbnRhaW5lcklkKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGNyZWF0ZUNsYXNzSW5zdGFuY2U8VCwgQXN5bmMgZXh0ZW5kcyBib29sZWFuID0gZmFsc2U+KFxuICAgICAgICBvcHRpb25zOiBJbnRlcm5hbFByb3ZpZGVyT3B0aW9uczxUPixcbiAgICAgICAgcGF0aDogU2V0PFRva2VuPixcbiAgICAgICAgYXN5bmM6IEFzeW5jID0gZmFsc2UgYXMgQXN5bmNcbiAgICApOiBBc3luYyBleHRlbmRzIHRydWUgPyBQcm9taXNlPFQ+IDogVCB7XG5cbiAgICAgICAgY29uc3QgeyBfaWQsIF9wcm92aWRlcjogcHJvdmlkZXIgfSA9IG9wdGlvbnM7XG5cbiAgICAgICAgaWYgKHRoaXMucmVzb2x2aW5nLmhhcyhfaWQpKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5yZXNvbHZpbmcuZ2V0KF9pZCk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB7IHVzZUNsYXNzIH0gPSBwcm92aWRlciBhcyBDbGFzc1Byb3ZpZGVyT3B0aW9uczxUPjtcblxuICAgICAgICAvLyBDcmVhdGUgYSBwbGFjZWhvbGRlciBvYmplY3QgYW5kIHN0b3JlIGl0IGluIHRoZSByZXNvbHZpbmcgbWFwXG4gICAgICAgIGNvbnN0IGluc3RhbmNlUGxhY2Vob2xkZXI6IFQgPSBPYmplY3QuY3JlYXRlKHVzZUNsYXNzLnByb3RvdHlwZSk7XG4gICAgICAgIHRoaXMucmVzb2x2aW5nLnNldChfaWQsIGluc3RhbmNlUGxhY2Vob2xkZXIpO1xuXG5cbiAgICAgICAgaWYgKGFzeW5jKSB7XG4gICAgICAgICAgICB0aGlzLnJlc29sdmVEZXBlbmRlbmNpZXNBc3luYyh1c2VDbGFzcywgcGF0aCkudGhlbihkZXBlbmRlbmNpZXMgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IGFjdHVhbEluc3RhbmNlID0gbmV3IHVzZUNsYXNzKC4uLmRlcGVuZGVuY2llcyk7XG4gICAgICAgICAgICAgICAgT2JqZWN0LmFzc2lnbihpbnN0YW5jZVBsYWNlaG9sZGVyIGFzIGFueSwgYWN0dWFsSW5zdGFuY2UpO1xuICAgICAgICAgICAgICAgIHRoaXMucmVzb2x2aW5nLnNldChfaWQsIGFjdHVhbEluc3RhbmNlKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gYWN0dWFsSW5zdGFuY2U7XG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgZGVwZW5kZW5jaWVzID0gdGhpcy5yZXNvbHZlRGVwZW5kZW5jaWVzKHVzZUNsYXNzLCBwYXRoKTtcbiAgICAgICAgY29uc3QgYWN0dWFsSW5zdGFuY2UgPSBuZXcgdXNlQ2xhc3MoLi4uZGVwZW5kZW5jaWVzKTtcbiAgICAgICAgT2JqZWN0LmFzc2lnbihpbnN0YW5jZVBsYWNlaG9sZGVyIGFzIGFueSwgYWN0dWFsSW5zdGFuY2UpO1xuICAgICAgICB0aGlzLnJlc29sdmluZy5zZXQoX2lkLCBhY3R1YWxJbnN0YW5jZSk7XG5cbiAgICAgICAgcmV0dXJuIGFjdHVhbEluc3RhbmNlIGFzIEFzeW5jIGV4dGVuZHMgdHJ1ZSA/IFByb21pc2U8VD4gOiBUO1xuICAgIH1cblxuICAgIHByaXZhdGUgY3JlYXRlRmFjdG9yeUluc3RhbmNlPFQ+KG9wdGlvbnM6IEZhY3RvcnlQcm92aWRlck9wdGlvbnM8VD4sIHBhdGg6IFNldDxUb2tlbj4pOiBUIHtcbiAgICAgICAgY29uc3QgZGVwZW5kZW5jaWVzID0gKG9wdGlvbnMuZGVwcyB8fCBbXSkubWFwKGRlcCA9PiB0aGlzLnJlc29sdmVEZXBlbmRlbmN5KGRlcCwgcGF0aCkpO1xuICAgICAgICByZXR1cm4gb3B0aW9ucy51c2VGYWN0b3J5KC4uLmRlcGVuZGVuY2llcyk7XG4gICAgfVxuXG4gICAgZ2V0Q2xhc3NEZXBlbmRlbmNpZXModGFyZ2V0OiBDbGFzc0NvbnN0cnVjdG9yKSB7XG4gICAgICAgIGNvbnN0IGNvbnN0cnVjdG9yRGVwZW5kZW5jaWVzID0gZ2V0Q29uc3RydWN0b3JEZXBlbmRlbmNpZXNNZXRhZGF0YSh0YXJnZXQpO1xuICAgICAgICBjb25zdCBwcm9wZXJ0eURlcGVuZGVuY2llcyA9IGdldFByb3BlcnR5RGVwZW5kZW5jaWVzTWV0YWRhdGEodGFyZ2V0KTtcblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgcHJvcGVydHlEZXBlbmRlbmNpZXMsXG4gICAgICAgICAgICBjb25zdHJ1Y3RvckRlcGVuZGVuY2llc1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSByZXNvbHZlRGVwZW5kZW5jeTxULCBBc3luYyBleHRlbmRzIGJvb2xlYW4gPSBmYWxzZT4oXG4gICAgICAgIGRlcDogRGVwSWRlbnRpZmllciB8IENvbXBsZXhEZXBlbmRlbmN5SWRlbnRpZmllcixcbiAgICAgICAgcGF0aDogU2V0PFRva2VuPixcbiAgICAgICAgYXN5bmM6IEFzeW5jID0gZmFsc2UgYXMgQXN5bmNcbiAgICApOiBBc3luYyBleHRlbmRzIHRydWUgPyBQcm9taXNlPFQ+IDogVCB7XG5cbiAgICAgICAgbGV0IG5vcm1hbGl6ZWREZXAgPSBkZXA7XG5cbiAgICAgICAgaWYgKCFpc0NvbXBsZXhEZXBlbmRlbmN5SWRlbnRpZmllcihub3JtYWxpemVkRGVwKSkge1xuICAgICAgICAgICAgbm9ybWFsaXplZERlcCA9IHsgdG9rZW46IG5vcm1hbGl6ZWREZXAgfSBhcyBDb21wbGV4RGVwZW5kZW5jeUlkZW50aWZpZXI7XG4gICAgICAgIH1cblxuICAgICAgICB0cnkge1xuXG4gICAgICAgICAgICBpZiAobm9ybWFsaXplZERlcC5pc0NvbmZpZykge1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLnJlc29sdmVDb25maWcobm9ybWFsaXplZERlcC50b2tlbiBhcyBzdHJpbmcsIG5vcm1hbGl6ZWREZXApIGFzIEFzeW5jIGV4dGVuZHMgdHJ1ZSA/IFByb21pc2U8VD4gOiBUO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAobm9ybWFsaXplZERlcC5mb3JFbnRpdHkpIHtcbiAgICAgICAgICAgICAgICBpZiAobm9ybWFsaXplZERlcC50eXBlID09ICdzY2hlbWEnKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLnJlc29sdmVFbnRpdHlTY2hlbWEobm9ybWFsaXplZERlcC5mb3JFbnRpdHksIG5vcm1hbGl6ZWREZXAsIGFzeW5jKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAobm9ybWFsaXplZERlcC50eXBlID09ICdzZXJ2aWNlJykge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5yZXNvbHZlRW50aXR5U2VydmljZShub3JtYWxpemVkRGVwLmZvckVudGl0eSwgbm9ybWFsaXplZERlcCwgYXN5bmMpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBJbnZhbGlkRGVwZW5kZW5jeUNyaXRlcmlhRXJyb3IoSlNPTi5zdHJpbmdpZnkobm9ybWFsaXplZERlcCkpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5yZXNvbHZlPFQsIEFzeW5jPihub3JtYWxpemVkRGVwLnRva2VuLCBub3JtYWxpemVkRGVwLCBwYXRoLCBhc3luYylcblxuICAgICAgICB9IGNhdGNoIChlKSB7XG5cbiAgICAgICAgICAgIGlmIChcbiAgICAgICAgICAgICAgICBlIGluc3RhbmNlb2YgTm9Qcm92aWRlckZvdW5kRXJyb3JcbiAgICAgICAgICAgICAgICAmJlxuICAgICAgICAgICAgICAgIChub3JtYWxpemVkRGVwLmlzT3B0aW9uYWwgfHwgbm9ybWFsaXplZERlcC5kZWZhdWx0VmFsdWUgIT09IHVuZGVmaW5lZClcbiAgICAgICAgICAgICkge1xuICAgICAgICAgICAgICAgIC8vIHRoaXMubG9nZ2VyLmluZm8oYE5vIHByb3ZpZGVyIGZvdW5kIGZvciAke0pTT04uc3RyaW5naWZ5KGRlcCl9YCwgeyBwYXRoIH0pXG4gICAgICAgICAgICAgICAgcmV0dXJuIG5vcm1hbGl6ZWREZXAuZGVmYXVsdFZhbHVlID8/IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdGhyb3cgZTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgcmVzb2x2ZURlcGVuZGVuY2llczxUIGV4dGVuZHMgQ2xhc3NDb25zdHJ1Y3Rvcj4odGFyZ2V0OiBULCBwYXRoOiBTZXQ8VG9rZW4+KTogYW55W10ge1xuXG4gICAgICAgIGNvbnN0IGluamVjdE1ldGFkYXRhID0gZ2V0Q29uc3RydWN0b3JEZXBlbmRlbmNpZXNNZXRhZGF0YSh0YXJnZXQpO1xuXG4gICAgICAgIHJldHVybiBpbmplY3RNZXRhZGF0YS5tYXAoZGVwID0+IHRoaXMucmVzb2x2ZURlcGVuZGVuY3koZGVwLCBwYXRoKSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBpbml0aWFsaXplSW5zdGFuY2U8VD4oaW5zdGFuY2U6IFQpOiB2b2lkIHtcbiAgICAgICAgaWYgKCFoYXNDb25zdHJ1Y3RvcihpbnN0YW5jZSkpIHJldHVybjtcblxuICAgICAgICBjb25zdCBpbml0TWV0aG9kID0gZ2V0T25Jbml0SG9va01ldGFkYXRhKGluc3RhbmNlLmNvbnN0cnVjdG9yIGFzIENsYXNzQ29uc3RydWN0b3IpO1xuXG4gICAgICAgIGlmIChpbml0TWV0aG9kKSB7XG4gICAgICAgICAgICBjb25zdCB0aGVJbml0TWV0aG9kID0gaW5zdGFuY2VbIGluaXRNZXRob2QgYXMga2V5b2YgdHlwZW9mIGluc3RhbmNlIF0gYXMgRnVuY3Rpb247XG4gICAgICAgICAgICBpZiAodHlwZW9mIHRoZUluaXRNZXRob2QgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICB0aGVJbml0TWV0aG9kLmNhbGwoaW5zdGFuY2UpOyAgLy8gQmluZCAndGhpcycgY29udGV4dCB0byB0aGUgaW5zdGFuY2VcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBJbml0aWFsaXphdGlvbk1ldGhvZEVycm9yKGluc3RhbmNlLmNvbnN0cnVjdG9yLm5hbWUsIGVycm9yLm1lc3NhZ2UsIHRoaXMuY29udGFpbmVySWQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEluaXRpYWxpemF0aW9uTWV0aG9kVHlwZUVycm9yKFN0cmluZyhpbml0TWV0aG9kKSwgaW5zdGFuY2UuY29uc3RydWN0b3IubmFtZSwgdGhpcy5jb250YWluZXJJZCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIGluamVjdFByb3BlcnRpZXM8VD4oaW5zdGFuY2U6IFQpOiB2b2lkIHtcbiAgICAgICAgaWYgKCFoYXNDb25zdHJ1Y3RvcihpbnN0YW5jZSkpIHJldHVybjtcblxuICAgICAgICBjb25zdCBkZXBlbmRlbmNpZXMgPSBnZXRQcm9wZXJ0eURlcGVuZGVuY2llc01ldGFkYXRhKGluc3RhbmNlLmNvbnN0cnVjdG9yIGFzIENsYXNzQ29uc3RydWN0b3IpO1xuXG4gICAgICAgIGZvciAoY29uc3QgZGVwIG9mIGRlcGVuZGVuY2llcykge1xuICAgICAgICAgICAgY29uc3QgcHJvcGVydHlWYWx1ZSA9IHRoaXMucmVzb2x2ZURlcGVuZGVuY3koZGVwLCBuZXcgU2V0KCkpXG5cbiAgICAgICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShpbnN0YW5jZSwgZGVwLnByb3BlcnR5S2V5LCB7XG4gICAgICAgICAgICAgICAgdmFsdWU6IHByb3BlcnR5VmFsdWUsXG4gICAgICAgICAgICAgICAgZW51bWVyYWJsZTogdHJ1ZSxcbiAgICAgICAgICAgICAgICBjb25maWd1cmFibGU6IHRydWVcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgaGFzKFxuICAgICAgICBkZXBlbmRlbmN5VG9rZW46IERlcElkZW50aWZpZXIsXG4gICAgICAgIGNyaXRlcmlhPzoge1xuICAgICAgICAgICAgdGFncz86IHN0cmluZ1tdO1xuICAgICAgICAgICAgdHlwZT86IFByb3ZpZGVyT3B0aW9uc1sgJ3R5cGUnIF0sXG4gICAgICAgICAgICBwcmlvcml0eT86IFByaW9yaXR5Q3JpdGVyaWE7XG4gICAgICAgICAgICBmb3JFbnRpdHk/OiBQcm92aWRlck9wdGlvbnNbICdmb3JFbnRpdHknIF0sXG4gICAgICAgICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzPzogYm9vbGVhblxuICAgICAgICB9XG4gICAgKTogYm9vbGVhbiB7XG5cbiAgICAgICAgY29uc3QgdG9rZW4gPSB0aGlzLmNyZWF0ZVRva2VuKGRlcGVuZGVuY3lUb2tlbik7XG5cbiAgICAgICAgY29uc3QgYmVzdFByb3ZpZGVycyA9IHRoaXMuY29sbGVjdEJlc3RQcm92aWRlcnNGb3I8YW55Pih7XG4gICAgICAgICAgICAuLi5jcml0ZXJpYSxcbiAgICAgICAgICAgIHRva2VuLFxuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gYmVzdFByb3ZpZGVycy5sZW5ndGggPiAwO1xuICAgIH1cblxuICAgIGhhc0VudGl0eVNlcnZpY2UoXG4gICAgICAgIGVudGl0eU5hbWU6IERlcElkZW50aWZpZXIsXG4gICAgICAgIGNyaXRlcmlhPzoge1xuICAgICAgICAgICAgdGFncz86IHN0cmluZ1tdO1xuICAgICAgICAgICAgcHJpb3JpdHk/OiBQcmlvcml0eUNyaXRlcmlhO1xuICAgICAgICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVycz86IGJvb2xlYW5cbiAgICAgICAgfVxuICAgICk6IGJvb2xlYW4ge1xuXG4gICAgICAgIGNvbnN0IHsgdGFncywgcHJpb3JpdHksIGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnMgfSA9IGNyaXRlcmlhID8/IHt9O1xuICAgICAgICBjb25zdCBiZXN0UHJvdmlkZXJzID0gdGhpcy5jb2xsZWN0QmVzdFByb3ZpZGVyc0Zvcjxhbnk+KHtcbiAgICAgICAgICAgIHRhZ3MsXG4gICAgICAgICAgICB0eXBlOiAnc2VydmljZScsXG4gICAgICAgICAgICBwcmlvcml0eSxcbiAgICAgICAgICAgIGZvckVudGl0eTogZW50aXR5TmFtZSxcbiAgICAgICAgICAgIGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnMsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiBiZXN0UHJvdmlkZXJzLmxlbmd0aCA+IDA7XG4gICAgfVxuXG4gICAgcmVzb2x2ZUVudGl0eVNlcnZpY2U8VCwgQXN5bmMgZXh0ZW5kcyBib29sZWFuID0gZmFsc2U+KFxuICAgICAgICBlbnRpdHlOYW1lOiBEZXBJZGVudGlmaWVyLFxuICAgICAgICBjcml0ZXJpYT86IHtcbiAgICAgICAgICAgIHRhZ3M/OiBzdHJpbmdbXTtcbiAgICAgICAgICAgIHByaW9yaXR5PzogUHJpb3JpdHlDcml0ZXJpYTtcbiAgICAgICAgICAgIGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnM/OiBib29sZWFuXG4gICAgICAgIH0sXG4gICAgICAgIGFzeW5jOiBBc3luYyA9IGZhbHNlIGFzIEFzeW5jXG4gICAgKTogQXN5bmMgZXh0ZW5kcyB0cnVlID8gUHJvbWlzZTxUPiA6IFQge1xuXG4gICAgICAgIGNvbnN0IHsgdGFncywgcHJpb3JpdHksIGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnMgfSA9IGNyaXRlcmlhID8/IHt9O1xuICAgICAgICBjb25zdCBiZXN0UHJvdmlkZXJzID0gdGhpcy5jb2xsZWN0QmVzdFByb3ZpZGVyc0Zvcjxhbnk+KHtcbiAgICAgICAgICAgIHRhZ3MsXG4gICAgICAgICAgICB0eXBlOiAnc2VydmljZScsXG4gICAgICAgICAgICBwcmlvcml0eSxcbiAgICAgICAgICAgIGZvckVudGl0eTogZW50aXR5TmFtZSxcbiAgICAgICAgICAgIGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnMsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGlmIChiZXN0UHJvdmlkZXJzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IE5vRW50aXR5U2VydmljZVByb3ZpZGVyRXJyb3IoU3RyaW5nKGVudGl0eU5hbWUpLCB0aGlzLmNvbnRhaW5lcklkKTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBvcHRpb25zID0gYmVzdFByb3ZpZGVyc1sgMCBdO1xuXG4gICAgICAgIHJldHVybiB0aGlzLnJlc29sdmVQcm92aWRlclZhbHVlPFQsIEFzeW5jPihvcHRpb25zLCBuZXcgU2V0KCksIGFzeW5jKTtcbiAgICB9XG5cbiAgICBoYXNFbnRpdHlTY2hlbWEoXG4gICAgICAgIGVudGl0eU5hbWU6IERlcElkZW50aWZpZXIsXG4gICAgICAgIGNyaXRlcmlhPzoge1xuICAgICAgICAgICAgdGFncz86IHN0cmluZ1tdO1xuICAgICAgICAgICAgcHJpb3JpdHk/OiBQcmlvcml0eUNyaXRlcmlhO1xuICAgICAgICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVycz86IGJvb2xlYW5cbiAgICAgICAgfVxuICAgICk6IGJvb2xlYW4ge1xuXG4gICAgICAgIGNvbnN0IHsgdGFncywgcHJpb3JpdHksIGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnMgfSA9IGNyaXRlcmlhID8/IHt9O1xuICAgICAgICBjb25zdCBiZXN0UHJvdmlkZXJzID0gdGhpcy5jb2xsZWN0QmVzdFByb3ZpZGVyc0Zvcjxhbnk+KHtcbiAgICAgICAgICAgIHRhZ3MsXG4gICAgICAgICAgICB0eXBlOiAnc2NoZW1hJyxcbiAgICAgICAgICAgIHByaW9yaXR5LFxuICAgICAgICAgICAgZm9yRW50aXR5OiBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVycyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIGJlc3RQcm92aWRlcnMubGVuZ3RoID4gMDtcbiAgICB9XG5cbiAgICByZXNvbHZlRW50aXR5U2NoZW1hPFQsIEFzeW5jIGV4dGVuZHMgYm9vbGVhbiA9IGZhbHNlPihcbiAgICAgICAgZW50aXR5TmFtZTogRGVwSWRlbnRpZmllcixcbiAgICAgICAgY3JpdGVyaWE/OiB7XG4gICAgICAgICAgICB0YWdzPzogc3RyaW5nW107XG4gICAgICAgICAgICBwcmlvcml0eT86IFByaW9yaXR5Q3JpdGVyaWE7XG4gICAgICAgICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzPzogYm9vbGVhblxuICAgICAgICB9LFxuICAgICAgICBhc3luYzogQXN5bmMgPSBmYWxzZSBhcyBBc3luY1xuICAgICk6IEFzeW5jIGV4dGVuZHMgdHJ1ZSA/IFByb21pc2U8VD4gOiBUIHtcblxuICAgICAgICBjb25zdCB7IHRhZ3MsIHByaW9yaXR5LCBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzIH0gPSBjcml0ZXJpYSA/PyB7fTtcbiAgICAgICAgY29uc3QgYmVzdFByb3ZpZGVycyA9IHRoaXMuY29sbGVjdEJlc3RQcm92aWRlcnNGb3I8YW55Pih7XG4gICAgICAgICAgICB0YWdzLFxuICAgICAgICAgICAgdHlwZTogJ3NjaGVtYScsXG4gICAgICAgICAgICBwcmlvcml0eSxcbiAgICAgICAgICAgIGZvckVudGl0eTogZW50aXR5TmFtZSxcbiAgICAgICAgICAgIGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnMsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGlmIChiZXN0UHJvdmlkZXJzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IE5vRW50aXR5U2NoZW1hUHJvdmlkZXJFcnJvcihTdHJpbmcoZW50aXR5TmFtZSksIHRoaXMuY29udGFpbmVySWQpO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IG9wdGlvbnMgPSBiZXN0UHJvdmlkZXJzWyAwIF07XG5cbiAgICAgICAgcmV0dXJuIHRoaXMucmVzb2x2ZVByb3ZpZGVyVmFsdWU8VCwgQXN5bmM+KG9wdGlvbnMsIG5ldyBTZXQoKSwgYXN5bmMpO1xuICAgIH1cblxuICAgIGNsZWFyKGNsZWFyQ2hpbGRDb250YWluZXJzID0gdHJ1ZSkge1xuICAgICAgICB0aGlzLnByb3ZpZGVycy5jbGVhcigpO1xuICAgICAgICB0aGlzLmNhY2hlLmNsZWFyKCk7XG4gICAgICAgIHRoaXMucmVzb2x2aW5nLmNsZWFyKCk7XG4gICAgICAgIGlmIChjbGVhckNoaWxkQ29udGFpbmVycykge1xuICAgICAgICAgICAgdGhpcy5jaGlsZENvbnRhaW5lcnMuZm9yRWFjaChjb250YWluZXIgPT4gY29udGFpbmVyLmNsZWFyKCkpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgdXNlTWlkZGxld2FyZSh7IG1pZGRsZXdhcmUsIG9yZGVyID0gMSB9OiBQYXJ0aWFsQnk8RElNaWRkbGV3YXJlPGFueT4sICdvcmRlcic+KSB7XG4gICAgICAgIHRoaXMubWlkZGxld2FyZXMucHVzaCh7IG1pZGRsZXdhcmUsIG9yZGVyIH0pO1xuICAgICAgICB0aGlzLm1pZGRsZXdhcmVzLnNvcnQoKGEsIGIpID0+IChhLm9yZGVyID8/IDApIC0gKGIub3JkZXIgPz8gMCkpO1xuICAgIH1cblxuICAgIGFzeW5jIHJlc29sdmVBc3luYzxUPihcbiAgICAgICAgZGVwZW5kZW5jeVRva2VuOiBEZXBJZGVudGlmaWVyPFQ+LFxuICAgICAgICBjcml0ZXJpYT86IHtcbiAgICAgICAgICAgIHRhZ3M/OiBzdHJpbmdbXTtcbiAgICAgICAgICAgIHR5cGU/OiBQcm92aWRlck9wdGlvbnNbICd0eXBlJyBdLFxuICAgICAgICAgICAgcHJpb3JpdHk/OiBQcmlvcml0eUNyaXRlcmlhO1xuICAgICAgICAgICAgZm9yRW50aXR5PzogUHJvdmlkZXJPcHRpb25zWyAnZm9yRW50aXR5JyBdLFxuICAgICAgICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVycz86IGJvb2xlYW5cbiAgICAgICAgfSxcbiAgICAgICAgcGF0aD86IFNldDxUb2tlbj5cbiAgICApIHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMucmVzb2x2ZTxULCB0cnVlPihkZXBlbmRlbmN5VG9rZW4sIGNyaXRlcmlhLCBwYXRoLCB0cnVlKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIGNyZWF0ZUFuZENhY2hlSW5zdGFuY2VBc3luYzxUPihvcHRpb25zOiBJbnRlcm5hbFByb3ZpZGVyT3B0aW9uczxUPiwgcGF0aDogU2V0PFRva2VuPik6IFByb21pc2U8VD4ge1xuICAgICAgICBjb25zdCB7IF9pZCwgX3Byb3ZpZGVyOiBwcm92aWRlciB9ID0gb3B0aW9ucztcblxuICAgICAgICBjb25zdCBpbnN0YW5jZSA9IGF3YWl0IHRoaXMuY3JlYXRlSW5zdGFuY2Uob3B0aW9ucywgcGF0aCwgdHJ1ZSk7XG4gICAgICAgIGlmIChwcm92aWRlci5zaW5nbGV0b24pIHtcbiAgICAgICAgICAgIHRoaXMuY2FjaGUuc2V0KF9pZCwgaW5zdGFuY2UpO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5yZXNvbHZpbmcuZGVsZXRlKF9pZCk7XG5cbiAgICAgICAgYXdhaXQgdGhpcy5pbmplY3RQcm9wZXJ0aWVzQXN5bmMoaW5zdGFuY2UpO1xuICAgICAgICBhd2FpdCB0aGlzLmluaXRpYWxpemVJbnN0YW5jZUFzeW5jKGluc3RhbmNlKTtcblxuICAgICAgICBwYXRoLmRlbGV0ZShfaWQpO1xuXG4gICAgICAgIHJldHVybiBpbnN0YW5jZTtcbiAgICB9XG5cbiAgICB1c2VNaWRkbGV3YXJlQXN5bmMoeyBtaWRkbGV3YXJlLCBvcmRlciA9IDEgfTogUGFydGlhbEJ5PERJTWlkZGxld2FyZUFzeW5jPGFueT4sICdvcmRlcic+KSB7XG4gICAgICAgIHRoaXMuYXN5bmNNaWRkbGV3YXJlcy5wdXNoKHsgbWlkZGxld2FyZSwgb3JkZXIgfSk7XG4gICAgICAgIHRoaXMuYXN5bmNNaWRkbGV3YXJlcy5zb3J0KChhLCBiKSA9PiAoYS5vcmRlciA/PyAwKSAtIChiLm9yZGVyID8/IDApKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIHJlc29sdmVEZXBlbmRlbmNpZXNBc3luYzxUIGV4dGVuZHMgQ2xhc3NDb25zdHJ1Y3Rvcj4odGFyZ2V0OiBULCBwYXRoOiBTZXQ8VG9rZW4+KTogUHJvbWlzZTxhbnlbXT4ge1xuXG4gICAgICAgIGNvbnN0IGluamVjdE1ldGFkYXRhID0gZ2V0Q29uc3RydWN0b3JEZXBlbmRlbmNpZXNNZXRhZGF0YSh0YXJnZXQpO1xuXG4gICAgICAgIHJldHVybiBhd2FpdCBQcm9taXNlLmFsbChpbmplY3RNZXRhZGF0YS5tYXAoYXN5bmMgZGVwID0+IGF3YWl0IHRoaXMucmVzb2x2ZURlcGVuZGVuY3koZGVwLCBwYXRoLCB0cnVlKSkpO1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgaW5pdGlhbGl6ZUluc3RhbmNlQXN5bmM8VD4oaW5zdGFuY2U6IFQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgaWYgKCFoYXNDb25zdHJ1Y3RvcihpbnN0YW5jZSkpIHJldHVybjtcblxuICAgICAgICBjb25zdCBpbml0TWV0aG9kID0gZ2V0T25Jbml0SG9va01ldGFkYXRhKGluc3RhbmNlLmNvbnN0cnVjdG9yIGFzIENsYXNzQ29uc3RydWN0b3IpO1xuXG4gICAgICAgIGlmIChpbml0TWV0aG9kKSB7XG4gICAgICAgICAgICBjb25zdCB0aGVJbml0TWV0aG9kID0gaW5zdGFuY2VbIGluaXRNZXRob2QgYXMga2V5b2YgdHlwZW9mIGluc3RhbmNlIF0gYXMgRnVuY3Rpb247XG4gICAgICAgICAgICBpZiAodHlwZW9mIHRoZUluaXRNZXRob2QgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICBhd2FpdCB0aGVJbml0TWV0aG9kLmNhbGwoaW5zdGFuY2UpOyAgLy8gQmluZCAndGhpcycgY29udGV4dCB0byB0aGUgaW5zdGFuY2VcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBJbml0aWFsaXphdGlvbk1ldGhvZEVycm9yKGluc3RhbmNlLmNvbnN0cnVjdG9yLm5hbWUsIGVycm9yLm1lc3NhZ2UsIHRoaXMuY29udGFpbmVySWQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEluaXRpYWxpemF0aW9uTWV0aG9kVHlwZUVycm9yKFN0cmluZyhpbml0TWV0aG9kKSwgaW5zdGFuY2UuY29uc3RydWN0b3IubmFtZSwgdGhpcy5jb250YWluZXJJZCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIGNyZWF0ZUZhY3RvcnlJbnN0YW5jZUFzeW5jPFQ+KG9wdGlvbnM6IEZhY3RvcnlQcm92aWRlck9wdGlvbnM8VD4sIHBhdGg6IFNldDxUb2tlbj4pOiBQcm9taXNlPFQ+IHtcbiAgICAgICAgY29uc3QgZGVwZW5kZW5jaWVzID0gYXdhaXQgUHJvbWlzZS5hbGwoKG9wdGlvbnMuZGVwcyB8fCBbXSkubWFwKGFzeW5jIChkZXApID0+IHtcbiAgICAgICAgICAgIHJldHVybiBhd2FpdCB0aGlzLnJlc29sdmVEZXBlbmRlbmN5KGRlcCwgcGF0aCwgdHJ1ZSk7XG4gICAgICAgIH0pKTtcbiAgICAgICAgcmV0dXJuIG9wdGlvbnMudXNlRmFjdG9yeSguLi5kZXBlbmRlbmNpZXMpO1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgaW5qZWN0UHJvcGVydGllc0FzeW5jPFQ+KGluc3RhbmNlOiBUKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGlmICghaGFzQ29uc3RydWN0b3IoaW5zdGFuY2UpKSByZXR1cm47XG5cbiAgICAgICAgY29uc3QgZGVwZW5kZW5jaWVzID0gZ2V0UHJvcGVydHlEZXBlbmRlbmNpZXNNZXRhZGF0YShpbnN0YW5jZS5jb25zdHJ1Y3RvciBhcyBDbGFzc0NvbnN0cnVjdG9yKTtcblxuICAgICAgICBmb3IgKGNvbnN0IGRlcCBvZiBkZXBlbmRlbmNpZXMpIHtcbiAgICAgICAgICAgIGNvbnN0IHByb3BlcnR5VmFsdWUgPSBhd2FpdCB0aGlzLnJlc29sdmVEZXBlbmRlbmN5KGRlcCwgbmV3IFNldCgpLCB0cnVlKVxuXG4gICAgICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkoaW5zdGFuY2UsIGRlcC5wcm9wZXJ0eUtleSwge1xuICAgICAgICAgICAgICAgIHZhbHVlOiBwcm9wZXJ0eVZhbHVlLFxuICAgICAgICAgICAgICAgIGVudW1lcmFibGU6IHRydWUsXG4gICAgICAgICAgICAgICAgY29uZmlndXJhYmxlOiB0cnVlXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGxvZ0NoaWxkQ29udGFpbmVycygpIHtcbiAgICAgICAgZm9yIChjb25zdCBjb250YWluZXIgb2YgdGhpcy5jaGlsZENvbnRhaW5lcnMpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDaGlsZCBDb250YWluZXI6ICR7Y29udGFpbmVyLmNvbnRhaW5lcklkfWApO1xuICAgICAgICAgICAgY29udGFpbmVyLmxvZ0NoaWxkQ29udGFpbmVycygpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgbG9nUHJvdmlkZXJzKGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnMgPSB0cnVlKSB7XG4gICAgICAgIGNvbnN0IGludGVybmFsUHJvdmlkZXJzID0gdGhpcy5jb2xsZWN0QmVzdFByb3ZpZGVyc0Zvcjxhbnk+KHtcbiAgICAgICAgICAgIGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnMsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBQYXJlbnQgQ29udGFpbmVyIElkLCBbUGFyZW50OiAke3RoaXMucGFyZW50Py5jb250YWluZXJJZH1dYCk7XG5cbiAgICAgICAgZm9yIChjb25zdCBpcCBvZiBpbnRlcm5hbFByb3ZpZGVycykge1xuICAgICAgICAgICAgbGV0IGZpbHRlcmVkID0ge1xuICAgICAgICAgICAgICAgIC4uLmlwLFxuICAgICAgICAgICAgICAgIF9jb250YWluZXI6IGlwLl9jb250YWluZXIuY29udGFpbmVySWQsXG4gICAgICAgICAgICAgICAgX3Byb3ZpZGVyOiB7XG4gICAgICAgICAgICAgICAgICAgIC4uLmlwLl9wcm92aWRlcixcbiAgICAgICAgICAgICAgICAgICAgdXNlQ2xhc3M6IChpcC5fcHJvdmlkZXIgYXMgYW55KT8udXNlQ2xhc3M/Lm5hbWUsXG4gICAgICAgICAgICAgICAgICAgIHByb3ZpZGU6IChpcC5fcHJvdmlkZXIucHJvdmlkZSBhcyBhbnkpLm5hbWUgPyAoaXAuX3Byb3ZpZGVyLnByb3ZpZGUgYXMgYW55KS5uYW1lIDogaXAuX3Byb3ZpZGVyLnByb3ZpZGVcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFByb3ZpZGVyOiBbJHtpcC5fY29udGFpbmVyLmNvbnRhaW5lcklkfV0gLSAke2lwLl9wcm92aWRlci5fdG9rZW59OmAsIHsgb3B0aW9uczogZmlsdGVyZWQgfSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBsb2dDYWNoZSgpIHtcbiAgICAgICAgZm9yIChjb25zdCBbIHRva2VuLCBpbnN0YW5jZSBdIG9mIHRoaXMuY2FjaGUuZW50cmllcygpKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQ2FjaGU6IFske3RoaXMuY29udGFpbmVySWR9XSAtICR7dG9rZW59OmAsIGluc3RhbmNlKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLnBhcmVudD8ubG9nQ2FjaGUoKTtcbiAgICB9XG5cbiAgICBwdWJsaWMgc2V0U2VhcmNoRW5naW5lKGVuZ2luZTogQmFzZVNlYXJjaEVuZ2luZSkge1xuICAgICAgICB0aGlzLnNlYXJjaEVuZ2luZSA9IGVuZ2luZTtcbiAgICB9XG5cbiAgICBwdWJsaWMgcmVzb2x2ZVNlYXJjaEVuZ2luZSgpOiBCYXNlU2VhcmNoRW5naW5lIHtcbiAgICAgICAgaWYgKCF0aGlzLnNlYXJjaEVuZ2luZSkge1xuXG4gICAgICAgICAgICBpZiAodGhpcy5wYXJlbnQpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5wYXJlbnQucmVzb2x2ZVNlYXJjaEVuZ2luZSgpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1NlYXJjaCBlbmdpbmUgbm90IGNvbmZpZ3VyZWQuIFBsZWFzZSBjYWxsIHNldFNlYXJjaEVuZ2luZSgpIGZpcnN0LicpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuc2VhcmNoRW5naW5lO1xuICAgIH1cbn1cbiJdfQ==