import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiDelete, type ErroApi } from '../../api';
import { useAuth } from '../../autenticacao/contexto';
import { TrilhaFases } from '../../componentes/TrilhaFases';
import { ModalEnviarPdf } from '../../componentes/ModalEnviarPdf';
import { faseParaIndice, ROTULO_FASE, ROTULO_STATUS_SOLIC } from '../../utils/fases';

const ultimoDoc = (docs: any[] = [], tipo: string) =>
  docs.filter((d) => d.tipo === tipo).sort((a, b) => b.versao - a.versao)[0] ?? null;

// Ação pendente do aluno na fase de desenvolvimento (monografia).
function acaoMonografia(tcc: any): 'ENVIAR' | 'AGUARDANDO' | null {
  if (!tcc || tcc.faseAtual !== 'DESENVOLVIMENTO' || tcc.monografiaAprovada) return null;
  const mono = ultimoDoc(tcc.documentos, 'MONOGRAFIA');
  if (!mono || mono.status === 'REJEITADO') return 'ENVIAR';
  if (mono.status === 'PENDENTE') return 'AGUARDANDO';
  return null;
}

// Ação pendente na conclusão (versão final).
function acaoVersaoFinal(tcc: any): 'ENVIAR' | 'AGUARDANDO' | null {
  if (!tcc) return null;
  if (tcc.faseAtual === 'AGUARDANDO_AJUSTES_FINAIS') return 'ENVIAR';
  if (tcc.faseAtual === 'ANALISE_FINAL_COORDENADOR') return 'AGUARDANDO';
  return null;
}

