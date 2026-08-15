import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { sanitizarNotasTcc, ocultarRascunho } from '../comum/sanitizar-notas';
import { ehCegoNoArquivado, podeVerDocumentoArquivado } from '../comum/visibilidade-arquivado';
import { resolverSemestreAtivo } from '../comum/semestre';
import { PESO_NF1, PESO_NF2 } from '@tcc/compartilhado';

// TCC de período encerrado entra na MESMA lista do histórico vivo; o prefixo no id só evita
// colisão com um id de TCC vivo e diz de onde o registro veio (não é categoria de tela).
const PREFIXO_ARQUIVADO = 'arq_';
const ehArquivado = (id: string) => id.startsWith(PREFIXO_ARQUIVADO);
const idArquivado = (id: string) => id.slice(PREFIXO_ARQUIVADO.length);

// Histórico de períodos ANTERIORES + ocultação individual — extraído do TccsService por
// coesão: aqui vivem só consultas de leitura (histórico do professor/coordenador) e a
// preferência HistoricoTccOculto. O fluxo do TCC segue no TccsService; nada de regra,
// sanitização ou duplo-cego mudou nesta extração.
@Injectable()
export class HistoricoTccsService {
  constructor(private readonly prisma: PrismaService) {}

  // Rótulo do critério (como fica no snapshot) -> coluna de nota do MembroBanca. Serve para
  // devolver o TCC arquivado no MESMO formato do histórico vivo, e não numa forma paralela.
  private static readonly COLUNA_POR_CRITERIO: Record<string, string> = {
    Resumo: 'notaResumo',
    Introdução: 'notaIntroducao',
    Revisão: 'notaRevisao',
    Desenvolvimento: 'notaDesenvolvimento',
    Conclusões: 'notaConclusoes',
    Coerência: 'notaCoerencia',
    Qualidade: 'notaQualidade',
    Domínio: 'notaDominio',
    Clareza: 'notaClareza',
    Observância: 'notaObservancia',
  };

