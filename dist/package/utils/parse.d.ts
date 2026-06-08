export type SafeParseSuccess = {
    success: true;
    value: number;
};
export type SafeParseError<ValType> = {
    success: false;
    value: ValType;
};
export type SafeParseReturnType<ValType> = SafeParseSuccess | SafeParseError<ValType>;
export declare function safeParseInt<ValType extends number>(value: any | null, defaultValue: ValType, radix?: number | undefined): SafeParseReturnType<ValType>;
export declare function safeParseFloat<ValType extends number>(value: any | null, defaultValue: ValType): SafeParseReturnType<ValType>;
interface ParseValueToCorrectTypesOptions {
    parseNull?: boolean;
    parseUndefined?: boolean;
    parseBoolean?: boolean;
    parseNumber?: boolean;
    parseJson?: boolean;
}
type ParsedValueType = any;
export declare const parseValueToCorrectTypes: (target: ParsedValueType, options?: ParseValueToCorrectTypesOptions) => ParsedValueType;
export {};
