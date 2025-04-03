/**
 * Types for HTTP request validation
 */
import { ValidationSchema } from '../validator';

/**
 * HTTP request object containing headers, params, query and body
 */
export interface HttpRequest {
  /** Request headers */
  headers: Record<string, string | string[]>;
  /** URL path parameters */
  params: Record<string, string>;
  /** Query string parameters */
  query: Record<string, string | string[]>;
  /** Request body */
  body?: unknown;
}

/**
 * HTTP validation context
 */
export interface HttpValidationContext {
  /** Full request information */
  request: HttpRequest;
}

/**
 * Schema for HTTP request validation
 */
export interface HttpValidationSchema {
  /** Validation schema for request headers */
  headers?: ValidationSchema<Record<string, string | string[]>, HttpValidationContext>;
  /** Validation schema for URL path parameters */
  params?: ValidationSchema<Record<string, string>, HttpValidationContext>;
  /** Validation schema for query string parameters */
  query?: ValidationSchema<Record<string, string | string[]>, HttpValidationContext>;
  /** Validation schema for request body */
  body?: ValidationSchema<unknown, HttpValidationContext>;
}
