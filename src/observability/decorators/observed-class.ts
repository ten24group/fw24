/**
 * @ObservedClass Decorator - Class-level observability configuration
 * 
 * Automatically applies observability to all or selected methods in a class.
 * Useful for services, controllers, or any class where you want comprehensive tracking.
 * 
 * Usage:
 * ```typescript
 * @ObservedClass({ traceAll: true, sourceType: 'service' })
 * class OrderService {
 *   // All methods automatically traced
 *   async createOrder(order: Order): Promise<Order> { ... }
 *   async updateOrder(id: string, data: Partial<Order>): Promise<Order> { ... }
 *   async deleteOrder(id: string): Promise<void> { ... }
 * }
 * 
 * @ObservedClass({ 
 *   trace: true,
 *   audit: true,
 *   exclude: ['internalHelper', 'privateMethod']
 * })
 * class UserService {
 *   async createUser(data: UserData): Promise<User> { ... } // Traced + Audited
 *   async updateUser(id: string, data: Partial<UserData>): Promise<User> { ... } // Traced + Audited
 *   private internalHelper(): void { ... } // Excluded
 * }
 * ```
 * 
 * REQUIREMENTS:
 * - Must be called within an observation context (runWithContext)
 * - Methods must be async or return synchronous values
 */

import { Observed, ObservedOptions } from './observed';

export interface ObservedClassOptions {
  /** Source type for all methods in the class */
  sourceType?: 'controller' | 'service' | 'handler' | 'queue' | 'task';
  
  /** Default level for all observations */
  level?: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  
  /** Enable tracing for all methods */
  traceAll?: boolean;
  
  /** Enable tracing with specific options */
  trace?: boolean | {
    level?: 'trace' | 'debug' | 'info' | 'warn' | 'error';
    captureArgs?: boolean;
    captureResult?: boolean;
  };
  
  /** Enable audit for all methods */
  audit?: boolean | {
    level?: 'info' | 'warn' | 'error';
    captureArgs?: boolean;
    captureResult?: boolean;
  };
  
  /** Enable metrics for all methods */
  metric?: boolean | {
    type?: 'counter' | 'timing';
    unit?: string;
  };
  
  /** Methods to exclude from observability */
  exclude?: string[];
  
  /** Methods to include (if provided, only these will be observed) */
  include?: string[];
  
  /** Tags applied to all observations in this class */
  tags?: Record<string, string>;
  
  /** Capture arguments for all methods */
  captureArgs?: boolean;
  
  /** Capture results for all methods */
  captureResult?: boolean;
}

/**
 * Class decorator that automatically applies observability to methods
 * 
 * @param options - Class-level observability options
 */
export function ObservedClass(options: ObservedClassOptions = {}) {
  return function <T extends { new(...args: any[]): {} }>(constructor: T): T {
    const className = constructor.name;
    
    // Get all method names from prototype
    const prototype = constructor.prototype;
    const methodNames = Object.getOwnPropertyNames(prototype)
      .filter(name => {
        // Skip constructor
        if (name === 'constructor') return false;
        
        // Skip if not a function
        const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
        if (!descriptor || typeof descriptor.value !== 'function') return false;
        
        // Apply include/exclude filters
        if (options.include && options.include.length > 0) {
          return options.include.includes(name);
        }
        
        if (options.exclude && options.exclude.includes(name)) {
          return false;
        }
        
        return true;
      });

    // Apply @Observed decorator to each method
    methodNames.forEach(methodName => {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, methodName);
      if (!descriptor) return;

      // Build method-specific options
      const methodOptions: ObservedOptions = {
        name: `${className}.${methodName}`,
        sourceType: options.sourceType,
        tags: options.tags,
        captureArgs: options.captureArgs,
        captureResult: options.captureResult,
      };

      // Configure tracing
      if (options.traceAll || options.trace) {
        if (typeof options.trace === 'boolean') {
          methodOptions.trace = true;
        } else if (options.trace && typeof options.trace === 'object') {
          methodOptions.trace = {
            level: options.trace.level || options.level,
            attributes: {},
          };
          // Override captureArgs/captureResult if specified in trace options
          if (options.trace.captureArgs !== undefined) {
            methodOptions.captureArgs = options.trace.captureArgs;
          }
          if (options.trace.captureResult !== undefined) {
            methodOptions.captureResult = options.trace.captureResult;
          }
        } else {
          methodOptions.trace = true;
        }
      }

      // Configure audit
      if (options.audit) {
        if (typeof options.audit === 'boolean') {
          methodOptions.audit = true;
        } else {
          methodOptions.audit = {
            action: `${className}.${methodName}`,
            level: options.audit.level,
            captureArgs: options.audit.captureArgs ?? options.captureArgs,
            captureResult: options.audit.captureResult ?? options.captureResult,
          };
        }
      }

      // Configure metric
      if (options.metric) {
        if (typeof options.metric === 'boolean') {
          methodOptions.metric = {
            name: `${className}.${methodName}.count`,
            type: 'counter',
          };
        } else {
          methodOptions.metric = {
            name: `${className}.${methodName}.${options.metric.type === 'timing' ? 'duration' : 'count'}`,
            type: options.metric.type ?? 'counter',
            unit: options.metric.unit,
          };
        }
      }

      // Apply the decorator
      const decoratedDescriptor = Observed(methodOptions)(
        prototype,
        methodName,
        descriptor as TypedPropertyDescriptor<any>
      );

      // Update the descriptor
      if (decoratedDescriptor) {
        Object.defineProperty(prototype, methodName, decoratedDescriptor);
      }
    });

    return constructor;
  };
}

