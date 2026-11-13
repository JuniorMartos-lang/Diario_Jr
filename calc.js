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

// Desenhar as telas repete as mesmas contas milhares de vezes. Dentro de comCache os dados nao mudam,
// entao cada conta roda uma vez; fora dele tudo e recalculado.
let cacheCalc = null;
const cacheDe = (db) => (cacheCalc && cacheCalc.db === db ? cacheCalc : null);
function comCache(db, fn) {
  cacheCalc = { db, parcelas: new Map() };
  try { return fn(); } finally { cacheCalc = null; }
}

// Conta ou cartao arquivado aparece ate o mes do arquivamento e some dos meses seguintes.
// Cartao arquivado vai ate a ultima fatura das compras feitas ate o arquivamento (ativoAte), para nao sumir parcela.
function ativoEm(item, ym) {
  return !item.arquivadaEm || ym <= (item.ativoAte || item.arquivadaEm.slice(0, 7));
}
function ultimaFaturaAte(db, cartao, data) {
  return db.lancs.filter((l) => l.meio === cartao.id && (l.compra || l.data) <= data)
    .reduce((m, l) => { const ym = mesFatura(l.data, cartao); return ym > m ? ym : m; }, data.slice(0, 7));
}

// Lancamentos depois do mes do arquivamento ficam guardados, mas nao contam: voltam ao desarquivar.
function lancsVisiveis(db) {
  const c = cacheDe(db);
  if (c && c.visiveis) return c.visiveis;
  const todos = [...db.contasBanco, ...db.cartoes];
  const ativo = (id, ym) => { const o = todos.find((x) => x.id === id); return !o || ativoEm(o, ym); };
  const visiveis = db.lancs.filter((l) => {
    const cartao = db.cartoes.find((x) => x.id === l.meio);
    const ym = cartao ? mesFatura(l.data, cartao) : l.data.slice(0, 7);
    // No cartao arquivado, depois do mes do arquivamento so continuam as compras feitas ate ele (parcelas inclusive).
    if (cartao && cartao.arquivadaEm && ym > cartao.arquivadaEm.slice(0, 7)) return ativoEm(cartao, ym) && (l.compra || l.data) <= cartao.arquivadaEm;
    return ativo(l.meio, ym) && (!l.destino || ativo(l.destino, ym));
  });
  if (c) c.visiveis = visiveis;
  return visiveis;
}

// Cada parcela e um lancamento proprio; a fatura vem da data dele.
function todasParcelas(db, cartao) {
  return lancsVisiveis(db).filter((l) => l.meio === cartao.id).map((l) => ({ ym: mesFatura(l.data, cartao), valor: l.valor, n: l.parcela, de: l.de, lanc: l }));
}

function itensFatura(db, cartao, ym) {
  const c = cacheDe(db);
  if (!c) return todasParcelas(db, cartao).filter((p) => p.ym === ym);
  let porMes = c.parcelas.get(cartao.id);
  if (!porMes) {
    porMes = new Map();
    for (const p of todasParcelas(db, cartao)) {
      if (!porMes.has(p.ym)) porMes.set(p.ym, []);
      porMes.get(p.ym).push(p);
    }
    c.parcelas.set(cartao.id, porMes);
  }
  return [...(porMes.get(ym) || [])];
}

function totalFatura(db, cartao, ym) {
  return itensFatura(db, cartao, ym).reduce((s, p) => s + p.valor, 0);
}

// Data em que a fatura com vencimento no mes ym fecha.
function fechamentoFatura(cartao, ym) {
  return dataNoMes(cartao.vencimento > cartao.fechamento ? ym : addMes(ym, -1), cartao.fechamento);
}

// O pagamento fica liberado a partir do fechamento, quando o valor da fatura ja esta definido.
function faturaPagavel(cartao, ym, hoje) {
  return hoje >= fechamentoFatura(cartao, ym);
}

function chaveFatura(cartaoId, ym) {
  return cartaoId + '|' + ym;
}

function ehCartao(db, meio) {
  return db.cartoes.some((c) => c.id === meio);
}

function parciaisDe(db, cartaoId, ym) {
  return db.parciais.filter((p) => p.cartao === cartaoId && p.ym === ym);
}

// O que falta pagar na fatura depois dos pagamentos parciais.
function restanteFatura(db, cartao, ym) {
  if (db.faturasPagas[chaveFatura(cartao.id, ym)]) return 0;
  return parciaisDe(db, cartao.id, ym).reduce((s, p) => s - p.valor, totalFatura(db, cartao, ym));
}

// Compra de cartao em fatura ja paga por inteiro nao muda mais: so depois de desfazer o pagamento.
function faturaPagaDoLanc(db, l) {
  const cartao = db.cartoes.find((c) => c.id === l.meio);
  return !!cartao && !!db.faturasPagas[chaveFatura(cartao.id, mesFatura(l.data, cartao))];
}

// Quem paga menos que o restante deixa a diferenca em aberto na mesma fatura.
function pagarFatura(db, cartao, ym, pagamento) {
  const falta = restanteFatura(db, cartao, ym);
  if (pagamento.valor >= falta) db.faturasPagas[chaveFatura(cartao.id, ym)] = { data: pagamento.data, valor: falta, conta: pagamento.conta };
  else db.parciais.push({ cartao: cartao.id, ym, ...pagamento });
}

function desfazerPagamentos(db, cartaoId, ym) {
  delete db.faturasPagas[chaveFatura(cartaoId, ym)];
  db.parciais = db.parciais.filter((p) => p.cartao !== cartaoId || p.ym !== ym);
}

// Saldo de cada conta: so o que foi marcado como pago/recebido, mesmo com data futura.
// Compras no cartao so saem da conta quando a fatura e paga.
function saldosPorConta(db, hoje) {
  const t = {};
  for (const c of db.contasBanco) t[c.id] = c.saldoInicial;
  for (const l of lancsVisiveis(db)) {
    if (!l.pago || ehCartao(db, l.meio)) continue;
    if (l.tipo === 'T') { t[l.meio] -= l.valor; t[l.destino] += l.valor; }
    else t[l.meio] += l.tipo === 'E' ? l.valor : -l.valor;
  }
  for (const f of [...Object.values(db.faturasPagas), ...db.parciais]) if (f.data <= hoje) t[f.conta] -= f.valor;
  return t;
}

function saldo(db, hoje) {
  const t = saldosPorConta(db, hoje);
  return db.contasBanco.filter((c) => ativoEm(c, hoje.slice(0, 7))).reduce((s, c) => s + t[c.id], 0);
}

// Gastos do mes por categoria, pagos ou pendentes, pela data do lancamento, inclusive no cartao
// (cada parcela e um lancamento, com a data do seu mes).
// Pagamento de fatura e transferencia nao entram: o dinheiro so muda de lugar.
function gastosPorCategoria(db, ym) {
  const t = {};
  for (const l of lancsVisiveis(db)) {
    if (l.tipo === 'S' && l.data.slice(0, 7) === ym) t[l.cat] = (t[l.cat] || 0) + l.valor;
  }
  return t;
}

// Limites de gastos do mes, por nome. variacao: % sobre o gasto do mes anterior; null se nao houve gasto nele.
function limitesDoMes(db, ym) {
  const gastos = gastosPorCategoria(db, ym), anteriores = gastosPorCategoria(db, addMes(ym, -1));
  return db.categorias
    .filter((c) => c.tipo === 'S' && c.limite && ativoEm(c, ym))
    .map((c) => {
      const gasto = gastos[c.id] || 0, anterior = anteriores[c.id] || 0;
      return { cat: c, limite: c.limite, gasto, resta: c.limite - gasto, pct: Math.round(gasto / c.limite * 100), variacao: anterior ? (gasto / anterior - 1) * 100 : null };
    })
    .sort((a, b) => a.cat.nome.localeCompare(b.cat.nome, 'pt-BR'));
}

// Os lancamentos que formam o gasto de uma categoria no mes, do mais novo para o mais antigo.
function lancsDoLimite(db, cat, ym) {
  return lancsVisiveis(db)
    .filter((l) => l.tipo === 'S' && l.cat === cat && l.data.slice(0, 7) === ym)
    .map((l) => ({ lanc: l, valor: l.valor, n: l.parcela, de: l.de }))
    .sort((a, b) => b.lanc.data.localeCompare(a.lanc.data));
}

// Receitas e despesas do periodo, pagas ou pendentes; transferencia fica fora, pois nao e ganho nem gasto.
// Cartao: base 'fatura' poe cada parcela no mes da fatura; base 'compra', todas no mes da compra.
function itensRelatorio(db, ini, fim, base, filtro) {
  const itens = [];
  for (const l of lancsVisiveis(db)) {
    if (l.tipo === 'T' || (filtro && l.meio !== filtro)) continue;
    const cartao = db.cartoes.find((c) => c.id === l.meio);
    const ym = !cartao ? l.data.slice(0, 7) : base === 'fatura' ? mesFatura(l.data, cartao) : (l.compra || l.data).slice(0, 7);
    itens.push({ lanc: l, ym, tipo: l.tipo, cat: l.cat, valor: l.valor, desc: l.de ? `${l.desc} (${l.parcela}/${l.de})` : l.desc });
  }
  return itens.filter((i) => i.ym >= ini && i.ym <= fim);
}

// Por categoria, da maior para a menor, com os lancamentos que formam cada total.
function relatorioCategorias(itens, tipo) {
  const grupos = new Map();
  for (const i of itens) {
    if (i.tipo !== tipo) continue;
    if (!grupos.has(i.cat)) grupos.set(i.cat, { cat: i.cat, total: 0, itens: [] });
    const g = grupos.get(i.cat);
    g.total += i.valor;
    g.itens.push(i);
  }
  const lista = [...grupos.values()].sort((a, b) => b.total - a.total);
  const total = lista.reduce((s, g) => s + g.total, 0);
  for (const g of lista) {
    g.pct = g.total / total * 100;
    g.itens.sort((a, b) => b.lanc.data.localeCompare(a.lanc.data));
  }
  return { total, lista };
}

// Um registro por mes do periodo, inclusive os meses sem movimento.
function relatorioBalanco(itens, ini, fim) {
  const meses = [];
  for (let m = ini; m <= fim; m = addMes(m, 1)) {
    const doMes = itens.filter((i) => i.ym === m);
    const soma = (tipo) => doMes.filter((i) => i.tipo === tipo).reduce((s, i) => s + i.valor, 0);
    const receitas = soma('E'), despesas = soma('S');
    meses.push({ ym: m, receitas, despesas, saldo: receitas - despesas });
  }
  return meses;
}

function entradasDoMes(db, ym) {
  return lancsVisiveis(db)
    .filter((l) => l.tipo === 'E' && l.data.slice(0, 7) === ym)
    .reduce((s, l) => s + l.valor, 0);
}

// Gastos do mes por conta ou cartao, pela data do lancamento: contas primeiro, depois do maior para o menor.
function gastosPorMeio(db, ym) {
  const grupos = new Map();
  for (const l of lancsVisiveis(db)) {
    if (l.tipo !== 'S' || l.data.slice(0, 7) !== ym) continue;
    if (!grupos.has(l.meio)) grupos.set(l.meio, { meio: l.meio, cartao: ehCartao(db, l.meio), total: 0, itens: [] });
    const g = grupos.get(l.meio);
    g.total += l.valor;
    g.itens.push(l);
  }
  for (const g of grupos.values()) g.itens.sort((a, b) => b.valor - a.valor);
  return [...grupos.values()].sort((a, b) => a.cartao - b.cartao || b.total - a.total);
}

