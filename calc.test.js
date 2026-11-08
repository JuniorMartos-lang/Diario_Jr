// Teste: node calc.test.js (dentro de app/)
const assert = require('assert');
const c = require('./calc.js');

// Datas
assert.strictEqual(c.addMes('2026-12', 1), '2027-01');
assert.strictEqual(c.addMes('2026-01', 13), '2027-02');
assert.strictEqual(c.dataNoMes('2026-02', 31), '2026-02-28');
assert.strictEqual(c.dataNoMes('2028-02', 31), '2028-02-29');

// Fatura: fecha dia 25, vence dia 5 do mes seguinte
const nu = { id: 'nu', nome: 'Nu', fechamento: 25, vencimento: 5, contaPag: 'conta' };
assert.strictEqual(c.mesFatura('2026-10-24', nu), '2026-11');
assert.strictEqual(c.mesFatura('2026-10-25', nu), '2026-12', 'dia do fechamento vai para a seguinte');
assert.strictEqual(c.mesFatura('2026-12-26', nu), '2027-02', 'virada de ano');

// Fecha dia 1, vence dia 10 do mesmo mes
const it = { id: 'it', nome: 'It', fechamento: 1, vencimento: 10 };
assert.strictEqual(c.mesFatura('2026-10-01', it), '2026-11');
assert.strictEqual(c.mesFatura('2026-10-15', it), '2026-11');

// Fecha dia 31 em fevereiro: o ultimo dia do mes conta como fechamento
const fim = { id: 'fim', nome: 'Fim', fechamento: 31, vencimento: 10 };
assert.strictEqual(c.mesFatura('2026-02-27', fim), '2026-03');
assert.strictEqual(c.mesFatura('2026-02-28', fim), '2026-04');

const base = () => c.migrar({
  contasBanco: [
    { id: 'conta', nome: 'Corrente', tipo: 'corrente', saldoInicial: 100000 },
    { id: 'poup', nome: 'Poupança', tipo: 'poupanca', saldoInicial: 0 },
  ],
  series: [],
  categorias: [{ id: 'a', nome: 'Alimentação', tipo: 'S' }, { id: 'm', nome: 'Moradia', tipo: 'S' }],
  cartoes: [nu],
  lancs: [
    { id: 1, tipo: 'E', data: '2026-10-05', valor: 500000, cat: 'a', meio: 'conta', pago: true },
    { id: 2, tipo: 'S', data: '2026-10-06', valor: 20000, cat: 'a', meio: 'conta', pago: true },
    { id: 3, tipo: 'S', data: '2026-10-10', valor: 30000, cat: 'a', meio: 'nu', parcelas: 3, pago: true },
    { id: 5, tipo: 'S', desc: 'Aluguel', data: '2026-10-10', valor: 150000, cat: 'm', meio: 'conta', pago: true },
    { id: 6, tipo: 'S', desc: 'Luz', data: '2026-10-20', valor: 25000, cat: 'm', meio: 'conta', pago: false },
    { id: 7, tipo: 'S', desc: 'Água', data: '2026-11-20', valor: 8000, cat: 'm', meio: 'conta', pago: false },
    { id: 8, tipo: 'E', desc: 'Freela', data: '2026-11-15', valor: 70000, cat: 'a', meio: 'conta', pago: false },
  ],
  faturasPagas: {},
}, '2026-10-31');

// Fechamento e liberacao do pagamento
assert.strictEqual(c.fechamentoFatura(nu, '2026-11'), '2026-10-25', 'vence no mes seguinte ao fechamento');
assert.strictEqual(c.fechamentoFatura(it, '2026-11'), '2026-11-01', 'vence no mesmo mes');
assert.strictEqual(c.fechamentoFatura(nu, '2027-01'), '2026-12-25', 'virada de ano');
assert.strictEqual(c.fechamentoFatura(fim, '2026-04'), '2026-03-31');
assert.strictEqual(c.fechamentoFatura(fim, '2026-03'), '2026-02-28');
assert.ok(!c.faturaPagavel(nu, '2026-11', '2026-10-24'), 'antes de fechar');
assert.ok(c.faturaPagavel(nu, '2026-11', '2026-10-25'), 'no fechamento');
assert.ok(c.faturaPagavel(nu, '2026-11', '2026-11-20'), 'atrasada');
assert.ok(!c.faturaPagavel(nu, '2026-12', '2026-10-31'), 'fatura seguinte');

// Parcelas no cartao: soma exata, centavos nas primeiras, uma por fatura (ja convertidas de um lancamento so)
const parcelar = (dados, per, total, cart = nu) => {
  const d = { contasBanco: [{ id: 'conta', nome: 'C', saldoInicial: 0 }], cartoes: [cart], series: [], parciais: [], lancs: [], faturasPagas: {}, categorias: [] };
  c.criarParcelada(d, 'p', { tipo: 'S', desc: 'X', cat: 'a', ...dados }, per, total, '2026-10-31');
  return d;
};
let dp = parcelar({ data: '2026-10-10', valor: 10000, meio: 'nu', pago: true }, 'mensal', 3);
assert.deepStrictEqual(dp.lancs.map((x) => x.valor), [3334, 3333, 3333]);
assert.deepStrictEqual(dp.lancs.map((x) => [x.parcela, x.de, x.compra]), [[1, 3, '2026-10-10'], [2, 3, '2026-10-10'], [3, 3, '2026-10-10']]);
assert.deepStrictEqual(['2026-11', '2026-12', '2027-01'].map((m) => c.totalFatura(dp, nu, m)), [3334, 3333, 3333]);
assert.ok(dp.lancs.every((x) => x.pago), 'no cartao quem paga e a fatura');
// Mes curto nao faz a parcela pular fatura
const fecha30 = { id: 'f30', nome: 'F', fechamento: 30, vencimento: 10, contaPag: 'conta' };
dp = parcelar({ data: '2026-01-29', valor: 400, meio: 'f30', pago: true }, 'mensal', 4, fecha30);
assert.deepStrictEqual(['2026-02', '2026-03', '2026-04', '2026-05'].map((m) => c.totalFatura(dp, fecha30, m)), [100, 100, 100, 100]);
// Em conta: pendentes, mensal ou em outro periodo; paga na criacao so ate hoje
dp = parcelar({ data: '2026-10-05', valor: 9000, meio: 'conta', pago: true }, 'mensal', 3);
assert.deepStrictEqual(dp.lancs.map((x) => [x.data, x.pago]), [['2026-10-05', true], ['2026-11-05', false], ['2026-12-05', false]]);
dp = parcelar({ data: '2026-11-01', valor: 6000, meio: 'conta', pago: false }, 'bimestral', 2);
assert.deepStrictEqual(dp.lancs.map((x) => x.data), ['2026-11-01', '2027-01-01']);
dp = parcelar({ data: '2026-11-01', valor: 6000, meio: 'conta', pago: false }, 'semanal', 2);
assert.deepStrictEqual(dp.lancs.map((x) => x.data), ['2026-11-01', '2026-11-08']);
assert.ok(c.backupValido(JSON.parse(JSON.stringify(dp))));
assert.strictEqual(c.completarSeries(dp, '2030-01'), false, 'parcelada nao cria mais');
// Editar a descricao das proximas nao mexe nos centavos; mudar o valor sim
dp = parcelar({ data: '2026-10-10', valor: 10000, meio: 'nu', pago: true }, 'mensal', 3);
c.aplicarEdicao(dp, 'p-1', { ...dp.lancs[1], desc: 'Nova' }, 'proximas');
assert.deepStrictEqual(dp.lancs.map((x) => [x.desc, x.valor]), [['X', 3334], ['Nova', 3333], ['Nova', 3333]]);
assert.deepStrictEqual(dp.lancs.map((x) => x.parcela), [1, 2, 3]);
c.aplicarEdicao(dp, 'p-1', { ...dp.lancs[1], valor: 5000 }, 'proximas');
assert.deepStrictEqual(dp.lancs.map((x) => x.valor), [3334, 5000, 5000]);
// So esta e proximas ao excluir
c.excluirLanc(dp, 'p-2', 'esta');
assert.deepStrictEqual(dp.lancs.map((x) => x.id), ['p-0', 'p-1']);
c.excluirLanc(dp, 'p-1', 'proximas');
assert.deepStrictEqual(dp.lancs.map((x) => x.id), ['p-0']);
assert.ok(c.backupValido(JSON.parse(JSON.stringify(dp))));
// Finais do cartao no backup: ate 4, cada um com 4 numeros
{ const b = JSON.parse(JSON.stringify(dp)); const k = b.cartoes[0];
  k.finais = [{ n: '1234', tipo: 'F' }, { n: '0001', tipo: 'V' }]; assert.ok(c.backupValido(b));
  k.finais = [{ n: '123', tipo: 'F' }]; assert.ok(!c.backupValido(b));
  k.finais = ['1111', '2222', '3333', '4444', '5555'].map((n) => ({ n, tipo: 'F' })); assert.ok(!c.backupValido(b));
  k.finais = [{ n: '1234', tipo: 'X' }]; assert.ok(!c.backupValido(b));
  k.finais = [{ n: '1234', tipo: 'V', dono: 'A' }]; assert.ok(c.backupValido(b));
  k.finais = [{ n: '1234', tipo: 'V', dono: 'Z' }]; assert.ok(!c.backupValido(b));
  k.finais = []; k.finaisInativos = [{ n: '1234', tipo: 'V', dono: 'A', motivo: 'Trocado', em: '2026-11-03' }]; assert.ok(c.backupValido(b));
  k.finaisInativos = [{ n: '1234', tipo: 'V', motivo: '', em: '2026-11-03' }]; assert.ok(!c.backupValido(b));
  k.finaisInativos = [{ n: '1234', tipo: 'V', motivo: 'Trocado' }]; assert.ok(!c.backupValido(b)); delete k.finaisInativos;
  k.ativoAte = '2027-03'; assert.ok(c.backupValido(b)); k.ativoAte = '03/2027'; assert.ok(!c.backupValido(b)); delete k.ativoAte;
  b.categorias.push({ id: 'cq', nome: 'Q', tipo: 'S', arquivadaEm: '2026-11-03' }); assert.ok(c.backupValido(b)); b.categorias[b.categorias.length - 1].arquivadaEm = 'ontem'; assert.ok(!c.backupValido(b)); b.categorias.pop(); }
// Cartao arquivado: compras ate o arquivamento seguem nas faturas (parcelas futuras e compra depois do fechamento); as de depois, nao.
{ const cart = { id: 'k1', nome: 'K', fechamento: 1, vencimento: 10, contaPag: 'conta' };
  const lanc = (id, data, extra) => ({ id, tipo: 'S', data, desc: id, valor: 100, cat: 'x', meio: 'k1', pago: true, ...extra });
  const dbA = { contasBanco: [{ id: 'conta', nome: 'C', saldoInicial: 0 }], cartoes: [cart], categorias: [], series: [], faturasPagas: {}, parciais: [],
    lancs: [lanc('p3', '2027-01-05', { compra: '2026-10-05', parcela: 3, de: 3 }), lanc('depois', '2026-11-02'), lanc('fixa', '2026-12-05')] };
  cart.arquivadaEm = '2026-11-03'; cart.ativoAte = c.ultimaFaturaAte(dbA, cart, cart.arquivadaEm);
  assert.strictEqual(cart.ativoAte, c.mesFatura('2027-01-05', cart));
  const nomes = (ym) => c.itensFatura(dbA, cart, ym).map((p) => p.lanc.id);
  assert.deepStrictEqual(nomes(c.mesFatura('2026-11-02', cart)), ['depois']);
  assert.ok(nomes(cart.ativoAte).includes('p3'));
  assert.ok(!nomes(c.mesFatura('2026-12-05', cart)).includes('fixa'));
  assert.ok(c.ativoEm(cart, cart.ativoAte) && !c.ativoEm(cart, c.addMes(cart.ativoAte, 1)));
  assert.ok(c.backupValido(dbA)); }

