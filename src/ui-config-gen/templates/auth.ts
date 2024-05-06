
export default (
    options: {

        authEndpoint?: string,

        enableSignin?: boolean,
        enableSignUp?: boolean,

        enableForgotPassword?: boolean,

        enableAccountVerification?: boolean,
    }
) =>  {

    const {
        authEndpoint = 'auth',

        enableSignin = true,
        enableSignUp = true,

        enableForgotPassword = true,

        enableAccountVerification = true,
    } = options;

    
    const config: any = {};

    if(enableSignin){
        config['/login'] = {
            apiConfig: {
                apiUrl: `/${authEndpoint}/signin/`,
                apiMethod: "POST"
            },
            pageType: "form",
            propertiesConfig: [
                {
                    column: "email",
                    label : "Email Address",
                    placeholder: "Email Address",
                    validations: ["required", "email"]
                }, 
                {
                    column: "password",
                    label : "Password",
                    fieldType: "password",
                    placeholder: "Password",
                    validations: ["required"]
                }
            ]
        };             
    }

    if(enableSignUp){
        config['/signup'] = {
            apiConfig: {
                apiUrl: `/${authEndpoint}/signup/`,
                apiMethod: "POST"
            },
            pageType: "form",
            propertiesConfig: [
                {
                    column: "email",
                    label : "Email Address",
                    placeholder: "Email Address",
                    validations: ["required", "email"]
                }, 
                {
                    column: "password",
                    label : "Password",
                    fieldType: "password",
                    placeholder: "Password",
                    validations: ["required"]
                },
                {
                    column: "confirmPassword",
                    label : "Confirm Password",
                    placeholder: "",
                    validations: ["required", "match:password"]
                }
            ]
        };             
    }


    if(enableAccountVerification){
        config['/verify'] = {
            apiConfig: {
                apiUrl: `/${authEndpoint}/verify/`,
                apiMethod: "POST"
            },
            pageType: "form",
            propertiesConfig: [
                {
                    column: "email",
                    label : "Email Address",
                    placeholder: "Email Address",
                    validations: ["required", "email"]
                }, 
                {
                    column: "code",
                    label : "Code",
                    placeholder: "Code",
                    validations: ["required"]
                }
            ]
        };             
    }

    if(enableForgotPassword){
        config['/forgot-password'] = {
            apiConfig: {
                apiUrl: `/${authEndpoint}/forgotPassword/`,
                apiMethod: "POST"
            },
            pageType: "form",
            propertiesConfig: [
                {
                    column: "email",
                    label : "Email Address",
                    placeholder: "Email Address",
                    validations: ["required", "email"]
                }
            ]
        };

        config['/reset-password'] = {
            apiConfig: {
                apiUrl: `/${authEndpoint}/confirmForgotPassword/`,
                apiMethod: "POST"
            },
            pageType: "form",
            propertiesConfig: [
                {
                    column: "email",
                    label : "Email Address",
                    placeholder: "Email Address",
                    validations: ["required", "email"]
                },
                {
                    column: "code",
                    label : "Code",
                    placeholder: "Code",
                    validations: ["required"]
                },
                {
                    column: "newPassword",
                    label : "New Password",
                    placeholder: "",
                    validations: ["required"]
                },
                {
                    column: "confirmNewPassword",
                    label : "Confirm New Password",
                    placeholder: "",
                    validations: ["required", "match:newPassword"]
                }
            ]
        };              
    }

    return config;
}