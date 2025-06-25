import { FormPageConfig } from "../../../ui-config-gen";

export const searchIndexSettingsConfig: FormPageConfig = {
  pageTitle: "Search Index Settings",
  pageType: "form",
  routePattern: "/system/search/indices/:entityName/settings",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search" },
    { label: "Indices", url: "/system/search/indices" },
    { label: "Settings" }
  ],
  formPageConfig: {
    detailApiConfig: { apiMethod: "GET", responseKey: "settings", apiUrl: "/system/search/indices/:entityName/settings" },
    apiConfig: { apiMethod: "PUT", responseKey: "result", apiUrl: "/system/search/indices/:entityName/settings" },
    formButtons: [ "Save", { text: "Cancel", url: "/system/search/indices/:entityName" } ],
    propertiesConfig: [
      { name: "settings", label: "Settings", id: "settings", column: "1", fieldType: "textarea", defaultValue: "{}" }
    ],
    submitSuccessRedirect: "/system/search/indices/:entityName"
  }
}; 