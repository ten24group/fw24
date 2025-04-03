import { ConfigObject } from '../types';

/**
 * Base class for all UI configuration builders
 * Provides common functionality for building UI configurations
 */
export abstract class BaseBuilder<T extends ConfigObject> {
  protected config: T;

  constructor(initialConfig: Partial<T>) {
    this.config = { ...initialConfig } as T;
  }

  /**
   * Get the current configuration
   */
  public getConfig(): T {
    return { ...this.config };
  }

  /**
   * Build the final configuration
   */
  public build(): T {
    this.validate();
    return this.getConfig();
  }

  /**
   * Validate the configuration
   * Should be implemented by child classes
   */
  protected abstract validate(): void;

  /**
   * Merge configuration objects
   * @param target Target object
   * @param source Source object
   */
  protected merge(target: object, source: object): object {
    return {
      ...target,
      ...source,
    };
  }

  /**
   * Extend or replace part of the configuration
   * @param partialConfig Partial configuration to merge
   */
  public extend(partialConfig: Partial<T>): this {
    this.config = {
      ...this.config,
      ...partialConfig,
    };
    return this;
  }

  /**
   * Set a specific config property
   * @param key Configuration key
   * @param value Configuration value
   */
  public set<K extends keyof T>(key: K, value: T[K]): this {
    this.config = {
      ...this.config,
      [key]: value,
    };
    return this;
  }

  /**
   * Convert the configuration to JSON string
   */
  public toJSON(): string {
    return JSON.stringify(this.build(), null, 2);
  }
}
