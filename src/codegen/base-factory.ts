import {
  Project, SourceFile, ClassDeclaration, MethodDeclarationStructure, PropertyDeclarationStructure,
  DecoratorStructure, ParameterDeclarationStructure, StructureKind, Node, Scope,
  InterfaceDeclarationStructure, TypeAliasDeclarationStructure, JSDocStructure,
  MethodDeclarationOverloadStructure, VariableStatementStructure, OptionalKind,
  ObjectLiteralExpression, ImportDeclaration, EnumDeclarationStructure, FunctionDeclarationStructure,
  GetAccessorDeclarationStructure, SetAccessorDeclarationStructure, MethodSignatureStructure,
  PropertySignatureStructure, SyntaxKind, TypeParameterDeclarationStructure
} from 'ts-morph';
import * as path from 'path';

export { Scope };

export interface DecoratorConfig {
  name: string;
  args?: any[];
}

export interface ConditionalConfig {
  condition: boolean;
  action: () => BaseFactory<any>;
}

export interface BatchOperation {
  type: 'method' | 'property' | 'decorator' | 'import';
  config: any;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface DebugOptions {
  verbose?: boolean;
  logOperations?: boolean;
  performanceMetrics?: boolean;
}

export interface FactoryOptions {
  /** Path to the TS template file (for file-based input) */
  templatePath?: string;
  /** Raw source code for in-memory input */
  templateText?: string;
  project?: Project;
  /** Debug configuration */
  debug?: DebugOptions;
  /** Framework-specific import path (e.g., '@ten24group/fw24') */
  frameworkImportPath?: string;
}

/**
 * Configuration for a method or constructor parameter.
 */
export interface ParameterConfig {
  name: string;
  type?: string;
  initializer?: string;
  isOptional?: boolean;
  decorators?: Array<DecoratorConfig>;
  // For constructor property promotion
  scope?: Scope;
  isReadonly?: boolean;
}

/**
 * Configuration for adding a method to the class via BaseFactory.
 */
export interface MethodConfig {
  /** Method name */
  name: string;
  /** Method-level decorators */
  decorators?: Array<DecoratorConfig>;
  /** Parameters for the method */
  parameters?: ParameterConfig[];
  /** Return type annotation */
  returnType?: string;
  /** Method body statements as a string */
  bodyText: string;
  /** JSDoc text */
  jsDoc?: string;
  isAsync?: boolean;
  isStatic?: boolean;
  scope?: Scope;
}

/**
 * Configuration for adding a class property via BaseFactory.
 */
export interface PropertyConfig {
  /** Property name */
  name: string;
  /** Type annotation */
  type?: string;
  /** Initializer expression */
  initializer?: string;
  /** Property-level decorators */
  decorators?: Array<DecoratorConfig>;
  /** Modifiers like public/private/static/readonly */
  scope?: Scope;
  isStatic?: boolean;
  isReadonly?: boolean;
  /** Optional property */
  optional?: boolean;
  /** JSDoc text */
  jsDoc?: string;
  /** Abstract property */
  isAbstract?: boolean;
}

/**
 * Configuration for getter/setter methods.
 */
export interface AccessorConfig {
  /** Property name */
  name: string;
  /** Type annotation */
  type?: string;
  /** Getter body text */
  getterBody?: string;
  /** Setter body text */
  setterBody?: string;
  /** Parameter name for setter (defaults to 'value') */
  setterParamName?: string;
  /** Access modifiers */
  scope?: Scope;
  /** JSDoc for getter */
  getterJsDoc?: string;
  /** JSDoc for setter */
  setterJsDoc?: string;
  /** Decorators */
  decorators?: Array<DecoratorConfig>;
}

/**
 * Configuration for enum creation.
 */
export interface EnumConfig {
  /** Enum name */
  name: string;
  /** Enum members */
  members: Array<{ name: string; value?: string | number; jsDoc?: string }>;
  /** Whether it's a const enum */
  isConst?: boolean;
  /** JSDoc for the enum */
  jsDoc?: string;
  /** Export the enum */
  isExported?: boolean;
}

/**
 * Generic base class for ts-morph based code generators for classes.
 * Provides methods for editing decorators, members, and emitting files.
 */
export abstract class BaseFactory<T extends FactoryOptions> {
  protected project: Project;
  protected sourceFile: SourceFile;
  protected classDeclaration: ClassDeclaration;
  protected debug: DebugOptions;
  protected frameworkImportPath: string;
  protected operations: BatchOperation[] = [];
  private performanceStart?: number;

