import { DetailsPageConfig } from "../../../ui-config-gen";

export const searchRecordDetailConfig: DetailsPageConfig = {
  pageTitle: "Search Record Details",
  pageType: "details",
  routePattern: "/system/search/records/:entityName/:documentId",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search" },
    { label: "Entities", url: "/system/search/entities" },
    { label: "Records", url: "/system/search/records/:entityName" },
    { label: "Details" }
  ],
  detailsPageConfig: {
    detailApiConfig: { apiMethod: "GET", responseKey: "", apiUrl: "/system/search/records/:entityName/:documentId" },
    propertiesConfig: [
      { name: "document", label: "Record", id: "document", column: "12", fieldType: "json" }
    ]
  }
}; 