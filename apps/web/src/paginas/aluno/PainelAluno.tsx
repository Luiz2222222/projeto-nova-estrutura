import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiDelete, type ErroApi } from '../../api';
import { TrilhaFases } from '../../componentes/TrilhaFases';
import { TimelineVerticalDetalhada } from '../../componentes/TimelineVerticalDetalhada';
import { ModalEnviarPdf } from '../../componentes/ModalEnviarPdf';
import { ModalConfirmacao } from '../../componentes/ModalConfirmacao';
import { CardNotasFinais } from '../../componentes/CardNotasFinais';
import { faseParaIndice, ROTULO_FASE, ROTULO_STATUS_SOLIC, ROTULO_TIPO_DOC, mostrarVersaoFinal, subfaseTcc, notasTrilhaTcc, chipsTrilha } from '../../utils/fases';

const ultimoDoc = (docs: any[] = [], tipo: string) =>
  docs.filter((d) => d.tipo === tipo).sort((a, b) => b.versao - a.versao)[0] ?? null;
const ultimaMonografia = (docs: any[] = []) => ultimoDoc(docs, 'MONOGRAFIA');

const fmtData = (iso?: string | null) => {
  if (!iso) return null;
  const [a, m, d] = String(iso).split('T')[0].split('-');
  return a && m && d ? `${d}/${m}/${a}` : null;
};

