import { Template } from "../../entity/base-entity";

/**
 * Generate dashboard page configuration.
 *
 * @param options Configuration options for the dashboard
 * @returns Dashboard page config
 *
 * @example
 * // Static dashboard
 * makeDashboardConfig()
 *
 * @example
 * // Dynamic dashboard with user context
 * makeDashboardConfig({ pageTitle: '{userName} Dashboard' })
 */
export default (options?: {
    /**
     * Page title - supports templates for dynamic dashboards.
     * @default 'Dashboard'
     * @example pageTitle: 'Admin Dashboard'
     * @example pageTitle: '{userName} Dashboard'
     */
    pageTitle?: Template;
    /**
     * Breadcrumbs with template support.
     * @default []
     */
    breadcrumbs?: Array<{ label: Template; url?: string }>;
}) => {
    return {
        pageTitle: options?.pageTitle || 'Dashboard',
        pageType: "dashboard" as const,
        breadcrumbs: options?.breadcrumbs || [],
    }
};