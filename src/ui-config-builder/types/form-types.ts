import { ApiConfig, PageConfig, PropertyConfig } from './index';

/**
 * Configuration for form pages (create/edit)
 */
export interface FormPageConfig extends PageConfig {
  pageType: 'form';
  formPageConfig: {
    apiConfig: ApiConfig;
    detailApiConfig?: ApiConfig; // Used for edit forms to get initial data
    formButtons: Array<'submit' | 'reset' | FormButton>;
    propertiesConfig: PropertyConfig[];
    submitSuccessRedirect?: string;
    formLayout?: 'horizontal' | 'vertical' | 'inline';
    formItemLayout?: {
      labelCol?: { span: number };
      wrapperCol?: { span: number };
    };
    formSections?: FormSection[];
    onSubmitHandler?: string; // Custom handler name if needed
    [key: string]: any;
  };
}

/**
 * Custom form button configuration
 */
export interface FormButton {
  text: string;
  url?: string;
  onClick?: string;
  icon?: string;
  type?: 'primary' | 'default' | 'dashed' | 'text' | 'link';
  [key: string]: any;
}

/**
 * Form section for grouping fields
 */
export interface FormSection {
  title: string;
  key: string;
  fields: string[]; // IDs of fields to include in this section
  collapsed?: boolean;
  description?: string;
  [key: string]: any;
}

/**
 * Create page specific configuration
 */
export interface CreatePageConfig extends FormPageConfig {
  // Additional create-specific options
  redirectAfterCreate?: string;
  showSuccessMessage?: boolean;
  successMessage?: string;
}

/**
 * Edit page specific configuration
 */
export interface EditPageConfig extends FormPageConfig {
  // Additional edit-specific options
  redirectAfterUpdate?: string;
  showSuccessMessage?: boolean;
  successMessage?: string;
  showDeleteButton?: boolean;
  deleteConfig?: {
    apiConfig: ApiConfig;
    confirmMessage?: string;
    redirectAfterDelete?: string;
  };
}
