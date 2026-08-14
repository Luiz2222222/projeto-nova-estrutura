import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { promises as fs } from 'fs';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { DriveService } from '../drive/drive.service';
import { baixarArquivo } from '../drive/drive-api';

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
        concluidoEm: true,
        arquivadoEm: true,
        arquivadoLocalEm: true,
        driveArquivoFinalNome: true,
        // Quantos documentos ficaram guardados (o download vem do arquivo local).
        _count: { select: { documentos: true } },
      },
    });
    return itens.map(({ _count, ...i }) => ({ ...i, documentos: _count.documentos }));
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
      },
    });
    if (!item) throw new NotFoundException({ mensagem: 'Registro arquivado não encontrado.' });
    // dadosJson volta já desserializado; o snapshot nunca guarda credencial.
    const dados = this.lerDados(item.dadosJson);
    const { dadosJson: _cru, ...resto } = item;
    return { ...resto, dados };
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
      include: { documentos: true },
    });
    if (!item) throw new NotFoundException({ mensagem: 'Registro arquivado não encontrado.' });

    const doc = documentoId
      ? item.documentos.find((d) => d.id === documentoId)
      : (item.documentos.find((d) => d.ehFinal) ?? item.documentos[0]);

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
