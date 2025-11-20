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
        for (const dir of customPagesDirectories) {
            if (!(0, fs_1.existsSync)(dir)) {
                this.logger.debug(`Custom pages directory does not exist: ${dir}`);
                continue;
            }
            const customPageFiles = helper_1.Helper.scanControllerSourceFilesFrom(dir);
            for (const file of customPageFiles) {
                try {
                    const module = await Promise.resolve(`${(0, path_1.join)(dir, file)}`).then(s => __importStar(require(s)));
                    for (const [key, value] of Object.entries(module)) {
                        if (this.isValidCustomPageConfig(value)) {
                            const pageName = this.getPageNameFromConfig(value);
                            if (pageName) {
                                this.registerCustomPage(value);
                                this.logger.info(`Registered custom page: ${pageName}`);
                            }
                        }
                    }
                }
                catch (e) {
                    this.logger.error(`Error loading custom page from ${file}:`, e);
                }
            }
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
        const globalUIConfigOptions = fw24_1.Fw24.getInstance().getConfig().uiConfigGenOptions;
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
                    defaultSort: entitySchema.model.listPageConfig?.defaultSort || entitySchema.model.listPageDefaultSort,
                    tableConfig: entitySchema.model.listPageConfig?.tableConfig,
                    globalUIConfigOptions, // NEW: Pass global config
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
                    globalUIConfigOptions, // NEW: Pass global config
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
        const menuConfigFilePath = (0, path_1.join)(configDirectoryPath, 'menu.json');
        this.logger.debug(`writing menu-config.. into: ${menuConfigFilePath}`);
        (0, fs_1.writeFileSync)(menuConfigFilePath, JSON.stringify(menuConfig, null, 2));
        const entitiesConfigFilePath = (0, path_1.join)(configDirectoryPath, 'entities.json');
        this.logger.debug(`writing entities-config.. into: ${entitiesConfigFilePath}`);
        (0, fs_1.writeFileSync)(entitiesConfigFilePath, JSON.stringify(entitiesConfig, null, 2));
        const authConfigFilePath = (0, path_1.join)(configDirectoryPath, 'auth.json');
        this.logger.debug(`writing auth-config.. into: ${authConfigFilePath}`);
        (0, fs_1.writeFileSync)(authConfigFilePath, JSON.stringify(authConfig, null, 2));
        const dashboardConfigFilePath = (0, path_1.join)(configDirectoryPath, 'dashboard.json');
        this.logger.debug(`writing dashboard-config.. into: ${dashboardConfigFilePath}`);
        (0, fs_1.writeFileSync)(dashboardConfigFilePath, JSON.stringify(dashboardConfig, null, 2));
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW50aXR5LXVpLWNvbmZpZy5nZW4uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdWktY29uZmlnLWdlbi9lbnRpdHktdWktY29uZmlnLmdlbi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFDQSw4RUFBK0Q7QUFDL0QsOEVBQStEO0FBQy9ELDBFQUEyRDtBQUMzRCwwRUFBMkQ7QUFDM0QsMEVBQTJEO0FBQzNELHNDQUE0RDtBQUM1RCx5REFBMEo7QUFFMUosNERBQThDO0FBQzlDLHNFQUF3RDtBQUV4RCwyQkFBMEQ7QUFDMUQsK0JBR2M7QUFFZCx1Q0FBb0M7QUFDcEMsMkNBQXdDO0FBQ3hDLHdDQUF1RDtBQUN2RCwwQ0FBd0M7QUFFeEMsTUFBYSxpQkFBaUI7SUFDakIsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxpQkFBaUIsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUN2RCw4RkFBOEY7SUFDOUYsbUNBQW1DO0lBQzFCLGdCQUFnQixHQUFHLFdBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO0lBRTNELFdBQVcsR0FBbUMsSUFBSSxHQUFHLEVBQUUsQ0FBQztJQUcxRCxBQUFOLEtBQUssQ0FBQyxlQUFlO1FBQ2pCLE1BQU0sSUFBSSxHQUFHLFdBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztRQUNoQyxNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUM7UUFDaEMsTUFBTSxjQUFjLEdBQUcsTUFBTSxDQUFDLGtCQUFrQixFQUFFLG9CQUFvQixJQUFJLGNBQWMsQ0FBQztRQUV6RixNQUFNLHNCQUFzQixHQUFHLENBQUUsSUFBQSxjQUFXLEVBQUMsU0FBUyxjQUFjLEdBQUcsQ0FBQyxDQUFFLENBQUM7UUFFM0UsSUFBSSxJQUFJLENBQUMsVUFBVSxFQUFFLEVBQUUsQ0FBQztZQUNwQixLQUFLLE1BQU0s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QUFDLCtCQUErQixrQkFBa0IsRUFBRSxDQUFFLENBQUM7UUFDeEUsSUFBQSxrQkFBYSxFQUFDLGtCQUFrQixFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsVUFBVSxFQUFFLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBRXZFLE1BQU0sdUJBQXVCLEdBQUcsSUFBQSxXQUFRLEVBQUMsbUJBQW1CLEVBQUUsZ0JBQWdCLENBQUMsQ0FBQztRQUNoRixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxvQ0FBb0MsdUJBQXVCLEVBQUUsQ0FBRSxDQUFDO1FBQ2xGLElBQUEsa0JBQWEsRUFBQyx1QkFBdUIsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLGVBQWUsRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUVyRixDQUFDO0NBQ0o7QUFua0JELDhDQW1rQkM7QUExakJTO0lBREwsSUFBQSxxQkFBVyxHQUFFO3dEQXdDYjtBQXVFSztJQURMLElBQUEscUJBQVcsR0FBRTtnREErTWI7QUFpSEQ7SUFEQyxJQUFBLHFCQUFXLEdBQUU7bUVBaUJiO0FBR0s7SUFETCxJQUFBLHFCQUFXLEdBQUU7NERBcUNiO0FBR0s7SUFETCxJQUFBLHFCQUFXLEdBQUU7a0VBa0RiO0FBR0s7SUFETCxJQUFBLHFCQUFXLEdBQUU7cURBK0JiIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgdHlwZSB9IGZyb20gJ29zJztcbmltcG9ydCBNYWtlQ3JlYXRlRW50aXR5Q29uZmlnIGZyb20gJy4vdGVtcGxhdGVzL2NyZWF0ZS1lbnRpdHknO1xuaW1wb3J0IE1ha2VVcGRhdGVFbnRpdHlDb25maWcgZnJvbSAnLi90ZW1wbGF0ZXMvdXBkYXRlLWVudGl0eSc7XG5pbXBvcnQgTWFrZUxpc3RFbnRpdHlDb25maWcgZnJvbSAnLi90ZW1wbGF0ZXMvbGlzdC1lbnRpdHknO1xuaW1wb3J0IE1ha2VWaWV3RW50aXR5Q29uZmlnIGZyb20gJy4vdGVtcGxhdGVzL3ZpZXctZW50aXR5JztcbmltcG9ydCBNYWtlRW50aXR5TWVudUNvbmZpZyBmcm9tICcuL3RlbXBsYXRlcy9lbnRpdHktbWVudSc7XG5pbXBvcnQgeyBCYXNlRW50aXR5U2VydmljZSwgRW50aXR5U2NoZW1hIH0gZnJvbSAnLi4vZW50aXR5JztcbmltcG9ydCB7IG1ha2VDdXN0b21QYWdlQ29uZmlnLCBDdXN0b21QYWdlT3B0aW9ucywgTGlzdFBhZ2VDb25maWcsIEZvcm1QYWdlQ29uZmlnLCBEZXRhaWxzUGFnZUNvbmZpZywgRGFzaGJvYXJkUGFnZUNvbmZpZyB9IGZyb20gJy4vdGVtcGxhdGVzL2N1c3RvbS1wYWdlJztcblxuaW1wb3J0IE1ha2VBdXRoQ29uZmlnIGZyb20gJy4vdGVtcGxhdGVzL2F1dGgnO1xuaW1wb3J0IE1ha2VEYXNoYm9hcmRDb25maWcgZnJvbSAnLi90ZW1wbGF0ZXMvZGFzaGJvYXJkJztcblxuaW1wb3J0IHsgZXhpc3RzU3luYywgbWtkaXJTeW5jLCB3cml0ZUZpbGVTeW5jIH0gZnJvbSBcImZzXCI7XG5pbXBvcnQge1xuICAgIHJlc29sdmUgYXMgcGF0aFJlc29sdmUsXG4gICAgam9pbiBhcyBwYXRoSm9pblxufSBmcm9tIFwicGF0aFwiO1xuXG5pbXBvcnQgeyBGdzI0IH0gZnJvbSAnLi4vY29yZS9mdzI0JztcbmltcG9ydCB7IEhlbHBlciB9IGZyb20gJy4uL2NvcmUvaGVscGVyJztcbmltcG9ydCB7IExvZ0R1cmF0aW9uLCBjcmVhdGVMb2dnZXIgfSBmcm9tICcuLi9sb2dnaW5nJztcbmltcG9ydCB7IHRvU2x1ZyB9IGZyb20gJy4uL3V0aWxzL2Nhc2VzJztcblxuZXhwb3J0IGNsYXNzIEVudGl0eVVJQ29uZmlnR2VuIHtcbiAgICByZWFkb25seSBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoRW50aXR5VUlDb25maWdHZW4ubmFtZSk7XG4gICAgLy8gbWFrZSBzdXJlIHRvIGNyZWF0ZSBhIGNoaWxkIGNvbnRhaW5lciB0byBub3QgcG9sbHV0ZSBhbnl0aGluZyBpbiB0aGUgQXBwbGljYXRpb24gY29udGFpbmVyIFxuICAgIC8vIHdoaWxlIHNjYW5uaW5nIGFuZCBsb2FkaW5nIHN0dWZmXG4gICAgcmVhZG9ubHkgdWlHZW5ESUNvbnRhaW5lciA9IEZ3MjQuZ2V0SW5zdGFuY2UoKS5nZXRBcHBESUNvbnRhaW5lcigpO1xuXG4gICAgcHJpdmF0ZSBjdXN0b21QYWdlczogTWFwPHN0cmluZywgQ3VzdG9tUGFnZU9wdGlvbnM+ID0gbmV3IE1hcCgpO1xuXG4gICAgQExvZ0R1cmF0aW9uKClcbiAgICBhc3luYyBzY2FuQ3VzdG9tUGFnZXMoKSB7XG4gICAgICAgIGNvbnN0IGZ3MjQgPSBGdzI0LmdldEluc3RhbmNlKCk7XG4gICAgICAgIGNvbnN0IGNvbmZpZyA9IGZ3MjQuZ2V0Q29uZmlnKCk7XG4gICAgICAgIGNvbnN0IGN1c3RvbVBhZ2VzRGlyID0gY29uZmlnLnVpQ29uZmlnR2VuT3B0aW9ucz8uY3VzdG9tUGFnZXNEaXJlY3RvcnkgfHwgJ2N1c3RvbS1wYWdlcyc7XG5cbiAgICAgICAgY29uc3QgY3VzdG9tUGFnZXNEaXJlY3RvcmllcyA9IFsgcGF0aFJlc29sdmUoYC4vc3JjLyR7Y3VzdG9tUGFnZXNEaXJ9L2ApIF07XG5cbiAgICAgICAgaWYgKGZ3MjQuaGFzTW9kdWxlcygpKSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IFsgLCBtb2R1bGUgXSBvZiBmdzI0LmdldE1vZHVsZXMoKSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IG1vZHVsZUN1c3RvbVBhZ2VzUGF0aCA9IHBhdGhKb2luKG1vZHVsZS5nZXRCYXNlUGF0aCgpLCBjdXN0b21QYWdlc0Rpcik7XG4gICAgICAgICAgICAgICAgY3VzdG9tUGFnZXNEaXJlY3Rvcmllcy5wdXNoKHBhdGhSZXNvbHZlKG1vZHVsZUN1c3RvbVBhZ2VzUGF0aCkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgZm9yIChjb25zdCBkaXIgb2YgY3VzdG9tUGFnZXNEaXJlY3Rvcmllcykge1xuICAgICAgICAgICAgaWYgKCFleGlzdHNTeW5jKGRpcikpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQ3VzdG9tIHBhZ2VzIGRpcmVjdG9yeSBkb2VzIG5vdCBleGlzdDogJHtkaXJ9YCk7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGN1c3RvbVBhZ2VGaWxlcyA9IEhlbHBlci5zY2FuQ29udHJvbGxlclNvdXJjZUZpbGVzRnJvbShkaXIpO1xuXG4gICAgICAgICAgICBmb3IgKGNvbnN0IGZpbGUgb2YgY3VzdG9tUGFnZUZpbGVzKSB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbW9kdWxlID0gYXdhaXQgaW1wb3J0KHBhdGhKb2luKGRpciwgZmlsZSkpO1xuICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IFsga2V5LCB2YWx1ZSBdIG9mIE9iamVjdC5lbnRyaWVzKG1vZHVsZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLmlzVmFsaWRDdXN0b21QYWdlQ29uZmlnKHZhbHVlKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHBhZ2VOYW1lID0gdGhpcy5nZXRQYWdlTmFtZUZyb21Db25maWcodmFsdWUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChwYWdlTmFtZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnJlZ2lzdGVyQ3VzdG9tUGFnZSh2YWx1ZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFJlZ2lzdGVyZWQgY3VzdG9tIHBhZ2U6ICR7cGFnZU5hbWV9YCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgRXJyb3IgbG9hZGluZyBjdXN0b20gcGFnZSBmcm9tICR7ZmlsZX06YCwgZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHVibGljIGlzVmFsaWRDdXN0b21QYWdlQ29uZmlnKHZhbHVlOiB1bmtub3duKTogdmFsdWUgaXMgQ3VzdG9tUGFnZU9wdGlvbnMge1xuICAgICAgICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gJ29iamVjdCcpIHJldHVybiBmYWxzZTtcblxuICAgICAgICBjb25zdCBjb25maWcgPSB2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICAgICAgaWYgKCEoJ3BhZ2VUeXBlJyBpbiBjb25maWcpIHx8ICEoJ3BhZ2VUaXRsZScgaW4gY29uZmlnKSkgcmV0dXJuIGZhbHNlO1xuXG4gICAgICAgIGNvbnN0IHBhZ2VUeXBlID0gY29uZmlnLnBhZ2VUeXBlO1xuICAgICAgICBpZiAocGFnZVR5cGUgPT09ICdsaXN0Jykge1xuICAgICAgICAgICAgcmV0dXJuICdsaXN0UGFnZUNvbmZpZycgaW4gY29uZmlnO1xuICAgICAgICB9IGVsc2UgaWYgKHBhZ2VUeXBlID09PSAnZm9ybScpIHtcbiAgICAgICAgICAgIHJldHVybiAnZm9ybVBhZ2VDb25maWcnIGluIGNvbmZpZztcbiAgICAgICAgfSBlbHNlIGlmIChwYWdlVHlwZSA9PT0gJ2RldGFpbHMnKSB7XG4gICAgICAgICAgICByZXR1cm4gJ2RldGFpbHNQYWdlQ29uZmlnJyBpbiBjb25maWc7XG4gICAgICAgIH0gZWxzZSBpZiAocGFnZVR5cGUgPT09ICdkYXNoYm9hcmQnKSB7XG4gICAgICAgICAgICByZXR1cm4gJ2Rhc2hib2FyZFBhZ2VDb25maWcnIGluIGNvbmZpZztcbiAgICAgICAgfSBlbHNlIGlmIChwYWdlVHlwZSA9PT0gJ2FjY29yZGlvbicpIHtcbiAgICAgICAgICAgIHJldHVybiAnYWNjb3JkaW9uUGFnZUNvbmZpZycgaW4gY29uZmlnO1xuICAgICAgICB9IGVsc2UgaWYgKHBhZ2VUeXBlID09PSAnbWVudScpIHtcbiAgICAgICAgICAgIHJldHVybiAnbWVudVBhZ2VDb25maWcnIGluIGNvbmZpZztcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBnZXRQYWdlTmFtZUZyb21Db25maWcoY29uZmlnOiBDdXN0b21QYWdlT3B0aW9ucyk6IHN0cmluZyB8IG51bGwge1xuICAgICAgICBpZiAoY29uZmlnLnBhZ2VOYW1lKSB7XG4gICAgICAgICAgICByZXR1cm4gdG9TbHVnKGNvbmZpZy5wYWdlTmFtZSk7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIC8vIEZvciB0ZW1wbGF0ZS1iYXNlZCBwYWdlIHRpdGxlcyAob2JqZWN0cyksIHBhZ2VOYW1lIE1VU1QgYmUgcHJvdmlkZWRcbiAgICAgICAgLy8gRXh0cmFjdCBzdHJpbmcgZnJvbSBwYWdlVGl0bGUgKGhhbmRsZXMgYm90aCBzdHJpbmcgYW5kIFRlbXBsYXRlIHR5cGVzKVxuICAgICAgICBjb25zdCBwYWdlVGl0bGVTdHJpbmcgPSB0eXBlb2YgY29uZmlnLnBhZ2VUaXRsZSA9PT0gJ3N0cmluZycgXG4gICAgICAgICAgICA/IGNvbmZpZy5wYWdlVGl0bGUgXG4gICAgICAgICAgICA6ICdjdXN0b20tcGFnZSc7IC8vIEZhbGxiYWNrIGZvciBUZW1wbGF0ZSBvYmplY3RzXG4gICAgICAgIFxuICAgICAgICBzd2l0Y2ggKGNvbmZpZy5wYWdlVHlwZSkge1xuICAgICAgICAgICAgY2FzZSAnbGlzdCc6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGBsaXN0LSR7dG9TbHVnKHBhZ2VUaXRsZVN0cmluZyl9YDtcbiAgICAgICAgICAgIGNhc2UgJ2Zvcm0nOlxuICAgICAgICAgICAgICAgIHJldHVybiBwYWdlVGl0bGVTdHJpbmcudG9Mb3dlckNhc2UoKS5pbmNsdWRlcygnYWRkJylcbiAgICAgICAgICAgICAgICAgICAgPyBgY3JlYXRlLSR7dG9TbHVnKHBhZ2VUaXRsZVN0cmluZyl9YFxuICAgICAgICAgICAgICAgICAgICA6IGBlZGl0LSR7dG9TbHVnKHBhZ2VUaXRsZVN0cmluZyl9YDtcbiAgICAgICAgICAgIGNhc2UgJ2RldGFpbHMnOlxuICAgICAgICAgICAgICAgIHJldHVybiBgdmlldy0ke3RvU2x1ZyhwYWdlVGl0bGVTdHJpbmcpfWA7XG4gICAgICAgICAgICBjYXNlICdkYXNoYm9hcmQnOlxuICAgICAgICAgICAgICAgIHJldHVybiBgJHt0b1NsdWcocGFnZVRpdGxlU3RyaW5nKX1gO1xuICAgICAgICAgICAgY2FzZSAnYWNjb3JkaW9uJzpcbiAgICAgICAgICAgICAgICByZXR1cm4gYGFjY29yZGlvbi0ke3RvU2x1ZyhwYWdlVGl0bGVTdHJpbmcpfWA7XG4gICAgICAgICAgICBjYXNlICdtZW51JzpcbiAgICAgICAgICAgICAgICByZXR1cm4gYCR7dG9TbHVnKHBhZ2VUaXRsZVN0cmluZyl9YDtcbiAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZWdpc3RlciBhIGN1c3RvbSBwYWdlLiBTdXBwb3J0cyBvcHRpb25hbCByb3V0ZVBhdHRlcm4gZm9yIGR5bmFtaWMgcm91dGVzIChlLmcuLCAvYXV0aG9yLzphdXRob3JJZC9ib29rcylcbiAgICAgKi9cbiAgICBwdWJsaWMgcmVnaXN0ZXJDdXN0b21QYWdlKG9wdGlvbnM6IEN1c3RvbVBhZ2VPcHRpb25zKSB7XG4gICAgICAgIGNvbnN0IHBhZ2VOYW1lID0gdGhpcy5nZXRQYWdlTmFtZUZyb21Db25maWcob3B0aW9ucyk7XG4gICAgICAgIGlmIChwYWdlTmFtZSkge1xuICAgICAgICAgICAgdGhpcy5jdXN0b21QYWdlcy5zZXQocGFnZU5hbWUsIG9wdGlvbnMpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgYXN5bmMgcnVuKCkge1xuICAgICAgICB0aGlzLnByb2Nlc3MoKTtcbiAgICB9XG5cbiAgICBATG9nRHVyYXRpb24oKVxuICAgIGFzeW5jIHByb2Nlc3MoKSB7XG4gICAgICAgIGNvbnN0IG1lbnVDb25maWdzOiBhbnlbXSA9IFtdO1xuICAgICAgICBjb25zdCBlbnRpdHlDb25maWdzOiBhbnkgPSB7fTtcblxuICAgICAgICBjb25zdCBzZXJ2aWNlRGlyZWN0b3JpZXMgPSB0aGlzLnByZXBhcmVTZXJ2aWNlc0RpcmVjdG9yaWVzKCk7XG5cbiAgICAgICAgY29uc3Qgc2VydmljZXMgPSBhd2FpdCB0aGlzLnNjYW5BbmRMb2FkU2VydmljZXMoc2VydmljZURpcmVjdG9yaWVzKTtcblxuICAgICAgICAvLyBTY2FuIGFuZCBsb2FkIGN1c3RvbSBwYWdlc1xuICAgICAgICBhd2FpdCB0aGlzLnNjYW5DdXN0b21QYWdlcygpO1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBVaS1jb25maWctZ2VuOjo6IFByb2Nlc3M6OjogYWxsLXNlcnZpY2VzOiBgLCBBcnJheS5mcm9tKHNlcnZpY2VzLmtleXMoKSkpO1xuXG4gICAgICAgIC8vIEdldCBnbG9iYWwgVUkgY29uZmlnIG9wdGlvbnMgKGluY2x1ZGluZyBkdXBsaWNhdGVkRmllbGREZXRlY3Rpb24pXG4gICAgICAgIGNvbnN0IGdsb2JhbFVJQ29uZmlnT3B0aW9ucyA9IEZ3MjQuZ2V0SW5zdGFuY2UoKS5nZXRDb25maWcoKS51aUNvbmZpZ0dlbk9wdGlvbnM7XG4gICAgICAgIFxuICAgICAgICBsZXQgbWVudUluZGV4ID0gMTtcbiAgICAgICAgLy8gZ2VuZXJhdGUgVUkgY29uZmlnc1xuICAgICAgICBzZXJ2aWNlcy5mb3JFYWNoKChzZXJ2aWNlLCBlbnRpdHlOYW1lKSA9PiB7XG5cbiAgICAgICAgICAgIGxldCBlbnRpdHlTY2hlbWEgPSBzZXJ2aWNlLmdldEVudGl0eVNjaGVtYSgpIGFzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PjtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gQ2hlY2sgZm9yIGRlcHJlY2F0ZWQgdXNhZ2UgYW5kIHdhcm5cbiAgICAgICAgICAgIHRoaXMuY2hlY2tEZXByZWNhdGVkVXNhZ2UoZW50aXR5U2NoZW1hKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gVHJhbnNmb3JtIGxlZ2FjeSBjb25maWcgc3RydWN0dXJlIHRvIG5ldyBuZXN0ZWQgc3RydWN0dXJlIGlmIG5lZWRlZFxuICAgICAgICAgICAgZW50aXR5U2NoZW1hID0gdGhpcy50cmFuc2Zvcm1MZWdhY3lDb25maWcoZW50aXR5U2NoZW1hKTtcbiAgICAgICAgICAgIGNvbnN0IGVudGl0eURlZmF1bHRPcHNTY2hlbWEgPSBzZXJ2aWNlLmdldE9wc0RlZmF1bHRJT1NjaGVtYSgpO1xuXG4gICAgICAgICAgICBpZiAoIWVudGl0eVNjaGVtYS5tb2RlbC5leGNsdWRlRnJvbUFkbWluQ3JlYXRlKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgY3JlYXRlQ29uZmlnID0gTWFrZUNyZWF0ZUVudGl0eUNvbmZpZyh7XG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWVQbHVyYWw6IGVudGl0eVNjaGVtYS5tb2RlbC5lbnRpdHlOYW1lUGx1cmFsLFxuICAgICAgICAgICAgICAgICAgICBDUlVEQXBpUGF0aDogZW50aXR5U2NoZW1hLm1vZGVsLkNSVURBcGlQYXRoLFxuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiBlbnRpdHlEZWZhdWx0T3BzU2NoZW1hLmNyZWF0ZS5pbnB1dCxcbiAgICAgICAgICAgICAgICAgICAgLy8gVXNlIG5ldyBuZXN0ZWQgY29uZmlnIGlmIGF2YWlsYWJsZSwgZmFsbGJhY2sgdG8gb2xkXG4gICAgICAgICAgICAgICAgICAgIGJyZWFkY3J1bWJzOiBlbnRpdHlTY2hlbWEubW9kZWwuY3JlYXRlUGFnZUNvbmZpZz8uYnJlYWRjcnVtYnMgfHwgZW50aXR5U2NoZW1hLm1vZGVsLmNyZWF0ZVBhZ2VCcmVhZGNydW1icyxcbiAgICAgICAgICAgICAgICAgICAgY29sdW1uc0NvbmZpZzogZW50aXR5U2NoZW1hLm1vZGVsLmNyZWF0ZVBhZ2VDb25maWc/LmNvbHVtbnNDb25maWcgfHwgZW50aXR5U2NoZW1hLm1vZGVsLmNyZWF0ZVBhZ2VDb2x1bW5zQ29uZmlnLFxuICAgICAgICAgICAgICAgICAgICBmb3JtQ29uZmlnOiBlbnRpdHlTY2hlbWEubW9kZWwuY3JlYXRlUGFnZUNvbmZpZz8uZm9ybUNvbmZpZyxcbiAgICAgICAgICAgICAgICB9LCBzZXJ2aWNlKTtcbiAgICAgICAgICAgICAgICBlbnRpdHlDb25maWdzWyBgY3JlYXRlLSR7ZW50aXR5TmFtZS50b0xvd2VyQ2FzZSgpfWAgXSA9IGNyZWF0ZUNvbmZpZztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKCFlbnRpdHlTY2hlbWEubW9kZWwuZXhjbHVkZUZyb21BZG1pblVwZGF0ZSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHVwZGF0ZUNvbmZpZyA9IE1ha2VVcGRhdGVFbnRpdHlDb25maWcoe1xuICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lUGx1cmFsOiBlbnRpdHlTY2hlbWEubW9kZWwuZW50aXR5TmFtZVBsdXJhbCxcbiAgICAgICAgICAgICAgICAgICAgQ1JVREFwaVBhdGg6IGVudGl0eVNjaGVtYS5tb2RlbC5DUlVEQXBpUGF0aCxcbiAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllczogZW50aXR5RGVmYXVsdE9wc1NjaGVtYS51cGRhdGUuaW5wdXQsXG4gICAgICAgICAgICAgICAgICAgIC8vIFVzZSBuZXcgbmVzdGVkIGNvbmZpZyBpZiBhdmFpbGFibGUsIGZhbGxiYWNrIHRvIG9sZFxuICAgICAgICAgICAgICAgICAgICBhY3Rpb25zOiBlbnRpdHlTY2hlbWEubW9kZWwuZWRpdFBhZ2VDb25maWc/LmFjdGlvbnMgfHwgZW50aXR5U2NoZW1hLm1vZGVsLmVkaXRQYWdlQWN0aW9ucyxcbiAgICAgICAgICAgICAgICAgICAgYnJlYWRjcnVtYnM6IGVudGl0eVNjaGVtYS5tb2RlbC5lZGl0UGFnZUNvbmZpZz8uYnJlYWRjcnVtYnMgfHwgZW50aXR5U2NoZW1hLm1vZGVsLmVkaXRQYWdlQnJlYWRjcnVtYnMsXG4gICAgICAgICAgICAgICAgICAgIGNvbHVtbnNDb25maWc6IGVudGl0eVNjaGVtYS5tb2RlbC5lZGl0UGFnZUNvbmZpZz8uY29sdW1uc0NvbmZpZyB8fCBlbnRpdHlTY2hlbWEubW9kZWwuZWRpdFBhZ2VDb2x1bW5zQ29uZmlnLFxuICAgICAgICAgICAgICAgICAgICBmb3JtQ29uZmlnOiBlbnRpdHlTY2hlbWEubW9kZWwuZWRpdFBhZ2VDb25maWc/LmZvcm1Db25maWcsXG4gICAgICAgICAgICAgICAgfSwgc2VydmljZSk7XG4gICAgICAgICAgICAgICAgZW50aXR5Q29uZmlnc1sgYGVkaXQtJHtlbnRpdHlOYW1lLnRvTG93ZXJDYXNlKCl9YCBdID0gdXBkYXRlQ29uZmlnO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoIWVudGl0eVNjaGVtYS5tb2RlbC5leGNsdWRlRnJvbUFkbWluTGlzdCkge1xuICAgICAgICAgICAgICAgIGNvbnN0IGxpc3RDb25maWcgPSBNYWtlTGlzdEVudGl0eUNvbmZpZyh7XG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWVQbHVyYWw6IGVudGl0eVNjaGVtYS5tb2RlbC5lbnRpdHlOYW1lUGx1cmFsLFxuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiBlbnRpdHlEZWZhdWx0T3BzU2NoZW1hLmxpc3Qub3V0cHV0LFxuICAgICAgICAgICAgICAgICAgICBDUlVEQXBpUGF0aDogZW50aXR5U2NoZW1hLm1vZGVsLkNSVURBcGlQYXRoLFxuICAgICAgICAgICAgICAgICAgICB1c2VTZWFyY2g6IEJvb2xlYW4oZW50aXR5U2NoZW1hLm1vZGVsLnNlYXJjaD8uZW5hYmxlZCksXG4gICAgICAgICAgICAgICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5DcmVhdGU6IGVudGl0eVNjaGVtYS5tb2RlbC5leGNsdWRlRnJvbUFkbWluQ3JlYXRlLFxuICAgICAgICAgICAgICAgICAgICBleGNsdWRlRnJvbUFkbWluVXBkYXRlOiBlbnRpdHlTY2hlbWEubW9kZWwuZXhjbHVkZUZyb21BZG1pblVwZGF0ZSxcbiAgICAgICAgICAgICAgICAgICAgZXhjbHVkZUZyb21BZG1pbkRlbGV0ZTogZW50aXR5U2NoZW1hLm1vZGVsLmV4Y2x1ZGVGcm9tQWRtaW5EZWxldGUsXG4gICAgICAgICAgICAgICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5EZXRhaWw6IGVudGl0eVNjaGVtYS5tb2RlbC5leGNsdWRlRnJvbUFkbWluRGV0YWlsLFxuICAgICAgICAgICAgICAgICAgICAvLyBVc2UgbmV3IG5lc3RlZCBjb25maWcgaWYgYXZhaWxhYmxlLCBmYWxsYmFjayB0byBvbGRcbiAgICAgICAgICAgICAgICAgICAgcGFnZUhlYWRlckFjdGlvbnM6IGVudGl0eVNjaGVtYS5tb2RlbC5saXN0UGFnZUNvbmZpZz8uYWN0aW9ucyB8fCBlbnRpdHlTY2hlbWEubW9kZWwubGlzdFBhZ2VBY3Rpb25zLFxuICAgICAgICAgICAgICAgICAgICBicmVhZGNydW1iczogZW50aXR5U2NoZW1hLm1vZGVsLmxpc3RQYWdlQ29uZmlnPy5icmVhZGNydW1icyB8fCBlbnRpdHlTY2hlbWEubW9kZWwubGlzdFBhZ2VCcmVhZGNydW1icyxcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdFNvcnQ6IGVudGl0eVNjaGVtYS5tb2RlbC5saXN0UGFnZUNvbmZpZz8uZGVmYXVsdFNvcnQgfHwgZW50aXR5U2NoZW1hLm1vZGVsLmxpc3RQYWdlRGVmYXVsdFNvcnQsXG4gICAgICAgICAgICAgICAgICAgIHRhYmxlQ29uZmlnOiBlbnRpdHlTY2hlbWEubW9kZWwubGlzdFBhZ2VDb25maWc/LnRhYmxlQ29uZmlnLFxuICAgICAgICAgICAgICAgICAgICBnbG9iYWxVSUNvbmZpZ09wdGlvbnMsICAvLyBORVc6IFBhc3MgZ2xvYmFsIGNvbmZpZ1xuICAgICAgICAgICAgICAgIH0sIHNlcnZpY2UpO1xuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ3NbIGBsaXN0LSR7ZW50aXR5TmFtZS50b0xvd2VyQ2FzZSgpfWAgXSA9IGxpc3RDb25maWc7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICghZW50aXR5U2NoZW1hLm1vZGVsLmV4Y2x1ZGVGcm9tQWRtaW5EZXRhaWwpIHtcbiAgICAgICAgICAgICAgICBjb25zdCB2aWV3Q29uZmlnID0gTWFrZVZpZXdFbnRpdHlDb25maWcoe1xuICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lUGx1cmFsOiBlbnRpdHlTY2hlbWEubW9kZWwuZW50aXR5TmFtZVBsdXJhbCxcbiAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllczogZW50aXR5RGVmYXVsdE9wc1NjaGVtYS5nZXQub3V0cHV0LFxuICAgICAgICAgICAgICAgICAgICBDUlVEQXBpUGF0aDogZW50aXR5U2NoZW1hLm1vZGVsLkNSVURBcGlQYXRoLFxuICAgICAgICAgICAgICAgICAgICAvLyBVc2UgbmV3IG5lc3RlZCBjb25maWcgaWYgYXZhaWxhYmxlLCBmYWxsYmFjayB0byBvbGRcbiAgICAgICAgICAgICAgICAgICAgYWN0aW9uczogZW50aXR5U2NoZW1hLm1vZGVsLnZpZXdQYWdlQ29uZmlnPy5hY3Rpb25zIHx8IGVudGl0eVNjaGVtYS5tb2RlbC52aWV3UGFnZUFjdGlvbnMsXG4gICAgICAgICAgICAgICAgICAgIGJyZWFkY3J1bWJzOiBlbnRpdHlTY2hlbWEubW9kZWwudmlld1BhZ2VDb25maWc/LmJyZWFkY3J1bWJzIHx8IGVudGl0eVNjaGVtYS5tb2RlbC52aWV3UGFnZUJyZWFkY3J1bWJzLFxuICAgICAgICAgICAgICAgICAgICBjb2x1bW5zQ29uZmlnOiBlbnRpdHlTY2hlbWEubW9kZWwudmlld1BhZ2VDb25maWc/LmNvbHVtbnNDb25maWcgfHwgZW50aXR5U2NoZW1hLm1vZGVsLnZpZXdQYWdlQ29sdW1uc0NvbmZpZyxcbiAgICAgICAgICAgICAgICAgICAgZmllbGRzOiBlbnRpdHlTY2hlbWEubW9kZWwudmlld1BhZ2VDb25maWc/LmZpZWxkcyxcbiAgICAgICAgICAgICAgICAgICAgc2VjdGlvbnNDb25maWc6IGVudGl0eVNjaGVtYS5tb2RlbC52aWV3UGFnZUNvbmZpZz8uc2VjdGlvbnNDb25maWcsXG4gICAgICAgICAgICAgICAgICAgIGdsb2JhbFVJQ29uZmlnT3B0aW9ucywgIC8vIE5FVzogUGFzcyBnbG9iYWwgY29uZmlnXG4gICAgICAgICAgICAgICAgfSwgc2VydmljZSk7XG4gICAgICAgICAgICAgICAgZW50aXR5Q29uZmlnc1sgYHZpZXctJHtlbnRpdHlOYW1lLnRvTG93ZXJDYXNlKCl9YCBdID0gdmlld0NvbmZpZztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKCFlbnRpdHlTY2hlbWEubW9kZWwuZXhjbHVkZUZyb21BZG1pbk1lbnUpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBtZW51Q29uZmlnID0gTWFrZUVudGl0eU1lbnVDb25maWcoe1xuICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lUGx1cmFsOiBlbnRpdHlTY2hlbWEubW9kZWwuZW50aXR5TmFtZVBsdXJhbCxcbiAgICAgICAgICAgICAgICAgICAgaWNvbjogZW50aXR5U2NoZW1hLm1vZGVsLmVudGl0eU1lbnVJY29uIHx8ICdhcHBTdG9yZScsXG4gICAgICAgICAgICAgICAgICAgIG1lbnVJbmRleDogbWVudUluZGV4KyssXG4gICAgICAgICAgICAgICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5MaXN0OiBlbnRpdHlTY2hlbWEubW9kZWwuZXhjbHVkZUZyb21BZG1pbkxpc3QsXG4gICAgICAgICAgICAgICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5DcmVhdGU6IGVudGl0eVNjaGVtYS5tb2RlbC5leGNsdWRlRnJvbUFkbWluQ3JlYXRlLFxuICAgICAgICAgICAgICAgICAgICBtZW51R3JvdXA6IGVudGl0eVNjaGVtYS5tb2RlbC5tZW51R3JvdXAsXG4gICAgICAgICAgICAgICAgICAgIG1lbnVPcmRlcjogZW50aXR5U2NoZW1hLm1vZGVsLm1lbnVPcmRlcixcbiAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgIG1lbnVDb25maWdzLnB1c2gobWVudUNvbmZpZyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gUHJvY2VzcyBjdXN0b20gcGFnZXNcbiAgICAgICAgZm9yIChjb25zdCBbIHBhZ2VOYW1lLCBvcHRpb25zIF0gb2YgdGhpcy5jdXN0b21QYWdlcykge1xuICAgICAgICAgICAgLy8gc2tpcCB0aGUgZGVmYXVsdCBkYXNoYm9hcmQgcGFnZSBhbmQgbWVudSBwYWdlXG4gICAgICAgICAgICBpZiAocGFnZU5hbWUgPT09ICdkYXNoYm9hcmQnIHx8IHBhZ2VOYW1lID09PSAnbWVudScpIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnN0IGN1c3RvbUNvbmZpZyA9IG1ha2VDdXN0b21QYWdlQ29uZmlnKG9wdGlvbnMpO1xuICAgICAgICAgICAgZW50aXR5Q29uZmlnc1sgcGFnZU5hbWUgXSA9IGN1c3RvbUNvbmZpZztcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGF1dGhDb25maWdPcHRpb25zID0gRncyNC5nZXRJbnN0YW5jZSgpLmdldENvbmZpZygpLnVpQ29uZmlnR2VuT3B0aW9ucyB8fCB7fTtcblxuICAgICAgICBjb25zdCBhdXRoQ29uZmlncyA9IE1ha2VBdXRoQ29uZmlnKHtcbiAgICAgICAgICAgIC4uLmF1dGhDb25maWdPcHRpb25zLFxuICAgICAgICAgICAgYXV0aEVuZHBvaW50OiBhdXRoQ29uZmlnT3B0aW9ucy5hdXRoRW5kcG9pbnQgfHwgJ21hdXRoJ1xuICAgICAgICB9KTtcblxuICAgICAgICAvLyBMb29rIGZvciBhIGRhc2hib2FyZCBjdXN0b20gcGFnZVxuICAgICAgICBsZXQgZGFzaGJvYXJkQ29uZmlnOiBEYXNoYm9hcmRQYWdlQ29uZmlnIHwgYW55ID0gbnVsbDtcbiAgICAgICAgZm9yIChjb25zdCBbICwgb3B0aW9ucyBdIG9mIHRoaXMuY3VzdG9tUGFnZXMpIHtcbiAgICAgICAgICAgIC8vIENoZWNrIGlmIHRoaXMgaXMgYSBkYXNoYm9hcmQgcGFnZSAtIGhhbmRsZSBib3RoIHN0cmluZyBhbmQgVGVtcGxhdGUgcGFnZVRpdGxlXG4gICAgICAgICAgICBjb25zdCBwYWdlVGl0bGVTdHIgPSB0eXBlb2Ygb3B0aW9ucy5wYWdlVGl0bGUgPT09ICdzdHJpbmcnID8gb3B0aW9ucy5wYWdlVGl0bGUgOiAnJztcbiAgICAgICAgICAgIGlmIChvcHRpb25zLnBhZ2VUeXBlID09PSAnZGFzaGJvYXJkJyAmJiBwYWdlVGl0bGVTdHIudG9Mb3dlckNhc2UoKSA9PT0gJ2Rhc2hib2FyZCcpIHtcbiAgICAgICAgICAgICAgICBkYXNoYm9hcmRDb25maWcgPSBvcHRpb25zO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGlmICghZGFzaGJvYXJkQ29uZmlnKSB7XG4gICAgICAgICAgICBkYXNoYm9hcmRDb25maWcgPSBNYWtlRGFzaGJvYXJkQ29uZmlnKCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBMb29rIGZvciBhIG1lbnUgY3VzdG9tIHBhZ2VcbiAgICAgICAgbGV0IG1lbnVDb25maWc6IGFueSA9IG51bGw7XG4gICAgICAgIGZvciAoY29uc3QgWyBwYWdlTmFtZSwgb3B0aW9ucyBdIG9mIHRoaXMuY3VzdG9tUGFnZXMpIHtcbiAgICAgICAgICAgIC8vIENoZWNrIGlmIHRoaXMgaXMgYSBtZW51IHBhZ2UgLSBoYW5kbGUgYm90aCBzdHJpbmcgYW5kIFRlbXBsYXRlIHBhZ2VUaXRsZVxuICAgICAgICAgICAgY29uc3QgcGFnZVRpdGxlU3RyID0gdHlwZW9mIG9wdGlvbnMucGFnZVRpdGxlID09PSAnc3RyaW5nJyA/IG9wdGlvbnMucGFnZVRpdGxlIDogJyc7XG4gICAgICAgICAgICBpZiAob3B0aW9ucy5wYWdlVHlwZSA9PT0gJ21lbnUnICYmIHBhZ2VUaXRsZVN0ci50b0xvd2VyQ2FzZSgpID09PSAnbWVudScpIHtcbiAgICAgICAgICAgICAgICBtZW51Q29uZmlnID0gb3B0aW9ucztcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEdyb3VwIG1lbnUgaXRlbXMgYnkgdGhlaXIgZ3JvdXAgcHJvcGVydHlcbiAgICAgICAgY29uc3QgbWVudUdyb3VwcyA9IG5ldyBNYXA8c3RyaW5nLCBhbnlbXT4oKTtcbiAgICAgICAgY29uc3QgdW5ncm91cGVkSXRlbXM6IGFueVtdID0gW107XG5cbiAgICAgICAgLy8gUHJvY2VzcyBlbnRpdHkgbWVudSBpdGVtc1xuICAgICAgICBtZW51Q29uZmlncy5mb3JFYWNoKGl0ZW0gPT4ge1xuICAgICAgICAgICAgaWYgKGl0ZW0uZ3JvdXApIHtcbiAgICAgICAgICAgICAgICBpZiAoIW1lbnVHcm91cHMuaGFzKGl0ZW0uZ3JvdXApKSB7XG4gICAgICAgICAgICAgICAgICAgIG1lbnVHcm91cHMuc2V0KGl0ZW0uZ3JvdXAsIFtdKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgbWVudUdyb3Vwcy5nZXQoaXRlbS5ncm91cCkhLnB1c2goaXRlbSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHVuZ3JvdXBlZEl0ZW1zLnB1c2goaXRlbSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIFByb2Nlc3MgY3VzdG9tIG1lbnUgaXRlbXNcbiAgICAgICAgaWYgKG1lbnVDb25maWc/Lm1lbnVQYWdlQ29uZmlnPy5tZW51SXRlbXMpIHtcbiAgICAgICAgICAgIG1lbnVDb25maWcubWVudVBhZ2VDb25maWcubWVudUl0ZW1zLmZvckVhY2goKGl0ZW06IGFueSkgPT4ge1xuICAgICAgICAgICAgICAgIGlmIChpdGVtLmdyb3VwKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmICghbWVudUdyb3Vwcy5oYXMoaXRlbS5ncm91cCkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIG1lbnVHcm91cHMuc2V0KGl0ZW0uZ3JvdXAsIFtdKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBtZW51R3JvdXBzLmdldChpdGVtLmdyb3VwKSEucHVzaChpdGVtKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICB1bmdyb3VwZWRJdGVtcy5wdXNoKGl0ZW0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ3JlYXRlIGZpbmFsIG1lbnUgc3RydWN0dXJlXG4gICAgICAgIGNvbnN0IGFsbE1lbnVJdGVtczogYW55W10gPSBbXTtcblxuICAgICAgICAvLyBBZGQgdW5ncm91cGVkIGl0ZW1zIGZpcnN0IChwcmltYXJ5IG5hdmlnYXRpb24pXG4gICAgICAgIGFsbE1lbnVJdGVtcy5wdXNoKC4uLnVuZ3JvdXBlZEl0ZW1zKTtcblxuICAgICAgICAvLyBBZGQgZ3JvdXBlZCBpdGVtc1xuICAgICAgICBtZW51R3JvdXBzLmZvckVhY2goKGl0ZW1zLCBncm91cE5hbWUpID0+IHtcbiAgICAgICAgICAgIC8vIFNvcnQgaXRlbXMgd2l0aGluIGdyb3VwIGJ5IG9yZGVyXG4gICAgICAgICAgICBpdGVtcy5zb3J0KChhLCBiKSA9PiAoYS5vcmRlciB8fCAwKSAtIChiLm9yZGVyIHx8IDApKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gQ3JlYXRlIGdyb3VwIGl0ZW1cbiAgICAgICAgICAgIGFsbE1lbnVJdGVtcy5wdXNoKHtcbiAgICAgICAgICAgICAgICBsYWJlbDogZ3JvdXBOYW1lLFxuICAgICAgICAgICAgICAgIGtleTogYGdyb3VwLSR7Z3JvdXBOYW1lfWAsXG4gICAgICAgICAgICAgICAgaWNvbjogJ0ZvbGRlck91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBjaGlsZHJlbjogaXRlbXNcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgICBhd2FpdCB0aGlzLndyaXRlVG9GaWxlcyhhbGxNZW51SXRlbXMsIGVudGl0eUNvbmZpZ3MsIGF1dGhDb25maWdzLCBkYXNoYm9hcmRDb25maWcpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFRyYW5zZm9ybSBsZWdhY3kgZmxhdCBjb25maWcgc3RydWN0dXJlIHRvIG5ldyBuZXN0ZWQgc3RydWN0dXJlXG4gICAgICogU3VwcG9ydHMgYmFja3dhcmQgY29tcGF0aWJpbGl0eSBieSB0cmFuc2Zvcm1pbmcgb2xkIHByb3BlcnRpZXMgdG8gbmV3IGZvcm1hdFxuICAgICAqL1xuICAgIHByaXZhdGUgdHJhbnNmb3JtTGVnYWN5Q29uZmlnKHNjaGVtYTogRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+KTogRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+IHtcbiAgICAgICAgY29uc3QgbW9kZWwgPSBzY2hlbWEubW9kZWw7XG4gICAgICAgIFxuICAgICAgICAvLyBJZiBhbHJlYWR5IHVzaW5nIG5ldyBmb3JtYXQsIHJldHVybiBhcy1pc1xuICAgICAgICBpZiAobW9kZWwubGlzdFBhZ2VDb25maWcgfHwgbW9kZWwudmlld1BhZ2VDb25maWcgfHwgbW9kZWwuZWRpdFBhZ2VDb25maWcgfHwgbW9kZWwuY3JlYXRlUGFnZUNvbmZpZykge1xuICAgICAgICAgICAgcmV0dXJuIHNjaGVtYTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgLy8gVHJhbnNmb3JtIG9sZCBmb3JtYXQgdG8gbmV3IG5lc3RlZCBzdHJ1Y3R1cmVcbiAgICAgICAgY29uc3QgdHJhbnNmb3JtZWRNb2RlbCA9IHtcbiAgICAgICAgICAgIC4uLm1vZGVsLFxuICAgICAgICAgICAgLy8gTGlzdCBwYWdlIHRyYW5zZm9ybWF0aW9uXG4gICAgICAgICAgICBsaXN0UGFnZUNvbmZpZzogKG1vZGVsLmxpc3RQYWdlQWN0aW9ucyB8fCBtb2RlbC5saXN0UGFnZUJyZWFkY3J1bWJzIHx8IG1vZGVsLmxpc3RQYWdlRGVmYXVsdFNvcnQpXG4gICAgICAgICAgICAgICAgPyB7XG4gICAgICAgICAgICAgICAgICAgIGFjdGlvbnM6IG1vZGVsLmxpc3RQYWdlQWN0aW9ucyxcbiAgICAgICAgICAgICAgICAgICAgYnJlYWRjcnVtYnM6IG1vZGVsLmxpc3RQYWdlQnJlYWRjcnVtYnMsXG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHRTb3J0OiBtb2RlbC5saXN0UGFnZURlZmF1bHRTb3J0XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIDogdW5kZWZpbmVkLFxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBWaWV3IHBhZ2UgdHJhbnNmb3JtYXRpb25cbiAgICAgICAgICAgIHZpZXdQYWdlQ29uZmlnOiAobW9kZWwudmlld1BhZ2VBY3Rpb25zIHx8IG1vZGVsLnZpZXdQYWdlQnJlYWRjcnVtYnMgfHwgbW9kZWwudmlld1BhZ2VDb2x1bW5zQ29uZmlnKVxuICAgICAgICAgICAgICAgID8ge1xuICAgICAgICAgICAgICAgICAgICBhY3Rpb25zOiBtb2RlbC52aWV3UGFnZUFjdGlvbnMsXG4gICAgICAgICAgICAgICAgICAgIGJyZWFkY3J1bWJzOiBtb2RlbC52aWV3UGFnZUJyZWFkY3J1bWJzLFxuICAgICAgICAgICAgICAgICAgICBjb2x1bW5zQ29uZmlnOiBtb2RlbC52aWV3UGFnZUNvbHVtbnNDb25maWdcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgOiB1bmRlZmluZWQsXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIEVkaXQgcGFnZSB0cmFuc2Zvcm1hdGlvblxuICAgICAgICAgICAgZWRpdFBhZ2VDb25maWc6IChtb2RlbC5lZGl0UGFnZUFjdGlvbnMgfHwgbW9kZWwuZWRpdFBhZ2VCcmVhZGNydW1icyB8fCBtb2RlbC5lZGl0UGFnZUNvbHVtbnNDb25maWcpXG4gICAgICAgICAgICAgICAgPyB7XG4gICAgICAgICAgICAgICAgICAgIGFjdGlvbnM6IG1vZGVsLmVkaXRQYWdlQWN0aW9ucyxcbiAgICAgICAgICAgICAgICAgICAgYnJlYWRjcnVtYnM6IG1vZGVsLmVkaXRQYWdlQnJlYWRjcnVtYnMsXG4gICAgICAgICAgICAgICAgICAgIGNvbHVtbnNDb25maWc6IG1vZGVsLmVkaXRQYWdlQ29sdW1uc0NvbmZpZ1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICA6IHVuZGVmaW5lZCxcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gQ3JlYXRlIHBhZ2UgdHJhbnNmb3JtYXRpb25cbiAgICAgICAgICAgIGNyZWF0ZVBhZ2VDb25maWc6IChtb2RlbC5jcmVhdGVQYWdlQnJlYWRjcnVtYnMgfHwgbW9kZWwuY3JlYXRlUGFnZUNvbHVtbnNDb25maWcpXG4gICAgICAgICAgICAgICAgPyB7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFkY3J1bWJzOiBtb2RlbC5jcmVhdGVQYWdlQnJlYWRjcnVtYnMsXG4gICAgICAgICAgICAgICAgICAgIGNvbHVtbnNDb25maWc6IG1vZGVsLmNyZWF0ZVBhZ2VDb2x1bW5zQ29uZmlnXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIDogdW5kZWZpbmVkLFxuICAgICAgICB9O1xuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHsgLi4uc2NoZW1hLCBtb2RlbDogdHJhbnNmb3JtZWRNb2RlbCB9O1xuICAgIH1cbiAgICBcbiAgICAvKipcbiAgICAgKiBDaGVjayBmb3IgZGVwcmVjYXRlZCBjb25maWd1cmF0aW9uIHVzYWdlIGFuZCBlbWl0IHdhcm5pbmdzXG4gICAgICovXG4gICAgcHJpdmF0ZSBjaGVja0RlcHJlY2F0ZWRVc2FnZShzY2hlbWE6IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pik6IHZvaWQge1xuICAgICAgICBjb25zdCBtb2RlbCA9IHNjaGVtYS5tb2RlbDtcbiAgICAgICAgY29uc3Qgd2FybmluZ3M6IHN0cmluZ1tdID0gW107XG4gICAgICAgIFxuICAgICAgICAvLyBDaGVjayBsaXN0IHBhZ2UgZGVwcmVjYXRlZCBmaWVsZHNcbiAgICAgICAgaWYgKG1vZGVsLmxpc3RQYWdlQWN0aW9ucykge1xuICAgICAgICAgICAgd2FybmluZ3MucHVzaCgnbGlzdFBhZ2VBY3Rpb25zIGlzIGRlcHJlY2F0ZWQuIFVzZSBsaXN0UGFnZUNvbmZpZy5hY3Rpb25zIGluc3RlYWQuJyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG1vZGVsLmxpc3RQYWdlQnJlYWRjcnVtYnMpIHtcbiAgICAgICAgICAgIHdhcm5pbmdzLnB1c2goJ2xpc3RQYWdlQnJlYWRjcnVtYnMgaXMgZGVwcmVjYXRlZC4gVXNlIGxpc3RQYWdlQ29uZmlnLmJyZWFkY3J1bWJzIGluc3RlYWQuJyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG1vZGVsLmxpc3RQYWdlRGVmYXVsdFNvcnQpIHtcbiAgICAgICAgICAgIHdhcm5pbmdzLnB1c2goJ2xpc3RQYWdlRGVmYXVsdFNvcnQgaXMgZGVwcmVjYXRlZC4gVXNlIGxpc3RQYWdlQ29uZmlnLmRlZmF1bHRTb3J0IGluc3RlYWQuJyk7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIC8vIENoZWNrIHZpZXcgcGFnZSBkZXByZWNhdGVkIGZpZWxkc1xuICAgICAgICBpZiAobW9kZWwudmlld1BhZ2VBY3Rpb25zKSB7XG4gICAgICAgICAgICB3YXJuaW5ncy5wdXNoKCd2aWV3UGFnZUFjdGlvbnMgaXMgZGVwcmVjYXRlZC4gVXNlIHZpZXdQYWdlQ29uZmlnLmFjdGlvbnMgaW5zdGVhZC4nKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAobW9kZWwudmlld1BhZ2VCcmVhZGNydW1icykge1xuICAgICAgICAgICAgd2FybmluZ3MucHVzaCgndmlld1BhZ2VCcmVhZGNydW1icyBpcyBkZXByZWNhdGVkLiBVc2Ugdmlld1BhZ2VDb25maWcuYnJlYWRjcnVtYnMgaW5zdGVhZC4nKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAobW9kZWwudmlld1BhZ2VDb2x1bW5zQ29uZmlnKSB7XG4gICAgICAgICAgICB3YXJuaW5ncy5wdXNoKCd2aWV3UGFnZUNvbHVtbnNDb25maWcgaXMgZGVwcmVjYXRlZC4gVXNlIHZpZXdQYWdlQ29uZmlnLmNvbHVtbnNDb25maWcgaW5zdGVhZC4nKTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgLy8gQ2hlY2sgZWRpdCBwYWdlIGRlcHJlY2F0ZWQgZmllbGRzXG4gICAgICAgIGlmIChtb2RlbC5lZGl0UGFnZUFjdGlvbnMpIHtcbiAgICAgICAgICAgIHdhcm5pbmdzLnB1c2goJ2VkaXRQYWdlQWN0aW9ucyBpcyBkZXByZWNhdGVkLiBVc2UgZWRpdFBhZ2VDb25maWcuYWN0aW9ucyBpbnN0ZWFkLicpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChtb2RlbC5lZGl0UGFnZUJyZWFkY3J1bWJzKSB7XG4gICAgICAgICAgICB3YXJuaW5ncy5wdXNoKCdlZGl0UGFnZUJyZWFkY3J1bWJzIGlzIGRlcHJlY2F0ZWQuIFVzZSBlZGl0UGFnZUNvbmZpZy5icmVhZGNydW1icyBpbnN0ZWFkLicpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChtb2RlbC5lZGl0UGFnZUNvbHVtbnNDb25maWcpIHtcbiAgICAgICAgICAgIHdhcm5pbmdzLnB1c2goJ2VkaXRQYWdlQ29sdW1uc0NvbmZpZyBpcyBkZXByZWNhdGVkLiBVc2UgZWRpdFBhZ2VDb25maWcuY29sdW1uc0NvbmZpZyBpbnN0ZWFkLicpO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICAvLyBDaGVjayBjcmVhdGUgcGFnZSBkZXByZWNhdGVkIGZpZWxkc1xuICAgICAgICBpZiAobW9kZWwuY3JlYXRlUGFnZUJyZWFkY3J1bWJzKSB7XG4gICAgICAgICAgICB3YXJuaW5ncy5wdXNoKCdjcmVhdGVQYWdlQnJlYWRjcnVtYnMgaXMgZGVwcmVjYXRlZC4gVXNlIGNyZWF0ZVBhZ2VDb25maWcuYnJlYWRjcnVtYnMgaW5zdGVhZC4nKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAobW9kZWwuY3JlYXRlUGFnZUNvbHVtbnNDb25maWcpIHtcbiAgICAgICAgICAgIHdhcm5pbmdzLnB1c2goJ2NyZWF0ZVBhZ2VDb2x1bW5zQ29uZmlnIGlzIGRlcHJlY2F0ZWQuIFVzZSBjcmVhdGVQYWdlQ29uZmlnLmNvbHVtbnNDb25maWcgaW5zdGVhZC4nKTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgLy8gRW1pdCB3YXJuaW5ncyBpZiBhbnkgZGVwcmVjYXRlZCBmaWVsZHMgZm91bmRcbiAgICAgICAgaWYgKHdhcm5pbmdzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYFxcbuKaoO+4jyAgRW50aXR5IFwiJHttb2RlbC5lbnRpdHl9XCIgdXNlcyBkZXByZWNhdGVkIGNvbmZpZ3VyYXRpb246YCk7XG4gICAgICAgICAgICB3YXJuaW5ncy5mb3JFYWNoKHcgPT4gdGhpcy5sb2dnZXIud2FybihgICAgLSAke3d9YCkpO1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgICAg8J+TliBNaWdyYXRpb24gZ3VpZGU6IGh0dHBzOi8vZG9jcy5mdzI0LmlvL21pZ3JhdGlvbi9uZXN0ZWQtY29uZmlnXFxuYCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBATG9nRHVyYXRpb24oKVxuICAgIHByZXBhcmVTZXJ2aWNlc0RpcmVjdG9yaWVzKCkge1xuICAgICAgICBjb25zdCBmdzI0ID0gRncyNC5nZXRJbnN0YW5jZSgpO1xuXG4gICAgICAgIGNvbnN0IHNlcnZpY2VEaXJlY3RvcmllcyA9IFsgcGF0aFJlc29sdmUoJy4vc3JjL3NlcnZpY2VzLycpIF07XG5cbiAgICAgICAgaWYgKGZ3MjQuaGFzTW9kdWxlcygpKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgVWktY29uZmlnLWdlbjo6OiBQcm9jZXNzOjo6IGFwcCBoYXMgbW9kdWxlczogYCwgQXJyYXkuZnJvbShmdzI0LmdldE1vZHVsZXMoKS5rZXlzKCkpKTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgWyAsIG1vZHVsZSBdIG9mIGZ3MjQuZ2V0TW9kdWxlcygpKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgbW9kdWxlU2VydmljZXNQYXRoID0gcGF0aEpvaW4obW9kdWxlLmdldEJhc2VQYXRoKCksIG1vZHVsZS5nZXRTZXJ2aWNlc0RpcmVjdG9yeSgpKTtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgVWktY29uZmlnLWdlbjo6OiBQcm9jZXNzOjo6IG1vZHVsZVNlcnZpY2VzUGF0aDogYCwgbW9kdWxlU2VydmljZXNQYXRoKTtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgVWktY29uZmlnLWdlbjo6OiBQcm9jZXNzOjo6IHJlcy1tb2R1bGVTZXJ2aWNlc1BhdGg6IGAsIHBhdGhSZXNvbHZlKG1vZHVsZVNlcnZpY2VzUGF0aCkpO1xuICAgICAgICAgICAgICAgIHNlcnZpY2VEaXJlY3Rvcmllcy5wdXNoKHBhdGhSZXNvbHZlKG1vZHVsZVNlcnZpY2VzUGF0aCkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHNlcnZpY2VEaXJlY3RvcmllcztcbiAgICB9XG5cbiAgICBATG9nRHVyYXRpb24oKVxuICAgIGFzeW5jIHNjYW5BbmRMb2FkU2VydmljZXMoc2VydmljZURpcmVjdG9yaWVzOiBBcnJheTxzdHJpbmc+KSB7XG5cbiAgICAgICAgY29uc3Qgc2Nhbm5lZFNlcnZpY2VzID0gbmV3IFNldDxGdW5jdGlvbj4oKTtcblxuICAgICAgICBmb3IgKGNvbnN0IGRpciBvZiBzZXJ2aWNlRGlyZWN0b3JpZXMpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBVaS1jb25maWctZ2VuOjo6IFByb2Nlc3M6OjogbG9hZGluZyBzZXJ2aWNlcyBmcm9tIERJUjogYCwgZGlyKTtcbiAgICAgICAgICAgIGNvbnN0IGRpclNlcnZpY2VUb2tlbnMgPSBhd2FpdCB0aGlzLnNjYW5TZXJ2aWNlc0Zyb21EaXJlY3RvcnkoZGlyKTtcbiAgICAgICAgICAgIGRpclNlcnZpY2VUb2tlbnMuZm9yRWFjaCh0b2tlbiA9PiBzY2FubmVkU2VydmljZXMuYWRkKHRva2VuKSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBnZXQgYWxsIGNvbnRhaW5lciByZWdpc3RlcmVkIHNlcnZpY2VzIHRvIG1ha2Ugc3VyZSBhdXRvLWdlbiBlbnRpdHktc2VydmljZXMgYXJlIGFsc28gaW5jbHVkZWRcbiAgICAgICAgdGhpcy51aUdlbkRJQ29udGFpbmVyLmNvbGxlY3RCZXN0UHJvdmlkZXJzRm9yKHtcbiAgICAgICAgICAgIHR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgICAgICAgIGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnM6IHRydWVcbiAgICAgICAgfSkuZmlsdGVyKG9wdCA9PiB7XG4gICAgICAgICAgICAvLyBtYWtlIHN1cmUgdG8gY29sbGVjdCBvbmx5IHRoZSBlbnRpdHkgc2VydmljZSBwcm92aWRlcnNcbiAgICAgICAgICAgIHJldHVybiAhIW9wdC5fcHJvdmlkZXIuZm9yRW50aXR5XG4gICAgICAgIH0pLmZvckVhY2gob3B0ID0+IHtcbiAgICAgICAgICAgIHNjYW5uZWRTZXJ2aWNlcy5hZGQob3B0Ll9wcm92aWRlci5wcm92aWRlIGFzIEZ1bmN0aW9uKTtcbiAgICAgICAgfSlcblxuICAgICAgICAvLyByZXNvbHZlIGFsbCBzZXJ2aWNlc1xuICAgICAgICBjb25zdCByZXNvbHZlZFNlcnZpY2VzID0gbmV3IE1hcDxzdHJpbmcsIEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4+KCk7XG5cbiAgICAgICAgc2Nhbm5lZFNlcnZpY2VzLmZvckVhY2godG9rZW4gPT4ge1xuICAgICAgICAgICAgY29uc3Qgc2VydmljZSA9IHRoaXMudWlHZW5ESUNvbnRhaW5lci5yZXNvbHZlKHRva2VuLCB7XG4gICAgICAgICAgICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVyczogdHJ1ZVxuICAgICAgICAgICAgfSkgYXMgQmFzZUVudGl0eVNlcnZpY2U8YW55PjtcblxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYHJlc29sdmVkIHNlcnZpY2UgZm9yIGVudGl0eTogJHtzZXJ2aWNlLmdldEVudGl0eU5hbWUoKX1gKTtcblxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFVpLWNvbmZpZy1nZW46OjogUHJvY2Vzczo6OiBsb2FkZWQgc2VydmljZXMgZnJvbSBlbnRpdHk6IGAsIHNlcnZpY2UuZ2V0RW50aXR5TmFtZSgpKTtcbiAgICAgICAgICAgIHJlc29sdmVkU2VydmljZXMuc2V0KHNlcnZpY2UuZ2V0RW50aXR5TmFtZSgpLCBzZXJ2aWNlKTtcbiAgICAgICAgfSlcblxuICAgICAgICByZXR1cm4gcmVzb2x2ZWRTZXJ2aWNlcztcbiAgICB9XG5cbiAgICBATG9nRHVyYXRpb24oKVxuICAgIGFzeW5jIHNjYW5TZXJ2aWNlc0Zyb21EaXJlY3Rvcnkoc2VydmljZXNEaXI6IHN0cmluZykge1xuXG4gICAgICAgIGNvbnN0IHNjYW5uZWRTZXJ2aWNlcyA9IG5ldyBTZXQ8RnVuY3Rpb24+KCk7XG5cbiAgICAgICAgaWYgKCFleGlzdHNTeW5jKHNlcnZpY2VzRGlyKSkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIud2Fybihgc2NhblNlcnZpY2VzRnJvbURpcmVjdG9yeTogc2VydmljZXNEaXIgZG9lcyBub3QgZXhpc3RzOiAke3NlcnZpY2VzRGlyfWApO1xuICAgICAgICAgICAgcmV0dXJuIHNjYW5uZWRTZXJ2aWNlcztcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHNlcnZpY2VQYXRocyA9IEhlbHBlci5zY2FuQ29udHJvbGxlclNvdXJjZUZpbGVzRnJvbShzZXJ2aWNlc0Rpcik7XG5cbiAgICAgICAgZm9yIChjb25zdCBzZXJ2aWNlUGF0aCBvZiBzZXJ2aWNlUGF0aHMpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGB0cnlpbmcgdG8gbG9hZCBzZXJ2aWNlUGF0aDogJHtzZXJ2aWNlUGF0aH1gKTtcblxuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAvLyBEeW5hbWljYWxseSBpbXBvcnQgdGhlIHNlcnZpY2UgZmlsZVxuICAgICAgICAgICAgICAgIGNvbnN0IG1vZHVsZSA9IGF3YWl0IGltcG9ydChwYXRoSm9pbihzZXJ2aWNlc0Rpciwgc2VydmljZVBhdGgpKTtcblxuICAgICAgICAgICAgICAgIC8vIEZpbmQgYW5kIGluc3RhbnRpYXRlIHNlcnZpY2UgY2xhc3Nlc1xuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgZXhwb3J0ZWRJdGVtIG9mIE9iamVjdC52YWx1ZXMobW9kdWxlKSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoXG4gICAgICAgICAgICAgICAgICAgICAgICBleHBvcnRlZEl0ZW1cbiAgICAgICAgICAgICAgICAgICAgICAgICYmIHR5cGVvZiBleHBvcnRlZEl0ZW0gPT09ICdmdW5jdGlvbidcbiAgICAgICAgICAgICAgICAgICAgICAgICYmICdwcm90b3R5cGUnIGluIGV4cG9ydGVkSXRlbVxuICAgICAgICAgICAgICAgICAgICAgICAgJiYgZXhwb3J0ZWRJdGVtLnByb3RvdHlwZSBpbnN0YW5jZW9mIEJhc2VFbnRpdHlTZXJ2aWNlXG4gICAgICAgICAgICAgICAgICAgICkge1xuXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy51aUdlbkRJQ29udGFpbmVyLmhhcyhleHBvcnRlZEl0ZW0sIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnc2VydmljZScsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVyczogdHJ1ZVxuICAgICAgICAgICAgICAgICAgICAgICAgfSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzY2FubmVkU2VydmljZXMuYWRkKGV4cG9ydGVkSXRlbSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYHNjYW5TZXJ2aWNlc0Zyb21EaXJlY3Rvcnk6IHJlZ2lzdGVyaW5nIHNlcnZpY2U6ICR7ZXhwb3J0ZWRJdGVtLm5hbWV9YCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBzY2FuU2VydmljZXNGcm9tRGlyZWN0b3J5OiBubyBwcm92aWRlciBjb3VsZCBiZSBmb3VuZCBmb3Igc2VydmljZTogJHtleHBvcnRlZEl0ZW0ubmFtZX1gKTtcblxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1Zyhgc2NhblNlcnZpY2VzRnJvbURpcmVjdG9yeTogU0tJUDogZXhwb3J0ZWRJdGVtIGlzIG5vdCBhIHNlcnZpY2UgY2xhc3M6ICR7KGV4cG9ydGVkSXRlbSBhcyBhbnkpPy5uYW1lID8gKGV4cG9ydGVkSXRlbSBhcyBhbnkpLm5hbWUgOiBleHBvcnRlZEl0ZW19YCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYHNjYW5TZXJ2aWNlc0Zyb21EaXJlY3Rvcnk6IEV4Y2VwdGlvbiB3aGlsZSB0cnlpbmcgdG8gbG9hZCBzZXJ2aWNlUGF0aDogJHtzZXJ2aWNlUGF0aH1gLCBlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBzY2FubmVkU2VydmljZXM7XG4gICAgfVxuXG4gICAgQExvZ0R1cmF0aW9uKClcbiAgICBhc3luYyB3cml0ZVRvRmlsZXMobWVudUNvbmZpZzogYW55LCBlbnRpdGllc0NvbmZpZzogYW55LCBhdXRoQ29uZmlnOiBhbnksIGRhc2hib2FyZENvbmZpZzogYW55KSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiQ2FsbGVkIHdyaXRlVG9GaWxlczo6Ojo6OiBcIik7XG4gICAgICAgIGNvbnN0IGdlbkRpcmVjdG9yeVBhdGggPSBwYXRoUmVzb2x2ZSgnLi9nZW4vJyk7XG4gICAgICAgIGlmICghZXhpc3RzU3luYyhnZW5EaXJlY3RvcnlQYXRoKSkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEdlbiBESVIgZG9lcyBub3QgZXhpc3RzLCBjcmVhdGluZzogJHtnZW5EaXJlY3RvcnlQYXRofWAsKTtcbiAgICAgICAgICAgIG1rZGlyU3luYyhnZW5EaXJlY3RvcnlQYXRoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGNvbmZpZ0RpcmVjdG9yeVBhdGggPSBwYXRoUmVzb2x2ZShwYXRoSm9pbihnZW5EaXJlY3RvcnlQYXRoLCAnY29uZmlnJykpO1xuICAgICAgICBpZiAoIWV4aXN0c1N5bmMoY29uZmlnRGlyZWN0b3J5UGF0aCkpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDb25maWcgRElSIGRvZXMgbm90IGV4aXN0cywgY3JlYXRpbmc6ICR7Y29uZmlnRGlyZWN0b3J5UGF0aH1gKTtcbiAgICAgICAgICAgIG1rZGlyU3luYyhjb25maWdEaXJlY3RvcnlQYXRoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IG1lbnVDb25maWdGaWxlUGF0aCA9IHBhdGhKb2luKGNvbmZpZ0RpcmVjdG9yeVBhdGgsICdtZW51Lmpzb24nKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYHdyaXRpbmcgbWVudS1jb25maWcuLiBpbnRvOiAke21lbnVDb25maWdGaWxlUGF0aH1gKTtcbiAgICAgICAgd3JpdGVGaWxlU3luYyhtZW51Q29uZmlnRmlsZVBhdGgsIEpTT04uc3RyaW5naWZ5KG1lbnVDb25maWcsIG51bGwsIDIpKTtcblxuICAgICAgICBjb25zdCBlbnRpdGllc0NvbmZpZ0ZpbGVQYXRoID0gcGF0aEpvaW4oY29uZmlnRGlyZWN0b3J5UGF0aCwgJ2VudGl0aWVzLmpzb24nKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYHdyaXRpbmcgZW50aXRpZXMtY29uZmlnLi4gaW50bzogJHtlbnRpdGllc0NvbmZpZ0ZpbGVQYXRofWAsKTtcbiAgICAgICAgd3JpdGVGaWxlU3luYyhlbnRpdGllc0NvbmZpZ0ZpbGVQYXRoLCBKU09OLnN0cmluZ2lmeShlbnRpdGllc0NvbmZpZywgbnVsbCwgMikpO1xuXG4gICAgICAgIGNvbnN0IGF1dGhDb25maWdGaWxlUGF0aCA9IHBhdGhKb2luKGNvbmZpZ0RpcmVjdG9yeVBhdGgsICdhdXRoLmpzb24nKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYHdyaXRpbmcgYXV0aC1jb25maWcuLiBpbnRvOiAke2F1dGhDb25maWdGaWxlUGF0aH1gLCk7XG4gICAgICAgIHdyaXRlRmlsZVN5bmMoYXV0aENvbmZpZ0ZpbGVQYXRoLCBKU09OLnN0cmluZ2lmeShhdXRoQ29uZmlnLCBudWxsLCAyKSk7XG5cbiAgICAgICAgY29uc3QgZGFzaGJvYXJkQ29uZmlnRmlsZVBhdGggPSBwYXRoSm9pbihjb25maWdEaXJlY3RvcnlQYXRoLCAnZGFzaGJvYXJkLmpzb24nKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYHdyaXRpbmcgZGFzaGJvYXJkLWNvbmZpZy4uIGludG86ICR7ZGFzaGJvYXJkQ29uZmlnRmlsZVBhdGh9YCwpO1xuICAgICAgICB3cml0ZUZpbGVTeW5jKGRhc2hib2FyZENvbmZpZ0ZpbGVQYXRoLCBKU09OLnN0cmluZ2lmeShkYXNoYm9hcmRDb25maWcsIG51bGwsIDIpKTtcblxuICAgIH1cbn1cblxuIl19