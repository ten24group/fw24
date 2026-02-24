import { Controller, Get, APIController } from '@ten24group/fw24';

@Controller('hello')
export class HelloController extends APIController {

    @Get('/')
    async sayHello() {
        return {
            statusCode: 200,
            body: JSON.stringify({ message: "Hello from FW24 Simulator!" })
        };
    }

    @Get('/{name}')
    async greet(event: any) {
        const name = event.pathParameters?.name || 'World';
        return {
            statusCode: 200,
            body: JSON.stringify({ message: `Hello, ${name}!` })
        };
    }
}
