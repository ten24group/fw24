export interface ErrorResponse {
    status: 'error';
    statusCode: number;
    message: string;
    details?: Record<string, any>;
    stack?: string;
} 