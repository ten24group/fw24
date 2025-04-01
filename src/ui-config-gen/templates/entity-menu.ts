import { toHumanReadableName } from '../../utils';

export default (options: {
  entityName: string;
  entityNamePlural: string;
  menuIndex?: number;
  icon?: string;
  excludeFromAdminList?: boolean;
  excludeFromAdminCreate?: boolean;
}) => {
  const children = [];

  if (!options.excludeFromAdminList) {
    children.push({
      label: `${toHumanReadableName(options.entityName)} List`,
      key: (options.menuIndex || 1) * 10 + 1,
      url: `/list-${options.entityName.toLowerCase()}`,
    });
  }

  if (!options.excludeFromAdminCreate) {
    children.push({
      label: `Add New ${toHumanReadableName(options.entityName)}`,
      key: (options.menuIndex || 1) * 10 + 2,
      url: `/create-${options.entityName.toLowerCase()}`,
    });
  }

  const config = {
    label: `${toHumanReadableName(options.entityNamePlural)}`,
    icon: `${options.icon || 'appStore'}`,
    key: options.menuIndex,
    children,
  };
  return config;
};
