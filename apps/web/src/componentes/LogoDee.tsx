import { useTema, type Tema } from '../tema/contexto';

const LOGO_POR_TEMA: Record<Tema, string> = {
  claro: '/logo-dee-1.png',
  institucional: '/logo-dee-2.png',
  escuro: '/logo-dee-3.png',
  preto: '/logo-dee-4.png',
};

interface Props {
  className?: string;
  alt?: string;
}

export function LogoDee({ className, alt = 'DEE — Departamento de Engenharia Elétrica' }: Props) {
  const { tema } = useTema();
  return <img className={className} src={LOGO_POR_TEMA[tema]} alt={alt} />;
}
