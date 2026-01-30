"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LogDuration = void 0;
const LogDuration = () => {
    return (target, propertyKey, descriptor) => {
        const cache = new Set;
        const method = descriptor.value;
        descriptor.value = function (...args) {
            let key = `Duration.of.${target.constructor.name}.${String(propertyKey)}_${cache.size}`;
            // to handle recursive calls
            cache.add(key);
            console.time(key);
            let result = method.apply(this, args);
            /**
             * Duck typing to check if the response is a promise. In the case a promise is returned we want
             * to know when the promise value is resolved.
             */
            if ((typeof result === 'function' || typeof result === 'object') && typeof result.then === 'function') {
                result = result.then((resolvedValue) => {
                    console.timeEnd(key);
                    return resolvedValue;
                });
            }
            else {
                console.timeEnd(key);
            }
            return result;
        };
        return descriptor;
    };
};
exports.LogDuration = LogDuration;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9nLWR1cmF0aW9uLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2RlY29yYXRvcnMvbG9nLWR1cmF0aW9uLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFPLE1BQU0sV0FBVyxHQUFHLEdBQUcsRUFBRTtJQUU5QixPQUFPLENBQUMsTUFBVyxFQUFFLFdBQTRCLEVBQUUsVUFBOEIsRUFBRSxFQUFFO1FBRW5GLE1BQU0sS0FBSyxHQUFHLElBQUksR0FBVyxDQUFDO1FBQzlCLE1BQU0sTUFBTSxHQUFHLFVBQVUsQ0FBQyxLQUFLLENBQUM7UUFFaEMsVUFBVSxDQUFDLEtBQUssR0FBRyxVQUFVLEdBQUcsSUFBVztZQUV6QyxJQUFJLEdBQUcsR0FBRyxlQUFlLE1BQU0sQ0FBQyxXQUFXLENBQUMsSUFBSSxJQUFJLE1BQU0sQ0FBQyxXQUFXLENBQUMsSUFBSSxLQUFLLENBQUMsSUFBSSxFQUFFLENBQUM7WUFFeEYsNEJBQTRCO1lBQzVCLEtBQUssQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUM7WUFFZixPQUFPLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBRWxCLElBQUksTUFBTSxHQUFRLE1BQU0sQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxDQUFDO1lBRTNDOzs7ZUFHRztZQUNILElBQUksQ0FBQyxPQUFPLE1BQU0sS0FBSyxVQUFVLElBQUksT0FBTyxNQUFNLEtBQUssUUFBUSxDQUFDLElBQUksT0FBTyxNQUFNLENBQUMsSUFBSSxLQUFLLFVBQVUsRUFBRSxDQUFDO2dCQUN0RyxNQUFNLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLGFBQWtCLEVBQUUsRUFBRTtvQkFDMUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQztvQkFDckIsT0FBTyxhQUFhLENBQUM7Z0JBQ3ZCLENBQUMsQ0FBQyxDQUFDO1lBQ0wsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLE9BQU8sQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUM7WUFDdkIsQ0FBQztZQUVELE9BQU8sTUFBTSxDQUFDO1FBQ2hCLENBQUMsQ0FBQztRQUVGLE9BQU8sVUFBVSxDQUFDO0lBQ3BCLENBQUMsQ0FBQztBQUNKLENBQUMsQ0FBQTtBQXBDWSxRQUFBLFdBQVcsZUFvQ3ZCIiwic291cmNlc0NvbnRlbnQiOlsiZXhwb3J0IGNvbnN0IExvZ0R1cmF0aW9uID0gKCkgPT4ge1xuICBcbiAgcmV0dXJuICh0YXJnZXQ6IGFueSwgcHJvcGVydHlLZXk6IHN0cmluZyB8IHN5bWJvbCwgZGVzY3JpcHRvcjogUHJvcGVydHlEZXNjcmlwdG9yKSA9PiB7XG4gICAgXG4gICAgY29uc3QgY2FjaGUgPSBuZXcgU2V0PHN0cmluZz47XG4gICAgY29uc3QgbWV0aG9kID0gZGVzY3JpcHRvci52YWx1ZTtcbiAgICBcbiAgICBkZXNjcmlwdG9yLnZhbHVlID0gZnVuY3Rpb24gKC4uLmFyZ3M6IGFueVtdKSB7XG4gICAgICBcbiAgICAgIGxldCBrZXkgPSBgRHVyYXRpb24ub2YuJHt0YXJnZXQuY29uc3RydWN0b3IubmFtZX0uJHtTdHJpbmcocHJvcGVydHlLZXkpfV8ke2NhY2hlLnNpemV9YDtcbiAgICAgIFxuICAgICAgLy8gdG8gaGFuZGxlIHJlY3Vyc2l2ZSBjYWxsc1xuICAgICAgY2FjaGUuYWRkKGtleSk7XG5cbiAgICAgIGNvbnNvbGUudGltZShrZXkpO1xuXG4gICAgICBsZXQgcmVzdWx0OiBhbnkgPSBtZXRob2QuYXBwbHkodGhpcywgYXJncyk7XG5cbiAgICAgIC8qKlxuICAgICAgICogRHVjayB0eXBpbmcgdG8gY2hlY2sgaWYgdGhlIHJlc3BvbnNlIGlzIGEgcHJvbWlzZS4gSW4gdGhlIGNhc2UgYSBwcm9taXNlIGlzIHJldHVybmVkIHdlIHdhbnRcbiAgICAgICAqIHRvIGtub3cgd2hlbiB0aGUgcHJvbWlzZSB2YWx1ZSBpcyByZXNvbHZlZC5cbiAgICAgICAqL1xuICAgICAgaWYgKCh0eXBlb2YgcmVzdWx0ID09PSAnZnVuY3Rpb24nIHx8IHR5cGVvZiByZXN1bHQgPT09ICdvYmplY3QnKSAmJiB0eXBlb2YgcmVzdWx0LnRoZW4gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgcmVzdWx0ID0gcmVzdWx0LnRoZW4oKHJlc29sdmVkVmFsdWU6IGFueSkgPT4ge1xuICAgICAgICAgIGNvbnNvbGUudGltZUVuZChrZXkpO1xuICAgICAgICAgIHJldHVybiByZXNvbHZlZFZhbHVlO1xuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnNvbGUudGltZUVuZChrZXkpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH07XG5cbiAgICByZXR1cm4gZGVzY3JpcHRvcjtcbiAgfTtcbn0iXX0=