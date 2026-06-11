import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiDelete, URL_API, type ErroApi } from '../../api';
import { useAuth } from '../../autenticacao/contexto';
import { TrilhaFases } from '../../componentes/TrilhaFases';
import { ModalEnviarPdf } from '../../componentes/ModalEnviarPdf';
import { faseParaIndice, ROTULO_FASE, ROTULO_TIPO_DOC } from '../../utils/fases';
import { MARCOS_CALENDARIO, ROTULO_MARCO, type MarcoCalendario } from '@tcc/compartilhado';

const ultimoDoc = (docs: any[] = [], tipo: string) =>
  docs.filter((d) => d.tipo === tipo).sort((a, b) => b.versao - a.versao)[0] ?? null;

const fmtData = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';

const STATUS_DOC: Record<string, { rotulo: string; classe: string }> = {
  APROVADO: { rotulo: 'Aprovado', classe: 'pilula-ok' },
  REJEITADO: { rotulo: 'Rejeitado', classe: 'pilula-bad' },
  PENDENTE: { rotulo: 'Em análise', classe: 'pilula-neutra' },
};

// Próximo marco do calendário com data >= hoje.
function proximoPrazo(cal: Record<string, string | null> | null) {
  if (!cal) return null;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  let melhor: { marco: MarcoCalendario; data: Date; iso: string } | null = null;
  for (const m of MARCOS_CALENDARIO) {
    const iso = cal[m];
    if (!iso) continue;
    const d = new Date(iso);
    const dLocal = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    if (dLocal >= hoje && (!melhor || dLocal < melhor.data)) melhor = { marco: m, data: dLocal, iso };
  }
  return melhor;
}

type Acao = { titulo: string; desc: string; parecer?: string; botao?: { rotulo: string; ao: () => void } };

