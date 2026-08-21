/**
 * マルチ口座 資産運用シミュレーター PRO (Wealth Simulator Pro)
 * Core Logic & Simulation Engine
 */

// ============================================================================
// State Management
// ============================================================================
const DEFAULT_STATE = {
  currentAge: 35,
  accounts: {
    taxable: {
      initial: 100,      // 万円
      monthly: 2.0,      // 万円/月
      rate: 5.0,         // %/年
      endAge: 60         // 歳まで積立
    },
    oldNisa: {
      initial: 200,      // 万円
      rate: 5.0,         // %/年
      transferAge: 40    // 歳時点で特定口座へ非課税移管
    },
    newNisa: {
      initial: 300,      // 万円
      monthly: 5.0,      // 万円/月
      rate: 5.0,         // %/年
      endAge: 60         // 歳まで積立 (上限1,800万)
    },
    dc: {
      initial: 150,      // 万円
      monthly: 2.3,      // 万円/月
      rate: 4.5,         // %/年
      endAge: 60,        // 歳まで拠出
      receiveAge: 60,    // 歳で退職金受取
      yearsPast: 5       // これまでの拠出年数
    },
    stock: {
      initial: 200,      // 万円
      monthly: 0.0,      // 万円/月
      rate: 4.0          // %/年 (原則取崩し対象外)
    }
  },
  pension: {
    startAge: 65,        // 歳から受給開始
    monthly: 15.0        // 万円/月
  },
  withdraw: {
    startAge: 65,        // 歳から取崩し開始
    type: 'fixed-amount', // 'fixed-amount' | 'fixed-rate'
    monthly: 20.0,       // 万円/月 (定額取崩し時)
    rate: 4.0            // %/年 (定率取崩し時)
  },
  chartType: 'stacked',  // 'stacked' | 'cashflow' | 'lines'
  theme: 'dark',
  detailTableOpen: false
};

// Application State Object (Cloned from Default)
let state = JSON.parse(JSON.stringify(DEFAULT_STATE));

// Presets
const PRESETS = {
  standard: {
    currentAge: 35,
    accounts: {
      taxable: { initial: 100, monthly: 2.0, rate: 5.0, endAge: 60 },
      oldNisa: { initial: 200, rate: 5.0, transferAge: 40 },
      newNisa: { initial: 300, monthly: 5.0, rate: 5.0, endAge: 60 },
      dc: { initial: 150, monthly: 2.3, rate: 4.5, endAge: 60, receiveAge: 60, yearsPast: 5 },
      stock: { initial: 200, monthly: 0.0, rate: 4.0 }
    },
    pension: { startAge: 65, monthly: 15.0 },
    withdraw: { startAge: 65, type: 'fixed-amount', monthly: 20.0, rate: 4.0 }
  },
  fire: {
    currentAge: 30,
    accounts: {
      taxable: { initial: 300, monthly: 10.0, rate: 6.0, endAge: 50 },
      oldNisa: { initial: 100, rate: 6.0, transferAge: 35 },
      newNisa: { initial: 500, monthly: 15.0, rate: 6.0, endAge: 50 },
      dc: { initial: 100, monthly: 5.5, rate: 5.0, endAge: 55, receiveAge: 60, yearsPast: 4 },
      stock: { initial: 300, monthly: 2.0, rate: 5.0 }
    },
    pension: { startAge: 65, monthly: 12.0 },
    withdraw: { startAge: 55, type: 'fixed-rate', monthly: 25.0, rate: 4.0 }
  },
  'stock-focused': {
    currentAge: 40,
    accounts: {
      taxable: { initial: 200, monthly: 3.0, rate: 4.5, endAge: 65 },
      oldNisa: { initial: 150, rate: 4.5, transferAge: 45 },
      newNisa: { initial: 400, monthly: 8.0, rate: 5.0, endAge: 65 },
      dc: { initial: 200, monthly: 2.0, rate: 4.0, endAge: 60, receiveAge: 65, yearsPast: 10 },
      stock: { initial: 1000, monthly: 5.0, rate: 4.5 }
    },
    pension: { startAge: 65, monthly: 16.0 },
    withdraw: { startAge: 65, type: 'fixed-amount', monthly: 18.0, rate: 3.5 }
  },
  senior: {
    currentAge: 55,
    accounts: {
      taxable: { initial: 800, monthly: 5.0, rate: 3.5, endAge: 60 },
      oldNisa: { initial: 400, rate: 4.0, transferAge: 58 },
      newNisa: { initial: 600, monthly: 10.0, rate: 4.5, endAge: 65 },
      dc: { initial: 800, monthly: 2.3, rate: 3.5, endAge: 60, receiveAge: 60, yearsPast: 20 },
      stock: { initial: 500, monthly: 0.0, rate: 3.5 }
    },
    pension: { startAge: 65, monthly: 18.0 },
    withdraw: { startAge: 60, type: 'fixed-amount', monthly: 22.0, rate: 4.0 }
  }
};

// ============================================================================
// Financial Calculations (現行退職所得控除 & シミュレーション)
// ============================================================================
const NISA_LIFETIME_LIMIT = 1800; // 万円
const CAPITAL_GAINS_TAX = 0.20315; // 20.315% (特定口座運用益・譲渡益税)

/**
 * 現行の退職所得控除 & 退職所得課税計算
 * @param {number} grossAmount - DC受取総額 (万円)
 * @param {number} totalYears - 勤続・拠出年数 (年)
 */
