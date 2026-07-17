// Aba "Informações" do aluno (espelha o projeto antigo): Datas do período (calendário
// definido pela coordenação) + Documentos de referência (modelos enviados pela coordenação).
import { useEffect, useState, type ReactNode } from 'react';
import { apiGet, URL_API } from '../../api';
import { MARCOS_CALENDARIO, ROTULO_MARCO, DESC_MARCO, type MarcoCalendario } from '@tcc/compartilhado';

// dd/MM/yyyy (formato do projeto antigo). Datas do calendário são UTC; o split evita "voltar" um dia.
function formatarData(valor?: string | null): string {
  if (!valor) return '--';
  const [ano, mes, dia] = valor.split('T')[0].split('-');
  return `${dia}/${mes}/${ano}`;
}
function formatarTamanho(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ic = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {d.split('|').map((p, i) => <path key={i} d={p} />)}
  </svg>
);
const icoUsers = ic('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2|M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8|M22 21v-2a4 4 0 0 0-3-3.87|M16 3.13a4 4 0 0 1 0 7.75');
const icoArquivo = ic('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z|M14 2v6h6|M16 13H8|M16 17H8|M10 9H8');
const icoRelogio = ic('M12 7v5l3 2|M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0');
const icoPasta = ic('M20 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2|M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2');
const icoLivro = ic('M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z|M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z');
const icoCheck = ic('M22 11.08V12a10 10 0 1 1-5.93-9.14|M22 4 12 14.01l-3-3');
const icoCalendario = ic('M16 2v4M8 2v4M3 10h18|M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2');
const icoBaixar = ic('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4|M7 10l5 5 5-5|M12 15V3');
const icoOlho = ic('M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z|M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0');

// Ícone + cor por etapa, espelhando o painel de datas do projeto antigo.
const MARCO_INFO: Record<MarcoCalendario, { icone: ReactNode; cor: string }> = {
  reuniaoAlunos: { icone: icoUsers, cor: '#3b82f6' },
  envioDocumentos: { icone: icoArquivo, cor: '#3b82f6' },
  avaliacaoContinuidade: { icone: icoRelogio, cor: '#eab308' },
  submissaoMonografia: { icone: icoArquivo, cor: '#eab308' },
  preparacaoBancasFase1: { icone: icoPasta, cor: '#a855f7' },
  avaliacaoFase1: { icone: icoLivro, cor: '#a855f7' },
  preparacaoBancasFase2: { icone: icoPasta, cor: '#ef4444' },
  apresentacaoFase2: { icone: icoUsers, cor: '#3b82f6' },
  ajustesFinais: { icone: icoCheck, cor: '#22c55e' },
};

export function Informacoes() {
  const [calendario, setCalendario] = useState<any | null>(null);
  const [modelos, setModelos] = useState<any[]>([]);

  useEffect(() => {
    apiGet('/calendario').then(setCalendario).catch(() => setCalendario(null));
    apiGet<any[]>('/documentos-referencia').then(setModelos).catch(() => setModelos([]));
  }, []);

  return (
    <>
      <h1>Informações</h1>
      <p className="legenda">Datas importantes do semestre e documentos de referência.</p>

      <section className="cartao-secao bloco">
        <h2 className="h2-icone">
          <span className="h2-ico">{icoCalendario}</span>
          Datas do período{calendario?.semestre ? ` - ${calendario.semestre}` : ''}
        </h2>
        <p className="legenda" style={{ marginBottom: 18 }}>
          As datas de cada etapa são definidas pela coordenação a cada semestre.
        </p>
        <div className="marcos-lista">
          {MARCOS_CALENDARIO.map((m) => {
            const info = MARCO_INFO[m];
            const data = calendario?.[m];
            return (
              <div key={m} className="marco-linha">
                <span className="marco-icone" style={{ background: `${info.cor}1f`, color: info.cor }}>{info.icone}</span>
                <div className="marco-texto">
                  <span className="marco-titulo">{ROTULO_MARCO[m]}</span>
                  <span className="marco-desc">{DESC_MARCO[m]}</span>
                </div>
                <span className={`marco-data${data ? ' definida' : ''}`}>{formatarData(data)}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="cartao-secao bloco">
        <h2 className="h2-icone">
          <span className="h2-ico">{icoArquivo}</span>
          Documentos de referência
        </h2>
        <p className="legenda" style={{ marginBottom: 18 }}>
          Baixe os modelos e orientações disponibilizados pela coordenação.
        </p>
        {modelos.length ? (
          <div className="ref-grid">
            {modelos.map((d) => (
              <div key={d.id} className="ref-card">
                <span className="ref-icone">{icoArquivo}</span>
                <div className="ref-texto">
                  <span className="nome">{d.titulo}</span>
                  <span className="meta">
                    {d.nomeArquivo}
                    {d.tamanho ? ` · ${formatarTamanho(d.tamanho)}` : ''}
                  </span>
                </div>
                <span className="acoes-doc">
                  <a className="botao-icone" title="Visualizar" href={`${URL_API}/documentos-referencia/${d.id}/visualizar`} target="_blank" rel="noreferrer">
                    {icoOlho}
                  </a>
                  <a className="botao-icone" title="Baixar" href={`${URL_API}/documentos-referencia/${d.id}/baixar`} target="_blank" rel="noreferrer">
                    {icoBaixar}
                  </a>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="estado-vazio" style={{ padding: '12px 0' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <p className="nota-vazio" style={{ marginTop: 8 }}>Nenhum documento disponível no momento.</p>
          </div>
        )}
      </section>
    </>
  );
}
