// Contas do Controle Diario. Valores sempre em centavos (inteiros); datas em texto AAAA-MM-DD.

function ultimoDia(ym) {
  const [a, m] = ym.split('-').map(Number);
  return new Date(a, m, 0).getDate();
}

function addMes(ym, n) {
  const [a, m] = ym.split('-').map(Number);
  const d = new Date(a, m - 1 + n, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

// Dia 31 em mes menor vira o ultimo dia do mes.
function dataNoMes(ym, dia) {
  return ym + '-' + String(Math.min(dia, ultimoDia(ym))).padStart(2, '0');
}

// Mes do vencimento da fatura em que a compra cai. Compra no dia do fechamento ja vai para a fatura seguinte.
function mesFatura(data, cartao) {
  const ym = data.slice(0, 7);
  const fecha = +data.slice(8) >= Math.min(cartao.fechamento, ultimoDia(ym)) ? addMes(ym, 1) : ym;
  return cartao.vencimento > cartao.fechamento ? fecha : addMes(fecha, 1);
}

// Os centavos que sobram da divisao ficam nas primeiras parcelas.
function parcelasDe(lanc, cartao) {
  const n = lanc.parcelas || 1;
  const base = Math.floor(lanc.valor / n);
  const resto = lanc.valor - base * n;
  const inicio = mesFatura(lanc.data, cartao);
  return Array.from({ length: n }, (_, i) => ({
    ym: addMes(inicio, i), valor: base + (i < resto ? 1 : 0), n: i + 1, de: n, lanc,
  }));
}

function todasParcelas(db, cartao) {
  return db.lancs.filter((l) => l.meio === cartao.id).flatMap((l) => parcelasDe(l, cartao));
}

function itensFatura(db, cartao, ym) {
  return todasParcelas(db, cartao).filter((p) => p.ym === ym);
}

function totalFatura(db, cartao, ym) {
  return itensFatura(db, cartao, ym).reduce((s, p) => s + p.valor, 0);
}

function chaveFatura(cartaoId, ym) {
  return cartaoId + '|' + ym;
}

// Saldo da conta corrente no dia: compras no cartao so saem da conta quando a fatura e paga.
function saldo(db, hoje) {
  let s = db.saldoInicial || 0;
  for (const l of db.lancs) {
    if (l.meio === 'conta' && l.data <= hoje) s += l.tipo === 'E' ? l.valor : -l.valor;
  }
  for (const c of db.contas) if (c.pagoEm && c.pagoEm <= hoje) s -= c.valor;
  for (const f of Object.values(db.faturasPagas)) if (f.data <= hoje) s -= f.valor;
  return s;
}

// Gastos do mes por categoria. Cartao conta no mes da fatura; conta a pagar, no mes do vencimento.
// O pagamento da fatura nao entra: as compras dela ja foram contadas.
function gastosPorCategoria(db, ym) {
  const t = {};
  const soma = (cat, v) => { t[cat] = (t[cat] || 0) + v; };
  for (const l of db.lancs) {
    if (l.meio === 'conta' && l.tipo === 'S' && l.data.slice(0, 7) === ym) soma(l.cat, l.valor);
  }
  for (const c of db.cartoes) for (const p of itensFatura(db, c, ym)) soma(p.lanc.cat, p.valor);
  for (const c of db.contas) if (c.venc.slice(0, 7) === ym) soma(c.cat, c.valor);
  return t;
}

function entradasDoMes(db, ym) {
  return db.lancs
    .filter((l) => l.tipo === 'E' && l.data.slice(0, 7) === ym)
    .reduce((s, l) => s + l.valor, 0);
}

// Tudo o que falta pagar ate o fim do mes, incluindo o que ficou atrasado de meses anteriores.
function aPagar(db, ym) {
  const itens = db.contas
    .filter((c) => !c.pagoEm && c.venc.slice(0, 7) <= ym)
    .map((c) => ({ tipo: 'conta', id: c.id, desc: c.desc, venc: c.venc, valor: c.valor }));
  for (const cartao of db.cartoes) {
    const meses = new Set(todasParcelas(db, cartao).map((p) => p.ym));
    for (const m of meses) {
      if (m > ym || db.faturasPagas[chaveFatura(cartao.id, m)]) continue;
      itens.push({
        tipo: 'fatura', id: cartao.id, ym: m, desc: 'Fatura ' + cartao.nome,
        venc: dataNoMes(m, cartao.vencimento), valor: totalFatura(db, cartao, m),
      });
    }
  }
  return itens.sort((a, b) => a.venc.localeCompare(b.venc));
}

// Barreira da restauracao: um arquivo fora deste formato nao pode substituir os dados.
function backupValido(d) {
  const inteiro = (v) => Number.isInteger(v);
  const data = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  return !!d && typeof d === 'object'
    && Array.isArray(d.categorias) && Array.isArray(d.cartoes)
    && Array.isArray(d.lancs) && Array.isArray(d.contas)
    && !!d.faturasPagas && typeof d.faturasPagas === 'object' && !Array.isArray(d.faturasPagas)
    && inteiro(d.saldoInicial)
    && d.categorias.every((c) => c.id && typeof c.nome === 'string')
    && d.cartoes.every((c) => c.id && typeof c.nome === 'string' && inteiro(c.fechamento) && inteiro(c.vencimento))
    && d.lancs.every((l) => data(l.data) && inteiro(l.valor) && (l.tipo === 'E' || l.tipo === 'S') && l.meio)
    && d.contas.every((c) => data(c.venc) && inteiro(c.valor) && typeof c.desc === 'string')
    && Object.values(d.faturasPagas).every((f) => data(f.data) && inteiro(f.valor));
}

if (typeof module !== 'undefined') {
  module.exports = {
    ultimoDia, addMes, dataNoMes, mesFatura, parcelasDe, itensFatura, totalFatura, chaveFatura,
    saldo, gastosPorCategoria, entradasDoMes, aPagar, backupValido,
  };
}
