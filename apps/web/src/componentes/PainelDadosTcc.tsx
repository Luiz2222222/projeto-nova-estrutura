// Aba "Dados gerais" do modal único de edição do TCC (coordenador). PUT /tccs/:id.
// SÓ dados gerais: a fase (e tudo que deriva dela — notas, banca, defesa) muda apenas pela
// Correção de fluxo (PainelCorrigirFase), nunca por aqui — salvar título/pessoas/semestre
// não altera fase, notas nem resultados.
import type { Tcc, UsuarioResumo } from '../tipos';
import { useEffect, useState } from 'react';
import { apiGet, apiPut, type ErroApi } from '../api';
import { ROTULO_FASE } from '@tcc/compartilhado';
import { ModalConfirmacao } from './ModalConfirmacao';

const rotuloUsuario = (u: UsuarioResumo) =>
  `${u.tratamento ? u.tratamento + ' ' : ''}${u.nomeCompleto}${u.papel === 'AVALIADOR' ? ' (Externo)' : u.papel === 'COORDENADOR' ? ' (Coordenador)' : u.papel === 'PROFESSOR' ? ' (Professor)' : ''}`;

export function PainelDadosTcc({ tcc, aoSalvo }: { tcc: Tcc; aoSalvo: () => void }) {
  const [alunos, setAlunos] = useState<UsuarioResumo[]>([]);
  const [professores, setProfessores] = useState<UsuarioResumo[]>([]);
  const [coorientadores, setCoorientadores] = useState<UsuarioResumo[]>([]);

  const [titulo, setTitulo] = useState(tcc.titulo ?? '');
  const [semestre, setSemestre] = useState(tcc.semestre ?? '');
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
  const [msg, setMsg] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [confirmandoSemestre, setConfirmandoSemestre] = useState(false);

  useEffect(() => {
    apiGet<UsuarioResumo[]>('/usuarios/lista?papel=ALUNO').then((r) => setAlunos(r ?? [])).catch(() => setAlunos([]));
    apiGet<UsuarioResumo[]>('/usuarios/lista?papel=PROFESSOR').then((r) => setProfessores(r ?? [])).catch(() => setProfessores([]));
    apiGet<UsuarioResumo[]>('/usuarios/coorientadores').then((r) => setCoorientadores(r ?? [])).catch(() => setCoorientadores([]));
  }, []);

  const descontinuado = tcc.faseAtual === 'DESCONTINUADO';
  // As trilhas do desenvolvimento só mudam com o TCC em DESENVOLVIMENTO (o backend também
  // barra) — fora daí os controles ficam travados e a legenda aponta a Correção de fluxo.
  const emDesenvolvimento = tcc.faseAtual === 'DESENVOLVIMENTO';

  // Coorientador interno e externo são mutuamente exclusivos (o backend também garante):
  // escolher um lado limpa o outro na hora, para o formulário nunca mandar os dois.
  function escolherInterno(id: string) {
    setCoorientadorId(id);
    if (id) {
      setCoorientadorNome('');
      setCoorientadorTitulacao('');
      setCoorientadorAfiliacao('');
      setCoorientadorLattes('');
    }
  }
  function aoDigitarExterno() {
    if (coorientadorId) setCoorientadorId('');
  }

  async function executarSalvar() {
    setSalvando(true);
    try {
      // Fase, NF1/NF2/NF e resultado NÃO são enviados: são derivados do fluxo (a fase muda
      // só pela Correção de fluxo). Este PUT nunca mexe em banca/notas/defesa.
      await apiPut(`/tccs/${tcc.id}`, {
        titulo: titulo.trim(),
        semestre: semestre.trim(),
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
      setMsg('Dados gerais salvos.');
      aoSalvo();
    } catch (e) {
      const er = e as ErroApi;
      setErro(er.erros?.[0]?.mensagem || er.mensagem || 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
      setConfirmandoSemestre(false);
    }
  }

  async function salvar() {
    setErro('');
    setMsg('');
    if (!titulo.trim()) return setErro('Informe o título.');
    if (!semestre.trim()) return setErro('Informe o semestre.');
    if (!alunoId) return setErro('Selecione o aluno.');
    // Trocar o SEMESTRE muda a régua inteira do TCC (prazos e pesos do calendário do novo
    // período) — pede confirmação explícita antes de aplicar.
    if (semestre.trim() !== (tcc.semestre ?? '')) {
      setConfirmandoSemestre(true);
      return;
    }
    await executarSalvar();
  }

  return (
    <>
      {erro && <div className="erro-geral">{erro}</div>}
      {msg && <div className="alerta" style={{ background: 'var(--aprovado-suave)', color: 'var(--aprovado)', marginBottom: 14 }}>{msg}</div>}

      <h3 className="titulo-bloco">Dados gerais</h3>
      <label className="campo"><span>Título</span><input value={titulo} onChange={(e) => setTitulo(e.target.value)} /></label>
      <div className="grade-2">
        <label className="campo">
          <span>Semestre</span>
          <input value={semestre} onChange={(e) => setSemestre(e.target.value)} placeholder="2026.1" />
          <small className="legenda">Só semestres com Calendário configurado no Planejamento. Trocar pede confirmação (muda prazos e pesos).</small>
        </label>
        <label className="campo">
          <span>Fase atual</span>
          <input value={ROTULO_FASE[tcc.faseAtual ?? ''] ?? tcc.faseAtual ?? '—'} disabled />
          <small className="legenda">A fase só muda pela “Correção de fluxo” (na página do TCC), que mostra o impacto antes de aplicar.</small>
        </label>
      </div>

      <h3 className="titulo-bloco" style={{ marginTop: 16 }}>Desenvolvimento / continuidade</h3>
      {!emDesenvolvimento && !descontinuado && (
        <p className="legenda" style={{ marginTop: 4 }}>
          Estas trilhas só mudam com o TCC em desenvolvimento — para reabri-las, use a “Correção de fluxo”.
        </p>
      )}
      <div className="pref-lista">
        <div className="pref-item">
          <div className="pref-texto"><span className="pref-rotulo">Monografia aprovada</span><span className="pref-desc">Trilha da monografia concluída pelo orientador.</span></div>
          <button type="button" role="switch" aria-checked={monografiaAprovada} disabled={!emDesenvolvimento} className={`pref-switch${monografiaAprovada ? ' on' : ''}`} onClick={() => setMonografiaAprovada((v) => !v)}><span className="pref-switch-bolinha" aria-hidden="true" /></button>
        </div>
      </div>
      <label className="campo" style={{ marginTop: 12 }}>
        <span>Continuidade</span>
        <select
          value={descontinuado ? 'descontinuado' : continuidadeConfirmada ? 'confirmada' : 'pendente'}
          disabled={descontinuado || !emDesenvolvimento}
          onChange={(e) => setContinuidadeConfirmada(e.target.value === 'confirmada')}
        >
          <option value="pendente">Não respondido / pendente</option>
          <option value="confirmada">Continuidade confirmada</option>
          {descontinuado && <option value="descontinuado">Descontinuado</option>}
        </select>
        <small className="legenda">
          {descontinuado
            ? 'TCC descontinuado — para retomá-lo (ou mudar a fase), use a “Correção de fluxo”.'
            : 'Para descontinuar o TCC, use a “Correção de fluxo” — nada é apagado e a fase fica registrada para retomada.'}
        </small>
      </label>
      <label className="campo" style={{ marginTop: 12 }}><span>Parecer de continuidade</span><textarea rows={2} value={parecerContinuidade} onChange={(e) => setParecerContinuidade(e.target.value)} placeholder="Motivo (quando descontinuado)…" /></label>

      <h3 className="titulo-bloco" style={{ marginTop: 16 }}>Pessoas / orientação</h3>
      <div className="grade-2">
        <label className="campo">
          <span>Aluno</span>
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
          <select value={coorientadorId} onChange={(e) => escolherInterno(e.target.value)}>
            <option value="">— nenhum / externo —</option>
            {coorientadores.map((c) => <option key={c.id} value={c.id}>{rotuloUsuario(c)}</option>)}
          </select>
        </label>
      </div>

      <h3 className="titulo-bloco" style={{ marginTop: 16 }}>Coorientador externo (se não for interno)</h3>
      {coorientadorId && <p className="legenda" style={{ marginTop: 4 }}>Há um coorientador interno selecionado — preencher um externo remove a seleção interna (são exclusivos).</p>}
      <div className="grade-2">
        <label className="campo"><span>Nome</span><input value={coorientadorNome} onChange={(e) => { aoDigitarExterno(); setCoorientadorNome(e.target.value); }} /></label>
        <label className="campo"><span>Titulação</span><input value={coorientadorTitulacao} onChange={(e) => { aoDigitarExterno(); setCoorientadorTitulacao(e.target.value); }} placeholder="Mestre / Doutor…" /></label>
        <label className="campo"><span>Afiliação</span><input value={coorientadorAfiliacao} onChange={(e) => { aoDigitarExterno(); setCoorientadorAfiliacao(e.target.value); }} /></label>
        <label className="campo"><span>Lattes</span><input value={coorientadorLattes} onChange={(e) => { aoDigitarExterno(); setCoorientadorLattes(e.target.value); }} placeholder="http://lattes.cnpq.br/…" /></label>
      </div>

      <div className="acoes" style={{ justifyContent: 'flex-end' }}>
        <button className="botao" disabled={salvando} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar dados gerais'}</button>
      </div>

      {confirmandoSemestre && (
        <ModalConfirmacao
          titulo="Trocar o semestre do TCC?"
          mensagem={<>O TCC sai de <strong>{tcc.semestre}</strong> para <strong>{semestre.trim()}</strong>. Prazos e pesos passam a ser os do calendário do novo período, e o TCC passa a aparecer nas listagens daquele semestre. O novo semestre precisa ter Calendário configurado.</>}
          textoConfirmar="Trocar semestre"
          textoProcessando="Salvando…"
          processando={salvando}
          erro=""
          aoConfirmar={executarSalvar}
          aoCancelar={() => setConfirmandoSemestre(false)}
        />
      )}
    </>
  );
}
