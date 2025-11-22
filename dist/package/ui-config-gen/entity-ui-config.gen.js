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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW50aXR5LXVpLWNvbmZpZy5nZW4uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdWktY29uZmlnLWdlbi9lbnRpdHktdWktY29uZmlnLmdlbi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFDQSw4RUFBK0Q7QUFDL0QsOEVBQStEO0FBQy9ELDBFQUEyRDtBQUMzRCwwRUFBMkQ7QUFDM0QsMEVBQTJEO0FBQzNELHNDQUE0RDtBQUM1RCx5REFBMEo7QUFFMUosNERBQThDO0FBQzlDLHNFQUF3RDtBQUV4RCwyQkFBMEQ7QUFDMUQsK0JBR2M7QUFFZCx1Q0FBb0M7QUFDcEMsMkNBQXdDO0FBQ3hDLHdDQUF1RDtBQUN2RCwwQ0FBd0M7QUFFeEMsTUFBYSxpQkFBaUI7SUFDakIsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxpQkFBaUIsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUN2RCw4RkFBOEY7SUFDOUYsbUNBQW1DO0lBQzFCLGdCQUFnQixHQUFHLFdBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO0lBRWxELFdBQVcsR0FBbUMsSUFBSSxHQUFHLEVBQUUsQ0FBQztJQUduRSxBQUFOLEtBQUssQ0FBQyxlQUFlO1FBQ2pCLE1BQU0sSUFBSSxHQUFHLFdBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztRQUNoQyxNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUM7UUFDaEMsTUFBTSxjQUFjLEdBQUcsTUFBTSxDQUFDLGtCQUFrQixFQUFFLG9CQUFvQixJQUFJLGNBQWMsQ0FBQztRQUV6RixNQUFNLHNCQUFzQixHQUFHLENBQUUsSUFBQSxjQUFXLEVBQUMsU0FBUyxjQUFjLEdBQUcsQ0FBQyxDQUFFLENBQUM7UUFFM0UsSUFBSSxJQUFJLENBQUMsVUFBVSxFQUFFLEVBQUUsQ0FBQztZQUNwQixLQUFLLE1BQU0s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QURMLElBQUEscUJBQVcsR0FBRTtrRUFrRGI7QUFHSztJQURMLElBQUEscUJBQVcsR0FBRTtxREErQmIiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyB0eXBlIH0gZnJvbSAnb3MnO1xuaW1wb3J0IE1ha2VDcmVhdGVFbnRpdHlDb25maWcgZnJvbSAnLi90ZW1wbGF0ZXMvY3JlYXRlLWVudGl0eSc7XG5pbXBvcnQgTWFrZVVwZGF0ZUVudGl0eUNvbmZpZyBmcm9tICcuL3RlbXBsYXRlcy91cGRhdGUtZW50aXR5JztcbmltcG9ydCBNYWtlTGlzdEVudGl0eUNvbmZpZyBmcm9tICcuL3RlbXBsYXRlcy9saXN0LWVudGl0eSc7XG5pbXBvcnQgTWFrZVZpZXdFbnRpdHlDb25maWcgZnJvbSAnLi90ZW1wbGF0ZXMvdmlldy1lbnRpdHknO1xuaW1wb3J0IE1ha2VFbnRpdHlNZW51Q29uZmlnIGZyb20gJy4vdGVtcGxhdGVzL2VudGl0eS1tZW51JztcbmltcG9ydCB7IEJhc2VFbnRpdHlTZXJ2aWNlLCBFbnRpdHlTY2hlbWEgfSBmcm9tICcuLi9lbnRpdHknO1xuaW1wb3J0IHsgbWFrZUN1c3RvbVBhZ2VDb25maWcsIEN1c3RvbVBhZ2VPcHRpb25zLCBMaXN0UGFnZUNvbmZpZywgRm9ybVBhZ2VDb25maWcsIERldGFpbHNQYWdlQ29uZmlnLCBEYXNoYm9hcmRQYWdlQ29uZmlnIH0gZnJvbSAnLi90ZW1wbGF0ZXMvY3VzdG9tLXBhZ2UnO1xuXG5pbXBvcnQgTWFrZUF1dGhDb25maWcgZnJvbSAnLi90ZW1wbGF0ZXMvYXV0aCc7XG5pbXBvcnQgTWFrZURhc2hib2FyZENvbmZpZyBmcm9tICcuL3RlbXBsYXRlcy9kYXNoYm9hcmQnO1xuXG5pbXBvcnQgeyBleGlzdHNTeW5jLCBta2RpclN5bmMsIHdyaXRlRmlsZVN5bmMgfSBmcm9tIFwiZnNcIjtcbmltcG9ydCB7XG4gICAgcmVzb2x2ZSBhcyBwYXRoUmVzb2x2ZSxcbiAgICBqb2luIGFzIHBhdGhKb2luXG59IGZyb20gXCJwYXRoXCI7XG5cbmltcG9ydCB7IEZ3MjQgfSBmcm9tICcuLi9jb3JlL2Z3MjQnO1xuaW1wb3J0IHsgSGVscGVyIH0gZnJvbSAnLi4vY29yZS9oZWxwZXInO1xuaW1wb3J0IHsgTG9nRHVyYXRpb24sIGNyZWF0ZUxvZ2dlciB9IGZyb20gJy4uL2xvZ2dpbmcnO1xuaW1wb3J0IHsgdG9TbHVnIH0gZnJvbSAnLi4vdXRpbHMvY2FzZXMnO1xuXG5leHBvcnQgY2xhc3MgRW50aXR5VUlDb25maWdHZW4ge1xuICAgIHJlYWRvbmx5IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcihFbnRpdHlVSUNvbmZpZ0dlbi5uYW1lKTtcbiAgICAvLyBtYWtlIHN1cmUgdG8gY3JlYXRlIGEgY2hpbGQgY29udGFpbmVyIHRvIG5vdCBwb2xsdXRlIGFueXRoaW5nIGluIHRoZSBBcHBsaWNhdGlvbiBjb250YWluZXIgXG4gICAgLy8gd2hpbGUgc2Nhbm5pbmcgYW5kIGxvYWRpbmcgc3R1ZmZcbiAgICByZWFkb25seSB1aUdlbkRJQ29udGFpbmVyID0gRncyNC5nZXRJbnN0YW5jZSgpLmdldEFwcERJQ29udGFpbmVyKCk7XG5cbiAgICBwcml2YXRlIHJlYWRvbmx5IGN1c3RvbVBhZ2VzOiBNYXA8c3RyaW5nLCBDdXN0b21QYWdlT3B0aW9ucz4gPSBuZXcgTWFwKCk7XG5cbiAgICBATG9nRHVyYXRpb24oKVxuICAgIGFzeW5jIHNjYW5DdXN0b21QYWdlcygpIHtcbiAgICAgICAgY29uc3QgZncyNCA9IEZ3MjQuZ2V0SW5zdGFuY2UoKTtcbiAgICAgICAgY29uc3QgY29uZmlnID0gZncyNC5nZXRDb25maWcoKTtcbiAgICAgICAgY29uc3QgY3VzdG9tUGFnZXNEaXIgPSBjb25maWcudWlDb25maWdHZW5PcHRpb25zPy5jdXN0b21QYWdlc0RpcmVjdG9yeSB8fCAnY3VzdG9tLXBhZ2VzJztcblxuICAgICAgICBjb25zdCBjdXN0b21QYWdlc0RpcmVjdG9yaWVzID0gWyBwYXRoUmVzb2x2ZShgLi9zcmMvJHtjdXN0b21QYWdlc0Rpcn0vYCkgXTtcblxuICAgICAgICBpZiAoZncyNC5oYXNNb2R1bGVzKCkpIHtcbiAgICAgICAgICAgIGZvciAoY29uc3QgWyAsIG1vZHVsZSBdIG9mIGZ3MjQuZ2V0TW9kdWxlcygpKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgbW9kdWxlQ3VzdG9tUGFnZXNQYXRoID0gcGF0aEpvaW4obW9kdWxlLmdldEJhc2VQYXRoKCksIGN1c3RvbVBhZ2VzRGlyKTtcbiAgICAgICAgICAgICAgICBjdXN0b21QYWdlc0RpcmVjdG9yaWVzLnB1c2gocGF0aFJlc29sdmUobW9kdWxlQ3VzdG9tUGFnZXNQYXRoKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCByZWdpc3RlcmVkUGFnZXM6IHN0cmluZ1tdID0gW107XG5cbiAgICAgICAgZm9yIChjb25zdCBkaXIgb2YgY3VzdG9tUGFnZXNEaXJlY3Rvcmllcykge1xuICAgICAgICAgICAgaWYgKCFleGlzdHNTeW5jKGRpcikpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQ3VzdG9tIHBhZ2VzIGRpcmVjdG9yeSBkb2VzIG5vdCBleGlzdDogJHtkaXJ9YCk7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGN1c3RvbVBhZ2VGaWxlcyA9IEhlbHBlci5zY2FuQ29udHJvbGxlclNvdXJjZUZpbGVzRnJvbShkaXIpO1xuXG4gICAgICAgICAgICBmb3IgKGNvbnN0IGZpbGUgb2YgY3VzdG9tUGFnZUZpbGVzKSB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbW9kdWxlID0gYXdhaXQgaW1wb3J0KHBhdGhKb2luKGRpciwgZmlsZSkpO1xuICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IFsgXywgdmFsdWUgXSBvZiBPYmplY3QuZW50cmllcyhtb2R1bGUpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5pc1ZhbGlkQ3VzdG9tUGFnZUNvbmZpZyh2YWx1ZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwYWdlTmFtZSA9IHRoaXMuZ2V0UGFnZU5hbWVGcm9tQ29uZmlnKHZhbHVlKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAocGFnZU5hbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5yZWdpc3RlckN1c3RvbVBhZ2UodmFsdWUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZWdpc3RlcmVkUGFnZXMucHVzaChwYWdlTmFtZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBSZWdpc3RlcmVkIGN1c3RvbSBwYWdlOiAke3BhZ2VOYW1lfWApO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYEVycm9yIGxvYWRpbmcgY3VzdG9tIHBhZ2UgZnJvbSAke2ZpbGV9OmAsIGUpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChyZWdpc3RlcmVkUGFnZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhg4pyFIFJlZ2lzdGVyZWQgJHtyZWdpc3RlcmVkUGFnZXMubGVuZ3RofSBjdXN0b20gcGFnZShzKTogJHtyZWdpc3RlcmVkUGFnZXMuc2xpY2UoMCwgNSkuam9pbignLCAnKX0ke3JlZ2lzdGVyZWRQYWdlcy5sZW5ndGggPiA1ID8gYCwgKyR7cmVnaXN0ZXJlZFBhZ2VzLmxlbmd0aCAtIDV9IG1vcmVgIDogJyd9YCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwdWJsaWMgaXNWYWxpZEN1c3RvbVBhZ2VDb25maWcodmFsdWU6IHVua25vd24pOiB2YWx1ZSBpcyBDdXN0b21QYWdlT3B0aW9ucyB7XG4gICAgICAgIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlO1xuXG4gICAgICAgIGNvbnN0IGNvbmZpZyA9IHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgICAgICBpZiAoISgncGFnZVR5cGUnIGluIGNvbmZpZykgfHwgISgncGFnZVRpdGxlJyBpbiBjb25maWcpKSByZXR1cm4gZmFsc2U7XG5cbiAgICAgICAgY29uc3QgcGFnZVR5cGUgPSBjb25maWcucGFnZVR5cGU7XG4gICAgICAgIGlmIChwYWdlVHlwZSA9PT0gJ2xpc3QnKSB7XG4gICAgICAgICAgICByZXR1cm4gJ2xpc3RQYWdlQ29uZmlnJyBpbiBjb25maWc7XG4gICAgICAgIH0gZWxzZSBpZiAocGFnZVR5cGUgPT09ICdmb3JtJykge1xuICAgICAgICAgICAgcmV0dXJuICdmb3JtUGFnZUNvbmZpZycgaW4gY29uZmlnO1xuICAgICAgICB9IGVsc2UgaWYgKHBhZ2VUeXBlID09PSAnZGV0YWlscycpIHtcbiAgICAgICAgICAgIHJldHVybiAnZGV0YWlsc1BhZ2VDb25maWcnIGluIGNvbmZpZztcbiAgICAgICAgfSBlbHNlIGlmIChwYWdlVHlwZSA9PT0gJ2Rhc2hib2FyZCcpIHtcbiAgICAgICAgICAgIHJldHVybiAnZGFzaGJvYXJkUGFnZUNvbmZpZycgaW4gY29uZmlnO1xuICAgICAgICB9IGVsc2UgaWYgKHBhZ2VUeXBlID09PSAnYWNjb3JkaW9uJykge1xuICAgICAgICAgICAgcmV0dXJuICdhY2NvcmRpb25QYWdlQ29uZmlnJyBpbiBjb25maWc7XG4gICAgICAgIH0gZWxzZSBpZiAocGFnZVR5cGUgPT09ICdtZW51Jykge1xuICAgICAgICAgICAgcmV0dXJuICdtZW51UGFnZUNvbmZpZycgaW4gY29uZmlnO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGdldFBhZ2VOYW1lRnJvbUNvbmZpZyhjb25maWc6IEN1c3RvbVBhZ2VPcHRpb25zKTogc3RyaW5nIHwgbnVsbCB7XG4gICAgICAgIGlmIChjb25maWcucGFnZU5hbWUpIHtcbiAgICAgICAgICAgIHJldHVybiB0b1NsdWcoY29uZmlnLnBhZ2VOYW1lKTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgLy8gRm9yIHRlbXBsYXRlLWJhc2VkIHBhZ2UgdGl0bGVzIChvYmplY3RzKSwgcGFnZU5hbWUgTVVTVCBiZSBwcm92aWRlZFxuICAgICAgICAvLyBFeHRyYWN0IHN0cmluZyBmcm9tIHBhZ2VUaXRsZSAoaGFuZGxlcyBib3RoIHN0cmluZyBhbmQgVGVtcGxhdGUgdHlwZXMpXG4gICAgICAgIGNvbnN0IHBhZ2VUaXRsZVN0cmluZyA9IHR5cGVvZiBjb25maWcucGFnZVRpdGxlID09PSAnc3RyaW5nJyBcbiAgICAgICAgICAgID8gY29uZmlnLnBhZ2VUaXRsZSBcbiAgICAgICAgICAgIDogJ2N1c3RvbS1wYWdlJzsgLy8gRmFsbGJhY2sgZm9yIFRlbXBsYXRlIG9iamVjdHNcbiAgICAgICAgXG4gICAgICAgIHN3aXRjaCAoY29uZmlnLnBhZ2VUeXBlKSB7XG4gICAgICAgICAgICBjYXNlICdsaXN0JzpcbiAgICAgICAgICAgICAgICByZXR1cm4gYGxpc3QtJHt0b1NsdWcocGFnZVRpdGxlU3RyaW5nKX1gO1xuICAgICAgICAgICAgY2FzZSAnZm9ybSc6XG4gICAgICAgICAgICAgICAgcmV0dXJuIHBhZ2VUaXRsZVN0cmluZy50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKCdhZGQnKVxuICAgICAgICAgICAgICAgICAgICA/IGBjcmVhdGUtJHt0b1NsdWcocGFnZVRpdGxlU3RyaW5nKX1gXG4gICAgICAgICAgICAgICAgICAgIDogYGVkaXQtJHt0b1NsdWcocGFnZVRpdGxlU3RyaW5nKX1gO1xuICAgICAgICAgICAgY2FzZSAnZGV0YWlscyc6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGB2aWV3LSR7dG9TbHVnKHBhZ2VUaXRsZVN0cmluZyl9YDtcbiAgICAgICAgICAgIGNhc2UgJ2Rhc2hib2FyZCc6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGAke3RvU2x1ZyhwYWdlVGl0bGVTdHJpbmcpfWA7XG4gICAgICAgICAgICBjYXNlICdhY2NvcmRpb24nOlxuICAgICAgICAgICAgICAgIHJldHVybiBgYWNjb3JkaW9uLSR7dG9TbHVnKHBhZ2VUaXRsZVN0cmluZyl9YDtcbiAgICAgICAgICAgIGNhc2UgJ21lbnUnOlxuICAgICAgICAgICAgICAgIHJldHVybiBgJHt0b1NsdWcocGFnZVRpdGxlU3RyaW5nKX1gO1xuICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJlZ2lzdGVyIGEgY3VzdG9tIHBhZ2UuIFN1cHBvcnRzIG9wdGlvbmFsIHJvdXRlUGF0dGVybiBmb3IgZHluYW1pYyByb3V0ZXMgKGUuZy4sIC9hdXRob3IvOmF1dGhvcklkL2Jvb2tzKVxuICAgICAqL1xuICAgIHB1YmxpYyByZWdpc3RlckN1c3RvbVBhZ2Uob3B0aW9uczogQ3VzdG9tUGFnZU9wdGlvbnMpIHtcbiAgICAgICAgY29uc3QgcGFnZU5hbWUgPSB0aGlzLmdldFBhZ2VOYW1lRnJvbUNvbmZpZyhvcHRpb25zKTtcbiAgICAgICAgaWYgKHBhZ2VOYW1lKSB7XG4gICAgICAgICAgICB0aGlzLmN1c3RvbVBhZ2VzLnNldChwYWdlTmFtZSwgb3B0aW9ucyk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBhc3luYyBydW4oKSB7XG4gICAgICAgIHRoaXMucHJvY2VzcygpO1xuICAgIH1cblxuICAgIEBMb2dEdXJhdGlvbigpXG4gICAgYXN5bmMgcHJvY2VzcygpIHtcbiAgICAgICAgY29uc3QgbWVudUNvbmZpZ3M6IGFueVtdID0gW107XG4gICAgICAgIGNvbnN0IGVudGl0eUNvbmZpZ3M6IGFueSA9IHt9O1xuXG4gICAgICAgIGNvbnN0IHNlcnZpY2VEaXJlY3RvcmllcyA9IHRoaXMucHJlcGFyZVNlcnZpY2VzRGlyZWN0b3JpZXMoKTtcblxuICAgICAgICBjb25zdCBzZXJ2aWNlcyA9IGF3YWl0IHRoaXMuc2NhbkFuZExvYWRTZXJ2aWNlcyhzZXJ2aWNlRGlyZWN0b3JpZXMpO1xuXG4gICAgICAgIC8vIFNjYW4gYW5kIGxvYWQgY3VzdG9tIHBhZ2VzXG4gICAgICAgIGF3YWl0IHRoaXMuc2NhbkN1c3RvbVBhZ2VzKCk7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFVpLWNvbmZpZy1nZW46OjogUHJvY2Vzczo6OiBhbGwtc2VydmljZXM6IGAsIEFycmF5LmZyb20oc2VydmljZXMua2V5cygpKSk7XG5cbiAgICAgICAgLy8gR2V0IGdsb2JhbCBVSSBjb25maWcgb3B0aW9ucyAoaW5jbHVkaW5nIGR1cGxpY2F0ZWRGaWVsZERldGVjdGlvbilcbiAgICAgICAgY29uc3QgZ2xvYmFsVUlDb25maWdPcHRpb25zID0gRncyNC5nZXRJbnN0YW5jZSgpLmdldENvbmZpZygpLnVpQ29uZmlnR2VuT3B0aW9ucztcbiAgICAgICAgXG4gICAgICAgIGxldCBtZW51SW5kZXggPSAxO1xuICAgICAgICAvLyBnZW5lcmF0ZSBVSSBjb25maWdzXG4gICAgICAgIHNlcnZpY2VzLmZvckVhY2goKHNlcnZpY2UsIGVudGl0eU5hbWUpID0+IHtcblxuICAgICAgICAgICAgbGV0IGVudGl0eVNjaGVtYSA9IHNlcnZpY2UuZ2V0RW50aXR5U2NoZW1hKCkgYXMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+O1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBDaGVjayBmb3IgZGVwcmVjYXRlZCB1c2FnZSBhbmQgd2FyblxuICAgICAgICAgICAgdGhpcy5jaGVja0RlcHJlY2F0ZWRVc2FnZShlbnRpdHlTY2hlbWEpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBUcmFuc2Zvcm0gbGVnYWN5IGNvbmZpZyBzdHJ1Y3R1cmUgdG8gbmV3IG5lc3RlZCBzdHJ1Y3R1cmUgaWYgbmVlZGVkXG4gICAgICAgICAgICBlbnRpdHlTY2hlbWEgPSB0aGlzLnRyYW5zZm9ybUxlZ2FjeUNvbmZpZyhlbnRpdHlTY2hlbWEpO1xuICAgICAgICAgICAgY29uc3QgZW50aXR5RGVmYXVsdE9wc1NjaGVtYSA9IHNlcnZpY2UuZ2V0T3BzRGVmYXVsdElPU2NoZW1hKCk7XG5cbiAgICAgICAgICAgIGlmICghZW50aXR5U2NoZW1hLm1vZGVsLmV4Y2x1ZGVGcm9tQWRtaW5DcmVhdGUpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBjcmVhdGVDb25maWcgPSBNYWtlQ3JlYXRlRW50aXR5Q29uZmlnKHtcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZVBsdXJhbDogZW50aXR5U2NoZW1hLm1vZGVsLmVudGl0eU5hbWVQbHVyYWwsXG4gICAgICAgICAgICAgICAgICAgIENSVURBcGlQYXRoOiBlbnRpdHlTY2hlbWEubW9kZWwuQ1JVREFwaVBhdGgsXG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IGVudGl0eURlZmF1bHRPcHNTY2hlbWEuY3JlYXRlLmlucHV0LFxuICAgICAgICAgICAgICAgICAgICAvLyBVc2UgbmV3IG5lc3RlZCBjb25maWcgaWYgYXZhaWxhYmxlLCBmYWxsYmFjayB0byBvbGRcbiAgICAgICAgICAgICAgICAgICAgYnJlYWRjcnVtYnM6IGVudGl0eVNjaGVtYS5tb2RlbC5jcmVhdGVQYWdlQ29uZmlnPy5icmVhZGNydW1icyB8fCBlbnRpdHlTY2hlbWEubW9kZWwuY3JlYXRlUGFnZUJyZWFkY3J1bWJzLFxuICAgICAgICAgICAgICAgICAgICBjb2x1bW5zQ29uZmlnOiBlbnRpdHlTY2hlbWEubW9kZWwuY3JlYXRlUGFnZUNvbmZpZz8uY29sdW1uc0NvbmZpZyB8fCBlbnRpdHlTY2hlbWEubW9kZWwuY3JlYXRlUGFnZUNvbHVtbnNDb25maWcsXG4gICAgICAgICAgICAgICAgICAgIGZvcm1Db25maWc6IGVudGl0eVNjaGVtYS5tb2RlbC5jcmVhdGVQYWdlQ29uZmlnPy5mb3JtQ29uZmlnLFxuICAgICAgICAgICAgICAgIH0sIHNlcnZpY2UpO1xuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ3NbIGBjcmVhdGUtJHtlbnRpdHlOYW1lLnRvTG93ZXJDYXNlKCl9YCBdID0gY3JlYXRlQ29uZmlnO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoIWVudGl0eVNjaGVtYS5tb2RlbC5leGNsdWRlRnJvbUFkbWluVXBkYXRlKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgdXBkYXRlQ29uZmlnID0gTWFrZVVwZGF0ZUVudGl0eUNvbmZpZyh7XG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWVQbHVyYWw6IGVudGl0eVNjaGVtYS5tb2RlbC5lbnRpdHlOYW1lUGx1cmFsLFxuICAgICAgICAgICAgICAgICAgICBDUlVEQXBpUGF0aDogZW50aXR5U2NoZW1hLm1vZGVsLkNSVURBcGlQYXRoLFxuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiBlbnRpdHlEZWZhdWx0T3BzU2NoZW1hLnVwZGF0ZS5pbnB1dCxcbiAgICAgICAgICAgICAgICAgICAgLy8gVXNlIG5ldyBuZXN0ZWQgY29uZmlnIGlmIGF2YWlsYWJsZSwgZmFsbGJhY2sgdG8gb2xkXG4gICAgICAgICAgICAgICAgICAgIGFjdGlvbnM6IGVudGl0eVNjaGVtYS5tb2RlbC5lZGl0UGFnZUNvbmZpZz8uYWN0aW9ucyB8fCBlbnRpdHlTY2hlbWEubW9kZWwuZWRpdFBhZ2VBY3Rpb25zLFxuICAgICAgICAgICAgICAgICAgICBicmVhZGNydW1iczogZW50aXR5U2NoZW1hLm1vZGVsLmVkaXRQYWdlQ29uZmlnPy5icmVhZGNydW1icyB8fCBlbnRpdHlTY2hlbWEubW9kZWwuZWRpdFBhZ2VCcmVhZGNydW1icyxcbiAgICAgICAgICAgICAgICAgICAgY29sdW1uc0NvbmZpZzogZW50aXR5U2NoZW1hLm1vZGVsLmVkaXRQYWdlQ29uZmlnPy5jb2x1bW5zQ29uZmlnIHx8IGVudGl0eVNjaGVtYS5tb2RlbC5lZGl0UGFnZUNvbHVtbnNDb25maWcsXG4gICAgICAgICAgICAgICAgICAgIGZvcm1Db25maWc6IGVudGl0eVNjaGVtYS5tb2RlbC5lZGl0UGFnZUNvbmZpZz8uZm9ybUNvbmZpZyxcbiAgICAgICAgICAgICAgICB9LCBzZXJ2aWNlKTtcbiAgICAgICAgICAgICAgICBlbnRpdHlDb25maWdzWyBgZWRpdC0ke2VudGl0eU5hbWUudG9Mb3dlckNhc2UoKX1gIF0gPSB1cGRhdGVDb25maWc7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICghZW50aXR5U2NoZW1hLm1vZGVsLmV4Y2x1ZGVGcm9tQWRtaW5MaXN0KSB7XG4gICAgICAgICAgICAgICAgY29uc3QgbGlzdENvbmZpZyA9IE1ha2VMaXN0RW50aXR5Q29uZmlnKHtcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZVBsdXJhbDogZW50aXR5U2NoZW1hLm1vZGVsLmVudGl0eU5hbWVQbHVyYWwsXG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IGVudGl0eURlZmF1bHRPcHNTY2hlbWEubGlzdC5vdXRwdXQsXG4gICAgICAgICAgICAgICAgICAgIENSVURBcGlQYXRoOiBlbnRpdHlTY2hlbWEubW9kZWwuQ1JVREFwaVBhdGgsXG4gICAgICAgICAgICAgICAgICAgIHVzZVNlYXJjaDogQm9vbGVhbihlbnRpdHlTY2hlbWEubW9kZWwuc2VhcmNoPy5lbmFibGVkKSxcbiAgICAgICAgICAgICAgICAgICAgZXhjbHVkZUZyb21BZG1pbkNyZWF0ZTogZW50aXR5U2NoZW1hLm1vZGVsLmV4Y2x1ZGVGcm9tQWRtaW5DcmVhdGUsXG4gICAgICAgICAgICAgICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5VcGRhdGU6IGVudGl0eVNjaGVtYS5tb2RlbC5leGNsdWRlRnJvbUFkbWluVXBkYXRlLFxuICAgICAgICAgICAgICAgICAgICBleGNsdWRlRnJvbUFkbWluRGVsZXRlOiBlbnRpdHlTY2hlbWEubW9kZWwuZXhjbHVkZUZyb21BZG1pbkRlbGV0ZSxcbiAgICAgICAgICAgICAgICAgICAgZXhjbHVkZUZyb21BZG1pbkRldGFpbDogZW50aXR5U2NoZW1hLm1vZGVsLmV4Y2x1ZGVGcm9tQWRtaW5EZXRhaWwsXG4gICAgICAgICAgICAgICAgICAgIC8vIFVzZSBuZXcgbmVzdGVkIGNvbmZpZyBpZiBhdmFpbGFibGUsIGZhbGxiYWNrIHRvIG9sZFxuICAgICAgICAgICAgICAgICAgICBwYWdlSGVhZGVyQWN0aW9uczogZW50aXR5U2NoZW1hLm1vZGVsLmxpc3RQYWdlQ29uZmlnPy5hY3Rpb25zIHx8IGVudGl0eVNjaGVtYS5tb2RlbC5saXN0UGFnZUFjdGlvbnMsXG4gICAgICAgICAgICAgICAgICAgIGJyZWFkY3J1bWJzOiBlbnRpdHlTY2hlbWEubW9kZWwubGlzdFBhZ2VDb25maWc/LmJyZWFkY3J1bWJzIHx8IGVudGl0eVNjaGVtYS5tb2RlbC5saXN0UGFnZUJyZWFkY3J1bWJzLFxuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0U29ydDogZW50aXR5U2NoZW1hLm1vZGVsLmxpc3RQYWdlQ29uZmlnPy5kZWZhdWx0U29ydCB8fCBlbnRpdHlTY2hlbWEubW9kZWwubGlzdFBhZ2VEZWZhdWx0U29ydCxcbiAgICAgICAgICAgICAgICAgICAgdGFibGVDb25maWc6IGVudGl0eVNjaGVtYS5tb2RlbC5saXN0UGFnZUNvbmZpZz8udGFibGVDb25maWcsXG4gICAgICAgICAgICAgICAgICAgIGdsb2JhbFVJQ29uZmlnT3B0aW9ucywgIC8vIE5FVzogUGFzcyBnbG9iYWwgY29uZmlnXG4gICAgICAgICAgICAgICAgfSwgc2VydmljZSk7XG4gICAgICAgICAgICAgICAgZW50aXR5Q29uZmlnc1sgYGxpc3QtJHtlbnRpdHlOYW1lLnRvTG93ZXJDYXNlKCl9YCBdID0gbGlzdENvbmZpZztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKCFlbnRpdHlTY2hlbWEubW9kZWwuZXhjbHVkZUZyb21BZG1pbkRldGFpbCkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHZpZXdDb25maWcgPSBNYWtlVmlld0VudGl0eUNvbmZpZyh7XG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWVQbHVyYWw6IGVudGl0eVNjaGVtYS5tb2RlbC5lbnRpdHlOYW1lUGx1cmFsLFxuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiBlbnRpdHlEZWZhdWx0T3BzU2NoZW1hLmdldC5vdXRwdXQsXG4gICAgICAgICAgICAgICAgICAgIENSVURBcGlQYXRoOiBlbnRpdHlTY2hlbWEubW9kZWwuQ1JVREFwaVBhdGgsXG4gICAgICAgICAgICAgICAgICAgIC8vIFVzZSBuZXcgbmVzdGVkIGNvbmZpZyBpZiBhdmFpbGFibGUsIGZhbGxiYWNrIHRvIG9sZFxuICAgICAgICAgICAgICAgICAgICBhY3Rpb25zOiBlbnRpdHlTY2hlbWEubW9kZWwudmlld1BhZ2VDb25maWc/LmFjdGlvbnMgfHwgZW50aXR5U2NoZW1hLm1vZGVsLnZpZXdQYWdlQWN0aW9ucyxcbiAgICAgICAgICAgICAgICAgICAgYnJlYWRjcnVtYnM6IGVudGl0eVNjaGVtYS5tb2RlbC52aWV3UGFnZUNvbmZpZz8uYnJlYWRjcnVtYnMgfHwgZW50aXR5U2NoZW1hLm1vZGVsLnZpZXdQYWdlQnJlYWRjcnVtYnMsXG4gICAgICAgICAgICAgICAgICAgIGNvbHVtbnNDb25maWc6IGVudGl0eVNjaGVtYS5tb2RlbC52aWV3UGFnZUNvbmZpZz8uY29sdW1uc0NvbmZpZyB8fCBlbnRpdHlTY2hlbWEubW9kZWwudmlld1BhZ2VDb2x1bW5zQ29uZmlnLFxuICAgICAgICAgICAgICAgICAgICBmaWVsZHM6IGVudGl0eVNjaGVtYS5tb2RlbC52aWV3UGFnZUNvbmZpZz8uZmllbGRzLFxuICAgICAgICAgICAgICAgICAgICBzZWN0aW9uc0NvbmZpZzogZW50aXR5U2NoZW1hLm1vZGVsLnZpZXdQYWdlQ29uZmlnPy5zZWN0aW9uc0NvbmZpZyxcbiAgICAgICAgICAgICAgICAgICAgZ2xvYmFsVUlDb25maWdPcHRpb25zLCAgLy8gTkVXOiBQYXNzIGdsb2JhbCBjb25maWdcbiAgICAgICAgICAgICAgICB9LCBzZXJ2aWNlKTtcbiAgICAgICAgICAgICAgICBlbnRpdHlDb25maWdzWyBgdmlldy0ke2VudGl0eU5hbWUudG9Mb3dlckNhc2UoKX1gIF0gPSB2aWV3Q29uZmlnO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoIWVudGl0eVNjaGVtYS5tb2RlbC5leGNsdWRlRnJvbUFkbWluTWVudSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IG1lbnVDb25maWcgPSBNYWtlRW50aXR5TWVudUNvbmZpZyh7XG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWVQbHVyYWw6IGVudGl0eVNjaGVtYS5tb2RlbC5lbnRpdHlOYW1lUGx1cmFsLFxuICAgICAgICAgICAgICAgICAgICBpY29uOiBlbnRpdHlTY2hlbWEubW9kZWwuZW50aXR5TWVudUljb24gfHwgJ2FwcFN0b3JlJyxcbiAgICAgICAgICAgICAgICAgICAgbWVudUluZGV4OiBtZW51SW5kZXgrKyxcbiAgICAgICAgICAgICAgICAgICAgZXhjbHVkZUZyb21BZG1pbkxpc3Q6IGVudGl0eVNjaGVtYS5tb2RlbC5leGNsdWRlRnJvbUFkbWluTGlzdCxcbiAgICAgICAgICAgICAgICAgICAgZXhjbHVkZUZyb21BZG1pbkNyZWF0ZTogZW50aXR5U2NoZW1hLm1vZGVsLmV4Y2x1ZGVGcm9tQWRtaW5DcmVhdGUsXG4gICAgICAgICAgICAgICAgICAgIG1lbnVHcm91cDogZW50aXR5U2NoZW1hLm1vZGVsLm1lbnVHcm91cCxcbiAgICAgICAgICAgICAgICAgICAgbWVudU9yZGVyOiBlbnRpdHlTY2hlbWEubW9kZWwubWVudU9yZGVyLFxuICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgbWVudUNvbmZpZ3MucHVzaChtZW51Q29uZmlnKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBQcm9jZXNzIGN1c3RvbSBwYWdlc1xuICAgICAgICBmb3IgKGNvbnN0IFsgcGFnZU5hbWUsIG9wdGlvbnMgXSBvZiB0aGlzLmN1c3RvbVBhZ2VzKSB7XG4gICAgICAgICAgICAvLyBza2lwIHRoZSBkZWZhdWx0IGRhc2hib2FyZCBwYWdlIGFuZCBtZW51IHBhZ2VcbiAgICAgICAgICAgIGlmIChwYWdlTmFtZSA9PT0gJ2Rhc2hib2FyZCcgfHwgcGFnZU5hbWUgPT09ICdtZW51Jykge1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29uc3QgY3VzdG9tQ29uZmlnID0gbWFrZUN1c3RvbVBhZ2VDb25maWcob3B0aW9ucyk7XG4gICAgICAgICAgICBlbnRpdHlDb25maWdzWyBwYWdlTmFtZSBdID0gY3VzdG9tQ29uZmlnO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgYXV0aENvbmZpZ09wdGlvbnMgPSBGdzI0LmdldEluc3RhbmNlKCkuZ2V0Q29uZmlnKCkudWlDb25maWdHZW5PcHRpb25zIHx8IHt9O1xuXG4gICAgICAgIGNvbnN0IGF1dGhDb25maWdzID0gTWFrZUF1dGhDb25maWcoe1xuICAgICAgICAgICAgLi4uYXV0aENvbmZpZ09wdGlvbnMsXG4gICAgICAgICAgICBhdXRoRW5kcG9pbnQ6IGF1dGhDb25maWdPcHRpb25zLmF1dGhFbmRwb2ludCB8fCAnbWF1dGgnXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIExvb2sgZm9yIGEgZGFzaGJvYXJkIGN1c3RvbSBwYWdlXG4gICAgICAgIGxldCBkYXNoYm9hcmRDb25maWc6IERhc2hib2FyZFBhZ2VDb25maWcgfCBhbnkgPSBudWxsO1xuICAgICAgICBmb3IgKGNvbnN0IFsgLCBvcHRpb25zIF0gb2YgdGhpcy5jdXN0b21QYWdlcykge1xuICAgICAgICAgICAgLy8gQ2hlY2sgaWYgdGhpcyBpcyBhIGRhc2hib2FyZCBwYWdlIC0gaGFuZGxlIGJvdGggc3RyaW5nIGFuZCBUZW1wbGF0ZSBwYWdlVGl0bGVcbiAgICAgICAgICAgIGNvbnN0IHBhZ2VUaXRsZVN0ciA9IHR5cGVvZiBvcHRpb25zLnBhZ2VUaXRsZSA9PT0gJ3N0cmluZycgPyBvcHRpb25zLnBhZ2VUaXRsZSA6ICcnO1xuICAgICAgICAgICAgaWYgKG9wdGlvbnMucGFnZVR5cGUgPT09ICdkYXNoYm9hcmQnICYmIHBhZ2VUaXRsZVN0ci50b0xvd2VyQ2FzZSgpID09PSAnZGFzaGJvYXJkJykge1xuICAgICAgICAgICAgICAgIGRhc2hib2FyZENvbmZpZyA9IG9wdGlvbnM7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFkYXNoYm9hcmRDb25maWcpIHtcbiAgICAgICAgICAgIGRhc2hib2FyZENvbmZpZyA9IE1ha2VEYXNoYm9hcmRDb25maWcoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIExvb2sgZm9yIGEgbWVudSBjdXN0b20gcGFnZVxuICAgICAgICBsZXQgbWVudUNvbmZpZzogYW55ID0gbnVsbDtcbiAgICAgICAgZm9yIChjb25zdCBbIHBhZ2VOYW1lLCBvcHRpb25zIF0gb2YgdGhpcy5jdXN0b21QYWdlcykge1xuICAgICAgICAgICAgLy8gQ2hlY2sgaWYgdGhpcyBpcyBhIG1lbnUgcGFnZSAtIGhhbmRsZSBib3RoIHN0cmluZyBhbmQgVGVtcGxhdGUgcGFnZVRpdGxlXG4gICAgICAgICAgICBjb25zdCBwYWdlVGl0bGVTdHIgPSB0eXBlb2Ygb3B0aW9ucy5wYWdlVGl0bGUgPT09ICdzdHJpbmcnID8gb3B0aW9ucy5wYWdlVGl0bGUgOiAnJztcbiAgICAgICAgICAgIGlmIChvcHRpb25zLnBhZ2VUeXBlID09PSAnbWVudScgJiYgcGFnZVRpdGxlU3RyLnRvTG93ZXJDYXNlKCkgPT09ICdtZW51Jykge1xuICAgICAgICAgICAgICAgIG1lbnVDb25maWcgPSBvcHRpb25zO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gR3JvdXAgbWVudSBpdGVtcyBieSB0aGVpciBncm91cCBwcm9wZXJ0eVxuICAgICAgICBjb25zdCBtZW51R3JvdXBzID0gbmV3IE1hcDxzdHJpbmcsIGFueVtdPigpO1xuICAgICAgICBjb25zdCB1bmdyb3VwZWRJdGVtczogYW55W10gPSBbXTtcblxuICAgICAgICAvLyBQcm9jZXNzIGVudGl0eSBtZW51IGl0ZW1zXG4gICAgICAgIG1lbnVDb25maWdzLmZvckVhY2goaXRlbSA9PiB7XG4gICAgICAgICAgICBpZiAoaXRlbS5ncm91cCkge1xuICAgICAgICAgICAgICAgIGlmICghbWVudUdyb3Vwcy5oYXMoaXRlbS5ncm91cCkpIHtcbiAgICAgICAgICAgICAgICAgICAgbWVudUdyb3Vwcy5zZXQoaXRlbS5ncm91cCwgW10pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBtZW51R3JvdXBzLmdldChpdGVtLmdyb3VwKSEucHVzaChpdGVtKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdW5ncm91cGVkSXRlbXMucHVzaChpdGVtKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gUHJvY2VzcyBjdXN0b20gbWVudSBpdGVtc1xuICAgICAgICBpZiAobWVudUNvbmZpZz8ubWVudVBhZ2VDb25maWc/Lm1lbnVJdGVtcykge1xuICAgICAgICAgICAgbWVudUNvbmZpZy5tZW51UGFnZUNvbmZpZy5tZW51SXRlbXMuZm9yRWFjaCgoaXRlbTogYW55KSA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKGl0ZW0uZ3JvdXApIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFtZW51R3JvdXBzLmhhcyhpdGVtLmdyb3VwKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgbWVudUdyb3Vwcy5zZXQoaXRlbS5ncm91cCwgW10pO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIG1lbnVHcm91cHMuZ2V0KGl0ZW0uZ3JvdXApIS5wdXNoKGl0ZW0pO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHVuZ3JvdXBlZEl0ZW1zLnB1c2goaXRlbSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDcmVhdGUgZmluYWwgbWVudSBzdHJ1Y3R1cmVcbiAgICAgICAgY29uc3QgYWxsTWVudUl0ZW1zOiBhbnlbXSA9IFtdO1xuXG4gICAgICAgIC8vIEFkZCB1bmdyb3VwZWQgaXRlbXMgZmlyc3QgKHByaW1hcnkgbmF2aWdhdGlvbilcbiAgICAgICAgYWxsTWVudUl0ZW1zLnB1c2goLi4udW5ncm91cGVkSXRlbXMpO1xuXG4gICAgICAgIC8vIEFkZCBncm91cGVkIGl0ZW1zXG4gICAgICAgIG1lbnVHcm91cHMuZm9yRWFjaCgoaXRlbXMsIGdyb3VwTmFtZSkgPT4ge1xuICAgICAgICAgICAgLy8gU29ydCBpdGVtcyB3aXRoaW4gZ3JvdXAgYnkgb3JkZXJcbiAgICAgICAgICAgIGl0ZW1zLnNvcnQoKGEsIGIpID0+IChhLm9yZGVyIHx8IDApIC0gKGIub3JkZXIgfHwgMCkpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBDcmVhdGUgZ3JvdXAgaXRlbVxuICAgICAgICAgICAgYWxsTWVudUl0ZW1zLnB1c2goe1xuICAgICAgICAgICAgICAgIGxhYmVsOiBncm91cE5hbWUsXG4gICAgICAgICAgICAgICAga2V5OiBgZ3JvdXAtJHtncm91cE5hbWV9YCxcbiAgICAgICAgICAgICAgICBpY29uOiAnRm9sZGVyT3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIGNoaWxkcmVuOiBpdGVtc1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGF3YWl0IHRoaXMud3JpdGVUb0ZpbGVzKGFsbE1lbnVJdGVtcywgZW50aXR5Q29uZmlncywgYXV0aENvbmZpZ3MsIGRhc2hib2FyZENvbmZpZyk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogVHJhbnNmb3JtIGxlZ2FjeSBmbGF0IGNvbmZpZyBzdHJ1Y3R1cmUgdG8gbmV3IG5lc3RlZCBzdHJ1Y3R1cmVcbiAgICAgKiBTdXBwb3J0cyBiYWNrd2FyZCBjb21wYXRpYmlsaXR5IGJ5IHRyYW5zZm9ybWluZyBvbGQgcHJvcGVydGllcyB0byBuZXcgZm9ybWF0XG4gICAgICovXG4gICAgcHJpdmF0ZSB0cmFuc2Zvcm1MZWdhY3lDb25maWcoc2NoZW1hOiBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4pOiBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4ge1xuICAgICAgICBjb25zdCBtb2RlbCA9IHNjaGVtYS5tb2RlbDtcbiAgICAgICAgXG4gICAgICAgIC8vIElmIGFscmVhZHkgdXNpbmcgbmV3IGZvcm1hdCwgcmV0dXJuIGFzLWlzXG4gICAgICAgIGlmIChtb2RlbC5saXN0UGFnZUNvbmZpZyB8fCBtb2RlbC52aWV3UGFnZUNvbmZpZyB8fCBtb2RlbC5lZGl0UGFnZUNvbmZpZyB8fCBtb2RlbC5jcmVhdGVQYWdlQ29uZmlnKSB7XG4gICAgICAgICAgICByZXR1cm4gc2NoZW1hO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICAvLyBUcmFuc2Zvcm0gb2xkIGZvcm1hdCB0byBuZXcgbmVzdGVkIHN0cnVjdHVyZVxuICAgICAgICBjb25zdCB0cmFuc2Zvcm1lZE1vZGVsID0ge1xuICAgICAgICAgICAgLi4ubW9kZWwsXG4gICAgICAgICAgICAvLyBMaXN0IHBhZ2UgdHJhbnNmb3JtYXRpb25cbiAgICAgICAgICAgIGxpc3RQYWdlQ29uZmlnOiAobW9kZWwubGlzdFBhZ2VBY3Rpb25zIHx8IG1vZGVsLmxpc3RQYWdlQnJlYWRjcnVtYnMgfHwgbW9kZWwubGlzdFBhZ2VEZWZhdWx0U29ydClcbiAgICAgICAgICAgICAgICA/IHtcbiAgICAgICAgICAgICAgICAgICAgYWN0aW9uczogbW9kZWwubGlzdFBhZ2VBY3Rpb25zLFxuICAgICAgICAgICAgICAgICAgICBicmVhZGNydW1iczogbW9kZWwubGlzdFBhZ2VCcmVhZGNydW1icyxcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdFNvcnQ6IG1vZGVsLmxpc3RQYWdlRGVmYXVsdFNvcnRcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgOiB1bmRlZmluZWQsXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIFZpZXcgcGFnZSB0cmFuc2Zvcm1hdGlvblxuICAgICAgICAgICAgdmlld1BhZ2VDb25maWc6IChtb2RlbC52aWV3UGFnZUFjdGlvbnMgfHwgbW9kZWwudmlld1BhZ2VCcmVhZGNydW1icyB8fCBtb2RlbC52aWV3UGFnZUNvbHVtbnNDb25maWcpXG4gICAgICAgICAgICAgICAgPyB7XG4gICAgICAgICAgICAgICAgICAgIGFjdGlvbnM6IG1vZGVsLnZpZXdQYWdlQWN0aW9ucyxcbiAgICAgICAgICAgICAgICAgICAgYnJlYWRjcnVtYnM6IG1vZGVsLnZpZXdQYWdlQnJlYWRjcnVtYnMsXG4gICAgICAgICAgICAgICAgICAgIGNvbHVtbnNDb25maWc6IG1vZGVsLnZpZXdQYWdlQ29sdW1uc0NvbmZpZ1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICA6IHVuZGVmaW5lZCxcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gRWRpdCBwYWdlIHRyYW5zZm9ybWF0aW9uXG4gICAgICAgICAgICBlZGl0UGFnZUNvbmZpZzogKG1vZGVsLmVkaXRQYWdlQWN0aW9ucyB8fCBtb2RlbC5lZGl0UGFnZUJyZWFkY3J1bWJzIHx8IG1vZGVsLmVkaXRQYWdlQ29sdW1uc0NvbmZpZylcbiAgICAgICAgICAgICAgICA/IHtcbiAgICAgICAgICAgICAgICAgICAgYWN0aW9uczogbW9kZWwuZWRpdFBhZ2VBY3Rpb25zLFxuICAgICAgICAgICAgICAgICAgICBicmVhZGNydW1iczogbW9kZWwuZWRpdFBhZ2VCcmVhZGNydW1icyxcbiAgICAgICAgICAgICAgICAgICAgY29sdW1uc0NvbmZpZzogbW9kZWwuZWRpdFBhZ2VDb2x1bW5zQ29uZmlnXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIDogdW5kZWZpbmVkLFxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBDcmVhdGUgcGFnZSB0cmFuc2Zvcm1hdGlvblxuICAgICAgICAgICAgY3JlYXRlUGFnZUNvbmZpZzogKG1vZGVsLmNyZWF0ZVBhZ2VCcmVhZGNydW1icyB8fCBtb2RlbC5jcmVhdGVQYWdlQ29sdW1uc0NvbmZpZylcbiAgICAgICAgICAgICAgICA/IHtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWRjcnVtYnM6IG1vZGVsLmNyZWF0ZVBhZ2VCcmVhZGNydW1icyxcbiAgICAgICAgICAgICAgICAgICAgY29sdW1uc0NvbmZpZzogbW9kZWwuY3JlYXRlUGFnZUNvbHVtbnNDb25maWdcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgOiB1bmRlZmluZWQsXG4gICAgICAgIH07XG4gICAgICAgIFxuICAgICAgICByZXR1cm4geyAuLi5zY2hlbWEsIG1vZGVsOiB0cmFuc2Zvcm1lZE1vZGVsIH07XG4gICAgfVxuICAgIFxuICAgIC8qKlxuICAgICAqIENoZWNrIGZvciBkZXByZWNhdGVkIGNvbmZpZ3VyYXRpb24gdXNhZ2UgYW5kIGVtaXQgd2FybmluZ3NcbiAgICAgKi9cbiAgICBwcml2YXRlIGNoZWNrRGVwcmVjYXRlZFVzYWdlKHNjaGVtYTogRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+KTogdm9pZCB7XG4gICAgICAgIGNvbnN0IG1vZGVsID0gc2NoZW1hLm1vZGVsO1xuICAgICAgICBjb25zdCB3YXJuaW5nczogc3RyaW5nW10gPSBbXTtcbiAgICAgICAgXG4gICAgICAgIC8vIENoZWNrIGxpc3QgcGFnZSBkZXByZWNhdGVkIGZpZWxkc1xuICAgICAgICBpZiAobW9kZWwubGlzdFBhZ2VBY3Rpb25zKSB7XG4gICAgICAgICAgICB3YXJuaW5ncy5wdXNoKCdsaXN0UGFnZUFjdGlvbnMgaXMgZGVwcmVjYXRlZC4gVXNlIGxpc3RQYWdlQ29uZmlnLmFjdGlvbnMgaW5zdGVhZC4nKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAobW9kZWwubGlzdFBhZ2VCcmVhZGNydW1icykge1xuICAgICAgICAgICAgd2FybmluZ3MucHVzaCgnbGlzdFBhZ2VCcmVhZGNydW1icyBpcyBkZXByZWNhdGVkLiBVc2UgbGlzdFBhZ2VDb25maWcuYnJlYWRjcnVtYnMgaW5zdGVhZC4nKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAobW9kZWwubGlzdFBhZ2VEZWZhdWx0U29ydCkge1xuICAgICAgICAgICAgd2FybmluZ3MucHVzaCgnbGlzdFBhZ2VEZWZhdWx0U29ydCBpcyBkZXByZWNhdGVkLiBVc2UgbGlzdFBhZ2VDb25maWcuZGVmYXVsdFNvcnQgaW5zdGVhZC4nKTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgLy8gQ2hlY2sgdmlldyBwYWdlIGRlcHJlY2F0ZWQgZmllbGRzXG4gICAgICAgIGlmIChtb2RlbC52aWV3UGFnZUFjdGlvbnMpIHtcbiAgICAgICAgICAgIHdhcm5pbmdzLnB1c2goJ3ZpZXdQYWdlQWN0aW9ucyBpcyBkZXByZWNhdGVkLiBVc2Ugdmlld1BhZ2VDb25maWcuYWN0aW9ucyBpbnN0ZWFkLicpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChtb2RlbC52aWV3UGFnZUJyZWFkY3J1bWJzKSB7XG4gICAgICAgICAgICB3YXJuaW5ncy5wdXNoKCd2aWV3UGFnZUJyZWFkY3J1bWJzIGlzIGRlcHJlY2F0ZWQuIFVzZSB2aWV3UGFnZUNvbmZpZy5icmVhZGNydW1icyBpbnN0ZWFkLicpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChtb2RlbC52aWV3UGFnZUNvbHVtbnNDb25maWcpIHtcbiAgICAgICAgICAgIHdhcm5pbmdzLnB1c2goJ3ZpZXdQYWdlQ29sdW1uc0NvbmZpZyBpcyBkZXByZWNhdGVkLiBVc2Ugdmlld1BhZ2VDb25maWcuY29sdW1uc0NvbmZpZyBpbnN0ZWFkLicpO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICAvLyBDaGVjayBlZGl0IHBhZ2UgZGVwcmVjYXRlZCBmaWVsZHNcbiAgICAgICAgaWYgKG1vZGVsLmVkaXRQYWdlQWN0aW9ucykge1xuICAgICAgICAgICAgd2FybmluZ3MucHVzaCgnZWRpdFBhZ2VBY3Rpb25zIGlzIGRlcHJlY2F0ZWQuIFVzZSBlZGl0UGFnZUNvbmZpZy5hY3Rpb25zIGluc3RlYWQuJyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG1vZGVsLmVkaXRQYWdlQnJlYWRjcnVtYnMpIHtcbiAgICAgICAgICAgIHdhcm5pbmdzLnB1c2goJ2VkaXRQYWdlQnJlYWRjcnVtYnMgaXMgZGVwcmVjYXRlZC4gVXNlIGVkaXRQYWdlQ29uZmlnLmJyZWFkY3J1bWJzIGluc3RlYWQuJyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG1vZGVsLmVkaXRQYWdlQ29sdW1uc0NvbmZpZykge1xuICAgICAgICAgICAgd2FybmluZ3MucHVzaCgnZWRpdFBhZ2VDb2x1bW5zQ29uZmlnIGlzIGRlcHJlY2F0ZWQuIFVzZSBlZGl0UGFnZUNvbmZpZy5jb2x1bW5zQ29uZmlnIGluc3RlYWQuJyk7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIC8vIENoZWNrIGNyZWF0ZSBwYWdlIGRlcHJlY2F0ZWQgZmllbGRzXG4gICAgICAgIGlmIChtb2RlbC5jcmVhdGVQYWdlQnJlYWRjcnVtYnMpIHtcbiAgICAgICAgICAgIHdhcm5pbmdzLnB1c2goJ2NyZWF0ZVBhZ2VCcmVhZGNydW1icyBpcyBkZXByZWNhdGVkLiBVc2UgY3JlYXRlUGFnZUNvbmZpZy5icmVhZGNydW1icyBpbnN0ZWFkLicpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChtb2RlbC5jcmVhdGVQYWdlQ29sdW1uc0NvbmZpZykge1xuICAgICAgICAgICAgd2FybmluZ3MucHVzaCgnY3JlYXRlUGFnZUNvbHVtbnNDb25maWcgaXMgZGVwcmVjYXRlZC4gVXNlIGNyZWF0ZVBhZ2VDb25maWcuY29sdW1uc0NvbmZpZyBpbnN0ZWFkLicpO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICAvLyBFbWl0IHdhcm5pbmdzIGlmIGFueSBkZXByZWNhdGVkIGZpZWxkcyBmb3VuZFxuICAgICAgICBpZiAod2FybmluZ3MubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgXFxu4pqg77iPICBFbnRpdHkgXCIke21vZGVsLmVudGl0eX1cIiB1c2VzIGRlcHJlY2F0ZWQgY29uZmlndXJhdGlvbjpgKTtcbiAgICAgICAgICAgIHdhcm5pbmdzLmZvckVhY2godyA9PiB0aGlzLmxvZ2dlci53YXJuKGAgICAtICR7d31gKSk7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGAgICDwn5OWIE1pZ3JhdGlvbiBndWlkZTogaHR0cHM6Ly9kb2NzLmZ3MjQuaW8vbWlncmF0aW9uL25lc3RlZC1jb25maWdcXG5gKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIEBMb2dEdXJhdGlvbigpXG4gICAgcHJlcGFyZVNlcnZpY2VzRGlyZWN0b3JpZXMoKSB7XG4gICAgICAgIGNvbnN0IGZ3MjQgPSBGdzI0LmdldEluc3RhbmNlKCk7XG5cbiAgICAgICAgY29uc3Qgc2VydmljZURpcmVjdG9yaWVzID0gWyBwYXRoUmVzb2x2ZSgnLi9zcmMvc2VydmljZXMvJykgXTtcblxuICAgICAgICBpZiAoZncyNC5oYXNNb2R1bGVzKCkpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBVaS1jb25maWctZ2VuOjo6IFByb2Nlc3M6OjogYXBwIGhhcyBtb2R1bGVzOiBgLCBBcnJheS5mcm9tKGZ3MjQuZ2V0TW9kdWxlcygpLmtleXMoKSkpO1xuICAgICAgICAgICAgZm9yIChjb25zdCBbICwgbW9kdWxlIF0gb2YgZncyNC5nZXRNb2R1bGVzKCkpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBtb2R1bGVTZXJ2aWNlc1BhdGggPSBwYXRoSm9pbihtb2R1bGUuZ2V0QmFzZVBhdGgoKSwgbW9kdWxlLmdldFNlcnZpY2VzRGlyZWN0b3J5KCkpO1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBVaS1jb25maWctZ2VuOjo6IFByb2Nlc3M6OjogbW9kdWxlU2VydmljZXNQYXRoOiBgLCBtb2R1bGVTZXJ2aWNlc1BhdGgpO1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBVaS1jb25maWctZ2VuOjo6IFByb2Nlc3M6OjogcmVzLW1vZHVsZVNlcnZpY2VzUGF0aDogYCwgcGF0aFJlc29sdmUobW9kdWxlU2VydmljZXNQYXRoKSk7XG4gICAgICAgICAgICAgICAgc2VydmljZURpcmVjdG9yaWVzLnB1c2gocGF0aFJlc29sdmUobW9kdWxlU2VydmljZXNQYXRoKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gc2VydmljZURpcmVjdG9yaWVzO1xuICAgIH1cblxuICAgIEBMb2dEdXJhdGlvbigpXG4gICAgYXN5bmMgc2NhbkFuZExvYWRTZXJ2aWNlcyhzZXJ2aWNlRGlyZWN0b3JpZXM6IEFycmF5PHN0cmluZz4pIHtcblxuICAgICAgICBjb25zdCBzY2FubmVkU2VydmljZXMgPSBuZXcgU2V0PEZ1bmN0aW9uPigpO1xuXG4gICAgICAgIGZvciAoY29uc3QgZGlyIG9mIHNlcnZpY2VEaXJlY3Rvcmllcykge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFVpLWNvbmZpZy1nZW46OjogUHJvY2Vzczo6OiBsb2FkaW5nIHNlcnZpY2VzIGZyb20gRElSOiBgLCBkaXIpO1xuICAgICAgICAgICAgY29uc3QgZGlyU2VydmljZVRva2VucyA9IGF3YWl0IHRoaXMuc2NhblNlcnZpY2VzRnJvbURpcmVjdG9yeShkaXIpO1xuICAgICAgICAgICAgZGlyU2VydmljZVRva2Vucy5mb3JFYWNoKHRva2VuID0+IHNjYW5uZWRTZXJ2aWNlcy5hZGQodG9rZW4pKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGdldCBhbGwgY29udGFpbmVyIHJlZ2lzdGVyZWQgc2VydmljZXMgdG8gbWFrZSBzdXJlIGF1dG8tZ2VuIGVudGl0eS1zZXJ2aWNlcyBhcmUgYWxzbyBpbmNsdWRlZFxuICAgICAgICB0aGlzLnVpR2VuRElDb250YWluZXIuY29sbGVjdEJlc3RQcm92aWRlcnNGb3Ioe1xuICAgICAgICAgICAgdHlwZTogJ3NlcnZpY2UnLFxuICAgICAgICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVyczogdHJ1ZVxuICAgICAgICB9KS5maWx0ZXIob3B0ID0+IHtcbiAgICAgICAgICAgIC8vIG1ha2Ugc3VyZSB0byBjb2xsZWN0IG9ubHkgdGhlIGVudGl0eSBzZXJ2aWNlIHByb3ZpZGVyc1xuICAgICAgICAgICAgcmV0dXJuICEhb3B0Ll9wcm92aWRlci5mb3JFbnRpdHlcbiAgICAgICAgfSkuZm9yRWFjaChvcHQgPT4ge1xuICAgICAgICAgICAgc2Nhbm5lZFNlcnZpY2VzLmFkZChvcHQuX3Byb3ZpZGVyLnByb3ZpZGUgYXMgRnVuY3Rpb24pO1xuICAgICAgICB9KVxuXG4gICAgICAgIC8vIHJlc29sdmUgYWxsIHNlcnZpY2VzXG4gICAgICAgIGNvbnN0IHJlc29sdmVkU2VydmljZXMgPSBuZXcgTWFwPHN0cmluZywgQmFzZUVudGl0eVNlcnZpY2U8YW55Pj4oKTtcblxuICAgICAgICBzY2FubmVkU2VydmljZXMuZm9yRWFjaCh0b2tlbiA9PiB7XG4gICAgICAgICAgICBjb25zdCBzZXJ2aWNlID0gdGhpcy51aUdlbkRJQ29udGFpbmVyLnJlc29sdmUodG9rZW4sIHtcbiAgICAgICAgICAgICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzOiB0cnVlXG4gICAgICAgICAgICB9KSBhcyBCYXNlRW50aXR5U2VydmljZTxhbnk+O1xuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgcmVzb2x2ZWQgc2VydmljZSBmb3IgZW50aXR5OiAke3NlcnZpY2UuZ2V0RW50aXR5TmFtZSgpfWApO1xuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgVWktY29uZmlnLWdlbjo6OiBQcm9jZXNzOjo6IGxvYWRlZCBzZXJ2aWNlcyBmcm9tIGVudGl0eTogYCwgc2VydmljZS5nZXRFbnRpdHlOYW1lKCkpO1xuICAgICAgICAgICAgcmVzb2x2ZWRTZXJ2aWNlcy5zZXQoc2VydmljZS5nZXRFbnRpdHlOYW1lKCksIHNlcnZpY2UpO1xuICAgICAgICB9KVxuXG4gICAgICAgIHJldHVybiByZXNvbHZlZFNlcnZpY2VzO1xuICAgIH1cblxuICAgIEBMb2dEdXJhdGlvbigpXG4gICAgYXN5bmMgc2NhblNlcnZpY2VzRnJvbURpcmVjdG9yeShzZXJ2aWNlc0Rpcjogc3RyaW5nKSB7XG5cbiAgICAgICAgY29uc3Qgc2Nhbm5lZFNlcnZpY2VzID0gbmV3IFNldDxGdW5jdGlvbj4oKTtcblxuICAgICAgICBpZiAoIWV4aXN0c1N5bmMoc2VydmljZXNEaXIpKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBzY2FuU2VydmljZXNGcm9tRGlyZWN0b3J5OiBzZXJ2aWNlc0RpciBkb2VzIG5vdCBleGlzdHM6ICR7c2VydmljZXNEaXJ9YCk7XG4gICAgICAgICAgICByZXR1cm4gc2Nhbm5lZFNlcnZpY2VzO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3Qgc2VydmljZVBhdGhzID0gSGVscGVyLnNjYW5Db250cm9sbGVyU291cmNlRmlsZXNGcm9tKHNlcnZpY2VzRGlyKTtcblxuICAgICAgICBmb3IgKGNvbnN0IHNlcnZpY2VQYXRoIG9mIHNlcnZpY2VQYXRocykge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYHRyeWluZyB0byBsb2FkIHNlcnZpY2VQYXRoOiAke3NlcnZpY2VQYXRofWApO1xuXG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIC8vIER5bmFtaWNhbGx5IGltcG9ydCB0aGUgc2VydmljZSBmaWxlXG4gICAgICAgICAgICAgICAgY29uc3QgbW9kdWxlID0gYXdhaXQgaW1wb3J0KHBhdGhKb2luKHNlcnZpY2VzRGlyLCBzZXJ2aWNlUGF0aCkpO1xuXG4gICAgICAgICAgICAgICAgLy8gRmluZCBhbmQgaW5zdGFudGlhdGUgc2VydmljZSBjbGFzc2VzXG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCBleHBvcnRlZEl0ZW0gb2YgT2JqZWN0LnZhbHVlcyhtb2R1bGUpKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChcbiAgICAgICAgICAgICAgICAgICAgICAgIGV4cG9ydGVkSXRlbVxuICAgICAgICAgICAgICAgICAgICAgICAgJiYgdHlwZW9mIGV4cG9ydGVkSXRlbSA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICAgICAgICAgICAgICAgICAgJiYgJ3Byb3RvdHlwZScgaW4gZXhwb3J0ZWRJdGVtXG4gICAgICAgICAgICAgICAgICAgICAgICAmJiBleHBvcnRlZEl0ZW0ucHJvdG90eXBlIGluc3RhbmNlb2YgQmFzZUVudGl0eVNlcnZpY2VcbiAgICAgICAgICAgICAgICAgICAgKSB7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLnVpR2VuRElDb250YWluZXIuaGFzKGV4cG9ydGVkSXRlbSwge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzOiB0cnVlXG4gICAgICAgICAgICAgICAgICAgICAgICB9KSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNjYW5uZWRTZXJ2aWNlcy5hZGQoZXhwb3J0ZWRJdGVtKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1Zyhgc2NhblNlcnZpY2VzRnJvbURpcmVjdG9yeTogcmVnaXN0ZXJpbmcgc2VydmljZTogJHtleHBvcnRlZEl0ZW0ubmFtZX1gKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYHNjYW5TZXJ2aWNlc0Zyb21EaXJlY3Rvcnk6IG5vIHByb3ZpZGVyIGNvdWxkIGJlIGZvdW5kIGZvciBzZXJ2aWNlOiAke2V4cG9ydGVkSXRlbS5uYW1lfWApO1xuXG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBzY2FuU2VydmljZXNGcm9tRGlyZWN0b3J5OiBTS0lQOiBleHBvcnRlZEl0ZW0gaXMgbm90IGEgc2VydmljZSBjbGFzczogJHsoZXhwb3J0ZWRJdGVtIGFzIGFueSk/Lm5hbWUgPyAoZXhwb3J0ZWRJdGVtIGFzIGFueSkubmFtZSA6IGV4cG9ydGVkSXRlbX1gKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgc2NhblNlcnZpY2VzRnJvbURpcmVjdG9yeTogRXhjZXB0aW9uIHdoaWxlIHRyeWluZyB0byBsb2FkIHNlcnZpY2VQYXRoOiAke3NlcnZpY2VQYXRofWAsIGUpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHNjYW5uZWRTZXJ2aWNlcztcbiAgICB9XG5cbiAgICBATG9nRHVyYXRpb24oKVxuICAgIGFzeW5jIHdyaXRlVG9GaWxlcyhtZW51Q29uZmlnOiBhbnksIGVudGl0aWVzQ29uZmlnOiBhbnksIGF1dGhDb25maWc6IGFueSwgZGFzaGJvYXJkQ29uZmlnOiBhbnkpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJDYWxsZWQgd3JpdGVUb0ZpbGVzOjo6Ojo6IFwiKTtcbiAgICAgICAgY29uc3QgZ2VuRGlyZWN0b3J5UGF0aCA9IHBhdGhSZXNvbHZlKCcuL2dlbi8nKTtcbiAgICAgICAgaWYgKCFleGlzdHNTeW5jKGdlbkRpcmVjdG9yeVBhdGgpKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgR2VuIERJUiBkb2VzIG5vdCBleGlzdHMsIGNyZWF0aW5nOiAke2dlbkRpcmVjdG9yeVBhdGh9YCwpO1xuICAgICAgICAgICAgbWtkaXJTeW5jKGdlbkRpcmVjdG9yeVBhdGgpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgY29uZmlnRGlyZWN0b3J5UGF0aCA9IHBhdGhSZXNvbHZlKHBhdGhKb2luKGdlbkRpcmVjdG9yeVBhdGgsICdjb25maWcnKSk7XG4gICAgICAgIGlmICghZXhpc3RzU3luYyhjb25maWdEaXJlY3RvcnlQYXRoKSkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENvbmZpZyBESVIgZG9lcyBub3QgZXhpc3RzLCBjcmVhdGluZzogJHtjb25maWdEaXJlY3RvcnlQYXRofWApO1xuICAgICAgICAgICAgbWtkaXJTeW5jKGNvbmZpZ0RpcmVjdG9yeVBhdGgpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgbWVudUNvbmZpZ0ZpbGVQYXRoID0gcGF0aEpvaW4oY29uZmlnRGlyZWN0b3J5UGF0aCwgJ21lbnUuanNvbicpO1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1Zyhgd3JpdGluZyBtZW51LWNvbmZpZy4uIGludG86ICR7bWVudUNvbmZpZ0ZpbGVQYXRofWApO1xuICAgICAgICB3cml0ZUZpbGVTeW5jKG1lbnVDb25maWdGaWxlUGF0aCwgSlNPTi5zdHJpbmdpZnkobWVudUNvbmZpZywgbnVsbCwgMikpO1xuXG4gICAgICAgIGNvbnN0IGVudGl0aWVzQ29uZmlnRmlsZVBhdGggPSBwYXRoSm9pbihjb25maWdEaXJlY3RvcnlQYXRoLCAnZW50aXRpZXMuanNvbicpO1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1Zyhgd3JpdGluZyBlbnRpdGllcy1jb25maWcuLiBpbnRvOiAke2VudGl0aWVzQ29uZmlnRmlsZVBhdGh9YCwpO1xuICAgICAgICB3cml0ZUZpbGVTeW5jKGVudGl0aWVzQ29uZmlnRmlsZVBhdGgsIEpTT04uc3RyaW5naWZ5KGVudGl0aWVzQ29uZmlnLCBudWxsLCAyKSk7XG5cbiAgICAgICAgY29uc3QgYXV0aENvbmZpZ0ZpbGVQYXRoID0gcGF0aEpvaW4oY29uZmlnRGlyZWN0b3J5UGF0aCwgJ2F1dGguanNvbicpO1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1Zyhgd3JpdGluZyBhdXRoLWNvbmZpZy4uIGludG86ICR7YXV0aENvbmZpZ0ZpbGVQYXRofWAsKTtcbiAgICAgICAgd3JpdGVGaWxlU3luYyhhdXRoQ29uZmlnRmlsZVBhdGgsIEpTT04uc3RyaW5naWZ5KGF1dGhDb25maWcsIG51bGwsIDIpKTtcblxuICAgICAgICBjb25zdCBkYXNoYm9hcmRDb25maWdGaWxlUGF0aCA9IHBhdGhKb2luKGNvbmZpZ0RpcmVjdG9yeVBhdGgsICdkYXNoYm9hcmQuanNvbicpO1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1Zyhgd3JpdGluZyBkYXNoYm9hcmQtY29uZmlnLi4gaW50bzogJHtkYXNoYm9hcmRDb25maWdGaWxlUGF0aH1gLCk7XG4gICAgICAgIHdyaXRlRmlsZVN5bmMoZGFzaGJvYXJkQ29uZmlnRmlsZVBhdGgsIEpTT04uc3RyaW5naWZ5KGRhc2hib2FyZENvbmZpZywgbnVsbCwgMikpO1xuXG4gICAgfVxufVxuXG4iXX0=