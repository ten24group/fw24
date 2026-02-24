import { ListPageConfig } from "../../../ui-config-gen";

export const meiliSearchApiKeysPage: ListPageConfig = {
  pageTitle: "MeiliSearch API Keys",
  pageType: "list",
  routePattern: "/system/search/api-keys",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search" },
    { label: "API Keys" }
  ],
  pageHeaderActions: [
    { label: "Create API Key", url: "/system/search/create-api-keys", type: "button" }
  ],
  listPageConfig: {
    apiConfig: { apiMethod: "GET", responseKey: "items", apiUrl: "/system/search/api-keys" },
    propertiesConfig: [
      {
        name: "UID",
        dataIndex: "uid",
        id: "uid",
        fieldType: "text",
        isListable: true,
        isVisible: false,
        isFilterable: true,
        isIdentifier: true,
        filterConfig: {
          defaultOperator: "eq",
          availableOperators: ["eq", "in", "nin"],
          filterType: "text"
        },
        actions: [
          { icon: "view", label: "Details", url: "/system/search/api-keys/:uid" },
          { icon: "edit", label: "Edit", url: "/system/search/api-keys/:uid/edit" }
        ]
      },
      {
        name: "Name",
        dataIndex: "name",
        id: "name",
        fieldType: "text",
        isListable: true,
        isFilterable: true,
        filterConfig: {
          defaultOperator: "contains",
          availableOperators: ["contains", "eq", "startsWith", "in", "nin"],
          filterType: "text"
        }
      },
      {
        name: "Description",
        dataIndex: "description",
        id: "description",
        fieldType: "text",
        isListable: true,
        isFilterable: true,
        filterConfig: {
          defaultOperator: "contains",
          availableOperators: ["contains", "eq", "in", "nin"],
          filterType: "text"
        }
      },
      {
        name: "Actions",
        dataIndex: "actions",
        id: "actions",
        fieldType: "text",
        isListable: true,
        isFilterable: true,
        filterConfig: {
          defaultOperator: "in",
          availableOperators: ["in", "nin"],
          predefinedOptions: [
            { label: "Search", value: "search" },
            { label: "Documents Add", value: "documents.add" },
            { label: "Documents Get", value: "documents.get" },
            { label: "Documents Delete", value: "documents.delete" },
            { label: "Indexes Create", value: "indexes.create" },
            { label: "Indexes Get", value: "indexes.get" },
            { label: "Indexes Update", value: "indexes.update" },
            { label: "Indexes Delete", value: "indexes.delete" },
            { label: "Indexes Swap", value: "indexes.swap" },
            { label: "Tasks Get", value: "tasks.get" },
            { label: "Tasks Cancel", value: "tasks.cancel" },
            { label: "Tasks Delete", value: "tasks.delete" },
            { label: "Settings Get", value: "settings.get" },
            { label: "Settings Update", value: "settings.update" },
            { label: "Stats Get", value: "stats.get" },
            { label: "Dumps Create", value: "dumps.create" },
            { label: "All Actions", value: "*" }
          ],
          filterType: "select"
        }
      },
      {
        name: "Expires At",
        dataIndex: "expiresAt",
        id: "expiresAt",
        fieldType: "datetime",
        isListable: true,
        isFilterable: true,
        filterConfig: {
          defaultOperator: "gt",
          availableOperators: ["gt", "lt", "eq"],
          filterType: "datetime"
        }
      },
      {
        name: "Created At",
        dataIndex: "createdAt",
        id: "createdAt",
        fieldType: "datetime",
        isListable: true,
        isFilterable: true,
        filterConfig: {
          defaultOperator: "gt",
          availableOperators: ["gt", "lt", "eq"],
          filterType: "datetime"
        }
      },
      {
        name: "Updated At",
        dataIndex: "updatedAt",
        id: "updatedAt",
        fieldType: "datetime",
        isListable: true,
        isFilterable: true,
        filterConfig: {
          defaultOperator: "gt",
          availableOperators: ["gt", "lt", "eq"],
          filterType: "datetime"
        }
      }
    ]
  }
};