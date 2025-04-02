/**
 * UI Config Builder Registration System
 *
 * This system allows registering custom routes and pages
 * that will be included in the generated UI configuration.
 */

import { JSXElement } from '../types/jsx-types';
import { render } from '../components/jsx';
import { MenuItem } from '../types/menu-types';

// Store for registered routes
type RouteRegistry = Map<
  string,
  {
    path: string;
    component: JSXElement | any; // Allow both JSX and legacy components
    menuItem?: MenuItem;
    order?: number;
  }
>;

// Global registry
const routeRegistry: RouteRegistry = new Map();

/**
 * Register a route with a component
 */
export function registerRoute(
  path: string,
  component: any, // Accept any type of component
  options: {
    menuItem?: MenuItem;
    order?: number;
  } = {},
): void {
  routeRegistry.set(path, {
    path,
    component,
    menuItem: options.menuItem,
    order: options.order || 999,
  });
}

/**
 * Get all registered routes
 */
export function getRegisteredRoutes(): RouteRegistry {
  return routeRegistry;
}

/**
 * Get all registered menu items
 */
export function getRegisteredMenuItems(): MenuItem[] {
  const menuItems: MenuItem[] = [];

  routeRegistry.forEach(route => {
    if (route.menuItem) {
      menuItems.push({
        ...route.menuItem,
        url: route.path,
        order: route.order,
      });
    }
  });

  return menuItems;
}

/**
 * Generate configurations for all registered routes
 */
export function generateRegisteredConfigs(): Record<string, any> {
  const configs: Record<string, any> = {};

  routeRegistry.forEach((route, path) => {
    const routeKey = path.replace(/^\//, '').replace(/\//g, '-');
    const component = route.component;

    // Handle different component types
    if (component) {
      if (typeof component.toConfig === 'function') {
        // New JSX component with toConfig method
        configs[routeKey] = component.toConfig();
      } else if (typeof component === 'object' && 'type' in component) {
        // Legacy component instance - use the imported render function
        configs[routeKey] = render(component);
      } else {
        // Already a config object
        configs[routeKey] = component;
      }
    }
  });

  return configs;
}

/**
 * Clear all registered routes
 */
export function clearRegisteredRoutes(): void {
  routeRegistry.clear();
}

/**
 * Entity-specific route registration helper
 */
export function registerEntityRoute(
  entityName: string,
  routeType: 'list' | 'create' | 'edit' | 'view' | 'custom',
  component: JSXElement | any,
  options: {
    menuItem?: MenuItem;
    order?: number;
    path?: string;
  } = {},
): void {
  const entityPath = entityName.toLowerCase();
  const path = options.path || `/${routeType}-${entityPath}`;

  registerRoute(path, component, options);
}