function pendentes(db, tipo, ym) {
  const contaAtiva = (id) => { const c = db.contasBanco.find((x) => x.id === id); return !c || ativoEm(c, ym); };
  return lancsVisiveis(db)
    .filter((l) => l.tipo === tipo && !ehCartao(db, l.meio) && !l.pago && l.data.slice(0, 7) <= ym && contaAtiva(l.meio))
    .map((l) => ({ tipo: 'conta', id: l.id, desc: l.desc, venc: l.data, valor: l.valor }))
    .sort((a, b) => a.venc.localeCompare(b.venc));
}

// Receitas pendentes ate o fim do mes, incluindo as atrasadas.
function aReceber(db, ym) {
  return pendentes(db, 'E', ym);
}

// Aba Resumos. f = { ini, fim (AAAA-MM), cat, meios (lista de contas e cartoes), base ('compra' | 'fatura'), origem ('tudo' | 'contas' | 'cartoes') }.
// cat vazia ou meios vazia quer dizer todos.
const noPeriodo = (ym, f) => ym >= f.ini && ym <= f.fim;
const meioNoFiltro = (m, f) => !f.meios || !f.meios.length || f.meios.includes(m);
// Mes em que o gasto conta: na conta, a data; no cartao, a data da compra ou o mes da fatura.
function mesDoGasto(db, l, base) {
  const cartao = db.cartoes.find((c) => c.id === l.meio);
  return cartao && base === 'fatura' ? mesFatura(l.data, cartao) : l.data.slice(0, 7);
}
function gastosFiltrados(db, f, deCartao) {
  return lancsVisiveis(db)
    .filter((l) => l.tipo === 'S' && ehCartao(db, l.meio) === deCartao && (!f.cat || l.cat === f.cat) && meioNoFiltro(l.meio, f)
      && noPeriodo(mesDoGasto(db, l, f.base), f))
    .sort((a, b) => a.data.localeCompare(b.data));
}
const resumoConta = (db, f) => gastosFiltrados(db, f, false);
const resumoCartoes = (db, f) => gastosFiltrados(db, f, true);
// Gastos de contas e cartoes somados por categoria, do maior para o menor.
function resumoCategorias(db, f) {
  const t = {};
  for (const l of [...gastosFiltrados(db, f, false), ...gastosFiltrados(db, f, true)]) t[l.cat] = (t[l.cat] || 0) + l.valor;
  return Object.entries(t).map(([cat, valor]) => ({ cat, valor })).sort((a, b) => b.valor - a.valor);
}
// O que falta pagar com vencimento no periodo, mais o que ja esta atrasado. Fatura nao tem categoria:
// com uma categoria escolhida, so entram contas.
function resumoAPagar(db, f, hoje) {
  const entra = (venc) => noPeriodo(venc.slice(0, 7), f) || (venc < hoje && venc.slice(0, 7) < f.ini);
  const itens = [];
  if (f.origem !== 'cartoes') {
    for (const l of lancsVisiveis(db)) {
      if (l.tipo === 'S' && !l.pago && !ehCartao(db, l.meio) && entra(l.data) && (!f.cat || l.cat === f.cat) && meioNoFiltro(l.meio, f)) {
        itens.push({ tipo: 'conta', lanc: l, meio: l.meio, desc: l.desc, venc: l.data, valor: l.valor });
      }
    }
  }
  if (f.origem !== 'contas' && !f.cat) {
    for (const c of db.cartoes) {
      if (!ativoEm(c, f.fim) || !meioNoFiltro(c.id, f)) continue;
      for (const ym of mesesEmAberto(db, c)) {
        const venc = dataNoMes(ym, c.vencimento);
        if (entra(venc)) itens.push({ tipo: 'fatura', ym, meio: c.id, desc: 'Fatura ' + c.nome, venc, valor: restanteFatura(db, c, ym) });
      }
    }
  }
  return itens.sort((a, b) => a.venc.localeCompare(b.venc));
}

// Resgates de aplicacoes do mes numa conta: entradas em categoria de receita cujo nome tem "resgate".
const ehCatResgate = (c) => !!c && c.tipo === 'E' && c.nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes('resgate');
function resgatesDoMes(db, ym, conta) {
  const cats = new Set(db.categorias.filter(ehCatResgate).map((c) => c.id));
  const itens = lancsVisiveis(db).filter((l) => l.tipo === 'E' && cats.has(l.cat) && l.data.slice(0, 7) === ym && (!conta || l.meio === conta));
  return { total: itens.reduce((s, l) => s + l.valor, 0), n: itens.length };
}

// Fluxo de caixa de um periodo (meses ini a fim), todas as contas, pago ou nao, como as linhas do Fluxo:
// faturas pelo vencimento, sem transferencias. Resgates saem de entradas e vem a parte.
function fluxoPeriodo(db, ini, fim) {
  const t = { entradas: 0, resgates: 0, saidas: 0 };
  for (const i of linhasFluxo(db, ini, 'fluxo', '', fim)) {
    if (i.sinal < 0) t.saidas += i.valor;
    else if (i.sinal > 0) t[i.lanc && ehCatResgate(db.categorias.find((c) => c.id === i.lanc.cat)) ? 'resgates' : 'entradas'] += i.valor;
  }
  return t;
}

// Parcelamentos: so gastos com parcelas (de > 1), em conta ou cartao; contas fixas ficam de fora.
const parcelasDeGasto = (db) => lancsVisiveis(db).filter((l) => l.tipo === 'S' && l.de > 1);
// Por conta ou cartao, o que ainda vem deste mes em diante: total, quantidade e data da ultima parcela.
function resumoParcelamentos(db, hoje) {
  const grupos = new Map();
  for (const l of parcelasDeGasto(db)) {
    if (l.data.slice(0, 7) < hoje.slice(0, 7)) continue;
    if (!grupos.has(l.meio)) grupos.set(l.meio, { meio: l.meio, total: 0, n: 0, ultima: l.data });
    const g = grupos.get(l.meio);
    g.total += l.valor; g.n += 1;
    if (l.data > g.ultima) g.ultima = l.data;
  }
  return [...grupos.values()].sort((a, b) => b.total - a.total);
}
// Parcelas com data entre ini e fim (AAAA-MM-DD), das contas e cartoes escolhidos (lista vazia: todos).
function parcelasNoPeriodo(db, ini, fim, meios) {
  return parcelasDeGasto(db).filter((l) => l.data >= ini && l.data <= fim && (!meios.length || meios.includes(l.meio)))
    .sort((a, b) => a.data.localeCompare(b.data) || a.desc.localeCompare(b.desc));
}

// Tudo o que falta pagar ate o fim do mes, incluindo o que ficou atrasado de meses anteriores.
function aPagar(db, ym) {
  const itens = pendentes(db, 'S', ym);
  for (const cartao of db.cartoes) {
    if (!ativoEm(cartao, ym)) continue;
    for (const m of mesesEmAberto(db, cartao)) {
      if (m > ym) continue;
      itens.push({
        tipo: 'fatura', id: cartao.id, ym: m, desc: 'Fatura ' + cartao.nome,
        venc: dataNoMes(m, cartao.vencimento), valor: restanteFatura(db, cartao, m),
      });
    }
  }
  return itens.sort((a, b) => a.venc.localeCompare(b.venc));
}

// Faturas com valor ate o mes: cada pagamento e um item pago; o que falta, um item aberto pela conta sugerida.
function faturasAte(db, ym) {
  const itens = [];
  for (const c of db.cartoes) {
    const meses = new Set(todasParcelas(db, c).map((p) => p.ym));
    for (const k of Object.keys(db.faturasPagas)) if (k.startsWith(c.id + '|')) meses.add(k.slice(c.id.length + 1));
    for (const p of db.parciais) if (p.cartao === c.id) meses.add(p.ym);
    for (const m of meses) {
      if (m > ym) continue;
      const paga = db.faturasPagas[chaveFatura(c.id, m)];
      for (const p of parciaisDe(db, c.id, m)) itens.push({ cartao: c, ym: m, paga: true, valor: p.valor, conta: p.conta });
      if (paga || ativoEm(c, ym)) itens.push({ cartao: c, ym: m, paga: !!paga, valor: paga ? paga.valor : restanteFatura(db, c, m), conta: paga ? paga.conta : c.contaPag });
    }
  }
  return itens;
}

function mesesEmAberto(db, cartao) {
  const meses = new Set(todasParcelas(db, cartao).map((p) => p.ym));
  return [...meses].filter((m) => restanteFatura(db, cartao, m) > 0).sort();
}

function statusFatura(db, cartao, ym, hoje) {
  if (db.faturasPagas[chaveFatura(cartao.id, ym)]) return 'Paga';
  if (restanteFatura(db, cartao, ym) > 0 && dataNoMes(ym, cartao.vencimento) < hoje) return 'Em atraso';
  return hoje >= fechamentoFatura(cartao, ym) ? 'Fechada' : 'Em aberto';
}

// Faturas vencidas com algo a pagar, de qualquer mes; vencer hoje ainda nao e atraso.
function faturasAtrasadas(db, hoje) {
  return db.cartoes.filter((c) => ativoEm(c, hoje.slice(0, 7))).flatMap((c) => mesesEmAberto(db, c)
    .map((ym) => ({ cartao: c, ym, venc: dataNoMes(ym, c.vencimento), valor: restanteFatura(db, c, ym) }))
    .filter((f) => f.venc < hoje)).sort((a, b) => a.venc.localeCompare(b.venc));
}

// Limite menos tudo o que falta pagar no cartao, inclusive parcelas futuras. Sem limite cadastrado: null.
function limiteDisponivel(db, cartao) {
  if (!cartao.limite) return null;
  return mesesEmAberto(db, cartao).reduce((s, m) => s - restanteFatura(db, cartao, m), cartao.limite);
}

// A fatura mais antiga ainda em aberto; sem nenhuma, a do ciclo de hoje. Paga, da lugar a do mes seguinte.
function faturaAtual(db, cartao, hoje) {
  const ciclo = mesFatura(hoje, cartao);
  let ym = mesesEmAberto(db, cartao).filter((m) => m <= ciclo)[0] || ciclo;
  while (db.faturasPagas[chaveFatura(cartao.id, ym)]) ym = addMes(ym, 1);
  const venc = dataNoMes(ym, cartao.vencimento), valor = restanteFatura(db, cartao, ym);
  return { ym, venc, valor, atrasada: valor > 0 && venc < hoje };
}

function saudacao(hora) {
  return hora >= 5 && hora < 12 ? 'Bom dia' : hora >= 12 && hora < 18 ? 'Boa tarde' : 'Boa noite';
}

function totalFaturasDoMes(db, ym) {
  return faturasAte(db, ym).filter((f) => f.ym === ym).reduce((s, f) => s + f.valor, 0);
}

// Efeito do lancamento no dinheiro: +1 entra, -1 sai, 0 so muda de conta dentro do que esta sendo visto.
function sinalLanc(l, filtro) {
  if (l.tipo === 'E') return 1;
  if (l.tipo === 'S') return -1;
  if (!filtro) return 0;
  return l.meio === filtro ? -1 : 1;
}

