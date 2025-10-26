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
        switch (config.pageType) {
            case 'list':
                return `list-${(0, cases_1.toSlug)(config.pageTitle)}`;
            case 'form':
                return config.pageTitle.toLowerCase().includes('add')
                    ? `create-${(0, cases_1.toSlug)(config.pageTitle)}`
                    : `edit-${(0, cases_1.toSlug)(config.pageTitle)}`;
            case 'details':
                return `view-${(0, cases_1.toSlug)(config.pageTitle)}`;
            case 'dashboard':
                return `${(0, cases_1.toSlug)(config.pageTitle)}`;
            case 'accordion':
                return `accordion-${(0, cases_1.toSlug)(config.pageTitle)}`;
            case 'menu':
                return `${(0, cases_1.toSlug)(config.pageTitle)}`;
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
        let menuIndex = 1;
        // generate UI configs
        services.forEach((service, entityName) => {
            const entitySchema = service.getEntitySchema();
            const entityDefaultOpsSchema = service.getOpsDefaultIOSchema();
            if (!entitySchema.model.excludeFromAdminCreate) {
                const createConfig = (0, create_entity_1.default)({
                    entityName,
                    entityNamePlural: entitySchema.model.entityNamePlural,
                    CRUDApiPath: entitySchema.model.CRUDApiPath,
                    properties: entityDefaultOpsSchema.create.input,
                    breadcrumbs: entitySchema.model.createPageBreadcrumbs,
                    columnsConfig: entitySchema.model.createPageColumnsConfig,
                }, service);
                entityConfigs[`create-${entityName.toLowerCase()}`] = createConfig;
            }
            if (!entitySchema.model.excludeFromAdminUpdate) {
                const updateConfig = (0, update_entity_1.default)({
                    entityName,
                    entityNamePlural: entitySchema.model.entityNamePlural,
                    CRUDApiPath: entitySchema.model.CRUDApiPath,
                    properties: entityDefaultOpsSchema.update.input,
                    actions: entitySchema.model.editPageActions,
                    breadcrumbs: entitySchema.model.editPageBreadcrumbs,
                    columnsConfig: entitySchema.model.editPageColumnsConfig,
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
                    pageHeaderActions: entitySchema.model.listPageActions,
                    breadcrumbs: entitySchema.model.listPageBreadcrumbs,
                    defaultSort: entitySchema.model.listPageDefaultSort,
                });
                entityConfigs[`list-${entityName.toLowerCase()}`] = listConfig;
            }
            if (!entitySchema.model.excludeFromAdminDetail) {
                const viewConfig = (0, view_entity_1.default)({
                    entityName,
                    entityNamePlural: entitySchema.model.entityNamePlural,
                    properties: entityDefaultOpsSchema.get.output,
                    CRUDApiPath: entitySchema.model.CRUDApiPath,
                    actions: entitySchema.model.viewPageActions,
                    breadcrumbs: entitySchema.model.viewPageBreadcrumbs,
                    columnsConfig: entitySchema.model.viewPageColumnsConfig,
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
            if (options.pageType === 'dashboard' && options.pageTitle.toLowerCase() === 'dashboard') {
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
            if (options.pageType === 'menu' && options.pageTitle.toLowerCase() === 'menu') {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW50aXR5LXVpLWNvbmZpZy5nZW4uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdWktY29uZmlnLWdlbi9lbnRpdHktdWktY29uZmlnLmdlbi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFDQSw4RUFBK0Q7QUFDL0QsOEVBQStEO0FBQy9ELDBFQUEyRDtBQUMzRCwwRUFBMkQ7QUFDM0QsMEVBQTJEO0FBQzNELHNDQUE0RDtBQUM1RCx5REFBMEo7QUFFMUosNERBQThDO0FBQzlDLHNFQUF3RDtBQUV4RCwyQkFBMEQ7QUFDMUQsK0JBR2M7QUFFZCx1Q0FBb0M7QUFDcEMsMkNBQXdDO0FBQ3hDLHdDQUF1RDtBQUN2RCwwQ0FBd0M7QUFFeEMsTUFBYSxpQkFBaUI7SUFDakIsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxpQkFBaUIsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUN2RCw4RkFBOEY7SUFDOUYsbUNBQW1DO0lBQzFCLGdCQUFnQixHQUFHLFdBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO0lBRTNELFdBQVcsR0FBbUMsSUFBSSxHQUFHLEVBQUUsQ0FBQztJQUcxRCxBQUFOLEtBQUssQ0FBQyxlQUFlO1FBQ2pCLE1BQU0sSUFBSSxHQUFHLFdBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztRQUNoQyxNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUM7UUFDaEMsTUFBTSxjQUFjLEdBQUcsTUFBTSxDQUFDLGtCQUFrQixFQUFFLG9CQUFvQixJQUFJLGNBQWMsQ0FBQztRQUV6RixNQUFNLHNCQUFzQixHQUFHLENBQUUsSUFBQSxjQUFXLEVBQUMsU0FBUyxjQUFjLEdBQUcsQ0FBQyxDQUFFLENBQUM7UUFFM0UsSUFBSSxJQUFJLENBQUMsVUFBVSxFQUFFLEVBQUUsQ0FBQztZQUNwQixLQUFLLE1BQU0s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YjtBQUdEO0lBREMsSUFBQSxxQkFBVyxHQUFFO21FQWlCYjtBQUdLO0lBREwsSUFBQSxxQkFBVyxHQUFFOzREQXFDYjtBQUdLO0lBREwsSUFBQSxxQkFBVyxHQUFFO2tFQWtEYjtBQUdLO0lBREwsSUFBQSxxQkFBVyxHQUFFO3FEQStCYiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IHR5cGUgfSBmcm9tICdvcyc7XG5pbXBvcnQgTWFrZUNyZWF0ZUVudGl0eUNvbmZpZyBmcm9tICcuL3RlbXBsYXRlcy9jcmVhdGUtZW50aXR5JztcbmltcG9ydCBNYWtlVXBkYXRlRW50aXR5Q29uZmlnIGZyb20gJy4vdGVtcGxhdGVzL3VwZGF0ZS1lbnRpdHknO1xuaW1wb3J0IE1ha2VMaXN0RW50aXR5Q29uZmlnIGZyb20gJy4vdGVtcGxhdGVzL2xpc3QtZW50aXR5JztcbmltcG9ydCBNYWtlVmlld0VudGl0eUNvbmZpZyBmcm9tICcuL3RlbXBsYXRlcy92aWV3LWVudGl0eSc7XG5pbXBvcnQgTWFrZUVudGl0eU1lbnVDb25maWcgZnJvbSAnLi90ZW1wbGF0ZXMvZW50aXR5LW1lbnUnO1xuaW1wb3J0IHsgQmFzZUVudGl0eVNlcnZpY2UsIEVudGl0eVNjaGVtYSB9IGZyb20gJy4uL2VudGl0eSc7XG5pbXBvcnQgeyBtYWtlQ3VzdG9tUGFnZUNvbmZpZywgQ3VzdG9tUGFnZU9wdGlvbnMsIExpc3RQYWdlQ29uZmlnLCBGb3JtUGFnZUNvbmZpZywgRGV0YWlsc1BhZ2VDb25maWcsIERhc2hib2FyZFBhZ2VDb25maWcgfSBmcm9tICcuL3RlbXBsYXRlcy9jdXN0b20tcGFnZSc7XG5cbmltcG9ydCBNYWtlQXV0aENvbmZpZyBmcm9tICcuL3RlbXBsYXRlcy9hdXRoJztcbmltcG9ydCBNYWtlRGFzaGJvYXJkQ29uZmlnIGZyb20gJy4vdGVtcGxhdGVzL2Rhc2hib2FyZCc7XG5cbmltcG9ydCB7IGV4aXN0c1N5bmMsIG1rZGlyU3luYywgd3JpdGVGaWxlU3luYyB9IGZyb20gXCJmc1wiO1xuaW1wb3J0IHtcbiAgICByZXNvbHZlIGFzIHBhdGhSZXNvbHZlLFxuICAgIGpvaW4gYXMgcGF0aEpvaW5cbn0gZnJvbSBcInBhdGhcIjtcblxuaW1wb3J0IHsgRncyNCB9IGZyb20gJy4uL2NvcmUvZncyNCc7XG5pbXBvcnQgeyBIZWxwZXIgfSBmcm9tICcuLi9jb3JlL2hlbHBlcic7XG5pbXBvcnQgeyBMb2dEdXJhdGlvbiwgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi4vbG9nZ2luZyc7XG5pbXBvcnQgeyB0b1NsdWcgfSBmcm9tICcuLi91dGlscy9jYXNlcyc7XG5cbmV4cG9ydCBjbGFzcyBFbnRpdHlVSUNvbmZpZ0dlbiB7XG4gICAgcmVhZG9ubHkgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKEVudGl0eVVJQ29uZmlnR2VuLm5hbWUpO1xuICAgIC8vIG1ha2Ugc3VyZSB0byBjcmVhdGUgYSBjaGlsZCBjb250YWluZXIgdG8gbm90IHBvbGx1dGUgYW55dGhpbmcgaW4gdGhlIEFwcGxpY2F0aW9uIGNvbnRhaW5lciBcbiAgICAvLyB3aGlsZSBzY2FubmluZyBhbmQgbG9hZGluZyBzdHVmZlxuICAgIHJlYWRvbmx5IHVpR2VuRElDb250YWluZXIgPSBGdzI0LmdldEluc3RhbmNlKCkuZ2V0QXBwRElDb250YWluZXIoKTtcblxuICAgIHByaXZhdGUgY3VzdG9tUGFnZXM6IE1hcDxzdHJpbmcsIEN1c3RvbVBhZ2VPcHRpb25zPiA9IG5ldyBNYXAoKTtcblxuICAgIEBMb2dEdXJhdGlvbigpXG4gICAgYXN5bmMgc2NhbkN1c3RvbVBhZ2VzKCkge1xuICAgICAgICBjb25zdCBmdzI0ID0gRncyNC5nZXRJbnN0YW5jZSgpO1xuICAgICAgICBjb25zdCBjb25maWcgPSBmdzI0LmdldENvbmZpZygpO1xuICAgICAgICBjb25zdCBjdXN0b21QYWdlc0RpciA9IGNvbmZpZy51aUNvbmZpZ0dlbk9wdGlvbnM/LmN1c3RvbVBhZ2VzRGlyZWN0b3J5IHx8ICdjdXN0b20tcGFnZXMnO1xuXG4gICAgICAgIGNvbnN0IGN1c3RvbVBhZ2VzRGlyZWN0b3JpZXMgPSBbIHBhdGhSZXNvbHZlKGAuL3NyYy8ke2N1c3RvbVBhZ2VzRGlyfS9gKSBdO1xuXG4gICAgICAgIGlmIChmdzI0Lmhhc01vZHVsZXMoKSkge1xuICAgICAgICAgICAgZm9yIChjb25zdCBbICwgbW9kdWxlIF0gb2YgZncyNC5nZXRNb2R1bGVzKCkpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBtb2R1bGVDdXN0b21QYWdlc1BhdGggPSBwYXRoSm9pbihtb2R1bGUuZ2V0QmFzZVBhdGgoKSwgY3VzdG9tUGFnZXNEaXIpO1xuICAgICAgICAgICAgICAgIGN1c3RvbVBhZ2VzRGlyZWN0b3JpZXMucHVzaChwYXRoUmVzb2x2ZShtb2R1bGVDdXN0b21QYWdlc1BhdGgpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGZvciAoY29uc3QgZGlyIG9mIGN1c3RvbVBhZ2VzRGlyZWN0b3JpZXMpIHtcbiAgICAgICAgICAgIGlmICghZXhpc3RzU3luYyhkaXIpKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEN1c3RvbSBwYWdlcyBkaXJlY3RvcnkgZG9lcyBub3QgZXhpc3Q6ICR7ZGlyfWApO1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBjdXN0b21QYWdlRmlsZXMgPSBIZWxwZXIuc2NhbkNvbnRyb2xsZXJTb3VyY2VGaWxlc0Zyb20oZGlyKTtcblxuICAgICAgICAgICAgZm9yIChjb25zdCBmaWxlIG9mIGN1c3RvbVBhZ2VGaWxlcykge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IG1vZHVsZSA9IGF3YWl0IGltcG9ydChwYXRoSm9pbihkaXIsIGZpbGUpKTtcbiAgICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCBbIGtleSwgdmFsdWUgXSBvZiBPYmplY3QuZW50cmllcyhtb2R1bGUpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5pc1ZhbGlkQ3VzdG9tUGFnZUNvbmZpZyh2YWx1ZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwYWdlTmFtZSA9IHRoaXMuZ2V0UGFnZU5hbWVGcm9tQ29uZmlnKHZhbHVlKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAocGFnZU5hbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5yZWdpc3RlckN1c3RvbVBhZ2UodmFsdWUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBSZWdpc3RlcmVkIGN1c3RvbSBwYWdlOiAke3BhZ2VOYW1lfWApO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYEVycm9yIGxvYWRpbmcgY3VzdG9tIHBhZ2UgZnJvbSAke2ZpbGV9OmAsIGUpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHB1YmxpYyBpc1ZhbGlkQ3VzdG9tUGFnZUNvbmZpZyh2YWx1ZTogdW5rbm93bik6IHZhbHVlIGlzIEN1c3RvbVBhZ2VPcHRpb25zIHtcbiAgICAgICAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XG5cbiAgICAgICAgY29uc3QgY29uZmlnID0gdmFsdWUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgICAgIGlmICghKCdwYWdlVHlwZScgaW4gY29uZmlnKSB8fCAhKCdwYWdlVGl0bGUnIGluIGNvbmZpZykpIHJldHVybiBmYWxzZTtcblxuICAgICAgICBjb25zdCBwYWdlVHlwZSA9IGNvbmZpZy5wYWdlVHlwZTtcbiAgICAgICAgaWYgKHBhZ2VUeXBlID09PSAnbGlzdCcpIHtcbiAgICAgICAgICAgIHJldHVybiAnbGlzdFBhZ2VDb25maWcnIGluIGNvbmZpZztcbiAgICAgICAgfSBlbHNlIGlmIChwYWdlVHlwZSA9PT0gJ2Zvcm0nKSB7XG4gICAgICAgICAgICByZXR1cm4gJ2Zvcm1QYWdlQ29uZmlnJyBpbiBjb25maWc7XG4gICAgICAgIH0gZWxzZSBpZiAocGFnZVR5cGUgPT09ICdkZXRhaWxzJykge1xuICAgICAgICAgICAgcmV0dXJuICdkZXRhaWxzUGFnZUNvbmZpZycgaW4gY29uZmlnO1xuICAgICAgICB9IGVsc2UgaWYgKHBhZ2VUeXBlID09PSAnZGFzaGJvYXJkJykge1xuICAgICAgICAgICAgcmV0dXJuICdkYXNoYm9hcmRQYWdlQ29uZmlnJyBpbiBjb25maWc7XG4gICAgICAgIH0gZWxzZSBpZiAocGFnZVR5cGUgPT09ICdhY2NvcmRpb24nKSB7XG4gICAgICAgICAgICByZXR1cm4gJ2FjY29yZGlvblBhZ2VDb25maWcnIGluIGNvbmZpZztcbiAgICAgICAgfSBlbHNlIGlmIChwYWdlVHlwZSA9PT0gJ21lbnUnKSB7XG4gICAgICAgICAgICByZXR1cm4gJ21lbnVQYWdlQ29uZmlnJyBpbiBjb25maWc7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIHByaXZhdGUgZ2V0UGFnZU5hbWVGcm9tQ29uZmlnKGNvbmZpZzogQ3VzdG9tUGFnZU9wdGlvbnMpOiBzdHJpbmcgfCBudWxsIHtcbiAgICAgICAgaWYgKGNvbmZpZy5wYWdlTmFtZSkge1xuICAgICAgICAgICAgcmV0dXJuIHRvU2x1Zyhjb25maWcucGFnZU5hbWUpO1xuICAgICAgICB9XG4gICAgICAgIHN3aXRjaCAoY29uZmlnLnBhZ2VUeXBlKSB7XG4gICAgICAgICAgICBjYXNlICdsaXN0JzpcbiAgICAgICAgICAgICAgICByZXR1cm4gYGxpc3QtJHt0b1NsdWcoY29uZmlnLnBhZ2VUaXRsZSl9YDtcbiAgICAgICAgICAgIGNhc2UgJ2Zvcm0nOlxuICAgICAgICAgICAgICAgIHJldHVybiBjb25maWcucGFnZVRpdGxlLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoJ2FkZCcpXG4gICAgICAgICAgICAgICAgICAgID8gYGNyZWF0ZS0ke3RvU2x1Zyhjb25maWcucGFnZVRpdGxlKX1gXG4gICAgICAgICAgICAgICAgICAgIDogYGVkaXQtJHt0b1NsdWcoY29uZmlnLnBhZ2VUaXRsZSl9YDtcbiAgICAgICAgICAgIGNhc2UgJ2RldGFpbHMnOlxuICAgICAgICAgICAgICAgIHJldHVybiBgdmlldy0ke3RvU2x1Zyhjb25maWcucGFnZVRpdGxlKX1gO1xuICAgICAgICAgICAgY2FzZSAnZGFzaGJvYXJkJzpcbiAgICAgICAgICAgICAgICByZXR1cm4gYCR7dG9TbHVnKGNvbmZpZy5wYWdlVGl0bGUpfWA7XG4gICAgICAgICAgICBjYXNlICdhY2NvcmRpb24nOlxuICAgICAgICAgICAgICAgIHJldHVybiBgYWNjb3JkaW9uLSR7dG9TbHVnKGNvbmZpZy5wYWdlVGl0bGUpfWA7XG4gICAgICAgICAgICBjYXNlICdtZW51JzpcbiAgICAgICAgICAgICAgICByZXR1cm4gYCR7dG9TbHVnKGNvbmZpZy5wYWdlVGl0bGUpfWA7XG4gICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUmVnaXN0ZXIgYSBjdXN0b20gcGFnZS4gU3VwcG9ydHMgb3B0aW9uYWwgcm91dGVQYXR0ZXJuIGZvciBkeW5hbWljIHJvdXRlcyAoZS5nLiwgL2F1dGhvci86YXV0aG9ySWQvYm9va3MpXG4gICAgICovXG4gICAgcHVibGljIHJlZ2lzdGVyQ3VzdG9tUGFnZShvcHRpb25zOiBDdXN0b21QYWdlT3B0aW9ucykge1xuICAgICAgICBjb25zdCBwYWdlTmFtZSA9IHRoaXMuZ2V0UGFnZU5hbWVGcm9tQ29uZmlnKG9wdGlvbnMpO1xuICAgICAgICBpZiAocGFnZU5hbWUpIHtcbiAgICAgICAgICAgIHRoaXMuY3VzdG9tUGFnZXMuc2V0KHBhZ2VOYW1lLCBvcHRpb25zKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGFzeW5jIHJ1bigpIHtcbiAgICAgICAgdGhpcy5wcm9jZXNzKCk7XG4gICAgfVxuXG4gICAgQExvZ0R1cmF0aW9uKClcbiAgICBhc3luYyBwcm9jZXNzKCkge1xuICAgICAgICBjb25zdCBtZW51Q29uZmlnczogYW55W10gPSBbXTtcbiAgICAgICAgY29uc3QgZW50aXR5Q29uZmlnczogYW55ID0ge307XG5cbiAgICAgICAgY29uc3Qgc2VydmljZURpcmVjdG9yaWVzID0gdGhpcy5wcmVwYXJlU2VydmljZXNEaXJlY3RvcmllcygpO1xuXG4gICAgICAgIGNvbnN0IHNlcnZpY2VzID0gYXdhaXQgdGhpcy5zY2FuQW5kTG9hZFNlcnZpY2VzKHNlcnZpY2VEaXJlY3Rvcmllcyk7XG5cbiAgICAgICAgLy8gU2NhbiBhbmQgbG9hZCBjdXN0b20gcGFnZXNcbiAgICAgICAgYXdhaXQgdGhpcy5zY2FuQ3VzdG9tUGFnZXMoKTtcblxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgVWktY29uZmlnLWdlbjo6OiBQcm9jZXNzOjo6IGFsbC1zZXJ2aWNlczogYCwgQXJyYXkuZnJvbShzZXJ2aWNlcy5rZXlzKCkpKTtcblxuICAgICAgICBsZXQgbWVudUluZGV4ID0gMTtcbiAgICAgICAgLy8gZ2VuZXJhdGUgVUkgY29uZmlnc1xuICAgICAgICBzZXJ2aWNlcy5mb3JFYWNoKChzZXJ2aWNlLCBlbnRpdHlOYW1lKSA9PiB7XG5cbiAgICAgICAgICAgIGNvbnN0IGVudGl0eVNjaGVtYSA9IHNlcnZpY2UuZ2V0RW50aXR5U2NoZW1hKCkgYXMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+O1xuICAgICAgICAgICAgY29uc3QgZW50aXR5RGVmYXVsdE9wc1NjaGVtYSA9IHNlcnZpY2UuZ2V0T3BzRGVmYXVsdElPU2NoZW1hKCk7XG5cbiAgICAgICAgICAgIGlmICghZW50aXR5U2NoZW1hLm1vZGVsLmV4Y2x1ZGVGcm9tQWRtaW5DcmVhdGUpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBjcmVhdGVDb25maWcgPSBNYWtlQ3JlYXRlRW50aXR5Q29uZmlnKHtcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZVBsdXJhbDogZW50aXR5U2NoZW1hLm1vZGVsLmVudGl0eU5hbWVQbHVyYWwsXG4gICAgICAgICAgICAgICAgICAgIENSVURBcGlQYXRoOiBlbnRpdHlTY2hlbWEubW9kZWwuQ1JVREFwaVBhdGgsXG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IGVudGl0eURlZmF1bHRPcHNTY2hlbWEuY3JlYXRlLmlucHV0LFxuICAgICAgICAgICAgICAgICAgICBicmVhZGNydW1iczogZW50aXR5U2NoZW1hLm1vZGVsLmNyZWF0ZVBhZ2VCcmVhZGNydW1icyxcbiAgICAgICAgICAgICAgICAgICAgY29sdW1uc0NvbmZpZzogZW50aXR5U2NoZW1hLm1vZGVsLmNyZWF0ZVBhZ2VDb2x1bW5zQ29uZmlnLFxuICAgICAgICAgICAgICAgIH0sIHNlcnZpY2UpO1xuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ3NbIGBjcmVhdGUtJHtlbnRpdHlOYW1lLnRvTG93ZXJDYXNlKCl9YCBdID0gY3JlYXRlQ29uZmlnO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoIWVudGl0eVNjaGVtYS5tb2RlbC5leGNsdWRlRnJvbUFkbWluVXBkYXRlKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgdXBkYXRlQ29uZmlnID0gTWFrZVVwZGF0ZUVudGl0eUNvbmZpZyh7XG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWVQbHVyYWw6IGVudGl0eVNjaGVtYS5tb2RlbC5lbnRpdHlOYW1lUGx1cmFsLFxuICAgICAgICAgICAgICAgICAgICBDUlVEQXBpUGF0aDogZW50aXR5U2NoZW1hLm1vZGVsLkNSVURBcGlQYXRoLFxuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiBlbnRpdHlEZWZhdWx0T3BzU2NoZW1hLnVwZGF0ZS5pbnB1dCxcbiAgICAgICAgICAgICAgICAgICAgYWN0aW9uczogZW50aXR5U2NoZW1hLm1vZGVsLmVkaXRQYWdlQWN0aW9ucyxcbiAgICAgICAgICAgICAgICAgICAgYnJlYWRjcnVtYnM6IGVudGl0eVNjaGVtYS5tb2RlbC5lZGl0UGFnZUJyZWFkY3J1bWJzLFxuICAgICAgICAgICAgICAgICAgICBjb2x1bW5zQ29uZmlnOiBlbnRpdHlTY2hlbWEubW9kZWwuZWRpdFBhZ2VDb2x1bW5zQ29uZmlnLFxuICAgICAgICAgICAgICAgIH0sIHNlcnZpY2UpO1xuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ3NbIGBlZGl0LSR7ZW50aXR5TmFtZS50b0xvd2VyQ2FzZSgpfWAgXSA9IHVwZGF0ZUNvbmZpZztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKCFlbnRpdHlTY2hlbWEubW9kZWwuZXhjbHVkZUZyb21BZG1pbkxpc3QpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBsaXN0Q29uZmlnID0gTWFrZUxpc3RFbnRpdHlDb25maWcoe1xuICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lUGx1cmFsOiBlbnRpdHlTY2hlbWEubW9kZWwuZW50aXR5TmFtZVBsdXJhbCxcbiAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllczogZW50aXR5RGVmYXVsdE9wc1NjaGVtYS5saXN0Lm91dHB1dCxcbiAgICAgICAgICAgICAgICAgICAgQ1JVREFwaVBhdGg6IGVudGl0eVNjaGVtYS5tb2RlbC5DUlVEQXBpUGF0aCxcbiAgICAgICAgICAgICAgICAgICAgdXNlU2VhcmNoOiBCb29sZWFuKGVudGl0eVNjaGVtYS5tb2RlbC5zZWFyY2g/LmVuYWJsZWQpLFxuICAgICAgICAgICAgICAgICAgICBleGNsdWRlRnJvbUFkbWluQ3JlYXRlOiBlbnRpdHlTY2hlbWEubW9kZWwuZXhjbHVkZUZyb21BZG1pbkNyZWF0ZSxcbiAgICAgICAgICAgICAgICAgICAgZXhjbHVkZUZyb21BZG1pblVwZGF0ZTogZW50aXR5U2NoZW1hLm1vZGVsLmV4Y2x1ZGVGcm9tQWRtaW5VcGRhdGUsXG4gICAgICAgICAgICAgICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5EZWxldGU6IGVudGl0eVNjaGVtYS5tb2RlbC5leGNsdWRlRnJvbUFkbWluRGVsZXRlLFxuICAgICAgICAgICAgICAgICAgICBleGNsdWRlRnJvbUFkbWluRGV0YWlsOiBlbnRpdHlTY2hlbWEubW9kZWwuZXhjbHVkZUZyb21BZG1pbkRldGFpbCxcbiAgICAgICAgICAgICAgICAgICAgcGFnZUhlYWRlckFjdGlvbnM6IGVudGl0eVNjaGVtYS5tb2RlbC5saXN0UGFnZUFjdGlvbnMsXG4gICAgICAgICAgICAgICAgICAgIGJyZWFkY3J1bWJzOiBlbnRpdHlTY2hlbWEubW9kZWwubGlzdFBhZ2VCcmVhZGNydW1icyxcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdFNvcnQ6IGVudGl0eVNjaGVtYS5tb2RlbC5saXN0UGFnZURlZmF1bHRTb3J0LFxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ3NbIGBsaXN0LSR7ZW50aXR5TmFtZS50b0xvd2VyQ2FzZSgpfWAgXSA9IGxpc3RDb25maWc7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICghZW50aXR5U2NoZW1hLm1vZGVsLmV4Y2x1ZGVGcm9tQWRtaW5EZXRhaWwpIHtcbiAgICAgICAgICAgICAgICBjb25zdCB2aWV3Q29uZmlnID0gTWFrZVZpZXdFbnRpdHlDb25maWcoe1xuICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lUGx1cmFsOiBlbnRpdHlTY2hlbWEubW9kZWwuZW50aXR5TmFtZVBsdXJhbCxcbiAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllczogZW50aXR5RGVmYXVsdE9wc1NjaGVtYS5nZXQub3V0cHV0LFxuICAgICAgICAgICAgICAgICAgICBDUlVEQXBpUGF0aDogZW50aXR5U2NoZW1hLm1vZGVsLkNSVURBcGlQYXRoLFxuICAgICAgICAgICAgICAgICAgICBhY3Rpb25zOiBlbnRpdHlTY2hlbWEubW9kZWwudmlld1BhZ2VBY3Rpb25zLFxuICAgICAgICAgICAgICAgICAgICBicmVhZGNydW1iczogZW50aXR5U2NoZW1hLm1vZGVsLnZpZXdQYWdlQnJlYWRjcnVtYnMsXG4gICAgICAgICAgICAgICAgICAgIGNvbHVtbnNDb25maWc6IGVudGl0eVNjaGVtYS5tb2RlbC52aWV3UGFnZUNvbHVtbnNDb25maWcsXG4gICAgICAgICAgICAgICAgfSwgc2VydmljZSk7XG4gICAgICAgICAgICAgICAgZW50aXR5Q29uZmlnc1sgYHZpZXctJHtlbnRpdHlOYW1lLnRvTG93ZXJDYXNlKCl9YCBdID0gdmlld0NvbmZpZztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKCFlbnRpdHlTY2hlbWEubW9kZWwuZXhjbHVkZUZyb21BZG1pbk1lbnUpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBtZW51Q29uZmlnID0gTWFrZUVudGl0eU1lbnVDb25maWcoe1xuICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lUGx1cmFsOiBlbnRpdHlTY2hlbWEubW9kZWwuZW50aXR5TmFtZVBsdXJhbCxcbiAgICAgICAgICAgICAgICAgICAgaWNvbjogZW50aXR5U2NoZW1hLm1vZGVsLmVudGl0eU1lbnVJY29uIHx8ICdhcHBTdG9yZScsXG4gICAgICAgICAgICAgICAgICAgIG1lbnVJbmRleDogbWVudUluZGV4KyssXG4gICAgICAgICAgICAgICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5MaXN0OiBlbnRpdHlTY2hlbWEubW9kZWwuZXhjbHVkZUZyb21BZG1pbkxpc3QsXG4gICAgICAgICAgICAgICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5DcmVhdGU6IGVudGl0eVNjaGVtYS5tb2RlbC5leGNsdWRlRnJvbUFkbWluQ3JlYXRlLFxuICAgICAgICAgICAgICAgICAgICBtZW51R3JvdXA6IGVudGl0eVNjaGVtYS5tb2RlbC5tZW51R3JvdXAsXG4gICAgICAgICAgICAgICAgICAgIG1lbnVPcmRlcjogZW50aXR5U2NoZW1hLm1vZGVsLm1lbnVPcmRlcixcbiAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgIG1lbnVDb25maWdzLnB1c2gobWVudUNvbmZpZyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gUHJvY2VzcyBjdXN0b20gcGFnZXNcbiAgICAgICAgZm9yIChjb25zdCBbIHBhZ2VOYW1lLCBvcHRpb25zIF0gb2YgdGhpcy5jdXN0b21QYWdlcykge1xuICAgICAgICAgICAgLy8gc2tpcCB0aGUgZGVmYXVsdCBkYXNoYm9hcmQgcGFnZSBhbmQgbWVudSBwYWdlXG4gICAgICAgICAgICBpZiAocGFnZU5hbWUgPT09ICdkYXNoYm9hcmQnIHx8IHBhZ2VOYW1lID09PSAnbWVudScpIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnN0IGN1c3RvbUNvbmZpZyA9IG1ha2VDdXN0b21QYWdlQ29uZmlnKG9wdGlvbnMpO1xuICAgICAgICAgICAgZW50aXR5Q29uZmlnc1sgcGFnZU5hbWUgXSA9IGN1c3RvbUNvbmZpZztcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGF1dGhDb25maWdPcHRpb25zID0gRncyNC5nZXRJbnN0YW5jZSgpLmdldENvbmZpZygpLnVpQ29uZmlnR2VuT3B0aW9ucyB8fCB7fTtcblxuICAgICAgICBjb25zdCBhdXRoQ29uZmlncyA9IE1ha2VBdXRoQ29uZmlnKHtcbiAgICAgICAgICAgIC4uLmF1dGhDb25maWdPcHRpb25zLFxuICAgICAgICAgICAgYXV0aEVuZHBvaW50OiBhdXRoQ29uZmlnT3B0aW9ucy5hdXRoRW5kcG9pbnQgfHwgJ21hdXRoJ1xuICAgICAgICB9KTtcblxuICAgICAgICAvLyBMb29rIGZvciBhIGRhc2hib2FyZCBjdXN0b20gcGFnZVxuICAgICAgICBsZXQgZGFzaGJvYXJkQ29uZmlnOiBEYXNoYm9hcmRQYWdlQ29uZmlnIHwgYW55ID0gbnVsbDtcbiAgICAgICAgZm9yIChjb25zdCBbICwgb3B0aW9ucyBdIG9mIHRoaXMuY3VzdG9tUGFnZXMpIHtcbiAgICAgICAgICAgIGlmIChvcHRpb25zLnBhZ2VUeXBlID09PSAnZGFzaGJvYXJkJyAmJiBvcHRpb25zLnBhZ2VUaXRsZS50b0xvd2VyQ2FzZSgpID09PSAnZGFzaGJvYXJkJykge1xuICAgICAgICAgICAgICAgIGRhc2hib2FyZENvbmZpZyA9IG9wdGlvbnM7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFkYXNoYm9hcmRDb25maWcpIHtcbiAgICAgICAgICAgIGRhc2hib2FyZENvbmZpZyA9IE1ha2VEYXNoYm9hcmRDb25maWcoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIExvb2sgZm9yIGEgbWVudSBjdXN0b20gcGFnZVxuICAgICAgICBsZXQgbWVudUNvbmZpZzogYW55ID0gbnVsbDtcbiAgICAgICAgZm9yIChjb25zdCBbIHBhZ2VOYW1lLCBvcHRpb25zIF0gb2YgdGhpcy5jdXN0b21QYWdlcykge1xuICAgICAgICAgICAgaWYgKG9wdGlvbnMucGFnZVR5cGUgPT09ICdtZW51JyAmJiBvcHRpb25zLnBhZ2VUaXRsZS50b0xvd2VyQ2FzZSgpID09PSAnbWVudScpIHtcbiAgICAgICAgICAgICAgICBtZW51Q29uZmlnID0gb3B0aW9ucztcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEdyb3VwIG1lbnUgaXRlbXMgYnkgdGhlaXIgZ3JvdXAgcHJvcGVydHlcbiAgICAgICAgY29uc3QgbWVudUdyb3VwcyA9IG5ldyBNYXA8c3RyaW5nLCBhbnlbXT4oKTtcbiAgICAgICAgY29uc3QgdW5ncm91cGVkSXRlbXM6IGFueVtdID0gW107XG5cbiAgICAgICAgLy8gUHJvY2VzcyBlbnRpdHkgbWVudSBpdGVtc1xuICAgICAgICBtZW51Q29uZmlncy5mb3JFYWNoKGl0ZW0gPT4ge1xuICAgICAgICAgICAgaWYgKGl0ZW0uZ3JvdXApIHtcbiAgICAgICAgICAgICAgICBpZiAoIW1lbnVHcm91cHMuaGFzKGl0ZW0uZ3JvdXApKSB7XG4gICAgICAgICAgICAgICAgICAgIG1lbnVHcm91cHMuc2V0KGl0ZW0uZ3JvdXAsIFtdKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgbWVudUdyb3Vwcy5nZXQoaXRlbS5ncm91cCkhLnB1c2goaXRlbSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHVuZ3JvdXBlZEl0ZW1zLnB1c2goaXRlbSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIFByb2Nlc3MgY3VzdG9tIG1lbnUgaXRlbXNcbiAgICAgICAgaWYgKG1lbnVDb25maWc/Lm1lbnVQYWdlQ29uZmlnPy5tZW51SXRlbXMpIHtcbiAgICAgICAgICAgIG1lbnVDb25maWcubWVudVBhZ2VDb25maWcubWVudUl0ZW1zLmZvckVhY2goKGl0ZW06IGFueSkgPT4ge1xuICAgICAgICAgICAgICAgIGlmIChpdGVtLmdyb3VwKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmICghbWVudUdyb3Vwcy5oYXMoaXRlbS5ncm91cCkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIG1lbnVHcm91cHMuc2V0KGl0ZW0uZ3JvdXAsIFtdKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBtZW51R3JvdXBzLmdldChpdGVtLmdyb3VwKSEucHVzaChpdGVtKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICB1bmdyb3VwZWRJdGVtcy5wdXNoKGl0ZW0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ3JlYXRlIGZpbmFsIG1lbnUgc3RydWN0dXJlXG4gICAgICAgIGNvbnN0IGFsbE1lbnVJdGVtczogYW55W10gPSBbXTtcblxuICAgICAgICAvLyBBZGQgdW5ncm91cGVkIGl0ZW1zIGZpcnN0IChwcmltYXJ5IG5hdmlnYXRpb24pXG4gICAgICAgIGFsbE1lbnVJdGVtcy5wdXNoKC4uLnVuZ3JvdXBlZEl0ZW1zKTtcblxuICAgICAgICAvLyBBZGQgZ3JvdXBlZCBpdGVtc1xuICAgICAgICBtZW51R3JvdXBzLmZvckVhY2goKGl0ZW1zLCBncm91cE5hbWUpID0+IHtcbiAgICAgICAgICAgIC8vIFNvcnQgaXRlbXMgd2l0aGluIGdyb3VwIGJ5IG9yZGVyXG4gICAgICAgICAgICBpdGVtcy5zb3J0KChhLCBiKSA9PiAoYS5vcmRlciB8fCAwKSAtIChiLm9yZGVyIHx8IDApKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gQ3JlYXRlIGdyb3VwIGl0ZW1cbiAgICAgICAgICAgIGFsbE1lbnVJdGVtcy5wdXNoKHtcbiAgICAgICAgICAgICAgICBsYWJlbDogZ3JvdXBOYW1lLFxuICAgICAgICAgICAgICAgIGtleTogYGdyb3VwLSR7Z3JvdXBOYW1lfWAsXG4gICAgICAgICAgICAgICAgaWNvbjogJ0ZvbGRlck91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBjaGlsZHJlbjogaXRlbXNcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgICBhd2FpdCB0aGlzLndyaXRlVG9GaWxlcyhhbGxNZW51SXRlbXMsIGVudGl0eUNvbmZpZ3MsIGF1dGhDb25maWdzLCBkYXNoYm9hcmRDb25maWcpO1xuICAgIH1cblxuICAgIEBMb2dEdXJhdGlvbigpXG4gICAgcHJlcGFyZVNlcnZpY2VzRGlyZWN0b3JpZXMoKSB7XG4gICAgICAgIGNvbnN0IGZ3MjQgPSBGdzI0LmdldEluc3RhbmNlKCk7XG5cbiAgICAgICAgY29uc3Qgc2VydmljZURpcmVjdG9yaWVzID0gWyBwYXRoUmVzb2x2ZSgnLi9zcmMvc2VydmljZXMvJykgXTtcblxuICAgICAgICBpZiAoZncyNC5oYXNNb2R1bGVzKCkpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBVaS1jb25maWctZ2VuOjo6IFByb2Nlc3M6OjogYXBwIGhhcyBtb2R1bGVzOiBgLCBBcnJheS5mcm9tKGZ3MjQuZ2V0TW9kdWxlcygpLmtleXMoKSkpO1xuICAgICAgICAgICAgZm9yIChjb25zdCBbICwgbW9kdWxlIF0gb2YgZncyNC5nZXRNb2R1bGVzKCkpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBtb2R1bGVTZXJ2aWNlc1BhdGggPSBwYXRoSm9pbihtb2R1bGUuZ2V0QmFzZVBhdGgoKSwgbW9kdWxlLmdldFNlcnZpY2VzRGlyZWN0b3J5KCkpO1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBVaS1jb25maWctZ2VuOjo6IFByb2Nlc3M6OjogbW9kdWxlU2VydmljZXNQYXRoOiBgLCBtb2R1bGVTZXJ2aWNlc1BhdGgpO1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBVaS1jb25maWctZ2VuOjo6IFByb2Nlc3M6OjogcmVzLW1vZHVsZVNlcnZpY2VzUGF0aDogYCwgcGF0aFJlc29sdmUobW9kdWxlU2VydmljZXNQYXRoKSk7XG4gICAgICAgICAgICAgICAgc2VydmljZURpcmVjdG9yaWVzLnB1c2gocGF0aFJlc29sdmUobW9kdWxlU2VydmljZXNQYXRoKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gc2VydmljZURpcmVjdG9yaWVzO1xuICAgIH1cblxuICAgIEBMb2dEdXJhdGlvbigpXG4gICAgYXN5bmMgc2NhbkFuZExvYWRTZXJ2aWNlcyhzZXJ2aWNlRGlyZWN0b3JpZXM6IEFycmF5PHN0cmluZz4pIHtcblxuICAgICAgICBjb25zdCBzY2FubmVkU2VydmljZXMgPSBuZXcgU2V0PEZ1bmN0aW9uPigpO1xuXG4gICAgICAgIGZvciAoY29uc3QgZGlyIG9mIHNlcnZpY2VEaXJlY3Rvcmllcykge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFVpLWNvbmZpZy1nZW46OjogUHJvY2Vzczo6OiBsb2FkaW5nIHNlcnZpY2VzIGZyb20gRElSOiBgLCBkaXIpO1xuICAgICAgICAgICAgY29uc3QgZGlyU2VydmljZVRva2VucyA9IGF3YWl0IHRoaXMuc2NhblNlcnZpY2VzRnJvbURpcmVjdG9yeShkaXIpO1xuICAgICAgICAgICAgZGlyU2VydmljZVRva2Vucy5mb3JFYWNoKHRva2VuID0+IHNjYW5uZWRTZXJ2aWNlcy5hZGQodG9rZW4pKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGdldCBhbGwgY29udGFpbmVyIHJlZ2lzdGVyZWQgc2VydmljZXMgdG8gbWFrZSBzdXJlIGF1dG8tZ2VuIGVudGl0eS1zZXJ2aWNlcyBhcmUgYWxzbyBpbmNsdWRlZFxuICAgICAgICB0aGlzLnVpR2VuRElDb250YWluZXIuY29sbGVjdEJlc3RQcm92aWRlcnNGb3Ioe1xuICAgICAgICAgICAgdHlwZTogJ3NlcnZpY2UnLFxuICAgICAgICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVyczogdHJ1ZVxuICAgICAgICB9KS5maWx0ZXIob3B0ID0+IHtcbiAgICAgICAgICAgIC8vIG1ha2Ugc3VyZSB0byBjb2xsZWN0IG9ubHkgdGhlIGVudGl0eSBzZXJ2aWNlIHByb3ZpZGVyc1xuICAgICAgICAgICAgcmV0dXJuICEhb3B0Ll9wcm92aWRlci5mb3JFbnRpdHlcbiAgICAgICAgfSkuZm9yRWFjaChvcHQgPT4ge1xuICAgICAgICAgICAgc2Nhbm5lZFNlcnZpY2VzLmFkZChvcHQuX3Byb3ZpZGVyLnByb3ZpZGUgYXMgRnVuY3Rpb24pO1xuICAgICAgICB9KVxuXG4gICAgICAgIC8vIHJlc29sdmUgYWxsIHNlcnZpY2VzXG4gICAgICAgIGNvbnN0IHJlc29sdmVkU2VydmljZXMgPSBuZXcgTWFwPHN0cmluZywgQmFzZUVudGl0eVNlcnZpY2U8YW55Pj4oKTtcblxuICAgICAgICBzY2FubmVkU2VydmljZXMuZm9yRWFjaCh0b2tlbiA9PiB7XG4gICAgICAgICAgICBjb25zdCBzZXJ2aWNlID0gdGhpcy51aUdlbkRJQ29udGFpbmVyLnJlc29sdmUodG9rZW4sIHtcbiAgICAgICAgICAgICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzOiB0cnVlXG4gICAgICAgICAgICB9KSBhcyBCYXNlRW50aXR5U2VydmljZTxhbnk+O1xuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgcmVzb2x2ZWQgc2VydmljZSBmb3IgZW50aXR5OiAke3NlcnZpY2UuZ2V0RW50aXR5TmFtZSgpfWApO1xuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgVWktY29uZmlnLWdlbjo6OiBQcm9jZXNzOjo6IGxvYWRlZCBzZXJ2aWNlcyBmcm9tIGVudGl0eTogYCwgc2VydmljZS5nZXRFbnRpdHlOYW1lKCkpO1xuICAgICAgICAgICAgcmVzb2x2ZWRTZXJ2aWNlcy5zZXQoc2VydmljZS5nZXRFbnRpdHlOYW1lKCksIHNlcnZpY2UpO1xuICAgICAgICB9KVxuXG4gICAgICAgIHJldHVybiByZXNvbHZlZFNlcnZpY2VzO1xuICAgIH1cblxuICAgIEBMb2dEdXJhdGlvbigpXG4gICAgYXN5bmMgc2NhblNlcnZpY2VzRnJvbURpcmVjdG9yeShzZXJ2aWNlc0Rpcjogc3RyaW5nKSB7XG5cbiAgICAgICAgY29uc3Qgc2Nhbm5lZFNlcnZpY2VzID0gbmV3IFNldDxGdW5jdGlvbj4oKTtcblxuICAgICAgICBpZiAoIWV4aXN0c1N5bmMoc2VydmljZXNEaXIpKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBzY2FuU2VydmljZXNGcm9tRGlyZWN0b3J5OiBzZXJ2aWNlc0RpciBkb2VzIG5vdCBleGlzdHM6ICR7c2VydmljZXNEaXJ9YCk7XG4gICAgICAgICAgICByZXR1cm4gc2Nhbm5lZFNlcnZpY2VzO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3Qgc2VydmljZVBhdGhzID0gSGVscGVyLnNjYW5Db250cm9sbGVyU291cmNlRmlsZXNGcm9tKHNlcnZpY2VzRGlyKTtcblxuICAgICAgICBmb3IgKGNvbnN0IHNlcnZpY2VQYXRoIG9mIHNlcnZpY2VQYXRocykge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYHRyeWluZyB0byBsb2FkIHNlcnZpY2VQYXRoOiAke3NlcnZpY2VQYXRofWApO1xuXG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIC8vIER5bmFtaWNhbGx5IGltcG9ydCB0aGUgc2VydmljZSBmaWxlXG4gICAgICAgICAgICAgICAgY29uc3QgbW9kdWxlID0gYXdhaXQgaW1wb3J0KHBhdGhKb2luKHNlcnZpY2VzRGlyLCBzZXJ2aWNlUGF0aCkpO1xuXG4gICAgICAgICAgICAgICAgLy8gRmluZCBhbmQgaW5zdGFudGlhdGUgc2VydmljZSBjbGFzc2VzXG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCBleHBvcnRlZEl0ZW0gb2YgT2JqZWN0LnZhbHVlcyhtb2R1bGUpKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChcbiAgICAgICAgICAgICAgICAgICAgICAgIGV4cG9ydGVkSXRlbVxuICAgICAgICAgICAgICAgICAgICAgICAgJiYgdHlwZW9mIGV4cG9ydGVkSXRlbSA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICAgICAgICAgICAgICAgICAgJiYgJ3Byb3RvdHlwZScgaW4gZXhwb3J0ZWRJdGVtXG4gICAgICAgICAgICAgICAgICAgICAgICAmJiBleHBvcnRlZEl0ZW0ucHJvdG90eXBlIGluc3RhbmNlb2YgQmFzZUVudGl0eVNlcnZpY2VcbiAgICAgICAgICAgICAgICAgICAgKSB7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLnVpR2VuRElDb250YWluZXIuaGFzKGV4cG9ydGVkSXRlbSwge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzOiB0cnVlXG4gICAgICAgICAgICAgICAgICAgICAgICB9KSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNjYW5uZWRTZXJ2aWNlcy5hZGQoZXhwb3J0ZWRJdGVtKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1Zyhgc2NhblNlcnZpY2VzRnJvbURpcmVjdG9yeTogcmVnaXN0ZXJpbmcgc2VydmljZTogJHtleHBvcnRlZEl0ZW0ubmFtZX1gKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYHNjYW5TZXJ2aWNlc0Zyb21EaXJlY3Rvcnk6IG5vIHByb3ZpZGVyIGNvdWxkIGJlIGZvdW5kIGZvciBzZXJ2aWNlOiAke2V4cG9ydGVkSXRlbS5uYW1lfWApO1xuXG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBzY2FuU2VydmljZXNGcm9tRGlyZWN0b3J5OiBTS0lQOiBleHBvcnRlZEl0ZW0gaXMgbm90IGEgc2VydmljZSBjbGFzczogJHsoZXhwb3J0ZWRJdGVtIGFzIGFueSk/Lm5hbWUgPyAoZXhwb3J0ZWRJdGVtIGFzIGFueSkubmFtZSA6IGV4cG9ydGVkSXRlbX1gKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgc2NhblNlcnZpY2VzRnJvbURpcmVjdG9yeTogRXhjZXB0aW9uIHdoaWxlIHRyeWluZyB0byBsb2FkIHNlcnZpY2VQYXRoOiAke3NlcnZpY2VQYXRofWAsIGUpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHNjYW5uZWRTZXJ2aWNlcztcbiAgICB9XG5cbiAgICBATG9nRHVyYXRpb24oKVxuICAgIGFzeW5jIHdyaXRlVG9GaWxlcyhtZW51Q29uZmlnOiBhbnksIGVudGl0aWVzQ29uZmlnOiBhbnksIGF1dGhDb25maWc6IGFueSwgZGFzaGJvYXJkQ29uZmlnOiBhbnkpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJDYWxsZWQgd3JpdGVUb0ZpbGVzOjo6Ojo6IFwiKTtcbiAgICAgICAgY29uc3QgZ2VuRGlyZWN0b3J5UGF0aCA9IHBhdGhSZXNvbHZlKCcuL2dlbi8nKTtcbiAgICAgICAgaWYgKCFleGlzdHNTeW5jKGdlbkRpcmVjdG9yeVBhdGgpKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgR2VuIERJUiBkb2VzIG5vdCBleGlzdHMsIGNyZWF0aW5nOiAke2dlbkRpcmVjdG9yeVBhdGh9YCwpO1xuICAgICAgICAgICAgbWtkaXJTeW5jKGdlbkRpcmVjdG9yeVBhdGgpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgY29uZmlnRGlyZWN0b3J5UGF0aCA9IHBhdGhSZXNvbHZlKHBhdGhKb2luKGdlbkRpcmVjdG9yeVBhdGgsICdjb25maWcnKSk7XG4gICAgICAgIGlmICghZXhpc3RzU3luYyhjb25maWdEaXJlY3RvcnlQYXRoKSkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENvbmZpZyBESVIgZG9lcyBub3QgZXhpc3RzLCBjcmVhdGluZzogJHtjb25maWdEaXJlY3RvcnlQYXRofWApO1xuICAgICAgICAgICAgbWtkaXJTeW5jKGNvbmZpZ0RpcmVjdG9yeVBhdGgpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgbWVudUNvbmZpZ0ZpbGVQYXRoID0gcGF0aEpvaW4oY29uZmlnRGlyZWN0b3J5UGF0aCwgJ21lbnUuanNvbicpO1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1Zyhgd3JpdGluZyBtZW51LWNvbmZpZy4uIGludG86ICR7bWVudUNvbmZpZ0ZpbGVQYXRofWApO1xuICAgICAgICB3cml0ZUZpbGVTeW5jKG1lbnVDb25maWdGaWxlUGF0aCwgSlNPTi5zdHJpbmdpZnkobWVudUNvbmZpZywgbnVsbCwgMikpO1xuXG4gICAgICAgIGNvbnN0IGVudGl0aWVzQ29uZmlnRmlsZVBhdGggPSBwYXRoSm9pbihjb25maWdEaXJlY3RvcnlQYXRoLCAnZW50aXRpZXMuanNvbicpO1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1Zyhgd3JpdGluZyBlbnRpdGllcy1jb25maWcuLiBpbnRvOiAke2VudGl0aWVzQ29uZmlnRmlsZVBhdGh9YCwpO1xuICAgICAgICB3cml0ZUZpbGVTeW5jKGVudGl0aWVzQ29uZmlnRmlsZVBhdGgsIEpTT04uc3RyaW5naWZ5KGVudGl0aWVzQ29uZmlnLCBudWxsLCAyKSk7XG5cbiAgICAgICAgY29uc3QgYXV0aENvbmZpZ0ZpbGVQYXRoID0gcGF0aEpvaW4oY29uZmlnRGlyZWN0b3J5UGF0aCwgJ2F1dGguanNvbicpO1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1Zyhgd3JpdGluZyBhdXRoLWNvbmZpZy4uIGludG86ICR7YXV0aENvbmZpZ0ZpbGVQYXRofWAsKTtcbiAgICAgICAgd3JpdGVGaWxlU3luYyhhdXRoQ29uZmlnRmlsZVBhdGgsIEpTT04uc3RyaW5naWZ5KGF1dGhDb25maWcsIG51bGwsIDIpKTtcblxuICAgICAgICBjb25zdCBkYXNoYm9hcmRDb25maWdGaWxlUGF0aCA9IHBhdGhKb2luKGNvbmZpZ0RpcmVjdG9yeVBhdGgsICdkYXNoYm9hcmQuanNvbicpO1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1Zyhgd3JpdGluZyBkYXNoYm9hcmQtY29uZmlnLi4gaW50bzogJHtkYXNoYm9hcmRDb25maWdGaWxlUGF0aH1gLCk7XG4gICAgICAgIHdyaXRlRmlsZVN5bmMoZGFzaGJvYXJkQ29uZmlnRmlsZVBhdGgsIEpTT04uc3RyaW5naWZ5KGRhc2hib2FyZENvbmZpZywgbnVsbCwgMikpO1xuXG4gICAgfVxufVxuXG4iXX0=