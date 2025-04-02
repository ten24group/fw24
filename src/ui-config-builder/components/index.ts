/**
 * Component system for UI Config Builder
 *
 * This module provides a component-based approach to creating UI configurations.
 *
 * NOTE: This is the legacy component system. New code should use the JSX syntax.
 * @deprecated Use JSX implementation instead
 */

import { RenderContext } from '../types/common-types';
import { render } from './jsx';

// Helper type to mimic the Element class from jsx.ts
interface Element<K extends string> {
  kind: K;
  props: Record<string, any>;
  children: Array<string | Element<any>>;
  toConfig(): any;
  findChildrenOfKind<T extends string>(kind: T): Element<T>[];
  textContent: string;
}

// Helper for TypeScript to recognize JSX
export interface JSX {
  namespace: {
    [key: string]: any;
  };
}

// Component types
export type ComponentType = string;
export type ComponentProps = Record<string, any>;

// Legacy component instance type
export interface ComponentInstance<T = any> {
  type: string;
  props: T;
  children?: Array<ComponentInstance<any> | string>;
}

// Legacy component factory function type
export type Component = (props: ComponentProps, context?: RenderContext) => ComponentInstance;

// Factory for creating components
function createComponent(type: ComponentType): Component {
  return (props: ComponentProps = {}, _context?: RenderContext) => {
    return {
      type,
      props,
      children: [],
    };
  };
}

// Layout Components
export const Layout = createComponent('Layout');
export const Page = createComponent('Page');

// Form Components
export const Form = createComponent('Form');
export const Section = createComponent('Section');
export const Field = createComponent('Field');

// Data Display Components
export const DataTable = createComponent('DataTable');
export const DetailView = createComponent('DetailView');

// Action Components
export const Action = createComponent('Action');
export const Button = createComponent('Button');

// Menu Components
export const Menu = createComponent('Menu');
export const MenuItem = createComponent('MenuItem');

// Convert to Element for rendering
function componentToElement(component: ComponentInstance): Element<string> {
  return {
    kind: component.type.toLowerCase(),
    props: component.props,
    children: component.children?.map(child => (typeof child === 'string' ? child : componentToElement(child))) || [],
    toConfig() {
      return render(this);
    },
    findChildrenOfKind<T extends string>(kind: T): Element<T>[] {
      return this.children.filter((c: any): c is Element<T> => typeof c !== 'string' && c.kind === kind);
    },
    get textContent(): string {
      return this.children.filter((c: any): c is string => typeof c === 'string').join('');
    },
  } as Element<string>;
}

// Convert component to config
export function buildConfig(component: ComponentInstance, context?: RenderContext): any {
  const element = componentToElement(component);
  return render(element, context);
}

// Helper to create a complete entity config with JSX
export function createEntityConfig(
  entityName: string,
  component: ComponentInstance,
  context?: RenderContext,
): Record<string, any> {
  const config = buildConfig(component, { ...context, entityName });
  return {
    [`${component.props.pageType || 'custom'}-${entityName.toLowerCase()}`]: config,
  };
}
