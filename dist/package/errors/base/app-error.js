"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppError = void 0;
class AppError extends Error {
    statusCode;
    details;
    request;
    constructor(statusCode, message, details, request) {
        super(message);
        this.statusCode = statusCode;
        this.details = details;
        this.request = request;
        this.name = this.constructor.name;
    }
    createErrorResponse(statusCode, message, details, includeStack) {
        const response = {
            status: 'error',
            statusCode,
            message
        };
        if (details) {
            response.details = details;
        }
        if (includeStack) {
            response.stack = this.stack;
        }
        return response;
    }
}
exports.AppError = AppError;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwLWVycm9yLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2Vycm9ycy9iYXNlL2FwcC1lcnJvci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFJQSxNQUFzQixRQUFTLFNBQVEsS0FBSztJQUVwQjtJQUVBO0lBQ0E7SUFKcEIsWUFDb0IsVUFBa0IsRUFDbEMsT0FBZSxFQUNDLE9BQTZCLEVBQzdCLE9BQWlCO1FBRWpDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUxDLGVBQVUsR0FBVixVQUFVLENBQVE7UUFFbEIsWUFBTyxHQUFQLE9BQU8sQ0FBc0I7UUFDN0IsWUFBTyxHQUFQLE9BQU8sQ0FBVTtRQUdqQyxJQUFJLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDO0lBQ3RDLENBQUM7SUFJTSxtQkFBbUIsQ0FDdEIsVUFBa0IsRUFDbEIsT0FBZSxFQUNmLE9BQTZCLEVBQzdCLFlBQXNCO1FBRXRCLE1BQU0sUUFBUSxHQUFrQjtZQUM1QixNQUFNLEVBQUUsT0FBTztZQUNmLFVBQVU7WUFDVixPQUFPO1NBQ1YsQ0FBQztRQUVGLElBQUksT0FBTyxFQUFFLENBQUM7WUFDVixRQUFRLENBQUMsT0FBTyxHQUFHLE9BQU8sQ0FBQztRQUMvQixDQUFDO1FBRUQsSUFBSSxZQUFZLEVBQUUsQ0FBQztZQUNmLFFBQVEsQ0FBQyxLQUFLLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQztRQUNoQyxDQUFDO1FBRUQsT0FBTyxRQUFRLENBQUM7SUFDcEIsQ0FBQztDQUNKO0FBbkNELDRCQW1DQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFJlcXVlc3QgfSBmcm9tICcuLi8uLi9pbnRlcmZhY2VzL3JlcXVlc3QnO1xuaW1wb3J0IHsgRXJyb3JIYW5kbGVyQ29udGV4dCwgRXJyb3JIYW5kbGVyUmVzdWx0LCBJRXJyb3JIYW5kbGVyIH0gZnJvbSAnLi4vaW50ZXJmYWNlcy9lcnJvci1oYW5kbGVyLmludGVyZmFjZSc7XG5pbXBvcnQgeyBFcnJvclJlc3BvbnNlIH0gZnJvbSAnLi4vaW50ZXJmYWNlcy9lcnJvci1yZXNwb25zZS5pbnRlcmZhY2UnO1xuXG5leHBvcnQgYWJzdHJhY3QgY2xhc3MgQXBwRXJyb3IgZXh0ZW5kcyBFcnJvciBpbXBsZW1lbnRzIElFcnJvckhhbmRsZXIge1xuICAgIGNvbnN0cnVjdG9yKFxuICAgICAgICBwdWJsaWMgcmVhZG9ubHkgc3RhdHVzQ29kZTogbnVtYmVyLFxuICAgICAgICBtZXNzYWdlOiBzdHJpbmcsXG4gICAgICAgIHB1YmxpYyByZWFkb25seSBkZXRhaWxzPzogUmVjb3JkPHN0cmluZywgYW55PixcbiAgICAgICAgcHVibGljIHJlYWRvbmx5IHJlcXVlc3Q/OiBSZXF1ZXN0XG4gICAgKSB7XG4gICAgICAgIHN1cGVyKG1lc3NhZ2UpO1xuICAgICAgICB0aGlzLm5hbWUgPSB0aGlzLmNvbnN0cnVjdG9yLm5hbWU7XG4gICAgfVxuXG4gICAgYWJzdHJhY3QgaGFuZGxlKGNvbnRleHQ6IEVycm9ySGFuZGxlckNvbnRleHQpOiBFcnJvckhhbmRsZXJSZXN1bHQ7XG5cbiAgICBwdWJsaWMgY3JlYXRlRXJyb3JSZXNwb25zZShcbiAgICAgICAgc3RhdHVzQ29kZTogbnVtYmVyLFxuICAgICAgICBtZXNzYWdlOiBzdHJpbmcsXG4gICAgICAgIGRldGFpbHM/OiBSZWNvcmQ8c3RyaW5nLCBhbnk+LFxuICAgICAgICBpbmNsdWRlU3RhY2s/OiBib29sZWFuXG4gICAgKTogRXJyb3JSZXNwb25zZSB7XG4gICAgICAgIGNvbnN0IHJlc3BvbnNlOiBFcnJvclJlc3BvbnNlID0ge1xuICAgICAgICAgICAgc3RhdHVzOiAnZXJyb3InLFxuICAgICAgICAgICAgc3RhdHVzQ29kZSxcbiAgICAgICAgICAgIG1lc3NhZ2VcbiAgICAgICAgfTtcblxuICAgICAgICBpZiAoZGV0YWlscykge1xuICAgICAgICAgICAgcmVzcG9uc2UuZGV0YWlscyA9IGRldGFpbHM7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoaW5jbHVkZVN0YWNrKSB7XG4gICAgICAgICAgICByZXNwb25zZS5zdGFjayA9IHRoaXMuc3RhY2s7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gcmVzcG9uc2U7XG4gICAgfVxufSAiXX0=