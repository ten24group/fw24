import MakeCreateEntityConfig from './templates/create-entity';
import MakeUpdateEntityConfig from './templates/update-entity';
import MakeListEntityConfig from './templates/list-entity';
import MakeViewEntityConfig from './templates/view-entity';
import MakeEntityMenuConfig from './templates/entity-menu';
import { BaseEntityService, EntitySchema } from '../entity';
import { makeCustomPageConfig, CustomPageOptions, ListPageConfig, FormPageConfig, DetailsPageConfig, DashboardPageConfig } from './templates/custom-page';

import MakeAuthConfig from './templates/auth';
import MakeDashboardConfig from './templates/dashboard';

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { gzipSync, brotliCompressSync, constants } from "zlib";
import {
    resolve as pathResolve,
    join as pathJoin
} from "path";

import { Fw24 } from '../core/fw24';
import { Helper } from '../core/helper';
import { LogDuration, createLogger } from '../logging';
import { toSlug } from '../utils/cases';

export class EntityUIConfigGen {
    readonly logger = createLogger(EntityUIConfigGen.name);
    // make sure to create a child container to not pollute anything in the Application container 
    // while scanning and loading stuff
    readonly uiGenDIContainer = Fw24.getInstance().getAppDIContainer();

    private readonly customPages: Map<string, CustomPageOptions> = new Map();

    @LogDuration()
    async scanCustomPages() {
        const fw24 = Fw24.getInstance();
        const config = fw24.getConfig();
        const customPagesDir = config.uiConfigGenOptions?.customPagesDirectory || 'custom-pages';

        const customPagesDirectories = [ pathResolve(`./src/${customPagesDir}/`) ];

        if (fw24.hasModules()) {
            for (const [ , module ] of fw24.getModules()) {
                const moduleCustomPagesPath = pathJoin(module.getBasePath(), customPagesDir);
                customPagesDirectories.push(pathResolve(moduleCustomPagesPath));
            }
        }

        const registeredPages: string[] = [];

        for (const dir of customPagesDirectories) {
            if (!existsSync(dir)) {
                this.logger.debug(`Custom pages directory does not exist: ${dir}`);
                continue;
            }

            const customPageFiles = Helper.scanControllerSourceFilesFrom(dir);

            for (const file of customPageFiles) {
                try {
                    const module = await import(pathJoin(dir, file));
                    for (const [ _, value ] of Object.entries(module)) {
                        if (this.isValidCustomPageConfig(value)) {
                            const pageName = this.getPageNameFromConfig(value);
                            if (pageName) {
                                this.registerCustomPage(value);
                                registeredPages.push(pageName);
                                this.logger.debug(`Registered custom page: ${pageName}`);
                            }
                        }
                    }
                } catch (e) {
                    this.logger.error(`Error loading custom page from ${file}:`, e);
                }
            }
        }

        if (registeredPages.length > 0) {
            this.logger.info(`✅ Registered ${registeredPages.length} custom page(s): ${registeredPages.slice(0, 5).join(', ')}${registeredPages.length > 5 ? `, +${registeredPages.length - 5} more` : ''}`);
        }
    }

    public isValidCustomPageConfig(value: unknown): value is CustomPageOptions {
        if (!value || typeof value !== 'object') return false;

        const config = value as Record<string, unknown>;
        if (!('pageType' in config) || !('pageTitle' in config)) return false;

        const pageType = config.pageType;
        if (pageType === 'list') {
            return 'listPageConfig' in config;
        } else if (pageType === 'form') {
            return 'formPageConfig' in config;
        } else if (pageType === 'details') {
            return 'detailsPageConfig' in config;
        } else if (pageType === 'dashboard') {
            return 'dashboardPageConfig' in config;
        } else if (pageType === 'accordion') {
            return 'accordionPageConfig' in config;
        } else if (pageType === 'menu') {
            return 'menuPageConfig' in config;
        }
        return false;
    }