export function PainelAluno() {
  const navegar = useNavigate();
  const [tcc, setTcc] = useState<any | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [modalUpload, setModalUpload] = useState<null | 'monografia' | 'versaoFinal'>(null);
  const [modoTimeline, setModoTimeline] = useState<'vertical' | 'horizontal'>('vertical');
  const [confirmar, setConfirmar] = useState<null | 'cancelar'>(null);
  const [processandoAcao, setProcessandoAcao] = useState(false);
  const [erroAcao, setErroAcao] = useState('');
  const [recusaFechada, setRecusaFechada] = useState(false);

  function carregar() {
    setCarregando(true);
    apiGet('/tccs/meu')
      .then(setTcc)
      .catch(() => setTcc(null))
      .finally(() => setCarregando(false));
  }
  useEffect(carregar, []);

  async function cancelar() {
    setErroAcao('');
    setProcessandoAcao(true);
    try {
      await apiDelete(`/tccs/${tcc.id}`);
      setConfirmar(null);
      setProcessandoAcao(false);
      setTcc(null);
    } catch (e) {
      setErroAcao((e as ErroApi).mensagem || 'Não foi possível cancelar.');
      setProcessandoAcao(false);
    }
  }

  function abrirCancelar() {
    setErroAcao('');
    setProcessandoAcao(false);
    setConfirmar('cancelar');
  }

  if (carregando) return <p className="nota-vazio">Carregando…</p>;

  const solic = tcc?.solicitacoes?.[0];
  // Solicitação recusada → trata como "sem TCC ativo": estado inicial + aviso vermelho no topo.
  const recusada = !!tcc && tcc.faseAtual === 'INICIALIZACAO' && solic?.status === 'RECUSADA';

  if (!tcc || recusada) {
    return (
      <>
        <h1>Meu TCC</h1>
        {recusada && !recusaFechada && (
          <div className="card-recusa bloco">
            <button className="card-recusa-x" onClick={() => setRecusaFechada(true)} aria-label="Fechar">✕</button>
            <div className="card-recusa-cabecalho">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4M12 16h.01" />
              </svg>
              <h3>Solicitação recusada</h3>
            </div>
            <p className="card-recusa-texto">
              Sua solicitação de orientação foi recusada pela coordenação{fmtData(solic?.respondidoEm) ? ` em ${fmtData(solic?.respondidoEm)}` : ''}.
            </p>
            {solic?.parecer && <div className="card-recusa-parecer">{solic.parecer}</div>}
          </div>
        )}
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

  const idx = faseParaIndice(tcc.faseAtual);
  const mono = ultimaMonografia(tcc.documentos);
  // Pode enviar/reenviar a 1ª monografia: em Desenvolvimento, não aprovada e sem versão
  // em análise (nenhuma ainda ou a última teve ajustes solicitados).
  const podeEnviarMono = tcc.faseAtual === 'DESENVOLVIMENTO' && !tcc.monografiaAprovada && (!mono || mono.status === 'REJEITADO');
  const blkMono = !!tcc.bloqueios?.SUBMISSAO_MONOGRAFIA;

  return (
    <>
      <div className="cabecalho-secao" style={{ alignItems: 'flex-start' }}>
        <div>
          <h1>Meu TCC</h1>
          <p className="legenda">{tcc.titulo}</p>
        </div>
        {podeEnviarMono && (
          <button className="botao" disabled={blkMono} onClick={() => setModalUpload('monografia')}>
            {mono ? 'Reenviar monografia' : 'Enviar monografia'}
          </button>
        )}
      </div>

      {/* Notas Finais (topo) — só aparece quando a nota final já foi confirmada/liberada.
          Pesos das fases vêm do calendário do semestre (backend); sem eles, o card usa 60/40. */}
      <CardNotasFinais tcc={tcc} pesoF1={tcc.pesoFase1} pesoF2={tcc.pesoFase2} />

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
            <button className="botao botao-secundario" onClick={abrirCancelar}>Cancelar solicitação</button>
          </div>
        </div>
      )}

      <section className="cartao-secao bloco">
        <h2>Dados</h2>
        <dl className="dados">
          <div>
            <dt>Título</dt>
            <dd>{tcc.titulo}</dd>
          </div>
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
                {d.nomeArquivo} <span className="muted">({ROTULO_TIPO_DOC[d.tipo] ?? d.tipo})</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="nota-vazio">Nenhum documento enviado.</p>
        )}
      </section>

      <section className="cartao-secao bloco">
        <div className="cabecalho-secao">
          <h2>Timeline de eventos</h2>
          <div className="rel-abas" style={{ margin: 0 }}>
            <button className={`rel-aba${modoTimeline === 'vertical' ? ' ativa' : ''}`} onClick={() => setModoTimeline('vertical')}>Vertical</button>
            <button className={`rel-aba${modoTimeline === 'horizontal' ? ' ativa' : ''}`} onClick={() => setModoTimeline('horizontal')}>Horizontal</button>
          </div>
        </div>
        {modoTimeline === 'vertical' ? (
          <TimelineVerticalDetalhada tcc={tcc} />
        ) : idx === null ? (
          <span className="badge-status status-bad">{ROTULO_FASE[tcc.faseAtual] ?? tcc.faseAtual}</span>
        ) : (
          <TrilhaFases atual={idx} sub={subfaseTcc(tcc)} chips={chipsTrilha(tcc)} notas={notasTrilhaTcc(tcc, false)} />
        )}
        <p className="nota-vazio" style={{ marginTop: 14 }}>
          Etapa atual: <strong>{ROTULO_FASE[tcc.faseAtual] ?? tcc.faseAtual}</strong>
        </p>
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
            const bloqueado = !!tcc.bloqueios?.SUBMISSAO_MONOGRAFIA;
            return (
              <>
                {bloqueado && <div className="aviso-prazo">⏰ O prazo de submissão da monografia venceu. Peça uma liberação à coordenação para enviar.</div>}
                <button className="botao" style={{ marginTop: 14 }} disabled={bloqueado} onClick={() => setModalUpload('monografia')}>
                  {mono ? 'Reenviar monografia' : 'Enviar monografia'}
                </button>
              </>
            );
          })()}
        </section>
      )}

      {mostrarVersaoFinal(tcc.faseAtual, !!ultimoDoc(tcc.documentos, 'VERSAO_FINAL')) && (
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
          <>
            {tcc.bloqueios?.VERSAO_FINAL && <div className="aviso-prazo">⏰ O prazo da versão final venceu. Peça uma liberação à coordenação para enviar.</div>}
            <button className="botao" style={{ marginTop: 14 }} disabled={!!tcc.bloqueios?.VERSAO_FINAL} onClick={() => setModalUpload('versaoFinal')}>
              {ultimoDoc(tcc.documentos, 'VERSAO_FINAL') ? 'Reenviar versão final' : 'Enviar versão final'}
            </button>
          </>
        )}
      </section>
      )}

      {modalUpload && (
        <ModalEnviarPdf
          endpoint={modalUpload === 'monografia' ? `/tccs/${tcc.id}/monografia` : `/tccs/${tcc.id}/versao-final`}
          titulo={modalUpload === 'monografia' ? 'Enviar versão do TCC' : 'Enviar versão final'}
          subtitulo={
            modalUpload === 'monografia'
              ? 'Envie a monografia em Word (.doc ou .docx) para avaliação do seu orientador.'
              : 'Envie a versão final corrigida (PDF) para validação do seu orientador.'
          }
          rotulo={modalUpload === 'monografia' ? 'Monografia' : 'Versão final'}
          aceita={modalUpload === 'monografia' ? '.doc,.docx' : '.pdf'}
          dica={modalUpload === 'monografia' ? 'Word (.doc ou .docx), até 10MB' : 'PDF, até 10MB'}
          aoFechar={() => setModalUpload(null)}
          aoEnviado={() => { setModalUpload(null); carregar(); }}
        />
      )}

      {confirmar === 'cancelar' && (
        <ModalConfirmacao
          titulo="Cancelar solicitação"
          mensagem="Deseja cancelar a solicitação de abertura do TCC? Os documentos enviados serão descartados e você poderá iniciar uma nova solicitação depois."
          textoConfirmar="Cancelar solicitação"
          textoCancelar="Voltar"
          textoProcessando="Cancelando…"
          perigo
          processando={processandoAcao}
          erro={erroAcao}
          aoConfirmar={cancelar}
          aoCancelar={() => setConfirmar(null)}
        />
      )}

    </>
  );
}
