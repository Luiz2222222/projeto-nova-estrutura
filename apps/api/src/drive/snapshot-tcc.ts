import { ROTULO_PAPEL, ROTULO_CURSO } from '@tcc/compartilhado';

// Retrato completo e restaurável de um TCC: vira o dados.json (estruturado) e o resumo.txt
// (legível) no Drive, e é o mesmo conteúdo guardado em TccArquivado.
//
// REGRA DE SEGURANÇA: nada de senha, hash, token, segredo ou rascunho privado do avaliador
// entra aqui. O `select` do Prisma em quem monta o snapshot já limita os campos, e
// `limparSensiveis` é a rede de proteção final.
const CAMPOS_PROIBIDOS = ['senha', 'senhahash', 'token', 'segredo', 'secret', 'refresh', 'rascunho', 'senhacriptografada'];

// Remove recursivamente qualquer chave com cara de credencial, em qualquer profundidade.
export function limparSensiveis<T>(valor: T): T {
  if (Array.isArray(valor)) return valor.map((v) => limparSensiveis(v)) as unknown as T;
  if (valor && typeof valor === 'object' && !(valor instanceof Date)) {
    const saida: Record<string, unknown> = {};
    for (const [chave, v] of Object.entries(valor as Record<string, unknown>)) {
      const normalizada = chave.toLowerCase();
      if (CAMPOS_PROIBIDOS.some((p) => normalizada.includes(p))) continue;
      saida[chave] = limparSensiveis(v);
    }
    return saida as T;
  }
  return valor;
}

const CRITERIOS_FASE1 = [
  ['notaResumo', 'Resumo'],
  ['notaIntroducao', 'Introdução'],
  ['notaRevisao', 'Revisão'],
  ['notaDesenvolvimento', 'Desenvolvimento'],
  ['notaConclusoes', 'Conclusões'],
] as const;
const CRITERIOS_FASE2 = [
  ['notaCoerencia', 'Coerência'],
  ['notaQualidade', 'Qualidade'],
  ['notaDominio', 'Domínio'],
  ['notaClareza', 'Clareza'],
  ['notaObservancia', 'Observância'],
] as const;

