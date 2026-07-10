// Dados fictícios para a conta de demonstração ("Conta Demo")
// Usados apenas para apresentação a clientes — nunca tocam os dados reais do usuário.

export const DATA_KEYS = [
  'financeiro_dividas',
  'financeiro_receitas',
  'financeiro_categorias_receita',
  'financeiro_categorias_divida',
  'financeiro_saldo_inicial',
  'financeiro_efetivacoes',
  'planeje_orcamentos',
  'planeje_metas',
  'planeje_cartoes',
  'planeje_faturas',
  'planeje_tarefas',
  'planeje_grupos',
  'planeje_etiquetas',
  'planeje_categorias_orcamento',
];

const pad = (n) => String(n).padStart(2, '0');

export function buildDemoData() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const d = (day) => `${y}-${pad(m)}-${pad(day)}`;

  const dividas = [
    { id: 'demo-d1', nome: 'Aluguel', valor: 1500, vencimento: d(10), categoria: 'Moradia', recorrencia: 'fixa', periodicidade: 'Mensal', pago: true, pagamentoData: d(8), valorPago: 1500, criadoEm: Date.now() },
    { id: 'demo-d2', nome: 'Supermercado', valor: 680, vencimento: d(6), categoria: 'Alimentação', recorrencia: 'nao', pago: true, pagamentoData: d(6), valorPago: 680, criadoEm: Date.now() },
    { id: 'demo-d3', nome: 'Conta de Luz', valor: 220, vencimento: d(15), categoria: 'Conta/Serviço', recorrencia: 'fixa', periodicidade: 'Mensal', pago: false, pagamentoData: null, criadoEm: Date.now() },
    { id: 'demo-d4', nome: 'Internet', valor: 120, vencimento: d(18), categoria: 'Conta/Serviço', recorrencia: 'fixa', periodicidade: 'Mensal', pago: false, pagamentoData: null, criadoEm: Date.now() },
    { id: 'demo-d5', nome: 'Financiamento Carro', valor: 5100, vencimento: d(20), categoria: 'Financiamento', recorrencia: 'parcelar', parcelaInicial: 2, totalParcelas: 6, periodicidade: 'Mensal', pago: false, pagamentoData: null, criadoEm: Date.now() },
    { id: 'demo-d6', nome: 'Academia', valor: 90, vencimento: d(25), categoria: 'Saúde', recorrencia: 'fixa', periodicidade: 'Mensal', pago: false, pagamentoData: null, criadoEm: Date.now() },
  ];

  const receitas = [
    { id: 'demo-r1', nome: 'Salário', categoria: 'Salário', valor: 4500, data: d(5), recorrencia: 'fixa', periodicidade: 'Mensal', observacao: '', recebida: true, recebimentoData: d(5), valorRecebido: 4500 },
    { id: 'demo-r2', nome: 'Freelance Design', categoria: 'Freelance', valor: 1200, data: d(12), recorrencia: 'nao', periodicidade: 'Mensal', observacao: '', recebida: true, recebimentoData: d(12), valorRecebido: 1200 },
    { id: 'demo-r3', nome: 'Reembolso Plano de Saúde', categoria: 'Reembolso', valor: 250, data: d(28), recorrencia: 'nao', periodicidade: 'Mensal', observacao: '', recebida: false, recebimentoData: null, valorRecebido: 0 },
  ];

  const cartoes = [
    { id: 'demo-c1', nome: 'Nubank', bandeira: 'Mastercard', limite: 5000, diaFechamento: 20, diaPagamento: 27, cor: '#820ad1', faturasPagas: {} },
  ];

  const faturas = [
    { id: 'demo-f1', cartaoId: 'demo-c1', descricao: 'Restaurante', valor: 85, categoria: 'Alimentação', parcelas: 1, parcelaAtual: 1, mes: m, ano: y, data: d(3) },
    { id: 'demo-f2', cartaoId: 'demo-c1', descricao: 'Farmácia', valor: 150, categoria: 'Saúde', parcelas: 1, parcelaAtual: 1, mes: m, ano: y, data: d(9) },
    { id: 'demo-f3', cartaoId: 'demo-c1', descricao: 'Streaming', valor: 55.90, categoria: 'Lazer', parcelas: 1, parcelaAtual: 1, mes: m, ano: y, data: d(1) },
    { id: 'demo-f4', cartaoId: 'demo-c1', descricao: 'Roupas (1/3)', valor: 320, categoria: 'Vestuário', parcelas: 3, parcelaAtual: 1, mes: m, ano: y, data: d(14) },
  ];

  const orcamentos = [
    { id: 'demo-o1', categoria: 'Alimentação', limite: 1000 },
    { id: 'demo-o2', categoria: 'Transporte', limite: 400 },
    { id: 'demo-o3', categoria: 'Lazer', limite: 300 },
  ];

  const metas = [
    { id: 'demo-m1', nome: 'Viagem Portugal', valorAlvo: 8000, valorAtual: 2500, prazo: `${y}-12-01`, emoji: '✈️', cor: '#3b82f6', criadoEm: new Date().toISOString() },
    { id: 'demo-m2', nome: 'Reserva de Emergência', valorAlvo: 10000, valorAtual: 6500, prazo: '', emoji: '💰', cor: '#22c55e', criadoEm: new Date().toISOString() },
  ];

  return {
    financeiro_dividas: dividas,
    financeiro_receitas: receitas,
    financeiro_categorias_receita: [],
    financeiro_categorias_divida: [],
    financeiro_saldo_inicial: '3200',
    planeje_orcamentos: orcamentos,
    planeje_metas: metas,
    planeje_cartoes: cartoes,
    planeje_faturas: faturas,
    planeje_tarefas: [],
    planeje_grupos: [],
    planeje_etiquetas: [],
  };
}
