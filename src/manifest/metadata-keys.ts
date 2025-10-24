import type { AuthorizerTypeMetadata } from '../decorators/authorizer';
import type { HttpRequestValidations, InputValidationRule } from '../validation';
import type { IControllerConfig } from '../decorators/controller';

/**
 * Metadata keys for storing framework metadata using reflect-metadata
 */
export const METADATA_KEYS = {
  // Controller metadata
  CONTROLLER: 'fw24:controller',
  CONTROLLER_ROUTES: 'fw24:controller:routes',
  
  // Route metadata (stored on methods)
  ROUTE: 'fw24:route',
  ROUTE_METHOD: 'fw24:route:method',
  ROUTE_PATH: 'fw24:route:path',
  ROUTE_OPTIONS: 'fw24:route:options',
  
  // Service metadata
  SERVICE: 'fw24:service',
  PROVIDER: 'fw24:provider',
  
  // Module metadata
  MODULE: 'fw24:module',
  MODULE_CONFIG: 'fw24:module:config',
  
  // Queue metadata
  QUEUE: 'fw24:queue',
  QUEUE_CONFIG: 'fw24:queue:config',
  
  // Task metadata
  TASK: 'fw24:task',
  TASK_CONFIG: 'fw24:task:config',
  
  // Entity metadata
  ENTITY_SCHEMA: 'fw24:entity:schema',
  
  // Injectable metadata
  INJECTABLE: 'fw24:injectable',
} as const;

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
