import { BaseEntityService, EntitySchema, TIOSchemaAttributesMap } from '../../entity';
import { camelCase, pascalCase } from '../../utils';
import { formatEntityAttributesForCreate } from './util';

export type CreateEntityPageOptions<
  S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>,
> = {
  entityName: string;
  entityNamePlural: string;
  properties: TIOSchemaAttributesMap<S>;
};

export default <S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>>(
  options: CreateEntityPageOptions<S>,
  entityService: BaseEntityService<S>,
) => {
  const { entityName } = options;
  const entityNameLower = entityName.toLowerCase();
  const entityNamePascalCase = pascalCase(entityName);

  const formPageConfig = makeCreateEntityFormConfig(options, entityService);

  return {
    pageTitle: `Create ${entityNamePascalCase}`,
    pageType: 'form',
    cardStyle: {
      width: '50%',
    },
    breadcrums: [],
    pageHeaderActions: [
      {
        label: 'Back',
        url: `/list-${entityNameLower}`,
      },
    ],
    formPageConfig: {
      ...formPageConfig,
      formButtons: [
        'submit',
        'reset',
        {
          text: 'Cancel',
          url: `/list-${entityNameLower}`,
        },
      ],
      submitSuccessRedirect: `/list-${entityNameLower}`,
    },
  };
};

export function makeCreateEntityFormConfig<
  S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>,
>(options: CreateEntityPageOptions<S>, entityService: BaseEntityService<S>) {
  const { entityName, properties } = options;
  const entityNameLower = entityName.toLowerCase();
  const entityNameCamel = camelCase(entityName);

  const formPageConfig = {
    apiConfig: {
      apiMethod: `POST`,
      responseKey: entityNameCamel,
      apiUrl: `/${entityNameLower}`,
    },
    formButtons: ['submit', 'reset'],
    propertiesConfig: [] as any[],
  };

  const formattedProps = formatEntityAttributesForCreate(Array.from(properties.values()), entityService);

  formPageConfig.propertiesConfig.push(...formattedProps);

  return formPageConfig;
}
