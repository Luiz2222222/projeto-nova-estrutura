import { SecaoCalendario } from './SecaoCalendario';
import { SecaoCodigos } from './SecaoCodigos';
import { SecaoPesos } from './SecaoPesos';
import { SecaoModelos } from './SecaoModelos';
import { SecaoDados } from './SecaoDados';

// Espelha "Planejamento acadêmico" do projeto original: calendário do semestre + documentos
// de referência numa única tela.
export function PlanejamentoCoordenador() {
  return (
    <>
      <h1>Planejamento acadêmico</h1>
      <p className="legenda">Datas do semestre e documentos de referência.</p>
      <SecaoCalendario />
      <SecaoCodigos />
      <SecaoPesos />
      <SecaoModelos />
      <SecaoDados />
    </>
  );
}
