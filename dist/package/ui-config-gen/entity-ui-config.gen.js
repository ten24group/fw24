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
                }, service);
                entityConfigs[`create-${entityName.toLowerCase()}`] = createConfig;
            }
            if (!entitySchema.model.excludeFromAdminUpdate) {
                const updateConfig = (0, update_entity_1.default)({
                    entityName,
                    entityNamePlural: entitySchema.model.entityNamePlural,
                    CRUDApiPath: entitySchema.model.CRUDApiPath,
                    properties: entityDefaultOpsSchema.update.input,
                    // Use new nested config if available, fallback to old
                    actions: entitySchema.model.editPageConfig?.actions || entitySchema.model.editPageActions,
                    breadcrumbs: entitySchema.model.editPageConfig?.breadcrumbs || entitySchema.model.editPageBreadcrumbs,
                    columnsConfig: entitySchema.model.editPageConfig?.columnsConfig || entitySchema.model.editPageColumnsConfig,
                    formConfig: entitySchema.model.editPageConfig?.formConfig,
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
                    // Legacy sort fallback (tableConfig.defaultSort is handled directly in list-entity.ts)
                    defaultSort: entitySchema.model.listPageConfig?.defaultSort ?? entitySchema.model.listPageDefaultSort,
                    tableConfig: entitySchema.model.listPageConfig?.tableConfig,
                    globalUIConfigOptions,
                    hasObservability,
                }, service);
                entityConfigs[`list-${entityName.toLowerCase()}`] = listConfig;
            }
            if (!entitySchema.model.excludeFromAdminDetail) {
                const viewConfig = (0, view_entity_1.default)({
                    entityName,
                    entityNamePlural: entitySchema.model.entityNamePlural,
                    properties: entityDefaultOpsSchema.get.output,
                    CRUDApiPath: entitySchema.model.CRUDApiPath,
                    // Use new nested config if available, fallback to old
                    actions: entitySchema.model.viewPageConfig?.actions || entitySchema.model.viewPageActions,
                    breadcrumbs: entitySchema.model.viewPageConfig?.breadcrumbs || entitySchema.model.viewPageBreadcrumbs,
                    columnsConfig: entitySchema.model.viewPageConfig?.columnsConfig || entitySchema.model.viewPageColumnsConfig,
                    fields: entitySchema.model.viewPageConfig?.fields,
                    sectionsConfig: entitySchema.model.viewPageConfig?.sectionsConfig,
                    globalUIConfigOptions,
                    hasObservability,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW50aXR5LXVpLWNvbmZpZy5nZW4uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdWktY29uZmlnLWdlbi9lbnRpdHktdWktY29uZmlnLmdlbi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFDQSw4RUFBK0Q7QUFDL0QsOEVBQStEO0FBQy9ELDBFQUEyRDtBQUMzRCwwRUFBMkQ7QUFDM0QsMEVBQTJEO0FBQzNELHNDQUE0RDtBQUM1RCx5REFBMEo7QUFFMUosNERBQThDO0FBQzlDLHNFQUF3RDtBQUV4RCwyQkFBMEQ7QUFDMUQsK0JBQStEO0FBQy9ELCtCQUdjO0FBRWQsdUNBQW9DO0FBQ3BDLDJDQUF3QztBQUN4Qyx3Q0FBdUQ7QUFDdkQsMENBQXdDO0FBRXhDLE1BQWEsaUJBQWlCO0lBQ2pCLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsaUJBQWlCLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDdkQsOEZBQThGO0lBQzlGLG1DQUFtQztJQUMxQixnQkFBZ0IsR0FBRyxXQUFJLENBQUMsV0FBVyxFQUFFLENBQUMsaUJBQWlCLEVBQUUsQ0FBQztJQUVsRCxXQUFXLEdBQW1DLElBQUksR0FBRyxFQUFFLENBQUM7SUFHbkUsQUFBTixLQUFLLENBQUMsZUFBZTtRQUNqQixNQUFNLElBQUksR0FBRyxXQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7UUFDaEMsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFDO1FBQ2hDLE1BQU0sY0FBYyxHQUFHLE1BQU0sQ0FBQyxrQkFBa0IsRUFBRSxvQkFBb0IsSUFBSSxjQUFjLENBQUM7UUFFekYsTUFBTSxzQkFBc0IsR0FBRyxDQUFFLElBQUEsY0FBVyxFQUFDLFNBQVMsY0FBYyxHQUFHLENBQUMsQ0FBRSxDQUFDO1FBRTNFLElBQUksSUFBSSxDQUFDLFVBQVUsRUFBRSxFQUFFLENBQUM7WUFD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QztRQUU3RCxrREFBa0Q7UUFDbEQsTUFBTSx1QkFBdUIsR0FBRyxJQUFBLFdBQVEsRUFBQyxtQkFBbUIsRUFBRSxnQkFBZ0IsQ0FBQyxDQUFDO1FBQ2hGLElBQUksQ0FBQyxlQUFlLENBQUMsdUJBQXVCLEVBQUUsZUFBZSxFQUFFLFdBQVcsQ0FBQyxDQUFDO0lBRWhGLENBQUM7Q0FDSjtBQTFuQkQsOENBMG5CQztBQWpuQlM7SUFETCxJQUFBLHFCQUFXLEdBQUU7d0RBK0NiO0FBdUVLO0lBREwsSUFBQSxxQkFBVyxHQUFFO2dEQW9OYjtBQWlIRDtJQURDLElBQUEscUJBQVcsR0FBRTttRUFpQmI7QUFHSztJQURMLElBQUEscUJBQVcsR0FBRTs0REFxQ2I7QUFHSztJQURMLElBQUEscUJBQVcsR0FBRTtrRUFrRGI7QUE4Q0s7SUFETCxJQUFBLHFCQUFXLEdBQUU7cURBK0JiIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgdHlwZSB9IGZyb20gJ29zJztcbmltcG9ydCBNYWtlQ3JlYXRlRW50aXR5Q29uZmlnIGZyb20gJy4vdGVtcGxhdGVzL2NyZWF0ZS1lbnRpdHknO1xuaW1wb3J0IE1ha2VVcGRhdGVFbnRpdHlDb25maWcgZnJvbSAnLi90ZW1wbGF0ZXMvdXBkYXRlLWVudGl0eSc7XG5pbXBvcnQgTWFrZUxpc3RFbnRpdHlDb25maWcgZnJvbSAnLi90ZW1wbGF0ZXMvbGlzdC1lbnRpdHknO1xuaW1wb3J0IE1ha2VWaWV3RW50aXR5Q29uZmlnIGZyb20gJy4vdGVtcGxhdGVzL3ZpZXctZW50aXR5JztcbmltcG9ydCBNYWtlRW50aXR5TWVudUNvbmZpZyBmcm9tICcuL3RlbXBsYXRlcy9lbnRpdHktbWVudSc7XG5pbXBvcnQgeyBCYXNlRW50aXR5U2VydmljZSwgRW50aXR5U2NoZW1hIH0gZnJvbSAnLi4vZW50aXR5JztcbmltcG9ydCB7IG1ha2VDdXN0b21QYWdlQ29uZmlnLCBDdXN0b21QYWdlT3B0aW9ucywgTGlzdFBhZ2VDb25maWcsIEZvcm1QYWdlQ29uZmlnLCBEZXRhaWxzUGFnZUNvbmZpZywgRGFzaGJvYXJkUGFnZUNvbmZpZyB9IGZyb20gJy4vdGVtcGxhdGVzL2N1c3RvbS1wYWdlJztcblxuaW1wb3J0IE1ha2VBdXRoQ29uZmlnIGZyb20gJy4vdGVtcGxhdGVzL2F1dGgnO1xuaW1wb3J0IE1ha2VEYXNoYm9hcmRDb25maWcgZnJvbSAnLi90ZW1wbGF0ZXMvZGFzaGJvYXJkJztcblxuaW1wb3J0IHsgZXhpc3RzU3luYywgbWtkaXJTeW5jLCB3cml0ZUZpbGVTeW5jIH0gZnJvbSBcImZzXCI7XG5pbXBvcnQgeyBnemlwU3luYywgYnJvdGxpQ29tcHJlc3NTeW5jLCBjb25zdGFudHMgfSBmcm9tIFwiemxpYlwiO1xuaW1wb3J0IHtcbiAgICByZXNvbHZlIGFzIHBhdGhSZXNvbHZlLFxuICAgIGpvaW4gYXMgcGF0aEpvaW5cbn0gZnJvbSBcInBhdGhcIjtcblxuaW1wb3J0IHsgRncyNCB9IGZyb20gJy4uL2NvcmUvZncyNCc7XG5pbXBvcnQgeyBIZWxwZXIgfSBmcm9tICcuLi9jb3JlL2hlbHBlcic7XG5pbXBvcnQgeyBMb2dEdXJhdGlvbiwgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi4vbG9nZ2luZyc7XG5pbXBvcnQgeyB0b1NsdWcgfSBmcm9tICcuLi91dGlscy9jYXNlcyc7XG5cbmV4cG9ydCBjbGFzcyBFbnRpdHlVSUNvbmZpZ0dlbiB7XG4gICAgcmVhZG9ubHkgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKEVudGl0eVVJQ29uZmlnR2VuLm5hbWUpO1xuICAgIC8vIG1ha2Ugc3VyZSB0byBjcmVhdGUgYSBjaGlsZCBjb250YWluZXIgdG8gbm90IHBvbGx1dGUgYW55dGhpbmcgaW4gdGhlIEFwcGxpY2F0aW9uIGNvbnRhaW5lciBcbiAgICAvLyB3aGlsZSBzY2FubmluZyBhbmQgbG9hZGluZyBzdHVmZlxuICAgIHJlYWRvbmx5IHVpR2VuRElDb250YWluZXIgPSBGdzI0LmdldEluc3RhbmNlKCkuZ2V0QXBwRElDb250YWluZXIoKTtcblxuICAgIHByaXZhdGUgcmVhZG9ubHkgY3VzdG9tUGFnZXM6IE1hcDxzdHJpbmcsIEN1c3RvbVBhZ2VPcHRpb25zPiA9IG5ldyBNYXAoKTtcblxuICAgIEBMb2dEdXJhdGlvbigpXG4gICAgYXN5bmMgc2NhbkN1c3RvbVBhZ2VzKCkge1xuICAgICAgICBjb25zdCBmdzI0ID0gRncyNC5nZXRJbnN0YW5jZSgpO1xuICAgICAgICBjb25zdCBjb25maWcgPSBmdzI0LmdldENvbmZpZygpO1xuICAgICAgICBjb25zdCBjdXN0b21QYWdlc0RpciA9IGNvbmZpZy51aUNvbmZpZ0dlbk9wdGlvbnM/LmN1c3RvbVBhZ2VzRGlyZWN0b3J5IHx8ICdjdXN0b20tcGFnZXMnO1xuXG4gICAgICAgIGNvbnN0IGN1c3RvbVBhZ2VzRGlyZWN0b3JpZXMgPSBbIHBhdGhSZXNvbHZlKGAuL3NyYy8ke2N1c3RvbVBhZ2VzRGlyfS9gKSBdO1xuXG4gICAgICAgIGlmIChmdzI0Lmhhc01vZHVsZXMoKSkge1xuICAgICAgICAgICAgZm9yIChjb25zdCBbICwgbW9kdWxlIF0gb2YgZncyNC5nZXRNb2R1bGVzKCkpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBtb2R1bGVDdXN0b21QYWdlc1BhdGggPSBwYXRoSm9pbihtb2R1bGUuZ2V0QmFzZVBhdGgoKSwgY3VzdG9tUGFnZXNEaXIpO1xuICAgICAgICAgICAgICAgIGN1c3RvbVBhZ2VzRGlyZWN0b3JpZXMucHVzaChwYXRoUmVzb2x2ZShtb2R1bGVDdXN0b21QYWdlc1BhdGgpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHJlZ2lzdGVyZWRQYWdlczogc3RyaW5nW10gPSBbXTtcblxuICAgICAgICBmb3IgKGNvbnN0IGRpciBvZiBjdXN0b21QYWdlc0RpcmVjdG9yaWVzKSB7XG4gICAgICAgICAgICBpZiAoIWV4aXN0c1N5bmMoZGlyKSkge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDdXN0b20gcGFnZXMgZGlyZWN0b3J5IGRvZXMgbm90IGV4aXN0OiAke2Rpcn1gKTtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgY3VzdG9tUGFnZUZpbGVzID0gSGVscGVyLnNjYW5Db250cm9sbGVyU291cmNlRmlsZXNGcm9tKGRpcik7XG5cbiAgICAgICAgICAgIGZvciAoY29uc3QgZmlsZSBvZiBjdXN0b21QYWdlRmlsZXMpIHtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBtb2R1bGUgPSBhd2FpdCBpbXBvcnQocGF0aEpvaW4oZGlyLCBmaWxlKSk7XG4gICAgICAgICAgICAgICAgICAgIGZvciAoY29uc3QgWyBfLCB2YWx1ZSBdIG9mIE9iamVjdC5lbnRyaWVzKG1vZHVsZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLmlzVmFsaWRDdXN0b21QYWdlQ29uZmlnKHZhbHVlKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHBhZ2VOYW1lID0gdGhpcy5nZXRQYWdlTmFtZUZyb21Db25maWcodmFsdWUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChwYWdlTmFtZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnJlZ2lzdGVyQ3VzdG9tUGFnZSh2YWx1ZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlZ2lzdGVyZWRQYWdlcy5wdXNoKHBhZ2VOYW1lKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFJlZ2lzdGVyZWQgY3VzdG9tIHBhZ2U6ICR7cGFnZU5hbWV9YCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgRXJyb3IgbG9hZGluZyBjdXN0b20gcGFnZSBmcm9tICR7ZmlsZX06YCwgZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHJlZ2lzdGVyZWRQYWdlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGDinIUgUmVnaXN0ZXJlZCAke3JlZ2lzdGVyZWRQYWdlcy5sZW5ndGh9IGN1c3RvbSBwYWdlKHMpOiAke3JlZ2lzdGVyZWRQYWdlcy5zbGljZSgwLCA1KS5qb2luKCcsICcpfSR7cmVnaXN0ZXJlZFBhZ2VzLmxlbmd0aCA+IDUgPyBgLCArJHtyZWdpc3RlcmVkUGFnZXMubGVuZ3RoIC0gNX0gbW9yZWAgOiAnJ31gKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHB1YmxpYyBpc1ZhbGlkQ3VzdG9tUGFnZUNvbmZpZyh2YWx1ZTogdW5rbm93bik6IHZhbHVlIGlzIEN1c3RvbVBhZ2VPcHRpb25zIHtcbiAgICAgICAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XG5cbiAgICAgICAgY29uc3QgY29uZmlnID0gdmFsdWUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgICAgIGlmICghKCdwYWdlVHlwZScgaW4gY29uZmlnKSB8fCAhKCdwYWdlVGl0bGUnIGluIGNvbmZpZykpIHJldHVybiBmYWxzZTtcblxuICAgICAgICBjb25zdCBwYWdlVHlwZSA9IGNvbmZpZy5wYWdlVHlwZTtcbiAgICAgICAgaWYgKHBhZ2VUeXBlID09PSAnbGlzdCcpIHtcbiAgICAgICAgICAgIHJldHVybiAnbGlzdFBhZ2VDb25maWcnIGluIGNvbmZpZztcbiAgICAgICAgfSBlbHNlIGlmIChwYWdlVHlwZSA9PT0gJ2Zvcm0nKSB7XG4gICAgICAgICAgICByZXR1cm4gJ2Zvcm1QYWdlQ29uZmlnJyBpbiBjb25maWc7XG4gICAgICAgIH0gZWxzZSBpZiAocGFnZVR5cGUgPT09ICdkZXRhaWxzJykge1xuICAgICAgICAgICAgcmV0dXJuICdkZXRhaWxzUGFnZUNvbmZpZycgaW4gY29uZmlnO1xuICAgICAgICB9IGVsc2UgaWYgKHBhZ2VUeXBlID09PSAnZGFzaGJvYXJkJykge1xuICAgICAgICAgICAgcmV0dXJuICdkYXNoYm9hcmRQYWdlQ29uZmlnJyBpbiBjb25maWc7XG4gICAgICAgIH0gZWxzZSBpZiAocGFnZVR5cGUgPT09ICdhY2NvcmRpb24nKSB7XG4gICAgICAgICAgICByZXR1cm4gJ2FjY29yZGlvblBhZ2VDb25maWcnIGluIGNvbmZpZztcbiAgICAgICAgfSBlbHNlIGlmIChwYWdlVHlwZSA9PT0gJ21lbnUnKSB7XG4gICAgICAgICAgICByZXR1cm4gJ21lbnVQYWdlQ29uZmlnJyBpbiBjb25maWc7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIHByaXZhdGUgZ2V0UGFnZU5hbWVGcm9tQ29uZmlnKGNvbmZpZzogQ3VzdG9tUGFnZU9wdGlvbnMpOiBzdHJpbmcgfCBudWxsIHtcbiAgICAgICAgaWYgKGNvbmZpZy5wYWdlTmFtZSkge1xuICAgICAgICAgICAgcmV0dXJuIHRvU2x1Zyhjb25maWcucGFnZU5hbWUpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRm9yIHRlbXBsYXRlLWJhc2VkIHBhZ2UgdGl0bGVzIChvYmplY3RzKSwgcGFnZU5hbWUgTVVTVCBiZSBwcm92aWRlZFxuICAgICAgICAvLyBFeHRyYWN0IHN0cmluZyBmcm9tIHBhZ2VUaXRsZSAoaGFuZGxlcyBib3RoIHN0cmluZyBhbmQgVGVtcGxhdGUgdHlwZXMpXG4gICAgICAgIGNvbnN0IHBhZ2VUaXRsZVN0cmluZyA9IHR5cGVvZiBjb25maWcucGFnZVRpdGxlID09PSAnc3RyaW5nJ1xuICAgICAgICAgICAgPyBjb25maWcucGFnZVRpdGxlXG4gICAgICAgICAgICA6ICdjdXN0b20tcGFnZSc7IC8vIEZhbGxiYWNrIGZvciBUZW1wbGF0ZSBvYmplY3RzXG5cbiAgICAgICAgc3dpdGNoIChjb25maWcucGFnZVR5cGUpIHtcbiAgICAgICAgICAgIGNhc2UgJ2xpc3QnOlxuICAgICAgICAgICAgICAgIHJldHVybiBgbGlzdC0ke3RvU2x1ZyhwYWdlVGl0bGVTdHJpbmcpfWA7XG4gICAgICAgICAgICBjYXNlICdmb3JtJzpcbiAgICAgICAgICAgICAgICByZXR1cm4gcGFnZVRpdGxlU3RyaW5nLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoJ2FkZCcpXG4gICAgICAgICAgICAgICAgICAgID8gYGNyZWF0ZS0ke3RvU2x1ZyhwYWdlVGl0bGVTdHJpbmcpfWBcbiAgICAgICAgICAgICAgICAgICAgOiBgZWRpdC0ke3RvU2x1ZyhwYWdlVGl0bGVTdHJpbmcpfWA7XG4gICAgICAgICAgICBjYXNlICdkZXRhaWxzJzpcbiAgICAgICAgICAgICAgICByZXR1cm4gYHZpZXctJHt0b1NsdWcocGFnZVRpdGxlU3RyaW5nKX1gO1xuICAgICAgICAgICAgY2FzZSAnZGFzaGJvYXJkJzpcbiAgICAgICAgICAgICAgICByZXR1cm4gYCR7dG9TbHVnKHBhZ2VUaXRsZVN0cmluZyl9YDtcbiAgICAgICAgICAgIGNhc2UgJ2FjY29yZGlvbic6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGBhY2NvcmRpb24tJHt0b1NsdWcocGFnZVRpdGxlU3RyaW5nKX1gO1xuICAgICAgICAgICAgY2FzZSAnbWVudSc6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGAke3RvU2x1ZyhwYWdlVGl0bGVTdHJpbmcpfWA7XG4gICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUmVnaXN0ZXIgYSBjdXN0b20gcGFnZS4gU3VwcG9ydHMgb3B0aW9uYWwgcm91dGVQYXR0ZXJuIGZvciBkeW5hbWljIHJvdXRlcyAoZS5nLiwgL2F1dGhvci86YXV0aG9ySWQvYm9va3MpXG4gICAgICovXG4gICAgcHVibGljIHJlZ2lzdGVyQ3VzdG9tUGFnZShvcHRpb25zOiBDdXN0b21QYWdlT3B0aW9ucykge1xuICAgICAgICBjb25zdCBwYWdlTmFtZSA9IHRoaXMuZ2V0UGFnZU5hbWVGcm9tQ29uZmlnKG9wdGlvbnMpO1xuICAgICAgICBpZiAocGFnZU5hbWUpIHtcbiAgICAgICAgICAgIHRoaXMuY3VzdG9tUGFnZXMuc2V0KHBhZ2VOYW1lLCBvcHRpb25zKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGFzeW5jIHJ1bigpIHtcbiAgICAgICAgdGhpcy5wcm9jZXNzKCk7XG4gICAgfVxuXG4gICAgQExvZ0R1cmF0aW9uKClcbiAgICBhc3luYyBwcm9jZXNzKCkge1xuICAgICAgICBjb25zdCBtZW51Q29uZmlnczogYW55W10gPSBbXTtcbiAgICAgICAgY29uc3QgZW50aXR5Q29uZmlnczogYW55ID0ge307XG5cbiAgICAgICAgY29uc3Qgc2VydmljZURpcmVjdG9yaWVzID0gdGhpcy5wcmVwYXJlU2VydmljZXNEaXJlY3RvcmllcygpO1xuXG4gICAgICAgIGNvbnN0IHNlcnZpY2VzID0gYXdhaXQgdGhpcy5zY2FuQW5kTG9hZFNlcnZpY2VzKHNlcnZpY2VEaXJlY3Rvcmllcyk7XG5cbiAgICAgICAgLy8gU2NhbiBhbmQgbG9hZCBjdXN0b20gcGFnZXNcbiAgICAgICAgYXdhaXQgdGhpcy5zY2FuQ3VzdG9tUGFnZXMoKTtcblxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgVWktY29uZmlnLWdlbjo6OiBQcm9jZXNzOjo6IGFsbC1zZXJ2aWNlczogYCwgQXJyYXkuZnJvbShzZXJ2aWNlcy5rZXlzKCkpKTtcblxuICAgICAgICAvLyBHZXQgZ2xvYmFsIFVJIGNvbmZpZyBvcHRpb25zIChpbmNsdWRpbmcgZHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uKVxuICAgICAgICBjb25zdCBmdzI0Q29uZmlnID0gRncyNC5nZXRJbnN0YW5jZSgpLmdldENvbmZpZygpO1xuICAgICAgICBjb25zdCBnbG9iYWxVSUNvbmZpZ09wdGlvbnMgPSBmdzI0Q29uZmlnLnVpQ29uZmlnR2VuT3B0aW9ucztcbiAgICAgICAgY29uc3QgaGFzT2JzZXJ2YWJpbGl0eSA9ICEhZncyNENvbmZpZy5vYnNlcnZhYmlsaXR5O1xuXG4gICAgICAgIGxldCBtZW51SW5kZXggPSAxO1xuICAgICAgICAvLyBnZW5lcmF0ZSBVSSBjb25maWdzXG4gICAgICAgIHNlcnZpY2VzLmZvckVhY2goKHNlcnZpY2UsIGVudGl0eU5hbWUpID0+IHtcblxuICAgICAgICAgICAgbGV0IGVudGl0eVNjaGVtYSA9IHNlcnZpY2UuZ2V0RW50aXR5U2NoZW1hKCkgYXMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+O1xuXG4gICAgICAgICAgICAvLyBDaGVjayBmb3IgZGVwcmVjYXRlZCB1c2FnZSBhbmQgd2FyblxuICAgICAgICAgICAgdGhpcy5jaGVja0RlcHJlY2F0ZWRVc2FnZShlbnRpdHlTY2hlbWEpO1xuXG4gICAgICAgICAgICAvLyBUcmFuc2Zvcm0gbGVnYWN5IGNvbmZpZyBzdHJ1Y3R1cmUgdG8gbmV3IG5lc3RlZCBzdHJ1Y3R1cmUgaWYgbmVlZGVkXG4gICAgICAgICAgICBlbnRpdHlTY2hlbWEgPSB0aGlzLnRyYW5zZm9ybUxlZ2FjeUNvbmZpZyhlbnRpdHlTY2hlbWEpO1xuICAgICAgICAgICAgY29uc3QgZW50aXR5RGVmYXVsdE9wc1NjaGVtYSA9IHNlcnZpY2UuZ2V0T3BzRGVmYXVsdElPU2NoZW1hKCk7XG5cbiAgICAgICAgICAgIGlmICghZW50aXR5U2NoZW1hLm1vZGVsLmV4Y2x1ZGVGcm9tQWRtaW5DcmVhdGUpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBjcmVhdGVDb25maWcgPSBNYWtlQ3JlYXRlRW50aXR5Q29uZmlnKHtcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZVBsdXJhbDogZW50aXR5U2NoZW1hLm1vZGVsLmVudGl0eU5hbWVQbHVyYWwsXG4gICAgICAgICAgICAgICAgICAgIENSVURBcGlQYXRoOiBlbnRpdHlTY2hlbWEubW9kZWwuQ1JVREFwaVBhdGgsXG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IGVudGl0eURlZmF1bHRPcHNTY2hlbWEuY3JlYXRlLmlucHV0LFxuICAgICAgICAgICAgICAgICAgICAvLyBVc2UgbmV3IG5lc3RlZCBjb25maWcgaWYgYXZhaWxhYmxlLCBmYWxsYmFjayB0byBvbGRcbiAgICAgICAgICAgICAgICAgICAgYnJlYWRjcnVtYnM6IGVudGl0eVNjaGVtYS5tb2RlbC5jcmVhdGVQYWdlQ29uZmlnPy5icmVhZGNydW1icyB8fCBlbnRpdHlTY2hlbWEubW9kZWwuY3JlYXRlUGFnZUJyZWFkY3J1bWJzLFxuICAgICAgICAgICAgICAgICAgICBjb2x1bW5zQ29uZmlnOiBlbnRpdHlTY2hlbWEubW9kZWwuY3JlYXRlUGFnZUNvbmZpZz8uY29sdW1uc0NvbmZpZyB8fCBlbnRpdHlTY2hlbWEubW9kZWwuY3JlYXRlUGFnZUNvbHVtbnNDb25maWcsXG4gICAgICAgICAgICAgICAgICAgIGZvcm1Db25maWc6IGVudGl0eVNjaGVtYS5tb2RlbC5jcmVhdGVQYWdlQ29uZmlnPy5mb3JtQ29uZmlnLFxuICAgICAgICAgICAgICAgIH0sIHNlcnZpY2UpO1xuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ3NbIGBjcmVhdGUtJHtlbnRpdHlOYW1lLnRvTG93ZXJDYXNlKCl9YCBdID0gY3JlYXRlQ29uZmlnO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoIWVudGl0eVNjaGVtYS5tb2RlbC5leGNsdWRlRnJvbUFkbWluVXBkYXRlKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgdXBkYXRlQ29uZmlnID0gTWFrZVVwZGF0ZUVudGl0eUNvbmZpZyh7XG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWVQbHVyYWw6IGVudGl0eVNjaGVtYS5tb2RlbC5lbnRpdHlOYW1lUGx1cmFsLFxuICAgICAgICAgICAgICAgICAgICBDUlVEQXBpUGF0aDogZW50aXR5U2NoZW1hLm1vZGVsLkNSVURBcGlQYXRoLFxuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiBlbnRpdHlEZWZhdWx0T3BzU2NoZW1hLnVwZGF0ZS5pbnB1dCxcbiAgICAgICAgICAgICAgICAgICAgLy8gVXNlIG5ldyBuZXN0ZWQgY29uZmlnIGlmIGF2YWlsYWJsZSwgZmFsbGJhY2sgdG8gb2xkXG4gICAgICAgICAgICAgICAgICAgIGFjdGlvbnM6IGVudGl0eVNjaGVtYS5tb2RlbC5lZGl0UGFnZUNvbmZpZz8uYWN0aW9ucyB8fCBlbnRpdHlTY2hlbWEubW9kZWwuZWRpdFBhZ2VBY3Rpb25zLFxuICAgICAgICAgICAgICAgICAgICBicmVhZGNydW1iczogZW50aXR5U2NoZW1hLm1vZGVsLmVkaXRQYWdlQ29uZmlnPy5icmVhZGNydW1icyB8fCBlbnRpdHlTY2hlbWEubW9kZWwuZWRpdFBhZ2VCcmVhZGNydW1icyxcbiAgICAgICAgICAgICAgICAgICAgY29sdW1uc0NvbmZpZzogZW50aXR5U2NoZW1hLm1vZGVsLmVkaXRQYWdlQ29uZmlnPy5jb2x1bW5zQ29uZmlnIHx8IGVudGl0eVNjaGVtYS5tb2RlbC5lZGl0UGFnZUNvbHVtbnNDb25maWcsXG4gICAgICAgICAgICAgICAgICAgIGZvcm1Db25maWc6IGVudGl0eVNjaGVtYS5tb2RlbC5lZGl0UGFnZUNvbmZpZz8uZm9ybUNvbmZpZyxcbiAgICAgICAgICAgICAgICB9LCBzZXJ2aWNlKTtcbiAgICAgICAgICAgICAgICBlbnRpdHlDb25maWdzWyBgZWRpdC0ke2VudGl0eU5hbWUudG9Mb3dlckNhc2UoKX1gIF0gPSB1cGRhdGVDb25maWc7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICghZW50aXR5U2NoZW1hLm1vZGVsLmV4Y2x1ZGVGcm9tQWRtaW5MaXN0KSB7XG4gICAgICAgICAgICAgICAgY29uc3QgbGlzdENvbmZpZyA9IE1ha2VMaXN0RW50aXR5Q29uZmlnKHtcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZVBsdXJhbDogZW50aXR5U2NoZW1hLm1vZGVsLmVudGl0eU5hbWVQbHVyYWwsXG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IGVudGl0eURlZmF1bHRPcHNTY2hlbWEubGlzdC5vdXRwdXQsXG4gICAgICAgICAgICAgICAgICAgIENSVURBcGlQYXRoOiBlbnRpdHlTY2hlbWEubW9kZWwuQ1JVREFwaVBhdGgsXG4gICAgICAgICAgICAgICAgICAgIHVzZVNlYXJjaDogQm9vbGVhbihlbnRpdHlTY2hlbWEubW9kZWwuc2VhcmNoPy5lbmFibGVkKSxcbiAgICAgICAgICAgICAgICAgICAgZXhjbHVkZUZyb21BZG1pbkNyZWF0ZTogZW50aXR5U2NoZW1hLm1vZGVsLmV4Y2x1ZGVGcm9tQWRtaW5DcmVhdGUsXG4gICAgICAgICAgICAgICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5VcGRhdGU6IGVudGl0eVNjaGVtYS5tb2RlbC5leGNsdWRlRnJvbUFkbWluVXBkYXRlLFxuICAgICAgICAgICAgICAgICAgICBleGNsdWRlRnJvbUFkbWluRGVsZXRlOiBlbnRpdHlTY2hlbWEubW9kZWwuZXhjbHVkZUZyb21BZG1pbkRlbGV0ZSxcbiAgICAgICAgICAgICAgICAgICAgZXhjbHVkZUZyb21BZG1pbkRldGFpbDogZW50aXR5U2NoZW1hLm1vZGVsLmV4Y2x1ZGVGcm9tQWRtaW5EZXRhaWwsXG4gICAgICAgICAgICAgICAgICAgIC8vIFVzZSBuZXcgbmVzdGVkIGNvbmZpZyBpZiBhdmFpbGFibGUsIGZhbGxiYWNrIHRvIG9sZFxuICAgICAgICAgICAgICAgICAgICBwYWdlSGVhZGVyQWN0aW9uczogZW50aXR5U2NoZW1hLm1vZGVsLmxpc3RQYWdlQ29uZmlnPy5hY3Rpb25zIHx8IGVudGl0eVNjaGVtYS5tb2RlbC5saXN0UGFnZUFjdGlvbnMsXG4gICAgICAgICAgICAgICAgICAgIGJyZWFkY3J1bWJzOiBlbnRpdHlTY2hlbWEubW9kZWwubGlzdFBhZ2VDb25maWc/LmJyZWFkY3J1bWJzIHx8IGVudGl0eVNjaGVtYS5tb2RlbC5saXN0UGFnZUJyZWFkY3J1bWJzLFxuICAgICAgICAgICAgICAgICAgICAvLyBMZWdhY3kgc29ydCBmYWxsYmFjayAodGFibGVDb25maWcuZGVmYXVsdFNvcnQgaXMgaGFuZGxlZCBkaXJlY3RseSBpbiBsaXN0LWVudGl0eS50cylcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdFNvcnQ6IGVudGl0eVNjaGVtYS5tb2RlbC5saXN0UGFnZUNvbmZpZz8uZGVmYXVsdFNvcnQgPz8gZW50aXR5U2NoZW1hLm1vZGVsLmxpc3RQYWdlRGVmYXVsdFNvcnQsXG4gICAgICAgICAgICAgICAgICAgIHRhYmxlQ29uZmlnOiBlbnRpdHlTY2hlbWEubW9kZWwubGlzdFBhZ2VDb25maWc/LnRhYmxlQ29uZmlnLFxuICAgICAgICAgICAgICAgICAgICBnbG9iYWxVSUNvbmZpZ09wdGlvbnMsXG4gICAgICAgICAgICAgICAgICAgIGhhc09ic2VydmFiaWxpdHksXG4gICAgICAgICAgICAgICAgfSwgc2VydmljZSk7XG4gICAgICAgICAgICAgICAgZW50aXR5Q29uZmlnc1sgYGxpc3QtJHtlbnRpdHlOYW1lLnRvTG93ZXJDYXNlKCl9YCBdID0gbGlzdENvbmZpZztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKCFlbnRpdHlTY2hlbWEubW9kZWwuZXhjbHVkZUZyb21BZG1pbkRldGFpbCkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHZpZXdDb25maWcgPSBNYWtlVmlld0VudGl0eUNvbmZpZyh7XG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWVQbHVyYWw6IGVudGl0eVNjaGVtYS5tb2RlbC5lbnRpdHlOYW1lUGx1cmFsLFxuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiBlbnRpdHlEZWZhdWx0T3BzU2NoZW1hLmdldC5vdXRwdXQsXG4gICAgICAgICAgICAgICAgICAgIENSVURBcGlQYXRoOiBlbnRpdHlTY2hlbWEubW9kZWwuQ1JVREFwaVBhdGgsXG4gICAgICAgICAgICAgICAgICAgIC8vIFVzZSBuZXcgbmVzdGVkIGNvbmZpZyBpZiBhdmFpbGFibGUsIGZhbGxiYWNrIHRvIG9sZFxuICAgICAgICAgICAgICAgICAgICBhY3Rpb25zOiBlbnRpdHlTY2hlbWEubW9kZWwudmlld1BhZ2VDb25maWc/LmFjdGlvbnMgfHwgZW50aXR5U2NoZW1hLm1vZGVsLnZpZXdQYWdlQWN0aW9ucyxcbiAgICAgICAgICAgICAgICAgICAgYnJlYWRjcnVtYnM6IGVudGl0eVNjaGVtYS5tb2RlbC52aWV3UGFnZUNvbmZpZz8uYnJlYWRjcnVtYnMgfHwgZW50aXR5U2NoZW1hLm1vZGVsLnZpZXdQYWdlQnJlYWRjcnVtYnMsXG4gICAgICAgICAgICAgICAgICAgIGNvbHVtbnNDb25maWc6IGVudGl0eVNjaGVtYS5tb2RlbC52aWV3UGFnZUNvbmZpZz8uY29sdW1uc0NvbmZpZyB8fCBlbnRpdHlTY2hlbWEubW9kZWwudmlld1BhZ2VDb2x1bW5zQ29uZmlnLFxuICAgICAgICAgICAgICAgICAgICBmaWVsZHM6IGVudGl0eVNjaGVtYS5tb2RlbC52aWV3UGFnZUNvbmZpZz8uZmllbGRzLFxuICAgICAgICAgICAgICAgICAgICBzZWN0aW9uc0NvbmZpZzogZW50aXR5U2NoZW1hLm1vZGVsLnZpZXdQYWdlQ29uZmlnPy5zZWN0aW9uc0NvbmZpZyxcbiAgICAgICAgICAgICAgICAgICAgZ2xvYmFsVUlDb25maWdPcHRpb25zLFxuICAgICAgICAgICAgICAgICAgICBoYXNPYnNlcnZhYmlsaXR5LFxuICAgICAgICAgICAgICAgIH0sIHNlcnZpY2UpO1xuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ3NbIGB2aWV3LSR7ZW50aXR5TmFtZS50b0xvd2VyQ2FzZSgpfWAgXSA9IHZpZXdDb25maWc7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICghZW50aXR5U2NoZW1hLm1vZGVsLmV4Y2x1ZGVGcm9tQWRtaW5NZW51KSB7XG4gICAgICAgICAgICAgICAgY29uc3QgbWVudUNvbmZpZyA9IE1ha2VFbnRpdHlNZW51Q29uZmlnKHtcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZVBsdXJhbDogZW50aXR5U2NoZW1hLm1vZGVsLmVudGl0eU5hbWVQbHVyYWwsXG4gICAgICAgICAgICAgICAgICAgIGljb246IGVudGl0eVNjaGVtYS5tb2RlbC5lbnRpdHlNZW51SWNvbiB8fCAnYXBwU3RvcmUnLFxuICAgICAgICAgICAgICAgICAgICBtZW51SW5kZXg6IG1lbnVJbmRleCsrLFxuICAgICAgICAgICAgICAgICAgICBleGNsdWRlRnJvbUFkbWluTGlzdDogZW50aXR5U2NoZW1hLm1vZGVsLmV4Y2x1ZGVGcm9tQWRtaW5MaXN0LFxuICAgICAgICAgICAgICAgICAgICBleGNsdWRlRnJvbUFkbWluQ3JlYXRlOiBlbnRpdHlTY2hlbWEubW9kZWwuZXhjbHVkZUZyb21BZG1pbkNyZWF0ZSxcbiAgICAgICAgICAgICAgICAgICAgbWVudUdyb3VwOiBlbnRpdHlTY2hlbWEubW9kZWwubWVudUdyb3VwLFxuICAgICAgICAgICAgICAgICAgICBtZW51T3JkZXI6IGVudGl0eVNjaGVtYS5tb2RlbC5tZW51T3JkZXIsXG4gICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICBtZW51Q29uZmlncy5wdXNoKG1lbnVDb25maWcpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIFByb2Nlc3MgY3VzdG9tIHBhZ2VzXG4gICAgICAgIGZvciAoY29uc3QgWyBwYWdlTmFtZSwgb3B0aW9ucyBdIG9mIHRoaXMuY3VzdG9tUGFnZXMpIHtcbiAgICAgICAgICAgIC8vIHNraXAgdGhlIGRlZmF1bHQgZGFzaGJvYXJkIHBhZ2UgYW5kIG1lbnUgcGFnZVxuICAgICAgICAgICAgaWYgKHBhZ2VOYW1lID09PSAnZGFzaGJvYXJkJyB8fCBwYWdlTmFtZSA9PT0gJ21lbnUnKSB7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zdCBjdXN0b21Db25maWcgPSBtYWtlQ3VzdG9tUGFnZUNvbmZpZyhvcHRpb25zKTtcbiAgICAgICAgICAgIGVudGl0eUNvbmZpZ3NbIHBhZ2VOYW1lIF0gPSBjdXN0b21Db25maWc7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBhdXRoQ29uZmlnT3B0aW9ucyA9IEZ3MjQuZ2V0SW5zdGFuY2UoKS5nZXRDb25maWcoKS51aUNvbmZpZ0dlbk9wdGlvbnMgfHwge307XG5cbiAgICAgICAgY29uc3QgYXV0aENvbmZpZ3MgPSBNYWtlQXV0aENvbmZpZyh7XG4gICAgICAgICAgICAuLi5hdXRoQ29uZmlnT3B0aW9ucyxcbiAgICAgICAgICAgIGF1dGhFbmRwb2ludDogYXV0aENvbmZpZ09wdGlvbnMuYXV0aEVuZHBvaW50IHx8ICdtYXV0aCdcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gTG9vayBmb3IgYSBkYXNoYm9hcmQgY3VzdG9tIHBhZ2VcbiAgICAgICAgbGV0IGRhc2hib2FyZENvbmZpZzogRGFzaGJvYXJkUGFnZUNvbmZpZyB8IGFueSA9IG51bGw7XG4gICAgICAgIGZvciAoY29uc3QgWyAsIG9wdGlvbnMgXSBvZiB0aGlzLmN1c3RvbVBhZ2VzKSB7XG4gICAgICAgICAgICAvLyBDaGVjayBpZiB0aGlzIGlzIGEgZGFzaGJvYXJkIHBhZ2UgLSBoYW5kbGUgYm90aCBzdHJpbmcgYW5kIFRlbXBsYXRlIHBhZ2VUaXRsZVxuICAgICAgICAgICAgY29uc3QgcGFnZVRpdGxlU3RyID0gdHlwZW9mIG9wdGlvbnMucGFnZVRpdGxlID09PSAnc3RyaW5nJyA/IG9wdGlvbnMucGFnZVRpdGxlIDogJyc7XG4gICAgICAgICAgICBpZiAob3B0aW9ucy5wYWdlVHlwZSA9PT0gJ2Rhc2hib2FyZCcgJiYgcGFnZVRpdGxlU3RyLnRvTG93ZXJDYXNlKCkgPT09ICdkYXNoYm9hcmQnKSB7XG4gICAgICAgICAgICAgICAgZGFzaGJvYXJkQ29uZmlnID0gb3B0aW9ucztcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBpZiAoIWRhc2hib2FyZENvbmZpZykge1xuICAgICAgICAgICAgZGFzaGJvYXJkQ29uZmlnID0gTWFrZURhc2hib2FyZENvbmZpZygpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gTG9vayBmb3IgYSBtZW51IGN1c3RvbSBwYWdlXG4gICAgICAgIGxldCBtZW51Q29uZmlnOiBhbnkgPSBudWxsO1xuICAgICAgICBmb3IgKGNvbnN0IFsgcGFnZU5hbWUsIG9wdGlvbnMgXSBvZiB0aGlzLmN1c3RvbVBhZ2VzKSB7XG4gICAgICAgICAgICAvLyBDaGVjayBpZiB0aGlzIGlzIGEgbWVudSBwYWdlIC0gaGFuZGxlIGJvdGggc3RyaW5nIGFuZCBUZW1wbGF0ZSBwYWdlVGl0bGVcbiAgICAgICAgICAgIGNvbnN0IHBhZ2VUaXRsZVN0ciA9IHR5cGVvZiBvcHRpb25zLnBhZ2VUaXRsZSA9PT0gJ3N0cmluZycgPyBvcHRpb25zLnBhZ2VUaXRsZSA6ICcnO1xuICAgICAgICAgICAgaWYgKG9wdGlvbnMucGFnZVR5cGUgPT09ICdtZW51JyAmJiBwYWdlVGl0bGVTdHIudG9Mb3dlckNhc2UoKSA9PT0gJ21lbnUnKSB7XG4gICAgICAgICAgICAgICAgbWVudUNvbmZpZyA9IG9wdGlvbnM7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBHcm91cCBtZW51IGl0ZW1zIGJ5IHRoZWlyIGdyb3VwIHByb3BlcnR5XG4gICAgICAgIGNvbnN0IG1lbnVHcm91cHMgPSBuZXcgTWFwPHN0cmluZywgYW55W10+KCk7XG4gICAgICAgIGNvbnN0IHVuZ3JvdXBlZEl0ZW1zOiBhbnlbXSA9IFtdO1xuXG4gICAgICAgIC8vIFByb2Nlc3MgZW50aXR5IG1lbnUgaXRlbXNcbiAgICAgICAgbWVudUNvbmZpZ3MuZm9yRWFjaChpdGVtID0+IHtcbiAgICAgICAgICAgIGlmIChpdGVtLmdyb3VwKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFtZW51R3JvdXBzLmhhcyhpdGVtLmdyb3VwKSkge1xuICAgICAgICAgICAgICAgICAgICBtZW51R3JvdXBzLnNldChpdGVtLmdyb3VwLCBbXSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIG1lbnVHcm91cHMuZ2V0KGl0ZW0uZ3JvdXApIS5wdXNoKGl0ZW0pO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB1bmdyb3VwZWRJdGVtcy5wdXNoKGl0ZW0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBQcm9jZXNzIGN1c3RvbSBtZW51IGl0ZW1zXG4gICAgICAgIGlmIChtZW51Q29uZmlnPy5tZW51UGFnZUNvbmZpZz8ubWVudUl0ZW1zKSB7XG4gICAgICAgICAgICBtZW51Q29uZmlnLm1lbnVQYWdlQ29uZmlnLm1lbnVJdGVtcy5mb3JFYWNoKChpdGVtOiBhbnkpID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoaXRlbS5ncm91cCkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoIW1lbnVHcm91cHMuaGFzKGl0ZW0uZ3JvdXApKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBtZW51R3JvdXBzLnNldChpdGVtLmdyb3VwLCBbXSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgbWVudUdyb3Vwcy5nZXQoaXRlbS5ncm91cCkhLnB1c2goaXRlbSk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgdW5ncm91cGVkSXRlbXMucHVzaChpdGVtKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENyZWF0ZSBmaW5hbCBtZW51IHN0cnVjdHVyZVxuICAgICAgICBjb25zdCBhbGxNZW51SXRlbXM6IGFueVtdID0gW107XG5cbiAgICAgICAgLy8gQWRkIHVuZ3JvdXBlZCBpdGVtcyBmaXJzdCAocHJpbWFyeSBuYXZpZ2F0aW9uKVxuICAgICAgICBhbGxNZW51SXRlbXMucHVzaCguLi51bmdyb3VwZWRJdGVtcyk7XG5cbiAgICAgICAgLy8gQWRkIGdyb3VwZWQgaXRlbXNcbiAgICAgICAgbWVudUdyb3Vwcy5mb3JFYWNoKChpdGVtcywgZ3JvdXBOYW1lKSA9PiB7XG4gICAgICAgICAgICAvLyBTb3J0IGl0ZW1zIHdpdGhpbiBncm91cCBieSBvcmRlclxuICAgICAgICAgICAgaXRlbXMuc29ydCgoYSwgYikgPT4gKGEub3JkZXIgfHwgMCkgLSAoYi5vcmRlciB8fCAwKSk7XG5cbiAgICAgICAgICAgIC8vIENyZWF0ZSBncm91cCBpdGVtXG4gICAgICAgICAgICBhbGxNZW51SXRlbXMucHVzaCh7XG4gICAgICAgICAgICAgICAgbGFiZWw6IGdyb3VwTmFtZSxcbiAgICAgICAgICAgICAgICBrZXk6IGBncm91cC0ke2dyb3VwTmFtZX1gLFxuICAgICAgICAgICAgICAgIGljb246ICdGb2xkZXJPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgY2hpbGRyZW46IGl0ZW1zXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgYXdhaXQgdGhpcy53cml0ZVRvRmlsZXMoYWxsTWVudUl0ZW1zLCBlbnRpdHlDb25maWdzLCBhdXRoQ29uZmlncywgZGFzaGJvYXJkQ29uZmlnKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBUcmFuc2Zvcm0gbGVnYWN5IGZsYXQgY29uZmlnIHN0cnVjdHVyZSB0byBuZXcgbmVzdGVkIHN0cnVjdHVyZVxuICAgICAqIFN1cHBvcnRzIGJhY2t3YXJkIGNvbXBhdGliaWxpdHkgYnkgdHJhbnNmb3JtaW5nIG9sZCBwcm9wZXJ0aWVzIHRvIG5ldyBmb3JtYXRcbiAgICAgKi9cbiAgICBwcml2YXRlIHRyYW5zZm9ybUxlZ2FjeUNvbmZpZyhzY2hlbWE6IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pik6IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PiB7XG4gICAgICAgIGNvbnN0IG1vZGVsID0gc2NoZW1hLm1vZGVsO1xuXG4gICAgICAgIC8vIElmIGFscmVhZHkgdXNpbmcgbmV3IGZvcm1hdCwgcmV0dXJuIGFzLWlzXG4gICAgICAgIGlmIChtb2RlbC5saXN0UGFnZUNvbmZpZyB8fCBtb2RlbC52aWV3UGFnZUNvbmZpZyB8fCBtb2RlbC5lZGl0UGFnZUNvbmZpZyB8fCBtb2RlbC5jcmVhdGVQYWdlQ29uZmlnKSB7XG4gICAgICAgICAgICByZXR1cm4gc2NoZW1hO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gVHJhbnNmb3JtIG9sZCBmb3JtYXQgdG8gbmV3IG5lc3RlZCBzdHJ1Y3R1cmVcbiAgICAgICAgY29uc3QgdHJhbnNmb3JtZWRNb2RlbCA9IHtcbiAgICAgICAgICAgIC4uLm1vZGVsLFxuICAgICAgICAgICAgLy8gTGlzdCBwYWdlIHRyYW5zZm9ybWF0aW9uXG4gICAgICAgICAgICBsaXN0UGFnZUNvbmZpZzogKG1vZGVsLmxpc3RQYWdlQWN0aW9ucyB8fCBtb2RlbC5saXN0UGFnZUJyZWFkY3J1bWJzIHx8IG1vZGVsLmxpc3RQYWdlRGVmYXVsdFNvcnQpXG4gICAgICAgICAgICAgICAgPyB7XG4gICAgICAgICAgICAgICAgICAgIGFjdGlvbnM6IG1vZGVsLmxpc3RQYWdlQWN0aW9ucyxcbiAgICAgICAgICAgICAgICAgICAgYnJlYWRjcnVtYnM6IG1vZGVsLmxpc3RQYWdlQnJlYWRjcnVtYnMsXG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHRTb3J0OiBtb2RlbC5saXN0UGFnZURlZmF1bHRTb3J0XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIDogdW5kZWZpbmVkLFxuXG4gICAgICAgICAgICAvLyBWaWV3IHBhZ2UgdHJhbnNmb3JtYXRpb25cbiAgICAgICAgICAgIHZpZXdQYWdlQ29uZmlnOiAobW9kZWwudmlld1BhZ2VBY3Rpb25zIHx8IG1vZGVsLnZpZXdQYWdlQnJlYWRjcnVtYnMgfHwgbW9kZWwudmlld1BhZ2VDb2x1bW5zQ29uZmlnKVxuICAgICAgICAgICAgICAgID8ge1xuICAgICAgICAgICAgICAgICAgICBhY3Rpb25zOiBtb2RlbC52aWV3UGFnZUFjdGlvbnMsXG4gICAgICAgICAgICAgICAgICAgIGJyZWFkY3J1bWJzOiBtb2RlbC52aWV3UGFnZUJyZWFkY3J1bWJzLFxuICAgICAgICAgICAgICAgICAgICBjb2x1bW5zQ29uZmlnOiBtb2RlbC52aWV3UGFnZUNvbHVtbnNDb25maWdcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgOiB1bmRlZmluZWQsXG5cbiAgICAgICAgICAgIC8vIEVkaXQgcGFnZSB0cmFuc2Zvcm1hdGlvblxuICAgICAgICAgICAgZWRpdFBhZ2VDb25maWc6IChtb2RlbC5lZGl0UGFnZUFjdGlvbnMgfHwgbW9kZWwuZWRpdFBhZ2VCcmVhZGNydW1icyB8fCBtb2RlbC5lZGl0UGFnZUNvbHVtbnNDb25maWcpXG4gICAgICAgICAgICAgICAgPyB7XG4gICAgICAgICAgICAgICAgICAgIGFjdGlvbnM6IG1vZGVsLmVkaXRQYWdlQWN0aW9ucyxcbiAgICAgICAgICAgICAgICAgICAgYnJlYWRjcnVtYnM6IG1vZGVsLmVkaXRQYWdlQnJlYWRjcnVtYnMsXG4gICAgICAgICAgICAgICAgICAgIGNvbHVtbnNDb25maWc6IG1vZGVsLmVkaXRQYWdlQ29sdW1uc0NvbmZpZ1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICA6IHVuZGVmaW5lZCxcblxuICAgICAgICAgICAgLy8gQ3JlYXRlIHBhZ2UgdHJhbnNmb3JtYXRpb25cbiAgICAgICAgICAgIGNyZWF0ZVBhZ2VDb25maWc6IChtb2RlbC5jcmVhdGVQYWdlQnJlYWRjcnVtYnMgfHwgbW9kZWwuY3JlYXRlUGFnZUNvbHVtbnNDb25maWcpXG4gICAgICAgICAgICAgICAgPyB7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFkY3J1bWJzOiBtb2RlbC5jcmVhdGVQYWdlQnJlYWRjcnVtYnMsXG4gICAgICAgICAgICAgICAgICAgIGNvbHVtbnNDb25maWc6IG1vZGVsLmNyZWF0ZVBhZ2VDb2x1bW5zQ29uZmlnXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIDogdW5kZWZpbmVkLFxuICAgICAgICB9O1xuXG4gICAgICAgIHJldHVybiB7IC4uLnNjaGVtYSwgbW9kZWw6IHRyYW5zZm9ybWVkTW9kZWwgfTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDaGVjayBmb3IgZGVwcmVjYXRlZCBjb25maWd1cmF0aW9uIHVzYWdlIGFuZCBlbWl0IHdhcm5pbmdzXG4gICAgICovXG4gICAgcHJpdmF0ZSBjaGVja0RlcHJlY2F0ZWRVc2FnZShzY2hlbWE6IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pik6IHZvaWQge1xuICAgICAgICBjb25zdCBtb2RlbCA9IHNjaGVtYS5tb2RlbDtcbiAgICAgICAgY29uc3Qgd2FybmluZ3M6IHN0cmluZ1tdID0gW107XG5cbiAgICAgICAgLy8gQ2hlY2sgbGlzdCBwYWdlIGRlcHJlY2F0ZWQgZmllbGRzXG4gICAgICAgIGlmIChtb2RlbC5saXN0UGFnZUFjdGlvbnMpIHtcbiAgICAgICAgICAgIHdhcm5pbmdzLnB1c2goJ2xpc3RQYWdlQWN0aW9ucyBpcyBkZXByZWNhdGVkLiBVc2UgbGlzdFBhZ2VDb25maWcuYWN0aW9ucyBpbnN0ZWFkLicpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChtb2RlbC5saXN0UGFnZUJyZWFkY3J1bWJzKSB7XG4gICAgICAgICAgICB3YXJuaW5ncy5wdXNoKCdsaXN0UGFnZUJyZWFkY3J1bWJzIGlzIGRlcHJlY2F0ZWQuIFVzZSBsaXN0UGFnZUNvbmZpZy5icmVhZGNydW1icyBpbnN0ZWFkLicpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChtb2RlbC5saXN0UGFnZURlZmF1bHRTb3J0KSB7XG4gICAgICAgICAgICB3YXJuaW5ncy5wdXNoKCdsaXN0UGFnZURlZmF1bHRTb3J0IGlzIGRlcHJlY2F0ZWQuIFVzZSBsaXN0UGFnZUNvbmZpZy5kZWZhdWx0U29ydCBpbnN0ZWFkLicpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ2hlY2sgdmlldyBwYWdlIGRlcHJlY2F0ZWQgZmllbGRzXG4gICAgICAgIGlmIChtb2RlbC52aWV3UGFnZUFjdGlvbnMpIHtcbiAgICAgICAgICAgIHdhcm5pbmdzLnB1c2goJ3ZpZXdQYWdlQWN0aW9ucyBpcyBkZXByZWNhdGVkLiBVc2Ugdmlld1BhZ2VDb25maWcuYWN0aW9ucyBpbnN0ZWFkLicpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChtb2RlbC52aWV3UGFnZUJyZWFkY3J1bWJzKSB7XG4gICAgICAgICAgICB3YXJuaW5ncy5wdXNoKCd2aWV3UGFnZUJyZWFkY3J1bWJzIGlzIGRlcHJlY2F0ZWQuIFVzZSB2aWV3UGFnZUNvbmZpZy5icmVhZGNydW1icyBpbnN0ZWFkLicpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChtb2RlbC52aWV3UGFnZUNvbHVtbnNDb25maWcpIHtcbiAgICAgICAgICAgIHdhcm5pbmdzLnB1c2goJ3ZpZXdQYWdlQ29sdW1uc0NvbmZpZyBpcyBkZXByZWNhdGVkLiBVc2Ugdmlld1BhZ2VDb25maWcuY29sdW1uc0NvbmZpZyBpbnN0ZWFkLicpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ2hlY2sgZWRpdCBwYWdlIGRlcHJlY2F0ZWQgZmllbGRzXG4gICAgICAgIGlmIChtb2RlbC5lZGl0UGFnZUFjdGlvbnMpIHtcbiAgICAgICAgICAgIHdhcm5pbmdzLnB1c2goJ2VkaXRQYWdlQWN0aW9ucyBpcyBkZXByZWNhdGVkLiBVc2UgZWRpdFBhZ2VDb25maWcuYWN0aW9ucyBpbnN0ZWFkLicpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChtb2RlbC5lZGl0UGFnZUJyZWFkY3J1bWJzKSB7XG4gICAgICAgICAgICB3YXJuaW5ncy5wdXNoKCdlZGl0UGFnZUJyZWFkY3J1bWJzIGlzIGRlcHJlY2F0ZWQuIFVzZSBlZGl0UGFnZUNvbmZpZy5icmVhZGNydW1icyBpbnN0ZWFkLicpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChtb2RlbC5lZGl0UGFnZUNvbHVtbnNDb25maWcpIHtcbiAgICAgICAgICAgIHdhcm5pbmdzLnB1c2goJ2VkaXRQYWdlQ29sdW1uc0NvbmZpZyBpcyBkZXByZWNhdGVkLiBVc2UgZWRpdFBhZ2VDb25maWcuY29sdW1uc0NvbmZpZyBpbnN0ZWFkLicpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ2hlY2sgY3JlYXRlIHBhZ2UgZGVwcmVjYXRlZCBmaWVsZHNcbiAgICAgICAgaWYgKG1vZGVsLmNyZWF0ZVBhZ2VCcmVhZGNydW1icykge1xuICAgICAgICAgICAgd2FybmluZ3MucHVzaCgnY3JlYXRlUGFnZUJyZWFkY3J1bWJzIGlzIGRlcHJlY2F0ZWQuIFVzZSBjcmVhdGVQYWdlQ29uZmlnLmJyZWFkY3J1bWJzIGluc3RlYWQuJyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG1vZGVsLmNyZWF0ZVBhZ2VDb2x1bW5zQ29uZmlnKSB7XG4gICAgICAgICAgICB3YXJuaW5ncy5wdXNoKCdjcmVhdGVQYWdlQ29sdW1uc0NvbmZpZyBpcyBkZXByZWNhdGVkLiBVc2UgY3JlYXRlUGFnZUNvbmZpZy5jb2x1bW5zQ29uZmlnIGluc3RlYWQuJyk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBFbWl0IHdhcm5pbmdzIGlmIGFueSBkZXByZWNhdGVkIGZpZWxkcyBmb3VuZFxuICAgICAgICBpZiAod2FybmluZ3MubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgXFxu4pqg77iPICBFbnRpdHkgXCIke21vZGVsLmVudGl0eX1cIiB1c2VzIGRlcHJlY2F0ZWQgY29uZmlndXJhdGlvbjpgKTtcbiAgICAgICAgICAgIHdhcm5pbmdzLmZvckVhY2godyA9PiB0aGlzLmxvZ2dlci53YXJuKGAgICAtICR7d31gKSk7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGAgICDwn5OWIE1pZ3JhdGlvbiBndWlkZTogaHR0cHM6Ly9kb2NzLmZ3MjQuaW8vbWlncmF0aW9uL25lc3RlZC1jb25maWdcXG5gKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIEBMb2dEdXJhdGlvbigpXG4gICAgcHJlcGFyZVNlcnZpY2VzRGlyZWN0b3JpZXMoKSB7XG4gICAgICAgIGNvbnN0IGZ3MjQgPSBGdzI0LmdldEluc3RhbmNlKCk7XG5cbiAgICAgICAgY29uc3Qgc2VydmljZURpcmVjdG9yaWVzID0gWyBwYXRoUmVzb2x2ZSgnLi9zcmMvc2VydmljZXMvJykgXTtcblxuICAgICAgICBpZiAoZncyNC5oYXNNb2R1bGVzKCkpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBVaS1jb25maWctZ2VuOjo6IFByb2Nlc3M6OjogYXBwIGhhcyBtb2R1bGVzOiBgLCBBcnJheS5mcm9tKGZ3MjQuZ2V0TW9kdWxlcygpLmtleXMoKSkpO1xuICAgICAgICAgICAgZm9yIChjb25zdCBbICwgbW9kdWxlIF0gb2YgZncyNC5nZXRNb2R1bGVzKCkpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBtb2R1bGVTZXJ2aWNlc1BhdGggPSBwYXRoSm9pbihtb2R1bGUuZ2V0QmFzZVBhdGgoKSwgbW9kdWxlLmdldFNlcnZpY2VzRGlyZWN0b3J5KCkpO1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBVaS1jb25maWctZ2VuOjo6IFByb2Nlc3M6OjogbW9kdWxlU2VydmljZXNQYXRoOiBgLCBtb2R1bGVTZXJ2aWNlc1BhdGgpO1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBVaS1jb25maWctZ2VuOjo6IFByb2Nlc3M6OjogcmVzLW1vZHVsZVNlcnZpY2VzUGF0aDogYCwgcGF0aFJlc29sdmUobW9kdWxlU2VydmljZXNQYXRoKSk7XG4gICAgICAgICAgICAgICAgc2VydmljZURpcmVjdG9yaWVzLnB1c2gocGF0aFJlc29sdmUobW9kdWxlU2VydmljZXNQYXRoKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gc2VydmljZURpcmVjdG9yaWVzO1xuICAgIH1cblxuICAgIEBMb2dEdXJhdGlvbigpXG4gICAgYXN5bmMgc2NhbkFuZExvYWRTZXJ2aWNlcyhzZXJ2aWNlRGlyZWN0b3JpZXM6IEFycmF5PHN0cmluZz4pIHtcblxuICAgICAgICBjb25zdCBzY2FubmVkU2VydmljZXMgPSBuZXcgU2V0PEZ1bmN0aW9uPigpO1xuXG4gICAgICAgIGZvciAoY29uc3QgZGlyIG9mIHNlcnZpY2VEaXJlY3Rvcmllcykge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFVpLWNvbmZpZy1nZW46OjogUHJvY2Vzczo6OiBsb2FkaW5nIHNlcnZpY2VzIGZyb20gRElSOiBgLCBkaXIpO1xuICAgICAgICAgICAgY29uc3QgZGlyU2VydmljZVRva2VucyA9IGF3YWl0IHRoaXMuc2NhblNlcnZpY2VzRnJvbURpcmVjdG9yeShkaXIpO1xuICAgICAgICAgICAgZGlyU2VydmljZVRva2Vucy5mb3JFYWNoKHRva2VuID0+IHNjYW5uZWRTZXJ2aWNlcy5hZGQodG9rZW4pKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGdldCBhbGwgY29udGFpbmVyIHJlZ2lzdGVyZWQgc2VydmljZXMgdG8gbWFrZSBzdXJlIGF1dG8tZ2VuIGVudGl0eS1zZXJ2aWNlcyBhcmUgYWxzbyBpbmNsdWRlZFxuICAgICAgICB0aGlzLnVpR2VuRElDb250YWluZXIuY29sbGVjdEJlc3RQcm92aWRlcnNGb3Ioe1xuICAgICAgICAgICAgdHlwZTogJ3NlcnZpY2UnLFxuICAgICAgICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVyczogdHJ1ZVxuICAgICAgICB9KS5maWx0ZXIob3B0ID0+IHtcbiAgICAgICAgICAgIC8vIG1ha2Ugc3VyZSB0byBjb2xsZWN0IG9ubHkgdGhlIGVudGl0eSBzZXJ2aWNlIHByb3ZpZGVyc1xuICAgICAgICAgICAgcmV0dXJuICEhb3B0Ll9wcm92aWRlci5mb3JFbnRpdHlcbiAgICAgICAgfSkuZm9yRWFjaChvcHQgPT4ge1xuICAgICAgICAgICAgc2Nhbm5lZFNlcnZpY2VzLmFkZChvcHQuX3Byb3ZpZGVyLnByb3ZpZGUgYXMgRnVuY3Rpb24pO1xuICAgICAgICB9KVxuXG4gICAgICAgIC8vIHJlc29sdmUgYWxsIHNlcnZpY2VzXG4gICAgICAgIGNvbnN0IHJlc29sdmVkU2VydmljZXMgPSBuZXcgTWFwPHN0cmluZywgQmFzZUVudGl0eVNlcnZpY2U8YW55Pj4oKTtcblxuICAgICAgICBzY2FubmVkU2VydmljZXMuZm9yRWFjaCh0b2tlbiA9PiB7XG4gICAgICAgICAgICBjb25zdCBzZXJ2aWNlID0gdGhpcy51aUdlbkRJQ29udGFpbmVyLnJlc29sdmUodG9rZW4sIHtcbiAgICAgICAgICAgICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzOiB0cnVlXG4gICAgICAgICAgICB9KSBhcyBCYXNlRW50aXR5U2VydmljZTxhbnk+O1xuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgcmVzb2x2ZWQgc2VydmljZSBmb3IgZW50aXR5OiAke3NlcnZpY2UuZ2V0RW50aXR5TmFtZSgpfWApO1xuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgVWktY29uZmlnLWdlbjo6OiBQcm9jZXNzOjo6IGxvYWRlZCBzZXJ2aWNlcyBmcm9tIGVudGl0eTogYCwgc2VydmljZS5nZXRFbnRpdHlOYW1lKCkpO1xuICAgICAgICAgICAgcmVzb2x2ZWRTZXJ2aWNlcy5zZXQoc2VydmljZS5nZXRFbnRpdHlOYW1lKCksIHNlcnZpY2UpO1xuICAgICAgICB9KVxuXG4gICAgICAgIHJldHVybiByZXNvbHZlZFNlcnZpY2VzO1xuICAgIH1cblxuICAgIEBMb2dEdXJhdGlvbigpXG4gICAgYXN5bmMgc2NhblNlcnZpY2VzRnJvbURpcmVjdG9yeShzZXJ2aWNlc0Rpcjogc3RyaW5nKSB7XG5cbiAgICAgICAgY29uc3Qgc2Nhbm5lZFNlcnZpY2VzID0gbmV3IFNldDxGdW5jdGlvbj4oKTtcblxuICAgICAgICBpZiAoIWV4aXN0c1N5bmMoc2VydmljZXNEaXIpKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBzY2FuU2VydmljZXNGcm9tRGlyZWN0b3J5OiBzZXJ2aWNlc0RpciBkb2VzIG5vdCBleGlzdHM6ICR7c2VydmljZXNEaXJ9YCk7XG4gICAgICAgICAgICByZXR1cm4gc2Nhbm5lZFNlcnZpY2VzO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3Qgc2VydmljZVBhdGhzID0gSGVscGVyLnNjYW5Db250cm9sbGVyU291cmNlRmlsZXNGcm9tKHNlcnZpY2VzRGlyKTtcblxuICAgICAgICBmb3IgKGNvbnN0IHNlcnZpY2VQYXRoIG9mIHNlcnZpY2VQYXRocykge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYHRyeWluZyB0byBsb2FkIHNlcnZpY2VQYXRoOiAke3NlcnZpY2VQYXRofWApO1xuXG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIC8vIER5bmFtaWNhbGx5IGltcG9ydCB0aGUgc2VydmljZSBmaWxlXG4gICAgICAgICAgICAgICAgY29uc3QgbW9kdWxlID0gYXdhaXQgaW1wb3J0KHBhdGhKb2luKHNlcnZpY2VzRGlyLCBzZXJ2aWNlUGF0aCkpO1xuXG4gICAgICAgICAgICAgICAgLy8gRmluZCBhbmQgaW5zdGFudGlhdGUgc2VydmljZSBjbGFzc2VzXG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCBleHBvcnRlZEl0ZW0gb2YgT2JqZWN0LnZhbHVlcyhtb2R1bGUpKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChcbiAgICAgICAgICAgICAgICAgICAgICAgIGV4cG9ydGVkSXRlbVxuICAgICAgICAgICAgICAgICAgICAgICAgJiYgdHlwZW9mIGV4cG9ydGVkSXRlbSA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICAgICAgICAgICAgICAgICAgJiYgJ3Byb3RvdHlwZScgaW4gZXhwb3J0ZWRJdGVtXG4gICAgICAgICAgICAgICAgICAgICAgICAmJiBleHBvcnRlZEl0ZW0ucHJvdG90eXBlIGluc3RhbmNlb2YgQmFzZUVudGl0eVNlcnZpY2VcbiAgICAgICAgICAgICAgICAgICAgKSB7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLnVpR2VuRElDb250YWluZXIuaGFzKGV4cG9ydGVkSXRlbSwge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzOiB0cnVlXG4gICAgICAgICAgICAgICAgICAgICAgICB9KSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNjYW5uZWRTZXJ2aWNlcy5hZGQoZXhwb3J0ZWRJdGVtKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1Zyhgc2NhblNlcnZpY2VzRnJvbURpcmVjdG9yeTogcmVnaXN0ZXJpbmcgc2VydmljZTogJHtleHBvcnRlZEl0ZW0ubmFtZX1gKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYHNjYW5TZXJ2aWNlc0Zyb21EaXJlY3Rvcnk6IG5vIHByb3ZpZGVyIGNvdWxkIGJlIGZvdW5kIGZvciBzZXJ2aWNlOiAke2V4cG9ydGVkSXRlbS5uYW1lfWApO1xuXG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBzY2FuU2VydmljZXNGcm9tRGlyZWN0b3J5OiBTS0lQOiBleHBvcnRlZEl0ZW0gaXMgbm90IGEgc2VydmljZSBjbGFzczogJHsoZXhwb3J0ZWRJdGVtIGFzIGFueSk/Lm5hbWUgPyAoZXhwb3J0ZWRJdGVtIGFzIGFueSkubmFtZSA6IGV4cG9ydGVkSXRlbX1gKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgc2NhblNlcnZpY2VzRnJvbURpcmVjdG9yeTogRXhjZXB0aW9uIHdoaWxlIHRyeWluZyB0byBsb2FkIHNlcnZpY2VQYXRoOiAke3NlcnZpY2VQYXRofWAsIGUpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHNjYW5uZWRTZXJ2aWNlcztcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBXcml0ZSBKU09OIGNvbmZpZyBmaWxlIGFuZCBjcmVhdGUgY29tcHJlc3NlZCB2ZXJzaW9ucyAoZ3ppcCBhbmQgYnJvdGxpKVxuICAgICAqIGZvciBicm93c2VyLWNvbXBhdGlibGUgZGVsaXZlcnlcbiAgICAgKi9cbiAgICBwcml2YXRlIHdyaXRlQ29uZmlnRmlsZShmaWxlUGF0aDogc3RyaW5nLCBkYXRhOiBhbnksIGNvbmZpZ05hbWU6IHN0cmluZykge1xuICAgICAgICBjb25zdCBqc29uU3RyaW5nID0gSlNPTi5zdHJpbmdpZnkoZGF0YSwgbnVsbCwgMik7XG4gICAgICAgIGNvbnN0IGpzb25CdWZmZXIgPSBCdWZmZXIuZnJvbShqc29uU3RyaW5nLCAndXRmLTgnKTtcblxuICAgICAgICAvLyBXcml0ZSBvcmlnaW5hbCBKU09OIGZpbGVcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYHdyaXRpbmcgJHtjb25maWdOYW1lfSBjb25maWcuLiBpbnRvOiAke2ZpbGVQYXRofWApO1xuICAgICAgICB3cml0ZUZpbGVTeW5jKGZpbGVQYXRoLCBqc29uU3RyaW5nKTtcblxuICAgICAgICAvLyBXcml0ZSBnemlwIGNvbXByZXNzZWQgdmVyc2lvblxuICAgICAgICBjb25zdCBnemlwRmlsZVBhdGggPSBgJHtmaWxlUGF0aH0uZ3pgO1xuICAgICAgICBjb25zdCBnemlwQ29tcHJlc3NlZCA9IGd6aXBTeW5jKGpzb25CdWZmZXIsIHsgbGV2ZWw6IGNvbnN0YW50cy5aX0JFU1RfQ09NUFJFU1NJT04gfSk7XG4gICAgICAgIHdyaXRlRmlsZVN5bmMoZ3ppcEZpbGVQYXRoLCBnemlwQ29tcHJlc3NlZCk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGB3cml0aW5nICR7Y29uZmlnTmFtZX0gY29uZmlnIChnemlwKS4uIGludG86ICR7Z3ppcEZpbGVQYXRofWApO1xuXG4gICAgICAgIC8vIFdyaXRlIGJyb3RsaSBjb21wcmVzc2VkIHZlcnNpb25cbiAgICAgICAgY29uc3QgYnJvdGxpRmlsZVBhdGggPSBgJHtmaWxlUGF0aH0uYnJgO1xuICAgICAgICBjb25zdCBicm90bGlDb21wcmVzc2VkID0gYnJvdGxpQ29tcHJlc3NTeW5jKGpzb25CdWZmZXIsIHtcbiAgICAgICAgICAgIHBhcmFtczoge1xuICAgICAgICAgICAgICAgIFsgY29uc3RhbnRzLkJST1RMSV9QQVJBTV9RVUFMSVRZIF06IGNvbnN0YW50cy5CUk9UTElfTUFYX1FVQUxJVFkgIC8vIE1heCBxdWFsaXR5ICgwLTExKVxuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgd3JpdGVGaWxlU3luYyhicm90bGlGaWxlUGF0aCwgYnJvdGxpQ29tcHJlc3NlZCk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGB3cml0aW5nICR7Y29uZmlnTmFtZX0gY29uZmlnIChicm90bGkpLi4gaW50bzogJHticm90bGlGaWxlUGF0aH1gKTtcblxuICAgICAgICAvLyBMb2cgY29tcHJlc3Npb24gcmF0aW9zXG4gICAgICAgIGNvbnN0IG9yaWdpbmFsU2l6ZSA9IGpzb25CdWZmZXIubGVuZ3RoO1xuICAgICAgICBjb25zdCBnemlwU2l6ZSA9IGd6aXBDb21wcmVzc2VkLmxlbmd0aDtcbiAgICAgICAgY29uc3QgYnJvdGxpU2l6ZSA9IGJyb3RsaUNvbXByZXNzZWQubGVuZ3RoO1xuICAgICAgICBjb25zdCBnemlwUmF0aW8gPSAoKDEgLSBnemlwU2l6ZSAvIG9yaWdpbmFsU2l6ZSkgKiAxMDApLnRvRml4ZWQoMik7XG4gICAgICAgIGNvbnN0IGJyb3RsaVJhdGlvID0gKCgxIC0gYnJvdGxpU2l6ZSAvIG9yaWdpbmFsU2l6ZSkgKiAxMDApLnRvRml4ZWQoMik7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhcbiAgICAgICAgICAgIGAke2NvbmZpZ05hbWV9IGNvbXByZXNzaW9uIHN0YXRzOiBgICtcbiAgICAgICAgICAgIGBvcmlnaW5hbDogJHtvcmlnaW5hbFNpemV9YiwgYCArXG4gICAgICAgICAgICBgZ3ppcDogJHtnemlwU2l6ZX1iICgke2d6aXBSYXRpb30lIHNtYWxsZXIpLCBgICtcbiAgICAgICAgICAgIGBicm90bGk6ICR7YnJvdGxpU2l6ZX1iICgke2Jyb3RsaVJhdGlvfSUgc21hbGxlcilgXG4gICAgICAgICk7XG4gICAgfVxuXG4gICAgQExvZ0R1cmF0aW9uKClcbiAgICBhc3luYyB3cml0ZVRvRmlsZXMobWVudUNvbmZpZzogYW55LCBlbnRpdGllc0NvbmZpZzogYW55LCBhdXRoQ29uZmlnOiBhbnksIGRhc2hib2FyZENvbmZpZzogYW55KSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiQ2FsbGVkIHdyaXRlVG9GaWxlczo6Ojo6OiBcIik7XG4gICAgICAgIGNvbnN0IGdlbkRpcmVjdG9yeVBhdGggPSBwYXRoUmVzb2x2ZSgnLi9nZW4vJyk7XG4gICAgICAgIGlmICghZXhpc3RzU3luYyhnZW5EaXJlY3RvcnlQYXRoKSkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEdlbiBESVIgZG9lcyBub3QgZXhpc3RzLCBjcmVhdGluZzogJHtnZW5EaXJlY3RvcnlQYXRofWAsKTtcbiAgICAgICAgICAgIG1rZGlyU3luYyhnZW5EaXJlY3RvcnlQYXRoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGNvbmZpZ0RpcmVjdG9yeVBhdGggPSBwYXRoUmVzb2x2ZShwYXRoSm9pbihnZW5EaXJlY3RvcnlQYXRoLCAnY29uZmlnJykpO1xuICAgICAgICBpZiAoIWV4aXN0c1N5bmMoY29uZmlnRGlyZWN0b3J5UGF0aCkpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDb25maWcgRElSIGRvZXMgbm90IGV4aXN0cywgY3JlYXRpbmc6ICR7Y29uZmlnRGlyZWN0b3J5UGF0aH1gKTtcbiAgICAgICAgICAgIG1rZGlyU3luYyhjb25maWdEaXJlY3RvcnlQYXRoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFdyaXRlIG1lbnUgY29uZmlnIHdpdGggY29tcHJlc3NlZCB2ZXJzaW9uc1xuICAgICAgICBjb25zdCBtZW51Q29uZmlnRmlsZVBhdGggPSBwYXRoSm9pbihjb25maWdEaXJlY3RvcnlQYXRoLCAnbWVudS5qc29uJyk7XG4gICAgICAgIHRoaXMud3JpdGVDb25maWdGaWxlKG1lbnVDb25maWdGaWxlUGF0aCwgbWVudUNvbmZpZywgJ21lbnUnKTtcblxuICAgICAgICAvLyBXcml0ZSBlbnRpdGllcyBjb25maWcgd2l0aCBjb21wcmVzc2VkIHZlcnNpb25zXG4gICAgICAgIGNvbnN0IGVudGl0aWVzQ29uZmlnRmlsZVBhdGggPSBwYXRoSm9pbihjb25maWdEaXJlY3RvcnlQYXRoLCAnZW50aXRpZXMuanNvbicpO1xuICAgICAgICB0aGlzLndyaXRlQ29uZmlnRmlsZShlbnRpdGllc0NvbmZpZ0ZpbGVQYXRoLCBlbnRpdGllc0NvbmZpZywgJ2VudGl0aWVzJyk7XG5cbiAgICAgICAgLy8gV3JpdGUgYXV0aCBjb25maWcgd2l0aCBjb21wcmVzc2VkIHZlcnNpb25zXG4gICAgICAgIGNvbnN0IGF1dGhDb25maWdGaWxlUGF0aCA9IHBhdGhKb2luKGNvbmZpZ0RpcmVjdG9yeVBhdGgsICdhdXRoLmpzb24nKTtcbiAgICAgICAgdGhpcy53cml0ZUNvbmZpZ0ZpbGUoYXV0aENvbmZpZ0ZpbGVQYXRoLCBhdXRoQ29uZmlnLCAnYXV0aCcpO1xuXG4gICAgICAgIC8vIFdyaXRlIGRhc2hib2FyZCBjb25maWcgd2l0aCBjb21wcmVzc2VkIHZlcnNpb25zXG4gICAgICAgIGNvbnN0IGRhc2hib2FyZENvbmZpZ0ZpbGVQYXRoID0gcGF0aEpvaW4oY29uZmlnRGlyZWN0b3J5UGF0aCwgJ2Rhc2hib2FyZC5qc29uJyk7XG4gICAgICAgIHRoaXMud3JpdGVDb25maWdGaWxlKGRhc2hib2FyZENvbmZpZ0ZpbGVQYXRoLCBkYXNoYm9hcmRDb25maWcsICdkYXNoYm9hcmQnKTtcblxuICAgIH1cbn1cblxuIl19