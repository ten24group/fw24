import { BaseFactory, FactoryOptions, Scope, MethodConfig } from './base-factory';
import { IControllerConfig } from '../decorators';
import { Request, Response } from '../interfaces';
import { OptionalKind, MethodDeclarationStructure } from 'ts-morph';

export interface EndpointConfig {
  httpMethod: 'Get' | 'Post' | 'Put' | 'Patch' | 'Delete';
  path: string;
  methodName: string;
  methodConfig?: OptionalKind<MethodDeclarationStructure>;
}

export interface ControllerFactoryOptions extends FactoryOptions {
  /** The import path for the fw24 framework. Defaults to '@ten24group/fw24'. */
  fw24ImportPath?: string;
}

export const makeDefaultControllerTemplateText = (controllerName: string, fw24ImportPath: string) => `
import { APIController, Controller, Request, Response, Get, Post, Put, Patch, Delete } from '${fw24ImportPath || '@ten24group/fw24'}';

@Controller('${controllerName.toLowerCase()}', { autoExportLambdaHandler: true })
export class ${controllerName}Controller extends APIController {
    // Methods will be added here
}
`;

/**
 * A factory for creating or modifying a standard FW24 APIController.
 * It provides full, type-safe access to all `@Controller` decorator options.
 */
export class ControllerFactory<T extends ControllerFactoryOptions = ControllerFactoryOptions> extends BaseFactory<T> {
  private readonly fw24ImportPath: string;

  constructor(options: T) {
    super(options);
    this.fw24ImportPath = options.fw24ImportPath || '@ten24group/fw24';
  }

  /**
   * Sets or merges the configuration for the main @Controller decorator.
   * @param config A partial IControllerConfig object.
   */
  public setConfig(config: Partial<IControllerConfig>): this {
    return this.patchDecoratorConfigOnClass('Controller', config);
  }

  /**
 * Framework-specific helper: Add authentication decorator to method.
 */
  public addAuthenticationToMethod(methodName: string, authType: 'jwt' | 'apikey' | 'cognito' = 'jwt'): this {
    this.logOperation(`Adding authentication to method: ${methodName}`);

    this.addImports(this.frameworkImportPath, [ 'Auth' ]);

    const method = this.getMethod(methodName);
    if (!method) {
      throw new Error(`Method '${methodName}' not found`);
    }

    method.addDecorator({
      name: 'Auth',
      arguments: [ `'${authType}'` ],
    });

    return this;
  }

  /**
   * Framework-specific helper: Add validation decorator to method.
   */
  public addValidationToMethod(methodName: string, validationSchema: string): this {
    this.logOperation(`Adding validation to method: ${methodName}`);

    this.addImports(this.frameworkImportPath, [ 'Validate' ]);

    const method = this.getMethod(methodName);
    if (!method) {
      throw new Error(`Method '${methodName}' not found`);
    }

    method.addDecorator({
      name: 'Validate',
      arguments: [ validationSchema ],
    });

    return this;
  }

  /**
   * Adds a new API endpoint method to the controller.
   * @param config - The configuration for the endpoint.
   */
  public addEndpoint(config: EndpointConfig): this {
    const { httpMethod, path, methodName, methodConfig = {} } = config;

    const finalMethodConfig: OptionalKind<MethodDeclarationStructure> = {
      name: methodName,
      isAsync: true,
      returnType: 'Promise<Response>',
      parameters: [
        { name: 'req', type: 'Request' },
        { name: 'res', type: 'Response' },
      ],
      scope: Scope.Public,
      decorators: [ { name: httpMethod, arguments: [ `'${path}'` ] } ],
      statements: 'return res.json({ success: true });',
      ...methodConfig,
    };

    this.addImports(this.fw24ImportPath, [ 'Request', 'Response', httpMethod ]);
    this.sourceFile.formatText();

    this.addMethod(finalMethodConfig);
    return this;
  }
} 