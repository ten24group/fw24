import { FormPageConfig } from "../../../ui-config-gen";

export const meiliSearchCreateApiKeyPage: FormPageConfig = {
  pageTitle: "Create API Key",
  pageType: "form",
  routePattern: "/system/search/meili/api-keys/create",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search" },
    { label: "API Keys", url: "/system/search/meili/api-keys" },
    { label: "Create Key" }
  ],
  formPageConfig: {
    apiConfig: { apiMethod: "POST", responseKey: "", apiUrl: "/system/search/meili/api-keys" },
    formButtons: [ "Create", { text: "Cancel", url: "/system/search/meili/api-keys" } ],
    propertiesConfig: [
      { name: "name", label: "Name", id: "name", column: "1", fieldType: "text" },
      { name: "description", label: "Description", id: "description", column: "1", fieldType: "textarea" },
      { name: "actions", label: "Actions (JSON array)", id: "actions", column: "1", fieldType: "textarea", defaultValue: "[\"search\", \"documents.get\"]" },
      { name: "indexes", label: "Indexes (JSON array)", id: "indexes", column: "1", fieldType: "textarea", defaultValue: "[\"*\"]" },
      { name: "expiresAt", label: "Expires At", id: "expiresAt", column: "1", fieldType: "datetime", defaultValue: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }
    ],
    submitSuccessRedirect: "/system/search/meili/api-keys"
  }
}; 