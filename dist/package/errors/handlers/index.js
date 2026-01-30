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
exports.createErrorHandler = exports.errorHandlerService = void 0;
__exportStar(require("./error-handler-service"), exports);
const error_handler_service_1 = require("./error-handler-service");
// Create a singleton instance
exports.errorHandlerService = error_handler_service_1.ErrorHandlerService.getInstance();
// Create error handler middleware for controllers
const createErrorHandler = (options = {
    includeStack: false,
    logErrors: true,
    logRequestDetails: true
}) => {
    return (error, req, res) => {
        const context = { error, request: req, response: res, options };
        const result = exports.errorHandlerService.handleError(context);
        return res.status(result.statusCode).json({ ...result.body });
    };
};
exports.createErrorHandler = createErrorHandler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZXJyb3JzL2hhbmRsZXJzL2luZGV4LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsMERBQXdDO0FBSXhDLG1FQUE4RDtBQUc5RCw4QkFBOEI7QUFDakIsUUFBQSxtQkFBbUIsR0FBRywyQ0FBbUIsQ0FBQyxXQUFXLEVBQUUsQ0FBQztBQUVyRSxrREFBa0Q7QUFDM0MsTUFBTSxrQkFBa0IsR0FBRyxDQUFDLFVBQStCO0lBQzlELFlBQVksRUFBRSxLQUFLO0lBQ25CLFNBQVMsRUFBRSxJQUFJO0lBQ2YsaUJBQWlCLEVBQUUsSUFBSTtDQUMxQixFQUFFLEVBQUU7SUFDRCxPQUFPLENBQUMsS0FBVSxFQUFFLEdBQVksRUFBRSxHQUFhLEVBQUUsRUFBRTtRQUUvQyxNQUFNLE9BQU8sR0FBd0IsRUFBRSxLQUFLLEVBQUUsT0FBTyxFQUFFLEdBQUcsRUFBRSxRQUFRLEVBQUUsR0FBRyxFQUFFLE9BQU8sRUFBRSxDQUFDO1FBRXJGLE1BQU0sTUFBTSxHQUFHLDJCQUFtQixDQUFDLFdBQVcsQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUV4RCxPQUFPLEdBQUcsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxDQUFDLElBQUksQ0FBQyxFQUFFLEdBQUcsTUFBTSxDQUFDLElBQUksRUFBRSxDQUFDLENBQUM7SUFDbEUsQ0FBQyxDQUFDO0FBQ04sQ0FBQyxDQUFDO0FBYlcsUUFBQSxrQkFBa0Isc0JBYTdCIiwic291cmNlc0NvbnRlbnQiOlsiZXhwb3J0ICogZnJvbSAnLi9lcnJvci1oYW5kbGVyLXNlcnZpY2UnO1xuXG5pbXBvcnQgeyBSZXF1ZXN0LCBSZXNwb25zZSB9IGZyb20gJy4uLy4uL2ludGVyZmFjZXMnO1xuaW1wb3J0IHsgRXJyb3JIYW5kbGVyT3B0aW9ucyB9IGZyb20gJy4vZXJyb3ItaGFuZGxlci1zZXJ2aWNlJztcbmltcG9ydCB7IEVycm9ySGFuZGxlclNlcnZpY2UgfSBmcm9tICcuL2Vycm9yLWhhbmRsZXItc2VydmljZSc7XG5pbXBvcnQgeyBFcnJvckhhbmRsZXJDb250ZXh0LCBFcnJvckhhbmRsZXJSZXN1bHQgfSBmcm9tICcuLi9pbnRlcmZhY2VzL2Vycm9yLWhhbmRsZXIuaW50ZXJmYWNlJztcblxuLy8gQ3JlYXRlIGEgc2luZ2xldG9uIGluc3RhbmNlXG5leHBvcnQgY29uc3QgZXJyb3JIYW5kbGVyU2VydmljZSA9IEVycm9ySGFuZGxlclNlcnZpY2UuZ2V0SW5zdGFuY2UoKTtcblxuLy8gQ3JlYXRlIGVycm9yIGhhbmRsZXIgbWlkZGxld2FyZSBmb3IgY29udHJvbGxlcnNcbmV4cG9ydCBjb25zdCBjcmVhdGVFcnJvckhhbmRsZXIgPSAob3B0aW9uczogRXJyb3JIYW5kbGVyT3B0aW9ucyA9IHtcbiAgICBpbmNsdWRlU3RhY2s6IGZhbHNlLFxuICAgIGxvZ0Vycm9yczogdHJ1ZSxcbiAgICBsb2dSZXF1ZXN0RGV0YWlsczogdHJ1ZVxufSkgPT4ge1xuICAgIHJldHVybiAoZXJyb3I6IGFueSwgcmVxOiBSZXF1ZXN0LCByZXM6IFJlc3BvbnNlKSA9PiB7XG5cbiAgICAgICAgY29uc3QgY29udGV4dDogRXJyb3JIYW5kbGVyQ29udGV4dCA9IHsgZXJyb3IsIHJlcXVlc3Q6IHJlcSwgcmVzcG9uc2U6IHJlcywgb3B0aW9ucyB9O1xuXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGVycm9ySGFuZGxlclNlcnZpY2UuaGFuZGxlRXJyb3IoY29udGV4dCk7XG5cbiAgICAgICAgcmV0dXJuIHJlcy5zdGF0dXMocmVzdWx0LnN0YXR1c0NvZGUpLmpzb24oeyAuLi5yZXN1bHQuYm9keSB9KTtcbiAgICB9O1xufTsiXX0=