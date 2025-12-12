"use strict";
/**
 * Storage Layer
 *
 * Entity schema and service for observability data.
 * Apps extend BaseEntityController<ObservabilityLogSchema> directly for admin UIs.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ObservabilityLogService = exports.ObservabilityLogEntitySchema = void 0;
var observability_log_entity_1 = require("./observability-log-entity");
Object.defineProperty(exports, "ObservabilityLogEntitySchema", { enumerable: true, get: function () { return observability_log_entity_1.ObservabilityLogEntitySchema; } });
var service_1 = require("./service");
Object.defineProperty(exports, "ObservabilityLogService", { enumerable: true, get: function () { return service_1.ObservabilityLogService; } });
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9zdG9yYWdlL2luZGV4LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7R0FLRzs7O0FBRUgsdUVBR29DO0FBRmxDLHdJQUFBLDRCQUE0QixPQUFBO0FBSTlCLHFDQUttQjtBQUpqQixrSEFBQSx1QkFBdUIsT0FBQSIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogU3RvcmFnZSBMYXllclxuICogXG4gKiBFbnRpdHkgc2NoZW1hIGFuZCBzZXJ2aWNlIGZvciBvYnNlcnZhYmlsaXR5IGRhdGEuXG4gKiBBcHBzIGV4dGVuZCBCYXNlRW50aXR5Q29udHJvbGxlcjxPYnNlcnZhYmlsaXR5TG9nU2NoZW1hPiBkaXJlY3RseSBmb3IgYWRtaW4gVUlzLlxuICovXG5cbmV4cG9ydCB7IFxuICBPYnNlcnZhYmlsaXR5TG9nRW50aXR5U2NoZW1hLCBcbiAgT2JzZXJ2YWJpbGl0eUxvZ1NjaGVtYSxcbn0gZnJvbSAnLi9vYnNlcnZhYmlsaXR5LWxvZy1lbnRpdHknO1xuXG5leHBvcnQgeyBcbiAgT2JzZXJ2YWJpbGl0eUxvZ1NlcnZpY2UsXG4gIFJlY29uc3RydWN0ZWRTcGFuLFxuICBMb2dSZWNvcmQsXG4gIE9ic2VydmFiaWxpdHlMb2dDcmVhdGVJdGVtLFxufSBmcm9tICcuL3NlcnZpY2UnO1xuIl19