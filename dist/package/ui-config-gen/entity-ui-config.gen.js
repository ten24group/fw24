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
        switch (config.pageType) {
            case 'list':
                return `list-${config.pageTitle.toLowerCase().replace(/\s+/g, '-')}`;
            case 'form':
                return config.pageTitle.toLowerCase().includes('add')
                    ? `create-${config.pageTitle.toLowerCase().replace(/\s+/g, '-').replace('add-', '')}`
                    : `edit-${config.pageTitle.toLowerCase().replace(/\s+/g, '-').replace('edit-', '')}`;
            case 'details':
                return `view-${config.pageTitle.toLowerCase().replace(/\s+/g, '-')}`;
            case 'dashboard':
                return `${config.pageTitle.toLowerCase().replace(/\s+/g, '-')}`;
            case 'accordion':
                return `accordion-${config.pageTitle.toLowerCase().replace(/\s+/g, '-')}`;
            case 'menu':
                return `${config.pageTitle.toLowerCase().replace(/\s+/g, '-')}`;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW50aXR5LXVpLWNvbmZpZy5nZW4uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdWktY29uZmlnLWdlbi9lbnRpdHktdWktY29uZmlnLmdlbi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFDQSw4RUFBK0Q7QUFDL0QsOEVBQStEO0FBQy9ELDBFQUEyRDtBQUMzRCwwRUFBMkQ7QUFDM0QsMEVBQTJEO0FBQzNELHNDQUE0RDtBQUM1RCx5REFBMEo7QUFFMUosNERBQThDO0FBQzlDLHNFQUF3RDtBQUV4RCwyQkFBMEQ7QUFDMUQsK0JBR2M7QUFFZCx1Q0FBb0M7QUFDcEMsMkNBQXdDO0FBQ3hDLHdDQUF1RDtBQUV2RCxNQUFhLGlCQUFpQjtJQUNqQixNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLGlCQUFpQixDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ3ZELDhGQUE4RjtJQUM5RixtQ0FBbUM7SUFDMUIsZ0JBQWdCLEdBQUcsV0FBSSxDQUFDLFdBQVcsRUFBRSxDQUFDLGlCQUFpQixFQUFFLENBQUM7SUFFM0QsV0FBVyxHQUFtQyxJQUFJLEdBQUcsRUFBRSxDQUFDO0lBRzFELEFBQU4sS0FBSyxDQUFDLGVBQWU7UUFDakIsTUFBTSxJQUFJLEdBQUcsV0FBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO1FBQ2hDLE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQztRQUNoQyxNQUFNLGNBQWMsR0FBRyxNQUFNLENBQUMsa0JBQWtCLEVBQUUsb0JBQW9CLElBQUksY0FBYyxDQUFDO1FBRXpGLE1BQU0sc0JBQXNCLEdBQUcsQ0FBRSxJQUFBLGNBQVcsRUFBQyxTQUFTLGNBQWMsR0FBRyxDQUFDLENBQUUsQ0FBQztRQUUzRSxJQUFJLElBQUksQ0FBQyxVQUFVLEVBQUUsRUFBRSxDQUFDO1lBQ3BCLEtBQUssTUFBTSxDQUFFLEFBQUQsRUFB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QUMsdUJBQXVCLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxlQUFlLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFFckYsQ0FBQztDQUNKO0FBbmJELDhDQW1iQztBQTFhUztJQURMLElBQUEscUJBQVcsR0FBRTt3REF3Q2I7QUE2REs7SUFETCxJQUFBLHFCQUFXLEdBQUU7Z0RBdUxiO0FBR0Q7SUFEQyxJQUFBLHFCQUFXLEdBQUU7bUVBaUJiO0FBR0s7SUFETCxJQUFBLHFCQUFXLEdBQUU7NERBcUNiO0FBR0s7SUFETCxJQUFBLHFCQUFXLEdBQUU7a0VBa0RiO0FBR0s7SUFETCxJQUFBLHFCQUFXLEdBQUU7cURBK0JiIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgdHlwZSB9IGZyb20gJ29zJztcbmltcG9ydCBNYWtlQ3JlYXRlRW50aXR5Q29uZmlnIGZyb20gJy4vdGVtcGxhdGVzL2NyZWF0ZS1lbnRpdHknO1xuaW1wb3J0IE1ha2VVcGRhdGVFbnRpdHlDb25maWcgZnJvbSAnLi90ZW1wbGF0ZXMvdXBkYXRlLWVudGl0eSc7XG5pbXBvcnQgTWFrZUxpc3RFbnRpdHlDb25maWcgZnJvbSAnLi90ZW1wbGF0ZXMvbGlzdC1lbnRpdHknO1xuaW1wb3J0IE1ha2VWaWV3RW50aXR5Q29uZmlnIGZyb20gJy4vdGVtcGxhdGVzL3ZpZXctZW50aXR5JztcbmltcG9ydCBNYWtlRW50aXR5TWVudUNvbmZpZyBmcm9tICcuL3RlbXBsYXRlcy9lbnRpdHktbWVudSc7XG5pbXBvcnQgeyBCYXNlRW50aXR5U2VydmljZSwgRW50aXR5U2NoZW1hIH0gZnJvbSAnLi4vZW50aXR5JztcbmltcG9ydCB7IG1ha2VDdXN0b21QYWdlQ29uZmlnLCBDdXN0b21QYWdlT3B0aW9ucywgTGlzdFBhZ2VDb25maWcsIEZvcm1QYWdlQ29uZmlnLCBEZXRhaWxzUGFnZUNvbmZpZywgRGFzaGJvYXJkUGFnZUNvbmZpZyB9IGZyb20gJy4vdGVtcGxhdGVzL2N1c3RvbS1wYWdlJztcblxuaW1wb3J0IE1ha2VBdXRoQ29uZmlnIGZyb20gJy4vdGVtcGxhdGVzL2F1dGgnO1xuaW1wb3J0IE1ha2VEYXNoYm9hcmRDb25maWcgZnJvbSAnLi90ZW1wbGF0ZXMvZGFzaGJvYXJkJztcblxuaW1wb3J0IHsgZXhpc3RzU3luYywgbWtkaXJTeW5jLCB3cml0ZUZpbGVTeW5jIH0gZnJvbSBcImZzXCI7XG5pbXBvcnQge1xuICAgIHJlc29sdmUgYXMgcGF0aFJlc29sdmUsXG4gICAgam9pbiBhcyBwYXRoSm9pblxufSBmcm9tIFwicGF0aFwiO1xuXG5pbXBvcnQgeyBGdzI0IH0gZnJvbSAnLi4vY29yZS9mdzI0JztcbmltcG9ydCB7IEhlbHBlciB9IGZyb20gJy4uL2NvcmUvaGVscGVyJztcbmltcG9ydCB7IExvZ0R1cmF0aW9uLCBjcmVhdGVMb2dnZXIgfSBmcm9tICcuLi9sb2dnaW5nJztcblxuZXhwb3J0IGNsYXNzIEVudGl0eVVJQ29uZmlnR2VuIHtcbiAgICByZWFkb25seSBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoRW50aXR5VUlDb25maWdHZW4ubmFtZSk7XG4gICAgLy8gbWFrZSBzdXJlIHRvIGNyZWF0ZSBhIGNoaWxkIGNvbnRhaW5lciB0byBub3QgcG9sbHV0ZSBhbnl0aGluZyBpbiB0aGUgQXBwbGljYXRpb24gY29udGFpbmVyIFxuICAgIC8vIHdoaWxlIHNjYW5uaW5nIGFuZCBsb2FkaW5nIHN0dWZmXG4gICAgcmVhZG9ubHkgdWlHZW5ESUNvbnRhaW5lciA9IEZ3MjQuZ2V0SW5zdGFuY2UoKS5nZXRBcHBESUNvbnRhaW5lcigpO1xuXG4gICAgcHJpdmF0ZSBjdXN0b21QYWdlczogTWFwPHN0cmluZywgQ3VzdG9tUGFnZU9wdGlvbnM+ID0gbmV3IE1hcCgpO1xuXG4gICAgQExvZ0R1cmF0aW9uKClcbiAgICBhc3luYyBzY2FuQ3VzdG9tUGFnZXMoKSB7XG4gICAgICAgIGNvbnN0IGZ3MjQgPSBGdzI0LmdldEluc3RhbmNlKCk7XG4gICAgICAgIGNvbnN0IGNvbmZpZyA9IGZ3MjQuZ2V0Q29uZmlnKCk7XG4gICAgICAgIGNvbnN0IGN1c3RvbVBhZ2VzRGlyID0gY29uZmlnLnVpQ29uZmlnR2VuT3B0aW9ucz8uY3VzdG9tUGFnZXNEaXJlY3RvcnkgfHwgJ2N1c3RvbS1wYWdlcyc7XG5cbiAgICAgICAgY29uc3QgY3VzdG9tUGFnZXNEaXJlY3RvcmllcyA9IFsgcGF0aFJlc29sdmUoYC4vc3JjLyR7Y3VzdG9tUGFnZXNEaXJ9L2ApIF07XG5cbiAgICAgICAgaWYgKGZ3MjQuaGFzTW9kdWxlcygpKSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IFsgLCBtb2R1bGUgXSBvZiBmdzI0LmdldE1vZHVsZXMoKSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IG1vZHVsZUN1c3RvbVBhZ2VzUGF0aCA9IHBhdGhKb2luKG1vZHVsZS5nZXRCYXNlUGF0aCgpLCBjdXN0b21QYWdlc0Rpcik7XG4gICAgICAgICAgICAgICAgY3VzdG9tUGFnZXNEaXJlY3Rvcmllcy5wdXNoKHBhdGhSZXNvbHZlKG1vZHVsZUN1c3RvbVBhZ2VzUGF0aCkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgZm9yIChjb25zdCBkaXIgb2YgY3VzdG9tUGFnZXNEaXJlY3Rvcmllcykge1xuICAgICAgICAgICAgaWYgKCFleGlzdHNTeW5jKGRpcikpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQ3VzdG9tIHBhZ2VzIGRpcmVjdG9yeSBkb2VzIG5vdCBleGlzdDogJHtkaXJ9YCk7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGN1c3RvbVBhZ2VGaWxlcyA9IEhlbHBlci5zY2FuQ29udHJvbGxlclNvdXJjZUZpbGVzRnJvbShkaXIpO1xuXG4gICAgICAgICAgICBmb3IgKGNvbnN0IGZpbGUgb2YgY3VzdG9tUGFnZUZpbGVzKSB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbW9kdWxlID0gYXdhaXQgaW1wb3J0KHBhdGhKb2luKGRpciwgZmlsZSkpO1xuICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IFsga2V5LCB2YWx1ZSBdIG9mIE9iamVjdC5lbnRyaWVzKG1vZHVsZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLmlzVmFsaWRDdXN0b21QYWdlQ29uZmlnKHZhbHVlKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHBhZ2VOYW1lID0gdGhpcy5nZXRQYWdlTmFtZUZyb21Db25maWcodmFsdWUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChwYWdlTmFtZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnJlZ2lzdGVyQ3VzdG9tUGFnZSh2YWx1ZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFJlZ2lzdGVyZWQgY3VzdG9tIHBhZ2U6ICR7cGFnZU5hbWV9YCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgRXJyb3IgbG9hZGluZyBjdXN0b20gcGFnZSBmcm9tICR7ZmlsZX06YCwgZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHVibGljIGlzVmFsaWRDdXN0b21QYWdlQ29uZmlnKHZhbHVlOiB1bmtub3duKTogdmFsdWUgaXMgQ3VzdG9tUGFnZU9wdGlvbnMge1xuICAgICAgICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gJ29iamVjdCcpIHJldHVybiBmYWxzZTtcblxuICAgICAgICBjb25zdCBjb25maWcgPSB2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICAgICAgaWYgKCEoJ3BhZ2VUeXBlJyBpbiBjb25maWcpIHx8ICEoJ3BhZ2VUaXRsZScgaW4gY29uZmlnKSkgcmV0dXJuIGZhbHNlO1xuXG4gICAgICAgIGNvbnN0IHBhZ2VUeXBlID0gY29uZmlnLnBhZ2VUeXBlO1xuICAgICAgICBpZiAocGFnZVR5cGUgPT09ICdsaXN0Jykge1xuICAgICAgICAgICAgcmV0dXJuICdsaXN0UGFnZUNvbmZpZycgaW4gY29uZmlnO1xuICAgICAgICB9IGVsc2UgaWYgKHBhZ2VUeXBlID09PSAnZm9ybScpIHtcbiAgICAgICAgICAgIHJldHVybiAnZm9ybVBhZ2VDb25maWcnIGluIGNvbmZpZztcbiAgICAgICAgfSBlbHNlIGlmIChwYWdlVHlwZSA9PT0gJ2RldGFpbHMnKSB7XG4gICAgICAgICAgICByZXR1cm4gJ2RldGFpbHNQYWdlQ29uZmlnJyBpbiBjb25maWc7XG4gICAgICAgIH0gZWxzZSBpZiAocGFnZVR5cGUgPT09ICdkYXNoYm9hcmQnKSB7XG4gICAgICAgICAgICByZXR1cm4gJ2Rhc2hib2FyZFBhZ2VDb25maWcnIGluIGNvbmZpZztcbiAgICAgICAgfSBlbHNlIGlmIChwYWdlVHlwZSA9PT0gJ2FjY29yZGlvbicpIHtcbiAgICAgICAgICAgIHJldHVybiAnYWNjb3JkaW9uUGFnZUNvbmZpZycgaW4gY29uZmlnO1xuICAgICAgICB9IGVsc2UgaWYgKHBhZ2VUeXBlID09PSAnbWVudScpIHtcbiAgICAgICAgICAgIHJldHVybiAnbWVudVBhZ2VDb25maWcnIGluIGNvbmZpZztcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBnZXRQYWdlTmFtZUZyb21Db25maWcoY29uZmlnOiBDdXN0b21QYWdlT3B0aW9ucyk6IHN0cmluZyB8IG51bGwge1xuICAgICAgICBzd2l0Y2ggKGNvbmZpZy5wYWdlVHlwZSkge1xuICAgICAgICAgICAgY2FzZSAnbGlzdCc6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGBsaXN0LSR7Y29uZmlnLnBhZ2VUaXRsZS50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL1xccysvZywgJy0nKX1gO1xuICAgICAgICAgICAgY2FzZSAnZm9ybSc6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGNvbmZpZy5wYWdlVGl0bGUudG9Mb3dlckNhc2UoKS5pbmNsdWRlcygnYWRkJylcbiAgICAgICAgICAgICAgICAgICAgPyBgY3JlYXRlLSR7Y29uZmlnLnBhZ2VUaXRsZS50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL1xccysvZywgJy0nKS5yZXBsYWNlKCdhZGQtJywgJycpfWBcbiAgICAgICAgICAgICAgICAgICAgOiBgZWRpdC0ke2NvbmZpZy5wYWdlVGl0bGUudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9cXHMrL2csICctJykucmVwbGFjZSgnZWRpdC0nLCAnJyl9YDtcbiAgICAgICAgICAgIGNhc2UgJ2RldGFpbHMnOlxuICAgICAgICAgICAgICAgIHJldHVybiBgdmlldy0ke2NvbmZpZy5wYWdlVGl0bGUudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9cXHMrL2csICctJyl9YDtcbiAgICAgICAgICAgIGNhc2UgJ2Rhc2hib2FyZCc6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGAke2NvbmZpZy5wYWdlVGl0bGUudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9cXHMrL2csICctJyl9YDtcbiAgICAgICAgICAgIGNhc2UgJ2FjY29yZGlvbic6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGBhY2NvcmRpb24tJHtjb25maWcucGFnZVRpdGxlLnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvXFxzKy9nLCAnLScpfWA7XG4gICAgICAgICAgICBjYXNlICdtZW51JzpcbiAgICAgICAgICAgICAgICByZXR1cm4gYCR7Y29uZmlnLnBhZ2VUaXRsZS50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL1xccysvZywgJy0nKX1gO1xuICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJlZ2lzdGVyIGEgY3VzdG9tIHBhZ2UuIFN1cHBvcnRzIG9wdGlvbmFsIHJvdXRlUGF0dGVybiBmb3IgZHluYW1pYyByb3V0ZXMgKGUuZy4sIC9hdXRob3IvOmF1dGhvcklkL2Jvb2tzKVxuICAgICAqL1xuICAgIHB1YmxpYyByZWdpc3RlckN1c3RvbVBhZ2Uob3B0aW9uczogQ3VzdG9tUGFnZU9wdGlvbnMpIHtcbiAgICAgICAgY29uc3QgcGFnZU5hbWUgPSB0aGlzLmdldFBhZ2VOYW1lRnJvbUNvbmZpZyhvcHRpb25zKTtcbiAgICAgICAgaWYgKHBhZ2VOYW1lKSB7XG4gICAgICAgICAgICB0aGlzLmN1c3RvbVBhZ2VzLnNldChwYWdlTmFtZSwgb3B0aW9ucyk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBhc3luYyBydW4oKSB7XG4gICAgICAgIHRoaXMucHJvY2VzcygpO1xuICAgIH1cblxuICAgIEBMb2dEdXJhdGlvbigpXG4gICAgYXN5bmMgcHJvY2VzcygpIHtcbiAgICAgICAgY29uc3QgbWVudUNvbmZpZ3M6IGFueVtdID0gW107XG4gICAgICAgIGNvbnN0IGVudGl0eUNvbmZpZ3M6IGFueSA9IHt9O1xuXG4gICAgICAgIGNvbnN0IHNlcnZpY2VEaXJlY3RvcmllcyA9IHRoaXMucHJlcGFyZVNlcnZpY2VzRGlyZWN0b3JpZXMoKTtcblxuICAgICAgICBjb25zdCBzZXJ2aWNlcyA9IGF3YWl0IHRoaXMuc2NhbkFuZExvYWRTZXJ2aWNlcyhzZXJ2aWNlRGlyZWN0b3JpZXMpO1xuXG4gICAgICAgIC8vIFNjYW4gYW5kIGxvYWQgY3VzdG9tIHBhZ2VzXG4gICAgICAgIGF3YWl0IHRoaXMuc2NhbkN1c3RvbVBhZ2VzKCk7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFVpLWNvbmZpZy1nZW46OjogUHJvY2Vzczo6OiBhbGwtc2VydmljZXM6IGAsIEFycmF5LmZyb20oc2VydmljZXMua2V5cygpKSk7XG5cbiAgICAgICAgbGV0IG1lbnVJbmRleCA9IDE7XG4gICAgICAgIC8vIGdlbmVyYXRlIFVJIGNvbmZpZ3NcbiAgICAgICAgc2VydmljZXMuZm9yRWFjaCgoc2VydmljZSwgZW50aXR5TmFtZSkgPT4ge1xuXG4gICAgICAgICAgICBjb25zdCBlbnRpdHlTY2hlbWEgPSBzZXJ2aWNlLmdldEVudGl0eVNjaGVtYSgpIGFzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PjtcbiAgICAgICAgICAgIGNvbnN0IGVudGl0eURlZmF1bHRPcHNTY2hlbWEgPSBzZXJ2aWNlLmdldE9wc0RlZmF1bHRJT1NjaGVtYSgpO1xuXG4gICAgICAgICAgICBpZiAoIWVudGl0eVNjaGVtYS5tb2RlbC5leGNsdWRlRnJvbUFkbWluQ3JlYXRlKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgY3JlYXRlQ29uZmlnID0gTWFrZUNyZWF0ZUVudGl0eUNvbmZpZyh7XG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWVQbHVyYWw6IGVudGl0eVNjaGVtYS5tb2RlbC5lbnRpdHlOYW1lUGx1cmFsLFxuICAgICAgICAgICAgICAgICAgICBDUlVEQXBpUGF0aDogZW50aXR5U2NoZW1hLm1vZGVsLkNSVURBcGlQYXRoLFxuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiBlbnRpdHlEZWZhdWx0T3BzU2NoZW1hLmNyZWF0ZS5pbnB1dCxcbiAgICAgICAgICAgICAgICAgICAgYnJlYWRjcnVtYnM6IGVudGl0eVNjaGVtYS5tb2RlbC5jcmVhdGVQYWdlQnJlYWRjcnVtYnMsXG4gICAgICAgICAgICAgICAgICAgIGNvbHVtbnNDb25maWc6IGVudGl0eVNjaGVtYS5tb2RlbC5jcmVhdGVQYWdlQ29sdW1uc0NvbmZpZyxcbiAgICAgICAgICAgICAgICB9LCBzZXJ2aWNlKTtcbiAgICAgICAgICAgICAgICBlbnRpdHlDb25maWdzWyBgY3JlYXRlLSR7ZW50aXR5TmFtZS50b0xvd2VyQ2FzZSgpfWAgXSA9IGNyZWF0ZUNvbmZpZztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKCFlbnRpdHlTY2hlbWEubW9kZWwuZXhjbHVkZUZyb21BZG1pblVwZGF0ZSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHVwZGF0ZUNvbmZpZyA9IE1ha2VVcGRhdGVFbnRpdHlDb25maWcoe1xuICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lUGx1cmFsOiBlbnRpdHlTY2hlbWEubW9kZWwuZW50aXR5TmFtZVBsdXJhbCxcbiAgICAgICAgICAgICAgICAgICAgQ1JVREFwaVBhdGg6IGVudGl0eVNjaGVtYS5tb2RlbC5DUlVEQXBpUGF0aCxcbiAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllczogZW50aXR5RGVmYXVsdE9wc1NjaGVtYS51cGRhdGUuaW5wdXQsXG4gICAgICAgICAgICAgICAgICAgIGFjdGlvbnM6IGVudGl0eVNjaGVtYS5tb2RlbC5lZGl0UGFnZUFjdGlvbnMsXG4gICAgICAgICAgICAgICAgICAgIGJyZWFkY3J1bWJzOiBlbnRpdHlTY2hlbWEubW9kZWwuZWRpdFBhZ2VCcmVhZGNydW1icyxcbiAgICAgICAgICAgICAgICAgICAgY29sdW1uc0NvbmZpZzogZW50aXR5U2NoZW1hLm1vZGVsLmVkaXRQYWdlQ29sdW1uc0NvbmZpZyxcbiAgICAgICAgICAgICAgICB9LCBzZXJ2aWNlKTtcbiAgICAgICAgICAgICAgICBlbnRpdHlDb25maWdzWyBgZWRpdC0ke2VudGl0eU5hbWUudG9Mb3dlckNhc2UoKX1gIF0gPSB1cGRhdGVDb25maWc7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICghZW50aXR5U2NoZW1hLm1vZGVsLmV4Y2x1ZGVGcm9tQWRtaW5MaXN0KSB7XG4gICAgICAgICAgICAgICAgY29uc3QgbGlzdENvbmZpZyA9IE1ha2VMaXN0RW50aXR5Q29uZmlnKHtcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZVBsdXJhbDogZW50aXR5U2NoZW1hLm1vZGVsLmVudGl0eU5hbWVQbHVyYWwsXG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IGVudGl0eURlZmF1bHRPcHNTY2hlbWEubGlzdC5vdXRwdXQsXG4gICAgICAgICAgICAgICAgICAgIENSVURBcGlQYXRoOiBlbnRpdHlTY2hlbWEubW9kZWwuQ1JVREFwaVBhdGgsXG4gICAgICAgICAgICAgICAgICAgIHVzZVNlYXJjaDogQm9vbGVhbihlbnRpdHlTY2hlbWEubW9kZWwuc2VhcmNoPy5lbmFibGVkKSxcbiAgICAgICAgICAgICAgICAgICAgZXhjbHVkZUZyb21BZG1pbkNyZWF0ZTogZW50aXR5U2NoZW1hLm1vZGVsLmV4Y2x1ZGVGcm9tQWRtaW5DcmVhdGUsXG4gICAgICAgICAgICAgICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5VcGRhdGU6IGVudGl0eVNjaGVtYS5tb2RlbC5leGNsdWRlRnJvbUFkbWluVXBkYXRlLFxuICAgICAgICAgICAgICAgICAgICBleGNsdWRlRnJvbUFkbWluRGVsZXRlOiBlbnRpdHlTY2hlbWEubW9kZWwuZXhjbHVkZUZyb21BZG1pbkRlbGV0ZSxcbiAgICAgICAgICAgICAgICAgICAgZXhjbHVkZUZyb21BZG1pbkRldGFpbDogZW50aXR5U2NoZW1hLm1vZGVsLmV4Y2x1ZGVGcm9tQWRtaW5EZXRhaWwsXG4gICAgICAgICAgICAgICAgICAgIHBhZ2VIZWFkZXJBY3Rpb25zOiBlbnRpdHlTY2hlbWEubW9kZWwubGlzdFBhZ2VBY3Rpb25zLFxuICAgICAgICAgICAgICAgICAgICBicmVhZGNydW1iczogZW50aXR5U2NoZW1hLm1vZGVsLmxpc3RQYWdlQnJlYWRjcnVtYnMsXG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHRTb3J0OiBlbnRpdHlTY2hlbWEubW9kZWwubGlzdFBhZ2VEZWZhdWx0U29ydCxcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICBlbnRpdHlDb25maWdzWyBgbGlzdC0ke2VudGl0eU5hbWUudG9Mb3dlckNhc2UoKX1gIF0gPSBsaXN0Q29uZmlnO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoIWVudGl0eVNjaGVtYS5tb2RlbC5leGNsdWRlRnJvbUFkbWluRGV0YWlsKSB7XG4gICAgICAgICAgICAgICAgY29uc3Qgdmlld0NvbmZpZyA9IE1ha2VWaWV3RW50aXR5Q29uZmlnKHtcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZVBsdXJhbDogZW50aXR5U2NoZW1hLm1vZGVsLmVudGl0eU5hbWVQbHVyYWwsXG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IGVudGl0eURlZmF1bHRPcHNTY2hlbWEuZ2V0Lm91dHB1dCxcbiAgICAgICAgICAgICAgICAgICAgQ1JVREFwaVBhdGg6IGVudGl0eVNjaGVtYS5tb2RlbC5DUlVEQXBpUGF0aCxcbiAgICAgICAgICAgICAgICAgICAgYWN0aW9uczogZW50aXR5U2NoZW1hLm1vZGVsLnZpZXdQYWdlQWN0aW9ucyxcbiAgICAgICAgICAgICAgICAgICAgYnJlYWRjcnVtYnM6IGVudGl0eVNjaGVtYS5tb2RlbC52aWV3UGFnZUJyZWFkY3J1bWJzLFxuICAgICAgICAgICAgICAgICAgICBjb2x1bW5zQ29uZmlnOiBlbnRpdHlTY2hlbWEubW9kZWwudmlld1BhZ2VDb2x1bW5zQ29uZmlnLFxuICAgICAgICAgICAgICAgIH0sIHNlcnZpY2UpO1xuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ3NbIGB2aWV3LSR7ZW50aXR5TmFtZS50b0xvd2VyQ2FzZSgpfWAgXSA9IHZpZXdDb25maWc7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICghZW50aXR5U2NoZW1hLm1vZGVsLmV4Y2x1ZGVGcm9tQWRtaW5NZW51KSB7XG4gICAgICAgICAgICAgICAgY29uc3QgbWVudUNvbmZpZyA9IE1ha2VFbnRpdHlNZW51Q29uZmlnKHtcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZVBsdXJhbDogZW50aXR5U2NoZW1hLm1vZGVsLmVudGl0eU5hbWVQbHVyYWwsXG4gICAgICAgICAgICAgICAgICAgIGljb246IGVudGl0eVNjaGVtYS5tb2RlbC5lbnRpdHlNZW51SWNvbiB8fCAnYXBwU3RvcmUnLFxuICAgICAgICAgICAgICAgICAgICBtZW51SW5kZXg6IG1lbnVJbmRleCsrLFxuICAgICAgICAgICAgICAgICAgICBleGNsdWRlRnJvbUFkbWluTGlzdDogZW50aXR5U2NoZW1hLm1vZGVsLmV4Y2x1ZGVGcm9tQWRtaW5MaXN0LFxuICAgICAgICAgICAgICAgICAgICBleGNsdWRlRnJvbUFkbWluQ3JlYXRlOiBlbnRpdHlTY2hlbWEubW9kZWwuZXhjbHVkZUZyb21BZG1pbkNyZWF0ZSxcbiAgICAgICAgICAgICAgICAgICAgbWVudUdyb3VwOiBlbnRpdHlTY2hlbWEubW9kZWwubWVudUdyb3VwLFxuICAgICAgICAgICAgICAgICAgICBtZW51T3JkZXI6IGVudGl0eVNjaGVtYS5tb2RlbC5tZW51T3JkZXIsXG4gICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICBtZW51Q29uZmlncy5wdXNoKG1lbnVDb25maWcpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIFByb2Nlc3MgY3VzdG9tIHBhZ2VzXG4gICAgICAgIGZvciAoY29uc3QgWyBwYWdlTmFtZSwgb3B0aW9ucyBdIG9mIHRoaXMuY3VzdG9tUGFnZXMpIHtcbiAgICAgICAgICAgIC8vIHNraXAgdGhlIGRlZmF1bHQgZGFzaGJvYXJkIHBhZ2UgYW5kIG1lbnUgcGFnZVxuICAgICAgICAgICAgaWYgKHBhZ2VOYW1lID09PSAnZGFzaGJvYXJkJyB8fCBwYWdlTmFtZSA9PT0gJ21lbnUnKSB7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zdCBjdXN0b21Db25maWcgPSBtYWtlQ3VzdG9tUGFnZUNvbmZpZyhvcHRpb25zKTtcbiAgICAgICAgICAgIGVudGl0eUNvbmZpZ3NbIHBhZ2VOYW1lIF0gPSBjdXN0b21Db25maWc7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBhdXRoQ29uZmlnT3B0aW9ucyA9IEZ3MjQuZ2V0SW5zdGFuY2UoKS5nZXRDb25maWcoKS51aUNvbmZpZ0dlbk9wdGlvbnMgfHwge307XG5cbiAgICAgICAgY29uc3QgYXV0aENvbmZpZ3MgPSBNYWtlQXV0aENvbmZpZyh7XG4gICAgICAgICAgICAuLi5hdXRoQ29uZmlnT3B0aW9ucyxcbiAgICAgICAgICAgIGF1dGhFbmRwb2ludDogYXV0aENvbmZpZ09wdGlvbnMuYXV0aEVuZHBvaW50IHx8ICdtYXV0aCdcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gTG9vayBmb3IgYSBkYXNoYm9hcmQgY3VzdG9tIHBhZ2VcbiAgICAgICAgbGV0IGRhc2hib2FyZENvbmZpZzogRGFzaGJvYXJkUGFnZUNvbmZpZyB8IGFueSA9IG51bGw7XG4gICAgICAgIGZvciAoY29uc3QgWyAsIG9wdGlvbnMgXSBvZiB0aGlzLmN1c3RvbVBhZ2VzKSB7XG4gICAgICAgICAgICBpZiAob3B0aW9ucy5wYWdlVHlwZSA9PT0gJ2Rhc2hib2FyZCcgJiYgb3B0aW9ucy5wYWdlVGl0bGUudG9Mb3dlckNhc2UoKSA9PT0gJ2Rhc2hib2FyZCcpIHtcbiAgICAgICAgICAgICAgICBkYXNoYm9hcmRDb25maWcgPSBvcHRpb25zO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGlmICghZGFzaGJvYXJkQ29uZmlnKSB7XG4gICAgICAgICAgICBkYXNoYm9hcmRDb25maWcgPSBNYWtlRGFzaGJvYXJkQ29uZmlnKCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBMb29rIGZvciBhIG1lbnUgY3VzdG9tIHBhZ2VcbiAgICAgICAgbGV0IG1lbnVDb25maWc6IGFueSA9IG51bGw7XG4gICAgICAgIGZvciAoY29uc3QgWyBwYWdlTmFtZSwgb3B0aW9ucyBdIG9mIHRoaXMuY3VzdG9tUGFnZXMpIHtcbiAgICAgICAgICAgIGlmIChvcHRpb25zLnBhZ2VUeXBlID09PSAnbWVudScgJiYgb3B0aW9ucy5wYWdlVGl0bGUudG9Mb3dlckNhc2UoKSA9PT0gJ21lbnUnKSB7XG4gICAgICAgICAgICAgICAgbWVudUNvbmZpZyA9IG9wdGlvbnM7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBHcm91cCBtZW51IGl0ZW1zIGJ5IHRoZWlyIGdyb3VwIHByb3BlcnR5XG4gICAgICAgIGNvbnN0IG1lbnVHcm91cHMgPSBuZXcgTWFwPHN0cmluZywgYW55W10+KCk7XG4gICAgICAgIGNvbnN0IHVuZ3JvdXBlZEl0ZW1zOiBhbnlbXSA9IFtdO1xuXG4gICAgICAgIC8vIFByb2Nlc3MgZW50aXR5IG1lbnUgaXRlbXNcbiAgICAgICAgbWVudUNvbmZpZ3MuZm9yRWFjaChpdGVtID0+IHtcbiAgICAgICAgICAgIGlmIChpdGVtLmdyb3VwKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFtZW51R3JvdXBzLmhhcyhpdGVtLmdyb3VwKSkge1xuICAgICAgICAgICAgICAgICAgICBtZW51R3JvdXBzLnNldChpdGVtLmdyb3VwLCBbXSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIG1lbnVHcm91cHMuZ2V0KGl0ZW0uZ3JvdXApIS5wdXNoKGl0ZW0pO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB1bmdyb3VwZWRJdGVtcy5wdXNoKGl0ZW0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBQcm9jZXNzIGN1c3RvbSBtZW51IGl0ZW1zXG4gICAgICAgIGlmIChtZW51Q29uZmlnPy5tZW51UGFnZUNvbmZpZz8ubWVudUl0ZW1zKSB7XG4gICAgICAgICAgICBtZW51Q29uZmlnLm1lbnVQYWdlQ29uZmlnLm1lbnVJdGVtcy5mb3JFYWNoKChpdGVtOiBhbnkpID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoaXRlbS5ncm91cCkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoIW1lbnVHcm91cHMuaGFzKGl0ZW0uZ3JvdXApKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBtZW51R3JvdXBzLnNldChpdGVtLmdyb3VwLCBbXSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgbWVudUdyb3Vwcy5nZXQoaXRlbS5ncm91cCkhLnB1c2goaXRlbSk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgdW5ncm91cGVkSXRlbXMucHVzaChpdGVtKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENyZWF0ZSBmaW5hbCBtZW51IHN0cnVjdHVyZVxuICAgICAgICBjb25zdCBhbGxNZW51SXRlbXM6IGFueVtdID0gW107XG5cbiAgICAgICAgLy8gQWRkIHVuZ3JvdXBlZCBpdGVtcyBmaXJzdCAocHJpbWFyeSBuYXZpZ2F0aW9uKVxuICAgICAgICBhbGxNZW51SXRlbXMucHVzaCguLi51bmdyb3VwZWRJdGVtcyk7XG5cbiAgICAgICAgLy8gQWRkIGdyb3VwZWQgaXRlbXNcbiAgICAgICAgbWVudUdyb3Vwcy5mb3JFYWNoKChpdGVtcywgZ3JvdXBOYW1lKSA9PiB7XG4gICAgICAgICAgICAvLyBTb3J0IGl0ZW1zIHdpdGhpbiBncm91cCBieSBvcmRlclxuICAgICAgICAgICAgaXRlbXMuc29ydCgoYSwgYikgPT4gKGEub3JkZXIgfHwgMCkgLSAoYi5vcmRlciB8fCAwKSk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIENyZWF0ZSBncm91cCBpdGVtXG4gICAgICAgICAgICBhbGxNZW51SXRlbXMucHVzaCh7XG4gICAgICAgICAgICAgICAgbGFiZWw6IGdyb3VwTmFtZSxcbiAgICAgICAgICAgICAgICBrZXk6IGBncm91cC0ke2dyb3VwTmFtZX1gLFxuICAgICAgICAgICAgICAgIGljb246ICdGb2xkZXJPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgY2hpbGRyZW46IGl0ZW1zXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgYXdhaXQgdGhpcy53cml0ZVRvRmlsZXMoYWxsTWVudUl0ZW1zLCBlbnRpdHlDb25maWdzLCBhdXRoQ29uZmlncywgZGFzaGJvYXJkQ29uZmlnKTtcbiAgICB9XG5cbiAgICBATG9nRHVyYXRpb24oKVxuICAgIHByZXBhcmVTZXJ2aWNlc0RpcmVjdG9yaWVzKCkge1xuICAgICAgICBjb25zdCBmdzI0ID0gRncyNC5nZXRJbnN0YW5jZSgpO1xuXG4gICAgICAgIGNvbnN0IHNlcnZpY2VEaXJlY3RvcmllcyA9IFsgcGF0aFJlc29sdmUoJy4vc3JjL3NlcnZpY2VzLycpIF07XG5cbiAgICAgICAgaWYgKGZ3MjQuaGFzTW9kdWxlcygpKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgVWktY29uZmlnLWdlbjo6OiBQcm9jZXNzOjo6IGFwcCBoYXMgbW9kdWxlczogYCwgQXJyYXkuZnJvbShmdzI0LmdldE1vZHVsZXMoKS5rZXlzKCkpKTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgWyAsIG1vZHVsZSBdIG9mIGZ3MjQuZ2V0TW9kdWxlcygpKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgbW9kdWxlU2VydmljZXNQYXRoID0gcGF0aEpvaW4obW9kdWxlLmdldEJhc2VQYXRoKCksIG1vZHVsZS5nZXRTZXJ2aWNlc0RpcmVjdG9yeSgpKTtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgVWktY29uZmlnLWdlbjo6OiBQcm9jZXNzOjo6IG1vZHVsZVNlcnZpY2VzUGF0aDogYCwgbW9kdWxlU2VydmljZXNQYXRoKTtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgVWktY29uZmlnLWdlbjo6OiBQcm9jZXNzOjo6IHJlcy1tb2R1bGVTZXJ2aWNlc1BhdGg6IGAsIHBhdGhSZXNvbHZlKG1vZHVsZVNlcnZpY2VzUGF0aCkpO1xuICAgICAgICAgICAgICAgIHNlcnZpY2VEaXJlY3Rvcmllcy5wdXNoKHBhdGhSZXNvbHZlKG1vZHVsZVNlcnZpY2VzUGF0aCkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHNlcnZpY2VEaXJlY3RvcmllcztcbiAgICB9XG5cbiAgICBATG9nRHVyYXRpb24oKVxuICAgIGFzeW5jIHNjYW5BbmRMb2FkU2VydmljZXMoc2VydmljZURpcmVjdG9yaWVzOiBBcnJheTxzdHJpbmc+KSB7XG5cbiAgICAgICAgY29uc3Qgc2Nhbm5lZFNlcnZpY2VzID0gbmV3IFNldDxGdW5jdGlvbj4oKTtcblxuICAgICAgICBmb3IgKGNvbnN0IGRpciBvZiBzZXJ2aWNlRGlyZWN0b3JpZXMpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBVaS1jb25maWctZ2VuOjo6IFByb2Nlc3M6OjogbG9hZGluZyBzZXJ2aWNlcyBmcm9tIERJUjogYCwgZGlyKTtcbiAgICAgICAgICAgIGNvbnN0IGRpclNlcnZpY2VUb2tlbnMgPSBhd2FpdCB0aGlzLnNjYW5TZXJ2aWNlc0Zyb21EaXJlY3RvcnkoZGlyKTtcbiAgICAgICAgICAgIGRpclNlcnZpY2VUb2tlbnMuZm9yRWFjaCh0b2tlbiA9PiBzY2FubmVkU2VydmljZXMuYWRkKHRva2VuKSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBnZXQgYWxsIGNvbnRhaW5lciByZWdpc3RlcmVkIHNlcnZpY2VzIHRvIG1ha2Ugc3VyZSBhdXRvLWdlbiBlbnRpdHktc2VydmljZXMgYXJlIGFsc28gaW5jbHVkZWRcbiAgICAgICAgdGhpcy51aUdlbkRJQ29udGFpbmVyLmNvbGxlY3RCZXN0UHJvdmlkZXJzRm9yKHtcbiAgICAgICAgICAgIHR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgICAgICAgIGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnM6IHRydWVcbiAgICAgICAgfSkuZmlsdGVyKG9wdCA9PiB7XG4gICAgICAgICAgICAvLyBtYWtlIHN1cmUgdG8gY29sbGVjdCBvbmx5IHRoZSBlbnRpdHkgc2VydmljZSBwcm92aWRlcnNcbiAgICAgICAgICAgIHJldHVybiAhIW9wdC5fcHJvdmlkZXIuZm9yRW50aXR5XG4gICAgICAgIH0pLmZvckVhY2gob3B0ID0+IHtcbiAgICAgICAgICAgIHNjYW5uZWRTZXJ2aWNlcy5hZGQob3B0Ll9wcm92aWRlci5wcm92aWRlIGFzIEZ1bmN0aW9uKTtcbiAgICAgICAgfSlcblxuICAgICAgICAvLyByZXNvbHZlIGFsbCBzZXJ2aWNlc1xuICAgICAgICBjb25zdCByZXNvbHZlZFNlcnZpY2VzID0gbmV3IE1hcDxzdHJpbmcsIEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4+KCk7XG5cbiAgICAgICAgc2Nhbm5lZFNlcnZpY2VzLmZvckVhY2godG9rZW4gPT4ge1xuICAgICAgICAgICAgY29uc3Qgc2VydmljZSA9IHRoaXMudWlHZW5ESUNvbnRhaW5lci5yZXNvbHZlKHRva2VuLCB7XG4gICAgICAgICAgICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVyczogdHJ1ZVxuICAgICAgICAgICAgfSkgYXMgQmFzZUVudGl0eVNlcnZpY2U8YW55PjtcblxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYHJlc29sdmVkIHNlcnZpY2UgZm9yIGVudGl0eTogJHtzZXJ2aWNlLmdldEVudGl0eU5hbWUoKX1gKTtcblxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFVpLWNvbmZpZy1nZW46OjogUHJvY2Vzczo6OiBsb2FkZWQgc2VydmljZXMgZnJvbSBlbnRpdHk6IGAsIHNlcnZpY2UuZ2V0RW50aXR5TmFtZSgpKTtcbiAgICAgICAgICAgIHJlc29sdmVkU2VydmljZXMuc2V0KHNlcnZpY2UuZ2V0RW50aXR5TmFtZSgpLCBzZXJ2aWNlKTtcbiAgICAgICAgfSlcblxuICAgICAgICByZXR1cm4gcmVzb2x2ZWRTZXJ2aWNlcztcbiAgICB9XG5cbiAgICBATG9nRHVyYXRpb24oKVxuICAgIGFzeW5jIHNjYW5TZXJ2aWNlc0Zyb21EaXJlY3Rvcnkoc2VydmljZXNEaXI6IHN0cmluZykge1xuXG4gICAgICAgIGNvbnN0IHNjYW5uZWRTZXJ2aWNlcyA9IG5ldyBTZXQ8RnVuY3Rpb24+KCk7XG5cbiAgICAgICAgaWYgKCFleGlzdHNTeW5jKHNlcnZpY2VzRGlyKSkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIud2Fybihgc2NhblNlcnZpY2VzRnJvbURpcmVjdG9yeTogc2VydmljZXNEaXIgZG9lcyBub3QgZXhpc3RzOiAke3NlcnZpY2VzRGlyfWApO1xuICAgICAgICAgICAgcmV0dXJuIHNjYW5uZWRTZXJ2aWNlcztcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHNlcnZpY2VQYXRocyA9IEhlbHBlci5zY2FuQ29udHJvbGxlclNvdXJjZUZpbGVzRnJvbShzZXJ2aWNlc0Rpcik7XG5cbiAgICAgICAgZm9yIChjb25zdCBzZXJ2aWNlUGF0aCBvZiBzZXJ2aWNlUGF0aHMpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGB0cnlpbmcgdG8gbG9hZCBzZXJ2aWNlUGF0aDogJHtzZXJ2aWNlUGF0aH1gKTtcblxuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAvLyBEeW5hbWljYWxseSBpbXBvcnQgdGhlIHNlcnZpY2UgZmlsZVxuICAgICAgICAgICAgICAgIGNvbnN0IG1vZHVsZSA9IGF3YWl0IGltcG9ydChwYXRoSm9pbihzZXJ2aWNlc0Rpciwgc2VydmljZVBhdGgpKTtcblxuICAgICAgICAgICAgICAgIC8vIEZpbmQgYW5kIGluc3RhbnRpYXRlIHNlcnZpY2UgY2xhc3Nlc1xuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgZXhwb3J0ZWRJdGVtIG9mIE9iamVjdC52YWx1ZXMobW9kdWxlKSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoXG4gICAgICAgICAgICAgICAgICAgICAgICBleHBvcnRlZEl0ZW1cbiAgICAgICAgICAgICAgICAgICAgICAgICYmIHR5cGVvZiBleHBvcnRlZEl0ZW0gPT09ICdmdW5jdGlvbidcbiAgICAgICAgICAgICAgICAgICAgICAgICYmICdwcm90b3R5cGUnIGluIGV4cG9ydGVkSXRlbVxuICAgICAgICAgICAgICAgICAgICAgICAgJiYgZXhwb3J0ZWRJdGVtLnByb3RvdHlwZSBpbnN0YW5jZW9mIEJhc2VFbnRpdHlTZXJ2aWNlXG4gICAgICAgICAgICAgICAgICAgICkge1xuXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy51aUdlbkRJQ29udGFpbmVyLmhhcyhleHBvcnRlZEl0ZW0sIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnc2VydmljZScsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVyczogdHJ1ZVxuICAgICAgICAgICAgICAgICAgICAgICAgfSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzY2FubmVkU2VydmljZXMuYWRkKGV4cG9ydGVkSXRlbSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYHNjYW5TZXJ2aWNlc0Zyb21EaXJlY3Rvcnk6IHJlZ2lzdGVyaW5nIHNlcnZpY2U6ICR7ZXhwb3J0ZWRJdGVtLm5hbWV9YCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBzY2FuU2VydmljZXNGcm9tRGlyZWN0b3J5OiBubyBwcm92aWRlciBjb3VsZCBiZSBmb3VuZCBmb3Igc2VydmljZTogJHtleHBvcnRlZEl0ZW0ubmFtZX1gKTtcblxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1Zyhgc2NhblNlcnZpY2VzRnJvbURpcmVjdG9yeTogU0tJUDogZXhwb3J0ZWRJdGVtIGlzIG5vdCBhIHNlcnZpY2UgY2xhc3M6ICR7KGV4cG9ydGVkSXRlbSBhcyBhbnkpPy5uYW1lID8gKGV4cG9ydGVkSXRlbSBhcyBhbnkpLm5hbWUgOiBleHBvcnRlZEl0ZW19YCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYHNjYW5TZXJ2aWNlc0Zyb21EaXJlY3Rvcnk6IEV4Y2VwdGlvbiB3aGlsZSB0cnlpbmcgdG8gbG9hZCBzZXJ2aWNlUGF0aDogJHtzZXJ2aWNlUGF0aH1gLCBlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBzY2FubmVkU2VydmljZXM7XG4gICAgfVxuXG4gICAgQExvZ0R1cmF0aW9uKClcbiAgICBhc3luYyB3cml0ZVRvRmlsZXMobWVudUNvbmZpZzogYW55LCBlbnRpdGllc0NvbmZpZzogYW55LCBhdXRoQ29uZmlnOiBhbnksIGRhc2hib2FyZENvbmZpZzogYW55KSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiQ2FsbGVkIHdyaXRlVG9GaWxlczo6Ojo6OiBcIik7XG4gICAgICAgIGNvbnN0IGdlbkRpcmVjdG9yeVBhdGggPSBwYXRoUmVzb2x2ZSgnLi9nZW4vJyk7XG4gICAgICAgIGlmICghZXhpc3RzU3luYyhnZW5EaXJlY3RvcnlQYXRoKSkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEdlbiBESVIgZG9lcyBub3QgZXhpc3RzLCBjcmVhdGluZzogJHtnZW5EaXJlY3RvcnlQYXRofWAsKTtcbiAgICAgICAgICAgIG1rZGlyU3luYyhnZW5EaXJlY3RvcnlQYXRoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGNvbmZpZ0RpcmVjdG9yeVBhdGggPSBwYXRoUmVzb2x2ZShwYXRoSm9pbihnZW5EaXJlY3RvcnlQYXRoLCAnY29uZmlnJykpO1xuICAgICAgICBpZiAoIWV4aXN0c1N5bmMoY29uZmlnRGlyZWN0b3J5UGF0aCkpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDb25maWcgRElSIGRvZXMgbm90IGV4aXN0cywgY3JlYXRpbmc6ICR7Y29uZmlnRGlyZWN0b3J5UGF0aH1gKTtcbiAgICAgICAgICAgIG1rZGlyU3luYyhjb25maWdEaXJlY3RvcnlQYXRoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IG1lbnVDb25maWdGaWxlUGF0aCA9IHBhdGhKb2luKGNvbmZpZ0RpcmVjdG9yeVBhdGgsICdtZW51Lmpzb24nKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYHdyaXRpbmcgbWVudS1jb25maWcuLiBpbnRvOiAke21lbnVDb25maWdGaWxlUGF0aH1gKTtcbiAgICAgICAgd3JpdGVGaWxlU3luYyhtZW51Q29uZmlnRmlsZVBhdGgsIEpTT04uc3RyaW5naWZ5KG1lbnVDb25maWcsIG51bGwsIDIpKTtcblxuICAgICAgICBjb25zdCBlbnRpdGllc0NvbmZpZ0ZpbGVQYXRoID0gcGF0aEpvaW4oY29uZmlnRGlyZWN0b3J5UGF0aCwgJ2VudGl0aWVzLmpzb24nKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYHdyaXRpbmcgZW50aXRpZXMtY29uZmlnLi4gaW50bzogJHtlbnRpdGllc0NvbmZpZ0ZpbGVQYXRofWAsKTtcbiAgICAgICAgd3JpdGVGaWxlU3luYyhlbnRpdGllc0NvbmZpZ0ZpbGVQYXRoLCBKU09OLnN0cmluZ2lmeShlbnRpdGllc0NvbmZpZywgbnVsbCwgMikpO1xuXG4gICAgICAgIGNvbnN0IGF1dGhDb25maWdGaWxlUGF0aCA9IHBhdGhKb2luKGNvbmZpZ0RpcmVjdG9yeVBhdGgsICdhdXRoLmpzb24nKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYHdyaXRpbmcgYXV0aC1jb25maWcuLiBpbnRvOiAke2F1dGhDb25maWdGaWxlUGF0aH1gLCk7XG4gICAgICAgIHdyaXRlRmlsZVN5bmMoYXV0aENvbmZpZ0ZpbGVQYXRoLCBKU09OLnN0cmluZ2lmeShhdXRoQ29uZmlnLCBudWxsLCAyKSk7XG5cbiAgICAgICAgY29uc3QgZGFzaGJvYXJkQ29uZmlnRmlsZVBhdGggPSBwYXRoSm9pbihjb25maWdEaXJlY3RvcnlQYXRoLCAnZGFzaGJvYXJkLmpzb24nKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYHdyaXRpbmcgZGFzaGJvYXJkLWNvbmZpZy4uIGludG86ICR7ZGFzaGJvYXJkQ29uZmlnRmlsZVBhdGh9YCwpO1xuICAgICAgICB3cml0ZUZpbGVTeW5jKGRhc2hib2FyZENvbmZpZ0ZpbGVQYXRoLCBKU09OLnN0cmluZ2lmeShkYXNoYm9hcmRDb25maWcsIG51bGwsIDIpKTtcblxuICAgIH1cbn1cblxuIl19