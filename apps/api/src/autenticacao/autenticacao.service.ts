import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import type { DadosCadastro, DadosLogin, UsuarioPublico } from '@tcc/compartilhado';

@Injectable()
export class AutenticacaoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  // Remove a senha antes de devolver o usuário.
  publicar(u: any): UsuarioPublico {
    return {
      id: u.id,
      nomeCompleto: u.nomeCompleto,
      email: u.email,
      papel: u.papel,
      curso: u.curso ?? null,
      tratamento: u.tratamento ?? null,
      afiliacao: u.afiliacao ?? null,
      disponivelParaOrientar: u.disponivelParaOrientar,
    };
  }

  async cadastrar(dados: DadosCadastro): Promise<UsuarioPublico> {
    // 1) Conferir o código de cadastro do papel.
    const cod = await this.prisma.codigoCadastro.findUnique({
      where: { papel: dados.papel },
    });
    if (!cod || cod.codigo !== dados.codigo) {
      throw new BadRequestException({
        mensagem: 'Código de cadastro inválido',
        erros: [{ campo: 'codigo', mensagem: 'Código incorreto para este tipo de usuário' }],
      });
    }

    // 2) E-mail único.
    const email = dados.email.toLowerCase();
    const existe = await this.prisma.usuario.findUnique({ where: { email } });
    if (existe) {
      throw new BadRequestException({
        mensagem: 'E-mail já cadastrado',
        erros: [{ campo: 'email', mensagem: 'Este e-mail já está em uso' }],
      });
    }

    // 3) Criar usuário com a senha protegida (hash).
    const senhaHash = await bcrypt.hash(dados.senha, 10);
    const u = await this.prisma.usuario.create({
      data: {
        nomeCompleto: dados.nomeCompleto,
        email,
        senhaHash,
        papel: dados.papel,
        curso: dados.papel === 'ALUNO' ? dados.curso ?? null : null,
        tratamento:
          dados.papel === 'PROFESSOR' || dados.papel === 'AVALIADOR'
            ? dados.tratamento ?? null
            : null,
        afiliacao: dados.papel === 'AVALIADOR' ? dados.afiliacao ?? null : null,
      },
    });
    return this.publicar(u);
  }

  async validarCredenciais(dados: DadosLogin) {
    const u = await this.prisma.usuario.findUnique({
      where: { email: dados.email.toLowerCase() },
    });
    if (!u) throw new UnauthorizedException({ mensagem: 'E-mail ou senha incorretos' });
    const ok = await bcrypt.compare(dados.senha, u.senhaHash);
    if (!ok) throw new UnauthorizedException({ mensagem: 'E-mail ou senha incorretos' });
    return u;
  }

  gerarToken(u: { id: string; papel: string }, manterLogin: boolean): string {
    return this.jwt.sign(
      { sub: u.id, papel: u.papel },
      { expiresIn: manterLogin ? '7d' : '1d' },
    );
  }

  async buscarPorId(id: string): Promise<UsuarioPublico | null> {
    const u = await this.prisma.usuario.findUnique({ where: { id } });
    return u ? this.publicar(u) : null;
  }

  // Professor liga/desliga a disponibilidade para receber novas orientações.
  // Indisponível → some da lista de orientadores que o aluno escolhe ao abrir o TCC.
  async definirDisponibilidade(userId: string, disponivel: boolean): Promise<UsuarioPublico> {
    const u = await this.prisma.usuario.update({
      where: { id: userId },
      data: { disponivelParaOrientar: disponivel },
    });
    return this.publicar(u);
  }
}
