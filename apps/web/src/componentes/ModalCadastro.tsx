import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../autenticacao/contexto';
import { Modal } from './Modal';
import {
  ROTULO_PAPEL,
  CURSOS,
  ROTULO_CURSO,
  TRATAMENTOS,
  AFILIACOES,
  esquemaCadastro,
  type PapelCadastro,
  type DadosCadastro,
} from '@tcc/compartilhado';
import type { ErroApi } from '../api';

const CATEGORIAS: { value: PapelCadastro; icone: string; descricao: string }[] = [
  { value: 'ALUNO', icone: '🎓', descricao: 'Estudante de graduação' },
  { value: 'PROFESSOR', icone: '👨‍🏫', descricao: 'Docente orientador' },
  { value: 'AVALIADOR', icone: '🏢', descricao: 'Membro externo de banca' },
];

export function ModalCadastro({ aoFechar }: { aoFechar: () => void }) {
  const { cadastrar } = useAuth();
  const navegar = useNavigate();

  // '' = passo 1 (escolher categoria). Definido = passo 2 (formulário).
  const [papel, setPapel] = useState<PapelCadastro | ''>('');
  const [nomeCompleto, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [confirmarSenha, setConfirmar] = useState('');
  const [codigo, setCodigo] = useState('');
  const [curso, setCurso] = useState('');
  const [tratSel, setTratSel] = useState('');
  const [tratLivre, setTratLivre] = useState('');
  const [afilSel, setAfilSel] = useState('');
  const [afilLivre, setAfilLivre] = useState('');

  const [erros, setErros] = useState<Record<string, string>>({});
  const [erroGeral, setErroGeral] = useState('');
  const [enviando, setEnviando] = useState(false);

  const tratamento = tratSel === 'Outros' ? tratLivre : tratSel;
  const afiliacao = afilSel === 'Outros' ? afilLivre : afilSel;

  function alterarCategoria() {
    setPapel('');
    setErros({});
    setErroGeral('');
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!papel) return;
    setErros({});
    setErroGeral('');

    const dados: Record<string, unknown> = { papel, nomeCompleto, email, senha, codigo };
    if (papel === 'ALUNO') dados.curso = curso || undefined;
    if (papel === 'PROFESSOR' || papel === 'AVALIADOR') dados.tratamento = tratamento || undefined;
    if (papel === 'AVALIADOR') dados.afiliacao = afiliacao || undefined;

    const r = esquemaCadastro.safeParse(dados);
    const m: Record<string, string> = {};
    if (!r.success) for (const i of r.error.issues) m[i.path.join('.')] = i.message;
    if (senha !== confirmarSenha) m.confirmarSenha = 'As senhas não coincidem';
    if (Object.keys(m).length) {
      setErros(m);
      return;
    }
    if (!r.success) return;

    setEnviando(true);
    try {
      await cadastrar(r.data as DadosCadastro);
      navegar('/');
    } catch (ex) {
      const er = ex as ErroApi;
      if (er.erros) {
        const m: Record<string, string> = {};
        er.erros.forEach((x) => (m[x.campo] = x.mensagem));
        setErros(m);
      }
      setErroGeral(er.mensagem || 'Não foi possível cadastrar.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal titulo="Cadastrar nova conta" aoFechar={aoFechar}>
      {/* Passo 1 — escolher a categoria */}
      {!papel ? (
        <>
          <p className="modal-sub">Selecione o tipo de conta que deseja criar:</p>
          <div className="cat-grid">
            {CATEGORIAS.map((c) => (
              <button key={c.value} type="button" className="cat-card" onClick={() => setPapel(c.value)}>
                <span className="cat-icone">{c.icone}</span>
                <span className="cat-label">{ROTULO_PAPEL[c.value]}</span>
                <span className="cat-desc">{c.descricao}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        /* Passo 2 — formulário (ordem dos campos como no original) */
        <>
          <div className="cat-banner">
            <span>
              Cadastro como: <strong>{ROTULO_PAPEL[papel]}</strong>
            </span>
            <button type="button" className="link-inline" onClick={alterarCategoria}>
              Alterar
            </button>
          </div>

          <form onSubmit={enviar}>
            {erroGeral && <div className="erro-geral">{erroGeral}</div>}

            <label className="campo">
              <span>Nome completo</span>
              <input value={nomeCompleto} onChange={(e) => setNome(e.target.value)} />
              {erros.nomeCompleto && <small className="erro">{erros.nomeCompleto}</small>}
            </label>

            <label className="campo">
              <span>E-mail</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              {erros.email && <small className="erro">{erros.email}</small>}
            </label>

            {papel === 'ALUNO' && (
              <label className="campo">
                <span>Curso</span>
                <select value={curso} onChange={(e) => setCurso(e.target.value)}>
                  <option value="">Selecione…</option>
                  {CURSOS.map((c) => (
                    <option key={c} value={c}>
                      {ROTULO_CURSO[c]}
                    </option>
                  ))}
                </select>
                {erros.curso && <small className="erro">{erros.curso}</small>}
              </label>
            )}

            {(papel === 'PROFESSOR' || papel === 'AVALIADOR') && (
              <label className="campo">
                <span>Titulação</span>
                <select value={tratSel} onChange={(e) => setTratSel(e.target.value)}>
                  <option value="">Selecione…</option>
                  {TRATAMENTOS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                {tratSel === 'Outros' && (
                  <input placeholder="Digite a titulação" value={tratLivre} onChange={(e) => setTratLivre(e.target.value)} />
                )}
                {erros.tratamento && <small className="erro">{erros.tratamento}</small>}
              </label>
            )}

            {papel === 'AVALIADOR' && (
              <label className="campo">
                <span>Afiliação (instituição)</span>
                <select value={afilSel} onChange={(e) => setAfilSel(e.target.value)}>
                  <option value="">Selecione…</option>
                  {AFILIACOES.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
                {afilSel === 'Outros' && (
                  <input placeholder="Digite a instituição" value={afilLivre} onChange={(e) => setAfilLivre(e.target.value)} />
                )}
                {erros.afiliacao && <small className="erro">{erros.afiliacao}</small>}
              </label>
            )}

            <label className="campo">
              <span>Código de cadastro</span>
              <input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Fornecido pela coordenação" />
              {erros.codigo && <small className="erro">{erros.codigo}</small>}
            </label>

            <label className="campo">
              <span>Senha</span>
              <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} />
              {erros.senha && <small className="erro">{erros.senha}</small>}
            </label>

            <label className="campo">
              <span>Confirmar senha</span>
              <input type="password" value={confirmarSenha} onChange={(e) => setConfirmar(e.target.value)} />
              {erros.confirmarSenha && <small className="erro">{erros.confirmarSenha}</small>}
            </label>

            <button className="botao" type="submit" disabled={enviando} style={{ width: '100%', marginTop: 6 }}>
              {enviando ? 'Cadastrando…' : 'Cadastrar'}
            </button>
          </form>
        </>
      )}
    </Modal>
  );
}
