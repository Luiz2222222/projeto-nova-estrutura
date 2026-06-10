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

  // Usuários de teste (login simples). Coordenador não se cadastra pela tela pública.
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

  // eslint-disable-next-line no-console
  console.log('Seed concluído.');
  // eslint-disable-next-line no-console
  console.log('Códigos:', codigos.map((c) => `${c.papel}=${c.codigo}`).join('  '));
  // eslint-disable-next-line no-console
  console.log('Logins de teste: adm/adm (coordenador) · aluno/aluno (aluno)');
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
