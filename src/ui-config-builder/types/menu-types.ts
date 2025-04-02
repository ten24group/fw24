/**
 * Menu configuration types
 */

export interface MenuConfig {
  items: MenuItem[];
  theme?: 'light' | 'dark';
  mode?: 'horizontal' | 'vertical' | 'inline';
  customStyle?: Record<string, any>;
  [key: string]: any;
}

export interface MenuItem {
  key: string;
  title: string;
  icon?: string;
  url?: string;
  children?: MenuItem[];
  type?: 'group' | 'item' | 'divider';
  permission?: string;
  order?: number;
  hidden?: boolean;
  [key: string]: any;
}

export interface EntityMenuConfig {
  entityKey: string;
  entityName: string;
  entityNamePlural: string;
  icon?: string;
  order?: number;
  includeCreate?: boolean;
  includeList?: boolean;
  includeView?: boolean;
  includeEdit?: boolean;
  includeDelete?: boolean;
  additionalActions?: MenuItem[];
  [key: string]: any;
}
