import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('status')
  getStatus() {
    return {
      message: 'Comunicação com a API funcionando!',
    };
  }

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
