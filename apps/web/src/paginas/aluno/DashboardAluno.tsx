import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiDelete, URL_API, type ErroApi } from '../../api';
import { TrilhaFases } from '../../componentes/TrilhaFases';
import { ModalEnviarPdf } from '../../componentes/ModalEnviarPdf';
import { faseParaIndice, ROTULO_FASE, ROTULO_TIPO_DOC, mostrarVersaoFinal, subfaseTcc, notasTrilhaTcc, chipsTrilha } from '../../utils/fases';
import { ROTULO_MARCO, type MarcoCalendario } from '@tcc/compartilhado';

const ultimoDoc = (docs: any[] = [], tipo: string) =>
  docs.filter((d) => d.tipo === tipo).sort((a, b) => b.versao - a.versao)[0] ?? null;

// dd/MM/yyyy (formato do projeto antigo). O split da string ISO evita "voltar" um dia por fuso.
const fmtData = (iso?: string | null) => {
  if (!iso) return '—';
  const [ano, mes, dia] = iso.split('T')[0].split('-');
  return `${dia}/${mes}/${ano}`;
};

const STATUS_DOC: Record<string, { rotulo: string; classe: string }> = {
  APROVADO: { rotulo: 'Aprovado', classe: 'pilula-ok' },
  REJEITADO: { rotulo: 'Rejeitado', classe: 'pilula-bad' },
  PENDENTE: { rotulo: 'Em análise', classe: 'pilula-neutra' },
};

// Documentos que o aluno percorre ao longo do TCC — aparecem desde o início,
// mesmo antes de enviados (como "Aguardando envio"), espelhando o projeto antigo.
const DOCS_ESPERADOS = ['PLANO_DESENVOLVIMENTO', 'TERMO_ACEITE', 'MONOGRAFIA', 'VERSAO_FINAL'] as const;

const icoOlho = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const icoBaixar = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
  </svg>
);

const ic = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{d.split('|').map((p, i) => <path key={i} d={p} />)}</svg>
);
const icoRelogio = ic('M12 7v5l3 2|M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0');
const icoCalendario = ic('M16 2v4M8 2v4M3 10h18|M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2');
const icoAtividade = ic('M22 12h-4l-3 9L9 3l-3 9H2');
// Estado vazio da "Ação pendente": exclamação dentro de um círculo, em cinza (como no antigo).
const icoAlertaCirculo = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

// Quebra o ROTULO_FASE em fase macro + status/subfase (duas linhas no card "Fase atual").
function faseMacroSub(tcc: any): { macro: string; sub: string } {
  const f = tcc?.faseAtual;
  const solic = tcc?.solicitacoes?.[0];
  switch (f) {
    case 'INICIALIZACAO':
      return {
        macro: 'Inicialização',
        sub: solic?.status === 'PENDENTE' ? 'Aguardando aprovação do coordenador'
          : solic?.status === 'RECUSADA' ? 'Abertura recusada'
          : 'Aguardando aceite/aprovação',
      };
    case 'DESENVOLVIMENTO': {
      // Status composto: monografia e continuidade são trilhas paralelas.
      const aprov = !!tcc?.monografiaAprovada;
      const cont = !!tcc?.continuidadeConfirmada;
      const sub = aprov && cont ? 'Pronto para a Fase I'
        : aprov ? 'Aguardando confirmação de continuidade'
        : cont ? 'Aguardando aprovação da monografia'
        : 'Aguardando monografia e continuidade';
      return { macro: 'Desenvolvimento', sub };
    }
    case 'FORMACAO_BANCA_FASE_1': return { macro: 'Fase I', sub: 'Formação da banca' };
    case 'AVALIACAO_FASE_1': return { macro: 'Fase I', sub: 'Avaliação da banca' };
    case 'VALIDACAO_FASE_1': return { macro: 'Fase I', sub: 'Validação da Fase I' };
    case 'AVALIACAO_FASE_2': return { macro: 'Fase II', sub: 'Avaliação da banca' };
    case 'VALIDACAO_FASE_2': return { macro: 'Fase II', sub: 'Validação da Fase II' };
    case 'AGUARDANDO_AJUSTES_FINAIS': return { macro: 'Finalização', sub: 'Envio da versão final' };
    case 'VALIDACAO_VERSAO_FINAL': return { macro: 'Finalização', sub: 'Versão final aguardando orientador' };
    case 'CONCLUIDO': return { macro: 'Concluído', sub: 'Aprovado' };
    case 'REPROVADO_FASE_1': return { macro: 'Encerrado', sub: 'Reprovado na Fase I' };
    case 'REPROVADO_FASE_2': return { macro: 'Encerrado', sub: 'Reprovado na Fase II' };
    case 'DESCONTINUADO': return { macro: 'Encerrado', sub: 'Descontinuado' };
    default: return { macro: ROTULO_FASE[f] ?? f ?? '—', sub: '' };
  }
}

