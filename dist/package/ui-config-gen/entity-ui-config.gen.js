"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EntityUIConfigGen = void 0;
const create_entity_1 = __importDefault(require("./templates/create-entity"));
const update_entity_1 = __importDefault(require("./templates/update-entity"));
const list_entity_1 = __importDefault(require("./templates/list-entity"));
const view_entity_1 = __importDefault(require("./templates/view-entity"));
const entity_menu_1 = __importDefault(require("./templates/entity-menu"));
const entity_1 = require("../entity");
const custom_page_1 = require("./templates/custom-page");
const auth_1 = __importDefault(require("./templates/auth"));
const dashboard_1 = __importDefault(require("./templates/dashboard"));
const fs_1 = require("fs");
const zlib_1 = require("zlib");
const path_1 = require("path");
const fw24_1 = require("../core/fw24");
const helper_1 = require("../core/helper");
const logging_1 = require("../logging");
const cases_1 = require("../utils/cases");
class EntityUIConfigGen {
    logger = (0, logging_1.createLogger)(EntityUIConfigGen.name);
    // make sure to create a child container to not pollute anything in the Application container 
    // while scanning and loading stuff
    uiGenDIContainer = fw24_1.Fw24.getInstance().getAppDIContainer();
    customPages = new Map();
    async scanCustomPages() {
        const fw24 = fw24_1.Fw24.getInstance();
        const config = fw24.getConfig();
        const customPagesDir = config.uiConfigGenOptions?.customPagesDirectory || 'custom-pages';
        const customPagesDirectories = [(0, path_1.resolve)(`./src/${customPagesDir}/`)];
        if (fw24.hasModules()) {
            for (const [, module] of fw24.getModules()) {
                const moduleCustomPagesPath = (0, path_1.join)(module.getBasePath(), customPagesDir);
                customPagesDirectories.push((0, path_1.resolve)(moduleCustomPagesPath));
            }
        }
        const registeredPages = [];
        for (const dir of customPagesDirectories) {
            if (!(0, fs_1.existsSync)(dir)) {
                this.logger.debug(`Custom pages directory does not exist: ${dir}`);
                continue;
            }
            const customPageFiles = helper_1.Helper.scanControllerSourceFilesFrom(dir);
            for (const file of customPageFiles) {
                try {
                    const module = await Promise.resolve(`${(0, path_1.join)(dir, file)}`).then(s => __importStar(require(s)));
                    for (const [_, value] of Object.entries(module)) {
                        if (this.isValidCustomPageConfig(value)) {
                            const pageName = this.getPageNameFromConfig(value);
                            if (pageName) {
                                this.registerCustomPage(value);
                                registeredPages.push(pageName);
                                this.logger.debug(`Registered custom page: ${pageName}`);
                            }
                        }
                    }
                }
                catch (e) {
                    this.logger.error(`Error loading custom page from ${file}:`, e);
                }
            }
        }
        if (registeredPages.length > 0) {
            this.logger.info(`✅ Registered ${registeredPages.length} custom page(s): ${registeredPages.slice(0, 5).join(', ')}${registeredPages.length > 5 ? `, +${registeredPages.length - 5} more` : ''}`);
        }
    }
    isValidCustomPageConfig(value) {
        if (!value || typeof value !== 'object')
            return false;
        const config = value;
        if (!('pageType' in config) || !('pageTitle' in config))
            return false;
        const pageType = config.pageType;
        if (pageType === 'list') {
            return 'listPageConfig' in config;
        }
        else if (pageType === 'form') {
            return 'formPageConfig' in config;
        }
        else if (pageType === 'details') {
            return 'detailsPageConfig' in config;
        }
        else if (pageType === 'dashboard') {
            return 'dashboardPageConfig' in config;
        }
        else if (pageType === 'accordion') {
            return 'accordionPageConfig' in config;
        }
        else if (pageType === 'menu') {
            return 'menuPageConfig' in config;
        }
        return false;
    }
    getPageNameFromConfig(config) {
        if (config.pageName) {
            return (0, cases_1.toSlug)(config.pageName);
        }
        // For template-based page titles (objects), pageName MUST be provided
        // Extract string from pageTitle (handles both string and Template types)
        const pageTitleString = typeof config.pageTitle === 'string'
            ? config.pageTitle
            : 'custom-page'; // Fallback for Template objects
        switch (config.pageType) {
            case 'list':
                return `list-${(0, cases_1.toSlug)(pageTitleString)}`;
            case 'form':
                return pageTitleString.toLowerCase().includes('add')
                    ? `create-${(0, cases_1.toSlug)(pageTitleString)}`
                    : `edit-${(0, cases_1.toSlug)(pageTitleString)}`;
            case 'details':
                return `view-${(0, cases_1.toSlug)(pageTitleString)}`;
            case 'dashboard':
                return `${(0, cases_1.toSlug)(pageTitleString)}`;
            case 'accordion':
                return `accordion-${(0, cases_1.toSlug)(pageTitleString)}`;
            case 'menu':
                return `${(0, cases_1.toSlug)(pageTitleString)}`;
            default:
                return null;
        }
    }
    /**
     * Register a custom page. Supports optional routePattern for dynamic routes (e.g., /author/:authorId/books)
     */
    registerCustomPage(options) {
        const pageName = this.getPageNameFromConfig(options);
        if (pageName) {
            this.customPages.set(pageName, options);
        }
    }
    async run() {
        this.process();
    }
    async process() {
        const menuConfigs = [];
        const entityConfigs = {};
        const serviceDirectories = this.prepareServicesDirectories();
        const services = await this.scanAndLoadServices(serviceDirectories);
        // Scan and load custom pages
        await this.scanCustomPages();
        this.logger.debug(`Ui-config-gen::: Process::: all-services: `, Array.from(services.keys()));
        // Get global UI config options (including duplicatedFieldDetection)
        const fw24Config = fw24_1.Fw24.getInstance().getConfig();
        const globalUIConfigOptions = fw24Config.uiConfigGenOptions;
        const hasObservability = !!fw24Config.observability;
        let menuIndex = 1;
        // generate UI configs
        services.forEach((service, entityName) => {
            let entitySchema = service.getEntitySchema();
            // Check for deprecated usage and warn
            this.checkDeprecatedUsage(entitySchema);
            // Transform legacy config structure to new nested structure if needed
            entitySchema = this.transformLegacyConfig(entitySchema);
            const entityDefaultOpsSchema = service.getOpsDefaultIOSchema();
            // Resolve autoGroupActions: entity-level override > global config > default (true)
            const autoGroupActions = entitySchema.model.autoGroupActions
                ?? globalUIConfigOptions?.autoGroupActions
                ?? true;
            if (!entitySchema.model.excludeFromAdminCreate) {
                const createConfig = (0, create_entity_1.default)({
                    entityName,
                    entityNamePlural: entitySchema.model.entityNamePlural,
                    CRUDApiPath: entitySchema.model.CRUDApiPath,
                    properties: entityDefaultOpsSchema.create.input,
                    // Use new nested config if available, fallback to old
                    breadcrumbs: entitySchema.model.createPageConfig?.breadcrumbs || entitySchema.model.createPageBreadcrumbs,
                    columnsConfig: entitySchema.model.createPageConfig?.columnsConfig || entitySchema.model.createPageColumnsConfig,
                    formConfig: entitySchema.model.createPageConfig?.formConfig,
                    sectionsConfig: entitySchema.model.createPageConfig?.sectionsConfig,
                    loading: entitySchema.model.createPageConfig?.loading,
                    pageTitle: entitySchema.model.createPageConfig?.pageTitle,
                    successMessage: entitySchema.model.createPageConfig?.successMessage,
                    errorHandling: entitySchema.model.createPageConfig?.errorHandling,
                    retry: entitySchema.model.createPageConfig?.retry,
                    displayOverrides: entitySchema.model.createPageConfig?.displayOverrides ?? entitySchema.model.displayOverrides,
                    globalUIConfigOptions,
                    autoGroupActions,
                }, service);
                entityConfigs[`create-${entityName.toLowerCase()}`] = createConfig;
            }
            if (!entitySchema.model.excludeFromAdminUpdate) {
                const updateConfig = (0, update_entity_1.default)({
                    entityName,
                    entityNamePlural: entitySchema.model.entityNamePlural,
                    CRUDApiPath: entitySchema.model.CRUDApiPath,
                    properties: entityDefaultOpsSchema.update.input,
                    excludeFromAdminDelete: entitySchema.model.excludeFromAdminDelete,
                    excludeFromAdminCreate: entitySchema.model.excludeFromAdminCreate,
                    excludeFromAdminDuplicate: entitySchema.model.excludeFromAdminDuplicate,
                    // Use new nested config if available, fallback to old
                    actions: entitySchema.model.editPageConfig?.actions || entitySchema.model.editPageActions,
                    breadcrumbs: entitySchema.model.editPageConfig?.breadcrumbs || entitySchema.model.editPageBreadcrumbs,
                    columnsConfig: entitySchema.model.editPageConfig?.columnsConfig || entitySchema.model.editPageColumnsConfig,
                    formConfig: entitySchema.model.editPageConfig?.formConfig,
                    sectionsConfig: entitySchema.model.editPageConfig?.sectionsConfig,
                    loading: entitySchema.model.editPageConfig?.loading,
                    pageTitle: entitySchema.model.editPageConfig?.pageTitle,
                    successMessage: entitySchema.model.editPageConfig?.successMessage,
                    errorHandling: entitySchema.model.editPageConfig?.errorHandling,
                    retry: entitySchema.model.editPageConfig?.retry,
                    displayOverrides: entitySchema.model.editPageConfig?.displayOverrides ?? entitySchema.model.displayOverrides,
                    globalUIConfigOptions,
                    autoGroupActions,
                }, service);
                entityConfigs[`edit-${entityName.toLowerCase()}`] = updateConfig;
            }
            if (!entitySchema.model.excludeFromAdminList) {
                const listConfig = (0, list_entity_1.default)({
                    entityName,
                    entityNamePlural: entitySchema.model.entityNamePlural,
                    properties: entityDefaultOpsSchema.list.output,
                    CRUDApiPath: entitySchema.model.CRUDApiPath,
                    useSearch: Boolean(entitySchema.model.search?.enabled),
                    excludeFromAdminCreate: entitySchema.model.excludeFromAdminCreate,
                    excludeFromAdminUpdate: entitySchema.model.excludeFromAdminUpdate,
                    excludeFromAdminDelete: entitySchema.model.excludeFromAdminDelete,
                    excludeFromAdminDetail: entitySchema.model.excludeFromAdminDetail,
                    // Use new nested config if available, fallback to old
                    pageHeaderActions: entitySchema.model.listPageConfig?.actions || entitySchema.model.listPageActions,
                    breadcrumbs: entitySchema.model.listPageConfig?.breadcrumbs || entitySchema.model.listPageBreadcrumbs,
                    pageTitle: entitySchema.model.listPageConfig?.pageTitle,
                    // Legacy sort fallback (tableConfig.defaultSort is handled directly in list-entity.ts)
                    defaultSort: entitySchema.model.listPageConfig?.defaultSort ?? entitySchema.model.listPageDefaultSort,
                    tableConfig: entitySchema.model.listPageConfig?.tableConfig,
                    sectionsConfig: entitySchema.model.listPageConfig?.sectionsConfig,
                    loading: entitySchema.model.listPageConfig?.loading,
                    errorHandling: entitySchema.model.listPageConfig?.errorHandling,
                    retry: entitySchema.model.listPageConfig?.retry,
                    displayOverrides: entitySchema.model.listPageConfig?.displayOverrides ?? entitySchema.model.displayOverrides,
                    globalUIConfigOptions,
                    hasObservability,
                    excludeAuditActions: entitySchema.model.excludeAuditActions,
                    autoGroupActions,
                }, service);
                entityConfigs[`list-${entityName.toLowerCase()}`] = listConfig;
            }
            if (!entitySchema.model.excludeFromAdminDetail) {
                const viewConfig = (0, view_entity_1.default)({
                    entityName,
                    entityNamePlural: entitySchema.model.entityNamePlural,
                    properties: entityDefaultOpsSchema.get.output,
                    CRUDApiPath: entitySchema.model.CRUDApiPath,
                    excludeFromAdminUpdate: entitySchema.model.excludeFromAdminUpdate,
                    excludeFromAdminDelete: entitySchema.model.excludeFromAdminDelete,
                    // Use new nested config if available, fallback to old
                    actions: entitySchema.model.viewPageConfig?.actions || entitySchema.model.viewPageActions,
                    breadcrumbs: entitySchema.model.viewPageConfig?.breadcrumbs || entitySchema.model.viewPageBreadcrumbs,
                    columnsConfig: entitySchema.model.viewPageConfig?.columnsConfig || entitySchema.model.viewPageColumnsConfig,
                    fields: entitySchema.model.viewPageConfig?.fields,
                    sectionsConfig: entitySchema.model.viewPageConfig?.sectionsConfig,
                    loading: entitySchema.model.viewPageConfig?.loading,
                    pageTitle: entitySchema.model.viewPageConfig?.pageTitle,
                    dataQuality: entitySchema.model.viewPageConfig?.dataQuality,
                    errorHandling: entitySchema.model.viewPageConfig?.errorHandling,
                    retry: entitySchema.model.viewPageConfig?.retry,
                    displayOverrides: entitySchema.model.viewPageConfig?.displayOverrides ?? entitySchema.model.displayOverrides,
                    globalUIConfigOptions,
                    hasObservability,
                    excludeAuditActions: entitySchema.model.excludeAuditActions,
                    autoGroupActions,
                }, service);
                entityConfigs[`view-${entityName.toLowerCase()}`] = viewConfig;
            }
            if (!entitySchema.model.excludeFromAdminMenu) {
                const menuConfig = (0, entity_menu_1.default)({
                    entityName,
                    entityNamePlural: entitySchema.model.entityNamePlural,
                    icon: entitySchema.model.entityMenuIcon || 'appStore',
                    menuIndex: menuIndex++,
                    excludeFromAdminList: entitySchema.model.excludeFromAdminList,
                    excludeFromAdminCreate: entitySchema.model.excludeFromAdminCreate,
                    menuGroup: entitySchema.model.menuGroup,
                    menuOrder: entitySchema.model.menuOrder,
                });
                menuConfigs.push(menuConfig);
            }
        });
        // Process custom pages
        for (const [pageName, options] of this.customPages) {
            // skip the default dashboard page and menu page
            if (pageName === 'dashboard' || pageName === 'menu') {
                continue;
            }
            const customConfig = (0, custom_page_1.makeCustomPageConfig)(options);
            entityConfigs[pageName] = customConfig;
        }
        const authConfigOptions = fw24_1.Fw24.getInstance().getConfig().uiConfigGenOptions || {};
        const authConfigs = (0, auth_1.default)({
            ...authConfigOptions,
            authEndpoint: authConfigOptions.authEndpoint || 'mauth'
        });
        // Look for a dashboard custom page
        let dashboardConfig = null;
        for (const [, options] of this.customPages) {
            // Check if this is a dashboard page - handle both string and Template pageTitle
            const pageTitleStr = typeof options.pageTitle === 'string' ? options.pageTitle : '';
            if (options.pageType === 'dashboard' && pageTitleStr.toLowerCase() === 'dashboard') {
                dashboardConfig = options;
                break;
            }
        }
        if (!dashboardConfig) {
            dashboardConfig = (0, dashboard_1.default)();
        }
        // Look for a menu custom page
        let menuConfig = null;
        for (const [pageName, options] of this.customPages) {
            // Check if this is a menu page - handle both string and Template pageTitle
            const pageTitleStr = typeof options.pageTitle === 'string' ? options.pageTitle : '';
            if (options.pageType === 'menu' && pageTitleStr.toLowerCase() === 'menu') {
                menuConfig = options;
                break;
            }
        }
        // Group menu items by their group property
        const menuGroups = new Map();
        const ungroupedItems = [];
        // Process entity menu items
        menuConfigs.forEach(item => {
            if (item.group) {
                if (!menuGroups.has(item.group)) {
                    menuGroups.set(item.group, []);
                }
                menuGroups.get(item.group).push(item);
            }
            else {
                ungroupedItems.push(item);
            }
        });
        // Process custom menu items
        if (menuConfig?.menuPageConfig?.menuItems) {
            menuConfig.menuPageConfig.menuItems.forEach((item) => {
                if (item.group) {
                    if (!menuGroups.has(item.group)) {
                        menuGroups.set(item.group, []);
                    }
                    menuGroups.get(item.group).push(item);
                }
                else {
                    ungroupedItems.push(item);
                }
            });
        }
        // Create final menu structure
        const allMenuItems = [];
        // Add ungrouped items first (primary navigation)
        allMenuItems.push(...ungroupedItems);
        // Add grouped items
        menuGroups.forEach((items, groupName) => {
            // Sort items within group by order
            items.sort((a, b) => (a.order || 0) - (b.order || 0));
            // Create group item
            allMenuItems.push({
                label: groupName,
                key: `group-${groupName}`,
                icon: 'FolderOutlined',
                children: items
            });
        });
        await this.writeToFiles(allMenuItems, entityConfigs, authConfigs, dashboardConfig);
    }
    /**
     * Transform legacy flat config structure to new nested structure
     * Supports backward compatibility by transforming old properties to new format
     */
    transformLegacyConfig(schema) {
        const model = schema.model;
        // If already using new format, return as-is
        if (model.listPageConfig || model.viewPageConfig || model.editPageConfig || model.createPageConfig) {
            return schema;
        }
        // Transform old format to new nested structure
        const transformedModel = {
            ...model,
            // List page transformation
            listPageConfig: (model.listPageActions || model.listPageBreadcrumbs || model.listPageDefaultSort)
                ? {
                    actions: model.listPageActions,
                    breadcrumbs: model.listPageBreadcrumbs,
                    defaultSort: model.listPageDefaultSort
                }
                : undefined,
            // View page transformation
            viewPageConfig: (model.viewPageActions || model.viewPageBreadcrumbs || model.viewPageColumnsConfig)
                ? {
                    actions: model.viewPageActions,
                    breadcrumbs: model.viewPageBreadcrumbs,
                    columnsConfig: model.viewPageColumnsConfig
                }
                : undefined,
            // Edit page transformation
            editPageConfig: (model.editPageActions || model.editPageBreadcrumbs || model.editPageColumnsConfig)
                ? {
                    actions: model.editPageActions,
                    breadcrumbs: model.editPageBreadcrumbs,
                    columnsConfig: model.editPageColumnsConfig
                }
                : undefined,
            // Create page transformation
            createPageConfig: (model.createPageBreadcrumbs || model.createPageColumnsConfig)
                ? {
                    breadcrumbs: model.createPageBreadcrumbs,
                    columnsConfig: model.createPageColumnsConfig
                }
                : undefined,
        };
        return { ...schema, model: transformedModel };
    }
    /**
     * Check for deprecated configuration usage and emit warnings
     */
    checkDeprecatedUsage(schema) {
        const model = schema.model;
        const warnings = [];
        // Check list page deprecated fields
        if (model.listPageActions) {
            warnings.push('listPageActions is deprecated. Use listPageConfig.actions instead.');
        }
        if (model.listPageBreadcrumbs) {
            warnings.push('listPageBreadcrumbs is deprecated. Use listPageConfig.breadcrumbs instead.');
        }
        if (model.listPageDefaultSort) {
            warnings.push('listPageDefaultSort is deprecated. Use listPageConfig.defaultSort instead.');
        }
        // Check view page deprecated fields
        if (model.viewPageActions) {
            warnings.push('viewPageActions is deprecated. Use viewPageConfig.actions instead.');
        }
        if (model.viewPageBreadcrumbs) {
            warnings.push('viewPageBreadcrumbs is deprecated. Use viewPageConfig.breadcrumbs instead.');
        }
        if (model.viewPageColumnsConfig) {
            warnings.push('viewPageColumnsConfig is deprecated. Use viewPageConfig.columnsConfig instead.');
        }
        // Check edit page deprecated fields
        if (model.editPageActions) {
            warnings.push('editPageActions is deprecated. Use editPageConfig.actions instead.');
        }
        if (model.editPageBreadcrumbs) {
            warnings.push('editPageBreadcrumbs is deprecated. Use editPageConfig.breadcrumbs instead.');
        }
        if (model.editPageColumnsConfig) {
            warnings.push('editPageColumnsConfig is deprecated. Use editPageConfig.columnsConfig instead.');
        }
        // Check create page deprecated fields
        if (model.createPageBreadcrumbs) {
            warnings.push('createPageBreadcrumbs is deprecated. Use createPageConfig.breadcrumbs instead.');
        }
        if (model.createPageColumnsConfig) {
            warnings.push('createPageColumnsConfig is deprecated. Use createPageConfig.columnsConfig instead.');
        }
        // Emit warnings if any deprecated fields found
        if (warnings.length > 0) {
            this.logger.warn(`\n⚠️  Entity "${model.entity}" uses deprecated configuration:`);
            warnings.forEach(w => this.logger.warn(`   - ${w}`));
            this.logger.warn(`   📖 Migration guide: https://docs.fw24.io/migration/nested-config\n`);
        }
    }
    prepareServicesDirectories() {
        const fw24 = fw24_1.Fw24.getInstance();
        const serviceDirectories = [(0, path_1.resolve)('./src/services/')];
        if (fw24.hasModules()) {
            this.logger.debug(`Ui-config-gen::: Process::: app has modules: `, Array.from(fw24.getModules().keys()));
            for (const [, module] of fw24.getModules()) {
                const moduleServicesPath = (0, path_1.join)(module.getBasePath(), module.getServicesDirectory());
                this.logger.debug(`Ui-config-gen::: Process::: moduleServicesPath: `, moduleServicesPath);
                this.logger.debug(`Ui-config-gen::: Process::: res-moduleServicesPath: `, (0, path_1.resolve)(moduleServicesPath));
                serviceDirectories.push((0, path_1.resolve)(moduleServicesPath));
            }
        }
        return serviceDirectories;
    }
    async scanAndLoadServices(serviceDirectories) {
        const scannedServices = new Set();
        for (const dir of serviceDirectories) {
            this.logger.debug(`Ui-config-gen::: Process::: loading services from DIR: `, dir);
            const dirServiceTokens = await this.scanServicesFromDirectory(dir);
            dirServiceTokens.forEach(token => scannedServices.add(token));
        }
        // get all container registered services to make sure auto-gen entity-services are also included
        this.uiGenDIContainer.collectBestProvidersFor({
            type: 'service',
            allProvidersFromChildContainers: true
        }).filter(opt => {
            // make sure to collect only the entity service providers
            return !!opt._provider.forEntity;
        }).forEach(opt => {
            scannedServices.add(opt._provider.provide);
        });
        // resolve all services
        const resolvedServices = new Map();
        scannedServices.forEach(token => {
            const service = this.uiGenDIContainer.resolve(token, {
                allProvidersFromChildContainers: true
            });
            this.logger.debug(`resolved service for entity: ${service.getEntityName()}`);
            this.logger.debug(`Ui-config-gen::: Process::: loaded services from entity: `, service.getEntityName());
            resolvedServices.set(service.getEntityName(), service);
        });
        return resolvedServices;
    }
    async scanServicesFromDirectory(servicesDir) {
        const scannedServices = new Set();
        if (!(0, fs_1.existsSync)(servicesDir)) {
            this.logger.warn(`scanServicesFromDirectory: servicesDir does not exists: ${servicesDir}`);
            return scannedServices;
        }
        const servicePaths = helper_1.Helper.scanControllerSourceFilesFrom(servicesDir);
        for (const servicePath of servicePaths) {
            this.logger.debug(`trying to load servicePath: ${servicePath}`);
            try {
                // Dynamically import the service file
                const module = await Promise.resolve(`${(0, path_1.join)(servicesDir, servicePath)}`).then(s => __importStar(require(s)));
                // Find and instantiate service classes
                for (const exportedItem of Object.values(module)) {
                    if (exportedItem
                        && typeof exportedItem === 'function'
                        && 'prototype' in exportedItem
                        && exportedItem.prototype instanceof entity_1.BaseEntityService) {
                        if (this.uiGenDIContainer.has(exportedItem, {
                            type: 'service',
                            allProvidersFromChildContainers: true
                        })) {
                            scannedServices.add(exportedItem);
                            this.logger.debug(`scanServicesFromDirectory: registering service: ${exportedItem.name}`);
                            continue;
                        }
                        this.logger.debug(`scanServicesFromDirectory: no provider could be found for service: ${exportedItem.name}`);
                    }
                    else {
                        this.logger.debug(`scanServicesFromDirectory: SKIP: exportedItem is not a service class: ${exportedItem?.name ? exportedItem.name : exportedItem}`);
                    }
                }
            }
            catch (e) {
                this.logger.error(`scanServicesFromDirectory: Exception while trying to load servicePath: ${servicePath}`, e);
            }
        }
        return scannedServices;
    }
    /**
     * Write JSON config file and create compressed versions (gzip and brotli)
     * for browser-compatible delivery
     */
    writeConfigFile(filePath, data, configName) {
        const jsonString = JSON.stringify(data, null, 2);
        const jsonBuffer = Buffer.from(jsonString, 'utf-8');
        // Write original JSON file
        this.logger.debug(`writing ${configName} config.. into: ${filePath}`);
        (0, fs_1.writeFileSync)(filePath, jsonString);
        // Write gzip compressed version
        const gzipFilePath = `${filePath}.gz`;
        const gzipCompressed = (0, zlib_1.gzipSync)(jsonBuffer, { level: zlib_1.constants.Z_BEST_COMPRESSION });
        (0, fs_1.writeFileSync)(gzipFilePath, gzipCompressed);
        this.logger.debug(`writing ${configName} config (gzip).. into: ${gzipFilePath}`);
        // Write brotli compressed version
        const brotliFilePath = `${filePath}.br`;
        const brotliCompressed = (0, zlib_1.brotliCompressSync)(jsonBuffer, {
            params: {
                [zlib_1.constants.BROTLI_PARAM_QUALITY]: zlib_1.constants.BROTLI_MAX_QUALITY // Max quality (0-11)
            }
        });
        (0, fs_1.writeFileSync)(brotliFilePath, brotliCompressed);
        this.logger.debug(`writing ${configName} config (brotli).. into: ${brotliFilePath}`);
        // Log compression ratios
        const originalSize = jsonBuffer.length;
        const gzipSize = gzipCompressed.length;
        const brotliSize = brotliCompressed.length;
        const gzipRatio = ((1 - gzipSize / originalSize) * 100).toFixed(2);
        const brotliRatio = ((1 - brotliSize / originalSize) * 100).toFixed(2);
        this.logger.info(`${configName} compression stats: ` +
            `original: ${originalSize}b, ` +
            `gzip: ${gzipSize}b (${gzipRatio}% smaller), ` +
            `brotli: ${brotliSize}b (${brotliRatio}% smaller)`);
    }
    async writeToFiles(menuConfig, entitiesConfig, authConfig, dashboardConfig) {
        this.logger.debug("Called writeToFiles:::::: ");
        const genDirectoryPath = (0, path_1.resolve)('./gen/');
        if (!(0, fs_1.existsSync)(genDirectoryPath)) {
            this.logger.debug(`Gen DIR does not exists, creating: ${genDirectoryPath}`);
            (0, fs_1.mkdirSync)(genDirectoryPath);
        }
        const configDirectoryPath = (0, path_1.resolve)((0, path_1.join)(genDirectoryPath, 'config'));
        if (!(0, fs_1.existsSync)(configDirectoryPath)) {
            this.logger.debug(`Config DIR does not exists, creating: ${configDirectoryPath}`);
            (0, fs_1.mkdirSync)(configDirectoryPath);
        }
        // Write menu config with compressed versions
        const menuConfigFilePath = (0, path_1.join)(configDirectoryPath, 'menu.json');
        this.writeConfigFile(menuConfigFilePath, menuConfig, 'menu');
        // Write entities config with compressed versions
        const entitiesConfigFilePath = (0, path_1.join)(configDirectoryPath, 'entities.json');
        this.writeConfigFile(entitiesConfigFilePath, entitiesConfig, 'entities');
        // Write auth config with compressed versions
        const authConfigFilePath = (0, path_1.join)(configDirectoryPath, 'auth.json');
        this.writeConfigFile(authConfigFilePath, authConfig, 'auth');
        // Write dashboard config with compressed versions
        const dashboardConfigFilePath = (0, path_1.join)(configDirectoryPath, 'dashboard.json');
        this.writeConfigFile(dashboardConfigFilePath, dashboardConfig, 'dashboard');
    }
}
exports.EntityUIConfigGen = EntityUIConfigGen;
__decorate([
    (0, logging_1.LogDuration)()
], EntityUIConfigGen.prototype, "scanCustomPages", null);
__decorate([
    (0, logging_1.LogDuration)()
], EntityUIConfigGen.prototype, "process", null);
__decorate([
    (0, logging_1.LogDuration)()
], EntityUIConfigGen.prototype, "prepareServicesDirectories", null);
__decorate([
    (0, logging_1.LogDuration)()
], EntityUIConfigGen.prototype, "scanAndLoadServices", null);
__decorate([
    (0, logging_1.LogDuration)()
], EntityUIConfigGen.prototype, "scanServicesFromDirectory", null);
__decorate([
    (0, logging_1.LogDuration)()
], EntityUIConfigGen.prototype, "writeToFiles", null);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW50aXR5LXVpLWNvbmZpZy5nZW4uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdWktY29uZmlnLWdlbi9lbnRpdHktdWktY29uZmlnLmdlbi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSw4RUFBK0Q7QUFDL0QsOEVBQStEO0FBQy9ELDBFQUEyRDtBQUMzRCwwRUFBMkQ7QUFDM0QsMEVBQTJEO0FBQzNELHNDQUE0RDtBQUM1RCx5REFBMEo7QUFFMUosNERBQThDO0FBQzlDLHNFQUF3RDtBQUV4RCwyQkFBMEQ7QUFDMUQsK0JBQStEO0FBQy9ELCtCQUdjO0FBRWQsdUNBQW9DO0FBQ3BDLDJDQUF3QztBQUN4Qyx3Q0FBdUQ7QUFDdkQsMENBQXdDO0FBRXhDLE1BQWEsaUJBQWlCO0lBQ2pCLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsaUJBQWlCLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDdkQsOEZBQThGO0lBQzlGLG1DQUFtQztJQUMxQixnQkFBZ0IsR0FBRyxXQUFJLENBQUMsV0FBVyxFQUFFLENBQUMsaUJBQWlCLEVBQUUsQ0FBQztJQUVsRCxXQUFXLEdBQW1DLElBQUksR0FBRyxFQUFFLENBQUM7SUFHbkUsQUFBTixLQUFLLENBQUMsZUFBZTtRQUNqQixNQUFNLElBQUksR0FBRyxXQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7UUFDaEMsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFDO1FBQ2hDLE1BQU0sY0FBYyxHQUFHLE1BQU0sQ0FBQyxrQkFBa0IsRUFBRSxvQkFBb0IsSUFBSSxjQUFjLENBQUM7UUFFekYsTUFBTSxzQkFBc0IsR0FBRyxDQUFFLElBQUEsY0FBVyxFQUFDLFNBQVMsY0FBYyxHQUFHLENBQUMsQ0FBRSxDQUFDO1FBRTNFLElBQUksSUFBSSxDQUFDLFVBQVUsRUFBRSxFQUFFLENBQUM7WUFD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QUFFLGVBQWUsQ0FBQyxDQUFDO1FBQzlFLElBQUksQ0FBQyxlQUFlLENBQUMsc0JBQXNCLEVBQUUsY0FBYyxFQUFFLFVBQVUsQ0FBQyxDQUFDO1FBRXpFLDZDQUE2QztRQUM3QyxNQUFNLGtCQUFrQixHQUFHLElBQUEsV0FBUSxFQUFDLG1CQUFtQixFQUFFLFdBQVcsQ0FBQyxDQUFDO1FBQ3RFLElBQUksQ0FBQyxlQUFlLENBQUMsa0JBQWtCLEVBQUUsVUFBVSxFQUFFLE1BQU0sQ0FBQyxDQUFDO1FBRTdELGtEQUFrRDtRQUNsRCxNQUFNLHVCQUF1QixHQUFHLElBQUEsV0FBUSxFQUFDLG1CQUFtQixFQUFFLGdCQUFnQixDQUFDLENBQUM7UUFDaEYsSUFBSSxDQUFDLGVBQWUsQ0FBQyx1QkFBdUIsRUFBRSxlQUFlLEVBQUUsV0FBVyxDQUFDLENBQUM7SUFFaEYsQ0FBQztDQUNKO0FBdHFCRCw4Q0FzcUJDO0FBN3BCUztJQURMLElBQUEscUJBQVcsR0FBRTt3REErQ2I7QUF1RUs7SUFETCxJQUFBLHFCQUFXLEdBQUU7Z0RBZ1FiO0FBaUhEO0lBREMsSUFBQSxxQkFBVyxHQUFFO21FQWlCYjtBQUdLO0lBREwsSUFBQSxxQkFBVyxHQUFFOzREQXFDYjtBQUdLO0lBREwsSUFBQSxxQkFBVyxHQUFFO2tFQWtEYjtBQThDSztJQURMLElBQUEscUJBQVcsR0FBRTtxREErQmIiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgTWFrZUNyZWF0ZUVudGl0eUNvbmZpZyBmcm9tICcuL3RlbXBsYXRlcy9jcmVhdGUtZW50aXR5JztcbmltcG9ydCBNYWtlVXBkYXRlRW50aXR5Q29uZmlnIGZyb20gJy4vdGVtcGxhdGVzL3VwZGF0ZS1lbnRpdHknO1xuaW1wb3J0IE1ha2VMaXN0RW50aXR5Q29uZmlnIGZyb20gJy4vdGVtcGxhdGVzL2xpc3QtZW50aXR5JztcbmltcG9ydCBNYWtlVmlld0VudGl0eUNvbmZpZyBmcm9tICcuL3RlbXBsYXRlcy92aWV3LWVudGl0eSc7XG5pbXBvcnQgTWFrZUVudGl0eU1lbnVDb25maWcgZnJvbSAnLi90ZW1wbGF0ZXMvZW50aXR5LW1lbnUnO1xuaW1wb3J0IHsgQmFzZUVudGl0eVNlcnZpY2UsIEVudGl0eVNjaGVtYSB9IGZyb20gJy4uL2VudGl0eSc7XG5pbXBvcnQgeyBtYWtlQ3VzdG9tUGFnZUNvbmZpZywgQ3VzdG9tUGFnZU9wdGlvbnMsIExpc3RQYWdlQ29uZmlnLCBGb3JtUGFnZUNvbmZpZywgRGV0YWlsc1BhZ2VDb25maWcsIERhc2hib2FyZFBhZ2VDb25maWcgfSBmcm9tICcuL3RlbXBsYXRlcy9jdXN0b20tcGFnZSc7XG5cbmltcG9ydCBNYWtlQXV0aENvbmZpZyBmcm9tICcuL3RlbXBsYXRlcy9hdXRoJztcbmltcG9ydCBNYWtlRGFzaGJvYXJkQ29uZmlnIGZyb20gJy4vdGVtcGxhdGVzL2Rhc2hib2FyZCc7XG5cbmltcG9ydCB7IGV4aXN0c1N5bmMsIG1rZGlyU3luYywgd3JpdGVGaWxlU3luYyB9IGZyb20gXCJmc1wiO1xuaW1wb3J0IHsgZ3ppcFN5bmMsIGJyb3RsaUNvbXByZXNzU3luYywgY29uc3RhbnRzIH0gZnJvbSBcInpsaWJcIjtcbmltcG9ydCB7XG4gICAgcmVzb2x2ZSBhcyBwYXRoUmVzb2x2ZSxcbiAgICBqb2luIGFzIHBhdGhKb2luXG59IGZyb20gXCJwYXRoXCI7XG5cbmltcG9ydCB7IEZ3MjQgfSBmcm9tICcuLi9jb3JlL2Z3MjQnO1xuaW1wb3J0IHsgSGVscGVyIH0gZnJvbSAnLi4vY29yZS9oZWxwZXInO1xuaW1wb3J0IHsgTG9nRHVyYXRpb24sIGNyZWF0ZUxvZ2dlciB9IGZyb20gJy4uL2xvZ2dpbmcnO1xuaW1wb3J0IHsgdG9TbHVnIH0gZnJvbSAnLi4vdXRpbHMvY2FzZXMnO1xuXG5leHBvcnQgY2xhc3MgRW50aXR5VUlDb25maWdHZW4ge1xuICAgIHJlYWRvbmx5IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcihFbnRpdHlVSUNvbmZpZ0dlbi5uYW1lKTtcbiAgICAvLyBtYWtlIHN1cmUgdG8gY3JlYXRlIGEgY2hpbGQgY29udGFpbmVyIHRvIG5vdCBwb2xsdXRlIGFueXRoaW5nIGluIHRoZSBBcHBsaWNhdGlvbiBjb250YWluZXIgXG4gICAgLy8gd2hpbGUgc2Nhbm5pbmcgYW5kIGxvYWRpbmcgc3R1ZmZcbiAgICByZWFkb25seSB1aUdlbkRJQ29udGFpbmVyID0gRncyNC5nZXRJbnN0YW5jZSgpLmdldEFwcERJQ29udGFpbmVyKCk7XG5cbiAgICBwcml2YXRlIHJlYWRvbmx5IGN1c3RvbVBhZ2VzOiBNYXA8c3RyaW5nLCBDdXN0b21QYWdlT3B0aW9ucz4gPSBuZXcgTWFwKCk7XG5cbiAgICBATG9nRHVyYXRpb24oKVxuICAgIGFzeW5jIHNjYW5DdXN0b21QYWdlcygpIHtcbiAgICAgICAgY29uc3QgZncyNCA9IEZ3MjQuZ2V0SW5zdGFuY2UoKTtcbiAgICAgICAgY29uc3QgY29uZmlnID0gZncyNC5nZXRDb25maWcoKTtcbiAgICAgICAgY29uc3QgY3VzdG9tUGFnZXNEaXIgPSBjb25maWcudWlDb25maWdHZW5PcHRpb25zPy5jdXN0b21QYWdlc0RpcmVjdG9yeSB8fCAnY3VzdG9tLXBhZ2VzJztcblxuICAgICAgICBjb25zdCBjdXN0b21QYWdlc0RpcmVjdG9yaWVzID0gWyBwYXRoUmVzb2x2ZShgLi9zcmMvJHtjdXN0b21QYWdlc0Rpcn0vYCkgXTtcblxuICAgICAgICBpZiAoZncyNC5oYXNNb2R1bGVzKCkpIHtcbiAgICAgICAgICAgIGZvciAoY29uc3QgWyAsIG1vZHVsZSBdIG9mIGZ3MjQuZ2V0TW9kdWxlcygpKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgbW9kdWxlQ3VzdG9tUGFnZXNQYXRoID0gcGF0aEpvaW4obW9kdWxlLmdldEJhc2VQYXRoKCksIGN1c3RvbVBhZ2VzRGlyKTtcbiAgICAgICAgICAgICAgICBjdXN0b21QYWdlc0RpcmVjdG9yaWVzLnB1c2gocGF0aFJlc29sdmUobW9kdWxlQ3VzdG9tUGFnZXNQYXRoKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCByZWdpc3RlcmVkUGFnZXM6IHN0cmluZ1tdID0gW107XG5cbiAgICAgICAgZm9yIChjb25zdCBkaXIgb2YgY3VzdG9tUGFnZXNEaXJlY3Rvcmllcykge1xuICAgICAgICAgICAgaWYgKCFleGlzdHNTeW5jKGRpcikpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQ3VzdG9tIHBhZ2VzIGRpcmVjdG9yeSBkb2VzIG5vdCBleGlzdDogJHtkaXJ9YCk7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGN1c3RvbVBhZ2VGaWxlcyA9IEhlbHBlci5zY2FuQ29udHJvbGxlclNvdXJjZUZpbGVzRnJvbShkaXIpO1xuXG4gICAgICAgICAgICBmb3IgKGNvbnN0IGZpbGUgb2YgY3VzdG9tUGFnZUZpbGVzKSB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbW9kdWxlID0gYXdhaXQgaW1wb3J0KHBhdGhKb2luKGRpciwgZmlsZSkpO1xuICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IFsgXywgdmFsdWUgXSBvZiBPYmplY3QuZW50cmllcyhtb2R1bGUpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5pc1ZhbGlkQ3VzdG9tUGFnZUNvbmZpZyh2YWx1ZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwYWdlTmFtZSA9IHRoaXMuZ2V0UGFnZU5hbWVGcm9tQ29uZmlnKHZhbHVlKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAocGFnZU5hbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5yZWdpc3RlckN1c3RvbVBhZ2UodmFsdWUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZWdpc3RlcmVkUGFnZXMucHVzaChwYWdlTmFtZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBSZWdpc3RlcmVkIGN1c3RvbSBwYWdlOiAke3BhZ2VOYW1lfWApO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYEVycm9yIGxvYWRpbmcgY3VzdG9tIHBhZ2UgZnJvbSAke2ZpbGV9OmAsIGUpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChyZWdpc3RlcmVkUGFnZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhg4pyFIFJlZ2lzdGVyZWQgJHtyZWdpc3RlcmVkUGFnZXMubGVuZ3RofSBjdXN0b20gcGFnZShzKTogJHtyZWdpc3RlcmVkUGFnZXMuc2xpY2UoMCwgNSkuam9pbignLCAnKX0ke3JlZ2lzdGVyZWRQYWdlcy5sZW5ndGggPiA1ID8gYCwgKyR7cmVnaXN0ZXJlZFBhZ2VzLmxlbmd0aCAtIDV9IG1vcmVgIDogJyd9YCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwdWJsaWMgaXNWYWxpZEN1c3RvbVBhZ2VDb25maWcodmFsdWU6IHVua25vd24pOiB2YWx1ZSBpcyBDdXN0b21QYWdlT3B0aW9ucyB7XG4gICAgICAgIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlO1xuXG4gICAgICAgIGNvbnN0IGNvbmZpZyA9IHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgICAgICBpZiAoISgncGFnZVR5cGUnIGluIGNvbmZpZykgfHwgISgncGFnZVRpdGxlJyBpbiBjb25maWcpKSByZXR1cm4gZmFsc2U7XG5cbiAgICAgICAgY29uc3QgcGFnZVR5cGUgPSBjb25maWcucGFnZVR5cGU7XG4gICAgICAgIGlmIChwYWdlVHlwZSA9PT0gJ2xpc3QnKSB7XG4gICAgICAgICAgICByZXR1cm4gJ2xpc3RQYWdlQ29uZmlnJyBpbiBjb25maWc7XG4gICAgICAgIH0gZWxzZSBpZiAocGFnZVR5cGUgPT09ICdmb3JtJykge1xuICAgICAgICAgICAgcmV0dXJuICdmb3JtUGFnZUNvbmZpZycgaW4gY29uZmlnO1xuICAgICAgICB9IGVsc2UgaWYgKHBhZ2VUeXBlID09PSAnZGV0YWlscycpIHtcbiAgICAgICAgICAgIHJldHVybiAnZGV0YWlsc1BhZ2VDb25maWcnIGluIGNvbmZpZztcbiAgICAgICAgfSBlbHNlIGlmIChwYWdlVHlwZSA9PT0gJ2Rhc2hib2FyZCcpIHtcbiAgICAgICAgICAgIHJldHVybiAnZGFzaGJvYXJkUGFnZUNvbmZpZycgaW4gY29uZmlnO1xuICAgICAgICB9IGVsc2UgaWYgKHBhZ2VUeXBlID09PSAnYWNjb3JkaW9uJykge1xuICAgICAgICAgICAgcmV0dXJuICdhY2NvcmRpb25QYWdlQ29uZmlnJyBpbiBjb25maWc7XG4gICAgICAgIH0gZWxzZSBpZiAocGFnZVR5cGUgPT09ICdtZW51Jykge1xuICAgICAgICAgICAgcmV0dXJuICdtZW51UGFnZUNvbmZpZycgaW4gY29uZmlnO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGdldFBhZ2VOYW1lRnJvbUNvbmZpZyhjb25maWc6IEN1c3RvbVBhZ2VPcHRpb25zKTogc3RyaW5nIHwgbnVsbCB7XG4gICAgICAgIGlmIChjb25maWcucGFnZU5hbWUpIHtcbiAgICAgICAgICAgIHJldHVybiB0b1NsdWcoY29uZmlnLnBhZ2VOYW1lKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEZvciB0ZW1wbGF0ZS1iYXNlZCBwYWdlIHRpdGxlcyAob2JqZWN0cyksIHBhZ2VOYW1lIE1VU1QgYmUgcHJvdmlkZWRcbiAgICAgICAgLy8gRXh0cmFjdCBzdHJpbmcgZnJvbSBwYWdlVGl0bGUgKGhhbmRsZXMgYm90aCBzdHJpbmcgYW5kIFRlbXBsYXRlIHR5cGVzKVxuICAgICAgICBjb25zdCBwYWdlVGl0bGVTdHJpbmcgPSB0eXBlb2YgY29uZmlnLnBhZ2VUaXRsZSA9PT0gJ3N0cmluZydcbiAgICAgICAgICAgID8gY29uZmlnLnBhZ2VUaXRsZVxuICAgICAgICAgICAgOiAnY3VzdG9tLXBhZ2UnOyAvLyBGYWxsYmFjayBmb3IgVGVtcGxhdGUgb2JqZWN0c1xuXG4gICAgICAgIHN3aXRjaCAoY29uZmlnLnBhZ2VUeXBlKSB7XG4gICAgICAgICAgICBjYXNlICdsaXN0JzpcbiAgICAgICAgICAgICAgICByZXR1cm4gYGxpc3QtJHt0b1NsdWcocGFnZVRpdGxlU3RyaW5nKX1gO1xuICAgICAgICAgICAgY2FzZSAnZm9ybSc6XG4gICAgICAgICAgICAgICAgcmV0dXJuIHBhZ2VUaXRsZVN0cmluZy50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKCdhZGQnKVxuICAgICAgICAgICAgICAgICAgICA/IGBjcmVhdGUtJHt0b1NsdWcocGFnZVRpdGxlU3RyaW5nKX1gXG4gICAgICAgICAgICAgICAgICAgIDogYGVkaXQtJHt0b1NsdWcocGFnZVRpdGxlU3RyaW5nKX1gO1xuICAgICAgICAgICAgY2FzZSAnZGV0YWlscyc6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGB2aWV3LSR7dG9TbHVnKHBhZ2VUaXRsZVN0cmluZyl9YDtcbiAgICAgICAgICAgIGNhc2UgJ2Rhc2hib2FyZCc6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGAke3RvU2x1ZyhwYWdlVGl0bGVTdHJpbmcpfWA7XG4gICAgICAgICAgICBjYXNlICdhY2NvcmRpb24nOlxuICAgICAgICAgICAgICAgIHJldHVybiBgYWNjb3JkaW9uLSR7dG9TbHVnKHBhZ2VUaXRsZVN0cmluZyl9YDtcbiAgICAgICAgICAgIGNhc2UgJ21lbnUnOlxuICAgICAgICAgICAgICAgIHJldHVybiBgJHt0b1NsdWcocGFnZVRpdGxlU3RyaW5nKX1gO1xuICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJlZ2lzdGVyIGEgY3VzdG9tIHBhZ2UuIFN1cHBvcnRzIG9wdGlvbmFsIHJvdXRlUGF0dGVybiBmb3IgZHluYW1pYyByb3V0ZXMgKGUuZy4sIC9hdXRob3IvOmF1dGhvcklkL2Jvb2tzKVxuICAgICAqL1xuICAgIHB1YmxpYyByZWdpc3RlckN1c3RvbVBhZ2Uob3B0aW9uczogQ3VzdG9tUGFnZU9wdGlvbnMpIHtcbiAgICAgICAgY29uc3QgcGFnZU5hbWUgPSB0aGlzLmdldFBhZ2VOYW1lRnJvbUNvbmZpZyhvcHRpb25zKTtcbiAgICAgICAgaWYgKHBhZ2VOYW1lKSB7XG4gICAgICAgICAgICB0aGlzLmN1c3RvbVBhZ2VzLnNldChwYWdlTmFtZSwgb3B0aW9ucyk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBhc3luYyBydW4oKSB7XG4gICAgICAgIHRoaXMucHJvY2VzcygpO1xuICAgIH1cblxuICAgIEBMb2dEdXJhdGlvbigpXG4gICAgYXN5bmMgcHJvY2VzcygpIHtcbiAgICAgICAgY29uc3QgbWVudUNvbmZpZ3M6IGFueVtdID0gW107XG4gICAgICAgIGNvbnN0IGVudGl0eUNvbmZpZ3M6IGFueSA9IHt9O1xuXG4gICAgICAgIGNvbnN0IHNlcnZpY2VEaXJlY3RvcmllcyA9IHRoaXMucHJlcGFyZVNlcnZpY2VzRGlyZWN0b3JpZXMoKTtcblxuICAgICAgICBjb25zdCBzZXJ2aWNlcyA9IGF3YWl0IHRoaXMuc2NhbkFuZExvYWRTZXJ2aWNlcyhzZXJ2aWNlRGlyZWN0b3JpZXMpO1xuXG4gICAgICAgIC8vIFNjYW4gYW5kIGxvYWQgY3VzdG9tIHBhZ2VzXG4gICAgICAgIGF3YWl0IHRoaXMuc2NhbkN1c3RvbVBhZ2VzKCk7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFVpLWNvbmZpZy1nZW46OjogUHJvY2Vzczo6OiBhbGwtc2VydmljZXM6IGAsIEFycmF5LmZyb20oc2VydmljZXMua2V5cygpKSk7XG5cbiAgICAgICAgLy8gR2V0IGdsb2JhbCBVSSBjb25maWcgb3B0aW9ucyAoaW5jbHVkaW5nIGR1cGxpY2F0ZWRGaWVsZERldGVjdGlvbilcbiAgICAgICAgY29uc3QgZncyNENvbmZpZyA9IEZ3MjQuZ2V0SW5zdGFuY2UoKS5nZXRDb25maWcoKTtcbiAgICAgICAgY29uc3QgZ2xvYmFsVUlDb25maWdPcHRpb25zID0gZncyNENvbmZpZy51aUNvbmZpZ0dlbk9wdGlvbnM7XG4gICAgICAgIGNvbnN0IGhhc09ic2VydmFiaWxpdHkgPSAhIWZ3MjRDb25maWcub2JzZXJ2YWJpbGl0eTtcblxuICAgICAgICBsZXQgbWVudUluZGV4ID0gMTtcbiAgICAgICAgLy8gZ2VuZXJhdGUgVUkgY29uZmlnc1xuICAgICAgICBzZXJ2aWNlcy5mb3JFYWNoKChzZXJ2aWNlLCBlbnRpdHlOYW1lKSA9PiB7XG5cbiAgICAgICAgICAgIGxldCBlbnRpdHlTY2hlbWEgPSBzZXJ2aWNlLmdldEVudGl0eVNjaGVtYSgpIGFzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PjtcblxuICAgICAgICAgICAgLy8gQ2hlY2sgZm9yIGRlcHJlY2F0ZWQgdXNhZ2UgYW5kIHdhcm5cbiAgICAgICAgICAgIHRoaXMuY2hlY2tEZXByZWNhdGVkVXNhZ2UoZW50aXR5U2NoZW1hKTtcblxuICAgICAgICAgICAgLy8gVHJhbnNmb3JtIGxlZ2FjeSBjb25maWcgc3RydWN0dXJlIHRvIG5ldyBuZXN0ZWQgc3RydWN0dXJlIGlmIG5lZWRlZFxuICAgICAgICAgICAgZW50aXR5U2NoZW1hID0gdGhpcy50cmFuc2Zvcm1MZWdhY3lDb25maWcoZW50aXR5U2NoZW1hKTtcbiAgICAgICAgICAgIGNvbnN0IGVudGl0eURlZmF1bHRPcHNTY2hlbWEgPSBzZXJ2aWNlLmdldE9wc0RlZmF1bHRJT1NjaGVtYSgpO1xuXG4gICAgICAgICAgICAvLyBSZXNvbHZlIGF1dG9Hcm91cEFjdGlvbnM6IGVudGl0eS1sZXZlbCBvdmVycmlkZSA+IGdsb2JhbCBjb25maWcgPiBkZWZhdWx0ICh0cnVlKVxuICAgICAgICAgICAgY29uc3QgYXV0b0dyb3VwQWN0aW9ucyA9IGVudGl0eVNjaGVtYS5tb2RlbC5hdXRvR3JvdXBBY3Rpb25zXG4gICAgICAgICAgICAgICAgPz8gZ2xvYmFsVUlDb25maWdPcHRpb25zPy5hdXRvR3JvdXBBY3Rpb25zXG4gICAgICAgICAgICAgICAgPz8gdHJ1ZTtcblxuICAgICAgICAgICAgaWYgKCFlbnRpdHlTY2hlbWEubW9kZWwuZXhjbHVkZUZyb21BZG1pbkNyZWF0ZSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IGNyZWF0ZUNvbmZpZyA9IE1ha2VDcmVhdGVFbnRpdHlDb25maWcoe1xuICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lUGx1cmFsOiBlbnRpdHlTY2hlbWEubW9kZWwuZW50aXR5TmFtZVBsdXJhbCxcbiAgICAgICAgICAgICAgICAgICAgQ1JVREFwaVBhdGg6IGVudGl0eVNjaGVtYS5tb2RlbC5DUlVEQXBpUGF0aCxcbiAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllczogZW50aXR5RGVmYXVsdE9wc1NjaGVtYS5jcmVhdGUuaW5wdXQsXG4gICAgICAgICAgICAgICAgICAgIC8vIFVzZSBuZXcgbmVzdGVkIGNvbmZpZyBpZiBhdmFpbGFibGUsIGZhbGxiYWNrIHRvIG9sZFxuICAgICAgICAgICAgICAgICAgICBicmVhZGNydW1iczogZW50aXR5U2NoZW1hLm1vZGVsLmNyZWF0ZVBhZ2VDb25maWc/LmJyZWFkY3J1bWJzIHx8IGVudGl0eVNjaGVtYS5tb2RlbC5jcmVhdGVQYWdlQnJlYWRjcnVtYnMsXG4gICAgICAgICAgICAgICAgICAgIGNvbHVtbnNDb25maWc6IGVudGl0eVNjaGVtYS5tb2RlbC5jcmVhdGVQYWdlQ29uZmlnPy5jb2x1bW5zQ29uZmlnIHx8IGVudGl0eVNjaGVtYS5tb2RlbC5jcmVhdGVQYWdlQ29sdW1uc0NvbmZpZyxcbiAgICAgICAgICAgICAgICAgICAgZm9ybUNvbmZpZzogZW50aXR5U2NoZW1hLm1vZGVsLmNyZWF0ZVBhZ2VDb25maWc/LmZvcm1Db25maWcsXG4gICAgICAgICAgICAgICAgICAgIHNlY3Rpb25zQ29uZmlnOiBlbnRpdHlTY2hlbWEubW9kZWwuY3JlYXRlUGFnZUNvbmZpZz8uc2VjdGlvbnNDb25maWcsXG4gICAgICAgICAgICAgICAgICAgIGxvYWRpbmc6IGVudGl0eVNjaGVtYS5tb2RlbC5jcmVhdGVQYWdlQ29uZmlnPy5sb2FkaW5nLFxuICAgICAgICAgICAgICAgICAgICBwYWdlVGl0bGU6IGVudGl0eVNjaGVtYS5tb2RlbC5jcmVhdGVQYWdlQ29uZmlnPy5wYWdlVGl0bGUsXG4gICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3NNZXNzYWdlOiBlbnRpdHlTY2hlbWEubW9kZWwuY3JlYXRlUGFnZUNvbmZpZz8uc3VjY2Vzc01lc3NhZ2UsXG4gICAgICAgICAgICAgICAgICAgIGVycm9ySGFuZGxpbmc6IGVudGl0eVNjaGVtYS5tb2RlbC5jcmVhdGVQYWdlQ29uZmlnPy5lcnJvckhhbmRsaW5nLFxuICAgICAgICAgICAgICAgICAgICByZXRyeTogZW50aXR5U2NoZW1hLm1vZGVsLmNyZWF0ZVBhZ2VDb25maWc/LnJldHJ5LFxuICAgICAgICAgICAgICAgICAgICBkaXNwbGF5T3ZlcnJpZGVzOiBlbnRpdHlTY2hlbWEubW9kZWwuY3JlYXRlUGFnZUNvbmZpZz8uZGlzcGxheU92ZXJyaWRlcyA/PyBlbnRpdHlTY2hlbWEubW9kZWwuZGlzcGxheU92ZXJyaWRlcyxcbiAgICAgICAgICAgICAgICAgICAgZ2xvYmFsVUlDb25maWdPcHRpb25zLFxuICAgICAgICAgICAgICAgICAgICBhdXRvR3JvdXBBY3Rpb25zLFxuICAgICAgICAgICAgICAgIH0sIHNlcnZpY2UpO1xuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ3NbIGBjcmVhdGUtJHtlbnRpdHlOYW1lLnRvTG93ZXJDYXNlKCl9YCBdID0gY3JlYXRlQ29uZmlnO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoIWVudGl0eVNjaGVtYS5tb2RlbC5leGNsdWRlRnJvbUFkbWluVXBkYXRlKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgdXBkYXRlQ29uZmlnID0gTWFrZVVwZGF0ZUVudGl0eUNvbmZpZyh7XG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWVQbHVyYWw6IGVudGl0eVNjaGVtYS5tb2RlbC5lbnRpdHlOYW1lUGx1cmFsLFxuICAgICAgICAgICAgICAgICAgICBDUlVEQXBpUGF0aDogZW50aXR5U2NoZW1hLm1vZGVsLkNSVURBcGlQYXRoLFxuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiBlbnRpdHlEZWZhdWx0T3BzU2NoZW1hLnVwZGF0ZS5pbnB1dCxcbiAgICAgICAgICAgICAgICAgICAgZXhjbHVkZUZyb21BZG1pbkRlbGV0ZTogZW50aXR5U2NoZW1hLm1vZGVsLmV4Y2x1ZGVGcm9tQWRtaW5EZWxldGUsXG4gICAgICAgICAgICAgICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5DcmVhdGU6IGVudGl0eVNjaGVtYS5tb2RlbC5leGNsdWRlRnJvbUFkbWluQ3JlYXRlLFxuICAgICAgICAgICAgICAgICAgICBleGNsdWRlRnJvbUFkbWluRHVwbGljYXRlOiBlbnRpdHlTY2hlbWEubW9kZWwuZXhjbHVkZUZyb21BZG1pbkR1cGxpY2F0ZSxcbiAgICAgICAgICAgICAgICAgICAgLy8gVXNlIG5ldyBuZXN0ZWQgY29uZmlnIGlmIGF2YWlsYWJsZSwgZmFsbGJhY2sgdG8gb2xkXG4gICAgICAgICAgICAgICAgICAgIGFjdGlvbnM6IGVudGl0eVNjaGVtYS5tb2RlbC5lZGl0UGFnZUNvbmZpZz8uYWN0aW9ucyB8fCBlbnRpdHlTY2hlbWEubW9kZWwuZWRpdFBhZ2VBY3Rpb25zLFxuICAgICAgICAgICAgICAgICAgICBicmVhZGNydW1iczogZW50aXR5U2NoZW1hLm1vZGVsLmVkaXRQYWdlQ29uZmlnPy5icmVhZGNydW1icyB8fCBlbnRpdHlTY2hlbWEubW9kZWwuZWRpdFBhZ2VCcmVhZGNydW1icyxcbiAgICAgICAgICAgICAgICAgICAgY29sdW1uc0NvbmZpZzogZW50aXR5U2NoZW1hLm1vZGVsLmVkaXRQYWdlQ29uZmlnPy5jb2x1bW5zQ29uZmlnIHx8IGVudGl0eVNjaGVtYS5tb2RlbC5lZGl0UGFnZUNvbHVtbnNDb25maWcsXG4gICAgICAgICAgICAgICAgICAgIGZvcm1Db25maWc6IGVudGl0eVNjaGVtYS5tb2RlbC5lZGl0UGFnZUNvbmZpZz8uZm9ybUNvbmZpZyxcbiAgICAgICAgICAgICAgICAgICAgc2VjdGlvbnNDb25maWc6IGVudGl0eVNjaGVtYS5tb2RlbC5lZGl0UGFnZUNvbmZpZz8uc2VjdGlvbnNDb25maWcsXG4gICAgICAgICAgICAgICAgICAgIGxvYWRpbmc6IGVudGl0eVNjaGVtYS5tb2RlbC5lZGl0UGFnZUNvbmZpZz8ubG9hZGluZyxcbiAgICAgICAgICAgICAgICAgICAgcGFnZVRpdGxlOiBlbnRpdHlTY2hlbWEubW9kZWwuZWRpdFBhZ2VDb25maWc/LnBhZ2VUaXRsZSxcbiAgICAgICAgICAgICAgICAgICAgc3VjY2Vzc01lc3NhZ2U6IGVudGl0eVNjaGVtYS5tb2RlbC5lZGl0UGFnZUNvbmZpZz8uc3VjY2Vzc01lc3NhZ2UsXG4gICAgICAgICAgICAgICAgICAgIGVycm9ySGFuZGxpbmc6IGVudGl0eVNjaGVtYS5tb2RlbC5lZGl0UGFnZUNvbmZpZz8uZXJyb3JIYW5kbGluZyxcbiAgICAgICAgICAgICAgICAgICAgcmV0cnk6IGVudGl0eVNjaGVtYS5tb2RlbC5lZGl0UGFnZUNvbmZpZz8ucmV0cnksXG4gICAgICAgICAgICAgICAgICAgIGRpc3BsYXlPdmVycmlkZXM6IGVudGl0eVNjaGVtYS5tb2RlbC5lZGl0UGFnZUNvbmZpZz8uZGlzcGxheU92ZXJyaWRlcyA/PyBlbnRpdHlTY2hlbWEubW9kZWwuZGlzcGxheU92ZXJyaWRlcyxcbiAgICAgICAgICAgICAgICAgICAgZ2xvYmFsVUlDb25maWdPcHRpb25zLFxuICAgICAgICAgICAgICAgICAgICBhdXRvR3JvdXBBY3Rpb25zLFxuICAgICAgICAgICAgICAgIH0sIHNlcnZpY2UpO1xuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ3NbIGBlZGl0LSR7ZW50aXR5TmFtZS50b0xvd2VyQ2FzZSgpfWAgXSA9IHVwZGF0ZUNvbmZpZztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKCFlbnRpdHlTY2hlbWEubW9kZWwuZXhjbHVkZUZyb21BZG1pbkxpc3QpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBsaXN0Q29uZmlnID0gTWFrZUxpc3RFbnRpdHlDb25maWcoe1xuICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lUGx1cmFsOiBlbnRpdHlTY2hlbWEubW9kZWwuZW50aXR5TmFtZVBsdXJhbCxcbiAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllczogZW50aXR5RGVmYXVsdE9wc1NjaGVtYS5saXN0Lm91dHB1dCxcbiAgICAgICAgICAgICAgICAgICAgQ1JVREFwaVBhdGg6IGVudGl0eVNjaGVtYS5tb2RlbC5DUlVEQXBpUGF0aCxcbiAgICAgICAgICAgICAgICAgICAgdXNlU2VhcmNoOiBCb29sZWFuKGVudGl0eVNjaGVtYS5tb2RlbC5zZWFyY2g/LmVuYWJsZWQpLFxuICAgICAgICAgICAgICAgICAgICBleGNsdWRlRnJvbUFkbWluQ3JlYXRlOiBlbnRpdHlTY2hlbWEubW9kZWwuZXhjbHVkZUZyb21BZG1pbkNyZWF0ZSxcbiAgICAgICAgICAgICAgICAgICAgZXhjbHVkZUZyb21BZG1pblVwZGF0ZTogZW50aXR5U2NoZW1hLm1vZGVsLmV4Y2x1ZGVGcm9tQWRtaW5VcGRhdGUsXG4gICAgICAgICAgICAgICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5EZWxldGU6IGVudGl0eVNjaGVtYS5tb2RlbC5leGNsdWRlRnJvbUFkbWluRGVsZXRlLFxuICAgICAgICAgICAgICAgICAgICBleGNsdWRlRnJvbUFkbWluRGV0YWlsOiBlbnRpdHlTY2hlbWEubW9kZWwuZXhjbHVkZUZyb21BZG1pbkRldGFpbCxcbiAgICAgICAgICAgICAgICAgICAgLy8gVXNlIG5ldyBuZXN0ZWQgY29uZmlnIGlmIGF2YWlsYWJsZSwgZmFsbGJhY2sgdG8gb2xkXG4gICAgICAgICAgICAgICAgICAgIHBhZ2VIZWFkZXJBY3Rpb25zOiBlbnRpdHlTY2hlbWEubW9kZWwubGlzdFBhZ2VDb25maWc/LmFjdGlvbnMgfHwgZW50aXR5U2NoZW1hLm1vZGVsLmxpc3RQYWdlQWN0aW9ucyxcbiAgICAgICAgICAgICAgICAgICAgYnJlYWRjcnVtYnM6IGVudGl0eVNjaGVtYS5tb2RlbC5saXN0UGFnZUNvbmZpZz8uYnJlYWRjcnVtYnMgfHwgZW50aXR5U2NoZW1hLm1vZGVsLmxpc3RQYWdlQnJlYWRjcnVtYnMsXG4gICAgICAgICAgICAgICAgICAgIHBhZ2VUaXRsZTogZW50aXR5U2NoZW1hLm1vZGVsLmxpc3RQYWdlQ29uZmlnPy5wYWdlVGl0bGUsXG4gICAgICAgICAgICAgICAgICAgIC8vIExlZ2FjeSBzb3J0IGZhbGxiYWNrICh0YWJsZUNvbmZpZy5kZWZhdWx0U29ydCBpcyBoYW5kbGVkIGRpcmVjdGx5IGluIGxpc3QtZW50aXR5LnRzKVxuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0U29ydDogZW50aXR5U2NoZW1hLm1vZGVsLmxpc3RQYWdlQ29uZmlnPy5kZWZhdWx0U29ydCA/PyBlbnRpdHlTY2hlbWEubW9kZWwubGlzdFBhZ2VEZWZhdWx0U29ydCxcbiAgICAgICAgICAgICAgICAgICAgdGFibGVDb25maWc6IGVudGl0eVNjaGVtYS5tb2RlbC5saXN0UGFnZUNvbmZpZz8udGFibGVDb25maWcsXG4gICAgICAgICAgICAgICAgICAgIHNlY3Rpb25zQ29uZmlnOiBlbnRpdHlTY2hlbWEubW9kZWwubGlzdFBhZ2VDb25maWc/LnNlY3Rpb25zQ29uZmlnLFxuICAgICAgICAgICAgICAgICAgICBsb2FkaW5nOiBlbnRpdHlTY2hlbWEubW9kZWwubGlzdFBhZ2VDb25maWc/LmxvYWRpbmcsXG4gICAgICAgICAgICAgICAgICAgIGVycm9ySGFuZGxpbmc6IGVudGl0eVNjaGVtYS5tb2RlbC5saXN0UGFnZUNvbmZpZz8uZXJyb3JIYW5kbGluZyxcbiAgICAgICAgICAgICAgICAgICAgcmV0cnk6IGVudGl0eVNjaGVtYS5tb2RlbC5saXN0UGFnZUNvbmZpZz8ucmV0cnksXG4gICAgICAgICAgICAgICAgICAgIGRpc3BsYXlPdmVycmlkZXM6IGVudGl0eVNjaGVtYS5tb2RlbC5saXN0UGFnZUNvbmZpZz8uZGlzcGxheU92ZXJyaWRlcyA/PyBlbnRpdHlTY2hlbWEubW9kZWwuZGlzcGxheU92ZXJyaWRlcyxcbiAgICAgICAgICAgICAgICAgICAgZ2xvYmFsVUlDb25maWdPcHRpb25zLFxuICAgICAgICAgICAgICAgICAgICBoYXNPYnNlcnZhYmlsaXR5LFxuICAgICAgICAgICAgICAgICAgICBleGNsdWRlQXVkaXRBY3Rpb25zOiBlbnRpdHlTY2hlbWEubW9kZWwuZXhjbHVkZUF1ZGl0QWN0aW9ucyxcbiAgICAgICAgICAgICAgICAgICAgYXV0b0dyb3VwQWN0aW9ucyxcbiAgICAgICAgICAgICAgICB9LCBzZXJ2aWNlKTtcbiAgICAgICAgICAgICAgICBlbnRpdHlDb25maWdzWyBgbGlzdC0ke2VudGl0eU5hbWUudG9Mb3dlckNhc2UoKX1gIF0gPSBsaXN0Q29uZmlnO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoIWVudGl0eVNjaGVtYS5tb2RlbC5leGNsdWRlRnJvbUFkbWluRGV0YWlsKSB7XG4gICAgICAgICAgICAgICAgY29uc3Qgdmlld0NvbmZpZyA9IE1ha2VWaWV3RW50aXR5Q29uZmlnKHtcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZVBsdXJhbDogZW50aXR5U2NoZW1hLm1vZGVsLmVudGl0eU5hbWVQbHVyYWwsXG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IGVudGl0eURlZmF1bHRPcHNTY2hlbWEuZ2V0Lm91dHB1dCxcbiAgICAgICAgICAgICAgICAgICAgQ1JVREFwaVBhdGg6IGVudGl0eVNjaGVtYS5tb2RlbC5DUlVEQXBpUGF0aCxcbiAgICAgICAgICAgICAgICAgICAgZXhjbHVkZUZyb21BZG1pblVwZGF0ZTogZW50aXR5U2NoZW1hLm1vZGVsLmV4Y2x1ZGVGcm9tQWRtaW5VcGRhdGUsXG4gICAgICAgICAgICAgICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5EZWxldGU6IGVudGl0eVNjaGVtYS5tb2RlbC5leGNsdWRlRnJvbUFkbWluRGVsZXRlLFxuICAgICAgICAgICAgICAgICAgICAvLyBVc2UgbmV3IG5lc3RlZCBjb25maWcgaWYgYXZhaWxhYmxlLCBmYWxsYmFjayB0byBvbGRcbiAgICAgICAgICAgICAgICAgICAgYWN0aW9uczogZW50aXR5U2NoZW1hLm1vZGVsLnZpZXdQYWdlQ29uZmlnPy5hY3Rpb25zIHx8IGVudGl0eVNjaGVtYS5tb2RlbC52aWV3UGFnZUFjdGlvbnMsXG4gICAgICAgICAgICAgICAgICAgIGJyZWFkY3J1bWJzOiBlbnRpdHlTY2hlbWEubW9kZWwudmlld1BhZ2VDb25maWc/LmJyZWFkY3J1bWJzIHx8IGVudGl0eVNjaGVtYS5tb2RlbC52aWV3UGFnZUJyZWFkY3J1bWJzLFxuICAgICAgICAgICAgICAgICAgICBjb2x1bW5zQ29uZmlnOiBlbnRpdHlTY2hlbWEubW9kZWwudmlld1BhZ2VDb25maWc/LmNvbHVtbnNDb25maWcgfHwgZW50aXR5U2NoZW1hLm1vZGVsLnZpZXdQYWdlQ29sdW1uc0NvbmZpZyxcbiAgICAgICAgICAgICAgICAgICAgZmllbGRzOiBlbnRpdHlTY2hlbWEubW9kZWwudmlld1BhZ2VDb25maWc/LmZpZWxkcyxcbiAgICAgICAgICAgICAgICAgICAgc2VjdGlvbnNDb25maWc6IGVudGl0eVNjaGVtYS5tb2RlbC52aWV3UGFnZUNvbmZpZz8uc2VjdGlvbnNDb25maWcsXG4gICAgICAgICAgICAgICAgICAgIGxvYWRpbmc6IGVudGl0eVNjaGVtYS5tb2RlbC52aWV3UGFnZUNvbmZpZz8ubG9hZGluZyxcbiAgICAgICAgICAgICAgICAgICAgcGFnZVRpdGxlOiBlbnRpdHlTY2hlbWEubW9kZWwudmlld1BhZ2VDb25maWc/LnBhZ2VUaXRsZSxcbiAgICAgICAgICAgICAgICAgICAgZGF0YVF1YWxpdHk6IGVudGl0eVNjaGVtYS5tb2RlbC52aWV3UGFnZUNvbmZpZz8uZGF0YVF1YWxpdHksXG4gICAgICAgICAgICAgICAgICAgIGVycm9ySGFuZGxpbmc6IGVudGl0eVNjaGVtYS5tb2RlbC52aWV3UGFnZUNvbmZpZz8uZXJyb3JIYW5kbGluZyxcbiAgICAgICAgICAgICAgICAgICAgcmV0cnk6IGVudGl0eVNjaGVtYS5tb2RlbC52aWV3UGFnZUNvbmZpZz8ucmV0cnksXG4gICAgICAgICAgICAgICAgICAgIGRpc3BsYXlPdmVycmlkZXM6IGVudGl0eVNjaGVtYS5tb2RlbC52aWV3UGFnZUNvbmZpZz8uZGlzcGxheU92ZXJyaWRlcyA/PyBlbnRpdHlTY2hlbWEubW9kZWwuZGlzcGxheU92ZXJyaWRlcyxcbiAgICAgICAgICAgICAgICAgICAgZ2xvYmFsVUlDb25maWdPcHRpb25zLFxuICAgICAgICAgICAgICAgICAgICBoYXNPYnNlcnZhYmlsaXR5LFxuICAgICAgICAgICAgICAgICAgICBleGNsdWRlQXVkaXRBY3Rpb25zOiBlbnRpdHlTY2hlbWEubW9kZWwuZXhjbHVkZUF1ZGl0QWN0aW9ucyxcbiAgICAgICAgICAgICAgICAgICAgYXV0b0dyb3VwQWN0aW9ucyxcbiAgICAgICAgICAgICAgICB9LCBzZXJ2aWNlKTtcbiAgICAgICAgICAgICAgICBlbnRpdHlDb25maWdzWyBgdmlldy0ke2VudGl0eU5hbWUudG9Mb3dlckNhc2UoKX1gIF0gPSB2aWV3Q29uZmlnO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoIWVudGl0eVNjaGVtYS5tb2RlbC5leGNsdWRlRnJvbUFkbWluTWVudSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IG1lbnVDb25maWcgPSBNYWtlRW50aXR5TWVudUNvbmZpZyh7XG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWVQbHVyYWw6IGVudGl0eVNjaGVtYS5tb2RlbC5lbnRpdHlOYW1lUGx1cmFsLFxuICAgICAgICAgICAgICAgICAgICBpY29uOiBlbnRpdHlTY2hlbWEubW9kZWwuZW50aXR5TWVudUljb24gfHwgJ2FwcFN0b3JlJyxcbiAgICAgICAgICAgICAgICAgICAgbWVudUluZGV4OiBtZW51SW5kZXgrKyxcbiAgICAgICAgICAgICAgICAgICAgZXhjbHVkZUZyb21BZG1pbkxpc3Q6IGVudGl0eVNjaGVtYS5tb2RlbC5leGNsdWRlRnJvbUFkbWluTGlzdCxcbiAgICAgICAgICAgICAgICAgICAgZXhjbHVkZUZyb21BZG1pbkNyZWF0ZTogZW50aXR5U2NoZW1hLm1vZGVsLmV4Y2x1ZGVGcm9tQWRtaW5DcmVhdGUsXG4gICAgICAgICAgICAgICAgICAgIG1lbnVHcm91cDogZW50aXR5U2NoZW1hLm1vZGVsLm1lbnVHcm91cCxcbiAgICAgICAgICAgICAgICAgICAgbWVudU9yZGVyOiBlbnRpdHlTY2hlbWEubW9kZWwubWVudU9yZGVyLFxuICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgbWVudUNvbmZpZ3MucHVzaChtZW51Q29uZmlnKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBQcm9jZXNzIGN1c3RvbSBwYWdlc1xuICAgICAgICBmb3IgKGNvbnN0IFsgcGFnZU5hbWUsIG9wdGlvbnMgXSBvZiB0aGlzLmN1c3RvbVBhZ2VzKSB7XG4gICAgICAgICAgICAvLyBza2lwIHRoZSBkZWZhdWx0IGRhc2hib2FyZCBwYWdlIGFuZCBtZW51IHBhZ2VcbiAgICAgICAgICAgIGlmIChwYWdlTmFtZSA9PT0gJ2Rhc2hib2FyZCcgfHwgcGFnZU5hbWUgPT09ICdtZW51Jykge1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29uc3QgY3VzdG9tQ29uZmlnID0gbWFrZUN1c3RvbVBhZ2VDb25maWcob3B0aW9ucyk7XG4gICAgICAgICAgICBlbnRpdHlDb25maWdzWyBwYWdlTmFtZSBdID0gY3VzdG9tQ29uZmlnO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgYXV0aENvbmZpZ09wdGlvbnMgPSBGdzI0LmdldEluc3RhbmNlKCkuZ2V0Q29uZmlnKCkudWlDb25maWdHZW5PcHRpb25zIHx8IHt9O1xuXG4gICAgICAgIGNvbnN0IGF1dGhDb25maWdzID0gTWFrZUF1dGhDb25maWcoe1xuICAgICAgICAgICAgLi4uYXV0aENvbmZpZ09wdGlvbnMsXG4gICAgICAgICAgICBhdXRoRW5kcG9pbnQ6IGF1dGhDb25maWdPcHRpb25zLmF1dGhFbmRwb2ludCB8fCAnbWF1dGgnXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIExvb2sgZm9yIGEgZGFzaGJvYXJkIGN1c3RvbSBwYWdlXG4gICAgICAgIGxldCBkYXNoYm9hcmRDb25maWc6IERhc2hib2FyZFBhZ2VDb25maWcgfCBhbnkgPSBudWxsO1xuICAgICAgICBmb3IgKGNvbnN0IFsgLCBvcHRpb25zIF0gb2YgdGhpcy5jdXN0b21QYWdlcykge1xuICAgICAgICAgICAgLy8gQ2hlY2sgaWYgdGhpcyBpcyBhIGRhc2hib2FyZCBwYWdlIC0gaGFuZGxlIGJvdGggc3RyaW5nIGFuZCBUZW1wbGF0ZSBwYWdlVGl0bGVcbiAgICAgICAgICAgIGNvbnN0IHBhZ2VUaXRsZVN0ciA9IHR5cGVvZiBvcHRpb25zLnBhZ2VUaXRsZSA9PT0gJ3N0cmluZycgPyBvcHRpb25zLnBhZ2VUaXRsZSA6ICcnO1xuICAgICAgICAgICAgaWYgKG9wdGlvbnMucGFnZVR5cGUgPT09ICdkYXNoYm9hcmQnICYmIHBhZ2VUaXRsZVN0ci50b0xvd2VyQ2FzZSgpID09PSAnZGFzaGJvYXJkJykge1xuICAgICAgICAgICAgICAgIGRhc2hib2FyZENvbmZpZyA9IG9wdGlvbnM7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFkYXNoYm9hcmRDb25maWcpIHtcbiAgICAgICAgICAgIGRhc2hib2FyZENvbmZpZyA9IE1ha2VEYXNoYm9hcmRDb25maWcoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIExvb2sgZm9yIGEgbWVudSBjdXN0b20gcGFnZVxuICAgICAgICBsZXQgbWVudUNvbmZpZzogYW55ID0gbnVsbDtcbiAgICAgICAgZm9yIChjb25zdCBbIHBhZ2VOYW1lLCBvcHRpb25zIF0gb2YgdGhpcy5jdXN0b21QYWdlcykge1xuICAgICAgICAgICAgLy8gQ2hlY2sgaWYgdGhpcyBpcyBhIG1lbnUgcGFnZSAtIGhhbmRsZSBib3RoIHN0cmluZyBhbmQgVGVtcGxhdGUgcGFnZVRpdGxlXG4gICAgICAgICAgICBjb25zdCBwYWdlVGl0bGVTdHIgPSB0eXBlb2Ygb3B0aW9ucy5wYWdlVGl0bGUgPT09ICdzdHJpbmcnID8gb3B0aW9ucy5wYWdlVGl0bGUgOiAnJztcbiAgICAgICAgICAgIGlmIChvcHRpb25zLnBhZ2VUeXBlID09PSAnbWVudScgJiYgcGFnZVRpdGxlU3RyLnRvTG93ZXJDYXNlKCkgPT09ICdtZW51Jykge1xuICAgICAgICAgICAgICAgIG1lbnVDb25maWcgPSBvcHRpb25zO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gR3JvdXAgbWVudSBpdGVtcyBieSB0aGVpciBncm91cCBwcm9wZXJ0eVxuICAgICAgICBjb25zdCBtZW51R3JvdXBzID0gbmV3IE1hcDxzdHJpbmcsIGFueVtdPigpO1xuICAgICAgICBjb25zdCB1bmdyb3VwZWRJdGVtczogYW55W10gPSBbXTtcblxuICAgICAgICAvLyBQcm9jZXNzIGVudGl0eSBtZW51IGl0ZW1zXG4gICAgICAgIG1lbnVDb25maWdzLmZvckVhY2goaXRlbSA9PiB7XG4gICAgICAgICAgICBpZiAoaXRlbS5ncm91cCkge1xuICAgICAgICAgICAgICAgIGlmICghbWVudUdyb3Vwcy5oYXMoaXRlbS5ncm91cCkpIHtcbiAgICAgICAgICAgICAgICAgICAgbWVudUdyb3Vwcy5zZXQoaXRlbS5ncm91cCwgW10pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBtZW51R3JvdXBzLmdldChpdGVtLmdyb3VwKSEucHVzaChpdGVtKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdW5ncm91cGVkSXRlbXMucHVzaChpdGVtKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gUHJvY2VzcyBjdXN0b20gbWVudSBpdGVtc1xuICAgICAgICBpZiAobWVudUNvbmZpZz8ubWVudVBhZ2VDb25maWc/Lm1lbnVJdGVtcykge1xuICAgICAgICAgICAgbWVudUNvbmZpZy5tZW51UGFnZUNvbmZpZy5tZW51SXRlbXMuZm9yRWFjaCgoaXRlbTogYW55KSA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKGl0ZW0uZ3JvdXApIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFtZW51R3JvdXBzLmhhcyhpdGVtLmdyb3VwKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgbWVudUdyb3Vwcy5zZXQoaXRlbS5ncm91cCwgW10pO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIG1lbnVHcm91cHMuZ2V0KGl0ZW0uZ3JvdXApIS5wdXNoKGl0ZW0pO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHVuZ3JvdXBlZEl0ZW1zLnB1c2goaXRlbSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDcmVhdGUgZmluYWwgbWVudSBzdHJ1Y3R1cmVcbiAgICAgICAgY29uc3QgYWxsTWVudUl0ZW1zOiBhbnlbXSA9IFtdO1xuXG4gICAgICAgIC8vIEFkZCB1bmdyb3VwZWQgaXRlbXMgZmlyc3QgKHByaW1hcnkgbmF2aWdhdGlvbilcbiAgICAgICAgYWxsTWVudUl0ZW1zLnB1c2goLi4udW5ncm91cGVkSXRlbXMpO1xuXG4gICAgICAgIC8vIEFkZCBncm91cGVkIGl0ZW1zXG4gICAgICAgIG1lbnVHcm91cHMuZm9yRWFjaCgoaXRlbXMsIGdyb3VwTmFtZSkgPT4ge1xuICAgICAgICAgICAgLy8gU29ydCBpdGVtcyB3aXRoaW4gZ3JvdXAgYnkgb3JkZXJcbiAgICAgICAgICAgIGl0ZW1zLnNvcnQoKGEsIGIpID0+IChhLm9yZGVyIHx8IDApIC0gKGIub3JkZXIgfHwgMCkpO1xuXG4gICAgICAgICAgICAvLyBDcmVhdGUgZ3JvdXAgaXRlbVxuICAgICAgICAgICAgYWxsTWVudUl0ZW1zLnB1c2goe1xuICAgICAgICAgICAgICAgIGxhYmVsOiBncm91cE5hbWUsXG4gICAgICAgICAgICAgICAga2V5OiBgZ3JvdXAtJHtncm91cE5hbWV9YCxcbiAgICAgICAgICAgICAgICBpY29uOiAnRm9sZGVyT3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIGNoaWxkcmVuOiBpdGVtc1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGF3YWl0IHRoaXMud3JpdGVUb0ZpbGVzKGFsbE1lbnVJdGVtcywgZW50aXR5Q29uZmlncywgYXV0aENvbmZpZ3MsIGRhc2hib2FyZENvbmZpZyk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogVHJhbnNmb3JtIGxlZ2FjeSBmbGF0IGNvbmZpZyBzdHJ1Y3R1cmUgdG8gbmV3IG5lc3RlZCBzdHJ1Y3R1cmVcbiAgICAgKiBTdXBwb3J0cyBiYWNrd2FyZCBjb21wYXRpYmlsaXR5IGJ5IHRyYW5zZm9ybWluZyBvbGQgcHJvcGVydGllcyB0byBuZXcgZm9ybWF0XG4gICAgICovXG4gICAgcHJpdmF0ZSB0cmFuc2Zvcm1MZWdhY3lDb25maWcoc2NoZW1hOiBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4pOiBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4ge1xuICAgICAgICBjb25zdCBtb2RlbCA9IHNjaGVtYS5tb2RlbDtcblxuICAgICAgICAvLyBJZiBhbHJlYWR5IHVzaW5nIG5ldyBmb3JtYXQsIHJldHVybiBhcy1pc1xuICAgICAgICBpZiAobW9kZWwubGlzdFBhZ2VDb25maWcgfHwgbW9kZWwudmlld1BhZ2VDb25maWcgfHwgbW9kZWwuZWRpdFBhZ2VDb25maWcgfHwgbW9kZWwuY3JlYXRlUGFnZUNvbmZpZykge1xuICAgICAgICAgICAgcmV0dXJuIHNjaGVtYTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFRyYW5zZm9ybSBvbGQgZm9ybWF0IHRvIG5ldyBuZXN0ZWQgc3RydWN0dXJlXG4gICAgICAgIGNvbnN0IHRyYW5zZm9ybWVkTW9kZWwgPSB7XG4gICAgICAgICAgICAuLi5tb2RlbCxcbiAgICAgICAgICAgIC8vIExpc3QgcGFnZSB0cmFuc2Zvcm1hdGlvblxuICAgICAgICAgICAgbGlzdFBhZ2VDb25maWc6IChtb2RlbC5saXN0UGFnZUFjdGlvbnMgfHwgbW9kZWwubGlzdFBhZ2VCcmVhZGNydW1icyB8fCBtb2RlbC5saXN0UGFnZURlZmF1bHRTb3J0KVxuICAgICAgICAgICAgICAgID8ge1xuICAgICAgICAgICAgICAgICAgICBhY3Rpb25zOiBtb2RlbC5saXN0UGFnZUFjdGlvbnMsXG4gICAgICAgICAgICAgICAgICAgIGJyZWFkY3J1bWJzOiBtb2RlbC5saXN0UGFnZUJyZWFkY3J1bWJzLFxuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0U29ydDogbW9kZWwubGlzdFBhZ2VEZWZhdWx0U29ydFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICA6IHVuZGVmaW5lZCxcblxuICAgICAgICAgICAgLy8gVmlldyBwYWdlIHRyYW5zZm9ybWF0aW9uXG4gICAgICAgICAgICB2aWV3UGFnZUNvbmZpZzogKG1vZGVsLnZpZXdQYWdlQWN0aW9ucyB8fCBtb2RlbC52aWV3UGFnZUJyZWFkY3J1bWJzIHx8IG1vZGVsLnZpZXdQYWdlQ29sdW1uc0NvbmZpZylcbiAgICAgICAgICAgICAgICA/IHtcbiAgICAgICAgICAgICAgICAgICAgYWN0aW9uczogbW9kZWwudmlld1BhZ2VBY3Rpb25zLFxuICAgICAgICAgICAgICAgICAgICBicmVhZGNydW1iczogbW9kZWwudmlld1BhZ2VCcmVhZGNydW1icyxcbiAgICAgICAgICAgICAgICAgICAgY29sdW1uc0NvbmZpZzogbW9kZWwudmlld1BhZ2VDb2x1bW5zQ29uZmlnXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIDogdW5kZWZpbmVkLFxuXG4gICAgICAgICAgICAvLyBFZGl0IHBhZ2UgdHJhbnNmb3JtYXRpb25cbiAgICAgICAgICAgIGVkaXRQYWdlQ29uZmlnOiAobW9kZWwuZWRpdFBhZ2VBY3Rpb25zIHx8IG1vZGVsLmVkaXRQYWdlQnJlYWRjcnVtYnMgfHwgbW9kZWwuZWRpdFBhZ2VDb2x1bW5zQ29uZmlnKVxuICAgICAgICAgICAgICAgID8ge1xuICAgICAgICAgICAgICAgICAgICBhY3Rpb25zOiBtb2RlbC5lZGl0UGFnZUFjdGlvbnMsXG4gICAgICAgICAgICAgICAgICAgIGJyZWFkY3J1bWJzOiBtb2RlbC5lZGl0UGFnZUJyZWFkY3J1bWJzLFxuICAgICAgICAgICAgICAgICAgICBjb2x1bW5zQ29uZmlnOiBtb2RlbC5lZGl0UGFnZUNvbHVtbnNDb25maWdcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgOiB1bmRlZmluZWQsXG5cbiAgICAgICAgICAgIC8vIENyZWF0ZSBwYWdlIHRyYW5zZm9ybWF0aW9uXG4gICAgICAgICAgICBjcmVhdGVQYWdlQ29uZmlnOiAobW9kZWwuY3JlYXRlUGFnZUJyZWFkY3J1bWJzIHx8IG1vZGVsLmNyZWF0ZVBhZ2VDb2x1bW5zQ29uZmlnKVxuICAgICAgICAgICAgICAgID8ge1xuICAgICAgICAgICAgICAgICAgICBicmVhZGNydW1iczogbW9kZWwuY3JlYXRlUGFnZUJyZWFkY3J1bWJzLFxuICAgICAgICAgICAgICAgICAgICBjb2x1bW5zQ29uZmlnOiBtb2RlbC5jcmVhdGVQYWdlQ29sdW1uc0NvbmZpZ1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICA6IHVuZGVmaW5lZCxcbiAgICAgICAgfTtcblxuICAgICAgICByZXR1cm4geyAuLi5zY2hlbWEsIG1vZGVsOiB0cmFuc2Zvcm1lZE1vZGVsIH07XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ2hlY2sgZm9yIGRlcHJlY2F0ZWQgY29uZmlndXJhdGlvbiB1c2FnZSBhbmQgZW1pdCB3YXJuaW5nc1xuICAgICAqL1xuICAgIHByaXZhdGUgY2hlY2tEZXByZWNhdGVkVXNhZ2Uoc2NoZW1hOiBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4pOiB2b2lkIHtcbiAgICAgICAgY29uc3QgbW9kZWwgPSBzY2hlbWEubW9kZWw7XG4gICAgICAgIGNvbnN0IHdhcm5pbmdzOiBzdHJpbmdbXSA9IFtdO1xuXG4gICAgICAgIC8vIENoZWNrIGxpc3QgcGFnZSBkZXByZWNhdGVkIGZpZWxkc1xuICAgICAgICBpZiAobW9kZWwubGlzdFBhZ2VBY3Rpb25zKSB7XG4gICAgICAgICAgICB3YXJuaW5ncy5wdXNoKCdsaXN0UGFnZUFjdGlvbnMgaXMgZGVwcmVjYXRlZC4gVXNlIGxpc3RQYWdlQ29uZmlnLmFjdGlvbnMgaW5zdGVhZC4nKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAobW9kZWwubGlzdFBhZ2VCcmVhZGNydW1icykge1xuICAgICAgICAgICAgd2FybmluZ3MucHVzaCgnbGlzdFBhZ2VCcmVhZGNydW1icyBpcyBkZXByZWNhdGVkLiBVc2UgbGlzdFBhZ2VDb25maWcuYnJlYWRjcnVtYnMgaW5zdGVhZC4nKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAobW9kZWwubGlzdFBhZ2VEZWZhdWx0U29ydCkge1xuICAgICAgICAgICAgd2FybmluZ3MucHVzaCgnbGlzdFBhZ2VEZWZhdWx0U29ydCBpcyBkZXByZWNhdGVkLiBVc2UgbGlzdFBhZ2VDb25maWcuZGVmYXVsdFNvcnQgaW5zdGVhZC4nKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENoZWNrIHZpZXcgcGFnZSBkZXByZWNhdGVkIGZpZWxkc1xuICAgICAgICBpZiAobW9kZWwudmlld1BhZ2VBY3Rpb25zKSB7XG4gICAgICAgICAgICB3YXJuaW5ncy5wdXNoKCd2aWV3UGFnZUFjdGlvbnMgaXMgZGVwcmVjYXRlZC4gVXNlIHZpZXdQYWdlQ29uZmlnLmFjdGlvbnMgaW5zdGVhZC4nKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAobW9kZWwudmlld1BhZ2VCcmVhZGNydW1icykge1xuICAgICAgICAgICAgd2FybmluZ3MucHVzaCgndmlld1BhZ2VCcmVhZGNydW1icyBpcyBkZXByZWNhdGVkLiBVc2Ugdmlld1BhZ2VDb25maWcuYnJlYWRjcnVtYnMgaW5zdGVhZC4nKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAobW9kZWwudmlld1BhZ2VDb2x1bW5zQ29uZmlnKSB7XG4gICAgICAgICAgICB3YXJuaW5ncy5wdXNoKCd2aWV3UGFnZUNvbHVtbnNDb25maWcgaXMgZGVwcmVjYXRlZC4gVXNlIHZpZXdQYWdlQ29uZmlnLmNvbHVtbnNDb25maWcgaW5zdGVhZC4nKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENoZWNrIGVkaXQgcGFnZSBkZXByZWNhdGVkIGZpZWxkc1xuICAgICAgICBpZiAobW9kZWwuZWRpdFBhZ2VBY3Rpb25zKSB7XG4gICAgICAgICAgICB3YXJuaW5ncy5wdXNoKCdlZGl0UGFnZUFjdGlvbnMgaXMgZGVwcmVjYXRlZC4gVXNlIGVkaXRQYWdlQ29uZmlnLmFjdGlvbnMgaW5zdGVhZC4nKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAobW9kZWwuZWRpdFBhZ2VCcmVhZGNydW1icykge1xuICAgICAgICAgICAgd2FybmluZ3MucHVzaCgnZWRpdFBhZ2VCcmVhZGNydW1icyBpcyBkZXByZWNhdGVkLiBVc2UgZWRpdFBhZ2VDb25maWcuYnJlYWRjcnVtYnMgaW5zdGVhZC4nKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAobW9kZWwuZWRpdFBhZ2VDb2x1bW5zQ29uZmlnKSB7XG4gICAgICAgICAgICB3YXJuaW5ncy5wdXNoKCdlZGl0UGFnZUNvbHVtbnNDb25maWcgaXMgZGVwcmVjYXRlZC4gVXNlIGVkaXRQYWdlQ29uZmlnLmNvbHVtbnNDb25maWcgaW5zdGVhZC4nKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENoZWNrIGNyZWF0ZSBwYWdlIGRlcHJlY2F0ZWQgZmllbGRzXG4gICAgICAgIGlmIChtb2RlbC5jcmVhdGVQYWdlQnJlYWRjcnVtYnMpIHtcbiAgICAgICAgICAgIHdhcm5pbmdzLnB1c2goJ2NyZWF0ZVBhZ2VCcmVhZGNydW1icyBpcyBkZXByZWNhdGVkLiBVc2UgY3JlYXRlUGFnZUNvbmZpZy5icmVhZGNydW1icyBpbnN0ZWFkLicpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChtb2RlbC5jcmVhdGVQYWdlQ29sdW1uc0NvbmZpZykge1xuICAgICAgICAgICAgd2FybmluZ3MucHVzaCgnY3JlYXRlUGFnZUNvbHVtbnNDb25maWcgaXMgZGVwcmVjYXRlZC4gVXNlIGNyZWF0ZVBhZ2VDb25maWcuY29sdW1uc0NvbmZpZyBpbnN0ZWFkLicpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRW1pdCB3YXJuaW5ncyBpZiBhbnkgZGVwcmVjYXRlZCBmaWVsZHMgZm91bmRcbiAgICAgICAgaWYgKHdhcm5pbmdzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYFxcbuKaoO+4jyAgRW50aXR5IFwiJHttb2RlbC5lbnRpdHl9XCIgdXNlcyBkZXByZWNhdGVkIGNvbmZpZ3VyYXRpb246YCk7XG4gICAgICAgICAgICB3YXJuaW5ncy5mb3JFYWNoKHcgPT4gdGhpcy5sb2dnZXIud2FybihgICAgLSAke3d9YCkpO1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgICAg8J+TliBNaWdyYXRpb24gZ3VpZGU6IGh0dHBzOi8vZG9jcy5mdzI0LmlvL21pZ3JhdGlvbi9uZXN0ZWQtY29uZmlnXFxuYCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBATG9nRHVyYXRpb24oKVxuICAgIHByZXBhcmVTZXJ2aWNlc0RpcmVjdG9yaWVzKCkge1xuICAgICAgICBjb25zdCBmdzI0ID0gRncyNC5nZXRJbnN0YW5jZSgpO1xuXG4gICAgICAgIGNvbnN0IHNlcnZpY2VEaXJlY3RvcmllcyA9IFsgcGF0aFJlc29sdmUoJy4vc3JjL3NlcnZpY2VzLycpIF07XG5cbiAgICAgICAgaWYgKGZ3MjQuaGFzTW9kdWxlcygpKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgVWktY29uZmlnLWdlbjo6OiBQcm9jZXNzOjo6IGFwcCBoYXMgbW9kdWxlczogYCwgQXJyYXkuZnJvbShmdzI0LmdldE1vZHVsZXMoKS5rZXlzKCkpKTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgWyAsIG1vZHVsZSBdIG9mIGZ3MjQuZ2V0TW9kdWxlcygpKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgbW9kdWxlU2VydmljZXNQYXRoID0gcGF0aEpvaW4obW9kdWxlLmdldEJhc2VQYXRoKCksIG1vZHVsZS5nZXRTZXJ2aWNlc0RpcmVjdG9yeSgpKTtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgVWktY29uZmlnLWdlbjo6OiBQcm9jZXNzOjo6IG1vZHVsZVNlcnZpY2VzUGF0aDogYCwgbW9kdWxlU2VydmljZXNQYXRoKTtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgVWktY29uZmlnLWdlbjo6OiBQcm9jZXNzOjo6IHJlcy1tb2R1bGVTZXJ2aWNlc1BhdGg6IGAsIHBhdGhSZXNvbHZlKG1vZHVsZVNlcnZpY2VzUGF0aCkpO1xuICAgICAgICAgICAgICAgIHNlcnZpY2VEaXJlY3Rvcmllcy5wdXNoKHBhdGhSZXNvbHZlKG1vZHVsZVNlcnZpY2VzUGF0aCkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHNlcnZpY2VEaXJlY3RvcmllcztcbiAgICB9XG5cbiAgICBATG9nRHVyYXRpb24oKVxuICAgIGFzeW5jIHNjYW5BbmRMb2FkU2VydmljZXMoc2VydmljZURpcmVjdG9yaWVzOiBBcnJheTxzdHJpbmc+KSB7XG5cbiAgICAgICAgY29uc3Qgc2Nhbm5lZFNlcnZpY2VzID0gbmV3IFNldDxGdW5jdGlvbj4oKTtcblxuICAgICAgICBmb3IgKGNvbnN0IGRpciBvZiBzZXJ2aWNlRGlyZWN0b3JpZXMpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBVaS1jb25maWctZ2VuOjo6IFByb2Nlc3M6OjogbG9hZGluZyBzZXJ2aWNlcyBmcm9tIERJUjogYCwgZGlyKTtcbiAgICAgICAgICAgIGNvbnN0IGRpclNlcnZpY2VUb2tlbnMgPSBhd2FpdCB0aGlzLnNjYW5TZXJ2aWNlc0Zyb21EaXJlY3RvcnkoZGlyKTtcbiAgICAgICAgICAgIGRpclNlcnZpY2VUb2tlbnMuZm9yRWFjaCh0b2tlbiA9PiBzY2FubmVkU2VydmljZXMuYWRkKHRva2VuKSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBnZXQgYWxsIGNvbnRhaW5lciByZWdpc3RlcmVkIHNlcnZpY2VzIHRvIG1ha2Ugc3VyZSBhdXRvLWdlbiBlbnRpdHktc2VydmljZXMgYXJlIGFsc28gaW5jbHVkZWRcbiAgICAgICAgdGhpcy51aUdlbkRJQ29udGFpbmVyLmNvbGxlY3RCZXN0UHJvdmlkZXJzRm9yKHtcbiAgICAgICAgICAgIHR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgICAgICAgIGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnM6IHRydWVcbiAgICAgICAgfSkuZmlsdGVyKG9wdCA9PiB7XG4gICAgICAgICAgICAvLyBtYWtlIHN1cmUgdG8gY29sbGVjdCBvbmx5IHRoZSBlbnRpdHkgc2VydmljZSBwcm92aWRlcnNcbiAgICAgICAgICAgIHJldHVybiAhIW9wdC5fcHJvdmlkZXIuZm9yRW50aXR5XG4gICAgICAgIH0pLmZvckVhY2gob3B0ID0+IHtcbiAgICAgICAgICAgIHNjYW5uZWRTZXJ2aWNlcy5hZGQob3B0Ll9wcm92aWRlci5wcm92aWRlIGFzIEZ1bmN0aW9uKTtcbiAgICAgICAgfSlcblxuICAgICAgICAvLyByZXNvbHZlIGFsbCBzZXJ2aWNlc1xuICAgICAgICBjb25zdCByZXNvbHZlZFNlcnZpY2VzID0gbmV3IE1hcDxzdHJpbmcsIEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4+KCk7XG5cbiAgICAgICAgc2Nhbm5lZFNlcnZpY2VzLmZvckVhY2godG9rZW4gPT4ge1xuICAgICAgICAgICAgY29uc3Qgc2VydmljZSA9IHRoaXMudWlHZW5ESUNvbnRhaW5lci5yZXNvbHZlKHRva2VuLCB7XG4gICAgICAgICAgICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVyczogdHJ1ZVxuICAgICAgICAgICAgfSkgYXMgQmFzZUVudGl0eVNlcnZpY2U8YW55PjtcblxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYHJlc29sdmVkIHNlcnZpY2UgZm9yIGVudGl0eTogJHtzZXJ2aWNlLmdldEVudGl0eU5hbWUoKX1gKTtcblxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFVpLWNvbmZpZy1nZW46OjogUHJvY2Vzczo6OiBsb2FkZWQgc2VydmljZXMgZnJvbSBlbnRpdHk6IGAsIHNlcnZpY2UuZ2V0RW50aXR5TmFtZSgpKTtcbiAgICAgICAgICAgIHJlc29sdmVkU2VydmljZXMuc2V0KHNlcnZpY2UuZ2V0RW50aXR5TmFtZSgpLCBzZXJ2aWNlKTtcbiAgICAgICAgfSlcblxuICAgICAgICByZXR1cm4gcmVzb2x2ZWRTZXJ2aWNlcztcbiAgICB9XG5cbiAgICBATG9nRHVyYXRpb24oKVxuICAgIGFzeW5jIHNjYW5TZXJ2aWNlc0Zyb21EaXJlY3Rvcnkoc2VydmljZXNEaXI6IHN0cmluZykge1xuXG4gICAgICAgIGNvbnN0IHNjYW5uZWRTZXJ2aWNlcyA9IG5ldyBTZXQ8RnVuY3Rpb24+KCk7XG5cbiAgICAgICAgaWYgKCFleGlzdHNTeW5jKHNlcnZpY2VzRGlyKSkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIud2Fybihgc2NhblNlcnZpY2VzRnJvbURpcmVjdG9yeTogc2VydmljZXNEaXIgZG9lcyBub3QgZXhpc3RzOiAke3NlcnZpY2VzRGlyfWApO1xuICAgICAgICAgICAgcmV0dXJuIHNjYW5uZWRTZXJ2aWNlcztcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHNlcnZpY2VQYXRocyA9IEhlbHBlci5zY2FuQ29udHJvbGxlclNvdXJjZUZpbGVzRnJvbShzZXJ2aWNlc0Rpcik7XG5cbiAgICAgICAgZm9yIChjb25zdCBzZXJ2aWNlUGF0aCBvZiBzZXJ2aWNlUGF0aHMpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGB0cnlpbmcgdG8gbG9hZCBzZXJ2aWNlUGF0aDogJHtzZXJ2aWNlUGF0aH1gKTtcblxuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAvLyBEeW5hbWljYWxseSBpbXBvcnQgdGhlIHNlcnZpY2UgZmlsZVxuICAgICAgICAgICAgICAgIGNvbnN0IG1vZHVsZSA9IGF3YWl0IGltcG9ydChwYXRoSm9pbihzZXJ2aWNlc0Rpciwgc2VydmljZVBhdGgpKTtcblxuICAgICAgICAgICAgICAgIC8vIEZpbmQgYW5kIGluc3RhbnRpYXRlIHNlcnZpY2UgY2xhc3Nlc1xuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgZXhwb3J0ZWRJdGVtIG9mIE9iamVjdC52YWx1ZXMobW9kdWxlKSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoXG4gICAgICAgICAgICAgICAgICAgICAgICBleHBvcnRlZEl0ZW1cbiAgICAgICAgICAgICAgICAgICAgICAgICYmIHR5cGVvZiBleHBvcnRlZEl0ZW0gPT09ICdmdW5jdGlvbidcbiAgICAgICAgICAgICAgICAgICAgICAgICYmICdwcm90b3R5cGUnIGluIGV4cG9ydGVkSXRlbVxuICAgICAgICAgICAgICAgICAgICAgICAgJiYgZXhwb3J0ZWRJdGVtLnByb3RvdHlwZSBpbnN0YW5jZW9mIEJhc2VFbnRpdHlTZXJ2aWNlXG4gICAgICAgICAgICAgICAgICAgICkge1xuXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy51aUdlbkRJQ29udGFpbmVyLmhhcyhleHBvcnRlZEl0ZW0sIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnc2VydmljZScsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVyczogdHJ1ZVxuICAgICAgICAgICAgICAgICAgICAgICAgfSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzY2FubmVkU2VydmljZXMuYWRkKGV4cG9ydGVkSXRlbSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYHNjYW5TZXJ2aWNlc0Zyb21EaXJlY3Rvcnk6IHJlZ2lzdGVyaW5nIHNlcnZpY2U6ICR7ZXhwb3J0ZWRJdGVtLm5hbWV9YCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBzY2FuU2VydmljZXNGcm9tRGlyZWN0b3J5OiBubyBwcm92aWRlciBjb3VsZCBiZSBmb3VuZCBmb3Igc2VydmljZTogJHtleHBvcnRlZEl0ZW0ubmFtZX1gKTtcblxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1Zyhgc2NhblNlcnZpY2VzRnJvbURpcmVjdG9yeTogU0tJUDogZXhwb3J0ZWRJdGVtIGlzIG5vdCBhIHNlcnZpY2UgY2xhc3M6ICR7KGV4cG9ydGVkSXRlbSBhcyBhbnkpPy5uYW1lID8gKGV4cG9ydGVkSXRlbSBhcyBhbnkpLm5hbWUgOiBleHBvcnRlZEl0ZW19YCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYHNjYW5TZXJ2aWNlc0Zyb21EaXJlY3Rvcnk6IEV4Y2VwdGlvbiB3aGlsZSB0cnlpbmcgdG8gbG9hZCBzZXJ2aWNlUGF0aDogJHtzZXJ2aWNlUGF0aH1gLCBlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBzY2FubmVkU2VydmljZXM7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogV3JpdGUgSlNPTiBjb25maWcgZmlsZSBhbmQgY3JlYXRlIGNvbXByZXNzZWQgdmVyc2lvbnMgKGd6aXAgYW5kIGJyb3RsaSlcbiAgICAgKiBmb3IgYnJvd3Nlci1jb21wYXRpYmxlIGRlbGl2ZXJ5XG4gICAgICovXG4gICAgcHJpdmF0ZSB3cml0ZUNvbmZpZ0ZpbGUoZmlsZVBhdGg6IHN0cmluZywgZGF0YTogYW55LCBjb25maWdOYW1lOiBzdHJpbmcpIHtcbiAgICAgICAgY29uc3QganNvblN0cmluZyA9IEpTT04uc3RyaW5naWZ5KGRhdGEsIG51bGwsIDIpO1xuICAgICAgICBjb25zdCBqc29uQnVmZmVyID0gQnVmZmVyLmZyb20oanNvblN0cmluZywgJ3V0Zi04Jyk7XG5cbiAgICAgICAgLy8gV3JpdGUgb3JpZ2luYWwgSlNPTiBmaWxlXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGB3cml0aW5nICR7Y29uZmlnTmFtZX0gY29uZmlnLi4gaW50bzogJHtmaWxlUGF0aH1gKTtcbiAgICAgICAgd3JpdGVGaWxlU3luYyhmaWxlUGF0aCwganNvblN0cmluZyk7XG5cbiAgICAgICAgLy8gV3JpdGUgZ3ppcCBjb21wcmVzc2VkIHZlcnNpb25cbiAgICAgICAgY29uc3QgZ3ppcEZpbGVQYXRoID0gYCR7ZmlsZVBhdGh9Lmd6YDtcbiAgICAgICAgY29uc3QgZ3ppcENvbXByZXNzZWQgPSBnemlwU3luYyhqc29uQnVmZmVyLCB7IGxldmVsOiBjb25zdGFudHMuWl9CRVNUX0NPTVBSRVNTSU9OIH0pO1xuICAgICAgICB3cml0ZUZpbGVTeW5jKGd6aXBGaWxlUGF0aCwgZ3ppcENvbXByZXNzZWQpO1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1Zyhgd3JpdGluZyAke2NvbmZpZ05hbWV9IGNvbmZpZyAoZ3ppcCkuLiBpbnRvOiAke2d6aXBGaWxlUGF0aH1gKTtcblxuICAgICAgICAvLyBXcml0ZSBicm90bGkgY29tcHJlc3NlZCB2ZXJzaW9uXG4gICAgICAgIGNvbnN0IGJyb3RsaUZpbGVQYXRoID0gYCR7ZmlsZVBhdGh9LmJyYDtcbiAgICAgICAgY29uc3QgYnJvdGxpQ29tcHJlc3NlZCA9IGJyb3RsaUNvbXByZXNzU3luYyhqc29uQnVmZmVyLCB7XG4gICAgICAgICAgICBwYXJhbXM6IHtcbiAgICAgICAgICAgICAgICBbIGNvbnN0YW50cy5CUk9UTElfUEFSQU1fUVVBTElUWSBdOiBjb25zdGFudHMuQlJPVExJX01BWF9RVUFMSVRZICAvLyBNYXggcXVhbGl0eSAoMC0xMSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIHdyaXRlRmlsZVN5bmMoYnJvdGxpRmlsZVBhdGgsIGJyb3RsaUNvbXByZXNzZWQpO1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1Zyhgd3JpdGluZyAke2NvbmZpZ05hbWV9IGNvbmZpZyAoYnJvdGxpKS4uIGludG86ICR7YnJvdGxpRmlsZVBhdGh9YCk7XG5cbiAgICAgICAgLy8gTG9nIGNvbXByZXNzaW9uIHJhdGlvc1xuICAgICAgICBjb25zdCBvcmlnaW5hbFNpemUgPSBqc29uQnVmZmVyLmxlbmd0aDtcbiAgICAgICAgY29uc3QgZ3ppcFNpemUgPSBnemlwQ29tcHJlc3NlZC5sZW5ndGg7XG4gICAgICAgIGNvbnN0IGJyb3RsaVNpemUgPSBicm90bGlDb21wcmVzc2VkLmxlbmd0aDtcbiAgICAgICAgY29uc3QgZ3ppcFJhdGlvID0gKCgxIC0gZ3ppcFNpemUgLyBvcmlnaW5hbFNpemUpICogMTAwKS50b0ZpeGVkKDIpO1xuICAgICAgICBjb25zdCBicm90bGlSYXRpbyA9ICgoMSAtIGJyb3RsaVNpemUgLyBvcmlnaW5hbFNpemUpICogMTAwKS50b0ZpeGVkKDIpO1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oXG4gICAgICAgICAgICBgJHtjb25maWdOYW1lfSBjb21wcmVzc2lvbiBzdGF0czogYCArXG4gICAgICAgICAgICBgb3JpZ2luYWw6ICR7b3JpZ2luYWxTaXplfWIsIGAgK1xuICAgICAgICAgICAgYGd6aXA6ICR7Z3ppcFNpemV9YiAoJHtnemlwUmF0aW99JSBzbWFsbGVyKSwgYCArXG4gICAgICAgICAgICBgYnJvdGxpOiAke2Jyb3RsaVNpemV9YiAoJHticm90bGlSYXRpb30lIHNtYWxsZXIpYFxuICAgICAgICApO1xuICAgIH1cblxuICAgIEBMb2dEdXJhdGlvbigpXG4gICAgYXN5bmMgd3JpdGVUb0ZpbGVzKG1lbnVDb25maWc6IGFueSwgZW50aXRpZXNDb25maWc6IGFueSwgYXV0aENvbmZpZzogYW55LCBkYXNoYm9hcmRDb25maWc6IGFueSkge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkNhbGxlZCB3cml0ZVRvRmlsZXM6Ojo6OjogXCIpO1xuICAgICAgICBjb25zdCBnZW5EaXJlY3RvcnlQYXRoID0gcGF0aFJlc29sdmUoJy4vZ2VuLycpO1xuICAgICAgICBpZiAoIWV4aXN0c1N5bmMoZ2VuRGlyZWN0b3J5UGF0aCkpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBHZW4gRElSIGRvZXMgbm90IGV4aXN0cywgY3JlYXRpbmc6ICR7Z2VuRGlyZWN0b3J5UGF0aH1gLCk7XG4gICAgICAgICAgICBta2RpclN5bmMoZ2VuRGlyZWN0b3J5UGF0aCk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBjb25maWdEaXJlY3RvcnlQYXRoID0gcGF0aFJlc29sdmUocGF0aEpvaW4oZ2VuRGlyZWN0b3J5UGF0aCwgJ2NvbmZpZycpKTtcbiAgICAgICAgaWYgKCFleGlzdHNTeW5jKGNvbmZpZ0RpcmVjdG9yeVBhdGgpKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQ29uZmlnIERJUiBkb2VzIG5vdCBleGlzdHMsIGNyZWF0aW5nOiAke2NvbmZpZ0RpcmVjdG9yeVBhdGh9YCk7XG4gICAgICAgICAgICBta2RpclN5bmMoY29uZmlnRGlyZWN0b3J5UGF0aCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBXcml0ZSBtZW51IGNvbmZpZyB3aXRoIGNvbXByZXNzZWQgdmVyc2lvbnNcbiAgICAgICAgY29uc3QgbWVudUNvbmZpZ0ZpbGVQYXRoID0gcGF0aEpvaW4oY29uZmlnRGlyZWN0b3J5UGF0aCwgJ21lbnUuanNvbicpO1xuICAgICAgICB0aGlzLndyaXRlQ29uZmlnRmlsZShtZW51Q29uZmlnRmlsZVBhdGgsIG1lbnVDb25maWcsICdtZW51Jyk7XG5cbiAgICAgICAgLy8gV3JpdGUgZW50aXRpZXMgY29uZmlnIHdpdGggY29tcHJlc3NlZCB2ZXJzaW9uc1xuICAgICAgICBjb25zdCBlbnRpdGllc0NvbmZpZ0ZpbGVQYXRoID0gcGF0aEpvaW4oY29uZmlnRGlyZWN0b3J5UGF0aCwgJ2VudGl0aWVzLmpzb24nKTtcbiAgICAgICAgdGhpcy53cml0ZUNvbmZpZ0ZpbGUoZW50aXRpZXNDb25maWdGaWxlUGF0aCwgZW50aXRpZXNDb25maWcsICdlbnRpdGllcycpO1xuXG4gICAgICAgIC8vIFdyaXRlIGF1dGggY29uZmlnIHdpdGggY29tcHJlc3NlZCB2ZXJzaW9uc1xuICAgICAgICBjb25zdCBhdXRoQ29uZmlnRmlsZVBhdGggPSBwYXRoSm9pbihjb25maWdEaXJlY3RvcnlQYXRoLCAnYXV0aC5qc29uJyk7XG4gICAgICAgIHRoaXMud3JpdGVDb25maWdGaWxlKGF1dGhDb25maWdGaWxlUGF0aCwgYXV0aENvbmZpZywgJ2F1dGgnKTtcblxuICAgICAgICAvLyBXcml0ZSBkYXNoYm9hcmQgY29uZmlnIHdpdGggY29tcHJlc3NlZCB2ZXJzaW9uc1xuICAgICAgICBjb25zdCBkYXNoYm9hcmRDb25maWdGaWxlUGF0aCA9IHBhdGhKb2luKGNvbmZpZ0RpcmVjdG9yeVBhdGgsICdkYXNoYm9hcmQuanNvbicpO1xuICAgICAgICB0aGlzLndyaXRlQ29uZmlnRmlsZShkYXNoYm9hcmRDb25maWdGaWxlUGF0aCwgZGFzaGJvYXJkQ29uZmlnLCAnZGFzaGJvYXJkJyk7XG5cbiAgICB9XG59XG5cbiJdfQ==