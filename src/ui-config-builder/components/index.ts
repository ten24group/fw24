/**
 * UI Config Builder Components
 *
 * This file exports the components that can be used in the JSX-like syntax
 * to build UI configurations.
 */

import { createElement, render } from './jsx';
import { ComponentInstance, RenderContext } from '../types/common-types';

// Export renderer
export { render };

// Export factory function as JSX runtime
export { createElement as jsx };

// JSX Intrinsic Elements Interface
export interface JSX {
  namespace: {
    [key: string]: any;
  };
}

// Component Types
export type ComponentType = string;
export type ComponentProps = Record<string, any>;
export type Component = (props: ComponentProps, context?: RenderContext) => ComponentInstance;

// Define component creators
function createComponent(type: ComponentType): Component {
  return (props: ComponentProps = {}, _context?: RenderContext) => {
    return {
      type,
      props,
      children: props.children || [],
    };
  };
}

// Layout Components
export const Layout = createComponent('Layout');
export const Page = createComponent('Page');
export const Section = createComponent('Section');

// Form Components
export const Form = createComponent('Form');
export const Field = createComponent('Field');

// Data Components
export const DataTable = createComponent('DataTable');
export const DetailView = createComponent('DetailView');

// Action Components
export const Action = createComponent('Action');
export const Button = createComponent('Button');

// Menu Components
export const Menu = createComponent('Menu');
export const MenuItem = createComponent('MenuItem');

// Convert component to config
export function buildConfig(component: ComponentInstance, context?: RenderContext): any {
  return render(component, context);
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
