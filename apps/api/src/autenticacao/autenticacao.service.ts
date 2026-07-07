import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import type { DadosCadastro, DadosLogin, UsuarioPublico } from '@tcc/compartilhado';

@Injectable()
export class AutenticacaoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly email: EmailService,
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

  // O token carrega `v` (versão de sessão): quando a senha muda, versaoToken é incrementada
  // e todos os tokens com `v` antigo passam a ser rejeitados pelo guard.
  gerarToken(u: { id: string; papel: string; versaoToken?: number }, manterLogin: boolean): string {
    return this.jwt.sign(
      { sub: u.id, papel: u.papel, v: u.versaoToken ?? 0 },
      { expiresIn: manterLogin ? '7d' : '1d' },
    );
  }

  async buscarPorId(id: string): Promise<UsuarioPublico | null> {
    const u = await this.prisma.usuario.findUnique({ where: { id } });
    return u ? this.publicar(u) : null;
  }

  // Troca de senha: confere a senha atual antes de gravar a nova (com hash).
  async trocarSenha(userId: string, senhaAtual: string, novaSenha: string): Promise<void> {
    const u = await this.prisma.usuario.findUnique({ where: { id: userId } });
    if (!u) throw new UnauthorizedException();
    const ok = await bcrypt.compare(senhaAtual, u.senhaHash);
    if (!ok) {
      throw new BadRequestException({
        mensagem: 'Senha atual incorreta',
        erros: [{ campo: 'senhaAtual', mensagem: 'Senha atual incorreta' }],
      });
    }
    const senhaHash = await bcrypt.hash(novaSenha, 10);
    // Nova senha derruba TODAS as sessões abertas (inclusive a de um eventual invasor).
    await this.prisma.usuario.update({ where: { id: userId }, data: { senhaHash, versaoToken: { increment: 1 } } });
  }

  // ---------- Recuperação de senha ("esqueci minha senha") ----------

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  // Solicita o link de recuperação. NUNCA revela se o e-mail existe (resposta
  // sempre "ok") para não vazar quais e-mails estão cadastrados.
  async solicitarRecuperacaoSenha(email: string): Promise<void> {
    const u = await this.prisma.usuario.findUnique({ where: { email: (email || '').toLowerCase() } });
    if (!u) return;

    // Invalida pedidos anteriores ainda pendentes desse usuário.
    await this.prisma.tokenSenha.deleteMany({ where: { usuarioId: u.id, usadoEm: null } });

    const token = crypto.randomBytes(32).toString('hex');
    const expiraEm = new Date(Date.now() + 60 * 60 * 1000); // 1 hora
    await this.prisma.tokenSenha.create({
      data: { usuarioId: u.id, tokenHash: this.hashToken(token), expiraEm },
    });

    const base = process.env.APP_URL || 'http://localhost:5173';
    const link = `${base}/redefinir-senha?token=${token}`;
    await this.email.enviarRecuperacaoSenha(u.email, u.nomeCompleto, link);
  }

  // Redefine a senha a partir do token do link. Valida hash, prazo e uso único.
  async redefinirSenha(token: string, novaSenha: string, confirmarNovaSenha: string): Promise<void> {
    if (!token) throw new BadRequestException({ mensagem: 'Link inválido.' });
    if (!novaSenha || novaSenha.length < 6) {
      throw new BadRequestException({
        mensagem: 'A nova senha precisa ter ao menos 6 caracteres.',
        erros: [{ campo: 'novaSenha', mensagem: 'Mínimo 6 caracteres' }],
      });
    }
    if (novaSenha !== confirmarNovaSenha) {
      throw new BadRequestException({
        mensagem: 'As senhas não coincidem.',
        erros: [{ campo: 'confirmarNovaSenha', mensagem: 'As senhas não coincidem' }],
      });
    }

    const registro = await this.prisma.tokenSenha.findUnique({ where: { tokenHash: this.hashToken(token) } });
    if (!registro || registro.usadoEm || registro.expiraEm < new Date()) {
      throw new BadRequestException({ mensagem: 'Link inválido ou expirado. Solicite a recuperação novamente.' });
    }

    const senhaHash = await bcrypt.hash(novaSenha, 10);
    await this.prisma.$transaction([
      // Redefinição derruba TODAS as sessões abertas do usuário (versão de token nova).
      this.prisma.usuario.update({ where: { id: registro.usuarioId }, data: { senhaHash, versaoToken: { increment: 1 } } }),
      this.prisma.tokenSenha.update({ where: { id: registro.id }, data: { usadoEm: new Date() } }),
    ]);
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
