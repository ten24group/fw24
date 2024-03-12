export class Helper {
    static hydrateConfig<T>(config: T, prefix = "APP") {
        Object.keys(process.env)
            .filter(key => key.startsWith(prefix))
            .forEach(key => {
                const newKey = key.replace(new RegExp('^' + prefix + '_'), '').toLowerCase().replace(/_./g, x => x[1].toUpperCase());
                if ((config as any)[newKey] === undefined) {
                    (config as any)[newKey] = process.env[key];
                }
            });
    }
}