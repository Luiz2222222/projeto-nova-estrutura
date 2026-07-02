// Aba "Banca e notas" do modal único de edição do TCC (coordenador).
// Lista Fase I/Fase II com notas por critério/comentário/status; edita a avaliação de
// um membro (PUT /bancas/membros/:id/avaliacao) e troca os 2 avaliadores da Fase I
// (PUT /tccs/:id/banca/avaliadores, que sincroniza a Fase II). Respeita os guards de
// fase do backend (bloqueia depois de validada/concluída).
import { useEffect, useState } from 'react';
import { apiGet, apiPut, type ErroApi } from '../api';
import { CRITERIOS_FASE1, CRITERIOS_FASE2, colunaNota, type Criterio } from '@tcc/compartilhado';
import { clampScore, construirParecer, extrairSecao, fmtNota, fmtNum, numToStr, parseBR, pesoDe, STATUS_AVAL } from '../utils/avaliacao';

const STATUS_OPCOES = [
  { v: 'PENDENTE', r: 'Pendente (rascunho — aceita parcial)' },
  { v: 'ENVIADO', r: 'Enviado' },
  { v: 'EM_ANALISE', r: 'Em análise da coordenação' },
  { v: 'AJUSTE_SOLICITADO', r: 'Ajuste solicitado' },
  { v: 'APROVADO', r: 'Aprovado pela coordenação' },
  { v: 'BLOQUEADO', r: 'Bloqueado' },
  { v: 'CONCLUIDO', r: 'Concluído' },
];
const nomeComTrat = (p?: any) => (p ? `${p.tratamento ? p.tratamento + ' ' : ''}${p.nomeCompleto}` : '—');
const rotuloCandidato = (c: any) =>
  `${c.tratamento ? c.tratamento + ' ' : ''}${c.nomeCompleto}${c.papel === 'AVALIADOR' ? ` (Externo${c.afiliacao ? ' · ' + c.afiliacao : ''})` : ' (Professor)'}`;

