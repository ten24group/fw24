import { EntityOperationConfig } from './base-entity';

export const ENTITY_OPERATION_KEY = Symbol('EntityOperation');

/**
 * Decorator to mark a service method as an entity operation.
 * These methods are automatically registered as API endpoints in the controller.
 *
 * @param config Optional configuration for the operation (path, method, label, etc.)
 */
export function EntityOperation(config: Partial<EntityOperationConfig> = {}) {
    return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
        const constructor = target.constructor;

        // Get existing operations or initialize empty object
        let operations: Record<string, EntityOperationConfig> = Reflect.get(constructor, ENTITY_OPERATION_KEY) || {};

        operations[propertyKey] = {
            enabled: true,
            // name: propertyKey,
            handler: propertyKey,
            ...config
        };

        // Store operations on the constructor
        Reflect.set(constructor, ENTITY_OPERATION_KEY, operations);
    };
}
