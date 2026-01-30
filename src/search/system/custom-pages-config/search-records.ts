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
  pageHeaderActions: [],
  listPageConfig: {
    apiConfig: { apiMethod: "GET", useSearch: true, responseKey: "items", apiUrl: "/system/search/records/:entityName" },
    propertiesConfig: [
      { 
        id: "id", 
        name: "ID", 
        dataIndex: "id", 
        fieldType: "text", 
        isListable: true, 
        isFilterable: false,
        isSortable: false,
        isIdentifier: true,
        actions: [
          { icon: "view", label: "View Details", url: "/system/search/records/:entityName/:id" }
        ]
      },
      { 
        name: "Full Record", 
        dataIndex: "fullRecord", 
        id: "fullRecord", 
        fieldType: "json", 
        isListable: true,
        isFilterable: false,
        isSortable: false,
        actions: [
          { icon: "view", label: "View Details", url: "/system/search/records/:entityName/:id" }
        ]
      }
    ]
  }
}; 