// Pagamento parcial: o resto fica em aberto na mesma fatura
let dpp = parcelar({ data: '2026-10-10', valor: 30000, meio: 'nu', pago: true }, 'mensal', 3);
dpp.contasBanco[0].saldoInicial = 100000;
assert.strictEqual(c.restanteFatura(dpp, nu, '2026-11'), 10000);
c.pagarFatura(dpp, nu, '2026-11', { data: '2026-11-01', valor: 4000, conta: 'conta' });
assert.strictEqual(c.restanteFatura(dpp, nu, '2026-11'), 6000);
assert.strictEqual(c.saldo(dpp, '2026-11-02'), 96000);
assert.strictEqual(c.saldo(dpp, '2026-10-31'), 100000, 'data futura ainda nao conta');
assert.deepStrictEqual(c.aPagar(dpp, '2026-11').map((x) => x.valor), [6000]);
assert.strictEqual(c.totalFaturasDoMes(dpp, '2026-11'), 10000);
let fp = c.fluxoMes(dpp, '2026-11', '2026-11-02');
assert.deepStrictEqual([fp.saidas, fp.prevSaidas, fp.previsao], [4000, 10000, 90000]);
assert.deepStrictEqual(c.linhasFluxo(dpp, '2026-11', 'fluxo').map((x) => [x.valor, x.pago]), [[4000, true], [6000, false]]);
assert.ok(c.backupValido(JSON.parse(JSON.stringify(dpp))));
// Area USA: opcional, com cadastros proprios.
{ const foto = 'data:image/jpeg;base64,AAAA';
  const viag = (x) => ({ id: 'v1', nome: 'Orlando', moedas: ['USD'], base: 'USD', viajantes: [], cot: {}, ...x });
  const u = { moedas: c.MOEDAS_PADRAO, despesas: [], viagens: [viag({ fundo: foto })], contas: [{ id: 'u1', nome: 'Wise' }], cartoes: [{ id: 'u2', nome: 'Visa', tipo: 'V' }],
    viajantes: [{ id: 'u3', nome: 'Ana', foto }], categorias: [{ id: 'u4', nome: 'Parques', simbolo: 'etiqueta', cor: '#1b76c9' }] };
  assert.ok(c.backupValido({ ...dpp, usa: u }));
  assert.ok(c.usaValido(undefined));
  assert.ok(c.backupValido({ ...dpp, usa: { ...u, viagens: [viag({ inicio: '2027-01-10', fim: '2027-01-20' }), viag({ id: 'v2', nome: 'NY' })] } }));
  assert.ok(!c.backupValido({ ...dpp, usa: { ...u, viagens: [viag({ inicio: '10/01/2027' })] } }));
  assert.ok(!c.backupValido({ ...dpp, usa: { ...u, viagens: undefined } }));
  assert.ok(!c.backupValido({ ...dpp, usa: { ...u, cartoes: [{ id: 'u2', nome: 'Visa', tipo: 'X' }] } }));
  assert.ok(!c.backupValido({ ...dpp, usa: { ...u, viagens: [viag({ fundo: 'javascript:alert(1)' })] } }));
  // Despesas: viagem, categoria, moeda e viajantes precisam existir; base precisa estar nas moedas da viagem
  const comDesp = { ...u, viagens: [viag({ moedas: ['USD', 'BRL'], viajantes: ['u3'] })],
    despesas: [{ id: 'd1', viagem: 'v1', desc: 'Parque', cat: 'u4', data: '2027-01-11', moeda: 'USD', valor: 10000, quem: ['u3'] }, { id: 'd2', viagem: 'v1', desc: 'Lanche', cat: 'u4', data: '2027-01-11', moeda: 'BRL', valor: 5000, quem: [] }] };
  assert.ok(c.backupValido({ ...dpp, usa: comDesp }));
  assert.deepStrictEqual(c.totaisViagem(comDesp, comDesp.viagens[0]), [{ moeda: 'USD', valor: 10000 }, { moeda: 'BRL', valor: 5000 }]);
  assert.deepStrictEqual(c.totaisViagem({ ...comDesp, despesas: [] }, comDesp.viagens[0]), [{ moeda: 'USD', valor: 0 }]);
  // Por categoria: uma lista por moeda, maior primeiro, e a soma bate com o total da viagem
  const porCat = { ...comDesp, despesas: [...comDesp.despesas, { ...comDesp.despesas[0], id: 'd3', cat: 'u5', valor: 30000 }] };
  assert.deepStrictEqual(c.categoriasViagem(porCat, porCat.viagens[0]), [
    { moeda: 'USD', total: 40000, lista: [{ cat: 'u5', valor: 30000, pct: 75 }, { cat: 'u4', valor: 10000, pct: 25 }] },
    { moeda: 'BRL', total: 5000, lista: [{ cat: 'u4', valor: 5000, pct: 100 }] }]);
  assert.deepStrictEqual(c.categoriasViagem({ ...comDesp, despesas: [] }, comDesp.viagens[0]), [], 'sem despesas, nada');
  const porCatP = { ...porCat, despesas: porCat.despesas.map((d) => (d.id === 'd3' ? { ...d, natureza: 'P' } : d)) };
  assert.deepStrictEqual(c.categoriasViagem(porCatP, porCatP.viagens[0], 'P'), [{ moeda: 'USD', total: 30000, lista: [{ cat: 'u5', valor: 30000, pct: 100 }] }]);
  assert.deepStrictEqual(c.categoriasViagem(porCatP, porCatP.viagens[0], 'C').map((g) => [g.moeda, g.total]), [['USD', 10000], ['BRL', 5000]]);
  // Viagem corporativa: despesa corporativa (padrao) ou pessoal, somadas em separado por moeda
  const corp = { ...comDesp, viagens: [{ ...comDesp.viagens[0], corporativa: true }], despesas: [{ ...comDesp.despesas[0] }, { ...comDesp.despesas[1], natureza: 'P' }] };
  assert.ok(c.backupValido({ ...dpp, usa: corp }));
  assert.deepStrictEqual(c.totaisViagem(corp, corp.viagens[0], 'C'), [{ moeda: 'USD', valor: 10000 }]);
  assert.deepStrictEqual(c.totaisViagem(corp, corp.viagens[0], 'P'), [{ moeda: 'USD', valor: 0 }, { moeda: 'BRL', valor: 5000 }]);
  assert.ok(!c.backupValido({ ...dpp, usa: { ...corp, despesas: [{ ...comDesp.despesas[0], natureza: 'X' }] } }));
  assert.ok(!c.backupValido({ ...dpp, usa: { ...corp, viagens: [{ ...corp.viagens[0], corporativa: 'sim' }] } }));
  // Aba USA: soma de viagens por moeda, finalizada depois do fim e filtro pela data de inicio
  const vB = viag({ id: 'v2', nome: 'NY', moedas: ['BRL'], base: 'BRL', inicio: '2027-02-01', fim: '2027-02-10' });
  const comDuas = { ...comDesp, viagens: [{ ...comDesp.viagens[0], inicio: '2027-01-10', fim: '2027-01-20' }, vB],
    despesas: [...comDesp.despesas, { id: 'd3', viagem: 'v2', desc: 'Taxi', cat: 'u4', data: '2027-02-02', moeda: 'BRL', valor: 700, quem: [] }] };
  assert.deepStrictEqual(c.totaisViagens(comDuas, comDuas.viagens), [{ moeda: 'USD', valor: 10000 }, { moeda: 'BRL', valor: 5700 }]);
  assert.ok(!c.viagemFinalizada(vB, '2027-02-10') && c.viagemFinalizada(vB, '2027-02-11') && !c.viagemFinalizada(viag({}), '2099-01-01'));
  const ids = (l) => l.map((v) => v.id);
  assert.deepStrictEqual(ids(c.filtrarViagens(comDuas.viagens, { ids: [], ini: '', fim: '' })), ['v1', 'v2']);
  assert.deepStrictEqual(ids(c.filtrarViagens(comDuas.viagens, { ids: ['v2'], ini: '', fim: '' })), ['v2']);
  assert.deepStrictEqual(ids(c.filtrarViagens(comDuas.viagens, { ids: [], ini: '2027-01-15', fim: '2027-02-01' })), ['v2']);
  assert.deepStrictEqual(ids(c.filtrarViagens(comDuas.viagens, { ids: [], ini: '', fim: '2027-01-31' })), ['v1']);
  assert.ok(!c.backupValido({ ...dpp, usa: { ...comDesp, despesas: [{ ...comDesp.despesas[0], cat: 'sumiu' }] } }));
  assert.ok(!c.backupValido({ ...dpp, usa: { ...comDesp, despesas: [{ ...comDesp.despesas[0], quem: ['sumiu'] }] } }));
  assert.ok(!c.backupValido({ ...dpp, usa: { ...comDesp, despesas: [{ ...comDesp.despesas[0], valor: 0 }] } }));
  assert.ok(c.backupValido({ ...dpp, usa: { ...comDesp, despesas: [{ ...comDesp.despesas[0], obs: 'Pago em dinheiro' }] } }));
  assert.ok(!c.backupValido({ ...dpp, usa: { ...comDesp, despesas: [{ ...comDesp.despesas[0], obs: 'x'.repeat(501) }] } }));
  assert.ok(c.backupValido({ ...dpp, usa: { ...comDesp, despesas: [{ ...comDesp.despesas[0], pago: false }] } }));
  assert.ok(!c.backupValido({ ...dpp, usa: { ...comDesp, despesas: [{ ...comDesp.despesas[0], pago: 'sim' }] } }));
  assert.ok(c.backupValido({ ...dpp, usa: { ...comDesp, despesas: [{ ...comDesp.despesas[0], checkin: '2027-01-11', checkout: '2027-01-14' }] } }));
  assert.ok(!c.backupValido({ ...dpp, usa: { ...comDesp, despesas: [{ ...comDesp.despesas[0], checkin: '2027-01-14', checkout: '2027-01-11' }] } }));
  assert.ok(!c.backupValido({ ...dpp, usa: { ...comDesp, despesas: [{ ...comDesp.despesas[0], checkin: '14/01/2027' }] } }));
  // Pago com: um meio com o valor inteiro, ou dois que somam o valor
  const pag = (pagamentos) => c.backupValido({ ...dpp, usa: { ...comDesp, despesas: [{ ...comDesp.despesas[0], pagamentos }] } });
  assert.ok(pag([{ meio: 'u1', valor: 10000 }]));
  assert.ok(pag([{ meio: 'u1', valor: 6000 }, { meio: 'u2', valor: 4000 }]));
  assert.ok(!pag([{ meio: 'u1', valor: 6000 }, { meio: 'u2', valor: 3000 }]));
  assert.ok(!pag([{ meio: 'u1', valor: 5000 }, { meio: 'u1', valor: 5000 }]));
  assert.ok(!pag([{ meio: 'sumiu', valor: 10000 }]));
  assert.ok(!pag([]));
  assert.ok(!c.backupValido({ ...dpp, usa: { ...comDesp, viagens: [viag({ base: 'EUR' })] } }));
  assert.ok(!c.backupValido({ ...dpp, usa: { ...comDesp, viagens: [viag({ cot: { BRL: -1 } })] } }));
  assert.ok(!c.backupValido({ ...dpp, usa: { ...comDesp, moedas: [{ id: 'x', nome: 'X', codigo: 'xx', simbolo: 'X' }] } }));
  assert.ok(!c.backupValido({ ...dpp, usa: { ...u, viajantes: [{ id: 'u3', nome: 'Ana', foto: 'data:image/svg+xml;base64,AAAA' }] } }));
  assert.ok(!c.backupValido({ ...dpp, usa: { ...u, viajantes: [{ id: 'u3', nome: 'Ana', inicial: 'sim' }] } }));
  assert.ok(!c.backupValido({ ...dpp, usa: { ...u, categorias: undefined } })); }
const comLimP = { ...nu, limite: 50000 };
assert.strictEqual(c.limiteDisponivel(dpp, comLimP), 50000 - 6000 - 20000);
assert.strictEqual(c.faturaAtual(dpp, nu, '2026-11-02').valor, 6000);
// Pagar o resto quita: o total pago e o da fatura
c.pagarFatura(dpp, nu, '2026-11', { data: '2026-11-03', valor: 6000, conta: 'conta' });
assert.strictEqual(c.restanteFatura(dpp, nu, '2026-11'), 0);
assert.strictEqual(c.saldo(dpp, '2026-11-05'), 90000);
assert.deepStrictEqual(c.aPagar(dpp, '2026-11'), []);
assert.strictEqual(c.fluxoMes(dpp, '2026-11', '2026-11-05').saidas, 10000);
// Desfazer devolve tudo
c.desfazerPagamentos(dpp, 'nu', '2026-11');
assert.strictEqual(c.saldo(dpp, '2026-11-05'), 100000);
assert.strictEqual(c.restanteFatura(dpp, nu, '2026-11'), 10000);
assert.ok(!c.backupValido({ ...dpp, parciais: [{ cartao: 'sumiu', ym: '2026-11', data: '2026-11-01', valor: 1, conta: 'conta' }] }));
assert.ok(!c.backupValido({ ...dpp, parciais: undefined }));

// Saldo: compra no cartao e pendentes nao mexem; o que foi pago sim, mesmo com data futura
let db = base();
assert.strictEqual(c.saldo(db, '2026-10-31'), 100000 + 500000 - 20000 - 150000);
db.lancs.push({ id: 9, tipo: 'S', data: '2026-12-01', valor: 9900, cat: 'a', meio: 'conta', pago: true });
assert.strictEqual(c.saldo(db, '2026-10-31'), 430000 - 9900, 'pago com data futura conta');
db = base();

// A receber: so receita pendente da conta, ate o fim do mes
assert.deepStrictEqual(c.aReceber(db, '2026-10').map((x) => x.desc), []);
assert.deepStrictEqual(c.aReceber(db, '2026-11').map((x) => x.desc), ['Freela']);

// Pagar a fatura desconta o valor gravado, mesmo que a fatura mude depois
db.faturasPagas[c.chaveFatura('nu', '2026-11')] = { data: '2026-11-05', valor: 10000, conta: 'conta' };
assert.strictEqual(c.saldo(db, '2026-11-05'), 430000 - 10000);
assert.strictEqual(c.saldo(db, '2026-11-04'), 430000, 'pagamento futuro ainda nao conta');

// A fatura sai da conta escolhida no pagamento
db.faturasPagas[c.chaveFatura('nu', '2026-11')].conta = 'poup';
assert.deepStrictEqual(c.saldosPorConta(db, '2026-11-05'), { conta: 430000, poup: -10000 });
db = base();

// Transferencia: muda de conta, nao muda o total, nao e gasto nem receita
const semTransf = c.gastosPorCategoria(db, '2026-10');
db.lancs.push({ id: 10, tipo: 'T', data: '2026-10-12', valor: 50000, meio: 'conta', destino: 'poup', cat: null, pago: true });
assert.deepStrictEqual(c.saldosPorConta(db, '2026-10-31'), { conta: 380000, poup: 50000 });
assert.strictEqual(c.saldo(db, '2026-10-31'), 430000);
assert.deepStrictEqual(c.gastosPorCategoria(db, '2026-10'), semTransf);
assert.strictEqual(c.entradasDoMes(db, '2026-10'), 500000);
assert.ok(c.backupValido(db));
// Pendente: nao mexe no saldo e nao aparece em a pagar ou a receber
db.lancs[db.lancs.length - 1].pago = false;
assert.strictEqual(c.saldosPorConta(db, '2026-10-31').poup, 0);
assert.ok(!c.aPagar(db, '2026-10').some((x) => x.id === 10));
assert.ok(!c.aReceber(db, '2026-10').some((x) => x.id === 10));

// Gasto e receita pendentes na segunda conta tambem aparecem
db = base();
db.lancs.push({ id: 11, tipo: 'S', desc: 'Taxa', data: '2026-10-15', valor: 500, cat: 'a', meio: 'poup', pago: false });
assert.deepStrictEqual(c.aPagar(db, '2026-10').map((x) => x.desc), ['Taxa', 'Luz']);
db = base();

// Categorias: compra no cartao conta no mes da compra, cada parcela no seu; pagar a fatura nao conta de novo
assert.deepStrictEqual(c.gastosPorCategoria(db, '2026-10'), { a: 30000, m: 175000 });
assert.deepStrictEqual(c.gastosPorCategoria(db, '2026-11'), { a: 10000, m: 8000 });
assert.strictEqual(c.entradasDoMes(db, '2026-10'), 500000);
assert.strictEqual(c.entradasDoMes(db, '2026-11'), 70000, 'receita pendente entra no mes');

// A pagar: em outubro so a Luz; em novembro entra a Agua e a fatura em aberto, ordenados por vencimento
db = base();
assert.deepStrictEqual(c.aPagar(db, '2026-10').map((x) => x.desc), ['Luz']);
assert.deepStrictEqual(c.aPagar(db, '2026-11').map((x) => x.desc), ['Luz', 'Fatura Nu', 'Água']);
// Fatura vencida nao paga continua aparecendo nos meses seguintes; paga, some
assert.strictEqual(c.aPagar(db, '2026-12').filter((x) => x.tipo === 'fatura').length, 2);
db.faturasPagas[c.chaveFatura('nu', '2026-11')] = { data: '2026-11-05', valor: 10000, conta: 'conta' };
assert.strictEqual(c.aPagar(db, '2026-12').filter((x) => x.tipo === 'fatura').length, 1);

// Fluxo do mes: fatura aberta de mes anterior continua pesando na previsao
db = base();
let f = c.fluxoMes(db, '2026-10', '2026-10-31');
assert.strictEqual(f.saldo, 430000);
assert.strictEqual(f.entradas, 500000);
assert.strictEqual(f.saidas, 170000);
assert.strictEqual(f.prevSaidas, 195000);
assert.strictEqual(f.previsao, 430000 - 25000, 'outubro: saldo menos a Luz pendente');
f = c.fluxoMes(db, '2026-11', '2026-10-31');
assert.deepStrictEqual([f.entradas, f.saidas, f.prevEntradas, f.prevSaidas], [0, 0, 70000, 18000]);
assert.strictEqual(f.previsao, 405000 + 70000 - 8000 - 10000);
f = c.fluxoMes(db, '2026-12', '2026-10-31');
assert.strictEqual(f.previsao, 457000 - 10000, 'a fatura de novembro em aberto continua contando');
// Paga: vale o valor pago, e a soma nao muda se foi paga em dia
db.faturasPagas[c.chaveFatura('nu', '2026-11')] = { data: '2026-10-31', valor: 10000, conta: 'conta' };
f = c.fluxoMes(db, '2026-11', '2026-10-31');
assert.strictEqual(f.previsao, 457000);
assert.strictEqual(f.saidas, 10000);
assert.strictEqual(f.saldo, 420000);
// Transferencia nao muda previsao nem entradas e saidas
db = base();
const semT = c.fluxoMes(db, '2026-10', '2026-10-31');
db.lancs.push({ id: 12, tipo: 'T', data: '2026-10-12', valor: 50000, meio: 'conta', destino: 'poup', cat: null, pago: true });
assert.deepStrictEqual(c.fluxoMes(db, '2026-10', '2026-10-31'), semT);

