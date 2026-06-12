// "Meu perfil" (espelha o projeto antigo): dados cadastrais (read-only) + alterar senha.
import { useState, type FormEvent } from 'react';
import { useAuth } from '../autenticacao/contexto';
import { apiPut, type ErroApi } from '../api';
import { ROTULO_PAPEL, ROTULO_CURSO } from '@tcc/compartilhado';

const ic = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {d.split('|').map((p, i) => <path key={i} d={p} />)}
  </svg>
);
const icoUsuario = ic('M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2|M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8');
const icoCadeado = ic('M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z|M7 11V7a5 5 0 0 1 10 0v4');

export function Perfil() {
  const { usuario } = useAuth();
  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmarNovaSenha, setConfirmar] = useState('');
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erroGeral, setErroGeral] = useState('');
  const [sucesso, setSucesso] = useState('');
  const [enviando, setEnviando] = useState(false);

  if (!usuario) return null;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErros({});
    setErroGeral('');
    setSucesso('');

    const m: Record<string, string> = {};
    if (!senhaAtual) m.senhaAtual = 'Informe a senha atual';
    if (novaSenha.length < 6) m.novaSenha = 'A nova senha precisa ter ao menos 6 caracteres';
    if (novaSenha !== confirmarNovaSenha) m.confirmarNovaSenha = 'As senhas não coincidem';
    if (Object.keys(m).length) {
      setErros(m);
      return;
    }

    setEnviando(true);
    try {
      await apiPut('/autenticacao/senha', { senhaAtual, novaSenha, confirmarNovaSenha });
      setSucesso('Senha alterada com sucesso.');
      setSenhaAtual('');
      setNovaSenha('');
      setConfirmar('');
    } catch (ex) {
      const er = ex as ErroApi;
      if (er.erros) {
        const mm: Record<string, string> = {};
        er.erros.forEach((x) => (mm[x.campo] = x.mensagem));
        setErros(mm);
      }
      setErroGeral(er.mensagem || 'Não foi possível alterar a senha.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <h1>Meu Perfil</h1>
      <p className="legenda">Visualize seus dados e altere sua senha.</p>

      <section className="cartao-secao bloco">
        <h2 className="h2-icone"><span className="h2-ico">{icoUsuario}</span>Dados cadastrais</h2>
        <div className="grade-2" style={{ marginTop: 6 }}>
          <label className="campo"><span>Nome completo</span><input value={usuario.nomeCompleto} disabled /></label>
          <label className="campo"><span>E-mail</span><input value={usuario.email} disabled /></label>
          <label className="campo"><span>Tipo de usuário</span><input value={ROTULO_PAPEL[usuario.papel]} disabled /></label>
          {usuario.curso && (
            <label className="campo"><span>Curso</span><input value={ROTULO_CURSO[usuario.curso]} disabled /></label>
          )}
          {usuario.tratamento && (
            <label className="campo"><span>Titulação</span><input value={usuario.tratamento} disabled /></label>
          )}
          {usuario.afiliacao && (
            <label className="campo"><span>Afiliação</span><input value={usuario.afiliacao} disabled /></label>
          )}
        </div>
        <div className="alerta-aviso bloco">
          <strong>Atenção:</strong> para alterar seus dados cadastrais (nome, e-mail, curso, etc.), entre em contato com a coordenação de TCCs do departamento.
        </div>
      </section>

      <section className="cartao-secao bloco">
        <h2 className="h2-icone"><span className="h2-ico">{icoCadeado}</span>Alterar senha</h2>
        <form onSubmit={enviar} style={{ marginTop: 6 }}>
          {erroGeral && <div className="erro-geral">{erroGeral}</div>}
          {sucesso && (
            <div className="erro-geral" style={{ background: 'var(--aprovado-suave)', borderColor: 'rgba(21,128,61,0.25)', color: 'var(--aprovado)' }}>
              {sucesso}
            </div>
          )}
          <label className="campo">
            <span>Senha atual</span>
            <input type="password" value={senhaAtual} onChange={(e) => setSenhaAtual(e.target.value)} placeholder="Digite sua senha atual" />
            {erros.senhaAtual && <small className="erro">{erros.senhaAtual}</small>}
          </label>
          <label className="campo">
            <span>Nova senha</span>
            <input type="password" value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} placeholder="Digite a nova senha" />
            {erros.novaSenha && <small className="erro">{erros.novaSenha}</small>}
          </label>
          <label className="campo">
            <span>Confirmar nova senha</span>
            <input type="password" value={confirmarNovaSenha} onChange={(e) => setConfirmar(e.target.value)} placeholder="Confirme a nova senha" />
            {erros.confirmarNovaSenha && <small className="erro">{erros.confirmarNovaSenha}</small>}
          </label>
          <button className="botao" type="submit" disabled={enviando} style={{ marginTop: 6, alignSelf: 'flex-start' }}>
            {enviando ? 'Alterando…' : 'Alterar senha'}
          </button>
        </form>
      </section>
    </>
  );
}
