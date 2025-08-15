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
exports.Default = exports.Dummy = exports.EventDispatcher = void 0;
exports.EventDispatcher = __importStar(require("./"));
exports.Dummy = {
    dispatch: () => { return Promise.resolve(); },
};
exports.Default = {
    dispatch: async (options) => {
        console.log("Called default-event-dispatcher.dispatch()", options);
    }
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZXZlbnQvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsc0RBQXNDO0FBTXpCLFFBQUEsS0FBSyxHQUFxQjtJQUNuQyxRQUFRLEVBQUUsR0FBRyxFQUFFLEdBQUUsT0FBTyxPQUFPLENBQUMsT0FBTyxFQUFFLENBQUEsQ0FBQSxDQUFDO0NBQzdDLENBQUM7QUFFVyxRQUFBLE9BQU8sR0FBcUI7SUFDckMsUUFBUSxFQUFFLEtBQUssRUFBRSxPQUFZLEVBQUUsRUFBRTtRQUM3QixPQUFPLENBQUMsR0FBRyxDQUFDLDRDQUE0QyxFQUFFLE9BQU8sQ0FBQyxDQUFDO0lBQ3ZFLENBQUM7Q0FDSixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiZXhwb3J0ICogYXMgRXZlbnREaXNwYXRjaGVyIGZyb20gJy4vJztcblxuZXhwb3J0IGludGVyZmFjZSBJRXZlbnREaXNwYXRjaGVyIHtcbiAgZGlzcGF0Y2gob3B0aW9uczogYW55KTogUHJvbWlzZTx2b2lkPjtcbn1cblxuZXhwb3J0IGNvbnN0IER1bW15OiBJRXZlbnREaXNwYXRjaGVyID0ge1xuICAgIGRpc3BhdGNoOiAoKSA9PiB7cmV0dXJuIFByb21pc2UucmVzb2x2ZSgpfSxcbn07XG5cbmV4cG9ydCBjb25zdCBEZWZhdWx0OiBJRXZlbnREaXNwYXRjaGVyID0ge1xuICAgIGRpc3BhdGNoOiBhc3luYyAob3B0aW9uczogYW55KSA9PiB7XG4gICAgICAgIGNvbnNvbGUubG9nKFwiQ2FsbGVkIGRlZmF1bHQtZXZlbnQtZGlzcGF0Y2hlci5kaXNwYXRjaCgpXCIsIG9wdGlvbnMpO1xuICAgIH1cbn07Il19