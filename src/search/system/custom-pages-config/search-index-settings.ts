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
    detailApiConfig: {
      apiMethod: "GET",
      apiUrl: "/system/search/indices/:entityName/settings"
    },
    apiConfig: {
      apiMethod: "PUT",
      responseKey: "result",
      apiUrl: "/system/search/indices/:entityName/settings"
    },
    formButtons: [ "submit", { text: "Cancel", url: "/system/search/indices/:entityName" } ],
    propertiesConfig: [
      { 
        name: "settings", 
        label: "Settings (JSON object)", 
        id: "settings", 
        column: "settings", 
        fieldType: "json", 
        validations: ["required"],
        defaultValue: "{}" 
      }
    ],
    submitSuccessRedirect: "/system/search/indices/:entityName"
  }
}; 