  // TCCs de períodos ENCERRADOS, cujas contas de aluno/avaliador já não existem. Para o
  // usuário são registros históricos como quaisquer outros: mesma lista, mesmo detalhe.
  // O id ganha o prefixo `arq_` só para não colidir com o id de um TCC vivo — as telas
  // acham por id na própria lista, então detalhe e navegação funcionam sem rota nova.
  // `profId` presente = listagem do professor: acrescenta os vínculos dele (as mesmas pílulas
  // e o mesmo filtro do histórico vivo) e aplica o duplo-cego da Fase I reprovada.
  private async arquivadosComoHistorico(where: Record<string, unknown>, ocultos: string[] = [], profId?: string) {
    const itens = await this.prisma.tccArquivado.findMany({
      where,
      include: {
        documentos: { orderBy: [{ tipo: 'asc' }, { versao: 'asc' }] },
        participantes: { select: { usuarioId: true, papel: true } },
      },
      orderBy: [{ semestre: 'desc' }, { alunoNome: 'asc' }],
    });

    // Pesos REAIS do calendário de cada semestre arquivado: um período antigo com pesos
    // personalizados tem que mostrar o denominador daquele período, não o padrão de hoje.
    const cals: any[] = await this.prisma.calendario.findMany({
      where: { semestre: { in: [...new Set(itens.map((a) => a.semestre))] } },
    });
    const calPorSemestre = new Map<string, any>(cals.map((c) => [c.semestre, c]));

    // "Ocultar do meu histórico" vale igual aqui: a preferência é gravada com o id prefixado.
    const escondidos = new Set(ocultos);
    return itens
      .filter((a) => !escondidos.has(`${PREFIXO_ARQUIVADO}${a.id}`))
      .map((a) => {
        // Snapshot ilegível não pode derrubar o histórico inteiro: cai para vazio e o
        // registro ainda aparece com o que está nas colunas da tabela.
        let snap: any;
        try {
          snap = JSON.parse(a.dadosJson) ?? {};
        } catch {
          snap = {};
        }
        const datas = snap.datas ?? {};
        const defesa = snap.defesa ?? {};
        const notas = snap.notas ?? {};
        const cal = calPorSemestre.get(a.semestre) ?? null;
        // O orientador da Fase II é rotulado por comparação de id; o vínculo sobreviveu na
        // tabela de participantes (a conta de professor não é apagada no encerramento).
        const orientadorId = a.participantes.find((p) => p.papel === 'ORIENTADOR')?.usuarioId ?? null;
        const coorientadorId = a.participantes.find((p) => p.papel === 'COORIENTADOR')?.usuarioId ?? null;
        const vinculos: string[] = [];
        if (profId) {
          if (orientadorId === profId) vinculos.push('ORIENTADOR');
          if (coorientadorId === profId) vinculos.push('COORIENTADOR');
          const naBanca = (snap.bancas ?? []).some((b: any) =>
            (b.membros ?? []).some((m: any) => m.avaliadorId === profId),
          );
          if (naBanca) vinculos.push('AVALIADOR');
        }
        const item: any = {
          id: `${PREFIXO_ARQUIVADO}${a.id}`,
          arquivado: true, // uso interno (download/ações); a tela não mostra isso como categoria
          titulo: a.titulo,
          semestre: a.semestre,
          faseAtual: a.faseFinal ?? 'CONCLUIDO',
          nf1: a.nf1,
          nf2: a.nf2,
          nf: a.nf,
          resultado: a.resultado,
          criadoEm: snap.tcc?.criadoEm ?? a.arquivadoEm,
          // Datas do fluxo: a timeline do detalhe é a mesma do TCC vivo.
          monografiaAprovada: snap.tcc?.monografiaAprovada ?? null,
          monografiaAprovadaEm: datas.monografiaAprovadaEm ?? null,
          continuidadeConfirmada: snap.tcc?.continuidadeConfirmada ?? null,
          continuidadeAvaliadaEm: datas.continuidadeAvaliadaEm ?? null,
          fase1ValidadaEm: datas.fase1ValidadaEm ?? null,
          fase2ValidadaEm: datas.fase2ValidadaEm ?? null,
          versaoFinalValidadaEm: datas.versaoFinalValidadaEm ?? null,
          concluidoEm: datas.concluidoEm ?? a.concluidoEm,
          defesaAgendadaPara: defesa.agendadaPara ?? a.defesaAgendadaPara,
          defesaLocal: defesa.local ?? a.defesaLocal,
          // Pessoas cujas contas foram apagadas: sobrevivem como texto no arquivo.
          aluno: { id: null, nomeCompleto: a.alunoNome, email: a.alunoEmail, curso: a.alunoCurso },
          orientadorId,
          orientador: a.orientadorNome
            ? { id: orientadorId, nomeCompleto: a.orientadorNome, tratamento: snap.orientador?.tratamento ?? null }
            : null,
          coorientador: null,
          coorientadorNome: a.coorientadorNome,
          coorientadorTitulacao: snap.coorientador?.titulacao ?? null,
          coorientadorAfiliacao: snap.coorientador?.afiliacao ?? null,
          // Documento da banca é interno da coordenação: o histórico vivo já o esconde do
          // professor (`tipo != AVALIACAO_BANCA`) e aqui vale o mesmo.
          documentos: a.documentos
            .filter((d) => podeVerDocumentoArquivado(d.tipo, profId ? 'PROFESSOR' : 'COORDENADOR'))
            .map((d) => ({
            id: d.id,
            tipo: d.tipo,
            nomeArquivo: d.nomeArquivo,
            versao: d.versao,
            status: d.status,
            tamanho: d.tamanho,
            criadoEm: d.criadoEm,
            // Download pelo arquivo permanente da VPS, sempre autenticado.
            urlBaixar: `/historico-arquivado/${a.id}/baixar?documento=${d.id}`,
            urlVisualizar: `/historico-arquivado/${a.id}/visualizar?documento=${d.id}`,
          })),
          // O snapshot não guarda ids de banca/membro (as linhas foram apagadas): as telas
          // usam id só como chave de render e para casar membro com papel, então geramos um
          // id estável a partir da posição.
          bancas: (snap.bancas ?? []).map((b: any, ib: number) => ({
            id: `${PREFIXO_ARQUIVADO}${a.id}_b${ib}`,
            fase: b.fase,
            criadoEm: b.criadoEm,
            membros: (b.membros ?? []).map((m: any, im: number) => {
              const colunas: Record<string, number | null> = {};
              for (const [rotulo, valor] of Object.entries(m.notasPorCriterio ?? {})) {
                const coluna = HistoricoTccsService.COLUNA_POR_CRITERIO[rotulo];
                if (coluna) colunas[coluna] = valor as number | null;
              }
              return {
                id: `${PREFIXO_ARQUIVADO}${a.id}_b${ib}m${im}`,
                status: m.status,
                nota: m.notaTotal ?? null,
                parecer: m.parecer ?? null,
                avaliadoEm: m.avaliadoEm ?? null,
                avaliadorId: m.avaliadorId ?? null,
                avaliador: { id: m.avaliadorId ?? null, nomeCompleto: m.nome, tratamento: m.tratamento ?? null },
                ...colunas,
              };
            }),
          })),
          solicitacoes: snap.solicitacoes ?? [],
          // Calendário daquele semestre = denominador certo por critério. Sem calendário
          // (período antigo demais), cai nos pesos gravados no snapshot e depois no padrão.
          pesos: cal,
          pesoFase1: cal?.pesoFase1 ?? notas.pesoFase1 ?? PESO_NF1,
          pesoFase2: cal?.pesoFase2 ?? notas.pesoFase2 ?? PESO_NF2,
          ...(profId ? { vinculos } : {}),
        };

        if (!profId) return item; // coordenação vê tudo

        // MESMA condição de liberação do histórico vivo: antes da nota final confirmada (ou
        // de uma fase terminal), o professor não recebe NF, notas por critério nem pareceres.
        const visivel: any = ocultarRascunho(sanitizarNotasTcc(item));

        // MESMO duplo-cego do histórico vivo: quem só participou como avaliador da Fase I de
        // um TCC reprovado nela continua sem saber quem era o aluno/orientador.
        if (ehCegoNoArquivado(a.faseFinal, a.participantes, profId)) {
          visivel.aluno = null;
          visivel.orientador = null;
          visivel.orientadorId = null;
          visivel.coorientadorNome = null;
          visivel.coorientadorTitulacao = null;
          visivel.coorientadorAfiliacao = null;
          visivel.documentos = []; // nomes de arquivo entregariam o aluno
        }
        return visivel;
      });
  }