  constructor(protected options: T) {
    this.debug = options.debug || {};
    this.frameworkImportPath = options.frameworkImportPath || '@ten24group/fw24';

    if (this.debug.performanceMetrics) {
      this.performanceStart = Date.now();
    }

    this.project = options.project || new Project({
      // To ensure type validation works, we should not skip lib file resolution.
      // This increases memory usage but is necessary for correctness.
      compilerOptions: {
        // You may need to adjust this to your project's tsconfig settings
        target: 99, // ESNext
        module: 1, // CommonJS
        esModuleInterop: true,
      },
    });

    // load template either from text (in-memory) or file path
    if (options.templateText !== undefined) {
      this.sourceFile = this.project.createSourceFile(
        'in-memory-template.ts',
        options.templateText,
        { overwrite: true }
      );
    } else if (options.templatePath) {
      this.sourceFile = this.project.addSourceFileAtPath(
        path.resolve(options.templatePath)
      );
    } else {
      throw new Error('One of templatePath or templateText must be provided');
    }
    const classes = this.sourceFile.getClasses();
    if (classes.length === 0) {
      throw new Error(`Template at ${options.templatePath} contains no classes`);
    }
    this.classDeclaration = classes[ 0 ];
  }

  /**
   * Emit the modified source to disk.
   */
  public async emitFile(outputPath: string): Promise<void> {
    const resolved = path.resolve(outputPath);
    this.sourceFile.formatText(); // Apply formatting before emit
    await this.sourceFile.save();
  }

  /**
   * Get the generated source as a string (in-memory).
   */
  public render(): string {
    this.sourceFile.formatText();
    return this.sourceFile.getFullText();
  }

  /**
   * Validate the AST via TypeScript diagnostics. Throws if any errors.
   */
  public validateTs(): this {
    const diagnostics = this.project.getPreEmitDiagnostics();
    if (diagnostics.length > 0) {
      const formatted = this.project.formatDiagnosticsWithColorAndContext(diagnostics);
      throw new Error(`TypeScript validation failed:\n${formatted}`);
    }
    return this;
  }

  /**
   * Patch a decorator config on the class (e.g., @Controller).
   * Overrides the path argument if provided, and replaces the config object wholly.
   */
  public patchDecoratorConfigOnClass(decoratorName: string, overrides: Record<string, any>): this {
    this.logOperation(`Patching decorator config on class: ${decoratorName}`);

    const decorator = this.classDeclaration.getDecorator(decoratorName);
    if (!decorator) {
      this.logWarning(`Decorator "${decoratorName}" not found on class "${this.classDeclaration.getName()}". Skipping patch operation.`);
      return this;
    }

    const callExpr = decorator.getCallExpression();
    if (!callExpr) throw new Error(`Could not get call expression for @${decoratorName}`);

    const args = callExpr.getArguments();

    // Step 1: Get existing config or create an empty one using safe parsing
    let existingConfig: Record<string, any> = {};
    if (args.length > 1 && Node.isObjectLiteralExpression(args[ 1 ])) {
      try {
        existingConfig = this.parseObjectLiteralSafely(args[ 1 ]);
      } catch (e) {
        this.logWarning(`Could not parse existing decorator config for ${decoratorName}. Proceeding with empty config.`);
      }
    }

    // Step 2: Merge new overrides
    const newConfig = { ...existingConfig, ...overrides };

    // Step 3: Remove the old config argument if it exists
    if (args.length > 1) {
      callExpr.removeArgument(1);
    }

    // Step 4: Add the new, stringified config as the argument
    // Ensure there's always a first argument (e.g., the controller name)
    if (args.length === 0) {
      callExpr.addArgument("''");
    }
    callExpr.addArgument(this.valueToInitializer(newConfig));

    return this;
  }

