import { useState } from 'react';
import { apiPost, URL_API, type ErroApi } from '../../api';
import { Modal } from '../../componentes/Modal';

// Seção do Planejamento: exportar backup dos dados e resetar o período (ação destrutiva).
export function SecaoDados() {
  const [modalReset, setModalReset] = useState(false);
  const [confirmacao, setConfirmacao] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [resetando, setResetando] = useState(false);

  function abrir() {
    setConfirmacao('');
    setSenha('');
    setErro('');
    setModalReset(true);
  }

  async function resetar() {
    setErro('');
    setResetando(true);
    try {
      const r: any = await apiPost('/resetar', { senha, confirmacao });
      // Baixa o backup retornado antes de recarregar.
      const blob = new Blob([JSON.stringify(r.backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup_tcc_${r.backup?.semestre ?? 'periodo'}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      window.alert(`Período resetado. ${r.apagados} TCC(s) apagado(s). Backup baixado.`);
      window.location.reload();
    } catch (e) {
      setErro((e as ErroApi).mensagem || 'Não foi possível resetar o período.');
    } finally {
      setResetando(false);
    }
  }

  return (
    <section className="cartao-secao bloco">
      <h2>Dados do período</h2>
      <p className="legenda" style={{ marginBottom: 18 }}>
        Baixe um backup completo dos TCCs ou reinicie o período. O reset apaga os TCCs do semestre atual.
      </p>
      <div className="acoes" style={{ justifyContent: 'flex-start' }}>
        <a className="botao botao-secundario" href={`${URL_API}/exportar`} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
          Baixar dados
        </a>
        <button className="botao botao-perigo" onClick={abrir}>Resetar período</button>
      </div>

      {modalReset && (
        <Modal
          titulo="Resetar período"
          subtitulo="Esta ação apaga todos os TCCs do semestre atual e seus arquivos. Não pode ser desfeita — um backup será baixado antes."
          aoFechar={() => !resetando && setModalReset(false)}
        >
          {erro && <div className="erro-geral">{erro}</div>}
          <label className="campo">
            <span>Digite APAGAR para confirmar</span>
            <input value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} placeholder="APAGAR" />
          </label>
          <label className="campo">
            <span>Sua senha</span>
            <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="Senha do coordenador" />
          </label>
          <div className="acoes">
            <button className="botao botao-secundario" disabled={resetando} onClick={() => setModalReset(false)}>Cancelar</button>
            <button className="botao botao-perigo" disabled={resetando || confirmacao !== 'APAGAR' || !senha} onClick={resetar}>
              {resetando ? 'Resetando…' : 'Resetar período'}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
