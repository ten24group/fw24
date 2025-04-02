/**
 * Tests for MenuBuilder in UI Config Builder
 */

import { MenuBuilder } from '../core/MenuBuilder';
import { createMenuBuilder } from '../core';
import { MenuItem } from '../types/menu-types';

describe('MenuBuilder', () => {
  describe('Basic menu functionality', () => {
    it('should create a menu with default values', () => {
      const menuBuilder = new MenuBuilder();
      const menu = menuBuilder.build();

      expect(menu.theme).toBe('light');
      expect(menu.mode).toBe('inline');
      expect(menu.items).toEqual([]);
    });

    it('should create a menu with custom initial config', () => {
      const initialConfig = {
        theme: 'dark' as const,
        mode: 'horizontal' as const,
        items: [{ key: 'test', title: 'Test Item' }],
      };

      const menuBuilder = new MenuBuilder(initialConfig);
      const menu = menuBuilder.build();

      expect(menu.theme).toBe('dark');
      expect(menu.mode).toBe('horizontal');
      expect(menu.items).toEqual([{ key: 'test', title: 'Test Item' }]);
    });

    it('should support createMenuBuilder factory function', () => {
      const menuBuilder = createMenuBuilder({
        theme: 'dark',
        mode: 'horizontal',
      });
      const menu = menuBuilder.build();

      expect(menu.theme).toBe('dark');
      expect(menu.mode).toBe('horizontal');
    });
  });

  describe('Menu configuration methods', () => {
    it('should set theme', () => {
      const menuBuilder = new MenuBuilder();
      menuBuilder.setTheme('dark');
      const menu = menuBuilder.build();

      expect(menu.theme).toBe('dark');
    });

    it('should set mode', () => {
      const menuBuilder = new MenuBuilder();
      menuBuilder.setMode('horizontal');
      const menu = menuBuilder.build();

      expect(menu.mode).toBe('horizontal');
    });

    it('should set custom style', () => {
      const customStyle = { backgroundColor: 'blue', color: 'white' };
      const menuBuilder = new MenuBuilder();
      menuBuilder.setCustomStyle(customStyle);
      const menu = menuBuilder.build();

      expect(menu.customStyle).toEqual(customStyle);
    });

    it('should set items', () => {
      const items: MenuItem[] = [
        { key: 'item1', title: 'Item 1' },
        { key: 'item2', title: 'Item 2' },
      ];

      const menuBuilder = new MenuBuilder();
      menuBuilder.setItems(items);
      const menu = menuBuilder.build();

      expect(menu.items).toEqual(items);
    });
  });

  describe('Menu item manipulation', () => {
    it('should add an item', () => {
      const menuBuilder = new MenuBuilder();
      menuBuilder.addItem({ key: 'item1', title: 'Item 1' });
      const menu = menuBuilder.build();

      expect(menu.items).toHaveLength(1);
      expect(menu.items[0].key).toBe('item1');
      expect(menu.items[0].title).toBe('Item 1');
    });

    it('should add multiple items', () => {
      const menuBuilder = new MenuBuilder();
      menuBuilder.addItem({ key: 'item1', title: 'Item 1' });
      menuBuilder.addItem({ key: 'item2', title: 'Item 2' });
      const menu = menuBuilder.build();

      expect(menu.items).toHaveLength(2);
      expect(menu.items[0].key).toBe('item1');
      expect(menu.items[1].key).toBe('item2');
    });

    it('should add a group', () => {
      const menuBuilder = new MenuBuilder();
      menuBuilder.addGroup('Group 1', 'group1', [
        { key: 'item1', title: 'Item 1' },
        { key: 'item2', title: 'Item 2' },
      ]);
      const menu = menuBuilder.build();

      expect(menu.items).toHaveLength(1);
      expect(menu.items[0].key).toBe('group1');
      expect(menu.items[0].title).toBe('Group 1');
      expect(menu.items[0].type).toBe('group');
      expect(menu.items[0].children).toHaveLength(2);
    });

    it('should add a divider', () => {
      const menuBuilder = new MenuBuilder();
      menuBuilder.addDivider('divider1');
      const menu = menuBuilder.build();

      expect(menu.items).toHaveLength(1);
      expect(menu.items[0].key).toBe('divider1');
      expect(menu.items[0].type).toBe('divider');
    });
  });

  describe('Entity menu functionality', () => {
    it('should add a basic entity menu', () => {
      const menuBuilder = new MenuBuilder();
      menuBuilder.addEntityMenu({
        entityName: 'User',
        entityNamePlural: 'Users',
        entityKey: 'users',
        icon: 'user',
      });
      const menu = menuBuilder.build();

      expect(menu.items).toHaveLength(1);
      expect(menu.items[0].key).toBe('users');
      expect(menu.items[0].title).toBe('Users');
      expect(menu.items[0].icon).toBe('user');
      expect(menu.items[0].children).toHaveLength(2); // List and Create by default
      expect(menu.items[0].children?.[0].key).toBe('list-user');
      expect(menu.items[0].children?.[1].key).toBe('create-user');
    });

    it('should add an entity menu with custom settings', () => {
      const menuBuilder = new MenuBuilder();
      menuBuilder.addEntityMenu({
        entityName: 'Product',
        entityNamePlural: 'Products',
        entityKey: 'products',
        includeCreate: false,
        includeList: true,
        additionalActions: [
          {
            key: 'product-stats',
            title: 'Product Stats',
            url: '/product-stats',
            icon: 'chart',
          },
        ],
      });
      const menu = menuBuilder.build();

      expect(menu.items).toHaveLength(1);
      expect(menu.items[0].key).toBe('products');
      expect(menu.items[0].children).toHaveLength(2); // List and additional action
      expect(menu.items[0].children?.[0].key).toBe('list-product');
      expect(menu.items[0].children?.[1].key).toBe('product-stats');
    });
  });

  describe('Menu ordering', () => {
    it('should sort items by order', () => {
      const menuBuilder = new MenuBuilder();
      menuBuilder.addItem({ key: 'item3', title: 'Item 3', order: 3 });
      menuBuilder.addItem({ key: 'item1', title: 'Item 1', order: 1 });
      menuBuilder.addItem({ key: 'item2', title: 'Item 2', order: 2 });
      menuBuilder.addItem({ key: 'noOrder', title: 'No Order' }); // No order, should be last

      const menu = menuBuilder.sortByOrder().build();

      expect(menu.items).toHaveLength(4);
      expect(menu.items[0].key).toBe('item1');
      expect(menu.items[1].key).toBe('item2');
      expect(menu.items[2].key).toBe('item3');
      expect(menu.items[3].key).toBe('noOrder');
    });

    it('should sort nested items recursively', () => {
      const menuBuilder = new MenuBuilder();
      menuBuilder.addItem({
        key: 'parent',
        title: 'Parent',
        children: [
          { key: 'child3', title: 'Child 3', order: 3 },
          { key: 'child1', title: 'Child 1', order: 1 },
          { key: 'child2', title: 'Child 2', order: 2 },
        ],
      });

      const menu = menuBuilder.sortByOrder().build();

      const children = menu.items[0].children || [];
      expect(children).toHaveLength(3);
      expect(children[0].key).toBe('child1');
      expect(children[1].key).toBe('child2');
      expect(children[2].key).toBe('child3');
    });
  });

  describe('Method chaining', () => {
    it('should support method chaining for fluent API', () => {
      const menu = new MenuBuilder()
        .setTheme('dark')
        .setMode('horizontal')
        .addItem({ key: 'item1', title: 'Item 1' })
        .addGroup('Group', 'group', [{ key: 'sub', title: 'Sub Item' }])
        .addDivider('divider')
        .sortByOrder()
        .build();

      expect(menu.theme).toBe('dark');
      expect(menu.mode).toBe('horizontal');
      expect(menu.items).toHaveLength(3);
    });
  });

  describe('Validation', () => {
    it('should pass validation with valid config', () => {
      const menuBuilder = new MenuBuilder();
      expect(() => menuBuilder.build()).not.toThrow();
    });
  });
});
