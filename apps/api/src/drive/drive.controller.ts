import { Controller, Get, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { GuardaJwt } from '../autenticacao/guarda-jwt';
import { GuardaPapeis } from '../comum/guarda-papeis';
import { Papeis } from '../comum/papeis.decorator';
import { DriveService } from './drive.service';
import { DriveSyncService } from './drive-sync.service';
import { basePublica } from './drive-api';

// Integração global com o Google Drive. Tudo é de COORDENADOR, exceto o callback do OAuth,
// que é aberto por definição (o Google redireciona o NAVEGADOR para cá, sem cookie garantido)
// e por isso é protegido pelo `state` de uso único gerado no início do fluxo.
@Controller('drive')
export class DriveController {
  constructor(
    private readonly drive: DriveService,
    private readonly sync: DriveSyncService,
  ) {}

  @Get('status')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  status() {
    return this.drive.statusSeguro();
  }

  @Get('pendencias')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  pendencias() {
    return this.sync.pendencias();
  }

  // Devolve a URL de consentimento (o front redireciona). Não redireciona daqui para o
  // fetch do navegador não seguir o 302 para o domínio do Google.
  @Post('autorizar')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  autorizar() {
    return this.drive.iniciarAutorizacao();
  }

  @Post('desconectar')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  async desconectar() {
    await this.drive.desconectar();
    return { ok: true };
  }

  @Post('sincronizar')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  async sincronizar() {
    const reenfileirados = await this.sync.reenfileirarErros();
    const r = await this.sync.processarPendentes();
    return { reenfileirados, ...r };
  }

  // Callback do Google. Sem guard (é o navegador voltando do consentimento); a segurança
  // vem do `state`. Sempre volta para a tela de Planejamento com o desfecho na URL —
  // nenhum dado sensível trafega aqui.
  @Get('callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    // MESMA base do redirect do OAuth (DRIVE_REDIRECT_BASE || APP_URL).
    const base = basePublica();
    try {
      await this.drive.concluirAutorizacao(code ?? '', state ?? '');
      return res.redirect(`${base}/coordenador/planejamento?drive=conectado`);
    } catch {
      // Motivo detalhado fica no status/log; a URL só sinaliza a falha.
      return res.redirect(`${base}/coordenador/planejamento?drive=erro`);
    }
  }
}
