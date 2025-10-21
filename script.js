// ---------- Helpers ----------
const APP_VER = '1.3.0'; // Nová verze
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

const UNIKA_RATES = {
  'RD': 700, 'BD': 700, 'PRU': 1200, 'BESS': 1200, 'BROWN': 1200,
};

// Ceny FVE/BESS
const BASE_UNIT_COSTS = {
  RD: {
    cFveFixed: 50000, cFveTiers: [{ upTo: Infinity, price: 30000 }],
    cBessFixed: 0, cBessTiers: [{ upTo: Infinity, price: 15000 }],
    balancePct: 0
  },
  BD: {
    cFveFixed: 50000, cFveTiers: [{ upTo: 50, price: 30000 }, { upTo: Infinity, price: 26000 }],
    cBessFixed: 0, cBessTiers: [{ upTo: 100, price: 15000 }, { upTo: Infinity, price: 8000 }],
    balancePct: 0
  },
  PRU: {
    cFveFixed: 500000, cFveTiers: [{ upTo: 100, price: 24000 }, { upTo: 500, price: 22000 }, { upTo: 2000, price: 15000 }, { upTo: Infinity, price: 15000 }],
    cBessFixed: 3000000, cBessTiers: [{ upTo: 500, price: 8000 }, { upTo: 2000, price: 6000 }, { upTo: Infinity, price: 4500 }],
    balancePct: 0
  },
  BESS: {
    cFveFixed: 0, cFveTiers: [],
    cBessFixed: 1000000, cBessTiers: [{ upTo: 500, price: 6500 }, { upTo: 2000, price: 4500 }, { upTo: 50000, price: 3500 }, { upTo: 250000, price: 2500 }, { upTo: Infinity, price: 2000 }],
    balancePct: 0
  },
  BROWN: {
    cFveFixed: 3500000, cFveTiers: [{ upTo: 100, price: 24000 }, { upTo: 500, price: 22000 }, { upTo: 2000, price: 15000 },  { upTo: 10000, price: 13000 }, { upTo: 20000, price: 12000 }, { upTo: Infinity, price: 10000 }],
    cBessFixed: 3000000, cBessTiers: [{ upTo: 500, price: 8000 }, { upTo: 2000, price: 6000 }, { upTo: Infinity, price: 4500 }],
    balancePct: 0
  },
};

// VÝCHOZÍ NASTAVENÍ TYPŮ
const DEFAULTS = {
  'RD': {
    label: 'Rodinný dům (RD)',
    perc: { STU: 0.0, DUR: 0.0, DSP: 0.0, DPS: 3.3, AD: 0.0 }, // Poměry
    rateMode: 'unika', rateCustom: 700,
    unitCosts: BASE_UNIT_COSTS.RD,
    pdPriceTiers: [ // Odstupňovaná cena PD (zde lineární)
      { upTo: Infinity, price: 0.033 } // 3.7%
    ]
  },
  'BD': {
    label: 'Bytový dům (BD)',
    perc: { STU: 0.5, DUR: 0.0, DSP: 0.0, DPS: 3.3, AD: 0.0 }, // Součet 3.8
    rateMode: 'unika', rateCustom: 700,
    unitCosts: BASE_UNIT_COSTS.BD,
    pdPriceTiers: [
      { upTo: 50000000, price: 0.038 }, // 3.8%
      { upTo: Infinity, price: 0.025 } // 2.5%
    ]
  },
  'PRU': {
    label: 'Průmyslový objekt',
    perc: { STU: 0.1, DUR: 0.35, DSP: 0.8, DPS: 1.5, AD: 0.3 }, // Součet 3.1
    rateMode: 'unika', rateCustom: 1200,
    unitCosts: BASE_UNIT_COSTS.PRU,
    pdPriceTiers: [
      { upTo: 50000000, price: 0.031 },   // 3.1%
      { upTo: 200000000, price: 0.025 },  // 2.5%
      { upTo: 1000000000, price: 0.020 }, // 2.0%
      { upTo: Infinity, price: 0.015 }    // 1.5%
    ]
  },
  'BESS': {
    label: 'BESS (samostatná)',
    perc: { STU: 0.1, DUR: 0.35, DSP: 0.8, DPS: 1.5, AD: 0.1 }, // Součet 2.85
    rateMode: 'unika', rateCustom: 1200,
    unitCosts: BASE_UNIT_COSTS.BESS,
    pdPriceTiers: [
      { upTo: 50000000, price: 0.029 },   // 2.85%
      { upTo: 200000000, price: 0.021 },  // 2.1%
      { upTo: 1000000000, price: 0.012 }, // 1.2%
      { upTo: Infinity, price: 0.010 }    // 1.0%
    ]
  },
  'BROWN': {
    label: 'Brownfield',
    perc: { STU: 0.2, DUR: 0.35, DSP: 1.0, DPS: 1.4, AD: 0.2 }, // Součet 3.15
    rateMode: 'unika', rateCustom: 1200,
    unitCosts: BASE_UNIT_COSTS.BROWN,
    pdPriceTiers: [
      { upTo: 50000000, price: 0.0315 },   // 3.15%
      { upTo: 200000000, price: 0.025 },  // 2.5%
      { upTo: 1000000000, price: 0.018 }, // 1.8%
      { upTo: Infinity, price: 0.015 }    // 1.5%
    ]
  },
};


