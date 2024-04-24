import { Route } from "../interfaces/route";


export const LogDuration = () => {
  
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    
    const cache = new Set<string>;
    const method = descriptor.value;
    
    descriptor.value = function (...args: any[]) {
      
      let key = `Duration.of.${target.constructor.name}.${String(propertyKey)}_${cache.size}`;
      
      // to handle recursive calls
      cache.add(key);

      console.time(key);

      let result: any = method.apply(this, args);

      /**
       * Duck typing to check if the response is a promise. In the case a promise is returned we want
       * to know when the promise value is resolved.
       */
      if ((typeof result === 'function' || typeof result === 'object') && typeof result.then === 'function') {
        result = result.then((resolvedValue: any) => {
          console.timeEnd(key);
          return resolvedValue;
        });
      } else {
        console.timeEnd(key);
      }

      return result;
    };

    return descriptor;
  };
}