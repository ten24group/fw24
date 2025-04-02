import { BaseBuilder } from './BaseBuilder';
import { ApiConfig, PropertyConfig, PageHeaderAction } from '../types';
import { FormPageConfig, FormButton, FormSection } from '../types/form-types';

/**
 * Builder for form page configurations
 */
export class FormBuilder extends BaseBuilder<FormPageConfig> {
  constructor(entityName: string, initialConfig?: Partial<FormPageConfig>) {
    super({
      pageTitle: `Form for ${entityName}`,
      pageType: 'form',
      formPageConfig: {
        apiConfig: {
          apiMethod: 'POST',
          apiUrl: `/${entityName.toLowerCase()}`,
          responseKey: entityName.toLowerCase(),
        },
        formButtons: ['submit', 'reset'],
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
  public setCardStyle(style: FormPageConfig['cardStyle']): this {
    return this.set('cardStyle', style);
  }

  /**
   * Set breadcrumbs
   */
  public setBreadcrumbs(breadcrums: FormPageConfig['breadcrums']): this {
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
   * Set the API configuration for the form
   */
  public setApiConfig(apiConfig: ApiConfig): this {
    return this.set('formPageConfig', {
      ...this.config.formPageConfig,
      apiConfig,
    });
  }

  /**
   * Set the detail API configuration for edit forms
   */
  public setDetailApiConfig(detailApiConfig: ApiConfig): this {
    return this.set('formPageConfig', {
      ...this.config.formPageConfig,
      detailApiConfig,
    });
  }

  /**
   * Set form buttons
   */
  public setFormButtons(buttons: Array<'submit' | 'reset' | FormButton>): this {
    return this.set('formPageConfig', {
      ...this.config.formPageConfig,
      formButtons: buttons,
    });
  }

  /**
   * Add a form button
   */
  public addFormButton(button: 'submit' | 'reset' | FormButton): this {
    const buttons = [...this.config.formPageConfig.formButtons];
    buttons.push(button);
    return this.set('formPageConfig', {
      ...this.config.formPageConfig,
      formButtons: buttons,
    });
  }

  /**
   * Set form properties configuration
   */
  public setProperties(properties: PropertyConfig[]): this {
    return this.set('formPageConfig', {
      ...this.config.formPageConfig,
      propertiesConfig: properties,
    });
  }

  /**
   * Add a form property
   */
  public addProperty(property: PropertyConfig): this {
    const properties = [...this.config.formPageConfig.propertiesConfig];
    properties.push(property);
    return this.set('formPageConfig', {
      ...this.config.formPageConfig,
      propertiesConfig: properties,
    });
  }

  /**
   * Set submit success redirect
   */
  public setSubmitSuccessRedirect(url: string): this {
    return this.set('formPageConfig', {
      ...this.config.formPageConfig,
      submitSuccessRedirect: url,
    });
  }

  /**
   * Set form layout
   */
  public setFormLayout(layout: 'horizontal' | 'vertical' | 'inline'): this {
    return this.set('formPageConfig', {
      ...this.config.formPageConfig,
      formLayout: layout,
    });
  }

  /**
   * Set form item layout
   */
  public setFormItemLayout(layout: FormPageConfig['formPageConfig']['formItemLayout']): this {
    return this.set('formPageConfig', {
      ...this.config.formPageConfig,
      formItemLayout: layout,
    });
  }

  /**
   * Set form sections
   */
  public setFormSections(sections: FormSection[]): this {
    return this.set('formPageConfig', {
      ...this.config.formPageConfig,
      formSections: sections,
    });
  }

  /**
   * Add a form section
   */
  public addFormSection(section: FormSection): this {
    const sections = [...(this.config.formPageConfig.formSections || [])];
    sections.push(section);
    return this.set('formPageConfig', {
      ...this.config.formPageConfig,
      formSections: sections,
    });
  }

  /**
   * Set custom submit handler
   */
  public setSubmitHandler(handlerName: string): this {
    return this.set('formPageConfig', {
      ...this.config.formPageConfig,
      onSubmitHandler: handlerName,
    });
  }

  /**
   * Validate the form configuration
   */
  protected validate(): void {
    if (!this.config.pageTitle) {
      throw new Error('Form configuration must have a pageTitle');
    }

    if (!this.config.formPageConfig.apiConfig.apiUrl) {
      throw new Error('Form configuration must have an apiUrl');
    }

    if (!this.config.formPageConfig.apiConfig.apiMethod) {
      throw new Error('Form configuration must have an apiMethod');
    }

    if (this.config.formPageConfig.propertiesConfig.length === 0) {
      throw new Error('Form configuration must have at least one property');
    }
  }
}