// Formulário inline de edição da avaliação de um membro.
function FormAvaliacao({ membro, fase, pesos, aoSalvo, aoFechar }: { membro: any; fase: string; pesos: any; aoSalvo: () => void; aoFechar: () => void }) {
  const ehF2 = fase === 'FASE_2';
  const criterios: Criterio[] = ehF2 ? CRITERIOS_FASE2 : CRITERIOS_FASE1;
  const [notas, setNotas] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    for (const c of criterios) o[c.chave] = numToStr(membro[colunaNota(c.chave)]);
    return o;
  });
  const [comentarios, setComentarios] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    for (const c of criterios) o[c.chave] = extrairSecao(membro.parecer ?? '', c.rotulo);
    return o;
  });
  const [parecerGeral, setParecerGeral] = useState(extrairSecao(membro.parecer ?? '', 'Parecer geral'));
  const [status, setStatus] = useState(membro.status ?? 'PENDENTE');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  const total = (() => {
    let s = 0;
    for (const c of criterios) {
      const n = parseBR(notas[c.chave] ?? '');
      if (n == null) return null;
      s += n;
    }
    return s;
  })();
  const numCor = ehF2 ? 'var(--roxo)' : 'var(--azul-forte)';

  async function salvar() {
    setErro('');
    const exigeCompleto = status === 'ENVIADO' || status === 'BLOQUEADO' || status === 'CONCLUIDO';
    const corpo: Record<string, number> = {};
    for (const c of criterios) {
      const n = parseBR(notas[c.chave] ?? '');
      if (n == null) {
        if (exigeCompleto) return setErro(`Para o status "${status}", preencha a nota de "${c.rotulo}".`);
        continue;
      }
      if (n < 0 || n > pesoDe(c, pesos)) return setErro(`A nota de "${c.rotulo}" deve estar entre 0 e ${fmtNum(pesoDe(c, pesos))}.`);
      corpo[c.chave] = n;
    }
    setSalvando(true);
    try {
      await apiPut(`/bancas/membros/${membro.id}/avaliacao`, { notas: corpo, parecer: construirParecer(criterios, comentarios, parecerGeral) || undefined, status });
      aoSalvo();
      aoFechar();
    } catch (e) {
      const er = e as ErroApi;
      setErro(er.erros?.[0]?.mensagem || er.mensagem || 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="aval-edit">
      {erro && <div className="erro-geral">{erro}</div>}
      <label className="campo"><span>Status</span>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>{STATUS_OPCOES.map((s) => <option key={s.v} value={s.v}>{s.r}</option>)}</select>
      </label>
      <div className="criterios-lista" style={{ marginTop: 12 }}>
        {criterios.map((c, i) => (
          <div key={c.chave} className="criterio-card">
            <span className="criterio-num" style={{ background: numCor }}>{i + 1}</span>
            <div className="criterio-corpo">
              <div className="criterio-cabecalho">
                <span className="criterio-titulo">{c.rotulo}</span>
                <span className="criterio-nota">
                  <input inputMode="decimal" value={notas[c.chave] ?? ''} disabled={salvando}
                    onChange={(e) => setNotas((v) => ({ ...v, [c.chave]: clampScore(e.target.value, pesoDe(c, pesos), v[c.chave] ?? '') }))} placeholder="–" />
                  <span className="criterio-peso">/ {fmtNum(Number(pesoDe(c, pesos).toFixed(1)))}</span>
                </span>
              </div>
              <p className="criterio-desc">{c.descricao}</p>
              <textarea rows={2} className="criterio-comentario" value={comentarios[c.chave] ?? ''} disabled={salvando}
                onChange={(e) => setComentarios((v) => ({ ...v, [c.chave]: e.target.value }))} placeholder="Comentário do critério…" />
            </div>
          </div>
        ))}
      </div>
      <label className="campo" style={{ marginTop: 12 }}><span>Parecer geral</span><textarea rows={3} value={parecerGeral} disabled={salvando} onChange={(e) => setParecerGeral(e.target.value)} /></label>
      <div className="nota-total-box">
        <span>Nota total{ehF2 ? ' (NF2)' : ' (NF1)'}:</span>
        <strong>{total != null ? fmtNum(Number(total.toFixed(2))) : '—'}</strong>
        <span className="nota-total-max">/ 10,0</span>
      </div>
      <div className="acoes" style={{ justifyContent: 'space-between' }}>
        <button className="botao botao-secundario" disabled={salvando} onClick={aoFechar}>Cancelar</button>
        <button className="botao" disabled={salvando} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar'}</button>
      </div>
    </div>
  );
}

// Formulário inline para trocar os 2 avaliadores da Fase I.
function FormTrocar({ tccId, membrosFase1, aoSalvo, aoFechar }: { tccId: string; membrosFase1: any[]; aoSalvo: () => void; aoFechar: () => void }) {
  const [candidatos, setCandidatos] = useState<any[]>([]);
  const [a1, setA1] = useState(membrosFase1?.[0]?.avaliadorId ?? '');
  const [a2, setA2] = useState(membrosFase1?.[1]?.avaliadorId ?? '');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    apiGet(`/tccs/${tccId}/banca/candidatos`).then((r: any) => setCandidatos(r ?? [])).catch(() => setCandidatos([]));
  }, [tccId]);

  async function salvar() {
    setErro('');
    if (!a1 || !a2) return setErro('Escolha os dois avaliadores.');
    if (a1 === a2) return setErro('Os dois avaliadores devem ser pessoas diferentes.');
    setSalvando(true);
    try {
      await apiPut(`/tccs/${tccId}/banca/avaliadores`, { avaliadorIds: [a1, a2] });
      aoSalvo();
      aoFechar();
    } catch (e) {
      const er = e as ErroApi;
      setErro(er.erros?.[0]?.mensagem || er.mensagem || 'Não foi possível trocar os avaliadores.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="aval-edit">
      {erro && <div className="erro-geral">{erro}</div>}
      <div className="alerta" style={{ background: 'rgba(245,158,11,.12)', color: '#b45309', marginBottom: 12 }}>
        ⚠ Trocar um avaliador <strong>descarta a avaliação dele</strong>; o novo entra pendente. A Fase II é sincronizada (orientador + estes 2).
      </div>
      <div className="grade-2">
        <label className="campo"><span>Avaliador 1</span>
          <select value={a1} onChange={(e) => setA1(e.target.value)}><option value="">Selecione…</option>{candidatos.filter((c) => c.id !== a2).map((c) => <option key={c.id} value={c.id}>{rotuloCandidato(c)}</option>)}</select>
        </label>
        <label className="campo"><span>Avaliador 2</span>
          <select value={a2} onChange={(e) => setA2(e.target.value)}><option value="">Selecione…</option>{candidatos.filter((c) => c.id !== a1).map((c) => <option key={c.id} value={c.id}>{rotuloCandidato(c)}</option>)}</select>
        </label>
      </div>
      <div className="acoes" style={{ justifyContent: 'flex-end' }}>
        <button className="botao botao-secundario" disabled={salvando} onClick={aoFechar}>Cancelar</button>
        <button className="botao" disabled={salvando || !a1 || !a2 || a1 === a2} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar avaliadores'}</button>
      </div>
    </div>
  );
}

export function PainelBancaTcc({ tcc, pesos, aoSalvo }: { tcc: any; pesos: any; aoSalvo: () => void }) {
  const [editandoMembro, setEditandoMembro] = useState<string | null>(null);
  const [trocando, setTrocando] = useState(false);
  const [colapsadas, setColapsadas] = useState<Set<string>>(new Set()); // Fase I/II abertas por padrão.
  const alternar = (id: string) =>
    setColapsadas((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const fase = tcc.faseAtual as string;
  const bancas = [...(tcc.bancas ?? [])].sort((a: any, b: any) => (a.fase < b.fase ? -1 : 1));

  // Edição administrativa do coordenador é SEMPRE permitida neste modal (endpoint só de
  // coordenador; o backend recalcula NF1/NF2/NF/resultado ao editar fases já validadas).
  const podeTrocarAvaliadores = ['FORMACAO_BANCA_FASE_1', 'AVALIACAO_FASE_1', 'AGUARDANDO_ANALISE_COORDENACAO_FASE_1'].includes(fase);

  if (bancas.length === 0) return <p className="nota-vazio">Banca ainda não formada.</p>;

  return (
    <>
      {bancas.map((b: any) => {
        const ehF2 = b.fase === 'FASE_2';
        const criterios: Criterio[] = ehF2 ? CRITERIOS_FASE2 : CRITERIOS_FASE1;
        const membros = b.membros ?? [];
        const aberta = !colapsadas.has(b.id);
        // Papel de cada membro: Fase II → Orientador + Avaliador 1/2; Fase I → Avaliador 1/2.
        let contaAval = 0;
        const papelDe = new Map<string, string>();
        for (const mm of membros) {
          const ehOri = ehF2 && mm.avaliadorId === tcc.orientadorId;
          papelDe.set(mm.id, ehOri ? 'Orientador' : `Avaliador ${++contaAval}`);
        }
        return (
          <div key={b.id} className="banca-fase">
            <div className="banca-fase-cab">
              <button type="button" className="banca-fase-toggle" onClick={() => alternar(b.id)} aria-expanded={aberta}>
                <span className="banca-caret">{aberta ? '▾' : '▸'}</span>
                <h3>{ehF2 ? 'Fase II' : 'Fase I'}</h3>
              </button>
              {aberta && !ehF2 && membros.length > 0 && podeTrocarAvaliadores && (
                <button className="botao botao-secundario" onClick={() => setTrocando((v) => !v)}>{trocando ? 'Fechar' : 'Trocar avaliadores'}</button>
              )}
            </div>
            {aberta && (<>
            {!ehF2 && trocando && <FormTrocar tccId={tcc.id} membrosFase1={membros} aoSalvo={aoSalvo} aoFechar={() => setTrocando(false)} />}
            {membros.length === 0 ? (
              <p className="nota-vazio">Sem membros nesta banca.</p>
            ) : (
              membros.map((m: any) => {
                const st = STATUS_AVAL[m.status] ?? { rotulo: m.status, classe: 'status-atencao' };
                const parecerGeral = extrairSecao(m.parecer ?? '', 'Parecer geral');
                // Por padrão em leitura; "Editar" abre o formulário (que traz Cancelar/Salvar).
                const editando = editandoMembro === m.id;
                return (
                  <div key={m.id} className="aval-card">
                    <div className="aval-card-top">
                      <span className="aval-nome">{nomeComTrat(m.avaliador)} <span className="aval-papel">({papelDe.get(m.id)})</span></span>
                      <span className={`status-pill ${st.classe}`}>{st.rotulo}</span>
                    </div>
                    {editando ? (
                      <FormAvaliacao membro={m} fase={b.fase} pesos={pesos} aoSalvo={() => { setEditandoMembro(null); aoSalvo(); }} aoFechar={() => setEditandoMembro(null)} />
                    ) : (
                      <>
                        <div className="aval-criterios">
                          {criterios.map((c) => {
                            const com = extrairSecao(m.parecer ?? '', c.rotulo);
                            return (
                              <div key={c.chave} className="aval-criterio">
                                <span className="aval-criterio-rot">{c.rotulo}</span>
                                <span className="aval-criterio-nota">{fmtNota(m[colunaNota(c.chave)])} <small>/ {fmtNum(Number(pesoDe(c, pesos).toFixed(1)))}</small></span>
                                {com && <span className="aval-criterio-com">{com}</span>}
                              </div>
                            );
                          })}
                        </div>
                        {parecerGeral && <p className="aval-parecer"><strong>Parecer geral:</strong> {parecerGeral}</p>}
                        <div className="aval-rodape">
                          <span className="aval-total">Nota total: <strong>{fmtNota(m.nota)}</strong> / 10</span>
                          <button className="botao botao-secundario" onClick={() => setEditandoMembro(m.id)}>Editar</button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })
            )}
            </>)}
          </div>
        );
      })}
    </>
  );
}
