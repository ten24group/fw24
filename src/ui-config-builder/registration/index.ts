/**
 * UI Config Builder Registration System
 *
 * This system allows registering custom routes and pages
 * that will be included in the generated UI configuration.
 */

import { ComponentInstance } from '../types/common-types';
import { render } from '../components';
import { MenuItem } from '../types/menu-types';

// Store for registered routes
type RouteRegistry = Map<
  string,
  {
    path: string;
    component: ComponentInstance;
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
  component: ComponentInstance,
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
    configs[routeKey] = render(route.component);
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
  component: ComponentInstance,
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
