import { useEffect, useId, useRef, useState } from 'react';
import { contemBusca } from '../utils/texto';
import type { UsuarioResumo } from '../tipos';

// Combobox de avaliador SEM dependência nova: digitar no próprio campo FILTRA os
// candidatos (sem diferenciar caixa/acentos); digitar NUNCA seleciona nem desfaz uma
// seleção — só confirmar uma opção (clique ou Enter) troca o avaliador; cancelar
// (Esc/clicar fora) restaura o nome de quem já estava selecionado. Funciona também
// quando a seleção existe ANTES de os candidatos chegarem da API (troca de banca).
// Acessível: combobox/listbox, setas, Enter confirma, Esc fecha.
export function ComboAvaliador({
  rotulo,
  valor,
  candidatos,
  rotuloDe,
  excluirId,
  aoEscolher,
}: {
  rotulo: string;
  valor: string; // id selecionado ('' = nenhum)
  candidatos: UsuarioResumo[];
  rotuloDe: (c: UsuarioResumo) => string;
  excluirId?: string; // pessoa já escolhida no OUTRO campo (não pode repetir)
  aoEscolher: (id: string) => void;
}) {
  const idLista = useId();
  const selecionado = candidatos.find((c) => c.id === valor) ?? null;
  const rotuloSel = selecionado ? rotuloDe(selecionado) : '';
  const [texto, setTexto] = useState(rotuloSel);
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(-1); // índice destacado pelo teclado
  const raiz = useRef<HTMLDivElement>(null);

  // Mantém o campo fiel à seleção enquanto NÃO está em edição — cobre a seleção que
  // muda por fora E os candidatos que chegam DEPOIS de já existir um id selecionado
  // (troca de banca: sem isso o campo ficava vazio até o usuário mexer nele).
  useEffect(() => {
    if (!aberto) setTexto(rotuloSel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor, candidatos, aberto]);

  // Abrir o campo com alguém selecionado mostra a LISTA COMPLETA de elegíveis (o texto
  // igual ao rótulo do selecionado não é filtro digitado — é só o estado de descanso).
  const filtro = texto.trim();
  const semFiltro = !filtro || (selecionado != null && filtro === rotuloSel);
  const opcoes = candidatos
    .filter((c) => c.id !== excluirId)
    .filter((c) => semFiltro || contemBusca(rotuloDe(c), filtro));

  function escolher(c: UsuarioResumo) {
    aoEscolher(c.id);
    setTexto(rotuloDe(c));
    setAberto(false);
    setAtivo(-1);
  }

  // Fecha SEM confirmar: restaura o nome da seleção vigente (nunca fica texto solto).
  function cancelar() {
    setAberto(false);
    setAtivo(-1);
    setTexto(rotuloSel);
  }

  function aoTeclar(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAberto(true);
      setAtivo((i) => Math.min(i + 1, opcoes.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setAtivo((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (aberto && ativo >= 0 && opcoes[ativo]) {
        e.preventDefault();
        escolher(opcoes[ativo]);
      }
    } else if (e.key === 'Escape') {
      cancelar();
    }
  }

  // Clique fora = cancelar a edição em andamento (a seleção anterior permanece).
  useEffect(() => {
    if (!aberto) return;
    const f = (ev: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(ev.target as Node)) cancelar();
    };
    document.addEventListener('mousedown', f);
    return () => document.removeEventListener('mousedown', f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, rotuloSel]);

  return (
    <div className="campo combo-avaliador" ref={raiz}>
      <span>{rotulo}</span>
      <input
        role="combobox"
        aria-expanded={aberto}
        aria-controls={idLista}
        aria-autocomplete="list"
        aria-label={rotulo}
        value={texto}
        placeholder="Digite para filtrar…"
        onChange={(e) => {
          // Digitar só edita o filtro — NÃO seleciona nem desfaz a seleção atual.
          setTexto(e.target.value);
          setAberto(true);
          setAtivo(-1);
        }}
        onFocus={() => setAberto(true)}
        onKeyDown={aoTeclar}
      />
      {aberto && (
        <ul id={idLista} role="listbox" className="combo-lista">
          {opcoes.length === 0 ? (
            <li className="combo-vazio" aria-disabled="true">Nenhum candidato encontrado.</li>
          ) : (
            opcoes.map((c, i) => (
              <li
                key={c.id}
                role="option"
                aria-selected={c.id === valor}
                className={`combo-opcao${i === ativo ? ' ativa' : ''}${c.id === valor ? ' sel' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault(); // não rouba o foco do input
                  escolher(c);
                }}
              >
                {rotuloDe(c)}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
