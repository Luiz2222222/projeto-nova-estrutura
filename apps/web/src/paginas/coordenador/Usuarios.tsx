import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPut, apiDelete, type ErroApi } from '../../api';
import { Modal } from '../../componentes/Modal';
import { ROTULO_CURSO, CURSOS, TRATAMENTOS, AFILIACOES } from '@tcc/compartilhado';
import type { UsuarioResumo } from '../../tipos';

const ABAS = [
  { id: 'PROFESSOR', rotulo: 'Professores' },
  { id: 'ALUNO', rotulo: 'Alunos' },
  { id: 'AVALIADOR', rotulo: 'Externos' },
] as const;
type Papel = (typeof ABAS)[number]['id'];

const cursoDe = (u: UsuarioResumo) => (ROTULO_CURSO as Record<string, string>)[u.curso ?? ''] ?? u.curso ?? '—';

// "Outros" igual ao cadastro (ModalCadastro): valor fora da lista vira "Outros" + campo livre.
const naLista = (v: string | null | undefined, lista: readonly string[]) => !!v && lista.includes(v);
const selDe = (v: string | null | undefined, lista: readonly string[]) => (v ? (naLista(v, lista) ? v : 'Outros') : '');
const livreDe = (v: string | null | undefined, lista: readonly string[]) => (v && !naLista(v, lista) ? v : '');

const ic = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {d.split('|').map((p, i) => <path key={i} d={p} />)}
  </svg>
);
const icoLapis = ic('M12 20h9|M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z');
const icoCadeado = ic('M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z|M7 11V7a5 5 0 0 1 10 0v4');
const icoLixeira = ic('M3 6h18|M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2');

