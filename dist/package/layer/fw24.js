"use strict";
/**
 * FW24 Lambda Layer Entry Point
 *
 * This file is the entry point for the fw24 Lambda layer.
 * When imported, it automatically loads entry packages (DI layers).
 * This ensures ALL Lambdas have DI initialized, not just those with decorators.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS - All fw24 runtime modules
// ═══════════════════════════════════════════════════════════════════════════
__exportStar(require("./../interfaces"), exports);
__exportStar(require("./../decorators"), exports);
// It is important to make sure that we only include the things needed by the fw24-runtime
__exportStar(require("./../core/runtime"), exports);
__exportStar(require("./../core/types"), exports);
__exportStar(require("./../entity"), exports);
__exportStar(require("./../logging"), exports);
__exportStar(require("./../client"), exports);
__exportStar(require("./../validation"), exports);
__exportStar(require("./../utils"), exports);
__exportStar(require("./../di"), exports);
__exportStar(require("../const/"), exports);
__exportStar(require("../errors"), exports);
__exportStar(require("../search"), exports);
__exportStar(require("../audit"), exports);
__exportStar(require("../observability"), exports);
// ═══════════════════════════════════════════════════════════════════════════
// AUTO-INITIALIZATION
// 
// Automatically load entry packages when fw24 layer is imported.
// This ensures custom Lambdas (not using decorators) also have DI initialized.
// ═══════════════════════════════════════════════════════════════════════════
const decorator_utils_1 = require("../decorators/decorator-utils");
// Load entry packages on import
(0, decorator_utils_1.tryImportingEntryPackagesFor)('fw24-layer');
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZncyNC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9sYXllci9mdzI0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7O0dBTUc7Ozs7Ozs7Ozs7Ozs7Ozs7QUFFSCw4RUFBOEU7QUFDOUUscUNBQXFDO0FBQ3JDLDhFQUE4RTtBQUU5RSxrREFBZ0M7QUFDaEMsa0RBQWdDO0FBQ2hDLDBGQUEwRjtBQUMxRixvREFBa0M7QUFDbEMsa0RBQWdDO0FBQ2hDLDhDQUE0QjtBQUM1QiwrQ0FBNkI7QUFDN0IsOENBQTRCO0FBQzVCLGtEQUFnQztBQUNoQyw2Q0FBMkI7QUFDM0IsMENBQXdCO0FBQ3hCLDRDQUEwQjtBQUMxQiw0Q0FBMEI7QUFDMUIsNENBQTBCO0FBQzFCLDJDQUF5QjtBQUN6QixtREFBaUM7QUFFakMsOEVBQThFO0FBQzlFLHNCQUFzQjtBQUN0QixHQUFHO0FBQ0gsaUVBQWlFO0FBQ2pFLCtFQUErRTtBQUMvRSw4RUFBOEU7QUFFOUUsbUVBQTZFO0FBRTdFLGdDQUFnQztBQUNoQyxJQUFBLDhDQUE0QixFQUFDLFlBQVksQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBGVzI0IExhbWJkYSBMYXllciBFbnRyeSBQb2ludFxuICogXG4gKiBUaGlzIGZpbGUgaXMgdGhlIGVudHJ5IHBvaW50IGZvciB0aGUgZncyNCBMYW1iZGEgbGF5ZXIuXG4gKiBXaGVuIGltcG9ydGVkLCBpdCBhdXRvbWF0aWNhbGx5IGxvYWRzIGVudHJ5IHBhY2thZ2VzIChESSBsYXllcnMpLlxuICogVGhpcyBlbnN1cmVzIEFMTCBMYW1iZGFzIGhhdmUgREkgaW5pdGlhbGl6ZWQsIG5vdCBqdXN0IHRob3NlIHdpdGggZGVjb3JhdG9ycy5cbiAqL1xuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbi8vIEVYUE9SVFMgLSBBbGwgZncyNCBydW50aW1lIG1vZHVsZXNcbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG5leHBvcnQgKiBmcm9tIFwiLi8uLi9pbnRlcmZhY2VzXCI7XG5leHBvcnQgKiBmcm9tIFwiLi8uLi9kZWNvcmF0b3JzXCI7XG4vLyBJdCBpcyBpbXBvcnRhbnQgdG8gbWFrZSBzdXJlIHRoYXQgd2Ugb25seSBpbmNsdWRlIHRoZSB0aGluZ3MgbmVlZGVkIGJ5IHRoZSBmdzI0LXJ1bnRpbWVcbmV4cG9ydCAqIGZyb20gXCIuLy4uL2NvcmUvcnVudGltZVwiO1xuZXhwb3J0ICogZnJvbSAnLi8uLi9jb3JlL3R5cGVzJztcbmV4cG9ydCAqIGZyb20gJy4vLi4vZW50aXR5JztcbmV4cG9ydCAqIGZyb20gJy4vLi4vbG9nZ2luZyc7XG5leHBvcnQgKiBmcm9tICcuLy4uL2NsaWVudCc7XG5leHBvcnQgKiBmcm9tICcuLy4uL3ZhbGlkYXRpb24nO1xuZXhwb3J0ICogZnJvbSAnLi8uLi91dGlscyc7XG5leHBvcnQgKiBmcm9tICcuLy4uL2RpJztcbmV4cG9ydCAqIGZyb20gJy4uL2NvbnN0Lyc7XG5leHBvcnQgKiBmcm9tICcuLi9lcnJvcnMnO1xuZXhwb3J0ICogZnJvbSAnLi4vc2VhcmNoJztcbmV4cG9ydCAqIGZyb20gJy4uL2F1ZGl0JztcbmV4cG9ydCAqIGZyb20gJy4uL29ic2VydmFiaWxpdHknO1xuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbi8vIEFVVE8tSU5JVElBTElaQVRJT05cbi8vIFxuLy8gQXV0b21hdGljYWxseSBsb2FkIGVudHJ5IHBhY2thZ2VzIHdoZW4gZncyNCBsYXllciBpcyBpbXBvcnRlZC5cbi8vIFRoaXMgZW5zdXJlcyBjdXN0b20gTGFtYmRhcyAobm90IHVzaW5nIGRlY29yYXRvcnMpIGFsc28gaGF2ZSBESSBpbml0aWFsaXplZC5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG5pbXBvcnQgeyB0cnlJbXBvcnRpbmdFbnRyeVBhY2thZ2VzRm9yIH0gZnJvbSAnLi4vZGVjb3JhdG9ycy9kZWNvcmF0b3ItdXRpbHMnO1xuXG4vLyBMb2FkIGVudHJ5IHBhY2thZ2VzIG9uIGltcG9ydFxudHJ5SW1wb3J0aW5nRW50cnlQYWNrYWdlc0ZvcignZncyNC1sYXllcicpO1xuIl19