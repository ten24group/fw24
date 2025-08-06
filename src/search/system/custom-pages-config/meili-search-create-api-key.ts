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
      },
      { 
        name: "actions", 
        label: "Actions", 
        id: "actions", 
        column: "actions", 
        fieldType: "json", 
        defaultValue: "[\"search\", \"documents.get\"]",
        placeholder: "[\"search\", \"documents.get\"]",
        helpText: "Required: Array of allowed actions. Common actions: search, documents.get, documents.add, documents.update, documents.delete, indexes.create, indexes.update, indexes.delete, settings.get, settings.update"
      },
      { 
        name: "indexes", 
        label: "Indexes", 
        id: "indexes", 
        column: "indexes", 
        fieldType: "json", 
        defaultValue: "[\"*\"]",
        placeholder: "[\"*\"]",
        helpText: "Required: Array of index UIDs this key can access. Use [\"*\"] for all indexes, or specify individual index UIDs like [\"my-index\", \"another-index\"]"
      },
      { 
        name: "expiresAt", 
        label: "Expires At", 
        id: "expiresAt", 
        column: "expiresAt", 
        fieldType: "datetime",
        defaultValue: "2025-12-31T23:59:59Z",
        placeholder: "2025-12-31T23:59:59Z",
        helpText: "Optional: ISO 8601 datetime when this key expires. Leave empty for no expiration"
      }
    ],
    submitSuccessRedirect: "/system/search/api-keys"
  }
}; 