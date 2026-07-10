import { useTema, type Tema } from '../tema/contexto';

const TEMAS_ESCUROS: Tema[] = ['escuro', 'preto'];

const LOGO_CLARO = '/Logo.png';
const LOGO_ESCURO = '/logo-dee-3.png';

interface Props {
  className?: string;
  alt?: string;
}

export function LogoDee({ className, alt = 'DEE — Departamento de Engenharia Elétrica' }: Props) {
  const { tema } = useTema();
  const src = TEMAS_ESCUROS.includes(tema) ? LOGO_ESCURO : LOGO_CLARO;
  return <img className={className} src={src} alt={alt} />;
}
