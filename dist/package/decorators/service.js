"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Service = Service;
require("reflect-metadata");
const tryRegisterInjectable_1 = require("./../di/utils/tryRegisterInjectable");
const metadata_keys_1 = require("../manifest/metadata-keys");
function Service(options = {}) {
    return (constructor) => {
        (0, tryRegisterInjectable_1.tryRegisterInjectable)(constructor, {
            ...options,
            type: 'service'
        });
        // Store comprehensive service metadata using reflect-metadata
        const serviceMetadata = {
            className: constructor.name,
            forEntity: typeof options.forEntity === 'string' ? options.forEntity : undefined,
            priority: options.priority || 0,
            providedIn: typeof options.providedIn === 'string' ? options.providedIn : options.providedIn?.constructor?.name || 'ROOT',
            tags: options.tags || [],
            kind: 'service'
        };
        Reflect.defineMetadata(metadata_keys_1.METADATA_KEYS.SERVICE, serviceMetadata, constructor);
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VydmljZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9kZWNvcmF0b3JzL3NlcnZpY2UudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFLQSwwQkFvQkM7QUF6QkQsNEJBQTBCO0FBRTFCLCtFQUFvRztBQUNwRyw2REFBZ0Y7QUFFaEYsU0FBZ0IsT0FBTyxDQUFDLFVBQTZCLEVBQUU7SUFDbkQsT0FBTyxDQUFDLFdBQXFCLEVBQUUsRUFBRTtRQUM3QixJQUFBLDZDQUFxQixFQUFDLFdBQStCLEVBQUU7WUFDbkQsR0FBRyxPQUFPO1lBQ1YsSUFBSSxFQUFFLFNBQVM7U0FDbEIsQ0FBQyxDQUFDO1FBRUgsOERBQThEO1FBQzlELE1BQU0sZUFBZSxHQUFvQjtZQUNyQyxTQUFTLEVBQUUsV0FBVyxDQUFDLElBQUk7WUFDM0IsU0FBUyxFQUFFLE9BQU8sT0FBTyxDQUFDLFNBQVMsS0FBSyxRQUFRLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLFNBQVM7WUFDaEYsUUFBUSxFQUFFLE9BQU8sQ0FBQyxRQUFRLElBQUksQ0FBQztZQUMvQixVQUFVLEVBQUUsT0FBTyxPQUFPLENBQUMsVUFBVSxLQUFLLFFBQVEsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLFVBQVUsRUFBRSxXQUFXLEVBQUUsSUFBSSxJQUFJLE1BQU07WUFDekgsSUFBSSxFQUFFLE9BQU8sQ0FBQyxJQUFJLElBQUksRUFBRTtZQUN4QixJQUFJLEVBQUUsU0FBUztTQUNsQixDQUFDO1FBRUYsT0FBTyxDQUFDLGNBQWMsQ0FBQyw2QkFBYSxDQUFDLE9BQU8sRUFBRSxlQUFlLEVBQUUsV0FBVyxDQUFDLENBQUM7SUFFaEYsQ0FBQyxDQUFDO0FBQ04sQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAncmVmbGVjdC1tZXRhZGF0YSc7XG5pbXBvcnQgdHlwZSB7IENsYXNzQ29uc3RydWN0b3IgfSBmcm9tICcuLy4uL2ludGVyZmFjZXMvZGknO1xuaW1wb3J0IHsgdHJ5UmVnaXN0ZXJJbmplY3RhYmxlLCB0eXBlIEluamVjdGFibGVPcHRpb25zIH0gZnJvbSAnLi8uLi9kaS91dGlscy90cnlSZWdpc3RlckluamVjdGFibGUnO1xuaW1wb3J0IHsgTUVUQURBVEFfS0VZUywgdHlwZSBTZXJ2aWNlTWV0YWRhdGEgfSBmcm9tICcuLi9tYW5pZmVzdC9tZXRhZGF0YS1rZXlzJztcblxuZXhwb3J0IGZ1bmN0aW9uIFNlcnZpY2Uob3B0aW9uczogSW5qZWN0YWJsZU9wdGlvbnMgPSB7fSApOiBDbGFzc0RlY29yYXRvciB7XG4gICAgcmV0dXJuIChjb25zdHJ1Y3RvcjogRnVuY3Rpb24pID0+IHtcbiAgICAgICAgdHJ5UmVnaXN0ZXJJbmplY3RhYmxlKGNvbnN0cnVjdG9yIGFzIENsYXNzQ29uc3RydWN0b3IsIHtcbiAgICAgICAgICAgIC4uLm9wdGlvbnMsIFxuICAgICAgICAgICAgdHlwZTogJ3NlcnZpY2UnXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIFN0b3JlIGNvbXByZWhlbnNpdmUgc2VydmljZSBtZXRhZGF0YSB1c2luZyByZWZsZWN0LW1ldGFkYXRhXG4gICAgICAgIGNvbnN0IHNlcnZpY2VNZXRhZGF0YTogU2VydmljZU1ldGFkYXRhID0ge1xuICAgICAgICAgICAgY2xhc3NOYW1lOiBjb25zdHJ1Y3Rvci5uYW1lLFxuICAgICAgICAgICAgZm9yRW50aXR5OiB0eXBlb2Ygb3B0aW9ucy5mb3JFbnRpdHkgPT09ICdzdHJpbmcnID8gb3B0aW9ucy5mb3JFbnRpdHkgOiB1bmRlZmluZWQsXG4gICAgICAgICAgICBwcmlvcml0eTogb3B0aW9ucy5wcmlvcml0eSB8fCAwLFxuICAgICAgICAgICAgcHJvdmlkZWRJbjogdHlwZW9mIG9wdGlvbnMucHJvdmlkZWRJbiA9PT0gJ3N0cmluZycgPyBvcHRpb25zLnByb3ZpZGVkSW4gOiBvcHRpb25zLnByb3ZpZGVkSW4/LmNvbnN0cnVjdG9yPy5uYW1lIHx8ICdST09UJyxcbiAgICAgICAgICAgIHRhZ3M6IG9wdGlvbnMudGFncyB8fCBbXSxcbiAgICAgICAgICAgIGtpbmQ6ICdzZXJ2aWNlJ1xuICAgICAgICB9O1xuXG4gICAgICAgIFJlZmxlY3QuZGVmaW5lTWV0YWRhdGEoTUVUQURBVEFfS0VZUy5TRVJWSUNFLCBzZXJ2aWNlTWV0YWRhdGEsIGNvbnN0cnVjdG9yKTtcbiAgICAgICAgXG4gICAgfTtcbn0iXX0=