# Anamnese recebida → cadastro da paciente automático — 16/11/2026

Pedido da clínica (Rodney, 16/11/2026): colocar a data de nascimento da paciente que está na anamnese no
cadastro quando ele não tiver, e ligar os dados da anamnese ao cadastro da paciente depois que ela conclui
o preenchimento, sem a clínica precisar digitar de novo.

## Como funciona

1. A paciente preenche a ficha em `/anamnese/` (nome, CPF, data de nascimento e WhatsApp são obrigatórios lá).
2. Quando o app da clínica abre (e sempre que a tela **Anamneses preenchidas** é aberta), ele confere as
   anamneses recebidas. Para cada uma que ainda não tem cadastro completo:
   - **não existe paciente com aquele CPF** → cria o cadastro com nome, CPF, nascimento e WhatsApp;
   - **existe** (mesmo CPF, ou mesmo nome em cadastro ainda sem CPF) → preenche só os campos **vazios**
     (CPF, data de nascimento, WhatsApp). Nada já preenchido é trocado.
   - dado diferente do que está no cadastro (ex.: outra data de nascimento) → não mexe e avisa para conferir.
3. Aparece um aviso: "Cadastro criado pela anamnese: Fulana." / "Cadastro completado pela anamnese: ...".
4. Com CPF e nascimento no cadastro, o atalho **Enviar pelo WhatsApp** não pede mais esses dados e o link
   do termo pode ser gerado direto.

Cada anamnese é processada uma vez por aparelho (marcador em `localStorage`, chave
`amj.anamnese-cadastro.v1`, só com identificadores, sem dados pessoais): se a clínica apagar um cadastro
criado assim, ele não volta sozinho naquele aparelho.

## Peças

- **Servidor** `supabase/functions/app-workspace/clinical-bridge.mjs`: nova ação
  `identidade_documento_original` `{source_kind:'anamnese', source_id, expected_source_fingerprint}` →
  `{document, identity:{name, cpf, birth_date, phone}}`. Mesmas exigências das demais ações da ponte
  (titular, MFA, sessão ativa), só para anamnese com status `recebido`, não arquivada nem retirada, e
  com a impressão digital atual. Não grava nada. A listagem continua mascarando CPF e telefone.
  **Precisa republicar a Edge Function `app-workspace`** (sem migração de banco):
  `node scripts/edge-package.mjs` gera a lista de arquivos do pacote.
- **App** `painel/piloto-simples/anamnese-patient-sync.mjs` (regras e sincronização),
  `clinical-bridge-service.mjs` (`documentIdentity`), `app.mjs` (`syncPatientsFromAnamneses`: ao abrir o
  app e ao abrir Anamneses preenchidas; nunca roda com formulário em edição ou gravação em andamento).
- Enquanto o servidor não for republicado, a ação nova é recusada e o app simplesmente não altera nada
  (tenta de novo na próxima abertura). Nenhum erro aparece para a usuária.

## Limites

- O vínculo da anamnese com uma **consulta** ("Vincular original") continua sendo um clique da clínica,
  com confirmação de identidade; com o cadastro completo ele deixa de ser bloqueado por falta de CPF.
- E-mail, profissão e contato de emergência da anamnese não são copiados: o servidor não os expõe na
  identidade (ficam no PDF original).
- A anamnese enviada pelo link pessoal do app já nasce ligada ao cadastro (a paciente é escolhida antes).

## Testes

`node --test painel/piloto-simples/tests/anamnese-patient-sync.test.mjs` (7 testes: regras, sincronização
com as regras do servidor, falha/servidor antigo, ação do servidor e validação do cliente).