// Atrasados: saida nao paga antes de hoje, de qualquer mes e conta; entrada, transferencia e o dia de hoje ficam fora
db = base();
db.lancs.push({ id: 15, tipo: 'T', desc: 'Guardar', data: '2026-10-12', valor: 100, meio: 'conta', destino: 'poup', cat: null, pago: false });
assert.deepStrictEqual(c.atrasados(db, '2026-11-20').map((x) => [x.desc, x.valor]), [['Fatura Nu', 10000], ['Luz', 25000]]);
db.lancs.find((l) => l.id === 6).pago = true;
assert.deepStrictEqual(c.atrasados(db, '2026-11-20').map((x) => x.desc), ['Fatura Nu'], 'pago sai da lista');

// Linhas do fluxo: fatura como linha, sem as compras; ordem da data mais recente
db = base();
db.lancs.push({ id: 13, tipo: 'T', desc: 'Guardar', data: '2026-11-12', valor: 50000, meio: 'conta', destino: 'poup', cat: null, pago: true });
db.lancs.push({ id: 14, tipo: 'S', desc: 'Taxa', data: '2026-11-13', valor: 500, cat: 'a', meio: 'poup', pago: true });
const descs = (ls) => ls.map((x) => x.desc);
assert.deepStrictEqual(descs(c.linhasFluxo(db, '2026-11', 'fluxo')), ['Água', 'Freela', 'Taxa', 'Guardar', 'Fatura Nu']);
assert.deepStrictEqual(descs(c.linhasFluxo(db, '2026-10', 'fluxo')), ['Luz', 'Aluguel', undefined, undefined], 'os dois sem descricao vem por ultimo');
assert.ok(!c.linhasFluxo(db, '2026-10', 'fluxo').some((x) => x.lanc && x.lanc.meio === 'nu'), 'compra fica dentro da fatura');
// Todos: compras na data da compra, sem fatura
const todos = c.linhasFluxo(db, '2026-10', 'todos');
assert.ok(todos.some((x) => x.lanc && x.lanc.id === 'p3-0'));
assert.ok(!todos.some((x) => x.fatura));
assert.ok(!c.linhasFluxo(db, '2026-11', 'todos').some((x) => x.fatura));
// Filtro por cartao em Todos
assert.deepStrictEqual(c.linhasFluxo(db, '2026-10', 'todos', 'nu').map((x) => x.lanc.id), ['p3-0']);
// Periodo livre: junta os meses; previsao vai ate o fim dele; um mes so continua igual
const per = c.linhasFluxo(db, '2026-10', 'fluxo', '', '2026-11');
assert.ok(per.some((x) => x.desc === 'Luz') && per.some((x) => x.desc === 'Água') && per.some((x) => x.desc === 'Fatura Nu'));
assert.ok(!per.some((x) => x.lanc && x.lanc.id === 'p3-1'));
const fPer = c.fluxoMes(db, '2026-10', '2026-11-30', '', '2026-11');
assert.strictEqual(fPer.previsao, c.fluxoMes(db, '2026-11', '2026-11-30').previsao);
assert.strictEqual(fPer.prevSaidas, c.fluxoMes(db, '2026-10', '2026-11-30').prevSaidas + c.fluxoMes(db, '2026-11', '2026-11-30').prevSaidas);
assert.strictEqual(fPer.prevEntradas, 500000 + 70000);
// Filtro por conta: transferencia vira saida ou entrada; fatura sai pela conta que paga
const naConta = c.linhasFluxo(db, '2026-11', 'fluxo', 'conta');
assert.deepStrictEqual(descs(naConta), ['Água', 'Freela', 'Guardar', 'Fatura Nu']);
assert.strictEqual(naConta.find((x) => x.desc === 'Guardar').sinal, -1);
const naPoup = c.linhasFluxo(db, '2026-11', 'fluxo', 'poup');
assert.deepStrictEqual(descs(naPoup), ['Taxa', 'Guardar']);
assert.strictEqual(naPoup.find((x) => x.desc === 'Guardar').sinal, 1);
assert.strictEqual(c.linhasFluxo(db, '2026-11', 'fluxo').find((x) => x.desc === 'Guardar').sinal, 0);
// Filtrado: cada conta fecha, e a soma das duas da o total
const fC = c.fluxoMes(db, '2026-11', '2026-11-30', 'conta'), fP = c.fluxoMes(db, '2026-11', '2026-11-30', 'poup'), fT = c.fluxoMes(db, '2026-11', '2026-11-30');
assert.strictEqual(fP.saldo, 49500);
assert.strictEqual(fP.previsao, 49500);
assert.strictEqual(fP.entradas, 50000);
assert.strictEqual(fP.saidas, 500);
assert.strictEqual(fC.saldo + fP.saldo, fT.saldo);
assert.strictEqual(fC.previsao + fP.previsao, fT.previsao);
assert.strictEqual(fC.prevSaidas, 8000 + 50000 + 10000);
// Fatura paga por outra conta sai da previsao dessa conta
db.faturasPagas[c.chaveFatura('nu', '2026-11')] = { data: '2026-11-05', valor: 10000, conta: 'poup' };
assert.strictEqual(c.fluxoMes(db, '2026-11', '2026-11-30', 'poup').previsao, 49500 - 10000);
assert.deepStrictEqual(descs(c.linhasFluxo(db, '2026-11', 'fluxo', 'conta')), ['Água', 'Freela', 'Guardar']);
// Mes sem nada
assert.deepStrictEqual(c.linhasFluxo(db, '2025-01', 'fluxo'), []);

// Limite: desconta tudo em aberto, inclusive parcelas futuras; libera ao pagar a fatura
db = base();
const comLim = { ...nu, limite: 100000 };
db.cartoes = [comLim];
assert.strictEqual(c.limiteDisponivel(db, comLim), 70000, '3 parcelas de 100,00 em aberto');
db.faturasPagas[c.chaveFatura('nu', '2026-11')] = { data: '2026-11-05', valor: 10000, conta: 'conta' };
assert.strictEqual(c.limiteDisponivel(db, comLim), 80000);
assert.strictEqual(c.limiteDisponivel(db, nu), null, 'sem limite');
db.lancs.push({ id: 15, tipo: 'S', data: '2026-11-10', valor: 200000, meio: 'nu', cat: 'a', parcelas: 1, pago: true });
assert.strictEqual(c.limiteDisponivel(db, comLim), -120000, 'estourado fica negativo');
assert.ok(c.backupValido({ ...base(), cartoes: [comLim] }));
assert.ok(!c.backupValido({ ...base(), cartoes: [{ ...nu, limite: '10' }] }));

// Fatura atual: a mais antiga em aberto, atrasada depois do vencimento
db = base();
let fa = c.faturaAtual(db, nu, '2026-10-31');
assert.deepStrictEqual([fa.ym, fa.venc, fa.valor, fa.atrasada], ['2026-11', '2026-11-05', 10000, false]);
fa = c.faturaAtual(db, nu, '2026-11-20');
assert.deepStrictEqual([fa.ym, fa.valor, fa.atrasada], ['2026-11', 10000, true], 'nao paga continua aparecendo');
db.faturasPagas[c.chaveFatura('nu', '2026-11')] = { data: '2026-11-05', valor: 10000, conta: 'conta' };
fa = c.faturaAtual(db, nu, '2026-11-20');
assert.deepStrictEqual([fa.ym, fa.valor, fa.atrasada], ['2026-12', 10000, false], 'paga: passa para a do ciclo');
// Cartao sem compras: ciclo de hoje, valor zero
fa = c.faturaAtual({ ...base(), lancs: [] }, nu, '2026-10-31');
assert.deepStrictEqual([fa.ym, fa.valor, fa.atrasada], ['2026-12', 0, false], 'ja passou do fechamento do dia 25');
// Paga e sem outra em aberto ate o ciclo: mostra o que foi pago
db = { ...base(), lancs: [{ id: 16, tipo: 'S', data: '2026-10-01', valor: 700, meio: 'nu', cat: 'a', parcelas: 1, pago: true }] };
db.faturasPagas[c.chaveFatura('nu', '2026-11')] = { data: '2026-10-20', valor: 700, conta: 'conta' };
fa = c.faturaAtual(db, nu, '2026-10-22');
assert.deepStrictEqual([fa.ym, fa.valor, fa.atrasada], ['2026-12', 0, false], 'paga antes do vencimento: passa para a seguinte');
// Exemplo do usuario: fecha 22, vence 30; compra em 31/10 ja aparece na fatura de 30/11
const black = { id: 'bk', nome: 'Black', fechamento: 22, vencimento: 30, contaPag: 'conta' };
db = { ...base(), cartoes: [black], lancs: [{ id: 30, tipo: 'S', data: '2026-10-31', valor: 12500, meio: 'bk', cat: 'a', pago: true }] };
fa = c.faturaAtual(db, black, '2026-10-31');
assert.deepStrictEqual([fa.ym, fa.venc, fa.valor, fa.atrasada], ['2026-11', '2026-11-30', 12500, false]);
// Vence no meio do mes: mostra essa fatura ate pagar; depois, a do mes seguinte
const meio = { id: 'mm', nome: 'Meio', fechamento: 5, vencimento: 15, contaPag: 'conta' };
db = { ...base(), cartoes: [meio], lancs: [
  { id: 31, tipo: 'S', data: '2026-11-01', valor: 1000, meio: 'mm', cat: 'a', pago: true },
  { id: 32, tipo: 'S', data: '2026-11-08', valor: 2000, meio: 'mm', cat: 'a', pago: true },
] };
fa = c.faturaAtual(db, meio, '2026-11-10');
assert.deepStrictEqual([fa.ym, fa.venc, fa.valor], ['2026-11', '2026-11-15', 1000]);
db.faturasPagas[c.chaveFatura('mm', '2026-11')] = { data: '2026-11-10', valor: 1000, conta: 'conta' };
fa = c.faturaAtual(db, meio, '2026-11-10');
assert.deepStrictEqual([fa.ym, fa.venc, fa.valor], ['2026-12', '2026-12-15', 2000]);
// Parcial: continua na mesma fatura, com o que falta
db.faturasPagas = {};
c.pagarFatura(db, meio, '2026-11', { data: '2026-11-10', valor: 400, conta: 'conta' });
assert.deepStrictEqual([c.faturaAtual(db, meio, '2026-11-10').ym, c.faturaAtual(db, meio, '2026-11-10').valor], ['2026-11', 600]);
// Saudacao
assert.deepStrictEqual([4, 5, 11, 12, 17, 18, 23, 0].map(c.saudacao), ['Boa noite', 'Bom dia', 'Bom dia', 'Boa tarde', 'Boa tarde', 'Boa noite', 'Boa noite', 'Boa noite']);

// Total das faturas do mes: soma os cartoes; paga vale o que foi pago
db = base();
db.cartoes.push({ id: 'b', nome: 'B', fechamento: 25, vencimento: 5, contaPag: 'conta' });
db.lancs.push({ id: 17, tipo: 'S', data: '2026-10-11', valor: 4000, meio: 'b', cat: 'a', parcelas: 1, pago: true });
assert.strictEqual(c.totalFaturasDoMes(db, '2026-11'), 14000);
db.faturasPagas[c.chaveFatura('b', '2026-11')] = { data: '2026-11-01', valor: 3000, conta: 'conta' };
assert.strictEqual(c.totalFaturasDoMes(db, '2026-11'), 13000);
assert.strictEqual(c.totalFaturasDoMes(db, '2025-01'), 0);

// Limites do mes: conta pendente e parcela do cartao; em ordem de nome
db = base();
db.categorias[0].limite = 40000;
db.categorias[1].limite = 100000;
db.categorias.push({ id: 'e', nome: 'Salário', tipo: 'E', limite: 500 }, { id: 'x', nome: 'Sem limite', tipo: 'S' });
const porId = (a, b) => a.cat.id.localeCompare(b.cat.id);
let lim = c.limitesDoMes(db, '2026-10').sort(porId);
assert.deepStrictEqual(lim.map((x) => [x.cat.id, x.gasto, x.resta, x.pct]), [['a', 30000, 10000, 75], ['m', 175000, -75000, 175]], 'receita e categoria sem limite ficam fora');
lim = c.limitesDoMes(db, '2026-11').sort(porId);
assert.deepStrictEqual(lim.map((x) => [x.cat.id, x.gasto]), [['a', 10000], ['m', 8000]], 'parcela do cartao conta no mes dela');
assert.deepStrictEqual(lim.map((x) => x.variacao), [(10000 / 30000 - 1) * 100, (8000 / 175000 - 1) * 100], 'comparado ao mes anterior');
assert.strictEqual(c.limitesDoMes(db, '2026-10').find((x) => x.cat.id === 'a').variacao, null, 'sem gasto no mes anterior');
assert.deepStrictEqual(c.limitesDoMes({ ...db, categorias: [{ id: 'z', nome: 'Zebra', tipo: 'S', limite: 1 }, { id: 'y', nome: 'Água', tipo: 'S', limite: 1 }] }, '2026-10').map((x) => x.cat.nome), ['Água', 'Zebra']);
// Os lancamentos do limite somam exatamente o gasto mostrado
for (const ym of ['2026-10', '2026-11']) for (const l of c.limitesDoMes(db, ym)) {
  assert.strictEqual(c.lancsDoLimite(db, l.cat.id, ym).reduce((s, i) => s + i.valor, 0), l.gasto);
}
assert.strictEqual(c.limitesDoMes(db, '2025-01')[0].pct, 0);
assert.ok(c.backupValido(db));
assert.ok(!c.backupValido({ ...base(), categorias: [{ id: 'a', nome: 'A', tipo: 'S', limite: -1 }] }));
assert.ok(!c.backupValido({ ...base(), categorias: [{ id: 'a', nome: 'A', tipo: 'X' }] }));

// Separar categorias: so receita, so despesa, nas duas, sem uso; serie tambem conta
const velha = {
  contasBanco: [{ id: 'conta', nome: 'C', saldoInicial: 0 }], cartoes: [], faturasPagas: {},
  categorias: [{ id: 'sal', nome: 'Salário' }, { id: 'desp', nome: 'Mercado' }, { id: 'out', nome: 'Outros' }, { id: 'sobra', nome: 'Sobra' }, { id: 'fixa', nome: 'Aluguel recebido' }],
  lancs: [
    { id: 1, tipo: 'E', data: '2026-10-01', valor: 1, cat: 'sal', meio: 'conta', pago: true },
    { id: 2, tipo: 'S', data: '2026-10-01', valor: 1, cat: 'desp', meio: 'conta', pago: true },
    { id: 3, tipo: 'S', data: '2026-10-01', valor: 1, cat: 'out', meio: 'conta', pago: true },
    { id: 4, tipo: 'E', data: '2026-10-01', valor: 1, cat: 'out', meio: 'conta', pago: true },
    { id: 5, tipo: 'T', data: '2026-10-01', valor: 1, cat: null, meio: 'conta', destino: 'conta2', pago: false },
  ],
  series: [{ id: 's', per: 'mensal', inicio: '2026-10-01', n: 1, modelo: { tipo: 'E', valor: 1, cat: 'fixa', meio: 'conta' }, encerrada: false }],
};
const copiaVelha = JSON.stringify(velha);
const sep = c.migrar(velha, '2026-10-31');
assert.strictEqual(JSON.stringify(velha), copiaVelha, 'o original nao muda');
const tipoDe = (id) => sep.categorias.find((x) => x.id === id).tipo;
assert.deepStrictEqual(['sal', 'desp', 'out', 'sobra', 'fixa'].map(tipoDe), ['E', 'S', 'S', 'S', 'E']);
assert.strictEqual(tipoDe('out-receita'), 'E');
assert.strictEqual(sep.lancs[2].cat, 'out');
assert.strictEqual(sep.lancs[3].cat, 'out-receita');
assert.deepStrictEqual(c.migrar(sep, '2026-10-31').categorias, sep.categorias, 'converter de novo nao duplica');
// Sem nenhuma receita: ganha as padrao
const soDesp = c.migrar({ ...velha, lancs: [], series: [], categorias: [{ id: 'k', nome: 'K' }] }, '2026-10-31');
assert.deepStrictEqual(soDesp.categorias.map((x) => x.tipo), ['S', 'E', 'E']);

