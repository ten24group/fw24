import { ListPageConfig } from "../../../ui-config-gen";

export const searchEntitiesConfig: ListPageConfig = {
  pageTitle: "Search Entities",
  pageType: "list",
  routePattern: "/system/search/entities",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search" },
    { label: "Entities" }
  ],
  listPageConfig: {
    apiConfig: { apiMethod: "GET", responseKey: "entities", apiUrl: "/system/search/entities" },
    propertiesConfig: [
      { 
        name: "Entity Name", 
        dataIndex: "entityName", 
        id: "entityName", 
        fieldType: "text", 
        isListable: true, 
        isIdentifier: true,
        actions: [
          { icon: "view", label: "View Records", url: "/system/search/records/:entityName" },
          { icon: "setting", label: "Index Details", url: "/system/search/indices/:entityName" }
        ]
      },
      { name: "Search Enabled", dataIndex: "searchEnabled", id: "searchEnabled", fieldType: "boolean", isListable: true },
      { name: "Index Exists", dataIndex: "indexExists", id: "indexExists", fieldType: "boolean", isListable: true },
      { name: "Index Name", dataIndex: "indexName", id: "indexName", fieldType: "text", isListable: true },
      { name: "Error", dataIndex: "error", id: "error", fieldType: "text", isListable: true }
    ]
  }
}; 