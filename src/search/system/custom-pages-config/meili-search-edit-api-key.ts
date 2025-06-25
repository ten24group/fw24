import { FormPageConfig } from "../../../ui-config-gen";

export const meiliSearchEditApiKeyPage: FormPageConfig = {
  pageTitle: "Edit MeiliSearch API Key",
  pageType: "form",
  routePattern: "/system/search/meili/api-keys/:keyOrUid/edit",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search/indices" },
    { label: "API Keys", url: "/system/search/meili/api-keys" },
    { label: "Edit API Key" }
  ],
  formPageConfig: {
    detailApiConfig: { apiMethod: "GET", responseKey: "", apiUrl: "/system/search/meili/api-keys/:keyOrUid" },
    apiConfig: { apiMethod: "PUT", responseKey: "", apiUrl: "/system/search/meili/api-keys/:keyOrUid" },
    formButtons: [ "Save", { text: "Cancel", url: "/system/search/meili/api-keys" } ],
    propertiesConfig: [
      { name: "name", label: "Name", id: "name", column: "1", fieldType: "text" },
      { name: "description", label: "Description", id: "description", column: "1", fieldType: "text" }
    ],
    submitSuccessRedirect: "/system/search/meili/api-keys"
  }
}; 