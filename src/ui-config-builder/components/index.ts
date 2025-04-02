/**
 * Component system for UI Config Builder
 *
 * This module provides a component-based approach to creating UI configurations.
 *
 * NOTE: This is the legacy component system. New code should use the JSX syntax.
 * @deprecated Use JSX implementation instead
 */

import { ComponentInstance, RenderContext } from '../types';
import { BaseElement } from '../types/element-types';
import { renderElement } from './ElementFactory';

// Create a simple component factory function
export function createComponent(type: string) {
  return (props: Record<string, any> = {}, children: any[] = []) => {
    return { type, props, children };
  };
}

// Create component instances
export const Form = createComponent('Form');
export const Field = createComponent('Field');
export const Section = createComponent('Section');
export const Layout = createComponent('Layout');
export const Page = createComponent('Page');
export const DataTable = createComponent('DataTable');
export const DetailView = createComponent('DetailView');
export const Action = createComponent('Action');
export const Button = createComponent('Button');

// Menu Components
export const Menu = createComponent('Menu');
export const MenuItem = createComponent('MenuItem');

// Convert to Element for rendering
function componentToElement(component: ComponentInstance): BaseElement {
  return {
    kind: component.type.toLowerCase(),
    props: component.props,
    children: component.children?.map(child => (typeof child === 'string' ? child : componentToElement(child))) || [],
    toConfig() {
      return renderElement(this);
    },
    findChildrenOfKind<T extends string>(kind: T): BaseElement[] {
      return this.children.filter((c: any): c is BaseElement => typeof c !== 'string' && c.kind === kind);
    },
    get textContent(): string {
      return this.children.filter((c: any): c is string => typeof c === 'string').join('');
    },
  };
}

// Convert component to config
export function buildConfig(component: ComponentInstance): any {
  const element = componentToElement(component);
  return renderElement(element);
}

// Helper to create a complete entity config with JSX
export function createEntityConfig(entityName: string, component: ComponentInstance): Record<string, any> {
  const config = buildConfig(component);
  return {
    [`${component.props.pageType || 'custom'}-${entityName.toLowerCase()}`]: config,
  };
}