  async historicoProfessor(profId: string) {
    const semestre = await resolverSemestreAtivo(this.prisma);
    const ocultos = await this.tccsOcultosDoUsuario(profId); // ocultações individuais do professor
    const tccs = await this.prisma.tcc.findMany({
      where: {
        excluidoEm: null,
        semestre: { not: semestre }, // "antigo" = período diferente do atual configurado
        id: { notIn: ocultos }, // fora os que ESTE professor ocultou do próprio histórico
        OR: [
          { orientadorId: profId },
          { coorientadorId: profId },
          { bancas: { some: { membros: { some: { avaliadorId: profId } } } } },
        ],
      },
      include: {
        aluno: { select: { id: true, nomeCompleto: true, email: true, curso: true } },
        orientador: { select: { id: true, nomeCompleto: true, tratamento: true } },
        coorientador: { select: { id: true, nomeCompleto: true, tratamento: true, afiliacao: true, email: true } },
        documentos: { where: { tipo: { not: 'AVALIACAO_BANCA' } }, orderBy: { criadoEm: 'desc' } },
        bancas: { include: { membros: { include: { avaliador: { select: { id: true, nomeCompleto: true, tratamento: true } } } } } },
        solicitacoes: { orderBy: { criadoEm: 'desc' } },
      },
      orderBy: [{ semestre: 'desc' }, { criadoEm: 'desc' }], // semestre mais recente primeiro
    });
    // Pesos do calendário de cada SEMESTRE do TCC (para os cards de notas usarem o peso real do
    // período antigo, não o padrão). `pesos` = a linha do calendário (pesos por critério +
    // pesoFase1/pesoFase2); pesoFase1/pesoFase2 já com o fallback do domínio.
    const cals: any[] = await this.prisma.calendario.findMany({
      where: { semestre: { in: [...new Set(tccs.map((t) => t.semestre))] } },
    });
    const calPorSemestre = new Map<string, any>(cals.map((c) => [c.semestre, c]));
    // Anota o(s) vínculo(s) do professor com cada TCC (para o filtro no front) e sanitiza:
    // esconde notas/parecer até a liberação (nf) e nunca expõe o rascunho privado do avaliador.
    const vivos = tccs.map((t) => {
      const vinculos: string[] = [];
      if (t.orientadorId === profId) vinculos.push('ORIENTADOR');
      if (t.coorientadorId === profId) vinculos.push('COORIENTADOR');
      if ((t.bancas ?? []).some((b) => (b.membros ?? []).some((m) => m.avaliadorId === profId))) vinculos.push('AVALIADOR');
      const cal = calPorSemestre.get(t.semestre) ?? null;
      const base: any = {
        ...ocultarRascunho(sanitizarNotasTcc(t)),
        vinculos,
        pesos: cal, // pesos por critério (para BancaNotasTcc)
        pesoFase1: cal?.pesoFase1 ?? PESO_NF1,
        pesoFase2: cal?.pesoFase2 ?? PESO_NF2,
      };
      // DUPLO-CEGO também no histórico: se o único vínculo do professor é ter sido AVALIADOR
      // da Fase I e o TCC foi REPROVADO na Fase I (nunca chegou à defesa pública da Fase II),
      // a identidade do aluno/orientador e os metadados de documentos continuam anônimos —
      // senão o avaliador cego descobriria o autor no período seguinte. TCCs que passaram da
      // Fase I tiveram defesa pública (a banca da F2 vê o aluno), então abrem normalmente.
      const soAvaliador = vinculos.length === 1 && vinculos[0] === 'AVALIADOR';
      if (soAvaliador && t.faseAtual === 'REPROVADO_FASE_1') {
        for (const k of [
          'aluno', 'alunoId', 'orientador', 'orientadorId', 'coorientador', 'coorientadorId',
          'coorientadorNome', 'coorientadorTitulacao', 'coorientadorAfiliacao', 'coorientadorLattes',
        ]) {
          if (k in base) base[k] = null;
        }
        base.documentos = []; // nomes de arquivo entregariam o aluno
      }
      return base;
    });

    // Junta os TCCs de períodos encerrados em que ESTE professor participou (orientador,
    // coorientador ou banca). Uma lista só: o usuário não vê duas categorias.
    const arquivados = await this.arquivadosComoHistorico(
      { participantes: { some: { usuarioId: profId } } },
      ocultos,
      profId,
    );
    return [...vivos, ...arquivados].sort((a: any, b: any) => String(b.semestre).localeCompare(String(a.semestre)));
  }

