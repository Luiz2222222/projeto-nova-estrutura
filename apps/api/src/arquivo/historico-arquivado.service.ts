import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
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
        driveArquivoFinalNome: true,
      },
    });
    return itens;
  }

  async detalhe(id: string, usuarioId: string, papel: string) {
    const item = await this.prisma.tccArquivado.findFirst({
      where: { id, ...this.filtroPorPapel(usuarioId, papel) },
    });
    if (!item) throw new NotFoundException({ mensagem: 'Registro arquivado não encontrado.' });
    // dadosJson volta já desserializado; o snapshot nunca guarda credencial.
    const dados = this.lerDados(item.dadosJson);
    const { dadosJson: _cru, ...resto } = item;
    return { ...resto, dados };
  }

  // Proxy autenticado: o arquivo desce pela API, com a permissão do sistema. Nunca é
  // exposto por link público do Drive.
  async baixar(id: string, usuarioId: string, papel: string) {
    const item = await this.prisma.tccArquivado.findFirst({
      where: { id, ...this.filtroPorPapel(usuarioId, papel) },
    });
    if (!item) throw new NotFoundException({ mensagem: 'Registro arquivado não encontrado.' });
    if (!item.driveArquivoFinalId) {
      throw new NotFoundException({ mensagem: 'Este registro não tem documento final arquivado.' });
    }
    const token = await this.drive.accessToken();
    const conteudo = await baixarArquivo(token, item.driveArquivoFinalId);
    return { conteudo, nome: item.driveArquivoFinalNome ?? 'documento' };
  }
}
