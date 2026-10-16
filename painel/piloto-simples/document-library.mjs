import {ADDITIONAL_PROCEDURE_MODELS} from './document-library-procedures.mjs';

// Modelos próprios: documentos existentes da clínica e termos específicos com fontes registradas.
// A importação prepara uma nova versão para revisão; não modifica originais emitidos.
export const CLINIC_DOCUMENT_MODELS = Object.freeze([
  {
    "id": "amj-anamnese-geral-20261016",
    "kind": "anamnese",
    "title": "Ficha de anamnese geral",
    "source": "Ficha oficial da clínica · versão de 16/10/2026",
    "body": "Responda com sinceridade sobre seu estado de saúde, medicamentos, alergias e procedimentos anteriores. Comunique qualquer alteração antes de cada atendimento. Esta ficha reúne as declarações gerais e não autoriza divulgação de imagem. A profissional revisará as respostas antes do atendimento.",
    "questions": [
      {
        "id": "saude-0",
        "label": "Está grávida, com suspeita de gravidez ou amamentando?",
        "type": "yesno",
        "required": true
      },
      {
        "id": "saude-1",
        "label": "Tem doença crônica em tratamento (diabetes, hipertensão, tireoide)?",
        "type": "yesno",
        "required": true
      },
      {
        "id": "saude-2",
        "label": "Tem doença cardíaca, renal ou hepática?",
        "type": "yesno",
        "required": true
      },
      {
        "id": "saude-3",
        "label": "Tem doença autoimune ou inflamatória?",
        "type": "yesno",
        "required": true
      },
      {
        "id": "saude-4",
        "label": "Tem doença neuromuscular (miastenia, ELA, outras)?",
        "type": "yesno",
        "required": true
      },
      {
        "id": "saude-5",
        "label": "Tem epilepsia ou já teve convulsões?",
        "type": "yesno",
        "required": true
      },
      {
        "id": "saude-6",
        "label": "Tem ou teve câncer? Está em tratamento oncológico?",
        "type": "yesno",
        "required": true
      },
      {
        "id": "saude-7",
        "label": "Tem imunossupressão de qualquer causa?",
        "type": "yesno",
        "required": true
      },
      {
        "id": "saude-8",
        "label": "Tem distúrbio de coagulação ou sangra com facilidade?",
        "type": "yesno",
        "required": true
      },
      {
        "id": "saude-9",
        "label": "Usa marca-passo ou tem prótese ou implante metálico?",
        "type": "yesno",
        "required": true
      },
      {
        "id": "saude-10",
        "label": "Tem histórico de queloide ou cicatrização anormal?",
        "type": "yesno",
        "required": true
      },
      {
        "id": "saude-11",
        "label": "Tem herpes labial ou genital recorrente?",
        "type": "yesno",
        "required": true
      },
      {
        "id": "saude-12",
        "label": "Tem doença de pele em atividade (acne, dermatite, rosácea)?",
        "type": "yesno",
        "required": true
      },
      {
        "id": "saude-13",
        "label": "Fez alguma cirurgia nos últimos 6 meses?",
        "type": "yesno",
        "required": true
      },
      {
        "id": "saude-14",
        "label": "Fez ou fará procedimento odontológico em até 2 semanas?",
        "type": "yesno",
        "required": true
      },
      {
        "id": "saude-15",
        "label": "Tomou vacina nas últimas 2 semanas?",
        "type": "yesno",
        "required": true
      },
      {
        "id": "saude-16",
        "label": "Fuma?",
        "type": "yesno",
        "required": true
      },
      {
        "id": "saude-17",
        "label": "Consome bebida alcoólica com frequência?",
        "type": "yesno",
        "required": true
      },
      {
        "id": "saude-detalhe",
        "label": "Se respondeu sim a algum item, conte mais aqui",
        "type": "long",
        "required": false
      },
      {
        "id": "medic-0",
        "label": "Usa anticoagulante ou antiagregante (AAS, varfarina, clopidogrel)?",
        "type": "yesno",
        "required": true
      },
      {
        "id": "medic-1",
        "label": "Usou isotretinoína oral nos últimos 6 meses?",
        "type": "yesno",
        "required": true
      },
      {
        "id": "medic-2",
        "label": "Usa corticoide de forma contínua?",
        "type": "yesno",
        "required": true
      },
      {
        "id": "medic-3",
        "label": "Usa anticoncepcional ou faz reposição hormonal?",
        "type": "yesno",
        "required": true
      },
      {
        "id": "medic-4",
        "label": "Tem alergia a anestésico local (lidocaína e semelhantes)?",
        "type": "yesno",
        "required": true
      },
      {
        "id": "medic-5",
        "label": "Tem alergia a látex?",
        "type": "yesno",
        "required": true
      },
      {
        "id": "continuo",
        "label": "Medicamentos de uso contínuo (quais e para quê)",
        "type": "long",
        "required": false
      },
      {
        "id": "suplementos",
        "label": "Suplementos, vitaminas e fitoterápicos",
        "type": "long",
        "required": false
      },
      {
        "id": "alergia-med",
        "label": "Alergias a medicamentos",
        "type": "text",
        "required": false
      },
      {
        "id": "alergia-out",
        "label": "Alergias a cosméticos, ativos ou alimentos",
        "type": "text",
        "required": false
      },
      {
        "id": "proc-0",
        "label": "Já realizou Toxina botulínica?",
        "type": "yesno",
        "required": true
      },
      {
        "id": "proc-detalhe-0",
        "label": "Quando, em qual região e com qual produto realizou Toxina botulínica?",
        "type": "long",
        "required": false,
        "condition": {
          "questionId": "proc-0",
          "value": "Sim"
        }
      },
      {
        "id": "proc-1",
        "label": "Já realizou Preenchimento com ácido hialurônico?",
        "type": "yesno",
        "required": true
      },
      {
        "id": "proc-detalhe-1",
        "label": "Quando, em qual região e com qual produto realizou Preenchimento com ácido hialurônico?",
        "type": "long",
        "required": false,
        "condition": {
          "questionId": "proc-1",
          "value": "Sim"
        }
      },
      {
        "id": "proc-2",
        "label": "Já realizou Preenchedor PERMANENTE (PMMA, silicone líquido, bioplastia)?",
        "type": "yesno",
        "required": true
      },
      {
        "id": "proc-detalhe-2",
        "label": "Quando, em qual região e com qual produto realizou Preenchedor PERMANENTE (PMMA, silicone líquido, bioplastia)?",
        "type": "long",
        "required": false,
        "condition": {
          "questionId": "proc-2",
          "value": "Sim"
        }
      },
      {
        "id": "proc-3",
        "label": "Já realizou Bioestimulador de colágeno?",
        "type": "yesno",
        "required": true
      },
      {
        "id": "proc-detalhe-3",
        "label": "Quando, em qual região e com qual produto realizou Bioestimulador de colágeno?",
        "type": "long",
        "required": false,
        "condition": {
          "questionId": "proc-3",
          "value": "Sim"
        }
      },
      {
        "id": "proc-4",
        "label": "Já realizou Fios de sustentação (PDO e outros)?",
        "type": "yesno",
        "required": true
      },
      {
        "id": "proc-detalhe-4",
        "label": "Quando, em qual região e com qual produto realizou Fios de sustentação (PDO e outros)?",
        "type": "long",
        "required": false,
        "condition": {
          "questionId": "proc-4",
          "value": "Sim"
        }
      },
      {
        "id": "proc-5",
        "label": "Já realizou Microagulhamento?",
        "type": "yesno",
        "required": true
      },
      {
        "id": "proc-detalhe-5",
        "label": "Quando, em qual região e com qual produto realizou Microagulhamento?",
        "type": "long",
        "required": false,
        "condition": {
          "questionId": "proc-5",
          "value": "Sim"
        }
      },
      {
        "id": "proc-6",
        "label": "Já realizou Peeling químico?",
        "type": "yesno",
        "required": true
      },
      {
        "id": "proc-detalhe-6",
        "label": "Quando, em qual região e com qual produto realizou Peeling químico?",
        "type": "long",
        "required": false,
        "condition": {
          "questionId": "proc-6",
          "value": "Sim"
        }
      },
      {
        "id": "proc-7",
        "label": "Já realizou Laser, luz pulsada ou radiofrequência?",
        "type": "yesno",
        "required": true
      },
      {
        "id": "proc-detalhe-7",
        "label": "Quando, em qual região e com qual produto realizou Laser, luz pulsada ou radiofrequência?",
        "type": "long",
        "required": false,
        "condition": {
          "questionId": "proc-7",
          "value": "Sim"
        }
      },
      {
        "id": "proc-8",
        "label": "Já realizou Depilação a laser?",
        "type": "yesno",
        "required": true
      },
      {
        "id": "proc-detalhe-8",
        "label": "Quando, em qual região e com qual produto realizou Depilação a laser?",
        "type": "long",
        "required": false,
        "condition": {
          "questionId": "proc-8",
          "value": "Sim"
        }
      },
      {
        "id": "proc-9",
        "label": "Já realizou Cirurgia plástica facial?",
        "type": "yesno",
        "required": true
      },
      {
        "id": "proc-detalhe-9",
        "label": "Quando, em qual região e com qual produto realizou Cirurgia plástica facial?",
        "type": "long",
        "required": false,
        "condition": {
          "questionId": "proc-9",
          "value": "Sim"
        }
      },
      {
        "id": "laser-interesse",
        "label": "Deseja avaliar depilação a laser neste atendimento?",
        "type": "yesno",
        "required": true
      },
      {
        "id": "laser-0",
        "label": "Tomou sol, foi à praia ou fez bronzeamento artificial nos últimos 15 dias?",
        "type": "yesno",
        "required": true,
        "condition": {
          "questionId": "laser-interesse",
          "value": "Sim"
        }
      },
      {
        "id": "laser-1",
        "label": "Usou autobronzeador nos últimos 15 dias?",
        "type": "yesno",
        "required": true,
        "condition": {
          "questionId": "laser-interesse",
          "value": "Sim"
        }
      },
      {
        "id": "laser-2",
        "label": "Depilou com cera, pinça ou linha nos últimos 30 dias?",
        "type": "yesno",
        "required": true,
        "condition": {
          "questionId": "laser-interesse",
          "value": "Sim"
        }
      },
      {
        "id": "laser-3",
        "label": "Tem tatuagem na área que quer tratar?",
        "type": "yesno",
        "required": true,
        "condition": {
          "questionId": "laser-interesse",
          "value": "Sim"
        }
      },
      {
        "id": "laser-4",
        "label": "Tem melasma, manchas escuras ou cicatriz escura na área?",
        "type": "yesno",
        "required": true,
        "condition": {
          "questionId": "laser-interesse",
          "value": "Sim"
        }
      },
      {
        "id": "laser-5",
        "label": "Já fez depilação a laser antes?",
        "type": "yesno",
        "required": true,
        "condition": {
          "questionId": "laser-interesse",
          "value": "Sim"
        }
      },
      {
        "id": "laser-6",
        "label": "Alguma vez teve queimadura, bolha ou mancha após laser?",
        "type": "yesno",
        "required": true,
        "condition": {
          "questionId": "laser-interesse",
          "value": "Sim"
        }
      },
      {
        "id": "laser-7",
        "label": "Usa medicamento fotossensibilizante (antibiótico, diurético, erva de São João)?",
        "type": "yesno",
        "required": true,
        "condition": {
          "questionId": "laser-interesse",
          "value": "Sim"
        }
      },
      {
        "id": "laser-8",
        "label": "Está usando ácido na área (retinoico, glicólico, salicílico)?",
        "type": "yesno",
        "required": true,
        "condition": {
          "questionId": "laser-interesse",
          "value": "Sim"
        }
      },
      {
        "id": "laser-9",
        "label": "Tem foliculite ou pelos encravados com frequência?",
        "type": "yesno",
        "required": true,
        "condition": {
          "questionId": "laser-interesse",
          "value": "Sim"
        }
      },
      {
        "id": "laser-10",
        "label": "Tem ovário policístico, hirsutismo ou alteração hormonal?",
        "type": "yesno",
        "required": true,
        "condition": {
          "questionId": "laser-interesse",
          "value": "Sim"
        }
      },
      {
        "id": "laser-11",
        "label": "Tem alguma lesão, ferida ou irritação na área agora?",
        "type": "yesno",
        "required": true,
        "condition": {
          "questionId": "laser-interesse",
          "value": "Sim"
        }
      },
      {
        "id": "laser-detalhe",
        "label": "Detalhe as respostas sobre depilação a laser",
        "type": "long",
        "required": false,
        "condition": {
          "questionId": "laser-interesse",
          "value": "Sim"
        }
      },
      {
        "id": "tipo-pele",
        "label": "Tipo de pele",
        "type": "select",
        "required": false,
        "options": [
          "Oleosa",
          "Mista",
          "Seca",
          "Normal",
          "Sensível"
        ]
      },
      {
        "id": "sol",
        "label": "Exposição ao sol no dia a dia",
        "type": "select",
        "required": false,
        "options": [
          "Baixa",
          "Média",
          "Alta"
        ]
      },
      {
        "id": "protetor",
        "label": "Usa protetor solar todos os dias?",
        "type": "select",
        "required": false,
        "options": [
          "Sim",
          "Às vezes",
          "Não"
        ]
      },
      {
        "id": "rotina",
        "label": "Rotina de cuidados atual (produtos que usa)",
        "type": "long",
        "required": false
      },
      {
        "id": "objetivo",
        "label": "Queixa principal e o que você espera do atendimento",
        "type": "long",
        "required": true
      }
    ],
    "steps": [
      {
        "id": "saude",
        "title": "Sua saúde",
        "questionIds": [
          "saude-0",
          "saude-1",
          "saude-2",
          "saude-3",
          "saude-4",
          "saude-5",
          "saude-6",
          "saude-7",
          "saude-8",
          "saude-9",
          "saude-10",
          "saude-11",
          "saude-12",
          "saude-13",
          "saude-14",
          "saude-15",
          "saude-16",
          "saude-17",
          "saude-detalhe"
        ]
      },
      {
        "id": "medicamentos",
        "title": "Medicamentos e alergias",
        "questionIds": [
          "medic-0",
          "medic-1",
          "medic-2",
          "medic-3",
          "medic-4",
          "medic-5",
          "continuo",
          "suplementos",
          "alergia-med",
          "alergia-out"
        ]
      },
      {
        "id": "historico",
        "title": "Procedimentos anteriores",
        "questionIds": [
          "proc-0",
          "proc-detalhe-0",
          "proc-1",
          "proc-detalhe-1",
          "proc-2",
          "proc-detalhe-2",
          "proc-3",
          "proc-detalhe-3",
          "proc-4",
          "proc-detalhe-4",
          "proc-5",
          "proc-detalhe-5",
          "proc-6",
          "proc-detalhe-6",
          "proc-7",
          "proc-detalhe-7",
          "proc-8",
          "proc-detalhe-8",
          "proc-9",
          "proc-detalhe-9"
        ]
      },
      {
        "id": "laser",
        "title": "Avaliação para depilação a laser",
        "questionIds": [
          "laser-interesse",
          "laser-0",
          "laser-1",
          "laser-2",
          "laser-3",
          "laser-4",
          "laser-5",
          "laser-6",
          "laser-7",
          "laser-8",
          "laser-9",
          "laser-10",
          "laser-11",
          "laser-detalhe"
        ]
      },
      {
        "id": "objetivo",
        "title": "Pele, cuidados e objetivo",
        "questionIds": [
          "tipo-pele",
          "sol",
          "protetor",
          "rotina",
          "objetivo"
        ]
      }
    ]
  },
  {
    "id": "amj-termo-toxina-20261016",
    "kind": "termo",
    "title": "Consentimento — Toxina botulínica",
    "source": "Conteúdo específico preservado do termo oficial toxina v3; declarações gerais e imagem em documentos separados.",
    "body": "As declarações gerais são registradas na anamnese obrigatória. A autorização de imagem é independente e tem documento próprio.\n\n1. FINALIDADE DO PROCEDIMENTO\n\nEste procedimento tem finalidade estética. Não se destina ao tratamento de doença, não substitui acompanhamento médico e não possui finalidade terapêutica neste atendimento.\n\nA aplicação proposta destina-se à suavização de rugas dinâmicas de expressão e ao equilíbrio estético da face, de acordo com a avaliação individual.\n\n2. O QUE É E COMO É FEITO\n\nA toxina botulínica tipo A é uma substância que, aplicada em pequenas quantidades no músculo, reduz temporariamente sua contração. Com o músculo menos ativo, as rugas formadas pelo movimento podem ficar menos marcadas.\n\nA aplicação é realizada com agulhas finas, em pontos definidos após avaliação e assepsia da região. O procedimento costuma durar de 15 a 30 minutos. Gelo ou anestésico tópico poderão ser utilizados para conforto, quando indicados.\n\nAs regiões pretendidas são registradas na seção individual. A definição final de pontos, dose e regiões cabe à profissional após avaliação. Algumas utilizações podem não constar da indicação aprovada na bula do produto escolhido. Se isso ocorrer, a profissional deverá informar o paciente antes da aplicação e obter confirmação específica.\n\n3. RESULTADO ESPERADO, LIMITAÇÕES E AUSÊNCIA DE GARANTIA\n\nO efeito não é imediato. Pode começar a ser percebido nos primeiros dias e atingir seu resultado progressivamente nas semanas seguintes. A duração é temporária e varia conforme organismo, metabolismo, produto, dose, região tratada e força muscular.\n\nA toxina botulínica atua principalmente sobre rugas de movimento. Rugas marcadas em repouso, flacidez, manchas e perda de volume podem não ser corrigidas e podem exigir outras abordagens.\n\nNenhum rosto é perfeitamente simétrico. Diferenças prévias entre os lados podem permanecer ou se tornar mais perceptíveis. O resultado varia de pessoa para pessoa. Imagens de outras pessoas são apenas referências e não constituem promessa de resultado igual.\n\nTrata-se de obrigação de meio, sem garantia de resultado estético específico. A profissional se compromete a empregar técnica, cuidado e materiais adequados. Esta cláusula não afasta direitos assegurados em lei nem exclui eventual responsabilidade profissional quando cabível.\n\n4. ALTERNATIVAS\n\nAs alternativas incluem não realizar o procedimento, manter cuidados tópicos e proteção solar ou avaliar outros procedimentos estéticos, cada qual com suas indicações, custos, benefícios e riscos. A escolha de realizar a aplicação deve ser livre e sem pressão.\n\n5. RISCOS E EFEITOS ADVERSOS\n\nTodo procedimento possui riscos. A frequência e a intensidade variam conforme o produto, a dose, a região, a técnica e as características individuais. A profissional confirmará as informações da bula atual do produto efetivamente utilizado antes da aplicação.\n\nPodem ocorrer dor, ardência ou desconforto durante a aplicação, vermelhidão, pequeno inchaço e hematomas nos pontos aplicados. Também podem ocorrer dor de cabeça, sensação de peso ou tensão, náusea, mal-estar, coceira, assimetria ou expressão diferente da desejada.\n\nEntre os efeitos menos frequentes estão queda temporária da pálpebra ou da sobrancelha, elevação exagerada da sobrancelha, visão dupla ou embaçada, dificuldade para fechar o olho, olho seco ou lacrimejamento, boca seca, fraqueza em músculos próximos, infecção e alterações temporárias do sorriso, da fala ou da capacidade de reter líquidos na boca. Aplicações no pescoço podem provocar dificuldade para engolir.\n\nRaramente podem ocorrer reação alérgica grave e disseminação do efeito da toxina para além do local aplicado, com fraqueza muscular generalizada, alteração da voz e dificuldade para falar, engolir ou respirar. Aplicações repetidas podem formar anticorpos e reduzir a resposta futura ao produto.\n\nNão existe substância capaz de reverter imediatamente o efeito já aplicado. Efeitos indesejados são acompanhados com medidas de suporte e tendem a acompanhar a duração temporária da toxina.\n\nATENÇÃO: procure atendimento médico imediatamente se apresentar dificuldade para respirar, engolir ou falar, fraqueza muscular generalizada, alteração importante da voz ou inchaço de lábios, língua ou garganta. Depois de buscar atendimento, comunique a clínica pelo telefone informado neste termo.\n\n6. CONFIRMAÇÃO DE SEGURANÇA ESPECÍFICA\n\nAs perguntas do questionário de saúde anexo são específicas para a avaliação da toxina botulínica. Elas não substituem a ficha de anamnese geral da clínica, que permanece um documento separado e necessário.\n\nO questionário completo é apresentado para preenchimento na seção “Confirmação de segurança específica” do formulário. Todas as perguntas, respostas e explicações são incluídas na cópia digital, como parte integrante deste documento.\n\nAs respostas e explicações individuais constam da seção individual deste documento. O paciente declara ter respondido com sinceridade e se compromete a comunicar qualquer alteração de saúde, medicamento, alergia ou procedimento anterior antes da aplicação.\n\nQualquer resposta de atenção exige revisão da profissional. O envio do formulário não representa liberação automática para o procedimento.\n\n7. CUIDADOS ANTES E DEPOIS\n\nAntes do atendimento: evite bebida alcoólica nas 24 horas anteriores; não suspenda medicamento de uso contínuo por conta própria; anticoagulantes somente podem ser interrompidos com autorização do profissional que os prescreveu; informe febre, infecção ativa ou lesão na pele; compareça com a face limpa e sem maquiagem, quando possível.\n\nDepois do atendimento: não massageie, esfregue, aperte ou aplique calor na região tratada até liberação; evite exercício intenso, sauna, banho muito quente e exposição solar prolongada nas primeiras 24 a 48 horas, salvo orientação individual diferente; evite pressão de acessórios sobre a área aplicada; e siga as orientações individuais sobre postura, repouso e retorno.\n\nEvite procedimentos faciais na região até a liberação profissional. A reavaliação costuma ocorrer entre o 14º e o 21º dia. Eventual complementação será avaliada nessa consulta e não constitui garantia de correção de resultado.\n\nDiante de sintoma preocupante, entre em contato com a clínica. Nos sinais de urgência descritos na seção 5, procure primeiro atendimento médico imediato.\n\n8. REGISTRO DO MATERIAL APLICADO\n\nEsta seção é exclusiva da profissional e será preenchida a cada sessão: data; produto e marca; lote; validade; número de registro na Anvisa; diluição; região; unidades aplicadas; intercorrências; identificação e assinatura profissional.\n\nO registro profissional ainda não preenchido ou assinado mantém este documento no estado “aguardando revisão profissional”.\n\n9. DIREITO DE RECUSAR OU RETIRAR O CONSENTIMENTO\n\nO paciente pode recusar ou desistir do procedimento antes da aplicação, sem precisar justificar e sem represália ou prejuízo no atendimento. Depois da aplicação, o procedimento realizado não pode ser desfeito, permanecendo o acompanhamento, o registro clínico e a guarda de dados quando necessários.\n\n10. DECLARAÇÃO FINAL\n\nAo enviar este documento, o paciente declara que leu integralmente o termo; recebeu informação sobre finalidade, forma de realização, benefícios esperados, limitações, alternativas, riscos e efeitos adversos; teve oportunidade de registrar dúvidas; compreendeu que o resultado é temporário e individual; respondeu com sinceridade ao questionário específico deste procedimento; e manifesta vontade livre de prosseguir para a avaliação profissional.\n\nO paciente compreende que o envio eletrônico é uma manifestação inicial documentada e que, antes da aplicação, a profissional deve revisar as respostas, esclarecer dúvidas, confirmar o consentimento e completar o registro e a assinatura profissional.\n\nUma cópia digital deste envio será disponibilizada imediatamente. O documento clínico completo dependerá da revisão e do registro profissional no atendimento.",
    "questions": [
      {
        "id": "regioes",
        "label": "Regiões pretendidas para avaliação",
        "type": "long",
        "required": true
      },
      {
        "id": "objetivo",
        "label": "Objetivo e expectativas do procedimento",
        "type": "long",
        "required": true
      },
      {
        "id": "mudancas",
        "label": "Mudanças de saúde desde o preenchimento da anamnese",
        "type": "long",
        "required": false
      },
      {
        "id": "duvidas",
        "label": "Dúvidas para esclarecer com a profissional",
        "type": "long",
        "required": false
      }
    ]
  },
  {
    "id": "amj-termo-preenchimento-20261016",
    "kind": "termo",
    "title": "Consentimento — Preenchimento com ácido hialurônico",
    "source": "Conteúdo específico preservado do termo oficial preenchimento v3; declarações gerais e imagem em documentos separados.",
    "body": "As declarações gerais são registradas na anamnese obrigatória. A autorização de imagem é independente e tem documento próprio.\n\n1. FINALIDADE DO PROCEDIMENTO\n\nEste procedimento tem finalidade exclusivamente estética. Não se destina ao tratamento de doença, não substitui acompanhamento médico e não possui finalidade terapêutica neste atendimento.\n\nO preenchimento proposto destina-se à reposição de volume, à suavização de sulcos e ao equilíbrio estético do contorno facial, de acordo com a avaliação individual.\n\n2. O QUE É E COMO É FEITO\n\nO ácido hialurônico é uma substância semelhante a componentes existentes naturalmente no organismo. O preenchedor é aplicado sob a pele para repor volume, dar suporte a estruturas ou suavizar sulcos. O produto é absorvível e seu efeito diminui com o tempo.\n\nA aplicação é realizada com agulha ou microcânula, após avaliação e assepsia da região. Anestésico tópico ou produto com anestésico poderá ser utilizado quando indicado. A escolha do produto, da técnica, do plano de aplicação e do volume cabe à profissional após avaliação individual.\n\nEste termo se aplica exclusivamente a preenchedores absorvíveis à base de ácido hialurônico com registro regular na Anvisa. Não autoriza o uso de PMMA, silicone líquido, óleos, produtos permanentes ou substâncias sem regularização sanitária aplicável.\n\n3. REGIÕES PRETENDIDAS E PLANO INDIVIDUAL\n\nO formulário permite indicar as seguintes regiões: Lábios; Sulco nasogeniano; Olheiras / região infraorbital; Malar / maçã do rosto; Mento / queixo; Mandíbula / contorno; Têmporas; Sulco labiomentual; ou Outra.\n\nAs regiões marcadas, o objetivo informado e o detalhamento ou volume inicialmente previsto constam da seção individual. Essas informações registram a intenção do paciente e não constituem promessa, prescrição ou autorização automática de quantidade.\n\nA definição final da região, do produto e marca, do lote, da validade, do número de registro na Anvisa, da técnica e do volume será feita pela profissional e deverá constar do registro do material aplicado.\n\n4. RESULTADO ESPERADO, LIMITAÇÕES E AUSÊNCIA DE GARANTIA\n\nPode haver mudança perceptível logo após a aplicação, mas esse aspecto inicial não corresponde necessariamente ao resultado final, pois inchaço, sensibilidade, hematomas e assimetrias temporárias podem alterar a aparência.\n\nO efeito é temporário e varia conforme o produto, a região, a quantidade aplicada, o metabolismo, a idade, hábitos e características individuais. A duração e o momento adequado para reavaliação devem ser confirmados pela profissional com base no produto efetivamente utilizado e em sua bula vigente.\n\nO preenchimento repõe volume e modifica contornos. Ele pode não corrigir flacidez acentuada, manchas, textura, rugas finas ou todas as assimetrias. Pode ser necessária mais de uma sessão, após nova avaliação, com custos e riscos próprios.\n\nNenhum rosto é perfeitamente simétrico. Diferenças anteriores podem permanecer ou tornar-se mais perceptíveis. Imagens de outras pessoas são apenas referências e não constituem promessa de resultado igual.\n\nNão há garantia de resultado estético específico. A profissional se compromete a empregar técnica, cuidado e materiais adequados. Esta informação não afasta direitos assegurados em lei nem exclui eventual responsabilidade profissional quando cabível.\n\n5. ALTERNATIVAS\n\nAs alternativas incluem não realizar o procedimento, manter cuidados tópicos e proteção solar ou avaliar outros procedimentos estéticos ou cirúrgicos, cada qual com indicações, custos, benefícios e riscos próprios. A escolha de realizar o preenchimento deve ser livre e sem pressão.\n\n6. RISCOS E EFEITOS ADVERSOS\n\nTodo procedimento possui riscos. A ocorrência e a intensidade variam conforme o produto, a região, o volume, a técnica e as características individuais. A profissional confirmará as informações e advertências da bula atual do produto efetivamente utilizado antes da aplicação.\n\nPodem ocorrer dor, ardência ou desconforto durante a aplicação; inchaço, vermelhidão, sensibilidade, coceira e hematomas; assimetria temporária ou persistente; endurecimento; irregularidades, saliências ou nódulos visíveis ou palpáveis; e resultado diferente do esperado.\n\nTambém podem ocorrer deslocamento ou migração do produto; efeito Tyndall, com coloração azulada quando o produto fica muito superficial; reativação de herpes; infecção; inflamação tardia; granuloma; biofilme de difícil tratamento; e reação de hipersensibilidade ao produto, à lidocaína ou a outro anestésico.\n\nNódulos, inflamações e irregularidades exigem avaliação profissional. A conduta pode incluir observação, tratamento clínico, hialuronidase ou outra intervenção, conforme a causa. Não massageie ou tente corrigir a região por conta própria.\n\nPreenchedor permanente previamente aplicado pode aumentar riscos e precisa ser informado. A hialuronidase atua sobre ácido hialurônico e não dissolve materiais permanentes como PMMA ou silicone.\n\nPodem ocorrer reação alérgica grave, inclusive anafilaxia, e oclusão vascular. A oclusão pode provocar necrose da pele, ferida, cicatriz permanente, perda parcial ou total e irreversível da visão e evento neurológico.\n\n7. RISCO VASCULAR E SINAIS DE URGÊNCIA\n\nA face possui artérias e outros vasos. A oclusão vascular pode ocorrer se o produto entrar em um vaso ou comprometer o fluxo sanguíneo. Esse evento pode acontecer mesmo quando são adotadas técnica adequada, avaliação cuidadosa e microcânula.\n\nO risco varia conforme a região e sua anatomia vascular. A profissional deve avaliar a região pretendida, explicar o risco específico e decidir se o procedimento pode ser realizado com segurança.\n\nATENÇÃO: procure atendimento médico imediatamente se apresentar dor intensa e desproporcional, dor que aumenta, pele branca, pálida ou acinzentada, manchas arroxeadas em padrão de rede, bolhas, feridas, escurecimento da pele ou qualquer alteração visual, como visão embaçada ou dupla, perda de campo visual, dor no olho ou queda da pálpebra. Não espere para ver se melhora.\n\nNos sinais de urgência, especialmente qualquer alteração visual ou neurológica, procure imediatamente um pronto-socorro ou acione o Samu pelo número 192. Não aguarde resposta da clínica. Informe que realizou preenchimento com ácido hialurônico, a região e a data e, depois de buscar atendimento, comunique a clínica pelo número (31) 99584-4803.\n\nA hialuronidase é uma enzima que dissolve o ácido hialurônico e pode ser necessária no manejo urgente de suspeita de oclusão vascular. O tratamento deve ser iniciado o mais rapidamente possível quando indicado. A própria hialuronidase pode provocar reação alérgica, inclusive grave.\n\nAo confirmar a ciência específica no formulário, o paciente declara compreender que, diante de suspeita de complicação, podem ser necessárias avaliação imediata, encaminhamento e medidas de urgência, inclusive hialuronidase quando clinicamente indicada para o produto utilizado. A ciência registrada não representa renúncia de direitos, não substitui a avaliação profissional e não dispensa o dever de informação, o registro da conduta e o encaminhamento médico quando necessário.\n\n8. CONFIRMAÇÃO DE SEGURANÇA ESPECÍFICA\n\nAs perguntas do questionário de saúde anexo são específicas para a avaliação do preenchimento facial. Elas não substituem a ficha de anamnese geral da clínica, que permanece um documento separado e necessário.\n\nO questionário completo é apresentado para preenchimento na seção “Confirmação de segurança específica” do formulário. Todas as perguntas, respostas e explicações são incluídas na cópia digital, como parte integrante deste documento.\n\nAs respostas e explicações individuais constam da seção individual deste documento. O paciente declara ter respondido com sinceridade e se compromete a comunicar qualquer alteração de saúde, medicamento, alergia, vacinação, procedimento odontológico ou procedimento estético antes da aplicação.\n\nQualquer resposta de atenção exige revisão da profissional. O envio do formulário não representa liberação automática para o procedimento.\n\n9. ORIENTAÇÕES ANTES E DEPOIS\n\nNão suspenda medicamentos prescritos, anticoagulantes ou antiagregantes por conta própria. Informe todos os medicamentos, suplementos, alergias, infecções, febre, herpes, lesões de pele, vacinação recente ou prevista e procedimentos odontológicos recentes ou planejados.\n\nAntes e depois do atendimento, siga somente as orientações individualizadas fornecidas pela profissional para o produto e a região tratados. Elas podem abranger higiene, maquiagem, compressa, posição para dormir, exercício, calor, sol, massagem, procedimentos faciais, vacinação, atendimento odontológico e retorno.\n\nNão massageie, aperte, aqueça ou tente corrigir a região sem orientação. Procure a clínica diante de sintoma inesperado. Nos sinais descritos na seção 7, procure atendimento médico imediatamente.\n\n10. REGISTRO DO MATERIAL APLICADO\n\nEsta seção é exclusiva da profissional e será preenchida a cada sessão: data; produto e marca; lote; validade; número de registro na Anvisa; região; volume em mililitros; agulha ou cânula; intercorrências e conduta; e identificação e assinatura profissional.\n\nSe houver uso de hialuronidase, também devem ser registrados produto, lote, validade, volume ou quantidade aplicada, motivo e conduta adotada.\n\nO registro profissional ainda não preenchido ou assinado mantém este documento no estado “aguardando revisão profissional”.\n\n11. DIREITO DE RECUSAR OU RETIRAR O CONSENTIMENTO\n\nO paciente pode recusar ou desistir do procedimento antes da aplicação, sem precisar justificar e sem represália ou prejuízo no atendimento.\n\nDepois da aplicação, o procedimento realizado não pode ser simplesmente desfeito. A hialuronidase poderá ser considerada para ácido hialurônico quando indicada, mas constitui nova intervenção, com avaliação, riscos e registro próprios.\n\n12. DECLARAÇÃO FINAL\n\nAo enviar este documento, o paciente declara que leu integralmente o termo; recebeu informação sobre finalidade, forma de realização, benefícios esperados, limitações, alternativas, riscos e efeitos adversos; compreendeu especificamente o risco de oclusão vascular, necrose, cicatriz permanente, perda irreversível da visão e evento neurológico; teve oportunidade de registrar dúvidas; respondeu com sinceridade ao questionário específico deste procedimento; e manifesta vontade livre de prosseguir para a avaliação profissional.\n\nO paciente compreende que o envio eletrônico é uma manifestação inicial documentada e que, antes da aplicação, a profissional deve revisar as respostas, esclarecer dúvidas, confirmar o produto e sua regularização, confirmar o consentimento e completar o registro e a assinatura profissional.\n\nUma cópia digital deste envio será disponibilizada imediatamente. O documento clínico completo dependerá da revisão e do registro profissional no atendimento.",
    "questions": [
      {
        "id": "regioes",
        "label": "Regiões pretendidas para avaliação",
        "type": "long",
        "required": true
      },
      {
        "id": "objetivo",
        "label": "Objetivo e expectativas do procedimento",
        "type": "long",
        "required": true
      },
      {
        "id": "mudancas",
        "label": "Mudanças de saúde desde o preenchimento da anamnese",
        "type": "long",
        "required": false
      },
      {
        "id": "duvidas",
        "label": "Dúvidas para esclarecer com a profissional",
        "type": "long",
        "required": false
      }
    ]
  },
  {
    "id": "amj-imagem-20261016",
    "kind": "imagem",
    "title": "Autorização independente de uso de imagem",
    "source": "Seção de imagem do termo oficial da clínica v3, preservada em documento independente.",
    "body": "A autorização de imagem é independente do consentimento para o procedimento. Recusar não impede o atendimento e não reduz sua qualidade. Nenhuma finalidade de divulgação vem previamente autorizada.\n\nO paciente decide separadamente sobre fotografia para prontuário interno; divulgação em redes sociais ou materiais profissionais; uso em comparativo de antes e depois; forma de enquadramento; uso do primeiro nome; e divulgação de depoimento.\n\nTarja, recorte ou enquadramento parcial não garantem anonimização completa, pois voz, tatuagens, contexto e outras características podem permitir identificação.\n\nAs autorizações opcionais podem ser revogadas para o futuro por mensagem ao contato informado. A clínica retirará o material dos canais sob seu controle em prazo razoável, sem possibilidade de recolher cópias já compartilhadas por terceiros. Imagens não poderão ser editadas para criar resultado diferente do real.",
    "questions": [
      {
        "id": "foto-prontuario",
        "label": "Autoriza fotografia para o prontuário interno?",
        "type": "yesno",
        "required": true
      },
      {
        "id": "antes-depois",
        "label": "Autoriza divulgação em comparativo de antes e depois?",
        "type": "yesno",
        "required": true
      },
      {
        "id": "enquadramento",
        "label": "Enquadramento autorizado para divulgação",
        "type": "select",
        "required": true,
        "options": [
          "Não autorizo divulgação",
          "Rosto inteiro",
          "Enquadramento parcial / tarja"
        ]
      },
      {
        "id": "nome",
        "label": "Autoriza divulgar seu primeiro nome?",
        "type": "yesno",
        "required": true
      },
      {
        "id": "depoimento",
        "label": "Autoriza divulgar seu depoimento?",
        "type": "yesno",
        "required": true
      },
      {
        "id": "canais",
        "label": "Canais de divulgação autorizados e limites (se houver)",
        "type": "long",
        "required": false
      }
    ]
  },
  ...ADDITIONAL_PROCEDURE_MODELS
]);
