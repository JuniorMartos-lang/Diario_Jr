// Teste: node calc.test.js (dentro de app/)
const assert = require('assert');
const c = require('./calc.js');

// Datas
assert.strictEqual(c.addMes('2026-12', 1), '2027-01');
assert.strictEqual(c.addMes('2026-01', 13), '2027-02');
assert.strictEqual(c.dataNoMes('2026-02', 31), '2026-02-28');
assert.strictEqual(c.dataNoMes('2028-02', 31), '2028-02-29');

// Fatura: fecha dia 25, vence dia 5 do mes seguinte
const nu = { id: 'nu', nome: 'Nu', fechamento: 25, vencimento: 5 };
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

// Parcelas: soma exata, centavos que sobram nas primeiras
const p = c.parcelasDe({ data: '2026-10-10', valor: 10000, parcelas: 3, meio: 'nu' }, nu);
assert.deepStrictEqual(p.map((x) => x.valor), [3334, 3333, 3333]);
assert.deepStrictEqual(p.map((x) => x.ym), ['2026-11', '2026-12', '2027-01']);

const base = () => ({
  saldoInicial: 100000,
  categorias: [{ id: 'a', nome: 'Alimentação' }, { id: 'm', nome: 'Moradia' }],
  cartoes: [nu],
  lancs: [
    { id: 1, tipo: 'E', data: '2026-10-05', valor: 500000, cat: 'a', meio: 'conta' },
    { id: 2, tipo: 'S', data: '2026-10-06', valor: 20000, cat: 'a', meio: 'conta' },
    { id: 3, tipo: 'S', data: '2026-10-10', valor: 30000, cat: 'a', meio: 'nu', parcelas: 3 },
    { id: 4, tipo: 'S', data: '2026-12-01', valor: 9900, cat: 'a', meio: 'conta' },
  ],
  contas: [
    { id: 5, desc: 'Aluguel', venc: '2026-10-10', valor: 150000, cat: 'm', pagoEm: '2026-10-10' },
    { id: 6, desc: 'Luz', venc: '2026-10-20', valor: 25000, cat: 'm', pagoEm: null },
    { id: 7, desc: 'Água', venc: '2026-11-20', valor: 8000, cat: 'm', pagoEm: null },
  ],
  faturasPagas: {},
});

// Saldo: compra no cartao, conta pendente e lancamento futuro nao mexem; conta paga sim
let db = base();
assert.strictEqual(c.saldo(db, '2026-10-31'), 100000 + 500000 - 20000 - 150000);

// Pagar a fatura desconta o valor gravado, mesmo que a fatura mude depois
db.faturasPagas[c.chaveFatura('nu', '2026-11')] = { data: '2026-11-05', valor: 10000 };
assert.strictEqual(c.saldo(db, '2026-11-05'), 430000 - 10000);
assert.strictEqual(c.saldo(db, '2026-11-04'), 430000, 'pagamento futuro ainda nao conta');

// Categorias: parcela conta no mes da fatura; pagar a fatura nao conta de novo
assert.deepStrictEqual(c.gastosPorCategoria(db, '2026-10'), { a: 20000, m: 175000 });
assert.deepStrictEqual(c.gastosPorCategoria(db, '2026-11'), { a: 10000, m: 8000 });
assert.strictEqual(c.entradasDoMes(db, '2026-10'), 500000);

// A pagar: em outubro so a Luz; em novembro entra a Agua e a fatura em aberto, ordenados por vencimento
db = base();
assert.deepStrictEqual(c.aPagar(db, '2026-10').map((x) => x.desc), ['Luz']);
assert.deepStrictEqual(c.aPagar(db, '2026-11').map((x) => x.desc), ['Luz', 'Fatura Nu', 'Água']);
// Fatura vencida nao paga continua aparecendo nos meses seguintes; paga, some
assert.strictEqual(c.aPagar(db, '2026-12').filter((x) => x.tipo === 'fatura').length, 2);
db.faturasPagas[c.chaveFatura('nu', '2026-11')] = { data: '2026-11-05', valor: 10000 };
assert.strictEqual(c.aPagar(db, '2026-12').filter((x) => x.tipo === 'fatura').length, 1);

// Restauracao
assert.ok(c.backupValido(base()));
assert.ok(!c.backupValido(null));
assert.ok(!c.backupValido({ ops: [] }), 'backup de outro app');
assert.ok(!c.backupValido({ ...base(), lancs: [{ data: 'ontem', valor: 1, tipo: 'S', meio: 'conta' }] }));
assert.ok(!c.backupValido({ ...base(), saldoInicial: '10' }));

console.log('calc.js: todos os testes passaram');
