import { APIGatewayController } from '../../../core/api-gateway-controller';
import { Controller } from '../../../decorators/controller';
import { Get, Post } from '../../../decorators/method';
import { Request } from '../../../interfaces/request';
import { Response } from '../../../interfaces/response';
import { Authorizer } from '../../../decorators/authorizer';
import { CognitoJwtVerifier } from "aws-jwt-verify";

// import cognito client
import { CognitoIdentityProviderClient, SignUpCommand, InitiateAuthCommand, ConfirmSignUpCommand, GlobalSignOutCommand, ChangePasswordCommand, ForgotPasswordCommand, ConfirmForgotPasswordCommand, AdminAddUserToGroupCommand } from "@aws-sdk/client-cognito-identity-provider";
import { CognitoIdentityClient, GetIdCommand, GetCredentialsForIdentityCommand } from "@aws-sdk/client-cognito-identity";

const identityProviderClient = new CognitoIdentityProviderClient({});
const identityClient = new CognitoIdentityClient({});

@Controller('mauth', { 
	authorizer: [{
		name: 'authmodule', type: 'NONE'
	}],
	env: [
		{ name: 'userPoolClientID', prefix: 'authmodule' },
		{ name: 'userPoolID', prefix: 'authmodule' },
		{ name: 'identityPoolID', prefix: 'authmodule' }
	]
})
export class AuthController extends APIGatewayController {	
	
	async initialize() {
        // register DI factories
        return Promise.resolve();
    }

	/*
	Cognito signup, signin and verify email methods
	*/
	@Post('/signup')
	async signup(req: Request, res: Response) {
		const {email, password} = req.body as { email?: string; password?: string };
		const userPoolClientId = this.getUserPoolClientId();

		if (email === undefined || password === undefined) {
			return res.status(400).end('Missing email or password');
		}

		await identityProviderClient.send(
			new SignUpCommand({
				ClientId: userPoolClientId,
				Username: email,
				Password: password,
				UserAttributes: [
					{
					Name: 'email',
					Value: email,
					},
				],
			}),
		);
		
		return res.send('User Signed Up');
	}

	@Post('/signin')
	async signin(req: Request, res: Response) {
		const {email, password} = req.body as { email?: string; password?: string };
		const userPoolClientId = this.getUserPoolClientId();

		if (email === undefined || password === undefined) {
			return res.status(400).end('Missing email or password');
		}

		const result = await identityProviderClient.send(
			new InitiateAuthCommand({
				AuthFlow: 'USER_PASSWORD_AUTH',
				ClientId: userPoolClientId,
				AuthParameters: {
					USERNAME: email,
					PASSWORD: password,
				},
			}),
		);

		const idToken = result.AuthenticationResult?.IdToken;
		
		if (idToken === undefined) {
			return res.status(401).end('Authentication failed');
		}

		return res.json(result.AuthenticationResult);
	}

	@Post('/signout')
	async signout(req: Request, res: Response) {
		const {accessToken} = req.body as { accessToken: string };

		if (accessToken === undefined) {
			return res.status(400).end('Missing Token');
		}

		const result = await identityProviderClient.send(
			new GlobalSignOutCommand({
				AccessToken: accessToken,
			}),
		);
		this.logger.debug('result', result);

		return res.send('User logged out');
	}

	@Post('/verify')
	async verify(req: Request, res: Response) {
		const {email, code} = req.body as { email?: string; code?: string };
		const userPoolClientId = this.getUserPoolClientId();

		if (email === undefined || code === undefined) {
			return res.status(400).end('Missing email or code');
		}

		const result = await identityProviderClient.send(
			new ConfirmSignUpCommand({
				ClientId: userPoolClientId,
				Username: email,
				ConfirmationCode: code,
			}),
		);
		this.logger.debug('result', result);

		return res.send('User verified');
	}

