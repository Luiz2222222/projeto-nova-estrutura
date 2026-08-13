import { useEffect, useState } from 'react';
import { apiGet } from '../../api';
import { ModalBaixarDados } from '../../componentes/ModalBaixarDados';

// Seção do Planejamento: backup dos dados do período.
//
// O antigo "Resetar período" foi REMOVIDO daqui: ele apagava os TCCs sem exigir arquivamento
// no Drive, o que era um caminho destrutivo paralelo. O único fluxo de encerramento agora é
// "Encerrar e arquivar período", na seção do Google Drive (com prévia de impacto, senha e
// confirmação ENCERRAR).
export function SecaoDados() {
  const [modalBaixar, setModalBaixar] = useState(false);
  // Período ativo (manual) — usado no nome do arquivo de backup.
  const [periodo, setPeriodo] = useState('');
  useEffect(() => {
    apiGet('/semestre-ativo').then((r: any) => setPeriodo(r?.semestre ?? '')).catch(() => {});
  }, []);

  return (
    <section className="cartao-secao bloco">
      <h2>Dados do período</h2>
      <p className="legenda" style={{ marginBottom: 18 }}>
        Baixe um backup completo dos TCCs do período ativo{periodo ? ` (${periodo})` : ''}. Para encerrar o
        período, use “Encerrar e arquivar período” na seção do Google Drive — ela arquiva tudo antes de
        apagar qualquer coisa.
      </p>
      <div className="acoes" style={{ justifyContent: 'flex-start' }}>
        <button className="botao botao-secundario" onClick={() => setModalBaixar(true)}>Baixar dados</button>
      </div>

      {modalBaixar && (
        <ModalBaixarDados
          titulo="Baixar dados"
          caminhoBase="/exportar"
          nomeArquivo={`TCCs_${periodo || 'periodo'}.zip`}
          aoFechar={() => setModalBaixar(false)}
        />
      )}
    </section>
  );
}