export function Usuarios() {
  const [aba, setAba] = useState<Papel>('PROFESSOR');
  const [usuarios, setUsuarios] = useState<UsuarioResumo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState('');

  // edição
  const [editando, setEditando] = useState<UsuarioResumo | null>(null);
  const [form, setForm] = useState<{ nomeCompleto?: string; email?: string | null; tratSel?: string; tratLivre?: string; afilSel?: string; afilLivre?: string; curso?: string; disponivelParaOrientar?: boolean }>({});
  const [erroEdit, setErroEdit] = useState('');
  const [salvando, setSalvando] = useState(false);

  // reset de senha
  const [resetando, setResetando] = useState<UsuarioResumo | null>(null);
  const [senha, setSenha] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [erroReset, setErroReset] = useState('');

  // exclusão
  const [excluindo, setExcluindo] = useState<UsuarioResumo | null>(null);
  const [erroExcluir, setErroExcluir] = useState('');

  function carregar() {
    setCarregando(true);
    apiGet<UsuarioResumo[]>(`/usuarios/lista?papel=${aba}`)
      .then((r) => setUsuarios(r ?? []))
      .catch(() => setUsuarios([]))
      .finally(() => setCarregando(false));
  }
  useEffect(carregar, [aba]);

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return usuarios;
    return usuarios.filter((u) => u.nomeCompleto.toLowerCase().includes(t) || (u.email ?? '').toLowerCase().includes(t));
  }, [usuarios, busca]);

  function abrirEdicao(u: UsuarioResumo) {
    setEditando(u);
    setForm({
      nomeCompleto: u.nomeCompleto,
      email: u.email,
      // "Outros" igual ao cadastro: se o valor salvo não está na lista, é customizado.
      tratSel: selDe(u.tratamento, TRATAMENTOS),
      tratLivre: livreDe(u.tratamento, TRATAMENTOS),
      afilSel: selDe(u.afiliacao, AFILIACOES),
      afilLivre: livreDe(u.afiliacao, AFILIACOES),
      curso: u.curso ?? '',
      disponivelParaOrientar: u.disponivelParaOrientar,
    });
    setErroEdit('');
  }
  async function salvarEdicao() {
    if (!editando) return;
    setErroEdit('');
    if (!form.nomeCompleto?.trim()) return setErroEdit('Informe o nome.');
    if (!form.email?.trim()) return setErroEdit('Informe o e-mail.');
    setSalvando(true);
    try {
      // Se "Outros" estiver selecionado, envia o texto livre digitado (igual ao cadastro).
      const tratamento = (form.tratSel === 'Outros' ? form.tratLivre ?? '' : form.tratSel || '').trim();
      const afiliacao = (form.afilSel === 'Outros' ? form.afilLivre ?? '' : form.afilSel || '').trim();
      const corpo: Record<string, unknown> = { nomeCompleto: form.nomeCompleto, email: form.email };
      if (aba === 'ALUNO') corpo.curso = form.curso || undefined;
      if (aba === 'PROFESSOR') { corpo.tratamento = tratamento || undefined; corpo.disponivelParaOrientar = form.disponivelParaOrientar; }
      if (aba === 'AVALIADOR') { corpo.tratamento = tratamento || undefined; corpo.afiliacao = afiliacao || undefined; }
      await apiPut(`/usuarios/${editando.id}`, corpo);
      setEditando(null);
      carregar();
    } catch (e) {
      setErroEdit((e as ErroApi).mensagem || 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  }

  function abrirReset(u: UsuarioResumo) {
    setResetando(u);
    setSenha('');
    setConfirmar('');
    setErroReset('');
  }
  async function salvarReset() {
    if (!resetando) return;
    setErroReset('');
    if (senha.length < 6) return setErroReset('A senha precisa ter ao menos 6 caracteres.');
    if (senha !== confirmar) return setErroReset('As senhas não coincidem.');
    setSalvando(true);
    try {
      await apiPut(`/usuarios/${resetando.id}/senha`, { senha });
      setResetando(null);
    } catch (e) {
      setErroReset((e as ErroApi).mensagem || 'Não foi possível resetar.');
    } finally {
      setSalvando(false);
    }
  }

  async function confirmarExcluir() {
    if (!excluindo) return;
    setErroExcluir('');
    setSalvando(true);
    try {
      await apiDelete(`/usuarios/${excluindo.id}`);
      setExcluindo(null);
      carregar();
    } catch (e) {
      setErroExcluir((e as ErroApi).mensagem || 'Não foi possível excluir.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <h1>Usuários</h1>
      <p className="legenda">Professores, alunos e membros externos cadastrados no sistema.</p>

      <div className="rel-abas bloco">
        {ABAS.map((a) => (
          <button key={a.id} className={`rel-aba${aba === a.id ? ' ativa' : ''}`} onClick={() => { setAba(a.id); setBusca(''); }}>
            {a.rotulo}
          </button>
        ))}
      </div>

      <section className="cartao-secao bloco">
        <label className="campo" style={{ marginBottom: 16 }}>
          <span>Pesquisar</span>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome ou e-mail…" />
        </label>

        {carregando ? (
          <p className="nota-vazio">Carregando…</p>
        ) : !filtrados.length ? (
          <p className="nota-vazio">Nenhum usuário encontrado.</p>
        ) : (
          <div className="tabela-rolavel">
            <table className="tabela tabela-relatorio">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>E-mail</th>
                  {aba === 'PROFESSOR' && <><th>Orientandos</th><th>Bancas</th><th>Disponível</th></>}
                  {aba === 'ALUNO' && <th>Curso</th>}
                  {aba === 'AVALIADOR' && <><th>Titulação</th><th>Afiliação</th></>}
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((u) => (
                  <tr key={u.id}>
                    <td title={u.nomeCompleto}>{u.tratamento ? `${u.tratamento} ` : ''}{u.nomeCompleto}</td>
                    <td title={u.email ?? ''}>{u.email}</td>
                    {aba === 'PROFESSOR' && (
                      <>
                        <td>{(u._count?.tccsComoOrientador ?? 0) + (u._count?.tccsComoCoorientador ?? 0)}</td>
                        <td>{u._count?.bancasComoAvaliador ?? 0}</td>
                        <td>
                          <span className={`pilula ${u.disponivelParaOrientar ? 'pilula-ok' : 'pilula-neutra'}`}>
                            {u.disponivelParaOrientar ? 'Sim' : 'Não'}
                          </span>
                        </td>
                      </>
                    )}
                    {aba === 'ALUNO' && <td>{cursoDe(u)}</td>}
                    {aba === 'AVALIADOR' && <><td>{u.tratamento ?? '—'}</td><td>{u.afiliacao ?? '—'}</td></>}
                    <td>
                      <span className="acoes-doc">
                        <button className="botao-icone" title="Editar" onClick={() => abrirEdicao(u)}>{icoLapis}</button>
                        <button className="botao-icone" title="Resetar senha" onClick={() => abrirReset(u)}>{icoCadeado}</button>
                        <button className="botao-icone" title="Excluir" onClick={() => { setExcluindo(u); setErroExcluir(''); }}>{icoLixeira}</button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editando && (
        <Modal titulo="Editar usuário" subtitulo={editando.nomeCompleto} aoFechar={() => !salvando && setEditando(null)}>
          {erroEdit && <div className="erro-geral">{erroEdit}</div>}
          <label className="campo"><span>Nome completo</span><input value={form.nomeCompleto} onChange={(e) => setForm({ ...form, nomeCompleto: e.target.value })} /></label>
          <label className="campo"><span>E-mail</span><input type="email" value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          {aba === 'ALUNO' && (
            <label className="campo"><span>Curso</span>
              <select value={form.curso} onChange={(e) => setForm({ ...form, curso: e.target.value })}>
                <option value="">Selecione…</option>
                {CURSOS.map((c) => <option key={c} value={c}>{ROTULO_CURSO[c]}</option>)}
              </select>
            </label>
          )}
          {(aba === 'PROFESSOR' || aba === 'AVALIADOR') && (
            <label className="campo"><span>Titulação</span>
              <select value={form.tratSel} onChange={(e) => setForm({ ...form, tratSel: e.target.value })}>
                <option value="">Selecione…</option>
                {TRATAMENTOS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              {form.tratSel === 'Outros' && (
                <input placeholder="Digite a titulação" value={form.tratLivre} onChange={(e) => setForm({ ...form, tratLivre: e.target.value })} />
              )}
            </label>
          )}
          {aba === 'AVALIADOR' && (
            <label className="campo"><span>Afiliação</span>
              <select value={form.afilSel} onChange={(e) => setForm({ ...form, afilSel: e.target.value })}>
                <option value="">Selecione…</option>
                {AFILIACOES.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              {form.afilSel === 'Outros' && (
                <input placeholder="Digite a instituição" value={form.afilLivre} onChange={(e) => setForm({ ...form, afilLivre: e.target.value })} />
              )}
            </label>
          )}
          {aba === 'PROFESSOR' && (
            <div className="campo-switch">
              <button
                type="button"
                role="switch"
                aria-checked={!!form.disponivelParaOrientar}
                aria-label="Disponível para orientar"
                className={`pref-switch${form.disponivelParaOrientar ? ' on' : ''}`}
                onClick={() => setForm({ ...form, disponivelParaOrientar: !form.disponivelParaOrientar })}
              >
                <span className="pref-switch-bolinha" aria-hidden="true" />
              </button>
              <span className="campo-switch-label">Disponível para orientar</span>
            </div>
          )}
          <div className="acoes">
            <button className="botao botao-secundario" disabled={salvando} onClick={() => setEditando(null)}>Cancelar</button>
            <button className="botao" disabled={salvando} onClick={salvarEdicao}>{salvando ? 'Salvando…' : 'Salvar'}</button>
          </div>
        </Modal>
      )}

      {resetando && (
        <Modal titulo="Resetar senha" subtitulo={resetando.nomeCompleto} aoFechar={() => !salvando && setResetando(null)}>
          {erroReset && <div className="erro-geral">{erroReset}</div>}
          <label className="campo"><span>Nova senha</span><input type="password" autoFocus value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="Mínimo 6 caracteres" /></label>
          <label className="campo"><span>Confirmar senha</span><input type="password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} /></label>
          <div className="acoes">
            <button className="botao botao-secundario" disabled={salvando} onClick={() => setResetando(null)}>Cancelar</button>
            <button className="botao" disabled={salvando} onClick={salvarReset}>{salvando ? 'Salvando…' : 'Resetar senha'}</button>
          </div>
        </Modal>
      )}

      {excluindo && (
        <Modal titulo="Excluir usuário" subtitulo={excluindo.nomeCompleto} aoFechar={() => !salvando && setExcluindo(null)}>
          {erroExcluir && <div className="erro-geral">{erroExcluir}</div>}
          <p className="nota-vazio" style={{ marginTop: 0 }}>
            Tem certeza que deseja excluir <strong>{excluindo.nomeCompleto}</strong>? Esta ação não pode ser desfeita.
          </p>
          <div className="acoes">
            <button className="botao botao-secundario" disabled={salvando} onClick={() => setExcluindo(null)}>Cancelar</button>
            <button className="botao botao-perigo" disabled={salvando} onClick={confirmarExcluir}>{salvando ? 'Excluindo…' : 'Excluir'}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
