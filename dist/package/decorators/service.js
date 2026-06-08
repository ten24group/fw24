"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Service = Service;
const tryRegisterInjectable_1 = require("./../di/utils/tryRegisterInjectable");
function Service(options = {}) {
    return (constructor) => {
        (0, tryRegisterInjectable_1.tryRegisterInjectable)(constructor, {
            ...options,
            type: 'service'
        });
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VydmljZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9kZWNvcmF0b3JzL3NlcnZpY2UudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFHQSwwQkFPQztBQVRELCtFQUFvRztBQUVwRyxTQUFnQixPQUFPLENBQUMsVUFBNkIsRUFBRTtJQUNuRCxPQUFPLENBQUMsV0FBcUIsRUFBRSxFQUFFO1FBQzdCLElBQUEsNkNBQXFCLEVBQUMsV0FBK0IsRUFBRTtZQUNuRCxHQUFHLE9BQU87WUFDVixJQUFJLEVBQUUsU0FBUztTQUNsQixDQUFDLENBQUM7SUFDUCxDQUFDLENBQUM7QUFDTixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUgeyBDbGFzc0NvbnN0cnVjdG9yIH0gZnJvbSAnLi8uLi9pbnRlcmZhY2VzL2RpJztcbmltcG9ydCB7IHRyeVJlZ2lzdGVySW5qZWN0YWJsZSwgdHlwZSBJbmplY3RhYmxlT3B0aW9ucyB9IGZyb20gJy4vLi4vZGkvdXRpbHMvdHJ5UmVnaXN0ZXJJbmplY3RhYmxlJztcblxuZXhwb3J0IGZ1bmN0aW9uIFNlcnZpY2Uob3B0aW9uczogSW5qZWN0YWJsZU9wdGlvbnMgPSB7fSApOiBDbGFzc0RlY29yYXRvciB7XG4gICAgcmV0dXJuIChjb25zdHJ1Y3RvcjogRnVuY3Rpb24pID0+IHtcbiAgICAgICAgdHJ5UmVnaXN0ZXJJbmplY3RhYmxlKGNvbnN0cnVjdG9yIGFzIENsYXNzQ29uc3RydWN0b3IsIHtcbiAgICAgICAgICAgIC4uLm9wdGlvbnMsIFxuICAgICAgICAgICAgdHlwZTogJ3NlcnZpY2UnXG4gICAgICAgIH0pO1xuICAgIH07XG59Il19