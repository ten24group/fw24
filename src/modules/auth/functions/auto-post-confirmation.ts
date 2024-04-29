import { AdminAddUserToGroupCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';

export const handler = async (event: any) => {
    console.log('::handler:: Event: ', event);
    const email = event.request.userAttributes.email;
    const userPoolID = event.userPoolId;
    const autoUserSignupGroups = getAutoUserSignupGroups().split(',');
    const identityProviderClient = new CognitoIdentityProviderClient({});

    //add user to default groups
    for (const groupName of autoUserSignupGroups) {
        await identityProviderClient.send(
            new AdminAddUserToGroupCommand({
                UserPoolId: userPoolID,
                GroupName: groupName,
                Username: email,
            }),
        );
    }
    return event;
}

function getAutoUserSignupGroups() {
    return process.env['autoSignupGroups'] || '';
}