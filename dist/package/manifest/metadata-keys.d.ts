import type { AuthorizerTypeMetadata } from '../decorators/authorizer';
import type { HttpRequestValidations, InputValidationRule } from '../validation';
import type { IControllerConfig } from '../decorators/controller';
/**
 * Metadata keys for storing framework metadata using reflect-metadata
 */
export declare const METADATA_KEYS: {
    readonly CONTROLLER: "fw24:controller";
    readonly CONTROLLER_ROUTES: "fw24:controller:routes";
    readonly ROUTE: "fw24:route";
    readonly ROUTE_METHOD: "fw24:route:method";
    readonly ROUTE_PATH: "fw24:route:path";
    readonly ROUTE_OPTIONS: "fw24:route:options";
    readonly SERVICE: "fw24:service";
    readonly PROVIDER: "fw24:provider";
    readonly MODULE: "fw24:module";
    readonly MODULE_CONFIG: "fw24:module:config";
    readonly QUEUE: "fw24:queue";
    readonly QUEUE_CONFIG: "fw24:queue:config";
    readonly TASK: "fw24:task";
    readonly TASK_CONFIG: "fw24:task:config";
    readonly ENTITY_SCHEMA: "fw24:entity:schema";
    readonly INJECTABLE: "fw24:injectable";
};
/**
 * Metadata interfaces for type safety
 */
export interface ControllerMetadata {
    name: string;
    config: IControllerConfig;
    basePath: string;
    authorizer?: IControllerConfig['authorizer'];
    resourceAccess?: IControllerConfig['resourceAccess'];
    env?: IControllerConfig['env'];
    target?: IControllerConfig['target'];
    functionTimeout?: IControllerConfig['functionTimeout'];
    policies?: IControllerConfig['policies'];
    processorArchitecture?: IControllerConfig['processorArchitecture'];
    functionProps?: IControllerConfig['functionProps'];
}
export interface RouteMetadata {
    method: string;
    path: string;
    options: {
        authorizer?: AuthorizerTypeMetadata | string;
        target: 'function' | 'queue' | 'topic';
        validations?: InputValidationRule | HttpRequestValidations;
    };
    functionName: string;
    parameters: string[];
}
export interface ServiceMetadata {
    className: string;
    forEntity?: string;
    priority: number;
    providedIn?: string;
    tags?: string[];
    kind: 'service';
}
export interface ModuleMetadata {
    config: any;
}
export interface QueueMetadata {
    name: string;
    config: any;
}
export interface TaskMetadata {
    name: string;
    config: any;
}
export interface EntitySchemaMetadata {
    entityName: string;
    schemaProviderToken: string;
    providedIn?: string;
    tags?: string[];
    doNotAutoRegisterEntityService?: boolean;
}
export interface InjectableMetadata {
    options: any;
}
