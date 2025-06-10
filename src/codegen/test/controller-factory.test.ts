import path from 'path';
import { ControllerFactory } from '../controller-factory';
import { ObjectLiteralExpression, SyntaxKind, Project, SourceFile } from 'ts-morph';
import { Scope } from 'ts-morph';

describe('ControllerFactory (AST-based)', () => {
  const fixturesDir = path.resolve(__dirname, 'fixtures');
  const simpleTemplatePath = path.resolve(fixturesDir, 'SimpleController.ts');
  const extraTemplatePath = path.resolve(fixturesDir, 'ExtraMethods.ts');

  let project: Project;
  let factory: ControllerFactory<{ project: Project; templateText: string; }>;
  let simpleControllerFile: SourceFile;

  beforeAll(() => {
    project = new Project();
    simpleControllerFile = project.addSourceFileAtPath(simpleTemplatePath);
  });

  beforeEach(() => {
    // Create a copy for each test to mutate
    const testFile = simpleControllerFile.copy('test-SimpleController.ts', { overwrite: true });
    factory = new ControllerFactory({
      project, // Reuse the same project
      templateText: testFile.getFullText(),
    });
  });

  test('constructor throws if no template provided', () => {
    // @ts-ignore: testing missing options
    expect(() => new ControllerFactory({ project })).toThrow('One of templatePath or templateText must be provided');
  });

  test('loads and renders without modifications', () => {
    const controllerClass = factory.getClassDeclarationRef();
    expect(controllerClass).toBeDefined();
    expect(controllerClass.getName()).toBe('SimpleController');
    expect(controllerClass.getMethod('hello')).toBeDefined();
    expect(controllerClass.getMethod('goodbye')).toBeDefined();
  });

  test('removeMethod removes specified method', () => {
    factory.removeMethod('goodbye');
    const controllerClass = factory.getClassDeclarationRef();
    expect(controllerClass.getMethod('goodbye')).toBeUndefined();
    expect(controllerClass.getMethod('hello')).toBeDefined();
  });

  test('removeMethod throws if method does not exist', () => {
    expect(() => factory.removeMethod('nonExistentMethod')).toThrow("Method 'nonExistentMethod' not found");
  });

  test('handles non-existent decorator gracefully', () => {
    const noDecoratorFactory = new ControllerFactory({ project, templateText: `export class Foo {}` });

    // Should not throw, should handle gracefully by skipping the operation
    expect(() => {
      noDecoratorFactory.setConfig({ requireApiKey: true });
    }).not.toThrow();
  });

  test('patchDecoratorArgsOnMethod throws if method or decorator missing', () => {
    expect(() => factory.patchDecoratorArgsOnMethod('nonExistentMethod', 'Post', [])).toThrow("Method 'nonExistentMethod' not found in class 'SimpleController'");
    expect(() => factory.patchDecoratorArgsOnMethod('hello', 'Get', [])).toThrow("Decorator 'Get' not found on method 'hello'");
  });

  test('validateTs throws on invalid TypeScript code', () => {
    factory.addMethod({
      name: 'badMethod',
      statements: 'const x: string = 123; return x;',
    });
    expect(() => factory.validateTs()).toThrow('TypeScript validation failed');
  });

  test('throws error when adding auth to non-existent method', () => {
    expect(() => {
      factory.addAuthenticationToMethod('nonExistentMethod');
    }).toThrow("Method 'nonExistentMethod' not found");
  });

  test('addProperty and addConstructorParameter for DI', () => {
    factory.addProperty({
      name: 'teamService',
      type: 'BaseEntityService<any>',
      scope: Scope.Private,
      isReadonly: true,
      decorators: [ { name: 'InjectEntityService', args: [ "'team'" ] } ],
    });
    factory.addConstructorParameter({
      name: 'teamService',
      type: 'BaseEntityService<any>',
      scope: Scope.Private,
      isReadonly: true,
      decorators: [ { name: 'InjectEntityService', args: [ "'team'" ] } ],
    });

    const controllerClass = factory.getClassDeclarationRef();
    const prop = controllerClass.getProperty('teamService');
    expect(prop).toBeDefined();

    const ctor = controllerClass.getConstructors()[ 0 ];
    const param = ctor.getParameter('teamService');
    expect(param).toBeDefined();
  });

  test('setConfig merges new configuration into the @Controller decorator', () => {
    factory.setConfig({ requireApiKey: true, authorizer: { type: 'AWS_IAM' } });

    const decorator = factory.getDecorator('Controller');
    expect(decorator).toBeDefined();

    const configArg = decorator!.getArguments()[ 1 ] as ObjectLiteralExpression;
    expect(configArg).toBeDefined();
    expect(configArg.getProperty('resourceAccess')).toBeDefined();
    const requireApiKeyProp = configArg.getProperty('requireApiKey');
    expect(requireApiKeyProp?.asKind(SyntaxKind.PropertyAssignment)?.getInitializer()?.getText()).toBe('true');
    const authorizerProp = configArg.getProperty('authorizer')?.asKind(SyntaxKind.PropertyAssignment);
    const authorizerValue = authorizerProp?.getInitializer()?.asKind(SyntaxKind.ObjectLiteralExpression);
    expect(authorizerValue?.getProperty('type')?.asKind(SyntaxKind.PropertyAssignment)?.getInitializer()?.getText()).toBe("'AWS_IAM'");
  });

  test('patchDecoratorArgsOnMethod updates decorator args on a method', () => {
    factory.patchDecoratorArgsOnMethod('hello', 'Post', [ "'/hi'" ]);

    const method = factory.getMethod('hello');
    const decorator = method?.getDecorator('Post');
    expect(decorator?.getArguments().map(a => a.getText())).toEqual([ "'/hi'" ]);
  });

  test('addMethodFromSource adds external method and its imports correctly', () => {
    factory.addMethodFromSource(extraTemplatePath, 'ping');

    const method = factory.getMethod('ping');
    expect(method).toBeDefined();
    const getImport = factory.getImportDeclaration(imp => imp.getModuleSpecifierValue().includes('fw24'));
    const namedImports = getImport?.getNamedImports().map(ni => ni.getName());
    expect(namedImports).toContain('Get');
  });

  test('addEndpoint adds a new method and merges imports', () => {
    factory.addEndpoint({
      httpMethod: 'Delete',
      path: '/items/:id',
      methodName: 'deleteItem'
    });

    const method = factory.getMethod('deleteItem');
    expect(method).toBeDefined();
    const returnTypeText = method?.getReturnType().getText(method);
    expect(returnTypeText?.endsWith('Promise<Response>')).toBe(true);

    const decorator = method?.getDecorator('Delete');
    expect(decorator).toBeDefined();
    expect(decorator?.getArguments()[ 0 ].getText()).toBe("'/items/:id'");

    const getImport = factory.getImportDeclaration(imp => imp.getModuleSpecifierValue().includes('fw24'));
    const namedImports = getImport?.getNamedImports().map(ni => ni.getName());
    expect(namedImports).toContain('Delete');
  });
});