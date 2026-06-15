import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, URL_API } from '../../api';
import { ROTULO_TIPO_DOC } from '../../utils/fases';

function formatarTamanho(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// dd/MM/yyyy (split da ISO evita "voltar" um dia por fuso).
const fmtData = (iso?: string | null) => {
  if (!iso) return '';
  const [ano, mes, dia] = iso.split('T')[0].split('-');
  return `${dia}/${mes}/${ano}`;
};

const STATUS_DOC: Record<string, { rotulo: string; classe: string }> = {
  APROVADO: { rotulo: 'Aprovado', classe: 'pilula-ok' },
  REJEITADO: { rotulo: 'Rejeitado', classe: 'pilula-bad' },
  PENDENTE: { rotulo: 'Em análise', classe: 'pilula-neutra' },
};
const TIPOS_FILTRO = ['PLANO_DESENVOLVIMENTO', 'TERMO_ACEITE', 'MONOGRAFIA', 'VERSAO_FINAL'] as const;
const STATUS_FILTRO = ['PENDENTE', 'APROVADO', 'REJEITADO'] as const;

const ic = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {d.split('|').map((p, i) => <path key={i} d={p} />)}
  </svg>
);
const icoArquivo = ic('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z|M14 2v6h6|M16 13H8|M16 17H8|M10 9H8');
const icoOlho = ic('M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z|M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0');
const icoBaixar = ic('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4|M7 10l5 5 5-5|M12 15V3');

export function Documentos() {
  const navegar = useNavigate();
  const [tcc, setTcc] = useState<any | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [filtroTipo, setFiltroTipo] = useState('TODOS');
  const [filtroStatus, setFiltroStatus] = useState('TODOS');

  useEffect(() => {
    apiGet('/tccs/meu')
      .then(setTcc)
      .catch(() => setTcc(null))
      .finally(() => setCarregando(false));
  }, []);

  if (carregando) return <p className="nota-vazio">Carregando…</p>;

  if (!tcc) {
    return (
      <>
        <h1>Documentos</h1>
        <p className="legenda">Arquivos enviados ao longo do seu TCC.</p>
        <section className="cartao-secao bloco" style={{ textAlign: 'center' }}>
          <p className="nota-vazio">Você ainda não iniciou seu TCC, então não há documentos.</p>
          <button className="botao" style={{ marginTop: 16 }} onClick={() => navegar('/aluno/abrir')}>
            Iniciar meu TCC
          </button>
        </section>
      </>
    );
  }

  const docs: any[] = tcc.documentos ?? [];
  const filtrados = docs.filter(
    (d) => (filtroTipo === 'TODOS' || d.tipo === filtroTipo) && (filtroStatus === 'TODOS' || d.status === filtroStatus),
  );

  return (
    <>
      <h1>Documentos</h1>
      <p className="legenda">Arquivos enviados ao longo do seu TCC.</p>

      {docs.length > 0 && (
        <section className="cartao-secao bloco">
          <div className="filtros">
            <label className="campo">
              <span>Filtrar por tipo</span>
              <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
                <option value="TODOS">Todos os tipos</option>
                {TIPOS_FILTRO.map((t) => (
                  <option key={t} value={t}>{ROTULO_TIPO_DOC[t] ?? t}</option>
                ))}
              </select>
            </label>
            <label className="campo">
              <span>Filtrar por status</span>
              <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}>
                <option value="TODOS">Todos os status</option>
                {STATUS_FILTRO.map((s) => (
                  <option key={s} value={s}>{STATUS_DOC[s].rotulo}</option>
                ))}
              </select>
            </label>
          </div>
        </section>
      )}

      <section className="cartao-secao bloco">
        <h2>Enviados</h2>
        {filtrados.length ? (
          <ul className="lista-arquivos">
            {filtrados.map((d) => {
              const st = STATUS_DOC[d.status] ?? { rotulo: d.status, classe: 'pilula-neutra' };
              return (
                <li key={d.id} className="item-arquivo">
                  <div className="item-arquivo-info">
                    {icoArquivo}
                    <div>
                      <span className="nome">
                        {ROTULO_TIPO_DOC[d.tipo] ?? d.tipo} <span className={`pilula ${st.classe}`}>{st.rotulo}</span>
                      </span>
                      <span className="meta">
                        {d.nomeArquivo}
                        {d.tipo === 'MONOGRAFIA' ? ` · Versão ${d.versao}` : ''}
                        {d.criadoEm ? ` · ${fmtData(d.criadoEm)}` : ''}
                        {d.tamanho ? ` · ${formatarTamanho(d.tamanho)}` : ''}
                      </span>
                      {d.status === 'REJEITADO' && d.parecer && (
                        <span className="feedback-rejeicao"><strong>Feedback do orientador:</strong> {d.parecer}</span>
                      )}
                    </div>
                  </div>
                  <span className="acoes-doc">
                    {/* Monografia, como no antigo: só baixar (sem visualizar). */}
                    {d.tipo !== 'MONOGRAFIA' && (
                      <a className="botao-icone" title="Visualizar" href={`${URL_API}/tccs/documentos/${d.id}/visualizar`} target="_blank" rel="noreferrer">{icoOlho}</a>
                    )}
                    <a className="botao-icone" title="Baixar" href={`${URL_API}/tccs/documentos/${d.id}/baixar`} target="_blank" rel="noreferrer">{icoBaixar}</a>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="nota-vazio">
            {docs.length ? 'Nenhum documento encontrado com os filtros selecionados.' : 'Nenhum documento enviado.'}
          </p>
        )}
      </section>
    </>
  );
}
