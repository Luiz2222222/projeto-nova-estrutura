import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost, apiUpload, apiDelete, type ErroApi } from '../../api';
import { useAuth } from '../../autenticacao/contexto';
import { Modal } from '../../componentes/Modal';
import { CampoArquivo } from '../../componentes/CampoArquivo';
import {
  esquemaAbrirTcc,
  ROTULO_CURSO,
  TITULACOES_COORIENTADOR,
  type DadosAbrirTcc,
} from '@tcc/compartilhado';

export function AbrirTcc() {
  const navegar = useNavigate();
  const { usuario } = useAuth();
  const [professores, setProfessores] = useState<any[]>([]);
  const [coorientadores, setCoorientadores] = useState<any[]>([]);
  const [abertura, setAbertura] = useState<{ prazo: string | null; vencido: boolean; liberado: boolean; bloqueado: boolean } | null>(null);
  const [carregandoAbertura, setCarregandoAbertura] = useState(true);

  const [titulo, setTitulo] = useState('');
  const [orientadorId, setOrientadorId] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [temCo, setTemCo] = useState(false);
  const [coCadastrado, setCoCadastrado] = useState(true);
  const [coorientadorId, setCoorientadorId] = useState('');
  const [coNome, setCoNome] = useState('');
  const [coTit, setCoTit] = useState('');
  const [coAfil, setCoAfil] = useState('');
  const [coLattes, setCoLattes] = useState('');
  const [plano, setPlano] = useState<File | null>(null);
  const [termo, setTermo] = useState<File | null>(null);

  const [erros, setErros] = useState<Record<string, string>>({});
  const [erroGeral, setErroGeral] = useState('');
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    apiGet('/usuarios/professores-disponiveis').then(setProfessores).catch(() => {});
    apiGet('/usuarios/coorientadores').then(setCoorientadores).catch(() => {});
    apiGet('/tccs/abertura-prazo').then(setAbertura).catch(() => setAbertura(null)).finally(() => setCarregandoAbertura(false));
  }, []);

  // Estado do prazo de abertura: considera a liberação individual deste aluno+semestre
  // (hoje===prazo ainda vale; liberado permite mesmo vencido). O backend é a fonte real.
  // Enquanto carrega, segura o botão para não "piscar" liberado por um instante.
  const bloqueado = !!abertura?.bloqueado;
  const desabilitarAbrir = bloqueado || carregandoAbertura;

  function montarDados(): Record<string, unknown> {
    const dados: Record<string, unknown> = { titulo, orientadorId, mensagem: mensagem || undefined };
    if (temCo) {
      if (coCadastrado) dados.coorientadorId = coorientadorId || undefined;
      else {
        dados.coorientadorNome = coNome || undefined;
        dados.coorientadorTitulacao = coTit || undefined;
        dados.coorientadorAfiliacao = coAfil || undefined;
        dados.coorientadorLattes = coLattes || undefined;
      }
    }
    return dados;
  }

  // Valida e devolve os dados prontos (ou null se inválido).
  function validar(): DadosAbrirTcc | null {
    const r = esquemaAbrirTcc.safeParse(montarDados());
    const m: Record<string, string> = {};
    if (!r.success) for (const i of r.error.issues) m[i.path.join('.')] = i.message;
    if (temCo && coCadastrado && coorientadorId && coorientadorId === orientadorId)
      m.coorientadorId = 'O coorientador deve ser diferente do orientador.';
    if (!plano) m.plano = 'Anexe o Plano de Desenvolvimento (PDF).';
    if (!termo) m.termo = 'Anexe o Termo de Aceite (PDF).';
    if (plano && plano.size > 10 * 1024 * 1024) m.plano = 'Máximo 10MB.';
    if (termo && termo.size > 10 * 1024 * 1024) m.termo = 'Máximo 10MB.';
    setErros(m);
    return Object.keys(m).length === 0 && r.success ? r.data : null;
  }

  function aoEnviar(e: FormEvent) {
    e.preventDefault();
    setErroGeral('');
    if (desabilitarAbrir) return;
    if (validar()) setConfirmando(true);
  }

  async function confirmar() {
    const dados = validar();
    if (!dados) {
      setConfirmando(false);
      return;
    }
    setEnviando(true);
    setErroGeral('');
    try {
      const tcc: any = await apiPost('/tccs', dados);
      // Os uploads precisam suceder juntos. Se algum falhar, desfaz o TCC recém-criado
      // (ainda em INICIALIZAÇÃO/pendente) pra não deixar um TCC parcial sem documentos.
      try {
        const f1 = new FormData();
        f1.append('tipo', 'PLANO_DESENVOLVIMENTO');
        f1.append('arquivo', plano!);
        const f2 = new FormData();
        f2.append('tipo', 'TERMO_ACEITE');
        f2.append('arquivo', termo!);
        await apiUpload(`/tccs/${tcc.id}/documentos`, f1);
        await apiUpload(`/tccs/${tcc.id}/documentos`, f2);
      } catch (erroUpload) {
        await apiDelete(`/tccs/${tcc.id}`).catch(() => {});
        throw erroUpload;
      }
      navegar('/aluno');
    } catch (ex) {
      const er = ex as ErroApi;
      if (er.erros) {
        const mm: Record<string, string> = {};
        er.erros.forEach((x) => (mm[x.campo] = x.mensagem));
        setErros(mm);
      }
      setErroGeral(er.mensagem || 'Não foi possível abrir o TCC.');
      setConfirmando(false);
      setEnviando(false);
    }
  }

  const nomeComTrat = (p?: any) => (p ? `${p.tratamento ? p.tratamento + ' ' : ''}${p.nomeCompleto}` : '');
  const orientadorSel = professores.find((p) => p.id === orientadorId);
  const coSel = temCo && coCadastrado ? coorientadores.find((c) => c.id === coorientadorId) : null;
  const coNomeResumo = temCo
    ? coCadastrado
      ? coSel?.nomeCompleto
      : coNome
    : null;

  return (
    <>
      <h1>Iniciar meu TCC</h1>
      <p className="legenda">Solicite a orientação e envie os documentos iniciais.</p>

      <section className="cartao-secao bloco">
        <form onSubmit={aoEnviar}>
          {erroGeral && <div className="erro-geral">{erroGeral}</div>}
          {bloqueado && (
            <div className="alerta alerta-erro bloco">
              <strong>Prazo encerrado.</strong> O período de envio de documentos iniciais já terminou. Para
              iniciar o TCC agora, peça uma liberação individual à coordenação.
            </div>
          )}

          {/* Dados do aluno (não editáveis) */}
          {usuario && (
            <>
              <label className="campo">
                <span>Nome completo</span>
                <input value={usuario.nomeCompleto} disabled />
              </label>
              <label className="campo">
                <span>E-mail</span>
                <input value={usuario.email} disabled />
              </label>
              {usuario.curso && (
                <label className="campo">
                  <span>Curso</span>
                  <input value={ROTULO_CURSO[usuario.curso]} disabled />
                </label>
              )}
            </>
          )}

          <label className="campo">
            <span>Orientador</span>
            <select
              value={orientadorId}
              onChange={(e) => {
                const novo = e.target.value;
                setOrientadorId(novo);
                // Evita orientador == coorientador: se a pessoa escolhida já estava como coorientador, limpa.
                if (novo && coorientadorId === novo) setCoorientadorId('');
              }}
            >
              <option value="">Selecione…</option>
              {professores.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.tratamento ? p.tratamento + ' ' : ''}
                  {p.nomeCompleto}
                </option>
              ))}
            </select>
            {erros.orientadorId && <small className="erro">{erros.orientadorId}</small>}
          </label>

          <label className="campo">
            <span>Título do TCC</span>
            <input value={titulo} onChange={(e) => setTitulo(e.target.value)} />
            {erros.titulo && <small className="erro">{erros.titulo}</small>}
          </label>

          <div className="campo">
            <span>Possui coorientador?</span>
            <div className="radios">
              <label>
                <input type="radio" checked={!temCo} onChange={() => setTemCo(false)} /> Não
              </label>
              <label>
                <input type="radio" checked={temCo} onChange={() => setTemCo(true)} /> Sim
              </label>
            </div>
          </div>

          {temCo && (
            <>
              <div className="campo">
                <span>O coorientador é cadastrado no sistema?</span>
                <div className="radios">
                  <label>
                    <input type="radio" checked={coCadastrado} onChange={() => setCoCadastrado(true)} /> Sim
                  </label>
                  <label>
                    <input type="radio" checked={!coCadastrado} onChange={() => setCoCadastrado(false)} /> Não (externo)
                  </label>
                </div>
              </div>

              {coCadastrado ? (
                <label className="campo">
                  <span>Coorientador</span>
                  <select value={coorientadorId} onChange={(e) => setCoorientadorId(e.target.value)}>
                    <option value="">Selecione…</option>
                    {coorientadores
                      .filter((c) => c.id !== orientadorId)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nomeCompleto}
                        </option>
                      ))}
                  </select>
                  {erros.coorientadorId && <small className="erro">{erros.coorientadorId}</small>}
                </label>
              ) : (
                <>
                  <label className="campo">
                    <span>Nome do coorientador</span>
                    <input value={coNome} onChange={(e) => setCoNome(e.target.value)} />
                    {erros.coorientadorNome && <small className="erro">{erros.coorientadorNome}</small>}
                  </label>
                  <label className="campo">
                    <span>Titulação</span>
                    <select value={coTit} onChange={(e) => setCoTit(e.target.value)}>
                      <option value="">Selecione…</option>
                      {TITULACOES_COORIENTADOR.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    {erros.coorientadorTitulacao && <small className="erro">{erros.coorientadorTitulacao}</small>}
                  </label>
                  <label className="campo">
                    <span>Afiliação</span>
                    <input value={coAfil} onChange={(e) => setCoAfil(e.target.value)} placeholder="Ex.: UFPE, IFPE…" />
                    {erros.coorientadorAfiliacao && <small className="erro">{erros.coorientadorAfiliacao}</small>}
                  </label>
                  <label className="campo">
                    <span>Link do Lattes</span>
                    <input value={coLattes} onChange={(e) => setCoLattes(e.target.value)} placeholder="lattes.cnpq.br/…" />
                    {erros.coorientadorLattes && <small className="erro">{erros.coorientadorLattes}</small>}
                  </label>
                </>
              )}
            </>
          )}

          <label className="campo">
            <span>Mensagem ao coordenador (opcional)</span>
            <textarea rows={3} value={mensagem} onChange={(e) => setMensagem(e.target.value)} />
          </label>

          <div className="campo">
            <span>Documentos</span>
            <div className="arquivos">
              <CampoArquivo
                rotulo="Plano de Desenvolvimento"
                arquivo={plano}
                aoMudar={setPlano}
                erro={erros.plano}
                aceita=".pdf"
                dica="PDF, até 10MB"
              />
              <CampoArquivo
                rotulo="Termo de Aceite"
                arquivo={termo}
                aoMudar={setTermo}
                erro={erros.termo}
                aceita=".pdf"
                dica="PDF, até 10MB"
              />
            </div>
          </div>

          <div className="acoes">
            <button type="button" className="botao botao-secundario" onClick={() => navegar('/aluno')}>
              Cancelar
            </button>
            <button type="submit" className="botao" disabled={desabilitarAbrir}>
              Enviar
            </button>
          </div>
        </form>
      </section>

      {confirmando && (
        <Modal
          titulo="Confirmar solicitação"
          subtitulo="Confira os dados antes de enviar."
          aoFechar={() => !enviando && setConfirmando(false)}
        >
          <div className="resumo-confirmacao">
            <div className="resumo-linha">
              <span className="resumo-rot">Título</span>
              <span className="resumo-val">{titulo || '—'}</span>
            </div>
            <div className="resumo-linha">
              <span className="resumo-rot">Orientador</span>
              <span className="resumo-val">{nomeComTrat(orientadorSel) || '—'}{orientadorSel?.afiliacao ? ` (${orientadorSel.afiliacao})` : ''}</span>
            </div>
            {temCo && coNomeResumo && (
              <div className="resumo-linha">
                <span className="resumo-rot">Co-orientador</span>
                <span className="resumo-val">{(coCadastrado ? nomeComTrat(coSel) : `${coTit ? coTit + ' ' : ''}${coNome}`)}{(coCadastrado ? coSel?.afiliacao : coAfil) ? ` (${coCadastrado ? coSel?.afiliacao : coAfil})` : ''}</span>
                {!coCadastrado && coLattes && (
                  <span className="resumo-sub"><a href={coLattes} target="_blank" rel="noreferrer">{coLattes}</a></span>
                )}
              </div>
            )}
            <div className="resumo-linha">
              <span className="resumo-rot">Plano de desenvolvimento</span>
              <span className="resumo-val">{plano?.name ?? '—'}</span>
            </div>
            <div className="resumo-linha">
              <span className="resumo-rot">Termo de aceite de orientação</span>
              <span className="resumo-val">{termo?.name ?? '—'}</span>
            </div>
          </div>
          <div className="acoes">
            <button className="botao botao-secundario" disabled={enviando} onClick={() => setConfirmando(false)}>
              Voltar
            </button>
            <button className="botao" disabled={enviando} onClick={confirmar}>
              {enviando ? 'Enviando…' : 'Confirmar'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
