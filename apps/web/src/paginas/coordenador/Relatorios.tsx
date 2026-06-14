import { useEffect, useMemo, useState } from 'react';
import { apiGet } from '../../api';
import { ROTULO_FASE } from '../../utils/fases';
import { ROTULO_CURSO, CRITERIOS_FASE1, CRITERIOS_FASE2, colunaNota } from '@tcc/compartilhado';

// Tela de Relatórios do coordenador (espelha o original): planilha dos TCCs em abas,
// com busca e exportação. Export em CSV (abre no Excel) — sem dependência de lib de xlsx.

type Linha = Record<string, string>;

const num = (v: any) => (v == null || v === '' ? '' : Number(v).toFixed(2).replace('.', ','));
const membrosFase = (t: any, fase: string) => t.bancas?.find((b: any) => b.fase === fase)?.membros ?? [];
const cursoDe = (t: any) => (ROTULO_CURSO as Record<string, string>)[t.aluno?.curso] ?? t.aluno?.curso ?? '';

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

  const linhas: Linha[] = useMemo(() => {
    if (aba === 'gerais') {
      return filtrados.map((t) => {
        const f1 = membrosFase(t, 'FASE_1');
        const f2 = membrosFase(t, 'FASE_2');
        return {
          'Nº': nro(t),
          Curso: cursoDe(t),
          'Título': t.titulo,
          Aluno: t.aluno?.nomeCompleto ?? '',
          Orientador: t.orientador?.nomeCompleto ?? '',
          Coorientador: t.coorientador?.nomeCompleto ?? t.coorientadorNome ?? '',
          'Aval. 1 (F1)': f1[0]?.avaliador?.nomeCompleto ?? '',
          'Aval. 2 (F1)': f1[1]?.avaliador?.nomeCompleto ?? '',
          'Aval. 1 (F2)': f2[0]?.avaliador?.nomeCompleto ?? '',
          'Aval. 2 (F2)': f2[1]?.avaliador?.nomeCompleto ?? '',
          'Aval. 3 (F2)': f2[2]?.avaliador?.nomeCompleto ?? '',
          Semestre: t.semestre,
          Fase: ROTULO_FASE[t.faseAtual] ?? t.faseAtual,
        };
      });
    }
    if (aba === 'fase1' || aba === 'fase2') {
      const fase = aba === 'fase1' ? 'FASE_1' : 'FASE_2';
      const criterios = aba === 'fase1' ? CRITERIOS_FASE1 : CRITERIOS_FASE2;
      return filtrados.flatMap((t) => {
        const membros = membrosFase(t, fase);
        const base = { 'Nº': nro(t), 'Título': t.titulo, Aluno: t.aluno?.nomeCompleto ?? '' };
        if (!membros.length) {
          return [{ ...base, Avaliador: '—', ...Object.fromEntries(criterios.map((c) => [c.rotulo, ''])), Total: '' }];
        }
        return membros.map((m: any) => ({
          ...base,
          Avaliador: m.avaliador?.nomeCompleto ?? '',
          ...Object.fromEntries(criterios.map((c) => [c.rotulo, num(m[colunaNota(c.chave)])])),
          Total: num(m.nota),
        }));
      });
    }
    if (aba === 'apuracao') {
      return filtrados.map((t) => ({
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
    return filtrados.map((t) => {
      const f1 = membrosFase(t, 'FASE_1');
      const f2 = membrosFase(t, 'FASE_2');
      return {
        'Nº': nro(t),
        'Título': t.titulo,
        Aluno: t.aluno?.nomeCompleto ?? '',
        'Aval. 1 (F1)': f1[0]?.avaliador?.nomeCompleto ?? '',
        'Parecer 1 (F1)': f1[0]?.parecer ?? '',
        'Aval. 2 (F1)': f1[1]?.avaliador?.nomeCompleto ?? '',
        'Parecer 2 (F1)': f1[1]?.parecer ?? '',
        'Aval. 1 (F2)': f2[0]?.avaliador?.nomeCompleto ?? '',
        'Parecer 1 (F2)': f2[0]?.parecer ?? '',
        'Aval. 2 (F2)': f2[1]?.avaliador?.nomeCompleto ?? '',
        'Parecer 2 (F2)': f2[1]?.parecer ?? '',
        'Aval. 3 (F2)': f2[2]?.avaliador?.nomeCompleto ?? '',
        'Parecer 3 (F2)': f2[2]?.parecer ?? '',
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aba, filtrados, numeroDe]);

  function exportar() {
    if (!linhas.length) return;
    const cols = Object.keys(linhas[0]);
    const esc = (v: string) => {
      const s = String(v ?? '');
      return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = '﻿' + [cols.join(';'), ...linhas.map((l) => cols.map((c) => esc(l[c])).join(';'))].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relatorio_${aba}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const cols = linhas[0] ? Object.keys(linhas[0]) : [];

  return (
    <>
      <div className="cabecalho-secao">
        <div>
          <h1>Relatórios</h1>
          <p className="legenda">Planilha dos TCCs — dados, avaliações por critério e apuração.</p>
        </div>
        <div className="acoes" style={{ margin: 0 }}>
          <button className="botao botao-secundario" onClick={carregar}>Atualizar</button>
          <button className="botao" onClick={exportar} disabled={!linhas.length}>Exportar CSV</button>
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