  // ----- Ocultação INDIVIDUAL do histórico (preferência por usuário) -----
  // NÃO confundir com exclusão: ocultar só esconde o TCC do histórico DESTE usuário; não mexe
  // no TCC, não toca em `excluidoEm`, não apaga nada. A exclusão administrativa global continua
  // sendo o soft delete (`Tcc.excluidoEm`). Hard delete definitivo não existe (etapa futura).

  // Ids dos TCCs que o usuário ocultou do próprio histórico (para filtrar as listagens).
  private async tccsOcultosDoUsuario(usuarioId: string): Promise<string[]> {
    const linhas = await this.prisma.historicoTccOculto.findMany({ where: { usuarioId }, select: { tccId: true } });
    return linhas.map((l) => l.tccId);
  }

  // Oculta um TCC do histórico do PRÓPRIO usuário logado (id do JWT). Só aceita TCC que
  // realmente APARECE no histórico: ativo (excluidoEm null) e de período ANTERIOR (semestre !=
  // atual). Coordenador pode ocultar qualquer TCC histórico; professor só os que tem vínculo
  // (orientador, coorientador ou membro de banca). Idempotente (se já oculto, retorna ok).
  async ocultarDoHistorico(usuario: { sub: string; papel: string }, tccId: string) {
    // Registro de período encerrado: mesma preferência, mesma checagem de vínculo — o que
    // muda é só de qual tabela vem a prova de que o TCC aparece no histórico deste usuário.
    if (ehArquivado(tccId)) {
      const whereArq: any = { id: idArquivado(tccId) };
      if (usuario.papel !== 'COORDENADOR') whereArq.participantes = { some: { usuarioId: usuario.sub } };
      const arq = await this.prisma.tccArquivado.findFirst({ where: whereArq, select: { id: true } });
      if (!arq) throw new NotFoundException({ mensagem: 'TCC não encontrado no histórico.' });
      await this.prisma.historicoTccOculto.upsert({
        where: { usuarioId_tccId: { usuarioId: usuario.sub, tccId } },
        update: {},
        create: { usuarioId: usuario.sub, tccId },
      });
      return { ok: true };
    }
    const semestre = await resolverSemestreAtivo(this.prisma);
    const where: any = { id: tccId, excluidoEm: null, semestre: { not: semestre } };
    if (usuario.papel !== 'COORDENADOR') {
      where.OR = [
        { orientadorId: usuario.sub },
        { coorientadorId: usuario.sub },
        { bancas: { some: { membros: { some: { avaliadorId: usuario.sub } } } } },
      ];
    }
    const tcc = await this.prisma.tcc.findFirst({ where, select: { id: true } });
    if (!tcc) throw new NotFoundException({ mensagem: 'TCC não encontrado no histórico.' });
    await this.prisma.historicoTccOculto.upsert({
      where: { usuarioId_tccId: { usuarioId: usuario.sub, tccId } },
      update: {},
      create: { usuarioId: usuario.sub, tccId },
    });
    return { ok: true };
  }

