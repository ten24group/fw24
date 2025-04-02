/**
 * UI Config Builder
 *
 * A system for building UI configurations using a builder pattern and JSX-like syntax.
 * This allows for more flexible and type-safe configuration building compared to manually
 * editing JSON files.
 */

// Import specific modules
import * as CoreBuilders from './core';
import * as Components from './components';
import * as Registration from './registration';
import * as Templates from './templates';

// Re-export the modules with namespaces to avoid name conflicts
export { CoreBuilders, Components, Registration, Templates };

// Export types separately to avoid name conflicts
export * from './types';

// Convenience exports for commonly used items
export {
  createFormBuilder,
  createListBuilder,
  createDetailBuilder,
  createMenuBuilder,
  createEntityUIConfig,
} from './core';

export {
  render,
  buildConfig,
  createEntityConfig,
  // Core JSX components
  Page,
  Layout,
  Form,
  DataTable,
  DetailView,
  Field,
  Action,
} from './components';
