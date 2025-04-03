/**
 * HTTP validation types
 * Defines the types for validating HTTP requests and responses
 */

import { ValidationContext, ValidationRule } from '../core/types';

/**
 * HTTP request body
 */
export type Body = Record<string, unknown>;

/**
 * HTTP request headers
 */
export type Headers = Record<string, string | string[]>;

/**
 * HTTP request parameters (path/route params)
 */
export type Params = Record<string, string>;

/**
 * HTTP request query parameters
 */
export type Query = Record<string, string | string[]>;

/**
 * HTTP request cookies
 */
export type Cookies = Record<string, string>;

/**
 * HTTP method
 */
export type Method = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

/**
 * HTTP validation context
 */
export interface HttpValidationContext extends ValidationContext {
  /** The HTTP method */
  method?: Method;

  /** The request URL */
  url?: string;

  /** The request path */
  path?: string;

  /** The request body */
  body?: Body;

  /** The request headers */
  headers?: Headers;

  /** The route parameters */
  params?: Params;

  /** The query parameters */
  query?: Query;

  /** The cookies */
  cookies?: Cookies;

  /** Named conditions */
  conditions?: Record<string, unknown>;
}

/**
 * HTTP validation target
 */
export type HttpValidationTarget = 'body' | 'headers' | 'params' | 'query' | 'cookies';

/**
 * Schema for a specific target in HTTP validation
 */
export type HttpTargetSchema<T> = {
  [K in keyof T]?: ValidationRule<T[K], HttpValidationContext>;
};

/**
 * Schema for HTTP validation
 */
export interface HttpValidationSchema {
  /** Body validation schema */
  body?: HttpTargetSchema<Body>;

  /** Headers validation schema */
  headers?: HttpTargetSchema<Headers>;

  /** Route parameters validation schema */
  params?: HttpTargetSchema<Params>;

  /** Query parameters validation schema */
  query?: HttpTargetSchema<Query>;

  /** Cookies validation schema */
  cookies?: HttpTargetSchema<Cookies>;

  /** Methods this schema applies to */
  methods?: Method[];

  /** Named conditions for validation */
  conditions?: Record<string, unknown>;
}

/**
 * Result of HTTP validation
 */
export interface HttpValidationResult {
  /** Whether validation passed */
  pass: boolean;

  /** Validation errors */
  errors?: Array<{
    /** Error message */
    message: string;

    /** Path to the field that failed validation */
    path: string[];

    /** The target that failed validation */
    target: HttpValidationTarget;
  }>;
}