  // Desfaz a ocultação do próprio usuário (o TCC volta a aparecer no histórico dele).
  async desocultarDoHistorico(usuario: { sub: string }, tccId: string) {
    await this.prisma.historicoTccOculto.deleteMany({ where: { usuarioId: usuario.sub, tccId } });
    return { ok: true };
  }

  // TCCs que o PRÓPRIO usuário ocultou do histórico, para a tela listar e permitir reexibir
  // (sem isso a ocultação seria um beco sem saída visível). Só dados de identificação — as
  // notas/detalhes continuam vindo das rotas normais de histórico depois de reexibir.
  async listarOcultosDoHistorico(usuario: { sub: string }) {
    const ocultos = await this.prisma.historicoTccOculto.findMany({
      where: { usuarioId: usuario.sub },
      orderBy: { criadoEm: 'desc' },
    });
    if (ocultos.length === 0) return [];
    const ids = ocultos.map((o) => o.tccId);
    const tccs = await this.prisma.tcc.findMany({
      where: { id: { in: ids.filter((i) => !ehArquivado(i)) } },
      select: { id: true, titulo: true, semestre: true, faseAtual: true, aluno: { select: { nomeCompleto: true } } },
      orderBy: [{ semestre: 'desc' }, { criadoEm: 'desc' }],
    });
    // Ocultados de períodos encerrados aparecem na MESMA lista, senão "Reexibir" sumiria só
    // para eles e a ocultação viraria um beco sem saída.
    const arquivados = await this.prisma.tccArquivado.findMany({
      where: { id: { in: ids.filter(ehArquivado).map(idArquivado) } },
      select: { id: true, titulo: true, semestre: true, faseFinal: true, alunoNome: true },
      orderBy: [{ semestre: 'desc' }, { arquivadoEm: 'desc' }],
    });
    return [
      ...tccs,
      ...arquivados.map((a) => ({
        id: `${PREFIXO_ARQUIVADO}${a.id}`,
        titulo: a.titulo,
        semestre: a.semestre,
        faseAtual: a.faseFinal ?? 'CONCLUIDO',
        aluno: { nomeCompleto: a.alunoNome },
      })),
    ].sort((a: any, b: any) => String(b.semestre).localeCompare(String(a.semestre)));
  }