function lancDoFiltro(l, filtro) {
  return !filtro || l.meio === filtro || l.destino === filtro;
}

// Linhas do periodo (um mes, se fim nao vier), da data mais recente para a mais antiga.
// 'fluxo': so o que mexe nas contas; a fatura e uma linha e as compras do cartao ficam dentro dela.
// 'todos': cada lancamento na sua data, com as compras do cartao e sem as faturas.
function linhasFluxo(db, ini, modo, filtro, fim = ini) {
  const dentro = (m) => m >= ini && m <= fim;
  const linhas = lancsVisiveis(db)
    .filter((l) => dentro(l.data.slice(0, 7)) && lancDoFiltro(l, filtro) && (modo === 'todos' || !ehCartao(db, l.meio)))
    // Estorno no cartao tem valor negativo: aparece como entrada, pelo valor positivo.
    .map((l) => ({ lanc: l, data: l.data, desc: l.desc, valor: Math.abs(l.valor), sinal: l.valor < 0 ? -sinalLanc(l, filtro) : sinalLanc(l, filtro), pago: l.pago }));
  if (modo === 'fluxo') {
    for (const f of faturasAte(db, fim)) {
      if (!dentro(f.ym) || !f.valor || (filtro && f.conta !== filtro)) continue;
      linhas.push({ fatura: f, data: dataNoMes(f.ym, f.cartao.vencimento), desc: 'Fatura ' + f.cartao.nome, valor: f.valor, sinal: -1, pago: f.paga });
    }
  }
  return linhas.sort((a, b) => b.data.localeCompare(a.data));
}

// Atrasados: o que o Fluxo pinta de vermelho, em todas as contas e meses: saida nao paga com data antes de hoje, faturas inclusive.
function atrasados(db, hoje) {
  return linhasFluxo(db, '0000-01', 'fluxo', '', hoje.slice(0, 7)).filter((i) => i.sinal < 0 && !i.pago && i.data < hoje);
}

// Fluxo de caixa do periodo, de todas as contas ou de uma. Previsao = saldo inicial + tudo com data ate o
// fim do periodo, pago ou nao, inclusive o que ficou em aberto de meses anteriores.
function fluxoMes(db, ini, hoje, conta, fim = ini) {
  const ym = fim;
  const t = {
    entradas: 0, saidas: 0, prevEntradas: 0, prevSaidas: 0, previsao: 0,
    saldo: conta ? saldosPorConta(db, hoje)[conta] : saldo(db, hoje),
  };
  for (const l of linhasFluxo(db, ini, 'fluxo', conta, fim)) {
    if (l.sinal > 0) { t.prevEntradas += l.valor; if (l.pago) t.entradas += l.valor; }
    if (l.sinal < 0) { t.prevSaidas += l.valor; if (l.pago) t.saidas += l.valor; }
  }
  // Geral: soma de cada conta ativa no fim do periodo; a arquivada sai por inteiro, com o saldo dela.
  if (!conta) {
    t.previsao = db.contasBanco.filter((c) => ativoEm(c, ym)).reduce((s, c) => s + fluxoMes(db, ini, hoje, c.id, fim).previsao, 0);
    return t;
  }
  t.previsao = db.contasBanco.find((c) => c.id === conta).saldoInicial;
  for (const l of lancsVisiveis(db)) {
    if (l.data.slice(0, 7) <= ym && !ehCartao(db, l.meio) && lancDoFiltro(l, conta)) t.previsao += sinalLanc(l, conta) * l.valor;
  }
  for (const f of faturasAte(db, ym)) if (f.conta === conta) t.previsao -= f.valor;
  return t;
}

// Contas fixas: cada ocorrencia e um lancamento comum, ligado a serie.
const PERIODOS = { semanal: { dias: 7 }, quinzenal: { dias: 14 }, mensal: { meses: 1 }, bimestral: { meses: 2 }, trimestral: { meses: 3 }, anual: { meses: 12 } };
const CAMPOS_SERIE = ['tipo', 'desc', 'valor', 'cat', 'meio', 'destino'];

// Calcula sempre a partir do inicio: dia 31 volta a ser 31 depois de um mes menor.
function dataSerie(inicio, per, n) {
  const p = PERIODOS[per];
  if (p.meses) return dataNoMes(addMes(inicio.slice(0, 7), p.meses * n), +inicio.slice(8));
  const [a, m, d] = inicio.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + p.dias * n)).toISOString().slice(0, 10);
}

function camposSerie(dados) {
  return Object.fromEntries(CAMPOS_SERIE.map((k) => [k, dados[k]]));
}

// Cria as ocorrencias que faltam ate o mes. Uma ocorrencia excluida nao volta, porque s.n so avanca.
function completarSeries(db, ym) {
  let mudou = false;
  for (const s of db.series) {
    if (s.encerrada) continue;
    for (let d = dataSerie(s.inicio, s.per, s.n); d.slice(0, 7) <= ym; d = dataSerie(s.inicio, s.per, s.n)) {
      db.lancs.push({ ...s.modelo, id: s.id + '-' + s.n, data: d, pago: ehCartao(db, s.modelo.meio), serie: s.id });
      s.n += 1;
      mudou = true;
    }
  }
  return mudou;
}

// Marcada como paga na criacao, a serie retroativa fica paga ate hoje, sem criar atrasadas.
function criarSerie(db, id, dados, per, hoje) {
  const modelo = camposSerie(dados);
  db.series.push({ id, per, inicio: dados.data, n: 1, modelo, encerrada: false });
  db.lancs.push({ ...modelo, id: id + '-0', data: dados.data, pago: dados.pago, serie: id });
  const horizonte = addMes(hoje.slice(0, 7), 12), mesData = dados.data.slice(0, 7);
  completarSeries(db, mesData > horizonte ? mesData : horizonte);
  if (dados.pago) for (const l of db.lancs) if (l.serie === id && l.data <= hoje) l.pago = true;
}

// Divide o valor total; os centavos que sobram ficam nas primeiras parcelas.
// No cartao mensal, a data recua se um mes curto faria a parcela pular uma fatura.
function gerarParcelas(dados, id, per, total, cartao, hoje) {
  const base = Math.floor(dados.valor / total), resto = dados.valor - base * total;
  const meses = PERIODOS[per].meses;
  return Array.from({ length: total }, (_, i) => {
    let data = dataSerie(dados.data, per, i);
    if (cartao && meses) {
      const esperado = addMes(mesFatura(dados.data, cartao), meses * i);
      while (mesFatura(data, cartao) > esperado) data = new Date(Date.parse(data) - 864e5).toISOString().slice(0, 10);
    }
    return {
      ...camposSerie(dados), id: id + '-' + i, data, valor: base + (i < resto ? 1 : 0), parcela: i + 1, de: total,
      compra: dados.data, pago: !!cartao || (dados.pago && data <= hoje), serie: id,
    };
  });
}

// Serie ja nasce encerrada: tem numero certo de parcelas e nao cria mais nada.
function criarParcelada(db, id, dados, per, total, hoje) {
  const cartao = db.cartoes.find((c) => c.id === dados.meio);
  const parcelas = gerarParcelas(dados, id, per, total, cartao, hoje);
  db.series.push({ id, per, inicio: dados.data, n: total, modelo: camposSerie(parcelas[total - 1]), encerrada: true });
  db.lancs.push(...parcelas);
}

// Data e situacao mudam so no lancamento aberto; os outros campos seguem o escopo.
function aplicarEdicao(db, id, dados, escopo) {
  const l = db.lancs.find((x) => x.id === id);
  if (!l.serie || escopo === 'esta') { Object.assign(l, dados); return; }
  const campos = camposSerie(dados), noCartao = ehCartao(db, dados.meio), desde = l.data;
  // Valor sem mudanca nao se espalha: as parcelas podem diferir em centavos.
  if (dados.valor === l.valor) delete campos.valor;
  for (const o of db.lancs) {
    if (o.serie !== l.serie || o === l || (escopo === 'proximas' && o.data < desde) || faturaPagaDoLanc(db, o)) continue;
    // Compra no cartao fica sempre "paga"; ao sair do cartao, a ocorrencia volta a ficar pendente.
    o.pago = noCartao || (ehCartao(db, o.meio) ? false : o.pago);
    Object.assign(o, campos);
  }
  Object.assign(l, dados);
  const s = db.series.find((x) => x.id === l.serie);
  s.modelo = { ...s.modelo, ...campos };
}

function excluirLanc(db, id, escopo) {
  const l = db.lancs.find((x) => x.id === id);
  if (!l.serie || escopo === 'esta') { db.lancs = db.lancs.filter((x) => x !== l); return; }
  const fica = (x) => x !== l && faturaPagaDoLanc(db, x);
  if (escopo === 'proximas') {
    db.lancs = db.lancs.filter((x) => x.serie !== l.serie || x.data < l.data || fica(x));
    db.series.find((s) => s.id === l.serie).encerrada = true;
  } else {
    db.lancs = db.lancs.filter((x) => x.serie !== l.serie || fica(x));
    if (db.lancs.some((x) => x.serie === l.serie)) db.series.find((s) => s.id === l.serie).encerrada = true;
    else db.series = db.series.filter((s) => s.id !== l.serie);
  }
}

// Ate a 1.5 a lista de categorias era unica. Categoria usada nos dois sentidos ganha uma copia de receita,
// para nenhum lancamento ficar com categoria do tipo errado.
function separarCategorias(d) {
  if (!Array.isArray(d.categorias) || d.categorias.every((c) => c && c.tipo)) return;
  const usos = [...d.lancs, ...d.series.map((s) => s && s.modelo)].filter(Boolean);
  const usada = (id, tipo) => usos.some((u) => u.cat === id && u.tipo === tipo);
  const copias = [];
  d.categorias = d.categorias.map((c) => {
    if (!c || c.tipo) return c;
    if (!usada(c.id, 'E')) return { ...c, tipo: 'S' };
    if (!usada(c.id, 'S')) return { ...c, tipo: 'E' };
    const copia = c.id + '-receita';
    copias.push({ id: copia, nome: c.nome, tipo: 'E' });
    for (const u of usos) if (u.cat === c.id && u.tipo === 'E') u.cat = copia;
    return { ...c, tipo: 'S' };
  });
  d.categorias.push(...copias);
  if (!d.categorias.some((c) => c && c.tipo === 'E')) {
    d.categorias.push({ id: 'receita-salario', nome: 'Salário', tipo: 'E' }, { id: 'receita-outras', nome: 'Outras receitas', tipo: 'E' });
  }
}

