import path from 'path';
import { BaseFactory, FactoryOptions, Scope } from '../base-factory';
import { Project, SourceFile, StructureKind } from 'ts-morph';

// A concrete implementation for testing the abstract BaseFactory
class TestFactory extends BaseFactory<FactoryOptions> { }

describe('BaseFactory', () => {
  const fixturesDir = path.resolve(__dirname, 'fixtures');
  const templatePath = path.resolve(fixturesDir, 'BaseTest.ts');
  const extraMethodsPath = path.resolve(fixturesDir, 'ExtraMethods.ts');

  let project: Project;
  let factory: TestFactory;
  let templateFile: SourceFile;

  beforeAll(() => {
    project = new Project();
    templateFile = project.addSourceFileAtPath(templatePath);
  });

  beforeEach(() => {
    const testFile = templateFile.copy('test-BaseTest.ts', { overwrite: true });
    factory = new TestFactory({
      project,
      templateText: testFile.getFullText(),
    });
  });

  describe('Constructor & Setup', () => {
    test('throws if no template provided', () => {
      // @ts-ignore
      expect(() => new TestFactory({ project })).toThrow('One of templatePath or templateText must be provided');
    });

    test('throws if template has no class', () => {
      expect(() => new TestFactory({ project, templateText: 'const x = 1;' })).toThrow('contains no classes');
    });

    test('render() returns full text of the source file', () => {
      const content = factory.render();
      expect(content).toContain('class BaseTestClass');
    });

    test('initializes debug options', () => {
      const factoryWithDebug = new TestFactory({
        project,
        templateText: templateFile.getFullText(),
        debug: { verbose: true, logOperations: true, performanceMetrics: true },
      });
      expect(factoryWithDebug.getPerformanceMetrics()).toHaveProperty('executionTime');
    });

    test('sets framework import path', () => {
      const customPath = '@custom/framework';
      const factoryWithCustomPath = new TestFactory({
        project,
        templateText: templateFile.getFullText(),
        frameworkImportPath: customPath,
      });
      // Test that custom path is used by adding a framework import
      factoryWithCustomPath.addImports(customPath, [ 'TestImport' ]);
      expect(factoryWithCustomPath.render()).toContain(`from "${customPath}"`);
    });
  });

  describe('Class Manipulation', () => {
    test('renameClass() renames the class', () => {
      factory.renameClass('NewClassName');
      expect(factory.getClassDeclarationRef().getName()).toBe('NewClassName');
    });

    test('setExtends() sets the superclass', () => {
      factory.setExtends('Error');
      expect(factory.getClassDeclarationRef().getExtends()?.getText()).toBe('Error');
    });

    test('addImplements() adds an interface', () => {
      factory.addImplements([ 'MyInterface' ]);
      expect(factory.getClassDeclarationRef().getImplements()[ 0 ].getText()).toBe('MyInterface');
    });

    test('addJsDocToClass() adds a JSDoc comment', () => {
      factory.addJsDocToClass('This is a test class.');
      const docs = factory.getClassDeclarationRef().getJsDocs();
      expect(docs.length).toBe(1);
      expect(docs[ 0 ].getDescription()).toBe('This is a test class.');
    });

    test('addTypeParameters() adds generic type parameters', () => {
      factory.addTypeParameters([ 'T', 'U extends string' ]);
      const typeParams = factory.getClassDeclarationRef().getTypeParameters();
      expect(typeParams.length).toBe(2);
      expect(typeParams[ 0 ].getName()).toBe('T');
      expect(typeParams[ 1 ].getName()).toBe('U');
    });

    test('makeAbstract() makes class abstract', () => {
      factory.makeAbstract();
      expect(factory.getClassDeclarationRef().isAbstract()).toBe(true);
    });
  });

  describe('Method Manipulation', () => {
    test('addMethod() adds a new method', () => {
      factory.addMethod({ name: 'newMethod', statements: 'return 1;' });
      expect(factory.getMethod('newMethod')).toBeDefined();
    });

    test('removeMethod() removes a method', () => {
      factory.removeMethod('myMethod');
      expect(factory.getMethod('myMethod')).toBeUndefined();
    });

    test('addMethodFromSource() adds a method and its imports', () => {
      factory.addMethodFromSource(extraMethodsPath, 'ping');
      expect(factory.getMethod('ping')).toBeDefined();
      const fw24Import = factory.getImportDeclaration(i => i.getModuleSpecifierValue().includes('fw24'));
      expect(fw24Import).toBeDefined();
      expect(fw24Import!.getNamedImports().some(ni => ni.getName() === 'Get')).toBe(true);
    });

    test('addAbstractMethod() adds abstract method', () => {
      factory.makeAbstract();
      factory.addAbstractMethod({
        name: 'abstractMethod',
        returnType: 'void',
        parameters: [ { name: 'param', type: 'string' } ],
      });

      const method = factory.getMethod('abstractMethod');
      expect(method).toBeDefined();
      expect(method!.isAbstract()).toBe(true);
    });
  });

  describe('Property & Constructor Manipulation', () => {
    test('addProperty() adds a property', () => {
      factory.addProperty({ name: 'newProp', type: 'number' });
      expect(factory.getClassDeclarationRef().getProperty('newProp')).toBeDefined();
    });

    test('addOrUpdateProperty() updates existing property', () => {
      factory.addProperty({ name: 'testProp', type: 'string' });
      factory.addOrUpdateProperty({ name: 'testProp', type: 'number' });

      const prop = factory.getClassDeclarationRef().getProperty('testProp');
      expect(prop?.getTypeNode()?.getText()).toBe('number');
    });

    test('addConstructorParameter() adds a parameter', () => {
      factory.addConstructorParameter({ name: 'dep', type: 'DepService' });
      const ctor = factory.getClassDeclarationRef().getConstructors()[ 0 ];
      expect(ctor.getParameter('dep')).toBeDefined();
    });

    test('addStatementToConstructor() adds a statement', () => {
      factory.addStatementToConstructor('this.foo = "bar";');
      const ctor = factory.getClassDeclarationRef().getConstructors()[ 0 ];
      expect(ctor.getBodyText()).toContain('this.foo = "bar";');
    });

    test('setConstructorBody() overwrites constructor body', () => {
      factory.setConstructorBody('this.newBody = true;');
      const ctor = factory.getClassDeclarationRef().getConstructors()[ 0 ];
      expect(ctor.getBodyText()).toBe('this.newBody = true;');
    });
  });

  describe('Accessor Methods', () => {
    test('addAccessor() adds getter and setter', () => {
      factory.addAccessor({
        name: 'testProperty',
        type: 'string',
        getterBody: 'return this._testProperty;',
        setterBody: 'this._testProperty = value;',
        getterJsDoc: 'Gets the test property',
        setterJsDoc: 'Sets the test property',
      });

      const getter = factory.getClassDeclarationRef().getGetAccessor('testProperty');
      const setter = factory.getClassDeclarationRef().getSetAccessor('testProperty');

      expect(getter).toBeDefined();
      expect(setter).toBeDefined();
      expect(getter!.getBodyText()).toContain('return this._testProperty;');
      expect(setter!.getBodyText()).toContain('this._testProperty = value;');
    });

    test('addAccessor() with custom setter parameter name', () => {
      factory.addAccessor({
        name: 'customProp',
        type: 'number',
        setterBody: 'this._customProp = newValue;',
        setterParamName: 'newValue',
      });

      const setter = factory.getClassDeclarationRef().getSetAccessor('customProp');
      expect(setter!.getParameters()[ 0 ].getName()).toBe('newValue');
    });
  });

  describe('Decorator Manipulation', () => {
    test('patchDecoratorConfigOnClass() updates decorator config safely', () => {
      factory.patchDecoratorConfigOnClass('ClassDecorator', { setting: 'updated', newProp: true });
      const decorator = factory.getDecorator('ClassDecorator');
      const config = decorator!.getArguments()[ 1 ];
      expect(config.getText()).toContain("setting: 'updated'");
      expect(config.getText()).toContain('newProp: true');
    });

    test('patchDecoratorArgsOnMethod() updates decorator args', () => {
      factory.patchDecoratorArgsOnMethod('myMethod', 'MethodDecorator', [ "'/newpath'" ]);
      const decorator = factory.getMethod('myMethod')?.getDecorator('MethodDecorator');
      expect(decorator?.getArguments()[ 0 ].getText()).toBe("'/newpath'");
    });

    test('patchDecoratorArgsOnClass() updates class decorator args', () => {
      factory.patchDecoratorArgsOnClass('ClassDecorator', [ "'newArg'", "{ test: true }" ]);
      const decorator = factory.getDecorator('ClassDecorator');
      const args = decorator!.getArguments();
      expect(args[ 0 ].getText()).toBe("'newArg'");
      expect(args[ 1 ].getText()).toBe("{ test: true }");
    });

    test('addClassDecorator() adds new decorator', () => {
      factory.addClassDecorator({ name: 'NewDecorator', args: [ 'arg1', 'arg2' ] });
      const decorator = factory.getDecorator('NewDecorator');
      expect(decorator).toBeDefined();
    });
  });

  describe('Import/Export Manipulation', () => {
    test('addImports() adds and merges imports', () => {
      factory.getSourceFileRef().addImportDeclaration({ moduleSpecifier: 'some-module', namedImports: [ 'Foo', 'Bar' ] });
      factory.addImports('some-module', [ 'Foo', 'Baz' ]); // Foo exists, Baz is new
      const imp = factory.getSourceFileRef().getImportDeclaration('some-module');
      const named = imp!.getNamedImports().map(n => n.getName());
      expect(named).toEqual(expect.arrayContaining([ 'Foo', 'Bar', 'Baz' ]));
    });

    test('removeImport() removes a named import', () => {
      factory.getSourceFileRef().addImportDeclaration({ moduleSpecifier: 'to-be-removed', namedImports: [ 'A', 'B' ] });
      factory.removeImport('to-be-removed', 'A');
      const imp = factory.getSourceFileRef().getImportDeclaration('to-be-removed');
      expect(imp?.getNamedImports().map(n => n.getName())).toEqual([ 'B' ]);
      factory.removeImport('to-be-removed', 'B');
      expect(factory.getSourceFileRef().getImportDeclaration('to-be-removed')).toBeUndefined();
    });

    test('addDefaultImport() adds a default import', () => {
      factory.addDefaultImport('default-module', 'DefaultClass');
      const imp = factory.getSourceFileRef().getImportDeclaration('default-module');
      expect(imp?.getDefaultImport()?.getText()).toBe('DefaultClass');
    });

    test('addNamespaceImport() adds namespace import', () => {
      factory.addNamespaceImport('namespace-module', 'NS');
      const imp = factory.getSourceFileRef().getImportDeclaration('namespace-module');
      expect(imp?.getNamespaceImport()?.getText()).toBe('NS');
    });

    test('addDefaultExport() adds a default export', () => {
      factory.addDefaultExport('BaseTestClass');
      const defaultExport = factory.getSourceFileRef().getExportAssignment(e => !e.isExportEquals());
      expect(defaultExport).toBeDefined();
      expect(defaultExport?.getExpression().getText()).toBe('BaseTestClass');
    });

    test('addNamedExport() adds named exports', () => {
      factory.addNamedExport([ 'ExportOne', 'ExportTwo' ]);
      const exportDecl = factory.getSourceFileRef().getExportDeclarations()[ 0 ];
      const namedExports = exportDecl.getNamedExports().map(ne => ne.getName());
      expect(namedExports).toEqual([ 'ExportOne', 'ExportTwo' ]);
    });
  });

  describe('Advanced AST Features', () => {
    test('addEnum() creates an enum', () => {
      factory.addEnum({
        name: 'TestEnum',
        isExported: true,
        jsDoc: 'A test enumeration',
        members: [
          { name: 'FIRST', value: 1, jsDoc: 'First value' },
          { name: 'SECOND', value: "'second'", jsDoc: 'Second value' },
          { name: 'THIRD' },
        ],
      });

      const enumDecl = factory.getSourceFileRef().getEnum('TestEnum');
      expect(enumDecl).toBeDefined();
      expect(enumDecl!.isExported()).toBe(true);
      expect(enumDecl!.getMembers().length).toBe(3);
      expect(enumDecl!.getMember('FIRST')?.getValue()).toBe(1);
    });

    test('addFunction() creates a function', () => {
      factory.addFunction({
        name: 'helperFunction',
        isExported: true,
        isAsync: true,
        returnType: 'Promise<string>',
        parameters: [
          { name: 'input', type: 'string' },
          { name: 'options', type: 'object', isOptional: true },
        ],
        bodyText: 'return Promise.resolve(input);',
        jsDoc: 'A helper function for testing',
        typeParameters: [ 'T' ],
      });

      const func = factory.getSourceFileRef().getFunction('helperFunction');
      expect(func).toBeDefined();
      expect(func!.isExported()).toBe(true);
      expect(func!.isAsync()).toBe(true);
      expect(func!.getParameters().length).toBe(2);
      expect(func!.getTypeParameters().length).toBe(1);
    });

    test('addInterface() and addTypeAlias() methods exist', () => {
      // These methods exist for advanced users who need them
      expect(typeof factory.addInterface).toBe('function');
      expect(typeof factory.addTypeAlias).toBe('function');
    });
  });

  describe('Validation & Error Handling', () => {
    test('validateTs() throws on type errors', () => {
      factory.addMethod({ name: 'bad', statements: 'const x: string = 1;' });
      expect(() => factory.validateTs()).toThrow('TypeScript validation failed');
    });

    test('validateTsDetailed() returns validation results', () => {
      // Create a clean factory with minimal valid code
      const cleanFactory = new TestFactory({
        project: new Project(),
        templateText: `
          export class TestClass {
            constructor() {}
            
            good(): string {
              const x: string = "hello";
              return x;
            }
          }
        `
      });

      const result = cleanFactory.validateTsDetailed();
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(Array.isArray(result.warnings)).toBe(true);
    });

    test('validateTsDetailed() captures errors', () => {
      factory.addMethod({ name: 'bad', statements: 'const x: string = 1;' });
      const result = factory.validateTsDetailed();
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Builder Pattern Features', () => {
    test('when() executes conditional operations', () => {
      let executed = false;
      factory.when(true, f => {
        executed = true;
        return f.addProperty({ name: 'conditionalProp', type: 'string' });
      });

      expect(executed).toBe(true);
      expect(factory.getClassDeclarationRef().getProperty('conditionalProp')).toBeDefined();
    });

    test('when() skips on false condition', () => {
      let executed = false;
      factory.when(false, f => {
        executed = true;
        return f.addProperty({ name: 'skippedProp', type: 'string' });
      });

      expect(executed).toBe(false);
      expect(factory.getClassDeclarationRef().getProperty('skippedProp')).toBeUndefined();
    });

    test('batch() executes multiple operations', () => {
      factory.batch([
        f => f.addProperty({ name: 'prop1', type: 'string' }),
        f => f.addProperty({ name: 'prop2', type: 'number' }),
        f => f.addMethod({ name: 'method1', statements: 'return;' }),
      ]);

      expect(factory.getClassDeclarationRef().getProperty('prop1')).toBeDefined();
      expect(factory.getClassDeclarationRef().getProperty('prop2')).toBeDefined();
      expect(factory.getMethod('method1')).toBeDefined();
    });
  });

  describe('Performance & Debug Features', () => {
    test('getPerformanceMetrics() returns timing when enabled', () => {
      const debugFactory = new TestFactory({
        project,
        templateText: templateFile.getFullText(),
        debug: { performanceMetrics: true },
      });

      // Perform some operations
      debugFactory.addProperty({ name: 'testProp', type: 'string' });

      const metrics = debugFactory.getPerformanceMetrics();
      expect(metrics).toHaveProperty('executionTime');
      expect(typeof metrics.executionTime).toBe('number');
    });

    test('getPerformanceMetrics() returns empty when disabled', () => {
      const metrics = factory.getPerformanceMetrics();
      expect(metrics).toEqual({});
    });

    test('debug logging works with verbose mode', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const debugFactory = new TestFactory({
        project,
        templateText: templateFile.getFullText(),
        debug: { verbose: true },
      });

      // This should trigger a warning internally and not throw
      expect(() => {
        debugFactory.patchDecoratorConfigOnClass('NonExistentDecorator', {});
      }).not.toThrow();

      // Check that warning was logged
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[BaseFactory Warning]')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('Edge Cases & Error Handling', () => {
    test('handles malformed decorator config gracefully', () => {
      // Add a malformed decorator first
      factory.getClassDeclarationRef().addDecorator({
        name: 'MalformedDecorator',
        arguments: [ '{ invalid: }' ], // Invalid syntax
      });

      // Should not throw, should use empty config
      expect(() => {
        factory.patchDecoratorConfigOnClass('MalformedDecorator', { fixed: true });
      }).not.toThrow();
    });

    test('handles non-existent decorator gracefully', () => {
      // Should not throw, should handle gracefully by skipping the operation
      expect(() => {
        factory.patchDecoratorConfigOnClass('NonExistent', {});
      }).not.toThrow();
    });

    test('handles empty arrays gracefully', () => {
      expect(() => {
        factory.addImports('test-module', []);
      }).not.toThrow();
    });
  });
}); 