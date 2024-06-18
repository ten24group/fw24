import { toHumanReadableName } from "../../utils";

export default(
    options: {
        entityName: string,
        entityNamePlural: string,
        menuIndex?: number
        icon?: string,
    }
) => {

    let config = {
        label: `${toHumanReadableName(options.entityNamePlural)}`,
        icon: `${ options.icon || 'appStore' }`,
        key: options.menuIndex,
        children: [
            {
                label: `${toHumanReadableName(options.entityName)} List`,
                key: (options.menuIndex || 1) * 10 + 1,
                url: `/list-${options.entityName.toLowerCase()}`
            },
            {
                label: `Add New ${toHumanReadableName(options.entityName)}`,
                key: (options.menuIndex || 1) * 10 + 2,
                url: `/create-${options.entityName.toLowerCase()}`
            }
        ]
    };
    return config;
};