  // Histórico do COORDENADOR: TCCs de períodos ANTERIORES (semestre != atual). Visão
  // administrativa — o coordenador vê TUDO (não sanitiza notas), só nunca o rascunho privado
  // do avaliador. Exclui soft delete (excluidoEm) e os TCCs que ESTE coordenador ocultou do
  // próprio histórico. Usa SEMPRE o id do JWT (nunca do front).
  async historicoCoordenador(coordId: string) {
    const semestre = await resolverSemestreAtivo(this.prisma);
    const ocultos = await this.tccsOcultosDoUsuario(coordId);
    const tccs = await this.prisma.tcc.findMany({
      where: {
        excluidoEm: null,
        semestre: { not: semestre }, // "antigo" = período diferente do atual configurado
        id: { notIn: ocultos }, // fora os que ESTE coordenador ocultou
      },
      include: {
        aluno: { select: { id: true, nomeCompleto: true, email: true, curso: true } },
        orientador: { select: { id: true, nomeCompleto: true, tratamento: true } },
        coorientador: { select: { id: true, nomeCompleto: true, tratamento: true, afiliacao: true, email: true } },
        documentos: { orderBy: { criadoEm: 'desc' } }, // coordenador vê todos (inclui doc da banca)
        bancas: { include: { membros: { include: { avaliador: { select: { id: true, nomeCompleto: true, tratamento: true } } } } } },
        solicitacoes: { orderBy: { criadoEm: 'desc' } },
      },
      orderBy: [{ semestre: 'desc' }, { criadoEm: 'desc' }], // semestre mais recente primeiro
    });
    // Pesos do calendário de cada SEMESTRE (para os cards de notas usarem o peso real do período).
    const cals: any[] = await this.prisma.calendario.findMany({
      where: { semestre: { in: [...new Set(tccs.map((t) => t.semestre))] } },
    });
    const calPorSemestre = new Map<string, any>(cals.map((c) => [c.semestre, c]));
    // Coordenador NÃO sanitiza notas (vê tudo), mas nunca recebe o rascunho privado do avaliador.
    const vivos = tccs.map((t) => {
      const cal = calPorSemestre.get(t.semestre) ?? null;
      return {
        ...ocultarRascunho(t),
        pesos: cal, // linha completa do calendário (pesos por critério) p/ BancaNotasTcc
        pesoFase1: cal?.pesoFase1 ?? PESO_NF1,
        pesoFase2: cal?.pesoFase2 ?? PESO_NF2,
      };
    });

    // Coordenação vê TODOS os períodos encerrados, na mesma lista dos demais históricos.
    const arquivados = await this.arquivadosComoHistorico({}, ocultos);
    return [...vivos, ...arquivados].sort((a: any, b: any) => String(b.semestre).localeCompare(String(a.semestre)));
  }
}
