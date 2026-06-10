import { Controller, Get } from '@nestjs/common';

// Endpoint simples para verificar se a API está no ar.
@Controller('saude')
export class SaudeController {
  @Get()
  verificar() {
    return {
      ok: true,
      mensagem: 'API do Sistema de TCC no ar',
      horario: new Date().toISOString(),
    };
  }
}
