import { useEffect, useMemo, useState } from 'react';
import { apiGet } from '../../api';
import { ROTULO_CURSO } from '@tcc/compartilhado';

// Lista do período (espelha o original): todos os alunos cruzados com o TCC do
// semestre atual, classificando o envio inicial pelo fluxo de Solicitação.

type Status = 'Aprovado' | 'Aprovação pendente' | 'Não enviado';

type AlunoLista = {
  alunoId: string;
  alunoNome: string;
  email: string | null;
  curso: string | null;
  dataEnvio: string | null;
  status: Status;
};

type Resposta = {
  semestre: string | null;
  prazoEnvio: string | null;
  alunos: AlunoLista[];
};

const PILULA: Record<Status, string> = {
  Aprovado: 'pilula-ok',
  'Aprovação pendente': 'pilula-alerta',
  'Não enviado': 'pilula-bad',
};

const cursoDe = (c: string | null) => (c ? (ROTULO_CURSO as Record<string, string>)[c] ?? c : '—');

function formatarData(iso: string | null): string {
  if (!iso) return '—';
  const [ano, mes, dia] = iso.slice(0, 10).split('-');
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : '—';
}

export function ListaDoPeriodo() {
  const [dados, setDados] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');

  function carregar() {
    setCarregando(true);
    setErro('');
    apiGet<Resposta>('/lista-do-periodo')
      .then((r) => setDados(r))
      .catch(() => setErro('Não foi possível carregar a lista do período.'))
      .finally(() => setCarregando(false));
  }
  useEffect(carregar, []);

  const filtrados = useMemo(() => {
    const lista = dados?.alunos ?? [];
    const termo = busca.trim().toLowerCase();
    if (!termo) return lista;
    return lista.filter((a) => a.alunoNome.toLowerCase().includes(termo) || (a.email ?? '').toLowerCase().includes(termo));
  }, [dados, busca]);

  const totais = useMemo(() => {
    const lista = dados?.alunos ?? [];
    return {
      aprovado: lista.filter((a) => a.status === 'Aprovado').length,
      pendente: lista.filter((a) => a.status === 'Aprovação pendente').length,
      naoEnviado: lista.filter((a) => a.status === 'Não enviado').length,
    };
  }, [dados]);

  return (
    <>
      <div className="cabecalho-secao">
        <div>
          <h1>Lista do período</h1>
          <p className="legenda">Alunos do semestre e situação do envio inicial do TCC.</p>
        </div>
      </div>

      <section className="cartao-secao bloco">
        <div className="grade-resumo">
          <div>
            <span className="legenda">Semestre</span>
            <strong className="resumo-valor">{dados?.semestre ?? '—'}</strong>
          </div>
          <div>
            <span className="legenda">Prazo de envio</span>
            <strong className="resumo-valor">{formatarData(dados?.prazoEnvio ?? null)}</strong>
          </div>
          <div>
            <span className="legenda">Aprovados</span>
            <strong className="resumo-valor" style={{ color: 'var(--aprovado)' }}>{totais.aprovado}</strong>
          </div>
          <div>
            <span className="legenda">Pendentes / Não enviados</span>
            <strong className="resumo-valor">
              <span style={{ color: '#a16207' }}>{totais.pendente}</span>
              <span style={{ color: 'var(--tinta-3)', margin: '0 4px' }}>/</span>
              <span style={{ color: 'var(--reprovado)' }}>{totais.naoEnviado}</span>
            </strong>
          </div>
        </div>
      </section>

      <section className="cartao-secao bloco">
        <label className="campo" style={{ marginBottom: 16 }}>
          <span>Pesquisar</span>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome ou e-mail…" />
        </label>

        {carregando ? (
          <p className="nota-vazio">Carregando…</p>
        ) : erro ? (
          <p className="nota-vazio">{erro}</p>
        ) : !filtrados.length ? (
          <p className="nota-vazio">
            {(dados?.alunos.length ?? 0) === 0 ? 'Nenhum aluno cadastrado no sistema.' : 'Nenhum aluno encontrado com esse filtro.'}
          </p>
        ) : (
          <div className="tabela-rolavel">
            <table className="tabela tabela-relatorio">
              <thead>
                <tr>
                  <th>Aluno</th>
                  <th>E-mail</th>
                  <th>Curso</th>
                  <th>Data de envio</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((a) => (
                  <tr key={a.alunoId}>
                    <td title={a.alunoNome}>{a.alunoNome}</td>
                    <td title={a.email ?? ''}>{a.email ?? '—'}</td>
                    <td>{cursoDe(a.curso)}</td>
                    <td>{formatarData(a.dataEnvio)}</td>
                    <td><span className={`pilula ${PILULA[a.status]}`}>{a.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