function calcRetirementTax(grossAmount, totalYears) {
  const years = Math.max(1, Math.ceil(totalYears));
  let deduction = 0; // 万円

  // 1. 退職所得控除額
  if (years <= 20) {
    deduction = Math.max(80, 40 * years);
  } else {
    deduction = 800 + 70 * (years - 20);
  }

  // 2. 課税退職所得金額 (1,000円未満切り捨て、0以下は0)
  const taxableIncomeYen = Math.max(0, Math.floor(((grossAmount - deduction) * 10000 * 0.5) / 1000) * 1000);
  const taxableIncomeMan = taxableIncomeYen / 10000;

  if (taxableIncomeYen <= 0) {
    return {
      grossAmount,
      years,
      deduction,
      taxableIncome: 0,
      totalTax: 0,
      netAmount: grossAmount
    };
  }

  // 3. 所得税の速算表 (円単位)
  let baseIncomeTaxYen = 0;
  if (taxableIncomeYen <= 1950000) {
    baseIncomeTaxYen = taxableIncomeYen * 0.05;
  } else if (taxableIncomeYen <= 3300000) {
    baseIncomeTaxYen = taxableIncomeYen * 0.10 - 97500;
  } else if (taxableIncomeYen <= 6950000) {
    baseIncomeTaxYen = taxableIncomeYen * 0.20 - 427500;
  } else if (taxableIncomeYen <= 9000000) {
    baseIncomeTaxYen = taxableIncomeYen * 0.23 - 636000;
  } else if (taxableIncomeYen <= 18000000) {
    baseIncomeTaxYen = taxableIncomeYen * 0.33 - 1536000;
  } else if (taxableIncomeYen <= 40000000) {
    baseIncomeTaxYen = taxableIncomeYen * 0.40 - 2796000;
  } else {
    baseIncomeTaxYen = taxableIncomeYen * 0.45 - 4796000;
  }

  // 復興特別所得税 (2.1%)
  const reconTaxYen = baseIncomeTaxYen * 0.021;
  const incomeTaxYen = Math.floor(baseIncomeTaxYen + reconTaxYen);

  // 住民税 (一律10%)
  const residentTaxYen = Math.floor(taxableIncomeYen * 0.10);

  const totalTaxYen = incomeTaxYen + residentTaxYen;
  const totalTaxMan = Math.round((totalTaxYen / 10000) * 100) / 100;
  const netAmountMan = Math.round((grossAmount - totalTaxMan) * 100) / 100;

  return {
    grossAmount,
    years,
    deduction,
    taxableIncome: taxableIncomeMan,
    incomeTax: incomeTaxYen / 10000,
    residentTax: residentTaxYen / 10000,
    totalTax: totalTaxMan,
    netAmount: netAmountMan
  };
}

/**
 * ライフサイクル資産シミュレーションエンジン
 * @param {object} cfg - 現在のstate設定
 */