export function DashboardAluno() {
  const navegar = useNavigate();
  const { usuario } = useAuth();
  const [tcc, setTcc] = useState<any | null>(null);
  const [calendario, setCalendario] = useState<Record<string, string | null> | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [modalUpload, setModalUpload] = useState<null | 'monografia' | 'versaoFinal'>(null);

  function carregar() {
    apiGet('/tccs/meu')
      .then(setTcc)
      .catch(() => setTcc(null))
      .finally(() => setCarregando(false));
  }
  useEffect(carregar, []);
  useEffect(() => {
    apiGet<Record<string, string | null>>('/calendario')
      .then(setCalendario)
      .catch(() => setCalendario(null));
  }, []);

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
  const prazo = proximoPrazo(calendario);

  // ---- Ação pendente (1 card, prioridade do fluxo) ----
  function acaoPendente(): Acao {
    const semAcao = (titulo: string, desc: string): Acao => ({ titulo, desc });
    if (!tcc) return semAcao('—', 'Sem TCC ativo.');

    if (solic?.status === 'RECUSADA')
      return { titulo: 'Abertura recusada', desc: 'Corrija os documentos e reenvie a solicitação.', botao: { rotulo: 'Corrigir e reenviar', ao: corrigirEReenviar } };
    if (solic?.status === 'PENDENTE')
      return semAcao('Aguardando aprovação', 'Sua abertura está em análise pelo coordenador.');

    if (tcc.faseAtual === 'DESENVOLVIMENTO' && !tcc.monografiaAprovada) {
      const mono = ultimoDoc(tcc.documentos, 'MONOGRAFIA');
      if (!mono || mono.status === 'REJEITADO')
        return {
          titulo: 'Enviar versão do TCC',
          desc: mono?.status === 'REJEITADO' ? 'Seu orientador pediu ajustes — reenvie a monografia.' : 'Submeta a monografia para avaliação do orientador.',
          parecer: mono?.status === 'REJEITADO' ? mono.parecer : undefined,
          botao: { rotulo: 'Enviar', ao: () => setModalUpload('monografia') },
        };
      if (mono.status === 'PENDENTE') return semAcao('Aguardando avaliação', 'Monografia enviada — em análise pelo orientador.');
    }

    if (tcc.faseAtual === 'AGUARDANDO_AJUSTES_FINAIS') {
      const vf = ultimoDoc(tcc.documentos, 'VERSAO_FINAL');
      return {
        titulo: 'Enviar versão final',
        desc: vf?.status === 'REJEITADO' ? 'O coordenador pediu ajustes — reenvie a versão final.' : 'Aprovado na defesa! Envie a versão final corrigida.',
        parecer: vf?.status === 'REJEITADO' ? vf.parecer : undefined,
        botao: { rotulo: 'Enviar', ao: () => setModalUpload('versaoFinal') },
      };
    }
    if (tcc.faseAtual === 'ANALISE_FINAL_COORDENADOR') return semAcao('Aguardando análise final', 'Versão final enviada — em análise pelo coordenador.');
    if (tcc.faseAtual === 'CONCLUIDO') return semAcao('TCC concluído 🎉', 'Parabéns! Seu TCC foi aprovado e concluído.');
    if (tcc.faseAtual === 'DESCONTINUADO' || tcc.faseAtual?.startsWith('REPROVADO')) return semAcao('—', 'TCC encerrado.');

    return semAcao('Nenhuma ação no momento', 'Acompanhe o andamento na trilha abaixo.');
  }

  const acao = acaoPendente();
  const recusada = solic?.status === 'RECUSADA' && solic.parecer;
  const docs = [...(tcc?.documentos ?? [])].sort(
    (a, b) => new Date(b.criadoEm ?? 0).getTime() - new Date(a.criadoEm ?? 0).getTime(),
  );

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
          {recusada && (
            <div className="alerta alerta-erro bloco">
              <strong>Abertura recusada.</strong> {solic.parecer}
            </div>
          )}

          {/* 3 cards de status */}
          <div className="cards-status bloco">
            <div className="card-status">
              <span className="card-status-titulo">Ação pendente</span>
              <div className="card-status-corpo">
                <span className="forte">{acao.titulo}</span>
                <span className="sub">{acao.desc}</span>
                {acao.parecer && <span className="sub"><strong>Devolutiva:</strong> {acao.parecer}</span>}
                {acao.botao && (
                  <button className="botao" onClick={acao.botao.ao}>{acao.botao.rotulo}</button>
                )}
              </div>
            </div>

            <div className="card-status">
              <span className="card-status-titulo">Próximo prazo</span>
              <div className="card-status-corpo">
                {prazo ? (
                  <>
                    <span className="grande">{fmtData(prazo.iso)}</span>
                    <span className="sub">{ROTULO_MARCO[prazo.marco]}</span>
                  </>
                ) : (
                  <span className="sub">Sem prazos futuros no calendário.</span>
                )}
              </div>
            </div>

            <div className="card-status">
              <span className="card-status-titulo">Fase atual</span>
              <div className="card-status-corpo">
                <span className="forte">{ROTULO_FASE[tcc.faseAtual] ?? tcc.faseAtual}</span>
                <span className="sub">{tcc.semestre}</span>
              </div>
            </div>
          </div>

          {/* Trilha */}
          <section className="cartao-secao bloco">
            <h2>Andamento do TCC</h2>
            <p className="legenda" style={{ marginBottom: 18 }}>{tcc.titulo}</p>
            {idx === null ? (
              <span className="badge-status status-bad">{ROTULO_FASE[tcc.faseAtual] ?? tcc.faseAtual}</span>
            ) : (
              <TrilhaFases atual={idx} />
            )}
          </section>

          {/* Documentos */}
          <section className="cartao-secao bloco">
            <div className="cabecalho-secao">
              <h2>Documentos</h2>
              <button className="link-inline" onClick={() => navegar('/aluno/documentos')}>Ver todos os documentos →</button>
            </div>
            {docs.length ? (
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Tipo</th>
                    <th>Arquivo</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {docs.slice(0, 5).map((d: any) => {
                    const st = STATUS_DOC[d.status] ?? { rotulo: d.status, classe: 'pilula-neutra' };
                    return (
                      <tr key={d.id}>
                        <td>{fmtData(d.criadoEm)}</td>
                        <td>{ROTULO_TIPO_DOC[d.tipo] ?? d.tipo}</td>
                        <td>{d.nomeArquivo}</td>
                        <td><span className={`pilula ${st.classe}`}>{st.rotulo}</span></td>
                        <td>
                          <a className="link-inline" href={`${URL_API}/tccs/documentos/${d.id}/baixar`} target="_blank" rel="noreferrer">Baixar</a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="nota-vazio">Nenhum documento enviado ainda.</p>
            )}
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
