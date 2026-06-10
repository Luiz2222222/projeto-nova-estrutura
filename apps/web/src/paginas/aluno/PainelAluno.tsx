import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiDelete, type ErroApi } from '../../api';
import { TrilhaFases } from '../../componentes/TrilhaFases';
import { ModalEnviarMonografia } from '../../componentes/ModalEnviarMonografia';
import { faseParaIndice, ROTULO_FASE, ROTULO_STATUS_SOLIC } from '../../utils/fases';

function ultimaMonografia(docs: any[] = []) {
  return docs.filter((d) => d.tipo === 'MONOGRAFIA').sort((a, b) => b.versao - a.versao)[0] ?? null;
}

export function PainelAluno() {
  const navegar = useNavigate();
  const [tcc, setTcc] = useState<any | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);

  function carregar() {
    setCarregando(true);
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

  async function cancelar() {
    if (!window.confirm('Cancelar a solicitação de abertura do TCC?')) return;
    try {
      await apiDelete(`/tccs/${tcc.id}`);
      setTcc(null);
    } catch (e) {
      window.alert((e as ErroApi).mensagem || 'Não foi possível cancelar.');
    }
  }

  if (carregando) return <p className="nota-vazio">Carregando…</p>;

  if (!tcc) {
    return (
      <>
        <h1>Meu TCC</h1>
        <section className="cartao-secao bloco" style={{ textAlign: 'center' }}>
          <h2>Você ainda não abriu seu TCC</h2>
          <p className="nota-vazio">
            Comece enviando a solicitação de orientação com os documentos iniciais.
          </p>
          <button className="botao" style={{ marginTop: 16 }} onClick={() => navegar('/aluno/abrir')}>
            Abrir meu TCC
          </button>
        </section>
      </>
    );
  }

  const solic = tcc.solicitacoes?.[0];
  const idx = faseParaIndice(tcc.faseAtual);

  return (
    <>
      <h1>Meu TCC</h1>
      <p className="legenda">{tcc.titulo}</p>

      {solic?.status === 'RECUSADA' && (
        <div className="alerta alerta-erro bloco">
          <strong>Abertura recusada.</strong> {solic.parecer}
          <div className="acoes" style={{ marginTop: 12 }}>
            <button className="botao" onClick={corrigirEReenviar}>Corrigir e reenviar</button>
          </div>
        </div>
      )}

      <section className="cartao-secao bloco">
        <h2>Andamento</h2>
        {idx === null ? (
          <span className="badge-status status-bad">{ROTULO_FASE[tcc.faseAtual] ?? tcc.faseAtual}</span>
        ) : (
          <TrilhaFases atual={idx} />
        )}
        <p className="nota-vazio">
          Etapa atual: <strong>{ROTULO_FASE[tcc.faseAtual] ?? tcc.faseAtual}</strong>
        </p>
      </section>

      <section className="cartao-secao bloco">
        <h2>Dados</h2>
        <dl className="dados">
          <div>
            <dt>Orientador</dt>
            <dd>
              {tcc.orientador?.tratamento ? tcc.orientador.tratamento + ' ' : ''}
              {tcc.orientador?.nomeCompleto ?? '—'}
            </dd>
          </div>
          {(tcc.coorientador || tcc.coorientadorNome) && (
            <div>
              <dt>Coorientador</dt>
              <dd>{tcc.coorientador?.nomeCompleto ?? tcc.coorientadorNome}</dd>
            </div>
          )}
          <div>
            <dt>Semestre</dt>
            <dd>{tcc.semestre}</dd>
          </div>
          <div>
            <dt>Situação</dt>
            <dd>{ROTULO_STATUS_SOLIC[solic?.status] ?? solic?.status}</dd>
          </div>
        </dl>

        <h3 style={{ marginTop: 18, fontSize: 14 }}>Documentos</h3>
        {tcc.documentos?.length ? (
          <ul className="lista-docs">
            {tcc.documentos.map((d: any) => (
              <li key={d.id}>
                {d.nomeArquivo} <span className="muted">({d.tipo})</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="nota-vazio">Nenhum documento enviado.</p>
        )}

        {tcc.faseAtual === 'INICIALIZACAO' && solic?.status === 'PENDENTE' && (
          <button className="botao botao-secundario" style={{ marginTop: 18 }} onClick={cancelar}>
            Cancelar solicitação
          </button>
        )}
      </section>

      {(tcc.faseAtual === 'DESENVOLVIMENTO' || ultimaMonografia(tcc.documentos)) && (
        <section className="cartao-secao bloco">
          <h2>Monografia</h2>
          {(() => {
            const mono = ultimaMonografia(tcc.documentos);
            if (!mono) return <p className="nota-vazio" style={{ marginTop: 0 }}>Você ainda não enviou a monografia.</p>;
            const rotulo =
              mono.status === 'APROVADO'
                ? 'Aprovada pelo orientador'
                : mono.status === 'REJEITADO'
                  ? 'Ajustes solicitados'
                  : 'Aguardando avaliação do orientador';
            return (
              <>
                <p className="nota-vazio" style={{ marginTop: 0 }}>
                  Versão {mono.versao} — <strong>{rotulo}</strong>.
                </p>
                {mono.status === 'REJEITADO' && mono.parecer && (
                  <div className="alerta alerta-erro"><strong>Devolutiva:</strong> {mono.parecer}</div>
                )}
              </>
            );
          })()}
          {(() => {
            // Só oferece enviar/reenviar quando NÃO há versão em avaliação (consistente com o Dashboard).
            const mono = ultimaMonografia(tcc.documentos);
            const podeEnviar =
              tcc.faseAtual === 'DESENVOLVIMENTO' && !tcc.monografiaAprovada && (!mono || mono.status === 'REJEITADO');
            if (!podeEnviar) return null;
            return (
              <button className="botao" style={{ marginTop: 14 }} onClick={() => setEnviando(true)}>
                {mono ? 'Reenviar monografia' : 'Enviar monografia'}
              </button>
            );
          })()}
        </section>
      )}

      {enviando && (
        <ModalEnviarMonografia
          tccId={tcc.id}
          aoFechar={() => setEnviando(false)}
          aoEnviado={() => { setEnviando(false); carregar(); }}
        />
      )}
    </>
  );
}