function runSimulation(cfg) {
  const currentAge = parseInt(cfg.currentAge, 10);
  const endAge = 100;
  const totalYears = endAge - currentAge;

  // 各口座の現在残高
  let balTaxable = parseFloat(cfg.accounts.taxable.initial) || 0;
  let bookTaxable = balTaxable; // 簿価 (元本)

  let balOldNisa = parseFloat(cfg.accounts.oldNisa.initial) || 0;
  let oldNisaTransferred = false;

  let balNewNisa = parseFloat(cfg.accounts.newNisa.initial) || 0;
  let bookNewNisa = Math.min(balNewNisa, NISA_LIFETIME_LIMIT); // 生涯枠カウント用簿価

  let balDc = parseFloat(cfg.accounts.dc.initial) || 0;
  let dcReceived = false;
  let dcNetTransferred = 0;
  let dcTaxPaid = 0;

  let balStock = parseFloat(cfg.accounts.stock.initial) || 0;

  // DCの通算年数計算
  const dcYearsPast = parseFloat(cfg.accounts.dc.yearsPast) || 0;

  const records = [];

  // 初期状態 (0年目 / 現在の年齢)
  records.push({
    age: currentAge,
    year: 0,
    totalAssets: balTaxable + balOldNisa + balNewNisa + balDc + balStock,
    taxable: balTaxable,
    oldNisa: balOldNisa,
    newNisa: balNewNisa,
    dc: balDc,
    stock: balStock,
    annualContribute: 0,
    annualGain: 0,
    annualPension: 0,
    dcTransfer: 0,
    annualWithdraw: 0,
    status: 'initial'
  });

  for (let y = 1; y <= totalYears; y++) {
    const age = currentAge + y;
    let yearContributeTotal = 0;
    let yearGainTotal = 0;
    let dcTransferThisYear = 0;

    // -------------------------------------------------------------
    // 1. 各口座の積立・運用複利計算
    // -------------------------------------------------------------

    // ① 特定口座
    let taxableMonthly = 0;
    if (age <= cfg.accounts.taxable.endAge) {
      taxableMonthly = parseFloat(cfg.accounts.taxable.monthly) || 0;
    }
    const taxableAnnualContribute = taxableMonthly * 12;
    const taxableRate = (parseFloat(cfg.accounts.taxable.rate) || 0) / 100;
    const taxableGain = (balTaxable + taxableAnnualContribute * 0.5) * taxableRate;
    balTaxable += taxableAnnualContribute + taxableGain;
    bookTaxable += taxableAnnualContribute;
    yearContributeTotal += taxableAnnualContribute;
    yearGainTotal += taxableGain;

    // ② 旧NISA口座
    let oldNisaGain = 0;
    if (!oldNisaTransferred && balOldNisa > 0) {
      const oldNisaRate = (parseFloat(cfg.accounts.oldNisa.rate) || 0) / 100;
      oldNisaGain = balOldNisa * oldNisaRate;
      balOldNisa += oldNisaGain;
      yearGainTotal += oldNisaGain;

      // 指定移管年齢に到達した場合、非課税で特定口座へ全額移管
      if (age >= cfg.accounts.oldNisa.transferAge) {
        balTaxable += balOldNisa;
        bookTaxable += balOldNisa; // 移管時時価が新たな特定口座の簿価となる
        balOldNisa = 0;
        oldNisaTransferred = true;
      }
    }

    // ③ 新NISA口座
    let newNisaMonthly = 0;
    if (age <= cfg.accounts.newNisa.endAge) {
      newNisaMonthly = parseFloat(cfg.accounts.newNisa.monthly) || 0;
    }
    // 生涯投資枠1,800万円のチェック
    let newNisaAnnualContribute = newNisaMonthly * 12;
    if (bookNewNisa + newNisaAnnualContribute > NISA_LIFETIME_LIMIT) {
      newNisaAnnualContribute = Math.max(0, NISA_LIFETIME_LIMIT - bookNewNisa);
    }
    bookNewNisa += newNisaAnnualContribute;
    const newNisaRate = (parseFloat(cfg.accounts.newNisa.rate) || 0) / 100;
    const newNisaGain = (balNewNisa + newNisaAnnualContribute * 0.5) * newNisaRate;
    balNewNisa += newNisaAnnualContribute + newNisaGain;
    yearContributeTotal += newNisaAnnualContribute;
    yearGainTotal += newNisaGain;

    // ④ 確定拠出年金 (DC/iDeCo)
    let dcMonthly = 0;
    if (!dcReceived) {
      if (age <= cfg.accounts.dc.endAge) {
        dcMonthly = parseFloat(cfg.accounts.dc.monthly) || 0;
      }
      const dcAnnualContribute = dcMonthly * 12;
      const dcRate = (parseFloat(cfg.accounts.dc.rate) || 0) / 100;
      const dcGain = (balDc + dcAnnualContribute * 0.5) * dcRate;
      balDc += dcAnnualContribute + dcGain;
      yearContributeTotal += dcAnnualContribute;
      yearGainTotal += dcGain;

      // 退職金受取年齢に到達した場合
      if (age >= cfg.accounts.dc.receiveAge) {
        const totalDcYears = dcYearsPast + (age - currentAge);
        const taxResult = calcRetirementTax(balDc, totalDcYears);
        dcNetTransferred = taxResult.netAmount;
        dcTaxPaid = taxResult.totalTax;
        dcTransferThisYear = dcNetTransferred;

        // 手取り額を特定口座へ移管
        balTaxable += dcNetTransferred;
        bookTaxable += dcNetTransferred;
        balDc = 0;
        dcReceived = true;
      }
    }

    // ⑤ 株式現物口座
    const stockMonthly = parseFloat(cfg.accounts.stock.monthly) || 0;
    const stockAnnualContribute = stockMonthly * 12;
    const stockRate = (parseFloat(cfg.accounts.stock.rate) || 0) / 100;
    const stockGain = (balStock + stockAnnualContribute * 0.5) * stockRate;
    balStock += stockAnnualContribute + stockGain;
    yearContributeTotal += stockAnnualContribute;
    yearGainTotal += stockGain;

    // -------------------------------------------------------------
    // 2. 年金受給 (公的年金)
    // -------------------------------------------------------------
    let annualPension = 0;
    if (age >= cfg.pension.startAge) {
      annualPension = (parseFloat(cfg.pension.monthly) || 0) * 12;
    }

    // -------------------------------------------------------------
    // 3. 取り崩し処理 (特定口座 → 旧NISA → 新NISA 順、現物株除外)
    // -------------------------------------------------------------
    let annualWithdrawTarget = 0;
    let actualWithdraw = 0;

    if (age >= cfg.withdraw.startAge) {
      if (cfg.withdraw.type === 'fixed-amount') {
        annualWithdrawTarget = (parseFloat(cfg.withdraw.monthly) || 0) * 12;
      } else {
        // 定率取り崩し (対象3口座の前年末/運用後残高合計に対する割合)
        const withdrawableTotal = balTaxable + balOldNisa + balNewNisa;
        const withdrawRate = (parseFloat(cfg.withdraw.rate) || 0) / 100;
        annualWithdrawTarget = withdrawableTotal * withdrawRate;
      }

      let remainingToWithdraw = annualWithdrawTarget;

      // 優先順位1位: 特定口座から取り崩し
      if (remainingToWithdraw > 0 && balTaxable > 0) {
        const drawTaxable = Math.min(balTaxable, remainingToWithdraw);
        balTaxable -= drawTaxable;
        remainingToWithdraw -= drawTaxable;
        actualWithdraw += drawTaxable;
      }

      // 優先順位2位: 旧NISAから取り崩し (移管前の残高がある場合)
      if (remainingToWithdraw > 0 && balOldNisa > 0) {
        const drawOldNisa = Math.min(balOldNisa, remainingToWithdraw);
        balOldNisa -= drawOldNisa;
        remainingToWithdraw -= drawOldNisa;
        actualWithdraw += drawOldNisa;
      }

      // 優先順位3位: 新NISAから取り崩し
      if (remainingToWithdraw > 0 && balNewNisa > 0) {
        const drawNewNisa = Math.min(balNewNisa, remainingToWithdraw);
        balNewNisa -= drawNewNisa;
        remainingToWithdraw -= drawNewNisa;
        actualWithdraw += drawNewNisa;
      }

      // 株式現物は取り崩さない (温存)
    }

    const totalAssets = balTaxable + balOldNisa + balNewNisa + balDc + balStock;

    records.push({
      age,
      year: y,
      totalAssets: Math.round(totalAssets * 10) / 10,
      taxable: Math.round(balTaxable * 10) / 10,
      oldNisa: Math.round(balOldNisa * 10) / 10,
      newNisa: Math.round(balNewNisa * 10) / 10,
      dc: Math.round(balDc * 10) / 10,
      stock: Math.round(balStock * 10) / 10,
      annualContribute: Math.round(yearContributeTotal * 10) / 10,
      annualGain: Math.round(yearGainTotal * 10) / 10,
      annualPension: Math.round(annualPension * 10) / 10,
      dcTransfer: Math.round(dcTransferThisYear * 10) / 10,
      annualWithdraw: Math.round(actualWithdraw * 10) / 10,
      targetWithdraw: Math.round(annualWithdrawTarget * 10) / 10
    });
  }

  // サマリー計算
  let peakAssetRecord = records[0];
  let totalPensionReceived = 0;
  for (const r of records) {
    if (r.totalAssets > peakAssetRecord.totalAssets) {
      peakAssetRecord = r;
    }
    totalPensionReceived += r.annualPension;
  }

  const record100 = records[records.length - 1];

  return {
    records,
    summary: {
      peakAssets: peakAssetRecord.totalAssets,
      peakAge: peakAssetRecord.age,
      finalAssets: record100.totalAssets,
      finalTaxable: record100.taxable,
      finalStock: record100.stock,
      totalPension: Math.round(totalPensionReceived),
      dcNet: dcNetTransferred,
      dcTax: dcTaxPaid,
      nisaBookTotal: bookNewNisa
    }
  };
}

// ============================================================================
// UI Controllers & Renderers
// ============================================================================
let mainChartInstance = null;

/**
 * フォーム要素とStateのバインディング
 */
