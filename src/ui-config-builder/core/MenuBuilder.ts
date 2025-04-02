import { BaseBuilder } from './BaseBuilder';
import { MenuConfig, MenuItem, EntityMenuConfig } from '../types/menu-types';

/**
 * Builder for menu configurations
 */
export class MenuBuilder extends BaseBuilder<MenuConfig> {
  constructor(initialConfig?: Partial<MenuConfig>) {
    super({
      items: [],
      theme: 'light',
      mode: 'inline',
      ...initialConfig,
    });
  }

  /**
   * Set the menu theme
   */
  public setTheme(theme: 'light' | 'dark'): this {
    return this.set('theme', theme);
  }

  /**
   * Set the menu mode
   */
  public setMode(mode: 'horizontal' | 'vertical' | 'inline'): this {
    return this.set('mode', mode);
  }

  /**
   * Set custom menu style
   */
  public setCustomStyle(style: Record<string, any>): this {
    return this.set('customStyle', style);
  }

  /**
   * Set menu items
   */
  public setItems(items: MenuItem[]): this {
    return this.set('items', items);
  }

  /**
   * Add a menu item
   */
  public addItem(item: MenuItem): this {
    const items = [...this.config.items];
    items.push(item);
    return this.set('items', items);
  }

  /**
   * Add a menu group
   */
  public addGroup(title: string, key: string, children: MenuItem[] = []): this {
    return this.addItem({
      key,
      title,
      type: 'group',
      children,
    });
  }

  /**
   * Add a divider
   */
  public addDivider(key: string): this {
    return this.addItem({
      key,
      title: '',
      type: 'divider',
    });
  }

  /**
   * Add an entity menu item with default CRUD operations
   */
  public addEntityMenu(config: EntityMenuConfig): this {
    const {
      entityKey,
      entityName,
      entityNamePlural,
      icon,
      order,
      includeCreate = true,
      includeList = true,
      additionalActions = [],
    } = config;

    const children: MenuItem[] = [];
    const entityNameLower = entityName.toLowerCase();

    if (includeList) {
      children.push({
        key: `list-${entityNameLower}`,
        title: `List ${entityNamePlural}`,
        url: `/list-${entityNameLower}`,
        icon: 'table',
      });
    }

    if (includeCreate) {
      children.push({
        key: `create-${entityNameLower}`,
        title: `Create ${entityName}`,
        url: `/create-${entityNameLower}`,
        icon: 'plus',
      });
    }

    // Add additional actions
    additionalActions.forEach(action => {
      children.push(action);
    });

    return this.addItem({
      key: entityKey || entityNameLower,
      title: entityNamePlural,
      icon,
      children: children.length > 0 ? children : undefined,
      order,
    });
  }

  /**
   * Sort menu items by order
   */
  public sortByOrder(): this {
    const sortItemsByOrder = (items: MenuItem[]): MenuItem[] => {
      return [...items].sort((a, b) => {
        const orderA = a.order ?? 999;
        const orderB = b.order ?? 999;
        return orderA - orderB;
      });
    };

    const sortRecursively = (items: MenuItem[]): MenuItem[] => {
      return sortItemsByOrder(items).map(item => {
        if (item.children && item.children.length > 0) {
          return {
            ...item,
            children: sortRecursively(item.children),
          };
        }
        return item;
      });
    };

    return this.set('items', sortRecursively(this.config.items));
  }

  /**
   * Validate the menu configuration
   */
  protected validate(): void {
    // No strict validation requirements for menu
  }
}
