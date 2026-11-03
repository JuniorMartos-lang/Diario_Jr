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
  k.finais = [{ n: '1234', tipo: 'V', dono: 'Z' }]; assert.ok(!c.backupValido(b)); }

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
  // Finais dos cartoes (numero, fisico/virtual, titular/adicional) passam inteiros pelos dois tipos de backup e pela restauracao
  const comFinais = JSON.parse(JSON.stringify(dp));
  comFinais.cartoes[0].finais = [{ n: '1111', tipo: 'F', dono: 'T' }, { n: '2222', tipo: 'V', dono: 'T' }, { n: '3333', tipo: 'F', dono: 'A' }, { n: '4444', tipo: 'V', dono: 'A' }];
  for (const arq of [await c.cifrarBackup(comFinais, 'senha-certa-1'), await c.cifrarBackupSenhaApp(comFinais, gApp)]) {
    const senhaArq = c.usaSenhaDoApp(arq) ? 'senha-do-app-1' : 'senha-certa-1';
    const volta = c.migrar(await c.decifrarBackup(JSON.parse(JSON.stringify(arq)), senhaArq), '2026-11-03');
    assert.ok(c.backupValido(volta));
    assert.deepStrictEqual(volta.cartoes[0].finais, comFinais.cartoes[0].finais);
  }
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
  console.log('calc.js: todos os testes passaram');
})().catch((e) => { console.error(e); process.exit(1); });