function data(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function dataBr(v: Date | string | null | undefined): string {
  const iso = data(v);
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

function nota(v: number | null | undefined): string {
  return v == null ? '—' : v.toFixed(2).replace('.', ',');
}

// `tcc` precisa vir com aluno, orientador, coorientador, documentos, solicitacoes e
// bancas.membros.avaliador incluídos. `calendario` traz os pesos do semestre.
export function montarSnapshot(tcc: any, calendario: any | null) {
  const membrosDaBanca = (b: any) =>
    (b.membros ?? []).map((m: any) => ({
      avaliadorId: m.avaliadorId,
      nome: m.avaliador?.nomeCompleto ?? null,
      tratamento: m.avaliador?.tratamento ?? null,
      papel: m.avaliador?.papel ?? null,
      afiliacao: m.avaliador?.afiliacao ?? null,
      externo: m.avaliador?.papel === 'AVALIADOR',
      status: m.status,
      notasPorCriterio: Object.fromEntries(
        (b.fase === 'FASE_1' ? CRITERIOS_FASE1 : CRITERIOS_FASE2).map(([campo, rotulo]) => [rotulo, m[campo] ?? null]),
      ),
      notaTotal: m.nota ?? null,
      parecer: m.parecer ?? null,
      avaliadoEm: data(m.avaliadoEm),
    }));

  const dados = {
    versaoSnapshot: 1,
    geradoEm: new Date().toISOString(),
    tcc: {
      id: tcc.id,
      titulo: tcc.titulo,
      semestre: tcc.semestre,
      faseAtual: tcc.faseAtual,
      monografiaAprovada: tcc.monografiaAprovada,
      continuidadeConfirmada: tcc.continuidadeConfirmada,
      parecerContinuidade: tcc.parecerContinuidade ?? null,
      excluidoEm: data(tcc.excluidoEm),
      motivoExclusao: tcc.motivoExclusao ?? null,
      criadoEm: data(tcc.criadoEm),
    },
    aluno: {
      nomeCompleto: tcc.aluno?.nomeCompleto ?? null,
      email: tcc.aluno?.email ?? null,
      curso: tcc.aluno?.curso ?? null,
      cursoRotulo: tcc.aluno?.curso ? ROTULO_CURSO[tcc.aluno.curso as keyof typeof ROTULO_CURSO] ?? null : null,
    },
    orientador: tcc.orientador
      ? { nomeCompleto: tcc.orientador.nomeCompleto, tratamento: tcc.orientador.tratamento ?? null }
      : null,
    coorientador: tcc.coorientador
      ? { nomeCompleto: tcc.coorientador.nomeCompleto, tratamento: tcc.coorientador.tratamento ?? null, externo: false }
      : tcc.coorientadorNome
        ? {
            nomeCompleto: tcc.coorientadorNome,
            titulacao: tcc.coorientadorTitulacao ?? null,
            afiliacao: tcc.coorientadorAfiliacao ?? null,
            lattes: tcc.coorientadorLattes ?? null,
            externo: true,
          }
        : null,
    notas: {
      nf1: tcc.nf1 ?? null,
      nf2: tcc.nf2 ?? null,
      nf: tcc.nf ?? null,
      resultado: tcc.resultado ?? null,
      pesoFase1: calendario?.pesoFase1 ?? null,
      pesoFase2: calendario?.pesoFase2 ?? null,
    },
    datas: {
      monografiaAprovadaEm: data(tcc.monografiaAprovadaEm),
      continuidadeAvaliadaEm: data(tcc.continuidadeAvaliadaEm),
      fase1ValidadaEm: data(tcc.fase1ValidadaEm),
      fase2ValidadaEm: data(tcc.fase2ValidadaEm),
      versaoFinalValidadaEm: data(tcc.versaoFinalValidadaEm),
      concluidoEm: data(tcc.concluidoEm),
    },
    defesa: {
      agendadaPara: data(tcc.defesaAgendadaPara),
      local: tcc.defesaLocal ?? null,
      comentario: tcc.defesaComentario ?? null,
      agendadaEm: data(tcc.defesaAgendadaEm),
      liberadaEm: data(tcc.defesaLiberadaEm),
    },
    documentos: (tcc.documentos ?? []).map((d: any) => ({
      id: d.id,
      tipo: d.tipo,
      nomeArquivo: d.nomeArquivo,
      versao: d.versao,
      status: d.status,
      parecer: d.parecer ?? null,
      tamanho: d.tamanho,
      criadoEm: data(d.criadoEm),
    })),
    bancas: (tcc.bancas ?? []).map((b: any) => ({
      fase: b.fase,
      criadoEm: data(b.criadoEm),
      membros: membrosDaBanca(b),
    })),
    solicitacoes: (tcc.solicitacoes ?? []).map((s: any) => ({
      status: s.status,
      mensagem: s.mensagem ?? null,
      parecer: s.parecer ?? null,
      criadoEm: data(s.criadoEm),
      respondidoEm: data(s.respondidoEm),
    })),
  };

  return limparSensiveis(dados);
}

// Versão legível do MESMO conteúdo — para quem abrir a pasta no Drive entender sem ler JSON.
export function montarResumo(dados: any): string {
  const l: string[] = [];
  l.push('TRABALHO DE CONCLUSÃO DE CURSO');
  l.push('='.repeat(60));
  l.push(`Título: ${dados.tcc.titulo}`);
  l.push(`Semestre: ${dados.tcc.semestre}`);
  l.push(`Fase: ${dados.tcc.faseAtual}`);
  l.push('');
  l.push(`Aluno: ${dados.aluno.nomeCompleto ?? '—'} (${dados.aluno.email ?? '—'})`);
  l.push(`Curso: ${dados.aluno.cursoRotulo ?? '—'}`);
  const ori = dados.orientador;
  l.push(`Orientador: ${ori ? `${ori.tratamento ?? ''} ${ori.nomeCompleto}`.trim() : '—'}`);
  if (dados.coorientador) {
    const co = dados.coorientador;
    l.push(`Coorientador: ${co.nomeCompleto}${co.externo ? ` (externo — ${co.afiliacao ?? 's/ afiliação'})` : ''}`);
  }
  l.push('');
  l.push('NOTAS');
  l.push('-'.repeat(60));
  l.push(`NF1 (Fase I): ${nota(dados.notas.nf1)}`);
  l.push(`NF2 (Fase II): ${nota(dados.notas.nf2)}`);
  l.push(`Nota final: ${nota(dados.notas.nf)}`);
  l.push(`Resultado: ${dados.notas.resultado ?? '—'}`);
  l.push('');
  l.push('DATAS');
  l.push('-'.repeat(60));
  l.push(`Monografia aprovada: ${dataBr(dados.datas.monografiaAprovadaEm)}`);
  l.push(`Continuidade avaliada: ${dataBr(dados.datas.continuidadeAvaliadaEm)}`);
  l.push(`Fase I validada: ${dataBr(dados.datas.fase1ValidadaEm)}`);
  l.push(`Fase II validada: ${dataBr(dados.datas.fase2ValidadaEm)}`);
  l.push(`Versão final validada: ${dataBr(dados.datas.versaoFinalValidadaEm)}`);
  l.push(`Concluído em: ${dataBr(dados.datas.concluidoEm)}`);
  if (dados.defesa.agendadaPara) {
    l.push('');
    l.push('DEFESA');
    l.push('-'.repeat(60));
    l.push(`Data: ${dataBr(dados.defesa.agendadaPara)}`);
    l.push(`Local: ${dados.defesa.local ?? '—'}`);
  }
  for (const b of dados.bancas ?? []) {
    l.push('');
    l.push(`BANCA — ${b.fase === 'FASE_1' ? 'Fase I' : 'Fase II'}`);
    l.push('-'.repeat(60));
    for (const m of b.membros ?? []) {
      l.push(`• ${`${m.tratamento ?? ''} ${m.nome ?? '—'}`.trim()}${m.externo ? ' (avaliador externo)' : ''}`);
      l.push(`  ${ROTULO_PAPEL[m.papel as keyof typeof ROTULO_PAPEL] ?? m.papel ?? '—'} — status: ${m.status}`);
      const criterios = Object.entries(m.notasPorCriterio ?? {})
        .map(([k, v]) => `${k}: ${nota(v as number)}`)
        .join(' | ');
      if (criterios) l.push(`  ${criterios}`);
      l.push(`  Nota total: ${nota(m.notaTotal)}`);
      if (m.parecer) l.push(`  Parecer: ${m.parecer}`);
    }
  }
  l.push('');
  l.push('DOCUMENTOS');
  l.push('-'.repeat(60));
  for (const d of dados.documentos ?? []) {
    l.push(`• ${d.tipo} v${d.versao} — ${d.nomeArquivo} (${d.status}, ${dataBr(d.criadoEm)})`);
  }
  l.push('');
  l.push(`Gerado pelo Sistema de TCC em ${dataBr(dados.geradoEm)}.`);
  return l.join('\n');
}
