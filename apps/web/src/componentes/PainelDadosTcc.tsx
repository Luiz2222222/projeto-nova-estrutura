// Aba "Dados gerais" do modal único de edição do TCC (coordenador). PUT /tccs/:id.
import { useEffect, useState } from 'react';
import { apiGet, apiPut, type ErroApi } from '../api';
import { FASES, ROTULO_FASE } from '@tcc/compartilhado';

const rotuloUsuario = (u: any) =>
  `${u.tratamento ? u.tratamento + ' ' : ''}${u.nomeCompleto}${u.papel === 'AVALIADOR' ? ' (Externo)' : u.papel === 'COORDENADOR' ? ' (Coordenador)' : u.papel === 'PROFESSOR' ? ' (Professor)' : ''}`;

export function PainelDadosTcc({ tcc, aoSalvo }: { tcc: any; aoSalvo: () => void }) {
  const [alunos, setAlunos] = useState<any[]>([]);
  const [professores, setProfessores] = useState<any[]>([]);
  const [coorientadores, setCoorientadores] = useState<any[]>([]);

  const [titulo, setTitulo] = useState(tcc.titulo ?? '');
  const [semestre, setSemestre] = useState(tcc.semestre ?? '');
  const [faseAtual, setFaseAtual] = useState(tcc.faseAtual ?? '');
  // Fase preservada para restaurar ao sair de "Descontinuado". Vem do banco
  // (faseAnteriorDescontinuacao) ou, se o TCC não está descontinuado, é a fase atual.
  const [faseAntes, setFaseAntes] = useState<string>(
    tcc.faseAnteriorDescontinuacao || (tcc.faseAtual && tcc.faseAtual !== 'DESCONTINUADO' ? tcc.faseAtual : 'DESENVOLVIMENTO'),
  );
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

  useEffect(() => {
    apiGet('/usuarios/lista?papel=ALUNO').then((r: any) => setAlunos(r ?? [])).catch(() => setAlunos([]));
    apiGet('/usuarios/lista?papel=PROFESSOR').then((r: any) => setProfessores(r ?? [])).catch(() => setProfessores([]));
    apiGet('/usuarios/coorientadores').then((r: any) => setCoorientadores(r ?? [])).catch(() => setCoorientadores([]));
  }, []);

  // Continuidade em 3 estados (derivada de faseAtual + continuidadeConfirmada). Mudar de
  // estado só ajusta esses dois campos — NÃO apaga notas/documentos/banca/histórico (o backend
  // apenas atualiza os campos do TCC). Voltar o status mantém tudo o que já existia.
  const continuidadeEstado = faseAtual === 'DESCONTINUADO' ? 'descontinuado' : continuidadeConfirmada ? 'confirmada' : 'pendente';
  function mudarContinuidade(v: string) {
    if (v === 'descontinuado') {
      if (faseAtual !== 'DESCONTINUADO') setFaseAntes(faseAtual); // preserva a fase atual
      setContinuidadeConfirmada(false);
      setFaseAtual('DESCONTINUADO');
    } else {
      setContinuidadeConfirmada(v === 'confirmada');
      // Ao sair de "Descontinuado", restaura a FASE ANTERIOR preservada (não sempre
      // DESENVOLVIMENTO). Se o TCC não estava descontinuado, a fase atual é mantida.
      if (faseAtual === 'DESCONTINUADO') setFaseAtual(faseAntes || 'DESENVOLVIMENTO');
    }
  }

  async function salvar() {
    setErro('');
    setMsg('');
    if (!titulo.trim()) return setErro('Informe o título.');
    if (!semestre.trim()) return setErro('Informe o semestre.');
    if (!alunoId) return setErro('Selecione o aluno.');
    setSalvando(true);
    try {
      // NF1/NF2/NF e Resultado são calculados pelo fluxo (validação das fases) — não enviados aqui.
      await apiPut(`/tccs/${tcc.id}`, {
        titulo: titulo.trim(),
        semestre: semestre.trim(),
        faseAtual,
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
    }
  }

  return (
    <>
      {erro && <div className="erro-geral">{erro}</div>}
      {msg && <div className="alerta" style={{ background: 'var(--aprovado-suave)', color: 'var(--aprovado)', marginBottom: 14 }}>{msg}</div>}

      <h3 className="titulo-bloco">Dados gerais</h3>
      <label className="campo"><span>Título</span><input value={titulo} onChange={(e) => setTitulo(e.target.value)} /></label>
      <div className="grade-2">
        <label className="campo"><span>Semestre</span><input value={semestre} onChange={(e) => setSemestre(e.target.value)} placeholder="2026.1" /></label>
        <label className="campo">
          <span>Fase atual</span>
          <select value={faseAtual} onChange={(e) => setFaseAtual(e.target.value)}>
            {FASES.map((f) => <option key={f} value={f}>{ROTULO_FASE[f] ?? f}</option>)}
          </select>
        </label>
      </div>

      <h3 className="titulo-bloco" style={{ marginTop: 16 }}>Desenvolvimento / continuidade</h3>
      <div className="pref-lista">
        <div className="pref-item">
          <div className="pref-texto"><span className="pref-rotulo">Monografia aprovada</span><span className="pref-desc">Trilha da monografia concluída pelo orientador.</span></div>
          <button type="button" role="switch" aria-checked={monografiaAprovada} className={`pref-switch${monografiaAprovada ? ' on' : ''}`} onClick={() => setMonografiaAprovada((v) => !v)}><span className="pref-switch-bolinha" aria-hidden="true" /></button>
        </div>
      </div>
      <label className="campo" style={{ marginTop: 12 }}>
        <span>Continuidade</span>
        <select value={continuidadeEstado} onChange={(e) => mudarContinuidade(e.target.value)}>
          <option value="pendente">Não respondido / pendente</option>
          <option value="confirmada">Continuidade confirmada</option>
          <option value="descontinuado">Descontinuado</option>
        </select>
        <small className="legenda">Pode marcar “Descontinuado” mesmo com o TCC em fase avançada. Isso não apaga notas, documentos, banca ou histórico — os dados ficam salvos e voltam se você mudar o status.</small>
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

      <div className="acoes" style={{ justifyContent: 'flex-end' }}>
        <button className="botao" disabled={salvando} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar dados gerais'}</button>
      </div>
    </>
  );
}