// Relatorios. base(): Tenis 3x de 100,00 comprado em 10/10 (faturas nov, dez, jan).
db = base();
db.lancs.push({ id: 18, tipo: 'T', desc: 'Guardar', data: '2026-10-12', valor: 50000, meio: 'conta', destino: 'poup', cat: null, pago: true });
let its = c.itensRelatorio(db, '2026-10', '2026-11', 'fatura');
assert.ok(!its.some((i) => i.tipo === 'T'), 'transferencia fica fora');
assert.deepStrictEqual(its.filter((i) => i.lanc.serie === 'p3').map((i) => [i.ym, i.valor, i.desc]), [['2026-11', 10000, 'undefined (1/3)']], 'so a parcela do periodo');
const porCompra = c.itensRelatorio(db, '2026-10', '2026-10', 'compra').filter((i) => i.lanc.serie === 'p3');
assert.strictEqual(porCompra.reduce((s, i) => s + i.valor, 0), 30000, 'valor total no mes da compra');
assert.ok(!c.itensRelatorio(db, '2026-10', '2026-10', 'fatura').some((i) => i.lanc.serie === 'p3'));
assert.ok(c.itensRelatorio(db, '2026-10', '2026-11', 'fatura', 'nu').every((i) => i.lanc.meio === 'nu'));
assert.ok(!c.itensRelatorio(db, '2026-10', '2026-11', 'fatura', 'conta').some((i) => i.lanc.meio === 'nu'));

// Por categoria: soma, ordem, percentual e detalhe batem
const rc = c.relatorioCategorias(its, 'S');
assert.deepStrictEqual(rc.lista.map((g) => [g.cat, g.total]), [['m', 183000], ['a', 30000]]);
assert.strictEqual(rc.total, 213000);
assert.ok(Math.abs(rc.lista.reduce((s, g) => s + g.pct, 0) - 100) < 1e-9);
for (const g of rc.lista) assert.strictEqual(g.itens.reduce((s, i) => s + i.valor, 0), g.total);
assert.deepStrictEqual(c.relatorioCategorias(its, 'E').lista.map((g) => g.total), [570000]);
assert.deepStrictEqual(c.relatorioCategorias([], 'S'), { total: 0, lista: [] });

// Balanco: um registro por mes, inclusive vazio e na virada de ano
const bal = c.relatorioBalanco(c.itensRelatorio(db, '2026-11', '2027-02', 'fatura'), '2026-11', '2027-02');
assert.deepStrictEqual(bal.map((m) => m.ym), ['2026-11', '2026-12', '2027-01', '2027-02']);
assert.deepStrictEqual(bal[0], { ym: '2026-11', receitas: 70000, despesas: 18000, saldo: 52000 });
assert.deepStrictEqual(bal[3], { ym: '2027-02', receitas: 0, despesas: 0, saldo: 0 });

// Datas das series
assert.strictEqual(c.dataSerie('2026-01-31', 'mensal', 1), '2026-02-28');
assert.strictEqual(c.dataSerie('2026-01-31', 'mensal', 2), '2026-03-31', 'volta ao dia 31');
assert.strictEqual(c.dataSerie('2026-12-15', 'bimestral', 1), '2027-02-15');
assert.strictEqual(c.dataSerie('2026-11-15', 'trimestral', 1), '2027-02-15');
assert.strictEqual(c.dataSerie('2028-02-29', 'anual', 1), '2029-02-28');
assert.strictEqual(c.dataSerie('2026-12-28', 'semanal', 1), '2027-01-04');
assert.strictEqual(c.dataSerie('2026-10-25', 'quinzenal', 1), '2026-11-08', 'horario de verao nao atrapalha');

// Conta fixa: cria 12 meses a frente, pendentes
const fixa = (extra) => ({ tipo: 'S', desc: 'Luz fixa', valor: 1000, cat: 'm', meio: 'conta', destino: undefined, data: '2026-11-15', pago: false, ...extra });
const serie = (d, id = 's') => d.lancs.filter((l) => l.serie === id).sort((a, b) => a.data.localeCompare(b.data));
db = base();
c.criarSerie(db, 's', fixa(), 'mensal', '2026-10-31');
assert.strictEqual(serie(db).length, 12, 'nov/2026 a out/2027');
assert.strictEqual(serie(db)[11].data, '2027-10-15');
assert.ok(serie(db).every((l) => !l.pago));
assert.ok(c.backupValido(JSON.parse(JSON.stringify(db))));
assert.strictEqual(c.fluxoMes(db, '2026-12', '2026-10-31').prevSaidas, 1000 + 10000);
// Completar nao duplica; avanca so quando precisa
assert.strictEqual(c.completarSeries(db, '2027-10'), false);
assert.strictEqual(c.completarSeries(db, '2027-12'), true);
assert.strictEqual(serie(db).length, 14);
assert.deepStrictEqual(new Set(serie(db).map((l) => l.id)).size, 14);

// Retroativa marcada como paga: paga ate hoje, pendente depois
db = base();
c.criarSerie(db, 's', fixa({ data: '2026-08-15', pago: true }), 'mensal', '2026-10-31');
assert.deepStrictEqual(serie(db).slice(0, 4).map((l) => l.pago), [true, true, true, false]);

// No cartao: cai na fatura de cada mes e nao vira conta a pagar
db = base();
c.criarSerie(db, 's', fixa({ meio: 'nu', data: '2026-10-20', pago: true }), 'mensal', '2026-10-31');
assert.ok(serie(db).every((l) => l.pago));
assert.strictEqual(c.totalFatura(db, nu, '2026-12'), 1000 + 10000);

// Editar: so esta
db = base();
c.criarSerie(db, 's', fixa(), 'mensal', '2026-10-31');
const edita = (id, extra, escopo) => { const l = db.lancs.find((x) => x.id === id); c.aplicarEdicao(db, id, { ...l, ...extra }, escopo); };
edita('s-2', { valor: 2000, data: '2027-01-20' }, 'esta');
assert.deepStrictEqual(serie(db).slice(0, 4).map((l) => l.valor), [1000, 1000, 2000, 1000]);
assert.strictEqual(serie(db)[2].data, '2027-01-20');
assert.strictEqual(db.series.find((s) => s.id === 's').modelo.valor, 1000);
// Esta e as proximas: nao mexe nas anteriores, nas datas nem na situacao; novas usam o valor novo
serie(db)[5].pago = true;
edita('s-3', { valor: 3000, desc: 'Luz nova' }, 'proximas');
assert.deepStrictEqual(serie(db).slice(0, 5).map((l) => l.valor), [1000, 1000, 2000, 3000, 3000]);
assert.strictEqual(serie(db)[1].desc, 'Luz fixa');
assert.strictEqual(serie(db)[4].data, '2027-03-15');
assert.strictEqual(serie(db)[5].pago, true);
c.completarSeries(db, '2027-11');
assert.strictEqual(serie(db)[12].valor, 3000);
// Todas
edita('s-1', { valor: 500 }, 'todas');
assert.ok(serie(db).every((l) => l.valor === 500));
// Da conta para o cartao e de volta
edita('s-1', { meio: 'nu', pago: true }, 'proximas');
assert.ok(serie(db).slice(1).every((l) => l.pago && l.meio === 'nu'));
edita('s-1', { meio: 'conta', pago: false }, 'proximas');
assert.ok(serie(db).slice(1).every((l) => !l.pago && l.meio === 'conta'));
assert.ok(c.backupValido(JSON.parse(JSON.stringify(db))));

// Excluir: so esta nao volta ao completar
db = base();
c.criarSerie(db, 's', fixa(), 'mensal', '2026-10-31');
c.excluirLanc(db, 's-2', 'esta');
c.completarSeries(db, '2027-11');
assert.ok(!db.lancs.some((l) => l.id === 's-2'));
assert.strictEqual(serie(db).length, 12);
// Esta e as proximas: encerra a serie
c.excluirLanc(db, 's-3', 'proximas');
assert.deepStrictEqual(serie(db).map((l) => l.id), ['s-0', 's-1']);
assert.strictEqual(c.completarSeries(db, '2028-12'), false);
assert.ok(c.backupValido(JSON.parse(JSON.stringify(db))));
// Todas: remove tudo; lancamento fora da serie fica
const qtd = db.lancs.length;
c.excluirLanc(db, 's-0', 'todas');
assert.strictEqual(db.lancs.length, qtd - 2);
assert.ok(!db.series.some((s) => s.id === 's'));
c.excluirLanc(db, 1, 'esta');
assert.ok(!db.lancs.some((l) => l.id === 1));

assert.ok(!c.backupValido({ ...base(), series: [{ id: 'x', per: 'diario', inicio: '2026-01-01', n: 1, modelo: { valor: 1, meio: 'conta' } }] }), 'periodo desconhecido');
assert.ok(!c.backupValido({ ...base(), series: [{ id: 'x', per: 'mensal', inicio: '2026-01-01', n: 1, modelo: { valor: 1, meio: 'sumiu' } }] }), 'conta inexistente');
assert.ok(!c.backupValido({ ...base(), series: undefined }));

// Conversao da versao 1.0: o saldo nao muda e cada conta vira um lancamento
const antigo = {
  saldoInicial: 100000,
  categorias: [{ id: 'm', nome: 'Moradia' }],
  cartoes: [{ id: 'nu', nome: 'Nu', fechamento: 25, vencimento: 5 }],
  lancs: [
    { id: 1, tipo: 'E', data: '2026-10-05', valor: 500000, cat: 'm', meio: 'conta' },
    { id: 2, tipo: 'S', data: '2026-12-01', valor: 9900, cat: 'm', meio: 'conta' },
    { id: 3, tipo: 'S', data: '2026-12-01', valor: 3000, cat: 'm', meio: 'nu', parcelas: 1 },
  ],
  contas: [
    { id: 5, desc: 'Aluguel', venc: '2026-10-10', valor: 150000, cat: 'm', pagoEm: '2026-10-10' },
    { id: 6, desc: 'Luz', venc: '2026-10-20', valor: 25000, cat: 'm', pagoEm: null },
  ],
  faturasPagas: {},
};
const novo = c.migrar(antigo, '2026-10-31');
assert.ok(c.backupValido(novo));
assert.ok(!('contas' in novo));
assert.strictEqual(novo.lancs.length, 5);
assert.strictEqual(c.saldo(novo, '2026-10-31'), 100000 + 500000 - 150000);
assert.deepStrictEqual(c.aPagar(novo, '2026-10').map((x) => x.desc), ['Luz']);
assert.deepStrictEqual(c.migrar(novo, '2026-12-31'), novo, 'converter de novo nao muda nada');
assert.strictEqual(novo.cartoes[0].contaPag, 'conta');
assert.ok(!('saldoInicial' in novo));

// Versao 1.7: compra parcelada vira parcelas; faturas, limite e fatura paga ficam iguais
const v17 = {
  contasBanco: [{ id: 'conta', nome: 'C', saldoInicial: 0 }], categorias: [{ id: 'a', nome: 'A', tipo: 'S' }], series: [],
  cartoes: [{ ...nu, limite: 100000 }], faturasPagas: { 'nu|2026-11': { data: '2026-11-05', valor: 3334, conta: 'conta' } },
  lancs: [{ id: 'x', tipo: 'S', desc: 'TV', data: '2026-10-10', valor: 10000, cat: 'a', meio: 'nu', parcelas: 3, pago: true }],
};
const copia17 = JSON.stringify(v17);
const c17 = c.migrar(v17, '2026-10-31');
assert.strictEqual(JSON.stringify(v17), copia17, 'o original nao muda');
assert.ok(c.backupValido(JSON.parse(JSON.stringify(c17))));
assert.deepStrictEqual(c17.lancs.map((l) => [l.parcela, l.valor, l.serie]), [[1, 3334, 'px'], [2, 3333, 'px'], [3, 3333, 'px']]);
assert.deepStrictEqual(c.aPagar(c17, '2027-01').map((x) => x.ym), ['2026-12', '2027-01']);
assert.strictEqual(c.limiteDisponivel(c17, c17.cartoes[0]), 100000 - 6666);
assert.deepStrictEqual(c.migrar(c17, '2026-12-31'), c17, 'converter de novo nao duplica');

// Versao 1.1: conta unica, com fatura ja paga; o saldo nao muda
const v11 = c.migrar({
  saldoInicial: 1000,
  categorias: [],
  cartoes: [{ id: 'nu', nome: 'Nu', fechamento: 25, vencimento: 5 }],
  lancs: [{ id: 1, tipo: 'E', data: '2026-10-05', valor: 500, cat: '', meio: 'conta', pago: true }],
  faturasPagas: { 'nu|2026-11': { data: '2026-10-05', valor: 200 } },
}, '2026-10-31');
assert.ok(c.backupValido(v11));
assert.strictEqual(c.saldo(v11, '2026-10-31'), 1300);
assert.strictEqual(c.migrar(null, '2026-10-31'), null);
assert.ok(!c.backupValido(c.migrar({ ...antigo, contas: [{ desc: 'x', valor: 1 }] }, '2026-10-31')), 'conta sem data e recusada');

// Icones: so SVG limpo e pequeno vira icone; acentos sobrevivem
const ic = c.svgParaIcone('<svg xmlns="http://www.w3.org/2000/svg"><title>Itaú</title></svg>');
assert.ok(c.iconeValido(ic));
assert.ok(Buffer.from(ic.split(',')[1], 'base64').toString('utf8').includes('Itaú'));
assert.strictEqual(c.svgParaIcone('<html>erro 404</html>'), null);
assert.strictEqual(c.svgParaIcone('<svg><script>alert(1)</script></svg>'), null);
assert.strictEqual(c.svgParaIcone('<svg onload="alert(1)"></svg>'), null);
assert.strictEqual(c.svgParaIcone('<svg><a href="javascript:alert(1)"/></svg>'), null);
assert.strictEqual(c.svgParaIcone('<svg>' + 'x'.repeat(100 * 1024) + '</svg>'), null);
assert.ok(c.iconeValido(undefined), 'sem icone tambem vale');
for (const ruim of ['https://x.com/a.svg', 'data:text/html;base64,AAAA', 'data:image/svg+xml;base64,"><script>', 7]) assert.ok(!c.iconeValido(ruim), String(ruim));
assert.ok(c.backupValido({ ...base(), cartoes: [{ ...nu, icone: ic }] }));
assert.ok(!c.backupValido({ ...base(), cartoes: [{ ...nu, icone: 'https://x.com/a.svg' }] }));
assert.ok(!c.backupValido({ ...base(), contasBanco: [{ id: 'conta', nome: 'x', saldoInicial: 0, icone: 'x' }] }));

