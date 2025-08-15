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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
// Export interfaces and types
__exportStar(require("./interfaces/error-handler.interface"), exports);
__exportStar(require("./interfaces/error-response.interface"), exports);
__exportStar(require("./http-status-code.enum"), exports);
// Export base error classes
__exportStar(require("./base/app-error"), exports);
__exportStar(require("./base/client-error"), exports);
__exportStar(require("./base/bad-request-error"), exports);
__exportStar(require("./base/server-error"), exports);
__exportStar(require("./base/framework-error"), exports);
__exportStar(require("./base/network-error"), exports);
__exportStar(require("./base/business-error"), exports);
// Export specific error classes
__exportStar(require("./client/unauthorized-error"), exports);
__exportStar(require("./client/forbidden-error"), exports);
__exportStar(require("./client/not-found-error"), exports);
__exportStar(require("./server/internal-server-error"), exports);
__exportStar(require("./server/validation-failed-error"), exports);
__exportStar(require("./server/invalid-http-request-validation-rule-error"), exports);
// Export entity-specific errors
__exportStar(require("../entity/errors"), exports);
// Export error handlers
__exportStar(require("./handlers/error-handler-service"), exports);
__exportStar(require("./handlers/index"), exports);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZXJyb3JzL2luZGV4LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSw4QkFBOEI7QUFDOUIsdUVBQXFEO0FBQ3JELHdFQUFzRDtBQUN0RCwwREFBd0M7QUFFeEMsNEJBQTRCO0FBQzVCLG1EQUFpQztBQUNqQyxzREFBb0M7QUFDcEMsMkRBQXlDO0FBQ3pDLHNEQUFvQztBQUNwQyx5REFBdUM7QUFDdkMsdURBQXFDO0FBQ3JDLHdEQUFzQztBQUV0QyxnQ0FBZ0M7QUFDaEMsOERBQTRDO0FBQzVDLDJEQUF5QztBQUN6QywyREFBeUM7QUFFekMsaUVBQStDO0FBQy9DLG1FQUFpRDtBQUNqRCxzRkFBb0U7QUFFcEUsZ0NBQWdDO0FBQ2hDLG1EQUFpQztBQUVqQyx3QkFBd0I7QUFDeEIsbUVBQWlEO0FBQ2pELG1EQUFpQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEV4cG9ydCBpbnRlcmZhY2VzIGFuZCB0eXBlc1xuZXhwb3J0ICogZnJvbSAnLi9pbnRlcmZhY2VzL2Vycm9yLWhhbmRsZXIuaW50ZXJmYWNlJztcbmV4cG9ydCAqIGZyb20gJy4vaW50ZXJmYWNlcy9lcnJvci1yZXNwb25zZS5pbnRlcmZhY2UnO1xuZXhwb3J0ICogZnJvbSAnLi9odHRwLXN0YXR1cy1jb2RlLmVudW0nO1xuXG4vLyBFeHBvcnQgYmFzZSBlcnJvciBjbGFzc2VzXG5leHBvcnQgKiBmcm9tICcuL2Jhc2UvYXBwLWVycm9yJztcbmV4cG9ydCAqIGZyb20gJy4vYmFzZS9jbGllbnQtZXJyb3InO1xuZXhwb3J0ICogZnJvbSAnLi9iYXNlL2JhZC1yZXF1ZXN0LWVycm9yJztcbmV4cG9ydCAqIGZyb20gJy4vYmFzZS9zZXJ2ZXItZXJyb3InO1xuZXhwb3J0ICogZnJvbSAnLi9iYXNlL2ZyYW1ld29yay1lcnJvcic7XG5leHBvcnQgKiBmcm9tICcuL2Jhc2UvbmV0d29yay1lcnJvcic7XG5leHBvcnQgKiBmcm9tICcuL2Jhc2UvYnVzaW5lc3MtZXJyb3InO1xuXG4vLyBFeHBvcnQgc3BlY2lmaWMgZXJyb3IgY2xhc3Nlc1xuZXhwb3J0ICogZnJvbSAnLi9jbGllbnQvdW5hdXRob3JpemVkLWVycm9yJztcbmV4cG9ydCAqIGZyb20gJy4vY2xpZW50L2ZvcmJpZGRlbi1lcnJvcic7XG5leHBvcnQgKiBmcm9tICcuL2NsaWVudC9ub3QtZm91bmQtZXJyb3InO1xuXG5leHBvcnQgKiBmcm9tICcuL3NlcnZlci9pbnRlcm5hbC1zZXJ2ZXItZXJyb3InO1xuZXhwb3J0ICogZnJvbSAnLi9zZXJ2ZXIvdmFsaWRhdGlvbi1mYWlsZWQtZXJyb3InO1xuZXhwb3J0ICogZnJvbSAnLi9zZXJ2ZXIvaW52YWxpZC1odHRwLXJlcXVlc3QtdmFsaWRhdGlvbi1ydWxlLWVycm9yJztcblxuLy8gRXhwb3J0IGVudGl0eS1zcGVjaWZpYyBlcnJvcnNcbmV4cG9ydCAqIGZyb20gJy4uL2VudGl0eS9lcnJvcnMnO1xuXG4vLyBFeHBvcnQgZXJyb3IgaGFuZGxlcnNcbmV4cG9ydCAqIGZyb20gJy4vaGFuZGxlcnMvZXJyb3ItaGFuZGxlci1zZXJ2aWNlJztcbmV4cG9ydCAqIGZyb20gJy4vaGFuZGxlcnMvaW5kZXgnOyJdfQ==