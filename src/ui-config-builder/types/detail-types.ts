import { ApiConfig, PageConfig, PropertyConfig } from './index';

/**
 * Configuration for detail view pages
 */
export interface DetailPageConfig extends PageConfig {
  pageType: 'detail';
  detailPageConfig: {
    apiConfig: ApiConfig;
    propertiesConfig: PropertyConfig[];
    layout?: DetailLayout;
    sections?: DetailSection[];
    relatedEntities?: RelatedEntity[];
    [key: string]: any;
  };
}

/**
 * Layout types for detail pages
 */
export type DetailLayout = 'default' | 'two-column' | 'tabs' | 'sections' | 'descriptive';

/**
 * Detail page section configuration
 */
export interface DetailSection {
  title: string;
  key: string;
  fields: string[]; // IDs of fields to include in this section
  collapsed?: boolean;
  description?: string;
  icon?: string;
  colspan?: number;
  [key: string]: any;
}

/**
 * Related entity configuration for detail pages
 */
export interface RelatedEntity {
  entityName: string;
  title: string;
  relationField: string;
  displayType: 'table' | 'cards' | 'list';
  apiConfig: ApiConfig;
  propertiesConfig: PropertyConfig[];
  actions?: Array<{
    label: string;
    icon?: string;
    url?: string;
    [key: string]: any;
  }>;
  [key: string]: any;
}
