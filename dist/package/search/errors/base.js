"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SearchValidationError = exports.SearchError = void 0;
const errors_1 = require("../../errors");
const http_status_code_enum_1 = require("../../errors/http-status-code.enum");
/**
 * Base class for all search-related errors
 */
class SearchError extends errors_1.ServerError {
    constructor(message, details, request) {
        super(http_status_code_enum_1.HttpStatusCode.INTERNAL_SERVER_ERROR, message, details, request);
        this.name = 'SearchError';
    }
    handle(context) {
        return {
            statusCode: http_status_code_enum_1.HttpStatusCode.INTERNAL_SERVER_ERROR,
            body: this.createErrorResponse(http_status_code_enum_1.HttpStatusCode.INTERNAL_SERVER_ERROR, this.message, {
                code: 'SEARCH_ERROR',
                ...this.details
            }, context.options.includeStack)
        };
    }
}
exports.SearchError = SearchError;
/**
 * Base class for search validation errors
 */
class SearchValidationError extends errors_1.BadRequestError {
    constructor(message, details, request) {
        super(message, details, request);
        this.name = 'SearchValidationError';
    }
    handle(context) {
        return {
            statusCode: http_status_code_enum_1.HttpStatusCode.BAD_REQUEST,
            body: this.createErrorResponse(http_status_code_enum_1.HttpStatusCode.BAD_REQUEST, this.message, {
                code: 'SEARCH_VALIDATION_ERROR',
                ...this.details
            }, context.options.includeStack)
        };
    }
}
exports.SearchValidationError = SearchValidationError;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9zZWFyY2gvZXJyb3JzL2Jhc2UudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEseUNBQXFHO0FBRXJHLDhFQUFvRTtBQUVwRTs7R0FFRztBQUNILE1BQWEsV0FBWSxTQUFRLG9CQUFXO0lBQzFDLFlBQVksT0FBZSxFQUFFLE9BQTZCLEVBQUUsT0FBaUI7UUFDM0UsS0FBSyxDQUFDLHNDQUFjLENBQUMscUJBQXFCLEVBQUUsT0FBTyxFQUFFLE9BQU8sRUFBRSxPQUFPLENBQUMsQ0FBQztRQUN2RSxJQUFJLENBQUMsSUFBSSxHQUFHLGFBQWEsQ0FBQztJQUM1QixDQUFDO0lBRUQsTUFBTSxDQUFDLE9BQTRCO1FBQ2pDLE9BQU87WUFDTCxVQUFVLEVBQUUsc0NBQWMsQ0FBQyxxQkFBcUI7WUFDaEQsSUFBSSxFQUFFLElBQUksQ0FBQyxtQkFBbUIsQ0FDNUIsc0NBQWMsQ0FBQyxxQkFBcUIsRUFDcEMsSUFBSSxDQUFDLE9BQU8sRUFDWjtnQkFDRSxJQUFJLEVBQUUsY0FBYztnQkFDcEIsR0FBRyxJQUFJLENBQUMsT0FBTzthQUNoQixFQUNELE9BQU8sQ0FBQyxPQUFPLENBQUMsWUFBWSxDQUM3QjtTQUNGLENBQUM7SUFDSixDQUFDO0NBQ0Y7QUFwQkQsa0NBb0JDO0FBRUQ7O0dBRUc7QUFDSCxNQUFhLHFCQUFzQixTQUFRLHdCQUFlO0lBQ3hELFlBQVksT0FBZSxFQUFFLE9BQTZCLEVBQUUsT0FBaUI7UUFDM0UsS0FBSyxDQUFDLE9BQU8sRUFBRSxPQUFPLEVBQUUsT0FBTyxDQUFDLENBQUM7UUFDakMsSUFBSSxDQUFDLElBQUksR0FBRyx1QkFBdUIsQ0FBQztJQUN0QyxDQUFDO0lBRUQsTUFBTSxDQUFDLE9BQTRCO1FBQ2pDLE9BQU87WUFDTCxVQUFVLEVBQUUsc0NBQWMsQ0FBQyxXQUFXO1lBQ3RDLElBQUksRUFBRSxJQUFJLENBQUMsbUJBQW1CLENBQzVCLHNDQUFjLENBQUMsV0FBVyxFQUMxQixJQUFJLENBQUMsT0FBTyxFQUNaO2dCQUNFLElBQUksRUFBRSx5QkFBeUI7Z0JBQy9CLEdBQUcsSUFBSSxDQUFDLE9BQU87YUFDaEIsRUFDRCxPQUFPLENBQUMsT0FBTyxDQUFDLFlBQVksQ0FDN0I7U0FDRixDQUFDO0lBQ0osQ0FBQztDQUNGO0FBcEJELHNEQW9CQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFNlcnZlckVycm9yLCBCYWRSZXF1ZXN0RXJyb3IsIEVycm9ySGFuZGxlckNvbnRleHQsIEVycm9ySGFuZGxlclJlc3VsdCB9IGZyb20gJy4uLy4uL2Vycm9ycyc7XG5pbXBvcnQgeyBSZXF1ZXN0IH0gZnJvbSAnLi4vLi4vaW50ZXJmYWNlcyc7XG5pbXBvcnQgeyBIdHRwU3RhdHVzQ29kZSB9IGZyb20gJy4uLy4uL2Vycm9ycy9odHRwLXN0YXR1cy1jb2RlLmVudW0nO1xuXG4vKipcbiAqIEJhc2UgY2xhc3MgZm9yIGFsbCBzZWFyY2gtcmVsYXRlZCBlcnJvcnNcbiAqL1xuZXhwb3J0IGNsYXNzIFNlYXJjaEVycm9yIGV4dGVuZHMgU2VydmVyRXJyb3Ige1xuICBjb25zdHJ1Y3RvcihtZXNzYWdlOiBzdHJpbmcsIGRldGFpbHM/OiBSZWNvcmQ8c3RyaW5nLCBhbnk+LCByZXF1ZXN0PzogUmVxdWVzdCkge1xuICAgIHN1cGVyKEh0dHBTdGF0dXNDb2RlLklOVEVSTkFMX1NFUlZFUl9FUlJPUiwgbWVzc2FnZSwgZGV0YWlscywgcmVxdWVzdCk7XG4gICAgdGhpcy5uYW1lID0gJ1NlYXJjaEVycm9yJztcbiAgfVxuXG4gIGhhbmRsZShjb250ZXh0OiBFcnJvckhhbmRsZXJDb250ZXh0KTogRXJyb3JIYW5kbGVyUmVzdWx0IHtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdHVzQ29kZTogSHR0cFN0YXR1c0NvZGUuSU5URVJOQUxfU0VSVkVSX0VSUk9SLFxuICAgICAgYm9keTogdGhpcy5jcmVhdGVFcnJvclJlc3BvbnNlKFxuICAgICAgICBIdHRwU3RhdHVzQ29kZS5JTlRFUk5BTF9TRVJWRVJfRVJST1IsXG4gICAgICAgIHRoaXMubWVzc2FnZSxcbiAgICAgICAge1xuICAgICAgICAgIGNvZGU6ICdTRUFSQ0hfRVJST1InLFxuICAgICAgICAgIC4uLnRoaXMuZGV0YWlsc1xuICAgICAgICB9LFxuICAgICAgICBjb250ZXh0Lm9wdGlvbnMuaW5jbHVkZVN0YWNrXG4gICAgICApXG4gICAgfTtcbiAgfVxufVxuXG4vKipcbiAqIEJhc2UgY2xhc3MgZm9yIHNlYXJjaCB2YWxpZGF0aW9uIGVycm9yc1xuICovXG5leHBvcnQgY2xhc3MgU2VhcmNoVmFsaWRhdGlvbkVycm9yIGV4dGVuZHMgQmFkUmVxdWVzdEVycm9yIHtcbiAgY29uc3RydWN0b3IobWVzc2FnZTogc3RyaW5nLCBkZXRhaWxzPzogUmVjb3JkPHN0cmluZywgYW55PiwgcmVxdWVzdD86IFJlcXVlc3QpIHtcbiAgICBzdXBlcihtZXNzYWdlLCBkZXRhaWxzLCByZXF1ZXN0KTtcbiAgICB0aGlzLm5hbWUgPSAnU2VhcmNoVmFsaWRhdGlvbkVycm9yJztcbiAgfVxuXG4gIGhhbmRsZShjb250ZXh0OiBFcnJvckhhbmRsZXJDb250ZXh0KTogRXJyb3JIYW5kbGVyUmVzdWx0IHtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdHVzQ29kZTogSHR0cFN0YXR1c0NvZGUuQkFEX1JFUVVFU1QsXG4gICAgICBib2R5OiB0aGlzLmNyZWF0ZUVycm9yUmVzcG9uc2UoXG4gICAgICAgIEh0dHBTdGF0dXNDb2RlLkJBRF9SRVFVRVNULFxuICAgICAgICB0aGlzLm1lc3NhZ2UsXG4gICAgICAgIHtcbiAgICAgICAgICBjb2RlOiAnU0VBUkNIX1ZBTElEQVRJT05fRVJST1InLFxuICAgICAgICAgIC4uLnRoaXMuZGV0YWlsc1xuICAgICAgICB9LFxuICAgICAgICBjb250ZXh0Lm9wdGlvbnMuaW5jbHVkZVN0YWNrXG4gICAgICApXG4gICAgfTtcbiAgfVxufSAiXX0=