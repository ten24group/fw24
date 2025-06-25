import { FormPageConfig } from "../../../ui-config-gen";

export const searchResetIndexSettingsPage: FormPageConfig = {
  pageTitle: "Reset Index Settings",
  pageType: "form",
  routePattern: "/system/search/indices/:entityName/reset-settings",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search/indices" },
    { label: "Reset Settings" }
  ],
  formPageConfig: {
    apiConfig: { apiMethod: "POST", responseKey: "", apiUrl: "/system/search/indices/:entityName/reset-settings" },
    formButtons: [ "Reset" ],
    propertiesConfig: [],
    submitSuccessRedirect: "/system/search/indices/:entityName"
  }
}; 