    private getPageNameFromConfig(config: CustomPageOptions): string | null {
        if (config.pageName) {
            return toSlug(config.pageName);
        }

        // For template-based page titles (objects), pageName MUST be provided
        // Extract string from pageTitle (handles both string and Template types)
        const pageTitleString = typeof config.pageTitle === 'string'
            ? config.pageTitle
            : 'custom-page'; // Fallback for Template objects

        switch (config.pageType) {
            case 'list':
                return `list-${toSlug(pageTitleString)}`;
            case 'form':
                return pageTitleString.toLowerCase().includes('add')
                    ? `create-${toSlug(pageTitleString)}`
                    : `edit-${toSlug(pageTitleString)}`;
            case 'details':
                return `view-${toSlug(pageTitleString)}`;
            case 'dashboard':
                return `${toSlug(pageTitleString)}`;
            case 'accordion':
                return `accordion-${toSlug(pageTitleString)}`;
            case 'menu':
                return `${toSlug(pageTitleString)}`;
            default:
                return null;
        }
    }

    /**
     * Register a custom page. Supports optional routePattern for dynamic routes (e.g., /author/:authorId/books)
     */
    public registerCustomPage(options: CustomPageOptions) {
        const pageName = this.getPageNameFromConfig(options);
        if (pageName) {
            this.customPages.set(pageName, options);
        }
    }

    async run() {
        this.process();
    }

