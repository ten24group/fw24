/**
 * Tests for JSX implementation in the UI Config Builder
 */

/* eslint-disable @typescript-eslint/no-unused-vars */
import UIConfig from '../components/jsx';
/* eslint-enable @typescript-eslint/no-unused-vars */

import { buildConfig } from '../components/jsx';
import { ConfigObject } from '../types';

// Helper function to create a basic form config for testing
const createBasicForm = () => (
    <form url="/api/test" method="POST">
        <field id="name" type="string" label="Name" required />
    </form>
);

describe('JSX Implementation', () => {
    describe('buildConfig function', () => {
        it('should convert a form element to the correct config object', () => {
            // Create a simple form with JSX
            const userForm = createBasicForm();

            // Convert to configuration object
            const config = buildConfig(userForm) as ConfigObject;

            // Verify the structure
            expect(config).toHaveProperty('formPageConfig');
            const formConfig = config.formPageConfig as ConfigObject;
            expect(formConfig).toHaveProperty('apiConfig');
            expect(formConfig.apiConfig).toEqual({
                apiMethod: 'POST',
                apiUrl: '/api/test',
                responseKey: undefined,
            });

            // Check properties
            const propertiesConfig = formConfig.propertiesConfig as Array<unknown>;
            expect(propertiesConfig).toHaveLength(1);
            const field = propertiesConfig[ 0 ] as ConfigObject;
            expect(field).toHaveProperty('id', 'name');
            expect(field).toHaveProperty('label', 'Name');
            expect(field).toHaveProperty('type', 'string');
            expect(field).toHaveProperty('validations');
            expect(field.validations).toContainEqual({ required: true });
        });

        it('should handle nested sections in forms', () => {
            // Create a form with sections
            const userForm = (
                <form url="/api/test" method="POST">
                    <section title="Basic Info" collapsible defaultOpen>
                        <field id="name" type="string" label="Name" required />
                        <field id="email" type="string" fieldType="email" label="Email" required>
                            <validation type="email" message="Please enter a valid email" />
                        </field>
                    </section>
                </form>
            );

            // Convert to configuration object
            const config = buildConfig(userForm) as ConfigObject;

            // Check for sections
            const formConfig = config.formPageConfig as ConfigObject;
            const propsConfig = formConfig.propertiesConfig as ConfigObject[];
            expect(propsConfig).toHaveLength(1); // 1 section

            // Find the section
            const section = propsConfig.find(
                (item: ConfigObject) => item.title === 'Basic Info'
            );

            expect(section).toBeDefined();
            expect(section).toHaveProperty('collapsible', true);
            expect(section).toHaveProperty('collapsed', false); // defaultOpen === true means collapsed === false
            expect(section).toHaveProperty('fields');
            expect(section?.fields).toContain('name');
            expect(section?.fields).toContain('email');

            // Check the allFields property
            expect(formConfig).toHaveProperty('allFields');
            const allFields = formConfig.allFields as ConfigObject[];
            expect(allFields).toHaveLength(2); // 2 fields from the section
        });

        it('should handle validation rules in fields', () => {
            // Create a form with validation
            const userForm = (
                <form url="/api/test" method="POST">
                    <field
                        id="email"
                        type="string"
                        fieldType="email"
                        label="Email"
                        required
                    >
                        <validation type="email" message="Please enter a valid email" />
                        <validation type="maxLength" value={100} message="Email must be less than 100 characters" />
                    </field>
                </form>
            );

            // Convert to configuration object
            const config = buildConfig(userForm) as ConfigObject;

            // Check validation
            const formConfig = config.formPageConfig as ConfigObject;
            const propsConfig = formConfig.propertiesConfig as ConfigObject[];
            const field = propsConfig[ 0 ] as ConfigObject;
            expect(field).toHaveProperty('validations');
            expect(field.validations).toHaveLength(3); // required + 2 validations

            // Check specific validations
            expect(field.validations).toContainEqual({ required: true });
            expect(field.validations).toContainEqual({
                email: true,
                message: 'Please enter a valid email'
            });
            expect(field.validations).toContainEqual({
                maxLength: 100,
                message: 'Email must be less than 100 characters'
            });
        });

        it('should handle data tables correctly', () => {
            // Create a data table with actions
            const userTable = (
                <datatable url="/api/users" responseKey="users" perPage={10}>
                    <field id="name" label="Name" sortable />
                    <field id="email" label="Email" sortable />
                    <action label="View" url="/users/:id" icon="eye" />
                    <action label="Edit" url="/users/:id/edit" icon="edit" />
                </datatable>
            );

            // Convert to configuration object
            const config = buildConfig(userTable) as ConfigObject;

            // Verify structure
            expect(config).toHaveProperty('listPageConfig');
            const listConfig = config.listPageConfig as ConfigObject;
            expect(listConfig).toHaveProperty('apiConfig');
            expect(listConfig.apiConfig).toEqual({
                apiMethod: 'GET',
                apiUrl: '/api/users',
                responseKey: 'users',
            });

            // Check fields
            const propsConfig = listConfig.propertiesConfig as ConfigObject[];
            expect(propsConfig).toHaveLength(2);
            expect(propsConfig[ 0 ]).toHaveProperty('id', 'name');
            expect(propsConfig[ 1 ]).toHaveProperty('id', 'email');

            // Check actions
            const rowActions = listConfig.rowActions as ConfigObject[];
            expect(rowActions).toHaveLength(2);
            expect(rowActions[ 0 ]).toHaveProperty('label', 'View');
            expect(rowActions[ 1 ]).toHaveProperty('label', 'Edit');
        });

        it('should handle detail views correctly', () => {
            // Create a detail view
            const userDetail = (
                <detailview url="/api/users/:id" responseKey="user">
                    <field id="name" label="Name" />
                    <field id="email" label="Email" />
                </detailview>
            );

            // Convert to configuration object
            const config = buildConfig(userDetail) as ConfigObject;

            // Verify structure
            expect(config).toHaveProperty('detailPageConfig');
            const detailConfig = config.detailPageConfig as ConfigObject;
            expect(detailConfig).toHaveProperty('apiConfig');
            expect(detailConfig.apiConfig).toEqual({
                apiMethod: 'GET',
                apiUrl: '/api/users/:id',
                responseKey: 'user',
            });

            // Check fields
            const propsConfig = detailConfig.propertiesConfig as ConfigObject[];
            expect(propsConfig).toHaveLength(2);
            expect(propsConfig[ 0 ]).toHaveProperty('id', 'name');
            expect(propsConfig[ 1 ]).toHaveProperty('id', 'email');
        });

        it('should handle page elements correctly', () => {
            // Create a page with content
            const userPage = (
                <page title="User Management" pageType="custom">
                    <datatable url="/api/users" responseKey="users">
                        <field id="name" label="Name" />
                    </datatable>
                    <action label="Add User" url="/users/new" icon="add" />
                </page>
            );

            // Convert to configuration object
            const config = buildConfig(userPage) as ConfigObject;

            // Verify structure
            expect(config).toHaveProperty('pageTitle', 'User Management');
            expect(config).toHaveProperty('pageType', 'custom');

            // Check content
            expect(config).toHaveProperty('content');
            const content = config.content as ConfigObject[];
            expect(content).toHaveLength(2);
            expect(content[ 0 ]).toHaveProperty('listPageConfig');
            expect(content[ 1 ]).toHaveProperty('label', 'Add User');
        });
    });
}); 