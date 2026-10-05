import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { GatewayConsumptionOrdersService } from './gateway-consumption-orders.service';
@Controller('internal/new-api')
export class GatewayConsumptionOrdersController {
  constructor(private readonly orders: GatewayConsumptionOrdersService) {}
  @Post('consumptions')
  @HttpCode(200)
  async notify(@Body() envelope: unknown) {
    const result = await this.orders.receiveEnvelope(envelope);
    return { accepted: true, status: result.status };
  }
}
