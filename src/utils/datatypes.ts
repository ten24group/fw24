    export function isNumeric(num: any){
        return !isNaN(num)
    }

    export function isEmail(val: string){
        const pattern = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
        return pattern.test(val);
    }

    export function isUnique(val: any): boolean {
        throw(new Error(`isUnique not implemented yet: ${val}`));
    }

    export function isIP(val: any){
        return !!require('net').isIP(val)
    }

    export function isIPv4(val: any){
        return require('net').isIPv4(val)
    }

    export function isIPv6(val: any){
        return require('net').isIPv6(val)
    }

    export function isUUID(val: string){
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(val);
    }

    export function isJsonString(val: string) {
        try {
            JSON.parse(val);
        } catch (e) {
            return false;
        }
        return true;
    }

    export function isDateString(val: string) {
        return !isNaN(new Date(val).getDate());
    }

    export function isHttpUrl(val: string) {
        let url;
        try {
            url = new URL(val);
        } catch (_) {
            return false;  
        }

        return url?.protocol === "http:" || url?.protocol === "https:";
    }

    export function isArray(val: any): val is Array<any>{
        return val && Array.isArray(val);
    }

    export function isEmptyArray(val: any){
        return isArray(val) && val.length === 0;
    }

    export function isEmptyArrayDeep(val: any): boolean {
        return isArray(val) && val.every( (item: any) => isEmptyDeep(item) );
    }

    export function isObject(val: any): val is Object{
        return val && typeof val === "object";
    }

    export function isEmptyObject(val: any){
        return isObject(val) && Object.keys(val).length === 0;
    }

    export function isEmptyObjectDeep(val: any): boolean {
        return isObject(val) && Object.keys(val).every( (key: any) => isEmptyDeep(val[key]) );
    }

    export function isMap(val: any): val is Map<any, any> {
        return isObject(val) && val instanceof Map;
    }

    export function isEmptyMap(val: any){
        return isMap(val) && val.size === 0;
    }

    export function isEmptyMapDeep(val: any){
        return isMap(val) && isEmptyArray( Array.from(val.values()) );
    }

    export function isSet(val: any): val is Set<any> {
        return isObject(val) && val instanceof Set;
    }

    export function isEmptySet(val: any){
        return isSet(val) && val.size === 0;
    }

    export function isEmptySetDeep(val: any){
        return isSet(val) && isEmptyArray( Array.from(val.values()) );
    }

    export function isEmpty(val: any) {
        return val === undefined 
        || val === null 
        || val === "" 
        || isEmptyMap(val)
        || isEmptySet(val)
        || isEmptyArray(val)
        || isEmptyObject(val)
    }

    export function isEmptyDeep(val: any) {
        return val === undefined 
        || val === null 
        || val === "" 
        || isEmptyMapDeep(val)
        || isEmptySetDeep(val)
        || isEmptyArrayDeep(val)
        || isEmptyObjectDeep(val)
    }