import { ListPageConfig } from "../../../ui-config-gen";

export const searchRecordsConfig: ListPageConfig = {
  pageTitle: "Search Records",
  pageType: "list",
  routePattern: "/system/search/records/:entityName",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search" },
    { label: "Entities", url: "/system/search/entities" },
    { label: "Records" }
  ],
  pageHeaderActions: [
    { label: "Update Documents", url: "/system/search/records/:entityName/update-documents", type: "button" },
    { label: "Delete by IDs", url: "/system/search/records/:entityName/by-ids", type: "button" },
    { label: "Delete by Filter", url: "/system/search/records/:entityName/by-filter", type: "button" }
  ],
  listPageConfig: {
    apiConfig: { apiMethod: "GET", responseKey: "items", apiUrl: "/system/search/records/:entityName" },
    propertiesConfig: [
      { name: "Document ID", dataIndex: "documentId", id: "documentId", fieldType: "text", isListable: true, isIdentifier: true },
      { name: "Score", dataIndex: "score", id: "score", fieldType: "number", isListable: true },
      {
        name: "Actions",
        dataIndex: "actions",
        id: "actions",
        fieldType: "text",
        isListable: true,
        actions: [
          { icon: "view", label: "View Details", url: "/system/search/records/:entityName/:documentId" }
        ]
      }
    ]
  }
}; 