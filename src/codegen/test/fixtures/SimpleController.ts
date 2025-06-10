import { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { Controller, APIController, Post, InjectEntityService, Request, Response } from '../../../fw24';
import { BaseEntityService } from '../../../fw24';

@Controller('simple', {
  authorizer: { type: 'NONE' },
  resourceAccess: { tables: [ 'plusfan' ] }
})
export class SimpleController extends APIController {
  constructor(
    @InjectEntityService('post') private readonly postService: BaseEntityService<any>
  ) { super(); }

  async initialize(_event: APIGatewayProxyEvent, _context: Context) {
  }

  @Post('/hello')
  async hello(_req: Request, res: Response) {
    return res.json({ hello: 'world' });
  }

  @Post('/goodbye')
  async goodbye(_req: Request, res: Response) {
    return res.json({ goodbye: 'world' });
  }
}

@Controller('demo')
export class DemoController extends APIController {
  async initialize(_event: APIGatewayProxyEvent, _context: Context) {
    // Initialize controller
  }
} 