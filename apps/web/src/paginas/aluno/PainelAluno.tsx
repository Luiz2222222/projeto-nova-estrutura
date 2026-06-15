import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiDelete, type ErroApi } from '../../api';
import { TrilhaFases } from '../../componentes/TrilhaFases';
import { ModalEnviarPdf } from '../../componentes/ModalEnviarPdf';
import { faseParaIndice, ROTULO_FASE, ROTULO_STATUS_SOLIC } from '../../utils/fases';

const ultimoDoc = (docs: any[] = [], tipo: string) =>
  docs.filter((d) => d.tipo === tipo).sort((a, b) => b.versao - a.versao)[0] ?? null;
const ultimaMonografia = (docs: any[] = []) => ultimoDoc(docs, 'MONOGRAFIA');

export function PainelAluno() {
  const navegar = useNavigate();
  const [tcc, setTcc] = useState<any | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [modalUpload, setModalUpload] = useState<null | 'monografia' | 'versaoFinal'>(null);

  function carregar() {
    setCarregando(true);
    apiGet('/tccs/meu')
      .then(setTcc)
      .catch(() => setTcc(null))
      .finally(() => setCarregando(false));
  }
  useEffect(carregar, []);

  async function corrigirEReenviar() {
    if (!window.confirm('Isso descarta esta solicitação recusada e abre uma nova. Continuar?')) return;
    try {
      await apiDelete(`/tccs/${tcc.id}`);
      navegar('/aluno/abrir');
    } catch (e) {
      window.alert((e as ErroApi).mensagem || 'Não foi possível reenviar.');
    }
  }

  async function cancelar() {
    if (!window.confirm('Cancelar a solicitação de abertura do TCC?')) return;
    try {
      await apiDelete(`/tccs/${tcc.id}`);
      setTcc(null);
    } catch (e) {
      window.alert((e as ErroApi).mensagem || 'Não foi possível cancelar.');
    }
  }

  if (carregando) return <p className="nota-vazio">Carregando…</p>;

  if (!tcc) {
    return (
      <>
        <h1>Meu TCC</h1>
        <section className="cartao-secao bloco" style={{ textAlign: 'center' }}>
          <h2>Você ainda não iniciou seu TCC</h2>
          <p className="nota-vazio">
            Comece enviando a solicitação de orientação com os documentos iniciais.
          </p>
          <button className="botao" style={{ marginTop: 16 }} onClick={() => navegar('/aluno/abrir')}>
            Iniciar meu TCC
          </button>
        </section>
      </>
    );
  }

  const solic = tcc.solicitacoes?.[0];
  const idx = faseParaIndice(tcc.faseAtual);

  return (
    <>
      <h1>Meu TCC</h1>
      <p className="legenda">{tcc.titulo}</p>

      {solic?.status === 'RECUSADA' && (
        <div className="card-recusa bloco">
          <div className="card-recusa-cabecalho">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
            <h3>Solicitação recusada</h3>
          </div>
          <p className="card-recusa-texto">
            Sua solicitação de orientação foi recusada pela coordenação. Corrija os documentos e reenvie.
          </p>
          {solic.parecer && <div className="card-recusa-parecer">{solic.parecer}</div>}
          <div className="acoes" style={{ marginTop: 14, justifyContent: 'flex-start' }}>
            <button className="botao" onClick={corrigirEReenviar}>Corrigir e reenviar</button>
          </div>
        </div>
      )}

      {/* Solicitação pendente: card destacado no topo (como no antigo), com a ação de cancelar. */}
      {tcc.faseAtual === 'INICIALIZACAO' && solic?.status === 'PENDENTE' && (
        <div className="card-pendente bloco">
          <div className="card-recusa-cabecalho">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 7v5l3 2" />
            </svg>
            <h3>Aguardando aprovação do coordenador</h3>
          </div>
          <p className="card-recusa-texto">
            Sua solicitação de abertura foi enviada e está em análise pela coordenação. Você pode
            cancelá-la enquanto não for aprovada.
          </p>
          <div className="acoes" style={{ marginTop: 6, justifyContent: 'flex-start' }}>
            <button className="botao botao-secundario" onClick={cancelar}>Cancelar solicitação</button>
          </div>
        </div>
      )}

      <section className="cartao-secao bloco">
        <h2>Andamento</h2>
        {idx === null ? (
          <span className="badge-status status-bad">{ROTULO_FASE[tcc.faseAtual] ?? tcc.faseAtual}</span>
        ) : (
          <TrilhaFases atual={idx} />
        )}
        <p className="nota-vazio">
          Etapa atual: <strong>{ROTULO_FASE[tcc.faseAtual] ?? tcc.faseAtual}</strong>
        </p>
      </section>

      <section className="cartao-secao bloco">
        <h2>Dados</h2>
        <dl className="dados">
          <div>
            <dt>Orientador</dt>
            <dd>
              {tcc.orientador?.tratamento ? tcc.orientador.tratamento + ' ' : ''}
              {tcc.orientador?.nomeCompleto ?? '—'}
            </dd>
          </div>
          {(tcc.coorientador || tcc.coorientadorNome) && (
            <div>
              <dt>Coorientador</dt>
              <dd>{tcc.coorientador?.nomeCompleto ?? tcc.coorientadorNome}</dd>
            </div>
          )}
          <div>
            <dt>Semestre</dt>
            <dd>{tcc.semestre}</dd>
          </div>
          <div>
            <dt>Situação</dt>
            <dd>{ROTULO_STATUS_SOLIC[solic?.status] ?? solic?.status}</dd>
          </div>
        </dl>

        <h3 style={{ marginTop: 18, fontSize: 14 }}>Documentos</h3>
        {tcc.documentos?.length ? (
          <ul className="lista-docs">
            {tcc.documentos.map((d: any) => (
              <li key={d.id}>
                {d.nomeArquivo} <span className="muted">({d.tipo})</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="nota-vazio">Nenhum documento enviado.</p>
        )}
      </section>

      {(tcc.faseAtual === 'DESENVOLVIMENTO' || ultimaMonografia(tcc.documentos)) && (
        <section className="cartao-secao bloco">
          <h2>Monografia</h2>
          {(() => {
            const mono = ultimaMonografia(tcc.documentos);
            if (!mono) return <p className="nota-vazio" style={{ marginTop: 0 }}>Você ainda não enviou a monografia.</p>;
            const rotulo =
              mono.status === 'APROVADO'
                ? 'Aprovada pelo orientador'
                : mono.status === 'REJEITADO'
                  ? 'Ajustes solicitados'
                  : 'Aguardando avaliação do orientador';
            return (
              <>
                <p className="nota-vazio" style={{ marginTop: 0 }}>
                  Versão {mono.versao} — <strong>{rotulo}</strong>.
                </p>
                {mono.status === 'REJEITADO' && mono.parecer && (
                  <div className="alerta alerta-erro"><strong>Devolutiva:</strong> {mono.parecer}</div>
                )}
              </>
            );
          })()}
          {(() => {
            // Só oferece enviar/reenviar quando NÃO há versão em avaliação (consistente com o Dashboard).
            const mono = ultimaMonografia(tcc.documentos);
            const podeEnviar =
              tcc.faseAtual === 'DESENVOLVIMENTO' && !tcc.monografiaAprovada && (!mono || mono.status === 'REJEITADO');
            if (!podeEnviar) return null;
            return (
              <button className="botao" style={{ marginTop: 14 }} onClick={() => setModalUpload('monografia')}>
                {mono ? 'Reenviar monografia' : 'Enviar monografia'}
              </button>
            );
          })()}
        </section>
      )}

      <section className="cartao-secao bloco">
        <h2>Versão final</h2>
        {(() => {
          const vf = ultimoDoc(tcc.documentos, 'VERSAO_FINAL');
          if (!vf)
            return (
              <p className="nota-vazio" style={{ marginTop: 0 }}>
                <span className="pilula pilula-neutra">Aguardando envio</span> — a versão final é enviada após a aprovação na banca final.
              </p>
            );
          const rotulo =
            vf.status === 'APROVADO'
              ? 'Aprovada — TCC concluído'
              : vf.status === 'REJEITADO'
                ? 'Ajustes solicitados'
                : 'Aguardando validação do orientador';
          return (
            <>
              <p className="nota-vazio" style={{ marginTop: 0 }}>
                Versão {vf.versao} — <strong>{rotulo}</strong>.
              </p>
              {vf.status === 'REJEITADO' && vf.parecer && (
                <div className="alerta alerta-erro"><strong>Devolutiva:</strong> {vf.parecer}</div>
              )}
            </>
          );
        })()}
        {tcc.faseAtual === 'AGUARDANDO_AJUSTES_FINAIS' && (
          <button className="botao" style={{ marginTop: 14 }} onClick={() => setModalUpload('versaoFinal')}>
            {ultimoDoc(tcc.documentos, 'VERSAO_FINAL') ? 'Reenviar versão final' : 'Enviar versão final'}
          </button>
        )}
      </section>

      {modalUpload && (
        <ModalEnviarPdf
          endpoint={modalUpload === 'monografia' ? `/tccs/${tcc.id}/monografia` : `/tccs/${tcc.id}/versao-final`}
          titulo={modalUpload === 'monografia' ? 'Enviar versão do TCC' : 'Enviar versão final'}
          subtitulo={
            modalUpload === 'monografia'
              ? 'Envie a monografia (PDF) para avaliação do seu orientador.'
              : 'Envie a versão final corrigida (PDF) para validação do seu orientador.'
          }
          rotulo={modalUpload === 'monografia' ? 'Monografia' : 'Versão final'}
          aoFechar={() => setModalUpload(null)}
          aoEnviado={() => { setModalUpload(null); carregar(); }}
        />
      )}
    </>
  );
}
