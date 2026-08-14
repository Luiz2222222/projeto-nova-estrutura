import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { promises as fs } from 'fs';
import { join } from 'path';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { DriveService } from '../drive/drive.service';
import { DriveSyncService } from '../drive/drive-sync.service';
import { apagarArquivo, arquivoValido } from '../drive/drive-api';
import { resolverSemestreAtivo } from '../comum/semestre';
import { FalhaArquivoLocal, copiarDocumentos, gravarSnapshot, validarArquivados } from './arquivo-local';

// Papéis que PODEM ser apagados no encerramento. Professor e coordenador nunca entram aqui.
const PAPEIS_APAGAVEIS = ['ALUNO', 'AVALIADOR'];

// Status de documento que podem ser preservados como arquivo final. REJEITADO e SUBSTITUIDA
// ficam de fora: arquivar uma versão recusada como "a" versão do TCC seria um erro grave.
const STATUS_PRESERVAVEIS = ['APROVADO', 'PENDENTE', 'EM_ANALISE'];

// Estados da fila do Drive que contam como pendência e IMPEDEM encerrar o período.
// PROCESSANDO entra aqui de propósito: um upload em curso ainda não terminou, então o
// arquivo pode não estar completo no Drive — apagar agora arriscaria perder o documento.
// Constante única para os dois pontos (prévia e encerramento) nunca divergirem.
const STATUS_SYNC_PENDENTE = ['PENDENTE', 'PROCESSANDO', 'ERRO'];

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
        coorientador: { select: { id: true, nomeCompleto: true, email: true, papel: true } },
        bancas: { include: { membros: { include: { avaliador: { select: { id: true, nomeCompleto: true, papel: true } } } } } },
      },
    });

    const pendencias = await this.prisma.syncDrive.count({
      where: { status: { in: STATUS_SYNC_PENDENTE }, tcc: { semestre } },
    });

    const { apagaveis, preservadas } = await this.classificarContas(tccs, semestre);

    const conectadoAoDrive = await this.drive.conectado();
    return {
      semestre,
      conectadoAoDrive,
      tccs: tccs.length,
      pendenciasSincronizacao: pendencias,
      // O Drive NÃO entra na condição: o encerramento é garantido pelo arquivo local.
      // Pendência de fila também não bloqueia — é só a cópia adicional que fica para depois.
      podeEncerrar: tccs.length > 0,
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
      // Coorientador INTERNO com conta: um AVALIADOR que seja só coorientador também precisa
      // entrar na análise (antes ficava de fora e a conta sobrava órfã no sistema).
      if (t.coorientador && PAPEIS_APAGAVEIS.includes(t.coorientador.papel)) {
        candidatos.set(t.coorientador.id, t.coorientador);
      }
      for (const b of t.bancas ?? []) {
        for (const m of b.membros ?? []) {
          if (m.avaliador && PAPEIS_APAGAVEIS.includes(m.avaliador.papel)) candidatos.set(m.avaliador.id, m.avaliador);
        }
      }
    }

    const apagaveis: any[] = [];
    const preservadas: any[] = [];
    for (const c of candidatos.values()) {
      // Vínculo em QUALQUER papel fora deste período preserva a conta: aluno, membro de
      // banca ou coorientador.
      const comoAluno = await this.prisma.tcc.count({
        where: { alunoId: c.id, semestre: { not: semestre } },
      });
      const comoCoorientador = await this.prisma.tcc.count({
        where: { coorientadorId: c.id, semestre: { not: semestre } },
      });
      const comoAvaliador = await this.prisma.membroBanca.count({
        where: { avaliadorId: c.id, banca: { tcc: { semestre: { not: semestre } } } },
      });
      const total = comoAluno + comoCoorientador + comoAvaliador;
      if (total > 0) {
        preservadas.push({ ...c, motivo: `ainda participa de ${total} TCC(s) de outro período` });
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
    // O Drive NÃO é pré-requisito: a garantia do encerramento é o arquivo local permanente.
    const driveConectado = await this.drive.conectado();

    const tccs = await this.prisma.tcc.findMany({
      where: { semestre },
      include: {
        aluno: { select: { id: true, nomeCompleto: true, email: true, curso: true, papel: true } },
        orientador: { select: { id: true, nomeCompleto: true } },
        coorientador: { select: { id: true, nomeCompleto: true, email: true, papel: true } },
        documentos: true,
        bancas: { include: { membros: { include: { avaliador: { select: { id: true, nomeCompleto: true, papel: true } } } } } },
      },
    });
    if (!tccs.length) throw new BadRequestException({ mensagem: `Nenhum TCC no período ${semestre}.` });

    // 1) ARQUIVO LOCAL PERMANENTE — a garantia do encerramento. Copia snapshot e documentos
    // para a área de arquivamento e VALIDA cada cópia (tamanho + sha256). Qualquer falha
    // aborta tudo aqui, antes de existir qualquer exclusão.
    const arquivados: string[] = [];
    for (const t of tccs) {
      try {
        arquivados.push(await this.arquivar(t));
      } catch (e) {
        throw new BadRequestException({
          mensagem: `Falha ao arquivar localmente o TCC "${t.titulo}": ${(e as Error).message}. NADA foi apagado.`,
        });
      }
    }

    // 2) REVALIDAÇÃO imediatamente antes de apagar: relê do disco tudo que foi arquivado.
    // É esta checagem que autoriza a exclusão dos dados ativos.
    try {
      await this.revalidarArquivoLocal(tccs.map((t) => t.id));
    } catch (e) {
      throw new BadRequestException({
        mensagem: `Validação do arquivo local falhou: ${(e as Error).message}. NADA foi apagado.`,
      });
    }

    // 3) Drive: cópia ADICIONAL e opcional. Nunca bloqueia — se estiver desconectado ou
    // falhar, o encerramento segue e a tela informa que a cópia no Drive ficou pendente.
    let podados = 0;
    let copiaDrivePendente = 0;
    if (driveConectado) {
      for (const t of tccs) {
        try {
          await this.sync.garantirPastaTcc(t.id);
          await this.sync.gravarDados(t.id);
          podados += await this.podarDrive(t.id);
        } catch (e) {
          copiaDrivePendente++;
          this.logger.warn(`Cópia no Drive do TCC ${t.id} ficou pendente: ${(e as Error).message}`);
        }
      }
    } else {
      copiaDrivePendente = tccs.length;
    }

    // 4) Agora sim: apagar TCCs (cascata leva documentos, bancas, fila e mapeamentos) e os
    // arquivos ATIVOS de uploads/ — é isso que libera espaço. As cópias arquivadas ficam
    // em outra pasta e não são tocadas.
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

    // 7) Contas de aluno/avaliador externo. Recheca vínculo DEPOIS da exclusão dos TCCs:
    // se sobrou qualquer vínculo, a conta é preservada em vez de falhar.
    const contasApagadas: string[] = [];
    const contasPuladas: { nome: string; motivo: string }[] = preservadas.map((c) => ({
      nome: c.nomeCompleto,
      motivo: c.motivo,
    }));
    for (const c of apagaveis) {
      const aindaTem =
        (await this.prisma.tcc.count({ where: { alunoId: c.id } })) +
        (await this.prisma.tcc.count({ where: { coorientadorId: c.id } })) +
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
      // A tela usa isto para dizer "arquivado localmente" e, se for o caso, "cópia no Drive
      // pendente" — sem sugerir que faltou backup.
      arquivadoLocalmente: true,
      driveConectado,
      copiaDrivePendente,
    };
  }

  // Grava o TccArquivado + participantes (só professor/coordenador, que nunca são apagados).
  private async arquivar(tcc: any): Promise<string> {
    const { dados, resumo } = await this.sync.montarConteudo(tcc.id);
    const raiz = process.cwd();

    // 1) Snapshot legível + estruturado na pasta permanente do TCC.
    const { pasta: pastaArquivo } = await gravarSnapshot(raiz, tcc.semestre, tcc.id, dados, resumo);

    // 2) Cópia validada dos documentos. Versões substituídas/rejeitadas ficam de fora —
    // o histórico guarda o que vale, não o descartado.
    const escolhido = await this.escolherDocumentoFinal(tcc.id);
    const paraArquivar = (tcc.documentos ?? []).filter((d: any) => STATUS_PRESERVAVEIS.includes(d.status));
    const copiados = await copiarDocumentos(raiz, tcc.semestre, tcc.id, paraArquivar, escolhido?.id ?? null);

    // Sem nenhum documento arquivado o histórico ficaria sem consulta possível.
    if (copiados.length === 0) {
      throw new FalhaArquivoLocal('nenhum documento válido para arquivar (todos rejeitados ou substituídos)');
    }

    const pasta = await this.prisma.driveArquivo.findUnique({
      where: { tccId_chave: { tccId: tcc.id, chave: 'PASTA' } },
    });
    const final = await this.arquivoFinal(tcc.id);

    // Upsert em tccIdOriginal (chave única): reexecutar o encerramento — depois de uma
    // interrupção, ou por um segundo coordenador — ATUALIZA o snapshot em vez de duplicar.
    const dadosArquivo = {
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
      pastaArquivo,
      arquivadoLocalEm: new Date(),
      drivePastaId: pasta?.driveId ?? null,
      driveArquivoFinalId: final?.driveId ?? null,
      driveArquivoFinalNome: final?.nome ?? null,
    };

    const arquivado = await this.prisma.tccArquivado.upsert({
      where: { tccIdOriginal: tcc.id },
      create: { tccIdOriginal: tcc.id, ...dadosArquivo },
      update: dadosArquivo,
    });

    // Documentos arquivados: upsert por (arquivado, tipo, versão) — reexecutar o
    // encerramento atualiza em vez de duplicar.
    for (const d of copiados) {
      await this.prisma.documentoArquivado.upsert({
        where: { arquivadoId_tipo_versao: { arquivadoId: arquivado.id, tipo: d.tipo, versao: d.versao } },
        create: { arquivadoId: arquivado.id, ...d },
        update: d,
      });
    }

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
    // Idempotente também aqui: repetir o encerramento não duplica participante.
    for (const [usuarioId, papel] of participantes) {
      await this.prisma.tccArquivadoParticipante.upsert({
        where: { arquivadoId_usuarioId_papel: { arquivadoId: arquivado.id, usuarioId, papel } },
        create: { arquivadoId: arquivado.id, usuarioId, papel },
        update: {},
      });
    }
    return arquivado.id;
  }

  // Relê do disco TUDO que foi arquivado destes TCCs e confere tamanho + sha256. Roda
  // imediatamente antes das exclusões: se um arquivo sumiu ou corrompeu entre a cópia e
  // agora, o encerramento para aqui e nada é apagado.
  private async revalidarArquivoLocal(tccIds: string[]): Promise<void> {
    const arquivados = await this.prisma.tccArquivado.findMany({
      where: { tccIdOriginal: { in: tccIds } },
      include: { documentos: true },
    });
    if (arquivados.length !== tccIds.length) {
      throw new FalhaArquivoLocal(
        `esperado ${tccIds.length} TCC(s) arquivado(s), encontrado ${arquivados.length}`,
      );
    }
    for (const a of arquivados) {
      if (!a.documentos.length) {
        throw new FalhaArquivoLocal(`o TCC arquivado "${a.titulo}" ficou sem nenhum documento`);
      }
      await validarArquivados(process.cwd(), a.documentos);
    }
  }

  // Documento que DEVE permanecer: versão final APROVADA mais recente; sem ela, o documento
  // acadêmico mais recente permitido (monografia aprovada/pendente/em análise).
  // Uma versão REJEITADA ou SUBSTITUIDA nunca pode ser escolhida como arquivo preservado.
  private async escolherDocumentoFinal(tccId: string) {
    const docs = await this.prisma.documentoTcc.findMany({
      where: { tccId, tipo: { in: ['VERSAO_FINAL', 'MONOGRAFIA'] }, status: { in: STATUS_PRESERVAVEIS } },
      orderBy: [{ versao: 'desc' }, { criadoEm: 'desc' }],
    });
    const finais = docs.filter((d) => d.tipo === 'VERSAO_FINAL');
    // Entre as versões finais, prioriza a APROVADA; se não houver, a mais recente válida.
    const escolhido = finais.find((d) => d.status === 'APROVADO') ?? finais[0] ?? docs.find((d) => d.tipo === 'MONOGRAFIA');
    return escolhido ?? null;
  }

  // Mapeamento no Drive do documento escolhido (null se ainda não subiu).
  private async arquivoFinal(tccId: string) {
    const escolhido = await this.escolherDocumentoFinal(tccId);
    if (!escolhido) return null;
    return this.prisma.driveArquivo.findUnique({
      where: { tccId_chave: { tccId, chave: `DOC:${escolhido.id}` } },
    });
  }

  // TRAVA DE BACKUP: para cada TCC, exige documento escolhido + mapeamento no Drive +
  // confirmação remota de que o arquivo existe e não está na lixeira. Qualquer falha aborta
  // TODO o encerramento — nada de banco, arquivo local ou conta é apagado.
  private async exigirBackupComprovado(tccs: any[]): Promise<void> {
    const token = await this.drive.accessToken();
    const problemas: string[] = [];

    for (const t of tccs) {
      const escolhido = await this.escolherDocumentoFinal(t.id);
      if (!escolhido) {
        problemas.push(`"${t.titulo}": nenhum documento acadêmico válido (versão final ou monografia) para arquivar`);
        continue;
      }
      const mapeado = await this.prisma.driveArquivo.findUnique({
        where: { tccId_chave: { tccId: t.id, chave: `DOC:${escolhido.id}` } },
      });
      if (!mapeado) {
        problemas.push(`"${t.titulo}": ${escolhido.tipo} v${escolhido.versao} ainda não foi enviado ao Drive`);
        continue;
      }
      if (!(await arquivoValido(token, mapeado.driveId))) {
        problemas.push(`"${t.titulo}": o arquivo no Drive não foi encontrado ou está na lixeira`);
      }
    }

    if (problemas.length) {
      throw new BadRequestException({
        mensagem:
          `Backup não comprovado em ${problemas.length} TCC(s). NADA foi apagado. Detalhes: ` +
          problemas.slice(0, 10).join('; ') +
          (problemas.length > 10 ? ` (e mais ${problemas.length - 10})` : ''),
      });
    }
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
