// Navegação baseada nas oito áreas observadas; disponibilidade explícita no piloto.
export const areas = [
  {id:'hoje',label:'Início',icon:'hoje'},
  {id:'pacientes',label:'Prontuários',icon:'pacientes'},
  {id:'financeiro',label:'Financeiro',icon:'financeiro'},
  {id:'orcamentos',label:'Orçamentos',icon:'financeiro'},
  {id:'agenda',label:'Agenda',icon:'agenda'},
  {id:'clinica',label:'Clínica',icon:'ajustes'},
  {id:'catalogo',label:'Catálogo',icon:'photo'},
  {id:'ajustes',label:'Conta e suporte',icon:'ajustes'},
];

export function areaPage(id){
  const data={
    orcamentos:{title:'Orçamentos',intro:'Propostas, sessões e condições de pagamento.',items:[['Orçamento por paciente','Itens, quantidade de sessões, descontos, validade e condições.'],['Aprovação e acompanhamento','Estado da proposta, histórico de versões e vínculo aos atendimentos.'],['Documento da proposta','Prévia e exportação com a identidade da clínica.']]},
    clinica:{title:'Clínica',intro:'Sua equipe, seus horários e os documentos de atendimento.',items:[['Horários e bloqueios','Funcionamento semanal, disponibilidade, intervalos e exceções.'],['Equipe e permissões','Acesso individual por área e histórico das operações.'],['Anamnese e termos','Modelos, perguntas condicionais, versões e assinaturas.'],['Custos fixos e metas','Despesas da clínica e acompanhamento de resultados.']]},
    catalogo:{title:'Catálogo',intro:'Procedimentos, produtos e estoque em um só lugar.',items:[['Procedimentos','Valores, duração, retorno, documentos e materiais vinculados.'],['Produtos e materiais','Unidade, custo e produtos usados nos atendimentos.'],['Estoque, lotes e validade','Entradas, consumo por atendimento, saldo e alertas.']]},
  }[id];
  if(!data)return '';
  return `<div class="page-heading"><div><h1>${data.title}</h1><p class="subtitle">${data.intro}</p></div><span class="badge rose">Em preparação</span></div><div class="area-preparation"><section class="card card-body"><h2>Esta área faz parte do aplicativo completo.</h2><p>Os controles operacionais ainda estão em desenvolvimento. Os itens abaixo apresentam o escopo desta área.</p><a class="secondary" href="#hoje">Voltar ao início</a></section><div class="area-sections">${data.items.map(([title,description])=>`<article class="card card-body"><h2>${title}</h2><p>${description}</p><span class="area-state">Implementação pendente</span></article>`).join('')}</div></div>`;
}
