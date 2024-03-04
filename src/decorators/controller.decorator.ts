export interface IControllerConfig {
	tableName?: string;
}

export function Controller(controllerName: string, controllerConfig?: IControllerConfig) {
	return function <T extends { new (...args: any[]): {} }>(target: T) {
		return class extends target {
			constructor(...args: any[]) {
				super(...args);
				Reflect.set(this, 'controllerName', controllerName);
				Reflect.set(this, 'controllerConfig', controllerConfig);
			}
		};
	};
}
