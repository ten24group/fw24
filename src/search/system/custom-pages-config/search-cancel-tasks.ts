import { FormPageConfig } from "../../../ui-config-gen";

export const searchCancelTasksConfig: FormPageConfig = {
  pageTitle: "Cancel Tasks",
  pageType: "form",
  routePattern: "/system/search/meili/tasks/cancel",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search" },
    { label: "Tasks", url: "/system/search/meili/tasks" },
    { label: "Cancel Tasks" }
  ],
  formPageConfig: {
    apiConfig: { apiMethod: "POST", responseKey: "", apiUrl: "/system/search/meili/tasks/cancel" },
    formButtons: [ "Cancel Tasks", { text: "Back", url: "/system/search/meili/tasks" } ],
    propertiesConfig: [
      {
        name: "uids",
        label: "Task UIDs (JSON array)",
        id: "uids",
        column: "1",
        fieldType: "textarea",
        defaultValue: "[1, 2, 3]"
      }
    ],
    submitSuccessRedirect: "/system/search/meili/tasks"
  }
}; 