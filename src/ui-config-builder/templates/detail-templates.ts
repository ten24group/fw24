/**
 * Detail templates for the UI Config Builder
 *
 * These templates provide pre-built configurations for common detail view patterns.
 * They use the DetailBuilder internally for consistency.
 */

import { DetailBuilder } from '../core/DetailBuilder';
import { PropertyConfig, DetailSection, RelatedEntity } from '../types';

export interface DetailTemplateOptions {
  entityName: string;
  title?: string;
  description?: string;
  fields: PropertyConfig[];
  showBackButton?: boolean;
  backUrl?: string;
  showEditButton?: boolean;
  editUrl?: string;
  showDeleteButton?: boolean;
  idField?: string;
  url?: string;
  responseKey?: string;
}

/**
 * Creates a standard detail view configuration
 *
 * This creates a simple detail view with all fields in a single view.
 * It uses DetailBuilder internally to ensure consistency with the builder pattern.
 *
 * @param options Configuration options for the detail view
 * @returns A detail page configuration
 */
export function createStandardDetailView(options: DetailTemplateOptions) {
  const {
    entityName,
    title,
    description,
    fields,
    showBackButton = true,
    backUrl,
    showEditButton = true,
    editUrl,
    showDeleteButton = true,
    idField = 'id',
    url,
    responseKey,
  } = options;

  const detailBuilder = new DetailBuilder(entityName);

  // Set basic properties
  detailBuilder.setTitle(title || `${entityName} Details`);

  if (description) {
    detailBuilder.set('detailPageConfig', {
      ...detailBuilder.getConfig().detailPageConfig,
      pageDescription: description,
    });
  }

  // Add all fields
  fields.forEach(field => {
    detailBuilder.addProperty(field);
  });

  // Add back button if requested
  if (showBackButton) {
    detailBuilder.addHeaderAction({
      label: 'Back',
      url: backUrl || `/list-${entityName.toLowerCase()}`,
    });
  }

  // Add edit button if requested
  if (showEditButton) {
    detailBuilder.addHeaderAction({
      label: 'Edit',
      icon: 'edit',
      url: editUrl || `/edit-${entityName.toLowerCase()}/:${idField}`,
    });
  }

  // Add delete button if requested
  if (showDeleteButton) {
    detailBuilder.addHeaderAction({
      label: 'Delete',
      icon: 'delete',
      openInModal: true,
      modalConfig: {
        modalType: 'confirm',
        modalPageConfig: {
          title: `Delete ${entityName}`,
          content: `Are you sure you want to delete this ${entityName.toLowerCase()}?`,
        },
        apiConfig: {
          apiMethod: 'DELETE',
          apiUrl: `/${entityName.toLowerCase()}/:${idField}`,
        },
        submitSuccessRedirect: `/list-${entityName.toLowerCase()}`,
      },
    });
  }

  // Set API configurations
  detailBuilder.set('detailPageConfig', {
    ...detailBuilder.getConfig().detailPageConfig,
    apiConfig: {
      apiMethod: 'GET',
      apiUrl: url || `/${entityName.toLowerCase()}/:${idField}`,
      responseKey: responseKey || entityName.toLowerCase(),
    },
  });

  return detailBuilder.build();
}

/**
 * Creates a sectioned detail view configuration
 *
 * This creates a detail view with fields organized into collapsible sections.
 * It uses DetailBuilder internally to ensure consistency with the builder pattern.
 *
 * @param options Configuration options for the detail view
 * @param sections Sections configuration for grouping fields
 * @returns A detail page configuration with sections
 */
