declare const _default: (options: {
    entityName: string;
    entityNamePlural: string;
    menuIndex?: number;
    icon?: string;
    excludeFromAdminList?: boolean;
    excludeFromAdminCreate?: boolean;
    menuGroup?: string;
    menuOrder?: number;
}) => {
    label: string;
    icon: string;
    key: number | undefined;
    children: {
        label: string;
        key: string;
        url: string;
    }[];
    group: string | undefined;
    order: number;
};
export default _default;
