import { FormPageConfig } from "../../../ui-config-gen";

export const meiliSearchCreateApiKeyPage: FormPageConfig = {
  pageTitle: "Create API Key",
  pageType: "form",
  routePattern: "/system/search/create-api-keys",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search" },
    { label: "API Keys", url: "/system/search/api-keys" },
    { label: "Create Key" }
  ],
  formPageConfig: {
    apiConfig: { apiMethod: "POST", responseKey: "", apiUrl: "/system/search/api-keys" },
    formButtons: [ "submit", "reset", { text: "Cancel", url: "/system/search/api-keys" } ],
    propertiesConfig: [
      { name: "name", label: "Name", id: "name", column: "name", fieldType: "text" },
      { name: "description", label: "Description", id: "description", column: "description", fieldType: "textarea" },
      { name: "actions", label: "Actions (JSON array)", id: "actions", column: "actions", fieldType: "json", defaultValue: "[\"search\", \"documents.get\"]" },
      { name: "indexes", label: "Indexes (JSON array)", id: "indexes", column: "indexes", fieldType: "json", defaultValue: "[\"*\"]" },
      { name: "expiresAt", label: "Expires At", id: "expiresAt", column: "expiresAt", fieldType: "datetime", defaultValue: "2025-07-22T00:00:00.000Z" }
    ],
    submitSuccessRedirect: "/system/search/api-keys"
  }
}; 