import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Tema = 'claro' | 'escuro' | 'preto' | 'institucional';
export type Fonte = 'pequeno' | 'medio' | 'grande';
export type Familia = 'padrao' | 'serif' | 'mono';

const TEMAS: Tema[] = ['claro', 'escuro', 'preto', 'institucional'];
const FONTES: Fonte[] = ['pequeno', 'medio', 'grande'];
const FAMILIAS: Familia[] = ['padrao', 'serif', 'mono'];

interface ContextoTema {
  tema: Tema;
  fonte: Fonte;
  familia: Familia;
  definirTema: (t: Tema) => void;
  definirFonte: (f: Fonte) => void;
  definirFamilia: (f: Familia) => void;
}

const Ctx = createContext<ContextoTema | null>(null);

function ler<T extends string>(chave: string, validos: readonly T[], padrao: T): T {
  const v = localStorage.getItem(chave) as T | null;
  return v && validos.includes(v) ? v : padrao;
}

export function ProvedorTema({ children }: { children: ReactNode }) {
  const [tema, setTema] = useState<Tema>(() => ler('tcc.tema', TEMAS, 'claro'));
  const [fonte, setFonte] = useState<Fonte>(() => ler('tcc.fonte', FONTES, 'medio'));
  const [familia, setFamilia] = useState<Familia>(() => ler('tcc.familia', FAMILIAS, 'padrao'));

  useEffect(() => {
    document.documentElement.dataset.tema = tema;
    localStorage.setItem('tcc.tema', tema);
  }, [tema]);

  useEffect(() => {
    document.documentElement.dataset.fonte = fonte;
    localStorage.setItem('tcc.fonte', fonte);
  }, [fonte]);

  useEffect(() => {
    document.documentElement.dataset.familia = familia;
    localStorage.setItem('tcc.familia', familia);
  }, [familia]);

  return (
    <Ctx.Provider
      value={{ tema, fonte, familia, definirTema: setTema, definirFonte: setFonte, definirFamilia: setFamilia }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useTema() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTema deve ser usado dentro de ProvedorTema');
  return ctx;
}