const LS_KEY = 'pd_calc_config_v130'; // NOVÝ KLÍČ pro v1.3.0

// ---------- Local storage ----------
// PŘEPSANÁ LOGIKA: Vždy bere 'pdPriceTiers' z DEFAULTS, ale zachová uživatelské 'perc' atd.
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

    // Nový, robustnější merge
    const mergedTypes = {};
    for (const k of Object.keys(DEFAULTS)) {
      if (!cfg.types[k]) {
        // Uživatel tento typ nemá (nově přidaný), vezme se celý default
        mergedTypes[k] = structuredClone(DEFAULTS[k]);
      } else {
        // Typ existuje, sloučíme
        const userType = cfg.types[k];
        const defaultType = DEFAULTS[k];

        mergedTypes[k] = structuredClone(defaultType); // Začneme s novým defaultem (hlavně kvůli 'pdPriceTiers')

        // Přepíšeme hodnotami od uživatele
        mergedTypes[k].perc = { ...defaultType.perc, ...userType.perc };
        mergedTypes[k].rateMode = userType.rateMode ?? defaultType.rateMode;
        mergedTypes[k].rateCustom = userType.rateCustom ?? defaultType.rateCustom;

        // Přepíšeme fixní náklady z 'unitCosts'
        if (userType.unitCosts) {
          mergedTypes[k].unitCosts.cFveFixed = userType.unitCosts.cFveFixed ?? defaultType.unitCosts.cFveFixed;
          mergedTypes[k].unitCosts.cBessFixed = userType.unitCosts.cBessFixed ?? defaultType.unitCosts.cBessFixed;
          mergedTypes[k].unitCosts.balancePct = userType.unitCosts.balancePct ?? defaultType.unitCosts.balancePct;
        }
      }
    }
    // Přidáme i typy, které si uživatel vytvořil sám a v DEFAULTS nejsou
    for (const k of Object.keys(cfg.types)) {
      if (!mergedTypes[k]) {
        mergedTypes[k] = cfg.types[k];
        // Pojistka, kdyby mu chyběly 'pdPriceTiers', dáme mu defaultní z PRU
        mergedTypes[k].pdPriceTiers ??= structuredClone(DEFAULTS.PRU.pdPriceTiers);
      }
    }

    base.types = mergedTypes;
    base.last = { ...base.last, ...cfg.last };

    return base;
  } catch (e) {
    console.error("Chyba při načítání konfigurace:", e);
    // V případě chyby vrátíme tvrdý default
    return {
      types: structuredClone(DEFAULTS),
      last: { typeKey: 'PRU', rateMode: 'unika', cisMode: 'model', modelParams: { fveKwp: 0, bessKwh: 0 } }
    };
  }
}
function saveConfig(cfg) { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); }

let CONFIG = loadConfig();

