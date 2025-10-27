// Export all custom page types
export * from './templates/custom-page';

// Export commonly used types from base-entity
export type {
    ApiMethod,
    ModalType,
    IModalApiConfig,
    IConfirmModal,
    IEntityPageAction,
    IEntityPageActionModalConfig,
    INavigateToConfig,
    IResponseDisplayConfig,
    IEntityConfigReference,
    IRelationFieldConfig,
    IEntityPageColumn,
    IEntityPageColumnConfig,
    BaseFieldMetadata,
} from '../entity/base-entity';

// Export list entity types
export type {
    ListEntityPageOptions,
    ListingPropConfig,
} from './templates/list-entity';

// Export create entity types
export type {
    CreateEntityPageOptions,
} from './templates/create-entity';

// Export update entity types
export type {
    UpdateEntityPageOptions,
} from './templates/update-entity';

// Export view entity types
export type {
    ViewEntityPageOptions,
} from './templates/view-entity';