// Marcos que são prazos do ALUNO (exclui Reunião e Preparação das bancas,
// que são atividades da coordenação) — espelha o "próximo prazo" do projeto antigo.
const PRAZOS_ALUNO: MarcoCalendario[] = [
  'envioDocumentos',
  'avaliacaoContinuidade',
  'submissaoMonografia',
  'avaliacaoFase1',
  'apresentacaoFase2',
  'ajustesFinais',
];

// Próximo prazo do aluno com data >= hoje.
function proximoPrazo(cal: Record<string, string | null> | null) {
  if (!cal) return null;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  let melhor: { marco: MarcoCalendario; data: Date; iso: string } | null = null;
  for (const m of PRAZOS_ALUNO) {
    const iso = cal[m];
    if (!iso) continue;
    const d = new Date(iso);
    const dLocal = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    if (dLocal >= hoje && (!melhor || dLocal < melhor.data)) melhor = { marco: m, data: dLocal, iso };
  }
  return melhor;
}

type Acao = { titulo: string; desc: string; parecer?: string; botao?: { rotulo: string; ao: () => void }; bloqueado?: boolean };

export function DashboardAluno() {
  const navegar = useNavigate();
  const [tcc, setTcc] = useState<any | null>(null);
  const [calendario, setCalendario] = useState<Record<string, string | null> | null>(null);
  const [abertura, setAbertura] = useState<{ bloqueado: boolean } | null>(null);
  const [carregandoAbertura, setCarregandoAbertura] = useState(true);
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
    // Estado da abertura (considera liberação individual deste aluno+semestre).
    apiGet('/tccs/abertura-prazo').then(setAbertura).catch(() => setAbertura(null)).finally(() => setCarregandoAbertura(false));
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
          bloqueado: !!tcc.bloqueios?.SUBMISSAO_MONOGRAFIA,
        };
      if (mono.status === 'PENDENTE') return semAcao('Aguardando avaliação', 'Monografia enviada — em análise pelo orientador.');
    }

    if (tcc.faseAtual === 'AGUARDANDO_AJUSTES_FINAIS') {
      const vf = ultimoDoc(tcc.documentos, 'VERSAO_FINAL');
      return {
        titulo: 'Enviar versão final',
        desc: vf?.status === 'REJEITADO' ? 'O orientador pediu ajustes — reenvie a versão final.' : 'Aprovado na defesa! Envie a versão final corrigida.',
        parecer: vf?.status === 'REJEITADO' ? vf.parecer : undefined,
        botao: { rotulo: 'Enviar', ao: () => setModalUpload('versaoFinal') },
        bloqueado: !!tcc.bloqueios?.VERSAO_FINAL,
      };
    }
    if (tcc.faseAtual === 'VALIDACAO_VERSAO_FINAL') return semAcao('Aguardando validação', 'Versão final enviada — aguardando a validação do orientador.');
    if (tcc.faseAtual === 'CONCLUIDO') return semAcao('TCC concluído 🎉', 'Parabéns! Seu TCC foi aprovado e concluído.');
    if (tcc.faseAtual === 'DESCONTINUADO' || tcc.faseAtual?.startsWith('REPROVADO'))
      return semAcao('TCC encerrado', tcc.faseAtual === 'DESCONTINUADO' ? 'O TCC foi descontinuado.' : 'O TCC foi reprovado.');

    return semAcao('Sem solicitação pendente', 'Nenhuma solicitação aguardando ação');
  }

  const acaoBruta = acaoPendente();
  // Sem botão = não há ação real para o aluno fazer: mostra o estado vazio.
  // (Estados informativos como "Aguardando aprovação/avaliação/validação" já
  // aparecem no card "Fase atual", então não substituem o texto deste card.)
  const acao: Acao = acaoBruta.botao
    ? acaoBruta
    : { titulo: 'Sem solicitação pendente', desc: 'Nenhuma solicitação aguardando ação' };
  const recusada = solic?.status === 'RECUSADA' && solic.parecer;

  // Versão final só aparece depois da Fase II aprovada (AGUARDANDO_AJUSTES_FINAIS),
  // na validação do orientador (VALIDACAO_VERSAO_FINAL) ou já concluído — ou quando
  // já existe um documento VERSAO_FINAL. Antes disso, só Plano, Termo e Monografia.
  const mostrarVF = mostrarVersaoFinal(tcc?.faseAtual, !!ultimoDoc(tcc?.documentos, 'VERSAO_FINAL'));
  const docsEsperados = DOCS_ESPERADOS.filter((t) => t !== 'VERSAO_FINAL' || mostrarVF).map((tipo) => ({
    tipo,
    doc: ultimoDoc(tcc?.documentos, tipo),
  }));

  return (
    <>
      {carregando ? (
        <p className="nota-vazio">Carregando…</p>
      ) : !tcc ? (
        <section className="cartao-secao bloco" style={{ textAlign: 'center' }}>
          <h2>Você ainda não iniciou seu TCC</h2>
          <p className="nota-vazio">Comece enviando a solicitação de orientação com os documentos iniciais.</p>
          {abertura?.bloqueado && (
            <div className="alerta alerta-erro" style={{ marginTop: 16, textAlign: 'left' }}>
              <strong>Prazo encerrado.</strong> O período de envio de documentos iniciais já terminou — peça uma liberação individual à coordenação.
            </div>
          )}
          <button
            className="botao"
            style={{ marginTop: 16 }}
            disabled={!!abertura?.bloqueado || carregandoAbertura}
            onClick={() => navegar('/aluno/abrir')}
          >
            Iniciar meu TCC
          </button>
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
              <div className="card-status-topo">
                <span className="card-status-titulo">Ação pendente</span>
                {acao.botao ? icoRelogio : null}
              </div>
              <div className="card-status-corpo">
                {!acao.botao && <span className="card-status-vazio-ico">{icoAlertaCirculo}</span>}
                <span className="forte">{acao.titulo}</span>
                <span className="sub">{acao.desc}</span>
                {acao.parecer && <span className="sub"><strong>Devolutiva:</strong> {acao.parecer}</span>}
                {acao.botao && acao.bloqueado && (
                  <span className="aviso-prazo">⏰ O prazo desta etapa venceu. Peça uma liberação à coordenação para enviar.</span>
                )}
                {acao.botao && (
                  <button className="botao" disabled={!!acao.bloqueado} onClick={acao.botao.ao}>{acao.botao.rotulo}</button>
                )}
              </div>
            </div>

            <div className="card-status">
              <div className="card-status-topo">
                <span className="card-status-titulo">Próximo prazo</span>
                {icoCalendario}
              </div>
              <div className="card-status-corpo">
                {prazo ? (
                  <>
                    <span className="grande">{ROTULO_MARCO[prazo.marco]}</span>
                    <span className="num">{fmtData(prazo.iso)}</span>
                  </>
                ) : (
                  <span className="grande">Sem prazos futuros</span>
                )}
              </div>
            </div>

            <div className="card-status card-roxo">
              <div className="card-status-topo">
                <span className="card-status-titulo">Fase atual</span>
                {icoAtividade}
              </div>
              <div className="card-status-corpo">
                {(() => {
                  const fs = faseMacroSub(tcc);
                  const chips = chipsTrilha(tcc);
                  return (
                    <>
                      <span className="fase">{fs.macro}</span>
                      {fs.sub && <span className="fase-sub">{fs.sub}</span>}
                      {chips.length > 0 && (
                        <span className="fase-chips">
                          {chips.map((c) => <span key={c.texto} className={`trilha-chip ${c.estado}`}>{c.texto}</span>)}
                        </span>
                      )}
                    </>
                  );
                })()}
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
              <TrilhaFases atual={idx} sub={subfaseTcc(tcc)} chips={chipsTrilha(tcc)} notas={notasTrilhaTcc(tcc, false)} />
            )}
          </section>

          {/* Documentos */}
          <section className="cartao-secao bloco">
            <div className="cabecalho-secao">
              <h2>Documentos</h2>
              <button className="link-inline" onClick={() => navegar('/aluno/documentos')}>Ver todos os documentos →</button>
            </div>
            <table className="tabela">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Documento</th>
                  <th>Arquivo</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {docsEsperados.map(({ tipo, doc }) => {
                  const st = doc
                    ? STATUS_DOC[doc.status] ?? { rotulo: doc.status, classe: 'pilula-neutra' }
                    : { rotulo: 'Aguardando envio', classe: 'pilula-neutra' };
                  return (
                    <tr key={tipo}>
                      <td>{doc ? fmtData(doc.criadoEm) : '—'}</td>
                      <td>{ROTULO_TIPO_DOC[tipo] ?? tipo}</td>
                      <td>{doc ? doc.nomeArquivo : <span className="nota-vazio" style={{ margin: 0 }}>—</span>}</td>
                      <td><span className={`pilula ${st.classe}`}>{st.rotulo}</span></td>
                      <td>
                        {doc && (
                          <span className="acoes-doc">
                            {/* Monografia, como no antigo: só baixar (sem visualizar). */}
                            {tipo !== 'MONOGRAFIA' && (
                              <a className="botao-icone" title="Visualizar" href={`${URL_API}/tccs/documentos/${doc.id}/visualizar`} target="_blank" rel="noreferrer">{icoOlho}</a>
                            )}
                            <a className="botao-icone" title="Baixar" href={`${URL_API}/tccs/documentos/${doc.id}/baixar`} target="_blank" rel="noreferrer">{icoBaixar}</a>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
              : 'Envie a versão final corrigida (PDF) para validação do orientador.'
          }
          rotulo={modalUpload === 'monografia' ? 'Monografia' : 'Versão final'}
          aoFechar={() => setModalUpload(null)}
          aoEnviado={() => { setModalUpload(null); carregar(); }}
        />
      )}
    </>
  );
}
