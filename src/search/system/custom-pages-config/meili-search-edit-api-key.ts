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
      {
        name: "name",
        label: "Name",
        id: "name",
        column: "name",
        fieldType: "text",
        placeholder: "Enter a descriptive name for this API key",
        helpText: "Optional: A human-readable name for the API key"
      },
      {
        name: "description",
        label: "Description",
        id: "description",
        column: "description",
        fieldType: "textarea",
        placeholder: "Enter a description of what this API key will be used for",
        helpText: "Optional: A detailed description of the API key's purpose"
      }
    ],
    submitSuccessRedirect: "/system/search/api-keys"
  }
};