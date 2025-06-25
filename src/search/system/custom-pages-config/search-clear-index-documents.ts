import { FormPageConfig } from "../../../ui-config-gen";

export const searchClearIndexDocumentsPage: FormPageConfig = {
  pageTitle: "Clear Index Documents",
  pageType: "form",
  routePattern: "/system/search/indices/:entityName/clear-documents",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search/indices" },
    { label: "Clear Documents" }
  ],
  formPageConfig: {
    apiConfig: { apiMethod: "DELETE", responseKey: "", apiUrl: "/system/search/indices/:entityName/documents" },
    formButtons: [ "Clear" ],
    propertiesConfig: [],
    submitSuccessRedirect: "/system/search/indices/:entityName"
  }
}; 