  /**
   * Patches the arguments of a decorator on a specific method.
   * @param methodName - The name of the method.
   * @param decoratorName - The name of the decorator to patch.
   * @param decoratorArgs - The new array of string arguments for the decorator.
   */
  public patchDecoratorArgsOnMethod(methodName: string, decoratorName: string, decoratorArgs: string[]): this {
    const method = this.classDeclaration.getMethod(methodName);
    if (!method) throw new Error(`Method '${methodName}' not found in class '${this.classDeclaration.getName()}'`);

    const decorator = method.getDecorator(decoratorName);
    if (!decorator) throw new Error(`Decorator '${decoratorName}' not found on method '${methodName}'`);

    decorator.getArguments().forEach(arg => decorator.removeArgument(arg));
    decorator.addArguments(decoratorArgs);

    return this;
  }

  /**
   * Remove a method by name from the class.
   */
  public removeMethod(methodName: string): this {
    const method = this.classDeclaration.getMethod(methodName);
    if (!method) throw new Error(`Method '${methodName}' not found`);
    method.remove();
    return this;
  }

  /**
   * Add a method from an external class source file, merging its imports.
   */
  public addMethodFromSource(sourcePath: string, methodName: string): this {
    const sourceFile = this.project.addSourceFileAtPath(sourcePath);
    const method = sourceFile.getFunction(methodName) ?? sourceFile.getClasses()[ 0 ]?.getMethod(methodName);
    if (!method) throw new Error(`Method '${methodName}' not found in '${sourcePath}'`);

    const structure = JSON.parse(JSON.stringify(method.getStructure()));

    // Add imports from the source file to the target file
    const sourceImports = sourceFile.getImportDeclarations();
    sourceImports.forEach(importDecl => {
      const named = importDecl.getNamedImports().map(ni => ni.getName());
      this.addImports(importDecl.getModuleSpecifierValue(), named);
    });

    this.classDeclaration.addMethod(structure);
    return this;
  }

  /**
   * Adds named imports for a given module specifier, merging with existing imports if possible.
   * @param moduleSpecifier - The module to import from (e.g., '@ten24group/fw24').
   * @param namedImports - An array of names to import (e.g., ['Request', 'Response']).
   */
  public addImports(moduleSpecifier: string, namedImports: string[]): this {
    if (namedImports.length === 0) return this;

    // Make matching more robust: handle relative vs. absolute paths to the framework.
    const isFw24Import = moduleSpecifier.includes('fw24');
    let importDecl = this.sourceFile.getImportDeclaration(spec => {
      const specifierValue = spec.getModuleSpecifierValue();
      if (isFw24Import) {
        return specifierValue.includes('fw24');
      }
      return specifierValue === moduleSpecifier;
    });

    if (importDecl) {
      const existingImports = importDecl.getNamedImports().map(ni => ni.getName());
      const newImports = namedImports.filter(ni => !existingImports.includes(ni));
      if (newImports.length > 0) {
        importDecl.addNamedImports(newImports);
      }
    } else {
      this.sourceFile.addImportDeclaration({ moduleSpecifier, namedImports });
    }

    return this;
  }

  /**
   * Remove an import or a specific named import from the source file.
   */
  public removeImport(moduleSpecifier: string, namedImport?: string): this {
    const importDecl = this.sourceFile.getImportDeclaration(id =>
      id.getModuleSpecifier().getLiteralText() === moduleSpecifier
    );
    if (!importDecl) return this;
    if (!namedImport) {
      importDecl.remove();
    } else {
      const named = importDecl.getNamedImports().find(n => n.getName() === namedImport);
      if (named) named.remove();
      if (importDecl.getNamedImports().length === 0) importDecl.remove();
    }
    return this;
  }

  /**
   * Add a default import (e.g., import Foo from 'bar').
   */
  public addDefaultImport(moduleSpecifier: string, defaultImportName: string): this {
    const importDecl = this.sourceFile.getImportDeclaration(id =>
      id.getModuleSpecifier().getLiteralText() === moduleSpecifier
    );
    if (importDecl) {
      importDecl.setDefaultImport(defaultImportName);
    } else {
      this.sourceFile.addImportDeclaration({ defaultImport: defaultImportName, moduleSpecifier });
    }
    return this;
  }

