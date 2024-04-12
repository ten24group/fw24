import { APIGatewayController } from '../../../core/api-gateway-controller';
import { Controller } from '../../../decorators/controller';
import { Get, Post } from '../../../decorators/method';
import { Request } from '../../../interfaces/request';
import { Response } from '../../../interfaces/response';
import { Authorizer } from '../../../decorators/authorizer';

// import cognito client
import { CognitoIdentityProviderClient, SignUpCommand, InitiateAuthCommand, ConfirmSignUpCommand, GlobalSignOutCommand } from "@aws-sdk/client-cognito-identity-provider";
import { CognitoIdentityClient, GetIdCommand, GetCredentialsForIdentityCommand } from "@aws-sdk/client-cognito-identity";
import { HttpRequestValidation, ValidationRules } from '../../../validation';

const identityProviderClient = new CognitoIdentityProviderClient({});
const identityClient = new CognitoIdentityClient({});


const SignInValidations: ValidationRules = {
    email: { 
      required: true,
      datatype: 'email',
      maxLength: 40, 
    },
    password: {
      datatype: 'string',
      neq: "Blah"
    }
};

@Controller('mauth', { 
	authorizer: {
		name: 'authmodule', type: 'NONE'
	},
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
	@Get('/signup', {
		body: {
		  email: { required: true, datatype: 'email', maxLength: 40, },
		  password: { datatype: 'string', neq: "Blah2" }
		},
	})
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

	@Get('/signin', SignInValidations)
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

	@Authorizer('COGNITO_USER_POOLS')
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

		return res.send('User verified');
	}

	// generate IAM Credentials from token
	@Post('/getCredentials')
	async getCredentials(req: Request, res: Response) {
		const {idToken} = req.body as { idToken: string };
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