// Versao 1.0: contas a pagar ficavam em lista separada e o saldo contava lancamentos ate hoje.
// Na conversao a data de pagamento se perde: a conta paga fica so com a data do vencimento.
// Ate a 1.1 havia uma conta so: ela vira a conta de id 'conta', que os lancamentos ja usam.
function migrar(d, hoje) {
  if (!d || !Array.isArray(d.lancs)) return d;
  if (d.contas !== undefined && !Array.isArray(d.contas)) return d;
  const lancs = d.lancs.map((l) => (l && l.pago === undefined ? { ...l, pago: l.meio !== 'conta' || l.data <= hoje } : l));
  for (const c of d.contas || []) {
    lancs.push({ id: c.id, tipo: 'S', data: c.venc, desc: c.desc, valor: c.valor, cat: c.cat, meio: 'conta', parcelas: 1, pago: !!c.pagoEm });
  }
  const novo = { ...d, lancs };
  delete novo.contas;
  if (!novo.series) novo.series = [];
  if (Array.isArray(novo.series)) {
    // Copias: a conversao altera categorias e nao pode mexer no objeto original se o arquivo for recusado.
    novo.lancs = lancs.map((l) => (l ? { ...l } : l));
    novo.series = novo.series.map((s) => (s && s.modelo ? { ...s, modelo: { ...s.modelo } } : s));
    separarCategorias(novo);
  }
  if (!novo.contasBanco) {
    novo.contasBanco = [{ id: 'conta', nome: 'Conta corrente', tipo: 'corrente', saldoInicial: d.saldoInicial }];
    delete novo.saldoInicial;
    if (Array.isArray(d.cartoes)) novo.cartoes = d.cartoes.map((c) => ({ ...c, contaPag: 'conta' }));
    if (d.faturasPagas && typeof d.faturasPagas === 'object') {
      novo.faturasPagas = Object.fromEntries(Object.entries(d.faturasPagas).map(([k, f]) => [k, { ...f, conta: 'conta' }]));
    }
  }
  if (!novo.parciais) novo.parciais = [];
  // Ate a 1.7 a compra parcelada era um lancamento so, sempre no cartao: cada parcela vira um lancamento.
  if (Array.isArray(novo.cartoes) && Array.isArray(novo.series) && novo.lancs.some((l) => l && l.parcelas > 1)) {
    const lista = [];
    for (const l of novo.lancs) {
      const cartao = l && l.parcelas > 1 && novo.cartoes.find((c) => c.id === l.meio);
      if (!cartao) { lista.push(l); continue; }
      const id = 'p' + l.id;
      const parcelas = gerarParcelas(l, id, 'mensal', l.parcelas, cartao, hoje);
      novo.series.push({ id, per: 'mensal', inicio: l.data, n: l.parcelas, modelo: camposSerie(parcelas[parcelas.length - 1]), encerrada: true });
      lista.push(...parcelas);
    }
    novo.lancs = lista;
  }
  // Ate a 1.46.1 a area USA tinha uma viagem so, com os campos soltos.
  if (novo.usa && typeof novo.usa === 'object' && !novo.usa.viagens) {
    const { viagem, inicio, fim, fundo, ...resto } = novo.usa;
    novo.usa = { ...resto, viagens: viagem ? [{ id: 'v1', nome: viagem, inicio, fim, fundo }] : [] };
  }
  // 1.47: moedas, despesas e, em cada viagem, viajantes, moedas, moeda base e cotacoes.
  if (novo.usa && typeof novo.usa === 'object' && Array.isArray(novo.usa.viagens)) {
    const moedas = novo.usa.moedas || MOEDAS_PADRAO.map((m) => ({ ...m }));
    novo.usa = { ...novo.usa, moedas, despesas: novo.usa.despesas || [], itinerario: novo.usa.itinerario || [],
      viagens: novo.usa.viagens.map((v) => (!v || v.moedas ? v : { ...v, moedas: ['USD'], base: 'USD', viajantes: v.viajantes || [], cot: v.cot || {} })) };
  }
  return novo;
}

// Logo baixado vira texto gravado nos dados. Recusa arquivo grande ou com conteudo executavel;
// mesmo assim o app so o mostra como imagem, onde navegadores nao rodam scripts.
const MAX_ICONE = 100 * 1024;
function svgParaIcone(texto) {
  if (texto.length > MAX_ICONE || !/<svg[\s>]/i.test(texto) || /<script|<foreignObject|\son\w+\s*=|javascript:/i.test(texto)) return null;
  let bin = '';
  for (const b of new TextEncoder().encode(texto)) bin += String.fromCharCode(b);
  return 'data:image/svg+xml;base64,' + btoa(bin);
}

function iconeValido(v) {
  return v === undefined || (typeof v === 'string' && v.length <= MAX_ICONE * 2 && /^data:image\/svg\+xml;base64,[A-Za-z0-9+/]+=*$/.test(v));
}

// Senha do app: guarda so o resultado do PBKDF2, nunca a senha. E trava de tela: os dados nao ficam cifrados.
const b64 = (u8) => { let s = ''; for (const b of u8) s += String.fromCharCode(b); return btoa(s); };
const deB64 = (s) => Uint8Array.from(atob(s), (x) => x.charCodeAt(0));
const aleatorio = (n) => crypto.getRandomValues(new Uint8Array(n));
async function hashSenha(senha, sal) {
  const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: deB64(sal), iterations: 150000 }, chave, 256);
  return b64(new Uint8Array(bits));
}
async function protegerSenha(senha) { const sal = b64(aleatorio(16)); return { sal, hash: await hashSenha(senha, sal) }; }
async function confereSenha(senha, g) { return !!g && await hashSenha(senha, g.sal) === g.hash; }
// Backup cifrado: AES-GCM com chave derivada da senha. A senha nao fica guardada; sem ela o arquivo nao abre.
const FORMATO_CIFRADO = 'controle-diario-cifrado', ITERACOES_BACKUP = 600000;
async function chaveBackup(senha, sal, iteracoes) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: iteracoes }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function cifrarBackup(dados, senha) {
  const sal = aleatorio(16), iv = aleatorio(12);
  const chave = await chaveBackup(senha, sal, ITERACOES_BACKUP);
  const cifrado = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, chave, new TextEncoder().encode(JSON.stringify(dados)));
  return { formato: FORMATO_CIFRADO, versao: 1, iteracoes: ITERACOES_BACKUP, sal: b64(sal), iv: b64(iv), dados: b64(new Uint8Array(cifrado)) };
}
// Com senha no app: a chave vem do hash ja guardado, entao salvar nao pede senha; restaurar pede a senha do app.
async function chaveDoHash(hash) {
  const base = await crypto.subtle.importKey('raw', deB64(hash), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode('controle-diario-backup') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function cifrarBackupSenhaApp(dados, g) {
  const iv = aleatorio(12), chave = await chaveDoHash(g.hash);
  const cifrado = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, chave, new TextEncoder().encode(JSON.stringify(dados)));
  return { formato: FORMATO_CIFRADO, versao: 2, sal: g.sal, iv: b64(iv), dados: b64(new Uint8Array(cifrado)) };
}
// Sincronizacao: o mesmo formato do backup versao 1, com um sal fixo por conta, para a chave ser tirada da senha
// uma vez so em cada aparelho. O arquivo de dados tambem abre pelo Restaurar comum, com a senha do app.
async function chaveSync(senha, sal) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveBits']);
  return b64(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: deB64(sal), iterations: ITERACOES_BACKUP }, base, 256)));
}
const chaveAes = (bruta) => crypto.subtle.importKey('raw', deB64(bruta), 'AES-GCM', false, ['encrypt', 'decrypt']);
async function cifrarComChave(dados, bruta, sal) {
  const iv = aleatorio(12);
  const cifrado = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await chaveAes(bruta), new TextEncoder().encode(JSON.stringify(dados)));
  return { formato: FORMATO_CIFRADO, versao: 1, iteracoes: ITERACOES_BACKUP, sal, iv: b64(iv), dados: b64(new Uint8Array(cifrado)) };
}
async function decifrarComChave(o, bruta) {
  if (!ehBackupCifrado(o) || o.versao !== 1 || o.iteracoes !== ITERACOES_BACKUP) throw new Error('formato');
  const claro = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deB64(o.iv) }, await chaveAes(bruta), deB64(o.dados));
  return JSON.parse(new TextDecoder().decode(claro));
}
const novoSal = () => b64(aleatorio(16));
const ehBackupCifrado = (o) => !!o && o.formato === FORMATO_CIFRADO;
const usaSenhaDoApp = (o) => o.versao === 2;
// Senha errada ou arquivo alterado: o AES-GCM recusa e a promessa falha.
async function decifrarBackup(o, senha) {
  if (!usaSenhaDoApp(o) && (o.versao !== 1 || !Number.isInteger(o.iteracoes) || o.iteracoes < 100000 || o.iteracoes > 5000000)) throw new Error('formato');
  const chave = usaSenhaDoApp(o) ? await chaveDoHash(await hashSenha(senha, o.sal)) : await chaveBackup(senha, deB64(o.sal), o.iteracoes);
  const claro = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deB64(o.iv) }, chave, deB64(o.dados));
  return JSON.parse(new TextDecoder().decode(claro));
}
// Arquivo versao 2 salvo com uma senha guardada no aparelho (do app ou do backup): o mesmo sal da o mesmo hash, entao
// abre com o hash guardado, sem digitar. Sal diferente (senha trocada depois), outra versao ou falha: null.
async function decifrarComHash(o, g) {
  if (!g || !ehBackupCifrado(o) || !usaSenhaDoApp(o) || o.sal !== g.sal) return null;
  try {
    const claro = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deB64(o.iv) }, await chaveDoHash(g.hash), deB64(o.dados));
    return JSON.parse(new TextDecoder().decode(claro));
  } catch { return null; }
}
// 12 letras e numeros, sem os que se confundem (0/O, 1/I/L). Ex.: 7K3P-9QXM-2B4T
const LETRAS_CODIGO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const gerarCodigo = () => [...aleatorio(12)].map((x) => LETRAS_CODIGO[x % LETRAS_CODIGO.length]).join('').replace(/(.{4})(?!$)/g, '$1-');
const limpaCodigo = (t) => t.toUpperCase().replace(/[^A-Z0-9]/g, '');

function perfilValido(p) {
  if (p === undefined) return true;
  const texto = (v) => v === undefined || (typeof v === 'string' && v.length <= 200);
  return !!p && typeof p === 'object' && texto(p.nome) && texto(p.email)
    && (p.nasc === undefined || /^\d{4}-\d{2}-\d{2}$/.test(p.nasc))
    && (p.foto === undefined || (typeof p.foto === 'string' && p.foto.length <= 200000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(p.foto)));
}

// Area USA: moedas que ja vem cadastradas. O id e o codigo, para conversoes acharem a mesma moeda.
const MOEDAS_PADRAO = [['BRL', 'Real Brasileiro', 'R$'], ['USD', 'Dólar Americano', 'US$'], ['EUR', 'Euro', '€'], ['GBP', 'Libra Esterlina', '£'],
  ['JPY', 'Iene Japonês', '¥'], ['CNY', 'Yuan Chinês', 'CN¥'], ['CAD', 'Dólar Canadense', 'C$'], ['AUD', 'Dólar Australiano', 'A$'], ['CHF', 'Franco Suíço', 'CHF'],
  ['ARS', 'Peso Argentino', 'AR$'], ['MXN', 'Peso Mexicano', 'MX$'], ['CLP', 'Peso Chileno', 'CL$'], ['HKD', 'Dólar de Hong Kong', 'HK$'],
  ['SGD', 'Dólar de Singapura', 'S$'], ['KRW', 'Won Sul-Coreano', '₩']].map(([codigo, nome, simbolo]) => ({ id: codigo, codigo, nome, simbolo }));
