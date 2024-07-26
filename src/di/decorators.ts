import { registry, Token } from './di-registry';
import { DEPENDENCIES_KEY, INJECT_KEY, INJECTABLE_KEY, ON_INIT_KEY } from './const';
import { createToken } from './utils';

export function Injectable(options: { singleton?: boolean, name?: string } = {}): ClassDecorator {
    return (target: any) => {
        const token = createToken(options.name || target.name);
        registry.defineMetadata({
            key: INJECTABLE_KEY, 
            value: true, 
            target
        });
        registry.register(token, { useClass: target as unknown as new (...args: any[]) => any, singleton: options.singleton, name: options.name });
    };
}


export function Inject<T>(depNameOrToken: string | Token<T>, name?: string): PropertyDecorator & ParameterDecorator {

    if(typeof depNameOrToken === 'string') {
        return Inject(createToken(depNameOrToken), name);
    }
    
    const token = depNameOrToken;

    return (target: Object, propertyKey: string | symbol | undefined, parameterIndex?: number) => {
        
        if (typeof parameterIndex === 'number') {
            const existingDependencies = registry.getMetadata({
                key: INJECT_KEY,
                target
            }) || {};

            existingDependencies[parameterIndex] = { token, name };
            registry.defineMetadata({
                key: INJECT_KEY, 
                value: existingDependencies, 
                target
            });
        } else if (propertyKey !== undefined) {
            const existingDependencies = registry.getMetadata({
                key: DEPENDENCIES_KEY, 
                target
            }) || [];
            existingDependencies.push({ token, name, propertyKey });
            registry.defineMetadata({
                key: DEPENDENCIES_KEY, 
                value: existingDependencies, 
                target
            });
        }
    };
}

export function Conditional(condition: () => boolean): ClassDecorator {
    return (target: any) => {
        let options = registry.getMetadata({
            key: INJECTABLE_KEY, 
            target
        }) || {};
        if (typeof options !== 'object') {
            options = {};
        }
        options.condition = condition;
        const token = createToken(options.name || target.name);
        registry.register(token, { ...options, useClass: target as unknown as new (...args: any[]) => any });
    };
}

export function OnInit(): MethodDecorator {
    return (target, propertyKey) => {
        registry.defineMetadata({
            key: ON_INIT_KEY, 
            value: propertyKey, 
            target
        });
    };
}
