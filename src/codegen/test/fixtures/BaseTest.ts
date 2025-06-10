// These are dummy decorators for testing purposes.
const ClassDecorator = (_config: any) => (_constructor: Function) => { };
const MethodDecorator = (_path: string) => (_target: any, _key: string) => { };

@ClassDecorator({ setting: 'initial' })
export class BaseTestClass {
  public myProperty: string = 'hello';

  constructor() {
    console.log('original constructor');
  }

  @MethodDecorator('path')
  public myMethod(arg: number): string {
    return `arg: ${arg}`;
  }
} 