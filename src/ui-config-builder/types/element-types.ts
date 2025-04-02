/**
 * Element Type Definitions
 *
 * This file defines the core Element types used in the JSX implementation
 * with a discriminated union approach for better type safety.
 */

import {
  FormProps,
  SectionProps,
  FieldProps,
  DataTableProps,
  DetailViewProps,
  PageProps,
  ActionProps,
  ValidationProps,
  OptionProps,
  JSXIntrinsicElements,
} from './jsx-types';
import { ConfigObject } from './index';

/**
 * Base interface for all elements
 */
export interface BaseElement {
  readonly kind: string;
  readonly props: Record<string, any>;
  readonly children: Array<string | BaseElement>;
  toConfig(): ConfigObject;
  findChildrenOfKind<K extends string>(kind: K): ElementOfKind<K>[];
  readonly textContent: string;
}

/**
 * Type for elements of a specific kind
 */
export type ElementOfKind<K extends string> = BaseElement;

/**
 * Form element
 */
export interface FormElement extends BaseElement {
  readonly kind: 'form';
  readonly props: FormProps;
}

/**
 * Section element
 */
export interface SectionElement extends BaseElement {
  readonly kind: 'section';
  readonly props: SectionProps;
}

/**
 * Field element
 */
export interface FieldElement extends BaseElement {
  readonly kind: 'field';
  readonly props: FieldProps;
}

/**
 * DataTable element
 */
export interface DataTableElement extends BaseElement {
  readonly kind: 'datatable';
  readonly props: DataTableProps;
}

/**
 * DetailView element
 */
export interface DetailViewElement extends BaseElement {
  readonly kind: 'detailview';
  readonly props: DetailViewProps;
}

/**
 * Page element
 */
export interface PageElement extends BaseElement {
  readonly kind: 'page';
  readonly props: PageProps;
}

/**
 * Action element
 */
export interface ActionElement extends BaseElement {
  readonly kind: 'action';
  readonly props: ActionProps;
}

/**
 * Validation element
 */
export interface ValidationElement extends BaseElement {
  readonly kind: 'validation';
  readonly props: ValidationProps;
}

/**
 * Option element
 */
export interface OptionElement extends BaseElement {
  readonly kind: 'option';
  readonly props: OptionProps;
}

/**
 * Discriminated union of all element types
 */
export type Element =
  | FormElement
  | SectionElement
  | FieldElement
  | DataTableElement
  | DetailViewElement
  | PageElement
  | ActionElement
  | ValidationElement
  | OptionElement;

/**
 * Generic helper to create an element
 */
export function createElement<K extends keyof JSXIntrinsicElements>(
  kind: K,
  props: JSXIntrinsicElements[K],
  children: Array<string | BaseElement | null | undefined> = [],
): ElementOfKind<K> {
  // Filter out null/undefined
  const filteredChildren = children.filter(Boolean) as Array<string | BaseElement>;

  return {
    kind,
    props,
    children: filteredChildren,
    toConfig(): ConfigObject {
      // Implementation will be provided by the ElementFactory
      throw new Error('toConfig not implemented for this element');
    },
    findChildrenOfKind<T extends string>(searchKind: T): ElementOfKind<T>[] {
      return this.children.filter(
        (child): child is ElementOfKind<T> => typeof child !== 'string' && child.kind === searchKind,
      );
    },
    get textContent(): string {
      return this.children.filter((child): child is string => typeof child === 'string').join('');
    },
  } as ElementOfKind<K>;
}
