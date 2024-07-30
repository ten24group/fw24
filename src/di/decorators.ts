import { PROPERTY_INJECT_METADATA_KEY, CONSTRUCTOR_INJECT_METADATA_KEY, ON_INIT_HOOK_METADATA_KEY } from './const';
import { makeDIToken } from './utils';
import { BaseProviderOptions, DepIdentifier, InjectOptions, ParameterInjectMetadata, PropertyInjectMetadata, Token } from './types';
import { DIContainer } from './di-container';

export function Injectable(options: BaseProviderOptions = {}, container: DIContainer = DIContainer.INSTANCE): ClassDecorator {
    return (target: any) => {

        container.register({
            ...options,
            useClass: target,
            name: options.name || target.name,
        });
    };
}

export function Inject<T>(depNameOrToken: DepIdentifier<T>, options: InjectOptions<T> = {}, container: DIContainer = DIContainer.INSTANCE): PropertyDecorator & ParameterDecorator {

    return (target: Object, propertyKey: string | symbol | undefined, parameterIndex?: number) => {
        
        if (typeof parameterIndex === 'number') {

            container.registerConstructorDependency(target, parameterIndex, depNameOrToken, { ...options });

        } else if (propertyKey !== undefined) {

            container.registerPropertyDependency(target, propertyKey, depNameOrToken, { ...options });
        }
    };
}

export function OnInit( container: DIContainer = DIContainer.INSTANCE ): MethodDecorator {
    return (target, propertyKey) => {
        container.registerOnInitHook(target, propertyKey);
    };
}
