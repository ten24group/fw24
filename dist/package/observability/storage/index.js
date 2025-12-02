"use strict";
/**
 * Storage Layer
 *
 * Entity schema and service for observability data.
 * Service is self-contained - creates its own DynamoDB client.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ObservabilityLogService = exports.getTtlDays = exports.ObservabilityLogEntitySchema = void 0;
var log_entity_1 = require("./log-entity");
Object.defineProperty(exports, "ObservabilityLogEntitySchema", { enumerable: true, get: function () { return log_entity_1.ObservabilityLogEntitySchema; } });
Object.defineProperty(exports, "getTtlDays", { enumerable: true, get: function () { return log_entity_1.getTtlDays; } });
var service_1 = require("./service");
Object.defineProperty(exports, "ObservabilityLogService", { enumerable: true, get: function () { return service_1.ObservabilityLogService; } });
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9zdG9yYWdlL2luZGV4LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7R0FLRzs7O0FBRUgsMkNBSXNCO0FBSHBCLDBIQUFBLDRCQUE0QixPQUFBO0FBRTVCLHdHQUFBLFVBQVUsT0FBQTtBQUdaLHFDQUltQjtBQUhqQixrSEFBQSx1QkFBdUIsT0FBQSIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogU3RvcmFnZSBMYXllclxuICogXG4gKiBFbnRpdHkgc2NoZW1hIGFuZCBzZXJ2aWNlIGZvciBvYnNlcnZhYmlsaXR5IGRhdGEuXG4gKiBTZXJ2aWNlIGlzIHNlbGYtY29udGFpbmVkIC0gY3JlYXRlcyBpdHMgb3duIER5bmFtb0RCIGNsaWVudC5cbiAqL1xuXG5leHBvcnQgeyBcbiAgT2JzZXJ2YWJpbGl0eUxvZ0VudGl0eVNjaGVtYSwgXG4gIE9ic2VydmFiaWxpdHlMb2dTY2hlbWEsXG4gIGdldFR0bERheXMsXG59IGZyb20gJy4vbG9nLWVudGl0eSc7XG5cbmV4cG9ydCB7IFxuICBPYnNlcnZhYmlsaXR5TG9nU2VydmljZSwgXG4gIFJlY29uc3RydWN0ZWRTcGFuLFxuICBMb2dSZWNvcmQsXG59IGZyb20gJy4vc2VydmljZSc7XG4iXX0=