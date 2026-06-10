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

  // Coordenador de teste (coordenador não se cadastra pela tela pública).
  const email = 'coordenador@dee.br';
  const existe = await prisma.usuario.findUnique({ where: { email } });
  if (!existe) {
    await prisma.usuario.create({
      data: {
        nomeCompleto: 'Coordenador de TCC',
        email,
        senhaHash: await bcrypt.hash('coordenador', 10),
        papel: 'COORDENADOR',
      },
    });
  }

  // eslint-disable-next-line no-console
  console.log('Seed concluído.');
  // eslint-disable-next-line no-console
  console.log('Códigos:', codigos.map((c) => `${c.papel}=${c.codigo}`).join('  '));
  // eslint-disable-next-line no-console
  console.log('Coordenador de teste: coordenador@dee.br / senha: coordenador');
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
