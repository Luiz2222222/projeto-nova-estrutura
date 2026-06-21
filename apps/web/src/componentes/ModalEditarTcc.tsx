// Modal ÚNICO de edição administrativa do TCC (coordenador). Estrutura fiel ao
// modal antigo: seções grandes empilhadas num scroll só (Dados do trabalho /
// orientação · Documentos · Avaliações Fase I e Fase II colapsáveis), em vez de abas.
// Os pesos da banca são buscados aqui mesmo (/tccs/:id/banca/pesos), então o modal
// funciona tanto pela página interna quanto aberto direto pela lista de TCCs.
// (Edição de USUÁRIOS não entra aqui — fica na aba Usuários.)
import { useEffect, useState } from 'react';
import { apiGet } from '../api';
import { Modal } from './Modal';
import { PainelDadosTcc } from './PainelDadosTcc';
import { PainelDocumentosTcc } from './PainelDocumentosTcc';
import { PainelBancaTcc } from './PainelBancaTcc';

export function ModalEditarTcc({ tcc, pesos, aoFechar, aoSalvo }: { tcc: any; pesos?: any; aoFechar: () => void; aoSalvo: () => void }) {
  // Usa os pesos vindos por prop (página interna) como valor inicial e, de toda forma,
  // busca aqui também — assim o modal aberto pela lista de TCCs também os carrega.
  const [pesosBanca, setPesosBanca] = useState<any>(pesos ?? null);
  useEffect(() => {
    apiGet(`/tccs/${tcc.id}/banca/pesos`).then(setPesosBanca).catch(() => {});
  }, [tcc.id]);

  const subtitulo = [tcc.aluno?.nomeCompleto, tcc.titulo].filter(Boolean).join(' — ');

  return (
    <Modal titulo="Editar TCC" subtitulo={subtitulo} aoFechar={aoFechar}>
      <div className="edicao-tcc">
        <section className="edicao-secao">
          <PainelDadosTcc tcc={tcc} aoSalvo={aoSalvo} />
        </section>

        <section className="edicao-secao">
          <PainelDocumentosTcc tcc={tcc} aoSalvo={aoSalvo} />
        </section>

        <section className="edicao-secao">
          <h3 className="titulo-bloco">Avaliações da banca</h3>
          <p className="legenda" style={{ marginTop: 0 }}>
            Notas por critério, comentários/pareceres e status de cada avaliador — Fase I e Fase II.
          </p>
          <PainelBancaTcc tcc={tcc} pesos={pesosBanca} aoSalvo={aoSalvo} />
        </section>
      </div>
    </Modal>
  );
}
