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
                    // Legacy sort fallback (tableConfig.defaultSort is handled directly in list-entity.ts)
                    defaultSort: entitySchema.model.listPageConfig?.defaultSort ?? entitySchema.model.listPageDefaultSort,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW50aXR5LXVpLWNvbmZpZy5nZW4uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdWktY29uZmlnLWdlbi9lbnRpdHktdWktY29uZmlnLmdlbi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFDQSw4RUFBK0Q7QUFDL0QsOEVBQStEO0FBQy9ELDBFQUEyRDtBQUMzRCwwRUFBMkQ7QUFDM0QsMEVBQTJEO0FBQzNELHNDQUE0RDtBQUM1RCx5REFBMEo7QUFFMUosNERBQThDO0FBQzlDLHNFQUF3RDtBQUV4RCwyQkFBMEQ7QUFDMUQsK0JBR2M7QUFFZCx1Q0FBb0M7QUFDcEMsMkNBQXdDO0FBQ3hDLHdDQUF1RDtBQUN2RCwwQ0FBd0M7QUFFeEMsTUFBYSxpQkFBaUI7SUFDakIsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxpQkFBaUIsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUN2RCw4RkFBOEY7SUFDOUYsbUNBQW1DO0lBQzFCLGdCQUFnQixHQUFHLFdBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO0lBRWxELFdBQVcsR0FBbUMsSUFBSSxHQUFHLEVBQUUsQ0FBQztJQUduRSxBQUFOLEtBQUssQ0FBQyxlQUFlO1FBQ2pCLE1BQU0sSUFBSSxHQUFHLFdBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztRQUNoQyxNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUM7UUFDaEMsTUFBTSxjQUFjLEdBQUcsTUFBTSxDQUFDLGtCQUFrQixFQUFFLG9CQUFvQixJQUFJLGNBQWMsQ0FBQztRQUV6RixNQUFNLHNCQUFzQixHQUFHLENBQUUsSUFBQSxjQUFXLEVBQUMsU0FBUyxjQUFjLEdBQUcsQ0FBQyxDQUFFLENBQUM7UUFFM0UsSUFBSSxJQUFJLENBQUMsVUFBVSxFQUFFLEVBQUUsQ0FBQztZQUNwQixLQUFLLE1BQU0s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OzREQXFDYjtBQUdLO0lBREwsSUFBQSxxQkFBVyxHQUFFO2tFQWtEYjtBQUdLO0lBREwsSUFBQSxxQkFBVyxHQUFFO3FEQStCYiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IHR5cGUgfSBmcm9tICdvcyc7XG5pbXBvcnQgTWFrZUNyZWF0ZUVudGl0eUNvbmZpZyBmcm9tICcuL3RlbXBsYXRlcy9jcmVhdGUtZW50aXR5JztcbmltcG9ydCBNYWtlVXBkYXRlRW50aXR5Q29uZmlnIGZyb20gJy4vdGVtcGxhdGVzL3VwZGF0ZS1lbnRpdHknO1xuaW1wb3J0IE1ha2VMaXN0RW50aXR5Q29uZmlnIGZyb20gJy4vdGVtcGxhdGVzL2xpc3QtZW50aXR5JztcbmltcG9ydCBNYWtlVmlld0VudGl0eUNvbmZpZyBmcm9tICcuL3RlbXBsYXRlcy92aWV3LWVudGl0eSc7XG5pbXBvcnQgTWFrZUVudGl0eU1lbnVDb25maWcgZnJvbSAnLi90ZW1wbGF0ZXMvZW50aXR5LW1lbnUnO1xuaW1wb3J0IHsgQmFzZUVudGl0eVNlcnZpY2UsIEVudGl0eVNjaGVtYSB9IGZyb20gJy4uL2VudGl0eSc7XG5pbXBvcnQgeyBtYWtlQ3VzdG9tUGFnZUNvbmZpZywgQ3VzdG9tUGFnZU9wdGlvbnMsIExpc3RQYWdlQ29uZmlnLCBGb3JtUGFnZUNvbmZpZywgRGV0YWlsc1BhZ2VDb25maWcsIERhc2hib2FyZFBhZ2VDb25maWcgfSBmcm9tICcuL3RlbXBsYXRlcy9jdXN0b20tcGFnZSc7XG5cbmltcG9ydCBNYWtlQXV0aENvbmZpZyBmcm9tICcuL3RlbXBsYXRlcy9hdXRoJztcbmltcG9ydCBNYWtlRGFzaGJvYXJkQ29uZmlnIGZyb20gJy4vdGVtcGxhdGVzL2Rhc2hib2FyZCc7XG5cbmltcG9ydCB7IGV4aXN0c1N5bmMsIG1rZGlyU3luYywgd3JpdGVGaWxlU3luYyB9IGZyb20gXCJmc1wiO1xuaW1wb3J0IHtcbiAgICByZXNvbHZlIGFzIHBhdGhSZXNvbHZlLFxuICAgIGpvaW4gYXMgcGF0aEpvaW5cbn0gZnJvbSBcInBhdGhcIjtcblxuaW1wb3J0IHsgRncyNCB9IGZyb20gJy4uL2NvcmUvZncyNCc7XG5pbXBvcnQgeyBIZWxwZXIgfSBmcm9tICcuLi9jb3JlL2hlbHBlcic7XG5pbXBvcnQgeyBMb2dEdXJhdGlvbiwgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi4vbG9nZ2luZyc7XG5pbXBvcnQgeyB0b1NsdWcgfSBmcm9tICcuLi91dGlscy9jYXNlcyc7XG5cbmV4cG9ydCBjbGFzcyBFbnRpdHlVSUNvbmZpZ0dlbiB7XG4gICAgcmVhZG9ubHkgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKEVudGl0eVVJQ29uZmlnR2VuLm5hbWUpO1xuICAgIC8vIG1ha2Ugc3VyZSB0byBjcmVhdGUgYSBjaGlsZCBjb250YWluZXIgdG8gbm90IHBvbGx1dGUgYW55dGhpbmcgaW4gdGhlIEFwcGxpY2F0aW9uIGNvbnRhaW5lciBcbiAgICAvLyB3aGlsZSBzY2FubmluZyBhbmQgbG9hZGluZyBzdHVmZlxuICAgIHJlYWRvbmx5IHVpR2VuRElDb250YWluZXIgPSBGdzI0LmdldEluc3RhbmNlKCkuZ2V0QXBwRElDb250YWluZXIoKTtcblxuICAgIHByaXZhdGUgcmVhZG9ubHkgY3VzdG9tUGFnZXM6IE1hcDxzdHJpbmcsIEN1c3RvbVBhZ2VPcHRpb25zPiA9IG5ldyBNYXAoKTtcblxuICAgIEBMb2dEdXJhdGlvbigpXG4gICAgYXN5bmMgc2NhbkN1c3RvbVBhZ2VzKCkge1xuICAgICAgICBjb25zdCBmdzI0ID0gRncyNC5nZXRJbnN0YW5jZSgpO1xuICAgICAgICBjb25zdCBjb25maWcgPSBmdzI0LmdldENvbmZpZygpO1xuICAgICAgICBjb25zdCBjdXN0b21QYWdlc0RpciA9IGNvbmZpZy51aUNvbmZpZ0dlbk9wdGlvbnM/LmN1c3RvbVBhZ2VzRGlyZWN0b3J5IHx8ICdjdXN0b20tcGFnZXMnO1xuXG4gICAgICAgIGNvbnN0IGN1c3RvbVBhZ2VzRGlyZWN0b3JpZXMgPSBbIHBhdGhSZXNvbHZlKGAuL3NyYy8ke2N1c3RvbVBhZ2VzRGlyfS9gKSBdO1xuXG4gICAgICAgIGlmIChmdzI0Lmhhc01vZHVsZXMoKSkge1xuICAgICAgICAgICAgZm9yIChjb25zdCBbICwgbW9kdWxlIF0gb2YgZncyNC5nZXRNb2R1bGVzKCkpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBtb2R1bGVDdXN0b21QYWdlc1BhdGggPSBwYXRoSm9pbihtb2R1bGUuZ2V0QmFzZVBhdGgoKSwgY3VzdG9tUGFnZXNEaXIpO1xuICAgICAgICAgICAgICAgIGN1c3RvbVBhZ2VzRGlyZWN0b3JpZXMucHVzaChwYXRoUmVzb2x2ZShtb2R1bGVDdXN0b21QYWdlc1BhdGgpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHJlZ2lzdGVyZWRQYWdlczogc3RyaW5nW10gPSBbXTtcblxuICAgICAgICBmb3IgKGNvbnN0IGRpciBvZiBjdXN0b21QYWdlc0RpcmVjdG9yaWVzKSB7XG4gICAgICAgICAgICBpZiAoIWV4aXN0c1N5bmMoZGlyKSkge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDdXN0b20gcGFnZXMgZGlyZWN0b3J5IGRvZXMgbm90IGV4aXN0OiAke2Rpcn1gKTtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgY3VzdG9tUGFnZUZpbGVzID0gSGVscGVyLnNjYW5Db250cm9sbGVyU291cmNlRmlsZXNGcm9tKGRpcik7XG5cbiAgICAgICAgICAgIGZvciAoY29uc3QgZmlsZSBvZiBjdXN0b21QYWdlRmlsZXMpIHtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBtb2R1bGUgPSBhd2FpdCBpbXBvcnQocGF0aEpvaW4oZGlyLCBmaWxlKSk7XG4gICAgICAgICAgICAgICAgICAgIGZvciAoY29uc3QgWyBfLCB2YWx1ZSBdIG9mIE9iamVjdC5lbnRyaWVzKG1vZHVsZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLmlzVmFsaWRDdXN0b21QYWdlQ29uZmlnKHZhbHVlKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHBhZ2VOYW1lID0gdGhpcy5nZXRQYWdlTmFtZUZyb21Db25maWcodmFsdWUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChwYWdlTmFtZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnJlZ2lzdGVyQ3VzdG9tUGFnZSh2YWx1ZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlZ2lzdGVyZWRQYWdlcy5wdXNoKHBhZ2VOYW1lKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFJlZ2lzdGVyZWQgY3VzdG9tIHBhZ2U6ICR7cGFnZU5hbWV9YCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgRXJyb3IgbG9hZGluZyBjdXN0b20gcGFnZSBmcm9tICR7ZmlsZX06YCwgZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHJlZ2lzdGVyZWRQYWdlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGDinIUgUmVnaXN0ZXJlZCAke3JlZ2lzdGVyZWRQYWdlcy5sZW5ndGh9IGN1c3RvbSBwYWdlKHMpOiAke3JlZ2lzdGVyZWRQYWdlcy5zbGljZSgwLCA1KS5qb2luKCcsICcpfSR7cmVnaXN0ZXJlZFBhZ2VzLmxlbmd0aCA+IDUgPyBgLCArJHtyZWdpc3RlcmVkUGFnZXMubGVuZ3RoIC0gNX0gbW9yZWAgOiAnJ31gKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHB1YmxpYyBpc1ZhbGlkQ3VzdG9tUGFnZUNvbmZpZyh2YWx1ZTogdW5rbm93bik6IHZhbHVlIGlzIEN1c3RvbVBhZ2VPcHRpb25zIHtcbiAgICAgICAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XG5cbiAgICAgICAgY29uc3QgY29uZmlnID0gdmFsdWUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgICAgIGlmICghKCdwYWdlVHlwZScgaW4gY29uZmlnKSB8fCAhKCdwYWdlVGl0bGUnIGluIGNvbmZpZykpIHJldHVybiBmYWxzZTtcblxuICAgICAgICBjb25zdCBwYWdlVHlwZSA9IGNvbmZpZy5wYWdlVHlwZTtcbiAgICAgICAgaWYgKHBhZ2VUeXBlID09PSAnbGlzdCcpIHtcbiAgICAgICAgICAgIHJldHVybiAnbGlzdFBhZ2VDb25maWcnIGluIGNvbmZpZztcbiAgICAgICAgfSBlbHNlIGlmIChwYWdlVHlwZSA9PT0gJ2Zvcm0nKSB7XG4gICAgICAgICAgICByZXR1cm4gJ2Zvcm1QYWdlQ29uZmlnJyBpbiBjb25maWc7XG4gICAgICAgIH0gZWxzZSBpZiAocGFnZVR5cGUgPT09ICdkZXRhaWxzJykge1xuICAgICAgICAgICAgcmV0dXJuICdkZXRhaWxzUGFnZUNvbmZpZycgaW4gY29uZmlnO1xuICAgICAgICB9IGVsc2UgaWYgKHBhZ2VUeXBlID09PSAnZGFzaGJvYXJkJykge1xuICAgICAgICAgICAgcmV0dXJuICdkYXNoYm9hcmRQYWdlQ29uZmlnJyBpbiBjb25maWc7XG4gICAgICAgIH0gZWxzZSBpZiAocGFnZVR5cGUgPT09ICdhY2NvcmRpb24nKSB7XG4gICAgICAgICAgICByZXR1cm4gJ2FjY29yZGlvblBhZ2VDb25maWcnIGluIGNvbmZpZztcbiAgICAgICAgfSBlbHNlIGlmIChwYWdlVHlwZSA9PT0gJ21lbnUnKSB7XG4gICAgICAgICAgICByZXR1cm4gJ21lbnVQYWdlQ29uZmlnJyBpbiBjb25maWc7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIHByaXZhdGUgZ2V0UGFnZU5hbWVGcm9tQ29uZmlnKGNvbmZpZzogQ3VzdG9tUGFnZU9wdGlvbnMpOiBzdHJpbmcgfCBudWxsIHtcbiAgICAgICAgaWYgKGNvbmZpZy5wYWdlTmFtZSkge1xuICAgICAgICAgICAgcmV0dXJuIHRvU2x1Zyhjb25maWcucGFnZU5hbWUpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRm9yIHRlbXBsYXRlLWJhc2VkIHBhZ2UgdGl0bGVzIChvYmplY3RzKSwgcGFnZU5hbWUgTVVTVCBiZSBwcm92aWRlZFxuICAgICAgICAvLyBFeHRyYWN0IHN0cmluZyBmcm9tIHBhZ2VUaXRsZSAoaGFuZGxlcyBib3RoIHN0cmluZyBhbmQgVGVtcGxhdGUgdHlwZXMpXG4gICAgICAgIGNvbnN0IHBhZ2VUaXRsZVN0cmluZyA9IHR5cGVvZiBjb25maWcucGFnZVRpdGxlID09PSAnc3RyaW5nJ1xuICAgICAgICAgICAgPyBjb25maWcucGFnZVRpdGxlXG4gICAgICAgICAgICA6ICdjdXN0b20tcGFnZSc7IC8vIEZhbGxiYWNrIGZvciBUZW1wbGF0ZSBvYmplY3RzXG5cbiAgICAgICAgc3dpdGNoIChjb25maWcucGFnZVR5cGUpIHtcbiAgICAgICAgICAgIGNhc2UgJ2xpc3QnOlxuICAgICAgICAgICAgICAgIHJldHVybiBgbGlzdC0ke3RvU2x1ZyhwYWdlVGl0bGVTdHJpbmcpfWA7XG4gICAgICAgICAgICBjYXNlICdmb3JtJzpcbiAgICAgICAgICAgICAgICByZXR1cm4gcGFnZVRpdGxlU3RyaW5nLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoJ2FkZCcpXG4gICAgICAgICAgICAgICAgICAgID8gYGNyZWF0ZS0ke3RvU2x1ZyhwYWdlVGl0bGVTdHJpbmcpfWBcbiAgICAgICAgICAgICAgICAgICAgOiBgZWRpdC0ke3RvU2x1ZyhwYWdlVGl0bGVTdHJpbmcpfWA7XG4gICAgICAgICAgICBjYXNlICdkZXRhaWxzJzpcbiAgICAgICAgICAgICAgICByZXR1cm4gYHZpZXctJHt0b1NsdWcocGFnZVRpdGxlU3RyaW5nKX1gO1xuICAgICAgICAgICAgY2FzZSAnZGFzaGJvYXJkJzpcbiAgICAgICAgICAgICAgICByZXR1cm4gYCR7dG9TbHVnKHBhZ2VUaXRsZVN0cmluZyl9YDtcbiAgICAgICAgICAgIGNhc2UgJ2FjY29yZGlvbic6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGBhY2NvcmRpb24tJHt0b1NsdWcocGFnZVRpdGxlU3RyaW5nKX1gO1xuICAgICAgICAgICAgY2FzZSAnbWVudSc6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGAke3RvU2x1ZyhwYWdlVGl0bGVTdHJpbmcpfWA7XG4gICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUmVnaXN0ZXIgYSBjdXN0b20gcGFnZS4gU3VwcG9ydHMgb3B0aW9uYWwgcm91dGVQYXR0ZXJuIGZvciBkeW5hbWljIHJvdXRlcyAoZS5nLiwgL2F1dGhvci86YXV0aG9ySWQvYm9va3MpXG4gICAgICovXG4gICAgcHVibGljIHJlZ2lzdGVyQ3VzdG9tUGFnZShvcHRpb25zOiBDdXN0b21QYWdlT3B0aW9ucykge1xuICAgICAgICBjb25zdCBwYWdlTmFtZSA9IHRoaXMuZ2V0UGFnZU5hbWVGcm9tQ29uZmlnKG9wdGlvbnMpO1xuICAgICAgICBpZiAocGFnZU5hbWUpIHtcbiAgICAgICAgICAgIHRoaXMuY3VzdG9tUGFnZXMuc2V0KHBhZ2VOYW1lLCBvcHRpb25zKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGFzeW5jIHJ1bigpIHtcbiAgICAgICAgdGhpcy5wcm9jZXNzKCk7XG4gICAgfVxuXG4gICAgQExvZ0R1cmF0aW9uKClcbiAgICBhc3luYyBwcm9jZXNzKCkge1xuICAgICAgICBjb25zdCBtZW51Q29uZmlnczogYW55W10gPSBbXTtcbiAgICAgICAgY29uc3QgZW50aXR5Q29uZmlnczogYW55ID0ge307XG5cbiAgICAgICAgY29uc3Qgc2VydmljZURpcmVjdG9yaWVzID0gdGhpcy5wcmVwYXJlU2VydmljZXNEaXJlY3RvcmllcygpO1xuXG4gICAgICAgIGNvbnN0IHNlcnZpY2VzID0gYXdhaXQgdGhpcy5zY2FuQW5kTG9hZFNlcnZpY2VzKHNlcnZpY2VEaXJlY3Rvcmllcyk7XG5cbiAgICAgICAgLy8gU2NhbiBhbmQgbG9hZCBjdXN0b20gcGFnZXNcbiAgICAgICAgYXdhaXQgdGhpcy5zY2FuQ3VzdG9tUGFnZXMoKTtcblxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgVWktY29uZmlnLWdlbjo6OiBQcm9jZXNzOjo6IGFsbC1zZXJ2aWNlczogYCwgQXJyYXkuZnJvbShzZXJ2aWNlcy5rZXlzKCkpKTtcblxuICAgICAgICAvLyBHZXQgZ2xvYmFsIFVJIGNvbmZpZyBvcHRpb25zIChpbmNsdWRpbmcgZHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uKVxuICAgICAgICBjb25zdCBnbG9iYWxVSUNvbmZpZ09wdGlvbnMgPSBGdzI0LmdldEluc3RhbmNlKCkuZ2V0Q29uZmlnKCkudWlDb25maWdHZW5PcHRpb25zO1xuXG4gICAgICAgIGxldCBtZW51SW5kZXggPSAxO1xuICAgICAgICAvLyBnZW5lcmF0ZSBVSSBjb25maWdzXG4gICAgICAgIHNlcnZpY2VzLmZvckVhY2goKHNlcnZpY2UsIGVudGl0eU5hbWUpID0+IHtcblxuICAgICAgICAgICAgbGV0IGVudGl0eVNjaGVtYSA9IHNlcnZpY2UuZ2V0RW50aXR5U2NoZW1hKCkgYXMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+O1xuXG4gICAgICAgICAgICAvLyBDaGVjayBmb3IgZGVwcmVjYXRlZCB1c2FnZSBhbmQgd2FyblxuICAgICAgICAgICAgdGhpcy5jaGVja0RlcHJlY2F0ZWRVc2FnZShlbnRpdHlTY2hlbWEpO1xuXG4gICAgICAgICAgICAvLyBUcmFuc2Zvcm0gbGVnYWN5IGNvbmZpZyBzdHJ1Y3R1cmUgdG8gbmV3IG5lc3RlZCBzdHJ1Y3R1cmUgaWYgbmVlZGVkXG4gICAgICAgICAgICBlbnRpdHlTY2hlbWEgPSB0aGlzLnRyYW5zZm9ybUxlZ2FjeUNvbmZpZyhlbnRpdHlTY2hlbWEpO1xuICAgICAgICAgICAgY29uc3QgZW50aXR5RGVmYXVsdE9wc1NjaGVtYSA9IHNlcnZpY2UuZ2V0T3BzRGVmYXVsdElPU2NoZW1hKCk7XG5cbiAgICAgICAgICAgIGlmICghZW50aXR5U2NoZW1hLm1vZGVsLmV4Y2x1ZGVGcm9tQWRtaW5DcmVhdGUpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBjcmVhdGVDb25maWcgPSBNYWtlQ3JlYXRlRW50aXR5Q29uZmlnKHtcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZVBsdXJhbDogZW50aXR5U2NoZW1hLm1vZGVsLmVudGl0eU5hbWVQbHVyYWwsXG4gICAgICAgICAgICAgICAgICAgIENSVURBcGlQYXRoOiBlbnRpdHlTY2hlbWEubW9kZWwuQ1JVREFwaVBhdGgsXG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IGVudGl0eURlZmF1bHRPcHNTY2hlbWEuY3JlYXRlLmlucHV0LFxuICAgICAgICAgICAgICAgICAgICAvLyBVc2UgbmV3IG5lc3RlZCBjb25maWcgaWYgYXZhaWxhYmxlLCBmYWxsYmFjayB0byBvbGRcbiAgICAgICAgICAgICAgICAgICAgYnJlYWRjcnVtYnM6IGVudGl0eVNjaGVtYS5tb2RlbC5jcmVhdGVQYWdlQ29uZmlnPy5icmVhZGNydW1icyB8fCBlbnRpdHlTY2hlbWEubW9kZWwuY3JlYXRlUGFnZUJyZWFkY3J1bWJzLFxuICAgICAgICAgICAgICAgICAgICBjb2x1bW5zQ29uZmlnOiBlbnRpdHlTY2hlbWEubW9kZWwuY3JlYXRlUGFnZUNvbmZpZz8uY29sdW1uc0NvbmZpZyB8fCBlbnRpdHlTY2hlbWEubW9kZWwuY3JlYXRlUGFnZUNvbHVtbnNDb25maWcsXG4gICAgICAgICAgICAgICAgICAgIGZvcm1Db25maWc6IGVudGl0eVNjaGVtYS5tb2RlbC5jcmVhdGVQYWdlQ29uZmlnPy5mb3JtQ29uZmlnLFxuICAgICAgICAgICAgICAgIH0sIHNlcnZpY2UpO1xuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ3NbIGBjcmVhdGUtJHtlbnRpdHlOYW1lLnRvTG93ZXJDYXNlKCl9YCBdID0gY3JlYXRlQ29uZmlnO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoIWVudGl0eVNjaGVtYS5tb2RlbC5leGNsdWRlRnJvbUFkbWluVXBkYXRlKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgdXBkYXRlQ29uZmlnID0gTWFrZVVwZGF0ZUVudGl0eUNvbmZpZyh7XG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWVQbHVyYWw6IGVudGl0eVNjaGVtYS5tb2RlbC5lbnRpdHlOYW1lUGx1cmFsLFxuICAgICAgICAgICAgICAgICAgICBDUlVEQXBpUGF0aDogZW50aXR5U2NoZW1hLm1vZGVsLkNSVURBcGlQYXRoLFxuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiBlbnRpdHlEZWZhdWx0T3BzU2NoZW1hLnVwZGF0ZS5pbnB1dCxcbiAgICAgICAgICAgICAgICAgICAgLy8gVXNlIG5ldyBuZXN0ZWQgY29uZmlnIGlmIGF2YWlsYWJsZSwgZmFsbGJhY2sgdG8gb2xkXG4gICAgICAgICAgICAgICAgICAgIGFjdGlvbnM6IGVudGl0eVNjaGVtYS5tb2RlbC5lZGl0UGFnZUNvbmZpZz8uYWN0aW9ucyB8fCBlbnRpdHlTY2hlbWEubW9kZWwuZWRpdFBhZ2VBY3Rpb25zLFxuICAgICAgICAgICAgICAgICAgICBicmVhZGNydW1iczogZW50aXR5U2NoZW1hLm1vZGVsLmVkaXRQYWdlQ29uZmlnPy5icmVhZGNydW1icyB8fCBlbnRpdHlTY2hlbWEubW9kZWwuZWRpdFBhZ2VCcmVhZGNydW1icyxcbiAgICAgICAgICAgICAgICAgICAgY29sdW1uc0NvbmZpZzogZW50aXR5U2NoZW1hLm1vZGVsLmVkaXRQYWdlQ29uZmlnPy5jb2x1bW5zQ29uZmlnIHx8IGVudGl0eVNjaGVtYS5tb2RlbC5lZGl0UGFnZUNvbHVtbnNDb25maWcsXG4gICAgICAgICAgICAgICAgICAgIGZvcm1Db25maWc6IGVudGl0eVNjaGVtYS5tb2RlbC5lZGl0UGFnZUNvbmZpZz8uZm9ybUNvbmZpZyxcbiAgICAgICAgICAgICAgICB9LCBzZXJ2aWNlKTtcbiAgICAgICAgICAgICAgICBlbnRpdHlDb25maWdzWyBgZWRpdC0ke2VudGl0eU5hbWUudG9Mb3dlckNhc2UoKX1gIF0gPSB1cGRhdGVDb25maWc7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICghZW50aXR5U2NoZW1hLm1vZGVsLmV4Y2x1ZGVGcm9tQWRtaW5MaXN0KSB7XG4gICAgICAgICAgICAgICAgY29uc3QgbGlzdENvbmZpZyA9IE1ha2VMaXN0RW50aXR5Q29uZmlnKHtcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZVBsdXJhbDogZW50aXR5U2NoZW1hLm1vZGVsLmVudGl0eU5hbWVQbHVyYWwsXG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IGVudGl0eURlZmF1bHRPcHNTY2hlbWEubGlzdC5vdXRwdXQsXG4gICAgICAgICAgICAgICAgICAgIENSVURBcGlQYXRoOiBlbnRpdHlTY2hlbWEubW9kZWwuQ1JVREFwaVBhdGgsXG4gICAgICAgICAgICAgICAgICAgIHVzZVNlYXJjaDogQm9vbGVhbihlbnRpdHlTY2hlbWEubW9kZWwuc2VhcmNoPy5lbmFibGVkKSxcbiAgICAgICAgICAgICAgICAgICAgZXhjbHVkZUZyb21BZG1pbkNyZWF0ZTogZW50aXR5U2NoZW1hLm1vZGVsLmV4Y2x1ZGVGcm9tQWRtaW5DcmVhdGUsXG4gICAgICAgICAgICAgICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5VcGRhdGU6IGVudGl0eVNjaGVtYS5tb2RlbC5leGNsdWRlRnJvbUFkbWluVXBkYXRlLFxuICAgICAgICAgICAgICAgICAgICBleGNsdWRlRnJvbUFkbWluRGVsZXRlOiBlbnRpdHlTY2hlbWEubW9kZWwuZXhjbHVkZUZyb21BZG1pbkRlbGV0ZSxcbiAgICAgICAgICAgICAgICAgICAgZXhjbHVkZUZyb21BZG1pbkRldGFpbDogZW50aXR5U2NoZW1hLm1vZGVsLmV4Y2x1ZGVGcm9tQWRtaW5EZXRhaWwsXG4gICAgICAgICAgICAgICAgICAgIC8vIFVzZSBuZXcgbmVzdGVkIGNvbmZpZyBpZiBhdmFpbGFibGUsIGZhbGxiYWNrIHRvIG9sZFxuICAgICAgICAgICAgICAgICAgICBwYWdlSGVhZGVyQWN0aW9uczogZW50aXR5U2NoZW1hLm1vZGVsLmxpc3RQYWdlQ29uZmlnPy5hY3Rpb25zIHx8IGVudGl0eVNjaGVtYS5tb2RlbC5saXN0UGFnZUFjdGlvbnMsXG4gICAgICAgICAgICAgICAgICAgIGJyZWFkY3J1bWJzOiBlbnRpdHlTY2hlbWEubW9kZWwubGlzdFBhZ2VDb25maWc/LmJyZWFkY3J1bWJzIHx8IGVudGl0eVNjaGVtYS5tb2RlbC5saXN0UGFnZUJyZWFkY3J1bWJzLFxuICAgICAgICAgICAgICAgICAgICAvLyBMZWdhY3kgc29ydCBmYWxsYmFjayAodGFibGVDb25maWcuZGVmYXVsdFNvcnQgaXMgaGFuZGxlZCBkaXJlY3RseSBpbiBsaXN0LWVudGl0eS50cylcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdFNvcnQ6IGVudGl0eVNjaGVtYS5tb2RlbC5saXN0UGFnZUNvbmZpZz8uZGVmYXVsdFNvcnQgPz8gZW50aXR5U2NoZW1hLm1vZGVsLmxpc3RQYWdlRGVmYXVsdFNvcnQsXG4gICAgICAgICAgICAgICAgICAgIHRhYmxlQ29uZmlnOiBlbnRpdHlTY2hlbWEubW9kZWwubGlzdFBhZ2VDb25maWc/LnRhYmxlQ29uZmlnLFxuICAgICAgICAgICAgICAgICAgICBnbG9iYWxVSUNvbmZpZ09wdGlvbnMsICAvLyBORVc6IFBhc3MgZ2xvYmFsIGNvbmZpZ1xuICAgICAgICAgICAgICAgIH0sIHNlcnZpY2UpO1xuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ3NbIGBsaXN0LSR7ZW50aXR5TmFtZS50b0xvd2VyQ2FzZSgpfWAgXSA9IGxpc3RDb25maWc7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICghZW50aXR5U2NoZW1hLm1vZGVsLmV4Y2x1ZGVGcm9tQWRtaW5EZXRhaWwpIHtcbiAgICAgICAgICAgICAgICBjb25zdCB2aWV3Q29uZmlnID0gTWFrZVZpZXdFbnRpdHlDb25maWcoe1xuICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lUGx1cmFsOiBlbnRpdHlTY2hlbWEubW9kZWwuZW50aXR5TmFtZVBsdXJhbCxcbiAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllczogZW50aXR5RGVmYXVsdE9wc1NjaGVtYS5nZXQub3V0cHV0LFxuICAgICAgICAgICAgICAgICAgICBDUlVEQXBpUGF0aDogZW50aXR5U2NoZW1hLm1vZGVsLkNSVURBcGlQYXRoLFxuICAgICAgICAgICAgICAgICAgICAvLyBVc2UgbmV3IG5lc3RlZCBjb25maWcgaWYgYXZhaWxhYmxlLCBmYWxsYmFjayB0byBvbGRcbiAgICAgICAgICAgICAgICAgICAgYWN0aW9uczogZW50aXR5U2NoZW1hLm1vZGVsLnZpZXdQYWdlQ29uZmlnPy5hY3Rpb25zIHx8IGVudGl0eVNjaGVtYS5tb2RlbC52aWV3UGFnZUFjdGlvbnMsXG4gICAgICAgICAgICAgICAgICAgIGJyZWFkY3J1bWJzOiBlbnRpdHlTY2hlbWEubW9kZWwudmlld1BhZ2VDb25maWc/LmJyZWFkY3J1bWJzIHx8IGVudGl0eVNjaGVtYS5tb2RlbC52aWV3UGFnZUJyZWFkY3J1bWJzLFxuICAgICAgICAgICAgICAgICAgICBjb2x1bW5zQ29uZmlnOiBlbnRpdHlTY2hlbWEubW9kZWwudmlld1BhZ2VDb25maWc/LmNvbHVtbnNDb25maWcgfHwgZW50aXR5U2NoZW1hLm1vZGVsLnZpZXdQYWdlQ29sdW1uc0NvbmZpZyxcbiAgICAgICAgICAgICAgICAgICAgZmllbGRzOiBlbnRpdHlTY2hlbWEubW9kZWwudmlld1BhZ2VDb25maWc/LmZpZWxkcyxcbiAgICAgICAgICAgICAgICAgICAgc2VjdGlvbnNDb25maWc6IGVudGl0eVNjaGVtYS5tb2RlbC52aWV3UGFnZUNvbmZpZz8uc2VjdGlvbnNDb25maWcsXG4gICAgICAgICAgICAgICAgICAgIGdsb2JhbFVJQ29uZmlnT3B0aW9ucywgIC8vIE5FVzogUGFzcyBnbG9iYWwgY29uZmlnXG4gICAgICAgICAgICAgICAgfSwgc2VydmljZSk7XG4gICAgICAgICAgICAgICAgZW50aXR5Q29uZmlnc1sgYHZpZXctJHtlbnRpdHlOYW1lLnRvTG93ZXJDYXNlKCl9YCBdID0gdmlld0NvbmZpZztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKCFlbnRpdHlTY2hlbWEubW9kZWwuZXhjbHVkZUZyb21BZG1pbk1lbnUpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBtZW51Q29uZmlnID0gTWFrZUVudGl0eU1lbnVDb25maWcoe1xuICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lUGx1cmFsOiBlbnRpdHlTY2hlbWEubW9kZWwuZW50aXR5TmFtZVBsdXJhbCxcbiAgICAgICAgICAgICAgICAgICAgaWNvbjogZW50aXR5U2NoZW1hLm1vZGVsLmVudGl0eU1lbnVJY29uIHx8ICdhcHBTdG9yZScsXG4gICAgICAgICAgICAgICAgICAgIG1lbnVJbmRleDogbWVudUluZGV4KyssXG4gICAgICAgICAgICAgICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5MaXN0OiBlbnRpdHlTY2hlbWEubW9kZWwuZXhjbHVkZUZyb21BZG1pbkxpc3QsXG4gICAgICAgICAgICAgICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5DcmVhdGU6IGVudGl0eVNjaGVtYS5tb2RlbC5leGNsdWRlRnJvbUFkbWluQ3JlYXRlLFxuICAgICAgICAgICAgICAgICAgICBtZW51R3JvdXA6IGVudGl0eVNjaGVtYS5tb2RlbC5tZW51R3JvdXAsXG4gICAgICAgICAgICAgICAgICAgIG1lbnVPcmRlcjogZW50aXR5U2NoZW1hLm1vZGVsLm1lbnVPcmRlcixcbiAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgIG1lbnVDb25maWdzLnB1c2gobWVudUNvbmZpZyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gUHJvY2VzcyBjdXN0b20gcGFnZXNcbiAgICAgICAgZm9yIChjb25zdCBbIHBhZ2VOYW1lLCBvcHRpb25zIF0gb2YgdGhpcy5jdXN0b21QYWdlcykge1xuICAgICAgICAgICAgLy8gc2tpcCB0aGUgZGVmYXVsdCBkYXNoYm9hcmQgcGFnZSBhbmQgbWVudSBwYWdlXG4gICAgICAgICAgICBpZiAocGFnZU5hbWUgPT09ICdkYXNoYm9hcmQnIHx8IHBhZ2VOYW1lID09PSAnbWVudScpIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnN0IGN1c3RvbUNvbmZpZyA9IG1ha2VDdXN0b21QYWdlQ29uZmlnKG9wdGlvbnMpO1xuICAgICAgICAgICAgZW50aXR5Q29uZmlnc1sgcGFnZU5hbWUgXSA9IGN1c3RvbUNvbmZpZztcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGF1dGhDb25maWdPcHRpb25zID0gRncyNC5nZXRJbnN0YW5jZSgpLmdldENvbmZpZygpLnVpQ29uZmlnR2VuT3B0aW9ucyB8fCB7fTtcblxuICAgICAgICBjb25zdCBhdXRoQ29uZmlncyA9IE1ha2VBdXRoQ29uZmlnKHtcbiAgICAgICAgICAgIC4uLmF1dGhDb25maWdPcHRpb25zLFxuICAgICAgICAgICAgYXV0aEVuZHBvaW50OiBhdXRoQ29uZmlnT3B0aW9ucy5hdXRoRW5kcG9pbnQgfHwgJ21hdXRoJ1xuICAgICAgICB9KTtcblxuICAgICAgICAvLyBMb29rIGZvciBhIGRhc2hib2FyZCBjdXN0b20gcGFnZVxuICAgICAgICBsZXQgZGFzaGJvYXJkQ29uZmlnOiBEYXNoYm9hcmRQYWdlQ29uZmlnIHwgYW55ID0gbnVsbDtcbiAgICAgICAgZm9yIChjb25zdCBbICwgb3B0aW9ucyBdIG9mIHRoaXMuY3VzdG9tUGFnZXMpIHtcbiAgICAgICAgICAgIC8vIENoZWNrIGlmIHRoaXMgaXMgYSBkYXNoYm9hcmQgcGFnZSAtIGhhbmRsZSBib3RoIHN0cmluZyBhbmQgVGVtcGxhdGUgcGFnZVRpdGxlXG4gICAgICAgICAgICBjb25zdCBwYWdlVGl0bGVTdHIgPSB0eXBlb2Ygb3B0aW9ucy5wYWdlVGl0bGUgPT09ICdzdHJpbmcnID8gb3B0aW9ucy5wYWdlVGl0bGUgOiAnJztcbiAgICAgICAgICAgIGlmIChvcHRpb25zLnBhZ2VUeXBlID09PSAnZGFzaGJvYXJkJyAmJiBwYWdlVGl0bGVTdHIudG9Mb3dlckNhc2UoKSA9PT0gJ2Rhc2hib2FyZCcpIHtcbiAgICAgICAgICAgICAgICBkYXNoYm9hcmRDb25maWcgPSBvcHRpb25zO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGlmICghZGFzaGJvYXJkQ29uZmlnKSB7XG4gICAgICAgICAgICBkYXNoYm9hcmRDb25maWcgPSBNYWtlRGFzaGJvYXJkQ29uZmlnKCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBMb29rIGZvciBhIG1lbnUgY3VzdG9tIHBhZ2VcbiAgICAgICAgbGV0IG1lbnVDb25maWc6IGFueSA9IG51bGw7XG4gICAgICAgIGZvciAoY29uc3QgWyBwYWdlTmFtZSwgb3B0aW9ucyBdIG9mIHRoaXMuY3VzdG9tUGFnZXMpIHtcbiAgICAgICAgICAgIC8vIENoZWNrIGlmIHRoaXMgaXMgYSBtZW51IHBhZ2UgLSBoYW5kbGUgYm90aCBzdHJpbmcgYW5kIFRlbXBsYXRlIHBhZ2VUaXRsZVxuICAgICAgICAgICAgY29uc3QgcGFnZVRpdGxlU3RyID0gdHlwZW9mIG9wdGlvbnMucGFnZVRpdGxlID09PSAnc3RyaW5nJyA/IG9wdGlvbnMucGFnZVRpdGxlIDogJyc7XG4gICAgICAgICAgICBpZiAob3B0aW9ucy5wYWdlVHlwZSA9PT0gJ21lbnUnICYmIHBhZ2VUaXRsZVN0ci50b0xvd2VyQ2FzZSgpID09PSAnbWVudScpIHtcbiAgICAgICAgICAgICAgICBtZW51Q29uZmlnID0gb3B0aW9ucztcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEdyb3VwIG1lbnUgaXRlbXMgYnkgdGhlaXIgZ3JvdXAgcHJvcGVydHlcbiAgICAgICAgY29uc3QgbWVudUdyb3VwcyA9IG5ldyBNYXA8c3RyaW5nLCBhbnlbXT4oKTtcbiAgICAgICAgY29uc3QgdW5ncm91cGVkSXRlbXM6IGFueVtdID0gW107XG5cbiAgICAgICAgLy8gUHJvY2VzcyBlbnRpdHkgbWVudSBpdGVtc1xuICAgICAgICBtZW51Q29uZmlncy5mb3JFYWNoKGl0ZW0gPT4ge1xuICAgICAgICAgICAgaWYgKGl0ZW0uZ3JvdXApIHtcbiAgICAgICAgICAgICAgICBpZiAoIW1lbnVHcm91cHMuaGFzKGl0ZW0uZ3JvdXApKSB7XG4gICAgICAgICAgICAgICAgICAgIG1lbnVHcm91cHMuc2V0KGl0ZW0uZ3JvdXAsIFtdKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgbWVudUdyb3Vwcy5nZXQoaXRlbS5ncm91cCkhLnB1c2goaXRlbSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHVuZ3JvdXBlZEl0ZW1zLnB1c2goaXRlbSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIFByb2Nlc3MgY3VzdG9tIG1lbnUgaXRlbXNcbiAgICAgICAgaWYgKG1lbnVDb25maWc/Lm1lbnVQYWdlQ29uZmlnPy5tZW51SXRlbXMpIHtcbiAgICAgICAgICAgIG1lbnVDb25maWcubWVudVBhZ2VDb25maWcubWVudUl0ZW1zLmZvckVhY2goKGl0ZW06IGFueSkgPT4ge1xuICAgICAgICAgICAgICAgIGlmIChpdGVtLmdyb3VwKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmICghbWVudUdyb3Vwcy5oYXMoaXRlbS5ncm91cCkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIG1lbnVHcm91cHMuc2V0KGl0ZW0uZ3JvdXAsIFtdKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBtZW51R3JvdXBzLmdldChpdGVtLmdyb3VwKSEucHVzaChpdGVtKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICB1bmdyb3VwZWRJdGVtcy5wdXNoKGl0ZW0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ3JlYXRlIGZpbmFsIG1lbnUgc3RydWN0dXJlXG4gICAgICAgIGNvbnN0IGFsbE1lbnVJdGVtczogYW55W10gPSBbXTtcblxuICAgICAgICAvLyBBZGQgdW5ncm91cGVkIGl0ZW1zIGZpcnN0IChwcmltYXJ5IG5hdmlnYXRpb24pXG4gICAgICAgIGFsbE1lbnVJdGVtcy5wdXNoKC4uLnVuZ3JvdXBlZEl0ZW1zKTtcblxuICAgICAgICAvLyBBZGQgZ3JvdXBlZCBpdGVtc1xuICAgICAgICBtZW51R3JvdXBzLmZvckVhY2goKGl0ZW1zLCBncm91cE5hbWUpID0+IHtcbiAgICAgICAgICAgIC8vIFNvcnQgaXRlbXMgd2l0aGluIGdyb3VwIGJ5IG9yZGVyXG4gICAgICAgICAgICBpdGVtcy5zb3J0KChhLCBiKSA9PiAoYS5vcmRlciB8fCAwKSAtIChiLm9yZGVyIHx8IDApKTtcblxuICAgICAgICAgICAgLy8gQ3JlYXRlIGdyb3VwIGl0ZW1cbiAgICAgICAgICAgIGFsbE1lbnVJdGVtcy5wdXNoKHtcbiAgICAgICAgICAgICAgICBsYWJlbDogZ3JvdXBOYW1lLFxuICAgICAgICAgICAgICAgIGtleTogYGdyb3VwLSR7Z3JvdXBOYW1lfWAsXG4gICAgICAgICAgICAgICAgaWNvbjogJ0ZvbGRlck91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBjaGlsZHJlbjogaXRlbXNcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgICBhd2FpdCB0aGlzLndyaXRlVG9GaWxlcyhhbGxNZW51SXRlbXMsIGVudGl0eUNvbmZpZ3MsIGF1dGhDb25maWdzLCBkYXNoYm9hcmRDb25maWcpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFRyYW5zZm9ybSBsZWdhY3kgZmxhdCBjb25maWcgc3RydWN0dXJlIHRvIG5ldyBuZXN0ZWQgc3RydWN0dXJlXG4gICAgICogU3VwcG9ydHMgYmFja3dhcmQgY29tcGF0aWJpbGl0eSBieSB0cmFuc2Zvcm1pbmcgb2xkIHByb3BlcnRpZXMgdG8gbmV3IGZvcm1hdFxuICAgICAqL1xuICAgIHByaXZhdGUgdHJhbnNmb3JtTGVnYWN5Q29uZmlnKHNjaGVtYTogRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+KTogRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+IHtcbiAgICAgICAgY29uc3QgbW9kZWwgPSBzY2hlbWEubW9kZWw7XG5cbiAgICAgICAgLy8gSWYgYWxyZWFkeSB1c2luZyBuZXcgZm9ybWF0LCByZXR1cm4gYXMtaXNcbiAgICAgICAgaWYgKG1vZGVsLmxpc3RQYWdlQ29uZmlnIHx8IG1vZGVsLnZpZXdQYWdlQ29uZmlnIHx8IG1vZGVsLmVkaXRQYWdlQ29uZmlnIHx8IG1vZGVsLmNyZWF0ZVBhZ2VDb25maWcpIHtcbiAgICAgICAgICAgIHJldHVybiBzY2hlbWE7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBUcmFuc2Zvcm0gb2xkIGZvcm1hdCB0byBuZXcgbmVzdGVkIHN0cnVjdHVyZVxuICAgICAgICBjb25zdCB0cmFuc2Zvcm1lZE1vZGVsID0ge1xuICAgICAgICAgICAgLi4ubW9kZWwsXG4gICAgICAgICAgICAvLyBMaXN0IHBhZ2UgdHJhbnNmb3JtYXRpb25cbiAgICAgICAgICAgIGxpc3RQYWdlQ29uZmlnOiAobW9kZWwubGlzdFBhZ2VBY3Rpb25zIHx8IG1vZGVsLmxpc3RQYWdlQnJlYWRjcnVtYnMgfHwgbW9kZWwubGlzdFBhZ2VEZWZhdWx0U29ydClcbiAgICAgICAgICAgICAgICA/IHtcbiAgICAgICAgICAgICAgICAgICAgYWN0aW9uczogbW9kZWwubGlzdFBhZ2VBY3Rpb25zLFxuICAgICAgICAgICAgICAgICAgICBicmVhZGNydW1iczogbW9kZWwubGlzdFBhZ2VCcmVhZGNydW1icyxcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdFNvcnQ6IG1vZGVsLmxpc3RQYWdlRGVmYXVsdFNvcnRcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgOiB1bmRlZmluZWQsXG5cbiAgICAgICAgICAgIC8vIFZpZXcgcGFnZSB0cmFuc2Zvcm1hdGlvblxuICAgICAgICAgICAgdmlld1BhZ2VDb25maWc6IChtb2RlbC52aWV3UGFnZUFjdGlvbnMgfHwgbW9kZWwudmlld1BhZ2VCcmVhZGNydW1icyB8fCBtb2RlbC52aWV3UGFnZUNvbHVtbnNDb25maWcpXG4gICAgICAgICAgICAgICAgPyB7XG4gICAgICAgICAgICAgICAgICAgIGFjdGlvbnM6IG1vZGVsLnZpZXdQYWdlQWN0aW9ucyxcbiAgICAgICAgICAgICAgICAgICAgYnJlYWRjcnVtYnM6IG1vZGVsLnZpZXdQYWdlQnJlYWRjcnVtYnMsXG4gICAgICAgICAgICAgICAgICAgIGNvbHVtbnNDb25maWc6IG1vZGVsLnZpZXdQYWdlQ29sdW1uc0NvbmZpZ1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICA6IHVuZGVmaW5lZCxcblxuICAgICAgICAgICAgLy8gRWRpdCBwYWdlIHRyYW5zZm9ybWF0aW9uXG4gICAgICAgICAgICBlZGl0UGFnZUNvbmZpZzogKG1vZGVsLmVkaXRQYWdlQWN0aW9ucyB8fCBtb2RlbC5lZGl0UGFnZUJyZWFkY3J1bWJzIHx8IG1vZGVsLmVkaXRQYWdlQ29sdW1uc0NvbmZpZylcbiAgICAgICAgICAgICAgICA/IHtcbiAgICAgICAgICAgICAgICAgICAgYWN0aW9uczogbW9kZWwuZWRpdFBhZ2VBY3Rpb25zLFxuICAgICAgICAgICAgICAgICAgICBicmVhZGNydW1iczogbW9kZWwuZWRpdFBhZ2VCcmVhZGNydW1icyxcbiAgICAgICAgICAgICAgICAgICAgY29sdW1uc0NvbmZpZzogbW9kZWwuZWRpdFBhZ2VDb2x1bW5zQ29uZmlnXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIDogdW5kZWZpbmVkLFxuXG4gICAgICAgICAgICAvLyBDcmVhdGUgcGFnZSB0cmFuc2Zvcm1hdGlvblxuICAgICAgICAgICAgY3JlYXRlUGFnZUNvbmZpZzogKG1vZGVsLmNyZWF0ZVBhZ2VCcmVhZGNydW1icyB8fCBtb2RlbC5jcmVhdGVQYWdlQ29sdW1uc0NvbmZpZylcbiAgICAgICAgICAgICAgICA/IHtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWRjcnVtYnM6IG1vZGVsLmNyZWF0ZVBhZ2VCcmVhZGNydW1icyxcbiAgICAgICAgICAgICAgICAgICAgY29sdW1uc0NvbmZpZzogbW9kZWwuY3JlYXRlUGFnZUNvbHVtbnNDb25maWdcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgOiB1bmRlZmluZWQsXG4gICAgICAgIH07XG5cbiAgICAgICAgcmV0dXJuIHsgLi4uc2NoZW1hLCBtb2RlbDogdHJhbnNmb3JtZWRNb2RlbCB9O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENoZWNrIGZvciBkZXByZWNhdGVkIGNvbmZpZ3VyYXRpb24gdXNhZ2UgYW5kIGVtaXQgd2FybmluZ3NcbiAgICAgKi9cbiAgICBwcml2YXRlIGNoZWNrRGVwcmVjYXRlZFVzYWdlKHNjaGVtYTogRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+KTogdm9pZCB7XG4gICAgICAgIGNvbnN0IG1vZGVsID0gc2NoZW1hLm1vZGVsO1xuICAgICAgICBjb25zdCB3YXJuaW5nczogc3RyaW5nW10gPSBbXTtcblxuICAgICAgICAvLyBDaGVjayBsaXN0IHBhZ2UgZGVwcmVjYXRlZCBmaWVsZHNcbiAgICAgICAgaWYgKG1vZGVsLmxpc3RQYWdlQWN0aW9ucykge1xuICAgICAgICAgICAgd2FybmluZ3MucHVzaCgnbGlzdFBhZ2VBY3Rpb25zIGlzIGRlcHJlY2F0ZWQuIFVzZSBsaXN0UGFnZUNvbmZpZy5hY3Rpb25zIGluc3RlYWQuJyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG1vZGVsLmxpc3RQYWdlQnJlYWRjcnVtYnMpIHtcbiAgICAgICAgICAgIHdhcm5pbmdzLnB1c2goJ2xpc3RQYWdlQnJlYWRjcnVtYnMgaXMgZGVwcmVjYXRlZC4gVXNlIGxpc3RQYWdlQ29uZmlnLmJyZWFkY3J1bWJzIGluc3RlYWQuJyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG1vZGVsLmxpc3RQYWdlRGVmYXVsdFNvcnQpIHtcbiAgICAgICAgICAgIHdhcm5pbmdzLnB1c2goJ2xpc3RQYWdlRGVmYXVsdFNvcnQgaXMgZGVwcmVjYXRlZC4gVXNlIGxpc3RQYWdlQ29uZmlnLmRlZmF1bHRTb3J0IGluc3RlYWQuJyk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDaGVjayB2aWV3IHBhZ2UgZGVwcmVjYXRlZCBmaWVsZHNcbiAgICAgICAgaWYgKG1vZGVsLnZpZXdQYWdlQWN0aW9ucykge1xuICAgICAgICAgICAgd2FybmluZ3MucHVzaCgndmlld1BhZ2VBY3Rpb25zIGlzIGRlcHJlY2F0ZWQuIFVzZSB2aWV3UGFnZUNvbmZpZy5hY3Rpb25zIGluc3RlYWQuJyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG1vZGVsLnZpZXdQYWdlQnJlYWRjcnVtYnMpIHtcbiAgICAgICAgICAgIHdhcm5pbmdzLnB1c2goJ3ZpZXdQYWdlQnJlYWRjcnVtYnMgaXMgZGVwcmVjYXRlZC4gVXNlIHZpZXdQYWdlQ29uZmlnLmJyZWFkY3J1bWJzIGluc3RlYWQuJyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG1vZGVsLnZpZXdQYWdlQ29sdW1uc0NvbmZpZykge1xuICAgICAgICAgICAgd2FybmluZ3MucHVzaCgndmlld1BhZ2VDb2x1bW5zQ29uZmlnIGlzIGRlcHJlY2F0ZWQuIFVzZSB2aWV3UGFnZUNvbmZpZy5jb2x1bW5zQ29uZmlnIGluc3RlYWQuJyk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDaGVjayBlZGl0IHBhZ2UgZGVwcmVjYXRlZCBmaWVsZHNcbiAgICAgICAgaWYgKG1vZGVsLmVkaXRQYWdlQWN0aW9ucykge1xuICAgICAgICAgICAgd2FybmluZ3MucHVzaCgnZWRpdFBhZ2VBY3Rpb25zIGlzIGRlcHJlY2F0ZWQuIFVzZSBlZGl0UGFnZUNvbmZpZy5hY3Rpb25zIGluc3RlYWQuJyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG1vZGVsLmVkaXRQYWdlQnJlYWRjcnVtYnMpIHtcbiAgICAgICAgICAgIHdhcm5pbmdzLnB1c2goJ2VkaXRQYWdlQnJlYWRjcnVtYnMgaXMgZGVwcmVjYXRlZC4gVXNlIGVkaXRQYWdlQ29uZmlnLmJyZWFkY3J1bWJzIGluc3RlYWQuJyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG1vZGVsLmVkaXRQYWdlQ29sdW1uc0NvbmZpZykge1xuICAgICAgICAgICAgd2FybmluZ3MucHVzaCgnZWRpdFBhZ2VDb2x1bW5zQ29uZmlnIGlzIGRlcHJlY2F0ZWQuIFVzZSBlZGl0UGFnZUNvbmZpZy5jb2x1bW5zQ29uZmlnIGluc3RlYWQuJyk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDaGVjayBjcmVhdGUgcGFnZSBkZXByZWNhdGVkIGZpZWxkc1xuICAgICAgICBpZiAobW9kZWwuY3JlYXRlUGFnZUJyZWFkY3J1bWJzKSB7XG4gICAgICAgICAgICB3YXJuaW5ncy5wdXNoKCdjcmVhdGVQYWdlQnJlYWRjcnVtYnMgaXMgZGVwcmVjYXRlZC4gVXNlIGNyZWF0ZVBhZ2VDb25maWcuYnJlYWRjcnVtYnMgaW5zdGVhZC4nKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAobW9kZWwuY3JlYXRlUGFnZUNvbHVtbnNDb25maWcpIHtcbiAgICAgICAgICAgIHdhcm5pbmdzLnB1c2goJ2NyZWF0ZVBhZ2VDb2x1bW5zQ29uZmlnIGlzIGRlcHJlY2F0ZWQuIFVzZSBjcmVhdGVQYWdlQ29uZmlnLmNvbHVtbnNDb25maWcgaW5zdGVhZC4nKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEVtaXQgd2FybmluZ3MgaWYgYW55IGRlcHJlY2F0ZWQgZmllbGRzIGZvdW5kXG4gICAgICAgIGlmICh3YXJuaW5ncy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBcXG7imqDvuI8gIEVudGl0eSBcIiR7bW9kZWwuZW50aXR5fVwiIHVzZXMgZGVwcmVjYXRlZCBjb25maWd1cmF0aW9uOmApO1xuICAgICAgICAgICAgd2FybmluZ3MuZm9yRWFjaCh3ID0+IHRoaXMubG9nZ2VyLndhcm4oYCAgIC0gJHt3fWApKTtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYCAgIPCfk5YgTWlncmF0aW9uIGd1aWRlOiBodHRwczovL2RvY3MuZncyNC5pby9taWdyYXRpb24vbmVzdGVkLWNvbmZpZ1xcbmApO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgQExvZ0R1cmF0aW9uKClcbiAgICBwcmVwYXJlU2VydmljZXNEaXJlY3RvcmllcygpIHtcbiAgICAgICAgY29uc3QgZncyNCA9IEZ3MjQuZ2V0SW5zdGFuY2UoKTtcblxuICAgICAgICBjb25zdCBzZXJ2aWNlRGlyZWN0b3JpZXMgPSBbIHBhdGhSZXNvbHZlKCcuL3NyYy9zZXJ2aWNlcy8nKSBdO1xuXG4gICAgICAgIGlmIChmdzI0Lmhhc01vZHVsZXMoKSkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFVpLWNvbmZpZy1nZW46OjogUHJvY2Vzczo6OiBhcHAgaGFzIG1vZHVsZXM6IGAsIEFycmF5LmZyb20oZncyNC5nZXRNb2R1bGVzKCkua2V5cygpKSk7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IFsgLCBtb2R1bGUgXSBvZiBmdzI0LmdldE1vZHVsZXMoKSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IG1vZHVsZVNlcnZpY2VzUGF0aCA9IHBhdGhKb2luKG1vZHVsZS5nZXRCYXNlUGF0aCgpLCBtb2R1bGUuZ2V0U2VydmljZXNEaXJlY3RvcnkoKSk7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFVpLWNvbmZpZy1nZW46OjogUHJvY2Vzczo6OiBtb2R1bGVTZXJ2aWNlc1BhdGg6IGAsIG1vZHVsZVNlcnZpY2VzUGF0aCk7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFVpLWNvbmZpZy1nZW46OjogUHJvY2Vzczo6OiByZXMtbW9kdWxlU2VydmljZXNQYXRoOiBgLCBwYXRoUmVzb2x2ZShtb2R1bGVTZXJ2aWNlc1BhdGgpKTtcbiAgICAgICAgICAgICAgICBzZXJ2aWNlRGlyZWN0b3JpZXMucHVzaChwYXRoUmVzb2x2ZShtb2R1bGVTZXJ2aWNlc1BhdGgpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBzZXJ2aWNlRGlyZWN0b3JpZXM7XG4gICAgfVxuXG4gICAgQExvZ0R1cmF0aW9uKClcbiAgICBhc3luYyBzY2FuQW5kTG9hZFNlcnZpY2VzKHNlcnZpY2VEaXJlY3RvcmllczogQXJyYXk8c3RyaW5nPikge1xuXG4gICAgICAgIGNvbnN0IHNjYW5uZWRTZXJ2aWNlcyA9IG5ldyBTZXQ8RnVuY3Rpb24+KCk7XG5cbiAgICAgICAgZm9yIChjb25zdCBkaXIgb2Ygc2VydmljZURpcmVjdG9yaWVzKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgVWktY29uZmlnLWdlbjo6OiBQcm9jZXNzOjo6IGxvYWRpbmcgc2VydmljZXMgZnJvbSBESVI6IGAsIGRpcik7XG4gICAgICAgICAgICBjb25zdCBkaXJTZXJ2aWNlVG9rZW5zID0gYXdhaXQgdGhpcy5zY2FuU2VydmljZXNGcm9tRGlyZWN0b3J5KGRpcik7XG4gICAgICAgICAgICBkaXJTZXJ2aWNlVG9rZW5zLmZvckVhY2godG9rZW4gPT4gc2Nhbm5lZFNlcnZpY2VzLmFkZCh0b2tlbikpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gZ2V0IGFsbCBjb250YWluZXIgcmVnaXN0ZXJlZCBzZXJ2aWNlcyB0byBtYWtlIHN1cmUgYXV0by1nZW4gZW50aXR5LXNlcnZpY2VzIGFyZSBhbHNvIGluY2x1ZGVkXG4gICAgICAgIHRoaXMudWlHZW5ESUNvbnRhaW5lci5jb2xsZWN0QmVzdFByb3ZpZGVyc0Zvcih7XG4gICAgICAgICAgICB0eXBlOiAnc2VydmljZScsXG4gICAgICAgICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzOiB0cnVlXG4gICAgICAgIH0pLmZpbHRlcihvcHQgPT4ge1xuICAgICAgICAgICAgLy8gbWFrZSBzdXJlIHRvIGNvbGxlY3Qgb25seSB0aGUgZW50aXR5IHNlcnZpY2UgcHJvdmlkZXJzXG4gICAgICAgICAgICByZXR1cm4gISFvcHQuX3Byb3ZpZGVyLmZvckVudGl0eVxuICAgICAgICB9KS5mb3JFYWNoKG9wdCA9PiB7XG4gICAgICAgICAgICBzY2FubmVkU2VydmljZXMuYWRkKG9wdC5fcHJvdmlkZXIucHJvdmlkZSBhcyBGdW5jdGlvbik7XG4gICAgICAgIH0pXG5cbiAgICAgICAgLy8gcmVzb2x2ZSBhbGwgc2VydmljZXNcbiAgICAgICAgY29uc3QgcmVzb2x2ZWRTZXJ2aWNlcyA9IG5ldyBNYXA8c3RyaW5nLCBCYXNlRW50aXR5U2VydmljZTxhbnk+PigpO1xuXG4gICAgICAgIHNjYW5uZWRTZXJ2aWNlcy5mb3JFYWNoKHRva2VuID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHNlcnZpY2UgPSB0aGlzLnVpR2VuRElDb250YWluZXIucmVzb2x2ZSh0b2tlbiwge1xuICAgICAgICAgICAgICAgIGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnM6IHRydWVcbiAgICAgICAgICAgIH0pIGFzIEJhc2VFbnRpdHlTZXJ2aWNlPGFueT47XG5cbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGByZXNvbHZlZCBzZXJ2aWNlIGZvciBlbnRpdHk6ICR7c2VydmljZS5nZXRFbnRpdHlOYW1lKCl9YCk7XG5cbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBVaS1jb25maWctZ2VuOjo6IFByb2Nlc3M6OjogbG9hZGVkIHNlcnZpY2VzIGZyb20gZW50aXR5OiBgLCBzZXJ2aWNlLmdldEVudGl0eU5hbWUoKSk7XG4gICAgICAgICAgICByZXNvbHZlZFNlcnZpY2VzLnNldChzZXJ2aWNlLmdldEVudGl0eU5hbWUoKSwgc2VydmljZSk7XG4gICAgICAgIH0pXG5cbiAgICAgICAgcmV0dXJuIHJlc29sdmVkU2VydmljZXM7XG4gICAgfVxuXG4gICAgQExvZ0R1cmF0aW9uKClcbiAgICBhc3luYyBzY2FuU2VydmljZXNGcm9tRGlyZWN0b3J5KHNlcnZpY2VzRGlyOiBzdHJpbmcpIHtcblxuICAgICAgICBjb25zdCBzY2FubmVkU2VydmljZXMgPSBuZXcgU2V0PEZ1bmN0aW9uPigpO1xuXG4gICAgICAgIGlmICghZXhpc3RzU3luYyhzZXJ2aWNlc0RpcikpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYHNjYW5TZXJ2aWNlc0Zyb21EaXJlY3Rvcnk6IHNlcnZpY2VzRGlyIGRvZXMgbm90IGV4aXN0czogJHtzZXJ2aWNlc0Rpcn1gKTtcbiAgICAgICAgICAgIHJldHVybiBzY2FubmVkU2VydmljZXM7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBzZXJ2aWNlUGF0aHMgPSBIZWxwZXIuc2NhbkNvbnRyb2xsZXJTb3VyY2VGaWxlc0Zyb20oc2VydmljZXNEaXIpO1xuXG4gICAgICAgIGZvciAoY29uc3Qgc2VydmljZVBhdGggb2Ygc2VydmljZVBhdGhzKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgdHJ5aW5nIHRvIGxvYWQgc2VydmljZVBhdGg6ICR7c2VydmljZVBhdGh9YCk7XG5cbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgLy8gRHluYW1pY2FsbHkgaW1wb3J0IHRoZSBzZXJ2aWNlIGZpbGVcbiAgICAgICAgICAgICAgICBjb25zdCBtb2R1bGUgPSBhd2FpdCBpbXBvcnQocGF0aEpvaW4oc2VydmljZXNEaXIsIHNlcnZpY2VQYXRoKSk7XG5cbiAgICAgICAgICAgICAgICAvLyBGaW5kIGFuZCBpbnN0YW50aWF0ZSBzZXJ2aWNlIGNsYXNzZXNcbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IGV4cG9ydGVkSXRlbSBvZiBPYmplY3QudmFsdWVzKG1vZHVsZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKFxuICAgICAgICAgICAgICAgICAgICAgICAgZXhwb3J0ZWRJdGVtXG4gICAgICAgICAgICAgICAgICAgICAgICAmJiB0eXBlb2YgZXhwb3J0ZWRJdGVtID09PSAnZnVuY3Rpb24nXG4gICAgICAgICAgICAgICAgICAgICAgICAmJiAncHJvdG90eXBlJyBpbiBleHBvcnRlZEl0ZW1cbiAgICAgICAgICAgICAgICAgICAgICAgICYmIGV4cG9ydGVkSXRlbS5wcm90b3R5cGUgaW5zdGFuY2VvZiBCYXNlRW50aXR5U2VydmljZVxuICAgICAgICAgICAgICAgICAgICApIHtcblxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMudWlHZW5ESUNvbnRhaW5lci5oYXMoZXhwb3J0ZWRJdGVtLCB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3NlcnZpY2UnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnM6IHRydWVcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc2Nhbm5lZFNlcnZpY2VzLmFkZChleHBvcnRlZEl0ZW0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBzY2FuU2VydmljZXNGcm9tRGlyZWN0b3J5OiByZWdpc3RlcmluZyBzZXJ2aWNlOiAke2V4cG9ydGVkSXRlbS5uYW1lfWApO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1Zyhgc2NhblNlcnZpY2VzRnJvbURpcmVjdG9yeTogbm8gcHJvdmlkZXIgY291bGQgYmUgZm91bmQgZm9yIHNlcnZpY2U6ICR7ZXhwb3J0ZWRJdGVtLm5hbWV9YCk7XG5cbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcblxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYHNjYW5TZXJ2aWNlc0Zyb21EaXJlY3Rvcnk6IFNLSVA6IGV4cG9ydGVkSXRlbSBpcyBub3QgYSBzZXJ2aWNlIGNsYXNzOiAkeyhleHBvcnRlZEl0ZW0gYXMgYW55KT8ubmFtZSA/IChleHBvcnRlZEl0ZW0gYXMgYW55KS5uYW1lIDogZXhwb3J0ZWRJdGVtfWApO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKGBzY2FuU2VydmljZXNGcm9tRGlyZWN0b3J5OiBFeGNlcHRpb24gd2hpbGUgdHJ5aW5nIHRvIGxvYWQgc2VydmljZVBhdGg6ICR7c2VydmljZVBhdGh9YCwgZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gc2Nhbm5lZFNlcnZpY2VzO1xuICAgIH1cblxuICAgIEBMb2dEdXJhdGlvbigpXG4gICAgYXN5bmMgd3JpdGVUb0ZpbGVzKG1lbnVDb25maWc6IGFueSwgZW50aXRpZXNDb25maWc6IGFueSwgYXV0aENvbmZpZzogYW55LCBkYXNoYm9hcmRDb25maWc6IGFueSkge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkNhbGxlZCB3cml0ZVRvRmlsZXM6Ojo6OjogXCIpO1xuICAgICAgICBjb25zdCBnZW5EaXJlY3RvcnlQYXRoID0gcGF0aFJlc29sdmUoJy4vZ2VuLycpO1xuICAgICAgICBpZiAoIWV4aXN0c1N5bmMoZ2VuRGlyZWN0b3J5UGF0aCkpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBHZW4gRElSIGRvZXMgbm90IGV4aXN0cywgY3JlYXRpbmc6ICR7Z2VuRGlyZWN0b3J5UGF0aH1gLCk7XG4gICAgICAgICAgICBta2RpclN5bmMoZ2VuRGlyZWN0b3J5UGF0aCk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBjb25maWdEaXJlY3RvcnlQYXRoID0gcGF0aFJlc29sdmUocGF0aEpvaW4oZ2VuRGlyZWN0b3J5UGF0aCwgJ2NvbmZpZycpKTtcbiAgICAgICAgaWYgKCFleGlzdHNTeW5jKGNvbmZpZ0RpcmVjdG9yeVBhdGgpKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQ29uZmlnIERJUiBkb2VzIG5vdCBleGlzdHMsIGNyZWF0aW5nOiAke2NvbmZpZ0RpcmVjdG9yeVBhdGh9YCk7XG4gICAgICAgICAgICBta2RpclN5bmMoY29uZmlnRGlyZWN0b3J5UGF0aCk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBtZW51Q29uZmlnRmlsZVBhdGggPSBwYXRoSm9pbihjb25maWdEaXJlY3RvcnlQYXRoLCAnbWVudS5qc29uJyk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGB3cml0aW5nIG1lbnUtY29uZmlnLi4gaW50bzogJHttZW51Q29uZmlnRmlsZVBhdGh9YCk7XG4gICAgICAgIHdyaXRlRmlsZVN5bmMobWVudUNvbmZpZ0ZpbGVQYXRoLCBKU09OLnN0cmluZ2lmeShtZW51Q29uZmlnLCBudWxsLCAyKSk7XG5cbiAgICAgICAgY29uc3QgZW50aXRpZXNDb25maWdGaWxlUGF0aCA9IHBhdGhKb2luKGNvbmZpZ0RpcmVjdG9yeVBhdGgsICdlbnRpdGllcy5qc29uJyk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGB3cml0aW5nIGVudGl0aWVzLWNvbmZpZy4uIGludG86ICR7ZW50aXRpZXNDb25maWdGaWxlUGF0aH1gLCk7XG4gICAgICAgIHdyaXRlRmlsZVN5bmMoZW50aXRpZXNDb25maWdGaWxlUGF0aCwgSlNPTi5zdHJpbmdpZnkoZW50aXRpZXNDb25maWcsIG51bGwsIDIpKTtcblxuICAgICAgICBjb25zdCBhdXRoQ29uZmlnRmlsZVBhdGggPSBwYXRoSm9pbihjb25maWdEaXJlY3RvcnlQYXRoLCAnYXV0aC5qc29uJyk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGB3cml0aW5nIGF1dGgtY29uZmlnLi4gaW50bzogJHthdXRoQ29uZmlnRmlsZVBhdGh9YCwpO1xuICAgICAgICB3cml0ZUZpbGVTeW5jKGF1dGhDb25maWdGaWxlUGF0aCwgSlNPTi5zdHJpbmdpZnkoYXV0aENvbmZpZywgbnVsbCwgMikpO1xuXG4gICAgICAgIGNvbnN0IGRhc2hib2FyZENvbmZpZ0ZpbGVQYXRoID0gcGF0aEpvaW4oY29uZmlnRGlyZWN0b3J5UGF0aCwgJ2Rhc2hib2FyZC5qc29uJyk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGB3cml0aW5nIGRhc2hib2FyZC1jb25maWcuLiBpbnRvOiAke2Rhc2hib2FyZENvbmZpZ0ZpbGVQYXRofWAsKTtcbiAgICAgICAgd3JpdGVGaWxlU3luYyhkYXNoYm9hcmRDb25maWdGaWxlUGF0aCwgSlNPTi5zdHJpbmdpZnkoZGFzaGJvYXJkQ29uZmlnLCBudWxsLCAyKSk7XG5cbiAgICB9XG59XG5cbiJdfQ==