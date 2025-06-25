import { FormPageConfig } from "../../../ui-config-gen";

export const meiliSearchSwapIndicesPage: FormPageConfig = {
  pageTitle: "Swap Indices",
  pageType: "form",
  routePattern: "/system/search/meili/indices/swap",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search/indices" },
    { label: "Swap Indices" }
  ],
  formPageConfig: {
    apiConfig: { apiMethod: "POST", responseKey: "", apiUrl: "/system/search/meili/indices/swap" },
    formButtons: [ "Swap" ],
    propertiesConfig: [
      {
        name: "swaps",
        label: "Swaps (JSON array of pairs)",
        id: "swaps",
        column: "1",
        fieldType: "textarea",
        defaultValue: "[[\"users\",\"users_temp\"], [\"posts\",\"posts_temp\"]]"
      }
    ],
    submitSuccessRedirect: "/system/search/meili/tasks"
  }
}; 