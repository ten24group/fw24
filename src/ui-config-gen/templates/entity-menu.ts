import {  Schema } from "electrodb";

export default(
    options: {
        entityName: string,
        entityNamePlural: string,
        menuIndex?: number
        icon?: string,
    }
) => {

    let config = {
        label: `${options.entityNamePlural}`,
        icon: `${ options.icon || 'appStore' }`,
        key: options.menuIndex,
        children: [
            {
                label: `${options.entityName} List`,
                key: (options.menuIndex || 1) * 10 + 1,
                url: `/list-${options.entityName.toLowerCase()}`
            },
            {
                label: `Add New ${options.entityName}`,
                key: (options.menuIndex || 1) * 10 + 2,
                url: `/create-${options.entityName.toLowerCase()}`
            }
        ]
    };
    return config;
};