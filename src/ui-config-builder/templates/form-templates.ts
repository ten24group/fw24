/**
 * Form templates for the UI Config Builder
 *
 * These templates provide pre-built configurations for common form patterns.
 * They use the FormBuilder internally for consistency.
 */

import { FormBuilder } from '../core/FormBuilder';
import { PropertyConfig } from '../types';

export interface FormTemplateOptions {
  entityName: string;
  title?: string;
  description?: string;
  fields: PropertyConfig[];
  showBackButton?: boolean;
  backUrl?: string;
  submitRedirect?: string;
  method?: 'POST' | 'PUT' | 'PATCH';
  url?: string;
  responseKey?: string;
}

/**
 * Creates a standard form configuration
 *
 * This creates a simple form with all fields in a single view.
 * It uses FormBuilder internally to ensure consistency with the builder pattern.
 *
 * @param options Configuration options for the form
 * @returns A form page configuration
 */
export function createStandardForm(options: FormTemplateOptions) {
  const {
    entityName,
    title,
    description,
    fields,
    showBackButton = true,
    backUrl,
    submitRedirect,
    method = 'POST',
    url,
    responseKey,
  } = options;

  const formBuilder = new FormBuilder(entityName);

  // Set basic properties
  formBuilder.setTitle(title || `Create ${entityName}`);

  if (description) {
    formBuilder.set('formPageConfig', {
      ...formBuilder.getConfig().formPageConfig,
      pageDescription: description,
    });
  }

  // Add all fields
  fields.forEach(field => {
    formBuilder.addProperty(field);
  });

  // Add back button if requested
  if (showBackButton) {
    formBuilder.addHeaderAction({
      label: 'Back',
      url: backUrl || `/list-${entityName.toLowerCase()}`,
    });
  }

  // Set API configurations
  formBuilder.set('formPageConfig', {
    ...formBuilder.getConfig().formPageConfig,
    apiConfig: {
      apiMethod: method,
      apiUrl: url || `/${entityName.toLowerCase()}`,
      responseKey: responseKey || entityName.toLowerCase(),
    },
  });

  // Set redirect on success
  if (submitRedirect) {
    formBuilder.setSubmitSuccessRedirect(submitRedirect);
  } else {
    formBuilder.setSubmitSuccessRedirect(`/list-${entityName.toLowerCase()}`);
  }

  return formBuilder.build();
}

/**
 * Creates a sectioned form configuration
 *
 * This creates a form with fields organized into collapsible sections.
 * It uses FormBuilder internally to ensure consistency with the builder pattern.
 *
 * @param options Configuration options for the form
 * @param sections Sections configuration for grouping fields
 * @returns A form page configuration with sections
 */
export function createSectionedForm(
  options: FormTemplateOptions,
  sections: Array<{
    title: string;
    description?: string;
    fieldIds: string[];
    collapsible?: boolean;
    defaultOpen?: boolean;
  }>,
) {
  const {
    entityName,
    title,
    description,
    fields,
    showBackButton = true,
    backUrl,
    submitRedirect,
    method = 'POST',
    url,
    responseKey,
  } = options;

  const formBuilder = new FormBuilder(entityName);

  // Set basic properties
  formBuilder.setTitle(title || `Create ${entityName}`);

  if (description) {
    formBuilder.set('formPageConfig', {
      ...formBuilder.getConfig().formPageConfig,
      pageDescription: description,
    });
  }

  // Add all fields to maintain the complete field list in the config
  fields.forEach(field => {
    formBuilder.addProperty(field);
  });

  // Add sections using the set method
  const formSections = sections.map(section => {
    const sectionFields = fields.filter(field => section.fieldIds.includes(field.id));

    return {
      title: section.title,
      description: section.description,
      collapsible: section.collapsible !== false,
      defaultOpen: section.defaultOpen !== false,
      fields: sectionFields,
    };
  });

  formBuilder.set('formPageConfig', {
    ...formBuilder.getConfig().formPageConfig,
    sections: formSections,
  });

  // Add back button if requested
  if (showBackButton) {
    formBuilder.addHeaderAction({
      label: 'Back',
      url: backUrl || `/list-${entityName.toLowerCase()}`,
    });
  }

  // Set API configurations
  formBuilder.set('formPageConfig', {
    ...formBuilder.getConfig().formPageConfig,
    apiConfig: {
      apiMethod: method,
      apiUrl: url || `/${entityName.toLowerCase()}`,
      responseKey: responseKey || entityName.toLowerCase(),
    },
  });

  // Set redirect on success
  if (submitRedirect) {
    formBuilder.setSubmitSuccessRedirect(submitRedirect);
  } else {
    formBuilder.setSubmitSuccessRedirect(`/list-${entityName.toLowerCase()}`);
  }

  return formBuilder.build();
}

/**
 * Creates an edit form template
 *
 * This creates a form for editing an existing entity with appropriate API configurations.
 * It uses FormBuilder internally to ensure consistency with the builder pattern.
 *
 * @param options Configuration options for the form
 * @returns An edit form page configuration
 */
export function createEditForm(options: FormTemplateOptions) {
  const {
    entityName,
    title,
    description,
    fields,
    showBackButton = true,
    backUrl,
    submitRedirect,
    url,
    responseKey,
  } = options;

  const formBuilder = new FormBuilder(entityName);

  // Set basic properties
  formBuilder.setTitle(title || `Edit ${entityName}`);

  if (description) {
    formBuilder.set('formPageConfig', {
      ...formBuilder.getConfig().formPageConfig,
      pageDescription: description,
    });
  }

  // Add all fields
  fields.forEach(field => {
    formBuilder.addProperty(field);
  });

  // Add back button if requested
  if (showBackButton) {
    formBuilder.addHeaderAction({
      label: 'Back',
      url: backUrl || `/list-${entityName.toLowerCase()}`,
    });
  }

  // Add delete button
  formBuilder.addHeaderAction({
    label: 'Delete',
    icon: 'delete',
    modalConfig: {
      modalType: 'confirm',
      modalPageConfig: {
        title: `Delete ${entityName}`,
        content: `Are you sure you want to delete this ${entityName.toLowerCase()}?`,
      },
      apiConfig: {
        apiMethod: 'DELETE',
        apiUrl: url || `/${entityName.toLowerCase()}/:id`,
      },
    },
  });

  // Set API configurations for update
  formBuilder.set('formPageConfig', {
    ...formBuilder.getConfig().formPageConfig,
    apiConfig: {
      apiMethod: 'PATCH',
      apiUrl: url || `/${entityName.toLowerCase()}/:id`,
      responseKey: responseKey || entityName.toLowerCase(),
    },
    detailApiConfig: {
      apiMethod: 'GET',
      apiUrl: url || `/${entityName.toLowerCase()}/:id`,
      responseKey: responseKey || entityName.toLowerCase(),
    },
  });

  // Set redirect on success
  if (submitRedirect) {
    formBuilder.setSubmitSuccessRedirect(submitRedirect);
  } else {
    formBuilder.setSubmitSuccessRedirect(`/list-${entityName.toLowerCase()}`);
  }

  return formBuilder.build();
}
