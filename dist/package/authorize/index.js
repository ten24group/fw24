"use strict";
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
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.Default = exports.Dummy = exports.Authorizer = void 0;
exports.Authorizer = __importStar(require("."));
exports.Dummy = {
    authorize: () => { return Promise.resolve({ pass: true }); },
};
exports.Default = {
    authorize: async (options) => {
        console.log("Called default authorizer.authorize()", options);
        return { pass: true };
    }
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYXV0aG9yaXplL2luZGV4LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLGdEQUFnQztBQVduQixRQUFBLEtBQUssR0FBZ0I7SUFDOUIsU0FBUyxFQUFFLEdBQUcsRUFBRSxHQUFHLE9BQU8sT0FBTyxDQUFDLE9BQU8sQ0FBQyxFQUFDLElBQUksRUFBQyxJQUFJLEVBQUMsQ0FBQyxDQUFBLENBQUMsQ0FBQztDQUMzRCxDQUFDO0FBR1csUUFBQSxPQUFPLEdBQWdCO0lBQ2hDLFNBQVMsRUFBRSxLQUFLLEVBQUUsT0FBWSxFQUFFLEVBQUU7UUFDOUIsT0FBTyxDQUFDLEdBQUcsQ0FBQyx1Q0FBdUMsRUFBRSxPQUFPLENBQUMsQ0FBQztRQUM5RCxPQUFPLEVBQUMsSUFBSSxFQUFFLElBQUksRUFBQyxDQUFDO0lBQ3hCLENBQUM7Q0FDSixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiZXhwb3J0ICogYXMgQXV0aG9yaXplciBmcm9tICcuJztcblxuZXhwb3J0IGludGVyZmFjZSBJQXV0aG9yaXplciB7XG4gICAgYXV0aG9yaXplIChvcHRpb25zOiBhbnkpOiBQcm9taXNlPElBdXRob3JpemVyUmVzcG9uc2U+O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIElBdXRob3JpemVyUmVzcG9uc2Uge1xuICAgIHBhc3M6IGJvb2xlYW47XG4gICAgZXJyb3JzPzoge1trZXk6c3RyaW5nXTogYW55fSBcbn1cblxuZXhwb3J0IGNvbnN0IER1bW15OiBJQXV0aG9yaXplciA9IHtcbiAgICBhdXRob3JpemU6ICgpID0+IHsgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh7cGFzczp0cnVlfSkgfSxcbn07XG5cblxuZXhwb3J0IGNvbnN0IERlZmF1bHQ6IElBdXRob3JpemVyID0ge1xuICAgIGF1dGhvcml6ZTogYXN5bmMgKG9wdGlvbnM6IGFueSkgPT4ge1xuICAgICAgICBjb25zb2xlLmxvZyhcIkNhbGxlZCBkZWZhdWx0IGF1dGhvcml6ZXIuYXV0aG9yaXplKClcIiwgb3B0aW9ucyk7XG4gICAgICAgIHJldHVybiB7cGFzczogdHJ1ZX07XG4gICAgfVxufTtcbiJdfQ==