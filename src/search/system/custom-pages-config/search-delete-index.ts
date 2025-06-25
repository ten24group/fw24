import { FormPageConfig } from "../../../ui-config-gen";

export const searchDeleteIndexPage: FormPageConfig = {
  pageTitle: "Delete Index",
  pageType: "form",
  routePattern: "/system/search/indices/:entityName/delete",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search/indices" },
    { label: "Delete Index" }
  ],
  formPageConfig: {
    apiConfig: { apiMethod: "DELETE", responseKey: "", apiUrl: "/system/search/indices/:entityName" },
    formButtons: [ "Delete" ],
    propertiesConfig: [],
    submitSuccessRedirect: "/system/search/indices"
  }
}; 