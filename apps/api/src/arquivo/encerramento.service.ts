import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { promises as fs } from 'fs';
import { join } from 'path';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { DriveService } from '../drive/drive.service';
import { DriveSyncService } from '../drive/drive-sync.service';
import { apagarArquivo, arquivoValido } from '../drive/drive-api';
import { resolverSemestreAtivo } from '../comum/semestre';

// Papéis que PODEM ser apagados no encerramento. Professor e coordenador nunca entram aqui.
const PAPEIS_APAGAVEIS = ['ALUNO', 'AVALIADOR'];

// "Encerrar e arquivar período": arquiva no Drive + cria o histórico independente e só
// então apaga TCCs, arquivos locais e contas de aluno/avaliador externo daquele período.
//
// Substitui o conceito do "Resetar período" (que apagava os TCCs sem arquivar nada). O
// endpoint antigo continua existindo até ser removido — ver nota no relatório da tarefa.
@Injectable()
export class EncerramentoService {
  private readonly logger = new Logger('Encerramento');

  constructor(
    private readonly prisma: PrismaService,
    private readonly drive: DriveService,
    private readonly sync: DriveSyncService,
  ) {}

  // ---------- Prévia (não muda nada) ----------

  async previa(semestreAlvo?: string) {
    const semestre = semestreAlvo || (await resolverSemestreAtivo(this.prisma));
    const tccs = await this.prisma.tcc.findMany({
      where: { semestre },
      include: {
        aluno: { select: { id: true, nomeCompleto: true, email: true, papel: true } },
        bancas: { include: { membros: { include: { avaliador: { select: { id: true, nomeCompleto: true, papel: true } } } } } },
      },
    });

    const pendencias = await this.prisma.syncDrive.count({
      where: { status: { in: ['PENDENTE', 'ERRO'] }, tcc: { semestre } },
    });

    const { apagaveis, preservadas } = await this.classificarContas(tccs, semestre);

    return {
      semestre,
      conectadoAoDrive: await this.drive.conectado(),
      tccs: tccs.length,
      pendenciasSincronizacao: pendencias,
      podeEncerrar: pendencias === 0 && (await this.drive.conectado()) && tccs.length > 0,
      contasParaApagar: apagaveis.map((c) => ({ nome: c.nomeCompleto, email: c.email, papel: c.papel })),
      contasPreservadas: preservadas.map((c) => ({ nome: c.nomeCompleto, papel: c.papel, motivo: c.motivo })),
    };
  }

  // Candidatos = alunos e avaliadores externos que participaram SÓ deste período.
  // Quem ainda tem vínculo em TCC de outro período (ou período não encerrado) é pulado.
  private async classificarContas(tccs: any[], semestre: string) {
    const candidatos = new Map<string, any>();
    for (const t of tccs) {
      if (t.aluno && PAPEIS_APAGAVEIS.includes(t.aluno.papel)) candidatos.set(t.aluno.id, t.aluno);
      for (const b of t.bancas ?? []) {
        for (const m of b.membros ?? []) {
          if (m.avaliador && PAPEIS_APAGAVEIS.includes(m.avaliador.papel)) candidatos.set(m.avaliador.id, m.avaliador);
        }
      }
    }

    const apagaveis: any[] = [];
    const preservadas: any[] = [];
    for (const c of candidatos.values()) {
      const tccsForaDoPeriodo = await this.prisma.tcc.count({
        where: { alunoId: c.id, semestre: { not: semestre } },
      });
      const bancasForaDoPeriodo = await this.prisma.membroBanca.count({
        where: { avaliadorId: c.id, banca: { tcc: { semestre: { not: semestre } } } },
      });
      if (tccsForaDoPeriodo > 0 || bancasForaDoPeriodo > 0) {
        preservadas.push({
          ...c,
          motivo: `ainda participa de ${tccsForaDoPeriodo + bancasForaDoPeriodo} TCC(s) de outro período`,
        });
      } else {
        apagaveis.push(c);
      }
    }
    return { apagaveis, preservadas };
  }

  // ---------- Encerramento ----------