// Arquivar conta: ate o mes do arquivamento aparece; depois, lancamentos, saldo e previsao saem
db = base();
db.lancs.push({ id: 20, tipo: 'E', desc: 'Antes', data: '2026-10-15', valor: 1000, cat: 'a', meio: 'poup', pago: true });
db.lancs.push({ id: 21, tipo: 'S', desc: 'Pendente out', data: '2026-10-16', valor: 300, cat: 'a', meio: 'poup', pago: false });
db.lancs.push({ id: 22, tipo: 'S', desc: 'Depois', data: '2026-11-15', valor: 200, cat: 'a', meio: 'poup', pago: false });
db.lancs.push({ id: 23, tipo: 'T', desc: 'Guardar', data: '2026-11-16', valor: 50, meio: 'conta', destino: 'poup', cat: null, pago: true });
db.contasBanco[1].arquivadaEm = '2026-10-31';
assert.ok(c.ativoEm(db.contasBanco[1], '2026-10'));
assert.ok(c.ativoEm(db.contasBanco[1], '2026-09'));
assert.ok(!c.ativoEm(db.contasBanco[1], '2026-11'));
assert.ok(c.backupValido(db));
assert.ok(!c.backupValido({ ...base(), contasBanco: [{ id: 'conta', nome: 'x', saldoInicial: 0, arquivadaEm: 'ontem' }] }));
// Mes do arquivamento: tudo igual
assert.strictEqual(c.saldo(db, '2026-10-31'), 430000 + 1000);
assert.ok(c.aPagar(db, '2026-10').some((x) => x.desc === 'Pendente out'));
assert.strictEqual(c.fluxoMes(db, '2026-10', '2026-10-31').previsao, 430000 + 1000 - 25000 - 300);
// Mes seguinte: conta some, inclusive o saldo; transferencia para ela nao conta na outra
assert.strictEqual(c.saldo(db, '2026-11-01'), 430000);
assert.ok(!c.linhasFluxo(db, '2026-11', 'fluxo').some((x) => ['Depois', 'Guardar'].includes(x.desc)));
assert.ok(!c.aPagar(db, '2026-11').some((x) => x.desc === 'Pendente out' || x.desc === 'Depois'), 'pendencia antiga tambem sai');
assert.strictEqual(c.fluxoMes(db, '2026-11', '2026-11-01').previsao, 430000 - 25000 + 70000 - 8000 - 10000);
assert.ok(!c.itensRelatorio(db, '2026-11', '2026-11', 'fatura').some((i) => i.lanc.meio === 'poup'));
assert.ok(c.itensRelatorio(db, '2026-10', '2026-10', 'fatura').some((i) => i.lanc.id === 20), 'meses anteriores continuam');
assert.strictEqual(db.lancs.length, base().lancs.length + 4, 'nada apagado');
// Desarquivar devolve tudo
delete db.contasBanco[1].arquivadaEm;
assert.ok(c.linhasFluxo(db, '2026-11', 'fluxo').some((x) => x.desc === 'Depois'));
assert.strictEqual(c.saldo(db, '2026-11-20'), 430000 + 1000 - 50 + 50);

// Arquivar cartao: parcelas e fatura em aberto saem depois do mes; fatura paga continua contando na conta
db = base();
db.faturasPagas[c.chaveFatura('nu', '2026-11')] = { data: '2026-11-05', valor: 10000, conta: 'conta' };
db.cartoes = [{ ...nu, arquivadaEm: '2026-11-20' }];
const cArq = db.cartoes[0];
assert.strictEqual(c.totalFatura(db, cArq, '2026-11'), 10000);
assert.strictEqual(c.totalFatura(db, cArq, '2026-12'), 0, 'parcela seguinte sai');
assert.ok(!c.aPagar(db, '2027-01').some((x) => x.tipo === 'fatura'));
assert.deepStrictEqual(c.gastosPorCategoria(db, '2026-12'), {});
assert.strictEqual(c.saldo(db, '2026-12-01'), 420000, 'o pagamento feito continua');
assert.strictEqual(c.fluxoMes(db, '2026-12', '2026-12-01').previsao, 420000 - 25000 + 70000 - 8000);
db.cartoes = [nu];
db.faturasPagas = {};
assert.strictEqual(c.totalFatura(db, nu, '2026-12'), 10000, 'desarquivado volta');

// Categoria com icone e cor: formato conferido ao restaurar
const comCat = (extra) => ({ ...base(), categorias: [{ id: 'a', nome: 'A', tipo: 'S', ...extra }] });
assert.ok(c.backupValido(comCat({ simbolo: 'casa', cor: '#1b76c9' })));
assert.ok(!c.backupValido(comCat({ cor: 'red;background:url(x)' })));
assert.ok(!c.backupValido(comCat({ simbolo: '"><script>' })));

// Restauracao
assert.ok(c.backupValido(base()));
assert.ok(!c.backupValido(null));
assert.ok(!c.backupValido({ ops: [] }), 'backup de outro app');
assert.ok(!c.backupValido({ ...base(), lancs: [{ data: 'ontem', valor: 1, tipo: 'S', meio: 'conta', pago: true }] }));
assert.ok(!c.backupValido({ ...base(), lancs: [{ data: '2026-10-01', valor: 1, tipo: 'S', meio: 'conta' }] }), 'sem situacao');
assert.ok(!c.backupValido({ ...base(), contasBanco: [{ id: 'conta', nome: 'x', saldoInicial: '10' }] }));
assert.ok(!c.backupValido({ ...base(), contasBanco: [] }));
assert.ok(!c.backupValido(c.migrar({ ...base(), contasBanco: undefined, saldoInicial: '10' }, '2026-10-31')));
const invalidos = [
  { id: 1, tipo: 'S', data: '2026-10-01', valor: 1, meio: 'sumiu', pago: true },
  { id: 1, tipo: 'E', data: '2026-10-01', valor: 1, meio: 'nu', pago: true },
  { id: 1, tipo: 'T', data: '2026-10-01', valor: 1, meio: 'conta', destino: 'conta', pago: true },
  { id: 1, tipo: 'T', data: '2026-10-01', valor: 1, meio: 'conta', destino: 'nu', pago: true },
];
for (const l of invalidos) assert.ok(!c.backupValido({ ...base(), lancs: [l] }), JSON.stringify(l));

