import { Project, SourceFile } from "ts-morph";
import { EntityControllerFactory } from "../entity-controller-factory";
import path from 'path';

describe('EntityControllerFactory', () => {
  const fixturesDir = path.resolve(__dirname, 'fixtures');
  const simpleTemplatePath = path.resolve(fixturesDir, 'SimpleController.ts');

  let project: Project;
  let factory: EntityControllerFactory;
  let simpleControllerFile: SourceFile;

  beforeAll(() => {
    project = new Project();
    simpleControllerFile = project.addSourceFileAtPath(simpleTemplatePath);
  });

  beforeEach(() => {
    // Create a copy for each test to mutate
    const testFile = simpleControllerFile.copy('test-SimpleController.ts', { overwrite: true });
    factory = new EntityControllerFactory({
      project, // Reuse the same project
      templateText: testFile.getFullText(),
    });
  });

  it('should create an instance', () => {
    expect(factory).toBeDefined();
  });

  describe('Framework-Specific Helpers', () => {
    test('addEntityServiceInjection() adds DI for entity service', () => {
      factory.addEntityServiceInjection('User');

      const ctor = factory.getClassDeclarationRef().getConstructors()[ 0 ];
      const param = ctor.getParameter('userService');
      expect(param).toBeDefined();
      expect(param!.getTypeNode()?.getText()).toBe('UserService');

      const decorator = param!.getDecorator('InjectEntityService');
      expect(decorator).toBeDefined();

      // Check import was added
      const imports = factory.getSourceFileRef().getImportDeclarations();
      const fw24Import = imports.find(imp => imp.getModuleSpecifierValue().includes('fw24'));
      expect(fw24Import?.getNamedImports().some(ni => ni.getName() === 'InjectEntityService')).toBe(true);
    });

    test('addCrudMethods() adds full CRUD endpoints', () => {
      factory.addEntityServiceInjection('Product');
      factory.addCrudMethods('Product');

      // Check all CRUD methods were added
      expect(factory.getMethod('getAllProducts')).toBeDefined();
      expect(factory.getMethod('getProductById')).toBeDefined();
      expect(factory.getMethod('createProduct')).toBeDefined();
      expect(factory.getMethod('updateProduct')).toBeDefined();
      expect(factory.getMethod('deleteProduct')).toBeDefined();

      // Check decorators
      const getAll = factory.getMethod('getAllProducts');
      expect(getAll!.getDecorator('Get')).toBeDefined();

      const create = factory.getMethod('createProduct');
      expect(create!.getDecorator('Post')).toBeDefined();
    });

    test('addSearchMethod() adds search endpoint', () => {
      factory.addEntityServiceInjection('Article');
      factory.addSearchMethod('Article');

      const searchMethod = factory.getMethod('searchArticles');
      expect(searchMethod).toBeDefined();
      expect(searchMethod!.getDecorator('Get')).toBeDefined();
      expect(searchMethod!.getBodyText()).toContain('this.articleService.search');
    });

    test('addAuthenticationToMethod() adds auth decorator', () => {
      factory.addMethod({ name: 'protectedMethod', statements: 'return;' });
      factory.addAuthenticationToMethod('protectedMethod', 'jwt');

      const method = factory.getMethod('protectedMethod');
      const authDecorator = method!.getDecorator('Auth');
      expect(authDecorator).toBeDefined();
      expect(authDecorator!.getArguments()[ 0 ].getText()).toBe("'jwt'");
    });

    test('addValidationToMethod() adds validation decorator', () => {
      factory.addMethod({ name: 'validatedMethod', statements: 'return;' });
      factory.addValidationToMethod('validatedMethod', 'MySchema');

      const method = factory.getMethod('validatedMethod');
      const validateDecorator = method!.getDecorator('Validate');
      expect(validateDecorator).toBeDefined();
      expect(validateDecorator!.getArguments()[ 0 ].getText()).toBe('MySchema');
    });
  });
});