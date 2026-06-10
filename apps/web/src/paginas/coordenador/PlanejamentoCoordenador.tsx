import { SecaoCalendario } from './SecaoCalendario';
import { SecaoModelos } from './SecaoModelos';

// Espelha "Planejamento acadêmico" do projeto original: calendário do semestre + documentos
// de referência numa única tela.
export function PlanejamentoCoordenador() {
  return (
    <>
      <h1>Planejamento acadêmico</h1>
      <p className="legenda">Datas do semestre e documentos de referência.</p>
      <SecaoCalendario />
      <SecaoModelos />
    </>
  );
}
