import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { apiGet } from '../../api';
import { ROTULO_FASE } from '../../utils/fases';
import { ROTULO_CURSO, CRITERIOS_FASE1, CRITERIOS_FASE2, colunaNota, type Criterio } from '@tcc/compartilhado';

// Tela de Relatórios do coordenador (espelha o original): planilha dos TCCs em abas,
// com busca e exportação. Export em CSV (todas as abas juntas) — sem dependência de lib de xlsx.

type Linha = Record<string, string>;

const num = (v: any) => (v == null || v === '' ? '' : Number(v).toFixed(2).replace('.', ','));
const cursoDe = (t: any) => (ROTULO_CURSO as Record<string, string>)[t.aluno?.curso] ?? t.aluno?.curso ?? '';
const membros = (t: any, fase: string) => t.bancas?.find((b: any) => b.fase === fase)?.membros ?? [];

// Avaliadores da Fase I, em ordem estável (o banco não garante a ordem do array).
const f1De = (t: any) => [...membros(t, 'FASE_1')].sort((a: any, b: any) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

// Fase II montada EXPLICITAMENTE por id (não por índice): orientador + os 2 avaliadores da Fase I.
// Cada slot devolve o membro da banca da Fase II (com as notas) e o nome esperado.
function f2De(t: any): { membro: any; nome: string }[] {
  const f1 = f1De(t);
  const lista = membros(t, 'FASE_2');
  const achar = (id?: string) => (id ? lista.find((m: any) => m.avaliadorId === id) ?? null : null);
  const esperados = [
    { id: t.orientadorId, pessoa: t.orientador },
    { id: f1[0]?.avaliadorId, pessoa: f1[0]?.avaliador },
    { id: f1[1]?.avaliadorId, pessoa: f1[1]?.avaliador },
  ];
  return esperados.map((e) => {
    const m = achar(e.id);
    return { membro: m, nome: m?.avaliador?.nomeCompleto ?? e.pessoa?.nomeCompleto ?? '' };
  });
}

const cells = (m: any, criterios: Criterio[]) =>
  Object.fromEntries(criterios.map((c) => [c.rotulo, num(m?.[colunaNota(c.chave)])]));

const ABAS = [
  { id: 'gerais', rotulo: 'Dados gerais' },
  { id: 'fase1', rotulo: 'Avaliações - Fase I' },
  { id: 'fase2', rotulo: 'Avaliações - Fase II' },
  { id: 'apuracao', rotulo: 'Apuração final' },
  { id: 'pareceres', rotulo: 'Relatório de avaliação' },
] as const;
type AbaId = (typeof ABAS)[number]['id'];

export function Relatorios() {
  const [tccs, setTccs] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [aba, setAba] = useState<AbaId>('gerais');
  const [busca, setBusca] = useState('');
  const [campo, setCampo] = useState('todos');

  function carregar() {
    setCarregando(true);
    apiGet('/relatorio').then((r: any) => setTccs(r ?? [])).catch(() => setTccs([])).finally(() => setCarregando(false));
  }
  useEffect(carregar, []);
  useEffect(() => setCampo('todos'), [aba]);

  // Nº de referência (1-based) estável por TCC, para cruzar entre as abas.
  const numeroDe = useMemo(() => {
    const m = new Map<string, number>();
    tccs.forEach((t, i) => m.set(t.id, i + 1));
    return m;
  }, [tccs]);
  const nro = (t: any) => String(numeroDe.get(t.id) ?? '');

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return tccs;
    return tccs.filter((t) => {
      const aluno = (t.aluno?.nomeCompleto ?? '').toLowerCase();
      const titulo = (t.titulo ?? '').toLowerCase();
      const orient = (t.orientador?.nomeCompleto ?? '').toLowerCase();
      const sem = (t.semestre ?? '').toLowerCase();
      const curso = cursoDe(t).toLowerCase();
      if (campo === 'aluno') return aluno.includes(termo);
      if (campo === 'titulo') return titulo.includes(termo);
      if (campo === 'orientador') return orient.includes(termo);
      if (campo === 'semestre') return sem.includes(termo);
      if (campo === 'curso') return curso.includes(termo);
      return [nro(t), aluno, titulo, orient, sem, curso].some((x) => x.includes(termo));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tccs, busca, campo, numeroDe]);

  // Linhas de uma aba (usado tanto na tabela quanto no export de todas as abas).
  function linhasDaAba(qual: AbaId, lista: any[]): Linha[] {
    if (qual === 'gerais') {
      return lista.map((t) => {
        const f1 = f1De(t);
        const f2 = f2De(t);
        return {
          'Nº': nro(t),
          Curso: cursoDe(t),
          'Título': t.titulo,
          Aluno: t.aluno?.nomeCompleto ?? '',
          Orientador: t.orientador?.nomeCompleto ?? '',
          Coorientador: t.coorientador?.nomeCompleto ?? t.coorientadorNome ?? '',
          'Aval. 1 (F1)': f1[0]?.avaliador?.nomeCompleto ?? '',
          'Aval. 2 (F1)': f1[1]?.avaliador?.nomeCompleto ?? '',
          'Aval. 1 (F2)': f2[0].nome,
          'Aval. 2 (F2)': f2[1].nome,
          'Aval. 3 (F2)': f2[2].nome,
          Semestre: t.semestre,
          Fase: ROTULO_FASE[t.faseAtual] ?? t.faseAtual,
        };
      });
    }
    if (qual === 'fase1') {
      return lista.flatMap((t) => {
        const f1 = f1De(t);
        const base = { 'Nº': nro(t), 'Título': t.titulo, Aluno: t.aluno?.nomeCompleto ?? '' };
        if (!f1.length) return [{ ...base, Avaliador: '—', ...cells(null, CRITERIOS_FASE1), Total: '' }];
        return f1.map((m: any) => ({ ...base, Avaliador: m.avaliador?.nomeCompleto ?? '', ...cells(m, CRITERIOS_FASE1), Total: num(m.nota) }));
      });
    }
    if (qual === 'fase2') {
      return lista.flatMap((t) => {
        const slots = f2De(t);
        const base = { 'Nº': nro(t), 'Título': t.titulo, Aluno: t.aluno?.nomeCompleto ?? '' };
        if (!membros(t, 'FASE_2').length) return [{ ...base, Avaliador: '—', ...cells(null, CRITERIOS_FASE2), Total: '' }];
        return slots.map((s) => ({ ...base, Avaliador: s.nome || '—', ...cells(s.membro, CRITERIOS_FASE2), Total: num(s.membro?.nota) }));
      });
    }
    if (qual === 'apuracao') {
      return lista.map((t) => ({
        'Nº': nro(t),
        'Título': t.titulo,
        Aluno: t.aluno?.nomeCompleto ?? '',
        Orientador: t.orientador?.nomeCompleto ?? '',
        NF1: num(t.nf1),
        NF2: num(t.nf2),
        'NF (0,6·NF1+0,4·NF2)': num(t.nf),
        Resultado: t.resultado ?? (t.faseAtual === 'CONCLUIDO' ? 'APROVADO' : ''),
      }));
    }
    // pareceres
    return lista.map((t) => {
      const f1 = f1De(t);
      const f2 = f2De(t);
      return {
        'Nº': nro(t),
        'Título': t.titulo,
        Aluno: t.aluno?.nomeCompleto ?? '',
        'Aval. 1 (F1)': f1[0]?.avaliador?.nomeCompleto ?? '',
        'Parecer 1 (F1)': f1[0]?.parecer ?? '',
        'Aval. 2 (F1)': f1[1]?.avaliador?.nomeCompleto ?? '',
        'Parecer 2 (F1)': f1[1]?.parecer ?? '',
        'Aval. 1 (F2)': f2[0].nome,
        'Parecer 1 (F2)': f2[0].membro?.parecer ?? '',
        'Aval. 2 (F2)': f2[1].nome,
        'Parecer 2 (F2)': f2[1].membro?.parecer ?? '',
        'Aval. 3 (F2)': f2[2].nome,
        'Parecer 3 (F2)': f2[2].membro?.parecer ?? '',
      };
    });
  }

  const linhas = useMemo(() => linhasDaAba(aba, filtrados), [aba, filtrados]); // eslint-disable-line react-hooks/exhaustive-deps
  const cols = linhas[0] ? Object.keys(linhas[0]) : [];

  // Exporta uma planilha Excel com as 5 abas reais (uma sheet por aba), como no projeto antigo.
  function exportarXlsx() {
    const wb = XLSX.utils.book_new();
    ABAS.forEach((a) => {
      const ls = linhasDaAba(a.id, filtrados);
      const ws = XLSX.utils.json_to_sheet(ls);
      if (ls.length) {
        const cls = Object.keys(ls[0]);
        ws['!cols'] = cls.map((c) => {
          const max = Math.max(c.length, ...ls.map((l) => String(l[c] ?? '').length));
          return { wch: Math.min(max + 2, 60) };
        });
      }
      const nome = a.rotulo.replace(/[\\/?*[\]:]/g, '').slice(0, 31);
      XLSX.utils.book_append_sheet(wb, ws, nome);
    });
    XLSX.writeFile(wb, `Relatorio_TCCs_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  return (
    <>
      <div className="cabecalho-secao">
        <div>
          <h1>Relatórios</h1>
          <p className="legenda">Planilha dos TCCs — dados, avaliações por critério e apuração.</p>
        </div>
        <div className="acoes" style={{ margin: 0 }}>
          <button className="botao botao-secundario" onClick={carregar}>Atualizar</button>
          <button className="botao" onClick={exportarXlsx} disabled={!tccs.length}>Exportar Excel</button>
        </div>
      </div>

      <section className="cartao-secao bloco">
        <div className="filtros">
          <label className="campo" style={{ flex: 2 }}>
            <span>Pesquisar</span>
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Aluno, título, orientador…" />
          </label>
          <label className="campo">
            <span>Campo</span>
            <select value={campo} onChange={(e) => setCampo(e.target.value)}>
              <option value="todos">Todos os campos</option>
              <option value="aluno">Aluno</option>
              <option value="titulo">Título</option>
              <option value="orientador">Orientador</option>
              {aba === 'gerais' && (
                <>
                  <option value="curso">Curso</option>
                  <option value="semestre">Semestre</option>
                </>
              )}
            </select>
          </label>
        </div>
      </section>

      <div className="rel-abas bloco">
        {ABAS.map((a) => (
          <button key={a.id} className={`rel-aba${aba === a.id ? ' ativa' : ''}`} onClick={() => setAba(a.id)}>
            {a.rotulo}
          </button>
        ))}
      </div>

      <p className="legenda" style={{ marginTop: 10 }}>
        Exibindo <strong>{filtrados.length}</strong> de <strong>{tccs.length}</strong> TCCs.
      </p>

      <section className="cartao-secao bloco" style={{ padding: 0 }}>
        {carregando ? (
          <p className="nota-vazio" style={{ padding: 24 }}>Carregando…</p>
        ) : !linhas.length ? (
          <p className="nota-vazio" style={{ padding: 24 }}>Nenhum TCC encontrado.</p>
        ) : (
          <div className="tabela-rolavel">
            <table className="tabela tabela-relatorio">
              <thead>
                <tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {linhas.map((l, i) => (
                  <tr key={i}>{cols.map((c) => <td key={c} title={l[c]}>{l[c] || '—'}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
