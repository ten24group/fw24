/**
 * JSX Examples for UI Config Builder
 * 
 * This file demonstrates the usage of JSX syntax to create UI configurations
 * with proper typing and structure.
 */

// Import the UIConfig JSX factory for JSX syntax to work
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import UIConfig from '../components/jsx';
import { buildConfig } from '../components/jsx';

// Form example with sections and validations
const userForm = (
    <form
        url="/api/users"
        method="POST"
        submitRedirect="/users"
        layout="vertical"
        initialValues={{ status: 'active' }}
    >
        <section title="User Information" collapsible defaultOpen>
            <field
                id="email"
                type="string"
                fieldType="email"
                required
                label="Email Address"
            >
                <validation type="email" message="Please enter a valid email address" />
                <validation type="maxLength" value={100} message="Email must be less than 100 characters" />
            </field>

            <field
                id="name"
                type="string"
                required
                label="Full Name"
            >
                <validation type="minLength" value={2} message="Name must be at least 2 characters" />
            </field>

            <field
                id="role"
                type="string"
                fieldType="select"
                required
                label="User Role"
            >
                <option value="admin" label="Administrator" />
                <option value="user" label="Regular User" />
                <option value="guest" label="Guest" />
            </field>
        </section>

        <section title="Authentication" collapsible>
            <field
                id="password"
                type="string"
                fieldType="password"
                required
                label="Password"
            >
                <validation type="minLength" value={8} message="Password must be at least 8 characters" />
                <validation type="pattern" value="^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)" message="Password must include uppercase, lowercase, and numbers" />
            </field>

            <field
                id="passwordConfirm"
                type="string"
                fieldType="password"
                required
                label="Confirm Password"
            />

            <field
                id="twoFactorEnabled"
                type="boolean"
                fieldType="switch"
                label="Enable Two-Factor Authentication"
            />
        </section>
    </form>
);

// Data table example
const userList = (
    <datatable
        url="/api/users"
        responseKey="users"
        perPage={15}
        search={true}
        showFilters={true}
    >
        <field id="name" label="Full Name" sortable />
        <field id="email" label="Email Address" sortable />
        <field id="role" label="Role" sortable />
        <field id="status" label="Status" fieldType="switch" />

        <action label="View" url="/users/:id" icon="eye" />
        <action label="Edit" url="/users/:id/edit" icon="edit" />
        <action label="Delete" url="/api/users/:id" icon="delete" type="danger" />
    </datatable>
);

// Detail view example
const userDetail = (
    <detailview url="/api/users/:id" responseKey="user">
        <section title="User Details" collapsible defaultOpen>
            <field id="name" label="Full Name" />
            <field id="email" label="Email Address" />
            <field id="role" label="Role" />
            <field id="status" label="Account Status" />
        </section>

        <section title="Activity Information" collapsible defaultOpen>
            <field id="createdAt" label="Account Created" fieldType="date" />
            <field id="lastLogin" label="Last Login" fieldType="date" />
            <field id="loginCount" label="Total Logins" fieldType="number" />
        </section>
    </detailview>
);

// Page example
const userPage = (
    <page title="User Management" pageType="custom">
        {userList}
        <action label="Add User" url="/users/new" icon="add" type="primary" />
    </page>
);

// Dashboard example with multiple components
const dashboardPage = (
    <page title="Admin Dashboard" pageType="dashboard">
        <section title="User Overview">
            <datatable
                url="/api/users/recent"
                responseKey="users"
                perPage={5}
            >
                <field id="name" label="Name" sortable />
                <field id="email" label="Email" />
                <field id="lastLogin" label="Last Login" fieldType="date" />
                <action label="View Details" url="/users/:id" icon="eye" />
            </datatable>
        </section>

        <section title="Content Overview">
            <datatable
                url="/api/content/recent"
                responseKey="content"
                perPage={5}
            >
                <field id="title" label="Title" sortable />
                <field id="status" label="Status" />
                <field id="publishedAt" label="Published Date" fieldType="date" />
                <action label="View" url="/content/:id" icon="eye" />
            </datatable>
        </section>
    </page>
);

// Convert JSX to configuration objects
const formConfig = buildConfig(userForm);
const listConfig = buildConfig(userList);
const detailConfig = buildConfig(userDetail);
const pageConfig = buildConfig(userPage);
const dashboardConfig = buildConfig(dashboardPage);

// Export the examples
export {
    userForm,
    userList,
    userDetail,
    userPage,
    dashboardPage,
    formConfig,
    listConfig,
    detailConfig,
    pageConfig,
    dashboardConfig
}; 