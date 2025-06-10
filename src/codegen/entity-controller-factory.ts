import { BaseFactory, FactoryOptions, Scope } from "./base-factory";
import { ControllerFactory, ControllerFactoryOptions } from "./controller-factory";

export interface EntityControllerFactoryOptions extends ControllerFactoryOptions {
}

export class EntityControllerFactory extends ControllerFactory<EntityControllerFactoryOptions> {
  constructor(options: EntityControllerFactoryOptions) {
    super(options);
  }

  /**
   * Framework-specific helper: Add entity service injection.
   */
  public addEntityServiceInjection(entityName: string): this {
    this.logOperation(`Adding entity service injection for: ${entityName}`);

    const serviceName = `${entityName}Service`;
    const propertyName = `${entityName.toLowerCase()}Service`;

    this.addImports(this.frameworkImportPath, [ 'InjectEntityService' ]);

    this.addConstructorParameter({
      name: propertyName,
      type: `${entityName}Service`,
      scope: Scope.Private,
      decorators: [ {
        name: 'InjectEntityService',
        args: [ `'${entityName}'` ],
      } ],
    });

    return this;
  }

  /**
   * Framework-specific helper: Add CRUD methods for entity controller.
   */
  public addCrudMethods(entityName: string): this {
    this.logOperation(`Adding CRUD methods for entity: ${entityName}`);

    this.addImports(this.frameworkImportPath, [ 'Get', 'Post', 'Put', 'Delete', 'Request', 'Response' ]);

    // GET /entities
    this.addMethod({
      name: `getAll${entityName}s`,
      decorators: [ { name: 'Get', arguments: [ `'/'` ] } ],
      parameters: [
        { name: 'req', type: 'Request' },
        { name: 'res', type: 'Response' },
      ],
      returnType: 'Promise<Response>',
      isAsync: true,
      scope: Scope.Public,
      statements: `
        const entities = await this.${entityName.toLowerCase()}Service.findAll();
        return res.json(entities);
      `,
    });

    // GET /entities/:id
    this.addMethod({
      name: `get${entityName}ById`,
      decorators: [ { name: 'Get', arguments: [ `'/:id'` ] } ],
      parameters: [
        { name: 'req', type: 'Request' },
        { name: 'res', type: 'Response' },
      ],
      returnType: 'Promise<Response>',
      isAsync: true,
      scope: Scope.Public,
      statements: `
        const entity = await this.${entityName.toLowerCase()}Service.findById(req.params.id);
        return res.json(entity);
      `,
    });

    // POST /entities
    this.addMethod({
      name: `create${entityName}`,
      decorators: [ { name: 'Post', arguments: [ `'/'` ] } ],
      parameters: [
        { name: 'req', type: 'Request' },
        { name: 'res', type: 'Response' },
      ],
      returnType: 'Promise<Response>',
      isAsync: true,
      scope: Scope.Public,
      statements: `
        const entity = await this.${entityName.toLowerCase()}Service.create(req.body);
        return res.status(201).json(entity);
      `,
    });

    // PUT /entities/:id
    this.addMethod({
      name: `update${entityName}`,
      decorators: [ { name: 'Put', arguments: [ `'/:id'` ] } ],
      parameters: [
        { name: 'req', type: 'Request' },
        { name: 'res', type: 'Response' },
      ],
      returnType: 'Promise<Response>',
      isAsync: true,
      scope: Scope.Public,
      statements: `
        const entity = await this.${entityName.toLowerCase()}Service.update(req.params.id, req.body);
        return res.json(entity);
      `,
    });

    // DELETE /entities/:id
    this.addMethod({
      name: `delete${entityName}`,
      decorators: [ { name: 'Delete', arguments: [ `'/:id'` ] } ],
      parameters: [
        { name: 'req', type: 'Request' },
        { name: 'res', type: 'Response' },
      ],
      returnType: 'Promise<Response>',
      isAsync: true,
      scope: Scope.Public,
      statements: `
        await this.${entityName.toLowerCase()}Service.delete(req.params.id);
        return res.status(204).send();
      `,
    });

    return this;
  }

  /**
   * Framework-specific helper: Add search method to controller.
   */
  public addSearchMethod(entityName: string): this {
    this.logOperation(`Adding search method for entity: ${entityName}`);

    this.addImports(this.frameworkImportPath, [ 'Get', 'Request', 'Response' ]);

    this.addMethod({
      name: `search${entityName}s`,
      decorators: [ { name: 'Get', arguments: [ `'/search'` ] } ],
      parameters: [
        { name: 'req', type: 'Request' },
        { name: 'res', type: 'Response' },
      ],
      returnType: 'Promise<Response>',
      isAsync: true,
      scope: Scope.Public,
      statements: `
        const results = await this.${entityName.toLowerCase()}Service.search(req.query.q as string, {
          limit: parseInt(req.query.limit as string) || 20,
          offset: parseInt(req.query.offset as string) || 0,
        });
        return res.json(results);
      `,
    });

    return this;
  }
}