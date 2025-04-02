/**
 * JSX Factory implementation for UI Config Builder
 *
 * Based on TypeScript JSX as a typed DSL pattern (see: https://dempfi.com/posts/type-scripts-jsx-as-a-typed-dsl/)
 */

import { createElement as createFactoryElement, renderElement } from './ElementFactory';
import { BaseElement } from '../types/element-types';
import { ConfigObject } from '../types';
import { JSXIntrinsicElements } from '../types/jsx-types';

/**
 * Create a React-like JSX factory function
 */
export function createElement(
  type: string,
  props: Record<string, any>,
  ...children: Array<string | BaseElement | null | undefined>
): BaseElement {
  // TypeScript's JSX transform will call this function
  props = props || {};
  return createFactoryElement(type as keyof JSXIntrinsicElements, props, children);
}

/**
 * Build a config object from JSX
 */
export function buildConfig(jsxElement: JSX.Element): ConfigObject {
  return renderElement(jsxElement as unknown as BaseElement);
}

// Export render for use in apps
export function render(element: BaseElement): ConfigObject {
  return renderElement(element);
}
