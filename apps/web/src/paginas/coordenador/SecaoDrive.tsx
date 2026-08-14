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

const quando = (v: string | null) => {
  if (!v) return 'nunca';
  const d = new Date(v);
  return `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
};

// Integração com o Google Drive: situação, conta autorizada, pasta raiz e sincronização.
// Configuração GLOBAL — todos os coordenadores veem a mesma conta conectada.
//
// O encerramento de período NÃO mora aqui: ele vive no card "Dados do período", para não
// existirem dois caminhos para uma ação destrutiva.
export function SecaoDrive() {
  const [status, setStatus] = useState<StatusDrive | null>(null);
  const [erro, setErro] = useState('');
  const [msg, setMsg] = useState('');
  const [ocupado, setOcupado] = useState(false);

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
        <div className="alerta-aviso bloco">
          <strong>Integração não configurada no servidor.</strong> Defina <code>GOOGLE_CLIENT_ID</code>,{' '}
          <code>GOOGLE_CLIENT_SECRET</code> e <code>DRIVE_CRYPTO_SEGREDO</code> no <code>.env</code> da API. O
          encerramento de período, em “Dados do período”, não depende do Drive: ele arquiva tudo na própria VPS.
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

    </section>
  );
}
