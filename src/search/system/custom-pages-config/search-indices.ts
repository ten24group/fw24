import { ListPageConfig } from "../../../ui-config-gen";

export const searchIndicesConfig: ListPageConfig = {
  pageTitle: "Search Indices",
  pageType: "list",
  routePattern: "/system/search/indices",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search" },
    { label: "Indices" }
  ],
  pageHeaderActions: [
    { label: "Initialize All Indices", url: "/system/search/initIndices", type: "button" }
  ],
  listPageConfig: {
    apiConfig: { apiMethod: "GET", responseKey: "indices", apiUrl: "/system/search/indices" },
    propertiesConfig: [
      { name: "Entity Name", dataIndex: "entityName", id: "entityName", fieldType: "text", isListable: true, isIdentifier: true },
      { name: "Index Name", dataIndex: "indexName", id: "indexName", fieldType: "text", isListable: true },
      { name: "Primary Key", dataIndex: "primaryKey", id: "primaryKey", fieldType: "text", isListable: true },
      { name: "Created At", dataIndex: "createdAt", id: "createdAt", fieldType: "datetime", isListable: true },
      { name: "Updated At", dataIndex: "updatedAt", id: "updatedAt", fieldType: "datetime", isListable: true },
      { name: "Error", dataIndex: "error", id: "error", fieldType: "text", isListable: true },
      {
        name: "Actions",
        dataIndex: "actions",
        id: "actions",
        fieldType: "text",
        isListable: true,
        actions: [
          { icon: "view", label: "Details", url: "/system/search/indices/:entityName" },
          { icon: "setting", label: "Settings", url: "/system/search/indices/:entityName/settings" },
          { icon: "reload", label: "Resync", url: "/system/search/indices/:entityName/resync" },
          { icon: "clear", label: "Clear Docs", url: "/system/search/indices/:entityName/documents" },
          { icon: "delete", label: "Delete", url: "/system/search/indices/:entityName", type: "delete" }
        ]
      }
    ]
  }
}; 