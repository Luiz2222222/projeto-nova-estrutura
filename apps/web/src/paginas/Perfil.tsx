// "Meu perfil" (espelha o projeto antigo): dados cadastrais (read-only) + alterar senha.
// Para o COORDENADOR aparece também o card de criar outro coordenador (fora do cadastro público).
import { useState, type FormEvent } from 'react';
import { useAuth } from '../autenticacao/contexto';
import { apiPost, apiPut, type ErroApi } from '../api';
import { ROTULO_PAPEL, ROTULO_CURSO } from '@tcc/compartilhado';

const ic = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {d.split('|').map((p, i) => <path key={i} d={p} />)}
  </svg>
);
const icoUsuario = ic('M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2|M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8');
const icoCadeado = ic('M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z|M7 11V7a5 5 0 0 1 10 0v4');
const icoNovoUsuario = ic('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2|M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8|M19 8v6|M22 11h-6');

export function Perfil() {
  const { usuario } = useAuth();
  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmarNovaSenha, setConfirmar] = useState('');
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erroGeral, setErroGeral] = useState('');
  const [sucesso, setSucesso] = useState('');
  const [enviando, setEnviando] = useState(false);

  // Card "Criar coordenador" (só para COORDENADOR): estado próprio para as mensagens não
  // se misturarem com as do card de troca de senha.
  const [coordNome, setCoordNome] = useState('');
  const [coordEmail, setCoordEmail] = useState('');
  const [coordSenha, setCoordSenha] = useState('');
  const [coordConfirmar, setCoordConfirmar] = useState('');
  const [errosCoord, setErrosCoord] = useState<Record<string, string>>({});
  const [erroGeralCoord, setErroGeralCoord] = useState('');
  const [sucessoCoord, setSucessoCoord] = useState('');
  const [criandoCoord, setCriandoCoord] = useState(false);

  if (!usuario) return null;

  const ehCoordenador = usuario.papel === 'COORDENADOR';

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

  async function criarCoordenador(e: FormEvent) {
    e.preventDefault();
    setErrosCoord({});
    setErroGeralCoord('');
    setSucessoCoord('');

    const m: Record<string, string> = {};
    if (coordNome.trim().split(/\s+/).filter(Boolean).length < 2) m.nomeCompleto = 'Informe o nome completo';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(coordEmail.trim())) m.email = 'E-mail inválido';
    if (coordSenha.length < 6) m.senha = 'A senha precisa ter ao menos 6 caracteres';
    if (coordSenha !== coordConfirmar) m.confirmarSenha = 'As senhas não coincidem';
    if (Object.keys(m).length) {
      setErrosCoord(m);
      return;
    }

    setCriandoCoord(true);
    try {
      // Só cria a conta — NÃO troca a sessão atual pela do coordenador criado.
      await apiPost('/autenticacao/coordenadores', {
        nomeCompleto: coordNome.trim(),
        email: coordEmail.trim(),
        senha: coordSenha,
      });
      setSucessoCoord(`Coordenador "${coordNome.trim()}" criado com sucesso.`);
      setCoordNome('');
      setCoordEmail('');
      setCoordSenha('');
      setCoordConfirmar('');
    } catch (ex) {
      const er = ex as ErroApi;
      if (er.erros) {
        const mm: Record<string, string> = {};
        er.erros.forEach((x) => (mm[x.campo] = x.mensagem));
        setErrosCoord(mm);
      }
      setErroGeralCoord(er.mensagem || 'Não foi possível criar o coordenador.');
    } finally {
      // Limpa as senhas mesmo em caso de erro: nada de senha parada na tela.
      setCoordSenha('');
      setCoordConfirmar('');
      setCriandoCoord(false);
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

      {ehCoordenador && (
        <section className="cartao-secao bloco">
          <h2 className="h2-icone"><span className="h2-ico">{icoNovoUsuario}</span>Criar coordenador</h2>
          <p className="legenda">
            Cria uma nova conta de coordenação. O coordenador não usa código de cadastro e não pode se cadastrar pela tela pública.
          </p>
          <form onSubmit={criarCoordenador} style={{ marginTop: 6 }}>
            {erroGeralCoord && <div className="erro-geral">{erroGeralCoord}</div>}
            {sucessoCoord && (
              <div className="erro-geral" style={{ background: 'var(--aprovado-suave)', borderColor: 'rgba(21,128,61,0.25)', color: 'var(--aprovado)' }}>
                {sucessoCoord}
              </div>
            )}
            <label className="campo">
              <span>Nome completo</span>
              <input value={coordNome} onChange={(e) => setCoordNome(e.target.value)} placeholder="Nome completo do coordenador" />
              {errosCoord.nomeCompleto && <small className="erro">{errosCoord.nomeCompleto}</small>}
            </label>
            <label className="campo">
              <span>E-mail</span>
              <input type="email" value={coordEmail} onChange={(e) => setCoordEmail(e.target.value)} placeholder="email@exemplo.com" />
              {errosCoord.email && <small className="erro">{errosCoord.email}</small>}
            </label>
            <label className="campo">
              <span>Senha</span>
              <input type="password" value={coordSenha} onChange={(e) => setCoordSenha(e.target.value)} placeholder="Defina a senha de acesso" />
              {errosCoord.senha && <small className="erro">{errosCoord.senha}</small>}
            </label>
            <label className="campo">
              <span>Confirmar senha</span>
              <input type="password" value={coordConfirmar} onChange={(e) => setCoordConfirmar(e.target.value)} placeholder="Repita a senha" />
              {errosCoord.confirmarSenha && <small className="erro">{errosCoord.confirmarSenha}</small>}
            </label>
            <button className="botao" type="submit" disabled={criandoCoord} style={{ marginTop: 6, alignSelf: 'flex-start' }}>
              {criandoCoord ? 'Criando…' : 'Criar coordenador'}
            </button>
          </form>
        </section>
      )}
    </>
  );
}