function syncStateToUI() {
  // 基本プロファイル
  setInputValue('range-current-age', state.currentAge);
  setInputValue('input-current-age', state.currentAge);
  setText('disp-current-age', state.currentAge);

  // ① 特定口座
  setInputValue('range-taxable-initial', state.accounts.taxable.initial);
  setInputValue('taxable-initial', state.accounts.taxable.initial);
  setText('disp-taxable-initial', state.accounts.taxable.initial);
  setInputValue('taxable-monthly', state.accounts.taxable.monthly);
  setText('disp-taxable-monthly', state.accounts.taxable.monthly);
  setInputValue('taxable-rate', state.accounts.taxable.rate);
  setText('disp-taxable-rate', state.accounts.taxable.rate);
  setInputValue('taxable-end-age', state.accounts.taxable.endAge);
  setText('disp-taxable-end-age', state.accounts.taxable.endAge);
  setText('sum-taxable', `初期 ${state.accounts.taxable.initial}万 / 積立 ${state.accounts.taxable.monthly}万`);

  // ② 旧NISA
  setInputValue('range-oldnisa-initial', state.accounts.oldNisa.initial);
  setInputValue('oldnisa-initial', state.accounts.oldNisa.initial);
  setText('disp-oldnisa-initial', state.accounts.oldNisa.initial);
  setInputValue('oldnisa-rate', state.accounts.oldNisa.rate);
  setText('disp-oldnisa-rate', state.accounts.oldNisa.rate);
  setInputValue('oldnisa-transfer-age', state.accounts.oldNisa.transferAge);
  setText('disp-oldnisa-transfer-age', state.accounts.oldNisa.transferAge);
  setText('sum-oldnisa', `初期 ${state.accounts.oldNisa.initial}万 / ${state.accounts.oldNisa.transferAge}歳移管`);

  // ③ 新NISA
  setInputValue('range-newnisa-initial', state.accounts.newNisa.initial);
  setInputValue('newnisa-initial', state.accounts.newNisa.initial);
  setText('disp-newnisa-initial', state.accounts.newNisa.initial);
  setInputValue('newnisa-monthly', state.accounts.newNisa.monthly);
  setText('disp-newnisa-monthly', state.accounts.newNisa.monthly);
  setInputValue('newnisa-rate', state.accounts.newNisa.rate);
  setText('disp-newnisa-rate', state.accounts.newNisa.rate);
  setInputValue('newnisa-end-age', state.accounts.newNisa.endAge);
  setText('disp-newnisa-end-age', state.accounts.newNisa.endAge);
  setText('sum-newnisa', `初期 ${state.accounts.newNisa.initial}万 / 積立 ${state.accounts.newNisa.monthly}万`);

  // ④ DC
  setInputValue('range-dc-initial', state.accounts.dc.initial);
  setInputValue('dc-initial', state.accounts.dc.initial);
  setText('disp-dc-initial', state.accounts.dc.initial);
  setInputValue('dc-monthly', state.accounts.dc.monthly);
  setText('disp-dc-monthly', state.accounts.dc.monthly);
  setInputValue('dc-rate', state.accounts.dc.rate);
  setText('disp-dc-rate', state.accounts.dc.rate);
  setInputValue('dc-end-age', state.accounts.dc.endAge);
  setText('disp-dc-end-age', state.accounts.dc.endAge);
  setInputValue('dc-receive-age', state.accounts.dc.receiveAge);
  setText('disp-dc-receive-age', state.accounts.dc.receiveAge);
  setInputValue('dc-years-past', state.accounts.dc.yearsPast);
  setText('disp-dc-years-past', state.accounts.dc.yearsPast);
  setText('sum-dc', `初期 ${state.accounts.dc.initial}万 / 拠出 ${state.accounts.dc.monthly}万`);

  // ⑤ 株式現物
  setInputValue('range-stock-initial', state.accounts.stock.initial);
  setInputValue('stock-initial', state.accounts.stock.initial);
  setText('disp-stock-initial', state.accounts.stock.initial);
  setInputValue('stock-monthly', state.accounts.stock.monthly);
  setText('disp-stock-monthly', state.accounts.stock.monthly);
  setInputValue('stock-rate', state.accounts.stock.rate);
  setText('disp-stock-rate', state.accounts.stock.rate);
  setText('sum-stock', `初期 ${state.accounts.stock.initial}万 / 買増 ${state.accounts.stock.monthly}万`);

  // 公的年金
  setInputValue('pension-start-age', state.pension.startAge);
  setText('disp-pension-start-age', state.pension.startAge);
  setInputValue('pension-monthly', state.pension.monthly);
  setText('disp-pension-monthly', state.pension.monthly);
  setText('disp-pension-annual', Math.round(state.pension.monthly * 12));

  // 取り崩し
  setInputValue('range-withdraw-start-age', state.withdraw.startAge);
  setInputValue('withdraw-start-age', state.withdraw.startAge);
  setText('disp-withdraw-start-age', state.withdraw.startAge);

  const radioType = document.querySelector(`input[name="withdraw-type"][value="${state.withdraw.type}"]`);
  if (radioType) radioType.checked = true;

  if (state.withdraw.type === 'fixed-amount') {
    document.getElementById('box-withdraw-amount').classList.remove('hidden');
    document.getElementById('box-withdraw-rate').classList.add('hidden');
  } else {
    document.getElementById('box-withdraw-amount').classList.add('hidden');
    document.getElementById('box-withdraw-rate').classList.remove('hidden');
  }

  setInputValue('range-withdraw-monthly', state.withdraw.monthly);
  setInputValue('withdraw-monthly', state.withdraw.monthly);
  setText('disp-withdraw-monthly', state.withdraw.monthly);
  setText('disp-withdraw-annual', Math.round(state.withdraw.monthly * 12));

  setInputValue('range-withdraw-rate', state.withdraw.rate);
  setInputValue('withdraw-rate', state.withdraw.rate);
  setText('disp-withdraw-rate', state.withdraw.rate);

  // NISA Progress
  const nisaInitial = parseFloat(state.accounts.newNisa.initial) || 0;
  const fillPct = Math.min(100, Math.round((nisaInitial / NISA_LIFETIME_LIMIT) * 100));
  const elFill = document.getElementById('nisa-limit-fill');
  if (elFill) elFill.style.width = `${fillPct}%`;
  setText('nisa-limit-fill-info', `${nisaInitial}万 / 1,800万 (${fillPct}%)`);
}

