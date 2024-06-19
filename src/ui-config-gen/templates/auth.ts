
export default (
    options: {
        authEndpoint?: string,
        disableSignin?: boolean,
        disableSignUp?: boolean,
        disableForgotPassword?: boolean,
        disableAccountVerification?: boolean,
    }
) =>  {

    const {
        authEndpoint,
        disableSignin,
        disableSignUp,
        disableForgotPassword,
        disableAccountVerification,
    } = options;

    
    const config: any = {};

    if(!disableSignin){
        config['/login'] = {
            apiConfig: {
                apiUrl: `/${authEndpoint}/signin`,
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

    if(!disableSignUp){
        config['/signup'] = {
            apiConfig: {
                apiUrl: `/${authEndpoint}/signup`,
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
                    fieldType: "password",
                    placeholder: "",
                    validations: ["required", "match:password"]
                }
            ]
        };             
    }


    if(!disableAccountVerification){
        config['/verify'] = {
            apiConfig: {
                apiUrl: `/${authEndpoint}/verify`,
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

    if(!disableForgotPassword){
        config['/forgot-password'] = {
            apiConfig: {
                apiUrl: `/${authEndpoint}/forgotPassword`,
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
                apiUrl: `/${authEndpoint}/confirmForgotPassword`,
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
                    fieldType: "password",
                    placeholder: "",
                    validations: ["required"]
                },
                {
                    column: "confirmNewPassword",
                    label : "Confirm New Password",
                    fieldType: "password",
                    placeholder: "",
                    validations: ["required", "match:newPassword"]
                }
            ]
        };              
    }

    return config;
}