// Total da viagem por moeda, sem conversao (pedido do usuario): a base sempre aparece e vem primeiro.
// natureza: 'C' (corporativa) ou 'P' (pessoal) so soma aquele tipo; sem ela, soma tudo.
// Despesa sem natureza, numa viagem corporativa, conta como corporativa.
const naturezaDesp = (d) => d.natureza || 'C';
function totaisViagem(u, v, natureza) {
  const t = new Map([[v.base, 0]]);
  for (const d of u.despesas) if (d.viagem === v.id && (!natureza || naturezaDesp(d) === natureza)) t.set(d.moeda, (t.get(d.moeda) || 0) + d.valor);
  return [...t].map(([moeda, valor]) => ({ moeda, valor }));
}

// Por categoria, separado por moeda como o total da viagem; o total de cada moeda bate com totaisViagem.
// Com natureza ('C' ou 'P'), so as despesas corporativas ou pessoais.
function categoriasViagem(u, v, natureza) {
  return totaisViagem(u, v, natureza).filter((t) => t.valor).map((t) => {
    // Por categoria: valor somado e quantidade de despesas.
    const cats = new Map();
    for (const d of u.despesas) if (d.viagem === v.id && d.moeda === t.moeda && (!natureza || naturezaDesp(d) === natureza)) { const k = cats.get(d.cat) || { valor: 0, qtd: 0 }; k.valor += d.valor; k.qtd++; cats.set(d.cat, k); }
    const lista = [...cats].map(([cat, k]) => ({ cat, valor: k.valor, qtd: k.qtd, pct: k.valor / t.valor * 100 })).sort((a, b) => b.valor - a.valor);
    return { moeda: t.moeda, total: t.valor, lista };
  });
}

// Soma de varias viagens, ainda separada por moeda.
function totaisViagens(u, viagens) {
  const t = new Map();
  for (const v of viagens) for (const x of totaisViagem(u, v)) t.set(x.moeda, (t.get(x.moeda) || 0) + x.valor);
  return [...t].map(([moeda, valor]) => ({ moeda, valor }));
}
// Distancia entre duas datas (AAAA-MM-DD) em anos e dias: conta os anos inteiros no calendario e o resto em dias.
// Ex.: 2026-11-07 a 2027-11-12 = 1 ano e 5 dias. 'de' precisa ser antes ou igual a 'ate'.
function anosEDias(de, ate) {
  const d = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  let anos = 0;
  while (d(`${+de.slice(0, 4) + anos + 1}${de.slice(4)}`) <= d(ate)) anos++;
  const base = d(`${+de.slice(0, 4) + anos}${de.slice(4)}`);
  return { anos, dias: Math.round((d(ate) - base) / 864e5) };
}
const textoAnosDias = ({ anos, dias }) => [anos ? `${anos} ${anos > 1 ? 'anos' : 'ano'}` : '', dias || !anos ? `${dias} ${dias === 1 ? 'dia' : 'dias'}` : ''].filter(Boolean).join(' e ');
// Contador da viagem: quanto falta para comecar, ou ha quanto tempo terminou.
function contadorViagem(v, hoje, finalizada) {
  if (finalizada) {
    if (!v.fim) return '';
    const t = anosEDias(v.fim, hoje);
    return `Há: ${textoAnosDias(t)}`;
  }
  if (!v.inicio) return '';
  if (v.inicio === hoje) return 'Começa hoje';
  if (v.inicio < hoje) return 'Em andamento';
  const t = anosEDias(hoje, v.inicio);
  return `${!t.anos && t.dias === 1 ? 'Falta' : 'Faltam'}: ${textoAnosDias(t)}`;
}
// Viagem finalizada: a partir do dia seguinte ao fim. Sem data de fim, fica em aberto.
const viagemFinalizada = (v, hoje) => !!v.fim && v.fim < hoje;
// Filtro da aba USA: viagens escolhidas (nenhuma = todas) e data de inicio entre ini e fim.
const filtrarViagens = (viagens, f) => viagens.filter((v) => (!f.ids.length || f.ids.includes(v.id))
  && (!f.ini || (v.inicio && v.inicio >= f.ini)) && (!f.fim || (v.inicio && v.inicio <= f.fim)));

// Compara dados antigos (um backup) com os atuais, pelos itens com id: quantos faltam nos atuais e quantos
// existem nos dois com conteudo diferente. Serve para saber se descartar um backup perde alguma coisa.
const LISTAS_COMPARADAS = [['lancs'], ['series'], ['contasBanco'], ['cartoes'], ['categorias'], ['usa', 'viagens'], ['usa', 'despesas'], ['usa', 'itinerario'], ['usa', 'contas'], ['usa', 'cartoes'], ['usa', 'viajantes'], ['usa', 'categorias']];
function compararDados(antigo, atual) {
  const lista = (d, cam) => cam.reduce((o, k) => (o ? o[k] : undefined), d) || [];
  let faltam = 0, diferentes = 0;
  for (const cam of LISTAS_COMPARADAS) {
    const agora = new Map(lista(atual, cam).map((x) => [x.id, JSON.stringify(x)]));
    for (const x of lista(antigo, cam)) {
      if (!agora.has(x.id)) faltam++;
      else if (agora.get(x.id) !== JSON.stringify(x)) diferentes++;
    }
  }
  return { faltam, diferentes };
}

// Recibos da despesa da viagem: o PDF fica no Google Drive (arq = id do arquivo) e, ate subir, so no aparelho
// onde foi escaneado. id local, data em que foi feito, paginas e nome do arquivo no Drive.
const recibosValidos = (l) => l === undefined || (Array.isArray(l) && l.length <= 20 && new Set(l.map((r) => r && r.id)).size === l.length
  && l.every((r) => r && typeof r.id === 'string' && r.id.length >= 1 && r.id.length <= 40 && typeof r.em === 'string' && r.em.length <= 40 && !Number.isNaN(Date.parse(r.em))
    && (r.arq === undefined || (typeof r.arq === 'string' && /^[\w-]{10,200}$/.test(r.arq)))
    && (r.nome === undefined || (typeof r.nome === 'string' && r.nome.length <= 200))
    && (r.pag === undefined || (Number.isInteger(r.pag) && r.pag >= 1 && r.pag <= 50))
    // Recibo compartilhado: o mesmo arquivo (mesmo id) em varias despesas da viagem.
    && (r.comp === undefined || r.comp === true)));
// Nome do PDF no Drive: data, descricao e valor, sem caracteres que o Drive ou o Windows recusam. n > 0 numera.
function nomeRecibo(d, simbolo, n) {
  const valor = (d.valor / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const base = `${d.data} ${d.desc} ${simbolo} ${valor}`.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return `${base}${n ? ` (${n})` : ''}.pdf`;
}
// Recorte do recibo: homografia que leva os 4 pontos de "de" aos 4 de "para" (ordem: cima-esq, cima-dir, baixo-dir, baixo-esq).
function homografia(de, para) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = de[i], [u, v] = para[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    if (Math.abs(A[c][c]) < 1e-12) throw new Error('cantos alinhados');
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  return [...b.map((x, i) => x / A[i][i]), 1];
}
const aplicarH = (h, x, y) => { const w = h[6] * x + h[7] * y + h[8]; return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w]; };
// Realce de documento: estima o tom do papel em cada regiao (blocos, o mais claro de cada um, suavizado) e
// divide a imagem por ele. Sombra e luz desigual somem, o papel fica branco e o texto escuro, sem escurecer o resto.
// lum: Float32Array com o brilho (0 a 255) de cada ponto; devolve Uint8ClampedArray em tons de cinza.
// preto/branco: abaixo de preto vira preto; acima de branco vira branco. 0,86 apaga o verso que aparece no papel
// termico sem sumir com a impressao fraca (0,80 apagava linhas claras; 0,92 deixava o verso aparecer).
function realceDocumento(lum, W, H, preto = 0.45, branco = 0.86) {
  const c = Math.max(8, Math.round(Math.max(W, H) / 48)), gw = Math.ceil(W / c), gh = Math.ceil(H / c), grade = new Float32Array(gw * gh), hist = new Uint32Array(64);
  for (let by = 0; by < gh; by++) {
    for (let bx = 0; bx < gw; bx++) {
      hist.fill(0);
      let n = 0;
      for (let y = by * c; y < Math.min(H, by * c + c); y++) for (let x = bx * c; x < Math.min(W, bx * c + c); x++) { hist[Math.min(63, lum[y * W + x] >> 2)]++; n++; }
      // Tom do papel no bloco: o ponto em que ficam 10% dos pontos mais claros.
      let s = 0, i = 63;
      for (; i > 0; i--) { s += hist[i]; if (s >= n * 0.1) break; }
      grade[by * gw + bx] = i * 4 + 2;
    }
  }
  // Suaviza a grade duas vezes, para nao aparecer o desenho dos blocos.
  for (let vez = 0; vez < 2; vez++) {
    const g2 = new Float32Array(grade.length);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < gh && xx >= 0 && xx < gw) { s += grade[yy * gw + xx]; n++; } }
      g2[y * gw + x] = s / n;
    }
    grade.set(g2);
  }
  const out = new Uint8ClampedArray(W * H);
  for (let y = 0; y < H; y++) {
    const gy = Math.max(0, Math.min(gh - 1, (y + 0.5) / c - 0.5)), y0 = Math.min(gh - 2, Math.floor(gy)), ay = gh > 1 ? gy - Math.max(0, y0) : 0, ya = Math.max(0, y0), yb = Math.min(gh - 1, ya + 1);
    for (let x = 0; x < W; x++) {
      const gx = Math.max(0, Math.min(gw - 1, (x + 0.5) / c - 0.5)), x0 = Math.min(gw - 2, Math.floor(gx)), ax = gw > 1 ? gx - Math.max(0, x0) : 0, xa = Math.max(0, x0), xb = Math.min(gw - 1, xa + 1);
      const fundo = (grade[ya * gw + xa] * (1 - ax) + grade[ya * gw + xb] * ax) * (1 - ay) + (grade[yb * gw + xa] * (1 - ax) + grade[yb * gw + xb] * ax) * ay;
      const v = lum[y * W + x] / Math.max(fundo, 24);
      // Papel e o verso aparecendo (acima de 86% do papel) viram branco; texto escuro; a borda da letra fica cinza, sem engrossar.
      out[y * W + x] = 255 * Math.max(0, Math.min(1, (v - preto) / (branco - preto)));
    }
  }
  return out;
}

