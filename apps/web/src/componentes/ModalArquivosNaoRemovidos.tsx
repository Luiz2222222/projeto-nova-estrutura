// Aviso pós-exclusão: o TCC saiu do banco, mas um ou mais arquivos de upload não puderam
// ser apagados do disco (ex.: arquivo travado pelo sistema operacional). Sem esta tela o
// coordenador veria "sucesso" e os órfãos ficariam no servidor sem ninguém saber — só no
// log. Aparece ANTES do redirecionamento e lista os caminhos para limpeza manual.
import { Modal } from './Modal';

export function ModalArquivosNaoRemovidos({ arquivos, aoFechar }: { arquivos: string[]; aoFechar: () => void }) {
  return (
    <Modal titulo="TCC excluído — arquivos pendentes no servidor" aoFechar={aoFechar}>
      <div className="alerta" style={{ marginBottom: 14 }}>
        O TCC e todos os seus registros foram <strong>excluídos do banco</strong>. Porém
        {arquivos.length === 1 ? ' 1 arquivo não pôde ser removido' : ` ${arquivos.length} arquivos não puderam ser removidos`} do
        disco do servidor e {arquivos.length === 1 ? 'precisa' : 'precisam'} de limpeza manual:
      </div>
      <ul style={{ margin: '0 0 4px 18px' }}>
        {arquivos.map((a) => <li key={a}><code>{a}</code></li>)}
      </ul>
      <p className="legenda">Peça a quem administra o servidor para apagar esses caminhos. Nada mais depende deles — o TCC já não existe no sistema.</p>
      <div className="acoes">
        <button className="botao" onClick={aoFechar}>Entendi</button>
      </div>
    </Modal>
  );
}
