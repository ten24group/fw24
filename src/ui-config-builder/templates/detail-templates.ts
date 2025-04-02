/**
 * Detail Templates for UI Config Builder
 */

import { DetailView, Action, Page, Section } from '../components';
import { ComponentInstance } from '../types/common-types';
import { PropertyConfig } from '../types';
import { DetailLayout, RelatedEntity } from '../types/detail-types';

/**
 * Create a standard detail view template
 */
export function createStandardDetailView(options: {
  entityName: string;
  title?: string;
  description?: string;
  fields: PropertyConfig[];
  detailUrl?: string;
  responseKey?: string;
  showBackButton?: boolean;
  backUrl?: string;
  showEditButton?: boolean;
  editUrl?: string;
  showDeleteButton?: boolean;
  layout?: DetailLayout;
}): ComponentInstance {
  const {
    entityName,
    title = `${entityName} Details`,
    description,
    fields,
    detailUrl = `/${entityName.toLowerCase()}/:id`,
    responseKey = entityName.toLowerCase(),
    showBackButton = true,
    backUrl = `/list-${entityName.toLowerCase()}`,
    showEditButton = true,
    editUrl = `/edit-${entityName.toLowerCase()}/:id`,
    showDeleteButton = true,
    layout = 'default',
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

  if (showEditButton) {
    actions.push(
      Action({
        label: 'Edit',
        icon: 'edit',
        url: editUrl,
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
            apiUrl: `/${entityName.toLowerCase()}/:id`,
          },
          submitSuccessRedirect: `/list-${entityName.toLowerCase()}`,
        },
      }),
    );
  }

  return Page({
    title,
    pageType: 'detail',
    description,
    actions,
    children: [
      DetailView({
        url: detailUrl,
        responseKey,
        layout,
        children: fields.map(field => ({
          ...field,
        })),
      }),
    ],
  });
}

/**
 * Create a sectioned detail view template
 */
export function createSectionedDetailView(options: {
  entityName: string;
  title?: string;
  description?: string;
  sections: Array<{
    title: string;
    key: string;
    fields: PropertyConfig[];
    collapsed?: boolean;
    icon?: string;
  }>;
  detailUrl?: string;
  responseKey?: string;
  showBackButton?: boolean;
  backUrl?: string;
  showEditButton?: boolean;
  editUrl?: string;
  showDeleteButton?: boolean;
}): ComponentInstance {
  const {
    entityName,
    title = `${entityName} Details`,
    description,
    sections,
    detailUrl = `/${entityName.toLowerCase()}/:id`,
    responseKey = entityName.toLowerCase(),
    showBackButton = true,
    backUrl = `/list-${entityName.toLowerCase()}`,
    showEditButton = true,
    editUrl = `/edit-${entityName.toLowerCase()}/:id`,
    showDeleteButton = true,
  } = options;

  const detailComponent = createStandardDetailView({
    entityName,
    title,
    description,
    fields: [], // We'll add fields through sections
    detailUrl,
    responseKey,
    showBackButton,
    backUrl,
    showEditButton,
    editUrl,
    showDeleteButton,
    layout: 'sections',
  });

  // Find the DetailView component and add sections
  if (detailComponent.children && detailComponent.children.length > 0) {
    const firstChild = detailComponent.children[0];
    if (typeof firstChild !== 'string' && firstChild.type === 'DetailView') {
      firstChild.children = sections.map(section =>
        Section({
          title: section.title,
          key: section.key,
          collapsed: section.collapsed,
          icon: section.icon,
          children: section.fields.map(field => ({
            ...field,
          })),
        }),
      );
    }
  }

  return detailComponent;
}

/**
 * Create a detail view with related entities
 */
export function createDetailViewWithRelations(options: {
  entityName: string;
  title?: string;
  description?: string;
  fields: PropertyConfig[];
  relatedEntities: RelatedEntity[];
  detailUrl?: string;
  responseKey?: string;
  showBackButton?: boolean;
  backUrl?: string;
  showEditButton?: boolean;
  editUrl?: string;
  showDeleteButton?: boolean;
  layout?: DetailLayout;
}): ComponentInstance {
  const {
    entityName,
    title = `${entityName} Details`,
    description,
    fields,
    relatedEntities,
    detailUrl = `/${entityName.toLowerCase()}/:id`,
    responseKey = entityName.toLowerCase(),
    showBackButton = true,
    backUrl = `/list-${entityName.toLowerCase()}`,
    showEditButton = true,
    editUrl = `/edit-${entityName.toLowerCase()}/:id`,
    showDeleteButton = true,
    layout = 'default',
  } = options;

  const detailComponent = createStandardDetailView({
    entityName,
    title,
    description,
    fields,
    detailUrl,
    responseKey,
    showBackButton,
    backUrl,
    showEditButton,
    editUrl,
    showDeleteButton,
    layout,
  });

  // Find the DetailView component and add related entities
  if (detailComponent.children && detailComponent.children.length > 0) {
    const firstChild = detailComponent.children[0];
    if (typeof firstChild !== 'string' && firstChild.type === 'DetailView') {
      firstChild.props.relatedEntities = relatedEntities;
    }
  }

  return detailComponent;
}
