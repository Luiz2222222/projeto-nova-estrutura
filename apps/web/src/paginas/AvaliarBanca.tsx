// Página interna de avaliação da banca (professor/avaliador), espelhando o antigo:
// header com voltar + fase, dados do TCC, documento e formulário por critério
// (nota + comentário por critério, parecer geral, nota total ao vivo).
// O backend atual NÃO tem rascunho/bloqueio: se a avaliação já foi enviada
// (m.nota !== null) a tela fica em modo LEITURA; senão permite preencher e enviar.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiGet, apiPost, URL_API, type ErroApi } from '../api';
import { useAuth } from '../autenticacao/contexto';
import { ROTULO_FASE } from '../utils/fases';
import { CRITERIOS_FASE1, CRITERIOS_FASE2, colunaNota, colunaPeso, type Criterio } from '@tcc/compartilhado';

const ic = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {d.split('|').map((p, i) => <path key={i} d={p} />)}
  </svg>
);
const icoVoltar = ic('M19 12H5|M12 19l-7-7 7-7');
const icoOlho = ic('M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z|M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0');
const icoBaixar = ic('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4|M7 10l5 5 5-5|M12 15V3');
const icoDoc = ic('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z|M14 2v6h6');

const ultimaMonografia = (docs: any[] = []) => docs.filter((d) => d.tipo === 'MONOGRAFIA').sort((a, b) => b.versao - a.versao)[0] ?? null;
const fmt = (n: number) => String(n).replace('.', ',');
const parseBR = (v: string): number | null => {
  if (!v.trim()) return null;
  const n = parseFloat(v.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
// Máscara/clamp das notas (igual ao antigo): remove letras/símbolos, ponto vira
// vírgula, só uma vírgula, até 2 casas decimais, mantém estado intermediário ("1,")
// e mantém a nota entre 0 e o peso do critério (acima do peso → vira o peso).
function clampScore(raw: string, max: number, atual: string): string {
  if (raw === '') return '';
  const limpo = raw.replace(/[^\d,.]/g, '').replace(/\./g, ',');
  if ((limpo.match(/,/g) || []).length > 1) return atual; // mais de uma vírgula
  if (!/^\d{0,2}(,\d{0,2})?$/.test(limpo)) return atual; // até 2 inteiros + 2 decimais
  const num = parseBR(limpo);
  if (num !== null && !limpo.endsWith(',')) {
    const clamped = Math.max(0, Math.min(num, max));
    return String(clamped).replace('.', ',');
  }
  return limpo; // estado intermediário válido (ex.: "1,")
}
const numToStr = (v: any) => (v == null ? '' : String(v).replace('.', ','));

// Parecer estruturado: "=== Rótulo ===\ncomentário" por critério + "=== Parecer geral ===".
const stripHeader = (t: string) => t.replace(/^===\s*.+?\s*===\s*/i, '').trim();
function extrairSecao(parecer: string, secao: string): string {
  const re = new RegExp(`===\\s*${secao.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*===\\s*([\\s\\S]*?)(?=\\n===|$)`, 'i');
  const m = parecer.match(re);
  return m ? m[1].trim() : '';
}

export function AvaliarBanca() {
  const { membroId } = useParams<{ membroId: string }>();
  const navigate = useNavigate();
  const { usuario } = useAuth();

  const [itens, setItens] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [notas, setNotas] = useState<Record<string, string>>({});
  const [comentarios, setComentarios] = useState<Record<string, string>>({});
  const [parecerGeral, setParecerGeral] = useState('');
  const [erro, setErro] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [enviando, setEnviando] = useState(false);

  const prefixoLista = usuario?.papel === 'AVALIADOR' ? '/avaliador/bancas' : usuario?.papel === 'PROFESSOR' ? '/professor/bancas' : '/bancas';

  useEffect(() => {
    apiGet('/bancas/minhas').then((r: any) => setItens(r ?? [])).catch(() => setItens([])).finally(() => setCarregando(false));
  }, []);

  const m = useMemo(() => itens.find((x) => x.id === membroId), [itens, membroId]);
  const fase: string | undefined = m?.banca?.fase;
  const ehF2 = fase === 'FASE_2';
  const criterios: Criterio[] = ehF2 ? CRITERIOS_FASE2 : CRITERIOS_FASE1;
  const status: string = m?.status ?? 'PENDENTE';
  const faseAval = ehF2 ? 'AVALIACAO_FASE_2' : 'AVALIACAO_FASE_1';
  const faseValid = ehF2 ? 'VALIDACAO_FASE_2' : 'VALIDACAO_FASE_1';
  const faseAtual: string | undefined = m?.banca?.tcc?.faseAtual;
  const emAvaliacao = faseAtual === faseAval;
  const emValidacao = faseAtual === faseValid;
  // Editável enquanto não bloqueada/concluída e dentro da janela (avaliação ou validação).
  const editavel = !!m && (status === 'PENDENTE' || status === 'ENVIADO') && (emAvaliacao || emValidacao);
  const podeRascunho = editavel && emAvaliacao; // rascunho (des-enviar) só durante a avaliação
  const leitura = !editavel;

  // Carrega o que estiver salvo (rascunho ou avaliação enviada).
  useEffect(() => {
    if (!m) return;
    const ns: Record<string, string> = {};
    const cs: Record<string, string> = {};
    for (const c of criterios) {
      ns[c.chave] = numToStr(m[colunaNota(c.chave)]);
      cs[c.chave] = extrairSecao(m.parecer ?? '', c.rotulo);
    }
    setNotas(ns);
    setComentarios(cs);
    setParecerGeral(extrairSecao(m.parecer ?? '', 'Parecer geral'));
  }, [m?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const peso = (c: Criterio) => Number(m?.pesos?.[colunaPeso(c.chave)] ?? c.pesoPadrao);

  const total = useMemo(() => {
    let soma = 0;
    for (const c of criterios) {
      const n = parseBR(notas[c.chave] ?? '');
      if (n == null) return null;
      soma += n;
    }
    return soma;
  }, [notas, criterios]);

  function construirParecer(): string {
    const partes: string[] = [];
    for (const c of criterios) {
      const t = stripHeader((comentarios[c.chave] ?? '').trim());
      if (t) partes.push(`=== ${c.rotulo} ===\n${t}`);
    }
    const g = stripHeader(parecerGeral.trim());
    if (g) partes.push(`=== Parecer geral ===\n${g}`);
    return partes.join('\n\n');
  }

  async function recarregar() {
    const r = await apiGet('/bancas/minhas').catch(() => null);
    if (r) setItens(r as any[]);
  }

  // finalizar=false → salva rascunho (notas parciais); finalizar=true → envia (exige todas).
  async function salvar(finalizar: boolean) {
    setErro('');
    setMensagem('');
    const corpo: Record<string, number> = {};
    for (const c of criterios) {
      const n = parseBR(notas[c.chave] ?? '');
      if (n == null) {
        if (finalizar) return setErro(`Preencha a nota de "${c.rotulo}" para enviar.`);
        continue; // rascunho: pula nota vazia
      }
      if (n < 0 || n > peso(c)) return setErro(`A nota de "${c.rotulo}" deve estar entre 0 e ${fmt(peso(c))}.`);
      corpo[c.chave] = n;
    }
    setEnviando(true);
    try {
      await apiPost(`/bancas/${m.bancaId}/avaliar`, { notas: corpo, parecer: construirParecer() || undefined, finalizar });
      await recarregar();
      setMensagem(finalizar ? 'Avaliação enviada.' : 'Rascunho salvo.');
    } catch (e) {
      setErro((e as ErroApi).mensagem || 'Não foi possível salvar.');
    } finally {
      setEnviando(false);
    }
  }

  if (carregando) return <p className="nota-vazio">Carregando…</p>;

  if (!m) {
    return (
      <div className="det-cabecalho">
        <button className="det-voltar" onClick={() => navigate(prefixoLista)}>{icoVoltar} Voltar para lista</button>
        <section className="cartao-secao bloco"><p className="nota-vazio">Avaliação não encontrada.</p></section>
      </div>
    );
  }

  const tcc = m.banca.tcc;
  const doc = m.banca.documentoAvaliacao ?? ultimaMonografia(tcc.documentos);
  const ehDocBanca = !!m.banca.documentoAvaliacao;
  const numCor = ehF2 ? 'var(--roxo)' : 'var(--azul-forte)';

  const temRascunhoSalvo = criterios.some((c) => m[colunaNota(c.chave)] != null) || !!m.parecer;
  const STATUS_INFO: Record<string, { rotulo: string; classe: string }> = {
    ENVIADO: { rotulo: 'Enviada', classe: 'status-normal' },
    BLOQUEADO: { rotulo: 'Bloqueada', classe: 'status-urgente' },
    CONCLUIDO: { rotulo: 'Concluída', classe: 'status-normal' },
  };
  const statusRotulo = status === 'PENDENTE' ? (temRascunhoSalvo ? 'Rascunho' : 'Pendente') : STATUS_INFO[status]?.rotulo ?? status;
  const statusClasse = status === 'PENDENTE' ? 'status-atencao' : STATUS_INFO[status]?.classe ?? 'status-atencao';
  const rotuloEnviar = status === 'ENVIADO' ? 'Reenviar avaliação' : 'Enviar avaliação';

  return (
    <>
      {/* Cabeçalho */}
      <div className="det-cabecalho">
        <button className="det-voltar" onClick={() => navigate(prefixoLista)}>{icoVoltar} Voltar para lista</button>
        <div className="det-titulo-area">
          <h1>{tcc.titulo}</h1>
          <div className="det-badges">
            <span className="badge-papel">{ehF2 ? 'Fase II' : 'Fase I'}</span>
            <span className={`status-pill ${statusClasse}`}>{statusRotulo}</span>
          </div>
        </div>
      </div>

      {/* Dados do TCC + documento */}
      <section className="cartao-secao bloco">
        <h2>{ehF2 ? 'Avaliação da Apresentação' : 'Avaliação da Monografia'}</h2>
        <div className="info-lista" style={{ marginBottom: 14 }}>
          <div className="info-campo"><span className="info-rotulo">Aluno</span><span className="info-valor">{tcc.aluno?.nomeCompleto ?? '—'}</span></div>
          <div className="info-campo"><span className="info-rotulo">Fase atual</span><span className="info-valor">{ROTULO_FASE[tcc.faseAtual] ?? tcc.faseAtual}</span></div>
        </div>
        {doc ? (
          <div className="item-arquivo">
            <div className="item-arquivo-info">
              {icoDoc}
              <div>
                <span className="nome">{ehDocBanca ? 'Documento para avaliação' : 'Monografia'}</span>
                <span className="meta">{doc.nomeArquivo}</span>
              </div>
            </div>
            <span className="acoes-doc">
              <a className="botao-icone" title="Visualizar" href={`${URL_API}/tccs/documentos/${doc.id}/visualizar`} target="_blank" rel="noreferrer">{icoOlho}</a>
              <a className="botao-icone" title="Baixar" href={`${URL_API}/tccs/documentos/${doc.id}/baixar`} target="_blank" rel="noreferrer">{icoBaixar}</a>
            </span>
          </div>
        ) : (
          <p className="nota-vazio">Documento ainda não disponível.</p>
        )}
      </section>

      {/* Formulário por critérios */}
      <section className="cartao-secao bloco">
        {erro && <div className="erro-geral">{erro}</div>}
        {mensagem && <div className="alerta" style={{ background: 'var(--aprovado-suave)', color: 'var(--aprovado)', marginBottom: 14 }}>{mensagem}</div>}
        {leitura && (
          <div className="alerta" style={{ background: 'rgba(245,158,11,.12)', color: '#b45309', marginBottom: 14 }}>
            {status === 'BLOQUEADO'
              ? 'Avaliação bloqueada pela coordenação — não é possível editar.'
              : status === 'CONCLUIDO'
                ? 'Fase concluída — esta avaliação está encerrada (somente leitura).'
                : 'Esta fase ainda não está liberada para avaliação. Você poderá avaliar quando o TCC chegar à fase correspondente.'}
          </div>
        )}
        <div className="criterios-lista">
          {criterios.map((c, i) => (
            <div key={c.chave} className="criterio-card">
              <span className="criterio-num" style={{ background: numCor }}>{i + 1}</span>
              <div className="criterio-corpo">
                <div className="criterio-cabecalho">
                  <span className="criterio-titulo">{c.rotulo}</span>
                  <span className="criterio-nota">
                    <input
                      inputMode="decimal"
                      value={notas[c.chave] ?? ''}
                      disabled={leitura || enviando}
                      onChange={(e) => setNotas((v) => ({ ...v, [c.chave]: clampScore(e.target.value, peso(c), v[c.chave] ?? '') }))}
                      placeholder="–"
                    />
                    <span className="criterio-peso">/ {fmt(Number(peso(c).toFixed(1)))}</span>
                  </span>
                </div>
                <p className="criterio-desc">{c.descricao}</p>
                <textarea
                  rows={2}
                  className="criterio-comentario"
                  value={comentarios[c.chave] ?? ''}
                  disabled={leitura || enviando}
                  onChange={(e) => setComentarios((v) => ({ ...v, [c.chave]: e.target.value }))}
                  placeholder={leitura ? 'Sem comentário.' : 'Justifique a nota atribuída…'}
                />
              </div>
            </div>
          ))}
        </div>

        <label className="campo" style={{ marginTop: 16 }}>
          <span>Parecer geral (opcional)</span>
          <textarea rows={4} value={parecerGeral} disabled={leitura || enviando} onChange={(e) => setParecerGeral(e.target.value)} placeholder={leitura ? 'Sem parecer geral.' : 'Comentários gerais sobre o trabalho…'} />
        </label>

        <div className="nota-total-box">
          <span>Nota total{ehF2 ? ' (NF2)' : ' (NF1)'}:</span>
          <strong>{total != null ? fmt(Number(total.toFixed(2))) : '—'}</strong>
          <span className="nota-total-max">/ 10,0</span>
        </div>

        <div className="acoes" style={{ justifyContent: 'flex-start' }}>
          <button className="botao botao-secundario" disabled={enviando} onClick={() => navigate(prefixoLista)}>Voltar</button>
          {podeRascunho && (
            <button className="botao botao-secundario" disabled={enviando} onClick={() => salvar(false)}>
              {enviando ? 'Salvando…' : 'Salvar rascunho'}
            </button>
          )}
          {editavel && (
            <button className="botao" disabled={enviando || total == null} onClick={() => salvar(true)}>
              {enviando ? 'Enviando…' : rotuloEnviar}
            </button>
          )}
        </div>
      </section>
    </>
  );
}
