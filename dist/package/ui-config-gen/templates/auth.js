"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = (options) => {
    const { authEndpoint, disableSignin, disableSignUp, disableForgotPassword, disableAccountVerification, signInMethods = ['EMAIL_PASSWORD'], } = options;
    const config = {};
    if (!disableSignin) {
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
            signInMethods: signInMethods,
            propertiesConfig: [
                {
                    column: "email",
                    label: "Email Address",
                    placeholder: "Email Address",
                    validations: ["required", "email"]
                },
                {
                    column: "password",
                    label: "Password",
                    fieldType: "password",
                    placeholder: "Password",
                    validations: ["required"]
                }
            ],
            authConfig: {
                initiateAuthUrl: `/${authEndpoint}/initiateAuth`,
                initiateOtpAuthUrl: `/${authEndpoint}/initiateOtpAuth`,
                otpResponseUrl: `/${authEndpoint}/respondToOtpChallenge`
            },
            ...(socialProviders.length > 0 ? {
                socialConfig: {
                    providers: socialProviders,
                    apiUrl: `/${authEndpoint}/getSocialSignInConfig`,
                    completeSignInUrl: `/${authEndpoint}/completeSocialSignIn`,
                    redirectUri: process.env.SOCIAL_LOGIN_REDIRECT_URL || ''
                }
            } : {})
        };
        if (signInMethods.includes('EMAIL_OTP')) {
            config['/otp-login'] = {
                pageType: 'form',
                propertiesConfig: [
                    {
                        column: 'email',
                        label: 'Email Address',
                        placeholder: 'Email Address',
                        validations: ['required', 'email']
                    }
                ]
            };
            config['/otp-login/verify'] = {
                pageType: 'form',
                propertiesConfig: [
                    {
                        column: 'otp',
                        label: 'OTP',
                        placeholder: 'OTP',
                        validations: ['required']
                    }
                ]
            };
        }
    }
    if (!disableSignUp) {
        config['/signup'] = {
            apiConfig: {
                apiUrl: `/${authEndpoint}/signup`,
                apiMethod: "POST"
            },
            pageType: "form",
            propertiesConfig: [
                {
                    column: "email",
                    label: "Email Address",
                    placeholder: "Email Address",
                    validations: ["required", "email"]
                },
                {
                    column: "password",
                    label: "Password",
                    fieldType: "password",
                    placeholder: "Password",
                    validations: ["required"]
                },
                {
                    column: "confirmPassword",
                    label: "Confirm Password",
                    fieldType: "password",
                    placeholder: "",
                    validations: ["required", "match:password"]
                }
            ]
        };
    }
    if (!disableAccountVerification) {
        config['/verify'] = {
            apiConfig: {
                apiUrl: `/${authEndpoint}/verify`,
                apiMethod: "POST"
            },
            pageType: "form",
            propertiesConfig: [
                {
                    column: "email",
                    label: "Email Address",
                    placeholder: "Email Address",
                    validations: ["required", "email"]
                },
                {
                    column: "code",
                    label: "Code",
                    placeholder: "Code",
                    validations: ["required"]
                }
            ]
        };
    }
    if (!disableForgotPassword) {
        config['/forgot-password'] = {
            apiConfig: {
                apiUrl: `/${authEndpoint}/forgotPassword`,
                apiMethod: "POST"
            },
            pageType: "form",
            propertiesConfig: [
                {
                    column: "email",
                    label: "Email Address",
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
                    label: "Email Address",
                    placeholder: "Email Address",
                    validations: ["required", "email"]
                },
                {
                    column: "code",
                    label: "Code",
                    placeholder: "Code",
                    validations: ["required"]
                },
                {
                    column: "newPassword",
                    label: "New Password",
                    fieldType: "password",
                    placeholder: "",
                    validations: ["required"]
                },
                {
                    column: "confirmNewPassword",
                    label: "Confirm New Password",
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
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXV0aC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy91aS1jb25maWctZ2VuL3RlbXBsYXRlcy9hdXRoLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEsa0JBQWUsQ0FDWCxPQU9DLEVBQ0gsRUFBRTtJQUVBLE1BQU0sRUFDRixZQUFZLEVBQ1osYUFBYSxFQUNiLGFBQWEsRUFDYixxQkFBcUIsRUFDckIsMEJBQTBCLEVBQzFCLGFBQWEsR0FBRyxDQUFDLGdCQUFnQixDQUFDLEdBQ3JDLEdBQUcsT0FBTyxDQUFDO0lBR1osTUFBTSxNQUFNLEdBQVEsRUFBRSxDQUFDO0lBRXZCLElBQUcsQ0FBQyxhQUFhLEVBQUMsQ0FBQztRQUNmLE1BQU0sZUFBZSxHQUFHLEVBQUUsQ0FBQztRQUMzQixJQUFJLE9BQU8sQ0FBQyxHQUFHLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQztZQUMvQixlQUFlLENBQUMsSUFBSSxDQUFDLEVBQUUsUUFBUSxFQUFFLFFBQVEsRUFBRSxLQUFLLEVBQUUsbUJBQW1CLEVBQUUsQ0FBQyxDQUFDO1FBQzdFLENBQUM7UUFDRCxNQUFNLENBQUMsUUFBUSxDQUFDLEdBQUc7WUFDZixTQUFTLEVBQUU7Z0JBQ1AsTUFBTSxFQUFFLElBQUksWUFBWSxTQUFTO2dCQUNqQyxTQUFTLEVBQUUsTUFBTTthQUNwQjtZQUNELFFBQVEsRUFBRSxNQUFNO1lBQ2hCLGFBQWEsRUFBRSxhQUFhO1lBQzVCLGdCQUFnQixFQUFFO2dCQUNkO29CQUNJLE1BQU0sRUFBRSxPQUFPO29CQUNmLEtBQUssRUFBRyxlQUFlO29CQUN2QixXQUFXLEVBQUUsZUFBZTtvQkFDNUIsV0FBVyxFQUFFLENBQUMsVUFBVSxFQUFFLE9BQU8sQ0FBQztpQkFDckM7Z0JBQ0Q7b0JBQ0ksTUFBTSxFQUFFLFVBQVU7b0JBQ2xCLEtBQUssRUFBRyxVQUFVO29CQUNsQixTQUFTLEVBQUUsVUFBVTtvQkFDckIsV0FBVyxFQUFFLFVBQVU7b0JBQ3ZCLFdB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O29CQUNmLFdBQVcsRUFBRSxDQUFDLFVBQVUsQ0FBQztpQkFDNUI7Z0JBQ0Q7b0JBQ0ksTUFBTSxFQUFFLG9CQUFvQjtvQkFDNUIsS0FBSyxFQUFHLHNCQUFzQjtvQkFDOUIsU0FBUyxFQUFFLFVBQVU7b0JBQ3JCLFdBQVcsRUFBRSxFQUFFO29CQUNmLFdBQVcsRUFBRSxDQUFDLFVBQVUsRUFBRSxtQkFBbUIsQ0FBQztpQkFDakQ7YUFDSjtTQUNKLENBQUM7SUFDTixDQUFDO0lBRUQsd0RBQXdEO0lBQ3hELE1BQU0sQ0FBQyxtQkFBbUIsQ0FBQyxHQUFHO1FBQzFCLFNBQVMsRUFBRTtZQUNQLE1BQU0sRUFBRSxJQUFJLFlBQVksaUJBQWlCO1lBQ3pDLFNBQVMsRUFBRSxNQUFNO1NBQ3BCO1FBQ0QsUUFBUSxFQUFFLE1BQU07UUFDaEIsZ0JBQWdCLEVBQUU7WUFDZDtnQkFDSSxNQUFNLEVBQUUsYUFBYTtnQkFDckIsS0FBSyxFQUFFLGNBQWM7Z0JBQ3JCLFNBQVMsRUFBRSxVQUFVO2dCQUNyQixXQUFXLEVBQUUseUJBQXlCO2dCQUN0QyxXQUFXLEVBQUUsQ0FBQyxVQUFVLENBQUM7Z0JBQ3pCLFFBQVEsRUFBRSw0Q0FBNEM7YUFDekQ7WUFDRDtnQkFDSSxNQUFNLEVBQUUsb0JBQW9CO2dCQUM1QixLQUFLLEVBQUUsc0JBQXNCO2dCQUM3QixTQUFTLEVBQUUsVUFBVTtnQkFDckIsV0FBVyxFQUFFLDJCQUEyQjtnQkFDeEMsV0FBVyxFQUFFLENBQUMsVUFBVSxFQUFFLG1CQUFtQixDQUFDO2dCQUM5QyxRQUFRLEVBQUUsNEJBQTRCO2FBQ3pDO1NBQ0o7S0FDSixDQUFDO0lBRUYsT0FBTyxNQUFNLENBQUM7QUFDbEIsQ0FBQyxDQUFBIiwic291cmNlc0NvbnRlbnQiOlsiZXhwb3J0IGRlZmF1bHQgKFxuICAgIG9wdGlvbnM6IHtcbiAgICAgICAgYXV0aEVuZHBvaW50Pzogc3RyaW5nLFxuICAgICAgICBkaXNhYmxlU2lnbmluPzogYm9vbGVhbixcbiAgICAgICAgZGlzYWJsZVNpZ25VcD86IGJvb2xlYW4sXG4gICAgICAgIGRpc2FibGVGb3Jnb3RQYXNzd29yZD86IGJvb2xlYW4sXG4gICAgICAgIGRpc2FibGVBY2NvdW50VmVyaWZpY2F0aW9uPzogYm9vbGVhbixcbiAgICAgICAgc2lnbkluTWV0aG9kcz86ICgnRU1BSUxfUEFTU1dPUkQnIHwgJ0VNQUlMX09UUCcgfCAnU01TX09UUCcgfCAnUEFTU0tFWScpW10sXG4gICAgfVxuKSA9PiAge1xuXG4gICAgY29uc3Qge1xuICAgICAgICBhdXRoRW5kcG9pbnQsXG4gICAgICAgIGRpc2FibGVTaWduaW4sXG4gICAgICAgIGRpc2FibGVTaWduVXAsXG4gICAgICAgIGRpc2FibGVGb3Jnb3RQYXNzd29yZCxcbiAgICAgICAgZGlzYWJsZUFjY291bnRWZXJpZmljYXRpb24sXG4gICAgICAgIHNpZ25Jbk1ldGhvZHMgPSBbJ0VNQUlMX1BBU1NXT1JEJ10sXG4gICAgfSA9IG9wdGlvbnM7XG5cbiAgICBcbiAgICBjb25zdCBjb25maWc6IGFueSA9IHt9O1xuXG4gICAgaWYoIWRpc2FibGVTaWduaW4pe1xuICAgICAgICBjb25zdCBzb2NpYWxQcm92aWRlcnMgPSBbXTtcbiAgICAgICAgaWYgKHByb2Nlc3MuZW52LkdPT0dMRV9DTElFTlRfSUQpIHtcbiAgICAgICAgICAgIHNvY2lhbFByb3ZpZGVycy5wdXNoKHsgcHJvdmlkZXI6ICdHb29nbGUnLCBsYWJlbDogJ0xvZ2luIHdpdGggR29vZ2xlJyB9KTtcbiAgICAgICAgfVxuICAgICAgICBjb25maWdbJy9sb2dpbiddID0ge1xuICAgICAgICAgICAgYXBpQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgYXBpVXJsOiBgLyR7YXV0aEVuZHBvaW50fS9zaWduaW5gLFxuICAgICAgICAgICAgICAgIGFwaU1ldGhvZDogXCJQT1NUXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwYWdlVHlwZTogXCJmb3JtXCIsXG4gICAgICAgICAgICBzaWduSW5NZXRob2RzOiBzaWduSW5NZXRob2RzLFxuICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogW1xuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgY29sdW1uOiBcImVtYWlsXCIsXG4gICAgICAgICAgICAgICAgICAgIGxhYmVsIDogXCJFbWFpbCBBZGRyZXNzXCIsXG4gICAgICAgICAgICAgICAgICAgIHBsYWNlaG9sZGVyOiBcIkVtYWlsIEFkZHJlc3NcIixcbiAgICAgICAgICAgICAgICAgICAgdmFsaWRhdGlvbnM6IFtcInJlcXVpcmVkXCIsIFwiZW1haWxcIl1cbiAgICAgICAgICAgICAgICB9LCBcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIGNvbHVtbjogXCJwYXNzd29yZFwiLFxuICAgICAgICAgICAgICAgICAgICBsYWJlbCA6IFwiUGFzc3dvcmRcIixcbiAgICAgICAgICAgICAgICAgICAgZmllbGRUeXBlOiBcInBhc3N3b3JkXCIsXG4gICAgICAgICAgICAgICAgICAgIHBsYWNlaG9sZGVyOiBcIlBhc3N3b3JkXCIsXG4gICAgICAgICAgICAgICAgICAgIHZhbGlkYXRpb25zOiBbXCJyZXF1aXJlZFwiXVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICBhdXRoQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgaW5pdGlhdGVBdXRoVXJsOiBgLyR7YXV0aEVuZHBvaW50fS9pbml0aWF0ZUF1dGhgLFxuICAgICAgICAgICAgICAgIGluaXRpYXRlT3RwQXV0aFVybDogYC8ke2F1dGhFbmRwb2ludH0vaW5pdGlhdGVPdHBBdXRoYCxcbiAgICAgICAgICAgICAgICBvdHBSZXNwb25zZVVybDogYC8ke2F1dGhFbmRwb2ludH0vcmVzcG9uZFRvT3RwQ2hhbGxlbmdlYFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIC4uLihzb2NpYWxQcm92aWRlcnMubGVuZ3RoID4gMCA/IHtcbiAgICAgICAgICAgICAgICBzb2NpYWxDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgcHJvdmlkZXJzOiBzb2NpYWxQcm92aWRlcnMsXG4gICAgICAgICAgICAgICAgICAgIGFwaVVybDogYC8ke2F1dGhFbmRwb2ludH0vZ2V0U29jaWFsU2lnbkluQ29uZmlnYCxcbiAgICAgICAgICAgICAgICAgICAgY29tcGxldGVTaWduSW5Vcmw6IGAvJHthdXRoRW5kcG9pbnR9L2NvbXBsZXRlU29jaWFsU2lnbkluYCxcbiAgICAgICAgICAgICAgICAgICAgcmVkaXJlY3RVcmk6IHByb2Nlc3MuZW52LlNPQ0lBTF9MT0dJTl9SRURJUkVDVF9VUkwgfHwgJydcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IDoge30pXG4gICAgICAgIH07XG4gICAgICAgIGlmKHNpZ25Jbk1ldGhvZHMuaW5jbHVkZXMoJ0VNQUlMX09UUCcpKXtcbiAgICAgICAgICAgIGNvbmZpZ1snL290cC1sb2dpbiddID0ge1xuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnZm9ybScsXG4gICAgICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogW1xuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgY29sdW1uOiAnZW1haWwnLFxuICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ0VtYWlsIEFkZHJlc3MnLFxuICAgICAgICAgICAgICAgICAgICBwbGFjZWhvbGRlcjogJ0VtYWlsIEFkZHJlc3MnLFxuICAgICAgICAgICAgICAgICAgICB2YWxpZGF0aW9uczogWydyZXF1aXJlZCcsICdlbWFpbCddXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgXVxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIGNvbmZpZ1snL290cC1sb2dpbi92ZXJpZnknXSA9IHtcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2Zvcm0nLFxuICAgICAgICAgICAgICAgIHByb3BlcnRpZXNDb25maWc6IFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29sdW1uOiAnb3RwJywgIFxuICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdPVFAnLFxuICAgICAgICAgICAgICAgICAgICAgICAgcGxhY2Vob2xkZXI6ICdPVFAnLFxuICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWRhdGlvbnM6IFsncmVxdWlyZWQnXVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICB9XG5cbiAgICBpZighZGlzYWJsZVNpZ25VcCl7XG4gICAgICAgIGNvbmZpZ1snL3NpZ251cCddID0ge1xuICAgICAgICAgICAgYXBpQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgYXBpVXJsOiBgLyR7YXV0aEVuZHBvaW50fS9zaWdudXBgLFxuICAgICAgICAgICAgICAgIGFwaU1ldGhvZDogXCJQT1NUXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwYWdlVHlwZTogXCJmb3JtXCIsXG4gICAgICAgICAgICBwcm9wZXJ0aWVzQ29uZmlnOiBbXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBjb2x1bW46IFwiZW1haWxcIixcbiAgICAgICAgICAgICAgICAgICAgbGFiZWwgOiBcIkVtYWlsIEFkZHJlc3NcIixcbiAgICAgICAgICAgICAgICAgICAgcGxhY2Vob2xkZXI6IFwiRW1haWwgQWRkcmVzc1wiLFxuICAgICAgICAgICAgICAgICAgICB2YWxpZGF0aW9uczogW1wicmVxdWlyZWRcIiwgXCJlbWFpbFwiXVxuICAgICAgICAgICAgICAgIH0sIFxuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgY29sdW1uOiBcInBhc3N3b3JkXCIsXG4gICAgICAgICAgICAgICAgICAgIGxhYmVsIDogXCJQYXNzd29yZFwiLFxuICAgICAgICAgICAgICAgICAgICBmaWVsZFR5cGU6IFwicGFzc3dvcmRcIixcbiAgICAgICAgICAgICAgICAgICAgcGxhY2Vob2xkZXI6IFwiUGFzc3dvcmRcIixcbiAgICAgICAgICAgICAgICAgICAgdmFsaWRhdGlvbnM6IFtcInJlcXVpcmVkXCJdXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIGNvbHVtbjogXCJjb25maXJtUGFzc3dvcmRcIixcbiAgICAgICAgICAgICAgICAgICAgbGFiZWwgOiBcIkNvbmZpcm0gUGFzc3dvcmRcIixcbiAgICAgICAgICAgICAgICAgICAgZmllbGRUeXBlOiBcInBhc3N3b3JkXCIsXG4gICAgICAgICAgICAgICAgICAgIHBsYWNlaG9sZGVyOiBcIlwiLFxuICAgICAgICAgICAgICAgICAgICB2YWxpZGF0aW9uczogW1wicmVxdWlyZWRcIiwgXCJtYXRjaDpwYXNzd29yZFwiXVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIF1cbiAgICAgICAgfTsgICAgICAgICAgICAgXG4gICAgfVxuXG5cbiAgICBpZighZGlzYWJsZUFjY291bnRWZXJpZmljYXRpb24pe1xuICAgICAgICBjb25maWdbJy92ZXJpZnknXSA9IHtcbiAgICAgICAgICAgIGFwaUNvbmZpZzoge1xuICAgICAgICAgICAgICAgIGFwaVVybDogYC8ke2F1dGhFbmRwb2ludH0vdmVyaWZ5YCxcbiAgICAgICAgICAgICAgICBhcGlNZXRob2Q6IFwiUE9TVFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcGFnZVR5cGU6IFwiZm9ybVwiLFxuICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogW1xuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgY29sdW1uOiBcImVtYWlsXCIsXG4gICAgICAgICAgICAgICAgICAgIGxhYmVsIDogXCJFbWFpbCBBZGRyZXNzXCIsXG4gICAgICAgICAgICAgICAgICAgIHBsYWNlaG9sZGVyOiBcIkVtYWlsIEFkZHJlc3NcIixcbiAgICAgICAgICAgICAgICAgICAgdmFsaWRhdGlvbnM6IFtcInJlcXVpcmVkXCIsIFwiZW1haWxcIl1cbiAgICAgICAgICAgICAgICB9LCBcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIGNvbHVtbjogXCJjb2RlXCIsXG4gICAgICAgICAgICAgICAgICAgIGxhYmVsIDogXCJDb2RlXCIsXG4gICAgICAgICAgICAgICAgICAgIHBsYWNlaG9sZGVyOiBcIkNvZGVcIixcbiAgICAgICAgICAgICAgICAgICAgdmFsaWRhdGlvbnM6IFtcInJlcXVpcmVkXCJdXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgXVxuICAgICAgICB9OyAgICAgICAgICAgICBcbiAgICB9XG5cbiAgICBpZighZGlzYWJsZUZvcmdvdFBhc3N3b3JkKXtcbiAgICAgICAgY29uZmlnWycvZm9yZ290LXBhc3N3b3JkJ10gPSB7XG4gICAgICAgICAgICBhcGlDb25maWc6IHtcbiAgICAgICAgICAgICAgICBhcGlVcmw6IGAvJHthdXRoRW5kcG9pbnR9L2ZvcmdvdFBhc3N3b3JkYCxcbiAgICAgICAgICAgICAgICBhcGlNZXRob2Q6IFwiUE9TVFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcGFnZVR5cGU6IFwiZm9ybVwiLFxuICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogW1xuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgY29sdW1uOiBcImVtYWlsXCIsXG4gICAgICAgICAgICAgICAgICAgIGxhYmVsIDogXCJFbWFpbCBBZGRyZXNzXCIsXG4gICAgICAgICAgICAgICAgICAgIHBsYWNlaG9sZGVyOiBcIkVtYWlsIEFkZHJlc3NcIixcbiAgICAgICAgICAgICAgICAgICAgdmFsaWRhdGlvbnM6IFtcInJlcXVpcmVkXCIsIFwiZW1haWxcIl1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBdXG4gICAgICAgIH07XG5cbiAgICAgICAgY29uZmlnWycvcmVzZXQtcGFzc3dvcmQnXSA9IHtcbiAgICAgICAgICAgIGFwaUNvbmZpZzoge1xuICAgICAgICAgICAgICAgIGFwaVVybDogYC8ke2F1dGhFbmRwb2ludH0vY29uZmlybUZvcmdvdFBhc3N3b3JkYCxcbiAgICAgICAgICAgICAgICBhcGlNZXRob2Q6IFwiUE9TVFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcGFnZVR5cGU6IFwiZm9ybVwiLFxuICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogW1xuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgY29sdW1uOiBcImVtYWlsXCIsXG4gICAgICAgICAgICAgICAgICAgIGxhYmVsIDogXCJFbWFpbCBBZGRyZXNzXCIsXG4gICAgICAgICAgICAgICAgICAgIHBsYWNlaG9sZGVyOiBcIkVtYWlsIEFkZHJlc3NcIixcbiAgICAgICAgICAgICAgICAgICAgdmFsaWRhdGlvbnM6IFtcInJlcXVpcmVkXCIsIFwiZW1haWxcIl1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgY29sdW1uOiBcImNvZGVcIixcbiAgICAgICAgICAgICAgICAgICAgbGFiZWwgOiBcIkNvZGVcIixcbiAgICAgICAgICAgICAgICAgICAgcGxhY2Vob2xkZXI6IFwiQ29kZVwiLFxuICAgICAgICAgICAgICAgICAgICB2YWxpZGF0aW9uczogW1wicmVxdWlyZWRcIl1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgY29sdW1uOiBcIm5ld1Bhc3N3b3JkXCIsXG4gICAgICAgICAgICAgICAgICAgIGxhYmVsIDogXCJOZXcgUGFzc3dvcmRcIixcbiAgICAgICAgICAgICAgICAgICAgZmllbGRUeXBlOiBcInBhc3N3b3JkXCIsXG4gICAgICAgICAgICAgICAgICAgIHBsYWNlaG9sZGVyOiBcIlwiLFxuICAgICAgICAgICAgICAgICAgICB2YWxpZGF0aW9uczogW1wicmVxdWlyZWRcIl1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgY29sdW1uOiBcImNvbmZpcm1OZXdQYXNzd29yZFwiLFxuICAgICAgICAgICAgICAgICAgICBsYWJlbCA6IFwiQ29uZmlybSBOZXcgUGFzc3dvcmRcIixcbiAgICAgICAgICAgICAgICAgICAgZmllbGRUeXBlOiBcInBhc3N3b3JkXCIsXG4gICAgICAgICAgICAgICAgICAgIHBsYWNlaG9sZGVyOiBcIlwiLFxuICAgICAgICAgICAgICAgICAgICB2YWxpZGF0aW9uczogW1wicmVxdWlyZWRcIiwgXCJtYXRjaDpuZXdQYXNzd29yZFwiXVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIF1cbiAgICAgICAgfTsgICAgICAgICAgICAgIFxuICAgIH1cblxuICAgIC8vIEFkZCBjb25maWd1cmF0aW9uIGZvciBuZXcgcGFzc3dvcmQgcmVxdWlyZWQgY2hhbGxlbmdlXG4gICAgY29uZmlnWycvc2V0LW5ldy1wYXNzd29yZCddID0ge1xuICAgICAgICBhcGlDb25maWc6IHtcbiAgICAgICAgICAgIGFwaVVybDogYC8ke2F1dGhFbmRwb2ludH0vc2V0TmV3UGFzc3dvcmRgLFxuICAgICAgICAgICAgYXBpTWV0aG9kOiBcIlBPU1RcIlxuICAgICAgICB9LFxuICAgICAgICBwYWdlVHlwZTogXCJmb3JtXCIsXG4gICAgICAgIHByb3BlcnRpZXNDb25maWc6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBjb2x1bW46IFwibmV3UGFzc3dvcmRcIixcbiAgICAgICAgICAgICAgICBsYWJlbDogXCJOZXcgUGFzc3dvcmRcIixcbiAgICAgICAgICAgICAgICBmaWVsZFR5cGU6IFwicGFzc3dvcmRcIixcbiAgICAgICAgICAgICAgICBwbGFjZWhvbGRlcjogXCJFbnRlciB5b3VyIG5ldyBwYXNzd29yZFwiLFxuICAgICAgICAgICAgICAgIHZhbGlkYXRpb25zOiBbXCJyZXF1aXJlZFwiXSxcbiAgICAgICAgICAgICAgICBoZWxwVGV4dDogXCJQbGVhc2Ugc2V0IGEgbmV3IHBhc3N3b3JkIGZvciB5b3VyIGFjY291bnRcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBjb2x1bW46IFwiY29uZmlybU5ld1Bhc3N3b3JkXCIsXG4gICAgICAgICAgICAgICAgbGFiZWw6IFwiQ29uZmlybSBOZXcgUGFzc3dvcmRcIixcbiAgICAgICAgICAgICAgICBmaWVsZFR5cGU6IFwicGFzc3dvcmRcIixcbiAgICAgICAgICAgICAgICBwbGFjZWhvbGRlcjogXCJDb25maXJtIHlvdXIgbmV3IHBhc3N3b3JkXCIsXG4gICAgICAgICAgICAgICAgdmFsaWRhdGlvbnM6IFtcInJlcXVpcmVkXCIsIFwibWF0Y2g6bmV3UGFzc3dvcmRcIl0sXG4gICAgICAgICAgICAgICAgaGVscFRleHQ6IFwiUmUtZW50ZXIgeW91ciBuZXcgcGFzc3dvcmRcIlxuICAgICAgICAgICAgfVxuICAgICAgICBdXG4gICAgfTtcblxuICAgIHJldHVybiBjb25maWc7XG59Il19