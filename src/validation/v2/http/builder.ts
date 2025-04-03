/**
 * HTTP validation builder
 * Provides a fluent API for building HTTP validation schemas
 */

import { ValidationRule } from '../core/types';
import {
  Body,
  Cookies,
  Headers,
  HttpTargetSchema,
  HttpValidationContext,
  HttpValidationSchema,
  Method,
  Params,
  Query,
} from './types';

/**
 * Field definition function
 * Allows for defining fields using a callback
 */
export type FieldDefinitionFn<T> = (field: string) => ValidationRule<T, HttpValidationContext>;

/**
 * HTTP validation builder
 * Provides a fluent API for building HTTP validation schemas
 */
export class HttpValidationBuilder {
  private schema: HttpValidationSchema = {};
  private conditions: Record<string, unknown> = {};

  /**
   * Creates a new HTTP validation builder
   */
  constructor() {}

  /**
   * Defines HTTP methods this schema applies to
   * @param methods Methods to apply the schema to
   */
  forMethods(...methods: Method[]): this {
    this.schema.methods = methods;
    return this;
  }

  /**
   * Defines conditions that can be referenced in validation rules
   * @param conditions Named conditions
   */
  defineConditions(conditions: Record<string, unknown>): this {
    this.conditions = { ...this.conditions, ...conditions };
    return this;
  }

  /**
   * Adds a validation rule for a body field
   * @param field Field name
   * @param rule Validation rule
   */
  addBody(field: string, rule: ValidationRule<unknown, HttpValidationContext>): this {
    if (!this.schema.body) {
      this.schema.body = {};
    }

    this.schema.body[field] = rule;
    return this;
  }

  /**
   * Adds validation rules for multiple body fields
   * @param fields Object mapping field names to validation rules
   */
  body(fields: Record<string, ValidationRule<unknown, HttpValidationContext> | FieldDefinitionFn<unknown>>): this {
    if (!this.schema.body) {
      this.schema.body = {};
    }

    for (const field in fields) {
      if (Object.prototype.hasOwnProperty.call(fields, field)) {
        const rule = fields[field];

        if (typeof rule === 'function') {
          this.schema.body[field] = rule(field);
        } else {
          this.schema.body[field] = rule;
        }
      }
    }

    return this;
  }

  /**
   * Adds a validation rule for a header
   * @param header Header name
   * @param rule Validation rule
   */
  addHeader(header: string, rule: ValidationRule<unknown, HttpValidationContext>): this {
    if (!this.schema.headers) {
      this.schema.headers = {};
    }

    this.schema.headers[header] = rule;
    return this;
  }

  /**
   * Adds validation rules for multiple headers
   * @param headers Object mapping header names to validation rules
   */
  headers(headers: Record<string, ValidationRule<unknown, HttpValidationContext> | FieldDefinitionFn<unknown>>): this {
    if (!this.schema.headers) {
      this.schema.headers = {};
    }

    for (const header in headers) {
      if (Object.prototype.hasOwnProperty.call(headers, header)) {
        const rule = headers[header];

        if (typeof rule === 'function') {
          this.schema.headers[header] = rule(header);
        } else {
          this.schema.headers[header] = rule;
        }
      }
    }

    return this;
  }

  /**
   * Adds a validation rule for a route parameter
   * @param param Parameter name
   * @param rule Validation rule
   */
  addParam(param: string, rule: ValidationRule<unknown, HttpValidationContext>): this {
    if (!this.schema.params) {
      this.schema.params = {};
    }

    this.schema.params[param] = rule;
    return this;
  }

  /**
   * Adds validation rules for multiple route parameters
   * @param params Object mapping parameter names to validation rules
   */
  params(params: Record<string, ValidationRule<unknown, HttpValidationContext> | FieldDefinitionFn<unknown>>): this {
    if (!this.schema.params) {
      this.schema.params = {};
    }

    for (const param in params) {
      if (Object.prototype.hasOwnProperty.call(params, param)) {
        const rule = params[param];

        if (typeof rule === 'function') {
          this.schema.params[param] = rule(param);
        } else {
          this.schema.params[param] = rule;
        }
      }
    }

    return this;
  }

  /**
   * Adds a validation rule for a query parameter
   * @param query Query parameter name
   * @param rule Validation rule
   */
  addQuery(query: string, rule: ValidationRule<unknown, HttpValidationContext>): this {
    if (!this.schema.query) {
      this.schema.query = {};
    }

    this.schema.query[query] = rule;
    return this;
  }

  /**
   * Adds validation rules for multiple query parameters
   * @param queries Object mapping query parameter names to validation rules
   */
  query(queries: Record<string, ValidationRule<unknown, HttpValidationContext> | FieldDefinitionFn<unknown>>): this {
    if (!this.schema.query) {
      this.schema.query = {};
    }

    for (const query in queries) {
      if (Object.prototype.hasOwnProperty.call(queries, query)) {
        const rule = queries[query];

        if (typeof rule === 'function') {
          this.schema.query[query] = rule(query);
        } else {
          this.schema.query[query] = rule;
        }
      }
    }

    return this;
  }

  /**
   * Adds a validation rule for a cookie
   * @param cookie Cookie name
   * @param rule Validation rule
   */
  addCookie(cookie: string, rule: ValidationRule<unknown, HttpValidationContext>): this {
    if (!this.schema.cookies) {
      this.schema.cookies = {};
    }

    this.schema.cookies[cookie] = rule;
    return this;
  }

  /**
   * Adds validation rules for multiple cookies
   * @param cookies Object mapping cookie names to validation rules
   */
  cookies(cookies: Record<string, ValidationRule<unknown, HttpValidationContext> | FieldDefinitionFn<unknown>>): this {
    if (!this.schema.cookies) {
      this.schema.cookies = {};
    }

    for (const cookie in cookies) {
      if (Object.prototype.hasOwnProperty.call(cookies, cookie)) {
        const rule = cookies[cookie];

        if (typeof rule === 'function') {
          this.schema.cookies[cookie] = rule(cookie);
        } else {
          this.schema.cookies[cookie] = rule;
        }
      }
    }

    return this;
  }

  /**
   * Generic method to add a validation rule for any target
   * @param target Validation target
   * @param field Field name
   * @param rule Validation rule
   */
  add(
    target: 'body' | 'headers' | 'params' | 'query' | 'cookies',
    field: string,
    rule: ValidationRule<unknown, HttpValidationContext>,
  ): this {
    switch (target) {
      case 'body':
        return this.addBody(field, rule);
      case 'headers':
        return this.addHeader(field, rule);
      case 'params':
        return this.addParam(field, rule);
      case 'query':
        return this.addQuery(field, rule);
      case 'cookies':
        return this.addCookie(field, rule);
      default:
        return this;
    }
  }

  /**
   * Builds the validation schema
   */
  build(): HttpValidationSchema {
    // Include conditions in the schema
    if (Object.keys(this.conditions).length > 0) {
      return {
        ...this.schema,
        conditions: this.conditions,
      } as HttpValidationSchema;
    }

    return this.schema;
  }
}

/**
 * Creates a new HTTP validation builder
 */
export function http(): HttpValidationBuilder {
  return new HttpValidationBuilder();
}