function setInputValue(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/**
 * UIからStateを読み取って更新
 */
function readStateFromUI() {
  state.currentAge = parseInt(document.getElementById('input-current-age').value, 10) || 35;

  state.accounts.taxable.initial = parseFloat(document.getElementById('taxable-initial').value) || 0;
  state.accounts.taxable.monthly = parseFloat(document.getElementById('taxable-monthly').value) || 0;
  state.accounts.taxable.rate = parseFloat(document.getElementById('taxable-rate').value) || 0;
  state.accounts.taxable.endAge = parseInt(document.getElementById('taxable-end-age').value, 10) || 60;

  state.accounts.oldNisa.initial = parseFloat(document.getElementById('oldnisa-initial').value) || 0;
  state.accounts.oldNisa.rate = parseFloat(document.getElementById('oldnisa-rate').value) || 0;
  state.accounts.oldNisa.transferAge = parseInt(document.getElementById('oldnisa-transfer-age').value, 10) || 40;

  state.accounts.newNisa.initial = parseFloat(document.getElementById('newnisa-initial').value) || 0;
  state.accounts.newNisa.monthly = parseFloat(document.getElementById('newnisa-monthly').value) || 0;
  state.accounts.newNisa.rate = parseFloat(document.getElementById('newnisa-rate').value) || 0;
  state.accounts.newNisa.endAge = parseInt(document.getElementById('newnisa-end-age').value, 10) || 60;

  state.accounts.dc.initial = parseFloat(document.getElementById('dc-initial').value) || 0;
  state.accounts.dc.monthly = parseFloat(document.getElementById('dc-monthly').value) || 0;
  state.accounts.dc.rate = parseFloat(document.getElementById('dc-rate').value) || 0;
  state.accounts.dc.endAge = parseInt(document.getElementById('dc-end-age').value, 10) || 60;
  state.accounts.dc.receiveAge = parseInt(document.getElementById('dc-receive-age').value, 10) || 60;
  state.accounts.dc.yearsPast = parseFloat(document.getElementById('dc-years-past').value) || 0;

  state.accounts.stock.initial = parseFloat(document.getElementById('stock-initial').value) || 0;
  state.accounts.stock.monthly = parseFloat(document.getElementById('stock-monthly').value) || 0;
  state.accounts.stock.rate = parseFloat(document.getElementById('stock-rate').value) || 0;

  state.pension.startAge = parseInt(document.getElementById('pension-start-age').value, 10) || 65;
  state.pension.monthly = parseFloat(document.getElementById('pension-monthly').value) || 0;

  state.withdraw.startAge = parseInt(document.getElementById('withdraw-start-age').value, 10) || 65;
  const checkedRadio = document.querySelector('input[name="withdraw-type"]:checked');
  if (checkedRadio) state.withdraw.type = checkedRadio.value;

  state.withdraw.monthly = parseFloat(document.getElementById('withdraw-monthly').value) || 0;
  state.withdraw.rate = parseFloat(document.getElementById('withdraw-rate').value) || 0;

  // LocalStorageに保存
  saveStateToLocalStorage();
}

/**
 * シミュレーションの実行と全画面更新
 */
function updateSimulation() {
  readStateFromUI();
  const sim = runSimulation(state);

  // 1. KPI更新
  setText('kpi-peak-assets', formatNumber(sim.summary.peakAssets));
  setText('kpi-peak-age', `${sim.summary.peakAge} 歳到達時`);
  setText('kpi-100-assets', formatNumber(sim.summary.finalAssets));
  setText('kpi-100-status', sim.summary.finalAssets > 0 ? (sim.summary.finalAssets > 2000 ? '資産潤沢' : '資産維持') : '資産枯渇');
  setText('kpi-dc-net', formatNumber(sim.summary.dcNet));
  setText('kpi-dc-tax-saved', `税引前: ${formatNumber(sim.summary.dcNet + sim.summary.dcTax)}万 (税額 ${formatNumber(sim.summary.dcTax)}万)`);
  setText('kpi-pension-total', formatNumber(sim.summary.totalPension));
  setText('kpi-pension-span', `${state.pension.startAge}歳〜100歳 (月${state.pension.monthly}万)`);

  // DCプレビューボックス更新
  const dcReceiveRecord = sim.records.find(r => r.age === state.accounts.dc.receiveAge);
  if (dcReceiveRecord && sim.summary.dcNet > 0) {
    const grossDc = sim.summary.dcNet + sim.summary.dcTax;
    const totalDcYears = state.accounts.dc.yearsPast + (state.accounts.dc.receiveAge - state.currentAge);
    const taxInfo = calcRetirementTax(grossDc, totalDcYears);
    setText('preview-dc-total', formatNumber(grossDc));
    setText('preview-dc-years', `${taxInfo.years}`);
    setText('preview-dc-deduction', formatNumber(taxInfo.deduction));
    setText('preview-dc-tax', formatNumber(taxInfo.totalTax));
    setText('preview-dc-net', formatNumber(taxInfo.netAmount));
  } else {
    setText('preview-dc-total', '-');
    setText('preview-dc-years', '-');
    setText('preview-dc-deduction', '-');
    setText('preview-dc-tax', '-');
    setText('preview-dc-net', '-');
  }

  // 2. グラフ描画更新
  renderChart(sim.records);

  // 3. マイルストーン描画 (60歳〜100歳 10歳刻み)
  renderMilestones(sim.records);

  // 4. 全年齢詳細テーブル描画
  renderDetailTable(sim.records);
}

/**
 * マイルストーンの描画 (60, 70, 80, 90, 100歳)
 */
function renderMilestones(records) {
  const targetAges = [60, 70, 80, 90, 100];
  const container = document.getElementById('milestone-cards-container');
  const tableBody = document.getElementById('milestone-table-body');
  
  if (!container || !tableBody) return;

  container.innerHTML = '';
  tableBody.innerHTML = '';

  targetAges.forEach(targetAge => {
    // レコード取得 (存在しない場合は最終または最寄りのレコード)
    const rec = records.find(r => r.age === targetAge) || records[records.length - 1];
    if (!rec) return;

    // 健全性ステータス判定
    let statusClass = 'status-rich';
    let statusText = '潤沢';
    if (rec.totalAssets <= 0) {
      statusClass = 'status-depleted';
      statusText = '枯渇';
    } else if (rec.totalAssets < 1000) {
      statusClass = 'status-warning';
      statusText = '要注意';
    } else if (rec.totalAssets < 3000) {
      statusClass = 'status-stable';
      statusText = '安定';
    }

    // 1. マイルストーンカード生成
    const card = document.createElement('div');
    card.className = 'milestone-card';
    card.innerHTML = `
      <div class="m-header">
        <span class="m-age"><i data-lucide="calendar"></i> ${targetAge} 歳時点</span>
        <span class="m-status-badge ${statusClass}">${statusText}</span>
      </div>
      <div class="m-total">
        <span class="m-total-label">総資産額</span>
        <span class="m-total-val">${formatNumber(rec.totalAssets)} <small style="font-size:0.7rem;">万円</small></span>
      </div>
      <div class="m-breakdown">
        <div class="m-row"><span>特定口座:</span><strong>${formatNumber(rec.taxable)} 万</strong></div>
        <div class="m-row"><span>旧NISA:</span><strong>${formatNumber(rec.oldNisa)} 万</strong></div>
        <div class="m-row"><span>新NISA:</span><strong>${formatNumber(rec.newNisa)} 万</strong></div>
        <div class="m-row"><span>確定拠出(DC):</span><strong>${formatNumber(rec.dc)} 万</strong></div>
        <div class="m-row"><span>株式現物:</span><strong>${formatNumber(rec.stock)} 万</strong></div>
      </div>
      <div class="m-cashflow-row">
        <span>年金: <strong>${rec.annualPension > 0 ? formatNumber(rec.annualPension) + '万' : 'なし'}</strong></span>
        <span>取崩し: <strong>${rec.annualWithdraw > 0 ? formatNumber(rec.annualWithdraw) + '万' : '0万'}</strong></span>
      </div>
    `;
    container.appendChild(card);

    // 2. マイルストーンテーブル行生成
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${targetAge} 歳時点</strong> (経過${rec.year}年)</td>
      <td><strong style="color: var(--text-primary);">${formatNumber(rec.totalAssets)} 万円</strong></td>
      <td style="color: var(--col-taxable);">${formatNumber(rec.taxable)} 万円</td>
      <td style="color: var(--col-oldnisa);">${formatNumber(rec.oldNisa)} 万円</td>
      <td style="color: var(--col-newnisa);">${formatNumber(rec.newNisa)} 万円</td>
      <td style="color: var(--col-dc);">${formatNumber(rec.dc)} 万円</td>
      <td style="color: var(--col-stock);">${formatNumber(rec.stock)} 万円</td>
      <td>${rec.annualPension > 0 ? formatNumber(rec.annualPension) + ' 万円' : '-'}</td>
      <td style="color: ${rec.annualWithdraw > 0 ? 'var(--col-danger)' : 'inherit'};">${rec.annualWithdraw > 0 ? formatNumber(rec.annualWithdraw) + ' 万円' : '-'}</td>
      <td><span class="m-status-badge ${statusClass}">${statusText}</span></td>
    `;
    tableBody.appendChild(tr);
  });

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

/**
 * 全年齢詳細テーブルの描画
 */
function renderDetailTable(records) {
  const tableBody = document.getElementById('full-detail-table-body');
  if (!tableBody) return;

  tableBody.innerHTML = '';

  records.forEach(rec => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${rec.age} 歳</strong></td>
      <td>${rec.year}年目</td>
      <td><strong>${formatNumber(rec.totalAssets)} 万</strong></td>
      <td>${rec.annualContribute > 0 ? '+' + formatNumber(rec.annualContribute) + ' 万' : '-'}</td>
      <td style="color: ${rec.annualGain >= 0 ? 'var(--col-success)' : 'var(--col-danger)'};">${rec.annualGain >= 0 ? '+' : ''}${formatNumber(rec.annualGain)} 万</td>
      <td>${rec.annualPension > 0 ? formatNumber(rec.annualPension) + ' 万' : '-'}</td>
      <td style="color: var(--col-dc);">${rec.dcTransfer > 0 ? '+' + formatNumber(rec.dcTransfer) + ' 万 (移管)' : '-'}</td>
      <td style="color: var(--col-taxable);">${formatNumber(rec.taxable)} 万</td>
      <td style="color: var(--col-oldnisa);">${formatNumber(rec.oldNisa)} 万</td>
      <td style="color: var(--col-newnisa);">${formatNumber(rec.newNisa)} 万</td>
      <td style="color: var(--col-dc);">${formatNumber(rec.dc)} 万</td>
      <td style="color: var(--col-stock);">${formatNumber(rec.stock)} 万</td>
      <td style="color: ${rec.annualWithdraw > 0 ? 'var(--col-danger)' : 'inherit'};">${rec.annualWithdraw > 0 ? '-' + formatNumber(rec.annualWithdraw) + ' 万' : '-'}</td>
    `;
    tableBody.appendChild(tr);
  });

  setText('badge-table-rows', `${state.currentAge}歳〜100歳 (${records.length}行)`);
}

/**
 * Chart.js グラフ描画
 */
function renderChart(records) {
  const ctx = document.getElementById('mainChart');
  if (!ctx) return;

  const labels = records.map(r => `${r.age}歳`);

  const dataTaxable = records.map(r => r.taxable);
  const dataOldNisa = records.map(r => r.oldNisa);
  const dataNewNisa = records.map(r => r.newNisa);
  const dataDc = records.map(r => r.dc);
  const dataStock = records.map(r => r.stock);
  const dataTotal = records.map(r => r.totalAssets);

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)';
  const textColor = isDark ? '#9ca3af' : '#4b5563';

  if (mainChartInstance) {
    mainChartInstance.destroy();
  }

  if (state.chartType === 'stacked') {
    // 口座別積み上げ面グラフ
    mainChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: '株式現物 (温存)',
            data: dataStock,
            backgroundColor: 'rgba(244, 63, 94, 0.55)',
            borderColor: '#f43f5e',
            borderWidth: 1.5,
            fill: true,
            tension: 0.25,
            pointRadius: 0
          },
          {
            label: '確定拠出年金 (DC)',
            data: dataDc,
            backgroundColor: 'rgba(139, 92, 246, 0.55)',
            borderColor: '#8b5cf6',
            borderWidth: 1.5,
            fill: true,
            tension: 0.25,
            pointRadius: 0
          },
          {
            label: '新NISA (非課税)',
            data: dataNewNisa,
            backgroundColor: 'rgba(16, 185, 129, 0.55)',
            borderColor: '#10b981',
            borderWidth: 1.5,
            fill: true,
            tension: 0.25,
            pointRadius: 0
          },
          {
            label: '旧NISA (移管前)',
            data: dataOldNisa,
            backgroundColor: 'rgba(245, 158, 11, 0.55)',
            borderColor: '#f59e0b',
            borderWidth: 1.5,
            fill: true,
            tension: 0.25,
            pointRadius: 0
          },
          {
            label: '特定口座 (課税)',
            data: dataTaxable,
            backgroundColor: 'rgba(6, 182, 212, 0.55)',
            borderColor: '#06b6d4',
            borderWidth: 1.5,
            fill: true,
            tension: 0.25,
            pointRadius: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(c) {
                return `${c.dataset.label}: ${formatNumber(c.parsed.y)} 万円`;
              },
              footer: function(items) {
                let sum = 0;
                items.forEach(i => sum += i.parsed.y);
                return `総資産額: ${formatNumber(sum)} 万円`;
              }
            }
          }
        },
        scales: {
          x: { grid: { color: gridColor }, ticks: { color: textColor, maxTicksLimit: 12 } },
          y: { stacked: true, grid: { color: gridColor }, ticks: { color: textColor, callback: v => `${v}万` } }
        }
      }
    });
  } else if (state.chartType === 'cashflow') {
    // キャッシュフロー棒グラフ
    const dataContribute = records.map(r => r.annualContribute);
    const dataPension = records.map(r => r.annualPension);
    const dataWithdraw = records.map(r => -r.annualWithdraw);

    mainChartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: '年間積立拠出',
            data: dataContribute,
            backgroundColor: 'rgba(99, 102, 241, 0.7)',
            borderRadius: 4
          },
          {
            label: '公的年金受給',
            data: dataPension,
            backgroundColor: 'rgba(245, 158, 11, 0.7)',
            borderRadius: 4
          },
          {
            label: '資産取り崩し (支出)',
            data: dataWithdraw,
            backgroundColor: 'rgba(239, 68, 68, 0.7)',
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, position: 'top', labels: { color: textColor, boxWidth: 12 } },
          tooltip: {
            callbacks: {
              label: function(c) {
                return `${c.dataset.label}: ${formatNumber(Math.abs(c.parsed.y))} 万円`;
              }
            }
          }
        },
        scales: {
          x: { grid: { color: gridColor }, ticks: { color: textColor, maxTicksLimit: 12 } },
          y: { grid: { color: gridColor }, ticks: { color: textColor, callback: v => `${v}万` } }
        }
      }
    });
  } else {
    // 口座別推移線
    mainChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: '総資産額',
            data: dataTotal,
            borderColor: '#ffffff',
            borderWidth: 2.5,
            tension: 0.2,
            pointRadius: 0
          },
          {
            label: '特定口座',
            data: dataTaxable,
            borderColor: '#06b6d4',
            borderWidth: 1.8,
            tension: 0.2,
            pointRadius: 0
          },
          {
            label: '旧NISA',
            data: dataOldNisa,
            borderColor: '#f59e0b',
            borderWidth: 1.8,
            tension: 0.2,
            pointRadius: 0
          },
          {
            label: '新NISA',
            data: dataNewNisa,
            borderColor: '#10b981',
            borderWidth: 1.8,
            tension: 0.2,
            pointRadius: 0
          },
          {
            label: '確定拠出年金 (DC)',
            data: dataDc,
            borderColor: '#8b5cf6',
            borderWidth: 1.8,
            tension: 0.2,
            pointRadius: 0
          },
          {
            label: '株式現物',
            data: dataStock,
            borderColor: '#f43f5e',
            borderWidth: 1.8,
            tension: 0.2,
            pointRadius: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(c) {
                return `${c.dataset.label}: ${formatNumber(c.parsed.y)} 万円`;
              }
            }
          }
        },
        scales: {
          x: { grid: { color: gridColor }, ticks: { color: textColor, maxTicksLimit: 12 } },
          y: { grid: { color: gridColor }, ticks: { color: textColor, callback: v => `${v}万` } }
        }
      }
    });
  }
}

