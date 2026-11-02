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
function ativoEm(item, ym) {
  return !item.arquivadaEm || ym <= item.arquivadaEm.slice(0, 7);
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
    .filter((c) => c.tipo === 'S' && c.limite)
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
const ehBackupCifrado = (o) => !!o && o.formato === FORMATO_CIFRADO;
const usaSenhaDoApp = (o) => o.versao === 2;
// Senha errada ou arquivo alterado: o AES-GCM recusa e a promessa falha.
async function decifrarBackup(o, senha) {
  if (!usaSenhaDoApp(o) && (o.versao !== 1 || !Number.isInteger(o.iteracoes) || o.iteracoes < 100000 || o.iteracoes > 5000000)) throw new Error('formato');
  const chave = usaSenhaDoApp(o) ? await chaveDoHash(await hashSenha(senha, o.sal)) : await chaveBackup(senha, deB64(o.sal), o.iteracoes);
  const claro = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deB64(o.iv) }, chave, deB64(o.dados));
  return JSON.parse(new TextDecoder().decode(claro));
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

// Barreira da restauracao: um arquivo fora deste formato nao pode substituir os dados.
function backupValido(d) {
  const inteiro = (v) => Number.isInteger(v);
  const data = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (!d || typeof d !== 'object' || !perfilValido(d.perfil) || !Array.isArray(d.categorias) || !Array.isArray(d.cartoes) || !Array.isArray(d.parciais)
    || !Array.isArray(d.lancs) || !Array.isArray(d.contasBanco) || !d.contasBanco.length || !Array.isArray(d.series)
    || !d.faturasPagas || typeof d.faturasPagas !== 'object' || Array.isArray(d.faturasPagas)) return false;
  const conta = (id) => d.contasBanco.some((c) => c.id === id);
  const cartao = (id) => d.cartoes.some((c) => c.id === id);
  const arquivo = (c) => c.arquivadaEm === undefined || data(c.arquivadaEm);
  return d.contasBanco.every((c) => c.id && typeof c.nome === 'string' && inteiro(c.saldoInicial) && iconeValido(c.icone) && arquivo(c))
    && d.categorias.every((c) => c.id && typeof c.nome === 'string' && (c.tipo === 'S' || c.tipo === 'E')
      && (c.limite === undefined || (inteiro(c.limite) && c.limite >= 0))
      && (c.simbolo === undefined || /^[a-z]+$/.test(c.simbolo)) && (c.cor === undefined || /^#[0-9a-f]{6}$/i.test(c.cor)))
    && d.cartoes.every((c) => c.id && typeof c.nome === 'string' && inteiro(c.fechamento) && inteiro(c.vencimento) && conta(c.contaPag) && iconeValido(c.icone) && arquivo(c)
      && (c.limite === undefined || (inteiro(c.limite) && c.limite >= 0)))
    && d.lancs.every((l) => data(l.data) && inteiro(l.valor) && typeof l.pago === 'boolean'
      && (l.tipo === 'T' ? conta(l.meio) && conta(l.destino) && l.meio !== l.destino
        : l.tipo === 'E' ? conta(l.meio)
          : l.tipo === 'S' && (conta(l.meio) || cartao(l.meio))))
    && Object.values(d.faturasPagas).every((f) => data(f.data) && inteiro(f.valor) && conta(f.conta))
    && d.parciais.every((p) => cartao(p.cartao) && /^\d{4}-\d{2}$/.test(p.ym) && data(p.data) && inteiro(p.valor) && conta(p.conta))
    && d.series.every((s) => s.id && PERIODOS[s.per] && data(s.inicio) && Number.isInteger(s.n) && s.n >= 1 && s.modelo
      && inteiro(s.modelo.valor) && (s.encerrada || conta(s.modelo.meio) || cartao(s.modelo.meio)));
}

if (typeof module !== 'undefined') {
  module.exports = {
    comCache, ultimoDia, addMes, dataNoMes, mesFatura, fechamentoFatura, faturaPagavel, itensFatura, totalFatura, chaveFatura,
    protegerSenha, confereSenha, cifrarBackup, cifrarBackupSenhaApp, decifrarBackup, ehBackupCifrado, usaSenhaDoApp, gerarCodigo, limpaCodigo, perfilValido, ativoEm, svgParaIcone, iconeValido, restanteFatura, faturaPagaDoLanc, statusFatura, faturasAtrasadas, pagarFatura, desfazerPagamentos, criarParcelada, ehCartao, saldosPorConta, saldo, gastosPorCategoria, itensRelatorio, relatorioCategorias, relatorioBalanco, limitesDoMes, lancsDoLimite, entradasDoMes, aPagar, aReceber, limiteDisponivel, faturaAtual, saudacao, totalFaturasDoMes, linhasFluxo, fluxoMes, dataSerie, completarSeries, criarSerie, aplicarEdicao, excluirLanc, migrar, backupValido,
  };
}
