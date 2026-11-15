// Token Launch Radar, second edition. Reads window.RADAR (written beside dashboard/ by main.ts) and
// renders three views: the ranked board (search, category / chain / tier filters, five sort orders),
// a detail view per protocol (the model's own arithmetic and the protocol's farm plan), the live-token
// comparables the peer multiples are priced from, and a method page that states the model in full.
// Routes live in the hash: #/ board, #/live, #/method, #/p/<slug>, and board filters ride along as
// #/?cat=<category>&tier=<watchlist|early>&q=<text>&sort=<key>. No network: every byte is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var bySlug = {};
  DATA.rows.forEach(function (r) { bySlug[r.slug] = r; });

  /* ---------- formatting ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(v) {
    if (v == null || !isFinite(v)) return '—';
    var a = Math.abs(v);
    if (a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(v);
  }
  function pct(v) {
    if (v == null || !isFinite(v)) return '<span class="mut">—</span>';
    var cls = v > 0 ? 'pos' : v < 0 ? 'neg' : 'mut';
    return '<span class="' + cls + '">' + (v > 0 ? '+' : '') + v.toFixed(1) + '%</span>';
  }
  function mult(v) { return '×' + Number(v).toFixed(3); }
  function ageText(days) {
    if (days == null) return 'not recorded';
    if (days < 365) return days + ' days';
    return (days / 365).toFixed(1) + ' years (' + days + 'd)';
  }
  function chainsText(chains) {
    if (!chains || chains.length === 0) return '—';
    if (chains.length <= 2) return esc(chains.join(', '));
    return esc(chains[0]) + ' <span class="mut">+' + (chains.length - 1) + '</span>';
  }

  /* ---------- routing ---------- */
  function route() {
    var h = location.hash.replace(/^#/, '') || '/';
    var qm = h.indexOf('?');
    var path = qm >= 0 ? h.slice(0, qm) : h;
    var params = {};
    if (qm >= 0) h.slice(qm + 1).split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0) params[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1));
    });
    return { path: path, params: params };
  }
  function boardHash(f) {
    var parts = [];
    if (f.cat && f.cat !== 'all') parts.push('cat=' + encodeURIComponent(f.cat));
    if (f.chain && f.chain !== 'all') parts.push('chain=' + encodeURIComponent(f.chain));
    if (f.tier && f.tier !== 'all') parts.push('tier=' + encodeURIComponent(f.tier));
    if (f.q) parts.push('q=' + encodeURIComponent(f.q));
    if (f.sort && f.sort !== 'implied') parts.push('sort=' + encodeURIComponent(f.sort));
    return '#/' + (parts.length ? '?' + parts.join('&') : '');
  }

  /* ---------- chrome ---------- */
  function masthead(active) {
    var total = DATA.rows.reduce(function (s, r) { return s + r.tvl_usd; }, 0);
    var strong = DATA.rows.filter(function (r) { return r.signal === 'Strong'; }).length;
    var tabs = [['/', 'The board'], ['/live', 'Live comparables'], ['/method', 'Method']]
      .map(function (t) {
        var on = (active === t[0]) || (active === 'detail' && t[0] === '/');
        return '<a href="#' + t[0] + '"' + (on ? ' class="on"' : '') + '>' + t[1] + '</a>';
      }).join('');
    return '' +
      '<header class="masthead">' +
      '<p class="eyebrow">Token Launch Radar · model ' + esc(DATA.model_version) + '</p>' +
      '<h1>Protocols whose token does not exist yet, ranked by what the launch could be worth</h1>' +
      '<p class="lede">Every protocol in the snapshot that records <strong>no token</strong> is priced the way the market ' +
      'prices its traded peers: <strong>TVL × the category’s market-cap-to-TVL multiple</strong>, adjusted for momentum, ' +
      'track record and chain breadth. Wrapped, staked and bridged products of tokens that already trade are screened out — ' +
      'they are not launches waiting to happen. Each row carries the arithmetic and a farm plan. Implied value is a ' +
      'ranking device, not a price prediction.</p>' +
      '<div class="stats">' +
      '<div class="stat"><span class="v">' + DATA.board_size + '</span><span class="k">protocols ranked</span></div>' +
      '<div class="stat"><span class="v">' + DATA.watchlist_size + '</span><span class="k">on the $' + (DATA.floor_usd / 1e6) + 'M+ watchlist</span></div>' +
      '<div class="stat"><span class="v">' + DATA.early_size + '</span><span class="k">early finds below it</span></div>' +
      '<div class="stat"><span class="v">' + money(DATA.total_implied_usd) + '</span><span class="k">total implied value</span></div>' +
      '<div class="stat"><span class="v">' + money(total) + '</span><span class="k">TVL under watch</span></div>' +
      '<div class="stat"><span class="v">' + strong + '</span><span class="k">strong signals</span></div>' +
      '</div></header>' +
      '<nav class="tabs">' + tabs + '</nav>';
  }
  function footer() {
    return '<footer>Data: ' + esc(DATA.source) + ' · Snapshot as of ' + esc(DATA.as_of) + ' · Model ' +
      esc(DATA.model_version) + ', computed from the snapshot alone; nothing on this page was fetched or looked up. ' +
      'Implied values rank protocols against each other; they are not valuations, offers or advice.</footer>';
  }

  /* ---------- board view ---------- */
  var SORTS = {
    implied: ['Implied value', function (a, b) { return b.implied_value_usd - a.implied_value_usd; }],
    tvl: ['TVL', function (a, b) { return b.tvl_usd - a.tvl_usd; }],
    growth: ['7d change', function (a, b) { return (b.change_7d == null ? -999 : b.change_7d) - (a.change_7d == null ? -999 : a.change_7d); }],
    peer: ['Peer multiple', function (a, b) { return b.peer_multiple - a.peer_multiple; }],
    age: ['Age', function (a, b) { return (b.age_days == null ? -1 : b.age_days) - (a.age_days == null ? -1 : a.age_days); }]
  };
  function categories() {
    var seen = {};
    DATA.rows.forEach(function (r) { if (r.category) seen[r.category] = 1; });
    return Object.keys(seen).sort();
  }
  function chains() {
    var seen = {};
    DATA.rows.forEach(function (r) { r.chains.forEach(function (c) { seen[c] = 1; }); });
    return Object.keys(seen).sort();
  }
  function renderBoard(params) {
    var f = {
      cat: params.cat || 'all', chain: params.chain || 'all', tier: params.tier || 'all',
      q: params.q || '', sort: params.sort || 'implied'
    };
    var rows = DATA.rows.filter(function (r) {
      if (f.cat !== 'all' && r.category !== f.cat) return false;
      if (f.chain !== 'all' && r.chains.indexOf(f.chain) < 0) return false;
      if (f.tier === 'watchlist' && !r.on_watchlist) return false;
      if (f.tier === 'early' && r.on_watchlist) return false;
      if (f.q && (r.name + ' ' + r.slug).toLowerCase().indexOf(f.q.toLowerCase()) < 0) return false;
      return true;
    });
    rows = rows.slice().sort(SORTS[f.sort] ? SORTS[f.sort][1] : SORTS.implied[1]);
    var maxImplied = DATA.rows.length ? DATA.rows[0].implied_value_usd : 1;

    var catOpts = ['<option value="all">All categories</option>'].concat(categories().map(function (c) {
      return '<option value="' + esc(c) + '"' + (f.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    })).join('');
    var chainOpts = ['<option value="all">All chains</option>'].concat(chains().map(function (c) {
      return '<option value="' + esc(c) + '"' + (f.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    })).join('');
    var tierOpts = [['all', 'Whole board'], ['watchlist', 'Watchlist only'], ['early', 'Early finds only']].map(function (t) {
      return '<option value="' + t[0] + '"' + (f.tier === t[0] ? ' selected' : '') + '>' + t[1] + '</option>';
    }).join('');
    var sortOpts = Object.keys(SORTS).map(function (k) {
      return '<option value="' + k + '"' + (f.sort === k ? ' selected' : '') + '>Sort: ' + SORTS[k][0] + '</option>';
    }).join('');

    var body = rows.map(function (r) {
      var badge = r.on_watchlist ? '<span class="badge wl">Watchlist</span>' : '<span class="badge early">Early</span>';
      var w = Math.max(2, Math.round(100 * r.implied_value_usd / maxImplied));
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="rank">' + r.rank + '</td>' +
        '<td><span class="pname">' + esc(r.name) + '</span>' + badge + '<span class="pcat">' + esc(r.category || 'Uncategorised') + '</span></td>' +
        '<td class="chains hideS">' + chainsText(r.chains) + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num hideS">' + pct(r.change_7d) + '</td>' +
        '<td class="num hideS">' + mult(r.peer_multiple) + '</td>' +
        '<td class="num"><strong>' + money(r.implied_value_usd) + '</strong><div class="bar"><i style="width:' + w + '%"></i></div></td>' +
        '<td><span class="sig ' + r.signal + '">' + r.signal + '</span></td></tr>';
    }).join('');

    app.innerHTML = masthead('/') +
      '<div class="controls">' +
      '<input type="search" id="fq" placeholder="Search protocols…" value="' + esc(f.q) + '" aria-label="Search protocols">' +
      '<select id="fcat" aria-label="Category">' + catOpts + '</select>' +
      '<select id="fchain" aria-label="Chain">' + chainOpts + '</select>' +
      '<select id="ftier" aria-label="Tier">' + tierOpts + '</select>' +
      '<select id="fsort" aria-label="Sort order">' + sortOpts + '</select>' +
      '<span class="count">' + rows.length + ' of ' + DATA.board_size + ' shown</span></div>' +
      (rows.length === 0
        ? '<p class="mut">No protocol on the board matches those filters. Loosen one and the radar sweeps again.</p>'
        : '<table><thead><tr><th>#</th><th>Protocol</th><th class="hideS">Chains</th><th>TVL</th><th class="hideS">7d</th>' +
          '<th class="hideS">Peer ×</th><th>Implied value</th><th>Signal</th></tr></thead><tbody>' + body + '</tbody></table>') +
      footer();
    app.setAttribute('aria-busy', 'false');

    function apply(patch) {
      var next = { cat: f.cat, chain: f.chain, tier: f.tier, q: f.q, sort: f.sort };
      Object.keys(patch).forEach(function (k) { next[k] = patch[k]; });
      location.hash = boardHash(next);
    }
    var q = document.getElementById('fq');
    q.addEventListener('change', function () { apply({ q: q.value }); });
    q.addEventListener('keydown', function (e) { if (e.key === 'Enter') apply({ q: q.value }); });
    document.getElementById('fcat').addEventListener('change', function (e) { apply({ cat: e.target.value }); });
    document.getElementById('fchain').addEventListener('change', function (e) { apply({ chain: e.target.value }); });
    document.getElementById('ftier').addEventListener('change', function (e) { apply({ tier: e.target.value }); });
    document.getElementById('fsort').addEventListener('change', function (e) { apply({ sort: e.target.value }); });
    Array.prototype.forEach.call(app.querySelectorAll('tbody tr'), function (tr) {
      tr.addEventListener('click', function () { location.hash = '#/p/' + tr.getAttribute('data-slug'); });
    });
  }

  /* ---------- detail view ---------- */
  function factorRow(label, desc, value, frac) {
    var w = Math.max(2, Math.min(100, Math.round(100 * frac)));
    return '<div class="factor"><span class="fk">' + label + '</span>' +
      '<span class="fd">' + desc + '<div class="bar"><i style="width:' + w + '%"></i></div></span>' +
      '<span class="fv">' + value + '</span></div>';
  }
  function renderDetail(slug) {
    var r = bySlug[slug];
    if (!r) { renderBoard({}); return; }
    var base = r.tvl_usd * r.peer_multiple;
    var why = [];
    why.push('its TVL of ' + money(r.tvl_usd) + ' is priced at ' + mult(r.peer_multiple) + ', the multiple ' +
      (r.peer_count > 0 ? r.peer_count + ' traded ' + esc(r.category || '') + ' peer' + (r.peer_count === 1 ? '' : 's') + ' support' : 'the market-wide median supports, its category having no traded peer in the snapshot'));
    if (r.change_7d != null && Math.abs(r.change_7d) >= 5) why.push('a 7-day TVL move of ' + r.change_7d.toFixed(1) + '% ' + (r.change_7d > 0 ? 'lifts' : 'trims') + ' the price through the momentum factor');
    if (r.age_days != null && r.age_days >= 730) why.push('a ' + ageText(r.age_days) + ' track record earns nearly the full maturity factor');
    if (r.chains.length >= 5) why.push('it already runs on ' + r.chains.length + ' chains, distribution a launch would not have to buy');
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    var chips = r.chains.map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('');
    app.innerHTML = masthead('detail') +
      '<a class="back" href="#/">← back to the board</a>' +
      '<div class="dhead"><h2>' + esc(r.name) + '</h2>' +
      '<span class="sig ' + r.signal + '">' + r.signal + ' signal</span>' +
      (r.on_watchlist ? '<span class="badge wl">Watchlist</span>' : '<span class="badge early">Early find</span>') + '</div>' +
      '<p class="dsub">Rank #' + r.rank + ' of ' + DATA.board_size + ' · ' + esc(r.category || 'Uncategorised') +
      ' · tracked by DefiLlama since ' + esc(r.listed_at || 'an unrecorded date') + ' · no token recorded: this is a launch that has not happened.</p>' +
      '<div class="grid">' +
      '<div class="card"><span class="k">Implied value</span><span class="v">' + money(r.implied_value_usd) + '</span><span class="s">what the launch could be worth</span></div>' +
      '<div class="card"><span class="k">TVL</span><span class="v">' + money(r.tvl_usd) + '</span><span class="s">' + pct(r.change_7d) + ' over 7 days</span></div>' +
      '<div class="card"><span class="k">Peer multiple</span><span class="v">' + mult(r.peer_multiple) + '</span><span class="s">from ' + r.peer_count + ' traded peer' + (r.peer_count === 1 ? '' : 's') + '</span></div>' +
      '<div class="card"><span class="k">Age</span><span class="v">' + ageText(r.age_days) + '</span><span class="s">since DefiLlama first tracked it</span></div>' +
      '<div class="card"><span class="k">Chains</span><span class="v">' + r.chains.length + '</span><span class="s">' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? '…' : '') + '</span></div>' +
      '</div>' +
      '<h3 class="sec">Why it ranks here</h3>' +
      '<p class="mut">This protocol ranks #' + r.rank + ' because ' + why.join('; ') + '.</p>' +
      '<h3 class="sec">The arithmetic</h3>' +
      '<p class="formula">implied = TVL ' + money(r.tvl_usd) + ' × peer ' + mult(r.peer_multiple) + ' × momentum ' + mult(r.growth_multiplier) +
      ' × maturity ' + mult(r.maturity_multiplier) + ' × breadth ' + mult(r.breadth_multiplier) + ' = ' + money(r.implied_value_usd) + '</p>' +
      factorRow('Peer multiple', 'Market cap per $1 of TVL among traded ' + esc(r.category || 'protocols') + '; category median shrunk toward the market median (' + mult(DATA.global_peer_median) + ') by peer count.', mult(r.peer_multiple), r.peer_multiple / 1.25) +
      factorRow('Momentum', '7-day TVL change of ' + (r.change_7d == null ? 'not recorded, scored neutral' : r.change_7d.toFixed(1) + '%') + ', clamped and weighted at 0.35 so one week cannot carry a ranking.', mult(r.growth_multiplier), (r.growth_multiplier - 0.8) / 0.6) +
      factorRow('Maturity', 'Age ' + ageText(r.age_days) + ' on a 0.70–1.00 scale that fills over three years of being tracked.', mult(r.maturity_multiplier), (r.maturity_multiplier - 0.7) / 0.3) +
      factorRow('Breadth', r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ' live; +4% per chain past the first, capped at five.', mult(r.breadth_multiplier), (r.breadth_multiplier - 1) / 0.2) +
      '<p class="mut">Peer-priced base before adjustments: ' + money(base) + '.</p>' +
      '<h3 class="sec">Chains</h3><div class="chips">' + chips + '</div>' +
      '<h3 class="sec">The farm plan</h3>' +
      '<p class="mut">Six steps, written from this protocol’s category, chains, size and age — the same generator writes every plan on the board.</p>' +
      '<ol class="plan">' + steps + '</ol>' +
      footer();
    app.setAttribute('aria-busy', 'false');
    window.scrollTo(0, 0);
  }

  /* ---------- live comparables ---------- */
  function renderLive() {
    var body = DATA.live.map(function (p, i) {
      return '<tr><td class="rank">' + (i + 1) + '</td>' +
        '<td><span class="pname">' + esc(p.name) + '</span><span class="pcat">' + esc(p.category || 'Uncategorised') + '</span></td>' +
        '<td class="chains hideS">' + chainsText(p.chains) + '</td>' +
        '<td class="num">' + money(p.tvl_usd) + '</td>' +
        '<td class="num">' + money(p.mcap_usd) + '</td>' +
        '<td class="num"><strong>' + (p.mcap_tvl == null ? '—' : mult(p.mcap_tvl)) + '</strong></td>' +
        '<td class="num hideS">' + pct(p.change_7d) + '</td></tr>';
    }).join('');
    app.innerHTML = masthead('/live') +
      '<p class="lede">These protocols already trade, so the market has priced them. Their market-cap-to-TVL ratios are the ' +
      'evidence the board’s peer multiples are built from: the market-wide median is <strong>' + mult(DATA.global_peer_median) + '</strong>, ' +
      'and each category’s median is shrunk toward it by how many traded peers the category has. A pre-token protocol is ' +
      'priced as if its launch were valued like these.</p>' +
      '<table><thead><tr><th>#</th><th>Protocol</th><th class="hideS">Chains</th><th>TVL</th><th>Market cap</th><th>Mcap / TVL</th><th class="hideS">7d</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table>' + footer();
    app.setAttribute('aria-busy', 'false');
  }

  /* ---------- method ---------- */
  function renderMethod() {
    var m = DATA.model;
    app.innerHTML = masthead('/method') +
      '<div class="method">' +
      '<h3>The question</h3>' +
      '<p>Which protocols that have <strong>no token yet</strong> would be worth the most if they launched one — and what should a ' +
      'farmer do about each of them now? The snapshot (' + esc(DATA.source) + ', as of ' + esc(DATA.as_of) + ') is the only input. ' +
      'It states TVL, a 7-day TVL change, chains, category, a first-tracked date, and, for protocols that already trade, a market cap.</p>' +
      '<h3>The screen</h3>' +
      '<p>A protocol is a candidate when it records no token (no market cap, no CoinGecko id, no symbol) and is not a product of ' +
      'one that trades: not a versioned pool of another protocol, not a wrapped, staked or bridged product, not an exchange’s own ' +
      'product. The house watchlist — every candidate at or above <span class="num">' + money(DATA.floor_usd) + '</span> of TVL — is always ' +
      'on the board (' + DATA.watchlist_size + ' protocols). Below the floor the radar adds the ' + DATA.early_size + ' largest remaining ' +
      'candidates as early finds, because a launch radar that only watches the biggest names is a press release, not a radar.</p>' +
      '<h3>The price</h3>' +
      '<p><code>implied = TVL × peer × momentum × maturity × breadth</code></p>' +
      '<ul>' +
      '<li><strong>Peer</strong> — for the protocol’s category, the median market-cap-to-TVL of its traded peers (a peer trading above ×5 its TVL is left out as mispriced), shrunk toward the ' +
      'market median (<span class="num">' + mult(DATA.global_peer_median) + '</span>) with prior weight ' + m.peer_prior_weight + ', clamped to ' +
      '<span class="num">[' + m.peer_min + ', ' + m.peer_max + ']</span>. One traded peer is a hint; fifteen are evidence. Categories trade at ' +
      'different multiples, and a flat multiple would rank a lending market’s TVL as if it were a curator network’s.</li>' +
      '<li><strong>Momentum</strong> — <code>1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ')% × ' + m.growth_weight + '</code>. ' +
      'A rising protocol is worth more than a shrinking one, but one week is weather, not climate, so the weight is damped.</li>' +
      '<li><strong>Maturity</strong> — <code>' + m.maturity_floor + ' + ' + m.maturity_range + ' × min(age, ' + m.maturity_days + 'd) / ' + m.maturity_days + 'd</code>. ' +
      'Age is measured from the day DefiLlama first tracked the protocol; an unrecorded date is scored at the median age of the ' +
      'snapshot’s pre-token protocols, a figure from the data rather than a guess.</li>' +
      '<li><strong>Breadth</strong> — <code>1 + ' + m.breadth_per_chain + ' × min(chains − 1, ' + m.breadth_max_extra + ')</code>. ' +
      'Every chain a protocol already runs on is an audience a token launch does not have to buy.</li>' +
      '</ul>' +
      '<h3>The signal</h3>' +
      '<p>A display label, never part of the price: <strong>Strong</strong> when a protocol is on the watchlist and adds scale ' +
      '(≥ $250M TVL), a year or more of track record, three or more chains, or positive momentum — four or more of those marks in ' +
      'total; <strong>Moderate</strong> at two or three; <strong>Early</strong> below that. It answers “how much of a case is there”, ' +
      'not “what is it worth”.</p>' +
      '<h3>The farm plans</h3>' +
      '<p>Each plan is six steps generated from the protocol’s own record: a fresh-wallet setup on its first chain, a core position ' +
      'written for its category (supply for a lending market, a vault deposit for a curator, a round trip for a bridge), a second ' +
      'action that separates a user from a one-click deposit, a weekly cadence, a holding window set by its age — snapshots are ' +
      'unannounced, and a position opened and closed inside a week is the pattern filters remove — and a claim-discipline step: ' +
      'claim only from the link the protocol itself publishes, and never pay to claim. Capital per position scales with the ' +
      'protocol’s TVL, from $50 to $250.</p>' +
      '<h3>The limits</h3>' +
      '<p>The snapshot carries no fees, revenue, users or team information, so the model uses none. A peer multiple is a ' +
      'category’s habit, not a protocol’s promise: two protocols with identical rows can launch to very different receptions. ' +
      'Implied value ranks the board against itself; it does not predict a price, and nothing here is advice.</p>' +
      '</div>' + footer();
    app.setAttribute('aria-busy', 'false');
  }

  /* ---------- dispatch ---------- */
  function render() {
    var r = route();
    if (r.path === '/live') renderLive();
    else if (r.path === '/method') renderMethod();
    else if (r.path.indexOf('/p/') === 0) renderDetail(decodeURIComponent(r.path.slice(3)));
    else renderBoard(r.params);
  }
  window.addEventListener('hashchange', render);
  render();
})();