  /**
   * Add a namespace import (e.g., import * as Foo from 'bar').
   */
  public addNamespaceImport(moduleSpecifier: string, namespaceName: string): this {
    const importDecl = this.sourceFile.getImportDeclaration(id =>
      id.getModuleSpecifier().getLiteralText() === moduleSpecifier
    );
    if (importDecl) {
      importDecl.setNamespaceImport(namespaceName);
    } else {
      this.sourceFile.addImportDeclaration({ namespaceImport: namespaceName, moduleSpecifier });
    }
    return this;
  }

  /**
   * Add a class-level decorator to the class.
   */
  public addClassDecorator(decoratorConfig: DecoratorConfig): this {
    this.getClassDeclarationRef().addDecorator(decoratorConfig);
    return this;
  }

  /**
   * Patch the arguments of a class-level decorator.
   */
  public patchDecoratorArgsOnClass(decoratorName: string, decoratorArgs: string[]): this {
    const decorator = this.classDeclaration.getDecoratorOrThrow(decoratorName);
    const callExpression = decorator.getCallExpression();

    if (!callExpression) {
      // The decorator exists but isn't a call (e.g., @injectable), so we replace it.
      const structure = decorator.getStructure();
      decorator.remove();
      this.classDeclaration.addDecorator({
        name: structure.name,
        arguments: decoratorArgs,
      });
    } else {
      // It is a call, so we can just set its arguments.
      const currentArgs = callExpression.getArguments();
      // Per ts-morph docs, removing backwards is safest
      for (let i = currentArgs.length - 1; i >= 0; i--) {
        callExpression.removeArgument(i);
      }
      callExpression.addArguments(decoratorArgs);
    }
    return this;
  }

  /**
   * Rename the class declaration.
   */
  public renameClass(newName: string): this {
    this.classDeclaration.rename(newName);
    return this;
  }

  /**
   * Get the current class name.
   */
  public getClassName(): string {
    return this.classDeclaration.getNameOrThrow();
  }

  /**
   * Set the 'extends' clause for the class.
   */
  public setExtends(className: string): this {
    this.classDeclaration.setExtends(className);
    return this;
  }

  /**
   * Add 'implements' clauses to the class.
   */
  public addImplements(interfaceNames: string[]): this {
    interfaceNames.forEach(name => this.classDeclaration.addImplements(name));
    return this;
  }

  /**
   * Add or update JSDoc on the class.
   */
  public addJsDocToClass(docText: string): this {
    this.classDeclaration.addJsDoc({ description: docText });
    return this;
  }

  /**
   * Adds a new method to the class.
   * @param methodStructure - The structure of the method to add.
   */
  public addMethod(methodStructure: OptionalKind<MethodDeclarationStructure>): this {
    this.getClassDeclarationRef().addMethod(methodStructure);
    return this;
  }

  /**
   * Add a class property based on PropertyConfig.
   */
  public addProperty(config: PropertyConfig): this {
    this.classDeclaration.addProperty(this.createPropertyStructure(config));
    return this;
  }

  public addOrUpdateProperty(config: PropertyConfig): this {
    const existing = this.classDeclaration.getProperty(config.name);
    if (existing) {
      existing.remove();
    }
    this.addProperty(config);
    return this;
  }

  /**
   * Add or update JSDoc on a specific method.
   */
  public addJsDocToMethod(methodName: string, docText: string): this {
    this.classDeclaration.getMethodOrThrow(methodName).addJsDoc({ description: docText });
    return this;
  }

  /**
   * Add or update JSDoc on a specific property.
   */
  public addJsDocToProperty(propertyName: string, docText: string): this {
    this.classDeclaration.getPropertyOrThrow(propertyName).addJsDoc({ description: docText });
    return this;
  }

