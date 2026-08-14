import { useEffect, useState } from 'react';
import { apiGet } from '../../api';
import { ModalBaixarDados } from '../../componentes/ModalBaixarDados';
import { EncerrarPeriodo } from './EncerrarPeriodo';

// Seção do Planejamento: backup e encerramento do período.
//
// O antigo "Resetar período" foi REMOVIDO: ele apagava os TCCs sem exigir arquivamento, um
// caminho destrutivo paralelo. O único fluxo é o "Encerrar e arquivar período" (prévia de
// impacto + senha + confirmação ENCERRAR), que mora AQUI — a seção do Drive não tem mais
// botão nem cópia desse fluxo.
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
        Baixe um backup completo dos TCCs do período ativo{periodo ? ` (${periodo})` : ''} ou encerre o período,
        arquivando tudo antes de qualquer exclusão.
      </p>
      {/* Ações nas pontas no desktop; em tela estreita empilham sem cortar texto. */}
      <div className="acoes" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <button className="botao botao-secundario" onClick={() => setModalBaixar(true)}>Baixar dados</button>
        <EncerrarPeriodo />
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
