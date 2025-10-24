/*
  Core manifest types (Phase 1 scope)
  - Minimal but sufficient to drive manifest generation and reports
  - Keep in sync with du-plan.md (Phase 1 fields only)
*/

export type SecretRef = { from: 'ssm' | 'secretsManager'; name: string };

export interface ManifestApp {
  name: string;
  version: string;
  defaults?: {
    functionProps?: { memorySize?: number; timeout?: number; arch?: 'arm64' | 'x86_64' };
    env?: Record<string, string | SecretRef>;
  };
}

export interface ModuleDescriptor {
  name: string;
  version?: string;
  path: string;
  imports?: string[];
  buildExports?: {
    env?: Record<string, string | SecretRef>;
    policies?: Record<string, any>;
    assets?: Array<{ source: string; target: string }>;
    constructs?: Array<{ type: string; props: any }>;
    layers?: Array<{ name: string; includes?: string[] }>;
    entryPackages?: string[];
  };
  runtime?: {
    providers?: ProviderDescriptor[];
    entities?: EntityRef[];
    capabilities?: CapabilityRef[];
    tags?: string[];
  };
}

export interface EntityRef {
  name: string;
  schemaProviderToken?: string;
  providerToken?: string;
}

export interface CapabilityRef {
  kind: 'controller' | 'queue' | 'task' | 'stream';
  file: string;
  exportName: string;
  tags?: string[];
}

export interface ProviderDescriptor {
  provide: string;
  kind: 'service' | 'config' | 'schema' | 'other';
  forEntity?: string;
  priority?: number;
  selector?: { tenantId?: string; version?: string; featureFlag?: string };
  tags?: string[];
  useClassToken?: string;
  useFactoryToken?: string;
  useValue?: any;
}

export interface EntityDescriptor {
  name: string;
  schemaProviderToken: string;
  variants?: Array<{ selector: ProviderDescriptor['selector']; providerToken: string }>;
  tags?: string[];
}

export type AuthorizerType = 'AWS_IAM' | 'COGNITO' | 'JWT' | 'CUSTOM' | 'NONE';

export interface CapabilityRoute {
  method: string;
  path: string; // keep {id} style
  authorizer?: { type: AuthorizerType; name?: string; groups?: string[]; requireRouteInGroupConfig?: boolean } | AuthorizerType;
  target?: 'function' | 'queue' | 'topic';
  targetName?: string;
}

export interface CapabilityRouting {
  basePath?: string;
  routes?: CapabilityRoute[];
}

export interface CapabilityDescriptor {
  id: string;
  kind: 'controller' | 'queue' | 'task' | 'stream';
  sourceFile: string;
  exportName: string;
  routing?: CapabilityRouting;
  schedule?: { rate: string };
  queue?: { name: string };
  stream?: { source: 'dynamodb' | 'kinesis'; table?: string; streamArn?: string };
  tags?: string[];
  requires?: {
    modules?: string[];
    entities?: Array<string | { tag: string } | { name: string; variant?: { tenantId?: string; version?: string; featureFlag?: string } }>;
    env?: Record<string, string | SecretRef>;
    resourceIntents?: ResourceIntent[];
  };
}

export interface ResourceIntent {
  kind: 'table' | 'index' | 'bucket' | 'queue' | 'topic' | 'parameter' | 'secret';
  name: string;
  permissions: Array<'read' | 'write' | 'publish' | 'subscribe' | 'list' | 'describe'>;
  scope?: { index?: string; prefix?: string };
}

export interface DeploymentUnitDescriptor {
  name: string;
  kind: 'api' | 'worker' | 'stream' | 'mixed';
  include?: {
    modules?: Array<string | { tag: string }>;
    capabilities?: Array<string | { kind: CapabilityDescriptor['kind']; tag?: string }>;
  };
  exclude?: { capabilities?: string[] };
  needs?: Array<'allEntities' | 'allSchemas' | 'allServices'>;
  functionProps?: { memorySize?: number; timeout?: number; arch?: 'arm64' | 'x86_64' };
  env?: Record<string, string | SecretRef>;
  iam?: { allowWildcard?: boolean; justification?: string };
  routing?: { domain?: string; stage?: string; basePath?: string; apiName?: string };
  logging?: { logRetentionDays?: number; logRemovalPolicy?: 'DESTROY' | 'RETAIN' };
}

export interface Manifest {
  manifestVersion: '1.0.0';
  app: ManifestApp;
  modules: ModuleDescriptor[];
  entities: EntityDescriptor[];
  capabilities: CapabilityDescriptor[];
  resourceIntents: ResourceIntent[];
  deploymentUnits: DeploymentUnitDescriptor[];
  sharedLayersPlan?: {
    maxLayers: number;
    maxLayerSizeMB: number;
    assignments: Array<{ layerName: string; includes: string[] }>;
  };
}

export type BuildDiagnosticLevel = 'info' | 'warn' | 'error';
export interface BuildDiagnostic {
  level: BuildDiagnosticLevel;
  code: string;
  message: string;
  hint?: string;
  source?: { file: string; line?: number; symbol?: string };
}


