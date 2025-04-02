/**
 * Layout templates for the UI Config Builder
 *
 * These templates provide pre-built configurations for common layout patterns.
 * They use LayoutBuilder internally for consistency.
 */

import { LayoutBuilder } from '../core/LayoutBuilder';
import { PageConfig } from '../types';

export interface LayoutTemplateOptions {
  title?: string;
  description?: string;
  breadcrumbs?: Array<{ label: string; url: string }>;
  headerActions?: Array<{
    label: string;
    icon?: string;
    url?: string;
  }>;
}

/**
 * Creates a dashboard layout with multiple cards
 *
 * @param options Layout configuration options
 * @param cards Array of card configurations to display in a grid
 * @returns A layout configuration
 */
export function createDashboardLayout(
  options: LayoutTemplateOptions,
  cards: Array<{
    title: string;
    width?: string;
    content: PageConfig | string;
  }>,
) {
  const { title = 'Dashboard', description, breadcrumbs, headerActions } = options;

  const layoutBuilder = new LayoutBuilder();

  layoutBuilder.setTitle(title);

  if (description) {
    layoutBuilder.setDescription(description);
  }

  if (breadcrumbs && breadcrumbs.length > 0) {
    layoutBuilder.setBreadcrumbs(breadcrumbs);
  }

  if (headerActions && headerActions.length > 0) {
    headerActions.forEach(action => {
      layoutBuilder.addHeaderAction(action);
    });
  }

  layoutBuilder.setLayoutType('grid');

  cards.forEach(card => {
    layoutBuilder.addCard({
      title: card.title,
      width: card.width || '100%',
      content: card.content,
    });
  });

  return layoutBuilder.build();
}

/**
 * Creates a two-column layout with main content and sidebar
 *
 * @param options Layout configuration options
 * @param mainContent The main content for the layout
 * @param sidebarContent The sidebar content
 * @param sidebarWidth Width of the sidebar (default: '30%')
 * @param sidebarPosition Position of the sidebar (default: 'right')
 * @returns A layout configuration
 */
export function createTwoColumnLayout(
  options: LayoutTemplateOptions,
  mainContent: PageConfig | string,
  sidebarContent: PageConfig | string,
  sidebarWidth: string = '30%',
  sidebarPosition: 'left' | 'right' = 'right',
) {
  const { title, description, breadcrumbs, headerActions } = options;

  const layoutBuilder = new LayoutBuilder();

  if (title) {
    layoutBuilder.setTitle(title);
  }

  if (description) {
    layoutBuilder.setDescription(description);
  }

  if (breadcrumbs && breadcrumbs.length > 0) {
    layoutBuilder.setBreadcrumbs(breadcrumbs);
  }

  if (headerActions && headerActions.length > 0) {
    headerActions.forEach(action => {
      layoutBuilder.addHeaderAction(action);
    });
  }

  layoutBuilder.setLayoutType('two-column');
  layoutBuilder.set('layoutConfig', {
    ...layoutBuilder.getConfig().layoutConfig,
    sidebarWidth,
    sidebarPosition,
    mainContent,
    sidebarContent,
  });

  return layoutBuilder.build();
}

/**
 * Creates a tabbed layout with multiple tabs
 *
 * @param options Layout configuration options
 * @param tabs Array of tab configurations
 * @returns A layout configuration with tabs
 */
export function createTabbedLayout(
  options: LayoutTemplateOptions,
  tabs: Array<{
    label: string;
    key: string;
    content: PageConfig | string;
    icon?: string;
  }>,
) {
  const { title, description, breadcrumbs, headerActions } = options;

  const layoutBuilder = new LayoutBuilder();

  if (title) {
    layoutBuilder.setTitle(title);
  }

  if (description) {
    layoutBuilder.setDescription(description);
  }

  if (breadcrumbs && breadcrumbs.length > 0) {
    layoutBuilder.setBreadcrumbs(breadcrumbs);
  }

  if (headerActions && headerActions.length > 0) {
    headerActions.forEach(action => {
      layoutBuilder.addHeaderAction(action);
    });
  }

  layoutBuilder.setLayoutType('tabs');
  layoutBuilder.set('layoutConfig', {
    ...layoutBuilder.getConfig().layoutConfig,
    tabs,
  });

  return layoutBuilder.build();
}

/**
 * Creates a card layout for displaying content in a bordered container
 *
 * @param options Layout configuration options
 * @param content The content to display in the card
 * @param width Width of the card (default: '100%')
 * @returns A layout configuration
 */
export function createCardLayout(options: LayoutTemplateOptions, content: PageConfig | string, width: string = '100%') {
  const { title, description, breadcrumbs, headerActions } = options;

  const layoutBuilder = new LayoutBuilder();

  if (title) {
    layoutBuilder.setTitle(title);
  }

  if (description) {
    layoutBuilder.setDescription(description);
  }

  if (breadcrumbs && breadcrumbs.length > 0) {
    layoutBuilder.setBreadcrumbs(breadcrumbs);
  }

  if (headerActions && headerActions.length > 0) {
    headerActions.forEach(action => {
      layoutBuilder.addHeaderAction(action);
    });
  }

  layoutBuilder.setLayoutType('card');
  layoutBuilder.set('layoutConfig', {
    ...layoutBuilder.getConfig().layoutConfig,
    content,
    width,
  });

  return layoutBuilder.build();
}
