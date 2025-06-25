import { DetailsPageConfig } from "../../../ui-config-gen";

export const meiliSearchApiKeyDetailPage: DetailsPageConfig = {
  pageTitle: "API Key Details",
  pageType: "details",
  routePattern: "/system/search/meili/api-keys/:keyOrUid",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search" },
    { label: "API Keys", url: "/system/search/meili/api-keys" },
    { label: "Key Details" }
  ],
  pageHeaderActions: [
    { label: "Edit Key", url: "/system/search/meili/api-keys/:keyOrUid/edit", type: "button" },
    { label: "Delete Key", url: "/system/search/meili/api-keys/:keyOrUid", type: "button" }
  ],
  detailsPageConfig: {
    detailApiConfig: { apiMethod: "GET", responseKey: "", apiUrl: "/system/search/meili/api-keys/:keyOrUid" },
    propertiesConfig: [
      { name: "uid", label: "Key UID", id: "uid", column: "1", fieldType: "text" },
      { name: "name", label: "Name", id: "name", column: "1", fieldType: "text" },
      { name: "description", label: "Description", id: "description", column: "1", fieldType: "text" },
      { name: "actions", label: "Actions", id: "actions", column: "6", fieldType: "json" },
      { name: "indexes", label: "Indexes", id: "indexes", column: "6", fieldType: "json" },
      { name: "expiresAt", label: "Expires At", id: "expiresAt", column: "1", fieldType: "datetime" },
      { name: "createdAt", label: "Created At", id: "createdAt", column: "1", fieldType: "datetime" },
      { name: "updatedAt", label: "Updated At", id: "updatedAt", column: "1", fieldType: "datetime" }
    ]
  }
}; 