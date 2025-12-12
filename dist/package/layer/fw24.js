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
// ═══════════════════════════════════════════════════════════════════════════
// AUTO-INITIALIZATION
// 
// Automatically load entry packages when fw24 layer is imported.
// This ensures custom Lambdas (not using decorators) also have DI initialized.
// ═══════════════════════════════════════════════════════════════════════════
const decorator_utils_1 = require("../decorators/decorator-utils");
// Load entry packages on import
(0, decorator_utils_1.tryImportingEntryPackagesFor)('fw24-layer');
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZncyNC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9sYXllci9mdzI0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7O0dBTUc7Ozs7Ozs7Ozs7Ozs7Ozs7QUFFSCw4RUFBOEU7QUFDOUUscUNBQXFDO0FBQ3JDLDhFQUE4RTtBQUU5RSxrREFBZ0M7QUFDaEMsa0RBQWdDO0FBQ2hDLDBGQUEwRjtBQUMxRixvREFBa0M7QUFDbEMsOENBQTRCO0FBQzVCLCtDQUE2QjtBQUM3Qiw4Q0FBNEI7QUFDNUIsa0RBQWdDO0FBQ2hDLDZDQUEyQjtBQUMzQiwwQ0FBd0I7QUFDeEIsNENBQTBCO0FBQzFCLDRDQUEwQjtBQUMxQiw0Q0FBMEI7QUFDMUIsMkNBQXlCO0FBRXpCLDhFQUE4RTtBQUM5RSxzQkFBc0I7QUFDdEIsR0FBRztBQUNILGlFQUFpRTtBQUNqRSwrRUFBK0U7QUFDL0UsOEVBQThFO0FBRTlFLG1FQUE2RTtBQUU3RSxnQ0FBZ0M7QUFDaEMsSUFBQSw4Q0FBNEIsRUFBQyxZQUFZLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogRlcyNCBMYW1iZGEgTGF5ZXIgRW50cnkgUG9pbnRcbiAqIFxuICogVGhpcyBmaWxlIGlzIHRoZSBlbnRyeSBwb2ludCBmb3IgdGhlIGZ3MjQgTGFtYmRhIGxheWVyLlxuICogV2hlbiBpbXBvcnRlZCwgaXQgYXV0b21hdGljYWxseSBsb2FkcyBlbnRyeSBwYWNrYWdlcyAoREkgbGF5ZXJzKS5cbiAqIFRoaXMgZW5zdXJlcyBBTEwgTGFtYmRhcyBoYXZlIERJIGluaXRpYWxpemVkLCBub3QganVzdCB0aG9zZSB3aXRoIGRlY29yYXRvcnMuXG4gKi9cblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyBFWFBPUlRTIC0gQWxsIGZ3MjQgcnVudGltZSBtb2R1bGVzXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuZXhwb3J0ICogZnJvbSBcIi4vLi4vaW50ZXJmYWNlc1wiO1xuZXhwb3J0ICogZnJvbSBcIi4vLi4vZGVjb3JhdG9yc1wiO1xuLy8gSXQgaXMgaW1wb3J0YW50IHRvIG1ha2Ugc3VyZSB0aGF0IHdlIG9ubHkgaW5jbHVkZSB0aGUgdGhpbmdzIG5lZWRlZCBieSB0aGUgZncyNC1ydW50aW1lXG5leHBvcnQgKiBmcm9tIFwiLi8uLi9jb3JlL3J1bnRpbWVcIjtcbmV4cG9ydCAqIGZyb20gJy4vLi4vZW50aXR5JztcbmV4cG9ydCAqIGZyb20gJy4vLi4vbG9nZ2luZyc7XG5leHBvcnQgKiBmcm9tICcuLy4uL2NsaWVudCc7XG5leHBvcnQgKiBmcm9tICcuLy4uL3ZhbGlkYXRpb24nO1xuZXhwb3J0ICogZnJvbSAnLi8uLi91dGlscyc7XG5leHBvcnQgKiBmcm9tICcuLy4uL2RpJztcbmV4cG9ydCAqIGZyb20gJy4uL2NvbnN0Lyc7XG5leHBvcnQgKiBmcm9tICcuLi9lcnJvcnMnO1xuZXhwb3J0ICogZnJvbSAnLi4vc2VhcmNoJztcbmV4cG9ydCAqIGZyb20gJy4uL2F1ZGl0JztcblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyBBVVRPLUlOSVRJQUxJWkFUSU9OXG4vLyBcbi8vIEF1dG9tYXRpY2FsbHkgbG9hZCBlbnRyeSBwYWNrYWdlcyB3aGVuIGZ3MjQgbGF5ZXIgaXMgaW1wb3J0ZWQuXG4vLyBUaGlzIGVuc3VyZXMgY3VzdG9tIExhbWJkYXMgKG5vdCB1c2luZyBkZWNvcmF0b3JzKSBhbHNvIGhhdmUgREkgaW5pdGlhbGl6ZWQuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuaW1wb3J0IHsgdHJ5SW1wb3J0aW5nRW50cnlQYWNrYWdlc0ZvciB9IGZyb20gJy4uL2RlY29yYXRvcnMvZGVjb3JhdG9yLXV0aWxzJztcblxuLy8gTG9hZCBlbnRyeSBwYWNrYWdlcyBvbiBpbXBvcnRcbnRyeUltcG9ydGluZ0VudHJ5UGFja2FnZXNGb3IoJ2Z3MjQtbGF5ZXInKTtcbiJdfQ==