export function DashboardAluno() {
  const navegar = useNavigate();
  const { usuario } = useAuth();
  const [tcc, setTcc] = useState<any | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [modalUpload, setModalUpload] = useState<null | 'monografia' | 'versaoFinal'>(null);

  function carregar() {
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

  const primeiroNome = usuario?.nomeCompleto.split(' ')[0] ?? '';
  const solic = tcc?.solicitacoes?.[0];
  const idx = tcc ? faseParaIndice(tcc.faseAtual) : null;
  const acao = acaoMonografia(tcc);
  const mono = ultimoDoc(tcc?.documentos, 'MONOGRAFIA');
  const acaoVF = acaoVersaoFinal(tcc);
  const vf = ultimoDoc(tcc?.documentos, 'VERSAO_FINAL');

  return (
    <>
      <h1>Olá, {primeiroNome} 👋</h1>
      <p className="legenda">Bem-vindo(a) ao seu painel de TCC.</p>

      {carregando ? (
        <p className="nota-vazio">Carregando…</p>
      ) : !tcc ? (
        <section className="cartao-secao bloco" style={{ textAlign: 'center' }}>
          <h2>Você ainda não abriu seu TCC</h2>
          <p className="nota-vazio">Comece enviando a solicitação de orientação com os documentos iniciais.</p>
          <button className="botao" style={{ marginTop: 16 }} onClick={() => navegar('/aluno/abrir')}>Abrir meu TCC</button>
        </section>
      ) : (
        <>
          {solic?.status === 'RECUSADA' && (
            <div className="alerta alerta-erro bloco">
              <strong>Abertura recusada.</strong> {solic.parecer}
              <div className="acoes" style={{ marginTop: 12 }}>
                <button className="botao" onClick={corrigirEReenviar}>Corrigir e reenviar</button>
              </div>
            </div>
          )}

          {/* Card de ação pendente */}
          {acao === 'ENVIAR' && (
            <section className="cartao-secao bloco card-acao">
              <div className="card-acao-info">
                <span className="card-acao-titulo">Ação necessária: enviar versão do TCC</span>
                <span className="card-acao-desc">
                  {mono?.status === 'REJEITADO'
                    ? 'Seu orientador pediu ajustes — reenvie a monografia corrigida.'
                    : 'Submeta a monografia para avaliação do seu orientador.'}
                </span>
                {mono?.status === 'REJEITADO' && mono.parecer && (
                  <span className="card-acao-parecer"><strong>Devolutiva:</strong> {mono.parecer}</span>
                )}
              </div>
              <button className="botao" onClick={() => setModalUpload('monografia')}>Enviar</button>
            </section>
          )}
          {acao === 'AGUARDANDO' && (
            <section className="cartao-secao bloco">
              <p className="nota-vazio" style={{ margin: 0 }}>
                📨 Monografia enviada — aguardando avaliação do orientador.
              </p>
            </section>
          )}

          {/* Conclusão: versão final */}
          {acaoVF === 'ENVIAR' && (
            <section className="cartao-secao bloco card-acao">
              <div className="card-acao-info">
                <span className="card-acao-titulo">Ação necessária: enviar a versão final</span>
                <span className="card-acao-desc">
                  {vf?.status === 'REJEITADO'
                    ? 'O coordenador pediu ajustes — reenvie a versão final corrigida.'
                    : 'Aprovado na defesa! Envie a versão final corrigida do TCC.'}
                </span>
                {vf?.status === 'REJEITADO' && vf.parecer && (
                  <span className="card-acao-parecer"><strong>Devolutiva:</strong> {vf.parecer}</span>
                )}
              </div>
              <button className="botao" onClick={() => setModalUpload('versaoFinal')}>Enviar</button>
            </section>
          )}
          {acaoVF === 'AGUARDANDO' && (
            <section className="cartao-secao bloco">
              <p className="nota-vazio" style={{ margin: 0 }}>
                📨 Versão final enviada — aguardando a análise final do coordenador.
              </p>
            </section>
          )}

          <section className="cartao-secao bloco">
            <h2>Andamento do TCC</h2>
            <p className="legenda" style={{ marginBottom: 18 }}>{tcc.titulo}</p>
            {idx === null ? (
              <span className="badge-status status-bad">{ROTULO_FASE[tcc.faseAtual] ?? tcc.faseAtual}</span>
            ) : (
              <TrilhaFases atual={idx} />
            )}
            <p className="nota-vazio">
              Etapa atual: <strong>{ROTULO_FASE[tcc.faseAtual] ?? tcc.faseAtual}</strong>
            </p>
            <div className="acoes" style={{ justifyContent: 'flex-start' }}>
              <button className="botao" onClick={() => navegar('/aluno/meu-tcc')}>Ver Meu TCC</button>
              <button className="botao botao-secundario" onClick={() => navegar('/aluno/documentos')}>Documentos</button>
            </div>
          </section>

          <section className="cartao-secao bloco">
            <h2>Resumo</h2>
            <dl className="dados">
              <div>
                <dt>Orientador</dt>
                <dd>
                  {tcc.orientador?.tratamento ? tcc.orientador.tratamento + ' ' : ''}
                  {tcc.orientador?.nomeCompleto ?? '—'}
                </dd>
              </div>
              <div>
                <dt>Semestre</dt>
                <dd>{tcc.semestre}</dd>
              </div>
              <div>
                <dt>Situação</dt>
                <dd>{ROTULO_STATUS_SOLIC[solic?.status] ?? solic?.status ?? '—'}</dd>
              </div>
            </dl>
          </section>
        </>
      )}

      {modalUpload && tcc && (
        <ModalEnviarPdf
          endpoint={modalUpload === 'monografia' ? `/tccs/${tcc.id}/monografia` : `/tccs/${tcc.id}/versao-final`}
          titulo={modalUpload === 'monografia' ? 'Enviar versão do TCC' : 'Enviar versão final'}
          subtitulo={
            modalUpload === 'monografia'
              ? 'Envie a monografia (PDF) para avaliação do seu orientador.'
              : 'Envie a versão final corrigida (PDF) para análise do coordenador.'
          }
          rotulo={modalUpload === 'monografia' ? 'Monografia' : 'Versão final'}
          aoFechar={() => setModalUpload(null)}
          aoEnviado={() => { setModalUpload(null); carregar(); }}
        />
      )}
    </>
  );
}