// ---------- UI populate ----------
function populateTypeSelects() {
  const s1 = el('projectType');
  const entries = Object.entries(CONFIG.types);
  s1.innerHTML = '';
  for (const [key, obj] of entries) {
    const opt = document.createElement('option');
    opt.value = key; opt.textContent = obj.label;
    s1.appendChild(opt);
  }

  if (CONFIG.last?.typeKey && CONFIG.types[CONFIG.last.typeKey]) {
    s1.value = CONFIG.last.typeKey;
  } else {
    s1.selectedIndex = 0;
    CONFIG.last.typeKey = s1.value;
  }
}

// UPRAVENO: Volá i updateRatioSummary
function populateTypeConfig(typeKey) {
  const tbody = el('stagesBody');
  tbody.innerHTML = '';
  const current = CONFIG.types[typeKey];
  if (!current) {
    console.error("Neznámý typ stavby:", typeKey);
    return;
  }

  // 1. Poměry (dříve procenta)
  for (const st of STAGES) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${st.name}</td>
      <td class="right"><input type="number" step="0.1" min="0" max="100" value="${current.perc[st.key] ?? 0}" data-stage="${st.key}"></td>
      <td class="right"><input type="checkbox" data-stage="${st.key}" ${(current.perc[st.key] ?? 0) > 0 ? 'checked' : ''}></td>
    `;
    tbody.appendChild(tr);
  }

  // 2. Hodinová sazba
  const { rateMode, rateCustom } = current;
  const hourlyRateEl = el('hourlyRate'); // Získáme element
  if (rateMode === 'custom') {
    el('rateCustom').checked = true;
    hourlyRateEl.disabled = false;
    hourlyRateEl.value = rateCustom || '';
    hourlyRateEl.classList.add('input-primary'); // <-- PŘIDÁNO ZVÝRAZNĚNÍ
  } else {
    el('rateUnika').checked = true;
    hourlyRateEl.disabled = true;
    hourlyRateEl.value = getUnikaRate(typeKey);
    hourlyRateEl.classList.remove('input-primary'); // <-- PŘIDÁNO ODEBRÁNÍ ZVÝRAZNĚNÍ
  }

  // 3. Jednotkové ceny (pouze FIXNÍ části)
  el('balancePct').value = current.unitCosts.balancePct ?? 0;

  // 4. Aktualizovat součet poměrů
  updateRatioSummary();
}


function getTypeKey() { return el('projectType').value; }
function setTypeKey(key) {
  el('projectType').value = key;
  CONFIG.last.typeKey = key;
}

function gatherPercents() {
  const rows = el('stagesBody').querySelectorAll('tr');
  const out = {}; const include = {};
  let totalRatio = 0;
  rows.forEach(r => {
    const pct = num(r.querySelector('input[type="number"]').value || '0');
    const stage = r.querySelector('input[type="number"]').dataset.stage;
    const on = r.querySelector('input[type="checkbox"]').checked;
    out[stage] = pct;
    include[stage] = on;
    if (on) {
      totalRatio += pct;
    }
  });
  return { perc: out, include, totalRatio };
}

// NOVÁ FUNKCE: Aktualizuje součet poměrů v UI
function updateRatioSummary() {
  const { totalRatio } = gatherPercents();
  el('stagesTotalRatio').textContent = totalRatio.toLocaleString('cs-CZ', { maximumFractionDigits: 2 });
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

function calculateTieredPrice(quantity, tiers) {
  if (!tiers || tiers.length === 0) return 0;
  let totalCost = 0;
  let processedQty = 0;

  for (const tier of tiers) {
    if (quantity <= processedQty) {
      break;
    }

    // Hranice tohoto stupně (např. 50M)
    const tierLimit = (tier.upTo === Infinity) ? Infinity : tier.upTo;
    // Množství, které spadá do tohoto stupně
    const qtyInThisTier = Math.min(quantity - processedQty, tierLimit - processedQty);

    if (qtyInThisTier > 0) {
      totalCost += qtyInThisTier * tier.price;
      processedQty += qtyInThisTier;
    }
  }
  return totalCost;
}

function currentInvestment() {
  const cisMode = getCisMode();
  const typeKey = getTypeKey();
  const typeConfig = CONFIG.types[typeKey] || DEFAULTS.PRU;

  if (cisMode === 'manual') {
    const investment = num(el('cis').value);
    return { totalValue: investment, priceFve: investment, priceBess: 0, note: 'Ručně zadáno' };
  }

  const kWp = num(el('fveKwp').value);
  const kWh = num(el('bessKwh').value);

  const cFveFix = num(typeConfig.unitCosts.cFveFixed);
  const cBessFix = num(typeConfig.unitCosts.cBessFixed);
  const bal = num(el('balancePct').value);

  const fveTiers = typeConfig.unitCosts.cFveTiers;
  const bessTiers = typeConfig.unitCosts.cBessTiers;

  const priceFve_var = calculateTieredPrice(kWp, fveTiers);
  const priceBess_var = calculateTieredPrice(kWh, bessTiers);

  const priceFve_base = (kWp > 0) ? (cFveFix + priceFve_var) : 0;
  const priceBess_base = (kWh > 0) ? (cBessFix + priceBess_var) : 0;

  const balFactor = (1 + bal / 100);
  const priceFve_final = priceFve_base * balFactor;
  const priceBess_final = priceBess_base * balFactor;

  const totalInvestment = priceFve_final + priceBess_final;

  let note = `Odhad: FVE ${fmtCZK(priceFve_base)} + BESS ${fmtCZK(priceBess_base)}${bal ? ` + ${bal}% ost.` : ''}`;

  return {
    totalValue: totalInvestment,
    priceFve: priceFve_final,
    priceBess: priceBess_final,
    note: note
  };
}

function getCisMode() {
  return (el('cisModeManual').checked) ? 'manual' : 'model';
}

// KOMPLETNĚ PŘEPSANÁ FUNKCE
function calculate() {
  const { perc, include, totalRatio } = gatherPercents();
  const typeKey = getTypeKey();
  if (!CONFIG.types[typeKey]) return;
  const typeConfig = CONFIG.types[typeKey];

  const investmentObj = currentInvestment();
  const totalInvestment = investmentObj.totalValue;
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
        warningText = 'Varování: Zadaný výkon/kapacita je velmi nízká pro "Průmyslový" typ. Výsledná investice může být nerealisticky vysoká kvůli fixním nákladům.';
      }
    } else if (typeKey === 'RD') {
      if (kWp > 50) warningText = 'Varování: Zadaný výkon FVE (> 50 kWp) je vysoký pro "Rodinný dům". Zvažte použití typu "Průmyslový objekt".';
      if (kWh > 100) warningText = 'Varování: Zadaná kapacita BESS (> 100 kWh) je vysoká pro "Rodinný dům". Zvažte použití jiného typu.';
    }

    if (warningText) {
      warningEl.textContent = warningText;
      warningEl.style.display = 'block';
    }
  }

  // 1. Zjistíme základ pro výpočet PD
  if (typeKey === 'RD') {
    calculationBase = investmentObj.priceFve;
  } else {
    calculationBase = totalInvestment;
  }

  // 2. Zjistíme "Koláč" (celkový rozpočet PD) pomocí odstupňovaných cen
  const pdTiers = typeConfig.pdPriceTiers;
  const totalPdBudget_Base = calculateTieredPrice(calculationBase, pdTiers);

  // 3. Zjistíme finální rozpočet PD (vynásobený koeficientem složitosti)
  const coef = num(el('coef').value);
  const reserve = 0; // Nepoužíváme
  const totalPdBudget_Final = totalPdBudget_Base * coef * (1 + reserve / 100);

  // 4. Připravíme sazby pro hodiny
  const hourlyRate = getRateForCalc();
  const hourlyCoef = num(el('hourlyCoef').value);

  // 5. Rozdělíme "Koláč" na jednotlivé stupně
  const resultBody = el('resultBody'); resultBody.innerHTML = '';
  let totalPrice = 0, totalHours = 0;
  const safeTotalRatio = (totalRatio === 0) ? 1 : totalRatio; // Ochrana proti dělení nulou

  for (const st of STAGES) {
    const ratio = (include[st.key] ? (perc[st.key] || 0) : 0);
    const ratioShare = ratio / safeTotalRatio; // Podíl tohoto stupně na celku

    const price = totalPdBudget_Final * ratioShare;
    const hoursBudget = (hourlyRate > 0 && hourlyCoef > 0) ? (price / (hourlyRate * hourlyCoef)) : 0;

    if (include[st.key] && ratio > 0) {
      totalPrice += price;
      totalHours += hoursBudget;
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${st.name}</td>
      <td class="right">${ratio.toLocaleString('cs-CZ', { maximumFractionDigits: 2 })}</td>
      <td class="right">${fmtCZK(price)}</td>
      <td class="right">${hoursBudget.toLocaleString('cs-CZ', { maximumFractionDigits: 1 })}</td>`;
    resultBody.appendChild(tr);
  }

  // 6. Aktualizujeme KPI
  el('kpiInvestment').textContent = fmtCZK(totalInvestment);
  el('kpiInvestmentNote').textContent = investmentObj.note || '';
  el('kpiTotal').textContent = fmtCZK(totalPrice); // totalPrice je součet, který odpovídá totalPdBudget_Final (pokud jsou všechny zaškrtnuté)
  el('kpiTotalNote').textContent = `Koeficient složitosti: ${coef}`;
  el('kpiHourlyRate').textContent = fmtCZK(hourlyRate);
  el('kpiHourlyRateNote').textContent = `Koeficient profese: ${hourlyCoef}`;
  el('resultSum').textContent = fmtCZK(totalPrice);
  el('resultHours').textContent = totalHours.toLocaleString('cs-CZ', { maximumFractionDigits: 1 });
}


