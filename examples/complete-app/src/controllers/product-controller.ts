import { Controller, Get, Post, APIController, Inject } from '@ten24group/fw24';
import { ProductService } from '../services/product-service';

@Controller('products', {
    resourceAccess: {
        tables: ['store-table']
    }
})
export class ProductController extends APIController {

    @Inject(ProductService)
    private productService!: ProductService;

    @Get('/')
    async listProducts() {
        const result = await this.productService.list({});
        return {
            statusCode: 200,
            body: JSON.stringify(result.data)
        };
    }

    @Get('/config-test')
    async testConfig() {
        return {
            statusCode: 200,
            body: JSON.stringify({
                setting: process.env.CUSTOM_APP_SETTING,
                message: "This value comes from Application Config environmentVariables"
            })
        };
    }

    @Get('/{id}')
    async getProduct(event: any) {
        const id = event.pathParameters?.id;
        const product = await this.productService.getProduct(id);
        return {
            statusCode: 200,
            body: JSON.stringify(product)
        };
    }

    @Post('/', { authorizer: 'AWS_IAM' })
    async createProduct(event: any) {
        // In APIController, the body is already parsed if it's application/json
        const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
        const result = await this.productService.create(body || {});
        return {
            statusCode: 201,
            body: JSON.stringify(result.data)
        };
    }
}
