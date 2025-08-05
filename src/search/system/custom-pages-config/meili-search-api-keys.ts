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
    apiConfig: { apiMethod: "GET", responseKey: "results", apiUrl: "/system/search/api-keys" },
    propertiesConfig: [
      { 
        name: "UID", 
        dataIndex: "uid", 
        id: "uid", 
        fieldType: "text", 
        isListable: true, 
        isIdentifier: true,
        actions: [
          { icon: "view", label: "Details", url: "/system/search/api-keys/:uid" },
          { icon: "edit", label: "Edit", url: "/system/search/api-keys/:uid/edit" }
        ]
      },
      { name: "Name", dataIndex: "name", id: "name", fieldType: "text", isListable: true },
      { name: "Description", dataIndex: "description", id: "description", fieldType: "text", isListable: true },
      { name: "Expires At", dataIndex: "expiresAt", id: "expiresAt", fieldType: "datetime", isListable: true },
      { name: "Created At", dataIndex: "createdAt", id: "createdAt", fieldType: "datetime", isListable: true },
      { name: "Updated At", dataIndex: "updatedAt", id: "updatedAt", fieldType: "datetime", isListable: true }
    ]
  }
}; 