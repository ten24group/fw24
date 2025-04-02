/**
 * Layout Templates for UI Config Builder
 */

import { Layout, Page, Section } from '../components';
import { ComponentInstance } from '../types/common-types';

/**
 * Create a dashboard layout template
 */
export function createDashboardLayout(options: {
  title?: string;
  description?: string;
  sections: Array<{
    title: string;
    key: string;
    content: ComponentInstance;
    width?: string | number;
    height?: string | number;
    collapsed?: boolean;
  }>;
}): ComponentInstance {
  const { title = 'Dashboard', description, sections } = options;

  return Page({
    title,
    pageType: 'custom',
    description,
    children: [
      Layout({
        type: 'dashboard',
        children: sections.map(section =>
          Section({
            title: section.title,
            key: section.key,
            collapsed: section.collapsed,
            style: {
              width: section.width || '100%',
              height: section.height || 'auto',
            },
            children: [section.content],
          }),
        ),
      }),
    ],
  });
}

/**
 * Create a two-column layout template
 */
export function createTwoColumnLayout(options: {
  title?: string;
  description?: string;
  leftColumn: {
    content: ComponentInstance;
    width?: string;
  };
  rightColumn: {
    content: ComponentInstance;
    width?: string;
  };
}): ComponentInstance {
  const { title, description, leftColumn, rightColumn } = options;

  return Page({
    title,
    pageType: 'custom',
    description,
    children: [
      Layout({
        type: 'columns',
        children: [
          Section({
            key: 'left-column',
            style: {
              width: leftColumn.width || '50%',
            },
            children: [leftColumn.content],
          }),
          Section({
            key: 'right-column',
            style: {
              width: rightColumn.width || '50%',
            },
            children: [rightColumn.content],
          }),
        ],
      }),
    ],
  });
}

/**
 * Create a tabbed layout template
 */
export function createTabbedLayout(options: {
  title?: string;
  description?: string;
  tabs: Array<{
    title: string;
    key: string;
    content: ComponentInstance;
    icon?: string;
  }>;
  defaultActiveTab?: string;
}): ComponentInstance {
  const { title, description, tabs, defaultActiveTab } = options;

  return Page({
    title,
    pageType: 'custom',
    description,
    children: [
      Layout({
        type: 'tabs',
        defaultActiveKey: defaultActiveTab || tabs[0]?.key,
        children: tabs.map(tab =>
          Section({
            title: tab.title,
            key: tab.key,
            icon: tab.icon,
            children: [tab.content],
          }),
        ),
      }),
    ],
  });
}

/**
 * Create a card layout
 */
export function createCardLayout(options: {
  title?: string;
  description?: string;
  content: ComponentInstance;
  width?: string;
  bordered?: boolean;
  shadow?: boolean;
}): ComponentInstance {
  const { title, description, content, width = '100%', bordered = true, shadow = false } = options;

  return Page({
    title,
    pageType: 'custom',
    description,
    children: [
      Layout({
        type: 'card',
        title,
        style: {
          width,
          border: bordered ? '1px solid #e8e8e8' : 'none',
          boxShadow: shadow ? '0 2px 8px rgba(0, 0, 0, 0.15)' : 'none',
        },
        children: [content],
      }),
    ],
  });
}