// Senha: nunca guarda o texto; confere so a certa; sal diferente a cada vez
(async () => {
  const g = await c.protegerSenha('minha senha ç');
  assert.ok(!JSON.stringify(g).includes('minha'));
  assert.ok(await c.confereSenha('minha senha ç', g));
  assert.ok(!await c.confereSenha('outra', g));
  assert.ok(!await c.confereSenha('x', undefined));
  assert.notStrictEqual((await c.protegerSenha('minha senha ç')).hash, g.hash);
  const cod = c.gerarCodigo();
  assert.ok(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(cod), cod);
  assert.ok(!/[01OIL]/.test(cod));
  assert.strictEqual(c.limpaCodigo(' ab12-cd 34 '), 'AB12CD34');
  // Perfil
  assert.ok(c.perfilValido(undefined));
  assert.ok(c.perfilValido({ nome: 'A', email: 'a@b.c', nasc: '1979-04-08', foto: 'data:image/jpeg;base64,AAAA' }));
  assert.ok(!c.perfilValido({ foto: 'https://x.com/a.jpg' }));
  assert.ok(!c.perfilValido({ foto: 'data:image/jpeg;base64,"><script>' }));
  assert.ok(!c.perfilValido({ nasc: 'ontem' }));
  assert.ok(!c.perfilValido({ nome: 'x'.repeat(201) }));
  assert.ok(c.backupValido({ ...base(), perfil: { nome: 'A' } }));
  assert.ok(!c.backupValido({ ...base(), perfil: { foto: 'x' } }));
  // Faturas atrasadas: de qualquer mes, com o restante; somem ao pagar e vencer hoje nao conta
  const cartaoAtr = { id: 'x', nome: 'X', fechamento: 25, vencimento: 28, contaPag: 'conta' };
  const dbAtr = {
    contasBanco: [{ id: 'conta', nome: 'C' }], cartoes: [cartaoAtr], faturasPagas: {}, parciais: [],
    lancs: [['a', '2026-08-20', 3000], ['b', '2026-09-20', 5000], ['d', '2026-10-20', 7000]].map(([id, data, valor]) => ({ id, tipo: 'S', data, valor, meio: 'x', cat: 't', pago: true })),
  };
  c.pagarFatura(dbAtr, cartaoAtr, '2026-09', { data: '2026-10-01', valor: 2000, conta: 'conta' });
  assert.deepStrictEqual(c.faturasAtrasadas(dbAtr, '2026-10-28').map((f) => [f.ym, f.venc, f.valor]), [['2026-08', '2026-08-28', 3000], ['2026-09', '2026-09-28', 3000]]);
  assert.strictEqual(c.faturasAtrasadas(dbAtr, '2026-10-29').length, 3);
  c.pagarFatura(dbAtr, cartaoAtr, '2026-08', { data: '2026-10-29', valor: 3000, conta: 'conta' });
  assert.deepStrictEqual(c.faturasAtrasadas(dbAtr, '2026-10-29').map((f) => f.ym), ['2026-09', '2026-10']);
  // Os 4 status da fatura (fecha dia 25, vence dia 28)
  assert.strictEqual(c.statusFatura(dbAtr, cartaoAtr, '2026-11', '2026-11-01'), 'Em aberto');
  assert.strictEqual(c.statusFatura(dbAtr, cartaoAtr, '2026-10', '2026-10-25'), 'Fechada');
  assert.strictEqual(c.statusFatura(dbAtr, cartaoAtr, '2026-10', '2026-10-28'), 'Fechada');
  assert.strictEqual(c.statusFatura(dbAtr, cartaoAtr, '2026-10', '2026-10-29'), 'Em atraso');
  assert.strictEqual(c.statusFatura(dbAtr, cartaoAtr, '2026-09', '2026-10-29'), 'Em atraso', 'parcial continua em atraso');
  assert.strictEqual(c.statusFatura(dbAtr, cartaoAtr, '2026-08', '2026-10-29'), 'Paga');
  // Estorno no cartao: valor negativo diminui a fatura e o gasto; no Fluxo aparece como entrada
  const cartaoEst = { id: 'e', nome: 'E', fechamento: 18, vencimento: 30, contaPag: 'conta' };
  const dbEst = {
    contasBanco: [{ id: 'conta', nome: 'C', saldoInicial: 0 }], cartoes: [cartaoEst], faturasPagas: {}, parciais: [], series: [],
    lancs: [{ id: 'g', tipo: 'S', data: '2026-03-05', valor: 10000, meio: 'e', cat: 'k', pago: true }, { id: 'v', tipo: 'S', data: '2026-03-06', valor: -2500, meio: 'e', cat: 'k', pago: true }],
  };
  assert.strictEqual(c.totalFatura(dbEst, cartaoEst, '2026-03'), 7500);
  assert.strictEqual(c.restanteFatura(dbEst, cartaoEst, '2026-03'), 7500);
  assert.deepStrictEqual(c.gastosPorCategoria(dbEst, '2026-03'), { k: 7500 });
  const estFluxo = c.linhasFluxo(dbEst, '2026-03', 'todos', '').find((i) => i.lanc && i.lanc.id === 'v');
  assert.deepStrictEqual([estFluxo.valor, estFluxo.sinal], [2500, 1]);
  // Fatura paga: a parcela nela nao muda nem sai quando a alteracao vale para as outras
  const cartaoPg = { id: 'q', nome: 'Q', fechamento: 18, vencimento: 30, contaPag: 'conta' };
  const dbPg = () => {
    const d = { contasBanco: [{ id: 'conta', nome: 'C', saldoInicial: 0 }], cartoes: [cartaoPg], lancs: [], series: [], parciais: [], faturasPagas: {} };
    c.criarParcelada(d, 's', { tipo: 'S', desc: 'A', valor: 30000, cat: 'k', meio: 'q', data: '2026-01-05', pago: true }, 'mensal', 3, '2026-01-05');
    d.faturasPagas['q|2026-01'] = { data: '2026-01-30', valor: 10000, conta: 'conta' };
    return d;
  };
  const dPg = dbPg();
  assert.ok(c.faturaPagaDoLanc(dPg, dPg.lancs[0]));
  assert.ok(!c.faturaPagaDoLanc(dPg, dPg.lancs[1]));
  c.aplicarEdicao(dPg, dPg.lancs[1].id, { ...dPg.lancs[1], desc: 'B' }, 'todas');
  assert.deepStrictEqual(dPg.lancs.map((l) => l.desc), ['A', 'B', 'B']);
  const dEx = dbPg();
  c.excluirLanc(dEx, dEx.lancs[1].id, 'todas');
  assert.deepStrictEqual(dEx.lancs.map((l) => l.parcela), [1]);
  assert.ok(dEx.series[0].encerrada);
  // Backup cifrado: nada legivel no arquivo; so abre com a senha certa e sem alteracao
  const claroBk = { lancs: [{ desc: 'Compra secreta', valor: 12345 }], perfil: { nome: 'Fulano' } };
  const bk = await c.cifrarBackup(claroBk, 'senha-certa-1');
  const textoBk = JSON.stringify(bk);
  assert.ok(c.ehBackupCifrado(JSON.parse(textoBk)) && !c.ehBackupCifrado(claroBk));
  for (const t of ['Compra', 'secreta', 'Fulano', 'lancs', '12345']) assert.ok(!textoBk.includes(t), t);
  assert.deepStrictEqual(await c.decifrarBackup(JSON.parse(textoBk), 'senha-certa-1'), claroBk);
  await assert.rejects(c.decifrarBackup(bk, 'senha-errada-1'));
  const dadosBk = Buffer.from(bk.dados, 'base64'); dadosBk[0] ^= 1;
  await assert.rejects(c.decifrarBackup({ ...bk, dados: dadosBk.toString('base64') }, 'senha-certa-1'));
  await assert.rejects(c.decifrarBackup({ ...bk, iteracoes: 1 }, 'senha-certa-1'));
  // Sincronizacao: a chave sai da senha e do sal do arquivo; outro aparelho com a mesma senha abre, e o Restaurar comum tambem
  const salSync = c.novoSal(), chaveA = await c.chaveSync('senha-do-app-1', salSync), chaveB = await c.chaveSync('senha-do-app-1', salSync);
  assert.strictEqual(chaveA, chaveB, 'mesma senha e sal, mesma chave nos dois aparelhos');
  const arqSync = JSON.parse(JSON.stringify(await c.cifrarComChave(claroBk, chaveA, salSync)));
  assert.strictEqual(arqSync.sal, salSync);
  assert.deepStrictEqual(await c.decifrarComChave(arqSync, chaveB), claroBk);
  assert.deepStrictEqual(await c.decifrarBackup(arqSync, 'senha-do-app-1'), claroBk, 'abre pelo Restaurar comum');
  await assert.rejects(c.decifrarComChave(arqSync, await c.chaveSync('outra-senha-1', salSync)));
  assert.notStrictEqual((await c.cifrarBackup(claroBk, 'senha-certa-1')).dados, bk.dados);
  // Backup com a senha do app: salva so com o hash guardado; abre com a senha, nao com o hash
  const gApp = await c.protegerSenha('senha-do-app-1');
  const bkApp = await c.cifrarBackupSenhaApp(claroBk, gApp);
  const textoApp = JSON.stringify(bkApp);
  assert.ok(c.usaSenhaDoApp(bkApp) && !c.usaSenhaDoApp(bk));
  for (const t of ['Compra', 'Fulano', 'lancs', gApp.hash]) assert.ok(!textoApp.includes(t), t);
  assert.deepStrictEqual(await c.decifrarBackup(JSON.parse(textoApp), 'senha-do-app-1'), claroBk);
  await assert.rejects(c.decifrarBackup(bkApp, 'senha-errada-1'));
  await assert.rejects(c.decifrarBackup(bkApp, gApp.hash));
  // Restaurar sem digitar: abre com o hash guardado so se for o mesmo sal (a mesma senha guardada)
  assert.deepStrictEqual(await c.decifrarComHash(bkApp, gApp), claroBk);
  assert.strictEqual(await c.decifrarComHash(bkApp, await c.protegerSenha('senha-do-app-1')), null, 'senha trocada: outro sal');
  assert.strictEqual(await c.decifrarComHash(bk, gApp), null, 'versao 1 precisa da senha digitada');
  assert.strictEqual(await c.decifrarComHash(bkApp, null), null);
  assert.strictEqual(await c.decifrarComHash({ ...bkApp, dados: bk.dados }, gApp), null, 'arquivo alterado');
  // Finais dos cartoes (numero, fisico/virtual, titular/adicional) passam inteiros pelos dois tipos de backup e pela restauracao
  const comFinais = JSON.parse(JSON.stringify(dp));
  comFinais.cartoes[0].finais = [{ n: '1111', tipo: 'F', dono: 'T' }, { n: '2222', tipo: 'V', dono: 'T' }, { n: '3333', tipo: 'F', dono: 'A' }, { n: '4444', tipo: 'V', dono: 'A' }];
  comFinais.cartoes[0].finaisInativos = [{ n: '9999', tipo: 'F', dono: 'T', motivo: 'Cartão perdido', em: '2026-11-03' }];
  for (const arq of [await c.cifrarBackup(comFinais, 'senha-certa-1'), await c.cifrarBackupSenhaApp(comFinais, gApp)]) {
    const senhaArq = c.usaSenhaDoApp(arq) ? 'senha-do-app-1' : 'senha-certa-1';
    const volta = c.migrar(await c.decifrarBackup(JSON.parse(JSON.stringify(arq)), senhaArq), '2026-11-03');
    assert.ok(c.backupValido(volta));
    assert.deepStrictEqual(volta.cartoes[0].finais, comFinais.cartoes[0].finais);
    assert.deepStrictEqual(volta.cartoes[0].finaisInativos, comFinais.cartoes[0].finaisInativos);
  }
  // Area USA inteira (viagens com imagem, contas, cartoes, viajantes, categorias) passa pelos dois tipos de backup
  const jpg = 'data:image/jpeg;base64,/9j/AAAA', svg = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
  const comUsa = { ...JSON.parse(JSON.stringify(dp)), usa: { moedas: c.MOEDAS_PADRAO, despesas: [{ id: 'd1', viagem: 'v1', desc: 'Parque', cat: 'u4', data: '2027-04-05', moeda: 'BRL', valor: 12345, quem: ['u3'], obs: 'Ingresso de 2 dias', pago: false, checkin: '2027-04-05', checkout: '2027-04-08',
      pagamentos: [{ meio: 'u1', valor: 10000 }, { meio: 'u2', valor: 2345 }], natureza: 'P',
      recibos: [{ id: 'r1', em: '2027-04-05T15:00:00.000Z', pag: 2, arq: '1AbCdEfGhIjKlMnOp_q-r', nome: '2027-04-05 Parque R$ 123,45 (1).pdf' }, { id: 'r2', em: '2027-04-05T15:05:00.000Z', pag: 1 }],
      local: { nome: 'Hotel Teste', endereco: 'Rua Teste, 100, Cidade, EUA', lat: 40.1, lng: -70.1, id: 'ChIJ_abc-123' } }],
    viagens: [{ id: 'v1', nome: 'Orlando', inicio: '2027-04-04', fim: '2027-04-18', fundo: jpg, moedas: ['USD', 'BRL'], base: 'USD', viajantes: ['u3'], cot: { BRL: 0.1852 }, corporativa: true, pais: 'US' }, { id: 'v2', nome: 'NY', moedas: ['USD'], base: 'USD', viajantes: [], cot: {} }],
    contas: [{ id: 'u1', nome: 'Wise', icone: svg, iconeNome: 'Wise' }], cartoes: [{ id: 'u2', nome: 'Visa', tipo: 'V', icone: svg, iconeNome: 'Visa',
      finais: [{ n: '1234', tipo: 'V', dono: 'T' }], finaisInativos: [{ n: '5678', tipo: 'F', dono: 'A', motivo: 'Vencido', em: '2026-11-03' }] }],
    viajantes: [{ id: 'u3', nome: 'Ana', foto: jpg, inicial: true, passaporte: { nome: 'ANA TESTE DA SILVA', pais: 'BR', num: 'XX000001', emissao: '2020-01-02', validade: '2030-01-01', fotos: [{ id: 'p1', em: '2026-11-08T10:00:00.000Z', pag: 1, arq: 'arquivoPassaporte01', nome: 'Passaporte Ana.pdf' }] },
      vistos: [{ id: 'vi1', pais: 'US', nome: 'SILVA, ANA TESTE', num: 'V123', emissao: '2021-05-05', validade: '2031-05-04', fotos: [{ id: 'p2', em: '2026-11-08T10:00:00.000Z', pag: 1 }] }, { id: 'vi2', pais: 'CA' }] }],
    categorias: [{ id: 'u4', nome: 'Parques', simbolo: 'carro', cor: '#2f8486', arquivadaEm: '2026-11-03' }],
    itinerario: [{ id: 'i1', viagem: 'v1', tipo: 'aereo', titulo: 'AAA - BBB', data: '2027-04-04', hora: '22:40', fuso: 'GMT-3', fim: '2027-04-05', horaFim: '06:35', fusoFim: 'EST',
      cia: 'Companhia Teste', voo: 'XX 1234', assento: '12A', origem: 'AAA', destino: 'BBB', localizador: 'ABC123', obs: 'Janela', pax: [{ quem: 'u3', loc: 'ABC123', assento: '12A' }] },
    { id: 'i2', viagem: 'v1', tipo: 'hotel', titulo: 'Hotel', data: '2027-04-05', hora: '15:00', fim: '2027-04-10', horaFim: '11:00', localizador: 'H123', despesa: 'd1',
      local: { nome: 'Hotel', endereco: 'Rua 1', lat: 28.5, lng: -81.4 } }] } };
  comUsa.usa.moedas = c.MOEDAS_PADRAO.map((m) => (m.id === 'EUR' ? { ...m, arquivadaEm: '2026-11-03' } : m));
  comUsa.usa.contas[0].arquivadaEm = '2026-11-03';
  for (const arq of [await c.cifrarBackup(comUsa, 'senha-certa-1'), await c.cifrarBackupSenhaApp(comUsa, gApp)]) {
    const senhaArq = c.usaSenhaDoApp(arq) ? 'senha-do-app-1' : 'senha-certa-1';
    const volta = c.migrar(await c.decifrarBackup(JSON.parse(JSON.stringify(arq)), senhaArq), '2026-11-03');
    assert.ok(c.backupValido(volta));
    assert.deepStrictEqual(volta.usa, comUsa.usa);
  }
  // ID do cliente do Google (Ajustes > Backup) passa pelos dois tipos de backup; formato errado nao restaura
  const comGoogle = { ...JSON.parse(JSON.stringify(dp)), google: { cliente: '729588885596-abc123.apps.googleusercontent.com', mapsKey: 'AIzaSyA1b2C3d4E5f6G7h8I9j0K_lmnoPQRst-u', aeroKey: 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5', ultimoAutoEm: '2026-11-07T18:30:05.000Z', agenda: { ativo: true, id: 'abc123def@group.calendar.google.com', tarefas: 'MDQ0NjE3ODM4NjU1NjIxNzk0NDk6MDow' } } };
  for (const arq of [await c.cifrarBackup(comGoogle, 'senha-certa-1'), await c.cifrarBackupSenhaApp(comGoogle, gApp)]) {
    const senhaArq = c.usaSenhaDoApp(arq) ? 'senha-do-app-1' : 'senha-certa-1';
    const volta = c.migrar(await c.decifrarBackup(JSON.parse(JSON.stringify(arq)), senhaArq), '2026-11-07');
    assert.ok(c.backupValido(volta));
    assert.deepStrictEqual(volta.google, comGoogle.google);
  }
  assert.ok(c.backupValido({ ...comGoogle, google: {} }));
  assert.ok(!c.backupValido({ ...comGoogle, google: { cliente: 'javascript:alert(1)' } }));
  assert.ok(!c.backupValido({ ...comGoogle, google: 'x' }));
  assert.ok(!c.backupValido({ ...comGoogle, google: { ultimoAutoEm: 'ontem' } }));
  assert.ok(!c.backupValido({ ...comGoogle, google: { agenda: { ativo: 'sim' } } }));
  assert.ok(!c.backupValido({ ...comGoogle, google: { mapsKey: 'chave-errada' } }));
  assert.ok(!c.backupValido({ ...comGoogle, google: { aeroKey: 'chave com espaco e curta' } }));
  // AeroDataBox: resposta do voo vira os campos do item aereo
  assert.strictEqual(c.fusoDeOffset('-03:00'), 'GMT-3');
  assert.strictEqual(c.fusoDeOffset('+05:30'), 'GMT+5:30');
  assert.strictEqual(c.fusoDeOffset('+00:00'), 'GMT');
  assert.strictEqual(c.fusoDeOffset('Z'), 'GMT');
  assert.strictEqual(c.fusoDeOffset(undefined), '');
  assert.deepStrictEqual(c.horaLocalVoo('2026-11-13 22:40-03:00'), { data: '2026-11-13', hora: '22:40', fuso: 'GMT-3' });
  assert.deepStrictEqual(c.horaLocalVoo('2026-11-14T06:35:00-05:00'), { data: '2026-11-14', hora: '06:35', fuso: 'GMT-5' });
  assert.strictEqual(c.horaLocalVoo('amanha'), null);
  const trecho = (de, para, hp, hc) => ({ number: 'XX 1234', status: 'Expected', airline: { name: 'Companhia Teste', iata: 'XX' },
    departure: { airport: { iata: de, name: 'Aeroporto ' + de, municipalityName: 'Cidade ' + de }, scheduledTime: { utc: '', local: hp } },
    arrival: { airport: { iata: para, name: 'Aeroporto ' + para }, scheduledTime: { utc: '', local: hc } } });
  const voos = c.dadosDoVoo([trecho('AAA', 'BBB', '2026-11-13 22:40-03:00', '2026-11-14 06:35-05:00'), trecho('AAA', 'BBB', '2026-11-13 22:40-03:00', '2026-11-14 06:35-05:00'),
    { ...trecho('BBB', 'CCC', '2026-11-14 08:00-05:00', '2026-11-14 09:10-05:00'), status: 'Canceled' }, { number: 'só lixo' }]);
  assert.strictEqual(voos.length, 2, 'repetido e incompleto saem');
  assert.deepStrictEqual(voos[0], { cia: 'Companhia Teste', voo: 'XX 1234', origem: 'AAA', destino: 'BBB', origemNome: 'Cidade AAA', destinoNome: 'Aeroporto BBB',
    data: '2026-11-13', hora: '22:40', fuso: 'GMT-3', fim: '2026-11-14', horaFim: '06:35', fusoFim: 'GMT-5', situacao: 'Previsto' });
  assert.strictEqual(voos[1].situacao, 'Cancelado');
  assert.deepStrictEqual(c.dadosDoVoo(null), []);
  assert.ok(!c.backupValido({ ...comGoogle, google: { agenda: { ativo: true, id: '<script>' } } }));
  assert.ok(c.backupValido({ ...comGoogle, google: { agenda: { ativo: true, id: 'x@group.calendar.google.com', tarefas: 'MDQ0NjE3ODM4NjU1NjIxNzk0NDk6MDow' } } }));
  assert.ok(!c.backupValido({ ...comGoogle, google: { agenda: { ativo: true, tarefas: 'a b' } } }));
  // Lembretes do Google Agenda: so conta a pagar nao paga e fatura com algo a pagar, de hoje ate 3 meses
  {
    const nuA = { id: 'nu', nome: 'Nu', fechamento: 25, vencimento: 5, contaPag: 'conta' };
    const dbA = c.migrar({ contasBanco: [{ id: 'conta', nome: 'Corrente', tipo: 'corrente', saldoInicial: 0 }], series: [], categorias: [{ id: 'a', nome: 'A', tipo: 'S' }], cartoes: [nuA], faturasPagas: {},
      lancs: [{ id: 1, tipo: 'S', desc: 'Luz', data: '2026-11-20', valor: 21000, cat: 'a', meio: 'conta', pago: false },
        { id: 2, tipo: 'S', desc: 'Paga', data: '2026-11-21', valor: 5000, cat: 'a', meio: 'conta', pago: true },
        { id: 3, tipo: 'S', desc: 'Atrasada', data: '2026-11-01', valor: 1000, cat: 'a', meio: 'conta', pago: false },
        { id: 4, tipo: 'S', desc: 'Longe', data: '2027-04-10', valor: 1000, cat: 'a', meio: 'conta', pago: false },
        { id: 5, tipo: 'S', desc: 'Compra', data: '2026-11-10', valor: 30000, cat: 'a', meio: 'nu', pago: true },
        { id: 6, tipo: 'E', desc: 'Salario', data: '2026-11-25', valor: 900000, cat: 'a', meio: 'conta', pago: false }] }, '2026-11-07');
    assert.deepStrictEqual(c.lembretesAgenda(dbA, '2026-11-07').map((x) => [x.chave, x.data]), [['lanc:1', '2026-11-20'], ['fat:nu:2026-12', '2026-12-05']]);
    // Conta parcelada: a parcela vai no titulo do evento e da tarefa
    const parc = { ...dbA.lancs[0], parcela: 10, de: 10, desc: 'IPTU 2026', valor: 49720 };
    assert.strictEqual(c.lembretesAgenda({ ...dbA, lancs: [parc] }, '2026-11-07')[0].titulo.replace(/\s/g, ' '), 'IPTU 2026 (parcela 10/10) — R$ 497,20');
    assert.ok(!c.lembretesAgenda(dbA, '2026-11-07')[0].titulo.includes('parcela'), 'conta sem parcela fica igual');
    // Situacao para as tarefas: a conta paga e a atrasada tambem aparecem, cada uma com pago certo
    const sit = c.situacaoLembretes(dbA, '2026-11-07');
    assert.deepStrictEqual([sit.get('lanc:1').pago, sit.get('lanc:2').pago, sit.get('lanc:3').pago, sit.has('lanc:5'), sit.has('lanc:6')], [false, true, false, false, false]);
    assert.strictEqual(sit.get('fat:nu:2026-12').pago, false);
    dbA.faturasPagas['nu|2026-12'] = { valor: 30000, conta: 'conta', data: '2026-12-01' };
    const sitPaga = c.situacaoLembretes(dbA, '2026-11-07').get('fat:nu:2026-12');
    assert.ok(sitPaga.pago && sitPaga.titulo.includes('300,00'), 'fatura paga vira concluida, com o valor pago');
    assert.deepStrictEqual(c.lembretesAgenda(dbA, '2026-11-07').map((x) => x.chave), ['lanc:1'], 'fatura paga sai');
    assert.ok(/^[a-v0-9]{5,1024}$/.test(c.idEvento('fat:nu:2026-12')) && c.idEvento('lanc:1') !== c.idEvento('lanc:2'));
  }
  // Realce de documento: papel com sombra forte de um lado (tom 220 a 90), texto a 40% do papel e o verso aparecendo a 85%
  {
    const W = 400, H = 300, lum = new Float32Array(W * H), texto = (x, y) => y % 30 < 6 && x % 50 < 35, verso = (x, y) => y % 30 > 15 && y % 30 < 20 && x % 50 < 30;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const papel = 220 - 130 * (x / W); lum[y * W + x] = texto(x, y) ? papel * 0.4 : verso(x, y) ? papel * 0.85 : papel; }
    const r = c.realceDocumento(lum, W, H);
    let papelMin = 255, textoMax = 0, versoMin = 255;
    for (let y = 0; y < H; y++) for (let x = 10; x < W - 10; x++) { const v = r[y * W + x]; if (texto(x, y)) textoMax = Math.max(textoMax, v); else if (verso(x, y)) versoMin = Math.min(versoMin, v); else if (y % 30 > 9 && x % 50 > 38 && x % 50 < 48) papelMin = Math.min(papelMin, v); }
    assert.ok(versoMin >= 235, 'verso aparecendo some: ' + versoMin);
    assert.ok(papelMin >= 235, 'papel branco ate na sombra: ' + papelMin);
    assert.ok(textoMax <= 40, 'texto escuro dos dois lados: ' + textoMax);
  }
  // Recibos no lancamento do cartao passam pelos dois tipos de backup; formato errado nao restaura
  const comRecLanc = JSON.parse(JSON.stringify(dp));
  comRecLanc.lancs[0].recibos = [{ id: 'rl1', em: '2026-11-07T19:00:00.000Z', pag: 1, arq: '1ZyXwVuTsRqPoNm_lk-j', nome: '2026-11-07 Compra R$ 10,00.pdf' }, { id: 'rl2', em: '2026-11-07T19:01:00.000Z', pag: 2 }];
  for (const arq of [await c.cifrarBackup(comRecLanc, 'senha-certa-1'), await c.cifrarBackupSenhaApp(comRecLanc, gApp)]) {
    const senhaArq = c.usaSenhaDoApp(arq) ? 'senha-do-app-1' : 'senha-certa-1';
    const volta = c.migrar(await c.decifrarBackup(JSON.parse(JSON.stringify(arq)), senhaArq), '2026-11-07');
    assert.ok(c.backupValido(volta));
    assert.deepStrictEqual(volta.lancs[0].recibos, comRecLanc.lancs[0].recibos);
  }
  const recRuim = JSON.parse(JSON.stringify(comRecLanc)); recRuim.lancs[0].recibos[0].em = 'ontem';
  assert.ok(!c.backupValido(recRuim));
  // Itinerario: validacao, despesas que viram itens e a linha do tempo por dia
  {
    const okIt = (x) => c.backupValido({ ...comUsa, usa: { ...comUsa.usa, itinerario: [x] } });
    const it0 = comUsa.usa.itinerario[0];
    assert.ok(okIt(it0));
    assert.ok(okIt({ ...it0, cat: 'u4' }) && !okIt({ ...it0, cat: 'nenhuma' }), 'categoria do item tem de existir');
    // Passaporte, vistos e pais de destino
    const comViaj = (p) => c.backupValido({ ...comUsa, usa: { ...comUsa.usa, viajantes: [{ ...comUsa.usa.viajantes[0], ...p }] } });
    assert.ok(comViaj({}) && comViaj({ passaporte: undefined, vistos: undefined }) && comViaj({ passaporte: { num: 'A1' } }));
    assert.ok(!comViaj({ passaporte: { num: 'A1', emissao: '2030-01-01', validade: '2020-01-01' } }), 'validade antes da emissao');
    assert.ok(!comViaj({ vistos: [{ id: 'x', pais: 'XX' }] }) && !comViaj({ vistos: [{ id: 'x', pais: 'US' }, { id: 'x', pais: 'CA' }] }) && !comViaj({ passaporte: { num: 'A'.repeat(31) } }));
    assert.ok(!comViaj({ passaporte: { fotos: [{ id: 'f' }] } }), 'foto no formato dos recibos');
    assert.ok(!comViaj({ passaporte: { num: 'A1', pais: 'ZZ' } }) && comViaj({ passaporte: { num: 'A1', pais: 'PT' } }), 'pais do passaporte');
    assert.ok(!comViaj({ passaporte: { nome: '' } }) && !comViaj({ passaporte: { nome: 'A'.repeat(81) } }) && comViaj({ passaporte: { nome: 'A'.repeat(80) } }), 'nome como no documento');
    assert.ok(!c.backupValido({ ...comUsa, usa: { ...comUsa.usa, viagens: comUsa.usa.viagens.map((v) => ({ ...v, pais: 'ZZ' })) } }));
    assert.strictEqual(c.nomePais('US'), 'Estados Unidos');
    assert.ok(c.PAISES.length > 240 && c.ehPais('BR') && !c.ehPais('EU'));
    // Passageiros: viajante cadastrado, sem repetir, com localizador ou assento
    assert.ok(okIt({ ...it0, pax: [{ quem: 'u3', assento: '3C' }] }) && okIt({ ...it0, pax: undefined }));
    assert.ok(!okIt({ ...it0, pax: [{ quem: 'xx', loc: 'A' }] }) && !okIt({ ...it0, pax: [{ quem: 'u3', loc: 'A' }, { quem: 'u3', loc: 'B' }] }) && !okIt({ ...it0, pax: [{ quem: 'u3' }] }) && !okIt({ ...it0, pax: [] }));
    // Voo sem data: o mais proximo vira modelo e e levado para a data escolhida (horario de verao nas duas pontas)
    const vooRef = [{ number: 'XX 1234', airline: { name: 'Companhia Teste' }, status: 'Arrived',
      departure: { airport: { iata: 'AAA', municipalityName: 'Cidade A', timeZone: 'America/New_York' }, scheduledTime: { utc: '2026-11-07 23:25Z', local: '2026-11-07 18:25-05:00' } },
      arrival: { airport: { iata: 'BBB', municipalityName: 'Cidade B', timeZone: 'Europe/London' }, scheduledTime: { utc: '2026-11-08 06:20Z', local: '2026-11-08 06:20+00:00' } } }];
    const mv = c.modelosDoVoo(vooRef)[0];
    assert.deepStrictEqual([mv.origem, mv.destino, mv.hora, mv.duracao, mv.offOrigem, mv.offDestino], ['AAA', 'BBB', '18:25', 415, -300, 0]);
    assert.deepStrictEqual(c.vooNaData(mv, '2026-11-20'), { data: '2026-11-20', hora: '18:25', fuso: 'GMT-5', fim: '2026-11-21', horaFim: '06:20', fusoFim: 'GMT' });
    assert.deepStrictEqual(c.vooNaData(mv, '2026-07-01'), { data: '2026-07-01', hora: '18:25', fuso: 'GMT-4', fim: '2026-07-02', horaFim: '06:20', fusoFim: 'GMT+1' });
    assert.deepStrictEqual(c.vooNaData({ ...mv, tzOrigem: '', tzDestino: '' }, '2026-07-01'), { data: '2026-07-01', hora: '18:25', fuso: 'GMT-5', fim: '2026-07-02', horaFim: '06:20', fusoFim: 'GMT' }, 'sem fuso IANA: offsets da referencia');
    assert.deepStrictEqual(c.vooNaData({ ...mv, duracao: null }, '2026-11-20'), { data: '2026-11-20', hora: '18:25', fuso: 'GMT-5' });
    assert.strictEqual(c.offsetFuso('America/Sao_Paulo', Date.parse('2026-11-08T12:00Z')), -180);
    assert.strictEqual(c.offsetFuso('Lugar/Nenhum', 0), null);
    assert.strictEqual(c.modelosDoVoo([...vooRef, ...vooRef]).length, 1, 'mesmo trecho uma vez so');
    assert.ok(!okIt({ ...it0, tipo: 'nave' }) && !okIt({ ...it0, hora: '25:00' }) && !okIt({ ...it0, fim: '2027-04-01' }) && !okIt({ ...it0, viagem: 'nenhuma' }) && !okIt({ ...it0, titulo: '' }));
    assert.strictEqual(c.tipoDaCategoriaViagem({ nome: '02 - Hotéis', simbolo: 'cama' }), 'hotel');
    assert.strictEqual(c.tipoDaCategoriaViagem({ nome: '01 - Aéreo', simbolo: 'x' }), 'aereo');
    assert.strictEqual(c.tipoDaCategoriaViagem({ nome: 'Aluguel de carro', simbolo: 'x' }), 'carro');
    assert.strictEqual(c.tipoDaCategoriaViagem({ nome: 'Comida', simbolo: 'x' }), null);
    // Forma do item pela categoria de Ajustes Travel
    assert.deepStrictEqual(['01 - Aéreo', '02 - Hotéis', 'Aluguel de Carro', 'Uber / Táxi', 'Trem Amtrak', '10 - Ingressos', 'Alimentação'].map((nome) => c.formaDaCategoria({ nome, simbolo: 'x' })),
      ['aereo', 'hotel', 'carro', 'transporte', 'transporte', 'evento', 'evento']);
    const uI = { viagens: [{ id: 'v', inicio: '2026-11-13', fim: '2026-11-21' }], categorias: [{ id: 'ch', nome: 'Hotel' }, { id: 'ca', nome: 'Aéreo' }, { id: 'cc', nome: 'Carro' }, { id: 'cx', nome: 'Comida' }],
      despesas: [{ id: 'h', viagem: 'v', desc: 'Hotel', cat: 'ch', checkin: '2026-11-14', checkout: '2026-11-21', local: { nome: 'Hotel Teste', endereco: 'Rua', lat: 1, lng: 1 } },
        { id: 'a', viagem: 'v', desc: 'Passagem', cat: 'ca', checkin: '2026-11-13', checkout: '2026-11-21' },
        { id: 'c', viagem: 'v', desc: 'Hertz', cat: 'cc', checkin: '2026-11-14', checkout: '2026-11-20' },
        { id: 'x', viagem: 'v', desc: 'Jantar', cat: 'cx', checkin: '2026-11-15' },
        { id: 's', viagem: 'v', desc: 'Hotel sem data', cat: 'ch', data: '2026-09-01' }], itinerario: [{ id: 'n1', viagem: 'v', tipo: 'nota', titulo: 'Feira', data: '2026-11-16', hora: '08:00' }] };
    // Nada entra sozinho; a pessoa escolhe entre as despesas que podem virar item
    assert.ok(!c.sincronizarItinDespesas(uI, 'v'));
    assert.deepStrictEqual(uI.itinerario.map((x) => x.id), ['n1']);
    assert.deepStrictEqual(['Parques Disney', 'Shows', '10 - Ingressos', 'Uber', 'Compras', 'Alimentação', 'Gorjetas', '12 - Alimentação Parques/Atrac', '09 - Cruzeiro', 'Estacionamento'].map((nome) => c.categoriaDeItinerario({ nome, simbolo: 'x' })),
      [true, true, true, true, false, false, false, false, true, false]);
    const ops = c.despesasParaItin(uI, 'v');
    assert.deepStrictEqual(ops.map((o) => [o.despesa, o.lado || '', o.forma, o.titulo, o.data, o.fim || '']),
      [['h', '', 'hotel', 'Hotel Teste', '2026-11-14', '2026-11-21'], ['a', 'ida', 'aereo', 'Passagem', '2026-11-13', ''], ['a', 'volta', 'aereo', 'Passagem', '2026-11-21', ''],
        ['c', '', 'carro', 'Hertz', '2026-11-14', '2026-11-20'], ['s', '', 'hotel', 'Hotel sem data', '2026-11-13', '']], 'comida fica de fora; sem check-in e compra fora da viagem: inicio');
    // escolhidas, viram itens ligados a despesa; nao aparecem mais na lista
    for (const o of ops.slice(0, 4)) uI.itinerario.push({ id: 'it' + o.despesa + (o.lado || ''), viagem: 'v', tipo: o.forma, cat: o.cat, titulo: o.titulo, data: o.data, ...(o.fim ? { fim: o.fim } : {}), ...(o.local ? { local: o.local } : {}), despesa: o.despesa, ...(o.lado ? { lado: o.lado } : {}) });
    assert.deepStrictEqual(c.despesasParaItin(uI, 'v').map((o) => o.despesa), ['s']);
    assert.ok(!c.sincronizarItinDespesas(uI, 'v'), 'nada mudou');
    assert.ok(c.despesaComCheckin(uI, uI.despesas[0]) && !c.despesaComCheckin(uI, uI.despesas[4]));
    // o que a pessoa completou fica; a data segue a despesa
    const hot = uI.itinerario.find((x) => x.tipo === 'hotel');
    Object.assign(hot, { hora: '15:00', localizador: 'H9', obs: 'Andar alto' });
    uI.despesas[0].checkout = '2026-11-20';
    uI.despesas[1].checkout = '2026-11-22';
    assert.ok(c.sincronizarItinDespesas(uI, 'v'));
    assert.deepStrictEqual([hot.fim, hot.hora, hot.localizador, hot.obs], ['2026-11-20', '15:00', 'H9', 'Andar alto']);
    assert.strictEqual(uI.itinerario.find((x) => x.lado === 'volta').data, '2026-11-22');
    // despesa excluida: os itens dela saem; o item feito a mao fica
    uI.despesas = uI.despesas.filter((d) => d.id !== 'a');
    assert.ok(c.sincronizarItinDespesas(uI, 'v'));
    assert.deepStrictEqual(uI.itinerario.map((x) => x.tipo).sort(), ['carro', 'hotel', 'nota']);
    // linha do tempo: hotel e carro aparecem de novo no dia da saida
    const dias = c.diasItinerario(uI, 'v');
    assert.deepStrictEqual(dias.map((d) => [d.data, d.itens.map((e) => e.item.tipo + ':' + e.papel)]),
      [['2026-11-14', ['carro:inicio', 'hotel:inicio']], ['2026-11-16', ['nota:inicio']], ['2026-11-20', ['carro:fim', 'hotel:fim']]], 'sem hora primeiro, depois por hora');
  }
  // Contador da viagem em anos e dias
  assert.deepStrictEqual(c.anosEDias('2026-11-07', '2027-11-12'), { anos: 1, dias: 5 });
  assert.deepStrictEqual(c.anosEDias('2026-11-07', '2026-11-11'), { anos: 0, dias: 4 });
  assert.deepStrictEqual(c.anosEDias('2025-11-08', '2026-11-07'), { anos: 0, dias: 364 });
  assert.deepStrictEqual(c.anosEDias('2024-02-29', '2025-03-01'), { anos: 1, dias: 0 }, '29/02 vira 01/03 no ano seguinte');
  assert.strictEqual(c.contadorViagem({ inicio: '2027-11-12' }, '2026-11-07'), 'Faltam: 1 ano e 5 dias');
  assert.strictEqual(c.contadorViagem({ inicio: '2026-11-11' }, '2026-11-07'), 'Faltam: 4 dias');
  assert.strictEqual(c.contadorViagem({ inicio: '2026-11-08' }, '2026-11-07'), 'Falta: 1 dia');
  assert.strictEqual(c.contadorViagem({ inicio: '2028-11-07' }, '2026-11-07'), 'Faltam: 2 anos');
  assert.strictEqual(c.contadorViagem({ inicio: '2026-11-07' }, '2026-11-07'), 'Começa hoje');
  assert.strictEqual(c.contadorViagem({ inicio: '2026-11-01', fim: '2026-11-20' }, '2026-11-07'), 'Em andamento');
  assert.strictEqual(c.contadorViagem({ inicio: '2025-10-20', fim: '2025-11-03' }, '2026-11-07', true), 'Há: 1 ano e 4 dias');
  assert.strictEqual(c.contadorViagem({ inicio: '2025-11-01', fim: '2025-11-09' }, '2026-11-07', true), 'Há: 363 dias');
  assert.strictEqual(c.contadorViagem({}, '2026-11-07'), '', 'sem data, sem contador');
  // Comparar um backup com os dados atuais: o que falta e o que mudou
  const atualC = { lancs: [{ id: 1, v: 1 }, { id: 2, v: 2 }], usa: { despesas: [{ id: 'a', v: 1 }] } };
  assert.deepStrictEqual(c.compararDados({ lancs: [{ id: 1, v: 1 }] }, atualC), { faltam: 0, diferentes: 0 }, 'backup mais antigo, sem nada a mais');
  assert.deepStrictEqual(c.compararDados({ lancs: [{ id: 1, v: 9 }, { id: 3, v: 3 }], usa: { despesas: [{ id: 'b' }] } }, atualC), { faltam: 2, diferentes: 1 });
  // Recibos: validacao, nome do arquivo, recorte (homografia) e PDF
  const ok = (r) => c.backupValido({ ...comUsa, usa: { ...comUsa.usa, despesas: [{ ...comUsa.usa.despesas[0], recibos: r }] } });
  assert.ok(ok(undefined) && ok([]));
  assert.ok(!ok([{ id: 'r1', em: 'ontem' }]), 'data invalida');
  assert.ok(!ok([{ id: 'r1', em: '2027-04-05' }, { id: 'r1', em: '2027-04-05' }]), 'id repetido');
  assert.ok(!ok([{ id: 'r1', em: '2027-04-05', arq: '../../x' }]), 'id do Drive estranho');
  // Local da despesa: nome, endereco, coordenadas e id do lugar; fora disso nao restaura
  const okLocal = (l) => c.backupValido({ ...comUsa, usa: { ...comUsa.usa, despesas: [{ ...comUsa.usa.despesas[0], local: l }] } });
  assert.ok(okLocal(undefined) && okLocal({ nome: 'Lugar', endereco: '', lat: 0, lng: 0 }));
  assert.ok(!okLocal({ nome: 'Lugar', endereco: 'Rua', lat: 91, lng: 0 }), 'latitude fora');
  assert.ok(!okLocal({ nome: '', endereco: 'Rua', lat: 1, lng: 1 }), 'sem nome');
  assert.ok(!okLocal({ nome: 'L', endereco: 'Rua', lat: '1', lng: 1 }), 'coordenada em texto');
  assert.ok(!okLocal({ nome: 'L', endereco: 'Rua', lat: 1, lng: 1, id: 'a b<' }), 'id estranho');
  assert.strictEqual(c.nomeRecibo({ data: '2026-04-25', desc: 'Hotel / Disney: "Pop"', valor: 35000 }, 'US$', 0), '2026-04-25 Hotel Disney Pop US$ 350,00.pdf');
  assert.strictEqual(c.nomeRecibo({ data: '2026-04-25', desc: 'Táxi', valor: 123456 }, 'R$', 2), '2026-04-25 Táxi R$ 1.234,56 (2).pdf');
  const quad = [[30, 40], [500, 20], [520, 700], [10, 680]], ret = [[0, 0], [400, 0], [400, 600], [0, 600]];
  const hq = c.homografia(ret, quad);
  ret.forEach((p, i) => { const [x, y] = c.aplicarH(hq, p[0], p[1]); assert.ok(Math.abs(x - quad[i][0]) < 1e-6 && Math.abs(y - quad[i][1]) < 1e-6); });
  const pdf = new TextDecoder('latin1').decode(c.montarPdf([{ jpeg: new Uint8Array([255, 216, 255, 217]), w: 100, h: 200 }, { jpeg: new Uint8Array([255, 216, 255, 217]), w: 200, h: 100 }]));
  assert.ok(pdf.startsWith('%PDF-1.4') && pdf.trimEnd().endsWith('%%EOF') && pdf.includes('/Count 2') && pdf.includes('/MediaBox [0 0 595 1190]') && pdf.includes('/MediaBox [0 0 595 297.5]'));
  const xrefEm = Number(pdf.match(/startxref\n(\d+)/)[1]);
  assert.ok(pdf.slice(xrefEm).startsWith('xref'), 'startxref aponta para a tabela');
  const offs = [...pdf.slice(xrefEm).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  offs.forEach((o, i) => assert.ok(pdf.slice(o).startsWith(`${i + 1} 0 obj`), `objeto ${i + 1} no lugar certo`));
  // Viagem unica da 1.46.1 vira a lista de viagens, sem perder nada
  const velho = c.migrar({ ...JSON.parse(JSON.stringify(dp)), usa: { viagem: 'Orlando', inicio: '2027-04-04', fundo: jpg, contas: [], cartoes: [], viajantes: [], categorias: [] } }, '2026-11-03');
  assert.deepStrictEqual(velho.usa, { contas: [], cartoes: [], viajantes: [], categorias: [], moedas: c.MOEDAS_PADRAO, despesas: [], itinerario: [],
    viagens: [{ id: 'v1', nome: 'Orlando', inicio: '2027-04-04', fim: undefined, fundo: jpg, moedas: ['USD'], base: 'USD', viajantes: [], cot: {} }] });
  assert.ok(c.backupValido(JSON.parse(JSON.stringify(velho))));
  // Backup antigo continua abrindo com a senha antiga depois que a senha do app muda
  const gNova = await c.protegerSenha('senha-nova-22');
  await assert.rejects(c.decifrarBackup(bkApp, 'senha-nova-22'));
  assert.ok(c.usaSenhaDoApp(await c.cifrarBackupSenhaApp(claroBk, gNova)));
  // Cache: mesmo resultado que sem ele; a lista devolvida pode ser alterada; ao sair, volta a ver mudancas
  const semCache = [c.totalFatura(dbAtr, cartaoAtr, '2026-10'), c.faturasAtrasadas(dbAtr, '2026-10-29')];
  c.comCache(dbAtr, () => {
    assert.deepStrictEqual([c.totalFatura(dbAtr, cartaoAtr, '2026-10'), c.faturasAtrasadas(dbAtr, '2026-10-29')], semCache);
    c.itensFatura(dbAtr, cartaoAtr, '2026-10').pop();
    assert.strictEqual(c.totalFatura(dbAtr, cartaoAtr, '2026-10'), semCache[0]);
    assert.deepStrictEqual(c.itensFatura(dbAtr, cartaoAtr, '1999-01'), []);
  });
  dbAtr.lancs.push({ id: 'n', tipo: 'S', data: '2026-10-20', valor: 100, meio: 'x', cat: 't', pago: true });
  assert.strictEqual(c.totalFatura(dbAtr, cartaoAtr, '2026-10'), semCache[0] + 100);
  // Gastos por conta ou cartao: conta primeiro, depois cartoes pelo maior total; soma igual a Gastos do mes
  const dbMeio = {
    contasBanco: [{ id: 'cc', nome: 'C', saldoInicial: 0 }], cartoes: [{ id: 'p', nome: 'P', fechamento: 18, vencimento: 30, contaPag: 'cc' }, { id: 'g', nome: 'G', fechamento: 18, vencimento: 30, contaPag: 'cc' }], faturasPagas: {}, parciais: [], series: [],
    lancs: [['a', 'cc', 100], ['b', 'cc', 300], ['d', 'p', 50], ['e', 'g', 900], ['f', 'g', -100]].map(([id, meio, valor]) => ({ id, tipo: 'S', data: '2026-11-05', valor, meio, cat: 'k', pago: true })).concat({ id: 'z', tipo: 'E', data: '2026-11-05', valor: 7, meio: 'cc', cat: 'r', pago: true }),
  };
  const meios = c.gastosPorMeio(dbMeio, '2026-11');
  assert.deepStrictEqual(meios.map((g) => [g.meio, g.total]), [['cc', 400], ['g', 800], ['p', 50]]);
  assert.deepStrictEqual(meios[0].itens.map((l) => l.id), ['b', 'a']);
  assert.strictEqual(meios.reduce((s, g) => s + g.total, 0), c.gastosPorCategoria(dbMeio, '2026-11').k);
  // Resumos: periodo, categoria, conta ou cartao, base do cartao e o que falta pagar
  const dbR = {
    contasBanco: [{ id: 'cc', nome: 'C', saldoInicial: 0 }, { id: 'pp', nome: 'P', saldoInicial: 0 }],
    cartoes: [{ id: 'k', nome: 'K', fechamento: 20, vencimento: 28, contaPag: 'cc' }], faturasPagas: {}, parciais: [], series: [],
    lancs: [
      { id: 'c1', tipo: 'S', data: '2026-10-10', valor: 100, meio: 'cc', cat: 'casa', pago: true },
      { id: 'c2', tipo: 'S', data: '2026-11-10', valor: 200, meio: 'cc', cat: 'casa', pago: false },
      { id: 'c3', tipo: 'S', data: '2026-11-12', valor: 50, meio: 'pp', cat: 'lazer', pago: false },
      { id: 'c4', tipo: 'S', data: '2026-09-05', valor: 70, meio: 'cc', cat: 'lazer', pago: false },
      { id: 'k1', tipo: 'S', data: '2026-10-25', valor: 300, meio: 'k', cat: 'casa', pago: true },
      { id: 'k2', tipo: 'S', data: '2026-11-21', valor: 400, meio: 'k', cat: 'lazer', pago: true },
      { id: 'e1', tipo: 'E', data: '2026-11-01', valor: 999, meio: 'cc', cat: 'r', pago: true },
    ],
  };
  const fR = (x) => ({ ini: '2026-11', fim: '2026-11', cat: '', meios: [], base: 'compra', origem: 'tudo', ...x });
  const ids = (l) => l.map((x) => x.id);
  assert.deepStrictEqual(ids(c.resumoConta(dbR, fR())), ['c2', 'c3']);
  assert.deepStrictEqual(ids(c.resumoConta(dbR, fR({ ini: '2026-09' }))), ['c4', 'c1', 'c2', 'c3']);
  assert.deepStrictEqual(ids(c.resumoConta(dbR, fR({ cat: 'casa', meios: ['cc'], ini: '2026-10' }))), ['c1', 'c2']);
  assert.deepStrictEqual(ids(c.resumoConta(dbR, fR({ meios: ['cc', 'pp'] }))), ['c2', 'c3'], 'varias contas juntas');
  assert.deepStrictEqual(c.resumoAPagar(dbR, fR({ meios: ['pp', 'k'] }), '2026-11-01').map((i) => i.meio), ['pp', 'k'], 'conta e cartao juntos');
  assert.deepStrictEqual(ids(c.resumoCartoes(dbR, fR())), ['k2']);
  assert.deepStrictEqual(ids(c.resumoCartoes(dbR, fR({ base: 'fatura' }))), ['k1'], 'compra de 25/10 entra na fatura de novembro');
  assert.deepStrictEqual(c.resumoCategorias(dbR, fR()), [{ cat: 'lazer', valor: 450 }, { cat: 'casa', valor: 200 }]);
  const apagar = (x) => c.resumoAPagar(dbR, fR(x), '2026-11-15').map((i) => i.tipo === 'conta' ? i.lanc.id : i.desc + ' ' + i.ym + ' ' + i.valor);
  assert.deepStrictEqual(apagar(), ['c4', 'c2', 'c3', 'Fatura K 2026-11 300']);
  assert.deepStrictEqual(apagar({ origem: 'contas' }), ['c4', 'c2', 'c3']);
  assert.deepStrictEqual(apagar({ origem: 'cartoes' }), ['Fatura K 2026-11 300']);
  assert.deepStrictEqual(apagar({ cat: 'casa' }), ['c2'], 'com categoria, fatura nao entra');
  assert.deepStrictEqual(apagar({ ini: '2026-12', fim: '2026-12' }), ['c4', 'c2', 'c3', 'Fatura K 2026-12 400'], 'atrasadas entram em qualquer periodo futuro');
  // Parcelamentos: so gastos parcelados, deste mes em diante no quadro; periodo e contas no detalhe
  const dbP = {
    contasBanco: [{ id: 'cc', nome: 'C', saldoInicial: 0 }], cartoes: [{ id: 'k', nome: 'K', fechamento: 20, vencimento: 28, contaPag: 'cc' }], faturasPagas: {}, parciais: [], series: [],
    lancs: [
      ...[1, 2, 3].map((n) => ({ id: 'a' + n, tipo: 'S', data: `2026-${String(9 + n).padStart(2, '0')}-10`, valor: 100, meio: 'k', desc: 'TV', cat: 'x', pago: true, parcela: n, de: 3, serie: 'sa' })),
      ...[1, 2].map((n) => ({ id: 'b' + n, tipo: 'S', data: `2026-${String(10 + n).padStart(2, '0')}-05`, valor: 50, meio: 'cc', desc: 'IPTU', cat: 'x', pago: false, parcela: n, de: 2, serie: 'sb' })),
      { id: 'f1', tipo: 'S', data: '2026-11-15', valor: 999, meio: 'cc', desc: 'Luz', cat: 'x', pago: false, serie: 'fixa' },
      { id: 'u1', tipo: 'S', data: '2026-11-15', valor: 30, meio: 'cc', desc: 'Avulso', cat: 'x', pago: false },
    ],
  };
  assert.deepStrictEqual(c.resumoParcelamentos(dbP, '2026-11-02'), [{ meio: 'k', total: 200, n: 2, ultima: '2026-12-10' }, { meio: 'cc', total: 100, n: 2, ultima: '2026-12-05' }]);
  assert.deepStrictEqual(c.parcelasNoPeriodo(dbP, '2026-10-01', '2026-11-30', []).map((l) => l.id), ['a1', 'b1', 'a2']);
  assert.deepStrictEqual(c.parcelasNoPeriodo(dbP, '2026-01-01', '2027-12-31', ['cc']).map((l) => l.id), ['b1', 'b2'], 'conta fixa e avulso ficam de fora');
  // Resgates: so entradas em categoria de receita com "resgate" no nome, no mes e na conta
  const dbRg = {
    contasBanco: [{ id: 'cc', nome: 'C', saldoInicial: 0 }, { id: 'pp', nome: 'P', saldoInicial: 0 }], cartoes: [], faturasPagas: {}, parciais: [], series: [],
    categorias: [{ id: 'rg', nome: 'Resgate de Aplicações', tipo: 'E' }, { id: 'ot', nome: 'Outras receitas', tipo: 'E' }, { id: 'sx', nome: 'Resgate', tipo: 'S' }],
    lancs: [
      { id: 'a', tipo: 'E', data: '2026-11-03', valor: 500, meio: 'cc', cat: 'rg', pago: true },
      { id: 'b', tipo: 'E', data: '2026-11-20', valor: 300, meio: 'cc', cat: 'rg', pago: false },
      { id: 'c', tipo: 'E', data: '2026-11-03', valor: 999, meio: 'cc', cat: 'ot', desc: 'Resgate antigo', pago: true },
      { id: 'd', tipo: 'E', data: '2026-11-03', valor: 70, meio: 'pp', cat: 'rg', pago: true },
      { id: 'e', tipo: 'E', data: '2026-10-03', valor: 40, meio: 'cc', cat: 'rg', pago: true },
    ],
  };
  assert.deepStrictEqual(c.resgatesDoMes(dbRg, '2026-11', 'cc'), { total: 800, n: 2 });
  assert.deepStrictEqual(c.resgatesDoMes(dbRg, '2026-11', ''), { total: 870, n: 3 });
  // Fluxo por periodo: resgates a parte das entradas; saidas pagas ou nao; transferencia fica fora
  dbRg.lancs.push({ id: 'f', tipo: 'S', data: '2026-11-05', valor: 200, meio: 'cc', cat: 'sx', pago: false }, { id: 'g', tipo: 'T', data: '2026-11-05', valor: 5000, meio: 'cc', destino: 'pp', pago: true });
  assert.deepStrictEqual(c.fluxoPeriodo(dbRg, '2026-11', '2026-11'), { entradas: 999, resgates: 870, saidas: 200 });
  assert.deepStrictEqual(c.fluxoPeriodo(dbRg, '2026-10', '2026-11'), { entradas: 999, resgates: 910, saidas: 200 });
  console.log('calc.js: todos os testes passaram');
})().catch((e) => { console.error(e); process.exit(1); });
