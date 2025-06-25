import { FormPageConfig } from "../../../ui-config-gen";

export const meiliSearchCreateDumpPage: FormPageConfig = {
  pageTitle: "Create MeiliSearch Dump",
  pageType: "form",
  routePattern: "/system/search/meili/dumps",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search/indices" },
    { label: "Create Dump" }
  ],
  formPageConfig: {
    apiConfig: { apiMethod: "POST", responseKey: "", apiUrl: "/system/search/meili/dumps" },
    formButtons: [ "Create" ],
    propertiesConfig: [],
    submitSuccessRedirect: "/system/search/meili/tasks"
  }
}; 