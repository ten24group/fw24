import { FormPageConfig } from "../../../ui-config-gen";

export const meiliSearchEditApiKeyPage: FormPageConfig = {
  pageTitle: "Edit MeiliSearch API Key",
  pageType: "form",
  routePattern: "/system/search/api-keys/:keyOrUid/edit",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search" },
    { label: "API Keys", url: "/system/search/api-keys" },
    { label: "Edit API Key" }
  ],
  formPageConfig: {
    detailApiConfig: { apiMethod: "GET", responseKey: "", apiUrl: "/system/search/api-keys/:keyOrUid" },
    apiConfig: { apiMethod: "PUT", responseKey: "", apiUrl: "/system/search/api-keys/:keyOrUid" },
    formButtons: [ "submit", "reset", { text: "Cancel", url: "/system/search/api-keys" } ],
    propertiesConfig: [
      { name: "name", label: "Name", id: "name", column: "name", fieldType: "text" },
      { name: "description", label: "Description", id: "description", column: "description", fieldType: "text" }
    ],
    submitSuccessRedirect: "/system/search/api-keys"
  }
}; 