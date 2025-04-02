/**
 * Layout Builder for UI Config Builder
 *
 * Provides a builder pattern interface for creating layout configurations
 */

import { BaseBuilder } from './BaseBuilder';
import { PageConfig, PageHeaderAction } from '../types';

/**
 * Layout configuration interface
 */
export interface LayoutConfig extends PageConfig {
  pageType: 'custom';
  layoutType: string;
  layoutConfig: {
    [key: string]: any;
  };
}

/**
 * Builder for creating layout configurations
 */
export class LayoutBuilder extends BaseBuilder<LayoutConfig> {
  /**
   * Constructor initializes a new layout configuration
   */
  constructor() {
    super();
    this.config = {
      pageTitle: '',
      pageType: 'custom',
      layoutType: 'default',
      layoutConfig: {},
    };
  }

  /**
   * Sets the layout title
   *
   * @param title The layout title
   * @returns This builder instance for chaining
   */
  setTitle(title: string): LayoutBuilder {
    this.config.pageTitle = title;
    return this;
  }

  /**
   * Sets the layout description
   *
   * @param description The layout description
   * @returns This builder instance for chaining
   */
  setDescription(description: string): LayoutBuilder {
    this.config.pageDescription = description;
    return this;
  }

  /**
   * Sets the layout type (grid, two-column, tabs, card, etc.)
   *
   * @param layoutType The layout type
   * @returns This builder instance for chaining
   */
  setLayoutType(layoutType: string): LayoutBuilder {
    this.config.layoutType = layoutType;
    return this;
  }

  /**
   * Sets breadcrumbs for the layout
   *
   * @param breadcrumbs Array of breadcrumb items
   * @returns This builder instance for chaining
   */
  setBreadcrumbs(breadcrumbs: Array<{ label: string; url: string }>): LayoutBuilder {
    this.config.breadcrums = breadcrumbs;
    return this;
  }

  /**
   * Adds a header action to the layout
   *
   * @param action The header action to add
   * @returns This builder instance for chaining
   */
  addHeaderAction(action: PageHeaderAction): LayoutBuilder {
    if (!this.config.pageHeaderActions) {
      this.config.pageHeaderActions = [];
    }
    this.config.pageHeaderActions.push(action);
    return this;
  }

  /**
   * Adds a card to a grid layout
   *
   * @param card The card configuration
   * @returns This builder instance for chaining
   */
  addCard(card: { title: string; width?: string; content: PageConfig | string }): LayoutBuilder {
    if (this.config.layoutType !== 'grid') {
      throw new Error('addCard can only be used with grid layout type');
    }

    if (!this.config.layoutConfig.cards) {
      this.config.layoutConfig.cards = [];
    }

    this.config.layoutConfig.cards.push(card);
    return this;
  }

  /**
   * Validates the layout configuration
   *
   * Ensures required properties are set and configuration is valid
   * @throws Error if configuration is invalid
   */
  protected validate(): void {
    if (!this.config.pageTitle) {
      throw new Error('Layout title is required');
    }

    if (!this.config.layoutType) {
      throw new Error('Layout type is required');
    }

    // Validate based on layout type
    switch (this.config.layoutType) {
      case 'grid':
        if (
          !this.config.layoutConfig.cards ||
          !Array.isArray(this.config.layoutConfig.cards) ||
          this.config.layoutConfig.cards.length === 0
        ) {
          throw new Error('Grid layout requires at least one card');
        }
        break;

      case 'two-column':
        if (!this.config.layoutConfig.mainContent) {
          throw new Error('Two-column layout requires mainContent');
        }
        if (!this.config.layoutConfig.sidebarContent) {
          throw new Error('Two-column layout requires sidebarContent');
        }
        break;

      case 'tabs':
        if (
          !this.config.layoutConfig.tabs ||
          !Array.isArray(this.config.layoutConfig.tabs) ||
          this.config.layoutConfig.tabs.length === 0
        ) {
          throw new Error('Tabs layout requires at least one tab');
        }
        break;

      case 'card':
        if (!this.config.layoutConfig.content) {
          throw new Error('Card layout requires content');
        }
        break;
    }
  }

  /**
   * Builds and returns the final layout configuration
   *
   * @returns The complete layout configuration
   */
  build(): LayoutConfig {
    return super.build();
  }
}
