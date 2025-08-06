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
        isFilterable: true,
        isIdentifier: true,
        filterConfig: {
          defaultOperator: "eq",
          availableOperators: ["eq", "in", "nin"],
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
          defaultOperator: "eq",
          availableOperators: ["eq", "in", "nin"],
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
          defaultOperator: "eq",
          availableOperators: ["eq", "in", "nin"],
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