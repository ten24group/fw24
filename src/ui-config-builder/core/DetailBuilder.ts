import { BaseBuilder } from './BaseBuilder';
import { ApiConfig, PageHeaderAction, PropertyConfig } from '../types';
import { DetailPageConfig, DetailSection, RelatedEntity, DetailLayout } from '../types/detail-types';

/**
 * Builder for detail page configurations
 */
export class DetailBuilder extends BaseBuilder<DetailPageConfig> {
  constructor(entityName: string, initialConfig?: Partial<DetailPageConfig>) {
    super({
      pageTitle: `${entityName} Details`,
      pageType: 'detail',
      detailPageConfig: {
        apiConfig: {
          apiMethod: 'GET',
          apiUrl: `/${entityName.toLowerCase()}`,
          responseKey: entityName.toLowerCase(),
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
  public setCardStyle(style: DetailPageConfig['cardStyle']): this {
    return this.set('cardStyle', style);
  }

  /**
   * Set breadcrumbs
   */
  public setBreadcrumbs(breadcrums: DetailPageConfig['breadcrums']): this {
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
   * Set the API configuration for the detail view
   */
  public setApiConfig(apiConfig: ApiConfig): this {
    return this.set('detailPageConfig', {
      ...this.config.detailPageConfig,
      apiConfig,
    });
  }

  /**
   * Set detail properties configuration
   */
  public setProperties(properties: PropertyConfig[]): this {
    return this.set('detailPageConfig', {
      ...this.config.detailPageConfig,
      propertiesConfig: properties,
    });
  }

  /**
   * Add a detail property
   */
  public addProperty(property: PropertyConfig): this {
    const properties = [...this.config.detailPageConfig.propertiesConfig];
    properties.push(property);
    return this.set('detailPageConfig', {
      ...this.config.detailPageConfig,
      propertiesConfig: properties,
    });
  }

  /**
   * Set layout type
   */
  public setLayout(layout: DetailLayout): this {
    return this.set('detailPageConfig', {
      ...this.config.detailPageConfig,
      layout,
    });
  }

  /**
   * Set sections
   */
  public setSections(sections: DetailSection[]): this {
    return this.set('detailPageConfig', {
      ...this.config.detailPageConfig,
      sections,
    });
  }

  /**
   * Add a section
   */
  public addSection(section: DetailSection): this {
    const sections = [...(this.config.detailPageConfig.sections || [])];
    sections.push(section);
    return this.set('detailPageConfig', {
      ...this.config.detailPageConfig,
      sections,
    });
  }

  /**
   * Set related entities
   */
  public setRelatedEntities(relatedEntities: RelatedEntity[]): this {
    return this.set('detailPageConfig', {
      ...this.config.detailPageConfig,
      relatedEntities,
    });
  }

  /**
   * Add a related entity
   */
  public addRelatedEntity(relatedEntity: RelatedEntity): this {
    const relatedEntities = [...(this.config.detailPageConfig.relatedEntities || [])];
    relatedEntities.push(relatedEntity);
    return this.set('detailPageConfig', {
      ...this.config.detailPageConfig,
      relatedEntities,
    });
  }

  /**
   * Add default edit action
   */
  public addDefaultEditAction(entityName: string, idField: string = 'id'): this {
    return this.addHeaderAction({
      label: 'Edit',
      icon: 'edit',
      url: `/edit-${entityName.toLowerCase()}/:${idField}`,
    });
  }

  /**
   * Add default delete action
   */
  public addDefaultDeleteAction(entityName: string, idField: string = 'id'): this {
    return this.addHeaderAction({
      label: 'Delete',
      icon: 'delete',
      openInModal: true,
      modalConfig: {
        modalType: 'confirm',
        modalPageConfig: {
          title: `Delete ${entityName}`,
          content: `Are you sure you want to delete this ${entityName}?`,
        },
        apiConfig: {
          apiMethod: 'DELETE',
          apiUrl: `/${entityName.toLowerCase()}/:${idField}`,
        },
      },
    });
  }

  /**
   * Add default back to list action
   */
  public addDefaultBackToListAction(entityName: string): this {
    return this.addHeaderAction({
      label: 'Back to List',
      icon: 'arrowLeft',
      url: `/list-${entityName.toLowerCase()}`,
    });
  }

  /**
   * Validate the detail configuration
   */
  protected validate(): void {
    if (!this.config.pageTitle) {
      throw new Error('Detail configuration must have a pageTitle');
    }

    if (!this.config.detailPageConfig.apiConfig.apiUrl) {
      throw new Error('Detail configuration must have an apiUrl');
    }

    if (!this.config.detailPageConfig.apiConfig.apiMethod) {
      throw new Error('Detail configuration must have an apiMethod');
    }

    if (this.config.detailPageConfig.propertiesConfig.length === 0) {
      throw new Error('Detail configuration must have at least one property');
    }
  }
}