  async encerrar(usuarioId: string, senha: string, confirmacao: string, semestreAlvo?: string) {
    if (confirmacao !== 'ENCERRAR') {
      throw new BadRequestException({ mensagem: 'Confirmação inválida. Digite ENCERRAR para confirmar.' });
    }
    const u = await this.prisma.usuario.findUnique({ where: { id: usuarioId } });
    if (!u) throw new UnauthorizedException();
    if (!(await bcrypt.compare(senha || '', u.senhaHash))) {
      throw new BadRequestException({ mensagem: 'Senha incorreta.', erros: [{ campo: 'senha', mensagem: 'Senha incorreta' }] });
    }

    const semestre = semestreAlvo || (await resolverSemestreAtivo(this.prisma));
    if (!(await this.drive.conectado())) {
      throw new BadRequestException({ mensagem: 'Conecte o Google Drive antes de encerrar o período. Nada foi apagado.' });
    }

    const tccs = await this.prisma.tcc.findMany({
      where: { semestre },
      include: {
        aluno: { select: { id: true, nomeCompleto: true, email: true, curso: true, papel: true } },
        orientador: { select: { id: true, nomeCompleto: true } },
        coorientador: { select: { id: true, nomeCompleto: true } },
        documentos: true,
        bancas: { include: { membros: { include: { avaliador: { select: { id: true, nomeCompleto: true, papel: true } } } } } },
      },
    });
    if (!tccs.length) throw new BadRequestException({ mensagem: `Nenhum TCC no período ${semestre}.` });

    // 1) Última sincronização de cada TCC. Se QUALQUER uma falhar, aborta sem apagar nada.
    for (const t of tccs) {
      try {
        await this.sync.garantirPastaTcc(t.id);
        await this.sync.gravarDados(t.id);
      } catch (e) {
        throw new BadRequestException({
          mensagem: `Falha ao sincronizar o TCC "${t.titulo}" com o Drive: ${(e as Error).message}. NADA foi apagado.`,
        });
      }
    }

    // 2) Só depois da sincronização conferimos a fila: nada pode ficar pendente.
    const pendencias = await this.prisma.syncDrive.count({
      where: { status: { in: ['PENDENTE', 'ERRO'] }, tcc: { semestre } },
    });
    if (pendencias > 0) {
      throw new BadRequestException({
        mensagem: `Existem ${pendencias} pendência(s) de sincronização com o Drive. Resolva antes de encerrar. NADA foi apagado.`,
      });
    }

    // 3) Histórico independente ANTES de qualquer exclusão.
    const arquivados: string[] = [];
    for (const t of tccs) {
      arquivados.push(await this.arquivar(t));
    }

    // 4) Poda no Drive: só depois de confirmar que o arquivo final está gravado.
    let podados = 0;
    for (const t of tccs) {
      podados += await this.podarDrive(t.id);
    }

    // 5) Agora sim: apagar TCCs (cascata leva documentos, bancas, fila e mapeamentos) e os
    // arquivos locais — é isso que libera espaço no servidor.
    const { apagaveis, preservadas } = await this.classificarContas(tccs, semestre);
    const caminhos = tccs.flatMap((t) => t.documentos.map((d: any) => d.caminho));
    const { count: tccsApagados } = await this.prisma.tcc.deleteMany({ where: { semestre } });
    let arquivosRemovidos = 0;
    for (const caminho of caminhos) {
      try {
        await fs.rm(join(process.cwd(), caminho), { force: true });
        arquivosRemovidos++;
      } catch {
        /* arquivo já sumiu: segue */
      }
    }

    // 6) Contas de aluno/avaliador externo. Recheca vínculo DEPOIS da exclusão dos TCCs:
    // se sobrou qualquer vínculo, a conta é preservada em vez de falhar.
    const contasApagadas: string[] = [];
    const contasPuladas: { nome: string; motivo: string }[] = preservadas.map((c) => ({
      nome: c.nomeCompleto,
      motivo: c.motivo,
    }));
    for (const c of apagaveis) {
      const aindaTem =
        (await this.prisma.tcc.count({ where: { alunoId: c.id } })) +
        (await this.prisma.membroBanca.count({ where: { avaliadorId: c.id } }));
      if (aindaTem > 0) {
        contasPuladas.push({ nome: c.nomeCompleto, motivo: 'ainda vinculada a TCC ativo' });
        continue;
      }
      try {
        // Cascata do schema leva notificações, preferências de e-mail e tokens de senha.
        await this.prisma.usuario.delete({ where: { id: c.id } });
        contasApagadas.push(c.nomeCompleto);
      } catch (e) {
        contasPuladas.push({ nome: c.nomeCompleto, motivo: `não foi possível apagar: ${(e as Error).message}` });
      }
    }

    this.logger.log(
      `Período ${semestre} encerrado: ${tccsApagados} TCC(s), ${contasApagadas.length} conta(s) apagada(s).`,
    );
    return {
      semestre,
      tccsArquivados: arquivados.length,
      tccsApagados,
      arquivosLocaisRemovidos: arquivosRemovidos,
      arquivosPodadosNoDrive: podados,
      contasApagadas,
      contasPreservadas: contasPuladas,
    };
  }

