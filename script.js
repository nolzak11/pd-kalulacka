// ---------- Helpers ----------
const APP_VER = '1.2.0'; // Nová verze
const el = (id) => document.getElementById(id);
const num = (v) => parseFloat(String(v).replace(',', '.')) || 0;
const fmtCZK = (n) => new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK', maximumFractionDigits: 0 }).format(n || 0);

let __calcTimer = null;
const recalcDebounced = () => { clearTimeout(__calcTimer); __calcTimer = setTimeout(calculate, 300); };

let __saveTimer = null;
const saveLastParamsDebounced = () => {
  clearTimeout(__saveTimer);
  __saveTimer = setTimeout(() => {
    CONFIG.last.modelParams = {
      fveKwp: num(el('fveKwp').value),
      bessKwh: num(el('bessKwh').value)
    };
    saveConfig(CONFIG);
  }, 800);
};

// ---------- Konfigurace (stupně PD) ----------
const STAGES = [
  { key: 'STU', name: 'Studie / návrh' },
  { key: 'DUR', name: 'Dokumentace pro územní řízení (DUR)' },
  { key: 'DSP', name: 'PD pro povolení stavby (DSP)' },
  { key: 'DPS', name: 'PD pro provedení stavby (DPS)' },
  { key: 'AD', name: 'Autorský dozor (AD)' },
];

// UNIKA sazby podle typu
const UNIKA_RATES = {
  'RD': 700,
  'BD': 700,
  'PRU': 1200,
  'BESS': 1200,
  'BROWN': 1200,
};

// ZMĚNA ZDE: Nová struktura pro odstupňované (progresivní) ceny
const BASE_UNIT_COSTS = {
  RD: {
    cFveFixed: 80000,
    cFveTiers: [ // Pro RD ponecháno lineární
      { upTo: Infinity, price: 28000 } 
    ],
    cBessFixed: 0,
    cBessTiers: [ // Pro RD ponecháno lineární
      { upTo: Infinity, price: 15000 }
    ],
    balancePct: 0
  },
  BD: {
    cFveFixed: 200000,
    cFveTiers: [
      { upTo: 50, price: 28000 }, // 0-50 kWp
      { upTo: Infinity, price: 26000 } // 51+ kWp
    ],
    cBessFixed: 500000,
    cBessTiers: [
      { upTo: 100, price: 10000 }, // 0-100 kWh
      { upTo: Infinity, price: 8000 }  // 101+ kWh
    ],
    balancePct: 0
  },
  PRU: {
    cFveFixed: 1500000,
    cFveTiers: [
      { upTo: 100, price: 30000 },      // 0-100 kWp
      { upTo: 500, price: 28000 },      // 101-500 kWp
      { upTo: 2000, price: 26000 },     // 501-2000 kWp
      { upTo: Infinity, price: 24000 }  // 2001+ kWp
    ],
    cBessFixed: 3000000,
    cBessTiers: [
      { upTo: 500, price: 8000 },       // 0-500 kWh
      { upTo: 2000, price: 6000 },      // 501-2000 kWh
      { upTo: Infinity, price: 4500 }   // 2001+ kWh
    ],
    balancePct: 0
  },
  // Ostatní typy kopírují PRU, můžeš si je upravit
  BESS: {
    cFveFixed: 0,
    cFveTiers: [], // Žádná FVE
    cBessFixed: 3000000,
    cBessTiers: [
      { upTo: 500, price: 8000 },
      { upTo: 2000, price: 6000 },
      { upTo: Infinity, price: 4500 }
    ],
    balancePct: 0
  },
  BROWN: {
    cFveFixed: 1500000,
    cFveTiers: [
      { upTo: 100, price: 30000 },
      { upTo: 500, price: 28000 },
      { upTo: 2000, price: 26000 },
      { upTo: Infinity, price: 24000 }
    ],
    cBessFixed: 3000000,
    cBessTiers: [
      { upTo: 500, price: 8000 },
      { upTo: 2000, price: 6000 },
      { upTo: Infinity, price: 4500 }
    ],
    balancePct: 0
  },
};

