// Edição administrativa do TCC pelo coordenador (PUT /tccs/:id).
// Campos sensíveis (fase, notas, resultado, aluno) ganham aviso visual.
import { useEffect, useState } from 'react';
import { apiGet, apiPut, type ErroApi } from '../api';
import { FASES, ROTULO_FASE } from '@tcc/compartilhado';
import { Modal } from './Modal';

const rotuloUsuario = (u: any) =>
  `${u.tratamento ? u.tratamento + ' ' : ''}${u.nomeCompleto}${u.papel === 'AVALIADOR' ? ' (Externo)' : u.papel === 'COORDENADOR' ? ' (Coordenador)' : u.papel === 'PROFESSOR' ? ' (Professor)' : ''}`;

const numToStr = (v: any) => (v == null ? '' : String(v).replace('.', ','));
const parseNota = (s: string): number | null => {
  const t = s.trim();
  if (t === '') return null;
  return Number(t.replace(',', '.'));
};

export function ModalEditarTcc({ tcc, aoFechar, aoSalvo }: { tcc: any; aoFechar: () => void; aoSalvo: () => void }) {
  const [alunos, setAlunos] = useState<any[]>([]);
  const [professores, setProfessores] = useState<any[]>([]);
  const [coorientadores, setCoorientadores] = useState<any[]>([]);

  const [titulo, setTitulo] = useState(tcc.titulo ?? '');
  const [semestre, setSemestre] = useState(tcc.semestre ?? '');
  const [faseAtual, setFaseAtual] = useState(tcc.faseAtual ?? '');
  const [resultado, setResultado] = useState(tcc.resultado ?? '');
  const [nf1, setNf1] = useState(numToStr(tcc.nf1));
  const [nf2, setNf2] = useState(numToStr(tcc.nf2));
  const [nf, setNf] = useState(numToStr(tcc.nf));
  const [monografiaAprovada, setMonografiaAprovada] = useState(!!tcc.monografiaAprovada);
  const [continuidadeConfirmada, setContinuidadeConfirmada] = useState(!!tcc.continuidadeConfirmada);
  const [parecerContinuidade, setParecerContinuidade] = useState(tcc.parecerContinuidade ?? '');
  const [alunoId, setAlunoId] = useState(tcc.aluno?.id ?? tcc.alunoId ?? '');
  const [orientadorId, setOrientadorId] = useState(tcc.orientador?.id ?? tcc.orientadorId ?? '');
  const [coorientadorId, setCoorientadorId] = useState(tcc.coorientador?.id ?? tcc.coorientadorId ?? '');
  const [coorientadorNome, setCoorientadorNome] = useState(tcc.coorientadorNome ?? '');
  const [coorientadorTitulacao, setCoorientadorTitulacao] = useState(tcc.coorientadorTitulacao ?? '');
  const [coorientadorAfiliacao, setCoorientadorAfiliacao] = useState(tcc.coorientadorAfiliacao ?? '');
  const [coorientadorLattes, setCoorientadorLattes] = useState(tcc.coorientadorLattes ?? '');

  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    apiGet('/usuarios/lista?papel=ALUNO').then((r: any) => setAlunos(r ?? [])).catch(() => setAlunos([]));
    apiGet('/usuarios/lista?papel=PROFESSOR').then((r: any) => setProfessores(r ?? [])).catch(() => setProfessores([]));
    apiGet('/usuarios/coorientadores').then((r: any) => setCoorientadores(r ?? [])).catch(() => setCoorientadores([]));
  }, []);

  async function salvar() {
    setErro('');
    if (!titulo.trim()) return setErro('Informe o título.');
    if (!semestre.trim()) return setErro('Informe o semestre.');
    if (!alunoId) return setErro('Selecione o aluno.');
    for (const [rotulo, valor] of [['NF1', nf1], ['NF2', nf2], ['NF', nf]] as const) {
      const n = parseNota(valor);
      if (n != null && (!Number.isFinite(n) || n < 0 || n > 10)) return setErro(`${rotulo} deve ser um número entre 0 e 10 (ou vazio).`);
    }
    setSalvando(true);
    try {
      await apiPut(`/tccs/${tcc.id}`, {
        titulo: titulo.trim(),
        semestre: semestre.trim(),
        faseAtual,
        resultado: resultado || null,
        nf1: parseNota(nf1),
        nf2: parseNota(nf2),
        nf: parseNota(nf),
        monografiaAprovada,
        continuidadeConfirmada,
        parecerContinuidade: parecerContinuidade.trim() || null,
        alunoId,
        orientadorId: orientadorId || null,
        coorientadorId: coorientadorId || null,
        coorientadorNome: coorientadorNome.trim() || null,
        coorientadorTitulacao: coorientadorTitulacao.trim() || null,
        coorientadorAfiliacao: coorientadorAfiliacao.trim() || null,
        coorientadorLattes: coorientadorLattes.trim() || null,
      });
      aoSalvo();
      aoFechar();
    } catch (e) {
      const er = e as ErroApi;
      setErro(er.erros?.[0]?.mensagem || er.mensagem || 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal titulo="Editar informações do TCC" subtitulo={tcc.titulo} aoFechar={() => !salvando && aoFechar()}>
      {erro && <div className="erro-geral">{erro}</div>}
      <div className="alerta" style={{ background: 'rgba(245,158,11,.12)', color: '#b45309', marginBottom: 14 }}>
        ⚠ Edição administrativa. Alterar <strong>fase, notas, resultado ou aluno</strong> pode afetar o fluxo do TCC — use com cuidado.
      </div>

      <h3 className="titulo-bloco">Dados gerais</h3>
      <label className="campo"><span>Título</span><input value={titulo} onChange={(e) => setTitulo(e.target.value)} /></label>
      <div className="grade-2">
        <label className="campo"><span>Semestre</span><input value={semestre} onChange={(e) => setSemestre(e.target.value)} placeholder="2026.1" /></label>
        <label className="campo">
          <span>Fase atual ⚠</span>
          <select value={faseAtual} onChange={(e) => setFaseAtual(e.target.value)}>
            {FASES.map((f) => <option key={f} value={f}>{ROTULO_FASE[f] ?? f}</option>)}
          </select>
        </label>
      </div>

      <h3 className="titulo-bloco" style={{ marginTop: 16 }}>Notas e resultado ⚠</h3>
      <div className="grade-2">
        <label className="campo"><span>NF1 (Fase I)</span><input inputMode="decimal" value={nf1} onChange={(e) => setNf1(e.target.value)} placeholder="vazio = sem nota" /></label>
        <label className="campo"><span>NF2 (Fase II)</span><input inputMode="decimal" value={nf2} onChange={(e) => setNf2(e.target.value)} placeholder="vazio = sem nota" /></label>
        <label className="campo"><span>NF (final)</span><input inputMode="decimal" value={nf} onChange={(e) => setNf(e.target.value)} placeholder="vazio = sem nota" /></label>
        <label className="campo">
          <span>Resultado</span>
          <select value={resultado} onChange={(e) => setResultado(e.target.value)}>
            <option value="">— sem resultado —</option>
            <option value="APROVADO">Aprovado</option>
            <option value="REPROVADO">Reprovado</option>
          </select>
        </label>
      </div>

      <h3 className="titulo-bloco" style={{ marginTop: 16 }}>Desenvolvimento</h3>
      <div className="pref-lista">
        <div className="pref-item">
          <div className="pref-texto"><span className="pref-rotulo">Monografia aprovada</span><span className="pref-desc">Trilha da monografia concluída pelo orientador.</span></div>
          <button type="button" role="switch" aria-checked={monografiaAprovada} className={`pref-switch${monografiaAprovada ? ' on' : ''}`} onClick={() => setMonografiaAprovada((v) => !v)}><span className="pref-switch-bolinha" aria-hidden="true" /></button>
        </div>
        <div className="pref-item">
          <div className="pref-texto"><span className="pref-rotulo">Continuidade confirmada</span><span className="pref-desc">Trilha da continuidade confirmada pelo orientador.</span></div>
          <button type="button" role="switch" aria-checked={continuidadeConfirmada} className={`pref-switch${continuidadeConfirmada ? ' on' : ''}`} onClick={() => setContinuidadeConfirmada((v) => !v)}><span className="pref-switch-bolinha" aria-hidden="true" /></button>
        </div>
      </div>
      <label className="campo" style={{ marginTop: 12 }}><span>Parecer de continuidade</span><textarea rows={2} value={parecerContinuidade} onChange={(e) => setParecerContinuidade(e.target.value)} placeholder="Motivo (quando descontinuado)…" /></label>

      <h3 className="titulo-bloco" style={{ marginTop: 16 }}>Pessoas</h3>
      <div className="grade-2">
        <label className="campo">
          <span>Aluno ⚠</span>
          <select value={alunoId} onChange={(e) => setAlunoId(e.target.value)}>
            <option value="">Selecione…</option>
            {alunos.map((a) => <option key={a.id} value={a.id}>{a.nomeCompleto}{a.email ? ` · ${a.email}` : ''}</option>)}
          </select>
        </label>
        <label className="campo">
          <span>Orientador</span>
          <select value={orientadorId} onChange={(e) => setOrientadorId(e.target.value)}>
            <option value="">— sem orientador —</option>
            {professores.map((p) => <option key={p.id} value={p.id}>{rotuloUsuario(p)}</option>)}
          </select>
        </label>
        <label className="campo">
          <span>Coorientador (interno)</span>
          <select value={coorientadorId} onChange={(e) => setCoorientadorId(e.target.value)}>
            <option value="">— nenhum / externo —</option>
            {coorientadores.map((c) => <option key={c.id} value={c.id}>{rotuloUsuario(c)}</option>)}
          </select>
        </label>
      </div>

      <h3 className="titulo-bloco" style={{ marginTop: 16 }}>Coorientador externo (se não for interno)</h3>
      <div className="grade-2">
        <label className="campo"><span>Nome</span><input value={coorientadorNome} onChange={(e) => setCoorientadorNome(e.target.value)} /></label>
        <label className="campo"><span>Titulação</span><input value={coorientadorTitulacao} onChange={(e) => setCoorientadorTitulacao(e.target.value)} placeholder="Mestre / Doutor…" /></label>
        <label className="campo"><span>Afiliação</span><input value={coorientadorAfiliacao} onChange={(e) => setCoorientadorAfiliacao(e.target.value)} /></label>
        <label className="campo"><span>Lattes</span><input value={coorientadorLattes} onChange={(e) => setCoorientadorLattes(e.target.value)} placeholder="http://lattes.cnpq.br/…" /></label>
      </div>

      <div className="acoes">
        <button className="botao botao-secundario" disabled={salvando} onClick={aoFechar}>Cancelar</button>
        <button className="botao" disabled={salvando} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar alterações'}</button>
      </div>
    </Modal>
  );
}
