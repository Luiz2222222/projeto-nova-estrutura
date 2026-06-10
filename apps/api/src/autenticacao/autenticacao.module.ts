import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AutenticacaoController } from './autenticacao.controller';
import { AutenticacaoService } from './autenticacao.service';
import { GuardaJwt } from './guarda-jwt';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const segredo = config.get<string>('JWT_SEGREDO');
        if (!segredo) {
          // Em produção, faltar o segredo é erro fatal (não inicia). Em dev, usa um fallback.
          if (process.env.NODE_ENV === 'production') {
            throw new Error('JWT_SEGREDO é obrigatório em produção.');
          }
          return { secret: 'segredo-dev' };
        }
        return { secret: segredo };
      },
    }),
  ],
  controllers: [AutenticacaoController],
  providers: [AutenticacaoService, GuardaJwt],
  exports: [GuardaJwt, JwtModule],
})
export class AutenticacaoModule {}