function openNewTypeDialog() {
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

    // Nový typ zdědí všechna nastavení z PRU
    CONFIG.types[key] = {
      label: name,
      perc,
      rateMode: 'unika',
      rateCustom: 1200,
      unitCosts: structuredClone(BASE_UNIT_COSTS.PRU),
      pdPriceTiers: structuredClone(DEFAULTS.PRU.pdPriceTiers)
    };
    saveConfig(CONFIG);
    populateTypeSelects();
    setTypeKey(key);
    populateTypeConfig(key);
    calculate();
    dlg.remove();
  };
}

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
  const hourlyRateEl = el('hourlyRate'); // Získáme element
  t.rateMode = mode;
  if (mode === 'custom') {
    hourlyRateEl.disabled = false;
    hourlyRateEl.classList.add('input-primary'); // <-- PŘIDÁNO ZVÝRAZNĚNÍ
  } else {
    hourlyRateEl.disabled = true;
    hourlyRateEl.value = getUnikaRate(typeKey);
    hourlyRateEl.classList.remove('input-primary'); // <-- PŘIDÁNO ODEBRÁNÍ ZVÝRAZNĚNÍ
  }
  calculate();
}

function onHourlyRateInput() {
  const customRateValue = num(el('hourlyRate').value);
  const typeKey = getTypeKey();
  if (CONFIG.types[typeKey]) {
    CONFIG.types[typeKey].rateCustom = customRateValue;
  }
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

// UPRAVENO: Ukládá poměry, sazby a FIXNÍ jednotkové ceny
function saveDefaults() {
  const key = getTypeKey();
  if (!CONFIG.types[key]) return;

  const { perc } = gatherPercents();
  CONFIG.types[key].perc = perc;

  CONFIG.types[key].rateMode = el('rateCustom').checked ? 'custom' : 'unika';
  if (CONFIG.types[key].rateMode === 'custom') {
    CONFIG.types[key].rateCustom = num(el('hourlyRate').value);
  }

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
    el('fveKwp').value = '';
    el('bessKwh').value = '';
    CONFIG.last.modelParams = { fveKwp: 0, bessKwh: 0 };
    saveConfig(CONFIG);
    calculate();
  }
});

