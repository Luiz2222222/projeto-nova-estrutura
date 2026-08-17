// Garantias de REDAÇÃO dos e-mails de fluxo, lidas direto do código-fonte dos serviços.
//
// Testar cada disparo exigiria montar meio sistema; o que precisa ficar travado aqui é o
// contrato do texto: nada de parecer/devolutiva/motivo no corpo, "[Ação pendente]" só onde
// há tarefa, e o nome do orientando nos avisos de envio. Um teste de fonte pega regressão de
// copiar-e-colar, que é como esses textos costumam voltar atrás.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ler = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const TCCS = ler('tccs/tccs.service.ts');
const BANCAS = ler('bancas/bancas.service.ts');
const DEFESAS = ler('bancas/defesas.service.ts');
const TODOS = TCCS + BANCAS + DEFESAS;

describe('Nenhum e-mail carrega parecer, devolutiva ou motivo', () => {
  it.each([
    ["' Parecer: '", /' Parecer: '/],
    ["' Devolutiva: '", /' Devolutiva: '/],
    ["' Motivo: '", /' Motivo: '/],
    ['Motivo interpolado', /Motivo: \$\{/],
  ])('não existe %s no corpo dos avisos', (_nome, padrao) => {
    expect(TODOS).not.toMatch(padrao as RegExp);
  });

  it('os textos mandam abrir o sistema para ler o parecer', () => {
    expect(TCCS).toContain('ver o parecer da coordenação');
    expect(TCCS).toContain('ver a devolutiva do orientador');
    expect(TCCS).toContain('ver o parecer do orientador');
    expect(BANCAS).toContain('ver o motivo');
  });
});

describe('"[Ação pendente]" onde há tarefa', () => {
  it.each([
    ['nova solicitação (coordenação)', TCCS, '[Ação pendente] Nova solicitação de TCC'],
    ['solicitação aprovada (aluno)', TCCS, '[Ação pendente] Solicitação de TCC aprovada'],
    ['solicitação recusada (aluno)', TCCS, '[Ação pendente] Solicitação de TCC recusada'],
    ['monografia enviada (orientador)', TCCS, '[Ação pendente] Monografia enviada para avaliação'],
    ['ajustes na monografia (aluno)', TCCS, '[Ação pendente] Ajustes solicitados na monografia'],
    ['formar banca (coordenação)', TCCS, '[Ação pendente] Formar banca da Fase I'],
    ['versão final enviada (orientador)', TCCS, '[Ação pendente] Versão final enviada'],
    ['ajustes na versão final (aluno)', TCCS, '[Ação pendente] Versão final precisa de ajustes'],
    ['adicionado à banca (Fase I)', BANCAS, '[Ação pendente] Você foi adicionado a uma banca (Fase I)'],
    ['agendar defesa (orientador)', BANCAS, '[Ação pendente] Agendar defesa (Fase II)'],
    ['enviar versão final (aluno)', BANCAS, '[Ação pendente] Envie a versão final'],
    ['ajuste solicitado (avaliador)', BANCAS, '[Ação pendente] Ajuste solicitado'],
    ['avaliação da Fase II liberada', DEFESAS, '[Ação pendente] Avaliação da Fase II liberada'],
  ])('%s', (_nome, fonte, assunto) => {
    expect(fonte).toContain(assunto);
  });

  it('avisos informativos NÃO levam o prefixo', () => {
    for (const assunto of [
      "'Você é orientador de um novo TCC'",
      "'Você foi indicado como coorientador'",
      "'Monografia liberada para avaliação'",
      "'Continuidade confirmada'",
      "'TCC descontinuado'",
      "'TCC concluído'",
    ]) {
      expect(TODOS).toContain(assunto);
      expect(TODOS).not.toContain(`'[Ação pendente] ${assunto.slice(1)}`);
    }
  });
});

describe('Nome do orientando nos avisos de envio', () => {
  it('não sobrou "O aluno enviou/reenviou"', () => {
    expect(TODOS).not.toMatch(/O aluno \$\{?(reenvio|enviou)/);
    expect(TODOS).not.toContain('`O aluno enviou/reenviou');
  });

  it('usa o prefixo com o nome do orientando', () => {
    expect(TCCS).toContain('prefixoOrientando');
    expect(TCCS).toContain('`${quem} enviou/reenviou a monografia');
    expect(TCCS).toContain('`${quemVF} ${verbo} a versão final');
  });
});

describe('Monografia liberada, não "aprovada"', () => {
  it('o aviso ao aluno fala em liberação para avaliação', () => {
    expect(TCCS).toContain("'Monografia liberada para avaliação'");
    expect(TCCS).not.toContain("'Monografia aprovada'");
    // Só nos AVISOS: a mensagem de erro "Sua monografia já foi aprovada pelo orientador."
    // é validação de fluxo, não e-mail, e continua valendo.
    expect(TCCS).not.toContain('` foi aprovada pelo orientador');
    expect(TCCS).not.toContain('}" foi aprovada pelo orientador');
  });

  it('o avanço para a banca virou explicação das DUAS condições', () => {
    expect(TCCS).toContain('CONDICOES_BANCA');
    expect(TCCS).toContain('quando as duas etapas estiverem cumpridas');
    expect(TCCS).not.toContain('avançou para a formação da banca da Fase I.');
  });
});

describe('Descontinuação não soa como falta de resposta', () => {
  it('usa "descontinuado pela orientação"', () => {
    expect(TCCS).toContain('foi descontinuado pela orientação');
    expect(TCCS).not.toContain('o orientador não confirmou a continuidade');
  });
});

describe('Fase I: um aviso só para o avaliador', () => {
  it('o evento de "liberada" separado deixou de existir', () => {
    expect(BANCAS).not.toContain('avaliador_fase1_liberada');
  });

  it('o aviso único diz que a avaliação já está liberada', () => {
    expect(BANCAS).toContain('e a avaliação já está liberada');
  });
});

describe('Aviso imediato de continuidade removido', () => {
  it('não há mais disparo de "Confirmar continuidade" na aprovação da abertura', () => {
    expect(TCCS).not.toContain('orientador_confirmar_continuidade');
    expect(TCCS).not.toContain('Confirmar continuidade do TCC');
  });
});

describe('Coordenação não é cobrada por prazo', () => {
  it('os avisos da coordenação não citam data nem pedem atenção a prazos', () => {
    // Recorta os disparos para coordenadores e confere que nenhum fala de prazo.
    const paraCoord = [...TODOS.matchAll(/emitirParaCoordenadores\(([\s\S]*?)\);\n/g)].map((m) => m[1]);
    expect(paraCoord.length).toBeGreaterThan(0);
    for (const trecho of paraCoord) {
      expect(trecho).not.toContain('fraseEtapa');
      expect(trecho).not.toContain('frasePrazo');
      expect(trecho).not.toContain('Fique atento aos prazos');
    }
  });
});

describe('Agendar defesa não é apresentado como prazo', () => {
  it('o aviso ao orientador não cita prazo (a preparação das bancas é informativa)', () => {
    const trecho = BANCAS.slice(BANCAS.indexOf('orientador_agendar_defesa'));
    const aviso = trecho.slice(0, trecho.indexOf('`/professor/orientandos/'));
    expect(aviso).toContain('agende a defesa na página do orientando');
    expect(aviso).not.toContain('prazo');
  });
});
