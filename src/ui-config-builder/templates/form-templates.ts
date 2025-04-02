/**
 * Form Templates for UI Config Builder
 */

import { Form, Field, Action, Page, Section } from '../components';
import { ComponentInstance } from '../types/common-types';
import { PropertyConfig } from '../types';

/**
 * Create a standard form template
 */
export function createStandardForm(options: {
  entityName: string;
  title?: string;
  description?: string;
  fields: PropertyConfig[];
  submitUrl?: string;
  submitRedirect?: string;
  showBackButton?: boolean;
  backUrl?: string;
}): ComponentInstance {
  const {
    entityName,
    title = `Create ${entityName}`,
    description,
    fields,
    submitUrl = `/${entityName.toLowerCase()}`,
    submitRedirect = `/list-${entityName.toLowerCase()}`,
    showBackButton = true,
    backUrl = `/list-${entityName.toLowerCase()}`,
  } = options;

  const actions = [];

  if (showBackButton) {
    actions.push(
      Action({
        label: 'Back',
        url: backUrl,
      }),
    );
  }

  return Page({
    title,
    pageType: 'form',
    description,
    actions,
    children: [
      Form({
        url: submitUrl,
        responseKey: entityName.toLowerCase(),
        submitRedirect,
        children: fields.map(field => Field(field)),
      }),
    ],
  });
}

/**
 * Create a sectioned form template
 */
export function createSectionedForm(options: {
  entityName: string;
  title?: string;
  description?: string;
  sections: Array<{
    title: string;
    key: string;
    fields: PropertyConfig[];
    collapsed?: boolean;
  }>;
  submitUrl?: string;
  submitRedirect?: string;
  showBackButton?: boolean;
  backUrl?: string;
}): ComponentInstance {
  const {
    entityName,
    title = `Create ${entityName}`,
    description,
    sections,
    submitUrl = `/${entityName.toLowerCase()}`,
    submitRedirect = `/list-${entityName.toLowerCase()}`,
    showBackButton = true,
    backUrl = `/list-${entityName.toLowerCase()}`,
  } = options;

  const actions = [];

  if (showBackButton) {
    actions.push(
      Action({
        label: 'Back',
        url: backUrl,
      }),
    );
  }

  return Page({
    title,
    pageType: 'form',
    description,
    actions,
    children: [
      Form({
        url: submitUrl,
        responseKey: entityName.toLowerCase(),
        submitRedirect,
        children: sections.map(section =>
          Section({
            title: section.title,
            key: section.key,
            collapsed: section.collapsed,
            children: section.fields.map(field => Field(field)),
          }),
        ),
      }),
    ],
  });
}

/**
 * Create a standard edit form template
 */
export function createEditForm(options: {
  entityName: string;
  idField?: string;
  title?: string;
  description?: string;
  fields: PropertyConfig[];
  submitUrl?: string;
  detailUrl?: string;
  submitRedirect?: string;
  showBackButton?: boolean;
  backUrl?: string;
  showDeleteButton?: boolean;
}): ComponentInstance {
  const {
    entityName,
    idField = 'id',
    title = `Edit ${entityName}`,
    description,
    fields,
    submitUrl = `/${entityName.toLowerCase()}/:${idField}`,
    detailUrl = `/${entityName.toLowerCase()}/:${idField}`,
    submitRedirect = `/list-${entityName.toLowerCase()}`,
    showBackButton = true,
    backUrl = `/list-${entityName.toLowerCase()}`,
    showDeleteButton = true,
  } = options;

  const actions = [];

  if (showBackButton) {
    actions.push(
      Action({
        label: 'Back',
        url: backUrl,
      }),
    );
  }

  if (showDeleteButton) {
    actions.push(
      Action({
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
          submitSuccessRedirect: `/list-${entityName.toLowerCase()}`,
        },
      }),
    );
  }

  return Page({
    title,
    pageType: 'form',
    description,
    actions,
    children: [
      Form({
        method: 'PATCH',
        url: submitUrl,
        responseKey: entityName.toLowerCase(),
        submitRedirect,
        detailApiConfig: {
          apiMethod: 'GET',
          apiUrl: detailUrl,
          responseKey: entityName.toLowerCase(),
        },
        children: fields.map(field => Field(field)),
      }),
    ],
  });
}