  /**
   * Add a parameter to the class constructor. Creates constructor if it doesn't exist.
   */
  public addConstructorParameter(config: ParameterConfig): this {
    const ctor = this.classDeclaration.getConstructors()[ 0 ] ?? this.classDeclaration.addConstructor();
    ctor.addParameter(this.createParameterStructure(config));
    return this;
  }

  /**
   * Overwrite the body of the class constructor.
   */
  public setConstructorBody(bodyText: string): this {
    const ctor = this.classDeclaration.getConstructors()[ 0 ] ?? this.classDeclaration.addConstructor();
    ctor.setBodyText(bodyText);
    return this;
  }

  /**
   * Add a top-level interface to the source file.
   */
  public addInterface(structure: InterfaceDeclarationStructure): this {
    this.sourceFile.addInterface(structure);
    return this;
  }

  /**
   * Add a top-level type alias to the source file.
   */
  public addTypeAlias(structure: TypeAliasDeclarationStructure): this {
    this.sourceFile.addTypeAlias(structure);
    return this;
  }

  /**
  * Adds a named export declaration to the file (e.g., `export { MyClass };`).
  * @param names - An array of names to export.
  */
  public addNamedExport(names: string[]): this {
    this.sourceFile.addExportDeclaration({
      namedExports: names,
    });
    return this;
  }

  /**
   * Adds a default export to the file (e.g., `export default MyClass;`).
   * @param name - The name of the identifier to export as default.
   */
  public addDefaultExport(name: string): this {
    this.sourceFile.addExportAssignment({
      expression: name,
      isExportEquals: false,
    });
    return this;
  }

  /**
   * Get the ts-morph SourceFile reference for advanced manipulation.
   * This provides direct access to the underlying SourceFile instance for operations
   * not covered by the BaseFactory methods.
   * 
   * @returns The ts-morph SourceFile instance representing the template file
   */
  public getSourceFileRef(): SourceFile {
    return this.sourceFile;
  }

  /**
   * Get the ts-morph ClassDeclaration reference for advanced manipulation.
   * This provides direct access to the underlying ClassDeclaration instance for operations
   * not covered by the BaseFactory methods.
   * 
   * @returns The ts-morph ClassDeclaration instance representing the class
   */
  public getClassDeclarationRef(): ClassDeclaration {
    return this.classDeclaration;
  }

  private createParameterStructure(config: ParameterConfig): ParameterDeclarationStructure {
    return {
      kind: StructureKind.Parameter,
      name: config.name,
      type: config.type,
      initializer: config.initializer,
      hasQuestionToken: config.isOptional,
      decorators: config.decorators?.map(d => ({
        kind: StructureKind.Decorator,
        name: d.name,
        arguments: d.args || []
      })),
      scope: config.scope,
      isReadonly: config.isReadonly,
    };
  }

  private createMethodStructure(config: MethodConfig): MethodDeclarationStructure {
    return {
      kind: StructureKind.Method,
      name: config.name,
      isAsync: config.isAsync,
      isStatic: config.isStatic,
      scope: config.scope,
      docs: config.jsDoc ? [ { description: config.jsDoc } ] : undefined,
      decorators: config.decorators?.map(d => ({ kind: StructureKind.Decorator, name: d.name, arguments: d.args || [] })),
      parameters: config.parameters?.map(p => this.createParameterStructure(p)),
      returnType: config.returnType,
      statements: config.bodyText,
    };
  }

  private createPropertyStructure(config: PropertyConfig): PropertyDeclarationStructure {
    return {
      kind: StructureKind.Property,
      name: config.name,
      hasQuestionToken: config.optional,
      type: config.type,
      initializer: config.initializer,
      docs: config.jsDoc ? [ { description: config.jsDoc } ] : undefined,
      decorators: config.decorators?.map(d => ({ kind: StructureKind.Decorator, name: d.name, arguments: d.args || [] })),
      scope: config.scope,
      isStatic: config.isStatic,
      isReadonly: config.isReadonly,
    };
  }

  /**
   * Adds a statement to the constructor body.
   * @param statement - The code statement to add.
   */
  public addStatementToConstructor(statement: string): this {
    const constructor = this.getClassDeclarationRef().getConstructors()[ 0 ] ?? this.getClassDeclarationRef().addConstructor();
    constructor.addStatements(statement);
    return this;
  }

