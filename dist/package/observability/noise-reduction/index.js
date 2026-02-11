"use strict";
/**
 * Noise Reduction Module (v2: three-decision model)
 *
 * Intelligent noise reduction for observability events, reducing DynamoDB
 * record count while preserving critical information through structured
 * absorption into parent spans.
 *
 * ## Three-Decision Model
 *
 * | Decision  | DynamoDB Record? | Info Preserved?                          |
 * |-----------|------------------|------------------------------------------|
 * | `emit`    | Yes              | Full event                               |
 * | `absorb`  | No               | Structured summary in parent `data.absorbed` |
 * | `silent`  | No               | Counter on parent only                   |
 *
 * ## Algorithm
 *
 * 1. **Build**: Flat events → tree (parentObservabilityLogId linkage)
 * 2. **Evaluate**: Post-order DFS assigns decisions (rules + hard signals)
 * 3. **Collect**: Pre-order DFS builds output (resolved parents + absorbed data)
 *
 * The tree is NEVER mutated. Parent IDs in output are resolved to the nearest
 * EMITTED ancestor, ensuring correct hierarchy without reparenting.
 *
 * @module noise-reduction
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isHardSignal = exports.matchesRule = exports.clearBuiltinRulesCache = exports.getBuiltinRules = exports.getEffectivePriority = exports.HARD_SIGNAL_PRIORITY = exports.DECISION_BASE_PRIORITY = exports.evaluateNoiseRules = exports.buildAndEvaluate = exports.pickNoiseDecision = exports.applyNoiseReduction = void 0;
// ═══════════════════════════════════════════════════════════════════════════
// MAIN API
// ═══════════════════════════════════════════════════════════════════════════
var algorithm_1 = require("./algorithm");
Object.defineProperty(exports, "applyNoiseReduction", { enumerable: true, get: function () { return algorithm_1.applyNoiseReduction; } });
Object.defineProperty(exports, "pickNoiseDecision", { enumerable: true, get: function () { return algorithm_1.pickNoiseDecision; } });
Object.defineProperty(exports, "buildAndEvaluate", { enumerable: true, get: function () { return algorithm_1.buildAndEvaluate; } });
// ═══════════════════════════════════════════════════════════════════════════
// RULE EVALUATION
// ═══════════════════════════════════════════════════════════════════════════
var priority_1 = require("./priority");
Object.defineProperty(exports, "evaluateNoiseRules", { enumerable: true, get: function () { return priority_1.evaluateNoiseRules; } });
Object.defineProperty(exports, "DECISION_BASE_PRIORITY", { enumerable: true, get: function () { return priority_1.DECISION_BASE_PRIORITY; } });
Object.defineProperty(exports, "HARD_SIGNAL_PRIORITY", { enumerable: true, get: function () { return priority_1.HARD_SIGNAL_PRIORITY; } });
Object.defineProperty(exports, "getEffectivePriority", { enumerable: true, get: function () { return priority_1.getEffectivePriority; } });
// ═══════════════════════════════════════════════════════════════════════════
// RULE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════
var builtins_1 = require("./rules/builtins");
Object.defineProperty(exports, "getBuiltinRules", { enumerable: true, get: function () { return builtins_1.getBuiltinRules; } });
Object.defineProperty(exports, "clearBuiltinRulesCache", { enumerable: true, get: function () { return builtins_1.clearBuiltinRulesCache; } });
var matcher_1 = require("./rules/matcher");
Object.defineProperty(exports, "matchesRule", { enumerable: true, get: function () { return matcher_1.matchesRule; } });
// ═══════════════════════════════════════════════════════════════════════════
// HARD SIGNALS
// ═══════════════════════════════════════════════════════════════════════════
var hard_signals_1 = require("./hard-signals");
Object.defineProperty(exports, "isHardSignal", { enumerable: true, get: function () { return hard_signals_1.isHardSignal; } });
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9ub2lzZS1yZWR1Y3Rpb24vaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBeUJHOzs7QUFFSCw4RUFBOEU7QUFDOUUsV0FBVztBQUNYLDhFQUE4RTtBQUU5RSx5Q0FBdUY7QUFBOUUsZ0hBQUEsbUJBQW1CLE9BQUE7QUFBRSw4R0FBQSxpQkFBaUIsT0FBQTtBQUFFLDZHQUFBLGdCQUFnQixPQUFBO0FBcUJqRSw4RUFBOEU7QUFDOUUsa0JBQWtCO0FBQ2xCLDhFQUE4RTtBQUU5RSx1Q0FPb0I7QUFObEIsOEdBQUEsa0JBQWtCLE9BQUE7QUFDbEIsa0hBQUEsc0JBQXNCLE9BQUE7QUFDdEIsZ0hBQUEsb0JBQW9CLE9BQUE7QUFDcEIsZ0hBQUEsb0JBQW9CLE9BQUE7QUFLdEIsOEVBQThFO0FBQzlFLGtCQUFrQjtBQUNsQiw4RUFBOEU7QUFFOUUsNkNBQTJFO0FBQWxFLDJHQUFBLGVBQWUsT0FBQTtBQUFFLGtIQUFBLHNCQUFzQixPQUFBO0FBQ2hELDJDQUE4QztBQUFyQyxzR0FBQSxXQUFXLE9BQUE7QUFFcEIsOEVBQThFO0FBQzlFLGVBQWU7QUFDZiw4RUFBOEU7QUFFOUUsK0NBQThDO0FBQXJDLDRHQUFBLFlBQVksT0FBQSIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogTm9pc2UgUmVkdWN0aW9uIE1vZHVsZSAodjI6IHRocmVlLWRlY2lzaW9uIG1vZGVsKVxuICogXG4gKiBJbnRlbGxpZ2VudCBub2lzZSByZWR1Y3Rpb24gZm9yIG9ic2VydmFiaWxpdHkgZXZlbnRzLCByZWR1Y2luZyBEeW5hbW9EQlxuICogcmVjb3JkIGNvdW50IHdoaWxlIHByZXNlcnZpbmcgY3JpdGljYWwgaW5mb3JtYXRpb24gdGhyb3VnaCBzdHJ1Y3R1cmVkXG4gKiBhYnNvcnB0aW9uIGludG8gcGFyZW50IHNwYW5zLlxuICogXG4gKiAjIyBUaHJlZS1EZWNpc2lvbiBNb2RlbFxuICogXG4gKiB8IERlY2lzaW9uICB8IER5bmFtb0RCIFJlY29yZD8gfCBJbmZvIFByZXNlcnZlZD8gICAgICAgICAgICAgICAgICAgICAgICAgIHxcbiAqIHwtLS0tLS0tLS0tLXwtLS0tLS0tLS0tLS0tLS0tLS18LS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tfFxuICogfCBgZW1pdGAgICAgfCBZZXMgICAgICAgICAgICAgIHwgRnVsbCBldmVudCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB8XG4gKiB8IGBhYnNvcmJgICB8IE5vICAgICAgICAgICAgICAgfCBTdHJ1Y3R1cmVkIHN1bW1hcnkgaW4gcGFyZW50IGBkYXRhLmFic29yYmVkYCB8XG4gKiB8IGBzaWxlbnRgICB8IE5vICAgICAgICAgICAgICAgfCBDb3VudGVyIG9uIHBhcmVudCBvbmx5ICAgICAgICAgICAgICAgICAgIHxcbiAqIFxuICogIyMgQWxnb3JpdGhtXG4gKiBcbiAqIDEuICoqQnVpbGQqKjogRmxhdCBldmVudHMg4oaSIHRyZWUgKHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCBsaW5rYWdlKVxuICogMi4gKipFdmFsdWF0ZSoqOiBQb3N0LW9yZGVyIERGUyBhc3NpZ25zIGRlY2lzaW9ucyAocnVsZXMgKyBoYXJkIHNpZ25hbHMpXG4gKiAzLiAqKkNvbGxlY3QqKjogUHJlLW9yZGVyIERGUyBidWlsZHMgb3V0cHV0IChyZXNvbHZlZCBwYXJlbnRzICsgYWJzb3JiZWQgZGF0YSlcbiAqIFxuICogVGhlIHRyZWUgaXMgTkVWRVIgbXV0YXRlZC4gUGFyZW50IElEcyBpbiBvdXRwdXQgYXJlIHJlc29sdmVkIHRvIHRoZSBuZWFyZXN0XG4gKiBFTUlUVEVEIGFuY2VzdG9yLCBlbnN1cmluZyBjb3JyZWN0IGhpZXJhcmNoeSB3aXRob3V0IHJlcGFyZW50aW5nLlxuICogXG4gKiBAbW9kdWxlIG5vaXNlLXJlZHVjdGlvblxuICovXG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gTUFJTiBBUElcbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG5leHBvcnQgeyBhcHBseU5vaXNlUmVkdWN0aW9uLCBwaWNrTm9pc2VEZWNpc2lvbiwgYnVpbGRBbmRFdmFsdWF0ZSB9IGZyb20gJy4vYWxnb3JpdGhtJztcblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyBUWVBFU1xuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbmV4cG9ydCB0eXBlIHtcbiAgTm9pc2VEZWNpc2lvbixcbiAgQWJzb3JiZWREYXRhLFxuICBBYnNvcmJlZEVycm9yLFxuICBPcGVyYXRpb25TdGF0cyxcbiAgRHVyYXRpb25TdGF0cyxcbiAgVHJlZU5vZGUsXG4gIE5vZGVEZWNpc2lvbixcbiAgRW1pdHRlZEV2ZW50LFxuICBOb2lzZVJlZHVjdGlvblJlc3VsdCxcbiAgTm9pc2VSZWR1Y3Rpb25TdGF0cyxcbiAgTm9pc2VEZWJ1Z0luZm8sXG4gIEFic29ycHRpb25Cb3VuZHMsXG59IGZyb20gJy4vdHlwZXMnO1xuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbi8vIFJVTEUgRVZBTFVBVElPTlxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbmV4cG9ydCB7XG4gIGV2YWx1YXRlTm9pc2VSdWxlcyxcbiAgREVDSVNJT05fQkFTRV9QUklPUklUWSxcbiAgSEFSRF9TSUdOQUxfUFJJT1JJVFksXG4gIGdldEVmZmVjdGl2ZVByaW9yaXR5LFxuICB0eXBlIE5vaXNlRXZhbHVhdGlvblJlc3VsdCxcbiAgdHlwZSBSdWxlTWF0Y2hGbixcbn0gZnJvbSAnLi9wcmlvcml0eSc7XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gUlVMRSBNQU5BR0VNRU5UXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuZXhwb3J0IHsgZ2V0QnVpbHRpblJ1bGVzLCBjbGVhckJ1aWx0aW5SdWxlc0NhY2hlIH0gZnJvbSAnLi9ydWxlcy9idWlsdGlucyc7XG5leHBvcnQgeyBtYXRjaGVzUnVsZSB9IGZyb20gJy4vcnVsZXMvbWF0Y2hlcic7XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gSEFSRCBTSUdOQUxTXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuZXhwb3J0IHsgaXNIYXJkU2lnbmFsIH0gZnJvbSAnLi9oYXJkLXNpZ25hbHMnO1xuIl19