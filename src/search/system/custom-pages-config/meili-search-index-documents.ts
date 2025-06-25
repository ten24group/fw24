import { DetailsPageConfig } from "../../../ui-config-gen";

export const meiliSearchIndexDocumentsPage: DetailsPageConfig = {
  pageTitle: "Index Documents",
  pageType: "details",
  routePattern: "/system/search/meili/index-documents/:indexName",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search/indices" },
    { label: "Documents" }
  ],
  detailsPageConfig: {
    detailApiConfig: { apiMethod: "GET", responseKey: "documents", apiUrl: "/system/search/meili/index-documents/:indexName" },
    propertiesConfig: [
      { name: "documents", label: "Documents", id: "documents", column: "12", fieldType: "json" }
    ]
  }
}; 