export function createSectionedDetailView(
  options: DetailTemplateOptions,
  sections: Array<{
    title: string;
    key: string;
    description?: string;
    fieldIds: string[];
    collapsed?: boolean;
    icon?: string;
  }>,
) {
  const {
    entityName,
    title,
    description,
    fields,
    showBackButton = true,
    backUrl,
    showEditButton = true,
    editUrl,
    showDeleteButton = true,
    idField = 'id',
    url,
    responseKey,
  } = options;

  const detailBuilder = new DetailBuilder(entityName);

  // Set basic properties
  detailBuilder.setTitle(title || `${entityName} Details`);

  if (description) {
    detailBuilder.set('detailPageConfig', {
      ...detailBuilder.getConfig().detailPageConfig,
      pageDescription: description,
    });
  }

  // Add all fields to maintain the complete field list in the config
  fields.forEach(field => {
    detailBuilder.addProperty(field);
  });

  // Add sections
  const detailSections: DetailSection[] = sections.map(section => {
    const sectionFields = fields.filter(field => section.fieldIds.includes(field.id));

    return {
      title: section.title,
      key: section.key,
      description: section.description,
      collapsed: section.collapsed,
      icon: section.icon,
      fields: sectionFields.map(field => field.id), // Convert field objects to IDs
    };
  });

  detailBuilder.set('detailPageConfig', {
    ...detailBuilder.getConfig().detailPageConfig,
    sections: detailSections,
  });

  // Add back button if requested
  if (showBackButton) {
    detailBuilder.addHeaderAction({
      label: 'Back',
      url: backUrl || `/list-${entityName.toLowerCase()}`,
    });
  }

  // Add edit button if requested
  if (showEditButton) {
    detailBuilder.addHeaderAction({
      label: 'Edit',
      icon: 'edit',
      url: editUrl || `/edit-${entityName.toLowerCase()}/:${idField}`,
    });
  }

  // Add delete button if requested
  if (showDeleteButton) {
    detailBuilder.addHeaderAction({
      label: 'Delete',
      icon: 'delete',
      openInModal: true,
      modalConfig: {
        modalType: 'confirm',
        modalPageConfig: {
          title: `Delete ${entityName}`,
          content: `Are you sure you want to delete this ${entityName.toLowerCase()}?`,
        },
        apiConfig: {
          apiMethod: 'DELETE',
          apiUrl: `/${entityName.toLowerCase()}/:${idField}`,
        },
        submitSuccessRedirect: `/list-${entityName.toLowerCase()}`,
      },
    });
  }

  // Set API configurations
  detailBuilder.set('detailPageConfig', {
    ...detailBuilder.getConfig().detailPageConfig,
    apiConfig: {
      apiMethod: 'GET',
      apiUrl: url || `/${entityName.toLowerCase()}/:${idField}`,
      responseKey: responseKey || entityName.toLowerCase(),
    },
  });

  return detailBuilder.build();
}

/**
 * Creates a detail view with related entities
 *
 * This creates a detail view that shows the main entity details and related entities.
 * It uses DetailBuilder internally to ensure consistency with the builder pattern.
 *
 * @param options Configuration options for the detail view
 * @param relatedEntities Related entities to display
 * @returns A detail page configuration with related entities
 */
export function createDetailViewWithRelated(
  options: DetailTemplateOptions,
  relatedEntities: Array<{
    entityName: string;
    title?: string;
    relationPath: string;
    displayFields: string[];
    displayType?: 'table' | 'cards' | 'list';
    actions?: Array<{
      label: string;
      icon?: string;
      url: string;
    }>;
  }>,
) {
  // Create a standard detail view as base
  const baseConfig = createStandardDetailView(options);

  // Add related entities configuration
  if (relatedEntities && relatedEntities.length > 0) {
    const detailPageConfig = baseConfig.detailPageConfig || {};

    detailPageConfig.relatedEntities = relatedEntities.map(related => {
      const relatedEntity: RelatedEntity = {
        entityName: related.entityName,
        title: related.title || `Related ${related.entityName}`,
        relationField: related.relationPath,
        displayType: related.displayType || 'table',
        apiConfig: {
          apiMethod: 'GET',
          apiUrl: `/${related.entityName.toLowerCase()}?${related.relationPath}=:id`,
        },
        propertiesConfig: related.displayFields.map(field => ({
          id: field,
          name: field,
          label: field,
          type: 'string',
          fieldType: 'text',
          column: field,
        })),
        actions: related.actions || [],
      };

      return relatedEntity;
    });

    // Update the configuration
    baseConfig.detailPageConfig = detailPageConfig;
  }

  return baseConfig;
}
