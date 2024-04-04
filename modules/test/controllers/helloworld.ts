import { Controller, APIGatewayController, Get, Request, Response, Post } from '../../../src/fw24';

@Controller('helloworld2')
export class HelloWorld extends APIGatewayController {

	async initialize() {
        // register DI factories
        return Promise.resolve();
    }
	// Simple string response
	@Get('/print')
	print(req: Request, res: Response) {
		return res.send('Hello World!');
	}

	// JSON response
	@Get('/ping')
	ping(req: Request, res: Response) {
		return res.json({ message: 'pong' });
	}

	@Get('/noreturn')
	noreturn(req: Request, res: Response) {
		res.end('This is a response without return');
	}

	@Get('/external')
	external(req: Request, res: Response) {
		return res.redirect('https://www.google.com');
	}

	@Get('/error')
	error(req: Request, res: Response) {
		throw new Error('This is an error');
	}

	@Get('/exception')
	exception(req: Request, res: Response) {
		return res.status(500).end('This is an exception');
	}

	@Post('/post')
	post(req: Request, res: Response) {
		return res.json(req.body);
	}

	@Get('/headers')
	headers(req: Request, res: Response) {
		return res.json(req.headers);
	}
}

export const handler = HelloWorld.CreateHandler(HelloWorld);