// PDF simples, uma pagina por imagem JPEG (largura A4, altura na proporcao da foto). paginas: [{ jpeg: Uint8Array, w, h }].
function montarPdf(paginas) {
  const enc = new TextEncoder(), partes = [], offs = [];
  let tam = 0;
  const add = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; partes.push(b); tam += b.length; };
  const obj = (n, corpo) => { offs[n] = tam; add(`${n} 0 obj\n`); corpo(); add('\nendobj\n'); };
  add('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n');
  obj(1, () => add('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => add(`<< /Type /Pages /Kids [${paginas.map((_, i) => `${3 + 3 * i} 0 R`).join(' ')}] /Count ${paginas.length} >>`));
  paginas.forEach((p, i) => {
    const W = 595, H = Math.round(595 * p.h / p.w * 100) / 100, cont = `q ${W} 0 0 ${H} 0 0 cm /Im${i} Do Q`;
    obj(3 + 3 * i, () => add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im${i} ${5 + 3 * i} 0 R >> >> /Contents ${4 + 3 * i} 0 R >>`));
    obj(4 + 3 * i, () => add(`<< /Length ${cont.length} >>\nstream\n${cont}\nendstream`));
    obj(5 + 3 * i, () => { add(`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`); add(p.jpeg); add('\nendstream'); });
  });
  const xref = tam, total = 3 + 3 * paginas.length;
  add(`xref\n0 ${total}\n0000000000 65535 f \n${offs.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`);
  add(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(tam);
  let pos = 0;
  for (const b of partes) { out.set(b, pos); pos += b.length; }
  return out;
}

// Local da despesa da viagem, escolhido na busca do Google: nome, endereco completo, coordenadas e id do lugar.
const localValido = (l) => l === undefined || (!!l && typeof l === 'object' && typeof l.nome === 'string' && l.nome.length >= 1 && l.nome.length <= 200
  && typeof l.endereco === 'string' && l.endereco.length <= 400 && typeof l.lat === 'number' && l.lat >= -90 && l.lat <= 90
  && typeof l.lng === 'number' && l.lng >= -180 && l.lng <= 180 && (l.id === undefined || (typeof l.id === 'string' && /^[\w-]{1,300}$/.test(l.id))));
// Chave do Google Maps (busca de enderecos e mapa), gravada pela pessoa em Ajustes.
const ehChaveMaps = (v) => typeof v === 'string' && /^AIza[\w-]{20,80}$/.test(v);

// Itinerario da viagem: itens por tipo, com data e hora (e fuso) de inicio e de fim, local, codigo do localizador e Obs.
// Aereo: companhia, voo, assento, origem e destino. Item vindo de uma despesa guarda o id dela (e, no aereo, ida ou volta).
const TIPOS_ITIN = ['aereo', 'hotel', 'evento', 'carro', 'transporte', 'restaurante', 'nota'];
// AeroDataBox (RapidAPI): chave da pessoa, gravada em db.google.aeroKey (vai no backup, nunca no codigo).
const ehChaveAero = (v) => typeof v === 'string' && /^[A-Za-z0-9]{30,80}$/.test(v);
// "-03:00" -> "GMT-3", "+05:30" -> "GMT+5:30", "Z" ou "+00:00" -> "GMT"; sem fuso -> ''.
function fusoDeOffset(o) {
  if (!o) return '';
  if (o === 'Z') return 'GMT';
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(o);
  if (!m) return '';
  const h = Number(m[2]);
  return h === 0 && m[3] === '00' ? 'GMT' : `GMT${m[1]}${h}${m[3] !== '00' ? ':' + m[3] : ''}`;
}
// Horario local do AeroDataBox, ex.: "2026-11-13 22:40-03:00" -> { data, hora, fuso }; formato estranho -> null.
function horaLocalVoo(t) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T]([01]\d|2[0-3]):([0-5]\d)(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(typeof t === 'string' ? t.trim() : '');
  return m ? { data: m[1], hora: `${m[2]}:${m[3]}`, fuso: fusoDeOffset(m[4]) } : null;
}
const SITUACAO_VOO = { Expected: 'Previsto', CheckIn: 'Check-in aberto', Boarding: 'Embarque', GateClosed: 'Portão fechado', Departed: 'Partiu', EnRoute: 'Em voo',
  Delayed: 'Atrasado', Approaching: 'Pousando', Arrived: 'Chegou', Canceled: 'Cancelado', CanceledUncertain: 'Talvez cancelado', Diverted: 'Desviado' };
// Resposta de /flights/number/{voo}/{data} -> campos do item aereo do itinerario, um por voo (sem repetir o mesmo trecho e horario).
function dadosDoVoo(lista) {
  const ap = (a) => String((a && (a.iata || a.icao || a.shortName || a.name)) || '').slice(0, 80);
  const nomeAp = (a) => String((a && (a.municipalityName || a.shortName || a.name)) || '');
  // Nome do aeroporto (ex.: "New York John F Kennedy"), para o campo Aeroporto do item.
  const nomeAero = (a) => String((a && (a.name || a.shortName)) || '').slice(0, 80);
  const tempo = (m) => horaLocalVoo(m.scheduledTime && m.scheduledTime.local) || horaLocalVoo(m.revisedTime && m.revisedTime.local) || {};
  const vistos = new Set();
  return (Array.isArray(lista) ? lista : []).filter((f) => f && f.departure && f.arrival).map((f) => {
    const p = tempo(f.departure), c = tempo(f.arrival);
    return { cia: String((f.airline && f.airline.name) || '').slice(0, 60), voo: String(f.number || '').slice(0, 12), origem: ap(f.departure.airport), destino: ap(f.arrival.airport),
      origemNome: nomeAp(f.departure.airport), destinoNome: nomeAp(f.arrival.airport), aeroOrigem: nomeAero(f.departure.airport), aeroDestino: nomeAero(f.arrival.airport), data: p.data, hora: p.hora, fuso: p.fuso, fim: c.data, horaFim: c.hora, fusoFim: c.fuso,
      situacao: SITUACAO_VOO[f.status] || '' };
  }).filter((v) => {
    const k = [v.origem, v.destino, v.data, v.hora].join('|');
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}
// Offset em minutos de um fuso IANA (ex.: America/New_York) num instante; fuso desconhecido -> null.
function offsetFuso(tz, ms) {
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(new Date(ms)).find((x) => x.type === 'timeZoneName').value;
    const m = /GMT(?:([+-])(\d{1,2}):?(\d{2})?)?/.exec(p);
    return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2] || 0) * 60 + Number(m[3] || 0)) : null;
  } catch { return null; }
}
const fusoDeMin = (min) => fusoDeOffset(`${min < 0 ? '-' : '+'}${String(Math.floor(Math.abs(min) / 60)).padStart(2, '0')}:${String(Math.abs(min) % 60).padStart(2, '0')}`);
// Resposta do voo mais proximo (/flights/number/{voo}, sem data) -> o "modelo" de cada trecho: o que dadosDoVoo da, mais
// os fusos IANA dos aeroportos, o offset de cada ponta e a duracao, para levar o voo para outra data (vooNaData).
function modelosDoVoo(lista) {
  const tempo = (m) => (m.scheduledTime && m.scheduledTime.local ? m.scheduledTime : m.revisedTime) || {};
  const ms = (t) => (t.utc ? Date.parse(t.utc.trim().replace(' ', 'T')) : NaN);
  const off = (t) => { const m = /([+-])(\d{2}):?(\d{2})$/.exec(t.local || ''); return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0; };
  const out = [];
  for (const f of Array.isArray(lista) ? lista : []) {
    const v = dadosDoVoo([f])[0];
    if (!v || !v.hora || out.some((o) => o.origem === v.origem && o.destino === v.destino)) continue;
    const p = tempo(f.departure), c = tempo(f.arrival), dur = (ms(c) - ms(p)) / 60000;
    out.push({ ...v, tzOrigem: String((f.departure.airport && f.departure.airport.timeZone) || ''), tzDestino: String((f.arrival.airport && f.arrival.airport.timeZone) || ''),
      offOrigem: off(p), offDestino: off(c), duracao: dur > 0 && dur < 2400 ? dur : null });
  }
  return out;
}
// O voo do modelo na data escolhida: mesma hora local de partida; fuso pela regra do aeroporto naquela data (horario de
// verao); chegada pela duracao, na hora local do destino. Sem fuso IANA, usa os offsets do voo de referencia.
function vooNaData(m, data) {
  if (!m || !m.hora || !/^\d{4}-\d{2}-\d{2}$/.test(data)) return null;
  const [h, mi] = m.hora.split(':').map(Number), local = Date.parse(data + 'T00:00Z') + (h * 60 + mi) * 60000;
  const offP = (ms) => { const o = m.tzOrigem ? offsetFuso(m.tzOrigem, ms) : null; return o === null ? m.offOrigem : o; };
  const o1 = offP(local - offP(local) * 60000), partida = local - o1 * 60000;
  const r = { data, hora: m.hora, fuso: fusoDeMin(o1) };
  if (m.duracao === null || m.duracao === undefined) return r;
  const chegada = partida + m.duracao * 60000, oc0 = m.tzDestino ? offsetFuso(m.tzDestino, chegada) : null, oc = oc0 === null ? m.offDestino : oc0;
  const iso = new Date(chegada + oc * 60000).toISOString();
  return { ...r, fim: iso.slice(0, 10), horaFim: iso.slice(11, 16), fusoFim: fusoDeMin(oc) };
}
// Localizador e assento por passageiro (viajante da viagem) no item aereo: { quem, loc, assento }, ao menos um dos dois.
const paxValido = (x, u) => x === undefined || (Array.isArray(x) && x.length >= 1 && x.length <= 30 && new Set(x.map((p) => p && p.quem)).size === x.length
  && x.every((p) => p && u.viajantes.some((v) => v.id === p.quem) && (p.loc || p.assento)
    && (p.loc === undefined || (typeof p.loc === 'string' && p.loc.length <= 40)) && (p.assento === undefined || (typeof p.assento === 'string' && p.assento.length <= 12))));
function itemItinValido(x, u) {
  const txt = (v, max) => v === undefined || (typeof v === 'string' && v.length <= max);
  const dataOk = (v) => v === undefined || /^\d{4}-\d{2}-\d{2}$/.test(v), horaOk = (v) => v === undefined || /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
  return !!x && typeof x.id === 'string' && x.id.length >= 1 && x.id.length <= 80 && u.viagens.some((v) => v.id === x.viagem) && TIPOS_ITIN.includes(x.tipo)
    && typeof x.titulo === 'string' && x.titulo.length >= 1 && x.titulo.length <= 120 && /^\d{4}-\d{2}-\d{2}$/.test(x.data) && dataOk(x.fim) && !(x.fim && x.fim < x.data)
    && horaOk(x.hora) && horaOk(x.horaFim) && txt(x.fuso, 12) && txt(x.fusoFim, 12) && txt(x.localizador, 40) && txt(x.obs, 500)
    && txt(x.cia, 60) && txt(x.voo, 12) && txt(x.assento, 12) && txt(x.origem, 80) && txt(x.destino, 80) && txt(x.aeroOrigem, 80) && txt(x.aeroDestino, 80) && txt(x.localFim, 200)
    && localValido(x.local) && localValido(x.localDev) && txt(x.despesa, 60) && (x.lado === undefined || x.lado === 'ida' || x.lado === 'volta')
    && (x.cat === undefined || u.categorias.some((c) => c.id === x.cat)) && paxValido(x.pax, u)
    // Ida e volta: dois itens aereos ligados (par = id do outro); encerra = o traco da linha do tempo termina nele.
    && (x.par === undefined || (typeof x.par === 'string' && x.par.length >= 1 && x.par.length <= 80 && x.par !== x.id)) && (x.encerra === undefined || x.encerra === true);
}
// Categoria de despesa que vira item do itinerario: hotel, aereo ou carro (pelo nome, sem acento, ou pelo icone).
function tipoDaCategoriaViagem(c) {
  if (!c) return null;
  const n = c.nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/hotel|hoteis|hosped/.test(n) || c.simbolo === 'hotel') return 'hotel';
  if (/aereo|aviao|voo|passagem/.test(n) || c.simbolo === 'aviao') return 'aereo';
  if (/carro|aluguel/.test(n) || c.simbolo === 'carro') return 'carro';
  return null;
}
// Forma do item do itinerario pela categoria de Ajustes Travel: aereo, hotel e carro como nas despesas; trem, onibus,
// metro, taxi, Uber ou transfer viram transporte (origem e destino); as outras, um item comum (titulo, local, inicio e fim).
function formaDaCategoria(c) {
  const t = tipoDaCategoriaViagem(c);
  if (t || !c) return t || 'evento';
  const n = c.nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return /trem|onibus|metro|taxi|uber|lyft|transfer|transporte|translado/.test(n) || ['onibus', 'trem', 'metro', 'taxi'].includes(c.simbolo) ? 'transporte' : 'evento';
}
// Categoria de despesa que pode virar item do itinerario: hotel, aereo, carro, transporte e passeios (parques, shows,
// ingressos, tours, museus...). Compras, alimentacao, gorjetas, cambio e afins ficam de fora.
function categoriaDeItinerario(c) {
  if (!c) return false;
  const n = c.nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/aliment|comida|refeic|restaur|lanche|supermerc|mercado|compra|outlet|gasolina|combust|estacion|gorjeta|cambio|seguro|outros/.test(n)) return false;
  if (tipoDaCategoriaViagem(c) || formaDaCategoria(c) === 'transporte') return true;
  return /parque|show|ingresso|ticket|passeio|tour|museu|evento|teatro|jogo|excurs|atrac|espetac|concert|cruzeiro|disney|universal|cinema|balada|festa/.test(n)
    || ['castelo', 'roda', 'lazer', 'navio'].includes(c.simbolo);
}
// Despesa que trava o item: hotel, aereo ou carro com check-in; as datas (e o local) do item seguem a despesa.
const despesaComCheckin = (u, d) => !!(d && d.checkin && tipoDaCategoriaViagem(u.categorias.find((c) => c.id === d.cat)));
// Despesas da viagem que podem virar item e ainda nao viraram, ja com o que preenchem no item. Aereo com check-in da
// duas opcoes (ida no check-in, volta no check-out). Sem check-in, a data e a da compra se cair na viagem, senao o inicio.
function despesasParaItin(u, vid) {
  const v = u.viagens.find((x) => x.id === vid) || {};
  const usadas = new Set((u.itinerario || []).filter((x) => x.viagem === vid && x.despesa).map((x) => x.despesa + '|' + (x.lado || '')));
  const ops = [];
  for (const d of u.despesas) {
    const c = u.categorias.find((x) => x.id === d.cat);
    if (d.viagem !== vid || !categoriaDeItinerario(c)) continue;
    const forma = formaDaCategoria(c), naViagem = (!v.inicio || d.data >= v.inicio) && (!v.fim || d.data <= v.fim);
    const base = { despesa: d.id, cat: d.cat, forma, titulo: ((forma === 'hotel' && d.local ? d.local.nome : d.desc) || c.nome).slice(0, 120), local: d.local || undefined };
    if (forma === 'aereo' && d.checkin) {
      ops.push({ ...base, lado: 'ida', data: d.checkin, local: undefined });
      if (d.checkout && d.checkout !== d.checkin) ops.push({ ...base, lado: 'volta', data: d.checkout, local: undefined });
    } else ops.push({ ...base, data: d.checkin || (naViagem || !v.inicio ? d.data : v.inicio), fim: (d.checkin && d.checkout) || undefined });
  }
  return ops.filter((o) => !usadas.has(o.despesa + '|' + (o.lado || '')));
}
// Itens que vieram de despesas: hotel, aereo e carro com check-in seguem as datas (e o local) da despesa; despesa
// excluida tira o item. Nada entra sozinho: a pessoa escolhe ao incluir (despesasParaItin). Devolve se mudou algo.
function sincronizarItinDespesas(u, vid) {
  if (!Array.isArray(u.itinerario)) u.itinerario = [];
  const antes = u.itinerario.length;
  u.itinerario = u.itinerario.filter((x) => !x.despesa || x.viagem !== vid || u.despesas.some((d) => d.id === x.despesa));
  let mudou = u.itinerario.length !== antes;
  for (const x of u.itinerario) {
    if (!x.despesa || x.viagem !== vid) continue;
    const d = u.despesas.find((i) => i.id === x.despesa);
    if (!despesaComCheckin(u, d)) continue;
    const tipo = tipoDaCategoriaViagem(u.categorias.find((c) => c.id === d.cat));
    const m = tipo === 'aereo' ? { tipo, cat: d.cat, data: x.lado === 'volta' ? d.checkout || d.checkin : d.checkin }
      : { tipo, cat: d.cat, data: d.checkin, fim: d.checkout || undefined, ...(d.local ? { local: d.local } : {}) };
    for (const [c, val] of Object.entries(m)) {
      if (JSON.stringify(x[c]) === JSON.stringify(val)) continue;
      if (val === undefined) delete x[c]; else x[c] = val;
      mudou = true;
    }
  }
  return mudou;
}
// Linha do tempo: cada item no dia de inicio e, se terminar em outro dia (hotel, carro, evento), tambem no dia do fim.
// Dentro do dia, o que nao tem hora vem primeiro, depois por hora.
function diasItinerario(u, vid) {
  const ent = [];
  for (const x of u.itinerario || []) {
    if (x.viagem !== vid) continue;
    ent.push({ data: x.data, hora: x.hora || '', papel: 'inicio', item: x });
    // Carro tambem mostra a devolucao no mesmo dia (com fim igual ao inicio ou so com a hora da devolucao).
    const ate = x.fim || (x.tipo === 'carro' && x.horaFim ? x.data : '');
    if (ate && (ate !== x.data || x.tipo === 'carro') && !['aereo', 'transporte'].includes(x.tipo)) ent.push({ data: ate, hora: x.horaFim || '', papel: 'fim', item: x });
  }
  ent.sort((a, b) => a.data.localeCompare(b.data) || a.hora.localeCompare(b.hora) || a.item.titulo.localeCompare(b.item.titulo));
  const dias = [];
  for (const e of ent) {
    if (!dias.length || dias[dias.length - 1].data !== e.data) dias.push({ data: e.data, itens: [] });
    dias[dias.length - 1].itens.push(e);
  }
  return dias;
}

// Area USA: cadastros proprios, sem ligacao com contas, cartoes e lancamentos do resto do app.
// Paises (ISO 3166, 2 letras): destino da viagem e pais do visto. O nome vem do proprio navegador, em portugues.
const PAISES = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'.split(' ');
const ehPais = (c) => PAISES.includes(c);
function nomePais(c) {
  try { return new Intl.DisplayNames(['pt-BR'], { type: 'region' }).of(c) || c; } catch { return c; }
}
function usaValido(u) {
  if (u === undefined) return true;
  const data = (v) => v === undefined || /^\d{4}-\d{2}-\d{2}$/.test(v);
  const jpeg = (v, max) => v === undefined || (typeof v === 'string' && v.length <= max && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(v));
  const itens = (l, ok) => Array.isArray(l) && l.every((x) => x && typeof x.id === 'string' && typeof x.nome === 'string' && x.nome.length <= 60 && data(x.arquivadaEm) && ok(x));
  if (!u || typeof u !== 'object' || !itens(u.moedas, (x) => /^[A-Z]{3}$/.test(x.codigo) && typeof x.simbolo === 'string' && x.simbolo.length >= 1 && x.simbolo.length <= 5)
    || !itens(u.viajantes, () => true) || !itens(u.categorias, () => true)) return false;
  const tem = (lista, id) => lista.some((x) => x.id === id);
  const doc = (d) => !!d && typeof d === 'object' && (d.nome === undefined || (typeof d.nome === 'string' && d.nome.length >= 1 && d.nome.length <= 80)) && (d.num === undefined || (typeof d.num === 'string' && d.num.length >= 1 && d.num.length <= 30))
    && data(d.emissao) && data(d.validade) && !(d.emissao && d.validade && d.validade < d.emissao) && recibosValidos(d.fotos) && (d.pais === undefined || ehPais(d.pais));
  const ids = (l, lista) => Array.isArray(l) && l.every((id) => tem(lista, id));
  return itens(u.viagens, (x) => data(x.inicio) && data(x.fim) && jpeg(x.fundo, 800000) && ids(x.moedas, u.moedas) && x.moedas.includes(x.base) && ids(x.viajantes, u.viajantes)
      && !!x.cot && typeof x.cot === 'object' && Object.entries(x.cot).every(([m, c]) => tem(u.moedas, m) && Number.isFinite(c) && c > 0)
      && (x.corporativa === undefined || typeof x.corporativa === 'boolean') && (x.pais === undefined || ehPais(x.pais))
      // Viagem so com despesas (semItin) ou so com itinerario (semDesp); nunca sem os dois.
      && (x.semDesp === undefined || x.semDesp === true) && (x.semItin === undefined || x.semItin === true) && !(x.semDesp && x.semItin))
    && Array.isArray(u.despesas) && u.despesas.every((d) => d && typeof d.id === 'string' && typeof d.desc === 'string' && d.desc.length <= 60 && tem(u.viagens, d.viagem)
      && tem(u.categorias, d.cat) && tem(u.moedas, d.moeda) && /^\d{4}-\d{2}-\d{2}$/.test(d.data) && Number.isInteger(d.valor) && d.valor > 0 && ids(d.quem, u.viajantes)
      && (d.obs === undefined || (typeof d.obs === 'string' && d.obs.length <= 500)) && (d.pago === undefined || typeof d.pago === 'boolean') && (d.natureza === undefined || d.natureza === 'C' || d.natureza === 'P')
      && data(d.checkin) && data(d.checkout) && !(d.checkin && d.checkout && d.checkout < d.checkin) && recibosValidos(d.recibos) && localValido(d.local)
      // Pago com: um ou dois meios (contas ou cartoes da area), diferentes, somando o valor da despesa.
      && (d.pagamentos === undefined || (Array.isArray(d.pagamentos) && d.pagamentos.length >= 1 && d.pagamentos.length <= 2
        && d.pagamentos.every((p) => p && (tem(u.contas, p.meio) || tem(u.cartoes, p.meio)) && Number.isInteger(p.valor) && p.valor > 0)
        && new Set(d.pagamentos.map((p) => p.meio)).size === d.pagamentos.length && d.pagamentos.reduce((a, p) => a + p.valor, 0) === d.valor)))
    && (u.itinerario === undefined || (Array.isArray(u.itinerario) && u.itinerario.every((x) => itemItinValido(x, u))))
    && itens(u.contas, (x) => iconeValido(x.icone))
    && itens(u.cartoes, (x) => iconeValido(x.icone) && (x.tipo === undefined || x.tipo === 'F' || x.tipo === 'V') && finaisValidos(x))
    && itens(u.viajantes, (x) => jpeg(x.foto, 200000) && (x.inicial === undefined || typeof x.inicial === 'boolean')
      // Passaporte e vistos: numero, emissao, validade e fotos (PDF no Drive, como os recibos); visto com pais e id.
      && (x.passaporte === undefined || doc(x.passaporte))
      && (x.vistos === undefined || (Array.isArray(x.vistos) && x.vistos.length <= 20 && new Set(x.vistos.map((v) => v && v.id)).size === x.vistos.length
        && x.vistos.every((v) => doc(v) && typeof v.id === 'string' && v.id.length >= 1 && v.id.length <= 40 && ehPais(v.pais)))))
    && itens(u.categorias, (x) => /^[a-z]+$/.test(x.simbolo) && /^#[0-9a-f]{6}$/i.test(x.cor));
}

// Finais do cartao: ate 4 ativos; os desabilitados ficam guardados com motivo e data, para nao perder o historico.
const finalOk = (f) => !!f && /^\d{4}$/.test(f.n) && (f.tipo === 'F' || f.tipo === 'V') && (f.dono === undefined || f.dono === 'T' || f.dono === 'A');
const finaisValidos = (c) => (c.finais === undefined || (Array.isArray(c.finais) && c.finais.length <= 4 && c.finais.every(finalOk)))
  && (c.finaisInativos === undefined || (Array.isArray(c.finaisInativos) && c.finaisInativos.every((f) => finalOk(f)
    && typeof f.motivo === 'string' && f.motivo.length >= 1 && f.motivo.length <= 200 && /^\d{4}-\d{2}-\d{2}$/.test(f.em))));

// Barreira da restauracao: um arquivo fora deste formato nao pode substituir os dados.
// Configuracao do Google guardada nos dados (vai no backup): o ID do cliente do projeto no Google Cloud.
const ehClienteGoogle = (v) => typeof v === 'string' && v.length <= 200 && /^[\w-]+\.apps\.googleusercontent\.com$/.test(v);
// ultimoAutoEm: data e hora do ultimo backup automatico no Drive, de qualquer aparelho.
// agenda: lembretes no Google Agenda ligados ou nao, e o id da agenda criada pelo app (vale para todos os aparelhos).
const googleValido = (g) => g === undefined || (!!g && typeof g === 'object' && !Array.isArray(g) && (g.cliente === undefined || ehClienteGoogle(g.cliente))
  && (g.ultimoAutoEm === undefined || (typeof g.ultimoAutoEm === 'string' && g.ultimoAutoEm.length <= 40 && !Number.isNaN(Date.parse(g.ultimoAutoEm))))
  && (g.mapsKey === undefined || ehChaveMaps(g.mapsKey))
  && (g.aeroKey === undefined || ehChaveAero(g.aeroKey))
  && (g.agenda === undefined || (!!g.agenda && typeof g.agenda === 'object' && typeof g.agenda.ativo === 'boolean'
    && (g.agenda.id === undefined || (typeof g.agenda.id === 'string' && g.agenda.id.length <= 300 && /^[\w.@-]+$/.test(g.agenda.id)))
    && (g.agenda.tarefas === undefined || (typeof g.agenda.tarefas === 'string' && g.agenda.tarefas.length <= 300 && /^[\w=.:@-]+$/.test(g.agenda.tarefas))))));
// Titulo do lembrete de uma conta: nome, parcela (se for parcelada) e valor. Ex.: "IPTU 2026 (parcela 10/10) — R$ 497,20".
const tituloLembrete = (l) => `${l.desc}${l.de > 1 ? ` (parcela ${l.parcela}/${l.de})` : ''} — ${(l.valor / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`;
// Lembretes do Google Agenda: contas a pagar (gasto em conta ainda nao pago) e faturas de cartao com algo a pagar,
// com vencimento de hoje ate o fim do mes daqui a "meses". Cada um tem uma chave fixa, que vira o id do evento.
function lembretesAgenda(db, hoje, meses = 3) {
  const fim = dataNoMes(addMes(hoje.slice(0, 7), meses), 31), real = (v) => (v / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const nomeDe = (id) => ([...db.contasBanco, ...db.cartoes].find((x) => x.id === id) || { nome: '' }).nome;
  const itens = [];
  for (const l of lancsVisiveis(db)) {
    if (l.tipo !== 'S' || l.pago || ehCartao(db, l.meio) || l.data < hoje || l.data > fim) continue;
    itens.push({ chave: 'lanc:' + l.id, data: l.data, titulo: tituloLembrete(l), detalhe: `Conta a pagar · ${nomeDe(l.meio)}` });
  }
  for (const f of faturasAte(db, fim.slice(0, 7))) {
    if (f.paga || f.valor <= 0) continue;
    const data = dataNoMes(f.ym, f.cartao.vencimento);
    if (data < hoje || data > fim) continue;
    itens.push({ chave: `fat:${f.cartao.id}:${f.ym}`, data, titulo: `Fatura ${f.cartao.nome} — ${real(f.valor)}`, detalhe: `Fatura do cartão · conta sugerida: ${nomeDe(f.conta)}` });
  }
  return itens.sort((a, b) => a.data.localeCompare(b.data) || a.chave.localeCompare(b.chave));
}
// Situacao de cada lembrete possivel, pago ou nao, em qualquer data: e o que marca a tarefa como concluida ou pendente.
// Contas: todo gasto em conta. Faturas: cada fatura ate o fim do mes daqui a "meses" (paga, com o valor pago; ou o que falta).
function situacaoLembretes(db, hoje, meses = 3) {
  const fim = dataNoMes(addMes(hoje.slice(0, 7), meses), 31), real = (v) => (v / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const nomeDe = (id) => ([...db.contasBanco, ...db.cartoes].find((x) => x.id === id) || { nome: '' }).nome;
  const m = new Map();
  for (const l of lancsVisiveis(db)) {
    if (l.tipo !== 'S' || ehCartao(db, l.meio)) continue;
    m.set('lanc:' + l.id, { data: l.data, pago: !!l.pago, titulo: tituloLembrete(l), detalhe: `Conta a pagar · ${nomeDe(l.meio)}` });
  }
  // Pagamentos parciais vem antes do item principal da fatura; o principal (o ultimo do mes) e o que vale.
  for (const f of faturasAte(db, fim.slice(0, 7))) {
    if (!f.paga && f.valor <= 0) continue;
    m.set(`fat:${f.cartao.id}:${f.ym}`, { data: dataNoMes(f.ym, f.cartao.vencimento), pago: !!f.paga, titulo: `Fatura ${f.cartao.nome} — ${real(f.valor)}`, detalhe: `Fatura do cartão · conta sugerida: ${nomeDe(f.conta)}` });
  }
  return m;
}
// Id do evento no Google Agenda: so letras de a a v e numeros; a chave em hexadecimal serve e e sempre a mesma.
const idEvento = (chave) => 'cd' + [...new TextEncoder().encode(chave)].map((b) => b.toString(16).padStart(2, '0')).join('');
function backupValido(d) {
  const inteiro = (v) => Number.isInteger(v);
  const data = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (!d || typeof d !== 'object' || !perfilValido(d.perfil) || !usaValido(d.usa) || !googleValido(d.google) || !Array.isArray(d.categorias) || !Array.isArray(d.cartoes) || !Array.isArray(d.parciais)
    || !Array.isArray(d.lancs) || !Array.isArray(d.contasBanco) || !d.contasBanco.length || !Array.isArray(d.series)
    || !d.faturasPagas || typeof d.faturasPagas !== 'object' || Array.isArray(d.faturasPagas)) return false;
  const conta = (id) => d.contasBanco.some((c) => c.id === id);
  const cartao = (id) => d.cartoes.some((c) => c.id === id);
  const arquivo = (c) => c.arquivadaEm === undefined || data(c.arquivadaEm);
  return d.contasBanco.every((c) => c.id && typeof c.nome === 'string' && inteiro(c.saldoInicial) && iconeValido(c.icone) && arquivo(c))
    && d.categorias.every((c) => c.id && typeof c.nome === 'string' && (c.tipo === 'S' || c.tipo === 'E')
      && (c.limite === undefined || (inteiro(c.limite) && c.limite >= 0))
      && (c.simbolo === undefined || /^[a-z]+$/.test(c.simbolo)) && (c.cor === undefined || /^#[0-9a-f]{6}$/i.test(c.cor)) && arquivo(c))
    && d.cartoes.every((c) => c.id && typeof c.nome === 'string' && inteiro(c.fechamento) && inteiro(c.vencimento) && conta(c.contaPag) && iconeValido(c.icone) && arquivo(c)
      && (c.limite === undefined || (inteiro(c.limite) && c.limite >= 0))
      && finaisValidos(c) && (c.ativoAte === undefined || /^\d{4}-\d{2}$/.test(c.ativoAte)))
    && d.lancs.every((l) => data(l.data) && inteiro(l.valor) && typeof l.pago === 'boolean' && recibosValidos(l.recibos)
      && (l.tipo === 'T' ? conta(l.meio) && conta(l.destino) && l.meio !== l.destino
        : l.tipo === 'E' ? conta(l.meio)
          : l.tipo === 'A' ? cartao(l.meio) && l.valor < 0 && !l.cat && !l.serie
          : l.tipo === 'S' && (conta(l.meio) || cartao(l.meio))))
    && Object.values(d.faturasPagas).every((f) => data(f.data) && inteiro(f.valor) && conta(f.conta))
    && d.parciais.every((p) => cartao(p.cartao) && /^\d{4}-\d{2}$/.test(p.ym) && data(p.data) && inteiro(p.valor) && conta(p.conta))
    && d.series.every((s) => s.id && PERIODOS[s.per] && data(s.inicio) && Number.isInteger(s.n) && s.n >= 1 && s.modelo
      && inteiro(s.modelo.valor) && (s.encerrada || conta(s.modelo.meio) || cartao(s.modelo.meio)));
}

if (typeof module !== 'undefined') {
  module.exports = {
    anosEDias, contadorViagem, PAISES, ehPais, nomePais, formaDaCategoria, TIPOS_ITIN, itemItinValido, tipoDaCategoriaViagem, categoriaDeItinerario, despesaComCheckin, despesasParaItin, sincronizarItinDespesas, diasItinerario, localValido, ehChaveMaps, ehChaveAero, fusoDeOffset, horaLocalVoo, dadosDoVoo, offsetFuso, modelosDoVoo, vooNaData, lembretesAgenda, situacaoLembretes, idEvento, googleValido, ehClienteGoogle, compararDados, realceDocumento, recibosValidos, nomeRecibo, homografia, aplicarH, montarPdf,
    comCache, ultimoDia, addMes, dataNoMes, mesFatura, fechamentoFatura, faturaPagavel, itensFatura, totalFatura, chaveFatura,
    protegerSenha, confereSenha, cifrarBackup, chaveSync, cifrarComChave, decifrarComChave, novoSal, cifrarBackupSenhaApp, decifrarBackup, decifrarComHash, ehBackupCifrado, usaSenhaDoApp, gerarCodigo, limpaCodigo, perfilValido, usaValido, MOEDAS_PADRAO, totaisViagem, categoriasViagem, totaisViagens, viagemFinalizada, filtrarViagens, ativoEm, ultimaFaturaAte, svgParaIcone, iconeValido, gastosPorMeio, resgatesDoMes, fluxoPeriodo, resumoParcelamentos, parcelasNoPeriodo, resumoConta, resumoCartoes, resumoCategorias, resumoAPagar, restanteFatura, faturaPagaDoLanc, statusFatura, faturasAtrasadas, pagarFatura, desfazerPagamentos, criarParcelada, ehCartao, saldosPorConta, saldo, gastosPorCategoria, itensRelatorio, relatorioCategorias, relatorioBalanco, limitesDoMes, lancsDoLimite, entradasDoMes, aPagar, aReceber, limiteDisponivel, faturaAtual, saudacao, totalFaturasDoMes, linhasFluxo, atrasados, fluxoMes, dataSerie, completarSeries, criarSerie, aplicarEdicao, excluirLanc, migrar, backupValido,
  };
}