// Výchozí typy a procenta
const DEFAULTS = {
  'RD': { label: 'Rodinný dům (RD)', perc: { STU: 0.0, DUR: 0.0, DSP: 0.0, DPS: 3.3, AD: 0.4 }, rateMode: 'unika', rateCustom: 700, unitCosts: BASE_UNIT_COSTS.RD },
  'BD': { label: 'Bytový dům (BD)', perc: { STU: 0.6, DUR: 0.6, DSP: 1.4, DPS: 2.0, AD: 0.5 }, rateMode: 'unika', rateCustom: 700, unitCosts: BASE_UNIT_COSTS.BD },
  'PRU': { label: 'Průmyslový objekt', perc: { STU: 0.4, DUR: 0.5, DSP: 1.0, DPS: 1.8, AD: 0.4 }, rateMode: 'unika', rateCustom: 1200, unitCosts: BASE_UNIT_COSTS.PRU },
  'BROWN': { label: 'Brownfield', perc: { STU: 0.4, DUR: 0.5, DSP: 1.2, DPS: 1.8, AD: 0.4 }, rateMode: 'unika', rateCustom: 1200, unitCosts: BASE_UNIT_COSTS.BROWN },
  'BESS': { label: 'BESS (samostatná)', perc: { STU: 0.3, DUR: 0.5, DSP: 0.9, DPS: 1.5, AD: 0.2 }, rateMode: 'unika', rateCustom: 1200, unitCosts: BASE_UNIT_COSTS.BESS },
};


const LS_KEY = 'pd_calc_config_v120'; // NOVÝ KLÍČ pro v1.2.0 (důležité!)

// ---------- Local storage ----------
function loadConfig() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const base = {
      types: structuredClone(DEFAULTS),
      last: {
        typeKey: 'PRU',
        rateMode: 'unika',
        cisMode: 'model',
        modelParams: { fveKwp: 0, bessKwh: 0 }
      }
    };
    if (!raw) return base;
    const cfg = JSON.parse(raw);
    
    // Sloučení konfigurace, zachování uživatelských dat
    for (const k of Object.keys(DEFAULTS)) {
      if (!cfg.types[k]) {
        // Nový typ, který uživatel nemá -> přidat
        cfg.types[k] = structuredClone(DEFAULTS[k]);
      } else {
        // Starý typ -> sloučit (uživatelská data mají přednost, ale doplníme chybějící)
        cfg.types[k].perc = { ...(DEFAULTS[k].perc || {}), ...(cfg.types[k].perc || {}) };
        cfg.types[k].rateMode ??= DEFAULTS[k].rateMode;
        cfg.types[k].rateCustom ??= DEFAULTS[k].rateCustom;
        
        // Sloučení unitCosts - prioritou jsou uživatelsky uložené FIXNÍ ČÁSTI
        // Ale Tiers (sazby) se vezmou VŽDY z nových DEFAULTS
        const userFixedCosts = {
          cFveFixed: cfg.types[k].unitCosts?.cFveFixed,
          cBessFixed: cfg.types[k].unitCosts?.cBessFixed,
          balancePct: cfg.types[k].unitCosts?.balancePct
        };
        
        cfg.types[k].unitCosts = { 
          ...structuredClone(DEFAULTS[k].unitCosts), 
          ...userFixedCosts 
        };
        
        // Vyčistit staré variabilní klíče, pokud existují
        delete cfg.types[k].unitCosts.cFveKwpVar;
        delete cfg.types[k].unitCosts.cBessKwh;
      }
    }
    cfg.last ??= base.last;
    if (cfg.last.unitCosts) delete cfg.last.unitCosts;
    
    return cfg;
  } catch (e) {
    console.error("Chyba při načítání konfigurace:", e);
    return { types: structuredClone(DEFAULTS), last: { typeKey: 'PRU', rateMode: 'unika', cisMode: 'model', modelParams: { fveKwp: 0, bessKwh: 0 } } };
  }
}
function saveConfig(cfg) { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); }

let CONFIG = loadConfig();

