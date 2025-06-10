import { Get, Request, Response } from '../../../fw24';

export class ExtraMethods {
  @Get('/ping')
  async ping(_req: Request, res: Response) {
    return res.json({ pong: true });
  }
} 