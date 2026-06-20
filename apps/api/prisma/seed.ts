import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // Códigos de cadastro (o coordenador poderá alterar depois pelo sistema).
  const codigos = [
    { papel: 'ALUNO', codigo: 'ALUNO2026' },
    { papel: 'PROFESSOR', codigo: 'PROF2026' },
    { papel: 'AVALIADOR', codigo: 'AVAL2026' },
  ];
  for (const c of codigos) {
    await prisma.codigoCadastro.upsert({
      where: { papel: c.papel },
      update: { codigo: c.codigo },
      create: c,
    });
  }

  // Usuários de teste com senha fraca (adm/adm, aluno/aluno) SÓ fora de produção.
  // Em produção, o coordenador inicial deve ser criado por outro meio seguro.
  const ehProducao = process.env.NODE_ENV === 'production';
  if (!ehProducao) {
    await prisma.usuario.upsert({
      where: { email: 'adm' },
      update: { senhaHash: await bcrypt.hash('adm', 10), papel: 'COORDENADOR' },
      create: {
        nomeCompleto: 'Coordenador de TCC',
        email: 'adm',
        senhaHash: await bcrypt.hash('adm', 10),
        papel: 'COORDENADOR',
      },
    });
    await prisma.usuario.upsert({
      where: { email: 'aluno' },
      update: { senhaHash: await bcrypt.hash('aluno', 10), papel: 'ALUNO' },
      create: {
        nomeCompleto: 'Aluno de Teste',
        email: 'aluno',
        senhaHash: await bcrypt.hash('aluno', 10),
        papel: 'ALUNO',
        curso: 'ENGENHARIA_ELETRICA',
      },
    });
    await prisma.usuario.upsert({
      where: { email: 'avaliador' },
      update: { senhaHash: await bcrypt.hash('avaliador', 10), papel: 'AVALIADOR' },
      create: {
        nomeCompleto: 'Avaliador Externo de Teste',
        email: 'avaliador',
        senhaHash: await bcrypt.hash('avaliador', 10),
        papel: 'AVALIADOR',
        afiliacao: 'Externo',
      },
    });
  }

  console.log('Seed concluído.');
  console.log('Códigos:', codigos.map((c) => `${c.papel}=${c.codigo}`).join('  '));
  console.log(ehProducao ? 'Produção: usuários de teste NÃO criados.' : 'Logins de teste: adm/adm · aluno/aluno · avaliador/avaliador');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
