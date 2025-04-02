import { BaseBuilder } from './BaseBuilder';
import { ApiConfig, PageHeaderAction, PropertyConfig } from '../types';
import {
  ListPageConfig,
  RowAction,
  TableConfig,
  FilterConfig,
  SearchConfig,
  PaginationConfig,
} from '../types/list-types';

/**
 * Builder for list page configurations
 */
export class ListBuilder extends BaseBuilder<ListPageConfig> {
  constructor(entityName: string, initialConfig?: Partial<ListPageConfig>) {
    super({
      pageTitle: `${entityName} Listing`,
      pageType: 'list',
      listPageConfig: {
        apiConfig: {
          apiMethod: 'GET',
          apiUrl: `/${entityName.toLowerCase()}`,
          responseKey: 'items',
        },
        propertiesConfig: [],
      },
      ...initialConfig,
    });
  }

  /**
   * Set the page title
   */
  public setTitle(title: string): this {
    return this.set('pageTitle', title);
  }

  /**
   * Set the card style
   */
  public setCardStyle(style: ListPageConfig['cardStyle']): this {
    return this.set('cardStyle', style);
  }

  /**
   * Set breadcrumbs
   */
  public setBreadcrumbs(breadcrums: ListPageConfig['breadcrums']): this {
    return this.set('breadcrums', breadcrums);
  }

  /**
   * Add a breadcrumb
   */
  public addBreadcrumb(label: string, url: string): this {
    const breadcrums = [...(this.config.breadcrums || [])];
    breadcrums.push({ label, url });
    return this.set('breadcrums', breadcrums);
  }

  /**
   * Set page header actions
   */
  public setHeaderActions(actions: PageHeaderAction[]): this {
    return this.set('pageHeaderActions', actions);
  }

  /**
   * Add a page header action
   */
  public addHeaderAction(action: PageHeaderAction): this {
    const actions = [...(this.config.pageHeaderActions || [])];
    actions.push(action);
    return this.set('pageHeaderActions', actions);
  }

  /**
   * Set the API configuration for the list
   */
  public setApiConfig(apiConfig: ApiConfig): this {
    return this.set('listPageConfig', {
      ...this.config.listPageConfig,
      apiConfig,
    });
  }

  /**
   * Set list properties configuration
   */
  public setProperties(properties: PropertyConfig[]): this {
    return this.set('listPageConfig', {
      ...this.config.listPageConfig,
      propertiesConfig: properties,
    });
  }

  /**
   * Add a list property
   */
  public addProperty(property: PropertyConfig): this {
    const properties = [...this.config.listPageConfig.propertiesConfig];
    properties.push(property);
    return this.set('listPageConfig', {
      ...this.config.listPageConfig,
      propertiesConfig: properties,
    });
  }

  /**
   * Set row actions
   */
  public setRowActions(actions: RowAction[]): this {
    return this.set('listPageConfig', {
      ...this.config.listPageConfig,
      rowActions: actions,
    });
  }

  /**
   * Add a row action
   */
  public addRowAction(action: RowAction): this {
    const actions = [...(this.config.listPageConfig.rowActions || [])];
    actions.push(action);
    return this.set('listPageConfig', {
      ...this.config.listPageConfig,
      rowActions: actions,
    });
  }

  /**
   * Set table configuration
   */
  public setTableConfig(tableConfig: TableConfig): this {
    return this.set('listPageConfig', {
      ...this.config.listPageConfig,
      tableConfig,
    });
  }

  /**
   * Set filter configuration
   */
  public setFilterConfig(filterConfig: FilterConfig): this {
    return this.set('listPageConfig', {
      ...this.config.listPageConfig,
      filterConfig,
    });
  }

  /**
   * Set search configuration
   */
  public setSearchConfig(searchConfig: SearchConfig): this {
    return this.set('listPageConfig', {
      ...this.config.listPageConfig,
      searchConfig,
    });
  }

  /**
   * Set pagination configuration
   */
  public setPaginationConfig(paginationConfig: PaginationConfig): this {
    return this.set('listPageConfig', {
      ...this.config.listPageConfig,
      paginationConfig,
    });
  }

  /**
   * Configure default view action
   */
  public addDefaultViewAction(entityName: string, idField: string = 'id'): this {
    return this.addRowAction({
      label: 'View',
      icon: 'eye',
      url: `/view-${entityName.toLowerCase()}`,
      urlParams: [idField],
    });
  }

  /**
   * Configure default edit action
   */
  public addDefaultEditAction(entityName: string, idField: string = 'id'): this {
    return this.addRowAction({
      label: 'Edit',
      icon: 'edit',
      url: `/edit-${entityName.toLowerCase()}`,
      urlParams: [idField],
    });
  }

  /**
   * Configure default delete action
   */
  public addDefaultDeleteAction(entityName: string, idField: string = 'id'): this {
    return this.addRowAction({
      label: 'Delete',
      icon: 'delete',
      openInModal: true,
      modalConfig: {
        title: `Delete ${entityName}`,
        content: `Are you sure you want to delete this ${entityName}?`,
        apiConfig: {
          apiMethod: 'DELETE',
          apiUrl: `/${entityName.toLowerCase()}/:${idField}`,
        },
      },
    });
  }

  /**
   * Add all default CRUD actions
   */
  public addDefaultCrudActions(entityName: string, idField: string = 'id'): this {
    this.addDefaultViewAction(entityName, idField);
    this.addDefaultEditAction(entityName, idField);
    this.addDefaultDeleteAction(entityName, idField);
    return this;
  }

  /**
   * Validate the list configuration
   */
  protected validate(): void {
    if (!this.config.pageTitle) {
      throw new Error('List configuration must have a pageTitle');
    }

    if (!this.config.listPageConfig.apiConfig.apiUrl) {
      throw new Error('List configuration must have an apiUrl');
    }

    if (!this.config.listPageConfig.apiConfig.apiMethod) {
      throw new Error('List configuration must have an apiMethod');
    }

    if (this.config.listPageConfig.propertiesConfig.length === 0) {
      throw new Error('List configuration must have at least one property');
    }
  }
}
