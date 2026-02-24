import { DetailsPageConfig } from "../../../ui-config-gen";

export const meiliSearchApiKeyDetailPage: DetailsPageConfig = {
  pageTitle: "MeiliSearch API Key Detail",
  pageType: "details",
  routePattern: "/system/search/api-keys/:keyOrUid",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search" },
    { label: "API Keys", url: "/system/search/api-keys" },
    { label: "Key Detail" }
  ],
  pageHeaderActions: [
    { label: "Edit Key", url: "/system/search/api-keys/:keyOrUid/edit", type: "button" },
    {
      label: "Delete Key",
      openInModal: true,
      modalConfig: {
        modalType: "confirm",
        modalPageConfig: {
          title: "Delete API Key",
          content: "Are you sure you want to delete this API key?"
        },
        apiConfig: {
          apiMethod: "DELETE",
          apiUrl: "/system/search/api-keys/:keyOrUid"
        },
        submitSuccessRedirect: "/system/search/api-keys"
      }
    }
  ],
  detailsPageConfig: {
    detailApiConfig: { apiMethod: "GET", responseKey: "", apiUrl: "/system/search/api-keys/:keyOrUid" },
    propertiesConfig: [
      { name: "uid", label: "UID", id: "uid", column: "uid", fieldType: "text" },
      { name: "name", label: "Name", id: "name", column: "name", fieldType: "text" },
      { name: "description", label: "Description", id: "description", column: "description", fieldType: "text" },
      { name: "key", label: "Key", id: "key", column: "key", fieldType: "text" },
      { name: "actions", label: "Actions", id: "actions", column: "actions", fieldType: "json" },
      { name: "indexes", label: "Indexes", id: "indexes", column: "indexes", fieldType: "json" },
      { name: "expiresAt", label: "Expires At", id: "expiresAt", column: "expiresAt", fieldType: "datetime" },
      { name: "createdAt", label: "Created At", id: "createdAt", column: "createdAt", fieldType: "datetime" },
      { name: "updatedAt", label: "Updated At", id: "updatedAt", column: "updatedAt", fieldType: "datetime" }
    ]
  }
};