  private valueToInitializer(value: any): string {
    if (value === null) return 'null';
    if (typeof value === 'undefined') return 'undefined';
    if (typeof value === 'string') return `'${value.replace(/'/g, "\\'")}'`;
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (Array.isArray(value)) return `[${value.map(v => this.valueToInitializer(v)).join(', ')}]`;
    if (typeof value === 'object') {
      const properties = Object.keys(value)
        .map(key => `${key}: ${this.valueToInitializer((value as any)[ key ])}`)
        .join(',\n');
      return `{\n${properties}\n}`;
    }
    return String(value);
  }

  // --- AST Inspection Methods ---

  public getDecorator(name: string) {
    return this.getClassDeclarationRef().getDecorator(name);
  }

  public getMethod(name: string) {
    return this.getClassDeclarationRef().getMethod(name);
  }

  public getImportDeclaration(findFn: (d: ImportDeclaration) => boolean) {
    return this.sourceFile.getImportDeclaration(findFn);
  }

  // --- Enhanced Factory Methods ---

  /**
   * Safe object literal parser that doesn't use eval().
   */
  private parseObjectLiteralSafely(objLiteral: ObjectLiteralExpression): Record<string, any> {
    const result: Record<string, any> = {};

    objLiteral.getProperties().forEach(prop => {
      if (Node.isPropertyAssignment(prop)) {
        const name = prop.getName();
        const value = prop.getInitializer();

        if (value) {
          if (Node.isStringLiteral(value)) {
            result[ name ] = value.getLiteralValue();
          } else if (Node.isNumericLiteral(value)) {
            result[ name ] = value.getLiteralValue();
          } else if (value.getKind() === SyntaxKind.TrueKeyword) {
            result[ name ] = true;
          } else if (value.getKind() === SyntaxKind.FalseKeyword) {
            result[ name ] = false;
          } else if (value.getKind() === SyntaxKind.NullKeyword) {
            result[ name ] = null;
          } else if (Node.isArrayLiteralExpression(value)) {
            // Simple array parsing for primitive values
            result[ name ] = value.getElements().map(el => {
              if (Node.isStringLiteral(el)) return el.getLiteralValue();
              if (Node.isNumericLiteral(el)) return el.getLiteralValue();
              return el.getText();
            });
          } else {
            // For complex objects, just keep the text representation
            result[ name ] = value.getText();
          }
        }
      }
    });

    return result;
  }

  /**
   * Log operation if debug mode is enabled.
   */
  protected logOperation(message: string): void {
    if (this.debug.logOperations) {
      console.log(`[BaseFactory] ${message}`);
    }
  }

  /**
   * Log warning if verbose mode is enabled.
   */
  private logWarning(message: string): void {
    if (this.debug.verbose) {
      console.warn(`[BaseFactory Warning] ${message}`);
    }
  }

  /**
   * Add getter and setter methods for a property.
   */
  public addAccessor(config: AccessorConfig): this {
    this.logOperation(`Adding accessor for property: ${config.name}`);

    if (config.getterBody) {
      const getterStructure: GetAccessorDeclarationStructure = {
        kind: StructureKind.GetAccessor,
        name: config.name,
        returnType: config.type,
        scope: config.scope,
        statements: config.getterBody,
        docs: config.getterJsDoc ? [ { description: config.getterJsDoc } ] : undefined,
        decorators: config.decorators?.map(d => ({
          kind: StructureKind.Decorator,
          name: d.name,
          arguments: d.args || []
        })),
      };
      this.classDeclaration.addGetAccessor(getterStructure);
    }

    if (config.setterBody) {
      const setterStructure: SetAccessorDeclarationStructure = {
        kind: StructureKind.SetAccessor,
        name: config.name,
        scope: config.scope,
        parameters: [ {
          name: config.setterParamName || 'value',
          type: config.type,
        } ],
        statements: config.setterBody,
        docs: config.setterJsDoc ? [ { description: config.setterJsDoc } ] : undefined,
      };
      this.classDeclaration.addSetAccessor(setterStructure);
    }

    return this;
  }

