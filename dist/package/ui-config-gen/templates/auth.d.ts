declare const _default: (options: {
    authEndpoint?: string;
    disableSignin?: boolean;
    disableSignUp?: boolean;
    disableForgotPassword?: boolean;
    disableAccountVerification?: boolean;
    signInMethods?: ("EMAIL_PASSWORD" | "EMAIL_OTP" | "SMS_OTP" | "PASSKEY")[];
}) => any;
export default _default;
