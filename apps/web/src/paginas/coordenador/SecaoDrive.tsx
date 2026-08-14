import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost, mensagemErro } from '../../api';

interface StatusDrive {
  conectado: boolean;
  configurado: boolean;
  contaEmail: string | null;
  pastaRaizNome: string | null;
  conectadoEm: string | null;
  ultimoSyncEm: string | null;
  ultimoErro: string | null;
  pendentes: number;
  comErro: number;
}

interface Previa {
  semestre: string;
  conectadoAoDrive: boolean;
  tccs: number;
  pendenciasSincronizacao: number;
  podeEncerrar: boolean;
  contasParaApagar: { nome: string; email: string; papel: string }[];
  contasPreservadas: { nome: string; papel: string; motivo: string }[];
}

const quando = (v: string | null) => {
  if (!v) return 'nunca';
  const d = new Date(v);
  return `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
};

// Arquivamento no Google Drive + encerramento de período. Configuração GLOBAL: todos os
// coordenadores veem a mesma conta conectada.
export function SecaoDrive() {
  const [status, setStatus] = useState<StatusDrive | null>(null);
  const [erro, setErro] = useState('');
  const [msg, setMsg] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const [previa, setPrevia] = useState<Previa | null>(null);
  const [mostrarEncerrar, setMostrarEncerrar] = useState(false);
  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [encerrando, setEncerrando] = useState(false);
  const [relatorio, setRelatorio] = useState<any | null>(null);

  const carregar = useCallback(() => {
    apiGet<StatusDrive>('/drive/status').then(setStatus).catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    carregar();
    // O callback do OAuth volta para cá com ?drive=conectado|erro.
    const p = new URLSearchParams(window.location.search).get('drive');
    if (p === 'conectado') setMsg('Google Drive conectado.');
    if (p === 'erro') setErro('Não foi possível concluir a conexão com o Google Drive. Tente novamente.');
  }, [carregar]);

  async function conectar() {
    setErro('');
    setOcupado(true);
    try {
      const { url } = await apiPost<{ url: string }>('/drive/autorizar', {});
      window.location.href = url; // vai para a tela de consentimento do Google
    } catch (e) {
      setErro(mensagemErro(e, 'Não foi possível iniciar a conexão.'));
      setOcupado(false);
    }
  }

  async function acao(rota: string, sucesso: string) {
    setErro('');
    setMsg('');
    setOcupado(true);
    try {
      await apiPost(rota, {});
      setMsg(sucesso);
      carregar();
    } catch (e) {
      setErro(mensagemErro(e, 'Não foi possível concluir a ação.'));
    } finally {
      setOcupado(false);
    }
  }

  async function abrirEncerramento() {
    setErro('');
    setRelatorio(null);
    try {
      setPrevia(await apiGet<Previa>('/periodo/encerrar/previa'));
      setMostrarEncerrar(true);
    } catch (e) {
      setErro(mensagemErro(e, 'Não foi possível calcular o impacto do encerramento.'));
    }
  }

  async function encerrar() {
    setErro('');
    setEncerrando(true);
    try {
      const r = await apiPost('/periodo/encerrar', { senha, confirmacao });
      setRelatorio(r);
      setMostrarEncerrar(false);
      setSenha('');
      setConfirmacao('');
      carregar();
    } catch (e) {
      setErro(mensagemErro(e, 'Não foi possível encerrar o período.'));
    } finally {
      setEncerrando(false);
    }
  }

  return (
    <section className="cartao-secao bloco">
      <h2>Arquivamento no Google Drive</h2>
      <p className="legenda" style={{ marginBottom: 14 }}>
        Configuração global compartilhada entre os coordenadores. Cada TCC aprovado ganha uma pasta no
        Drive da conta institucional com os documentos e um retrato dos dados.
      </p>

      {msg && (
        <div className="erro-geral" style={{ background: 'var(--aprovado-suave)', borderColor: 'rgba(21,128,61,0.25)', color: 'var(--aprovado)' }}>
          {msg}
        </div>
      )}
      {erro && <div className="erro-geral">{erro}</div>}

      {!status ? (
        <p className="nota-vazio">Carregando…</p>
      ) : !status.configurado ? (
        // Integração indisponível NÃO esconde o encerramento: ele é garantido pelo arquivo
        // local e precisa funcionar sem Drive nenhum.
        <div className="alerta-aviso bloco">
          <strong>Integração não configurada no servidor.</strong> Defina <code>GOOGLE_CLIENT_ID</code>,{' '}
          <code>GOOGLE_CLIENT_SECRET</code> e <code>DRIVE_CRYPTO_SEGREDO</code> no <code>.env</code> da API. O
          encerramento de período abaixo continua funcionando: ele arquiva tudo na própria VPS.
        </div>
      ) : (
        <>
          <div className="grade-2">
            <label className="campo">
              <span>Situação</span>
              <input value={status.conectado ? 'Conectado' : 'Não conectado'} disabled />
            </label>
            <label className="campo">
              <span>Conta autorizada</span>
              <input value={status.contaEmail ?? '—'} disabled />
            </label>
            <label className="campo">
              <span>Pasta raiz</span>
              <input value={status.pastaRaizNome ?? '—'} disabled />
            </label>
            <label className="campo">
              <span>Última sincronização</span>
              <input value={quando(status.ultimoSyncEm)} disabled />
            </label>
          </div>

          <p className="legenda" style={{ marginTop: 6 }}>
            Pendências: <strong>{status.pendentes}</strong> na fila · <strong>{status.comErro}</strong> com erro
            {status.ultimoErro ? ` · último erro: ${status.ultimoErro}` : ''}
          </p>

          <div className="acoes" style={{ justifyContent: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
            {!status.conectado ? (
              <button className="botao" disabled={ocupado} onClick={conectar}>
                Conectar conta do Google
              </button>
            ) : (
              <>
                <button className="botao" disabled={ocupado} onClick={() => acao('/drive/sincronizar', 'Sincronização disparada.')}>
                  Tentar novamente
                </button>
                <button className="botao-secundario" disabled={ocupado} onClick={() => acao('/drive/desconectar', 'Drive desconectado.')}>
                  Desconectar
                </button>
              </>
            )}
          </div>
        </>
      )}

      {/* Encerramento SEMPRE visível: não depende de o Drive estar configurado nem conectado. */}
      {status && (
        <>
          <div className="config-grupo" style={{ marginTop: 18 }}>
            <h3>Encerrar e arquivar período</h3>
            <p className="legenda" style={{ marginBottom: 8 }}>
              Arquiva os TCCs do período no arquivo permanente da VPS (dados, notas, pareceres e documentos)
              e no histórico do sistema. Só depois de a cópia ser validada é que os TCCs saem do fluxo ativo
              e as contas de alunos e avaliadores externos são apagadas. Professores e coordenadores nunca
              são apagados.
            </p>

            {relatorio && (
              <div className="alerta-aviso bloco">
                <strong>Período {relatorio.semestre} arquivado localmente.</strong> {relatorio.tccsArquivados} TCC(s)
                guardado(s) no arquivo permanente da VPS (dados e documentos), {relatorio.tccsApagados} removido(s) do
                fluxo ativo, {relatorio.arquivosLocaisRemovidos} arquivo(s) de trabalho liberado(s),{' '}
                {relatorio.contasApagadas.length} conta(s) apagada(s).
                <div style={{ marginTop: 6 }}>
                  {relatorio.driveConectado
                    ? `Cópia adicional enviada ao Google Drive para ${relatorio.copiadoParaDrive} TCC(s).`
                    : 'Sem cópia no Google Drive (a integração não estava conectada). O arquivo permanente da VPS está completo e é a fonte do Histórico.'}
                </div>
                {relatorio.contasPreservadas?.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    Preservadas: {relatorio.contasPreservadas.map((c: any) => `${c.nome} (${c.motivo})`).join('; ')}
                  </div>
                )}
              </div>
            )}

            {!mostrarEncerrar ? (
              <button className="botao-secundario" onClick={abrirEncerramento}>
                Ver impacto do encerramento
              </button>
            ) : (
              previa && (
                <>
                  <div className="alerta-aviso bloco">
                    <strong>Período {previa.semestre}:</strong> {previa.tccs} TCC(s).
                    <div>Contas que serão apagadas: {previa.contasParaApagar.length}</div>
                    <div>Contas preservadas: {previa.contasPreservadas.length}</div>
                    <div style={{ marginTop: 6 }}>
                      Os dados e documentos vão para o arquivo permanente da VPS antes de qualquer exclusão. Se a cópia
                      não puder ser validada, nada é apagado.
                    </div>
                    {!previa.conectadoAoDrive && (
                      <div style={{ marginTop: 6 }}>
                        Google Drive não conectado: o período será arquivado <strong>somente</strong> na VPS. Isso não
                        impede o encerramento — mas depois dele não há como enviar estes TCCs ao Drive.
                      </div>
                    )}
                    {previa.conectadoAoDrive && previa.pendenciasSincronizacao > 0 && (
                      <div style={{ marginTop: 6 }}>
                        {previa.pendenciasSincronizacao} item(ns) ainda sincronizando com o Drive — a cópia adicional
                        pode ficar incompleta.
                      </div>
                    )}
                    {!previa.podeEncerrar && (
                      <div style={{ marginTop: 6 }}>
                        <strong>Não há TCC neste período para encerrar.</strong>
                      </div>
                    )}
                  </div>

                  {previa.contasParaApagar.length > 0 && (
                    <p className="legenda">
                      Serão apagadas: {previa.contasParaApagar.map((c) => `${c.nome} (${c.papel})`).join(', ')}
                    </p>
                  )}

                  <div className="grade-2">
                    <label className="campo">
                      <span>Sua senha</span>
                      <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="Confirme sua senha" />
                    </label>
                    <label className="campo">
                      <span>Digite ENCERRAR para confirmar</span>
                      <input value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} placeholder="ENCERRAR" />
                    </label>
                  </div>

                  <div className="acoes" style={{ justifyContent: 'flex-start', gap: 8 }}>
                    <button
                      className="botao-perigo"
                      disabled={encerrando || !previa.podeEncerrar || confirmacao !== 'ENCERRAR' || !senha}
                      onClick={encerrar}
                    >
                      {encerrando ? 'Encerrando…' : 'Encerrar e arquivar período'}
                    </button>
                    <button className="botao-secundario" disabled={encerrando} onClick={() => setMostrarEncerrar(false)}>
                      Cancelar
                    </button>
                  </div>
                </>
              )
            )}
          </div>
        </>
      )}
    </section>
  );
}
