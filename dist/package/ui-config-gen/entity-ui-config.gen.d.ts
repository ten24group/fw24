import { BaseEntityService } from '../entity';
import { CustomPageOptions } from './templates/custom-page';
export declare class EntityUIConfigGen {
    readonly logger: import("tslog").Logger<import("tslog").ILogObj>;
    readonly uiGenDIContainer: import("../fw24").IDIContainer;
    private customPages;
    scanCustomPages(): Promise<void>;
    isValidCustomPageConfig(value: unknown): value is CustomPageOptions;
    private getPageNameFromConfig;
    /**
     * Register a custom page. Supports optional routePattern for dynamic routes (e.g., /author/:authorId/books)
     */
    registerCustomPage(options: CustomPageOptions): void;
    run(): Promise<void>;
    process(): Promise<void>;
    prepareServicesDirectories(): string[];
    scanAndLoadServices(serviceDirectories: Array<string>): Promise<Map<string, BaseEntityService<any>>>;
    scanServicesFromDirectory(servicesDir: string): Promise<Set<Function>>;
    writeToFiles(menuConfig: any, entitiesConfig: any, authConfig: any, dashboardConfig: any): Promise<void>;
}
