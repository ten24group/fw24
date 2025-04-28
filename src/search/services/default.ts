import { BaseSearchService } from './base';
import { EntitySchema, EntityRecordTypeFromSchema } from '../../entity';

export class DefaultSearchService<S extends EntitySchema<any, any, any>> extends BaseSearchService<S> {
  async transformDocumentForIndexing(entity: EntityRecordTypeFromSchema<S>): Promise<Record<string, any>> {
    const schema = this.entityService.getEntitySchema();
    const searchConfig = schema.model.search;

    // Use schema-defined transformer if available
    if (searchConfig?.documentTransformer) {
      return searchConfig.documentTransformer(entity);
    }

    // Default transformation
    const document: Record<string, any> = { ...entity };

    // Handle searchable relations if defined
    const searchableRelations = searchConfig?.config.settings?.searchableAttributes
      ?.filter(attr => attr.includes('.')) || [];

    for (const relation of searchableRelations) {
      const [ relationName, field ] = relation.split('.');
      if (entity[ relationName ]) {
        document[ relation ] = entity[ relationName ][ field ];
      }
    }

    return document;
  }
} 