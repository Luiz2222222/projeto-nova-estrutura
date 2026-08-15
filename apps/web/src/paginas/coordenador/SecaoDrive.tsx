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

// Linha informativa do painel: rótulo + valor, sem nada editável.
function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
      <dt className="legenda" style={{ margin: 0 }}>{rotulo}:</dt>
      <dd style={{ margin: 0, fontWeight: 600, wordBreak: 'break-word' }}>{valor}</dd>
    </div>
  );
}

// dd/mm/aaaa HH:mm:ss no fuso oficial do curso (America/Fortaleza), como no resto do projeto.
const quando = (v: string | null) => {
  if (!v) return 'nunca';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return 'nunca';
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Fortaleza',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const p: Record<string, string> = {};
  for (const parte of fmt.formatToParts(d)) p[parte.type] = parte.value;
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second}`;
};

// Selo de situação, no mesmo padrão visual dos status de documento.
function Selo({ conectado, configurado }: { conectado: boolean; configurado: boolean }) {
  if (!configurado) return <span className="status-pill pilula-neutra">Não configurado</span>;
  return conectado ? (
    <span className="status-pill status-normal">Conectado</span>
  ) : (
    <span className="status-pill status-atencao">Não conectado</span>
  );
}

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ marginBottom: 0 }}>Arquivamento no Google Drive</h2>
        {status && <Selo conectado={status.conectado} configurado={status.configurado} />}
      </div>
      <p className="legenda" style={{ marginTop: 8, marginBottom: 14 }}>
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
          {/* Painel só de leitura: nada aqui é editável, então nada tem cara de input. A
              situação virou o selo do título, então não se repete como linha. */}
          <dl style={{ margin: 0, display: 'grid', gap: 8 }}>
            <Linha rotulo="Conta" valor={status.contaEmail ?? '—'} />
            <Linha rotulo="Pasta" valor={status.pastaRaizNome ?? '—'} />
            <Linha rotulo="Última atualização" valor={quando(status.ultimoSyncEm)} />
          </dl>

          {/* Um grupo só, encostado à direita (`.acoes` já alinha em flex-end): "Atualizar"
              vem imediatamente antes da ação de conectar/desconectar, e em tela estreita os
              dois empilham nessa mesma ordem.
              "Atualizar" só relê /drive/status: não enfileira, não sincroniza, não apaga —
              a fila já tem retry automático e varredura diária no servidor. */}
          <div className="acoes" style={{ flexWrap: 'wrap', gap: 10 }}>
            <button type="button" className="botao botao-secundario" disabled={ocupado} onClick={carregar}>
              Atualizar
            </button>
            {!status.conectado ? (
              // Verde fixo (não a variável de tema, que clareia no escuro e perderia o
              // contraste com o texto branco).
              <button
                className="botao"
                style={{ background: '#15803d', borderColor: '#15803d', color: '#fff' }}
                disabled={ocupado}
                onClick={conectar}
              >
                Conectar Google Drive
              </button>
            ) : (
              // Mesmo padrão do "Encerrar período": ação de desfazer, à direita do card.
              <button
                className="botao botao-perigo"
                disabled={ocupado}
                onClick={() => acao('/drive/desconectar', 'Drive desconectado.')}
              >
                Desconectar
              </button>
            )}
          </div>
        </>
      )}

    </section>
  );
}