// ---------- UI populate ----------
function populateTypeSelects() {
  const s1 = el('type');
  const s2 = el('type2');
  const entries = Object.entries(CONFIG.types);
  const fill = (sel) => {
    sel.innerHTML = '';
    for (const [key, obj] of entries) {
      const opt = document.createElement('option');
      opt.value = key; opt.textContent = obj.label;
      sel.appendChild(opt);
    }
  };
  fill(s1); fill(s2);
  if (CONFIG.last?.typeKey && CONFIG.types[CONFIG.last.typeKey]) {
    s1.value = CONFIG.last.typeKey;
    s2.value = CONFIG.last.typeKey;
  } else {
    s1.selectedIndex = 0; s2.selectedIndex = 0;
    CONFIG.last.typeKey = s2.value;
  }
}

// Načte procenta, sazby a JEDNOTKOVÉ CENY
function populateTypeConfig(typeKey) {
  const tbody = el('stagesBody');
  tbody.innerHTML = '';
  const current = CONFIG.types[typeKey];
  if (!current) {
    console.error("Neznámý typ stavby:", typeKey);
    return;
  }

  // 1. Procenta PD
  for (const st of STAGES) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${st.name}</td>
      <td class="right"><input type="number" step="0.1" min="0" max="100" value="${current.perc[st.key] ?? 0}" data-stage="${st.key}"></td>
      <td class="right"><input type="checkbox" data-stage="${st.key}" ${ (current.perc[st.key] ?? 0) > 0 ? 'checked' : '' }></td>
    `;
    tbody.appendChild(tr);
  }

  // 2. Hodinová sazba
  const { rateMode, rateCustom } = current;
  if (rateMode === 'custom') {
    el('rateCustom').checked = true;
    el('hourlyRate').disabled = false;
    el('hourlyRate').value = rateCustom || '';
  } else {
    el('rateUnika').checked = true;
    el('hourlyRate').disabled = true;
    el('hourlyRate').value = getUnikaRate(typeKey);
  }
  
  // 3. Jednotkové ceny (pouze FIXNÍ části)
  const uc = current.unitCosts;
  el('cFveFixed').value = uc.cFveFixed;
  el('cBessFixed').value = uc.cBessFixed;
  el('balancePct').value = uc.balancePct ?? 0;
}


function getTypeKey() { return el('type2').value || el('type').value; }
function setTypeKey(key) { if (el('type')) el('type').value = key; if (el('type2')) el('type2').value = key; CONFIG.last.typeKey = key; }

function gatherPercents() {
  const rows = el('stagesBody').querySelectorAll('tr');
  const out = {}; const include = {};
  rows.forEach(r => {
    const pct = num(r.querySelector('input[type="number"]').value || '0');
    const stage = r.querySelector('input[type="number"]').dataset.stage;
    const on = r.querySelector('input[type="checkbox"]').checked;
    out[stage] = pct; include[stage] = on;
  });
  return { perc: out, include };
}

function getUnikaRate(typeKey) {
  return UNIKA_RATES[typeKey] ?? 1200;
}

function getRateForCalc() {
  const typeKey = getTypeKey();
  const t = CONFIG.types[typeKey];
  if (!t) return 1200;
  if (t.rateMode === 'custom') {
    return num(t.rateCustom);
  }
  return getUnikaRate(typeKey);
}

// NOVÁ POMOCNÁ FUNKCE pro výpočet ceny z "daňových pásem"
function calculateTieredPrice(quantity, tiers) {
  if (!tiers || tiers.length === 0) return 0;
  let totalCost = 0;
  let processedQty = 0;

  for (const tier of tiers) {
    if (quantity <= processedQty) {
      break; 
    }
    
    const tierLimit = (tier.upTo === Infinity) ? Infinity : tier.upTo;
    const qtyInThisTier = Math.min(quantity - processedQty, tierLimit - processedQty);
    
    if (qtyInThisTier > 0) {
      totalCost += qtyInThisTier * tier.price;
      processedQty += qtyInThisTier;
    }
  }
  return totalCost;
}

// UPRAVENÁ FUNKCE pro výpočet CIS
function currentCIS() {
  const cisMode = getCisMode();
  const typeKey = getTypeKey();
  const typeConfig = CONFIG.types[typeKey] || DEFAULTS.PRU;

  if (cisMode === 'manual') {
    const cis = num(el('cis').value);
    return { totalValue: cis, priceFve: cis, priceBess: 0, note: 'Ručně zadáno' };
  }
  
  // model
  const kWp = num(el('fveKwp').value);
  const kWh = num(el('bessKwh').value);
  
  // Načteme konfigurační data z UI (fixní) a z DEFAULTS (tiers)
  const cFveFix = num(el('cFveFixed').value);
  const cBessFix = num(el('cBessFixed').value);
  const bal = num(el('balancePct').value);
  
  const fveTiers = typeConfig.unitCosts.cFveTiers;
  const bessTiers = typeConfig.unitCosts.cBessTiers;

  // Základní ceny
  const priceFve_var = calculateTieredPrice(kWp, fveTiers);
  const priceBess_var = calculateTieredPrice(kWh, bessTiers);

  const priceFve_base = (kWp > 0) ? (cFveFix + priceFve_var) : 0;
  const priceBess_base = (kWh > 0) ? (cBessFix + priceBess_var) : 0;

  const balFactor = (1 + bal / 100);
  const priceFve_final = priceFve_base * balFactor;
  const priceBess_final = priceBess_base * balFactor;

  const totalCIS = priceFve_final + priceBess_final;

  // Poznámka pro KPI - zjednodušená
  let note = `Odhad: FVE ${fmtCZK(priceFve_base)} + BESS ${fmtCZK(priceBess_base)}${bal ? ` + ${bal}% BoP` : ''}`;

  return {
    totalValue: totalCIS,
    priceFve: priceFve_final,
    priceBess: priceBess_final,
    note: note
  };
}

function getCisMode() {
  return (el('cisModeManual').checked) ? 'manual' : 'model';
}

// UPRAVENÁ FUNKCE - přidání varování
function calculate() {
  const { perc, include } = gatherPercents();
  const typeKey = getTypeKey();
  if (!CONFIG.types[typeKey]) return;

  const cisObj = currentCIS();
  const totalCIS = cisObj.totalValue;
  let calculationBase = 0;

  // Varování
  const warningEl = el('calcWarning');
  warningEl.textContent = '';
  warningEl.style.display = 'none';
  let warningText = '';

  if (getCisMode() === 'model') {
    const kWp = num(el('fveKwp').value);
    const kWh = num(el('bessKwh').value);
    const industrialTypes = ['PRU', 'BROWN', 'BESS'];

    if (industrialTypes.includes(typeKey)) {
      const isTooSmall = (kWp > 0 && kWp < 50) || (kWh > 0 && kWh < 100);
      if (isTooSmall) {
        warningText = 'Varování: Zadaný výkon/kapacita je velmi nízká pro "Průmyslový" typ. Výsledná CIS může být nerealisticky vysoká kvůli fixním nákladům.';
      }
    } else if (typeKey === 'RD') {
      if (kWp > 50) {
        warningText = 'Varování: Zadaný výkon FVE (> 50 kWp) je vysoký pro "Rodinný dům". Zvažte použití typu "Průmyslový objekt".';
      }
      if (kWh > 100) {
        warningText = 'Varování: Zadaná kapacita BESS (> 100 kWh) je vysoká pro "Rodinný dům". Zvažte použití jiného typu.';
      }
    }
    
    if (warningText) {
      warningEl.textContent = warningText;
      warningEl.style.display = 'block';
    }
  }

  // Základ výpočtu
  if (typeKey === 'RD') {
    calculationBase = cisObj.priceFve;
  } else {
    calculationBase = totalCIS;
  }
  
  const coef = num(el('coef').value);
  const reserve = 0; 
  const hourlyRate = getRateForCalc();
  const hourlyCoef = num(el('hourlyCoef').value);

  // Výsledky
  const resultBody = el('resultBody'); resultBody.innerHTML = '';
  let totalPrice = 0, totalHours = 0;

  for (const st of STAGES) {
    const p = (include[st.key] ? (perc[st.key] || 0) : 0);
    const pricePercent = (calculationBase * (p / 100)) * coef * (1 + reserve / 100);
    const hoursBudget = (hourlyRate > 0 && hourlyCoef > 0) ? (pricePercent / (hourlyRate * hourlyCoef)) : 0;

    if (include[st.key] && p > 0) {
      totalPrice += pricePercent;
      totalHours += hoursBudget;
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${st.name}</td>
      <td class="right">${p.toLocaleString('cs-CZ', { maximumFractionDigits: 2 })}%</td>
      <td class="right">${fmtCZK(pricePercent)}</td>
      <td class="right">${hoursBudget.toLocaleString('cs-CZ', { maximumFractionDigits: 1 })}</td>`;
    resultBody.appendChild(tr);
  }

  // KPI
  el('kpiCis').textContent = fmtCZK(totalCIS); 
  el('kpiCisNote').textContent = cisObj.note || '';
  el('kpiCoef').textContent = `${coef.toLocaleString('cs-CZ', { maximumFractionDigits: 2 })} × ${hourlyCoef.toLocaleString('cs-CZ', { maximumFractionDigits: 2 })} (${CONFIG.types[typeKey].rateMode === 'unika' ? 'UNIKA' : 'Vlastní'}: ${fmtCZK(hourlyRate)}/h)`;
  el('kpiTotal').textContent = fmtCZK(totalPrice);
  el('resultSum').textContent = fmtCZK(totalPrice);
  el('resultHours').textContent = totalHours.toLocaleString('cs-CZ', { maximumFractionDigits: 1 });
}

