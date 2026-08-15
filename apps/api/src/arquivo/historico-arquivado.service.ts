import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { promises as fs } from 'fs';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { DriveService } from '../drive/drive.service';
import { baixarArquivo } from '../drive/drive-api';
import {
  anonimizarSnapshot,
  CAMPOS_IDENTIDADE_ARQUIVADO,
  ehCegoNoArquivado,
  notasLiberadasNoArquivado,
  podeVerDocumentoArquivado,
  sanitizarNotasSnapshot,
} from '../comum/visibilidade-arquivado';

// Histórico de períodos ENCERRADOS. Vive por conta própria: não usa as rotas nem os ids do
// TCC ativo (que já foi apagado) e não depende das contas de aluno/avaliador externo.
//
// Quem enxerga: COORDENADOR vê tudo; PROFESSOR vê só os TCCs em que participou (orientador,
// coorientador ou banca), pela tabela de participantes.
@Injectable()
export class HistoricoArquivadoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly drive: DriveService,
  ) {}

  private filtroPorPapel(usuarioId: string, papel: string) {
    if (papel === 'COORDENADOR') return {};
    if (papel === 'PROFESSOR') return { participantes: { some: { usuarioId } } };
    // Aluno/avaliador não acessam o arquivo histórico.
    throw new ForbiddenException({ mensagem: 'Você não tem permissão para ver o histórico arquivado.' });
  }

  // Snapshot corrompido não pode derrubar a tela: devolve null e o resto do registro segue.
  private lerDados(json: string): unknown {
    try {
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  async listar(usuarioId: string, papel: string) {
    const itens = await this.prisma.tccArquivado.findMany({
      where: this.filtroPorPapel(usuarioId, papel),
      orderBy: [{ semestre: 'desc' }, { alunoNome: 'asc' }],
      select: {
        id: true,
        semestre: true,
        titulo: true,
        alunoNome: true,
        alunoCurso: true,
        orientadorNome: true,
        nf: true,
        resultado: true,
        faseFinal: true,
        concluidoEm: true,
        arquivadoEm: true,
        arquivadoLocalEm: true,
        driveArquivoFinalNome: true,
        participantes: { select: { usuarioId: true, papel: true } },
        // Quantos documentos ficaram guardados (o download vem do arquivo local).
        _count: { select: { documentos: true } },
      },
    });
    return itens.map(({ _count, participantes, ...i }) => {
      const linha: any = { ...i, documentos: _count.documentos };
      // Avaliador cego da Fase I: fica o registro, sem quem é quem e sem documentos (o nome
      // do arquivo já entregaria o aluno).
      if (ehCegoNoArquivado(i.faseFinal, participantes, usuarioId)) {
        for (const campo of CAMPOS_IDENTIDADE_ARQUIVADO) if (campo in linha) linha[campo] = null;
        linha.documentos = 0;
        linha.driveArquivoFinalNome = null; // o nome do arquivo entrega o aluno
      }
      return linha;
    });
  }

  async detalhe(id: string, usuarioId: string, papel: string) {
    const item = await this.prisma.tccArquivado.findFirst({
      where: { id, ...this.filtroPorPapel(usuarioId, papel) },
      include: {
        // Sem caminho de disco nem hash: o front só precisa identificar e baixar.
        documentos: {
          select: { id: true, tipo: true, nomeArquivo: true, versao: true, status: true, tamanho: true, ehFinal: true },
          orderBy: [{ tipo: 'asc' }, { versao: 'asc' }],
        },
        participantes: { select: { usuarioId: true, papel: true } },
      },
    });
    if (!item) throw new NotFoundException({ mensagem: 'Registro arquivado não encontrado.' });

    // dadosJson volta já desserializado; o snapshot nunca guarda credencial.
    let dados: any = this.lerDados(item.dadosJson);
    const { dadosJson: _cru, participantes: _p, ...resto } = item;
    const registro: any = { ...resto };
    const ehCoordenador = papel === 'COORDENADOR';

    // Documento da banca é interno da coordenação — some da lista para o professor, do mesmo
    // jeito que já some no histórico vivo.
    if (!ehCoordenador) {
      registro.documentos = registro.documentos.filter((d: any) => podeVerDocumentoArquivado(d.tipo, papel));
    }

    // Notas só aparecem sob a MESMA condição do histórico vivo (nf confirmada ou fase
    // terminal). Antes disso, nem no registro nem dentro do snapshot.
    if (!ehCoordenador && !notasLiberadasNoArquivado(item)) {
      registro.nf1 = null;
      registro.nf2 = null;
      registro.nf = null;
      registro.resultado = null;
      dados = sanitizarNotasSnapshot(dados);
    }

    // Avaliador cego da Fase I: resposta sem identidade, sem documentos e sem o snapshot
    // bruto (que carrega aluno, orientador e nomes de arquivo).
    if (!ehCoordenador && ehCegoNoArquivado(item.faseFinal, item.participantes, usuarioId)) {
      for (const campo of CAMPOS_IDENTIDADE_ARQUIVADO) if (campo in registro) registro[campo] = null;
      registro.documentos = [];
      registro.driveArquivoFinalNome = null;
      dados = anonimizarSnapshot(dados);
    }

    return { ...registro, dados };
  }

  // Download SEMPRE autenticado pela API. A fonte é o ARQUIVO LOCAL permanente — que não
  // depende do Drive nem das contas apagadas. O Drive só entra como último recurso, se a
  // cópia local não estiver acessível.
  //
  // `documentoId` opcional: sem ele, baixa o documento final; com ele, um documento
  // específico do mesmo registro arquivado (o vínculo é conferido).
  async baixar(id: string, usuarioId: string, papel: string, documentoId?: string) {
    const item = await this.prisma.tccArquivado.findFirst({
      where: { id, ...this.filtroPorPapel(usuarioId, papel) },
      include: { documentos: true, participantes: { select: { usuarioId: true, papel: true } } },
    });
    if (!item) throw new NotFoundException({ mensagem: 'Registro arquivado não encontrado.' });

    const ehCoordenador = papel === 'COORDENADOR';
    // Avaliador cego da Fase I não baixa NADA deste registro: o nome do arquivo já
    // entregaria o aluno. Mesma mensagem do registro inexistente — não confirma que existe.
    if (!ehCoordenador && ehCegoNoArquivado(item.faseFinal, item.participantes, usuarioId)) {
      throw new NotFoundException({ mensagem: 'Registro arquivado não encontrado.' });
    }

    // O documento da banca não existe para o professor, nem por URL direta. Sem ele também
    // na escolha automática do "documento final".
    const visiveis = ehCoordenador
      ? item.documentos
      : item.documentos.filter((d) => podeVerDocumentoArquivado(d.tipo, papel));

    const doc = documentoId
      ? visiveis.find((d) => d.id === documentoId)
      : (visiveis.find((d) => d.ehFinal) ?? visiveis[0]);

    if (doc) {
      const abs = join(process.cwd(), doc.caminho);
      try {
        return { conteudo: await fs.readFile(abs), nome: doc.nomeArquivo };
      } catch {
        // Cai para o Drive abaixo; o erro real é registrado por quem chama.
      }
    }
    if (documentoId && !doc) {
      throw new NotFoundException({ mensagem: 'Documento arquivado não encontrado neste registro.' });
    }

    if (item.driveArquivoFinalId) {
      const token = await this.drive.accessToken();
      const conteudo = await baixarArquivo(token, item.driveArquivoFinalId);
      return { conteudo, nome: item.driveArquivoFinalNome ?? 'documento' };
    }
    throw new NotFoundException({ mensagem: 'Este registro não tem documento arquivado disponível.' });
  }
}