	// change password
	@Post('/changePassword')
	async changePassword(req: Request, res: Response) {
		const {accessToken, oldPassword, newPassword} = req.body as { accessToken: string; oldPassword: string; newPassword: string };

		if (accessToken === undefined || oldPassword === undefined || newPassword === undefined) {
			return res.status(400).end('Missing accessToken, oldPassword or newPassword');
		}

		const result = await identityProviderClient.send(
			new ChangePasswordCommand({
				AccessToken: accessToken,
				PreviousPassword: oldPassword,
				ProposedPassword: newPassword,
			}),
		);

		this.logger.debug('newPasswordResult', result);

		return res.send('Password changed');
	}

	// forgot password route
	@Post('/forgotPassword')
	async forgotPassword(req: Request, res: Response) {
		const {email} = req.body as { email: string };

		if (email === undefined) {
			return res.status(400).end('Missing email');
		}

		const result = await identityProviderClient.send(
			new ForgotPasswordCommand({
				ClientId: this.getUserPoolClientId(),
				Username: email,
			}),
		);

		this.logger.debug('result', result);

		return res.send('Password reset email sent');
	}
	
	// confirm forgot password
	@Post('/confirmForgotPassword')
	async confirmForgotPassword(req: Request, res: Response) {
		const {email, code, newPassword} = req.body as { email: string; code: string; newPassword: string };

		if (email === undefined || code === undefined || newPassword === undefined) {
			return res.status(400).end('Missing email, code or newPassword');
		}

		const result = await identityProviderClient.send(
			new ConfirmForgotPasswordCommand({
				ClientId: this.getUserPoolClientId(),
				Username: email,
				ConfirmationCode: code,
				Password: newPassword,
			}),
		);

		this.logger.debug('result', result);

		return res.send('Password reset');
	}
	
	// Add user to group
	@Authorizer({type: 'AWS_IAM', requireRouteInGroupConfig: true})
	@Post('/addUserToGroup')
	async addUserToGroup(req: Request, res: Response) {
		const {email, groupName} = req.body as { email: string; groupName: string };

		if (email === undefined || groupName === undefined) {
			return res.status(400).end('Missing email or groupName');
		}

		const result = await identityProviderClient.send(
			new AdminAddUserToGroupCommand({
				UserPoolId: this.getUserPoolID(),
				GroupName: groupName,
				Username: email,
			}),
		);

		this.logger.debug('result', result);

		return res.send('User added to group');
	}

	// generate IAM Credentials from token
	@Post('/getCredentials')
	async getCredentials(req: Request, res: Response) {
		const {idToken} = req.body as { idToken: string};

		// validate the token
		const jwtVerifier = CognitoJwtVerifier.create({
			userPoolId: this.getUserPoolID(),
			clientId: this.getUserPoolClientId(),
			tokenUse: null,
		});

		try{
			const payload = await jwtVerifier.verify(idToken);
			this.logger.debug("Token is valid. Payload:", payload);
		} catch {
			this.logger.debug("Token not valid!");
			return res.send('Token not valid');
		}

		const providerName = `cognito-idp.us-east-1.amazonaws.com/${this.getUserPoolID()}`;
		const identityInput = {
			IdentityPoolId: this.getIdentityPoolId(),
			Logins: { 
				[providerName]: idToken,
			},
		};
		const identityCommand = new GetIdCommand(identityInput);
		const identityResponse = await identityClient.send(identityCommand);
		const identityID = identityResponse.IdentityId;

		const credentialInput = {
			IdentityId: identityID,
			Logins: { 
				[providerName]: idToken,
			}
		};

		const command = new GetCredentialsForIdentityCommand(credentialInput);
		const credentialsResponse = await identityClient.send(command);

		return res.json(credentialsResponse);
	}
	
	// private function to get identity pool id
	private getIdentityPoolId() {
		return process.env['identityPoolID'] || '';
	}

	// private function to get userpool client id
	private getUserPoolClientId() {
		return process.env['userPoolClientID'] || '';
	}

	// private function to get userpool client id
	private getUserPoolID() {
		return process.env['userPoolID'] || '';
	}

}

export const handler = AuthController.CreateHandler(AuthController);
