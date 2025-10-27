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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udGFpbmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2RpL2NvbnRhaW5lci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSwrQkFBMEM7QUFDMUMsZ0RBQW9EO0FBRXBELDhDQUEyRDtBQUMzRCw2Q0FBMEM7QUFtQjFDLHNDQU91QjtBQUV2QixtQ0FZaUI7QUFFakIseUNBS29CO0FBRXBCLG9DQUFxQztBQUVyQyxxQ0FXa0I7QUFJbEIsTUFBYSxXQUFXO0lBd0dBO0lBdEdwQixNQUFNLENBQVUsZUFBZSxHQUFHLElBQUksMEJBQWUsQ0FBQyxFQUFFLFNBQVMsRUFBRSxTQUFTLEVBQUUsQ0FBQyxDQUFDO0lBRWhFLFdBQVcsQ0FBUztJQUNuQixNQUFNLENBQVU7SUFDaEIsV0FBVyxHQUF3QixFQUFFLENBQUM7SUFDdEMsZ0JBQWdCLEdBQTZCLEVBQUUsQ0FBQztJQUV6RCxVQUFVLEdBQUcsSUFBSSxHQUFHLEVBQWUsQ0FBQztJQUM1QyxJQUFjLFNBQVM7UUFFbkIsSUFBSSxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7WUFDaEIsT0FBTyxJQUFJLENBQUMsUUFBUSxDQUFDLFNBQVMsQ0FBQztRQUNuQyxDQUFDO1FBRUQsSUFBSSxDQUFDLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQztZQUNuQixJQUFJLENBQUMsVUFBVSxHQUFHLElBQUksR0FBRyxFQUFlLENBQUM7UUFDN0MsQ0FBQztRQUNELE9BQU8sSUFBSSxDQUFDLFVBQVUsQ0FBQztJQUMzQixDQUFDO0lBRU8sTUFBTSxHQUFHLElBQUksR0FBRyxFQUFlLENBQUM7SUFDeEMsSUFBYyxLQUFLO1FBRWYsSUFBSSxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7WUFDaEIsT0FBTyxJQUFJLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQztRQUMvQixDQUFDO1FBRUQsSUFBSSxDQUFDLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQztZQUNmLElBQUksQ0FBQyxNQUFN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QUUsRUFBRSxDQUFDO1lBQ3JELElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLFdBQVcsSUFBSSxDQUFDLFdBQVcsT0FBTyxLQUFLLEdBQUcsRUFBRSxRQUFRLENBQUMsQ0FBQztRQUM1RSxDQUFDO1FBQ0QsSUFBSSxDQUFDLE1BQU0sRUFBRSxRQUFRLEVBQUUsQ0FBQztJQUM1QixDQUFDO0lBRU0sZUFBZSxDQUFDLE1BQXdCO1FBQzNDLElBQUksQ0FBQyxZQUFZLEdBQUcsTUFBTSxDQUFDO0lBQy9CLENBQUM7SUFFTSxtQkFBbUI7UUFDdEIsSUFBSSxDQUFDLElBQUksQ0FBQyxZQUFZLEVBQUUsQ0FBQztZQUVyQixJQUFJLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQztnQkFDZCxPQUFPLElBQUksQ0FBQyxNQUFNLENBQUMsbUJBQW1CLEVBQUUsQ0FBQztZQUM3QyxDQUFDO1lBRUQsTUFBTSxJQUFJLEtBQUssQ0FBQyxvRUFBb0UsQ0FBQyxDQUFDO1FBQzFGLENBQUM7UUFFRCxPQUFPLElBQUksQ0FBQyxZQUFZLENBQUM7SUFDN0IsQ0FBQzs7QUF0bUNMLGtDQXVtQ0MiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyB2NCBhcyBnZW5lcmF0ZVVVSUQgfSBmcm9tICd1dWlkJztcbmltcG9ydCB7IE1ldGFkYXRhTWFuYWdlciB9IGZyb20gJy4uL3V0aWxzL21ldGFkYXRhJztcbmltcG9ydCB7IHR5cGUgRGVlcFBhcnRpYWwsIHR5cGUgUGFydGlhbEJ5IH0gZnJvbSAnLi4vdXRpbHMvdHlwZXMnO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyLCBJTG9nZ2VyIH0gZnJvbSAnLi8uLi9sb2dnaW5nL2luZGV4JztcbmltcG9ydCB7IEluamVjdGFibGUgfSBmcm9tICcuL2RlY29yYXRvcnMnO1xuXG5pbXBvcnQge1xuICAgIEJhc2VQcm92aWRlck9wdGlvbnMsXG4gICAgQ2xhc3NDb25zdHJ1Y3RvcixcbiAgICBDbGFzc1Byb3ZpZGVyT3B0aW9ucyxcbiAgICBDb21wbGV4RGVwZW5kZW5jeUlkZW50aWZpZXIsXG4gICAgQ29uZmlnUHJvdmlkZXJPcHRpb25zLFxuICAgIERlcElkZW50aWZpZXIsXG4gICAgRmFjdG9yeVByb3ZpZGVyT3B0aW9ucyxcbiAgICBJRElDb250YWluZXIsXG4gICAgSW50ZXJuYWxQcm92aWRlck9wdGlvbnMsXG4gICAgRElNaWRkbGV3YXJlLFxuICAgIERJTWlkZGxld2FyZUFzeW5jLFxuICAgIFByaW9yaXR5Q3JpdGVyaWEsXG4gICAgUHJvdmlkZXJPcHRpb25zLFxuICAgIFRva2VuXG59IGZyb20gJy4vLi4vaW50ZXJmYWNlcy9kaSc7XG5cbmltcG9ydCB7XG4gICAgaXNBbGlhc1Byb3ZpZGVyT3B0aW9ucyxcbiAgICBpc0NsYXNzUHJvdmlkZXJPcHRpb25zLFxuICAgIGlzQ29tcGxleERlcGVuZGVuY3lJZGVudGlmaWVyLFxuICAgIGlzQ29uZmlnUHJvdmlkZXJPcHRpb25zLFxuICAgIGlzRmFjdG9yeVByb3ZpZGVyT3B0aW9ucyxcbiAgICBpc1ZhbHVlUHJvdmlkZXJPcHRpb25zLFxufSBmcm9tICcuLy4uL3V0aWxzL2RpJztcblxuaW1wb3J0IHtcbiAgICBhcHBseU1pZGRsZXdhcmVzLFxuICAgIGFwcGx5TWlkZGxld2FyZXNBc3luYyxcbiAgICBmaWx0ZXJBbmRTb3J0UHJvdmlkZXJzLFxuICAgIGZsYXR0ZW5Db25maWcsXG4gICAgZ2V0UGF0aFZhbHVlLFxuICAgIGhhc0NvbnN0cnVjdG9yLFxuICAgIG1ha2VESVRva2VuLFxuICAgIG1hdGNoZXNQYXR0ZXJuLFxuICAgIHNldFBhdGhWYWx1ZSxcbiAgICBzdHJpcERJVG9rZW5OYW1lc3BhY2UsXG4gICAgdmFsaWRhdGVQcm92aWRlck9wdGlvbnNcbn0gZnJvbSAnLi91dGlscyc7XG5cbmltcG9ydCB7XG4gICAgZ2V0Q29uc3RydWN0b3JEZXBlbmRlbmNpZXNNZXRhZGF0YSxcbiAgICBnZXRNb2R1bGVNZXRhZGF0YSxcbiAgICBnZXRPbkluaXRIb29rTWV0YWRhdGEsXG4gICAgZ2V0UHJvcGVydHlEZXBlbmRlbmNpZXNNZXRhZGF0YSxcbn0gZnJvbSAnLi9tZXRhZGF0YSc7XG5cbmltcG9ydCB7IERJX1RPS0VOUyB9IGZyb20gJy4uL2NvbnN0JztcblxuaW1wb3J0IHtcbiAgICBDaXJjdWxhckRlcGVuZGVuY3lFcnJvcixcbiAgICBJbml0aWFsaXphdGlvbk1ldGhvZEVycm9yLFxuICAgIEluaXRpYWxpemF0aW9uTWV0aG9kVHlwZUVycm9yLFxuICAgIEludmFsaWREZXBlbmRlbmN5Q3JpdGVyaWFFcnJvcixcbiAgICBNb2R1bGVNZXRhZGF0YUVycm9yLFxuICAgIE5vRW50aXR5U2NoZW1hUHJvdmlkZXJFcnJvcixcbiAgICBOb0VudGl0eVNlcnZpY2VQcm92aWRlckVycm9yLFxuICAgIE5vUHJvdmlkZXJGb3VuZEVycm9yLFxuICAgIE5vdGhpbmdUb0V4cG9ydEVycm9yLFxuICAgIFByb3ZpZGVyQ29uZmlndXJhdGlvbkVycm9yXG59IGZyb20gJy4vZXJyb3JzJztcbmltcG9ydCB7IEJhc2VTZWFyY2hFbmdpbmUgfSBmcm9tICcuLi9zZWFyY2gnO1xuXG5cbmV4cG9ydCBjbGFzcyBESUNvbnRhaW5lciBpbXBsZW1lbnRzIElESUNvbnRhaW5lciB7XG5cbiAgICBzdGF0aWMgcmVhZG9ubHkgRElNZXRhZGF0YVN0b3JlID0gbmV3IE1ldGFkYXRhTWFuYWdlcih7IG5hbWVzcGFjZTogJ2Z3MjQ6ZGknIH0pO1xuXG4gICAgcHVibGljIHJlYWRvbmx5IGNvbnRhaW5lcklkOiBzdHJpbmc7XG4gICAgcHJpdmF0ZSByZWFkb25seSBsb2dnZXI6IElMb2dnZXI7XG4gICAgcHJpdmF0ZSByZWFkb25seSBtaWRkbGV3YXJlczogRElNaWRkbGV3YXJlPGFueT5bXSA9IFtdO1xuICAgIHByaXZhdGUgcmVhZG9ubHkgYXN5bmNNaWRkbGV3YXJlczogRElNaWRkbGV3YXJlQXN5bmM8YW55PltdID0gW107XG5cbiAgICBwcml2YXRlIF9yZXNvbHZpbmcgPSBuZXcgTWFwPHN0cmluZywgYW55PigpO1xuICAgIHByb3RlY3RlZCBnZXQgcmVzb2x2aW5nKCk6IE1hcDxzdHJpbmcsIGFueT4ge1xuXG4gICAgICAgIGlmICh0aGlzLnByb3h5Rm9yKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5wcm94eUZvci5yZXNvbHZpbmc7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIXRoaXMuX3Jlc29sdmluZykge1xuICAgICAgICAgICAgdGhpcy5fcmVzb2x2aW5nID0gbmV3IE1hcDxzdHJpbmcsIGFueT4oKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5fcmVzb2x2aW5nO1xuICAgIH1cblxuICAgIHByaXZhdGUgX2NhY2hlID0gbmV3IE1hcDxzdHJpbmcsIGFueT4oKTtcbiAgICBwcm90ZWN0ZWQgZ2V0IGNhY2hlKCk6IE1hcDxzdHJpbmcsIGFueT4ge1xuXG4gICAgICAgIGlmICh0aGlzLnByb3h5Rm9yKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5wcm94eUZvci5jYWNoZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghdGhpcy5fY2FjaGUpIHtcbiAgICAgICAgICAgIHRoaXMuX2NhY2hlID0gbmV3IE1hcDxzdHJpbmcsIGFueT4oKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5fY2FjaGU7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBfcHJvdmlkZXJzOiBNYXA8c3RyaW5nLCBJbnRlcm5hbFByb3ZpZGVyT3B0aW9uc1tdPiB8IHVuZGVmaW5lZDtcbiAgICBnZXQgcHJvdmlkZXJzKCk6IE1hcDxzdHJpbmcsIEludGVybmFsUHJvdmlkZXJPcHRpb25zW10+IHtcblxuICAgICAgICBpZiAodGhpcy5wcm94eUZvcikge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMucHJveHlGb3IucHJvdmlkZXJzO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCF0aGlzLl9wcm92aWRlcnMpIHtcbiAgICAgICAgICAgIHRoaXMuX3Byb3ZpZGVycyA9IG5ldyBNYXA8c3RyaW5nLCBJbnRlcm5hbFByb3ZpZGVyT3B0aW9uc1tdPigpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLl9wcm92aWRlcnNcbiAgICB9XG5cbiAgICBwcml2YXRlIF9leHBvcnRzOiBNYXA8c3RyaW5nLCBJbnRlcm5hbFByb3ZpZGVyT3B0aW9uc1tdPiB8IHVuZGVmaW5lZDtcbiAgICBnZXQgZXhwb3J0cygpOiBNYXA8c3RyaW5nLCBJbnRlcm5hbFByb3ZpZGVyT3B0aW9uc1tdPiB7XG5cbiAgICAgICAgaWYgKHRoaXMucHJveHlGb3IpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnByb3h5Rm9yLmV4cG9ydHM7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIXRoaXMuX2V4cG9ydHMpIHtcbiAgICAgICAgICAgIHRoaXMuX2V4cG9ydHMgPSBuZXcgTWFwPHN0cmluZywgSW50ZXJuYWxQcm92aWRlck9wdGlvbnNbXT4oKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5fZXhwb3J0c1xuICAgIH1cblxuICAgIC8vIHdoZW4gdGhpcyBjb250YWluZXIgaXMgYSBwcm94eSBmb3IgYW5vdGhlciBjb250YWluZXI7IHRoZSBhbm90aGVyIGNvbnRhaW5lcidzIHJlZiB3aWxsIGJlIHN0b3JlZCBoZXJlXG4gICAgcHVibGljIHByb3h5Rm9yOiBESUNvbnRhaW5lciB8IHVuZGVmaW5lZDtcblxuICAgIGdldCBwYXJlbnQoKTogRElDb250YWluZXIgfCB1bmRlZmluZWQge1xuICAgICAgICByZXR1cm4gdGhpcy5wYXJlbnRDb250YWluZXJcbiAgICB9XG5cbiAgICBwcml2YXRlIF9jaGlsZENvbnRhaW5lcnM6IFNldDxESUNvbnRhaW5lcj4gfCB1bmRlZmluZWQ7XG4gICAgZ2V0IGNoaWxkQ29udGFpbmVycygpOiBTZXQ8RElDb250YWluZXI+IHtcblxuICAgICAgICBpZiAodGhpcy5wcm94eUZvcikge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMucHJveHlGb3IuY2hpbGRDb250YWluZXJzO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCF0aGlzLl9jaGlsZENvbnRhaW5lcnMpIHtcbiAgICAgICAgICAgIHRoaXMuX2NoaWxkQ29udGFpbmVycyA9IG5ldyBTZXQ8RElDb250YWluZXI+KCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuX2NoaWxkQ29udGFpbmVyc1xuICAgIH1cblxuICAgIHByaXZhdGUgX3Byb3hpZXM6IFNldDxESUNvbnRhaW5lcj4gfCB1bmRlZmluZWQ7XG4gICAgZ2V0IHByb3hpZXMoKTogU2V0PERJQ29udGFpbmVyPiB7XG5cbiAgICAgICAgaWYgKHRoaXMucHJveHlGb3IpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnByb3h5Rm9yLnByb3hpZXM7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIXRoaXMuX3Byb3hpZXMpIHtcbiAgICAgICAgICAgIHRoaXMuX3Byb3hpZXMgPSBuZXcgU2V0PERJQ29udGFpbmVyPigpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLl9wcm94aWVzXG4gICAgfVxuXG4gICAgcHJpdmF0ZSBzdGF0aWMgX3Jvb3RJbnN0YW5jZTogRElDb250YWluZXI7XG4gICAgc3RhdGljIGdldCBST09UKCk6IElESUNvbnRhaW5lciB7XG4gICAgICAgIGlmICghdGhpcy5fcm9vdEluc3RhbmNlKSB7XG4gICAgICAgICAgICB0aGlzLl9yb290SW5zdGFuY2UgPSBuZXcgRElDb250YWluZXIoKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5fcm9vdEluc3RhbmNlO1xuICAgIH1cblxuICAgIHByaXZhdGUgc2VhcmNoRW5naW5lPzogQmFzZVNlYXJjaEVuZ2luZTtcblxuICAgIGNvbnN0cnVjdG9yKHByaXZhdGUgcGFyZW50Q29udGFpbmVyPzogRElDb250YWluZXIsIGlkZW50aWZpZXI6IHN0cmluZyA9ICdST09UJykge1xuICAgICAgICAvLyB0byBlbnN1cmUgZGVzdHJ1Y3R1cmluZyB3b3JrcyBjb3JyZWN0bHlcbiAgICAgICAgdGhpcy5JbmplY3RhYmxlID0gdGhpcy5JbmplY3RhYmxlLmJpbmQodGhpcyk7XG4gICAgICAgIHRoaXMuY29udGFpbmVySWQgPSBpZGVudGlmaWVyO1xuICAgICAgICB0aGlzLmxvZ2dlciA9IGNyZWF0ZUxvZ2dlcihgRElDb250YWluZXJbJHtpZGVudGlmaWVyfV1gKTtcbiAgICB9XG5cbiAgICBJbmplY3RhYmxlKG9wdGlvbnM6IFBhcnRpYWxCeTxCYXNlUHJvdmlkZXJPcHRpb25zLCAncHJvdmlkZSc+ID0ge30pIHtcbiAgICAgICAgcmV0dXJuIEluamVjdGFibGUoeyAuLi5vcHRpb25zLCBwcm92aWRlZEluOiB0aGlzIH0pO1xuICAgIH1cblxuICAgIGNyZWF0ZUNoaWxkQ29udGFpbmVyKGlkZW50aWZpZXI6IHN0cmluZyk6IERJQ29udGFpbmVyIHtcbiAgICAgICAgY29uc3QgY2hpbGQgPSBuZXcgRElDb250YWluZXIodGhpcywgaWRlbnRpZmllcik7XG4gICAgICAgIHRoaXMuY2hpbGRDb250YWluZXJzLmFkZChjaGlsZCk7XG4gICAgICAgIHJldHVybiBjaGlsZDtcbiAgICB9XG5cbiAgICBwcm90ZWN0ZWQgY3JlYXRlQ2hpbGRDb250YWluZXJQcm94eUlkZW50aWZpZXIocGFyZW50Q29udGFpbmVyOiBESUNvbnRhaW5lcik6IHN0cmluZyB7XG4gICAgICAgIHJldHVybiBgJHt0aGlzLmNvbnRhaW5lcklkfTpQcm94eUluWyR7cGFyZW50Q29udGFpbmVyLmNvbnRhaW5lcklkfV1gXG4gICAgfVxuXG4gICAgcHJvdGVjdGVkIGFkZFByb3h5Q29udGFpbmVySW4gPSAocGFyZW50Q29udGFpbmVyOiBESUNvbnRhaW5lcik6IERJQ29udGFpbmVyID0+IHtcblxuICAgICAgICBjb25zdCBwcm94eUNvbnRhaW5lcklkID0gdGhpcy5jcmVhdGVDaGlsZENvbnRhaW5lclByb3h5SWRlbnRpZmllcihwYXJlbnRDb250YWluZXIpO1xuXG4gICAgICAgIC8vIG1ha2Ugc3VyZSB0byByZW1vdmUgb2xkIHByb3h5IGZyb20gdGhlIGltcG9ydGluZyBtb2R1bGUgaWYgZXhpc3RzXG4gICAgICAgIGlmIChwYXJlbnRDb250YWluZXIuaGFzQ2hpbGRDb250YWluZXJCeUlkKHByb3h5Q29udGFpbmVySWQpKSB7XG5cbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYEZvdW5kIG9sZCBwcm94eSBjb250YWluZXI6IFske3Byb3h5Q29udGFpbmVySWR9XSBpbiBwYXJlbnQ6IFske3BhcmVudENvbnRhaW5lci5jb250YWluZXJJZH1dOyByZXBsYWNpbmcgaXRgKTtcblxuICAgICAgICAgICAgY29uc3Qgb2xkUHJveHlDb250YWluZXIgPSBwYXJlbnRDb250YWluZXIuZ2V0Q2hpbGRDb250YWluZXJCeUlkKHByb3h5Q29udGFpbmVySWQpO1xuXG4gICAgICAgICAgICBwYXJlbnRDb250YWluZXIucmVtb3ZlQ2hpbGRDb250YWluZXJCeUlkKHByb3h5Q29udGFpbmVySWQpO1xuXG4gICAgICAgICAgICB0aGlzLnByb3hpZXMuZGVsZXRlKG9sZFByb3h5Q29udGFpbmVyKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IG5ld1Byb3h5Q29udGFpbmVyID0gcGFyZW50Q29udGFpbmVyLmNyZWF0ZUNoaWxkQ29udGFpbmVyKHByb3h5Q29udGFpbmVySWQpO1xuXG4gICAgICAgIG5ld1Byb3h5Q29udGFpbmVyLnByb3h5Rm9yID0gdGhpcztcblxuICAgICAgICB0aGlzLnByb3hpZXMuYWRkKG5ld1Byb3h5Q29udGFpbmVyKTtcblxuICAgICAgICByZXR1cm4gbmV3UHJveHlDb250YWluZXI7XG4gICAgfVxuXG4gICAgaGFzQ2hpbGRDb250YWluZXJCeUlkKGlkZW50aWZpZXI6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgICAgICBsZXQgZm91bmQgPSBBcnJheS5mcm9tKHRoaXMuY2hpbGRDb250YWluZXJzKS5zb21lKFxuICAgICAgICAgICAgZWxlbWVudCA9PiBlbGVtZW50LmNvbnRhaW5lcklkLnN0YXJ0c1dpdGgoaWRlbnRpZmllcilcbiAgICAgICAgKTtcblxuICAgICAgICBpZiAoIWZvdW5kICYmIHRoaXMuY2hpbGRDb250YWluZXJzLnNpemUgPiAwKSB7XG4gICAgICAgICAgICBmb3VuZCA9IEFycmF5LmZyb20odGhpcy5jaGlsZENvbnRhaW5lcnMpLnNvbWUoY2MgPT4gY2MuaGFzQ2hpbGRDb250YWluZXJCeUlkKGlkZW50aWZpZXIpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBmb3VuZDtcbiAgICB9XG5cbiAgICByZW1vdmVDaGlsZENvbnRhaW5lckJ5SWQoaWRlbnRpZmllcjogc3RyaW5nKTogdm9pZCB7XG4gICAgICAgIGNvbnN0IGNoaWxkQ29udGFpbmVyID0gdGhpcy5nZXRDaGlsZENvbnRhaW5lckJ5SWQoaWRlbnRpZmllcik7XG4gICAgICAgIHRoaXMuY2hpbGRDb250YWluZXJzLmRlbGV0ZShjaGlsZENvbnRhaW5lcik7XG4gICAgfVxuXG4gICAgZ2V0Q2hpbGRDb250YWluZXJCeUlkKGlkZW50aWZpZXI6IHN0cmluZyk6IGFueSB7XG4gICAgICAgIGxldCBmb3VuZENvbnRhaW5lciA9IEFycmF5LmZyb20odGhpcy5jaGlsZENvbnRhaW5lcnMpLmZpbmQoZWxlbWVudCA9PiB7XG4gICAgICAgICAgICByZXR1cm4gZWxlbWVudC5jb250YWluZXJJZC5zdGFydHNXaXRoKGlkZW50aWZpZXIpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpZiAoIWZvdW5kQ29udGFpbmVyICYmIHRoaXMuY2hpbGRDb250YWluZXJzLnNpemUgPiAwKSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGNjIG9mIHRoaXMuY2hpbGRDb250YWluZXJzKSB7XG4gICAgICAgICAgICAgICAgZm91bmRDb250YWluZXIgPSBjYy5nZXRDaGlsZENvbnRhaW5lckJ5SWQoaWRlbnRpZmllcik7XG4gICAgICAgICAgICAgICAgaWYgKGZvdW5kQ29udGFpbmVyKSB7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBmb3VuZENvbnRhaW5lcjtcbiAgICB9XG5cbiAgICBtb2R1bGUodGFyZ2V0OiBDbGFzc0NvbnN0cnVjdG9yKSB7XG5cbiAgICAgICAgY29uc3QgbW9kdWxlTWV0YSA9IGdldE1vZHVsZU1ldGFkYXRhKHRhcmdldCk7XG5cbiAgICAgICAgaWYgKCFtb2R1bGVNZXRhKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgTW9kdWxlTWV0YWRhdGFFcnJvcih0YXJnZXQubmFtZSwgdGhpcy5jb250YWluZXJJZCk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB7IGltcG9ydHMgPSBbXSwgZXhwb3J0cyA9IFtdLCBwcm92aWRlcnMgPSBbXSwgaWRlbnRpZmllciB9ID0gbW9kdWxlTWV0YTtcblxuICAgICAgICAvLyBpZiB0aGVyZSdzIG5vIGNvbnRhaW5lciBpbiB0aGUgbW9kdWxlIG1ldGFkYXRhLCBjcmVhdGUgdGhlIG1haW4gY29udGFpbmVyIGZvciB0aGUgbW9kdWxlXG4gICAgICAgIGlmICghbW9kdWxlTWV0YS5oYXNDb250YWluZXIoKSkge1xuXG4gICAgICAgICAgICBjb25zdCBtb2R1bGVDb250YWluZXIgPSBuZXcgRElDb250YWluZXIodW5kZWZpbmVkLCBpZGVudGlmaWVyKTtcbiAgICAgICAgICAgIC8vIHRoaXMubG9nZ2VyLmluZm8oYE1vZHVsZSAke21vZHVsZU1ldGEuaWRlbnRpZmllcn0gbWV0YWRhdGEgZG9lcyBub3QgaGF2ZSBhIGNvbnRhaW5lciwgYXNzaWduaW5nIG9uZS5gLCB7IGlkOiBtb2R1bGVDb250YWluZXIuY29udGFpbmVySWQgfSk7XG5cbiAgICAgICAgICAgIG1vZHVsZU1ldGEuc2V0Q29udGFpbmVyKG1vZHVsZUNvbnRhaW5lcik7XG5cbiAgICAgICAgICAgIC8vIG1ha2Ugc3VyZSBhbGwgdGhlIG1vZHVsZSBwcm92aWRlcnMgYXJlIGxvYWRlZCBpbnRvIHRoZSBtb2R1bGUncyBjb250YWluZXIncyBwcm92aWRlcnNcbiAgICAgICAgICAgIGZvciAoY29uc3QgcHJvdmlkZXIgb2YgcHJvdmlkZXJzKSB7XG4gICAgICAgICAgICAgICAgbW9kdWxlQ29udGFpbmVyLnJlZ2lzdGVyKHByb3ZpZGVyKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIGFuZCBtYWtlIHN1cmUgYWxsIHRoZSBtb2R1bGUgZXhwb3J0cyBhcmUgYWxzbyBsb2FkZWQgaW50byB0aGUgbW9kdWxlJ3MgY29udGFpbmVyJ3MgcHJvdmlkZXJzXG4gICAgICAgICAgICBmb3IgKGNvbnN0IGltcG9ydGVkTW9kdWxlIG9mIGltcG9ydHMpIHtcbiAgICAgICAgICAgICAgICBtb2R1bGVDb250YWluZXIubW9kdWxlKGltcG9ydGVkTW9kdWxlKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gbG9hZCBhbGwgdGhlIGV4cG9ydCBmcm9tIHRoaXMgbW9kdWxlIGludG8gdGhlIGN1cnJlbnQgY29udGFpbmVyXG4gICAgICAgICAgICBmb3IgKGNvbnN0IGV4cG9ydGVkRGVwIG9mIGV4cG9ydHMpIHtcbiAgICAgICAgICAgICAgICBtb2R1bGVDb250YWluZXIuZXhwb3J0UHJvdmlkZXJzRm9yKGV4cG9ydGVkRGVwKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gVE9ETzogbW9kdWxlIGxpZmVjeWNsZSBob29rc1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgbW9kdWxlUHJveHlDb250YWluZXIgPSAobW9kdWxlTWV0YS5jb250YWluZXIgYXMgRElDb250YWluZXIpLmFkZFByb3h5Q29udGFpbmVySW4odGhpcyk7XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGlkZW50aWZpZXIsXG4gICAgICAgICAgICBjb250YWluZXI6IG1vZHVsZVByb3h5Q29udGFpbmVyXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwdWJsaWMgZXhwb3J0UHJvdmlkZXJzRm9yPFQ+KGV4cG9ydGVkRGVwOiBEZXBJZGVudGlmaWVyPFQ+KSB7XG4gICAgICAgIGNvbnN0IHRva2VuID0gdGhpcy5jcmVhdGVUb2tlbihleHBvcnRlZERlcCk7XG5cbiAgICAgICAgbGV0IGZvdW5kUHJvdmlkZXJzRm9yVG9rZW4gPSBmYWxzZTtcblxuICAgICAgICAvLyBDb2xsZWN0IHByb3ZpZGVycyBkaXJlY3RseSBtYXRjaGluZyB0aGUgZXhwb3J0IHRva2VuXG4gICAgICAgIGNvbnN0IGF2YWlsYWJsZVByb3ZpZGVycyA9IHRoaXMucHJvdmlkZXJzLmdldCh0b2tlbikgfHwgW107XG4gICAgICAgIGNvbnN0IGNoaWxkRXhwb3J0ZWRQcm92aWRlcnMgPSBBcnJheS5mcm9tKHRoaXMuY2hpbGRDb250YWluZXJzKVxuICAgICAgICAgICAgLmZsYXRNYXAoY2hpbGQgPT4gY2hpbGQuZXhwb3J0cy5nZXQodG9rZW4pIHx8IFtdKTtcblxuICAgICAgICAvLyBDb21iaW5lIGF2YWlsYWJsZSBwcm92aWRlcnMgYW5kIGNoaWxkIGV4cG9ydGVkIHByb3ZpZGVyc1xuICAgICAgICBjb25zdCBhbGxQcm92aWRlcnMgPSBbIC4uLmF2YWlsYWJsZVByb3ZpZGVycywgLi4uY2hpbGRFeHBvcnRlZFByb3ZpZGVycyBdO1xuXG4gICAgICAgIC8vIE5lc3RlZCBmdW5jdGlvbiB0byBtYXAgYW5kIGV4cG9ydCBwcm92aWRlcnNcbiAgICAgICAgY29uc3QgbWFwQW5kRXhwb3J0UHJvdmlkZXJzID0gKHByb3ZpZGVyczogSW50ZXJuYWxQcm92aWRlck9wdGlvbnNbXSwgdGFyZ2V0VG9rZW46IHN0cmluZykgPT4ge1xuXG4gICAgICAgICAgICBmb3VuZFByb3ZpZGVyc0ZvclRva2VuID0gdHJ1ZTtcblxuICAgICAgICAgICAgY29uc3QgZXhwb3J0ZWQgPSBwcm92aWRlcnMubWFwKHByb3ZpZGVyID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCB7IF9jb250YWluZXIsIF9wcm92aWRlciwgX2lkIH0gPSBwcm92aWRlcjtcbiAgICAgICAgICAgICAgICBjb25zdCB7IGNvbmRpdGlvbiwgcHJvdmlkZSwgcHJpb3JpdHksIG92ZXJyaWRlLCBzaW5nbGV0b24sIHRhZ3MsIHR5cGUsIGZvckVudGl0eSB9ID0gX3Byb3ZpZGVyO1xuXG4gICAgICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICAgICAgX3Byb3ZpZGVyOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICB1c2VGYWN0b3J5OiAoKSA9PiBfY29udGFpbmVyLnJlc29sdmUocHJvdmlkZSksXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25kaXRpb24sXG4gICAgICAgICAgICAgICAgICAgICAgICBwcm92aWRlLFxuICAgICAgICAgICAgICAgICAgICAgICAgcHJpb3JpdHksXG4gICAgICAgICAgICAgICAgICAgICAgICBvdmVycmlkZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHNpbmdsZXRvbixcbiAgICAgICAgICAgICAgICAgICAgICAgIHRhZ3MsXG4gICAgICAgICAgICAgICAgICAgICAgICB0eXBlLFxuICAgICAgICAgICAgICAgICAgICAgICAgZm9yRW50aXR5LFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBfaWQsXG4gICAgICAgICAgICAgICAgICAgIF9jb250YWluZXI6IHRoaXNcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIC8vIE1lcmdlIG9yIHNldCB0aGVzZSBleHBvcnRlZCBwcm92aWRlcnMgdW5kZXIgdGhlaXIgcmVzcGVjdGl2ZSBrZXlzXG4gICAgICAgICAgICBjb25zdCBleGlzdGluZ0V4cG9ydHMgPSB0aGlzLmV4cG9ydHMuZ2V0KHRhcmdldFRva2VuKSB8fCBbXTtcbiAgICAgICAgICAgIHRoaXMuZXhwb3J0cy5zZXQodGFyZ2V0VG9rZW4sIFsgLi4uZXhpc3RpbmdFeHBvcnRzLCAuLi5leHBvcnRlZCBdKTtcbiAgICAgICAgfTtcblxuICAgICAgICBpZiAoYWxsUHJvdmlkZXJzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIC8vIEV4cG9ydCB0aGUgc3RhbmRhcmQgYW5kIGNvbmZpZyBwcm92aWRlcnMgZGlyZWN0bHkgbWF0Y2hpbmcgdGhlIHRva2VuXG4gICAgICAgICAgICBtYXBBbmRFeHBvcnRQcm92aWRlcnMoYWxsUHJvdmlkZXJzLCB0b2tlbik7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBGaW5kIGFsbCBjb25maWcgcHJvdmlkZXJzIHdob3NlIGtleXMgc3RhcnQgd2l0aCB0aGUgdG9rZW4gYW5kIGV4cG9ydCB0aGVtXG4gICAgICAgIGZvciAoY29uc3QgWyBjb25maWdLZXksIGNvbmZpZ1Byb3ZpZGVycyBdIG9mIHRoaXMucHJvdmlkZXJzLmVudHJpZXMoKSkge1xuICAgICAgICAgICAgaWYgKGNvbmZpZ0tleS5zdGFydHNXaXRoKHRva2VuKSAmJiBjb25maWdQcm92aWRlcnMuc29tZShwID0+IHAuX3Byb3ZpZGVyLnR5cGUgPT09ICdjb25maWcnKSkge1xuICAgICAgICAgICAgICAgIG1hcEFuZEV4cG9ydFByb3ZpZGVycyhjb25maWdQcm92aWRlcnMsIGNvbmZpZ0tleSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIWZvdW5kUHJvdmlkZXJzRm9yVG9rZW4pIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBOb3RoaW5nVG9FeHBvcnRFcnJvcih0b2tlbiwgdGhpcy5jb250YWluZXJJZCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBjcmVhdGVUb2tlbjxUPih0b2tlbk9yVHlwZTogRGVwSWRlbnRpZmllcjxUPik6IFRva2VuIHtcbiAgICAgICAgLy8gbWF5YmUgYWRkIGEgbWVjaGFuaXNtIGZvciBhZGRpbmcgZXh0cmEgbWV0YWRhdGEgdG8gdGhlIHRva2VuIGxpa2UgY29udGFpbmVyIElEIGFuZCBzdHVmZj9cbiAgICAgICAgcmV0dXJuIG1ha2VESVRva2VuKHRva2VuT3JUeXBlKTtcbiAgICB9XG5cbiAgICByZWdpc3RlcjxUPihvcHRpb25zOiBQcm92aWRlck9wdGlvbnM8VD4sIGNvbnRhaW5lcjogRElDb250YWluZXIgPSB0aGlzKTogeyBwcm92aWRlOiBUb2tlbiwgb3B0aW9uczogUHJvdmlkZXJPcHRpb25zPFQ+IH0gfCB1bmRlZmluZWQge1xuICAgICAgICBpZiAoY29udGFpbmVyICE9PSB0aGlzKSB7XG4gICAgICAgICAgICByZXR1cm4gY29udGFpbmVyLnJlZ2lzdGVyKG9wdGlvbnMpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgdG9rZW4gPSB0aGlzLmNyZWF0ZVRva2VuKG9wdGlvbnMucHJvdmlkZSk7XG5cbiAgICAgICAgY29uc3Qgb3B0aW9uc0NvcHkgPSB7XG4gICAgICAgICAgICAuLi5vcHRpb25zLFxuICAgICAgICAgICAgdHlwZTogb3B0aW9ucy50eXBlIHx8ICd1bmtub3duJyxcbiAgICAgICAgICAgIHByaW9yaXR5OiBvcHRpb25zLnByaW9yaXR5ICE9PSB1bmRlZmluZWQgPyBvcHRpb25zLnByaW9yaXR5IDogMCxcbiAgICAgICAgICAgIHNpbmdsZXRvbjogb3B0aW9ucy5zaW5nbGV0b24gIT09IHVuZGVmaW5lZCA/IG9wdGlvbnMuc2luZ2xldG9uIDogdHJ1ZSxcbiAgICAgICAgfTtcblxuICAgICAgICBpZiAob3B0aW9uc0NvcHkuY29uZGl0aW9uICYmICFvcHRpb25zQ29weS5jb25kaXRpb24oKSkgcmV0dXJuO1xuXG4gICAgICAgIHZhbGlkYXRlUHJvdmlkZXJPcHRpb25zKG9wdGlvbnNDb3B5LCB0b2tlbik7XG5cbiAgICAgICAgLy8gSGFuZGxlIGNvbmZpZyBwcm92aWRlcnNcbiAgICAgICAgaWYgKGlzQ29uZmlnUHJvdmlkZXJPcHRpb25zKG9wdGlvbnMpKSB7XG4gICAgICAgICAgICB0aGlzLnJlZ2lzdGVyQ29uZmlnUHJvdmlkZXIob3B0aW9ucyk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLnJlZ2lzdGVyUHJvdmlkZXIoeyBfcHJvdmlkZXI6IG9wdGlvbnNDb3B5IH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHByb3ZpZGU6IHRva2VuLFxuICAgICAgICAgICAgb3B0aW9uczogb3B0aW9uc0NvcHksXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgcmVnaXN0ZXJDb25maWdQcm92aWRlcihvcHRpb25zOiBDb25maWdQcm92aWRlck9wdGlvbnMpIHtcbiAgICAgICAgY29uc3QgeyB1c2VDb25maWcsIHByb3ZpZGU6IHByb3ZpZGUsIC4uLnJlc3QgfSA9IG9wdGlvbnM7XG5cbiAgICAgICAgbGV0IHByb3ZpZGVUb2tlbiA9IHN0cmlwRElUb2tlbk5hbWVzcGFjZSh0aGlzLmNyZWF0ZVRva2VuKHByb3ZpZGUpKTtcbiAgICAgICAgY29uc3QgZmxhdHRlbmVkRW50cmllcyA9IGZsYXR0ZW5Db25maWcodXNlQ29uZmlnLCBwcm92aWRlVG9rZW4pO1xuXG4gICAgICAgIGZvciAoY29uc3QgWyBjb25maWdQYXRoLCB2YWx1ZSBdIG9mIGZsYXR0ZW5lZEVudHJpZXMpIHtcbiAgICAgICAgICAgIHRoaXMucmVnaXN0ZXJQcm92aWRlcih7XG4gICAgICAgICAgICAgICAgX3Byb3ZpZGVyOiB7XG4gICAgICAgICAgICAgICAgICAgIC4uLnJlc3QsXG4gICAgICAgICAgICAgICAgICAgIHR5cGU6ICdjb25maWcnLFxuICAgICAgICAgICAgICAgICAgICBwcm92aWRlOiBjb25maWdQYXRoLFxuICAgICAgICAgICAgICAgICAgICB1c2VDb25maWc6IHZhbHVlLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByb3RlY3RlZCByZWdpc3RlclByb3ZpZGVyKG9wdGlvbnM6IFBhcnRpYWxCeTxJbnRlcm5hbFByb3ZpZGVyT3B0aW9ucywgJ19pZCcgfCAnX2NvbnRhaW5lcic+KSB7XG4gICAgICAgIGNvbnN0IGN1cnJlbnRQcm92aWRlciA9IG9wdGlvbnMuX3Byb3ZpZGVyO1xuICAgICAgICBjb25zdCB0b2tlbiA9IHRoaXMuY3JlYXRlVG9rZW4oY3VycmVudFByb3ZpZGVyLnByb3ZpZGUpO1xuICAgICAgICBjdXJyZW50UHJvdmlkZXIuX3Rva2VuID0gdG9rZW47XG5cbiAgICAgICAgY29uc3QgdG9rZW5Qcm92aWRlcnMgPSB0aGlzLnByb3ZpZGVycy5nZXQodG9rZW4pIHx8IFtdO1xuXG4gICAgICAgIGNvbnN0IGFyZUJvdGhWYWx1ZXNFcXVhbCA9IDxUPih2YWx1ZTE6IFQgfCBudWxsIHwgdW5kZWZpbmVkLCB2YWx1ZTI6IFQgfCBudWxsIHwgdW5kZWZpbmVkKTogYm9vbGVhbiA9PiB7XG4gICAgICAgICAgICByZXR1cm4gKHZhbHVlMSA9PSBudWxsICYmIHZhbHVlMiA9PSBudWxsKSB8fCAodmFsdWUxICE9PSBudWxsICYmIHZhbHVlMSAhPT0gdW5kZWZpbmVkICYmIHZhbHVlMSA9PT0gdmFsdWUyKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGFyZUJvdGhBcnJheXNFcXVhbCA9IDxUPihhcnIxOiBUW10gfCBudWxsIHwgdW5kZWZpbmVkLCBhcnIyOiBUW10gfCBudWxsIHwgdW5kZWZpbmVkKTogYm9vbGVhbiA9PiB7XG4gICAgICAgICAgICBpZiAoYXJyMSA9PSBudWxsICYmIGFycjIgPT0gbnVsbCkgcmV0dXJuIHRydWU7XG4gICAgICAgICAgICBpZiAoYXJyMSA9PSBudWxsIHx8IGFycjIgPT0gbnVsbCB8fCBhcnIxLmxlbmd0aCAhPT0gYXJyMi5sZW5ndGgpIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgIHJldHVybiBbIC4uLmFycjEgXS5zb3J0KCkuZXZlcnkoKHZhbHVlLCBpbmRleCkgPT4gdmFsdWUgPT09IGFycjIuc2xpY2UoKS5zb3J0KClbIGluZGV4IF0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gaWYgdG9rZW4gcHJvdmlkZXJzIGFscmVhZHkgaGFzIGEgcHJvdmlkZXIgd2l0aCBzYW1lIHByaW9yaXR5LCB0eXBlLCBmb3JFbnRpdHkgYW5kIHRhZ3MsIGxvZyB3YXJuaW5nIGFuZCByZXBsYWNlIGl0XG4gICAgICAgIGNvbnN0IGV4aXN0aW5nUHJvdmlkZXIgPSB0b2tlblByb3ZpZGVycy5maW5kKCh7IF9wcm92aWRlcjogZXhpc3RpbmdQcm92aWRlciB9KSA9PiB7XG4gICAgICAgICAgICByZXR1cm4gZXhpc3RpbmdQcm92aWRlci5wcmlvcml0eSA9PT0gY3VycmVudFByb3ZpZGVyLnByaW9yaXR5XG4gICAgICAgICAgICAgICAgJiYgYXJlQm90aFZhbHVlc0VxdWFsKGV4aXN0aW5nUHJvdmlkZXIudHlwZSwgY3VycmVudFByb3ZpZGVyLnR5cGUpXG4gICAgICAgICAgICAgICAgJiYgYXJlQm90aEFycmF5c0VxdWFsKGV4aXN0aW5nUHJvdmlkZXIudGFncywgY3VycmVudFByb3ZpZGVyLnRhZ3MpIC8vICEgbWF5YmUgYmUgbWFrZSBpdCBjb25maWd1cmFibGUgdG8gY29tcGFyZSB0YWdzLi4uXG4gICAgICAgICAgICAgICAgJiYgYXJlQm90aFZhbHVlc0VxdWFsKGV4aXN0aW5nUHJvdmlkZXIuZm9yRW50aXR5LCBjdXJyZW50UHJvdmlkZXIuZm9yRW50aXR5KVxuICAgICAgICB9KTtcblxuICAgICAgICBpZiAoZXhpc3RpbmdQcm92aWRlcikge1xuICAgICAgICAgICAgLy8gY29uc3QgaW5kZXggPSB0b2tlblByb3ZpZGVycy5pbmRleE9mKGV4aXN0aW5nUHJvdmlkZXIpO1xuICAgICAgICAgICAgLy8gZGVsZXRlIHRoZSBleGlzdGluZyBwcm92aWRlclxuICAgICAgICAgICAgLy8gdG9rZW5Qcm92aWRlcnMuc3BsaWNlKGluZGV4LCAxKTtcblxuICAgICAgICAgICAgLy8gRE8gTk9UIHJlcGxhY2UgdGhlIGV4aXN0aW5nIHByb3ZpZGVyLCBqdXN0IGxvZyBhIHdhcm5pbmdcbiAgICAgICAgICAgIC8vIHRoaXMubG9nZ2VyLndhcm4oYFByb3ZpZGVyIGZvciAke3Rva2VufSB3aXRoIHNhbWUgcHJpb3JpdHksIHR5cGUsIGZvckVudGl0eSBhbmQgdGFncyBhbHJlYWR5IGV4aXN0cywgcmVwbGFjaW5nIGl0LiB8IE9wdGlvbnNbJHtKU09OLnN0cmluZ2lmeShvcHRpb25zKX1dYCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBpbnRlcm5hbFByb3ZpZGVyT3B0aW9ucyA9IHtcbiAgICAgICAgICAgIC4uLm9wdGlvbnMsXG4gICAgICAgICAgICBfaWQ6IGdlbmVyYXRlVVVJRCgpLFxuICAgICAgICAgICAgX2NvbnRhaW5lcjogdGhpcyxcbiAgICAgICAgfTtcblxuICAgICAgICB0b2tlblByb3ZpZGVycy5wdXNoKGludGVybmFsUHJvdmlkZXJPcHRpb25zKTtcbiAgICAgICAgdGhpcy5wcm92aWRlcnMuc2V0KHRva2VuLCB0b2tlblByb3ZpZGVycyk7XG4gICAgfVxuXG4gICAgcmVtb3ZlUHJvdmlkZXJzRm9yKGRlcGVuZGVuY3lUb2tlbjogRGVwSWRlbnRpZmllcikge1xuICAgICAgICBjb25zdCB0b2tlbiA9IHRoaXMuY3JlYXRlVG9rZW4oZGVwZW5kZW5jeVRva2VuKTtcbiAgICAgICAgY29uc3QgcHJvdmlkZXJzID0gdGhpcy5wcm92aWRlcnMuZ2V0KHRva2VuKSB8fCBbXTtcbiAgICAgICAgcHJvdmlkZXJzLmZvckVhY2gocHJvdmlkZXIgPT4ge1xuICAgICAgICAgICAgdGhpcy5jYWNoZS5kZWxldGUocHJvdmlkZXIuX2lkISk7XG4gICAgICAgIH0pO1xuICAgICAgICB0aGlzLnByb3ZpZGVycy5kZWxldGUodG9rZW4pO1xuICAgIH1cblxuICAgIC8vIFJlc29sdmUgYSBjb25maWd1cmF0aW9uIHBhdGggd2l0aCBmbGV4aWJsZSBjcml0ZXJpYSwgc3VwcG9ydGluZyB3aWxkY2FyZHMgYW5kIHJlZ2V4XG4gICAgcmVzb2x2ZUNvbmZpZzxUID0gYW55PihcbiAgICAgICAgcXVlcnk6IHN0cmluZyA9ICcnLFxuICAgICAgICBjcml0ZXJpYT86IHtcbiAgICAgICAgICAgIHByaW9yaXR5PzogUHJpb3JpdHlDcml0ZXJpYTtcbiAgICAgICAgICAgIHRhZ3M/OiBzdHJpbmdbXTtcbiAgICAgICAgfVxuICAgICk6IERlZXBQYXJ0aWFsPFQ+IHtcblxuICAgICAgICBxdWVyeSA9IHN0cmlwRElUb2tlbk5hbWVzcGFjZShxdWVyeSk7XG5cbiAgICAgICAgY29uc3QgbWF0Y2hpbmdQYXRocyA9IHRoaXMuY29sbGVjdE1hdGNoaW5nQ29uZmlnUGF0aHMocXVlcnkpO1xuXG4gICAgICAgIGNvbnN0IHJlc29sdmVkVmFsdWVzID0gdGhpcy5yZXNvbHZlQ29uZmlnUGF0aHMobWF0Y2hpbmdQYXRocywgY3JpdGVyaWEpO1xuXG4gICAgICAgIC8vIE1lcmdlIHJlc29sdmVkIHZhbHVlcyBpbnRvIGEgZmluYWwgY29uZmlndXJhdGlvbiBvYmplY3RcbiAgICAgICAgY29uc3QgbWVyZ2VkQ29uZmlnOiBSZWNvcmQ8YW55LCBhbnk+ID0ge307XG5cbiAgICAgICAgcmVzb2x2ZWRWYWx1ZXMuZm9yRWFjaCgodmFsdWUsIHBhdGgpID0+IHtcbiAgICAgICAgICAgIHBhdGggPSBzdHJpcERJVG9rZW5OYW1lc3BhY2UocGF0aCk7XG4gICAgICAgICAgICBzZXRQYXRoVmFsdWUobWVyZ2VkQ29uZmlnLCBwYXRoLCB2YWx1ZSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiBnZXRQYXRoVmFsdWUobWVyZ2VkQ29uZmlnLCBxdWVyeSkgYXMgRGVlcFBhcnRpYWw8VD47XG4gICAgfVxuXG4gICAgLy8gQ29sbGVjdCBhbGwgcGF0aHMgdGhhdCBtYXRjaCB0aGUgcXVlcnksIHN1cHBvcnRpbmcgd2lsZGNhcmRzIGFuZCByZWdleFxuICAgIHByaXZhdGUgY29sbGVjdE1hdGNoaW5nQ29uZmlnUGF0aHMocXVlcnk6IHN0cmluZyk6IFNldDxzdHJpbmc+IHtcbiAgICAgICAgY29uc3QgbWF0Y2hpbmdQYXRoczogU2V0PHN0cmluZz4gPSBuZXcgU2V0KCk7XG5cbiAgICAgICAgY29uc3QgcHJvY2Vzc0tleXMgPSAoa2V5czogSXRlcmFibGVJdGVyYXRvcjxzdHJpbmc+KSA9PiB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHBhdGggb2Yga2V5cykge1xuICAgICAgICAgICAgICAgIGNvbnN0IGFjdHVhbFBhdGggPSBzdHJpcERJVG9rZW5OYW1lc3BhY2UocGF0aCk7XG4gICAgICAgICAgICAgICAgaWYgKG1hdGNoZXNQYXR0ZXJuKGFjdHVhbFBhdGgsIHF1ZXJ5KSkge1xuICAgICAgICAgICAgICAgICAgICBtYXRjaGluZ1BhdGhzLmFkZChwYXRoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG5cbiAgICAgICAgbGV0IGN1cnJlbnQ6IERJQ29udGFpbmVyIHwgdW5kZWZpbmVkID0gdGhpcztcblxuICAgICAgICB3aGlsZSAoY3VycmVudCkge1xuICAgICAgICAgICAgLy8gQ2hlY2sgdGhlIHByb3ZpZGVycyBpbiB0aGUgY3VycmVudCBjb250YWluZXJcbiAgICAgICAgICAgIHByb2Nlc3NLZXlzKGN1cnJlbnQucHJvdmlkZXJzLmtleXMoKSk7XG5cbiAgICAgICAgICAgIC8vIENoZWNrIHRoZSBleHBvcnRlZCBwcm92aWRlcnMgZnJvbSBjaGlsZCBjb250YWluZXJzXG4gICAgICAgICAgICBjdXJyZW50LmNoaWxkQ29udGFpbmVycy5mb3JFYWNoKGNoaWxkID0+IHtcbiAgICAgICAgICAgICAgICBwcm9jZXNzS2V5cyhjaGlsZC5leHBvcnRzLmtleXMoKSk7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgLy8gTW92ZSB0byB0aGUgcGFyZW50IGNvbnRhaW5lclxuICAgICAgICAgICAgY3VycmVudCA9IGN1cnJlbnQucGFyZW50O1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIG1hdGNoaW5nUGF0aHM7XG4gICAgfVxuXG4gICAgLy8gUmVzb2x2ZSB2YWx1ZXMgZm9yIGFsbCBtYXRjaGluZyBwYXRocyB1c2luZyB0aGUgYmVzdCBwcm92aWRlciBmcm9tIHRoZSBoaWVyYXJjaHkgYmFzZWQgb24gY3JpdGVyaWFcbiAgICBwcml2YXRlIHJlc29sdmVDb25maWdQYXRocyhcbiAgICAgICAgcGF0aHM6IFNldDxzdHJpbmc+LFxuICAgICAgICBjcml0ZXJpYT86IHtcbiAgICAgICAgICAgIHByaW9yaXR5PzogUHJpb3JpdHlDcml0ZXJpYTtcbiAgICAgICAgICAgIHRhZ3M/OiBzdHJpbmdbXTtcbiAgICAgICAgICAgIGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnM/OiBib29sZWFuXG4gICAgICAgIH1cbiAgICApOiBNYXA8c3RyaW5nLCBhbnk+IHtcblxuICAgICAgICBjb25zdCByZXNvbHZlZFZhbHVlcyA9IG5ldyBNYXA8c3RyaW5nLCBhbnk+KCk7XG5cbiAgICAgICAgY29uc3QgcmVkdWNlUHJvdmlkZXJzID0gKHByb3ZpZGVyczogSW50ZXJuYWxQcm92aWRlck9wdGlvbnNbXSk6IGFueSA9PiB7XG4gICAgICAgICAgICBpZiAocHJvdmlkZXJzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIEFzc3VtZSB0aGUgaGlnaGVzdC1wcmlvcml0eSBwcm92aWRlcidzIHZhbHVlIGlzIHRoZSBkZXNpcmVkIG9uZVxuICAgICAgICAgICAgY29uc3QgYmVzdFByb3ZpZGVyID0gcHJvdmlkZXJzWyAwIF0uX3Byb3ZpZGVyIGFzIENvbmZpZ1Byb3ZpZGVyT3B0aW9uczxhbnk+O1xuICAgICAgICAgICAgcmV0dXJuIGJlc3RQcm92aWRlci51c2VDb25maWdcbiAgICAgICAgfVxuXG4gICAgICAgIHBhdGhzLmZvckVhY2goKHBhdGgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGJlc3RQcm92aWRlcnMgPSB0aGlzLmNvbGxlY3RCZXN0UHJvdmlkZXJzRm9yPENvbmZpZ1Byb3ZpZGVyT3B0aW9ucz4oe1xuICAgICAgICAgICAgICAgIC4uLmNyaXRlcmlhLFxuICAgICAgICAgICAgICAgIHRva2VuOiBwYXRoLFxuICAgICAgICAgICAgICAgIHR5cGU6ICdjb25maWcnXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY29uc3QgcmVzb2x2ZWRWYWx1ZSA9IHJlZHVjZVByb3ZpZGVycyhiZXN0UHJvdmlkZXJzKTtcblxuICAgICAgICAgICAgcmVzb2x2ZWRWYWx1ZXMuc2V0KHBhdGgsIHJlc29sdmVkVmFsdWUpO1xuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gcmVzb2x2ZWRWYWx1ZXM7XG4gICAgfVxuXG4gICAgLy8gQ29sbGVjdCBhbGwgcHJvdmlkZXJzIGZvciBhIGdpdmVuIHBhdGggYWNyb3NzIHRoZSBoaWVyYXJjaHlcbiAgICBwdWJsaWMgY29sbGVjdEJlc3RQcm92aWRlcnNGb3I8VD4oXG4gICAgICAgIGNyaXRlcmlhOiB7XG4gICAgICAgICAgICB0b2tlbj86IHN0cmluZyxcbiAgICAgICAgICAgIHRhZ3M/OiBzdHJpbmdbXSxcbiAgICAgICAgICAgIHR5cGU/OiBQcm92aWRlck9wdGlvbnNbICd0eXBlJyBdLFxuICAgICAgICAgICAgcHJpb3JpdHk/OiBQcmlvcml0eUNyaXRlcmlhLFxuICAgICAgICAgICAgZm9yRW50aXR5PzogUHJvdmlkZXJPcHRpb25zWyAnZm9yRW50aXR5JyBdLFxuICAgICAgICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVycz86IGJvb2xlYW5cbiAgICAgICAgfVxuICAgICk6IEludGVybmFsUHJvdmlkZXJPcHRpb25zPFQ+W10ge1xuICAgICAgICBjb25zdCBiZXN0UHJvdmlkZXJzID0gbmV3IE1hcDxzdHJpbmcsIEludGVybmFsUHJvdmlkZXJPcHRpb25zPFQ+PigpO1xuXG4gICAgICAgIGxldCBjdXJyZW50OiBESUNvbnRhaW5lciB8IHVuZGVmaW5lZCA9IHRoaXM7XG4gICAgICAgIGxldCBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzID0gY3JpdGVyaWEuYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVycyB8fCBmYWxzZTtcblxuICAgICAgICBjb25zdCB2aXNpdGVkQ29udGFpbmVycyA9IG5ldyBTZXQ8RElDb250YWluZXI+KCk7XG5cbiAgICAgICAgY29uc3QgY3JpdGVyaWFTdHJpbmcgPSBKU09OLnN0cmluZ2lmeShjcml0ZXJpYSk7XG5cbiAgICAgICAgd2hpbGUgKGN1cnJlbnQpIHtcbiAgICAgICAgICAgIGlmICh2aXNpdGVkQ29udGFpbmVycy5oYXMoY3VycmVudCkpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENpcmN1bGFyIHJlZmVyZW5jZSBkZXRlY3RlZCBpbiBjb250YWluZXIgaGllcmFyY2h5LiBESUNvbnRhaW5lclske3RoaXMuY29udGFpbmVySWR9XSB8IENyaXRlcmlhOiBbJHtjcml0ZXJpYVN0cmluZ31dYCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB2aXNpdGVkQ29udGFpbmVycy5hZGQoY3VycmVudCk7XG5cbiAgICAgICAgICAgIGxldCBwYXRoUHJvdmlkZXJzID0gY3JpdGVyaWEudG9rZW5cbiAgICAgICAgICAgICAgICA/IGN1cnJlbnQucHJvdmlkZXJzLmdldChjcml0ZXJpYS50b2tlbikgfHwgW11cbiAgICAgICAgICAgICAgICA6IEFycmF5LmZyb20oY3VycmVudC5wcm92aWRlcnMudmFsdWVzKCkpLmZsYXQoKTtcblxuICAgICAgICAgICAgaWYgKGNyaXRlcmlhPy50eXBlKSB7XG4gICAgICAgICAgICAgICAgcGF0aFByb3ZpZGVycyA9IHBhdGhQcm92aWRlcnMuZmlsdGVyKHAgPT4gcC5fcHJvdmlkZXIudHlwZSA9PT0gY3JpdGVyaWEudHlwZSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChjcml0ZXJpYT8uZm9yRW50aXR5KSB7XG4gICAgICAgICAgICAgICAgcGF0aFByb3ZpZGVycyA9IHBhdGhQcm92aWRlcnMuZmlsdGVyKHAgPT4gcC5fcHJvdmlkZXIuZm9yRW50aXR5ID09PSBjcml0ZXJpYS5mb3JFbnRpdHkpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHBhdGhQcm92aWRlcnMuZm9yRWFjaChwcm92aWRlciA9PiB7XG5cbiAgICAgICAgICAgICAgICBpZiAoYmVzdFByb3ZpZGVycy5oYXMocHJvdmlkZXIuX2lkKSkge1xuICAgICAgICAgICAgICAgICAgICAvLyB0aGlzLmxvZ2dlci5pbmZvKGBQcm92aWRlciB3aXRoIGlkICR7cHJvdmlkZXIuX2lkfSBhbHJlYWR5IGV4aXN0cyBpbiBiZXN0LXByb3ZpZGVycywgc2tpcHBpbmcgaXQuIHwgQ3JpdGVyaWE6IFske2NyaXRlcmlhU3RyaW5nfV1gKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGJlc3RQcm92aWRlcnMuc2V0KHByb3ZpZGVyLl9pZCwge1xuICAgICAgICAgICAgICAgICAgICAuLi5wcm92aWRlcixcbiAgICAgICAgICAgICAgICAgICAgLy8gd2hlbiBpdCdzIGEgcHJveHkgY29udGFpbmVyIG1ha2Ugc3VyZSB0aGUgcHJvdmlkZXIgaGFzIGl0J3MgcmVmZXJlbmNlIGZvciByZXNvbHZpbmcgaXQgbGF0ZXIsXG4gICAgICAgICAgICAgICAgICAgIC8vIHRoYXQgd2F5IHRoZSBwcm92aWRlciBpcyByZXNvbHZlZCB1c2luZyB0aGUgcmlnaHQgaGllcmFyY2h5XG4gICAgICAgICAgICAgICAgICAgIF9jb250YWluZXI6IGN1cnJlbnQgYXMgRElDb250YWluZXJcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAvLyBDb2xsZWN0IGV4cG9ydGVkIHByb3ZpZGVycyBmcm9tIGNoaWxkIGNvbnRhaW5lcnNcbiAgICAgICAgICAgIGN1cnJlbnQuY2hpbGRDb250YWluZXJzLmZvckVhY2goY2hpbGQgPT4ge1xuXG4gICAgICAgICAgICAgICAgLy8gYXMgd2UncmUgbW92aW5nIGZyb20gY2hpbGQgdG8gcGFyZW50LCBtYWtlIHN1cmUgdG8gc2tpcCBvdmVyIHRoZSB2aXNpdGVkIGNvbnRhaW5lcnNcbiAgICAgICAgICAgICAgICBpZiAodmlzaXRlZENvbnRhaW5lcnMuaGFzKGNoaWxkKSkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgdmlzaXRlZENvbnRhaW5lcnMuYWRkKGNoaWxkKTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBjb25zdCBjaGlsZFByb3ZpZGVycyA9IGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnMgPyBjaGlsZC5wcm92aWRlcnMgOiBjaGlsZC5leHBvcnRzO1xuXG4gICAgICAgICAgICAgICAgbGV0IGNoaWxkRXhwb3J0ZWRQcm92aWRlcnMgPSBjcml0ZXJpYS50b2tlbiA/IChjaGlsZFByb3ZpZGVycy5nZXQoY3JpdGVyaWEudG9rZW4pIHx8IFtdKVxuICAgICAgICAgICAgICAgICAgICA6IEFycmF5LmZyb20oY2hpbGRQcm92aWRlcnMudmFsdWVzKCkpLmZsYXQoKTtcblxuICAgICAgICAgICAgICAgIGlmIChjcml0ZXJpYT8udHlwZSkge1xuICAgICAgICAgICAgICAgICAgICBjaGlsZEV4cG9ydGVkUHJvdmlkZXJzID0gY2hpbGRFeHBvcnRlZFByb3ZpZGVycy5maWx0ZXIocCA9PiBwLl9wcm92aWRlci50eXBlID09PSBjcml0ZXJpYS50eXBlKTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAoY3JpdGVyaWE/LmZvckVudGl0eSkge1xuICAgICAgICAgICAgICAgICAgICBjaGlsZEV4cG9ydGVkUHJvdmlkZXJzID0gY2hpbGRFeHBvcnRlZFByb3ZpZGVycy5maWx0ZXIocCA9PiBwLl9wcm92aWRlci5mb3JFbnRpdHkgPT09IGNyaXRlcmlhLmZvckVudGl0eSlcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBjaGlsZEV4cG9ydGVkUHJvdmlkZXJzLmZvckVhY2gocHJvdmlkZXIgPT4ge1xuXG4gICAgICAgICAgICAgICAgICAgIGlmIChiZXN0UHJvdmlkZXJzLmhhcyhwcm92aWRlci5faWQpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyB0aGlzLmxvZ2dlci5pbmZvKGBQcm92aWRlciB3aXRoIGlkICR7cHJvdmlkZXIuX2lkfSBhbHJlYWR5IGV4aXN0cyBpbiBiZXN0LXByb3ZpZGVycywgc2tpcHBpbmcgZXhwb3J0ZWQtcHJvdmlkZXIgZnJvbSBjaGlsZCBjb250YWluZXI6ICR7Y2hpbGQuY29udGFpbmVySWR9IHwgQ3JpdGVyaWE6IFske2NyaXRlcmlhU3RyaW5nfV1gKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgIGJlc3RQcm92aWRlcnMuc2V0KHByb3ZpZGVyLl9pZCwge1xuICAgICAgICAgICAgICAgICAgICAgICAgLi4ucHJvdmlkZXIsXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyB3aGVuIGl0J3MgYSBwcm94eSBjb250YWluZXIgbWFrZSBzdXJlIHRoZSBwcm92aWRlciBoYXMgaXQncyByZWZlcmVuY2UgZm9yIHJlc29sdmluZyBpdCBsYXRlcixcbiAgICAgICAgICAgICAgICAgICAgICAgIF9jb250YWluZXI6IGNoaWxkXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY3VycmVudCA9IGN1cnJlbnQucGFyZW50O1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRmlsdGVyIGFuZCBzb3J0IHByb3ZpZGVycyBiYXNlZCBvbiBjcml0ZXJpYSBhbmQgY29uZmxpY3QgcmVzb2x1dGlvbiBzdHJhdGVnaWVzXG4gICAgICAgIGNvbnN0IGJlc3RQcm92aWRlcnNBcnJheSA9IEFycmF5LmZyb20oYmVzdFByb3ZpZGVycy52YWx1ZXMoKSk7XG4gICAgICAgIHJldHVybiBmaWx0ZXJBbmRTb3J0UHJvdmlkZXJzKGJlc3RQcm92aWRlcnNBcnJheSwgY3JpdGVyaWEpO1xuICAgIH1cblxuICAgIHJlc29sdmU8VCwgQXN5bmMgZXh0ZW5kcyBib29sZWFuID0gZmFsc2U+KFxuICAgICAgICBkZXBlbmRlbmN5VG9rZW46IERlcElkZW50aWZpZXI8VD4sXG4gICAgICAgIGNyaXRlcmlhPzoge1xuICAgICAgICAgICAgdGFncz86IHN0cmluZ1tdO1xuICAgICAgICAgICAgdHlwZT86IFByb3ZpZGVyT3B0aW9uc1sgJ3R5cGUnIF0sXG4gICAgICAgICAgICBwcmlvcml0eT86IFByaW9yaXR5Q3JpdGVyaWE7XG4gICAgICAgICAgICBmb3JFbnRpdHk/OiBQcm92aWRlck9wdGlvbnNbICdmb3JFbnRpdHknIF0sXG4gICAgICAgICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzPzogYm9vbGVhblxuICAgICAgICB9LFxuICAgICAgICBwYXRoOiBTZXQ8VG9rZW4+ID0gbmV3IFNldCgpLFxuICAgICAgICBhc3luYzogQXN5bmMgPSBmYWxzZSBhcyBBc3luY1xuICAgICk6IEFzeW5jIGV4dGVuZHMgdHJ1ZSA/IFByb21pc2U8VD4gOiBUIHtcblxuICAgICAgICBjb25zdCB0b2tlbiA9IHRoaXMuY3JlYXRlVG9rZW4oZGVwZW5kZW5jeVRva2VuKTtcbiAgICAgICAgY3JpdGVyaWEgPSBjcml0ZXJpYSA/PyB7fTtcblxuICAgICAgICAvLyBpZiB0b2tlbiBpcyBgRElDb250YWluZXJgIHJldHVybiB0aGUgY3VycmVudCBjb250YWluZXJcbiAgICAgICAgaWYgKERJX1RPS0VOUy5ESV9DT05UQUlORVIgPT09IHRva2VuIHx8IHRoaXMuY3JlYXRlVG9rZW4oRElDb250YWluZXIpID09PSB0b2tlbikge1xuICAgICAgICAgICAgcmV0dXJuIChhc3luYyA/IFByb21pc2UucmVzb2x2ZSh0aGlzKSA6IHRoaXMpIGFzIEFzeW5jIGV4dGVuZHMgdHJ1ZSA/IFByb21pc2U8VD4gOiBUO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgYmVzdFByb3ZpZGVycyA9IHRoaXMuY29sbGVjdEJlc3RQcm92aWRlcnNGb3I8VD4oe1xuICAgICAgICAgICAgLi4uY3JpdGVyaWEsXG4gICAgICAgICAgICB0b2tlbixcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKGJlc3RQcm92aWRlcnMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgTm9Qcm92aWRlckZvdW5kRXJyb3IodG9rZW4sIHRoaXMsIGNyaXRlcmlhKTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBvcHRpb25zID0gYmVzdFByb3ZpZGVyc1sgMCBdO1xuXG4gICAgICAgIHJldHVybiB0aGlzLnJlc29sdmVQcm92aWRlclZhbHVlPFQsIEFzeW5jPihvcHRpb25zLCBwYXRoLCBhc3luYyk7XG4gICAgfVxuXG4gICAgcmVzb2x2ZVByb3ZpZGVyVmFsdWU8VCwgQXN5bmMgZXh0ZW5kcyBib29sZWFuID0gZmFsc2U+KFxuICAgICAgICBvcHRpb25zOiBJbnRlcm5hbFByb3ZpZGVyT3B0aW9uczxUPixcbiAgICAgICAgcGF0aDogU2V0PFRva2VuPiA9IG5ldyBTZXQoKSxcbiAgICAgICAgYXN5bmM6IEFzeW5jID0gZmFsc2UgYXMgQXN5bmNcbiAgICApOiBBc3luYyBleHRlbmRzIHRydWUgPyBQcm9taXNlPFQ+IDogVCB7XG5cbiAgICAgICAgY29uc3QgeyBfaWQsIF9jb250YWluZXIsIF9wcm92aWRlcjogcHJvdmlkZXIgfSA9IG9wdGlvbnM7XG5cbiAgICAgICAgaWYgKF9jb250YWluZXIgIT09IHRoaXMpIHtcbiAgICAgICAgICAgIHJldHVybiAoX2NvbnRhaW5lciBhcyBESUNvbnRhaW5lcikucmVzb2x2ZVByb3ZpZGVyVmFsdWUob3B0aW9ucywgcGF0aCwgYXN5bmMpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHByb3ZpZGVyLnNpbmdsZXRvbiAmJiB0aGlzLmNhY2hlLmhhcyhfaWQpKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5jYWNoZS5nZXQoX2lkKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0aGlzLnJlc29sdmluZy5oYXMoX2lkKSkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMucmVzb2x2aW5nLmdldChfaWQpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHBhdGguaGFzKF9pZCkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBDaXJjdWxhckRlcGVuZGVuY3lFcnJvcihBcnJheS5mcm9tKHBhdGgpLCB0aGlzLmNvbnRhaW5lcklkKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHBhdGguYWRkKF9pZCk7XG5cbiAgICAgICAgaWYgKGFzeW5jKSB7XG4gICAgICAgICAgICByZXR1cm4gYXBwbHlNaWRkbGV3YXJlc0FzeW5jKFxuICAgICAgICAgICAgICAgIHRoaXMuYXN5bmNNaWRkbGV3YXJlcyxcbiAgICAgICAgICAgICAgICAoKSA9PiB0aGlzLmNyZWF0ZUFuZENhY2hlSW5zdGFuY2VBc3luYzxUPihvcHRpb25zLCBwYXRoKVxuICAgICAgICAgICAgKSBhcyBBc3luYyBleHRlbmRzIHRydWUgPyBQcm9taXNlPFQ+IDogVDtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBhcHBseU1pZGRsZXdhcmVzKFxuICAgICAgICAgICAgdGhpcy5taWRkbGV3YXJlcyxcbiAgICAgICAgICAgICgpID0+IHRoaXMuY3JlYXRlQW5kQ2FjaGVJbnN0YW5jZShvcHRpb25zLCBwYXRoKVxuICAgICAgICApIGFzIEFzeW5jIGV4dGVuZHMgdHJ1ZSA/IFByb21pc2U8VD4gOiBUO1xuICAgIH1cblxuICAgIHByaXZhdGUgY3JlYXRlQW5kQ2FjaGVJbnN0YW5jZTxUPihvcHRpb25zOiBJbnRlcm5hbFByb3ZpZGVyT3B0aW9uczxUPiwgcGF0aDogU2V0PFRva2VuPik6IFQge1xuXG4gICAgICAgIGNvbnN0IHsgX2lkLCBfcHJvdmlkZXI6IHByb3ZpZGVyIH0gPSBvcHRpb25zO1xuXG4gICAgICAgIGNvbnN0IGluc3RhbmNlID0gdGhpcy5jcmVhdGVJbnN0YW5jZShvcHRpb25zLCBwYXRoKTtcbiAgICAgICAgaWYgKHByb3ZpZGVyLnNpbmdsZXRvbikge1xuICAgICAgICAgICAgdGhpcy5jYWNoZS5zZXQoX2lkLCBpbnN0YW5jZSk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLnJlc29sdmluZy5kZWxldGUoX2lkKTtcblxuICAgICAgICB0aGlzLmluamVjdFByb3BlcnRpZXMoaW5zdGFuY2UpO1xuICAgICAgICB0aGlzLmluaXRpYWxpemVJbnN0YW5jZShpbnN0YW5jZSk7XG5cbiAgICAgICAgcGF0aC5kZWxldGUoX2lkKTtcblxuICAgICAgICByZXR1cm4gaW5zdGFuY2U7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBjcmVhdGVJbnN0YW5jZTxULCBBc3luYyBleHRlbmRzIGJvb2xlYW4gPSBmYWxzZT4oXG4gICAgICAgIG9wdGlvbnM6IEludGVybmFsUHJvdmlkZXJPcHRpb25zPFQ+LFxuICAgICAgICBwYXRoOiBTZXQ8VG9rZW4+LFxuICAgICAgICBhc3luYzogQXN5bmMgPSBmYWxzZSBhcyBBc3luY1xuICAgICk6IEFzeW5jIGV4dGVuZHMgdHJ1ZSA/IFByb21pc2U8VD4gOiBUIHtcblxuICAgICAgICBjb25zdCB7IF9pZCwgX3Byb3ZpZGVyOiBwcm92aWRlciB9ID0gb3B0aW9ucztcblxuICAgICAgICBpZiAoaXNBbGlhc1Byb3ZpZGVyT3B0aW9ucyhwcm92aWRlcikpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnJlc29sdmUocHJvdmlkZXIudXNlRXhpc3RpbmcsIHt9LCBwYXRoLCBhc3luYyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoaXNDbGFzc1Byb3ZpZGVyT3B0aW9ucyhwcm92aWRlcikpIHtcblxuICAgICAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICAgICAgICBhc3luYyA/IHRoaXMuY3JlYXRlQ2xhc3NJbnN0YW5jZTxULCB0cnVlPihvcHRpb25zLCBwYXRoLCB0cnVlKVxuICAgICAgICAgICAgICAgICAgICA6IHRoaXMuY3JlYXRlQ2xhc3NJbnN0YW5jZShvcHRpb25zLCBwYXRoKVxuICAgICAgICAgICAgKSBhcyBBc3luYyBleHRlbmRzIHRydWUgPyBQcm9taXNlPFQ+IDogVDtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChpc0ZhY3RvcnlQcm92aWRlck9wdGlvbnMocHJvdmlkZXIpKSB7XG5cbiAgICAgICAgICAgIHJldHVybiAoXG4gICAgICAgICAgICAgICAgYXN5bmMgPyB0aGlzLmNyZWF0ZUZhY3RvcnlJbnN0YW5jZUFzeW5jPFQ+KHByb3ZpZGVyLCBwYXRoKVxuICAgICAgICAgICAgICAgICAgICA6IHRoaXMuY3JlYXRlRmFjdG9yeUluc3RhbmNlKHByb3ZpZGVyLCBwYXRoKVxuICAgICAgICAgICAgKSBhcyBBc3luYyBleHRlbmRzIHRydWUgPyBQcm9taXNlPFQ+IDogVDtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChpc1ZhbHVlUHJvdmlkZXJPcHRpb25zKHByb3ZpZGVyKSkge1xuICAgICAgICAgICAgcmV0dXJuIHByb3ZpZGVyLnVzZVZhbHVlIGFzIEFzeW5jIGV4dGVuZHMgdHJ1ZSA/IFByb21pc2U8VD4gOiBUO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGlzQ29uZmlnUHJvdmlkZXJPcHRpb25zKHByb3ZpZGVyKSkge1xuICAgICAgICAgICAgcmV0dXJuIHByb3ZpZGVyLnVzZUNvbmZpZyBhcyBBc3luYyBleHRlbmRzIHRydWUgPyBQcm9taXNlPFQ+IDogVDtcbiAgICAgICAgfVxuXG4gICAgICAgIHRocm93IG5ldyBQcm92aWRlckNvbmZpZ3VyYXRpb25FcnJvcihfaWQsIHRoaXMuY29udGFpbmVySWQpO1xuICAgIH1cblxuICAgIHByaXZhdGUgY3JlYXRlQ2xhc3NJbnN0YW5jZTxULCBBc3luYyBleHRlbmRzIGJvb2xlYW4gPSBmYWxzZT4oXG4gICAgICAgIG9wdGlvbnM6IEludGVybmFsUHJvdmlkZXJPcHRpb25zPFQ+LFxuICAgICAgICBwYXRoOiBTZXQ8VG9rZW4+LFxuICAgICAgICBhc3luYzogQXN5bmMgPSBmYWxzZSBhcyBBc3luY1xuICAgICk6IEFzeW5jIGV4dGVuZHMgdHJ1ZSA/IFByb21pc2U8VD4gOiBUIHtcblxuICAgICAgICBjb25zdCB7IF9pZCwgX3Byb3ZpZGVyOiBwcm92aWRlciB9ID0gb3B0aW9ucztcblxuICAgICAgICBpZiAodGhpcy5yZXNvbHZpbmcuaGFzKF9pZCkpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnJlc29sdmluZy5nZXQoX2lkKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHsgdXNlQ2xhc3MgfSA9IHByb3ZpZGVyIGFzIENsYXNzUHJvdmlkZXJPcHRpb25zPFQ+O1xuXG4gICAgICAgIC8vIENyZWF0ZSBhIHBsYWNlaG9sZGVyIG9iamVjdCBhbmQgc3RvcmUgaXQgaW4gdGhlIHJlc29sdmluZyBtYXBcbiAgICAgICAgY29uc3QgaW5zdGFuY2VQbGFjZWhvbGRlcjogVCA9IE9iamVjdC5jcmVhdGUodXNlQ2xhc3MucHJvdG90eXBlKTtcbiAgICAgICAgdGhpcy5yZXNvbHZpbmcuc2V0KF9pZCwgaW5zdGFuY2VQbGFjZWhvbGRlcik7XG5cblxuICAgICAgICBpZiAoYXN5bmMpIHtcbiAgICAgICAgICAgIHRoaXMucmVzb2x2ZURlcGVuZGVuY2llc0FzeW5jKHVzZUNsYXNzLCBwYXRoKS50aGVuKGRlcGVuZGVuY2llcyA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgYWN0dWFsSW5zdGFuY2UgPSBuZXcgdXNlQ2xhc3MoLi4uZGVwZW5kZW5jaWVzKTtcbiAgICAgICAgICAgICAgICBPYmplY3QuYXNzaWduKGluc3RhbmNlUGxhY2Vob2xkZXIgYXMgYW55LCBhY3R1YWxJbnN0YW5jZSk7XG4gICAgICAgICAgICAgICAgdGhpcy5yZXNvbHZpbmcuc2V0KF9pZCwgYWN0dWFsSW5zdGFuY2UpO1xuICAgICAgICAgICAgICAgIHJldHVybiBhY3R1YWxJbnN0YW5jZTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBkZXBlbmRlbmNpZXMgPSB0aGlzLnJlc29sdmVEZXBlbmRlbmNpZXModXNlQ2xhc3MsIHBhdGgpO1xuICAgICAgICBjb25zdCBhY3R1YWxJbnN0YW5jZSA9IG5ldyB1c2VDbGFzcyguLi5kZXBlbmRlbmNpZXMpO1xuICAgICAgICBPYmplY3QuYXNzaWduKGluc3RhbmNlUGxhY2Vob2xkZXIgYXMgYW55LCBhY3R1YWxJbnN0YW5jZSk7XG4gICAgICAgIHRoaXMucmVzb2x2aW5nLnNldChfaWQsIGFjdHVhbEluc3RhbmNlKTtcblxuICAgICAgICByZXR1cm4gYWN0dWFsSW5zdGFuY2UgYXMgQXN5bmMgZXh0ZW5kcyB0cnVlID8gUHJvbWlzZTxUPiA6IFQ7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBjcmVhdGVGYWN0b3J5SW5zdGFuY2U8VD4ob3B0aW9uczogRmFjdG9yeVByb3ZpZGVyT3B0aW9uczxUPiwgcGF0aDogU2V0PFRva2VuPik6IFQge1xuICAgICAgICBjb25zdCBkZXBlbmRlbmNpZXMgPSAob3B0aW9ucy5kZXBzIHx8IFtdKS5tYXAoZGVwID0+IHRoaXMucmVzb2x2ZURlcGVuZGVuY3koZGVwLCBwYXRoKSk7XG4gICAgICAgIHJldHVybiBvcHRpb25zLnVzZUZhY3RvcnkoLi4uZGVwZW5kZW5jaWVzKTtcbiAgICB9XG5cbiAgICBnZXRDbGFzc0RlcGVuZGVuY2llcyh0YXJnZXQ6IENsYXNzQ29uc3RydWN0b3IpIHtcbiAgICAgICAgY29uc3QgY29uc3RydWN0b3JEZXBlbmRlbmNpZXMgPSBnZXRDb25zdHJ1Y3RvckRlcGVuZGVuY2llc01ldGFkYXRhKHRhcmdldCk7XG4gICAgICAgIGNvbnN0IHByb3BlcnR5RGVwZW5kZW5jaWVzID0gZ2V0UHJvcGVydHlEZXBlbmRlbmNpZXNNZXRhZGF0YSh0YXJnZXQpO1xuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBwcm9wZXJ0eURlcGVuZGVuY2llcyxcbiAgICAgICAgICAgIGNvbnN0cnVjdG9yRGVwZW5kZW5jaWVzXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIHJlc29sdmVEZXBlbmRlbmN5PFQsIEFzeW5jIGV4dGVuZHMgYm9vbGVhbiA9IGZhbHNlPihcbiAgICAgICAgZGVwOiBEZXBJZGVudGlmaWVyIHwgQ29tcGxleERlcGVuZGVuY3lJZGVudGlmaWVyLFxuICAgICAgICBwYXRoOiBTZXQ8VG9rZW4+LFxuICAgICAgICBhc3luYzogQXN5bmMgPSBmYWxzZSBhcyBBc3luY1xuICAgICk6IEFzeW5jIGV4dGVuZHMgdHJ1ZSA/IFByb21pc2U8VD4gOiBUIHtcblxuICAgICAgICBsZXQgbm9ybWFsaXplZERlcCA9IGRlcDtcblxuICAgICAgICBpZiAoIWlzQ29tcGxleERlcGVuZGVuY3lJZGVudGlmaWVyKG5vcm1hbGl6ZWREZXApKSB7XG4gICAgICAgICAgICBub3JtYWxpemVkRGVwID0geyB0b2tlbjogbm9ybWFsaXplZERlcCB9IGFzIENvbXBsZXhEZXBlbmRlbmN5SWRlbnRpZmllcjtcbiAgICAgICAgfVxuXG4gICAgICAgIHRyeSB7XG5cbiAgICAgICAgICAgIGlmIChub3JtYWxpemVkRGVwLmlzQ29uZmlnKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMucmVzb2x2ZUNvbmZpZyhub3JtYWxpemVkRGVwLnRva2VuIGFzIHN0cmluZywgbm9ybWFsaXplZERlcCkgYXMgQXN5bmMgZXh0ZW5kcyB0cnVlID8gUHJvbWlzZTxUPiA6IFQ7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChub3JtYWxpemVkRGVwLmZvckVudGl0eSkge1xuICAgICAgICAgICAgICAgIGlmIChub3JtYWxpemVkRGVwLnR5cGUgPT0gJ3NjaGVtYScpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMucmVzb2x2ZUVudGl0eVNjaGVtYShub3JtYWxpemVkRGVwLmZvckVudGl0eSwgbm9ybWFsaXplZERlcCwgYXN5bmMpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmIChub3JtYWxpemVkRGVwLnR5cGUgPT0gJ3NlcnZpY2UnKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLnJlc29sdmVFbnRpdHlTZXJ2aWNlKG5vcm1hbGl6ZWREZXAuZm9yRW50aXR5LCBub3JtYWxpemVkRGVwLCBhc3luYylcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEludmFsaWREZXBlbmRlbmN5Q3JpdGVyaWFFcnJvcihKU09OLnN0cmluZ2lmeShub3JtYWxpemVkRGVwKSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiB0aGlzLnJlc29sdmU8VCwgQXN5bmM+KG5vcm1hbGl6ZWREZXAudG9rZW4sIG5vcm1hbGl6ZWREZXAsIHBhdGgsIGFzeW5jKVxuXG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcblxuICAgICAgICAgICAgaWYgKFxuICAgICAgICAgICAgICAgIGUgaW5zdGFuY2VvZiBOb1Byb3ZpZGVyRm91bmRFcnJvclxuICAgICAgICAgICAgICAgICYmXG4gICAgICAgICAgICAgICAgKG5vcm1hbGl6ZWREZXAuaXNPcHRpb25hbCB8fCBub3JtYWxpemVkRGVwLmRlZmF1bHRWYWx1ZSAhPT0gdW5kZWZpbmVkKVxuICAgICAgICAgICAgKSB7XG4gICAgICAgICAgICAgICAgLy8gdGhpcy5sb2dnZXIuaW5mbyhgTm8gcHJvdmlkZXIgZm91bmQgZm9yICR7SlNPTi5zdHJpbmdpZnkoZGVwKX1gLCB7IHBhdGggfSlcbiAgICAgICAgICAgICAgICByZXR1cm4gbm9ybWFsaXplZERlcC5kZWZhdWx0VmFsdWUgPz8gdW5kZWZpbmVkO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB0aHJvdyBlO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSByZXNvbHZlRGVwZW5kZW5jaWVzPFQgZXh0ZW5kcyBDbGFzc0NvbnN0cnVjdG9yPih0YXJnZXQ6IFQsIHBhdGg6IFNldDxUb2tlbj4pOiBhbnlbXSB7XG5cbiAgICAgICAgY29uc3QgaW5qZWN0TWV0YWRhdGEgPSBnZXRDb25zdHJ1Y3RvckRlcGVuZGVuY2llc01ldGFkYXRhKHRhcmdldCk7XG5cbiAgICAgICAgcmV0dXJuIGluamVjdE1ldGFkYXRhLm1hcChkZXAgPT4gdGhpcy5yZXNvbHZlRGVwZW5kZW5jeShkZXAsIHBhdGgpKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGluaXRpYWxpemVJbnN0YW5jZTxUPihpbnN0YW5jZTogVCk6IHZvaWQge1xuICAgICAgICBpZiAoIWhhc0NvbnN0cnVjdG9yKGluc3RhbmNlKSkgcmV0dXJuO1xuXG4gICAgICAgIGNvbnN0IGluaXRNZXRob2QgPSBnZXRPbkluaXRIb29rTWV0YWRhdGEoaW5zdGFuY2UuY29uc3RydWN0b3IgYXMgQ2xhc3NDb25zdHJ1Y3Rvcik7XG5cbiAgICAgICAgaWYgKGluaXRNZXRob2QpIHtcbiAgICAgICAgICAgIGNvbnN0IHRoZUluaXRNZXRob2QgPSBpbnN0YW5jZVsgaW5pdE1ldGhvZCBhcyBrZXlvZiB0eXBlb2YgaW5zdGFuY2UgXSBhcyBGdW5jdGlvbjtcbiAgICAgICAgICAgIGlmICh0eXBlb2YgdGhlSW5pdE1ldGhvZCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIHRoZUluaXRNZXRob2QuY2FsbChpbnN0YW5jZSk7ICAvLyBCaW5kICd0aGlzJyBjb250ZXh0IHRvIHRoZSBpbnN0YW5jZVxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEluaXRpYWxpemF0aW9uTWV0aG9kRXJyb3IoaW5zdGFuY2UuY29uc3RydWN0b3IubmFtZSwgZXJyb3IubWVzc2FnZSwgdGhpcy5jb250YWluZXJJZCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSW5pdGlhbGl6YXRpb25NZXRob2RUeXBlRXJyb3IoU3RyaW5nKGluaXRNZXRob2QpLCBpbnN0YW5jZS5jb25zdHJ1Y3Rvci5uYW1lLCB0aGlzLmNvbnRhaW5lcklkKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgaW5qZWN0UHJvcGVydGllczxUPihpbnN0YW5jZTogVCk6IHZvaWQge1xuICAgICAgICBpZiAoIWhhc0NvbnN0cnVjdG9yKGluc3RhbmNlKSkgcmV0dXJuO1xuXG4gICAgICAgIGNvbnN0IGRlcGVuZGVuY2llcyA9IGdldFByb3BlcnR5RGVwZW5kZW5jaWVzTWV0YWRhdGEoaW5zdGFuY2UuY29uc3RydWN0b3IgYXMgQ2xhc3NDb25zdHJ1Y3Rvcik7XG5cbiAgICAgICAgZm9yIChjb25zdCBkZXAgb2YgZGVwZW5kZW5jaWVzKSB7XG4gICAgICAgICAgICBjb25zdCBwcm9wZXJ0eVZhbHVlID0gdGhpcy5yZXNvbHZlRGVwZW5kZW5jeShkZXAsIG5ldyBTZXQoKSlcblxuICAgICAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KGluc3RhbmNlLCBkZXAucHJvcGVydHlLZXksIHtcbiAgICAgICAgICAgICAgICB2YWx1ZTogcHJvcGVydHlWYWx1ZSxcbiAgICAgICAgICAgICAgICBlbnVtZXJhYmxlOiB0cnVlLFxuICAgICAgICAgICAgICAgIGNvbmZpZ3VyYWJsZTogdHJ1ZVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBoYXMoXG4gICAgICAgIGRlcGVuZGVuY3lUb2tlbjogRGVwSWRlbnRpZmllcixcbiAgICAgICAgY3JpdGVyaWE/OiB7XG4gICAgICAgICAgICB0YWdzPzogc3RyaW5nW107XG4gICAgICAgICAgICB0eXBlPzogUHJvdmlkZXJPcHRpb25zWyAndHlwZScgXSxcbiAgICAgICAgICAgIHByaW9yaXR5PzogUHJpb3JpdHlDcml0ZXJpYTtcbiAgICAgICAgICAgIGZvckVudGl0eT86IFByb3ZpZGVyT3B0aW9uc1sgJ2ZvckVudGl0eScgXSxcbiAgICAgICAgICAgIGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnM/OiBib29sZWFuXG4gICAgICAgIH1cbiAgICApOiBib29sZWFuIHtcblxuICAgICAgICBjb25zdCB0b2tlbiA9IHRoaXMuY3JlYXRlVG9rZW4oZGVwZW5kZW5jeVRva2VuKTtcblxuICAgICAgICBjb25zdCBiZXN0UHJvdmlkZXJzID0gdGhpcy5jb2xsZWN0QmVzdFByb3ZpZGVyc0Zvcjxhbnk+KHtcbiAgICAgICAgICAgIC4uLmNyaXRlcmlhLFxuICAgICAgICAgICAgdG9rZW4sXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiBiZXN0UHJvdmlkZXJzLmxlbmd0aCA+IDA7XG4gICAgfVxuXG4gICAgaGFzRW50aXR5U2VydmljZShcbiAgICAgICAgZW50aXR5TmFtZTogRGVwSWRlbnRpZmllcixcbiAgICAgICAgY3JpdGVyaWE/OiB7XG4gICAgICAgICAgICB0YWdzPzogc3RyaW5nW107XG4gICAgICAgICAgICBwcmlvcml0eT86IFByaW9yaXR5Q3JpdGVyaWE7XG4gICAgICAgICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzPzogYm9vbGVhblxuICAgICAgICB9XG4gICAgKTogYm9vbGVhbiB7XG5cbiAgICAgICAgY29uc3QgeyB0YWdzLCBwcmlvcml0eSwgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVycyB9ID0gY3JpdGVyaWEgPz8ge307XG4gICAgICAgIGNvbnN0IGJlc3RQcm92aWRlcnMgPSB0aGlzLmNvbGxlY3RCZXN0UHJvdmlkZXJzRm9yPGFueT4oe1xuICAgICAgICAgICAgdGFncyxcbiAgICAgICAgICAgIHR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgICAgICAgIHByaW9yaXR5LFxuICAgICAgICAgICAgZm9yRW50aXR5OiBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVycyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIGJlc3RQcm92aWRlcnMubGVuZ3RoID4gMDtcbiAgICB9XG5cbiAgICByZXNvbHZlRW50aXR5U2VydmljZTxULCBBc3luYyBleHRlbmRzIGJvb2xlYW4gPSBmYWxzZT4oXG4gICAgICAgIGVudGl0eU5hbWU6IERlcElkZW50aWZpZXIsXG4gICAgICAgIGNyaXRlcmlhPzoge1xuICAgICAgICAgICAgdGFncz86IHN0cmluZ1tdO1xuICAgICAgICAgICAgcHJpb3JpdHk/OiBQcmlvcml0eUNyaXRlcmlhO1xuICAgICAgICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVycz86IGJvb2xlYW5cbiAgICAgICAgfSxcbiAgICAgICAgYXN5bmM6IEFzeW5jID0gZmFsc2UgYXMgQXN5bmNcbiAgICApOiBBc3luYyBleHRlbmRzIHRydWUgPyBQcm9taXNlPFQ+IDogVCB7XG5cbiAgICAgICAgY29uc3QgeyB0YWdzLCBwcmlvcml0eSwgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVycyB9ID0gY3JpdGVyaWEgPz8ge307XG4gICAgICAgIGNvbnN0IGJlc3RQcm92aWRlcnMgPSB0aGlzLmNvbGxlY3RCZXN0UHJvdmlkZXJzRm9yPGFueT4oe1xuICAgICAgICAgICAgdGFncyxcbiAgICAgICAgICAgIHR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgICAgICAgIHByaW9yaXR5LFxuICAgICAgICAgICAgZm9yRW50aXR5OiBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVycyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKGJlc3RQcm92aWRlcnMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgTm9FbnRpdHlTZXJ2aWNlUHJvdmlkZXJFcnJvcihTdHJpbmcoZW50aXR5TmFtZSksIHRoaXMuY29udGFpbmVySWQpO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IG9wdGlvbnMgPSBiZXN0UHJvdmlkZXJzWyAwIF07XG5cbiAgICAgICAgcmV0dXJuIHRoaXMucmVzb2x2ZVByb3ZpZGVyVmFsdWU8VCwgQXN5bmM+KG9wdGlvbnMsIG5ldyBTZXQoKSwgYXN5bmMpO1xuICAgIH1cblxuICAgIGhhc0VudGl0eVNjaGVtYShcbiAgICAgICAgZW50aXR5TmFtZTogRGVwSWRlbnRpZmllcixcbiAgICAgICAgY3JpdGVyaWE/OiB7XG4gICAgICAgICAgICB0YWdzPzogc3RyaW5nW107XG4gICAgICAgICAgICBwcmlvcml0eT86IFByaW9yaXR5Q3JpdGVyaWE7XG4gICAgICAgICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzPzogYm9vbGVhblxuICAgICAgICB9XG4gICAgKTogYm9vbGVhbiB7XG5cbiAgICAgICAgY29uc3QgeyB0YWdzLCBwcmlvcml0eSwgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVycyB9ID0gY3JpdGVyaWEgPz8ge307XG4gICAgICAgIGNvbnN0IGJlc3RQcm92aWRlcnMgPSB0aGlzLmNvbGxlY3RCZXN0UHJvdmlkZXJzRm9yPGFueT4oe1xuICAgICAgICAgICAgdGFncyxcbiAgICAgICAgICAgIHR5cGU6ICdzY2hlbWEnLFxuICAgICAgICAgICAgcHJpb3JpdHksXG4gICAgICAgICAgICBmb3JFbnRpdHk6IGVudGl0eU5hbWUsXG4gICAgICAgICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzLFxuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gYmVzdFByb3ZpZGVycy5sZW5ndGggPiAwO1xuICAgIH1cblxuICAgIHJlc29sdmVFbnRpdHlTY2hlbWE8VCwgQXN5bmMgZXh0ZW5kcyBib29sZWFuID0gZmFsc2U+KFxuICAgICAgICBlbnRpdHlOYW1lOiBEZXBJZGVudGlmaWVyLFxuICAgICAgICBjcml0ZXJpYT86IHtcbiAgICAgICAgICAgIHRhZ3M/OiBzdHJpbmdbXTtcbiAgICAgICAgICAgIHByaW9yaXR5PzogUHJpb3JpdHlDcml0ZXJpYTtcbiAgICAgICAgICAgIGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnM/OiBib29sZWFuXG4gICAgICAgIH0sXG4gICAgICAgIGFzeW5jOiBBc3luYyA9IGZhbHNlIGFzIEFzeW5jXG4gICAgKTogQXN5bmMgZXh0ZW5kcyB0cnVlID8gUHJvbWlzZTxUPiA6IFQge1xuXG4gICAgICAgIGNvbnN0IHsgdGFncywgcHJpb3JpdHksIGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnMgfSA9IGNyaXRlcmlhID8/IHt9O1xuICAgICAgICBjb25zdCBiZXN0UHJvdmlkZXJzID0gdGhpcy5jb2xsZWN0QmVzdFByb3ZpZGVyc0Zvcjxhbnk+KHtcbiAgICAgICAgICAgIHRhZ3MsXG4gICAgICAgICAgICB0eXBlOiAnc2NoZW1hJyxcbiAgICAgICAgICAgIHByaW9yaXR5LFxuICAgICAgICAgICAgZm9yRW50aXR5OiBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVycyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKGJlc3RQcm92aWRlcnMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgTm9FbnRpdHlTY2hlbWFQcm92aWRlckVycm9yKFN0cmluZyhlbnRpdHlOYW1lKSwgdGhpcy5jb250YWluZXJJZCk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3Qgb3B0aW9ucyA9IGJlc3RQcm92aWRlcnNbIDAgXTtcblxuICAgICAgICByZXR1cm4gdGhpcy5yZXNvbHZlUHJvdmlkZXJWYWx1ZTxULCBBc3luYz4ob3B0aW9ucywgbmV3IFNldCgpLCBhc3luYyk7XG4gICAgfVxuXG4gICAgY2xlYXIoY2xlYXJDaGlsZENvbnRhaW5lcnMgPSB0cnVlKSB7XG4gICAgICAgIHRoaXMucHJvdmlkZXJzLmNsZWFyKCk7XG4gICAgICAgIHRoaXMuY2FjaGUuY2xlYXIoKTtcbiAgICAgICAgdGhpcy5yZXNvbHZpbmcuY2xlYXIoKTtcbiAgICAgICAgaWYgKGNsZWFyQ2hpbGRDb250YWluZXJzKSB7XG4gICAgICAgICAgICB0aGlzLmNoaWxkQ29udGFpbmVycy5mb3JFYWNoKGNvbnRhaW5lciA9PiBjb250YWluZXIuY2xlYXIoKSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICB1c2VNaWRkbGV3YXJlKHsgbWlkZGxld2FyZSwgb3JkZXIgPSAxIH06IFBhcnRpYWxCeTxESU1pZGRsZXdhcmU8YW55PiwgJ29yZGVyJz4pIHtcbiAgICAgICAgdGhpcy5taWRkbGV3YXJlcy5wdXNoKHsgbWlkZGxld2FyZSwgb3JkZXIgfSk7XG4gICAgICAgIHRoaXMubWlkZGxld2FyZXMuc29ydCgoYSwgYikgPT4gKGEub3JkZXIgPz8gMCkgLSAoYi5vcmRlciA/PyAwKSk7XG4gICAgfVxuXG4gICAgYXN5bmMgcmVzb2x2ZUFzeW5jPFQ+KFxuICAgICAgICBkZXBlbmRlbmN5VG9rZW46IERlcElkZW50aWZpZXI8VD4sXG4gICAgICAgIGNyaXRlcmlhPzoge1xuICAgICAgICAgICAgdGFncz86IHN0cmluZ1tdO1xuICAgICAgICAgICAgdHlwZT86IFByb3ZpZGVyT3B0aW9uc1sgJ3R5cGUnIF0sXG4gICAgICAgICAgICBwcmlvcml0eT86IFByaW9yaXR5Q3JpdGVyaWE7XG4gICAgICAgICAgICBmb3JFbnRpdHk/OiBQcm92aWRlck9wdGlvbnNbICdmb3JFbnRpdHknIF0sXG4gICAgICAgICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzPzogYm9vbGVhblxuICAgICAgICB9LFxuICAgICAgICBwYXRoPzogU2V0PFRva2VuPlxuICAgICkge1xuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5yZXNvbHZlPFQsIHRydWU+KGRlcGVuZGVuY3lUb2tlbiwgY3JpdGVyaWEsIHBhdGgsIHRydWUpO1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgY3JlYXRlQW5kQ2FjaGVJbnN0YW5jZUFzeW5jPFQ+KG9wdGlvbnM6IEludGVybmFsUHJvdmlkZXJPcHRpb25zPFQ+LCBwYXRoOiBTZXQ8VG9rZW4+KTogUHJvbWlzZTxUPiB7XG4gICAgICAgIGNvbnN0IHsgX2lkLCBfcHJvdmlkZXI6IHByb3ZpZGVyIH0gPSBvcHRpb25zO1xuXG4gICAgICAgIGNvbnN0IGluc3RhbmNlID0gYXdhaXQgdGhpcy5jcmVhdGVJbnN0YW5jZShvcHRpb25zLCBwYXRoLCB0cnVlKTtcbiAgICAgICAgaWYgKHByb3ZpZGVyLnNpbmdsZXRvbikge1xuICAgICAgICAgICAgdGhpcy5jYWNoZS5zZXQoX2lkLCBpbnN0YW5jZSk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLnJlc29sdmluZy5kZWxldGUoX2lkKTtcblxuICAgICAgICBhd2FpdCB0aGlzLmluamVjdFByb3BlcnRpZXNBc3luYyhpbnN0YW5jZSk7XG4gICAgICAgIGF3YWl0IHRoaXMuaW5pdGlhbGl6ZUluc3RhbmNlQXN5bmMoaW5zdGFuY2UpO1xuXG4gICAgICAgIHBhdGguZGVsZXRlKF9pZCk7XG5cbiAgICAgICAgcmV0dXJuIGluc3RhbmNlO1xuICAgIH1cblxuICAgIHVzZU1pZGRsZXdhcmVBc3luYyh7IG1pZGRsZXdhcmUsIG9yZGVyID0gMSB9OiBQYXJ0aWFsQnk8RElNaWRkbGV3YXJlQXN5bmM8YW55PiwgJ29yZGVyJz4pIHtcbiAgICAgICAgdGhpcy5hc3luY01pZGRsZXdhcmVzLnB1c2goeyBtaWRkbGV3YXJlLCBvcmRlciB9KTtcbiAgICAgICAgdGhpcy5hc3luY01pZGRsZXdhcmVzLnNvcnQoKGEsIGIpID0+IChhLm9yZGVyID8/IDApIC0gKGIub3JkZXIgPz8gMCkpO1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgcmVzb2x2ZURlcGVuZGVuY2llc0FzeW5jPFQgZXh0ZW5kcyBDbGFzc0NvbnN0cnVjdG9yPih0YXJnZXQ6IFQsIHBhdGg6IFNldDxUb2tlbj4pOiBQcm9taXNlPGFueVtdPiB7XG5cbiAgICAgICAgY29uc3QgaW5qZWN0TWV0YWRhdGEgPSBnZXRDb25zdHJ1Y3RvckRlcGVuZGVuY2llc01ldGFkYXRhKHRhcmdldCk7XG5cbiAgICAgICAgcmV0dXJuIGF3YWl0IFByb21pc2UuYWxsKGluamVjdE1ldGFkYXRhLm1hcChhc3luYyBkZXAgPT4gYXdhaXQgdGhpcy5yZXNvbHZlRGVwZW5kZW5jeShkZXAsIHBhdGgsIHRydWUpKSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBpbml0aWFsaXplSW5zdGFuY2VBc3luYzxUPihpbnN0YW5jZTogVCk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBpZiAoIWhhc0NvbnN0cnVjdG9yKGluc3RhbmNlKSkgcmV0dXJuO1xuXG4gICAgICAgIGNvbnN0IGluaXRNZXRob2QgPSBnZXRPbkluaXRIb29rTWV0YWRhdGEoaW5zdGFuY2UuY29uc3RydWN0b3IgYXMgQ2xhc3NDb25zdHJ1Y3Rvcik7XG5cbiAgICAgICAgaWYgKGluaXRNZXRob2QpIHtcbiAgICAgICAgICAgIGNvbnN0IHRoZUluaXRNZXRob2QgPSBpbnN0YW5jZVsgaW5pdE1ldGhvZCBhcyBrZXlvZiB0eXBlb2YgaW5zdGFuY2UgXSBhcyBGdW5jdGlvbjtcbiAgICAgICAgICAgIGlmICh0eXBlb2YgdGhlSW5pdE1ldGhvZCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IHRoZUluaXRNZXRob2QuY2FsbChpbnN0YW5jZSk7ICAvLyBCaW5kICd0aGlzJyBjb250ZXh0IHRvIHRoZSBpbnN0YW5jZVxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEluaXRpYWxpemF0aW9uTWV0aG9kRXJyb3IoaW5zdGFuY2UuY29uc3RydWN0b3IubmFtZSwgZXJyb3IubWVzc2FnZSwgdGhpcy5jb250YWluZXJJZCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSW5pdGlhbGl6YXRpb25NZXRob2RUeXBlRXJyb3IoU3RyaW5nKGluaXRNZXRob2QpLCBpbnN0YW5jZS5jb25zdHJ1Y3Rvci5uYW1lLCB0aGlzLmNvbnRhaW5lcklkKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgY3JlYXRlRmFjdG9yeUluc3RhbmNlQXN5bmM8VD4ob3B0aW9uczogRmFjdG9yeVByb3ZpZGVyT3B0aW9uczxUPiwgcGF0aDogU2V0PFRva2VuPik6IFByb21pc2U8VD4ge1xuICAgICAgICBjb25zdCBkZXBlbmRlbmNpZXMgPSBhd2FpdCBQcm9taXNlLmFsbCgob3B0aW9ucy5kZXBzIHx8IFtdKS5tYXAoYXN5bmMgKGRlcCkgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMucmVzb2x2ZURlcGVuZGVuY3koZGVwLCBwYXRoLCB0cnVlKTtcbiAgICAgICAgfSkpO1xuICAgICAgICByZXR1cm4gb3B0aW9ucy51c2VGYWN0b3J5KC4uLmRlcGVuZGVuY2llcyk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBpbmplY3RQcm9wZXJ0aWVzQXN5bmM8VD4oaW5zdGFuY2U6IFQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgaWYgKCFoYXNDb25zdHJ1Y3RvcihpbnN0YW5jZSkpIHJldHVybjtcblxuICAgICAgICBjb25zdCBkZXBlbmRlbmNpZXMgPSBnZXRQcm9wZXJ0eURlcGVuZGVuY2llc01ldGFkYXRhKGluc3RhbmNlLmNvbnN0cnVjdG9yIGFzIENsYXNzQ29uc3RydWN0b3IpO1xuXG4gICAgICAgIGZvciAoY29uc3QgZGVwIG9mIGRlcGVuZGVuY2llcykge1xuICAgICAgICAgICAgY29uc3QgcHJvcGVydHlWYWx1ZSA9IGF3YWl0IHRoaXMucmVzb2x2ZURlcGVuZGVuY3koZGVwLCBuZXcgU2V0KCksIHRydWUpXG5cbiAgICAgICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShpbnN0YW5jZSwgZGVwLnByb3BlcnR5S2V5LCB7XG4gICAgICAgICAgICAgICAgdmFsdWU6IHByb3BlcnR5VmFsdWUsXG4gICAgICAgICAgICAgICAgZW51bWVyYWJsZTogdHJ1ZSxcbiAgICAgICAgICAgICAgICBjb25maWd1cmFibGU6IHRydWVcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgbG9nQ2hpbGRDb250YWluZXJzKCkge1xuICAgICAgICBmb3IgKGNvbnN0IGNvbnRhaW5lciBvZiB0aGlzLmNoaWxkQ29udGFpbmVycykge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENoaWxkIENvbnRhaW5lcjogJHtjb250YWluZXIuY29udGFpbmVySWR9YCk7XG4gICAgICAgICAgICBjb250YWluZXIubG9nQ2hpbGRDb250YWluZXJzKCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBsb2dQcm92aWRlcnMoYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVycyA9IHRydWUpIHtcbiAgICAgICAgY29uc3QgaW50ZXJuYWxQcm92aWRlcnMgPSB0aGlzLmNvbGxlY3RCZXN0UHJvdmlkZXJzRm9yPGFueT4oe1xuICAgICAgICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVycyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFBhcmVudCBDb250YWluZXIgSWQsIFtQYXJlbnQ6ICR7dGhpcy5wYXJlbnQ/LmNvbnRhaW5lcklkfV1gKTtcblxuICAgICAgICBmb3IgKGNvbnN0IGlwIG9mIGludGVybmFsUHJvdmlkZXJzKSB7XG4gICAgICAgICAgICBsZXQgZmlsdGVyZWQgPSB7XG4gICAgICAgICAgICAgICAgLi4uaXAsXG4gICAgICAgICAgICAgICAgX2NvbnRhaW5lcjogaXAuX2NvbnRhaW5lci5jb250YWluZXJJZCxcbiAgICAgICAgICAgICAgICBfcHJvdmlkZXI6IHtcbiAgICAgICAgICAgICAgICAgICAgLi4uaXAuX3Byb3ZpZGVyLFxuICAgICAgICAgICAgICAgICAgICB1c2VDbGFzczogKGlwLl9wcm92aWRlciBhcyBhbnkpPy51c2VDbGFzcz8ubmFtZSxcbiAgICAgICAgICAgICAgICAgICAgcHJvdmlkZTogKGlwLl9wcm92aWRlci5wcm92aWRlIGFzIGFueSkubmFtZSA/IChpcC5fcHJvdmlkZXIucHJvdmlkZSBhcyBhbnkpLm5hbWUgOiBpcC5fcHJvdmlkZXIucHJvdmlkZVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgUHJvdmlkZXI6IFske2lwLl9jb250YWluZXIuY29udGFpbmVySWR9XSAtICR7aXAuX3Byb3ZpZGVyLl90b2tlbn06YCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBsb2dDYWNoZSgpIHtcbiAgICAgICAgZm9yIChjb25zdCBbIHRva2VuLCBpbnN0YW5jZSBdIG9mIHRoaXMuY2FjaGUuZW50cmllcygpKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQ2FjaGU6IFske3RoaXMuY29udGFpbmVySWR9XSAtICR7dG9rZW59OmAsIGluc3RhbmNlKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLnBhcmVudD8ubG9nQ2FjaGUoKTtcbiAgICB9XG5cbiAgICBwdWJsaWMgc2V0U2VhcmNoRW5naW5lKGVuZ2luZTogQmFzZVNlYXJjaEVuZ2luZSkge1xuICAgICAgICB0aGlzLnNlYXJjaEVuZ2luZSA9IGVuZ2luZTtcbiAgICB9XG5cbiAgICBwdWJsaWMgcmVzb2x2ZVNlYXJjaEVuZ2luZSgpOiBCYXNlU2VhcmNoRW5naW5lIHtcbiAgICAgICAgaWYgKCF0aGlzLnNlYXJjaEVuZ2luZSkge1xuXG4gICAgICAgICAgICBpZiAodGhpcy5wYXJlbnQpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5wYXJlbnQucmVzb2x2ZVNlYXJjaEVuZ2luZSgpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1NlYXJjaCBlbmdpbmUgbm90IGNvbmZpZ3VyZWQuIFBsZWFzZSBjYWxsIHNldFNlYXJjaEVuZ2luZSgpIGZpcnN0LicpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuc2VhcmNoRW5naW5lO1xuICAgIH1cbn1cbiJdfQ==