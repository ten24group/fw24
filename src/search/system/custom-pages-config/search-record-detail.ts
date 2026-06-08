import { DetailsPageConfig } from "../../../ui-config-gen";

export const searchRecordDetailConfig: DetailsPageConfig = {
  pageTitle: "Search Record Details",
  pageType: "details",
  routePattern: "/system/search/records/:entityName/:id",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search" },
    { label: "Entities", url: "/system/search/entities" },
    { label: "Records", url: "/system/search/records/:entityName" },
    { label: "Details" }
  ],
  pageHeaderActions: [
    {
      label: "Delete Record",
      openInModal: true,
      modalConfig: {
        modalType: "confirm",
        modalPageConfig: {  
          title: "Delete Record",
          content: "Are you sure you want to delete this record?"
        },
        apiConfig: {
          apiMethod: "DELETE",
          apiUrl: "/system/search/records/:entityName/:id"  
        },
        submitSuccessRedirect: "/system/search/records/:entityName"
      }
    }
  ],
  detailsPageConfig: {
    detailApiConfig: { apiMethod: "GET", apiUrl: "/system/search/records/:entityName/:id" },
    propertiesConfig: [
      { name: "id",  label: "ID", id: "id", column: "id", fieldType: "text", isIdentifier: true },
      { name: "_indexedAt", label: "Index At", id: "_indexedAt", column: "_indexedAt", fieldType: "text" },
      { name: "entityName", label: "Entity Name", id: "entityName", column: "entityName", fieldType: "text" },
      { name: "fullRecord", label: "Full Record", id: "fullRecord", column: "fullRecord", fieldType: "json" },
    ]
  }
}; 