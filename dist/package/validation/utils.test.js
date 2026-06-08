"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const globals_1 = require("@jest/globals");
const utils_1 = require("./utils");
(0, globals_1.describe)('isValidationRule()', () => {
    (0, globals_1.it)('should return true for valid ValidationRule objects', () => {
        const rule = {
            required: true
        };
        (0, globals_1.expect)((0, utils_1.isValidationRule)(rule)).toBe(true);
    });
    (0, globals_1.it)('should return false for non-objects', () => {
        (0, globals_1.expect)((0, utils_1.isValidationRule)(123)).toBe(false);
        (0, globals_1.expect)((0, utils_1.isValidationRule)('abc')).toBe(false);
        (0, globals_1.expect)((0, utils_1.isValidationRule)(null)).toBe(false);
        (0, globals_1.expect)((0, utils_1.isValidationRule)(undefined)).toBe(false);
    });
    (0, globals_1.it)('should return false for objects without valid keys', () => {
        (0, globals_1.expect)((0, utils_1.isValidationRule)({ foo: 'bar' })).toBe(false);
    });
});
(0, globals_1.describe)('isValidationRules()', () => {
    (0, globals_1.it)('should return true for valid ValidationRules objects', () => {
        const rules = {
            name: {
                required: true
            },
            email: {
                required: true,
                datatype: 'email'
            }
        };
        (0, globals_1.expect)((0, utils_1.isInputValidationRule)(rules)).toBe(true);
    });
    (0, globals_1.it)('should return false for non-objects', () => {
        (0, globals_1.expect)((0, utils_1.isInputValidationRule)(123)).toBe(false);
        (0, globals_1.expect)((0, utils_1.isInputValidationRule)('abc')).toBe(false);
        (0, globals_1.expect)((0, utils_1.isInputValidationRule)(null)).toBe(false);
        (0, globals_1.expect)((0, utils_1.isInputValidationRule)(undefined)).toBe(false);
    });
    (0, globals_1.it)('should return false for objects with invalid rules', () => {
        const rules = {
            name: {
                required: true
            },
            email: 'invalid'
        };
        (0, globals_1.expect)((0, utils_1.isInputValidationRule)(rules)).toBe(false);
    });
});
(0, globals_1.describe)('isHttpRequestValidationRule()', () => {
    (0, globals_1.it)('should return true for valid HttpRequestValidationRule objects', () => {
        const rule = {
            body: {
                name: {
                    required: true
                }
            }
        };
        (0, globals_1.expect)((0, utils_1.isHttpRequestValidationRule)(rule)).toBe(true);
    });
    (0, globals_1.it)('should return true for valid HttpRequestValidationRule objects 2', () => {
        const rule = {
            body: {
                email: {
                    required: true,
                    datatype: 'email',
                    maxLength: 40,
                },
                password: {
                    datatype: 'string',
                    neq: "Blah"
                }
            }
        };
        (0, globals_1.expect)((0, utils_1.isHttpRequestValidationRule)(rule)).toBe(true);
    });
    (0, globals_1.it)('should return true for objects with valid query rules', () => {
        const rule = {
            query: {
                limit: {
                    required: true,
                    datatype: 'number'
                }
            }
        };
        (0, globals_1.expect)((0, utils_1.isHttpRequestValidationRule)(rule)).toBe(true);
    });
    (0, globals_1.it)('should return true for objects with valid param rules', () => {
        const rule = {
            param: {
                id: {
                    required: true,
                    datatype: 'uuid'
                }
            }
        };
        (0, globals_1.expect)((0, utils_1.isHttpRequestValidationRule)(rule)).toBe(true);
    });
    (0, globals_1.it)('should return true for objects with valid header rules', () => {
        const rule = {
            header: {
                'Content-Type': {
                    required: true,
                    inList: ['application/json']
                }
            }
        };
        (0, globals_1.expect)((0, utils_1.isHttpRequestValidationRule)(rule)).toBe(true);
    });
    (0, globals_1.it)('should return false for non-objects', () => {
        (0, globals_1.expect)((0, utils_1.isHttpRequestValidationRule)(123)).toBe(false);
        (0, globals_1.expect)((0, utils_1.isHttpRequestValidationRule)('abc')).toBe(false);
        (0, globals_1.expect)((0, utils_1.isHttpRequestValidationRule)(null)).toBe(false);
        (0, globals_1.expect)((0, utils_1.isHttpRequestValidationRule)(undefined)).toBe(false);
    });
    (0, globals_1.it)('should return false for objects without valid sub-rules', () => {
        const rule = {
            body: 'invalid'
        };
        (0, globals_1.expect)((0, utils_1.isHttpRequestValidationRule)(rule)).toBe(false);
    });
});
(0, globals_1.describe)('extractOpValidationFromEntityValidations()', () => {
    (0, globals_1.it)('should return empty validations when no entityValidations passed', () => {
        const result = (0, utils_1.extractOpValidationFromEntityValidations)('create', {});
        (0, globals_1.expect)(result).toEqual({
            opValidations: {
                actor: {},
                input: {},
                record: {}
            },
            conditions: undefined
        });
    });
    (0, globals_1.it)('should extract validations for given op from array', () => {
        const entityValidations = {
            actor: {
                id: [{
                        operations: ['create'],
                        required: true
                    }]
            }
        };
        const result = (0, utils_1.extractOpValidationFromEntityValidations)('create', entityValidations);
        (0, globals_1.expect)(result).toEqual({
            opValidations: {
                actor: {
                    id: [{
                            required: true
                        }]
                },
                input: {},
                record: {}
            },
            conditions: undefined
        });
    });
    (0, globals_1.it)('should only extract validations for given op', () => {
        const entityValidations = {
            // has validations for create and update op  
            actor: {
                id: [
                    { operations: ['create'], required: true },
                    { operations: ['update'], required: false }
                ]
            }
        };
        const resultForCreate = (0, utils_1.extractOpValidationFromEntityValidations)('create', entityValidations);
        (0, globals_1.expect)(resultForCreate).toEqual({
            opValidations: {
                actor: {
                    id: [{ required: true }]
                },
                input: {},
                record: {}
            },
            conditions: undefined
        });
        const resultForUpdate = (0, utils_1.extractOpValidationFromEntityValidations)('update', entityValidations);
        (0, globals_1.expect)(resultForUpdate).toEqual({
            opValidations: {
                actor: {
                    id: [{ required: false }]
                },
                input: {},
                record: {}
            },
            conditions: undefined
        });
    });
    (0, globals_1.it)('should handle no matching op validations', () => {
        const entityValidations = {
            actor: {
                id: [{
                        operations: ['create'],
                        required: true
                    }]
            }
        };
        const result = (0, utils_1.extractOpValidationFromEntityValidations)('read', entityValidations);
        (0, globals_1.expect)(result).toEqual({
            conditions: undefined,
            opValidations: {
                actor: {},
                input: {},
                record: {}
            }
        });
    });
    (0, globals_1.it)('should extract multiple validation rules for a property', () => {
        const entityValidations = {
            actor: {
                id: [
                    { required: true },
                    { datatype: 'string' }
                ]
            }
        };
        const result = (0, utils_1.extractOpValidationFromEntityValidations)('update', entityValidations);
        (0, globals_1.expect)(result).toEqual({
            opValidations: {
                actor: {
                    id: [
                        { required: true },
                        { datatype: 'string' }
                    ]
                },
                input: {},
                record: {}
            },
            conditions: undefined
        });
    });
    (0, globals_1.it)('should handle conditional validations from tuple', () => {
        const conditions = {
            recordIsNotNew: {
                record: {
                    userId: {
                        neq: ''
                    }
                }
            }
        };
        const entityValidations = {
            conditions,
            actor: {
                id: [{
                        operations: [['update', ['recordIsNotNew']]],
                        required: true
                    }]
            }
        };
        const result = (0, utils_1.extractOpValidationFromEntityValidations)('update', entityValidations);
        (0, globals_1.expect)(result).toEqual({
            opValidations: {
                actor: {
                    id: [{
                            conditions: [['recordIsNotNew'], 'all'],
                            required: true
                        }]
                },
                input: {},
                record: {}
            },
            conditions
        });
    });
    (0, globals_1.it)('should handle conditional validations from object', () => {
        const conditions = {
            recordIsNotNew: {
                record: {
                    userId: {
                        neq: ''
                    }
                }
            }
        };
        const entityValidations = {
            conditions,
            actor: {
                id: [{
                        operations: {
                            //@ts-ignore
                            'update': [{ conditions: ['recordIsNotNew'] }],
                        },
                        required: true
                    }]
            }
        };
        const result = (0, utils_1.extractOpValidationFromEntityValidations)('update', entityValidations);
        (0, globals_1.expect)(result).toEqual({
            opValidations: {
                actor: {
                    id: [{
                            conditions: [['recordIsNotNew'], 'all'],
                            required: true
                        }]
                },
                input: {},
                record: {}
            },
            conditions
        });
    });
    (0, globals_1.it)('should extract validation conditions for given op from object', () => {
        const entityValidations = {
            actor: {
                id: [{
                        required: true,
                        operations: {
                            //@ts-ignore
                            create: [{
                                    conditions: ['recordIsNotNew', 'recordIsNotNew'],
                                    scope: 'any',
                                }],
                        }
                    }]
            }
        };
        const result = (0, utils_1.extractOpValidationFromEntityValidations)('create', entityValidations);
        (0, globals_1.expect)(result).toEqual({
            opValidations: {
                actor: {
                    id: [{
                            required: true,
                            conditions: [['recordIsNotNew', 'recordIsNotNew'], 'any']
                        }]
                },
                input: {},
                record: {}
            },
            conditions: undefined
        });
    });
    (0, globals_1.it)('should handle invalid validation rules', () => {
        const consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
        const entityValidations = {
            actor: {
                id: [
                    { operations: ['update'] } // no other validations
                ]
            }
        };
        const result = (0, utils_1.extractOpValidationFromEntityValidations)('update', entityValidations);
        (0, globals_1.expect)(result).toEqual({
            opValidations: {
                actor: {
                    id: [{}]
                },
                input: {},
                record: {}
            },
            conditions: undefined
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXRpbHMudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy92YWxpZGF0aW9uL3V0aWxzLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSwyQ0FBcUQ7QUFDckQsbUNBQXlJO0FBSXpJLElBQUEsa0JBQVEsRUFBQyxvQkFBb0IsRUFBRSxHQUFHLEVBQUU7SUFDbEMsSUFBQSxZQUFFLEVBQUMscURBQXFELEVBQUUsR0FBRyxFQUFFO1FBQzdELE1BQU0sSUFBSSxHQUFHO1lBQ1gsUUFBUSxFQUFFLElBQUk7U0FDZixDQUFDO1FBQ0YsSUFBQSxnQkFBTSxFQUFDLElBQUEsd0JBQWdCLEVBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDNUMsQ0FBQyxDQUFDLENBQUM7SUFFSCxJQUFBLFlBQUUsRUFBQyxxQ0FBcUMsRUFBRSxHQUFHLEVBQUU7UUFDN0MsSUFBQSxnQkFBTSxFQUFDLElBQUEsd0JBQWdCLEVBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUM7UUFDMUMsSUFBQSxnQkFBTSxFQUFDLElBQUEsd0JBQWdCLEVBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUM7UUFDNUMsSUFBQSxnQkFBTSxFQUFDLElBQUEsd0JBQWdCLEVBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUM7UUFDM0MsSUFBQSxnQkFBTSxFQUFDLElBQUEsd0JBQWdCLEVBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUM7SUFDbEQsQ0FBQyxDQUFDLENBQUM7SUFFSCxJQUFBLFlBQUUsRUFBQyxvREFBb0QsRUFBRSxHQUFHLEVBQUU7UUFDNUQsSUFBQSxnQkFBTSxFQUFDLElBQUEsd0JBQWdCLEVBQUMsRUFBQyxHQUFHLEVBQUUsS0FBSyxFQUFD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QkFBaUIsQ0FBQyxDQUFDO1FBRXJGLElBQUEsZ0JBQU0sRUFBQyxNQUFNLENBQUMsQ0FBQyxPQUFPLENBQUM7WUFDckIsYUFBYSxFQUFFO2dCQUNiLEtBQUssRUFBRTtvQkFDTCxFQUFFLEVBQUUsQ0FBQyxFQUFFLENBQUM7aUJBQ1Q7Z0JBQ0QsS0FBSyxFQUFFLEVBQUU7Z0JBQ1QsTUFBTSxFQUFFLEVBQUU7YUFDWDtZQUNELFVBQVUsRUFBRSxTQUFTO1NBQ3RCLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0FBRUwsQ0FBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBkZXNjcmliZSwgZXhwZWN0LCBpdCB9IGZyb20gJ0BqZXN0L2dsb2JhbHMnO1xuaW1wb3J0IHsgZXh0cmFjdE9wVmFsaWRhdGlvbkZyb21FbnRpdHlWYWxpZGF0aW9ucywgaXNIdHRwUmVxdWVzdFZhbGlkYXRpb25SdWxlLCBpc0lucHV0VmFsaWRhdGlvblJ1bGUsIGlzVmFsaWRhdGlvblJ1bGUgfSBmcm9tICcuL3V0aWxzJztcbmltcG9ydCB7IEVudGl0eVZhbGlkYXRpb25zIH0gZnJvbSAnLi90eXBlcyc7XG5pbXBvcnQgeyBURGVmYXVsdEVudGl0eU9wZXJhdGlvbnMgfSBmcm9tICcuLi9lbnRpdHknO1xuXG5kZXNjcmliZSgnaXNWYWxpZGF0aW9uUnVsZSgpJywgKCkgPT4ge1xuICBpdCgnc2hvdWxkIHJldHVybiB0cnVlIGZvciB2YWxpZCBWYWxpZGF0aW9uUnVsZSBvYmplY3RzJywgKCkgPT4ge1xuICAgIGNvbnN0IHJ1bGUgPSB7XG4gICAgICByZXF1aXJlZDogdHJ1ZVxuICAgIH07XG4gICAgZXhwZWN0KGlzVmFsaWRhdGlvblJ1bGUocnVsZSkpLnRvQmUodHJ1ZSk7XG4gIH0pO1xuXG4gIGl0KCdzaG91bGQgcmV0dXJuIGZhbHNlIGZvciBub24tb2JqZWN0cycsICgpID0+IHtcbiAgICBleHBlY3QoaXNWYWxpZGF0aW9uUnVsZSgxMjMpKS50b0JlKGZhbHNlKTtcbiAgICBleHBlY3QoaXNWYWxpZGF0aW9uUnVsZSgnYWJjJykpLnRvQmUoZmFsc2UpO1xuICAgIGV4cGVjdChpc1ZhbGlkYXRpb25SdWxlKG51bGwpKS50b0JlKGZhbHNlKTtcbiAgICBleHBlY3QoaXNWYWxpZGF0aW9uUnVsZSh1bmRlZmluZWQpKS50b0JlKGZhbHNlKTtcbiAgfSk7XG5cbiAgaXQoJ3Nob3VsZCByZXR1cm4gZmFsc2UgZm9yIG9iamVjdHMgd2l0aG91dCB2YWxpZCBrZXlzJywgKCkgPT4ge1xuICAgIGV4cGVjdChpc1ZhbGlkYXRpb25SdWxlKHtmb286ICdiYXInfSkpLnRvQmUoZmFsc2UpO1xuICB9KTtcbn0pO1xuXG5kZXNjcmliZSgnaXNWYWxpZGF0aW9uUnVsZXMoKScsICgpID0+IHtcbiAgaXQoJ3Nob3VsZCByZXR1cm4gdHJ1ZSBmb3IgdmFsaWQgVmFsaWRhdGlvblJ1bGVzIG9iamVjdHMnLCAoKSA9PiB7XG4gICAgY29uc3QgcnVsZXMgPSB7XG4gICAgICBuYW1lOiB7XG4gICAgICAgIHJlcXVpcmVkOiB0cnVlXG4gICAgICB9LFxuICAgICAgZW1haWw6IHtcbiAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgIGRhdGF0eXBlOiAnZW1haWwnXG4gICAgICB9XG4gICAgfTtcbiAgICBleHBlY3QoaXNJbnB1dFZhbGlkYXRpb25SdWxlKHJ1bGVzKSkudG9CZSh0cnVlKTtcbiAgfSk7XG5cbiAgaXQoJ3Nob3VsZCByZXR1cm4gZmFsc2UgZm9yIG5vbi1vYmplY3RzJywgKCkgPT4ge1xuICAgIGV4cGVjdChpc0lucHV0VmFsaWRhdGlvblJ1bGUoMTIzKSkudG9CZShmYWxzZSk7XG4gICAgZXhwZWN0KGlzSW5wdXRWYWxpZGF0aW9uUnVsZSgnYWJjJykpLnRvQmUoZmFsc2UpO1xuICAgIGV4cGVjdChpc0lucHV0VmFsaWRhdGlvblJ1bGUobnVsbCkpLnRvQmUoZmFsc2UpO1xuICAgIGV4cGVjdChpc0lucHV0VmFsaWRhdGlvblJ1bGUodW5kZWZpbmVkKSkudG9CZShmYWxzZSk7XG4gIH0pO1xuXG4gIGl0KCdzaG91bGQgcmV0dXJuIGZhbHNlIGZvciBvYmplY3RzIHdpdGggaW52YWxpZCBydWxlcycsICgpID0+IHtcbiAgICBjb25zdCBydWxlcyA9IHtcbiAgICAgIG5hbWU6IHtcbiAgICAgICAgcmVxdWlyZWQ6IHRydWVcbiAgICAgIH0sXG4gICAgICBlbWFpbDogJ2ludmFsaWQnXG4gICAgfTtcbiAgICBleHBlY3QoaXNJbnB1dFZhbGlkYXRpb25SdWxlKHJ1bGVzKSkudG9CZShmYWxzZSk7XG4gIH0pO1xufSk7XG5cbmRlc2NyaWJlKCdpc0h0dHBSZXF1ZXN0VmFsaWRhdGlvblJ1bGUoKScsICgpID0+IHtcbiAgaXQoJ3Nob3VsZCByZXR1cm4gdHJ1ZSBmb3IgdmFsaWQgSHR0cFJlcXVlc3RWYWxpZGF0aW9uUnVsZSBvYmplY3RzJywgKCkgPT4ge1xuICAgIGNvbnN0IHJ1bGUgPSB7XG4gICAgICBib2R5OiB7XG4gICAgICAgIG5hbWU6IHtcbiAgICAgICAgICByZXF1aXJlZDogdHJ1ZVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfTtcbiAgICBleHBlY3QoaXNIdHRwUmVxdWVzdFZhbGlkYXRpb25SdWxlKHJ1bGUpKS50b0JlKHRydWUpO1xuICB9KTtcblxuICBpdCgnc2hvdWxkIHJldHVybiB0cnVlIGZvciB2YWxpZCBIdHRwUmVxdWVzdFZhbGlkYXRpb25SdWxlIG9iamVjdHMgMicsICgpID0+IHtcbiAgICBjb25zdCBydWxlID0ge1xuICAgICAgYm9keToge1xuICAgICAgICBlbWFpbDogeyBcbiAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgICBkYXRhdHlwZTogJ2VtYWlsJyxcbiAgICAgICAgICBtYXhMZW5ndGg6IDQwLCBcbiAgICAgICAgfSxcbiAgICAgICAgcGFzc3dvcmQ6IHtcbiAgICAgICAgICBkYXRhdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgbmVxOiBcIkJsYWhcIlxuICAgICAgICB9XG4gICAgICB9XG4gICAgfTtcbiAgICBleHBlY3QoaXNIdHRwUmVxdWVzdFZhbGlkYXRpb25SdWxlKHJ1bGUpKS50b0JlKHRydWUpO1xuICB9KTtcblxuICBpdCgnc2hvdWxkIHJldHVybiB0cnVlIGZvciBvYmplY3RzIHdpdGggdmFsaWQgcXVlcnkgcnVsZXMnLCAoKSA9PiB7XG4gICAgY29uc3QgcnVsZSA9IHtcbiAgICAgIHF1ZXJ5OiB7XG4gICAgICAgIGxpbWl0OiB7XG4gICAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgICAgZGF0YXR5cGU6ICdudW1iZXInXG4gICAgICAgIH0gIFxuICAgICAgfVxuICAgIH07XG4gICAgZXhwZWN0KGlzSHR0cFJlcXVlc3RWYWxpZGF0aW9uUnVsZShydWxlKSkudG9CZSh0cnVlKTtcbiAgfSk7XG5cbiAgaXQoJ3Nob3VsZCByZXR1cm4gdHJ1ZSBmb3Igb2JqZWN0cyB3aXRoIHZhbGlkIHBhcmFtIHJ1bGVzJywgKCkgPT4ge1xuICAgIGNvbnN0IHJ1bGUgPSB7XG4gICAgICBwYXJhbToge1xuICAgICAgICBpZDoge1xuICAgICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICAgIGRhdGF0eXBlOiAndXVpZCdcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH07XG4gICAgZXhwZWN0KGlzSHR0cFJlcXVlc3RWYWxpZGF0aW9uUnVsZShydWxlKSkudG9CZSh0cnVlKTtcbiAgfSk7XG5cbiAgaXQoJ3Nob3VsZCByZXR1cm4gdHJ1ZSBmb3Igb2JqZWN0cyB3aXRoIHZhbGlkIGhlYWRlciBydWxlcycsICgpID0+IHtcbiAgICBjb25zdCBydWxlID0ge1xuICAgICAgaGVhZGVyOiB7XG4gICAgICAgICdDb250ZW50LVR5cGUnOiB7XG4gICAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgICAgaW5MaXN0OiBbJ2FwcGxpY2F0aW9uL2pzb24nXVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfTtcbiAgICBleHBlY3QoaXNIdHRwUmVxdWVzdFZhbGlkYXRpb25SdWxlKHJ1bGUpKS50b0JlKHRydWUpO1xuICB9KTtcblxuICBpdCgnc2hvdWxkIHJldHVybiBmYWxzZSBmb3Igbm9uLW9iamVjdHMnLCAoKSA9PiB7XG4gICAgZXhwZWN0KGlzSHR0cFJlcXVlc3RWYWxpZGF0aW9uUnVsZSgxMjMpKS50b0JlKGZhbHNlKTtcbiAgICBleHBlY3QoaXNIdHRwUmVxdWVzdFZhbGlkYXRpb25SdWxlKCdhYmMnKSkudG9CZShmYWxzZSk7XG4gICAgZXhwZWN0KGlzSHR0cFJlcXVlc3RWYWxpZGF0aW9uUnVsZShudWxsKSkudG9CZShmYWxzZSk7XG4gICAgZXhwZWN0KGlzSHR0cFJlcXVlc3RWYWxpZGF0aW9uUnVsZSh1bmRlZmluZWQpKS50b0JlKGZhbHNlKTtcbiAgfSk7XG5cbiAgaXQoJ3Nob3VsZCByZXR1cm4gZmFsc2UgZm9yIG9iamVjdHMgd2l0aG91dCB2YWxpZCBzdWItcnVsZXMnLCAoKSA9PiB7XG4gICAgY29uc3QgcnVsZSA9IHtcbiAgICAgIGJvZHk6ICdpbnZhbGlkJyAgXG4gICAgfTtcbiAgICBleHBlY3QoaXNIdHRwUmVxdWVzdFZhbGlkYXRpb25SdWxlKHJ1bGUpKS50b0JlKGZhbHNlKTtcbiAgfSk7XG59KTtcblxuZGVzY3JpYmUoJ2V4dHJhY3RPcFZhbGlkYXRpb25Gcm9tRW50aXR5VmFsaWRhdGlvbnMoKScsICgpID0+IHtcblxuICBpdCgnc2hvdWxkIHJldHVybiBlbXB0eSB2YWxpZGF0aW9ucyB3aGVuIG5vIGVudGl0eVZhbGlkYXRpb25zIHBhc3NlZCcsICgpID0+IHtcbiAgICBjb25zdCByZXN1bHQgPSBleHRyYWN0T3BWYWxpZGF0aW9uRnJvbUVudGl0eVZhbGlkYXRpb25zKCdjcmVhdGUnLCB7fSBhcyBhbnkpO1xuXG4gICAgZXhwZWN0KHJlc3VsdCkudG9FcXVhbCh7XG4gICAgICBvcFZhbGlkYXRpb25zOiB7XG4gICAgICAgIGFjdG9yOiB7fSxcbiAgICAgICAgaW5wdXQ6IHt9LFxuICAgICAgICByZWNvcmQ6IHt9XG4gICAgICB9LFxuICAgICAgY29uZGl0aW9uczogdW5kZWZpbmVkXG4gICAgfSk7XG4gIH0pO1xuXG4gIGl0KCdzaG91bGQgZXh0cmFjdCB2YWxpZGF0aW9ucyBmb3IgZ2l2ZW4gb3AgZnJvbSBhcnJheScsICgpID0+IHtcbiAgICBjb25zdCBlbnRpdHlWYWxpZGF0aW9uczogRW50aXR5VmFsaWRhdGlvbnM8YW55LCBhbnksIGFueT4gPSB7XG4gICAgICBhY3Rvcjoge1xuICAgICAgICBpZDogW3tcbiAgICAgICAgICBvcGVyYXRpb25zOiBbJ2NyZWF0ZSddLFxuICAgICAgICAgIHJlcXVpcmVkOiB0cnVlXG4gICAgICAgIH1dICBcbiAgICAgIH1cbiAgICB9O1xuICAgIFxuICAgIGNvbnN0IHJlc3VsdCA9IGV4dHJhY3RPcFZhbGlkYXRpb25Gcm9tRW50aXR5VmFsaWRhdGlvbnMoJ2NyZWF0ZScsIGVudGl0eVZhbGlkYXRpb25zKTtcblxuICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwoe1xuICAgICAgb3BWYWxpZGF0aW9uczoge1xuICAgICAgICBhY3Rvcjoge1xuICAgICAgICAgIGlkOiBbe1xuICAgICAgICAgICAgcmVxdWlyZWQ6IHRydWVcbiAgICAgICAgICB9XVxuICAgICAgICB9LFxuICAgICAgICBpbnB1dDoge30sXG4gICAgICAgIHJlY29yZDoge31cbiAgICAgIH0sXG4gICAgICBjb25kaXRpb25zOiB1bmRlZmluZWQgIFxuICAgIH0pO1xuICB9KTtcblxuICBpdCgnc2hvdWxkIG9ubHkgZXh0cmFjdCB2YWxpZGF0aW9ucyBmb3IgZ2l2ZW4gb3AnLCAoKSA9PiB7XG4gICAgY29uc3QgZW50aXR5VmFsaWRhdGlvbnM6IEVudGl0eVZhbGlkYXRpb25zPGFueSwgYW55PiAgPSB7XG4gICAgICAvLyBoYXMgdmFsaWRhdGlvbnMgZm9yIGNyZWF0ZSBhbmQgdXBkYXRlIG9wICBcbiAgICAgIGFjdG9yOiB7XG4gICAgICAgIGlkOiBbXG4gICAgICAgICAge29wZXJhdGlvbnM6IFsnY3JlYXRlJ10sIHJlcXVpcmVkOiB0cnVlfSxcbiAgICAgICAgICB7b3BlcmF0aW9uczogWyd1cGRhdGUnXSwgcmVxdWlyZWQ6IGZhbHNlfVxuICAgICAgICBdXG4gICAgICB9XG4gICAgfTtcbiAgICBcbiAgICBjb25zdCByZXN1bHRGb3JDcmVhdGUgPSBleHRyYWN0T3BWYWxpZGF0aW9uRnJvbUVudGl0eVZhbGlkYXRpb25zKCdjcmVhdGUnLCBlbnRpdHlWYWxpZGF0aW9ucyk7XG5cbiAgICBleHBlY3QocmVzdWx0Rm9yQ3JlYXRlKS50b0VxdWFsKHtcbiAgICAgIG9wVmFsaWRhdGlvbnM6IHtcbiAgICAgICAgYWN0b3I6IHtcbiAgICAgICAgICBpZDogW3tyZXF1aXJlZDogdHJ1ZX1dIFxuICAgICAgICB9LFxuICAgICAgICBpbnB1dDoge30sXG4gICAgICAgIHJlY29yZDoge31cbiAgICAgIH0sXG4gICAgICBjb25kaXRpb25zOiB1bmRlZmluZWRcbiAgICB9KTtcblxuICAgIGNvbnN0IHJlc3VsdEZvclVwZGF0ZSA9IGV4dHJhY3RPcFZhbGlkYXRpb25Gcm9tRW50aXR5VmFsaWRhdGlvbnMoJ3VwZGF0ZScsIGVudGl0eVZhbGlkYXRpb25zKTtcblxuICAgIGV4cGVjdChyZXN1bHRGb3JVcGRhdGUpLnRvRXF1YWwoe1xuICAgICAgb3BWYWxpZGF0aW9uczoge1xuICAgICAgICBhY3Rvcjoge1xuICAgICAgICAgIGlkOiBbe3JlcXVpcmVkOiBmYWxzZX1dXG4gICAgICAgIH0sXG4gICAgICAgIGlucHV0OiB7fSxcbiAgICAgICAgcmVjb3JkOiB7fVxuICAgICAgfSxcbiAgICAgIGNvbmRpdGlvbnM6IHVuZGVmaW5lZFxuICAgIH0pO1xuICB9KTtcblxuICBpdCgnc2hvdWxkIGhhbmRsZSBubyBtYXRjaGluZyBvcCB2YWxpZGF0aW9ucycsICgpID0+IHtcbiAgICBjb25zdCBlbnRpdHlWYWxpZGF0aW9uczogRW50aXR5VmFsaWRhdGlvbnM8YW55LCBhbnk+ID0ge1xuICAgICAgYWN0b3I6IHtcbiAgICAgICAgaWQ6IFt7XG4gICAgICAgICAgb3BlcmF0aW9uczogWydjcmVhdGUnXSxcbiAgICAgICAgICByZXF1aXJlZDogdHJ1ZVxuICAgICAgICB9XVxuICAgICAgfVxuICAgIH07XG5cbiAgICBjb25zdCByZXN1bHQgPSBleHRyYWN0T3BWYWxpZGF0aW9uRnJvbUVudGl0eVZhbGlkYXRpb25zKCdyZWFkJyBhcyBrZXlvZiBURGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsIGVudGl0eVZhbGlkYXRpb25zKTtcblxuICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwoe1xuICAgICAgY29uZGl0aW9uczogdW5kZWZpbmVkLFxuICAgICAgb3BWYWxpZGF0aW9uczoge1xuICAgICAgICBhY3Rvcjoge30sXG4gICAgICAgIGlucHV0OiB7fSxcbiAgICAgICAgcmVjb3JkOiB7fVxuICAgICAgfVxuICAgIH0pO1xuICB9KTtcblxuICBpdCgnc2hvdWxkIGV4dHJhY3QgbXVsdGlwbGUgdmFsaWRhdGlvbiBydWxlcyBmb3IgYSBwcm9wZXJ0eScsICgpID0+IHtcbiAgICBjb25zdCBlbnRpdHlWYWxpZGF0aW9uczogRW50aXR5VmFsaWRhdGlvbnM8YW55LCBhbnk+ID0ge1xuICAgICAgYWN0b3I6IHtcbiAgICAgICAgaWQ6IFtcbiAgICAgICAgICB7cmVxdWlyZWQ6IHRydWV9LCBcbiAgICAgICAgICB7ZGF0YXR5cGU6ICdzdHJpbmcnfVxuICAgICAgICBdXG4gICAgICB9XG4gICAgfTtcblxuICAgIGNvbnN0IHJlc3VsdCA9IGV4dHJhY3RPcFZhbGlkYXRpb25Gcm9tRW50aXR5VmFsaWRhdGlvbnMoJ3VwZGF0ZScsIGVudGl0eVZhbGlkYXRpb25zKTtcblxuICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwoe1xuICAgICAgb3BWYWxpZGF0aW9uczoge1xuICAgICAgICBhY3Rvcjoge1xuICAgICAgICAgIGlkOiBbXG4gICAgICAgICAgICB7cmVxdWlyZWQ6IHRydWV9LCBcbiAgICAgICAgICAgIHtkYXRhdHlwZTogJ3N0cmluZyd9IFxuICAgICAgICAgIF1cbiAgICAgICAgfSxcbiAgICAgICAgaW5wdXQ6IHt9LFxuICAgICAgICByZWNvcmQ6IHt9XG4gICAgICB9LFxuICAgICAgY29uZGl0aW9uczogdW5kZWZpbmVkXG4gICAgfSk7XG4gIH0pO1xuXG4gIGl0KCdzaG91bGQgaGFuZGxlIGNvbmRpdGlvbmFsIHZhbGlkYXRpb25zIGZyb20gdHVwbGUnLCAoKSA9PiB7XG4gICAgY29uc3QgY29uZGl0aW9ucyA9IHtcbiAgICAgIHJlY29yZElzTm90TmV3OiB7XG4gICAgICAgIHJlY29yZDoge1xuICAgICAgICAgIHVzZXJJZDoge1xuICAgICAgICAgICAgbmVxOiAnJ1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gYXMgY29uc3Q7XG5cbiAgICBjb25zdCBlbnRpdHlWYWxpZGF0aW9uczogRW50aXR5VmFsaWRhdGlvbnM8YW55LCB0eXBlb2YgY29uZGl0aW9ucz4gPSB7XG4gICAgICBjb25kaXRpb25zLFxuICAgICAgYWN0b3I6IHtcbiAgICAgICAgaWQ6IFt7XG4gICAgICAgICAgb3BlcmF0aW9uczogW1sndXBkYXRlJywgWydyZWNvcmRJc05vdE5ldyddXV0sXG4gICAgICAgICAgcmVxdWlyZWQ6IHRydWVcbiAgICAgICAgfV1cbiAgICAgIH0gIFxuICAgIH07XG5cbiAgICBjb25zdCByZXN1bHQgPSBleHRyYWN0T3BWYWxpZGF0aW9uRnJvbUVudGl0eVZhbGlkYXRpb25zKCd1cGRhdGUnLCBlbnRpdHlWYWxpZGF0aW9ucyk7XG5cbiAgICBleHBlY3QocmVzdWx0KS50b0VxdWFsKHtcbiAgICAgIG9wVmFsaWRhdGlvbnM6IHtcbiAgICAgICAgYWN0b3I6IHtcbiAgICAgICAgICBpZDogW3tcbiAgICAgICAgICAgIGNvbmRpdGlvbnM6IFsgWydyZWNvcmRJc05vdE5ldyddLCAnYWxsJ10sXG4gICAgICAgICAgICByZXF1aXJlZDogdHJ1ZVxuICAgICAgICAgIH1dXG4gICAgICAgIH0sXG4gICAgICAgIGlucHV0OiB7fSxcbiAgICAgICAgcmVjb3JkOiB7fVxuICAgICAgfSxcbiAgICAgIGNvbmRpdGlvbnNcbiAgICB9KTtcbiAgfSk7XG5cbiAgaXQoJ3Nob3VsZCBoYW5kbGUgY29uZGl0aW9uYWwgdmFsaWRhdGlvbnMgZnJvbSBvYmplY3QnLCAoKSA9PiB7XG4gICAgY29uc3QgY29uZGl0aW9ucyA9IHtcbiAgICAgIHJlY29yZElzTm90TmV3OiB7XG4gICAgICAgIHJlY29yZDoge1xuICAgICAgICAgIHVzZXJJZDoge1xuICAgICAgICAgICAgbmVxOiAnJ1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gYXMgY29uc3Q7XG5cbiAgICBjb25zdCBlbnRpdHlWYWxpZGF0aW9uczogRW50aXR5VmFsaWRhdGlvbnM8YW55LCB0eXBlb2YgY29uZGl0aW9ucz4gPSB7XG4gICAgICBjb25kaXRpb25zLFxuICAgICAgYWN0b3I6IHtcbiAgICAgICAgaWQ6IFt7XG4gICAgICAgICAgb3BlcmF0aW9uczogeyBcbiAgICAgICAgICAgIC8vQHRzLWlnbm9yZVxuICAgICAgICAgICAgJ3VwZGF0ZSc6IFt7IGNvbmRpdGlvbnM6IFsncmVjb3JkSXNOb3ROZXcnXSB9XSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHJlcXVpcmVkOiB0cnVlXG4gICAgICAgIH1dXG4gICAgICB9ICBcbiAgICB9O1xuXG4gICAgY29uc3QgcmVzdWx0ID0gZXh0cmFjdE9wVmFsaWRhdGlvbkZyb21FbnRpdHlWYWxpZGF0aW9ucygndXBkYXRlJywgZW50aXR5VmFsaWRhdGlvbnMpO1xuXG4gICAgZXhwZWN0KHJlc3VsdCkudG9FcXVhbCh7XG4gICAgICBvcFZhbGlkYXRpb25zOiB7XG4gICAgICAgIGFjdG9yOiB7XG4gICAgICAgICAgaWQ6IFt7XG4gICAgICAgICAgICBjb25kaXRpb25zOiBbIFsncmVjb3JkSXNOb3ROZXcnXSwgJ2FsbCcgXSxcbiAgICAgICAgICAgIHJlcXVpcmVkOiB0cnVlXG4gICAgICAgICAgfV1cbiAgICAgICAgfSxcbiAgICAgICAgaW5wdXQ6IHt9LFxuICAgICAgICByZWNvcmQ6IHt9XG4gICAgICB9LFxuICAgICAgY29uZGl0aW9uc1xuICAgIH0pO1xuICB9KTtcblxuICBpdCgnc2hvdWxkIGV4dHJhY3QgdmFsaWRhdGlvbiBjb25kaXRpb25zIGZvciBnaXZlbiBvcCBmcm9tIG9iamVjdCcsICgpID0+IHtcbiAgICBjb25zdCBlbnRpdHlWYWxpZGF0aW9uczogRW50aXR5VmFsaWRhdGlvbnM8YW55LCBhbnksIGFueT4gPSB7XG4gICAgICBhY3Rvcjoge1xuICAgICAgICBpZDogW3tcbiAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgICBvcGVyYXRpb25zOiB7XG4gICAgICAgICAgICAvL0B0cy1pZ25vcmVcbiAgICAgICAgICAgICAgY3JlYXRlOiBbe1xuICAgICAgICAgICAgICAgIGNvbmRpdGlvbnM6IFsncmVjb3JkSXNOb3ROZXcnLCAncmVjb3JkSXNOb3ROZXcnXSxcbiAgICAgICAgICAgICAgICBzY29wZTogJ2FueScsXG4gICAgICAgICAgICAgIH1dLFxuICAgICAgICAgICAgfVxuICAgICAgICB9XSAgXG4gICAgICB9XG4gICAgfTtcbiAgICBcbiAgICBjb25zdCByZXN1bHQgPSBleHRyYWN0T3BWYWxpZGF0aW9uRnJvbUVudGl0eVZhbGlkYXRpb25zKCdjcmVhdGUnLCBlbnRpdHlWYWxpZGF0aW9ucyk7XG5cbiAgICBleHBlY3QocmVzdWx0KS50b0VxdWFsKHtcbiAgICAgIG9wVmFsaWRhdGlvbnM6IHtcbiAgICAgICAgYWN0b3I6IHtcbiAgICAgICAgICBpZDogW3tcbiAgICAgICAgICAgIHJlcXVpcmVkOiB0cnVlLCBcbiAgICAgICAgICAgIGNvbmRpdGlvbnM6IFtbJ3JlY29yZElzTm90TmV3JywgJ3JlY29yZElzTm90TmV3J10sICdhbnknXSBcbiAgICAgICAgICB9XVxuICAgICAgICB9LFxuICAgICAgICBpbnB1dDoge30sXG4gICAgICAgIHJlY29yZDoge31cbiAgICAgIH0sXG4gICAgICBjb25kaXRpb25zOiB1bmRlZmluZWQgXG4gICAgfSk7XG4gIH0pO1xuXG4gIGl0KCdzaG91bGQgaGFuZGxlIGludmFsaWQgdmFsaWRhdGlvbiBydWxlcycsICgpID0+IHtcbiAgICBjb25zdCBjb25zb2xlV2FybiA9IGplc3Quc3B5T24oY29uc29sZSwgJ3dhcm4nKS5tb2NrSW1wbGVtZW50YXRpb24oKTtcbiAgICBcbiAgICBjb25zdCBlbnRpdHlWYWxpZGF0aW9uczogRW50aXR5VmFsaWRhdGlvbnM8YW55LCBhbnk+ID0ge1xuICAgICAgYWN0b3I6IHtcbiAgICAgICAgaWQ6IFtcbiAgICAgICAgICB7b3BlcmF0aW9uczogWyd1cGRhdGUnXX0gLy8gbm8gb3RoZXIgdmFsaWRhdGlvbnNcbiAgICAgICAgXVxuICAgICAgfVxuICAgIH07XG5cbiAgICBjb25zdCByZXN1bHQgPSBleHRyYWN0T3BWYWxpZGF0aW9uRnJvbUVudGl0eVZhbGlkYXRpb25zKCd1cGRhdGUnLCBlbnRpdHlWYWxpZGF0aW9ucyk7XG5cbiAgICBleHBlY3QocmVzdWx0KS50b0VxdWFsKHtcbiAgICAgIG9wVmFsaWRhdGlvbnM6IHtcbiAgICAgICAgYWN0b3I6IHtcbiAgICAgICAgICBpZDogW3t9XVxuICAgICAgICB9LFxuICAgICAgICBpbnB1dDoge30sXG4gICAgICAgIHJlY29yZDoge31cbiAgICAgIH0sXG4gICAgICBjb25kaXRpb25zOiB1bmRlZmluZWRcbiAgICB9KTtcbiAgfSk7XG4gIFxufSk7Il19