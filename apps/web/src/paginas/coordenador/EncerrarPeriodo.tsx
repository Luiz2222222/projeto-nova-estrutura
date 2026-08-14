import { useState } from 'react';
import { apiGet, apiPost, mensagemErro } from '../../api';
import { Modal } from '../../componentes/Modal';

interface Previa {
  semestre: string;
  conectadoAoDrive: boolean;
  tccs: number;
  pendenciasSincronizacao: number;
  podeEncerrar: boolean;
  contasParaApagar: { nome: string; email: string; papel: string }[];
  contasPreservadas: { nome: string; papel: string; motivo: string }[];
}

// Fluxo ÚNICO de encerramento de período: prévia de impacto -> senha -> ENCERRAR.
// Vive num componente próprio para existir em um lugar só da tela (card "Dados do
// período"); a seção do Drive não tem mais botão nem caminho paralelo para isso.
// Reaproveita os mesmos endpoints de sempre — nenhuma lógica nova de encerramento.
export function EncerrarPeriodo() {
  const [aberto, setAberto] = useState(false);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [encerrando, setEncerrando] = useState(false);
  const [erro, setErro] = useState('');
  const [relatorio, setRelatorio] = useState<any | null>(null);

  async function abrir() {
    setErro('');
    setRelatorio(null);
    setSenha('');
    setConfirmacao('');
    setPrevia(null);
    setAberto(true);
    setCarregando(true);
    try {
      setPrevia(await apiGet<Previa>('/periodo/encerrar/previa'));
    } catch (e) {
      setErro(mensagemErro(e, 'Não foi possível calcular o impacto do encerramento.'));
    } finally {
      setCarregando(false);
    }
  }

  function fechar() {
    if (encerrando) return;
    setAberto(false);
    setSenha('');
    setConfirmacao('');
    setErro('');
  }

  async function encerrar() {
    setErro('');
    setEncerrando(true);
    try {
      setRelatorio(await apiPost('/periodo/encerrar', { senha, confirmacao }));
      setSenha('');
      setConfirmacao('');
    } catch (e) {
      setErro(mensagemErro(e, 'Não foi possível encerrar o período.'));
    } finally {
      setEncerrando(false);
    }
  }

  return (
    <>
      <button className="botao botao-perigo" onClick={abrir}>
        Encerrar e arquivar período
      </button>

      {aberto && (
        <Modal
          titulo="Encerrar e arquivar período"
          subtitulo="Arquiva os TCCs no arquivo permanente da VPS (dados, notas, pareceres e documentos) e no histórico. Só depois de a cópia ser validada os TCCs saem do fluxo ativo e as contas de alunos e avaliadores externos são apagadas. Professores e coordenadores nunca são apagados."
          aoFechar={fechar}
        >
          {erro && <div className="erro-geral">{erro}</div>}

          {relatorio ? (
            <>
              <div className="alerta-aviso bloco">
                <strong>Período {relatorio.semestre} arquivado localmente.</strong> {relatorio.tccsArquivados} TCC(s)
                guardado(s) no arquivo permanente da VPS (dados e documentos), {relatorio.tccsApagados} removido(s) do
                fluxo ativo, {relatorio.arquivosLocaisRemovidos} arquivo(s) de trabalho liberado(s),{' '}
                {relatorio.contasApagadas.length} conta(s) apagada(s).
                <div style={{ marginTop: 6 }}>
                  {relatorio.driveConectado
                    ? `No Google Drive foi atualizado apenas o resumo de dados (dados.json e resumo.txt) de ${relatorio.snapshotEnviadoAoDrive} TCC(s) — os documentos lá dependem do que já havia sido sincronizado antes. A cópia completa é a da VPS.`
                    : 'Sem cópia no Google Drive (a integração não estava conectada). O arquivo permanente da VPS está completo e é a fonte do Histórico.'}
                </div>
                {relatorio.contasPreservadas?.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    Preservadas: {relatorio.contasPreservadas.map((c: any) => `${c.nome} (${c.motivo})`).join('; ')}
                  </div>
                )}
              </div>
              <div className="acoes">
                <button className="botao" onClick={() => { setAberto(false); window.location.reload(); }}>
                  Fechar
                </button>
              </div>
            </>
          ) : carregando ? (
            <p className="nota-vazio">Calculando impacto…</p>
          ) : (
            previa && (
              <>
                <div className="alerta-aviso bloco">
                  <strong>Período {previa.semestre}:</strong> {previa.tccs} TCC(s).
                  <div>Contas que serão apagadas: {previa.contasParaApagar.length}</div>
                  <div>Contas preservadas: {previa.contasPreservadas.length}</div>
                  <div style={{ marginTop: 6 }}>
                    Os dados e documentos vão para o arquivo permanente da VPS antes de qualquer exclusão. Se a cópia
                    não puder ser validada, nada é apagado.
                  </div>
                  {!previa.conectadoAoDrive && (
                    <div style={{ marginTop: 6 }}>
                      Google Drive não conectado: o período será arquivado <strong>somente</strong> na VPS. Isso não
                      impede o encerramento — mas depois dele não há como enviar estes TCCs ao Drive.
                    </div>
                  )}
                  {previa.conectadoAoDrive && previa.pendenciasSincronizacao > 0 && (
                    <div style={{ marginTop: 6 }}>
                      {previa.pendenciasSincronizacao} item(ns) ainda sincronizando com o Drive — a cópia adicional pode
                      ficar incompleta.
                    </div>
                  )}
                  {!previa.podeEncerrar && (
                    <div style={{ marginTop: 6 }}>
                      <strong>Não há TCC neste período para encerrar.</strong>
                    </div>
                  )}
                </div>

                {previa.contasParaApagar.length > 0 && (
                  <p className="legenda">
                    Serão apagadas: {previa.contasParaApagar.map((c) => `${c.nome} (${c.papel})`).join(', ')}
                  </p>
                )}

                <label className="campo">
                  <span>Sua senha</span>
                  <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="Confirme sua senha" />
                </label>
                <label className="campo">
                  <span>Digite ENCERRAR para confirmar</span>
                  <input value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} placeholder="ENCERRAR" />
                </label>

                <div className="acoes">
                  <button className="botao botao-secundario" disabled={encerrando} onClick={fechar}>
                    Cancelar
                  </button>
                  <button
                    className="botao botao-perigo"
                    disabled={encerrando || !previa.podeEncerrar || confirmacao !== 'ENCERRAR' || !senha}
                    onClick={encerrar}
                  >
                    {encerrando ? 'Encerrando…' : 'Encerrar e arquivar período'}
                  </button>
                </div>
              </>
            )
          )}
        </Modal>
      )}
    </>
  );
}
