    // ---------- Helpers ----------
    const APP_VER = '1.1.3';
    const el = (id) => document.getElementById(id);
    const num = (v) => parseFloat(String(v).replace(',', '.')) || 0;
    const fmtCZK = (n) => new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK', maximumFractionDigits: 0 }).format(n || 0);

    let __calcTimer = null;
    const recalcDebounced = () => { clearTimeout(__calcTimer); __calcTimer = setTimeout(calculate, 300); };

    let __saveTimer = null;
    const saveLastParamsDebounced = () => {
      clearTimeout(__saveTimer);
      __saveTimer = setTimeout(() => {
        // Uložíme jen poslední zadané parametry modelu (kWp, kWh), ne jednotkové ceny
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

    // Výchozí jednotkové ceny — startovní defaults
    // Přesunuto přímo do DEFAULTS, aby měl každý typ své vlastní
    const BASE_UNIT_COSTS = {
      RD: { cFveFixed: 50000, cFveKwpVar: 28000, cBessFixed: 200000, cBessKwh: 10000, balancePct: 0 },
      BD: { cFveFixed: 200000, cFveKwpVar: 26000, cBessFixed: 500000, cBessKwh: 8000, balancePct: 0 },
      PRU: { cFveFixed: 2000000, cFveKwpVar: 18000, cBessFixed: 5000000, cBessKwh: 3000, balancePct: 0 },
      BESS: { cFveFixed: 0, cFveKwpVar: 0, cBessFixed: 5000000, cBessKwh: 3000, balancePct: 0 },
      BROWN: { cFveFixed: 2000000, cFveKwpVar: 24000, cBessFixed: 5000000, cBessKwh: 3000, balancePct: 0 },
    };

    // Výchozí typy a procenta
    const DEFAULTS = {
      'RD': { label: 'Rodinný dům (RD)', perc: { STU: 0.0, DUR: 0.0, DSP: 0.0, DPS: 3.3, AD: 0.4 }, rateMode: 'unika', rateCustom: 700, unitCosts: BASE_UNIT_COSTS.RD },
      'BD': { label: 'Bytový dům (BD)', perc: { STU: 0.6, DUR: 0.6, DSP: 1.4, DPS: 2.0, AD: 0.5 }, rateMode: 'unika', rateCustom: 700, unitCosts: BASE_UNIT_COSTS.BD },
      'PRU': { label: 'Průmyslový objekt', perc: { STU: 0.4, DUR: 0.5, DSP: 1.0, DPS: 1.8, AD: 0.4 }, rateMode: 'unika', rateCustom: 1200, unitCosts: BASE_UNIT_COSTS.PRU },
      'BROWN': { label: 'Brownfield', perc: { STU: 0.4, DUR: 0.5, DSP: 1.2, DPS: 1.8, AD: 0.4 }, rateMode: 'unika', rateCustom: 1200, unitCosts: BASE_UNIT_COSTS.BROWN },
      'BESS': { label: 'BESS (samostatná)', perc: { STU: 0.3, DUR: 0.5, DSP: 0.9, DPS: 1.5, AD: 0.2 }, rateMode: 'unika', rateCustom: 1200, unitCosts: BASE_UNIT_COSTS.BESS },
    };


    const LS_KEY = 'pd_calc_config_v120'; // nový klíč pro v1.2.0

    // ---------- Local storage ----------
    function loadConfig() {
      try {
        const raw = localStorage.getItem(LS_KEY);
        const base = {
          types: structuredClone(DEFAULTS),
          // per-user poslední volby
          last: {
            typeKey: 'PRU', // Změněn výchozí typ na PRU
            rateMode: 'unika',
            cisMode: 'model',
            modelParams: { fveKwp: 0, bessKwh: 0 }
            // unitCosts se už neukládá do 'last', ale per typ
          }
        };
        if (!raw) return base;
        const cfg = JSON.parse(raw);
        // doplnit případné chybějící typy nebo vlastnosti
        for (const k of Object.keys(DEFAULTS)) {
          if (!cfg.types[k]) {
            cfg.types[k] = structuredClone(DEFAULTS[k]);
          } else {
            // Merge starých typů s novými properties (perc, rateMode, unitCosts)
            cfg.types[k].perc = { ...(DEFAULTS[k].perc || {}), ...(cfg.types[k].perc || {}) };
            cfg.types[k].rateMode ??= DEFAULTS[k].rateMode;
            cfg.types[k].rateCustom ??= DEFAULTS[k].rateCustom;
            cfg.types[k].unitCosts = { ...(DEFAULTS[k].unitCosts || {}), ...(cfg.types[k].unitCosts || {}) };
          }
        }
        cfg.last ??= base.last;
        // Vyčistit staré unitCosts z 'last', pokud existuje
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
      const s1 = el('type');   // ruční blok (je skrytý podle režimu)
      const s2 = el('type2');  // společný blok
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
      // nastavit poslední zvolený
      if (CONFIG.last?.typeKey && CONFIG.types[CONFIG.last.typeKey]) {
        s1.value = CONFIG.last.typeKey;
        s2.value = CONFIG.last.typeKey;
      } else {
        s1.selectedIndex = 0; s2.selectedIndex = 0;
        CONFIG.last.typeKey = s2.value;
      }
    }

    // Načte procenta do tabulky a nastaví režim sazeb
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
        const tdName = document.createElement('td'); tdName.textContent = st.name;
        const tdPct = document.createElement('td'); tdPct.className = 'right';
        const inp = document.createElement('input');
        inp.type = 'number'; inp.step = '0.1'; inp.min = '0'; inp.max = '100';
        inp.value = (current.perc[st.key] ?? 0);
        inp.dataset.stage = st.key;
        tdPct.appendChild(inp);
        const tdInclude = document.createElement('td'); tdInclude.className = 'right';
        const chk = document.createElement('input'); chk.type = 'checkbox';
        chk.checked = (current.perc[st.key] ?? 0) > 0; chk.dataset.stage = st.key;
        tdInclude.appendChild(chk);

        tr.appendChild(tdName); tr.appendChild(tdPct); tr.appendChild(tdInclude);
        tbody.appendChild(tr);
      }

      // 2. Hodinová sazba – režim
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
      
      // 3. Jednotkové ceny
      const uc = current.unitCosts || BASE_UNIT_COSTS[typeKey] || BASE_UNIT_COSTS.PRU; // Fallback
      el('cFveFixed').value = uc.cFveFixed;
      el('cFveKwpVar').value = uc.cFveKwpVar;
      el('cBessFixed').value = uc.cBessFixed;
      el('cBessKwh').value = uc.cBessKwh;
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
      if (!t) return 1200; // Fallback
      if (t.rateMode === 'custom') {
        return num(t.rateCustom);
      }
      return getUnikaRate(typeKey);
    }

    function currentCIS() {
      const cisMode = getCisMode();
      if (cisMode === 'manual') {
        const cis = num(el('cis').value);
        return { value: cis, note: 'Ručně zadáno' };
      }
      // model
      const kWp = num(el('fveKwp').value);
      const kWh = num(el('bessKwh').value);
      
      const cFveFix = num(el('cFveFixed').value);
      const cFveVar = num(el('cFveKwpVar').value);
      const cKWh = num(el('cBessKwh').value);
      const bal = num(el('balancePct').value);
      const fixed = num(el('cBessFixed').value);
      
      const priceFve = (kWp > 0) ? (cFveFix + (kWp * cFveVar)) : 0;
      const priceBess = (kWh > 0) ? (fixed + (kWh * cKWh)) : 0;
      
      const base = priceFve + priceBess;
      const cis = base * (1 + bal / 100);
      
      let note = `Odhad: FVE ${fmtCZK(cFveFix)} + ${kWp || 0} kWp × ${fmtCZK(cFveVar)} + BESS: ${fmtCZK(fixed)} + ${kWh || 0} kWh × ${fmtCZK(cKWh)}${bal ? ` + ${bal}% BoP` : ''}`;
      return { value: cis, note };
    }

    function getCisMode() {
      return (el('cisModeManual').checked) ? 'manual' : 'model';
    }

    function calculate() {
      const { perc, include } = gatherPercents();
      const typeKey = getTypeKey();
      if (!CONFIG.types[typeKey]) return; // Ochrana, pokud typ neexistuje

      const cisObj = currentCIS();
      const cis = cisObj.value;

      const coef = num(el('coef').value);
      const reserve = 0; // teď nepoužíváme zvláštní rezervu mimo BoP, případně lze vrátit pole
      const hourlyRate = getRateForCalc();
      const hourlyCoef = num(el('hourlyCoef').value);

      // výsledky
      const resultBody = el('resultBody'); resultBody.innerHTML = '';
      let totalPrice = 0, totalHours = 0;

      for (const st of STAGES) {
        const p = (include[st.key] ? (perc[st.key] || 0) : 0);
        const pricePercent = (cis * (p / 100)) * coef * (1 + reserve / 100);
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
      el('kpiCis').textContent = fmtCZK(cis);
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
        populateTypeConfig(key); // Načíst všechna nastavení
        calculate();
        dlg.remove();
      };
    }

    function syncTypeSelects(e) {
      const key = e.target.value;
      setTypeKey(key);
      populateTypeConfig(key); // Načte procenta, sazby I jednotkové ceny
      calculate();
    }

    function onRateModeChange() {
      const typeKey = getTypeKey();
      const t = CONFIG.types[typeKey];
      const mode = el('rateCustom').checked ? 'custom' : 'unika';
      t.rateMode = mode;
      if (mode === 'custom') {
        el('hourlyRate').disabled = false;
        // ponechat uložený rateCustom, nebo vyplnit aktuální hodnotu
      } else {
        el('hourlyRate').disabled = true;
        el('hourlyRate').value = getUnikaRate(typeKey);
      }
      // Neukládáme hned, uloží se až s 'saveDefaults'
      calculate();
    }

    function onHourlyRateInput() {
      const typeKey = getTypeKey();
      const t = CONFIG.types[typeKey];
      t.rateCustom = num(el('hourlyRate').value);
      // Neukládáme hned, uloží se až s 'saveDefaults'
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

    function saveDefaults() {
      const key = getTypeKey();
      if (!CONFIG.types[key]) return; // Ochrana
      
      const { perc } = gatherPercents();
      CONFIG.types[key].perc = perc;
      
      // sazby
      CONFIG.types[key].rateMode = el('rateCustom').checked ? 'custom' : 'unika';
      if (CONFIG.types[key].rateMode === 'custom') {
        CONFIG.types[key].rateCustom = num(el('hourlyRate').value);
      }
      
      // JEDNOTKOVÉ CENY
      CONFIG.types[key].unitCosts = {
        cFveFixed: num(el('cFveFixed').value),
        cFveKwpVar: num(el('cFveKwpVar').value),
        cBessFixed: num(el('cBessFixed').value),
        cBessKwh: num(el('cBessKwh').value),
        balancePct: num(el('balancePct').value)
      };

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
        calculate();
      }
    });

    function printOffer() {
      const typeKey = getTypeKey();
      const typeLabel = CONFIG.types[typeKey]?.label || typeKey;

      const { perc, include } = gatherPercents();
      const cisObj = currentCIS();
      const cis = cisObj.value;
      const coef = num(el('coef').value);
      const hourlyCoef = num(el('hourlyCoef').value);
      const rateMode = CONFIG.types[typeKey].rateMode;
      const hourlyRate = getRateForCalc();
      
      const reserve = 0; 

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
        </style></head><body>`;

      html += `<h1>Nabídka – projektová dokumentace</h1>`;
      html += `<div class="muted">Typ: <b>${typeLabel}</b> | CIS: <b>${fmtCZK(cis)}</b> | Koef.: <b>${coef}</b> | Koef. profese: <b>${hourlyCoef}</b></div>`;
      html += `<div class="muted">Sazba: <b>${rateMode === 'unika' ? 'UNIKA' : 'Vlastní'}</b> (${fmtCZK(hourlyRate)}/h)${cisObj.note ? ` | ${cisObj.note}` : ''}</div>`;

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
        const price = (cis * (p / 100)) * coef * (1 + reserve / 100);
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
    window.addEventListener('DOMContentLoaded', () => {
      el('appVer').textContent = `Verze ${APP_VER}`;
      el('year').textContent = new Date().getFullYear();

      // Naplnit selecty
      populateTypeSelects();
      // Načíst kompletní konfiguraci pro poslední zvolený typ
      const key = getTypeKey();
      populateTypeConfig(key);

      // Nastavit poslední režimy/parametry
      if (CONFIG.last?.cisMode === 'manual') { el('cisModeManual').checked = true; }
      onCisModeChange(); // schová/ukáže bloky

      // Načíst poslední zadané parametry modelu
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
      ['cis', 'coef', 'hourlyCoef', 'cFveFixed', 'cFveKwpVar', 'cBessFixed', 'cBessKwh', 'balancePct']
        .forEach(id => { const n = el(id); if (n) n.addEventListener('input', recalcDebounced); });
      
      // Pole, která přepočítávají A zárověň se automaticky ukládají (poslední parametry)
      ['fveKwp', 'bessKwh']
        .forEach(id => { 
            const n = el(id); 
            if (n) {
                n.addEventListener('input', recalcDebounced);
                n.addEventListener('input', saveLastParamsDebounced); // Automatické ukládání
            }
        });

      // procenta ve stupních
      el('stagesBody').addEventListener('input', (e) => { if (e.target.matches('input')) recalcDebounced(); });

      el('calculate').addEventListener('click', calculate);
      el('saveDefaults').addEventListener('click', saveDefaults);
      el('printOffer').addEventListener('click', printOffer);
    });