  /**
   * Add an enum to the source file.
   */
  public addEnum(config: EnumConfig): this {
    this.logOperation(`Adding enum: ${config.name}`);

    const enumStructure: EnumDeclarationStructure = {
      kind: StructureKind.Enum,
      name: config.name,
      isConst: config.isConst,
      isExported: config.isExported,
      docs: config.jsDoc ? [ { description: config.jsDoc } ] : undefined,
      members: config.members.map(member => ({
        name: member.name,
        value: member.value,
        docs: member.jsDoc ? [ { description: member.jsDoc } ] : undefined,
      })),
    };

    this.sourceFile.addEnum(enumStructure);
    return this;
  }

  /**
   * Add a function declaration to the source file.
   */
  public addFunction(config: {
    name: string;
    parameters?: ParameterConfig[];
    returnType?: string;
    bodyText: string;
    isExported?: boolean;
    isAsync?: boolean;
    jsDoc?: string;
    typeParameters?: string[];
  }): this {
    this.logOperation(`Adding function: ${config.name}`);

    const functionStructure: FunctionDeclarationStructure = {
      kind: StructureKind.Function,
      name: config.name,
      isExported: config.isExported,
      isAsync: config.isAsync,
      returnType: config.returnType,
      parameters: config.parameters?.map(p => this.createParameterStructure(p)),
      statements: config.bodyText,
      docs: config.jsDoc ? [ { description: config.jsDoc } ] : undefined,
      typeParameters: config.typeParameters?.map(tp => ({ name: tp })),
    };

    this.sourceFile.addFunction(functionStructure);
    return this;
  }

  /**
   * Enhanced validation with detailed results.
   */
  public validateTsDetailed(): ValidationResult {
    this.logOperation('Running detailed TypeScript validation');

    const diagnostics = this.project.getPreEmitDiagnostics();
    const errors: string[] = [];
    const warnings: string[] = [];

    diagnostics.forEach(diagnostic => {
      const message = diagnostic.getMessageText();
      const severity = diagnostic.getCategory();

      if (severity === 1) { // Error
        errors.push(typeof message === 'string' ? message : message.getMessageText());
      } else if (severity === 0) { // Warning
        warnings.push(typeof message === 'string' ? message : message.getMessageText());
      }
    });

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Conditional operation execution.
   */
  public when(condition: boolean, action: (factory: this) => this): this {
    if (condition) {
      return action(this);
    }
    return this;
  }

  /**
   * Batch operation execution.
   */
  public batch(operations: Array<(factory: this) => this>): this {
    this.logOperation(`Executing batch of ${operations.length} operations`);

    operations.forEach(operation => {
      operation(this);
    });

    return this;
  }

  /**
   * Add type parameters to the class.
   */
  public addTypeParameters(typeParams: string[]): this {
    typeParams.forEach(param => {
      this.classDeclaration.addTypeParameter({ name: param });
    });
    return this;
  }

  /**
   * Make the class abstract.
   */
  public makeAbstract(): this {
    this.classDeclaration.setIsAbstract(true);
    return this;
  }

  /**
   * Add an abstract method to the class.
   */
  public addAbstractMethod(config: {
    name: string;
    parameters?: ParameterConfig[];
    returnType?: string;
    jsDoc?: string;
    scope?: Scope;
  }): this {
    this.logOperation(`Adding abstract method: ${config.name}`);

    const methodStructure: MethodDeclarationStructure = {
      kind: StructureKind.Method,
      name: config.name,
      isAbstract: true,
      scope: config.scope,
      parameters: config.parameters?.map(p => this.createParameterStructure(p)),
      returnType: config.returnType,
      docs: config.jsDoc ? [ { description: config.jsDoc } ] : undefined,
    };

    this.classDeclaration.addMethod(methodStructure);
    return this;
  }

  /**
   * Get performance metrics if enabled.
   */
  public getPerformanceMetrics(): { executionTime?: number } {
    if (this.debug.performanceMetrics && this.performanceStart) {
      return {
        executionTime: Date.now() - this.performanceStart,
      };
    }
    return {};
  }
} 