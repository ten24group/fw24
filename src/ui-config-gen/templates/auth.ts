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
        const socialProviders = [];
        if (process.env.GOOGLE_CLIENT_ID) {
            socialProviders.push({ provider: 'Google', label: 'Login with Google' });
        }
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
            ],
            ...(socialProviders.length > 0 ? {
                socialConfig: {
                    providers: socialProviders,
                    apiUrl: `/${authEndpoint}/getSocialSignInConfig`,
                    completeSignInUrl: `/${authEndpoint}/completeSocialSignIn`,
                    redirectUri: process.env.SOCIAL_LOGIN_REDIRECT_URL || ''
                }
            } : {})
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

    // Add configuration for new password required challenge
    config['/set-new-password'] = {
        apiConfig: {
            apiUrl: `/${authEndpoint}/setNewPassword`,
            apiMethod: "POST"
        },
        pageType: "form",
        propertiesConfig: [
            {
                column: "newPassword",
                label: "New Password",
                fieldType: "password",
                placeholder: "Enter your new password",
                validations: ["required"],
                helpText: "Please set a new password for your account"
            },
            {
                column: "confirmNewPassword",
                label: "Confirm New Password",
                fieldType: "password",
                placeholder: "Confirm your new password",
                validations: ["required", "match:newPassword"],
                helpText: "Re-enter your new password"
            }
        ]
    };

    return config;
}