    @LogDuration()
    async process() {
        const menuConfigs: any[] = [];
        const entityConfigs: any = {};

        const serviceDirectories = this.prepareServicesDirectories();

        const services = await this.scanAndLoadServices(serviceDirectories);

        // Scan and load custom pages
        await this.scanCustomPages();

        this.logger.debug(`Ui-config-gen::: Process::: all-services: `, Array.from(services.keys()));

        // Get global UI config options (including duplicatedFieldDetection)
        const fw24Config = Fw24.getInstance().getConfig();
        const globalUIConfigOptions = fw24Config.uiConfigGenOptions;
        const hasObservability = !!fw24Config.observability;

        let menuIndex = 1;
        // generate UI configs
        services.forEach((service, entityName) => {

            let entitySchema = service.getEntitySchema() as EntitySchema<any, any, any>;

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
                const createConfig = MakeCreateEntityConfig({
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
                entityConfigs[ `create-${entityName.toLowerCase()}` ] = createConfig;
            }

            if (!entitySchema.model.excludeFromAdminUpdate) {
                const updateConfig = MakeUpdateEntityConfig({
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
                entityConfigs[ `edit-${entityName.toLowerCase()}` ] = updateConfig;
            }

            if (!entitySchema.model.excludeFromAdminList) {
                const listConfig = MakeListEntityConfig({
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
                entityConfigs[ `list-${entityName.toLowerCase()}` ] = listConfig;
            }

            if (!entitySchema.model.excludeFromAdminDetail) {
                const viewConfig = MakeViewEntityConfig({
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
                entityConfigs[ `view-${entityName.toLowerCase()}` ] = viewConfig;
            }

            if (!entitySchema.model.excludeFromAdminMenu) {
                const menuConfig = MakeEntityMenuConfig({
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
        for (const [ pageName, options ] of this.customPages) {
            // skip the default dashboard page and menu page
            if (pageName === 'dashboard' || pageName === 'menu') {
                continue;
            }
            const customConfig = makeCustomPageConfig(options);
            entityConfigs[ pageName ] = customConfig;
        }

        const authConfigOptions = Fw24.getInstance().getConfig().uiConfigGenOptions || {};

        const authConfigs = MakeAuthConfig({
            ...authConfigOptions,
            authEndpoint: authConfigOptions.authEndpoint || 'mauth'
        });

        // Look for a dashboard custom page
        let dashboardConfig: DashboardPageConfig | any = null;
        for (const [ , options ] of this.customPages) {
            // Check if this is a dashboard page - handle both string and Template pageTitle
            const pageTitleStr = typeof options.pageTitle === 'string' ? options.pageTitle : '';
            if (options.pageType === 'dashboard' && pageTitleStr.toLowerCase() === 'dashboard') {
                dashboardConfig = options;
                break;
            }
        }
        if (!dashboardConfig) {
            dashboardConfig = MakeDashboardConfig();
        }

        // Look for a menu custom page
        let menuConfig: any = null;
        for (const [ pageName, options ] of this.customPages) {
            // Check if this is a menu page - handle both string and Template pageTitle
            const pageTitleStr = typeof options.pageTitle === 'string' ? options.pageTitle : '';
            if (options.pageType === 'menu' && pageTitleStr.toLowerCase() === 'menu') {
                menuConfig = options;
                break;
            }
        }

        // Group menu items by their group property
        const menuGroups = new Map<string, any[]>();
        const ungroupedItems: any[] = [];

        // Process entity menu items
        menuConfigs.forEach(item => {
            if (item.group) {
                if (!menuGroups.has(item.group)) {
                    menuGroups.set(item.group, []);
                }
                menuGroups.get(item.group)!.push(item);
            } else {
                ungroupedItems.push(item);
            }
        });

        // Process custom menu items
        if (menuConfig?.menuPageConfig?.menuItems) {
            menuConfig.menuPageConfig.menuItems.forEach((item: any) => {
                if (item.group) {
                    if (!menuGroups.has(item.group)) {
                        menuGroups.set(item.group, []);
                    }
                    menuGroups.get(item.group)!.push(item);
                } else {
                    ungroupedItems.push(item);
                }
            });
        }

        // Create final menu structure
        const allMenuItems: any[] = [];

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
    private transformLegacyConfig(schema: EntitySchema<any, any, any>): EntitySchema<any, any, any> {
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
    private checkDeprecatedUsage(schema: EntitySchema<any, any, any>): void {
        const model = schema.model;
        const warnings: string[] = [];

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

    @LogDuration()
    prepareServicesDirectories() {
        const fw24 = Fw24.getInstance();

        const serviceDirectories = [ pathResolve('./src/services/') ];

        if (fw24.hasModules()) {
            this.logger.debug(`Ui-config-gen::: Process::: app has modules: `, Array.from(fw24.getModules().keys()));
            for (const [ , module ] of fw24.getModules()) {
                const moduleServicesPath = pathJoin(module.getBasePath(), module.getServicesDirectory());
                this.logger.debug(`Ui-config-gen::: Process::: moduleServicesPath: `, moduleServicesPath);
                this.logger.debug(`Ui-config-gen::: Process::: res-moduleServicesPath: `, pathResolve(moduleServicesPath));
                serviceDirectories.push(pathResolve(moduleServicesPath));
            }
        }

        return serviceDirectories;
    }

    @LogDuration()
    async scanAndLoadServices(serviceDirectories: Array<string>) {

        const scannedServices = new Set<Function>();

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
            return !!opt._provider.forEntity
        }).forEach(opt => {
            scannedServices.add(opt._provider.provide as Function);
        })

        // resolve all services
        const resolvedServices = new Map<string, BaseEntityService<any>>();

        scannedServices.forEach(token => {
            const service = this.uiGenDIContainer.resolve(token, {
                allProvidersFromChildContainers: true
            }) as BaseEntityService<any>;

            this.logger.debug(`resolved service for entity: ${service.getEntityName()}`);

            this.logger.debug(`Ui-config-gen::: Process::: loaded services from entity: `, service.getEntityName());
            resolvedServices.set(service.getEntityName(), service);
        })

        return resolvedServices;
    }

    @LogDuration()
    async scanServicesFromDirectory(servicesDir: string) {

        const scannedServices = new Set<Function>();

        if (!existsSync(servicesDir)) {
            this.logger.warn(`scanServicesFromDirectory: servicesDir does not exists: ${servicesDir}`);
            return scannedServices;
        }

        const servicePaths = Helper.scanControllerSourceFilesFrom(servicesDir);

        for (const servicePath of servicePaths) {
            this.logger.debug(`trying to load servicePath: ${servicePath}`);

            try {
                // Dynamically import the service file
                const module = await import(pathJoin(servicesDir, servicePath));

                // Find and instantiate service classes
                for (const exportedItem of Object.values(module)) {
                    if (
                        exportedItem
                        && typeof exportedItem === 'function'
                        && 'prototype' in exportedItem
                        && exportedItem.prototype instanceof BaseEntityService
                    ) {

                        if (this.uiGenDIContainer.has(exportedItem, {
                            type: 'service',
                            allProvidersFromChildContainers: true
                        })) {
                            scannedServices.add(exportedItem);
                            this.logger.debug(`scanServicesFromDirectory: registering service: ${exportedItem.name}`);
                            continue;
                        }

                        this.logger.debug(`scanServicesFromDirectory: no provider could be found for service: ${exportedItem.name}`);

                    } else {

                        this.logger.debug(`scanServicesFromDirectory: SKIP: exportedItem is not a service class: ${(exportedItem as any)?.name ? (exportedItem as any).name : exportedItem}`);
                    }
                }
            } catch (e) {
                this.logger.error(`scanServicesFromDirectory: Exception while trying to load servicePath: ${servicePath}`, e);
            }
        }

        return scannedServices;
    }

    /**
     * Write JSON config file and create compressed versions (gzip and brotli)
     * for browser-compatible delivery
     */
    private writeConfigFile(filePath: string, data: any, configName: string) {
        const jsonString = JSON.stringify(data, null, 2);
        const jsonBuffer = Buffer.from(jsonString, 'utf-8');

        // Write original JSON file
        this.logger.debug(`writing ${configName} config.. into: ${filePath}`);
        writeFileSync(filePath, jsonString);

        // Write gzip compressed version
        const gzipFilePath = `${filePath}.gz`;
        const gzipCompressed = gzipSync(jsonBuffer, { level: constants.Z_BEST_COMPRESSION });
        writeFileSync(gzipFilePath, gzipCompressed);
        this.logger.debug(`writing ${configName} config (gzip).. into: ${gzipFilePath}`);

        // Write brotli compressed version
        const brotliFilePath = `${filePath}.br`;
        const brotliCompressed = brotliCompressSync(jsonBuffer, {
            params: {
                [ constants.BROTLI_PARAM_QUALITY ]: constants.BROTLI_MAX_QUALITY  // Max quality (0-11)
            }
        });
        writeFileSync(brotliFilePath, brotliCompressed);
        this.logger.debug(`writing ${configName} config (brotli).. into: ${brotliFilePath}`);

        // Log compression ratios
        const originalSize = jsonBuffer.length;
        const gzipSize = gzipCompressed.length;
        const brotliSize = brotliCompressed.length;
        const gzipRatio = ((1 - gzipSize / originalSize) * 100).toFixed(2);
        const brotliRatio = ((1 - brotliSize / originalSize) * 100).toFixed(2);

        this.logger.info(
            `${configName} compression stats: ` +
            `original: ${originalSize}b, ` +
            `gzip: ${gzipSize}b (${gzipRatio}% smaller), ` +
            `brotli: ${brotliSize}b (${brotliRatio}% smaller)`
        );
    }

    @LogDuration()
    async writeToFiles(menuConfig: any, entitiesConfig: any, authConfig: any, dashboardConfig: any) {
        this.logger.debug("Called writeToFiles:::::: ");
        const genDirectoryPath = pathResolve('./gen/');
        if (!existsSync(genDirectoryPath)) {
            this.logger.debug(`Gen DIR does not exists, creating: ${genDirectoryPath}`,);
            mkdirSync(genDirectoryPath);
        }

        const configDirectoryPath = pathResolve(pathJoin(genDirectoryPath, 'config'));
        if (!existsSync(configDirectoryPath)) {
            this.logger.debug(`Config DIR does not exists, creating: ${configDirectoryPath}`);
            mkdirSync(configDirectoryPath);
        }

        // Write menu config with compressed versions
        const menuConfigFilePath = pathJoin(configDirectoryPath, 'menu.json');
        this.writeConfigFile(menuConfigFilePath, menuConfig, 'menu');

        // Write entities config with compressed versions
        const entitiesConfigFilePath = pathJoin(configDirectoryPath, 'entities.json');
        this.writeConfigFile(entitiesConfigFilePath, entitiesConfig, 'entities');

        // Write auth config with compressed versions
        const authConfigFilePath = pathJoin(configDirectoryPath, 'auth.json');
        this.writeConfigFile(authConfigFilePath, authConfig, 'auth');

        // Write dashboard config with compressed versions
        const dashboardConfigFilePath = pathJoin(configDirectoryPath, 'dashboard.json');
        this.writeConfigFile(dashboardConfigFilePath, dashboardConfig, 'dashboard');

    }
}