// KOMPLETNĚ PŘEPSANÁ FUNKCE TISKU
function printOffer() {
  const typeKey = getTypeKey();
  const typeLabel = CONFIG.types[typeKey]?.label || typeKey;
  const typeConfig = CONFIG.types[typeKey];

  const { perc, include, totalRatio } = gatherPercents();
  const investmentObj = currentInvestment();

  const totalInvestment = investmentObj.totalValue;
  let calculationBase = 0;
  if (typeKey === 'RD') {
    calculationBase = investmentObj.priceFve;
  } else {
    calculationBase = totalInvestment;
  }

  // Logika výpočtu z 'calculate' zkopírována 1:1
  const pdTiers = typeConfig.pdPriceTiers;
  const totalPdBudget_Base = calculateTieredPrice(calculationBase, pdTiers);

  const coef = num(el('coef').value);
  const reserve = 0;
  const totalPdBudget_Final = totalPdBudget_Base * coef * (1 + reserve / 100);

  const hourlyCoef = num(el('hourlyCoef').value);
  const rateMode = typeConfig.rateMode;
  const hourlyRate = getRateForCalc();
  const warningText = el('calcWarning').textContent;
  const safeTotalRatio = (totalRatio === 0) ? 1 : totalRatio;

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
  html += `<div class="muted">Typ: <b>${typeLabel}</b> | Odhad investice: <b>${fmtCZK(totalInvestment)}</b> | Koef. složitosti: <b>${coef}</b></div>`;
  html += `<div class="muted">Celkový rozpočet PD: <b>${fmtCZK(totalPdBudget_Final)}</b> (vypočteno z investice ${fmtCZK(calculationBase)})</div>`;
  html += `<div class="muted">Sazba: <b>${rateMode === 'unika' ? 'UNIKA' : 'Vlastní'}</b> (${fmtCZK(hourlyRate)}/h) | Koef. profese: <b>${hourlyCoef}</b></div>`;

  if (warningText) {
    html += `<div class="print-warning">${warningText}</div>`;
  }

  html += `<table><thead>
    <tr>
      <th>Stupeň</th>
      <th class='right'>Poměr (díl)</th>
      <th class='right'>Cena (Kč)</th>
      <th class='right'>Hodinový limit (h)</th>
    </tr>
  </thead><tbody>`;

  let sum = 0, sumHours = 0;
  for (const st of STAGES) {
    if (!include[st.key]) continue;

    const ratio = perc[st.key] || 0;
    const ratioShare = ratio / safeTotalRatio;
    const price = totalPdBudget_Final * ratioShare;

    const hours = (hourlyRate > 0 && hourlyCoef > 0) ? (price / (hourlyRate * hourlyCoef)) : 0;
    sum += price; sumHours += hours;
    html += `<tr>
      <td>${st.name}</td>
      <td class='right'>${ratio.toLocaleString('cs-CZ', { maximumFractionDigits: 2 })}</td>
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
window.addEventListener('DOMContentLoaded', () => {
  el('appVer').textContent = `Verze ${APP_VER}`;
  el('year').textContent = new Date().getFullYear();

  populateTypeSelects(); // Naplní JEDEN select
  const key = getTypeKey();
  populateTypeConfig(key); 

  if (CONFIG.last?.cisMode === 'manual') { el('cisModeManual').checked = true; }
  onCisModeChange(); 

  const mp = CONFIG.last.modelParams || { fveKwp: 0, bessKwh: 0 };
  el('fveKwp').value = mp.fveKwp || '';
  el('bessKwh').value = mp.bessKwh || '';

  calculate();

  // Eventy
  el('projectType').addEventListener('change', syncTypeSelects);
  el('addType').addEventListener('click', openNewTypeDialog);

  el('rateUnika').addEventListener('change', onRateModeChange);
  el('rateCustom').addEventListener('change', onRateModeChange);
  
  // ZMĚNA ZDE: Opraven listener pro hourlyRate, aby volal správnou funkci
  el('hourlyRate').addEventListener('input', onHourlyRateInput); 

  el('cisModeManual').addEventListener('change', onCisModeChange);
  el('cisModeModel').addEventListener('change', onCisModeChange);

  ['cis', 'coef', 'hourlyCoef', 'balancePct']
    .forEach(id => { const n = el(id); if (n) n.addEventListener('input', recalcDebounced); });
  
  ['fveKwp', 'bessKwh']
    .forEach(id => { 
        const n = el(id); 
        if (n) {
            n.addEventListener('input', recalcDebounced);
            n.addEventListener('input', saveLastParamsDebounced); 
        }
    });

  el('stagesBody').addEventListener('input', (e) => { 
    if (e.target.matches('input')) {
      recalcDebounced();
      updateRatioSummary(); 
    }
  });

  el('calculate').addEventListener('click', calculate);
  el('saveDefaults').addEventListener('click', saveDefaults);
  el('printOffer').addEventListener('click', printOffer);
});