  // Grava o TccArquivado + participantes (só professor/coordenador, que nunca são apagados).
  private async arquivar(tcc: any): Promise<string> {
    const { dados, resumo } = await this.sync.montarConteudo(tcc.id);
    const pasta = await this.prisma.driveArquivo.findUnique({
      where: { tccId_chave: { tccId: tcc.id, chave: 'PASTA' } },
    });
    const final = await this.arquivoFinal(tcc.id);

    const arquivado = await this.prisma.tccArquivado.create({
      data: {
        tccIdOriginal: tcc.id,
        semestre: tcc.semestre,
        titulo: tcc.titulo,
        alunoNome: tcc.aluno?.nomeCompleto ?? '(sem aluno)',
        alunoEmail: tcc.aluno?.email ?? '',
        alunoCurso: tcc.aluno?.curso ?? null,
        orientadorNome: tcc.orientador?.nomeCompleto ?? null,
        coorientadorNome: tcc.coorientador?.nomeCompleto ?? tcc.coorientadorNome ?? null,
        nf1: tcc.nf1 ?? null,
        nf2: tcc.nf2 ?? null,
        nf: tcc.nf ?? null,
        resultado: tcc.resultado ?? null,
        faseFinal: tcc.faseAtual ?? null,
        concluidoEm: tcc.concluidoEm ?? null,
        defesaAgendadaPara: tcc.defesaAgendadaPara ?? null,
        defesaLocal: tcc.defesaLocal ?? null,
        dadosJson: JSON.stringify(dados),
        resumoTexto: resumo,
        drivePastaId: pasta?.driveId ?? null,
        driveArquivoFinalId: final?.driveId ?? null,
        driveArquivoFinalNome: final?.nome ?? null,
      },
    });

    // Participantes preserváveis: orientador, coorientador interno e membros de banca que
    // sejam PROFESSOR (avaliador externo é apagado, então fica só no snapshot/texto).
    const participantes = new Map<string, string>();
    if (tcc.orientadorId) participantes.set(tcc.orientadorId, 'ORIENTADOR');
    if (tcc.coorientadorId) participantes.set(tcc.coorientadorId, 'COORIENTADOR');
    for (const b of tcc.bancas ?? []) {
      for (const m of b.membros ?? []) {
        if (m.avaliador?.papel === 'PROFESSOR' && !participantes.has(m.avaliadorId)) {
          participantes.set(m.avaliadorId, 'BANCA');
        }
      }
    }
    for (const [usuarioId, papel] of participantes) {
      await this.prisma.tccArquivadoParticipante.create({
        data: { arquivadoId: arquivado.id, usuarioId, papel },
      });
    }
    return arquivado.id;
  }

  // Documento que fica no Drive: versão final aprovada; sem ela, a última monografia.
  private async arquivoFinal(tccId: string) {
    const docs = await this.prisma.documentoTcc.findMany({
      where: { tccId, tipo: { in: ['VERSAO_FINAL', 'MONOGRAFIA'] } },
      orderBy: [{ versao: 'desc' }, { criadoEm: 'desc' }],
    });
    const escolhido = docs.find((d) => d.tipo === 'VERSAO_FINAL') ?? docs.find((d) => d.tipo === 'MONOGRAFIA');
    if (!escolhido) return null;
    return this.prisma.driveArquivo.findUnique({
      where: { tccId_chave: { tccId, chave: `DOC:${escolhido.id}` } },
    });
  }

  // Remove do Drive os arquivos intermediários, mantendo dados.json, resumo.txt e o final.
  // Só apaga DEPOIS de confirmar que o arquivo que fica realmente existe lá.
  private async podarDrive(tccId: string): Promise<number> {
    const final = await this.arquivoFinal(tccId);
    const token = await this.drive.accessToken();

    if (final && !(await arquivoValido(token, final.driveId))) {
      this.logger.warn(`TCC ${tccId}: arquivo final não confirmado no Drive — poda cancelada.`);
      return 0;
    }

    const manter = new Set(['DADOS_JSON', 'RESUMO_TXT', 'PASTA', ...(final ? [final.chave] : [])]);
    const arquivos = await this.prisma.driveArquivo.findMany({ where: { tccId } });
    let podados = 0;
    for (const a of arquivos) {
      if (manter.has(a.chave)) continue;
      try {
        await apagarArquivo(token, a.driveId);
        podados++;
      } catch (e) {
        this.logger.warn(`Não foi possível podar ${a.nome} do TCC ${tccId}: ${(e as Error).message}`);
      }
    }
    return podados;
  }
}
