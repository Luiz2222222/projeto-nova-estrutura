// Seção "Banca e notas" SOMENTE LEITURA — mesmo visual do coordenador (PainelBancaTcc):
// card por fase (Fase I/II) e card por membro com nome + papel + status em pill, critérios
// separados (rótulo, nota / peso, comentário formatado) e nota total no rodapé. Sem parecer
// cru com "===". Reaproveitada na página do orientador e no Histórico do professor.
//
// notasLiberadas (tcc.nf != null): antes disso o backend sanitiza notas/parecer, então só o
// STATUS do membro aparece; depois, os critérios e o parecer completos.
import { CRITERIOS_FASE1, CRITERIOS_FASE2, colunaNota, type Criterio } from '@tcc/compartilhado';
import { extrairSecao, pesoDe, fmtNum, STATUS_AVAL } from '../utils/avaliacao';

const nomeComTrat = (p?: any) => (p ? `${p.tratamento ? p.tratamento + ' ' : ''}${p.nomeCompleto}` : '—');
const fmtNota = (v: any) => (v != null ? Number(v).toFixed(2).replace('.', ',') : '—');

// pesos = linha do calendário do semestre (para o denominador "/ peso"); se ausente, usa o
// peso padrão de cada critério (pesoDe faz esse fallback).
export function BancaNotasTcc({ tcc, pesos = null }: { tcc: any; pesos?: any }) {
  const bancas = [...(tcc?.bancas ?? [])].sort((a: any, b: any) => (a.fase < b.fase ? -1 : 1));
  // Mesmo critério do backend (sanitizarNotasTcc): nota final confirmada OU reprovação
  // terminal (resultado definitivo → o backend já envia as notas reais nesses casos).
  const notasLiberadas = tcc?.nf != null || ['REPROVADO_FASE_1', 'REPROVADO_FASE_2'].includes(tcc?.faseAtual);
  if (bancas.length === 0) return <p className="nota-vazio">Banca ainda não formada.</p>;
  return (
    <>
      {bancas.map((b: any) => {
        const ehF2b = b.fase === 'FASE_2';
        const criterios: Criterio[] = ehF2b ? CRITERIOS_FASE2 : CRITERIOS_FASE1;
        const membros = b.membros ?? [];
        let contaAval = 0;
        const papelDe = new Map<string, string>();
        for (const mm of membros) {
          const ehOri = ehF2b && mm.avaliadorId === tcc.orientadorId;
          papelDe.set(mm.id, ehOri ? 'Orientador' : `Avaliador ${++contaAval}`);
        }
        return (
          <div key={b.id} className="banca-fase">
            <div className="banca-fase-cab"><h3>{ehF2b ? 'Fase II' : 'Fase I'}</h3></div>
            {membros.length === 0 ? (
              <p className="nota-vazio">Sem membros nesta banca.</p>
            ) : (
              membros.map((m: any) => {
                const st = STATUS_AVAL[m.status] ?? { rotulo: m.status, classe: 'status-atencao' };
                const parecerGeral = extrairSecao(m.parecer ?? '', 'Parecer geral');
                return (
                  <div key={m.id} className="aval-card">
                    <div className="aval-card-top">
                      <span className="aval-nome">{nomeComTrat(m.avaliador)} <span className="aval-papel">({papelDe.get(m.id)})</span></span>
                      <span className={`status-pill ${st.classe}`}>{st.rotulo}</span>
                    </div>
                    {!notasLiberadas ? (
                      <p className="nota-vazio" style={{ marginTop: 8 }}>
                        {m.status === 'PENDENTE' ? 'Aguardando avaliação' : 'Avaliação registrada'}
                      </p>
                    ) : m.nota == null ? (
                      <p className="nota-vazio" style={{ marginTop: 8 }}>Avaliação ainda não enviada.</p>
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
                        <div className="aval-rodape"><span className="aval-total">Nota total: <strong>{fmtNota(m.nota)}</strong> / 10</span></div>
                      </>
                    )}
                  </div>
                );
              })
            )}
          </div>
        );
      })}
    </>
  );
}
