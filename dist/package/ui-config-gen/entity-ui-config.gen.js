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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW50aXR5LXVpLWNvbmZpZy5nZW4uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdWktY29uZmlnLWdlbi9lbnRpdHktdWktY29uZmlnLmdlbi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFDQSw4RUFBK0Q7QUFDL0QsOEVBQStEO0FBQy9ELDBFQUEyRDtBQUMzRCwwRUFBMkQ7QUFDM0QsMEVBQTJEO0FBQzNELHNDQUE0RDtBQUM1RCx5REFBMEo7QUFFMUosNERBQThDO0FBQzlDLHNFQUF3RDtBQUV4RCwyQkFBMEQ7QUFDMUQsK0JBR2M7QUFFZCx1Q0FBb0M7QUFDcEMsMkNBQXdDO0FBQ3hDLHdDQUF1RDtBQUN2RCwwQ0FBd0M7QUFFeEMsTUFBYSxpQkFBaUI7SUFDakIsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxpQkFBaUIsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUN2RCw4RkFBOEY7SUFDOUYsbUNBQW1DO0lBQzFCLGdCQUFnQixHQUFHLFdBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO0lBRTNELFdBQVcsR0FBbUMsSUFBSSxHQUFHLEVBQUUsQ0FBQztJQUcxRCxBQUFOLEtBQUssQ0FBQyxlQUFlO1FBQ2pCLE1BQU0sSUFBSSxHQUFHLFdBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztRQUNoQyxNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUM7UUFDaEMsTUFBTSxjQUFjLEdBQUcsTUFBTSxDQUFDLGtCQUFrQixFQUFFLG9CQUFvQixJQUFJLGNBQWMsQ0FBQztRQUV6RixNQUFNLHNCQUFzQixHQUFHLENBQUUsSUFBQSxjQUFXLEVBQUMsU0FBUyxjQUFjLEdBQUcsQ0FBQyxDQUFFLENBQUM7UUFFM0UsSUFBSSxJQUFJLENBQUMsVUFBVSxFQUFFLEVBQUUsQ0FBQztZQUNwQixLQUFLLE1BQU0s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QUMsa0JBQWtCLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxVQUFVLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFFdkUsTUFBTSx1QkFBdUIsR0FBRyxJQUFBLFdBQVEsRUFBQyxtQkFBbUIsRUFBRSxnQkFBZ0IsQ0FBQyxDQUFDO1FBQ2hGLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLG9DQUFvQyx1QkFBdUIsRUFBRSxDQUFFLENBQUM7UUFDbEYsSUFBQSxrQkFBYSxFQUFDLHVCQUF1QixFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsZUFBZSxFQUFFLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBRXJGLENBQUM7Q0FDSjtBQWxrQkQsOENBa2tCQztBQXpqQlM7SUFETCxJQUFBLHFCQUFXLEdBQUU7d0RBd0NiO0FBdUVLO0lBREwsSUFBQSxxQkFBVyxHQUFFO2dEQThNYjtBQWlIRDtJQURDLElBQUEscUJBQVcsR0FBRTttRUFpQmI7QUFHSztJQURMLElBQUEscUJBQVcsR0FBRTs0REFxQ2I7QUFHSztJQURMLElBQUEscUJBQVcsR0FBRTtrRUFrRGI7QUFHSztJQURMLElBQUEscUJBQVcsR0FBRTtxREErQmIiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyB0eXBlIH0gZnJvbSAnb3MnO1xuaW1wb3J0IE1ha2VDcmVhdGVFbnRpdHlDb25maWcgZnJvbSAnLi90ZW1wbGF0ZXMvY3JlYXRlLWVudGl0eSc7XG5pbXBvcnQgTWFrZVVwZGF0ZUVudGl0eUNvbmZpZyBmcm9tICcuL3RlbXBsYXRlcy91cGRhdGUtZW50aXR5JztcbmltcG9ydCBNYWtlTGlzdEVudGl0eUNvbmZpZyBmcm9tICcuL3RlbXBsYXRlcy9saXN0LWVudGl0eSc7XG5pbXBvcnQgTWFrZVZpZXdFbnRpdHlDb25maWcgZnJvbSAnLi90ZW1wbGF0ZXMvdmlldy1lbnRpdHknO1xuaW1wb3J0IE1ha2VFbnRpdHlNZW51Q29uZmlnIGZyb20gJy4vdGVtcGxhdGVzL2VudGl0eS1tZW51JztcbmltcG9ydCB7IEJhc2VFbnRpdHlTZXJ2aWNlLCBFbnRpdHlTY2hlbWEgfSBmcm9tICcuLi9lbnRpdHknO1xuaW1wb3J0IHsgbWFrZUN1c3RvbVBhZ2VDb25maWcsIEN1c3RvbVBhZ2VPcHRpb25zLCBMaXN0UGFnZUNvbmZpZywgRm9ybVBhZ2VDb25maWcsIERldGFpbHNQYWdlQ29uZmlnLCBEYXNoYm9hcmRQYWdlQ29uZmlnIH0gZnJvbSAnLi90ZW1wbGF0ZXMvY3VzdG9tLXBhZ2UnO1xuXG5pbXBvcnQgTWFrZUF1dGhDb25maWcgZnJvbSAnLi90ZW1wbGF0ZXMvYXV0aCc7XG5pbXBvcnQgTWFrZURhc2hib2FyZENvbmZpZyBmcm9tICcuL3RlbXBsYXRlcy9kYXNoYm9hcmQnO1xuXG5pbXBvcnQgeyBleGlzdHNTeW5jLCBta2RpclN5bmMsIHdyaXRlRmlsZVN5bmMgfSBmcm9tIFwiZnNcIjtcbmltcG9ydCB7XG4gICAgcmVzb2x2ZSBhcyBwYXRoUmVzb2x2ZSxcbiAgICBqb2luIGFzIHBhdGhKb2luXG59IGZyb20gXCJwYXRoXCI7XG5cbmltcG9ydCB7IEZ3MjQgfSBmcm9tICcuLi9jb3JlL2Z3MjQnO1xuaW1wb3J0IHsgSGVscGVyIH0gZnJvbSAnLi4vY29yZS9oZWxwZXInO1xuaW1wb3J0IHsgTG9nRHVyYXRpb24sIGNyZWF0ZUxvZ2dlciB9IGZyb20gJy4uL2xvZ2dpbmcnO1xuaW1wb3J0IHsgdG9TbHVnIH0gZnJvbSAnLi4vdXRpbHMvY2FzZXMnO1xuXG5leHBvcnQgY2xhc3MgRW50aXR5VUlDb25maWdHZW4ge1xuICAgIHJlYWRvbmx5IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcihFbnRpdHlVSUNvbmZpZ0dlbi5uYW1lKTtcbiAgICAvLyBtYWtlIHN1cmUgdG8gY3JlYXRlIGEgY2hpbGQgY29udGFpbmVyIHRvIG5vdCBwb2xsdXRlIGFueXRoaW5nIGluIHRoZSBBcHBsaWNhdGlvbiBjb250YWluZXIgXG4gICAgLy8gd2hpbGUgc2Nhbm5pbmcgYW5kIGxvYWRpbmcgc3R1ZmZcbiAgICByZWFkb25seSB1aUdlbkRJQ29udGFpbmVyID0gRncyNC5nZXRJbnN0YW5jZSgpLmdldEFwcERJQ29udGFpbmVyKCk7XG5cbiAgICBwcml2YXRlIGN1c3RvbVBhZ2VzOiBNYXA8c3RyaW5nLCBDdXN0b21QYWdlT3B0aW9ucz4gPSBuZXcgTWFwKCk7XG5cbiAgICBATG9nRHVyYXRpb24oKVxuICAgIGFzeW5jIHNjYW5DdXN0b21QYWdlcygpIHtcbiAgICAgICAgY29uc3QgZncyNCA9IEZ3MjQuZ2V0SW5zdGFuY2UoKTtcbiAgICAgICAgY29uc3QgY29uZmlnID0gZncyNC5nZXRDb25maWcoKTtcbiAgICAgICAgY29uc3QgY3VzdG9tUGFnZXNEaXIgPSBjb25maWcudWlDb25maWdHZW5PcHRpb25zPy5jdXN0b21QYWdlc0RpcmVjdG9yeSB8fCAnY3VzdG9tLXBhZ2VzJztcblxuICAgICAgICBjb25zdCBjdXN0b21QYWdlc0RpcmVjdG9yaWVzID0gWyBwYXRoUmVzb2x2ZShgLi9zcmMvJHtjdXN0b21QYWdlc0Rpcn0vYCkgXTtcblxuICAgICAgICBpZiAoZncyNC5oYXNNb2R1bGVzKCkpIHtcbiAgICAgICAgICAgIGZvciAoY29uc3QgWyAsIG1vZHVsZSBdIG9mIGZ3MjQuZ2V0TW9kdWxlcygpKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgbW9kdWxlQ3VzdG9tUGFnZXNQYXRoID0gcGF0aEpvaW4obW9kdWxlLmdldEJhc2VQYXRoKCksIGN1c3RvbVBhZ2VzRGlyKTtcbiAgICAgICAgICAgICAgICBjdXN0b21QYWdlc0RpcmVjdG9yaWVzLnB1c2gocGF0aFJlc29sdmUobW9kdWxlQ3VzdG9tUGFnZXNQYXRoKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBmb3IgKGNvbnN0IGRpciBvZiBjdXN0b21QYWdlc0RpcmVjdG9yaWVzKSB7XG4gICAgICAgICAgICBpZiAoIWV4aXN0c1N5bmMoZGlyKSkge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDdXN0b20gcGFnZXMgZGlyZWN0b3J5IGRvZXMgbm90IGV4aXN0OiAke2Rpcn1gKTtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgY3VzdG9tUGFnZUZpbGVzID0gSGVscGVyLnNjYW5Db250cm9sbGVyU291cmNlRmlsZXNGcm9tKGRpcik7XG5cbiAgICAgICAgICAgIGZvciAoY29uc3QgZmlsZSBvZiBjdXN0b21QYWdlRmlsZXMpIHtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBtb2R1bGUgPSBhd2FpdCBpbXBvcnQocGF0aEpvaW4oZGlyLCBmaWxlKSk7XG4gICAgICAgICAgICAgICAgICAgIGZvciAoY29uc3QgWyBrZXksIHZhbHVlIF0gb2YgT2JqZWN0LmVudHJpZXMobW9kdWxlKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuaXNWYWxpZEN1c3RvbVBhZ2VDb25maWcodmFsdWUpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcGFnZU5hbWUgPSB0aGlzLmdldFBhZ2VOYW1lRnJvbUNvbmZpZyh2YWx1ZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHBhZ2VOYW1lKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMucmVnaXN0ZXJDdXN0b21QYWdlKHZhbHVlKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgUmVnaXN0ZXJlZCBjdXN0b20gcGFnZTogJHtwYWdlTmFtZX1gKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKGBFcnJvciBsb2FkaW5nIGN1c3RvbSBwYWdlIGZyb20gJHtmaWxlfTpgLCBlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwdWJsaWMgaXNWYWxpZEN1c3RvbVBhZ2VDb25maWcodmFsdWU6IHVua25vd24pOiB2YWx1ZSBpcyBDdXN0b21QYWdlT3B0aW9ucyB7XG4gICAgICAgIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlO1xuXG4gICAgICAgIGNvbnN0IGNvbmZpZyA9IHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgICAgICBpZiAoISgncGFnZVR5cGUnIGluIGNvbmZpZykgfHwgISgncGFnZVRpdGxlJyBpbiBjb25maWcpKSByZXR1cm4gZmFsc2U7XG5cbiAgICAgICAgY29uc3QgcGFnZVR5cGUgPSBjb25maWcucGFnZVR5cGU7XG4gICAgICAgIGlmIChwYWdlVHlwZSA9PT0gJ2xpc3QnKSB7XG4gICAgICAgICAgICByZXR1cm4gJ2xpc3RQYWdlQ29uZmlnJyBpbiBjb25maWc7XG4gICAgICAgIH0gZWxzZSBpZiAocGFnZVR5cGUgPT09ICdmb3JtJykge1xuICAgICAgICAgICAgcmV0dXJuICdmb3JtUGFnZUNvbmZpZycgaW4gY29uZmlnO1xuICAgICAgICB9IGVsc2UgaWYgKHBhZ2VUeXBlID09PSAnZGV0YWlscycpIHtcbiAgICAgICAgICAgIHJldHVybiAnZGV0YWlsc1BhZ2VDb25maWcnIGluIGNvbmZpZztcbiAgICAgICAgfSBlbHNlIGlmIChwYWdlVHlwZSA9PT0gJ2Rhc2hib2FyZCcpIHtcbiAgICAgICAgICAgIHJldHVybiAnZGFzaGJvYXJkUGFnZUNvbmZpZycgaW4gY29uZmlnO1xuICAgICAgICB9IGVsc2UgaWYgKHBhZ2VUeXBlID09PSAnYWNjb3JkaW9uJykge1xuICAgICAgICAgICAgcmV0dXJuICdhY2NvcmRpb25QYWdlQ29uZmlnJyBpbiBjb25maWc7XG4gICAgICAgIH0gZWxzZSBpZiAocGFnZVR5cGUgPT09ICdtZW51Jykge1xuICAgICAgICAgICAgcmV0dXJuICdtZW51UGFnZUNvbmZpZycgaW4gY29uZmlnO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGdldFBhZ2VOYW1lRnJvbUNvbmZpZyhjb25maWc6IEN1c3RvbVBhZ2VPcHRpb25zKTogc3RyaW5nIHwgbnVsbCB7XG4gICAgICAgIGlmIChjb25maWcucGFnZU5hbWUpIHtcbiAgICAgICAgICAgIHJldHVybiB0b1NsdWcoY29uZmlnLnBhZ2VOYW1lKTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgLy8gRm9yIHRlbXBsYXRlLWJhc2VkIHBhZ2UgdGl0bGVzIChvYmplY3RzKSwgcGFnZU5hbWUgTVVTVCBiZSBwcm92aWRlZFxuICAgICAgICAvLyBFeHRyYWN0IHN0cmluZyBmcm9tIHBhZ2VUaXRsZSAoaGFuZGxlcyBib3RoIHN0cmluZyBhbmQgVGVtcGxhdGUgdHlwZXMpXG4gICAgICAgIGNvbnN0IHBhZ2VUaXRsZVN0cmluZyA9IHR5cGVvZiBjb25maWcucGFnZVRpdGxlID09PSAnc3RyaW5nJyBcbiAgICAgICAgICAgID8gY29uZmlnLnBhZ2VUaXRsZSBcbiAgICAgICAgICAgIDogJ2N1c3RvbS1wYWdlJzsgLy8gRmFsbGJhY2sgZm9yIFRlbXBsYXRlIG9iamVjdHNcbiAgICAgICAgXG4gICAgICAgIHN3aXRjaCAoY29uZmlnLnBhZ2VUeXBlKSB7XG4gICAgICAgICAgICBjYXNlICdsaXN0JzpcbiAgICAgICAgICAgICAgICByZXR1cm4gYGxpc3QtJHt0b1NsdWcocGFnZVRpdGxlU3RyaW5nKX1gO1xuICAgICAgICAgICAgY2FzZSAnZm9ybSc6XG4gICAgICAgICAgICAgICAgcmV0dXJuIHBhZ2VUaXRsZVN0cmluZy50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKCdhZGQnKVxuICAgICAgICAgICAgICAgICAgICA/IGBjcmVhdGUtJHt0b1NsdWcocGFnZVRpdGxlU3RyaW5nKX1gXG4gICAgICAgICAgICAgICAgICAgIDogYGVkaXQtJHt0b1NsdWcocGFnZVRpdGxlU3RyaW5nKX1gO1xuICAgICAgICAgICAgY2FzZSAnZGV0YWlscyc6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGB2aWV3LSR7dG9TbHVnKHBhZ2VUaXRsZVN0cmluZyl9YDtcbiAgICAgICAgICAgIGNhc2UgJ2Rhc2hib2FyZCc6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGAke3RvU2x1ZyhwYWdlVGl0bGVTdHJpbmcpfWA7XG4gICAgICAgICAgICBjYXNlICdhY2NvcmRpb24nOlxuICAgICAgICAgICAgICAgIHJldHVybiBgYWNjb3JkaW9uLSR7dG9TbHVnKHBhZ2VUaXRsZVN0cmluZyl9YDtcbiAgICAgICAgICAgIGNhc2UgJ21lbnUnOlxuICAgICAgICAgICAgICAgIHJldHVybiBgJHt0b1NsdWcocGFnZVRpdGxlU3RyaW5nKX1gO1xuICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJlZ2lzdGVyIGEgY3VzdG9tIHBhZ2UuIFN1cHBvcnRzIG9wdGlvbmFsIHJvdXRlUGF0dGVybiBmb3IgZHluYW1pYyByb3V0ZXMgKGUuZy4sIC9hdXRob3IvOmF1dGhvcklkL2Jvb2tzKVxuICAgICAqL1xuICAgIHB1YmxpYyByZWdpc3RlckN1c3RvbVBhZ2Uob3B0aW9uczogQ3VzdG9tUGFnZU9wdGlvbnMpIHtcbiAgICAgICAgY29uc3QgcGFnZU5hbWUgPSB0aGlzLmdldFBhZ2VOYW1lRnJvbUNvbmZpZyhvcHRpb25zKTtcbiAgICAgICAgaWYgKHBhZ2VOYW1lKSB7XG4gICAgICAgICAgICB0aGlzLmN1c3RvbVBhZ2VzLnNldChwYWdlTmFtZSwgb3B0aW9ucyk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBhc3luYyBydW4oKSB7XG4gICAgICAgIHRoaXMucHJvY2VzcygpO1xuICAgIH1cblxuICAgIEBMb2dEdXJhdGlvbigpXG4gICAgYXN5bmMgcHJvY2VzcygpIHtcbiAgICAgICAgY29uc3QgbWVudUNvbmZpZ3M6IGFueVtdID0gW107XG4gICAgICAgIGNvbnN0IGVudGl0eUNvbmZpZ3M6IGFueSA9IHt9O1xuXG4gICAgICAgIGNvbnN0IHNlcnZpY2VEaXJlY3RvcmllcyA9IHRoaXMucHJlcGFyZVNlcnZpY2VzRGlyZWN0b3JpZXMoKTtcblxuICAgICAgICBjb25zdCBzZXJ2aWNlcyA9IGF3YWl0IHRoaXMuc2NhbkFuZExvYWRTZXJ2aWNlcyhzZXJ2aWNlRGlyZWN0b3JpZXMpO1xuXG4gICAgICAgIC8vIFNjYW4gYW5kIGxvYWQgY3VzdG9tIHBhZ2VzXG4gICAgICAgIGF3YWl0IHRoaXMuc2NhbkN1c3RvbVBhZ2VzKCk7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFVpLWNvbmZpZy1nZW46OjogUHJvY2Vzczo6OiBhbGwtc2VydmljZXM6IGAsIEFycmF5LmZyb20oc2VydmljZXMua2V5cygpKSk7XG5cbiAgICAgICAgLy8gR2V0IGdsb2JhbCBVSSBjb25maWcgb3B0aW9ucyAoaW5jbHVkaW5nIGR1cGxpY2F0ZWRGaWVsZERldGVjdGlvbilcbiAgICAgICAgY29uc3QgZ2xvYmFsVUlDb25maWdPcHRpb25zID0gRncyNC5nZXRJbnN0YW5jZSgpLmdldENvbmZpZygpLnVpQ29uZmlnR2VuT3B0aW9ucztcbiAgICAgICAgXG4gICAgICAgIGxldCBtZW51SW5kZXggPSAxO1xuICAgICAgICAvLyBnZW5lcmF0ZSBVSSBjb25maWdzXG4gICAgICAgIHNlcnZpY2VzLmZvckVhY2goKHNlcnZpY2UsIGVudGl0eU5hbWUpID0+IHtcblxuICAgICAgICAgICAgbGV0IGVudGl0eVNjaGVtYSA9IHNlcnZpY2UuZ2V0RW50aXR5U2NoZW1hKCkgYXMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+O1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBDaGVjayBmb3IgZGVwcmVjYXRlZCB1c2FnZSBhbmQgd2FyblxuICAgICAgICAgICAgdGhpcy5jaGVja0RlcHJlY2F0ZWRVc2FnZShlbnRpdHlTY2hlbWEpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBUcmFuc2Zvcm0gbGVnYWN5IGNvbmZpZyBzdHJ1Y3R1cmUgdG8gbmV3IG5lc3RlZCBzdHJ1Y3R1cmUgaWYgbmVlZGVkXG4gICAgICAgICAgICBlbnRpdHlTY2hlbWEgPSB0aGlzLnRyYW5zZm9ybUxlZ2FjeUNvbmZpZyhlbnRpdHlTY2hlbWEpO1xuICAgICAgICAgICAgY29uc3QgZW50aXR5RGVmYXVsdE9wc1NjaGVtYSA9IHNlcnZpY2UuZ2V0T3BzRGVmYXVsdElPU2NoZW1hKCk7XG5cbiAgICAgICAgICAgIGlmICghZW50aXR5U2NoZW1hLm1vZGVsLmV4Y2x1ZGVGcm9tQWRtaW5DcmVhdGUpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBjcmVhdGVDb25maWcgPSBNYWtlQ3JlYXRlRW50aXR5Q29uZmlnKHtcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZVBsdXJhbDogZW50aXR5U2NoZW1hLm1vZGVsLmVudGl0eU5hbWVQbHVyYWwsXG4gICAgICAgICAgICAgICAgICAgIENSVURBcGlQYXRoOiBlbnRpdHlTY2hlbWEubW9kZWwuQ1JVREFwaVBhdGgsXG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IGVudGl0eURlZmF1bHRPcHNTY2hlbWEuY3JlYXRlLmlucHV0LFxuICAgICAgICAgICAgICAgICAgICAvLyBVc2UgbmV3IG5lc3RlZCBjb25maWcgaWYgYXZhaWxhYmxlLCBmYWxsYmFjayB0byBvbGRcbiAgICAgICAgICAgICAgICAgICAgYnJlYWRjcnVtYnM6IGVudGl0eVNjaGVtYS5tb2RlbC5jcmVhdGVQYWdlQ29uZmlnPy5icmVhZGNydW1icyB8fCBlbnRpdHlTY2hlbWEubW9kZWwuY3JlYXRlUGFnZUJyZWFkY3J1bWJzLFxuICAgICAgICAgICAgICAgICAgICBjb2x1bW5zQ29uZmlnOiBlbnRpdHlTY2hlbWEubW9kZWwuY3JlYXRlUGFnZUNvbmZpZz8uY29sdW1uc0NvbmZpZyB8fCBlbnRpdHlTY2hlbWEubW9kZWwuY3JlYXRlUGFnZUNvbHVtbnNDb25maWcsXG4gICAgICAgICAgICAgICAgICAgIGZvcm1Db25maWc6IGVudGl0eVNjaGVtYS5tb2RlbC5jcmVhdGVQYWdlQ29uZmlnPy5mb3JtQ29uZmlnLFxuICAgICAgICAgICAgICAgIH0sIHNlcnZpY2UpO1xuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ3NbIGBjcmVhdGUtJHtlbnRpdHlOYW1lLnRvTG93ZXJDYXNlKCl9YCBdID0gY3JlYXRlQ29uZmlnO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoIWVudGl0eVNjaGVtYS5tb2RlbC5leGNsdWRlRnJvbUFkbWluVXBkYXRlKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgdXBkYXRlQ29uZmlnID0gTWFrZVVwZGF0ZUVudGl0eUNvbmZpZyh7XG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWVQbHVyYWw6IGVudGl0eVNjaGVtYS5tb2RlbC5lbnRpdHlOYW1lUGx1cmFsLFxuICAgICAgICAgICAgICAgICAgICBDUlVEQXBpUGF0aDogZW50aXR5U2NoZW1hLm1vZGVsLkNSVURBcGlQYXRoLFxuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiBlbnRpdHlEZWZhdWx0T3BzU2NoZW1hLnVwZGF0ZS5pbnB1dCxcbiAgICAgICAgICAgICAgICAgICAgLy8gVXNlIG5ldyBuZXN0ZWQgY29uZmlnIGlmIGF2YWlsYWJsZSwgZmFsbGJhY2sgdG8gb2xkXG4gICAgICAgICAgICAgICAgICAgIGFjdGlvbnM6IGVudGl0eVNjaGVtYS5tb2RlbC5lZGl0UGFnZUNvbmZpZz8uYWN0aW9ucyB8fCBlbnRpdHlTY2hlbWEubW9kZWwuZWRpdFBhZ2VBY3Rpb25zLFxuICAgICAgICAgICAgICAgICAgICBicmVhZGNydW1iczogZW50aXR5U2NoZW1hLm1vZGVsLmVkaXRQYWdlQ29uZmlnPy5icmVhZGNydW1icyB8fCBlbnRpdHlTY2hlbWEubW9kZWwuZWRpdFBhZ2VCcmVhZGNydW1icyxcbiAgICAgICAgICAgICAgICAgICAgY29sdW1uc0NvbmZpZzogZW50aXR5U2NoZW1hLm1vZGVsLmVkaXRQYWdlQ29uZmlnPy5jb2x1bW5zQ29uZmlnIHx8IGVudGl0eVNjaGVtYS5tb2RlbC5lZGl0UGFnZUNvbHVtbnNDb25maWcsXG4gICAgICAgICAgICAgICAgICAgIGZvcm1Db25maWc6IGVudGl0eVNjaGVtYS5tb2RlbC5lZGl0UGFnZUNvbmZpZz8uZm9ybUNvbmZpZyxcbiAgICAgICAgICAgICAgICB9LCBzZXJ2aWNlKTtcbiAgICAgICAgICAgICAgICBlbnRpdHlDb25maWdzWyBgZWRpdC0ke2VudGl0eU5hbWUudG9Mb3dlckNhc2UoKX1gIF0gPSB1cGRhdGVDb25maWc7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICghZW50aXR5U2NoZW1hLm1vZGVsLmV4Y2x1ZGVGcm9tQWRtaW5MaXN0KSB7XG4gICAgICAgICAgICAgICAgY29uc3QgbGlzdENvbmZpZyA9IE1ha2VMaXN0RW50aXR5Q29uZmlnKHtcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZVBsdXJhbDogZW50aXR5U2NoZW1hLm1vZGVsLmVudGl0eU5hbWVQbHVyYWwsXG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IGVudGl0eURlZmF1bHRPcHNTY2hlbWEubGlzdC5vdXRwdXQsXG4gICAgICAgICAgICAgICAgICAgIENSVURBcGlQYXRoOiBlbnRpdHlTY2hlbWEubW9kZWwuQ1JVREFwaVBhdGgsXG4gICAgICAgICAgICAgICAgICAgIHVzZVNlYXJjaDogQm9vbGVhbihlbnRpdHlTY2hlbWEubW9kZWwuc2VhcmNoPy5lbmFibGVkKSxcbiAgICAgICAgICAgICAgICAgICAgZXhjbHVkZUZyb21BZG1pbkNyZWF0ZTogZW50aXR5U2NoZW1hLm1vZGVsLmV4Y2x1ZGVGcm9tQWRtaW5DcmVhdGUsXG4gICAgICAgICAgICAgICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5VcGRhdGU6IGVudGl0eVNjaGVtYS5tb2RlbC5leGNsdWRlRnJvbUFkbWluVXBkYXRlLFxuICAgICAgICAgICAgICAgICAgICBleGNsdWRlRnJvbUFkbWluRGVsZXRlOiBlbnRpdHlTY2hlbWEubW9kZWwuZXhjbHVkZUZyb21BZG1pbkRlbGV0ZSxcbiAgICAgICAgICAgICAgICAgICAgZXhjbHVkZUZyb21BZG1pbkRldGFpbDogZW50aXR5U2NoZW1hLm1vZGVsLmV4Y2x1ZGVGcm9tQWRtaW5EZXRhaWwsXG4gICAgICAgICAgICAgICAgICAgIC8vIFVzZSBuZXcgbmVzdGVkIGNvbmZpZyBpZiBhdmFpbGFibGUsIGZhbGxiYWNrIHRvIG9sZFxuICAgICAgICAgICAgICAgICAgICBwYWdlSGVhZGVyQWN0aW9uczogZW50aXR5U2NoZW1hLm1vZGVsLmxpc3RQYWdlQ29uZmlnPy5hY3Rpb25zIHx8IGVudGl0eVNjaGVtYS5tb2RlbC5saXN0UGFnZUFjdGlvbnMsXG4gICAgICAgICAgICAgICAgICAgIGJyZWFkY3J1bWJzOiBlbnRpdHlTY2hlbWEubW9kZWwubGlzdFBhZ2VDb25maWc/LmJyZWFkY3J1bWJzIHx8IGVudGl0eVNjaGVtYS5tb2RlbC5saXN0UGFnZUJyZWFkY3J1bWJzLFxuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0U29ydDogZW50aXR5U2NoZW1hLm1vZGVsLmxpc3RQYWdlQ29uZmlnPy5kZWZhdWx0U29ydCB8fCBlbnRpdHlTY2hlbWEubW9kZWwubGlzdFBhZ2VEZWZhdWx0U29ydCxcbiAgICAgICAgICAgICAgICAgICAgdGFibGVDb25maWc6IGVudGl0eVNjaGVtYS5tb2RlbC5saXN0UGFnZUNvbmZpZz8udGFibGVDb25maWcsXG4gICAgICAgICAgICAgICAgICAgIGdsb2JhbFVJQ29uZmlnT3B0aW9ucywgIC8vIE5FVzogUGFzcyBnbG9iYWwgY29uZmlnXG4gICAgICAgICAgICAgICAgfSwgc2VydmljZSk7XG4gICAgICAgICAgICAgICAgZW50aXR5Q29uZmlnc1sgYGxpc3QtJHtlbnRpdHlOYW1lLnRvTG93ZXJDYXNlKCl9YCBdID0gbGlzdENvbmZpZztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKCFlbnRpdHlTY2hlbWEubW9kZWwuZXhjbHVkZUZyb21BZG1pbkRldGFpbCkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHZpZXdDb25maWcgPSBNYWtlVmlld0VudGl0eUNvbmZpZyh7XG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWVQbHVyYWw6IGVudGl0eVNjaGVtYS5tb2RlbC5lbnRpdHlOYW1lUGx1cmFsLFxuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiBlbnRpdHlEZWZhdWx0T3BzU2NoZW1hLmdldC5vdXRwdXQsXG4gICAgICAgICAgICAgICAgICAgIENSVURBcGlQYXRoOiBlbnRpdHlTY2hlbWEubW9kZWwuQ1JVREFwaVBhdGgsXG4gICAgICAgICAgICAgICAgICAgIC8vIFVzZSBuZXcgbmVzdGVkIGNvbmZpZyBpZiBhdmFpbGFibGUsIGZhbGxiYWNrIHRvIG9sZFxuICAgICAgICAgICAgICAgICAgICBhY3Rpb25zOiBlbnRpdHlTY2hlbWEubW9kZWwudmlld1BhZ2VDb25maWc/LmFjdGlvbnMgfHwgZW50aXR5U2NoZW1hLm1vZGVsLnZpZXdQYWdlQWN0aW9ucyxcbiAgICAgICAgICAgICAgICAgICAgYnJlYWRjcnVtYnM6IGVudGl0eVNjaGVtYS5tb2RlbC52aWV3UGFnZUNvbmZpZz8uYnJlYWRjcnVtYnMgfHwgZW50aXR5U2NoZW1hLm1vZGVsLnZpZXdQYWdlQnJlYWRjcnVtYnMsXG4gICAgICAgICAgICAgICAgICAgIGNvbHVtbnNDb25maWc6IGVudGl0eVNjaGVtYS5tb2RlbC52aWV3UGFnZUNvbmZpZz8uY29sdW1uc0NvbmZpZyB8fCBlbnRpdHlTY2hlbWEubW9kZWwudmlld1BhZ2VDb2x1bW5zQ29uZmlnLFxuICAgICAgICAgICAgICAgICAgICBmaWVsZHM6IGVudGl0eVNjaGVtYS5tb2RlbC52aWV3UGFnZUNvbmZpZz8uZmllbGRzLFxuICAgICAgICAgICAgICAgICAgICBnbG9iYWxVSUNvbmZpZ09wdGlvbnMsICAvLyBORVc6IFBhc3MgZ2xvYmFsIGNvbmZpZ1xuICAgICAgICAgICAgICAgIH0sIHNlcnZpY2UpO1xuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ3NbIGB2aWV3LSR7ZW50aXR5TmFtZS50b0xvd2VyQ2FzZSgpfWAgXSA9IHZpZXdDb25maWc7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICghZW50aXR5U2NoZW1hLm1vZGVsLmV4Y2x1ZGVGcm9tQWRtaW5NZW51KSB7XG4gICAgICAgICAgICAgICAgY29uc3QgbWVudUNvbmZpZyA9IE1ha2VFbnRpdHlNZW51Q29uZmlnKHtcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZVBsdXJhbDogZW50aXR5U2NoZW1hLm1vZGVsLmVudGl0eU5hbWVQbHVyYWwsXG4gICAgICAgICAgICAgICAgICAgIGljb246IGVudGl0eVNjaGVtYS5tb2RlbC5lbnRpdHlNZW51SWNvbiB8fCAnYXBwU3RvcmUnLFxuICAgICAgICAgICAgICAgICAgICBtZW51SW5kZXg6IG1lbnVJbmRleCsrLFxuICAgICAgICAgICAgICAgICAgICBleGNsdWRlRnJvbUFkbWluTGlzdDogZW50aXR5U2NoZW1hLm1vZGVsLmV4Y2x1ZGVGcm9tQWRtaW5MaXN0LFxuICAgICAgICAgICAgICAgICAgICBleGNsdWRlRnJvbUFkbWluQ3JlYXRlOiBlbnRpdHlTY2hlbWEubW9kZWwuZXhjbHVkZUZyb21BZG1pbkNyZWF0ZSxcbiAgICAgICAgICAgICAgICAgICAgbWVudUdyb3VwOiBlbnRpdHlTY2hlbWEubW9kZWwubWVudUdyb3VwLFxuICAgICAgICAgICAgICAgICAgICBtZW51T3JkZXI6IGVudGl0eVNjaGVtYS5tb2RlbC5tZW51T3JkZXIsXG4gICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICBtZW51Q29uZmlncy5wdXNoKG1lbnVDb25maWcpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIFByb2Nlc3MgY3VzdG9tIHBhZ2VzXG4gICAgICAgIGZvciAoY29uc3QgWyBwYWdlTmFtZSwgb3B0aW9ucyBdIG9mIHRoaXMuY3VzdG9tUGFnZXMpIHtcbiAgICAgICAgICAgIC8vIHNraXAgdGhlIGRlZmF1bHQgZGFzaGJvYXJkIHBhZ2UgYW5kIG1lbnUgcGFnZVxuICAgICAgICAgICAgaWYgKHBhZ2VOYW1lID09PSAnZGFzaGJvYXJkJyB8fCBwYWdlTmFtZSA9PT0gJ21lbnUnKSB7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zdCBjdXN0b21Db25maWcgPSBtYWtlQ3VzdG9tUGFnZUNvbmZpZyhvcHRpb25zKTtcbiAgICAgICAgICAgIGVudGl0eUNvbmZpZ3NbIHBhZ2VOYW1lIF0gPSBjdXN0b21Db25maWc7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBhdXRoQ29uZmlnT3B0aW9ucyA9IEZ3MjQuZ2V0SW5zdGFuY2UoKS5nZXRDb25maWcoKS51aUNvbmZpZ0dlbk9wdGlvbnMgfHwge307XG5cbiAgICAgICAgY29uc3QgYXV0aENvbmZpZ3MgPSBNYWtlQXV0aENvbmZpZyh7XG4gICAgICAgICAgICAuLi5hdXRoQ29uZmlnT3B0aW9ucyxcbiAgICAgICAgICAgIGF1dGhFbmRwb2ludDogYXV0aENvbmZpZ09wdGlvbnMuYXV0aEVuZHBvaW50IHx8ICdtYXV0aCdcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gTG9vayBmb3IgYSBkYXNoYm9hcmQgY3VzdG9tIHBhZ2VcbiAgICAgICAgbGV0IGRhc2hib2FyZENvbmZpZzogRGFzaGJvYXJkUGFnZUNvbmZpZyB8IGFueSA9IG51bGw7XG4gICAgICAgIGZvciAoY29uc3QgWyAsIG9wdGlvbnMgXSBvZiB0aGlzLmN1c3RvbVBhZ2VzKSB7XG4gICAgICAgICAgICAvLyBDaGVjayBpZiB0aGlzIGlzIGEgZGFzaGJvYXJkIHBhZ2UgLSBoYW5kbGUgYm90aCBzdHJpbmcgYW5kIFRlbXBsYXRlIHBhZ2VUaXRsZVxuICAgICAgICAgICAgY29uc3QgcGFnZVRpdGxlU3RyID0gdHlwZW9mIG9wdGlvbnMucGFnZVRpdGxlID09PSAnc3RyaW5nJyA/IG9wdGlvbnMucGFnZVRpdGxlIDogJyc7XG4gICAgICAgICAgICBpZiAob3B0aW9ucy5wYWdlVHlwZSA9PT0gJ2Rhc2hib2FyZCcgJiYgcGFnZVRpdGxlU3RyLnRvTG93ZXJDYXNlKCkgPT09ICdkYXNoYm9hcmQnKSB7XG4gICAgICAgICAgICAgICAgZGFzaGJvYXJkQ29uZmlnID0gb3B0aW9ucztcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBpZiAoIWRhc2hib2FyZENvbmZpZykge1xuICAgICAgICAgICAgZGFzaGJvYXJkQ29uZmlnID0gTWFrZURhc2hib2FyZENvbmZpZygpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gTG9vayBmb3IgYSBtZW51IGN1c3RvbSBwYWdlXG4gICAgICAgIGxldCBtZW51Q29uZmlnOiBhbnkgPSBudWxsO1xuICAgICAgICBmb3IgKGNvbnN0IFsgcGFnZU5hbWUsIG9wdGlvbnMgXSBvZiB0aGlzLmN1c3RvbVBhZ2VzKSB7XG4gICAgICAgICAgICAvLyBDaGVjayBpZiB0aGlzIGlzIGEgbWVudSBwYWdlIC0gaGFuZGxlIGJvdGggc3RyaW5nIGFuZCBUZW1wbGF0ZSBwYWdlVGl0bGVcbiAgICAgICAgICAgIGNvbnN0IHBhZ2VUaXRsZVN0ciA9IHR5cGVvZiBvcHRpb25zLnBhZ2VUaXRsZSA9PT0gJ3N0cmluZycgPyBvcHRpb25zLnBhZ2VUaXRsZSA6ICcnO1xuICAgICAgICAgICAgaWYgKG9wdGlvbnMucGFnZVR5cGUgPT09ICdtZW51JyAmJiBwYWdlVGl0bGVTdHIudG9Mb3dlckNhc2UoKSA9PT0gJ21lbnUnKSB7XG4gICAgICAgICAgICAgICAgbWVudUNvbmZpZyA9IG9wdGlvbnM7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBHcm91cCBtZW51IGl0ZW1zIGJ5IHRoZWlyIGdyb3VwIHByb3BlcnR5XG4gICAgICAgIGNvbnN0IG1lbnVHcm91cHMgPSBuZXcgTWFwPHN0cmluZywgYW55W10+KCk7XG4gICAgICAgIGNvbnN0IHVuZ3JvdXBlZEl0ZW1zOiBhbnlbXSA9IFtdO1xuXG4gICAgICAgIC8vIFByb2Nlc3MgZW50aXR5IG1lbnUgaXRlbXNcbiAgICAgICAgbWVudUNvbmZpZ3MuZm9yRWFjaChpdGVtID0+IHtcbiAgICAgICAgICAgIGlmIChpdGVtLmdyb3VwKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFtZW51R3JvdXBzLmhhcyhpdGVtLmdyb3VwKSkge1xuICAgICAgICAgICAgICAgICAgICBtZW51R3JvdXBzLnNldChpdGVtLmdyb3VwLCBbXSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIG1lbnVHcm91cHMuZ2V0KGl0ZW0uZ3JvdXApIS5wdXNoKGl0ZW0pO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB1bmdyb3VwZWRJdGVtcy5wdXNoKGl0ZW0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBQcm9jZXNzIGN1c3RvbSBtZW51IGl0ZW1zXG4gICAgICAgIGlmIChtZW51Q29uZmlnPy5tZW51UGFnZUNvbmZpZz8ubWVudUl0ZW1zKSB7XG4gICAgICAgICAgICBtZW51Q29uZmlnLm1lbnVQYWdlQ29uZmlnLm1lbnVJdGVtcy5mb3JFYWNoKChpdGVtOiBhbnkpID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoaXRlbS5ncm91cCkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoIW1lbnVHcm91cHMuaGFzKGl0ZW0uZ3JvdXApKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBtZW51R3JvdXBzLnNldChpdGVtLmdyb3VwLCBbXSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgbWVudUdyb3Vwcy5nZXQoaXRlbS5ncm91cCkhLnB1c2goaXRlbSk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgdW5ncm91cGVkSXRlbXMucHVzaChpdGVtKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENyZWF0ZSBmaW5hbCBtZW51IHN0cnVjdHVyZVxuICAgICAgICBjb25zdCBhbGxNZW51SXRlbXM6IGFueVtdID0gW107XG5cbiAgICAgICAgLy8gQWRkIHVuZ3JvdXBlZCBpdGVtcyBmaXJzdCAocHJpbWFyeSBuYXZpZ2F0aW9uKVxuICAgICAgICBhbGxNZW51SXRlbXMucHVzaCguLi51bmdyb3VwZWRJdGVtcyk7XG5cbiAgICAgICAgLy8gQWRkIGdyb3VwZWQgaXRlbXNcbiAgICAgICAgbWVudUdyb3Vwcy5mb3JFYWNoKChpdGVtcywgZ3JvdXBOYW1lKSA9PiB7XG4gICAgICAgICAgICAvLyBTb3J0IGl0ZW1zIHdpdGhpbiBncm91cCBieSBvcmRlclxuICAgICAgICAgICAgaXRlbXMuc29ydCgoYSwgYikgPT4gKGEub3JkZXIgfHwgMCkgLSAoYi5vcmRlciB8fCAwKSk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIENyZWF0ZSBncm91cCBpdGVtXG4gICAgICAgICAgICBhbGxNZW51SXRlbXMucHVzaCh7XG4gICAgICAgICAgICAgICAgbGFiZWw6IGdyb3VwTmFtZSxcbiAgICAgICAgICAgICAgICBrZXk6IGBncm91cC0ke2dyb3VwTmFtZX1gLFxuICAgICAgICAgICAgICAgIGljb246ICdGb2xkZXJPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgY2hpbGRyZW46IGl0ZW1zXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgYXdhaXQgdGhpcy53cml0ZVRvRmlsZXMoYWxsTWVudUl0ZW1zLCBlbnRpdHlDb25maWdzLCBhdXRoQ29uZmlncywgZGFzaGJvYXJkQ29uZmlnKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBUcmFuc2Zvcm0gbGVnYWN5IGZsYXQgY29uZmlnIHN0cnVjdHVyZSB0byBuZXcgbmVzdGVkIHN0cnVjdHVyZVxuICAgICAqIFN1cHBvcnRzIGJhY2t3YXJkIGNvbXBhdGliaWxpdHkgYnkgdHJhbnNmb3JtaW5nIG9sZCBwcm9wZXJ0aWVzIHRvIG5ldyBmb3JtYXRcbiAgICAgKi9cbiAgICBwcml2YXRlIHRyYW5zZm9ybUxlZ2FjeUNvbmZpZyhzY2hlbWE6IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pik6IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PiB7XG4gICAgICAgIGNvbnN0IG1vZGVsID0gc2NoZW1hLm1vZGVsO1xuICAgICAgICBcbiAgICAgICAgLy8gSWYgYWxyZWFkeSB1c2luZyBuZXcgZm9ybWF0LCByZXR1cm4gYXMtaXNcbiAgICAgICAgaWYgKG1vZGVsLmxpc3RQYWdlQ29uZmlnIHx8IG1vZGVsLnZpZXdQYWdlQ29uZmlnIHx8IG1vZGVsLmVkaXRQYWdlQ29uZmlnIHx8IG1vZGVsLmNyZWF0ZVBhZ2VDb25maWcpIHtcbiAgICAgICAgICAgIHJldHVybiBzY2hlbWE7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIC8vIFRyYW5zZm9ybSBvbGQgZm9ybWF0IHRvIG5ldyBuZXN0ZWQgc3RydWN0dXJlXG4gICAgICAgIGNvbnN0IHRyYW5zZm9ybWVkTW9kZWwgPSB7XG4gICAgICAgICAgICAuLi5tb2RlbCxcbiAgICAgICAgICAgIC8vIExpc3QgcGFnZSB0cmFuc2Zvcm1hdGlvblxuICAgICAgICAgICAgbGlzdFBhZ2VDb25maWc6IChtb2RlbC5saXN0UGFnZUFjdGlvbnMgfHwgbW9kZWwubGlzdFBhZ2VCcmVhZGNydW1icyB8fCBtb2RlbC5saXN0UGFnZURlZmF1bHRTb3J0KVxuICAgICAgICAgICAgICAgID8ge1xuICAgICAgICAgICAgICAgICAgICBhY3Rpb25zOiBtb2RlbC5saXN0UGFnZUFjdGlvbnMsXG4gICAgICAgICAgICAgICAgICAgIGJyZWFkY3J1bWJzOiBtb2RlbC5saXN0UGFnZUJyZWFkY3J1bWJzLFxuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0U29ydDogbW9kZWwubGlzdFBhZ2VEZWZhdWx0U29ydFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICA6IHVuZGVmaW5lZCxcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gVmlldyBwYWdlIHRyYW5zZm9ybWF0aW9uXG4gICAgICAgICAgICB2aWV3UGFnZUNvbmZpZzogKG1vZGVsLnZpZXdQYWdlQWN0aW9ucyB8fCBtb2RlbC52aWV3UGFnZUJyZWFkY3J1bWJzIHx8IG1vZGVsLnZpZXdQYWdlQ29sdW1uc0NvbmZpZylcbiAgICAgICAgICAgICAgICA/IHtcbiAgICAgICAgICAgICAgICAgICAgYWN0aW9uczogbW9kZWwudmlld1BhZ2VBY3Rpb25zLFxuICAgICAgICAgICAgICAgICAgICBicmVhZGNydW1iczogbW9kZWwudmlld1BhZ2VCcmVhZGNydW1icyxcbiAgICAgICAgICAgICAgICAgICAgY29sdW1uc0NvbmZpZzogbW9kZWwudmlld1BhZ2VDb2x1bW5zQ29uZmlnXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIDogdW5kZWZpbmVkLFxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBFZGl0IHBhZ2UgdHJhbnNmb3JtYXRpb25cbiAgICAgICAgICAgIGVkaXRQYWdlQ29uZmlnOiAobW9kZWwuZWRpdFBhZ2VBY3Rpb25zIHx8IG1vZGVsLmVkaXRQYWdlQnJlYWRjcnVtYnMgfHwgbW9kZWwuZWRpdFBhZ2VDb2x1bW5zQ29uZmlnKVxuICAgICAgICAgICAgICAgID8ge1xuICAgICAgICAgICAgICAgICAgICBhY3Rpb25zOiBtb2RlbC5lZGl0UGFnZUFjdGlvbnMsXG4gICAgICAgICAgICAgICAgICAgIGJyZWFkY3J1bWJzOiBtb2RlbC5lZGl0UGFnZUJyZWFkY3J1bWJzLFxuICAgICAgICAgICAgICAgICAgICBjb2x1bW5zQ29uZmlnOiBtb2RlbC5lZGl0UGFnZUNvbHVtbnNDb25maWdcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgOiB1bmRlZmluZWQsXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIENyZWF0ZSBwYWdlIHRyYW5zZm9ybWF0aW9uXG4gICAgICAgICAgICBjcmVhdGVQYWdlQ29uZmlnOiAobW9kZWwuY3JlYXRlUGFnZUJyZWFkY3J1bWJzIHx8IG1vZGVsLmNyZWF0ZVBhZ2VDb2x1bW5zQ29uZmlnKVxuICAgICAgICAgICAgICAgID8ge1xuICAgICAgICAgICAgICAgICAgICBicmVhZGNydW1iczogbW9kZWwuY3JlYXRlUGFnZUJyZWFkY3J1bWJzLFxuICAgICAgICAgICAgICAgICAgICBjb2x1bW5zQ29uZmlnOiBtb2RlbC5jcmVhdGVQYWdlQ29sdW1uc0NvbmZpZ1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICA6IHVuZGVmaW5lZCxcbiAgICAgICAgfTtcbiAgICAgICAgXG4gICAgICAgIHJldHVybiB7IC4uLnNjaGVtYSwgbW9kZWw6IHRyYW5zZm9ybWVkTW9kZWwgfTtcbiAgICB9XG4gICAgXG4gICAgLyoqXG4gICAgICogQ2hlY2sgZm9yIGRlcHJlY2F0ZWQgY29uZmlndXJhdGlvbiB1c2FnZSBhbmQgZW1pdCB3YXJuaW5nc1xuICAgICAqL1xuICAgIHByaXZhdGUgY2hlY2tEZXByZWNhdGVkVXNhZ2Uoc2NoZW1hOiBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4pOiB2b2lkIHtcbiAgICAgICAgY29uc3QgbW9kZWwgPSBzY2hlbWEubW9kZWw7XG4gICAgICAgIGNvbnN0IHdhcm5pbmdzOiBzdHJpbmdbXSA9IFtdO1xuICAgICAgICBcbiAgICAgICAgLy8gQ2hlY2sgbGlzdCBwYWdlIGRlcHJlY2F0ZWQgZmllbGRzXG4gICAgICAgIGlmIChtb2RlbC5saXN0UGFnZUFjdGlvbnMpIHtcbiAgICAgICAgICAgIHdhcm5pbmdzLnB1c2goJ2xpc3RQYWdlQWN0aW9ucyBpcyBkZXByZWNhdGVkLiBVc2UgbGlzdFBhZ2VDb25maWcuYWN0aW9ucyBpbnN0ZWFkLicpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChtb2RlbC5saXN0UGFnZUJyZWFkY3J1bWJzKSB7XG4gICAgICAgICAgICB3YXJuaW5ncy5wdXNoKCdsaXN0UGFnZUJyZWFkY3J1bWJzIGlzIGRlcHJlY2F0ZWQuIFVzZSBsaXN0UGFnZUNvbmZpZy5icmVhZGNydW1icyBpbnN0ZWFkLicpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChtb2RlbC5saXN0UGFnZURlZmF1bHRTb3J0KSB7XG4gICAgICAgICAgICB3YXJuaW5ncy5wdXNoKCdsaXN0UGFnZURlZmF1bHRTb3J0IGlzIGRlcHJlY2F0ZWQuIFVzZSBsaXN0UGFnZUNvbmZpZy5kZWZhdWx0U29ydCBpbnN0ZWFkLicpO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICAvLyBDaGVjayB2aWV3IHBhZ2UgZGVwcmVjYXRlZCBmaWVsZHNcbiAgICAgICAgaWYgKG1vZGVsLnZpZXdQYWdlQWN0aW9ucykge1xuICAgICAgICAgICAgd2FybmluZ3MucHVzaCgndmlld1BhZ2VBY3Rpb25zIGlzIGRlcHJlY2F0ZWQuIFVzZSB2aWV3UGFnZUNvbmZpZy5hY3Rpb25zIGluc3RlYWQuJyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG1vZGVsLnZpZXdQYWdlQnJlYWRjcnVtYnMpIHtcbiAgICAgICAgICAgIHdhcm5pbmdzLnB1c2goJ3ZpZXdQYWdlQnJlYWRjcnVtYnMgaXMgZGVwcmVjYXRlZC4gVXNlIHZpZXdQYWdlQ29uZmlnLmJyZWFkY3J1bWJzIGluc3RlYWQuJyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG1vZGVsLnZpZXdQYWdlQ29sdW1uc0NvbmZpZykge1xuICAgICAgICAgICAgd2FybmluZ3MucHVzaCgndmlld1BhZ2VDb2x1bW5zQ29uZmlnIGlzIGRlcHJlY2F0ZWQuIFVzZSB2aWV3UGFnZUNvbmZpZy5jb2x1bW5zQ29uZmlnIGluc3RlYWQuJyk7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIC8vIENoZWNrIGVkaXQgcGFnZSBkZXByZWNhdGVkIGZpZWxkc1xuICAgICAgICBpZiAobW9kZWwuZWRpdFBhZ2VBY3Rpb25zKSB7XG4gICAgICAgICAgICB3YXJuaW5ncy5wdXNoKCdlZGl0UGFnZUFjdGlvbnMgaXMgZGVwcmVjYXRlZC4gVXNlIGVkaXRQYWdlQ29uZmlnLmFjdGlvbnMgaW5zdGVhZC4nKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAobW9kZWwuZWRpdFBhZ2VCcmVhZGNydW1icykge1xuICAgICAgICAgICAgd2FybmluZ3MucHVzaCgnZWRpdFBhZ2VCcmVhZGNydW1icyBpcyBkZXByZWNhdGVkLiBVc2UgZWRpdFBhZ2VDb25maWcuYnJlYWRjcnVtYnMgaW5zdGVhZC4nKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAobW9kZWwuZWRpdFBhZ2VDb2x1bW5zQ29uZmlnKSB7XG4gICAgICAgICAgICB3YXJuaW5ncy5wdXNoKCdlZGl0UGFnZUNvbHVtbnNDb25maWcgaXMgZGVwcmVjYXRlZC4gVXNlIGVkaXRQYWdlQ29uZmlnLmNvbHVtbnNDb25maWcgaW5zdGVhZC4nKTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgLy8gQ2hlY2sgY3JlYXRlIHBhZ2UgZGVwcmVjYXRlZCBmaWVsZHNcbiAgICAgICAgaWYgKG1vZGVsLmNyZWF0ZVBhZ2VCcmVhZGNydW1icykge1xuICAgICAgICAgICAgd2FybmluZ3MucHVzaCgnY3JlYXRlUGFnZUJyZWFkY3J1bWJzIGlzIGRlcHJlY2F0ZWQuIFVzZSBjcmVhdGVQYWdlQ29uZmlnLmJyZWFkY3J1bWJzIGluc3RlYWQuJyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG1vZGVsLmNyZWF0ZVBhZ2VDb2x1bW5zQ29uZmlnKSB7XG4gICAgICAgICAgICB3YXJuaW5ncy5wdXNoKCdjcmVhdGVQYWdlQ29sdW1uc0NvbmZpZyBpcyBkZXByZWNhdGVkLiBVc2UgY3JlYXRlUGFnZUNvbmZpZy5jb2x1bW5zQ29uZmlnIGluc3RlYWQuJyk7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIC8vIEVtaXQgd2FybmluZ3MgaWYgYW55IGRlcHJlY2F0ZWQgZmllbGRzIGZvdW5kXG4gICAgICAgIGlmICh3YXJuaW5ncy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBcXG7imqDvuI8gIEVudGl0eSBcIiR7bW9kZWwuZW50aXR5fVwiIHVzZXMgZGVwcmVjYXRlZCBjb25maWd1cmF0aW9uOmApO1xuICAgICAgICAgICAgd2FybmluZ3MuZm9yRWFjaCh3ID0+IHRoaXMubG9nZ2VyLndhcm4oYCAgIC0gJHt3fWApKTtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYCAgIPCfk5YgTWlncmF0aW9uIGd1aWRlOiBodHRwczovL2RvY3MuZncyNC5pby9taWdyYXRpb24vbmVzdGVkLWNvbmZpZ1xcbmApO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgQExvZ0R1cmF0aW9uKClcbiAgICBwcmVwYXJlU2VydmljZXNEaXJlY3RvcmllcygpIHtcbiAgICAgICAgY29uc3QgZncyNCA9IEZ3MjQuZ2V0SW5zdGFuY2UoKTtcblxuICAgICAgICBjb25zdCBzZXJ2aWNlRGlyZWN0b3JpZXMgPSBbIHBhdGhSZXNvbHZlKCcuL3NyYy9zZXJ2aWNlcy8nKSBdO1xuXG4gICAgICAgIGlmIChmdzI0Lmhhc01vZHVsZXMoKSkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFVpLWNvbmZpZy1nZW46OjogUHJvY2Vzczo6OiBhcHAgaGFzIG1vZHVsZXM6IGAsIEFycmF5LmZyb20oZncyNC5nZXRNb2R1bGVzKCkua2V5cygpKSk7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IFsgLCBtb2R1bGUgXSBvZiBmdzI0LmdldE1vZHVsZXMoKSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IG1vZHVsZVNlcnZpY2VzUGF0aCA9IHBhdGhKb2luKG1vZHVsZS5nZXRCYXNlUGF0aCgpLCBtb2R1bGUuZ2V0U2VydmljZXNEaXJlY3RvcnkoKSk7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFVpLWNvbmZpZy1nZW46OjogUHJvY2Vzczo6OiBtb2R1bGVTZXJ2aWNlc1BhdGg6IGAsIG1vZHVsZVNlcnZpY2VzUGF0aCk7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFVpLWNvbmZpZy1nZW46OjogUHJvY2Vzczo6OiByZXMtbW9kdWxlU2VydmljZXNQYXRoOiBgLCBwYXRoUmVzb2x2ZShtb2R1bGVTZXJ2aWNlc1BhdGgpKTtcbiAgICAgICAgICAgICAgICBzZXJ2aWNlRGlyZWN0b3JpZXMucHVzaChwYXRoUmVzb2x2ZShtb2R1bGVTZXJ2aWNlc1BhdGgpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBzZXJ2aWNlRGlyZWN0b3JpZXM7XG4gICAgfVxuXG4gICAgQExvZ0R1cmF0aW9uKClcbiAgICBhc3luYyBzY2FuQW5kTG9hZFNlcnZpY2VzKHNlcnZpY2VEaXJlY3RvcmllczogQXJyYXk8c3RyaW5nPikge1xuXG4gICAgICAgIGNvbnN0IHNjYW5uZWRTZXJ2aWNlcyA9IG5ldyBTZXQ8RnVuY3Rpb24+KCk7XG5cbiAgICAgICAgZm9yIChjb25zdCBkaXIgb2Ygc2VydmljZURpcmVjdG9yaWVzKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgVWktY29uZmlnLWdlbjo6OiBQcm9jZXNzOjo6IGxvYWRpbmcgc2VydmljZXMgZnJvbSBESVI6IGAsIGRpcik7XG4gICAgICAgICAgICBjb25zdCBkaXJTZXJ2aWNlVG9rZW5zID0gYXdhaXQgdGhpcy5zY2FuU2VydmljZXNGcm9tRGlyZWN0b3J5KGRpcik7XG4gICAgICAgICAgICBkaXJTZXJ2aWNlVG9rZW5zLmZvckVhY2godG9rZW4gPT4gc2Nhbm5lZFNlcnZpY2VzLmFkZCh0b2tlbikpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gZ2V0IGFsbCBjb250YWluZXIgcmVnaXN0ZXJlZCBzZXJ2aWNlcyB0byBtYWtlIHN1cmUgYXV0by1nZW4gZW50aXR5LXNlcnZpY2VzIGFyZSBhbHNvIGluY2x1ZGVkXG4gICAgICAgIHRoaXMudWlHZW5ESUNvbnRhaW5lci5jb2xsZWN0QmVzdFByb3ZpZGVyc0Zvcih7XG4gICAgICAgICAgICB0eXBlOiAnc2VydmljZScsXG4gICAgICAgICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzOiB0cnVlXG4gICAgICAgIH0pLmZpbHRlcihvcHQgPT4ge1xuICAgICAgICAgICAgLy8gbWFrZSBzdXJlIHRvIGNvbGxlY3Qgb25seSB0aGUgZW50aXR5IHNlcnZpY2UgcHJvdmlkZXJzXG4gICAgICAgICAgICByZXR1cm4gISFvcHQuX3Byb3ZpZGVyLmZvckVudGl0eVxuICAgICAgICB9KS5mb3JFYWNoKG9wdCA9PiB7XG4gICAgICAgICAgICBzY2FubmVkU2VydmljZXMuYWRkKG9wdC5fcHJvdmlkZXIucHJvdmlkZSBhcyBGdW5jdGlvbik7XG4gICAgICAgIH0pXG5cbiAgICAgICAgLy8gcmVzb2x2ZSBhbGwgc2VydmljZXNcbiAgICAgICAgY29uc3QgcmVzb2x2ZWRTZXJ2aWNlcyA9IG5ldyBNYXA8c3RyaW5nLCBCYXNlRW50aXR5U2VydmljZTxhbnk+PigpO1xuXG4gICAgICAgIHNjYW5uZWRTZXJ2aWNlcy5mb3JFYWNoKHRva2VuID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHNlcnZpY2UgPSB0aGlzLnVpR2VuRElDb250YWluZXIucmVzb2x2ZSh0b2tlbiwge1xuICAgICAgICAgICAgICAgIGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnM6IHRydWVcbiAgICAgICAgICAgIH0pIGFzIEJhc2VFbnRpdHlTZXJ2aWNlPGFueT47XG5cbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGByZXNvbHZlZCBzZXJ2aWNlIGZvciBlbnRpdHk6ICR7c2VydmljZS5nZXRFbnRpdHlOYW1lKCl9YCk7XG5cbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBVaS1jb25maWctZ2VuOjo6IFByb2Nlc3M6OjogbG9hZGVkIHNlcnZpY2VzIGZyb20gZW50aXR5OiBgLCBzZXJ2aWNlLmdldEVudGl0eU5hbWUoKSk7XG4gICAgICAgICAgICByZXNvbHZlZFNlcnZpY2VzLnNldChzZXJ2aWNlLmdldEVudGl0eU5hbWUoKSwgc2VydmljZSk7XG4gICAgICAgIH0pXG5cbiAgICAgICAgcmV0dXJuIHJlc29sdmVkU2VydmljZXM7XG4gICAgfVxuXG4gICAgQExvZ0R1cmF0aW9uKClcbiAgICBhc3luYyBzY2FuU2VydmljZXNGcm9tRGlyZWN0b3J5KHNlcnZpY2VzRGlyOiBzdHJpbmcpIHtcblxuICAgICAgICBjb25zdCBzY2FubmVkU2VydmljZXMgPSBuZXcgU2V0PEZ1bmN0aW9uPigpO1xuXG4gICAgICAgIGlmICghZXhpc3RzU3luYyhzZXJ2aWNlc0RpcikpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYHNjYW5TZXJ2aWNlc0Zyb21EaXJlY3Rvcnk6IHNlcnZpY2VzRGlyIGRvZXMgbm90IGV4aXN0czogJHtzZXJ2aWNlc0Rpcn1gKTtcbiAgICAgICAgICAgIHJldHVybiBzY2FubmVkU2VydmljZXM7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBzZXJ2aWNlUGF0aHMgPSBIZWxwZXIuc2NhbkNvbnRyb2xsZXJTb3VyY2VGaWxlc0Zyb20oc2VydmljZXNEaXIpO1xuXG4gICAgICAgIGZvciAoY29uc3Qgc2VydmljZVBhdGggb2Ygc2VydmljZVBhdGhzKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgdHJ5aW5nIHRvIGxvYWQgc2VydmljZVBhdGg6ICR7c2VydmljZVBhdGh9YCk7XG5cbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgLy8gRHluYW1pY2FsbHkgaW1wb3J0IHRoZSBzZXJ2aWNlIGZpbGVcbiAgICAgICAgICAgICAgICBjb25zdCBtb2R1bGUgPSBhd2FpdCBpbXBvcnQocGF0aEpvaW4oc2VydmljZXNEaXIsIHNlcnZpY2VQYXRoKSk7XG5cbiAgICAgICAgICAgICAgICAvLyBGaW5kIGFuZCBpbnN0YW50aWF0ZSBzZXJ2aWNlIGNsYXNzZXNcbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IGV4cG9ydGVkSXRlbSBvZiBPYmplY3QudmFsdWVzKG1vZHVsZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKFxuICAgICAgICAgICAgICAgICAgICAgICAgZXhwb3J0ZWRJdGVtXG4gICAgICAgICAgICAgICAgICAgICAgICAmJiB0eXBlb2YgZXhwb3J0ZWRJdGVtID09PSAnZnVuY3Rpb24nXG4gICAgICAgICAgICAgICAgICAgICAgICAmJiAncHJvdG90eXBlJyBpbiBleHBvcnRlZEl0ZW1cbiAgICAgICAgICAgICAgICAgICAgICAgICYmIGV4cG9ydGVkSXRlbS5wcm90b3R5cGUgaW5zdGFuY2VvZiBCYXNlRW50aXR5U2VydmljZVxuICAgICAgICAgICAgICAgICAgICApIHtcblxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMudWlHZW5ESUNvbnRhaW5lci5oYXMoZXhwb3J0ZWRJdGVtLCB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3NlcnZpY2UnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnM6IHRydWVcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc2Nhbm5lZFNlcnZpY2VzLmFkZChleHBvcnRlZEl0ZW0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBzY2FuU2VydmljZXNGcm9tRGlyZWN0b3J5OiByZWdpc3RlcmluZyBzZXJ2aWNlOiAke2V4cG9ydGVkSXRlbS5uYW1lfWApO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1Zyhgc2NhblNlcnZpY2VzRnJvbURpcmVjdG9yeTogbm8gcHJvdmlkZXIgY291bGQgYmUgZm91bmQgZm9yIHNlcnZpY2U6ICR7ZXhwb3J0ZWRJdGVtLm5hbWV9YCk7XG5cbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcblxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYHNjYW5TZXJ2aWNlc0Zyb21EaXJlY3Rvcnk6IFNLSVA6IGV4cG9ydGVkSXRlbSBpcyBub3QgYSBzZXJ2aWNlIGNsYXNzOiAkeyhleHBvcnRlZEl0ZW0gYXMgYW55KT8ubmFtZSA/IChleHBvcnRlZEl0ZW0gYXMgYW55KS5uYW1lIDogZXhwb3J0ZWRJdGVtfWApO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKGBzY2FuU2VydmljZXNGcm9tRGlyZWN0b3J5OiBFeGNlcHRpb24gd2hpbGUgdHJ5aW5nIHRvIGxvYWQgc2VydmljZVBhdGg6ICR7c2VydmljZVBhdGh9YCwgZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gc2Nhbm5lZFNlcnZpY2VzO1xuICAgIH1cblxuICAgIEBMb2dEdXJhdGlvbigpXG4gICAgYXN5bmMgd3JpdGVUb0ZpbGVzKG1lbnVDb25maWc6IGFueSwgZW50aXRpZXNDb25maWc6IGFueSwgYXV0aENvbmZpZzogYW55LCBkYXNoYm9hcmRDb25maWc6IGFueSkge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkNhbGxlZCB3cml0ZVRvRmlsZXM6Ojo6OjogXCIpO1xuICAgICAgICBjb25zdCBnZW5EaXJlY3RvcnlQYXRoID0gcGF0aFJlc29sdmUoJy4vZ2VuLycpO1xuICAgICAgICBpZiAoIWV4aXN0c1N5bmMoZ2VuRGlyZWN0b3J5UGF0aCkpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBHZW4gRElSIGRvZXMgbm90IGV4aXN0cywgY3JlYXRpbmc6ICR7Z2VuRGlyZWN0b3J5UGF0aH1gLCk7XG4gICAgICAgICAgICBta2RpclN5bmMoZ2VuRGlyZWN0b3J5UGF0aCk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBjb25maWdEaXJlY3RvcnlQYXRoID0gcGF0aFJlc29sdmUocGF0aEpvaW4oZ2VuRGlyZWN0b3J5UGF0aCwgJ2NvbmZpZycpKTtcbiAgICAgICAgaWYgKCFleGlzdHNTeW5jKGNvbmZpZ0RpcmVjdG9yeVBhdGgpKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQ29uZmlnIERJUiBkb2VzIG5vdCBleGlzdHMsIGNyZWF0aW5nOiAke2NvbmZpZ0RpcmVjdG9yeVBhdGh9YCk7XG4gICAgICAgICAgICBta2RpclN5bmMoY29uZmlnRGlyZWN0b3J5UGF0aCk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBtZW51Q29uZmlnRmlsZVBhdGggPSBwYXRoSm9pbihjb25maWdEaXJlY3RvcnlQYXRoLCAnbWVudS5qc29uJyk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGB3cml0aW5nIG1lbnUtY29uZmlnLi4gaW50bzogJHttZW51Q29uZmlnRmlsZVBhdGh9YCk7XG4gICAgICAgIHdyaXRlRmlsZVN5bmMobWVudUNvbmZpZ0ZpbGVQYXRoLCBKU09OLnN0cmluZ2lmeShtZW51Q29uZmlnLCBudWxsLCAyKSk7XG5cbiAgICAgICAgY29uc3QgZW50aXRpZXNDb25maWdGaWxlUGF0aCA9IHBhdGhKb2luKGNvbmZpZ0RpcmVjdG9yeVBhdGgsICdlbnRpdGllcy5qc29uJyk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGB3cml0aW5nIGVudGl0aWVzLWNvbmZpZy4uIGludG86ICR7ZW50aXRpZXNDb25maWdGaWxlUGF0aH1gLCk7XG4gICAgICAgIHdyaXRlRmlsZVN5bmMoZW50aXRpZXNDb25maWdGaWxlUGF0aCwgSlNPTi5zdHJpbmdpZnkoZW50aXRpZXNDb25maWcsIG51bGwsIDIpKTtcblxuICAgICAgICBjb25zdCBhdXRoQ29uZmlnRmlsZVBhdGggPSBwYXRoSm9pbihjb25maWdEaXJlY3RvcnlQYXRoLCAnYXV0aC5qc29uJyk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGB3cml0aW5nIGF1dGgtY29uZmlnLi4gaW50bzogJHthdXRoQ29uZmlnRmlsZVBhdGh9YCwpO1xuICAgICAgICB3cml0ZUZpbGVTeW5jKGF1dGhDb25maWdGaWxlUGF0aCwgSlNPTi5zdHJpbmdpZnkoYXV0aENvbmZpZywgbnVsbCwgMikpO1xuXG4gICAgICAgIGNvbnN0IGRhc2hib2FyZENvbmZpZ0ZpbGVQYXRoID0gcGF0aEpvaW4oY29uZmlnRGlyZWN0b3J5UGF0aCwgJ2Rhc2hib2FyZC5qc29uJyk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGB3cml0aW5nIGRhc2hib2FyZC1jb25maWcuLiBpbnRvOiAke2Rhc2hib2FyZENvbmZpZ0ZpbGVQYXRofWAsKTtcbiAgICAgICAgd3JpdGVGaWxlU3luYyhkYXNoYm9hcmRDb25maWdGaWxlUGF0aCwgSlNPTi5zdHJpbmdpZnkoZGFzaGJvYXJkQ29uZmlnLCBudWxsLCAyKSk7XG5cbiAgICB9XG59XG5cbiJdfQ==