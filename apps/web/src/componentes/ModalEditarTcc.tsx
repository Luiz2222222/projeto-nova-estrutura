// Modal ÚNICO de edição administrativa do TCC (coordenador), com abas:
// Dados gerais · Documentos · Banca e notas. Reaproveita os painéis internos.
// (Edição de USUÁRIOS não entra aqui — fica na aba Usuários.)
import { useState } from 'react';
import { Modal } from './Modal';
import { PainelDadosTcc } from './PainelDadosTcc';
import { PainelDocumentosTcc } from './PainelDocumentosTcc';
import { PainelBancaTcc } from './PainelBancaTcc';

type Aba = 'gerais' | 'documentos' | 'banca';

export function ModalEditarTcc({ tcc, pesos, aoFechar, aoSalvo }: { tcc: any; pesos: any; aoFechar: () => void; aoSalvo: () => void }) {
  const [aba, setAba] = useState<Aba>('gerais');

  return (
    <Modal titulo="Editar TCC" subtitulo={tcc.titulo} aoFechar={aoFechar}>
      <div className="abas-edicao">
        <button className={`aba-edicao${aba === 'gerais' ? ' ativa' : ''}`} onClick={() => setAba('gerais')}>Dados gerais</button>
        <button className={`aba-edicao${aba === 'documentos' ? ' ativa' : ''}`} onClick={() => setAba('documentos')}>Documentos</button>
        <button className={`aba-edicao${aba === 'banca' ? ' ativa' : ''}`} onClick={() => setAba('banca')}>Banca e notas</button>
      </div>

      {/* Só a aba ativa é montada — assim cada painel reinicia com os dados atuais do TCC. */}
      {aba === 'gerais' && <PainelDadosTcc tcc={tcc} aoSalvo={aoSalvo} />}
      {aba === 'documentos' && <PainelDocumentosTcc tcc={tcc} aoSalvo={aoSalvo} />}
      {aba === 'banca' && <PainelBancaTcc tcc={tcc} pesos={pesos} aoSalvo={aoSalvo} />}
    </Modal>
  );
}
