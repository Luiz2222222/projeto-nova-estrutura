import { useEffect, useState } from 'react';
import { URL_API, apiGet, mensagemErro } from '../api';

interface ItemArquivado {
  id: string;
  semestre: string;
  titulo: string;
  alunoNome: string;
  alunoCurso: string | null;
  orientadorNome: string | null;
  nf: number | null;
  resultado: string | null;
  concluidoEm: string | null;
  arquivadoEm: string;
  driveArquivoFinalNome: string | null;
}

const nota = (v: number | null) => (v == null ? '—' : v.toFixed(2).replace('.', ','));
const dia = (v: string | null) => (v ? new Date(v).toLocaleDateString('pt-BR') : '—');

// Períodos ENCERRADOS. Fica separado do Histórico normal de propósito: aqui os TCCs já
// foram apagados do sistema ativo e as contas de aluno/avaliador não existem mais — o que
// se vê é o retrato arquivado, com o documento final vindo do Drive por proxy autenticado.
export function HistoricoArquivado() {
  const [itens, setItens] = useState<ItemArquivado[] | null>(null);
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');

  useEffect(() => {
    apiGet<ItemArquivado[]>('/historico-arquivado')
      .then(setItens)
      .catch((e) => {
        setErro(mensagemErro(e, 'Não foi possível carregar o histórico arquivado.'));
        setItens([]);
      });
  }, []);

  const filtrados = (itens ?? []).filter((i) => {
    const t = busca.trim().toLowerCase();
    if (!t) return true;
    return [i.titulo, i.alunoNome, i.orientadorNome ?? '', i.semestre].some((c) => c.toLowerCase().includes(t));
  });

  const porSemestre = new Map<string, ItemArquivado[]>();
  for (const i of filtrados) porSemestre.set(i.semestre, [...(porSemestre.get(i.semestre) ?? []), i]);

  return (
    <>
      <h1>Histórico arquivado</h1>
      <p className="legenda">
        TCCs de períodos já encerrados. Os dados ficam preservados aqui mesmo depois que as contas dos
        alunos e avaliadores externos são removidas do sistema.
      </p>

      {erro && <div className="erro-geral">{erro}</div>}

      <section className="cartao-secao bloco">
        <label className="campo">
          <span>Buscar</span>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Aluno, título, orientador ou semestre" />
        </label>

        {itens === null ? (
          <p className="nota-vazio">Carregando…</p>
        ) : filtrados.length === 0 ? (
          <p className="nota-vazio">Nenhum TCC arquivado.</p>
        ) : (
          [...porSemestre.entries()]
            .sort((a, b) => b[0].localeCompare(a[0]))
            .map(([semestre, lista]) => (
              <div key={semestre} className="config-grupo">
                <h3>{semestre}</h3>
                <div className="tabela-rolagem">
                  <table className="tabela">
                    <thead>
                      <tr>
                        <th>Aluno</th>
                        <th>Título</th>
                        <th>Orientador</th>
                        <th>Nota</th>
                        <th>Resultado</th>
                        <th>Concluído</th>
                        <th>Documento</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lista.map((i) => (
                        <tr key={i.id}>
                          <td>{i.alunoNome}</td>
                          <td>{i.titulo}</td>
                          <td>{i.orientadorNome ?? '—'}</td>
                          <td>{nota(i.nf)}</td>
                          <td>{i.resultado ?? '—'}</td>
                          <td>{dia(i.concluidoEm)}</td>
                          <td>
                            {i.driveArquivoFinalNome ? (
                              // Download pelo backend autenticado — sem link público do Drive.
                              <a className="link" href={`${URL_API}/historico-arquivado/${i.id}/baixar`}>
                                Baixar
                              </a>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
        )}
      </section>
    </>
  );
}