function openNewTypeDialog(targetSelectId) {
  const tpl = el('typeDialogTpl');
  const node = tpl.content.cloneNode(true);
  document.body.appendChild(node);
  const dlg = document.body.lastElementChild;
  const tbody = dlg.querySelector('#newTypePerc'); tbody.innerHTML = '';

  for (const st of STAGES) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${st.name}</td><td class="right"><input type="number" step="0.1" min="0" max="100" value="0" data-stage="${st.key}"/></td>`;
    tbody.appendChild(tr);
  }
  dlg.querySelector('#cancelType').onclick = () => dlg.remove();
  dlg.querySelector('#confirmType').onclick = () => {
    const name = dlg.querySelector('#newTypeName').value?.trim();
    if (!name) { alert('Zadejte název typu.'); return; }
    const key = name.toUpperCase().normalize('NFD').replace(/[^A-Z0-9]+/g, '').slice(0, 6) || `TYP${Math.random().toString(36).slice(2, 6)}`;
    const perc = {};
    dlg.querySelectorAll('input[data-stage]').forEach(i => perc[i.dataset.stage] = num(i.value || '0'));
    // Přiřadit výchozí hodnoty z "PRU" pro nový typ
    CONFIG.types[key] = { 
      label: name, 
      perc, 
      rateMode: 'unika', 
      rateCustom: 1200, 
      unitCosts: structuredClone(BASE_UNIT_COSTS.PRU) 
    };
    saveConfig(CONFIG);
    populateTypeSelects();
    setTypeKey(key);
    populateTypeConfig(key);
    calculate();
    dlg.remove();
  };
}

// UPRAVENO: Načte VŠE (procenta, sazby, JEDNOTKOVÉ CENY)
function syncTypeSelects(e) {
  const key = e.target.value;
  setTypeKey(key);
  populateTypeConfig(key); 
  calculate();
}

function onRateModeChange() {
  const typeKey = getTypeKey();
  const t = CONFIG.types[typeKey];
  const mode = el('rateCustom').checked ? 'custom' : 'unika';
  t.rateMode = mode;
  if (mode === 'custom') {
    el('hourlyRate').disabled = false;
  } else {
    el('hourlyRate').disabled = true;
    el('hourlyRate').value = getUnikaRate(typeKey);
  }
  calculate();
}

function onHourlyRateInput() {
  const typeKey = getTypeKey();
  const t = CONFIG.types[typeKey];
  t.rateCustom = num(el('hourlyRate').value);
  recalcDebounced();
}

function onCisModeChange() {
  const mode = getCisMode();
  CONFIG.last.cisMode = mode;
  el('modelBlock').style.display = (mode === 'model') ? '' : 'none';
  el('manualBlock').style.display = (mode === 'manual') ? '' : 'none';
  saveConfig(CONFIG);
  calculate();
}

// UPRAVENO: Ukládá procenta, sazby a FIXNÍ jednotkové ceny
function saveDefaults() {
  const key = getTypeKey();
  if (!CONFIG.types[key]) return;
  
  const { perc } = gatherPercents();
  CONFIG.types[key].perc = perc;
  
  // Sazby
  CONFIG.types[key].rateMode = el('rateCustom').checked ? 'custom' : 'unika';
  if (CONFIG.types[key].rateMode === 'custom') {
    CONFIG.types[key].rateCustom = num(el('hourlyRate').value);
  }
  
  // POUZE FIXNÍ JEDNOTKOVÉ CENY (Tiers se berou z DEFAULTS)
  CONFIG.types[key].unitCosts.cFveFixed = num(el('cFveFixed').value);
  CONFIG.types[key].unitCosts.cBessFixed = num(el('cBessFixed').value);
  CONFIG.types[key].unitCosts.balancePct = num(el('balancePct').value);

  saveConfig(CONFIG);
  alert('Uloženo: Kompletní nastavení pro typ "' + CONFIG.types[key].label + '"');
}

el('resetConfig').addEventListener('click', () => {
  if (confirm('Smazat uložené nastavení a načíst nové výchozí hodnoty?')) {
    localStorage.removeItem(LS_KEY);
    CONFIG = loadConfig();
    populateTypeSelects();
    const key = getTypeKey();
    populateTypeConfig(key);
    // Také resetujeme poslední zadané kWp/kWh
    el('fveKwp').value = '';
    el('bessKwh').value = '';
    CONFIG.last.modelParams = { fveKwp: 0, bessKwh: 0 };
    saveConfig(CONFIG);
    calculate();
  }
});

// UPRAVENO: Funkce tisku (bez velkých změn, jen kosmetika)
function printOffer() {
  const typeKey = getTypeKey();
  const typeLabel = CONFIG.types[typeKey]?.label || typeKey;

  const { perc, include } = gatherPercents();
  const cisObj = currentCIS();
  
  const totalCIS = cisObj.totalValue;
  let calculationBase = 0;
  if (typeKey === 'RD') {
    calculationBase = cisObj.priceFve;
  } else {
    calculationBase = totalCIS;
  }

  const coef = num(el('coef').value);
  const hourlyCoef = num(el('hourlyCoef').value);
  const rateMode = CONFIG.types[typeKey].rateMode;
  const hourlyRate = getRateForCalc();
  const reserve = 0; 
  const warningText = el('calcWarning').textContent;

  let html = `<!doctype html><html lang="cs"><head><meta charset="utf-8"><title>Nabídka PD</title>
    <style>
      body{font-family:system-ui,Segoe UI,Roboto; margin:40px;}
      h1{margin:0 0 6px;}
      .muted{color:#475569}
      table{width:100%; border-collapse:collapse; margin-top:16px}
      th,td{border-bottom:1px solid #e2e8f0; padding:8px 6px; text-align:left}
      tfoot th{text-align:right}
      .right{text-align:right}
      .total{font-weight:800}
      .note{margin-top:10px; color:#475569; font-size:12px}
      .print-warning{color: #d97706; font-weight: bold; padding: 8px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 4px; margin-top: 10px;}
    </style></head><body>`;

  html += `<h1>Nabídka – projektová dokumentace</h1>`;
  html += `<div class="muted">Typ: <b>${typeLabel}</b> | CIS: <b>${fmtCZK(totalCIS)}</b> | Koef.: <b>${coef}</b> | Koef. profese: <b>${hourlyCoef}</b></div>`;
  html += `<div class="muted">Sazba: <b>${rateMode === 'unika' ? 'UNIKA' : 'Vlastní'}</b> (${fmtCZK(hourlyRate)}/h)${cisObj.note ? ` | ${cisObj.note}` : ''}</div>`;

  if (warningText) {
    html += `<div class="print-warning">${warningText}</div>`;
  }

  html += `<table><thead>
    <tr>
      <th>Stupeň</th>
      <th class='right'>% z CIS</th>
      <th class='right'>Cena (Kč)</th>
      <th class='right'>Hodinový limit (h)</th>
    </tr>
  </thead><tbody>`;

  let sum = 0, sumHours = 0;
  for (const st of STAGES) {
    if (!include[st.key]) continue;
    const p = perc[st.key] || 0;
    const price = (calculationBase * (p / 100)) * coef * (1 + reserve / 100);
    const hours = (hourlyRate > 0 && hourlyCoef > 0) ? (price / (hourlyRate * hourlyCoef)) : 0;
    sum += price; sumHours += hours;
    html += `<tr>
      <td>${st.name}</td>
      <td class='right'>${p.toLocaleString('cs-CZ', { maximumFractionDigits: 2 })}%</td>
      <td class='right'>${fmtCZK(price)}</td>
      <td class='right'>${hours.toLocaleString('cs-CZ', { maximumFractionDigits: 1 })}</td>
    </tr>`;
  }
  html += `</tbody><tfoot>
    <tr>
      <th class='right' colspan='2'>Součet</th>
      <th class='right total'>${fmtCZK(sum)}</th>
      <th class='right total'>${sumHours.toLocaleString('cs-CZ', { maximumFractionDigits: 1 })}</th>
    </tr>
  </tfoot></table>`;

  html += `<p class='note'>Pozn.: Orientační nabídka bez DPH. Platnost 14 dní, pokud není uvedeno jinak.</p>`;
  html += `</body></html>`;

  const w = window.open('about:blank', '_blank');
  if (!w) { alert('Prohlížeč zablokoval nové okno. Povolit vyskakovací okna pro tuto stránku.'); return; }
  w.document.open(); w.document.write(html); w.document.close();
  w.onload = () => { w.focus(); w.print(); };
}

// ---------- Init ----------
// UPRAVENO: DOMContentLoaded - zjednodušené listenery
window.addEventListener('DOMContentLoaded', () => {
  el('appVer').textContent = `Verze ${APP_VER}`;
  el('year').textContent = new Date().getFullYear();

  populateTypeSelects();
  const key = getTypeKey();
  populateTypeConfig(key); // Načte % i jednotkové ceny

  if (CONFIG.last?.cisMode === 'manual') { el('cisModeManual').checked = true; }
  onCisModeChange(); 

  const mp = CONFIG.last.modelParams || { fveKwp: 0, bessKwh: 0 };
  el('fveKwp').value = mp.fveKwp || '';
  el('bessKwh').value = mp.bessKwh || '';

  calculate();

  // Eventy
  el('type').addEventListener('change', syncTypeSelects);
  el('type2').addEventListener('change', syncTypeSelects);
  el('addType').addEventListener('click', () => openNewTypeDialog('type'));
  el('addType2').addEventListener('click', () => openNewTypeDialog('type2'));

  el('rateUnika').addEventListener('change', onRateModeChange);
  el('rateCustom').addEventListener('change', onRateModeChange);
  el('hourlyRate').addEventListener('input', onHourlyRateInput);

  el('cisModeManual').addEventListener('change', onCisModeChange);
  el('cisModeModel').addEventListener('change', onCisModeChange);

  // Pole, která jen přepočítávají (ukládají se jen přes "Uložit nastavení")
  ['cis', 'coef', 'hourlyCoef', 'cFveFixed', 'cBessFixed', 'balancePct']
    .forEach(id => { const n = el(id); if (n) n.addEventListener('input', recalcDebounced); });
  
  // Pole, která přepočítávají A zárověň se automaticky ukládají (poslední parametry)
  ['fveKwp', 'bessKwh']
    .forEach(id => { 
        const n = el(id); 
        if (n) {
            n.addEventListener('input', recalcDebounced);
            n.addEventListener('input', saveLastParamsDebounced); 
        }
    });

  el('stagesBody').addEventListener('input', (e) => { if (e.target.matches('input')) recalcDebounced(); });

  el('calculate').addEventListener('click', calculate);
  el('saveDefaults').addEventListener('click', saveDefaults);
  el('printOffer').addEventListener('click', printOffer);
});