// ============================================================================
// JSON Export / Import & Storage
// ============================================================================

/**
 * 設定をJSONファイルとして保存 (ダウンロード)
 */
function exportSettingsAsJSON() {
  readStateFromUI();
  const exportData = {
    appName: 'WealthBuildingSimulatorPro',
    version: '2.0.0',
    exportedAt: new Date().toISOString(),
    config: state
  };

  const jsonString = JSON.stringify(exportData, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `wealth_simulation_config_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('設定をJSONファイルとして保存しました', 'success');
}

/**
 * JSONファイルを読み込んで設定を復元
 */
function importSettingsFromJSON(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const parsed = JSON.parse(evt.target.result);
      const config = parsed.config || parsed;
      if (!config.accounts || !config.currentAge) {
        throw new Error('有効なシミュレーター設定ファイルではありません');
      }

      state = Object.assign({}, DEFAULT_STATE, config);
      syncStateToUI();
      updateSimulation();
      showToast('設定ファイルを正常に読み込みました', 'success');
    } catch (err) {
      showToast('ファイルの読み込みに失敗しました: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
  e.target.value = ''; // リセット
}

/**
 * CSVエクスポート
 */
function exportTableCSV() {
  const sim = runSimulation(state);
  let csv = '年齢,経過年,総資産額(万円),年間積立(万円),年間運用益(万円),公的年金(万円),DC受取移管(万円),特定口座(万円),旧NISA(万円),新NISA(万円),確定拠出年金(万円),株式現物(万円),年間取崩し(万円)\n';

  sim.records.forEach(r => {
    csv += `${r.age},${r.year},${r.totalAssets},${r.annualContribute},${r.annualGain},${r.annualPension},${r.dcTransfer},${r.taxable},${r.oldNisa},${r.newNisa},${r.dc},${r.stock},${r.annualWithdraw}\n`;
  });

  const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `wealth_simulation_data_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('CSVファイルをダウンロードしました', 'success');
}

/**
 * LocalStorage 保存 & 読込
 */
function saveStateToLocalStorage() {
  try {
    localStorage.setItem('wealth_sim_pro_state', JSON.stringify(state));
  } catch (e) {
    console.warn('LocalStorage error:', e);
  }
}

function loadStateFromLocalStorage() {
  try {
    const saved = localStorage.getItem('wealth_sim_pro_state');
    if (saved) {
      const parsed = JSON.parse(saved);
      state = Object.assign({}, DEFAULT_STATE, parsed);
    }
  } catch (e) {
    console.warn('LocalStorage load error:', e);
  }
}

// ============================================================================
// Utilities & Helpers
// ============================================================================
function formatNumber(num) {
  if (num === null || num === undefined || isNaN(num)) return '0';
  return Number(num).toLocaleString('ja-JP', { maximumFractionDigits: 1 });
}

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<i data-lucide="${type === 'success' ? 'check-circle' : 'alert-circle'}"></i> <span>${msg}</span>`;
  container.appendChild(toast);

  if (window.lucide) window.lucide.createIcons();

  setTimeout(() => {
    toast.style.animation = 'toastOut 0.25s ease-in forwards';
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 250);
  }, 3500);
}

// ============================================================================
// Event Listeners Initialization
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  // 1. LocalStorageから設定復元
  loadStateFromLocalStorage();

  // 2. テーマ初期化
  const savedTheme = localStorage.getItem('wealth_sim_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeIcon(savedTheme);

  // 3. UIとState同期 & 初回シミュレーション実行
  syncStateToUI();
  updateSimulation();

  // 4. イベントリスナー登録

  // 入力変更リスナー (スライダー & 数値入力)
  const form = document.getElementById('sim-form');
  if (form) {
    form.addEventListener('input', (e) => {
      // 双方向スライダーと数値入力の同期
      const id = e.target.id;
      if (id.startsWith('range-')) {
        const numId = id.replace('range-', '');
        const targetInput = document.getElementById(numId) || document.getElementById('input-' + numId);
        if (targetInput) targetInput.value = e.target.value;
      } else if (e.target.classList.contains('num-input')) {
        const rangeId = 'range-' + id.replace('input-', '');
        const targetRange = document.getElementById(rangeId);
        if (targetRange) targetRange.value = e.target.value;
      }

      // 取り崩しラジオ切り替え時の表示制御
      if (e.target.name === 'withdraw-type') {
        if (e.target.value === 'fixed-amount') {
          document.getElementById('box-withdraw-amount').classList.remove('hidden');
          document.getElementById('box-withdraw-rate').classList.add('hidden');
        } else {
          document.getElementById('box-withdraw-amount').classList.add('hidden');
          document.getElementById('box-withdraw-rate').classList.remove('hidden');
        }
      }

      updateSimulation();
    });
  }

  // アコーディオン開閉
  document.querySelectorAll('.acc-header').forEach(header => {
    header.addEventListener('click', () => {
      const box = header.closest('.account-box');
      if (box) {
        box.classList.toggle('collapsed');
      }
    });
  });

  // プリセットボタン
  document.querySelectorAll('.btn-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const presetKey = btn.dataset.preset;
      if (PRESETS[presetKey]) {
        document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        state = JSON.parse(JSON.stringify(PRESETS[presetKey]));
        syncStateToUI();
        updateSimulation();
        showToast(`「${btn.querySelector('.preset-name').textContent}」シナリオを適用しました`, 'success');
      }
    });
  });

  // グラフ切り替えボタン
  document.querySelectorAll('.btn-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-toggle').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.chartType = btn.dataset.chart;
      updateSimulation();
    });
  });

  // JSONファイル保存
  const btnSaveJson = document.getElementById('btn-save-json');
  if (btnSaveJson) btnSaveJson.addEventListener('click', exportSettingsAsJSON);

  // JSONファイル読込
  const btnLoadJson = document.getElementById('btn-load-json');
  const inputJson = document.getElementById('input-file-json');
  if (btnLoadJson && inputJson) {
    btnLoadJson.addEventListener('click', () => inputJson.click());
    inputJson.addEventListener('change', importSettingsFromJSON);
  }

  // CSV出力
  const btnExportCsv = document.getElementById('btn-export-csv');
  const btnTableCsv = document.getElementById('btn-table-download-csv');
  if (btnExportCsv) btnExportCsv.addEventListener('click', exportTableCSV);
  if (btnTableCsv) btnTableCsv.addEventListener('click', exportTableCSV);

  // テーマ切り替え
  const btnTheme = document.getElementById('btn-theme-toggle');
  if (btnTheme) {
    btnTheme.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('wealth_sim_theme', next);
      updateThemeIcon(next);
      updateSimulation();
    });
  }

  // 全初期化リセット
  const btnReset = document.getElementById('btn-reset-all');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      if (confirm('すべての入力設定を初期状態に戻しますか？')) {
        state = JSON.parse(JSON.stringify(DEFAULT_STATE));
        syncStateToUI();
        updateSimulation();
        showToast('設定を初期化しました', 'info');
      }
    });
  }

  // 詳細テーブル開閉
  const btnToggleDetail = document.getElementById('btn-toggle-detail-table');
  const boxDetail = document.getElementById('box-detail-table');
  const iconDetail = document.getElementById('icon-detail-table');
  if (btnToggleDetail && boxDetail) {
    boxDetail.classList.add('collapsed'); // デフォルトは閉じておく
    btnToggleDetail.addEventListener('click', () => {
      boxDetail.classList.toggle('collapsed');
      if (iconDetail) {
        iconDetail.style.transform = boxDetail.classList.contains('collapsed') ? 'rotate(0deg)' : 'rotate(180deg)';
      }
    });
  }

  // Lucideアイコン初期化
  if (window.lucide) {
    window.lucide.createIcons();
  }
});

function updateThemeIcon(theme) {
  const iconLight = document.getElementById('icon-theme-light');
  const iconDark = document.getElementById('icon-theme-dark');
  if (iconLight && iconDark) {
    if (theme === 'light') {
      iconLight.classList.remove('hidden');
      iconDark.classList.add('hidden');
    } else {
      iconLight.classList.add('hidden');
      iconDark.classList.remove('hidden');
    }
  }
}
